import { circle, convex, featureCollection, point } from "@turf/turf";
import type { Polygon } from "geojson";
import {
  describeAudience,
  distanceMeters,
  findCity,
  insidePolygon,
  rescore,
  type ChatState,
  type HeatCell,
  type LonLat,
  type PlaceRef,
  type ScoringParams,
  type ScoutResult,
  type TraceStep,
  type Zone,
  type ZoneProfile,
} from "@whitespace/shared";
import type { QlooClient } from "../qloo/client.js";
import type { QlooEndpoint, QlooParams } from "../qloo/params.js";
import { profileZones } from "../profile/profile.js";
import type { Call } from "../scout/pipeline.js";
import { EntityRegistry } from "./grounding.js";

const NEARBY_RIVALS_M = 1500;
const MAX_RIVALS_PER_ZONE = 4;
const EXCLUDE_RADIUS_KM = 0.6;
const UI_LABELS = ["Exclude this area", "Download brief", "Find spots", "Basic mode"];

export type AnalysisState = ChatState;

export class Analysis {
  readonly registry = new EntityRegistry();
  readonly trace: TraceStep[] = [];
  changed = false;
  fresh = false;
  private demo: boolean;
  private current: ScoutResult | undefined;
  private readonly profiles = new Map<string, ZoneProfile>();

  constructor(
    private readonly qloo: QlooClient | undefined,
    state: AnalysisState | undefined,
    private readonly logger: Pick<Console, "warn"> = console,
  ) {
    this.demo = state?.demo ?? false;
    if (state) this.current = fromState(state);
    for (const zone of this.current?.zones ?? []) {
      if (zone.profile) this.profiles.set(zone.id, zone.profile);
    }
    this.registerAll();
  }

  get result(): ScoutResult | undefined {
    return this.current;
  }

  readonly call: Call = async (endpoint: QlooEndpoint, params: QlooParams, label: string) => {
    if (!this.qloo) throw new Error("This analysis cannot call Qloo");
    const result = await this.qloo.get(endpoint, params, label);
    this.trace.push(result.trace);
    if (result.source === "recorded" || result.source === "synthetic") this.demo = true;
    return result;
  };

  adopt(result: ScoutResult): void {
    this.current = { ...result, trace: [] };
    this.trace.push(...result.trace);
    if (result.demo) this.demo = true;
    for (const zone of result.zones) if (zone.profile) this.profiles.set(zone.id, zone.profile);
    this.changed = true;
    this.fresh = true;
    this.registerAll();
  }

  output(): ScoutResult | undefined {
    if (!this.current) return undefined;
    return { ...this.current, trace: [...this.trace], demo: this.demo || this.current.demo };
  }

  async rescore(update: Partial<ScoringParams>): Promise<ScoutResult> {
    const result = this.require();
    const params: ScoringParams = { ...result.params, ...update };
    const { cells, zones } = rescore(result.cells, result.competitors, params, {
      cityName: result.city.name,
    });
    this.current = { ...result, params, cells, zones };
    this.changed = true;
    await this.ensureProfiles();
    return this.require();
  }

  async ensureProfiles(): Promise<void> {
    const result = this.require();
    const missing = result.zones.filter((zone) => !this.profiles.has(zone.id));
    if (missing.length > 0) {
      const loaded = await profileZones(
        missing,
        result.anchors.map((anchor) => anchor.id).join(","),
        new Set(result.categoryTags.map((tag) => tag.id)),
        this.call,
        (zone, error) => this.logger.warn(`Zone ${zone.rank ?? zone.id} profile failed`, error),
      );
      for (const [id, profile] of Object.entries(loaded)) this.profiles.set(id, profile);
    }
    this.current = {
      ...result,
      zones: result.zones.map((zone) => {
        const profile = this.profiles.get(zone.id);
        return profile ? { ...zone, profile } : zone;
      }),
    };
    this.registerAll();
  }

  setBrief(zoneId: string, brief: string): void {
    const result = this.require();
    const profile = this.profiles.get(zoneId) ?? { tastePlaces: [] };
    const withBrief = { ...profile, brief };
    this.profiles.set(zoneId, withBrief);
    this.current = {
      ...result,
      zones: result.zones.map((zone) =>
        zone.id === zoneId ? { ...zone, profile: withBrief } : zone,
      ),
    };
    this.changed = true;
  }

  require(): ScoutResult {
    if (!this.current) throw new NoAnalysisError();
    return this.current;
  }

  zone(rank: number): Zone | undefined {
    return this.current?.zones.find((zone) => zone.rank === rank);
  }

