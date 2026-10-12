import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ngeohash from "ngeohash";
import {
  SYNTHETIC_ANCHORS,
  SYNTHETIC_RAMEN_TAG,
  distanceMeters,
  findCity,
  type LonLat,
} from "@whitespace/shared";

const SEED = 20261012;
const GENERATED_AT = "2026-10-12T00:00:00.000Z";
const PRECISION = 7;
const RADIUS_M = 3200;
const HOLE_SHARE = 0.08;
const OUTPUT_DIR = resolve(import.meta.dirname, "../api/fixtures");
const SYNTHETIC_LOCALITY_ID = "00000000-0000-4000-8000-000000000001";

interface Hotspot {
  eastM: number;
  northM: number;
  strength: number;
  spreadM: number;
}

const TASTE_HOTSPOTS: Hotspot[] = [
  { eastM: 2100, northM: 300, strength: 1, spreadM: 650 },
  { eastM: -200, northM: -2200, strength: 0.85, spreadM: 550 },
  { eastM: 600, northM: 2500, strength: 0.75, spreadM: 600 },
  { eastM: 0, northM: 0, strength: 0.6, spreadM: 450 },
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function offset([lon, lat]: LonLat, eastM: number, northM: number): LonLat {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((lat * Math.PI) / 180);
  return [lon + eastM / metersPerDegreeLon, lat + northM / metersPerDegreeLat];
}

function percentiles(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
  const result = new Array<number>(values.length).fill(0);
  order.forEach(({ index }, rank) => {
    result[index] = 1 - rank / values.length;
  });
  return result;
}

const round = (value: number, digits = 6): number => Number(value.toFixed(digits));

function buildHeatmap(center: LonLat) {
  const random = mulberry32(SEED);
  const [minLat, minLon, maxLat, maxLon] = ngeohash.decode_bbox(
    ngeohash.encode(center[1], center[0], PRECISION),
  );
  const stepLat = maxLat - minLat;
  const stepLon = maxLon - minLon;
  const [westLon, southLat] = offset(center, -RADIUS_M, -RADIUS_M);
  const [eastLon, northLat] = offset(center, RADIUS_M, RADIUS_M);

  const hotspots = TASTE_HOTSPOTS.map((spot) => ({
    ...spot,
    point: offset(center, spot.eastM, spot.northM),
  }));

  const seen = new Set<string>();
  const cells: { geohash: string; point: LonLat; taste: number; reach: number }[] = [];
  for (let lat = southLat; lat <= northLat; lat += stepLat) {
    for (let lon = westLon; lon <= eastLon; lon += stepLon) {
      const geohash = ngeohash.encode(lat, lon, PRECISION);
      if (seen.has(geohash)) continue;
      seen.add(geohash);
      const decoded = ngeohash.decode(geohash);
      const point: LonLat = [decoded.longitude, decoded.latitude];
      const fromCenter = distanceMeters(point, center);
      if (fromCenter > RADIUS_M || random() < HOLE_SHARE) continue;
      const taste = hotspots.reduce((sum, spot) => {
        const d = distanceMeters(point, spot.point);
        return sum + spot.strength * Math.exp(-(d * d) / (2 * spot.spreadM * spot.spreadM));
      }, 0.15 * random());
      const reach = Math.exp(-(fromCenter * fromCenter) / (2 * 1800 * 1800)) + 0.25 * random();
      cells.push({ geohash, point, taste, reach });
    }
  }

  const affinity = percentiles(cells.map((cell) => cell.taste));
  const popularity = percentiles(cells.map((cell) => cell.reach));
  const order = affinity
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value);

  return {
    success: true,
    results: {
      heatmap: order.map(({ index }, rank) => {
        const cell = cells[index]!;
        return {
          location: {
            latitude: round(cell.point[1]),
            longitude: round(cell.point[0]),
            geohash: cell.geohash,
          },
          query: {
            affinity: round(affinity[index]!),
            affinity_rank: round(1 - (rank + 1) / (cells.length + 1)),
            popularity: round(popularity[index]!),
          },
        };
      }),
    },
    query: {
      localities: {
        filter: {
          entity_id: SYNTHETIC_LOCALITY_ID,
          name: "Austin (synthetic)",
          subtype: "urn:entity:locality",
          location: { lat: center[0], lng: center[1] },
          popularity: 1,
          disambiguation: "Synthetic locality for tests and demo mode",
        },
      },
    },
    duration: 0,
  };
}

