import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ngeohash from "ngeohash";
import {
  RAMEN_RESTAURANT_TAG,
  SCENARIOS,
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
        filter: [
          {
            entity_id: SYNTHETIC_LOCALITY_ID,
            name: "Austin (synthetic)",
            subtype: "urn:entity:locality",
            location: { lat: center[1], lon: center[0] },
            popularity: 1,
            disambiguation: "Synthetic locality for tests and demo mode",
          },
        ],
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
  const anchors = SCENARIOS[0]?.anchors ?? [];
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
          neighborhood: serial % 3 === 0 ? null : group.name,
          price_level: 1 + Math.floor(random() * 3),
          geocode: { name: serial % 3 === 0 ? group.name : null, city: "Austin" },
        },
        tags: [
          {
            id: RAMEN_RESTAURANT_TAG.id,
            name: RAMEN_RESTAURANT_TAG.name,
            type: "urn:tag:genre:place",
          },
          {
            id: "urn:tag:offerings:place:hot_tea",
            name: "Hot tea",
            type: "urn:tag:offerings:place",
          },
        ],
        query: {
          affinity: round(affinity),
          explainability: {
            "signal.interests.entities": anchors.map((anchor) => ({
              entity_id: anchor.id,
              score: round(random() * affinity),
            })),
          },
        },
      };
    }),
  );
  return {
    success: true,
    results: { entities: [...entities, ...buildVenues(center)] },
    duration: 0,
  };
}

const VENUE_KINDS: [string, string, string][] = [
  ["Vinyl Cellar", "urn:tag:genre:place:bar", "Bar"],
  ["Hop Garden Taproom", "urn:tag:genre:place:brewery", "Brewery"],
  ["Night Owl Coffee", "urn:tag:genre:place:coffee_shop", "Coffee shop"],
  ["Groove Records", "urn:tag:genre:place:record_store", "Record store"],
  ["Lantern Cocktail Club", "urn:tag:genre:place:cocktail_bar", "Cocktail bar"],
];

const VENUE_AREAS: { name: string; eastM: number; northM: number; spreadM: number }[] = [
  { name: "East End", eastM: 2100, northM: 300, spreadM: 350 },
  { name: "South Bank", eastM: -200, northM: -2200, spreadM: 300 },
  { name: "North Loop", eastM: 600, northM: 2500, spreadM: 350 },
  { name: "Downtown", eastM: 0, northM: 0, spreadM: 250 },
];

function buildVenues(center: LonLat) {
  const random = mulberry32(SEED + 2);
  const anchors = SCENARIOS[0]?.anchors ?? [];
  let serial = 0;
  return VENUE_AREAS.flatMap((area) =>
    VENUE_KINDS.map(([kind, tagId, tagName]) => {
      serial += 1;
      const [lon, lat] = offset(
        center,
        area.eastM + (random() - 0.5) * 2 * area.spreadM,
        area.northM + (random() - 0.5) * 2 * area.spreadM,
      );
      const affinity = 0.85 + 0.13 * random();
      const label = String(serial).padStart(2, "0");
      return {
        name: `${kind} ${area.name} (synthetic)`,
        entity_id: `00000000-0000-4000-b000-0000000000${label}`,
        type: "urn:entity",
        subtype: "urn:entity:place",
        location: { lat: round(lat), lon: round(lon), geohash: ngeohash.encode(lat, lon, 12) },
        properties: {
          neighborhood: area.name,
          price_level: 1 + Math.floor(random() * 3),
          geocode: { name: area.name, city: "Austin" },
        },
        tags: [{ id: tagId, name: tagName, type: "urn:tag:genre:place" }],
        query: {
          affinity: round(affinity),
          explainability: {
            "signal.interests.entities": anchors.map((anchor) => ({
              entity_id: anchor.id,
              score: round(random() * affinity),
            })),
          },
        },
      };
    }),
  );
}

const AGE_KEYS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"];

function buildDemographics() {
  const random = mulberry32(SEED + 3);
  const anchors = SCENARIOS[0]?.anchors ?? [];
  return {
    success: true,
    results: {
      demographics: anchors.map((anchor) => {
        const male = round((random() - 0.5) * 0.8, 3);
        return {
          entity_id: anchor.id,
          query: {
            age: Object.fromEntries(AGE_KEYS.map((key) => [key, round((random() - 0.5) * 1.2, 3)])),
            gender: { male, female: -male },
          },
        };
      }),
    },
  };
}

function buildSearch(center: LonLat) {
  const anchors = SCENARIOS[0]?.anchors ?? [];
  return {
    results: anchors.map((anchor, index) => {
      const [lon, lat] = offset(center, 3000 + 400 * index, 4000 - 300 * index);
      return {
        name: `${anchor.name} (synthetic)`,
        entity_id: anchor.id,
        types: [anchor.type],
        location: anchor.type === "urn:entity:place" ? { lat: round(lat), lon: round(lon) } : null,
        tags: [],
      };
    }),
  };
}

function buildTags() {
  return {
    success: true,
    results: {
      tags: [
        {
          id: RAMEN_RESTAURANT_TAG.id,
          name: RAMEN_RESTAURANT_TAG.name,
          type: "urn:tag:genre:place",
        },
        {
          id: "urn:tag:category:place:ramen_restaurant",
          name: "Ramen restaurant",
          type: "urn:tag:category:place",
        },
      ],
    },
  };
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
    "Generated by scripts/make-fixtures.ts. Not Qloo data: fictional ramen bars and other venues around Austin. Follows the place response format confirmed against the live API on S0.",
    places,
  );
  console.log(`places.json: ${places.results.entities.length} synthetic places`);

  const demographics = buildDemographics();
  await writeFixture(
    "demographics",
    "Generated by scripts/make-fixtures.ts. Not Qloo data: random age and gender skews per anchor, in the urn:demographics response format.",
    demographics,
  );
  console.log(`demographics.json: ${demographics.results.demographics.length} synthetic anchors`);

  const search = buildSearch(city.center);
  await writeFixture(
    "search",
    "Generated by scripts/make-fixtures.ts. Not Qloo data: every search answers with the Austin scenario anchors, marked synthetic, in the /search response format.",
    search,
  );
  console.log(`search.json: ${search.results.length} synthetic entities`);

  const tags = buildTags();
  await writeFixture(
    "tags",
    "Generated by scripts/make-fixtures.ts. Not Qloo data: the ramen genre tags used by the demo, in the /v2/tags response format.",
    tags,
  );
  console.log(`tags.json: ${tags.results.tags.length} synthetic tags`);
}

await main();