  allowedNames(): string[] {
    const result = this.current;
    const names = [...UI_LABELS];
    if (!result) return names;
    names.push(result.city.name, result.city.name.split(",")[0] ?? "");
    if (result.city.resolvedLocality) names.push(result.city.resolvedLocality.name);
    for (const zone of result.zones)
      if (zone.profile?.neighborhood) names.push(zone.profile.neighborhood);
    for (const place of this.places()) if (place.neighborhood) names.push(place.neighborhood);
    for (const tag of result.categoryTags) names.push(tag.name);
    return names;
  }

  places(): PlaceRef[] {
    const result = this.current;
    if (!result) return [];
    return [
      ...result.competitors,
      ...result.zones.flatMap((zone) => zone.profile?.tastePlaces ?? []),
    ];
  }

  rivalsNear(zone: Zone): PlaceRef[] {
    const result = this.require();
    return result.competitors
      .map((place) => ({ place, distance: distanceMeters([place.lon, place.lat], zone.centroid) }))
      .filter(
        ({ place, distance }) =>
          distance <= NEARBY_RIVALS_M || insidePolygon([place.lon, place.lat], zone.polygon),
      )
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MAX_RIVALS_PER_ZONE)
      .map(({ place }) => place);
  }

  areaPolygon(name: string): { polygon: Polygon; label: string } | undefined {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return undefined;
    const result = this.require();
    const matches = (value: string | undefined) => {
      const lower = value?.toLowerCase();
      return (
        lower !== undefined &&
        (lower === wanted || lower.includes(wanted) || wanted.includes(lower))
      );
    };
    const points: LonLat[] = this.places()
      .filter((place) => matches(place.neighborhood))
      .map((place) => [place.lon, place.lat]);
    let label = this.places().find((place) => matches(place.neighborhood))?.neighborhood;
    for (const zone of result.zones) {
      if (!matches(zone.profile?.neighborhood)) continue;
      label ??= zone.profile?.neighborhood;
      for (const corner of zone.polygon.coordinates[0] ?? []) {
        const [lon, lat] = corner;
        if (lon !== undefined && lat !== undefined) points.push([lon, lat]);
      }
    }
    if (points.length === 0 || !label) return undefined;
    const corners = points.flatMap((at) =>
      (circle(at, EXCLUDE_RADIUS_KM, { steps: 12 }).geometry.coordinates[0] ?? []).map((corner) =>
        point(corner),
      ),
    );
    const hull = convex(featureCollection(corners));
    return hull ? { polygon: hull.geometry, label } : undefined;
  }

  context(): string {
    const result = this.current;
    if (!result)
      return "No analysis has been run yet. Use run_scout when the user describes a concept and a city.";
    const anchors = result.anchors
      .map(
        (anchor) =>
          `${this.registry.ref("anchor", anchor.id, anchor.name)} = ${anchor.name} (${anchor.type.replace("urn:entity:", "")}${anchor.localCompetitor ? ", local competitor" : ""})`,
      )
      .join("; ");
    const lines = [
      `City: ${result.city.name}`,
      `Concept: ${result.concept || "(not given)"}`,
      `Anchors: ${anchors}`,
      `Competitor category: ${result.categoryTags.map((tag) => tag.name).join(", ") || "none"}; ${result.competitors.length} similar venues in the city`,
      `Scoring: competition weight ${result.params.competitionWeight.toFixed(2)} (0 ignores rivals, 1 avoids them strongly), minimum taste match ${result.params.minAffinity.toFixed(2)}, ${result.params.excludePolygons.length} excluded areas`,
    ];
    if (result.audience) lines.push(`Audience: ${describeAudience(result.audience)}`);
    lines.push(
      result.zones.length === 0
        ? "Zones: none match the current settings."
        : `Zones:\n${result.zones.map((zone) => this.zoneFacts(zone)).join("\n")}`,
    );
    return lines.join("\n");
  }

  zoneFacts(zone: Zone, detailed = false): string {
    const profile = zone.profile ?? this.profiles.get(zone.id);
    const lines = [
      `Zone ${zone.rank}${profile?.neighborhood ? ` (${profile.neighborhood})` : ""}: score ${zone.score.toFixed(2)}, ${zone.cellCount} map cells, ${zone.competitorsInside} similar venues inside, ${zone.competitorsNearby} inside or within 1 km of its edge. ${zone.reasons.join(". ")}.`,
    ];
    const places = profile?.tastePlaces ?? [];
    if (places.length > 0) {
      lines.push(
        `  Places this audience likes here: ${places
          .slice(0, detailed ? 5 : 3)
          .map((place) => this.describePlace(place, "place", detailed))
          .join("; ")}`,
      );
    }
    if (detailed) {
      const rivals = this.rivalsNear(zone);
      lines.push(
        rivals.length === 0
          ? "  No similar venues within 1.5 km of the zone center."
          : `  Closest similar venues: ${rivals.map((place) => `${this.describePlace(place, "competitor", false)}, ${(distanceMeters([place.lon, place.lat], zone.centroid) / 1000).toFixed(1)} km from the zone center`).join("; ")}`,
      );
      if (profile?.brief) lines.push(`  Brief already shown: ${profile.brief}`);
    }
    return lines.join("\n");
  }

  zoneLine(zone: Zone): string {
    const share = Math.max(1, Math.round((1 - zone.meanAffinity) * 100));
    const places = (zone.profile?.tastePlaces ?? [])
      .slice(0, 2)
      .map((place) => this.registry.ref("place", place.id, place.name));
    const parts = [
      `Zone ${zone.rank}${zone.profile?.neighborhood ? ` (${zone.profile.neighborhood})` : ""}: score ${zone.score.toFixed(2)}`,
      `taste match in the top ${share}%`,
      `${zone.competitorsInside} similar venues inside, ${zone.competitorsNearby} inside or within 1 km`,
    ];
    if (places.length > 0) parts.push(`locals like ${places.join(" and ")}`);
    return `${parts.join(", ")}.`;
  }

  describePlace(place: PlaceRef, kind: "place" | "competitor", withDrivers: boolean): string {
    const parts = [this.registry.ref(kind, place.id, place.name)];
    const details: string[] = [];
    if (place.neighborhood) details.push(place.neighborhood);
    if (place.affinity !== undefined)
      details.push(`taste match ${Math.round(place.affinity * 100)}%`);
    if (withDrivers && place.drivers && place.drivers.length > 0) {
      details.push(`driven by ${this.describeDrivers(place.drivers)}`);
    }
    if (details.length > 0) parts.push(`(${details.join(", ")})`);
    return parts.join(" ");
  }

  describeDrivers(drivers: readonly { anchorId: string; score: number }[]): string {
    const anchors = new Map(this.current?.anchors.map((anchor) => [anchor.id, anchor]) ?? []);
    return drivers
      .slice(0, 3)
      .flatMap((driver) => {
        const anchor = anchors.get(driver.anchorId);
        return anchor
          ? [`${this.registry.ref("anchor", anchor.id, anchor.name)} ${driver.score.toFixed(2)}`]
          : [];
      })
      .join(", ");
  }

  summary(): string {
    const result = this.current;
    if (!result) return "Describe your concept and pick a city, then press Find spots.";
    if (result.zones.length === 0) {
      return `No zones in ${result.city.name} pass the current settings. Try caring less about competition or removing an exclusion.`;
    }
    const zones = result.zones.map((zone) => {
      const share = Math.max(1, Math.round((1 - zone.meanAffinity) * 100));
      const rivals =
        zone.competitorsNearby === 0
          ? "no similar venues"
          : `${zone.competitorsNearby} similar ${zone.competitorsNearby === 1 ? "venue" : "venues"}`;
      return `${zone.rank}. ${zone.profile?.neighborhood ?? `Zone ${zone.rank}`}: taste match in the top ${share}%, ${rivals} inside or within 1 km.`;
    });
    return [
      `Top zones in ${result.city.name}:`,
      ...zones,
      "Taste match is a first filter: check rent, foot traffic and visit in person.",
    ].join("\n");
  }

  private registerAll(): void {
    const result = this.current;
    if (!result) return;
    for (const anchor of result.anchors) this.registry.add("anchor", anchor.id, anchor.name);
    for (const zone of result.zones) {
      for (const place of zone.profile?.tastePlaces ?? [])
        this.registry.add("place", place.id, place.name);
    }
  }
}

export class NoAnalysisError extends Error {
  override readonly name = "NoAnalysisError";
  constructor() {
    super("There is no analysis yet. Run one first.");
  }
}

function fromState(state: AnalysisState): ScoutResult {
  const city = findCity(state.cityId);
  if (!city) throw new Error(`Unknown city: ${state.cityId}`);
  const heat: HeatCell[] = state.cells.map(([geohash, affinity, popularity]) =>
    popularity === undefined ? { geohash, affinity } : { geohash, affinity, popularity },
  );
  const { cells, zones } = rescore(heat, state.competitors, state.params, { cityName: city.name });
  const profiles = new Map(
    state.zones.flatMap((zone) => (zone.profile ? [[zone.id, zone.profile] as const] : [])),
  );
  const result: ScoutResult = {
    concept: state.concept,
    city: { ...city },
    anchors: state.anchors,
    categoryTags: state.categoryTags,
    affinityMode: "percentile",
    cells,
    competitors: state.competitors,
    zones: zones.map((zone) => {
      const profile = profiles.get(zone.id);
      return profile ? { ...zone, profile } : zone;
    }),
    params: state.params,
    trace: [],
    demo: state.demo,
  };
  if (state.audience) result.audience = state.audience;
  return result;
}
