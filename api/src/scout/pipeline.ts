import {
  DEFAULT_SCORING_PARAMS,
  averageAudience,
  cellCenter,
  distanceMeters,
  findCity,
  inBBox,
  rescore,
  smoothCells,
  type Anchor,
  type AudiencePortrait,
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
import { parseDemographics, parseHeatmap, parsePlaces, type ParsedHeatmap } from "../qloo/types.js";
import { profileZones } from "../profile/profile.js";
import type { LlmClient } from "../llm/client.js";
import { Analysis } from "../agent/analysis.js";
import { writeBriefs } from "../agent/briefs.js";
import { planConcept, resolveConcept } from "./concept.js";

export interface ScoutInput {
  concept: string;
  cityId: string;
  anchors: Anchor[];
  categoryTags?: { id: string; name: string }[];
  referencePlaces?: string[];
  params?: Partial<Pick<ScoringParams, "competitionWeight" | "minAffinity">>;
}

export interface ScoutOptions {
  llm?: LlmClient | undefined;
  logger?: Pick<Console, "warn">;
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
  options: ScoutOptions = {},
): Promise<ScoutResult> {
  const city = findCity(input.cityId);
  if (!city) throw new ScoutInputError(`Unknown city: ${input.cityId}`);
  const logger = options.logger ?? console;
  if (input.anchors.length === 0 && !input.concept.trim() && !input.referencePlaces?.length) {
    throw new ScoutInputError("Describe the concept or name at least one anchor");
  }

  const trace: TraceStep[] = [];
  let demo = false;
  const call: Call = async (endpoint, params, label) => {
    const result = await qloo.get(endpoint, params, label);
    trace.push(result.trace);
    if (result.source === "recorded" || result.source === "synthetic") demo = true;
    emit({ type: "step", step: result.trace });
    return result;
  };

  let anchors = input.anchors;
  let categoryTags = input.categoryTags ?? [];
  if (anchors.length === 0) {
    const { plan } = await planConcept(
      input.concept,
      city,
      input.referencePlaces ?? [],
      options.llm,
      logger,
    );
    const resolved = await resolveConcept(plan, city, call, logger);
    anchors = resolved.anchors;
    if (input.categoryTags === undefined) categoryTags = resolved.categoryTags;
    if (anchors.length === 0) {
      throw new ScoutInputError(
        "Qloo found no entities for this concept. Name a few venues, artists or brands that capture it.",
      );
    }
  }

  emit({ type: "anchors", anchors, categoryTags });
  const anchorIds = anchors.map((anchor) => anchor.id).join(",");
  const [heatmap, competitors, audience] = await Promise.all([
    loadHeatmap(city, anchorIds, call),
    loadCompetitors(city, categoryTags, anchorIds, call),
    loadAudience(anchorIds, call),
  ]);

  const params: ScoringParams = { ...DEFAULT_SCORING_PARAMS, excludePolygons: [], ...input.params };
  const { cells, zones } = rescore(heatmap.cells, competitors, params, { cityName: city.name });

  const base: ScoutResult = {
    concept: input.concept,
    city: heatmap.locality ? { ...city, resolvedLocality: heatmap.locality } : { ...city },
    anchors,
    categoryTags,
    affinityMode: "percentile",
    cells,
    competitors,
    zones,
    params,
    trace: [...trace],
    demo,
  };
  if (audience) base.audience = audience;
  emit({ type: "result", result: base });

  const profiles = await profileZones(
    zones,
    anchorIds,
    new Set(categoryTags.map((tag) => tag.id)),
    call,
    (zone, error) => logger.warn(`Zone ${zone.rank ?? zone.id} profile failed`, error),
  );
  const profiled: ScoutResult = {
    ...base,
    zones: zones.map((zone) => {
      const profile = profiles[zone.id];
      return profile ? { ...zone, profile } : zone;
    }),
    trace: [...trace],
    demo,
  };
  emit({ type: "result", result: profiled });
  if (!options.llm || profiled.zones.length === 0) return profiled;

  const analysis = new Analysis(undefined, undefined, logger);
  analysis.adopt(profiled);
  await writeBriefs(analysis, options.llm, logger);
  const result: ScoutResult = { ...analysis.require(), trace: [...trace], demo };
  emit({ type: "result", result });
  return result;
}

async function loadAudience(anchorIds: string, call: Call): Promise<AudiencePortrait | undefined> {
  try {
    const response = await call(
      "/v2/insights",
      { "filter.type": "urn:demographics", "signal.interests.entities": anchorIds },
      "Audience portrait",
    );
    return averageAudience(parseDemographics(response.data));
  } catch (error) {
    console.warn("Audience portrait failed", error);
    return undefined;
  }
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
