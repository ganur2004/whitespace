import { CITIES, type Anchor, type TraceStep } from "@whitespace/shared";

export type RunStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; ms: number }
  | { kind: "error"; message: string };

export interface ConceptPanelProps {
  badge: React.ReactNode;
  concept: string;
  cityId: string;
  anchors: readonly Anchor[] | undefined;
  status: RunStatus;
  liveSteps: readonly TraceStep[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onConceptChange: (concept: string) => void;
  onCityChange: (cityId: string) => void;
  onRun: () => void;
  chat: React.ReactNode;
}

const UNITS: Record<string, [string, string]> = {
  "urn:heatmap": ["map cell", "map cells"],
  "urn:entity:place": ["place", "places"],
};

function stepCount(step: TraceStep): string {
  const [one, many] = UNITS[step.params["filter.type"] ?? ""] ?? ["result", "results"];
  return `${step.resultCount.toLocaleString("en-US")} ${step.resultCount === 1 ? one : many}`;
}

function Progress({ steps, running }: { steps: readonly TraceStep[]; running: boolean }) {
  return (
    <ol className="progress" aria-label="Analysis progress">
      {steps.map((step) => (
        <li key={step.id} className="progress-done">
          <span className="progress-label">{step.label}</span>
          <span className="muted">{stepCount(step)}</span>
        </li>
      ))}
      {running && (
        <li className="progress-pending">
          <span className="progress-label">{steps.length === 0 ? "Asking Qloo" : "Working"}</span>
        </li>
      )}
    </ol>
  );
}

export function ConceptPanel({
  badge,
  concept,
  cityId,
  anchors,
  status,
  liveSteps,
  collapsed,
  onToggleCollapsed,
  onConceptChange,
  onCityChange,
  onRun,
  chat,
}: ConceptPanelProps): React.JSX.Element {
  const running = status.kind === "running";
  const city = CITIES.find((option) => option.id === cityId);
  return (
    <section className={`panel panel-left${collapsed ? " is-collapsed" : ""}`} aria-label="Concept">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <h1>Whitespace</h1>
        {badge}
        <button
          type="button"
          className="collapse-toggle link-button"
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? "Edit" : "Hide"}
        </button>
      </header>
      {collapsed && city && <p className="collapsed-summary small muted">{city.name}</p>}

      <p className="tagline">Where your audience already is, and your competitors are not.</p>

      <label className="field">
        <span>Concept</span>
        <textarea
          rows={3}
          value={concept}
          onChange={(event) => onConceptChange(event.target.value)}
        />
      </label>

      <label className="field">
        <span>City</span>
        <select value={cityId} onChange={(event) => onCityChange(event.target.value)}>
          {CITIES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="primary"
        onClick={onRun}
        disabled={running || !concept.trim()}
      >
        {running ? "Analysing…" : "Find spots"}
      </button>

      {anchors && anchors.length > 0 && (
        <div className="anchors">
          <span className="field-label">Taste anchors</span>
          <ul className="chips">
            {anchors.map((anchor) => (
              <li
                key={anchor.id}
                className="chip"
                title={anchor.localCompetitor ? "A similar venue in this city" : undefined}
              >
                {anchor.name}
                {anchor.localCompetitor && <span className="muted"> · local</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="status small" role="status" aria-live="polite">
        {(running || liveSteps.length > 0) && status.kind !== "error" && (
          <Progress steps={liveSteps} running={running} />
        )}
        {status.kind === "done" && (
          <p className="muted">
            Done in {(status.ms / 1000).toFixed(1)} s · {liveSteps.length} Qloo{" "}
            {liveSteps.length === 1 ? "call" : "calls"}
          </p>
        )}
        {status.kind === "error" && <p className="error">{status.message}</p>}
      </div>

      {chat}
    </section>
  );
}
