import {
  booleanPointInPolygon,
  clustersDbscan,
  convex,
  featureCollection,
  point,
} from "@turf/turf";
import type { Polygon } from "geojson";
import { cellBounds, cellSizeMeters } from "../geohash.js";
import type { PlaceRef, ScoredCell, Zone } from "../types.js";
import {
  cellPoints,
  cityProjector,
  competitorPoints,
  countWithin,
  median,
  stableHash,
  type CellPoint,
  type CompetitorPoint,
} from "./geometry.js";

export const NEARBY_RADIUS_M = 1000;
const MIN_CLUSTER_RADIUS_M = 400;
const MIN_CANDIDATES = 20;
const TOP_CELLS_FOR_SCORE = 10;
const SIZE_BONUS_CAP_CELLS = 100;
const SIZE_BONUS = (cells: number): number =>
  1 + 0.1 * Math.log(Math.min(cells, SIZE_BONUS_CAP_CELLS));

export interface ZoneOptions {
  cityName: string;
  maxZones?: number;
}

interface ClusterPass {
  share: number;
  minPoints: number;
}

const FIRST_PASS: ClusterPass = { share: 0.05, minPoints: 4 };
const RELAXED_PASS: ClusterPass = { share: 0.1, minPoints: 3 };

export function clusterRadius(geohash: string): number {
  const { width, height } = cellSizeMeters(geohash);
  return Math.max(MIN_CLUSTER_RADIUS_M, 1.5 * Math.max(width, height));
}

export function buildZones(
  scored: readonly ScoredCell[],
  competitors: readonly PlaceRef[],
  options: ZoneOptions,
): Zone[] {
  const first = scored[0];
  if (!first) return [];
  const maxZones = options.maxZones ?? 3;
  const project = cityProjector(scored);
  const points = cellPoints(scored, project);
  const rivals = competitorPoints(competitors, project);
  const radius = clusterRadius(first.geohash);

  let clusters = findClusters(scored, points, radius, FIRST_PASS);
  if (clusters.length < maxZones) {
    const relaxed = findClusters(scored, points, radius, RELAXED_PASS);
    if (relaxed.length > clusters.length) clusters = relaxed;
  }

  const typicalNearby = median(
    scored.flatMap((cell, index) => {
      const at = points[index];
      return cell.opportunity > 0 && at ? [countWithin(at.x, at.y, rivals, NEARBY_RADIUS_M)] : [];
    }),
  );

  return clusters
    .map((indices) =>
      describeZone(indices, scored, points, rivals, typicalNearby, options.cityName),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, maxZones)
    .map((zone, index) => ({ ...zone, rank: index + 1 }));
}

function findClusters(
  scored: readonly ScoredCell[],
  points: readonly CellPoint[],
  radius: number,
  pass: ClusterPass,
): number[][] {
  const candidates = scored
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => cell.opportunity > 0)
    .sort((a, b) => b.cell.opportunity - a.cell.opportunity);
  const take = Math.min(
    candidates.length,
    Math.max(MIN_CANDIDATES, Math.ceil(pass.share * scored.length)),
  );
  const chosen = candidates.slice(0, take).flatMap(({ index }) => {
    const at = points[index];
    return at ? [point(at.center, { index })] : [];
  });
  if (chosen.length < pass.minPoints) return [];

  const clustered = clustersDbscan(featureCollection(chosen), radius / 1000, {
    minPoints: pass.minPoints,
    units: "kilometers",
  });
  const groups = new Map<number, number[]>();
  for (const feature of clustered.features) {
    const cluster = feature.properties.cluster;
    if (cluster === undefined) continue;
    const members = groups.get(cluster) ?? [];
    members.push(feature.properties.index);
    groups.set(cluster, members);
  }
  return [...groups.values()];
}

function describeZone(
  indices: readonly number[],
  scored: readonly ScoredCell[],
  points: readonly CellPoint[],
  rivals: readonly CompetitorPoint[],
  typicalNearby: number | undefined,
  cityName: string,
): Omit<Zone, "rank"> {
  const members = indices.flatMap((index) => {
    const cell = scored[index];
    const at = points[index];
    return cell && at ? [{ cell, at }] : [];
  });
  const geohashes = members.map(({ cell }) => cell.geohash).sort();
  const opportunities = members.map(({ cell }) => cell.opportunity).sort((a, b) => b - a);
  const top = opportunities.slice(0, TOP_CELLS_FOR_SCORE);
  const score = ((mean(top) ?? 0) * SIZE_BONUS(members.length)) / SIZE_BONUS(SIZE_BONUS_CAP_CELLS);
  const meanAffinity = mean(members.map(({ cell }) => cell.affinity)) ?? 0;

  const meanX = mean(members.map(({ at }) => at.x)) ?? 0;
  const meanY = mean(members.map(({ at }) => at.y)) ?? 0;
  const anchor = members.reduce((best, member) =>
    distanceSquared(member.at, meanX, meanY) < distanceSquared(best.at, meanX, meanY)
      ? member
      : best,
  );

  const polygon = outline(geohashes);
  const inside = rivals.filter(({ place }) =>
    booleanPointInPolygon([place.lon, place.lat], polygon),
  );
  const nearby = rivals.filter(
    (rival) =>
      inside.includes(rival) ||
      members.some(({ at }) => distanceSquared(at, rival.x, rival.y) <= NEARBY_RADIUS_M ** 2),
  );
  const aroundCenter = countWithin(anchor.at.x, anchor.at.y, rivals, NEARBY_RADIUS_M);
  const popularity = mean(
    members.flatMap(({ cell }) => (cell.popularity === undefined ? [] : [cell.popularity])),
  );

  return {
    id: `z${stableHash(geohashes.join(","))}`,
    score,
    polygon,
    centroid: anchor.at.center,
    cellCount: members.length,
    meanAffinity,
    competitorsInside: inside.length,
    competitorsNearby: nearby.length,
    reasons: reasons(meanAffinity, aroundCenter, typicalNearby, popularity, cityName),
  };
}

function reasons(
  meanAffinity: number,
  aroundCenter: number,
  typicalNearby: number | undefined,
  popularity: number | undefined,
  cityName: string,
): string[] {
  const share = Math.max(1, Math.round((1 - meanAffinity) * 100));
  const venues =
    aroundCenter === 0
      ? "No similar venues"
      : `${aroundCenter} similar ${aroundCenter === 1 ? "venue" : "venues"}`;
  const usual =
    typicalNearby !== undefined && typicalNearby > 0
      ? `; areas with this audience usually have ${formatCount(typicalNearby)}`
      : "";
  const result = [
    `Taste match in the top ${share}% of ${cityName}`,
    `${venues} within 1 km of the zone center${usual}`,
  ];
  if (popularity !== undefined) {
    const size = popularity >= 2 / 3 ? "large" : popularity >= 1 / 3 ? "mid-size" : "niche";
    result.push(`Audience size: ${size}`);
  }
  return result;
}

function outline(geohashes: readonly string[]): Polygon {
  const corners = geohashes.flatMap((geohash) => {
    const [west, south, east, north] = cellBounds(geohash);
    return [point([west, south]), point([east, south]), point([east, north]), point([west, north])];
  });
  const hull = convex(featureCollection(corners));
  if (!hull) throw new Error("A zone needs at least one cell");
  return hull.geometry;
}

function mean(values: readonly number[]): number | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function distanceSquared(at: { x: number; y: number }, x: number, y: number): number {
  return (at.x - x) ** 2 + (at.y - y) ** 2;
}

function formatCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
