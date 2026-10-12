import { booleanDisjoint, feature } from "@turf/turf";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCORING_PARAMS,
  buildZones,
  cellCenter,
  cellSizeMeters,
  clusterRadius,
  distanceMeters,
  encodeCell,
  rescore,
  scoreCells,
  stableHash,
  type HeatCell,
  type LonLat,
  type PlaceRef,
  type ScoringParams,
  type Zone,
} from "@whitespace/shared";

const AUSTIN: LonLat = [-97.7431, 30.2672];
const CHICAGO: LonLat = [-87.6298, 41.8781];

function offset([lon, lat]: LonLat, eastM: number, northM: number): LonLat {
  return [lon + eastM / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + northM / 110_574];
}

function grid(
  center: LonLat,
  radiusM: number,
  precision: number,
  affinity: (point: LonLat) => number,
): HeatCell[] {
  const { width, height } = cellSizeMeters(encodeCell(center, precision));
  const seen = new Set<string>();
  const cells: HeatCell[] = [];
  for (let north = -radiusM; north <= radiusM; north += height / 2) {
    for (let east = -radiusM; east <= radiusM; east += width / 2) {
      const geohash = encodeCell(offset(center, east, north), precision);
      if (seen.has(geohash)) continue;
      seen.add(geohash);
      const point = cellCenter(geohash);
      if (distanceMeters(point, center) > radiusM) continue;
      cells.push({ geohash, affinity: affinity(point) });
    }
  }
  return cells;
}

function asPercentiles(cells: HeatCell[]): HeatCell[] {
  const order = [...cells].sort((a, b) => b.affinity - a.affinity);
  const rank = new Map(order.map((cell, index) => [cell.geohash, index]));
  return cells.map((cell) => ({
    ...cell,
    affinity: 1 - (rank.get(cell.geohash) ?? 0) / cells.length,
  }));
}

function hotspots(spots: { at: LonLat; strength: number; spreadM: number }[]) {
  return (point: LonLat) =>
    spots.reduce((sum, spot) => {
      const d = distanceMeters(point, spot.at);
      return sum + spot.strength * Math.exp(-(d * d) / (2 * spot.spreadM ** 2));
    }, 0);
}

function place(id: string, [lon, lat]: LonLat, affinity?: number): PlaceRef {
  return { id, name: id, lon, lat, tags: [], ...(affinity === undefined ? {} : { affinity }) };
}

const params = (overrides: Partial<ScoringParams> = {}): ScoringParams => ({
  ...DEFAULT_SCORING_PARAMS,
  excludePolygons: [],
  ...overrides,
});

const nearestCell = <T extends HeatCell>(cells: T[], point: LonLat): T =>
  cells.reduce((best, cell) =>
    distanceMeters(cellCenter(cell.geohash), point) <
    distanceMeters(cellCenter(best.geohash), point)
      ? cell
      : best,
  );

const EAST = offset(AUSTIN, 2000, 0);
const WEST = offset(AUSTIN, -2000, 0);
const NORTH = offset(AUSTIN, 0, 2200);
const THREE_SPOTS = hotspots([
  { at: EAST, strength: 1, spreadM: 450 },
  { at: WEST, strength: 0.9, spreadM: 450 },
  { at: NORTH, strength: 0.8, spreadM: 450 },
]);

describe("scoreCells", () => {
  const flat = grid(AUSTIN, 2000, 7, () => 0.9);

  it("lowers opportunity next to a competitor and barely at 2 km", () => {
    const scored = scoreCells(flat, [place("rival", AUSTIN)], params());
    const near = nearestCell(scored, AUSTIN);
    const far = nearestCell(scored, offset(AUSTIN, 1900, 0));

    expect(near.pressure).toBeGreaterThan(0.9);
    expect(near.opportunity).toBeLessThan(0.45);
    expect(far.pressure).toBeLessThan(0.01);
    expect(far.opportunity).toBeGreaterThan(0.89);
  });

  it("ignores a competitor 3 km away", () => {
    const small = grid(AUSTIN, 400, 7, () => 0.9);
    const scored = scoreCells(small, [place("rival", offset(AUSTIN, 3000, 0))], params());

    for (const cell of scored) {
      expect(cell.pressure).toBeLessThan(0.001);
      expect(cell.opportunity).toBeGreaterThan(0.899);
    }
  });

  it("does not stretch a lone distant competitor to full pressure", () => {
    const scored = scoreCells(flat, [place("rival", offset(AUSTIN, 3500, 0))], params());

    expect(Math.max(...scored.map((cell) => cell.pressure))).toBeLessThan(0.05);
  });

  it("weighs a competitor the same audience loves more heavily", () => {
    const loved = scoreCells(flat, [place("rival", AUSTIN, 1)], params());
    const ignored = scoreCells(flat, [place("rival", AUSTIN, 0)], params());

    expect(nearestCell(loved, AUSTIN).opportunity).toBeLessThan(
      nearestCell(ignored, AUSTIN).opportunity - 0.2,
    );
  });

  it("zeroes cells below minAffinity and inside excluded polygons", () => {
    const cells = grid(AUSTIN, 1000, 7, (point) => (point[0] < AUSTIN[0] ? 0.5 : 0.95));
    const [west, south] = offset(AUSTIN, 200, -300);
    const [east, north] = offset(AUSTIN, 600, 300);
    const excluded = {
      type: "Polygon" as const,
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    };

    const scored = scoreCells(cells, [], params({ excludePolygons: [excluded] }));

    for (const cell of scored) {
      const [lon, lat] = cellCenter(cell.geohash);
      const inside = lon >= west && lon <= east && lat >= south && lat <= north;
      if (cell.affinity < 0.7 || inside) expect(cell.opportunity).toBe(0);
      else expect(cell.opportunity).toBeCloseTo(cell.affinity);
    }
  });

  it("handles no competitors and no cells", () => {
    const scored = scoreCells(flat, [], params());
    expect(scored.every((cell) => cell.pressure === 0 && cell.opportunity === 0.9)).toBe(true);
    expect(scoreCells([], [place("rival", AUSTIN)], params())).toEqual([]);
  });

  it("treats a competitor without affinity as full weight", () => {
    const unknown = scoreCells(flat, [place("rival", AUSTIN)], params());
    const loved = scoreCells(flat, [place("rival", AUSTIN, 1)], params());
    expect(nearestCell(unknown, AUSTIN).pressure).toBeCloseTo(nearestCell(loved, AUSTIN).pressure);
  });
});

