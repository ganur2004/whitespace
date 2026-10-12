export type QlooEndpoint = "/search" | "/v2/tags" | "/v2/insights";

export type QlooParams = Readonly<Record<string, string>>;

export class QlooParamError extends Error {
  override readonly name = "QlooParamError";
}

const PAGING = ["take", "page", "offset"];

const INTEREST_SIGNALS = ["signal.interests.entities", "signal.interests.tags"];

const DEMOGRAPHIC_SIGNALS = [
  "signal.demographics.age",
  "signal.demographics.gender",
  "signal.demographics.audiences",
];

const LOCATION_SIGNALS = ["signal.location", "signal.location.query", "signal.location.weight"];

const LOCATION_FILTERS = ["filter.location", "filter.location.query", "filter.location.radius"];

const ENTITY_COMMON = [
  "filter.type",
  "bias.trends",
  "feature.explainability",
  "filter.tags",
  "operator.filter.tags",
  "filter.exclude.tags",
  "filter.exclude.entities",
  "filter.results.entities",
  "filter.popularity.min",
  "filter.popularity.max",
  ...INTEREST_SIGNALS,
  ...DEMOGRAPHIC_SIGNALS,
  ...PAGING,
];

const INSIGHTS: Readonly<Record<string, readonly string[]>> = {
  "urn:heatmap": [
    "filter.type",
    "bias.trends",
    ...LOCATION_FILTERS,
    "output.heatmap.boundary",
    "heatmap.dimensions",
    "filter.dimensions.price_level",
    "filter.dimensions.hotel_class",
    ...INTEREST_SIGNALS,
    ...DEMOGRAPHIC_SIGNALS,
  ],
  "urn:entity:place": [
    ...ENTITY_COMMON,
    ...LOCATION_FILTERS,
    "bias.quality",
    "filter.location.geohash",
    "filter.exclude.location",
    "filter.exclude.location.geohash",
    "filter.geocode.name",
    "filter.geocode.admin1_region",
    "filter.geocode.admin2_region",
    "filter.price_level.min",
    "filter.price_level.max",
    "filter.hours",
    "sort_by",
  ],
  "urn:entity:artist": [...ENTITY_COMMON, ...LOCATION_SIGNALS],
  "urn:entity:brand": [...ENTITY_COMMON, ...LOCATION_SIGNALS],
  "urn:tag": [
    "filter.type",
    "filter.tag.types",
    "filter.parents.types",
    "diversify.by",
    "diversify.take",
    ...INTEREST_SIGNALS,
    ...LOCATION_SIGNALS,
    "signal.demographics.audiences",
    ...PAGING,
  ],
  "urn:demographics": ["filter.type", ...INTEREST_SIGNALS],
};

const LOOKUPS: Readonly<Record<Exclude<QlooEndpoint, "/v2/insights">, readonly string[]>> = {
  "/search": [
    "query",
    "types",
    "filter.location",
    "filter.radius",
    "filter.tags",
    "operator.filter.tags",
    "filter.popularity",
    "filter.address",
    "sort_by",
    "page",
    "take",
  ],
  "/v2/tags": [
    "filter.query",
    "filter.tag.types",
    "filter.parents.types",
    "filter.results.tags",
    "feature.typo_tolerance",
    "feature.semantic_search",
    ...PAGING,
  ],
};

const ALLOWED = new Map<string, ReadonlySet<string>>([
  ...Object.entries(INSIGHTS).map(
    ([type, names]) => [`/v2/insights ${type}`, new Set(names)] as const,
  ),
  ...Object.entries(LOOKUPS).map(([endpoint, names]) => [endpoint, new Set(names)] as const),
]);

export function assertAllowedParams(endpoint: QlooEndpoint, params: QlooParams): void {
  const filterType = params["filter.type"];
  const scope = endpoint === "/v2/insights" ? `${endpoint} ${filterType ?? ""}` : endpoint;
  const allowed = ALLOWED.get(scope);
  if (!allowed) {
    throw new QlooParamError(
      `Unsupported filter.type for ${endpoint}: ${filterType ?? "(missing)"}`,
    );
  }
  const rejected = Object.keys(params).filter((name) => !allowed.has(name));
  if (rejected.length > 0) {
    throw new QlooParamError(`Parameters not allowed for ${scope.trim()}: ${rejected.join(", ")}`);
  }
  const empty = Object.entries(params)
    .filter(([, value]) => value.trim() === "")
    .map(([name]) => name);
  if (empty.length > 0) {
    throw new QlooParamError(`Empty parameter values for ${scope.trim()}: ${empty.join(", ")}`);
  }
}
