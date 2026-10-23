import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  RAMEN_RESTAURANT_TAG,
  SCENARIOS,
  findCity,
  type ScoutEvent,
  type ScoutResult,
} from "@whitespace/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SyntheticFixtures } from "../src/demo/fixtures.js";
import { QlooClient } from "../src/qloo/client.js";
import { Limiter } from "../src/qloo/limiter.js";
import {
  bboxPolygon,
  loadHeatmap,
  runScout,
  ScoutInputError,
  type ScoutInput,
} from "../src/scout/pipeline.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "../fixtures");
const scenario = SCENARIOS[0]!;
const input: ScoutInput = {
  concept: scenario.concept,
  cityId: scenario.cityId,
  anchors: scenario.anchors,
  categoryTags: scenario.categoryTags,
};

const demoClient = () =>
  new QlooClient({
    baseUrl: "https://hackathon.api.qloo.com",
    apiKey: undefined,
    demo: true,
    demoSource: new SyntheticFixtures(FIXTURES_DIR),
    fetch: vi.fn<typeof fetch>(),
    logger: { warn: vi.fn() },
  });

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const liveClient = (fetchMock: typeof fetch) =>
  new QlooClient({
    baseUrl: "https://hackathon.api.qloo.com",
    apiKey: "key",
    demo: false,
    fetch: fetchMock,
    limiter: new Limiter({ maxConcurrent: 5, ratePerSecond: 1000 }),
    logger: { warn: vi.fn() },
  });

const heatmapAt = (lat: number, lon: number) => ({
  results: {
    heatmap: [
      {
        location: { latitude: 30.27, longitude: -97.74, geohash: "9v6kpwz" },
        query: { affinity: 0.9 },
      },
    ],
  },
  query: {
    localities: { filter: [{ entity_id: "loc", name: "Somewhere", location: { lat, lon } }] },
  },
});

