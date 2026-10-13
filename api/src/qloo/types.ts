import { z } from "zod";
import {
  distanceMeters,
  isValidLonLat,
  type HeatCell,
  type LonLat,
  type PlaceRef,
  type ResolvedLocality,
} from "@whitespace/shared";

const localitySchema = z.object({
  entity_id: z.string(),
  name: z.string(),
  location: z
    .object({ lat: z.number(), lon: z.number().optional(), lng: z.number().optional() })
    .nullish(),
});

const heatmapSchema = z.object({
  results: z.object({
    heatmap: z.array(
      z.object({
        location: z.object({
          latitude: z.number(),
          longitude: z.number(),
          geohash: z.string().min(1),
        }),
        query: z.object({
          affinity: z.number(),
          affinity_rank: z.number().optional(),
          popularity: z.number().optional(),
        }),
      }),
    ),
  }),
  query: z
    .object({
      localities: z
        .object({ filter: z.union([localitySchema, z.array(localitySchema)]).optional() })
        .optional(),
    })
    .optional(),
});

export interface ParsedHeatmap {
  cells: HeatCell[];
  locality?: ResolvedLocality;
}

export function parseHeatmap(data: unknown, expectedCenter: LonLat): ParsedHeatmap {
  const parsed = heatmapSchema.parse(data);
  const cells = parsed.results.heatmap.map(({ location, query }) => {
    const cell: HeatCell = { geohash: location.geohash, affinity: clamp01(query.affinity) };
    if (query.popularity !== undefined) cell.popularity = clamp01(query.popularity);
    return cell;
  });

  const resolved = parsed.query?.localities?.filter;
  const filter = Array.isArray(resolved) ? resolved[0] : resolved;
  if (!filter) return { cells };

  const locality: ResolvedLocality = { id: filter.entity_id, name: filter.name };
  const longitude = filter.location?.lon ?? filter.location?.lng;
  const center =
    filter.location && longitude !== undefined
      ? localityCenter({ lat: filter.location.lat, lng: longitude }, expectedCenter)
      : undefined;
  if (center) locality.center = center;
  return { cells, locality };
}

export function localityCenter(
  location: { lat: number; lng: number },
  expected: LonLat,
): LonLat | undefined {
  const fieldOrder: LonLat = [location.lng, location.lat];
  const swappedOrder: LonLat = [location.lat, location.lng];
  const candidates = [fieldOrder, swappedOrder].filter(isValidLonLat);
  let best: LonLat | undefined;
  for (const candidate of candidates) {
    if (!best || distanceMeters(candidate, expected) < distanceMeters(best, expected)) {
      best = candidate;
    }
  }
  return best;
}

const KEPT_TAG_TYPES = new Set([
  "urn:tag:genre:place",
  "urn:tag:category:place",
  "urn:tag:cuisine:qloo",
  "urn:tag:culinary_style:qloo",
  "urn:tag:ambience:qloo",
  "urn:tag:ambience:place",
  "urn:tag:setting:qloo",
  "urn:tag:customer_identity:qloo",
  "urn:tag:interests:qloo",
  "urn:tag:beverage_offering:qloo",
  "urn:tag:time_of_day_fit:qloo",
  "urn:tag:neighborhood_characteristic:qloo",
]);

const placeSchema = z.object({
  entity_id: z.string().min(1),
  name: z.string(),
  location: z.object({ lat: z.number(), lon: z.number() }).nullish(),
  properties: z
    .object({
      neighborhood: z.string().nullish(),
      price_level: z.number().nullish(),
      geocode: z.object({ name: z.string().nullish(), city: z.string().nullish() }).nullish(),
    })
    .nullish(),
  tags: z
    .array(
      z.object({
        id: z.string().nullish(),
        tag_id: z.string().nullish(),
        type: z.string().nullish(),
      }),
    )
    .nullish(),
  query: z
    .object({
      affinity: z.number().nullish(),
      explainability: z.unknown().optional(),
    })
    .nullish(),
});

const placesResponseSchema = z.object({
  results: z.object({ entities: z.array(z.unknown()) }),
});

const driverSchema = z.object({ entity_id: z.string(), score: z.number() });

export interface ParsedPlaces {
  places: PlaceRef[];
  skipped: number;
}

export function parsePlaces(data: unknown): ParsedPlaces {
  const { results } = placesResponseSchema.parse(data);
  const places: PlaceRef[] = [];
  let skipped = 0;
  for (const raw of results.entities) {
    const parsed = placeSchema.safeParse(raw);
    const location = parsed.success ? parsed.data.location : undefined;
    if (!parsed.success || !location || !isValidLonLat([location.lon, location.lat])) {
      skipped += 1;
      continue;
    }
    const entity = parsed.data;
    const place: PlaceRef = {
      id: entity.entity_id,
      name: entity.name,
      lat: location.lat,
      lon: location.lon,
      tags: (entity.tags ?? []).flatMap((tag) =>
        !tag.type || KEPT_TAG_TYPES.has(tag.type) ? (tag.id ?? tag.tag_id ?? []) : [],
      ),
    };
    const neighborhood = neighborhoodOf(entity.properties);
    if (neighborhood) place.neighborhood = neighborhood;
    const priceLevel = entity.properties?.price_level;
    if (typeof priceLevel === "number") place.priceLevel = priceLevel;
    const affinity = entity.query?.affinity;
    if (typeof affinity === "number") place.affinity = clamp01(affinity);
    const drivers = parseDrivers(entity.query?.explainability);
    if (drivers.length > 0) place.drivers = drivers;
    places.push(place);
  }
  return { places, skipped };
}

function neighborhoodOf(properties: z.infer<typeof placeSchema>["properties"]): string | undefined {
  if (properties?.neighborhood) return properties.neighborhood;
  const area = properties?.geocode?.name;
  return area && area !== properties?.geocode?.city ? area : undefined;
}

function parseDrivers(value: unknown): { anchorId: string; score: number }[] {
  if (typeof value !== "object" || value === null) return [];
  const lists = Array.isArray(value) ? [value] : Object.values(value).filter(Array.isArray);
  return lists
    .flat()
    .flatMap((item) => {
      const driver = driverSchema.safeParse(item);
      return driver.success
        ? [{ anchorId: driver.data.entity_id, score: clamp01(driver.data.score) }]
        : [];
    })
    .sort((a, b) => b.score - a.score);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
