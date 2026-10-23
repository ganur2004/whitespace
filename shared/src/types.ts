import type { Polygon } from "geojson";

export type LonLat = [number, number];

export type BBox = [number, number, number, number];

export interface SupportedCity {
  id: string;
  name: string;
  center: LonLat;
  bbox: BBox;
  localityId?: string;
}

export interface Anchor {
  id: string;
  name: string;
  type: string;
  source: "agent" | "user";
  localCompetitor?: boolean;
}

export interface HeatCell {
  geohash: string;
  affinity: number;
  popularity?: number;
}

export interface PlaceRef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  neighborhood?: string;
  affinity?: number;
  priceLevel?: number;
  tags: string[];
  drivers?: { anchorId: string; score: number }[];
  sharedTags?: string[];
}

export interface ScoredCell extends HeatCell {
  pressure: number;
  opportunity: number;
}

export interface ZoneProfile {
  neighborhood?: string;
  tastePlaces: PlaceRef[];
  brief?: string;
}

export interface Zone {
  id: string;
  rank: number;
  score: number;
  polygon: Polygon;
  centroid: LonLat;
  cellCount: number;
  meanAffinity: number;
  competitorsInside: number;
  competitorsNearby: number;
  reasons: string[];
  profile?: ZoneProfile;
}

export interface ScoringParams {
  competitionWeight: number;
  minAffinity: number;
  excludePolygons: Polygon[];
}

export interface TraceStep {
  id: string;
  label: string;
  endpoint: string;
  params: Record<string, string>;
  resultCount: number;
  ms: number;
  cached: boolean;
  cachedAt?: string;
}

export interface AnchorAudience {
  anchorId: string;
  age: Record<string, number>;
  gender: Record<string, number>;
}

export interface AudiencePortrait {
  age: Record<string, number>;
  gender: Record<string, number>;
  byAnchor: AnchorAudience[];
}

export interface ResolvedLocality {
  id: string;
  name: string;
  center?: LonLat;
}

export interface ScoutResult {
  concept: string;
  city: SupportedCity & { resolvedLocality?: ResolvedLocality };
  anchors: Anchor[];
  categoryTags: { id: string; name: string }[];
  affinityMode: "percentile" | "lift";
  cells: ScoredCell[];
  competitors: PlaceRef[];
  zones: Zone[];
  params: ScoringParams;
  audience?: AudiencePortrait;
  trace: TraceStep[];
  demo: boolean;
}

export type ScoutEvent =
  | { type: "step"; step: TraceStep }
  | { type: "anchors"; anchors: Anchor[]; categoryTags: { id: string; name: string }[] }
  | { type: "result"; result: ScoutResult }
  | { type: "error"; message: string };

export type CompactCell = [geohash: string, affinity: number, popularity?: number];

export interface ChatState {
  concept: string;
  cityId: string;
  anchors: Anchor[];
  categoryTags: { id: string; name: string }[];
  params: ScoringParams;
  cells: CompactCell[];
  competitors: PlaceRef[];
  zones: { id: string; profile?: ZoneProfile }[];
  audience?: AudiencePortrait;
  demo: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export type ChatAction =
  { type: "focusZone"; zoneId: string } | { type: "highlightPlaces"; placeIds: string[] };

export interface ChatReply {
  reply: string;
  mode: "agent" | "basic";
  result?: ScoutResult;
  fresh?: boolean;
  actions: ChatAction[];
}

export interface HealthStatus {
  ok: true;
  demo: boolean;
  qlooKey: boolean;
  llm: boolean;
}
