import {
  DEFAULT_SCORING_PARAMS,
  cellCenter,
  distanceMeters,
  findCity,
  inBBox,
  rescore,
  smoothCells,
  type Anchor,
  type BBox,
  type PlaceRef,
  type ScoringParams,
  type ScoutEvent,
  type ScoutResult,
  type SupportedCity,
  type TraceStep,
} from "@whitespace/shared";
import type { QlooClient, QlooResult } from "../qloo/client.js";
import type { QlooEndpoint, QlooParams } from "../qloo/params.js";
import { parseHeatmap, parsePlaces, type ParsedHeatmap } from "../qloo/types.js";

export interface ScoutInput {
  concept: string;
  cityId: string;
  anchors: Anchor[];
  categoryTags: { id: string; name: string }[];
  params?: Partial<Pick<ScoringParams, "competitionWeight" | "minAffinity">>;
}

export class ScoutInputError extends Error {
  override readonly name = "ScoutInputError";
}

export const LOCALITY_TOLERANCE_M = 30_000;
const FALLBACK_RADIUS_M = 25_000;
const PAGE_SIZE = 50;
const MAX_PAGES = 4;
const AFFINITY_BATCH = 50;

export type Call = (
  endpoint: QlooEndpoint,
  params: QlooParams,
  label: string,
) => Promise<QlooResult>;

export async function runScout(
  input: ScoutInput,
  qloo: QlooClient,
  emit: (event: ScoutEvent) => void = () => {},
): Promise<ScoutResult> {
  const city = findCity(input.cityId);
  if (!city) throw new ScoutInputError(`Unknown city: ${input.cityId}`);
  if (input.anchors.length === 0) throw new ScoutInputError("At least one anchor is required");

  const trace: TraceStep[] = [];
  let demo = false;
  const call: Call = async (endpoint, params, label) => {
    const result = await qloo.get(endpoint, params, label);
    trace.push(result.trace);
    if (result.source === "recorded" || result.source === "synthetic") demo = true;
    emit({ type: "step", step: result.trace });
    return result;
  };

  emit({ type: "anchors", anchors: input.anchors });
  const anchorIds = input.anchors.map((anchor) => anchor.id).join(",");
  const [heatmap, competitors] = await Promise.all([
    loadHeatmap(city, anchorIds, call),
    loadCompetitors(city, input.categoryTags, anchorIds, call),
  ]);

  const params: ScoringParams = { ...DEFAULT_SCORING_PARAMS, excludePolygons: [], ...input.params };
  const { cells, zones } = rescore(heatmap.cells, competitors, params, { cityName: city.name });

  const result: ScoutResult = {
    concept: input.concept,
    city: heatmap.locality ? { ...city, resolvedLocality: heatmap.locality } : { ...city },
    anchors: input.anchors,
    categoryTags: input.categoryTags,
    affinityMode: "percentile",
    cells,
    competitors,
    zones,
    params,
    trace,
    demo,
  };
  emit({ type: "result", result });
  return result;
}

export async function loadHeatmap(city: SupportedCity, anchorIds: string, call: Call) {
  const signal = { "filter.type": "urn:heatmap", "signal.interests.entities": anchorIds };
  if (city.localityId) {
    const response = await call(
      "/v2/insights",
      { ...signal, "filter.location": city.localityId },
      "Taste heatmap",
    );
    return withinCity(parseHeatmap(response.data, city.center), city.bbox);
  }

  const byName = await call(
    "/v2/insights",
    { ...signal, "filter.location.query": city.name },
    "Taste heatmap",
  );
  const parsed = parseHeatmap(byName.data, city.center);
  const resolved = parsed.locality?.center;
  if (!resolved || distanceMeters(resolved, city.center) <= LOCALITY_TOLERANCE_M) {
    return withinCity(parsed, city.bbox);
  }

  const [lon, lat] = city.center;
  const byPoint = await call(
    "/v2/insights",
    {
      ...signal,
      "filter.location": `POINT(${lon} ${lat})`,
      "filter.location.radius": String(FALLBACK_RADIUS_M),
    },
    "Taste heatmap by coordinates",
  );
  return withinCity(parseHeatmap(byPoint.data, city.center), city.bbox);
}

function withinCity(heatmap: ParsedHeatmap, bbox: BBox): ParsedHeatmap {
  const inside = heatmap.cells.filter((cell) => inBBox(cellCenter(cell.geohash), bbox));
  return { ...heatmap, cells: smoothCells(inside) };
}

async function loadCompetitors(
  city: SupportedCity,
  categoryTags: { id: string }[],
  anchorIds: string,
  call: Call,
): Promise<PlaceRef[]> {
  if (categoryTags.length === 0) return [];
  const tagIds = new Set(categoryTags.map((tag) => tag.id));
  const location = city.localityId ?? bboxPolygon(city.bbox);

  const byId = new Map<string, PlaceRef>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await call(
      "/v2/insights",
      {
        "filter.type": "urn:entity:place",
        "filter.location": location,
        "filter.tags": [...tagIds].join(","),
        "operator.filter.tags": "union",
        take: String(PAGE_SIZE),
        page: String(page),
      },
      `Competitors, page ${page}`,
    );
    const { places } = parsePlaces(response.data);
    const known = byId.size;
    for (const place of places) if (!byId.has(place.id)) byId.set(place.id, place);
    if (places.length < PAGE_SIZE || byId.size === known) break;
  }

  const candidates = [...byId.values()].filter(
    (place) =>
      inBBox([place.lon, place.lat], city.bbox) &&
      (place.tags.length === 0 || place.tags.some((tag) => tagIds.has(tag))),
  );

  const affinity = new Map<string, number>();
  const batches = chunk(
    candidates.map((place) => place.id),
    AFFINITY_BATCH,
  );
  await Promise.all(
    batches.map(async (ids, index) => {
      const response = await call(
        "/v2/insights",
        {
          "filter.type": "urn:entity:place",
          "filter.results.entities": ids.join(","),
          "signal.interests.entities": anchorIds,
          take: String(ids.length),
        },
        batches.length > 1 ? `Competitor taste match ${index + 1}` : "Competitor taste match",
      );
      for (const place of parsePlaces(response.data).places) {
        if (place.affinity !== undefined) affinity.set(place.id, place.affinity);
      }
    }),
  );

  return candidates.map((place) => {
    const match = affinity.get(place.id);
    return match === undefined ? place : { ...place, affinity: match };
  });
}

export function bboxPolygon([west, south, east, north]: BBox): string {
  return `POLYGON((${west} ${south}, ${east} ${south}, ${east} ${north}, ${west} ${north}, ${west} ${south}))`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
