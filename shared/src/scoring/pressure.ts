import type { PlaceRef } from "../types.js";

export const PRESSURE_SIGMA_M = 600;
export const PRESSURE_FLOOR = 1;

export interface ProjectedCompetitor {
  x: number;
  y: number;
  weight: number;
}

export function competitorWeight(place: PlaceRef): number {
  return place.affinity === undefined ? 1 : 0.5 + 0.5 * Math.min(1, Math.max(0, place.affinity));
}

export function rawPressure(
  x: number,
  y: number,
  competitors: readonly ProjectedCompetitor[],
  sigma = PRESSURE_SIGMA_M,
): number {
  const cutoff = 3 * sigma;
  const twoSigmaSquared = 2 * sigma * sigma;
  let total = 0;
  for (const competitor of competitors) {
    const dx = competitor.x - x;
    const dy = competitor.y - y;
    if (Math.abs(dx) > cutoff || Math.abs(dy) > cutoff) continue;
    total += competitor.weight * Math.exp(-(dx * dx + dy * dy) / twoSigmaSquared);
  }
  return total;
}

export function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function normalizePressure(raw: readonly number[]): number[] {
  const scale = Math.max(percentile(raw, 0.95), PRESSURE_FLOOR);
  return raw.map((value) => Math.min(1, value / scale));
}
