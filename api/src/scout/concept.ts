import { z } from "zod";
import { inBBox, type Anchor, type SupportedCity } from "@whitespace/shared";
import { assertUsable, describeLlmError, textOf, type LlmClient } from "../llm/client.js";
import { parseSearch, parseTags, type SearchHit, type TagHit } from "../qloo/types.js";
import type { Call } from "./pipeline.js";

export type AnchorKind = "place" | "artist" | "brand";

export interface AnchorQuery {
  query: string;
  type: AnchorKind;
  reference?: boolean;
}

export interface ConceptPlan {
  anchorQueries: AnchorQuery[];
  categoryQueries: string[];
}

export interface ResolvedConcept {
  anchors: Anchor[];
  categoryTags: { id: string; name: string }[];
  plannedBy: "llm" | "fallback";
}

export const MAX_ANCHORS = 6;
const SEARCH_TAKE = 5;
const TAG_TAKE = 10;
const PLACE_GENRE = "urn:tag:genre:place:";

const planSchema = z.object({
  anchorQueries: z
    .array(
      z.object({
        query: z.string().trim().min(1).max(80),
        type: z.enum(["place", "artist", "brand"]),
      }),
    )
    .min(1),
  categoryQueries: z.array(z.string().trim().min(1).max(40)).min(1),
});

const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["anchorQueries", "categoryQueries"],
  properties: {
    anchorQueries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["query", "type"],
        properties: {
          query: { type: "string" },
          type: { type: "string", enum: ["place", "artist", "brand"] },
        },
      },
    },
    categoryQueries: { type: "array", items: { type: "string" } },
  },
};

const PLAN_SYSTEM = `You turn a venue concept into search queries for the Qloo taste graph.
Return JSON only.
anchorQueries: 3 to 6 searches for real, well-known entities that capture the concept's taste, covering at least two types:
- "place": famous venues of the same kind, preferably in other cities than the target city, so the taste map does not just light up around local rivals;
- "artist": musicians or bands that fit the mood;
- "brand": consumer brands that fit the style.
Each query is the exact name of one entity, not a description.
categoryQueries: 1 or 2 short tag searches for the main venue category only (for example "ramen" or "coffee shop"), never adjacent categories like "bar".
Never invent IDs.`;

export async function planConcept(
  concept: string,
  city: SupportedCity,
  referencePlaces: readonly string[],
  llm: LlmClient | undefined,
  logger: Pick<Console, "warn"> = console,
): Promise<{ plan: ConceptPlan; plannedBy: "llm" | "fallback" }> {
  const references: AnchorQuery[] = referencePlaces
    .map((query) => query.trim())
    .filter(Boolean)
    .map((query) => ({ query, type: "place", reference: true }));

  if (llm) {
    try {
      const message = assertUsable(
        await llm.create({
          max_tokens: 16000,
          system: PLAN_SYSTEM,
          output_config: {
            effort: "low",
            format: { type: "json_schema", schema: PLAN_JSON_SCHEMA },
          },
          messages: [
            {
              role: "user",
              content: `Concept: ${concept}\nTarget city: ${city.name}${
                references.length > 0
                  ? `\nThe owner named these venues as similar: ${references.map((ref) => ref.query).join("; ")}`
                  : ""
              }`,
            },
          ],
        }),
      );
      const parsed = planSchema.parse(JSON.parse(textOf(message)));
      return {
        plan: {
          anchorQueries: dedupeQueries([...references, ...parsed.anchorQueries]).slice(
            0,
            MAX_ANCHORS + 2,
          ),
          categoryQueries: parsed.categoryQueries.slice(0, 2),
        },
        plannedBy: "llm",
      };
    } catch (error) {
      logger.warn(
        `Concept planning with the LLM failed; using keywords. ${describeLlmError(error)}`,
      );
    }
  }
  return { plan: fallbackPlan(concept, references), plannedBy: "fallback" };
}

const CATEGORY_WORDS: readonly string[] = [
  "wine bar",
  "cocktail bar",
  "coffee shop",
  "record store",
  "ice cream",
  "book store",
  "bookstore",
  "ramen",
  "sushi",
  "pizza",
  "taco",
  "burger",
  "barbecue",
  "bbq",
  "bakery",
  "brewery",
  "taproom",
  "coffee",
  "cafe",
  "café",
  "bistro",
  "brunch",
  "noodle",
  "dumpling",
  "pho",
  "thai",
  "korean",
  "vegan",
  "juice",
  "tea",
  "gym",
  "yoga",
  "climbing",
  "barber",
  "salon",
  "boutique",
  "florist",
  "pub",
  "bar",
  "restaurant",
];

const MUSIC_WORDS: readonly [string, string][] = [
  ["vinyl", "Khruangbin"],
  ["jazz", "Miles Davis"],
  ["hip hop", "Kendrick Lamar"],
  ["hip-hop", "Kendrick Lamar"],
  ["punk", "The Clash"],
  ["indie", "Arctic Monkeys"],
  ["techno", "Daft Punk"],
  ["house music", "Daft Punk"],
  ["country", "Willie Nelson"],
  ["k-pop", "BTS"],
  ["lo-fi", "Nujabes"],
  ["soul", "Al Green"],
];

const BRAND_WORDS: readonly [string, string][] = [
  ["craft beer", "Lagunitas Brewing Company"],
  ["natural wine", "Raw Wine"],
  ["specialty coffee", "Blue Bottle Coffee"],
  ["third wave coffee", "Blue Bottle Coffee"],
  ["kombucha", "GT's Living Foods"],
  ["streetwear", "Supreme"],
  ["outdoor", "Patagonia"],
  ["sustainable", "Patagonia"],
  ["skate", "Vans"],
];

