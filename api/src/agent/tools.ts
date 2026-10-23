import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CITIES, findCity, type Anchor, type Zone } from "@whitespace/shared";
import type { LlmClient } from "../llm/client.js";
import type { QlooClient } from "../qloo/client.js";
import { parsePlaces } from "../qloo/types.js";
import { MAX_ANCHORS, searchEntity } from "../scout/concept.js";
import { runScout } from "../scout/pipeline.js";
import type { Analysis } from "./analysis.js";

export interface ToolContext {
  analysis: Analysis;
  qloo: QlooClient;
  llm: LlmClient | undefined;
  logger: Pick<Console, "warn">;
}

export interface ToolOutcome {
  text: string;
  focusZoneId?: string;
  highlightPlaceIds?: string[];
}

const zoneNumber = z.coerce.number().int().min(1).max(10);

const schemas = {
  run_scout: z.object({
    concept: z.string().trim().min(3).max(1000),
    city: z.string().trim().min(1),
    referencePlaces: z.array(z.string().trim().min(1).max(80)).max(4).optional(),
  }),
  update_anchors: z.object({
    add: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          type: z.enum(["place", "artist", "brand"]),
        }),
      )
      .max(4)
      .optional(),
    remove: z.array(z.string().trim().min(1)).max(6).optional(),
  }),
  adjust_scoring: z.object({
    competitionWeight: z.number().min(0).max(1).optional(),
    minAffinity: z.number().min(0.5).max(0.95).optional(),
  }),
  exclude_area: z.object({
    zone: zoneNumber.optional(),
    neighborhood: z.string().trim().min(2).max(80).optional(),
  }),
  reset_exclusions: z.object({}),
  profile_zone: z.object({ zone: zoneNumber }),
  compare_zones: z.object({ a: zoneNumber, b: zoneNumber }),
  explain_place: z.object({ place: z.string().trim().min(1).max(120) }),
} as const;

export type ToolName = keyof typeof schemas;

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Anthropic.Tool.InputSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "run_scout",
    description:
      "Run a full new analysis: find taste anchors for a venue concept in one of the supported cities, build the taste map, find similar venues and pick the top zones. Use when the user describes a new concept or wants another city.",
    input_schema: objectSchema(
      {
        concept: { type: "string", description: "The venue concept in the user's words." },
        city: { type: "string", enum: CITIES.map((city) => city.id) },
        referencePlaces: {
          type: "array",
          items: { type: "string" },
          description: "Venues the user named as similar, if any.",
        },
      },
      ["concept", "city"],
    ),
  },
  {
    name: "update_anchors",
    description:
      "Add taste anchors (searched by name in Qloo) or remove anchors (by [[id]] token or name), then rerun the analysis for the same concept and city.",
    input_schema: objectSchema({
      add: {
        type: "array",
        items: objectSchema(
          {
            name: { type: "string", description: "Exact name of a venue, artist or brand." },
            type: { type: "string", enum: ["place", "artist", "brand"] },
          },
          ["name", "type"],
        ),
      },
      remove: { type: "array", items: { type: "string" } },
    }),
  },
  {
    name: "adjust_scoring",
    description:
      "Change how zones are scored and recompute them. competitionWeight: 0 ignores similar venues, 1 avoids them strongly (default 0.6). minAffinity: the minimum taste-match percentile a map cell needs, 0.5 to 0.95 (default 0.7).",
    input_schema: objectSchema({
      competitionWeight: { type: "number" },
      minAffinity: { type: "number" },
    }),
  },
  {
    name: "exclude_area",
    description:
      "Exclude an area from the search and recompute the zones: either a current zone by its number, or a neighborhood by name (its outline is built from the places we know there).",
    input_schema: objectSchema({
      zone: { type: "integer" },
      neighborhood: { type: "string" },
    }),
  },
  {
    name: "reset_exclusions",
    description: "Remove every excluded area and recompute the zones.",
    input_schema: objectSchema({}),
  },
  {
    name: "profile_zone",
    description:
      "Detailed facts about one zone: neighborhood, scores, places its audience likes with the anchors that drive them, and the closest similar venues.",
    input_schema: objectSchema({ zone: { type: "integer" } }, ["zone"]),
  },
  {
    name: "compare_zones",
    description: "Facts about two zones side by side, for a comparison.",
    input_schema: objectSchema({ a: { type: "integer" }, b: { type: "integer" } }, ["a", "b"]),
  },
  {
    name: "explain_place",
    description:
      "Explain why one place matches the concept's taste: its taste match and which anchors drive it, from Qloo explainability.",
    input_schema: objectSchema(
      { place: { type: "string", description: "The place's [[id]] token or its name." } },
      ["place"],
    ),
  },
];

