import ngeohash from "ngeohash";
import { cellCenter, cellSizeMeters } from "../geohash.js";
import { distanceMeters } from "../geo.js";
import type { HeatCell } from "../types.js";

export function smoothCells(cells: readonly HeatCell[]): HeatCell[] {
  const first = cells[0];
  if (!first) return [];
  const affinity = new Map(cells.map((cell) => [cell.geohash, cell.affinity]));
  const { width, height } = cellSizeMeters(first.geohash);
  const sigma = Math.max(width, height);

  const blurred = cells.map((cell) => {
    const center = cellCenter(cell.geohash);
    let weighted = 0;
    let total = 0;
    for (const neighbour of [cell.geohash, ...ngeohash.neighbors(cell.geohash)]) {
      const d = distanceMeters(center, cellCenter(neighbour));
      const weight = Math.exp(-(d * d) / (2 * sigma * sigma));
      total += weight;
      weighted += weight * (affinity.get(neighbour) ?? 0);
    }
    return weighted / total;
  });

  const rank = new Array<number>(cells.length);
  blurred
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value)
    .forEach(({ index }, position) => {
      rank[index] = 1 - position / cells.length;
    });
  return cells.map((cell, index) => ({ ...cell, affinity: rank[index] ?? 0 }));
}
