import ngeohash from "ngeohash";
import type { Polygon } from "geojson";
import type { BBox, LonLat } from "./types.js";

const METERS_PER_DEGREE_LAT = 110_574;
const METERS_PER_DEGREE_LON_AT_EQUATOR = 111_320;

export function cellCenter(geohash: string): LonLat {
  const { latitude, longitude } = ngeohash.decode(geohash);
  return [longitude, latitude];
}

export function cellBounds(geohash: string): BBox {
  const [south, west, north, east] = ngeohash.decode_bbox(geohash);
  return [west, south, east, north];
}

export function cellPolygon(geohash: string): Polygon {
  const [west, south, east, north] = cellBounds(geohash);
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

export function cellSizeMeters(geohash: string): { width: number; height: number } {
  const [west, south, east, north] = cellBounds(geohash);
  const latitude = (south + north) / 2;
  return {
    width: (east - west) * METERS_PER_DEGREE_LON_AT_EQUATOR * Math.cos((latitude * Math.PI) / 180),
    height: (north - south) * METERS_PER_DEGREE_LAT,
  };
}

export function encodeCell([lon, lat]: LonLat, precision: number): string {
  return ngeohash.encode(lat, lon, precision);
}

export type Projector = (point: LonLat) => [number, number];

export function localProjector(originLatitude: number): Projector {
  const metersPerDegreeLon =
    METERS_PER_DEGREE_LON_AT_EQUATOR * Math.cos((originLatitude * Math.PI) / 180);
  return ([lon, lat]) => [lon * metersPerDegreeLon, lat * METERS_PER_DEGREE_LAT];
}
