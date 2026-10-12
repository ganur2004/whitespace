import { z } from "zod";
import {
  distanceMeters,
  isValidLonLat,
  type HeatCell,
  type LonLat,
  type ResolvedLocality,
} from "@whitespace/shared";

const localitySchema = z.object({
  entity_id: z.string(),
  name: z.string(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
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
      localities: z.object({ filter: localitySchema.optional() }).optional(),
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

  const filter = parsed.query?.localities?.filter;
  if (!filter) return { cells };

  const locality: ResolvedLocality = { id: filter.entity_id, name: filter.name };
  const center = filter.location && localityCenter(filter.location, expectedCenter);
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
