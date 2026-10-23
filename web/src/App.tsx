import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Polygon } from "geojson";
import {
  DEFAULT_CITY,
  DEFAULT_CITY_ID,
  DEFAULT_SCORING_PARAMS,
  findCity,
  rescore,
  scenarioFor,
  type Anchor,
  type ChatReply,
  type HealthStatus,
  type ScoutResult,
  type TraceStep,
  type Zone,
} from "@whitespace/shared";
import { chatState, sendChat } from "./api/chat.js";
import { streamScout, type ScoutRequestBody } from "./api/scout.js";
import { ChatPanel, type ChatEntry } from "./chat/ChatPanel.js";
import { briefFileName, buildBrief, downloadText } from "./brief.js";
import type { MapCapture } from "./map/capture.js";
import { polygonsBBox } from "./map/bounds.js";
import type { LayerMode } from "./map/layers.js";
import { MapView, type MapFocus } from "./map/MapView.js";
import { AudiencePanel } from "./panels/AudiencePanel.js";
import { ConceptPanel, type RunStatus } from "./panels/ConceptPanel.js";
import { MapControls, worryLabel } from "./panels/MapControls.js";
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
  const mapCapture = useRef<MapCapture | null>(null);
  const [exporting, setExporting] = useState(false);
  const [liveAnchors, setLiveAnchors] = useState<Anchor[]>();
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState<string>();
  const chatSerial = useRef(0);
  const chatRequest = useRef<AbortController | null>(null);
  const [conceptFormOpen, setConceptFormOpen] = useState(false);

  const city = findCity(cityId) ?? DEFAULT_CITY;
  const scenario = scenarioFor(cityId);
  const usesScenario = scenario !== undefined && concept.trim() === scenario.concept.trim();

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
    chatRequest.current?.abort();
    setCityId(nextId);
    setConcept((current) => scenarioFor(nextId)?.concept ?? current);
    setResult(null);
    setStatus({ kind: "idle" });
    setLiveSteps([]);
    setLiveAnchors(undefined);
    setChatEntries([]);
    setChatError(undefined);
    setExcluded([]);
    setSelectedZoneId(undefined);
    setConceptCollapsed(false);
    setFocus({ key: `city-${nextId}`, bbox: next.bbox });
  };

  const run = async () => {
    if (!concept.trim()) return;
    running.current?.abort();
    chatRequest.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setStatus({ kind: "running" });
    setLiveSteps([]);
    setExcluded([]);
    setSelectedZoneId(undefined);
    setSheetExpanded(false);
    setLiveAnchors(undefined);
    setChatEntries([]);
    setChatError(undefined);
    setConceptFormOpen(false);
    const started = performance.now();
    let focused = false;
    const body: ScoutRequestBody =
      usesScenario && scenario
        ? { concept, cityId, anchors: scenario.anchors, categoryTags: scenario.categoryTags }
        : { concept, cityId };
    try {
      const next = await streamScout(
        body,
        (event) => {
          if (event.type === "step") setLiveSteps((steps) => [...steps, event.step]);
          if (event.type === "anchors") setLiveAnchors(event.anchors);
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

  const applyChatReply = (reply: ChatReply, started: number) => {
    const next = reply.result;
    if (next) {
      running.current?.abort();
      setResult((current) =>
        reply.fresh || !current ? next : { ...next, trace: [...current.trace, ...next.trace] },
      );
      setCompetitionWeight(next.params.competitionWeight);
      setExcluded(next.params.excludePolygons);
      if (reply.fresh) {
        setCityId(next.city.id);
        setConcept(next.concept);
        setLiveSteps(next.trace);
        setLiveAnchors(undefined);
        setStatus({ kind: "done", ms: performance.now() - started });
      }
    }
    const candidates = next?.zones ?? zones;
    const focusAction = [...reply.actions].reverse().find((action) => action.type === "focusZone");
    const zone = focusAction && candidates.find((candidate) => candidate.id === focusAction.zoneId);
    const bbox = zone
      ? polygonsBBox([zone.polygon])
      : next
        ? polygonsBBox(next.zones.map((candidate) => candidate.polygon))
        : undefined;
    setSelectedZoneId(zone?.id);
    if (bbox) setFocus({ key: `chat-${Date.now()}`, bbox });
  };

  const toggleConcept = () => {
    const collapsing = !conceptCollapsed;
    setConceptCollapsed(collapsing);
    if (!collapsing || zones.length === 0) return;
    const selected = zones.find((zone) => zone.id === selectedZoneId);
    const bbox = polygonsBBox((selected ? [selected] : zones).map((zone) => zone.polygon));
    if (bbox) setFocus({ key: `collapse-${Date.now()}`, bbox });
  };

  const sendMessage = async (text: string) => {
    chatRequest.current?.abort();
    const controller = new AbortController();
    chatRequest.current = controller;
    chatSerial.current += 1;
    const question: ChatEntry = { id: chatSerial.current, role: "user", text };
    const history = [...chatEntries, question];
    setChatEntries(history);
    setChatPending(true);
    setChatError(undefined);
    const started = performance.now();
    try {
      const reply = await sendChat(
        history.map(({ role, text: message }) => ({ role, text: message })),
        result && status.kind !== "running"
          ? chatState(result, competitionWeight, excluded, zones)
          : undefined,
        controller.signal,
      );
      chatSerial.current += 1;
      const answer: ChatEntry = {
        id: chatSerial.current,
        role: "assistant",
        text: reply.reply,
        basic: reply.mode === "basic",
      };
      setChatEntries((current) => [...current, answer]);
      applyChatReply(reply, started);
    } catch (error) {
      if (controller.signal.aborted) return;
      setChatError(error instanceof Error ? error.message : "The assistant failed.");
    } finally {
      if (chatRequest.current === controller) {
        chatRequest.current = null;
        setChatPending(false);
      }
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

  const downloadBrief = async () => {
    if (!result) return;
    setExporting(true);
    try {
      const mapImage = await mapCapture.current?.capture();
      const now = new Date();
      downloadText(
        briefFileName(result, now),
        buildBrief({
          result,
          zones,
          competitionWeight,
          competitionLabel: worryLabel(competitionWeight),
          excludedCount: excluded.length,
          mapImage,
          now,
        }),
      );
    } finally {
      setExporting(false);
    }
  };

  const excludeZone = (zone: Zone) => {
    setExcluded((current) => [...current, zone.polygon]);
    setSelectedZoneId(undefined);
    setHoveredZoneId(undefined);
  };

  return (
    <div
      className={`app${view && result ? " has-sheet" : ""}${conceptCollapsed ? "" : " concept-open"}`}
    >
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
        captureRef={mapCapture}
        conceptOpen={!conceptCollapsed}
      />

      <ConceptPanel
        badge={<DataBadge api={api} />}
        concept={concept}
        cityId={city.id}
        anchors={
          status.kind === "running"
            ? liveAnchors
            : (result?.anchors ?? (usesScenario ? scenario?.anchors : undefined))
        }
        status={status}
        liveSteps={liveSteps}
        collapsed={conceptCollapsed}
        canCollapse={result !== null}
        compact={chatEntries.length > 0 && !conceptFormOpen}
        hasConversation={chatEntries.length > 0}
        onCompactChange={(compact) => setConceptFormOpen(!compact)}
        onToggleCollapsed={toggleConcept}
        onConceptChange={setConcept}
        onCityChange={changeCity}
        onRun={() => void run()}
        chat={
          <ChatPanel
            entries={chatEntries}
            pending={chatPending}
            error={chatError}
            agent={api.kind === "ready" && api.health.llm}
            hasResult={result !== null && status.kind !== "running"}
            disabled={status.kind === "running"}
            onSend={(text) => void sendMessage(text)}
          />
        }
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
              <div className="zones-title">
                <h2>Top zones in {result.city.name}</h2>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void downloadBrief()}
                  disabled={exporting || status.kind === "running"}
                >
                  {exporting ? "Preparing…" : "Download brief"}
                </button>
              </div>
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
            {result.audience && (
              <AudiencePanel audience={result.audience} anchorNames={anchorNames} />
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