describe("buildZones", () => {
  const cells = asPercentiles(grid(AUSTIN, 3200, 7, THREE_SPOTS));

  const zonesFor = (competitors: PlaceRef[] = [], overrides: Partial<ScoringParams> = {}) =>
    rescore(cells, competitors, params(overrides), { cityName: "Austin" }).zones;

  const zoneNear = (zones: Zone[], point: LonLat): Zone | undefined =>
    zones.find((zone) => distanceMeters(zone.centroid, point) < 700);

  it("finds three ranked, disjoint zones on the three hotspots", () => {
    const zones = zonesFor();

    expect(zones).toHaveLength(3);
    expect(zones.map((zone) => zone.rank)).toEqual([1, 2, 3]);
    expect(zones[0]!.score).toBeGreaterThanOrEqual(zones[1]!.score);
    expect(zones[1]!.score).toBeGreaterThanOrEqual(zones[2]!.score);
    for (const spot of [EAST, WEST, NORTH]) expect(zoneNear(zones, spot)).toBeDefined();
    for (let a = 0; a < zones.length; a += 1) {
      for (let b = a + 1; b < zones.length; b += 1) {
        expect(booleanDisjoint(feature(zones[a]!.polygon), feature(zones[b]!.polygon))).toBe(true);
      }
    }
  });

  it("moves the best zone away from a hotspot crowded with competitors", () => {
    const crowd = [0, 120, 240, 360].map((bearing, index) =>
      place(`rival-${index}`, offset(EAST, 150 * Math.cos(bearing), 150 * Math.sin(bearing)), 1),
    );

    const zones = zonesFor(crowd);

    expect(zoneNear(zonesFor(), EAST)?.rank).toBe(1);
    expect(zoneNear(zones, EAST)?.rank ?? 99).toBeGreaterThan(1);
    expect(zones[0]!.competitorsNearby).toBe(0);
  });

  it("counts competitors inside and within 1 km of a zone", () => {
    const eastZone = zoneNear(zonesFor(), EAST)!;
    const competitors = [
      place("inside", eastZone.centroid),
      place("close", offset(eastZone.centroid, 0, 900)),
      place("far", offset(eastZone.centroid, 0, 6000)),
    ];

    const zone = zoneNear(zonesFor(competitors, { competitionWeight: 0 }), EAST)!;

    expect(zone.competitorsInside).toBe(1);
    expect(zone.competitorsNearby).toBe(2);
  });

  it("keeps zone ids stable for the same cells", () => {
    const first = zonesFor().map((zone) => zone.id);
    const second = zonesFor().map((zone) => zone.id);

    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(3);
    expect(stableHash("a,b")).not.toBe(stableHash("a,c"));
  });

  it("explains each zone with facts computed from the data", () => {
    const [best] = zonesFor([place("rival", offset(WEST, 0, 300))]);

    expect(best!.reasons[0]).toMatch(/^Taste match in the top \d+% of Austin$/);
    expect(best!.reasons[1]).toMatch(/similar venues? within 1 km of the zone center/);
    expect(best!.meanAffinity).toBeGreaterThan(0.9);
    expect(best!.cellCount).toBeGreaterThanOrEqual(4);
  });

  it("returns fewer zones when there are fewer audience clusters", () => {
    const single = asPercentiles(
      grid(AUSTIN, 2500, 7, hotspots([{ at: EAST, strength: 1, spreadM: 500 }])),
    );

    const zones = rescore(single, [], params({ minAffinity: 0.9 }), { cityName: "Austin" }).zones;

    expect(zones.length).toBeGreaterThanOrEqual(1);
    expect(zones.length).toBeLessThan(3);
    expect(buildZones([], [], { cityName: "Austin" })).toEqual([]);
  });

  it("clusters a geohash-6 grid, where cell centers are farther apart than 400 m", () => {
    const coarse = asPercentiles(
      grid(
        CHICAGO,
        14000,
        6,
        hotspots([
          { at: offset(CHICAGO, -6000, 4000), strength: 1, spreadM: 2500 },
          { at: offset(CHICAGO, 5000, -5000), strength: 0.9, spreadM: 2500 },
        ]),
      ),
    );

    expect(clusterRadius(coarse[0]!.geohash)).toBeGreaterThan(1000);
    const zones = rescore(coarse, [], params(), { cityName: "Chicago" }).zones;
    expect(zones.length).toBeGreaterThanOrEqual(2);
  });
});
