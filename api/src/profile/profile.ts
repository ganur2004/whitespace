import type { Polygon } from "geojson";
import { insidePolygon, type PlaceRef, type ZoneProfile } from "@whitespace/shared";
import type { QlooEndpoint, QlooParams } from "../qloo/params.js";
import type { QlooResult } from "../qloo/client.js";
import { parsePlaces } from "../qloo/types.js";

export const PROFILE_TAKE = 12;
export const TASTE_PLACES = 5;
export const MIN_PLACES_INSIDE = 3;
export const NEARBY_RADIUS_M = 600;

const NOT_A_TASTE_SIGNAL = new Set(["urn:tag:genre:place:hotel", "urn:tag:category:place:hotel"]);

export type ProfileCall = (
  endpoint: QlooEndpoint,
  params: QlooParams,
  label: string,
) => Promise<QlooResult>;

export interface ZoneShape {
  id: string;
  rank?: number;
  polygon: Polygon;
}

export function polygonWkt(polygon: Polygon): string {
  const points = (polygon.coordinates[0] ?? []).flatMap(([lon, lat]) =>
    lon === undefined || lat === undefined ? [] : [`${lon.toFixed(5)} ${lat.toFixed(5)}`],
  );
  if (points.length > 0 && points[0] !== points.at(-1)) points.push(points[0] ?? "");
  return `POLYGON((${points.join(", ")}))`;
}

export function mostCommon(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  let best: string | undefined;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (best === undefined || count > (counts.get(best) ?? 0)) best = value;
  }
  return best;
}

export function ringCenter(polygon: Polygon): [number, number] {
  const ring = (polygon.coordinates[0] ?? []).slice(0, -1);
  let lon = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lon += x ?? 0;
    lat += y ?? 0;
  }
  const count = Math.max(1, ring.length);
  return [lon / count, lat / count];
}

export async function profileZone(
  zone: ZoneShape,
  anchorIds: string,
  categoryTagIds: ReadonlySet<string>,
  call: ProfileCall,
): Promise<ZoneProfile> {
  const label = zone.rank ? `Zone ${zone.rank} profile` : "Zone profile";
  const ask = (location: Record<string, string>, suffix = "") =>
    call(
      "/v2/insights",
      {
        "filter.type": "urn:entity:place",
        ...location,
        "signal.interests.entities": anchorIds,
        "feature.explainability": "true",
        take: String(PROFILE_TAKE),
      },
      label + suffix,
    );

  let places = parsePlaces(
    (await ask({ "filter.location": polygonWkt(zone.polygon) })).data,
  ).places.filter((place) => insidePolygon([place.lon, place.lat], zone.polygon));
  if (places.length < MIN_PLACES_INSIDE) {
    const [lon, lat] = ringCenter(zone.polygon);
    const nearby = await ask(
      {
        "filter.location": `POINT(${lon.toFixed(5)} ${lat.toFixed(5)})`,
        "filter.location.radius": String(NEARBY_RADIUS_M),
      },
      ", nearby",
    );
    places = parsePlaces(nearby.data).places;
  }

  const isCompetitor = (place: PlaceRef) => place.tags.some((tag) => categoryTagIds.has(tag));
  const isTasteSignal = (place: PlaceRef) => !place.tags.some((tag) => NOT_A_TASTE_SIGNAL.has(tag));
  const profile: ZoneProfile = {
    tastePlaces: places
      .filter((place) => !isCompetitor(place) && isTasteSignal(place))
      .slice(0, TASTE_PLACES),
  };
  const neighborhood = mostCommon(places.flatMap((place) => place.neighborhood ?? []));
  if (neighborhood) profile.neighborhood = neighborhood;
  return profile;
}

export async function profileZones(
  zones: readonly ZoneShape[],
  anchorIds: string,
  categoryTagIds: ReadonlySet<string>,
  call: ProfileCall,
  onError: (zone: ZoneShape, error: unknown) => void = () => {},
): Promise<Record<string, ZoneProfile>> {
  const settled = await Promise.allSettled(
    zones.map((zone) => profileZone(zone, anchorIds, categoryTagIds, call)),
  );
  const profiles: Record<string, ZoneProfile> = {};
  settled.forEach((outcome, index) => {
    const zone = zones[index];
    if (!zone) return;
    if (outcome.status === "fulfilled") profiles[zone.id] = outcome.value;
    else onError(zone, outcome.reason);
  });
  return profiles;
}
