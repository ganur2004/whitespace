import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Polygon } from "geojson";
import {
  DEFAULT_CITY,
  DEFAULT_CITY_ID,
  DEFAULT_SCORING_PARAMS,
  findCity,
  rescore,
  scenarioFor,
  type HealthStatus,
  type ScoutResult,
  type TraceStep,
  type Zone,
} from "@whitespace/shared";
import { streamScout } from "./api/scout.js";
import { polygonsBBox } from "./map/bounds.js";
import type { LayerMode } from "./map/layers.js";
import { MapView, type MapFocus } from "./map/MapView.js";
import { ConceptPanel, type RunStatus } from "./panels/ConceptPanel.js";
import { MapControls } from "./panels/MapControls.js";
import { TracePanel } from "./panels/TracePanel.js";
import { ZoneCards } from "./panels/ZoneCards.js";
import { useZoneProfiles } from "./useZoneProfiles.js";

type ApiState = { kind: "loading" } | { kind: "ready"; health: HealthStatus } | { kind: "down" };

function useHealth(): ApiState {
  const [state, setState] = useState<ApiState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/health", { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<HealthStatus>) : null))
      .then((health) => setState(health ? { kind: "ready", health } : { kind: "down" }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.warn("API health check failed", error);
          setState({ kind: "down" });
        }
      });
    return () => controller.abort();
  }, []);
  return state;
}

function DataBadge({ api }: { api: ApiState }): React.JSX.Element | null {
  if (api.kind === "loading") return null;
  if (api.kind === "down") return <span className="badge badge-warn">API offline</span>;
  if (api.health.demo) return <span className="badge badge-demo">Demo data</span>;
  if (!api.health.qlooKey) return <span className="badge badge-warn">No Qloo key</span>;
  return <span className="badge badge-live">Live Qloo data</span>;
}

