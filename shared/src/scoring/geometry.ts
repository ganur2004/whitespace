import { cellCenter, localProjector, type Projector } from "../geohash.js";
import type { LonLat, PlaceRef } from "../types.js";
import { competitorWeight, type ProjectedCompetitor } from "./pressure.js";

export interface CellPoint {
  center: LonLat;
  x: number;
  y: number;
}

export interface CompetitorPoint extends ProjectedCompetitor {
  place: PlaceRef;
}

export function cityProjector(cells: readonly { geohash: string }[]): Projector {
  const latitudes = cells.map((cell) => cellCenter(cell.geohash)[1]);
  const origin = latitudes.reduce((sum, lat) => sum + lat, 0) / Math.max(1, latitudes.length);
  return localProjector(origin);
}

export function cellPoints(cells: readonly { geohash: string }[], project: Projector): CellPoint[] {
  return cells.map((cell) => {
    const center = cellCenter(cell.geohash);
    const [x, y] = project(center);
    return { center, x, y };
  });
}

export function competitorPoints(
  competitors: readonly PlaceRef[],
  project: Projector,
): CompetitorPoint[] {
  return competitors.map((place) => {
    const [x, y] = project([place.lon, place.lat]);
    return { place, x, y, weight: competitorWeight(place) };
  });
}

export function countWithin(
  x: number,
  y: number,
  competitors: readonly ProjectedCompetitor[],
  radius: number,
): number {
  let count = 0;
  for (const competitor of competitors) {
    const dx = competitor.x - x;
    const dy = competitor.y - y;
    if (dx * dx + dy * dy <= radius * radius) count += 1;
  }
  return count;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function stableHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