describe("runScout on synthetic data", () => {
  it("builds cells, competitors with affinity, zones and a trace", async () => {
    const events: ScoutEvent[] = [];
    const result = await runScout(input, demoClient(), (event) => events.push(event));

    expect(result.demo).toBe(true);
    expect(result.cells.length).toBeGreaterThan(1000);
    expect(result.competitors).toHaveLength(30);
    expect(result.competitors.every((place) => place.affinity !== undefined)).toBe(true);
    expect(result.zones).toHaveLength(3);
    expect(result.city.resolvedLocality?.name).toBe("Austin (synthetic)");
    expect(result.audience?.byAnchor.map((entry) => entry.anchorId)).toEqual(
      scenario.anchors.map((anchor) => anchor.id),
    );
    expect(Object.keys(result.audience?.age ?? {})).toHaveLength(6);
    expect(result.trace.map((step) => step.label)).toEqual(
      expect.arrayContaining(["Taste heatmap", "Competitors, page 1", "Competitor taste match"]),
    );
    expect(events[0]).toEqual({
      type: "anchors",
      anchors: scenario.anchors,
      categoryTags: scenario.categoryTags,
    });
    expect(events.filter((event) => event.type === "step")).toHaveLength(result.trace.length);
    expect(events.at(-1)).toEqual({ type: "result", result });
  });

  it("skips competitors when there is no category tag", async () => {
    const result = await runScout({ ...input, categoryTags: [] }, demoClient());

    expect(result.competitors).toEqual([]);
    expect(result.trace.filter((step) => step.label.startsWith("Competitor"))).toEqual([]);
  });

  it("rejects unknown cities and a run with neither anchors nor a concept", async () => {
    await expect(runScout({ ...input, cityId: "atlantis" }, demoClient())).rejects.toBeInstanceOf(
      ScoutInputError,
    );
    await expect(runScout({ ...input, concept: " ", anchors: [] }, demoClient())).rejects.toThrow(
      /anchor/,
    );
  });

  it("finds anchors and the category tag from the concept text without an LLM", async () => {
    const events: ScoutEvent[] = [];
    const result = await runScout(
      {
        concept: "A ramen bar with a vinyl corner and craft beer. Places like Ramen Tatsu-Ya.",
        cityId: "austin",
        anchors: [],
      },
      demoClient(),
      (event) => events.push(event),
    );

    expect(result.anchors.length).toBeGreaterThanOrEqual(3);
    expect(new Set(result.anchors.map((anchor) => anchor.id)).size).toBe(result.anchors.length);
    expect(result.categoryTags).toEqual([RAMEN_RESTAURANT_TAG]);
    expect(result.trace.map((step) => step.label)).toEqual(
      expect.arrayContaining(["Find anchor: Ramen Tatsu-Ya", "Category tag: ramen"]),
    );
    expect(events.find((event) => event.type === "anchors")).toMatchObject({
      categoryTags: [RAMEN_RESTAURANT_TAG],
    });
    expect(result.zones).toHaveLength(3);
  });

  it("asks for the heatmap by locality id when the city has one", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("urn%3Aheatmap")
        ? json(heatmapAt(30.27, -97.74))
        : json({ results: { entities: [], demographics: [] } }),
    );
    const live = liveClient(fetchMock);

    const result = await runScout({ ...input, categoryTags: [] }, live);

    const heatmapCalls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("urn%3Aheatmap"));
    expect(heatmapCalls).toHaveLength(1);
    expect(heatmapCalls[0]).toContain("filter.location=C93C0541-F43D-484E-AC86-E27A54E5B1D0");
    expect(heatmapCalls[0]).not.toContain("filter.location.query");
    expect(result.trace.map((step) => step.label)).toContain("Taste heatmap");
    expect(result.trace.map((step) => step.label)).toContain("Audience portrait");
  });

  it("retries by coordinates when a city without a locality id resolves to the wrong place", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(heatmapAt(40.66, -73.94)))
      .mockResolvedValueOnce(json(heatmapAt(30.27, -97.74)));
    const live = liveClient(fetchMock);
    const { id, name, center, bbox } = findCity("austin")!;
    const austin = { id, name, center, bbox };
    const labels: string[] = [];

    const heatmap = await loadHeatmap(austin, "a,b", async (endpoint, params, label) => {
      labels.push(label);
      return live.get(endpoint, params, label);
    });

    expect(heatmap.cells).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("filter.location.query=Austin");
    const retryUrl = String(fetchMock.mock.calls[1]![0]);
    expect(retryUrl).toContain("filter.location=POINT(-97.7431%2030.2672)");
    expect(retryUrl).toContain("filter.location.radius=25000");
    expect(labels).toEqual(["Taste heatmap", "Taste heatmap by coordinates"]);
  });

  it("writes the city bounding box as a closed WKT polygon", () => {
    expect(bboxPolygon([-1, -2, 3, 4])).toBe("POLYGON((-1 -2, 3 -2, 3 4, -1 4, -1 -2))");
  });
});

describe("POST /api/scout", () => {
  const app = () => createApp(loadConfig({ DEMO_MODE: "true" }), { qloo: demoClient() });
  const post = (body: unknown, query = "") =>
    app().request(`/api/scout${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("returns the whole result as JSON with ?format=json", async () => {
    const response = await post(input, "?format=json");

    expect(response.status).toBe(200);
    const result = (await response.json()) as ScoutResult;
    expect(result.zones).toHaveLength(3);
    expect(result.demo).toBe(true);
  });

  it("streams anchors, steps and the result as server-sent events", async () => {
    const response = await post(input);

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    const names = [...text.matchAll(/^event: (\w+)$/gm)].map((match) => match[1]);
    expect(names[0]).toBe("anchors");
    expect(names.at(-1)).toBe("result");
    expect(names.filter((name) => name === "step").length).toBeGreaterThanOrEqual(3);
  });

  it("rejects an invalid body and an unknown city", async () => {
    expect((await post({ cityId: "austin" }, "?format=json")).status).toBe(400);
    const unknown = await post({ ...input, cityId: "atlantis" }, "?format=json");
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "Unknown city: atlantis" });
  });

  it("reports a Qloo failure without leaking details", async () => {
    const failing = new QlooClient({
      baseUrl: "https://hackathon.api.qloo.com",
      apiKey: "key",
      demo: false,
      fetch: vi.fn<typeof fetch>(async () => new Response("down", { status: 503 })),
      sleep: async () => {},
      logger: { warn: vi.fn() },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await createApp(loadConfig({}), { qloo: failing }).request(
      "/api/scout?format=json",
      {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
      },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Qloo is not answering right now (HTTP 503). Try again in a minute.",
    });
    errors.mockRestore();
  });
});
