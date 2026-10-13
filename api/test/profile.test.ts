import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Polygon } from "geojson";
import {
  RAMEN_RESTAURANT_TAG,
  SCENARIOS,
  type ScoutEvent,
  type ZoneProfile,
} from "@whitespace/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SyntheticFixtures } from "../src/demo/fixtures.js";
import { IpRateLimiter } from "../src/limits.js";
import { QlooClient } from "../src/qloo/client.js";
import { mostCommon, polygonWkt, profileZone } from "../src/profile/profile.js";
import { runScout } from "../src/scout/pipeline.js";

const scenario = SCENARIOS[0]!;
const square = (west: number, south: number, east: number, north: number): Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});

const demoClient = () =>
  new QlooClient({
    baseUrl: "https://hackathon.api.qloo.com",
    apiKey: undefined,
    demo: true,
    demoSource: new SyntheticFixtures(resolve(import.meta.dirname, "../fixtures")),
    logger: { warn: vi.fn() },
  });

const place = (id: string, lon: number, lat: number, extra: Record<string, unknown> = {}) => ({
  entity_id: id,
  name: id,
  location: { lat, lon },
  ...extra,
});

describe("profile helpers", () => {
  it("writes a closed WKT ring with rounded coordinates", () => {
    const open: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-97.7234567, 30.26],
          [-97.71, 30.26],
          [-97.71, 30.27],
        ],
      ],
    };
    expect(polygonWkt(open)).toBe(
      "POLYGON((-97.72346 30.26000, -97.71000 30.26000, -97.71000 30.27000, -97.72346 30.26000))",
    );
    expect(polygonWkt(square(0, 0, 1, 1))).toBe(
      "POLYGON((0.00000 0.00000, 1.00000 0.00000, 1.00000 1.00000, 0.00000 1.00000, 0.00000 0.00000))",
    );
  });

  it("picks the most common value, first one on ties", () => {
    expect(mostCommon(["a", "b", "b", "a", "c", "b"])).toBe("b");
    expect(mostCommon(["x", "y"])).toBe("x");
    expect(mostCommon([])).toBeUndefined();
  });
});

describe("profileZone", () => {
  it("keeps places inside the zone, drops competitors and names the neighborhood", async () => {
    const response = {
      results: {
        entities: [
          place("bar", -97.715, 30.265, {
            properties: { neighborhood: "East Cesar Chavez" },
            tags: [{ id: "urn:tag:genre:place:bar", type: "urn:tag:genre:place" }],
            query: { affinity: 0.96, explainability: { "signal.interests.entities": [] } },
          }),
          place("ramen", -97.716, 30.266, {
            properties: { neighborhood: "East Cesar Chavez" },
            tags: [{ id: RAMEN_RESTAURANT_TAG.id, type: "urn:tag:genre:place" }],
          }),
          place("coffee", -97.714, 30.264, { properties: { neighborhood: "Holly" } }),
          place("far away", -97.8, 30.4, { properties: { neighborhood: "Elsewhere" } }),
        ],
      },
    };
    const call = vi.fn(async () => ({
      data: response,
      source: "live" as const,
      trace: {
        id: "q1",
        label: "Zone 1 profile",
        endpoint: "/v2/insights",
        params: {},
        resultCount: 4,
        ms: 1,
        cached: false,
      },
    }));

    const profile = await profileZone(
      { id: "z1", rank: 1, polygon: square(-97.72, 30.26, -97.71, 30.27) },
      "a,b",
      new Set([RAMEN_RESTAURANT_TAG.id]),
      call,
    );

    expect(profile.neighborhood).toBe("East Cesar Chavez");
    expect(profile.tastePlaces.map((entry) => entry.id)).toEqual(["bar", "coffee"]);
    const [, params, label] = call.mock.calls[0] as unknown as [
      string,
      Record<string, string>,
      string,
    ];
    expect(params["filter.location"]).toMatch(/^POLYGON\(\(/);
    expect(params["feature.explainability"]).toBe("true");
    expect(label).toBe("Zone 1 profile");
  });
});

describe("profiles in the pipeline", () => {
  it("sends zones first, then the same zones with profiles", async () => {
    const results: ScoutEvent[] = [];
    const final = await runScout(
      {
        concept: scenario.concept,
        cityId: scenario.cityId,
        anchors: scenario.anchors,
        categoryTags: scenario.categoryTags,
      },
      demoClient(),
      (event) => {
        if (event.type === "result") results.push(event);
      },
    );

    expect(results).toHaveLength(2);
    const [first, second] = results as Extract<ScoutEvent, { type: "result" }>[];
    expect(first!.result.zones.every((zone) => zone.profile === undefined)).toBe(true);
    expect(second!.result).toEqual(final);
    const profiled = final.zones.filter((zone) => zone.profile);
    expect(profiled.length).toBe(final.zones.length);
    expect(profiled.some((zone) => (zone.profile?.tastePlaces.length ?? 0) > 0)).toBe(true);
    for (const zone of profiled) {
      for (const entry of zone.profile!.tastePlaces) {
        expect(entry.tags).not.toContain(RAMEN_RESTAURANT_TAG.id);
      }
    }
    expect(final.trace.filter((step) => step.label.endsWith("profile"))).toHaveLength(3);
  });
});

describe("POST /api/profile", () => {
  const body = {
    anchorIds: scenario.anchors.map((anchor) => anchor.id),
    categoryTagIds: [RAMEN_RESTAURANT_TAG.id],
    zones: [{ id: "zone-east", rank: 1, polygon: square(-97.73, 30.25, -97.7, 30.28) }],
  };
  const post = (app: ReturnType<typeof createApp>, payload: unknown) =>
    app.request("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.4" },
      body: JSON.stringify(payload),
    });

  it("returns a profile per zone id", async () => {
    const app = createApp(loadConfig({ DEMO_MODE: "true" }), { qloo: demoClient() });

    const response = await post(app, body);

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      profiles: Record<string, ZoneProfile>;
      trace: unknown[];
      demo: boolean;
    };
    expect(Object.keys(json.profiles)).toEqual(["zone-east"]);
    expect(json.trace).toHaveLength(1);
    expect(json.demo).toBe(true);
  });

  it("rejects bad shapes and too many zones", async () => {
    const app = createApp(loadConfig({ DEMO_MODE: "true" }), { qloo: demoClient() });
    expect((await post(app, { ...body, zones: [] })).status).toBe(400);
    const tooMany = Array.from({ length: 6 }, (_, index) => ({
      ...body.zones[0]!,
      id: `z${index}`,
    }));
    expect((await post(app, { ...body, zones: tooMany })).status).toBe(400);
    expect((await post(app, { ...body, anchorIds: [] })).status).toBe(400);
  });

  it("limits each address separately from /api/scout", async () => {
    const limiter = new IpRateLimiter(1, 1);
    limiter.take("198.51.100.4");
    const app = createApp(loadConfig({ DEMO_MODE: "true" }), {
      qloo: demoClient(),
      profileLimiter: limiter,
    });

    expect((await post(app, body)).status).toBe(429);
  });
});
