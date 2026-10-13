import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAMEN_RESTAURANT_TAG, SCENARIOS } from "@whitespace/shared";
import { parsePlaces } from "../src/qloo/types.js";

async function syntheticPlaces(): Promise<unknown> {
  const file = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../fixtures/places.json"), "utf8"),
  ) as { synthetic: boolean; response: unknown };
  expect(file.synthetic).toBe(true);
  return file.response;
}

describe("parsePlaces", () => {
  it("reads the synthetic places", async () => {
    const { places, skipped } = parsePlaces(await syntheticPlaces());

    expect(skipped).toBe(0);
    expect(places.filter((place) => place.tags.includes(RAMEN_RESTAURANT_TAG.id))).toHaveLength(30);
    expect(places.filter((place) => !place.tags.includes(RAMEN_RESTAURANT_TAG.id))).toHaveLength(
      20,
    );
    const first = places[0]!;
    expect(first.tags).toEqual([RAMEN_RESTAURANT_TAG.id]);
    expect(first.neighborhood).toBe("Downtown");
    expect(first.affinity).toBeGreaterThan(0);
    expect(first.drivers?.map((driver) => driver.anchorId).sort()).toEqual(
      SCENARIOS[0]!.anchors.map((anchor) => anchor.id).sort(),
    );
    expect(first.drivers![0]!.score).toBeGreaterThanOrEqual(first.drivers![1]!.score);
  });

  it("skips entities it cannot place on a map instead of failing", () => {
    const { places, skipped } = parsePlaces({
      results: {
        entities: [
          { entity_id: "a", name: "No location" },
          { entity_id: "b", name: "Bad location", location: { lat: 200, lon: 0 } },
          { name: "No id", location: { lat: 30, lon: -97 } },
          {
            entity_id: "c",
            name: "Fine",
            location: { lat: 30.27, lon: -97.74 },
            tags: [{ tag_id: "t" }],
          },
        ],
      },
    });

    expect(skipped).toBe(3);
    expect(places).toEqual([{ id: "c", name: "Fine", lat: 30.27, lon: -97.74, tags: ["t"] }]);
  });

  it("rejects a response without an entity list", () => {
    expect(() => parsePlaces({ results: { heatmap: [] } })).toThrow();
  });
});