export class ToolInputError extends Error {
  override readonly name = "ToolInputError";
}

export async function executeTool(
  name: string,
  input: unknown,
  context: ToolContext,
): Promise<ToolOutcome> {
  switch (name) {
    case "run_scout":
      return runScoutTool(schemas.run_scout.parse(input), context);
    case "update_anchors":
      return updateAnchors(schemas.update_anchors.parse(input), context);
    case "adjust_scoring":
      return adjustScoring(schemas.adjust_scoring.parse(input), context);
    case "exclude_area":
      return excludeArea(schemas.exclude_area.parse(input), context);
    case "reset_exclusions":
      return resetExclusions(context);
    case "profile_zone":
      return profileZone(schemas.profile_zone.parse(input).zone, context);
    case "compare_zones":
      return compareZones(schemas.compare_zones.parse(input), context);
    case "explain_place":
      return explainPlace(schemas.explain_place.parse(input).place, context);
    default:
      throw new ToolInputError(`Unknown tool: ${name}`);
  }
}

async function runScoutTool(
  input: z.infer<typeof schemas.run_scout>,
  { analysis, qloo, llm, logger }: ToolContext,
): Promise<ToolOutcome> {
  const city =
    findCity(input.city) ??
    CITIES.find((option) => option.name.toLowerCase().includes(input.city.toLowerCase()));
  if (!city) {
    throw new ToolInputError(
      `Unsupported city. Choose one of: ${CITIES.map((option) => option.name).join(", ")}`,
    );
  }
  const result = await runScout(
    {
      concept: input.concept,
      cityId: city.id,
      anchors: [],
      referencePlaces: input.referencePlaces ?? [],
    },
    qloo,
    () => {},
    { llm, logger },
  );
  analysis.adopt(result);
  return { text: `New analysis for ${city.name}.\n${analysis.context()}`, ...focusFirst(analysis) };
}

async function updateAnchors(
  input: z.infer<typeof schemas.update_anchors>,
  { analysis, qloo, llm, logger }: ToolContext,
): Promise<ToolOutcome> {
  const result = analysis.require();
  const city = findCity(result.city.id);
  if (!city) throw new ToolInputError("The current city is not supported.");

  const removed = new Set(
    (input.remove ?? []).flatMap((reference) => {
      const entity = analysis.registry.find(reference);
      return entity && entity.kind === "anchor" ? [entity.id] : [];
    }),
  );
  const anchors: Anchor[] = result.anchors.filter((anchor) => !removed.has(anchor.id));
  const notFound: string[] = [];
  for (const addition of input.add ?? []) {
    const hits = await searchEntity(
      { query: addition.name, type: addition.type },
      city,
      analysis.call,
    );
    const hit = hits.find((candidate) => !anchors.some((anchor) => anchor.id === candidate.id));
    if (!hit) {
      notFound.push(addition.name);
      continue;
    }
    anchors.push({
      id: hit.id,
      name: hit.name,
      type: hit.type ?? `urn:entity:${addition.type}`,
      source: "user",
    });
  }
  if (anchors.length === 0) throw new ToolInputError("At least one anchor has to stay.");
  if (anchors.length > MAX_ANCHORS + 2)
    throw new ToolInputError("Too many anchors; remove some first.");

  const rerun = await runScout(
    {
      concept: result.concept,
      cityId: city.id,
      anchors,
      categoryTags: result.categoryTags,
      params: {
        competitionWeight: result.params.competitionWeight,
        minAffinity: result.params.minAffinity,
      },
    },
    qloo,
    () => {},
    { llm, logger },
  );
  analysis.adopt(rerun);
  const missing = notFound.length > 0 ? `\nQloo found nothing for: ${notFound.join(", ")}.` : "";
  return {
    text: `Anchors updated and the analysis rerun.${missing}\n${analysis.context()}`,
    ...focusFirst(analysis),
  };
}

async function adjustScoring(
  input: z.infer<typeof schemas.adjust_scoring>,
  { analysis }: ToolContext,
): Promise<ToolOutcome> {
  if (input.competitionWeight === undefined && input.minAffinity === undefined) {
    throw new ToolInputError("Give competitionWeight, minAffinity or both.");
  }
  const update: { competitionWeight?: number; minAffinity?: number } = {};
  if (input.competitionWeight !== undefined) update.competitionWeight = input.competitionWeight;
  if (input.minAffinity !== undefined) update.minAffinity = input.minAffinity;
  await analysis.rescore(update);
  return { text: `Zones recomputed.\n${analysis.context()}`, ...focusFirst(analysis) };
}

