import ngeohash from "ngeohash";
import { describe, expect, it } from "vitest";
import { encodeCell, smoothCells, type HeatCell } from "@whitespace/shared";

const dense = encodeCell([-97.7431, 30.2672], 7);
const lonely = encodeCell([-97.6664, 30.1975], 7);

function block(center: string, affinity: number): HeatCell[] {
  return [center, ...ngeohash.neighbors(center)].map((geohash) => ({ geohash, affinity }));
}

describe("smoothCells", () => {
  it("ranks a dense high area above an isolated spike", () => {
    const cells: HeatCell[] = [
      ...block(dense, 0.9).map((cell) =>
        cell.geohash === dense ? { ...cell, affinity: 0.95 } : cell,
      ),
      { geohash: lonely, affinity: 1 },
    ];

    const smoothed = new Map(smoothCells(cells).map((cell) => [cell.geohash, cell.affinity]));

    expect(smoothed.get(dense)).toBe(1);
    expect(smoothed.get(lonely)!).toBeLessThan(smoothed.get(dense)!);
  });

  it("keeps the cells, their order and other fields, and returns a percentile", () => {
    const cells = block(dense, 0.5).map((cell, index) => ({
      ...cell,
      affinity: index / 10,
      popularity: 0.3,
    }));

    const smoothed = smoothCells(cells);

    expect(smoothed.map((cell) => cell.geohash)).toEqual(cells.map((cell) => cell.geohash));
    expect(smoothed.every((cell) => cell.popularity === 0.3)).toBe(true);
    expect(Math.max(...smoothed.map((cell) => cell.affinity))).toBe(1);
    expect(Math.min(...smoothed.map((cell) => cell.affinity))).toBeGreaterThan(0);
  });

  it("handles an empty heatmap", () => {
    expect(smoothCells([])).toEqual([]);
  });
});