interface PlaceGroup {
  name: string;
  eastM: number;
  northM: number;
  count: number;
  spreadM: number;
}

const PLACE_GROUPS: PlaceGroup[] = [
  { name: "Downtown", eastM: 0, northM: 0, count: 9, spreadM: 350 },
  { name: "Eastside", eastM: 2600, northM: 700, count: 3, spreadM: 250 },
  { name: "Southside", eastM: -900, northM: -2500, count: 2, spreadM: 300 },
  { name: "Northside", eastM: 300, northM: 2900, count: 1, spreadM: 200 },
  { name: "Westside", eastM: -2200, northM: 400, count: 6, spreadM: 700 },
  { name: "Riverside", eastM: 900, northM: -1000, count: 5, spreadM: 600 },
  { name: "Airport Blvd", eastM: 1800, northM: 2000, count: 4, spreadM: 500 },
];

function buildPlaces(center: LonLat) {
  const random = mulberry32(SEED + 1);
  const gaussian = (): number => {
    const u = Math.max(random(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  let serial = 0;
  const entities = PLACE_GROUPS.flatMap((group) =>
    Array.from({ length: group.count }, () => {
      serial += 1;
      const [lon, lat] = offset(
        center,
        group.eastM + gaussian() * group.spreadM,
        group.northM + gaussian() * group.spreadM,
      );
      const affinity = 0.3 + 0.65 * random();
      const label = String(serial).padStart(2, "0");
      return {
        name: `Noodle Bar ${label} (synthetic)`,
        entity_id: `00000000-0000-4000-9000-0000000000${label}`,
        type: "urn:entity",
        subtype: "urn:entity:place",
        location: { lat: round(lat), lon: round(lon), geohash: ngeohash.encode(lat, lon, 12) },
        properties: {
          neighborhood: group.name,
          price_level: 1 + Math.floor(random() * 3),
        },
        tags: [{ id: SYNTHETIC_RAMEN_TAG.id, name: SYNTHETIC_RAMEN_TAG.name }],
        query: {
          affinity: round(affinity),
          explainability: {
            "signal.interests.entities": SYNTHETIC_ANCHORS.map((anchor) => ({
              entity_id: anchor.id,
              score: round(random() * affinity),
            })),
          },
        },
      };
    }),
  );
  return { success: true, results: { entities }, duration: 0 };
}

async function writeFixture(name: string, description: string, response: unknown): Promise<void> {
  const file = { synthetic: true, generatedAt: GENERATED_AT, description, response };
  await writeFile(resolve(OUTPUT_DIR, `${name}.json`), `${JSON.stringify(file)}\n`);
}

async function main(): Promise<void> {
  const city = findCity("austin");
  if (!city) throw new Error("Austin is missing from shared/src/cities.ts");
  await mkdir(OUTPUT_DIR, { recursive: true });

  const heatmap = buildHeatmap(city.center);
  await writeFixture(
    "heatmap",
    "Generated by scripts/make-fixtures.ts. Not Qloo data: an Austin-shaped grid with planted taste hotspots, in the documented heatmap response format.",
    heatmap,
  );
  console.log(`heatmap.json: ${heatmap.results.heatmap.length} synthetic cells`);

  const places = buildPlaces(city.center);
  await writeFixture(
    "places",
    "Generated by scripts/make-fixtures.ts. Not Qloo data: fictional ramen bars around Austin. Qloo does not document the place response, so the field paths are a provisional guess until S0 checks them against the live API.",
    places,
  );
  console.log(`places.json: ${places.results.entities.length} synthetic places`);
}

await main();