export function App(): React.JSX.Element {
  const api = useHealth();
  const [cityId, setCityId] = useState(DEFAULT_CITY_ID);
  const [concept, setConcept] = useState(scenarioFor(DEFAULT_CITY_ID)?.concept ?? "");
  const [result, setResult] = useState<ScoutResult | null>(null);
  const [status, setStatus] = useState<RunStatus>({ kind: "idle" });
  const [liveSteps, setLiveSteps] = useState<TraceStep[]>([]);
  const [mode, setMode] = useState<LayerMode>("opportunity");
  const [competitionWeight, setCompetitionWeight] = useState(
    DEFAULT_SCORING_PARAMS.competitionWeight,
  );
  const [excluded, setExcluded] = useState<Polygon[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string>();
  const [hoveredZoneId, setHoveredZoneId] = useState<string>();
  const [conceptCollapsed, setConceptCollapsed] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [focus, setFocus] = useState<MapFocus>({ key: "start", bbox: DEFAULT_CITY.bbox });
  const running = useRef<AbortController | null>(null);

  const city = findCity(cityId) ?? DEFAULT_CITY;
  const scenario = scenarioFor(cityId);

  const view = useMemo(
    () =>
      result
        ? rescore(
            result.cells,
            result.competitors,
            { ...result.params, competitionWeight, excludePolygons: excluded },
            { cityName: result.city.name },
          )
        : null,
    [result, competitionWeight, excluded],
  );

  const { profiles, loading: profilesLoading } = useZoneProfiles(
    result,
    view?.zones,
    status.kind === "done",
  );
  const zones = useMemo(
    () =>
      (view?.zones ?? []).map((zone) => {
        const profile = profiles[zone.id];
        return profile ? { ...zone, profile } : zone;
      }),
    [view, profiles],
  );
  const anchorNames = useMemo(
    () => Object.fromEntries((result?.anchors ?? []).map((anchor) => [anchor.id, anchor.name])),
    [result],
  );
  const highlightedZone = zones.find((zone) => zone.id === (hoveredZoneId ?? selectedZoneId));

  const changeCity = (nextId: string) => {
    const next = findCity(nextId);
    if (!next) return;
    running.current?.abort();
    setCityId(nextId);
    setConcept((current) => scenarioFor(nextId)?.concept ?? current);
    setResult(null);
    setStatus({ kind: "idle" });
    setLiveSteps([]);
    setExcluded([]);
    setSelectedZoneId(undefined);
    setConceptCollapsed(false);
    setFocus({ key: `city-${nextId}`, bbox: next.bbox });
  };

  const run = async () => {
    if (!scenario) return;
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setStatus({ kind: "running" });
    setLiveSteps([]);
    setExcluded([]);
    setSelectedZoneId(undefined);
    setSheetExpanded(false);
    const started = performance.now();
    let focused = false;
    try {
      const next = await streamScout(
        { concept, cityId, anchors: scenario.anchors, categoryTags: scenario.categoryTags },
        (event) => {
          if (event.type === "step") setLiveSteps((steps) => [...steps, event.step]);
          if (event.type !== "result") return;
          setResult(event.result);
          if (focused) return;
          focused = true;
          setConceptCollapsed(true);
          setFocus({
            key: `result-${Date.now()}`,
            bbox:
              polygonsBBox(event.result.zones.map((zone) => zone.polygon)) ??
              event.result.city.bbox,
          });
        },
        controller.signal,
      );
      setResult(next);
      setStatus({ kind: "done", ms: performance.now() - started });
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "The analysis failed.",
      });
    }
  };

  const selectZone = useCallback(
    (zoneId: string) => {
      const zone = zones.find((candidate) => candidate.id === zoneId);
      if (!zone) return;
      setSelectedZoneId(zoneId);
      setSheetExpanded(false);
      const bbox = polygonsBBox([zone.polygon]);
      if (bbox) setFocus({ key: `zone-${zoneId}-${Date.now()}`, bbox });
    },
    [zones],
  );

  const excludeZone = (zone: Zone) => {
    setExcluded((current) => [...current, zone.polygon]);
    setSelectedZoneId(undefined);
    setHoveredZoneId(undefined);
  };

  return (
    <div className={`app${view && result ? " has-sheet" : ""}`}>
      <MapView
        focus={focus}
        cells={view?.cells ?? []}
        competitors={result?.competitors ?? []}
        zones={zones}
        tastePlaces={highlightedZone?.profile?.tastePlaces ?? []}
        anchorNames={anchorNames}
        excluded={excluded}
        mode={mode}
        selectedZoneId={selectedZoneId}
        hoveredZoneId={hoveredZoneId}
        onSelectZone={selectZone}
      />

      <ConceptPanel
        badge={<DataBadge api={api} />}
        concept={concept}
        cityId={city.id}
        anchors={scenario?.anchors}
        status={status}
        liveSteps={liveSteps}
        collapsed={conceptCollapsed}
        onToggleCollapsed={() => setConceptCollapsed((current) => !current)}
        onConceptChange={setConcept}
        onCityChange={changeCity}
        onRun={() => void run()}
      />

      {view && result && (
        <>
          <section
            className={`panel panel-right${sheetExpanded ? " is-expanded" : ""}`}
            aria-label="Zones"
          >
            <button
              type="button"
              className="sheet-handle"
              aria-expanded={sheetExpanded}
              onClick={() => setSheetExpanded((current) => !current)}
            >
              <span className="sheet-grip" aria-hidden="true" />
              {sheetExpanded ? "Show map" : "Show all zones"}
            </button>
            <header className="zones-header">
              <h2>Top zones in {result.city.name}</h2>
              <p className="muted small">
                {view.zones.length} {view.zones.length === 1 ? "zone" : "zones"} ·{" "}
                {result.competitors.length} similar venues ·{" "}
                {result.cells.length.toLocaleString("en-US")} map cells
              </p>
            </header>
            {result.demo && (
              <p className="notice small">
                Demo data: recorded or synthetic responses, not a live Qloo call.
              </p>
            )}
            <MapControls
              variant="sheet"
              mode={mode}
              competitionWeight={competitionWeight}
              onModeChange={setMode}
              onCompetitionWeightChange={setCompetitionWeight}
            />
            {result.cells.length === 0 ? (
              <p className="muted">
                Qloo returned no taste data for {result.city.name}.
                {result.demo ? " In demo mode only Austin has data." : " Try another city."}
              </p>
            ) : (
              <ZoneCards
                zones={zones}
                anchorNames={anchorNames}
                profilesLoading={profilesLoading}
                selectedZoneId={selectedZoneId}
                excludedCount={excluded.length}
                onSelect={selectZone}
                onHover={setHoveredZoneId}
                onExclude={excludeZone}
                onResetExclusions={() => setExcluded([])}
              />
            )}
            <p className="muted small">
              Taste match is a first filter, not a full site analysis. Check rent, foot traffic and
              visit in person.
            </p>
            <TracePanel steps={result.trace} />
          </section>

          <MapControls
            variant="floating"
            mode={mode}
            competitionWeight={competitionWeight}
            onModeChange={setMode}
            onCompetitionWeightChange={setCompetitionWeight}
          />
        </>
      )}
    </div>
  );
}