export function fallbackPlan(concept: string, references: readonly AnchorQuery[]): ConceptPlan {
  const text = ` ${concept.toLowerCase()} `;
  const has = (word: string) => new RegExp(`[^a-z]${escapeRegExp(word)}[^a-z]`).test(text);
  const category = CATEGORY_WORDS.find(has);
  const quoted = [...concept.matchAll(/["“]([^"”]{2,60})["”]/g)].flatMap((match) =>
    match[1] ? [{ query: match[1].trim(), type: "place" as const, reference: true }] : [],
  );
  const liked = likedPlaces(concept).map((query) => ({
    query,
    type: "place" as const,
    reference: true,
  }));
  const extras: AnchorQuery[] = [
    ...MUSIC_WORDS.filter(([word]) => has(word)).map(([, query]) => ({
      query,
      type: "artist" as const,
    })),
    ...BRAND_WORDS.filter(([word]) => has(word)).map(([, query]) => ({
      query,
      type: "brand" as const,
    })),
  ];
  const anchorQueries = dedupeQueries([
    ...references,
    ...quoted,
    ...liked,
    ...(category ? [{ query: category, type: "place" as const }] : []),
    ...extras,
  ]);
  if (anchorQueries.length === 0) {
    const words = concept.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim();
    if (words) anchorQueries.push({ query: words.slice(0, 60), type: "place" });
  }
  return { anchorQueries, categoryQueries: category ? [category] : [] };
}

function likedPlaces(concept: string): string[] {
  const match = /(?:places?|spots?|venues?)\s+like\s+([^.;\n]+)/i.exec(concept);
  if (!match?.[1]) return [];
  return match[1]
    .split(/,|\band\b|&/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 1 && /[A-Z]/.test(part));
}

function dedupeQueries(queries: readonly AnchorQuery[]): AnchorQuery[] {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = query.query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function resolveConcept(
  plan: ConceptPlan,
  city: SupportedCity,
  call: Call,
  logger: Pick<Console, "warn"> = console,
): Promise<Omit<ResolvedConcept, "plannedBy">> {
  const [hits, categoryTags] = await Promise.all([
    Promise.all(
      plan.anchorQueries.map((query) =>
        searchEntity(query, city, call).catch((error: unknown) => {
          logger.warn(`Anchor search failed for "${query.query}"`, error);
          return [] as SearchHit[];
        }),
      ),
    ),
    resolveCategoryTags(plan.categoryQueries, call, logger),
  ]);

  const tagIds = new Set(categoryTags.map((tag) => tag.id));
  const chosen = new Map<string, Anchor>();
  hits.forEach((candidates, index) => {
    const query = plan.anchorQueries[index];
    if (!query || chosen.size >= MAX_ANCHORS) return;
    const hit = candidates.find((candidate) => !chosen.has(candidate.id));
    if (!hit) return;
    const anchor: Anchor = {
      id: hit.id,
      name: hit.name,
      type: hit.type ?? `urn:entity:${query.type}`,
      source: query.reference ? "user" : "agent",
    };
    if (
      anchor.type === "urn:entity:place" &&
      hit.location &&
      inBBox(hit.location, city.bbox) &&
      hit.tags.some((tag) => tagIds.has(tag))
    ) {
      anchor.localCompetitor = true;
    }
    chosen.set(hit.id, anchor);
  });
  return { anchors: [...chosen.values()], categoryTags };
}

export async function searchEntity(
  query: AnchorQuery,
  city: SupportedCity,
  call: Call,
): Promise<SearchHit[]> {
  const params: Record<string, string> = {
    query: query.query,
    types: `urn:entity:${query.type}`,
    take: String(SEARCH_TAKE),
  };
  if (query.reference) {
    const [lon, lat] = city.center;
    params["filter.location"] = `${lat},${lon}`;
    params.sort_by = "match";
  }
  const response = await call("/search", params, `Find anchor: ${query.query}`);
  return parseSearch(response.data);
}

async function resolveCategoryTags(
  queries: readonly string[],
  call: Call,
  logger: Pick<Console, "warn">,
): Promise<{ id: string; name: string }[]> {
  const found = await Promise.all(
    queries.map(async (query) => {
      try {
        const exact = pickGenre(
          parseTags(
            (
              await call(
                "/v2/tags",
                {
                  "filter.query": query,
                  "feature.typo_tolerance": "true",
                  take: String(TAG_TAKE),
                },
                `Category tag: ${query}`,
              )
            ).data,
          ),
          query,
        );
        if (exact) return exact;
        return pickGenre(
          parseTags(
            (
              await call(
                "/v2/tags",
                {
                  "filter.query": query,
                  "feature.semantic_search": "true",
                  take: String(TAG_TAKE),
                },
                `Category tag (semantic): ${query}`,
              )
            ).data,
          ),
          query,
        );
      } catch (error) {
        logger.warn(`Category tag search failed for "${query}"`, error);
        return undefined;
      }
    }),
  );
  const unique = new Map<string, { id: string; name: string }>();
  for (const tag of found) if (tag) unique.set(tag.id, { id: tag.id, name: tag.name });
  return [...unique.values()];
}

export function pickGenre(tags: readonly TagHit[], query: string): TagHit | undefined {
  const genres = tags.filter((tag) => tag.id.startsWith(PLACE_GENRE));
  const wanted = query.toLowerCase().replace(/\s+/g, "_");
  return (
    genres.find((tag) => tag.id.endsWith(`:${wanted}`)) ??
    genres.find((tag) => tag.id.includes(wanted)) ??
    genres[0]
  );
}
