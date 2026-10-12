import type { Polygon } from "geojson";
import type { BBox } from "@whitespace/shared";

export function polygonsBBox(polygons: readonly Polygon[]): BBox | undefined {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon.coordinates) {
      for (const [lon, lat] of ring) {
        if (lon === undefined || lat === undefined) continue;
        west = Math.min(west, lon);
        south = Math.min(south, lat);
        east = Math.max(east, lon);
        north = Math.max(north, lat);
      }
    }
  }
  return Number.isFinite(west) ? [west, south, east, north] : undefined;
}
