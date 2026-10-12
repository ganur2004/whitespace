import type { HeatCell, PlaceRef, ScoredCell, ScoringParams, Zone } from "../types.js";
import { scoreCells } from "./opportunity.js";
import { buildZones, type ZoneOptions } from "./zones.js";

export const DEFAULT_SCORING_PARAMS: Readonly<ScoringParams> = Object.freeze({
  competitionWeight: 0.6,
  minAffinity: 0.7,
  excludePolygons: [],
});

export function rescore(
  cells: readonly HeatCell[],
  competitors: readonly PlaceRef[],
  params: ScoringParams,
  options: ZoneOptions,
): { cells: ScoredCell[]; zones: Zone[] } {
  const scored = scoreCells(cells, competitors, params);
  return { cells: scored, zones: buildZones(scored, competitors, options) };
}

export { scoreCells } from "./opportunity.js";
export { buildZones, clusterRadius, NEARBY_RADIUS_M, type ZoneOptions } from "./zones.js";
export {
  competitorWeight,
  normalizePressure,
  percentile,
  rawPressure,
  PRESSURE_FLOOR,
  PRESSURE_SIGMA_M,
} from "./pressure.js";
export { stableHash } from "./geometry.js";