async function excludeArea(
  input: z.infer<typeof schemas.exclude_area>,
  { analysis }: ToolContext,
): Promise<ToolOutcome> {
  const result = analysis.require();
  let excluded: { polygon: Zone["polygon"]; label: string } | undefined;
  if (input.zone !== undefined) {
    const zone = analysis.zone(input.zone);
    if (!zone) throw new ToolInputError(`There is no zone ${input.zone}.`);
    excluded = { polygon: zone.polygon, label: zone.profile?.neighborhood ?? `zone ${zone.rank}` };
  } else if (input.neighborhood) {
    excluded = analysis.areaPolygon(input.neighborhood);
    if (!excluded) {
      return {
        text: `I have no places in "${input.neighborhood}" in the data, so I cannot draw it. Ask the user to use "Exclude this area" on a zone card instead.`,
      };
    }
  } else {
    throw new ToolInputError("Give a zone number or a neighborhood.");
  }
  await analysis.rescore({ excludePolygons: [...result.params.excludePolygons, excluded.polygon] });
  return {
    text: `Excluded ${excluded.label} and recomputed the zones.\n${analysis.context()}`,
    ...focusFirst(analysis),
  };
}

async function resetExclusions({ analysis }: ToolContext): Promise<ToolOutcome> {
  await analysis.rescore({ excludePolygons: [] });
  return { text: `All exclusions removed.\n${analysis.context()}`, ...focusFirst(analysis) };
}

async function profileZone(rank: number, { analysis }: ToolContext): Promise<ToolOutcome> {
  analysis.require();
  await analysis.ensureProfiles();
  const zone = analysis.zone(rank);
  if (!zone) throw new ToolInputError(`There is no zone ${rank}.`);
  return { text: analysis.zoneFacts(zone, true), focusZoneId: zone.id };
}

async function compareZones(
  { a, b }: z.infer<typeof schemas.compare_zones>,
  { analysis }: ToolContext,
): Promise<ToolOutcome> {
  analysis.require();
  await analysis.ensureProfiles();
  const first = analysis.zone(a);
  const second = analysis.zone(b);
  if (!first || !second) throw new ToolInputError(`Zones ${a} and ${b} do not both exist.`);
  return {
    text: `${analysis.zoneFacts(first, true)}\n${analysis.zoneFacts(second, true)}`,
    focusZoneId: first.id,
  };
}

async function explainPlace(reference: string, { analysis }: ToolContext): Promise<ToolOutcome> {
  const result = analysis.require();
  const places = analysis.places();
  const entity = analysis.registry.find(reference);
  const place =
    places.find((candidate) => candidate.id === entity?.id) ??
    places.find((candidate) => candidate.name.toLowerCase() === reference.toLowerCase()) ??
    places.find((candidate) => candidate.name.toLowerCase().includes(reference.toLowerCase()));
  if (!place) {
    if (entity?.kind === "anchor") {
      return {
        text: `${analysis.registry.ref("anchor", entity.id, entity.name)} is one of the taste anchors: it defines the taste rather than matching it.`,
      };
    }
    throw new ToolInputError(`"${reference}" is not a place in the current analysis.`);
  }

  let drivers = place.drivers ?? [];
  let affinity = place.affinity;
  if (drivers.length === 0) {
    const response = await analysis.call(
      "/v2/insights",
      {
        "filter.type": "urn:entity:place",
        "filter.results.entities": place.id,
        "signal.interests.entities": result.anchors.map((anchor) => anchor.id).join(","),
        "feature.explainability": "true",
        take: "1",
      },
      "Explain place",
    );
    const explained = parsePlaces(response.data).places.find(
      (candidate) => candidate.id === place.id,
    );
    drivers = explained?.drivers ?? [];
    affinity ??= explained?.affinity;
  }

  const isRival = result.competitors.some((rival) => rival.id === place.id);
  const kind = isRival ? "competitor" : "place";
  const parts = [
    `${analysis.registry.ref(kind, place.id, place.name)}${place.neighborhood ? ` in ${place.neighborhood}` : ""} is ${isRival ? "a similar venue (competitor)" : "a place this audience likes"}.`,
    affinity === undefined
      ? "Qloo gave no taste match for it."
      : `Taste match with the anchors: ${Math.round(affinity * 100)}%.`,
    drivers.length === 0
      ? "Qloo did not say which anchors drive it."
      : `Anchors that drive the match (0 to 1): ${analysis.describeDrivers(drivers)}.`,
  ];
  const zone = result.zones.find((candidate) =>
    candidate.profile?.tastePlaces.some((taste) => taste.id === place.id),
  );
  return {
    text: parts.join(" "),
    highlightPlaceIds: [place.id],
    ...(zone ? { focusZoneId: zone.id } : {}),
  };
}

function focusFirst(analysis: Analysis): { focusZoneId?: string } {
  const first = analysis.result?.zones[0];
  return first ? { focusZoneId: first.id } : {};
}
