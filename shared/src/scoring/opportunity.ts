import { booleanPointInPolygon } from "@turf/turf";
import type { HeatCell, PlaceRef, ScoredCell, ScoringParams } from "../types.js";
import { cellPoints, cityProjector, competitorPoints } from "./geometry.js";
import { normalizePressure, rawPressure } from "./pressure.js";

export function scoreCells(
  cells: readonly HeatCell[],
  competitors: readonly PlaceRef[],
  params: ScoringParams,
): ScoredCell[] {
  if (cells.length === 0) return [];
  const project = cityProjector(cells);
  const points = cellPoints(cells, project);
  const rivals = competitorPoints(competitors, project);
  const pressure = normalizePressure(points.map(({ x, y }) => rawPressure(x, y, rivals)));
  const weight = Math.min(1, Math.max(0, params.competitionWeight));

  return cells.map((cell, index) => {
    const point = points[index];
    const cellPressure = pressure[index] ?? 0;
    const excluded =
      point !== undefined &&
      params.excludePolygons.some((polygon) => booleanPointInPolygon(point.center, polygon));
    const opportunity =
      excluded || cell.affinity < params.minAffinity
        ? 0
        : cell.affinity * (1 - weight * cellPressure);
    return { ...cell, pressure: cellPressure, opportunity };
  });
}
