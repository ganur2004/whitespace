import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { distanceMeters, findCity } from "@whitespace/shared";
import { localityCenter, parseHeatmap } from "../src/qloo/types.js";

const austin = findCity("austin")!;

async function syntheticHeatmap(): Promise<unknown> {
  const file = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../fixtures/heatmap.json"), "utf8"),
  ) as { synthetic: boolean; response: unknown };
  expect(file.synthetic).toBe(true);
  return file.response;
}

describe("parseHeatmap", () => {
  it("turns the synthetic Austin heatmap into cells", async () => {
    const { cells, locality } = parseHeatmap(await syntheticHeatmap(), austin.center);

    expect(cells.length).toBeGreaterThan(1000);
    expect(new Set(cells.map((cell) => cell.geohash)).size).toBe(cells.length);
    for (const cell of cells) {
      expect(cell.geohash).toHaveLength(7);
      expect(cell.affinity).toBeGreaterThanOrEqual(0);
      expect(cell.affinity).toBeLessThanOrEqual(1);
      expect(cell.popularity).toBeDefined();
    }
    expect(Math.max(...cells.map((cell) => cell.affinity))).toBe(1);
    expect(locality?.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(distanceMeters(locality!.center!, austin.center)).toBeLessThan(1);
  });

  it("rejects a response that is not a heatmap", () => {
    expect(() => parseHeatmap({ results: { entities: [] } }, austin.center)).toThrow();
  });

  it("keeps cells without popularity and responses without a locality", () => {
    const { cells, locality } = parseHeatmap(
      {
        results: {
          heatmap: [
            {
              location: { latitude: 30.27, longitude: -97.74, geohash: "9v6kpw" },
              query: { affinity: 1.2 },
            },
          ],
        },
      },
      austin.center,
    );
    expect(cells).toEqual([{ geohash: "9v6kpw", affinity: 1 }]);
    expect(locality).toBeUndefined();
  });
});

describe("localityCenter", () => {
  it("repairs the swapped lat/lng from the documentation example", () => {
    const center = localityCenter(
      { lat: -73.93889084762313, lng: 40.66320611815103 },
      [-73.9442, 40.6782],
    );
    expect(center).toEqual([-73.93889084762313, 40.66320611815103]);
  });

  it("keeps a correctly ordered location", () => {
    expect(localityCenter({ lat: 30.2672, lng: -97.7431 }, austin.center)).toEqual([
      -97.7431, 30.2672,
    ]);
  });

  it("returns nothing for impossible coordinates", () => {
    expect(localityCenter({ lat: 500, lng: 500 }, austin.center)).toBeUndefined();
  });
});
