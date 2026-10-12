import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { booleanDisjoint, feature } from "@turf/turf";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCORING_PARAMS,
  distanceMeters,
  findCity,
  rescore,
  type LonLat,
  type PlaceRef,
} from "@whitespace/shared";
import { parseHeatmap } from "../src/qloo/types.js";

const austin = findCity("austin")!;

function offset([lon, lat]: LonLat, eastM: number, northM: number): LonLat {
  return [lon + eastM / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + northM / 110_574];
}

const DOWNTOWN = austin.center;

const rivalsAround = (center: LonLat, count: number): PlaceRef[] =>
  Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count;
    const [lon, lat] = offset(center, 180 * Math.cos(angle), 180 * Math.sin(angle));
    return { id: `rival-${index}`, name: `Rival ${index}`, lon, lat, tags: [], affinity: 0.8 };
  });

async function syntheticCells() {
  const file = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../fixtures/heatmap.json"), "utf8"),
  ) as { response: unknown };
  return parseHeatmap(file.response, austin.center).cells;
}

describe("zones on the synthetic Austin heatmap", () => {
  it("finds exactly three disjoint zones away from a crowded downtown", async () => {
    const cells = await syntheticCells();
    const { zones } = rescore(
      cells,
      rivalsAround(DOWNTOWN, 6),
      { ...DEFAULT_SCORING_PARAMS, excludePolygons: [] },
      { cityName: austin.name },
    );

    expect(zones).toHaveLength(3);
    for (const zone of zones) {
      expect(distanceMeters(zone.centroid, DOWNTOWN)).toBeGreaterThan(1000);
      expect(zone.score).toBeGreaterThan(0);
      expect(zone.score).toBeLessThanOrEqual(1);
    }
    for (let a = 0; a < zones.length; a += 1) {
      for (let b = a + 1; b < zones.length; b += 1) {
        expect(booleanDisjoint(feature(zones[a]!.polygon), feature(zones[b]!.polygon))).toBe(true);
      }
    }
  });

  it("drops an excluded zone and promotes the next one", async () => {
    const cells = await syntheticCells();
    const params = { ...DEFAULT_SCORING_PARAMS, excludePolygons: [] };
    const before = rescore(cells, [], params, { cityName: austin.name }).zones;
    const best = before[0]!;

    const after = rescore(
      cells,
      [],
      { ...params, excludePolygons: [best.polygon] },
      { cityName: austin.name },
    ).zones;

    expect(after.some((zone) => distanceMeters(zone.centroid, best.centroid) < 500)).toBe(false);
    expect(distanceMeters(after[0]!.centroid, before[1]!.centroid)).toBeLessThan(500);
  });
});
