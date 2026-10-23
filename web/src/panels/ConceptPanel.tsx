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
  canCollapse: boolean;
  compact: boolean;
  hasConversation: boolean;
  onCompactChange: (compact: boolean) => void;
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
  canCollapse,
  compact,
  hasConversation,
  onCompactChange,
  onToggleCollapsed,
  onConceptChange,
  onCityChange,
  onRun,
  chat,
}: ConceptPanelProps): React.JSX.Element {
  const running = status.kind === "running";
  const city = CITIES.find((option) => option.id === cityId);
  return (
    <section
      className={`panel panel-left${collapsed ? " is-collapsed" : ""}${canCollapse ? " can-collapse" : ""}${hasConversation && !compact ? " is-editing" : ""}`}
      aria-label="Concept"
    >
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
          {collapsed ? "Edit or ask" : "Hide"}
        </button>
      </header>
      {collapsed && city && (
        <p className="collapsed-summary small muted">
          {city.name}
          {concept.trim() ? ` · ${concept.trim()}` : ""}
        </p>
      )}

      {compact && city && (
        <div className="concept-compact">
          <p className="concept-compact-text small">
            <strong>{city.name}</strong>
            {concept.trim() ? ` · ${concept.trim()}` : ""}
          </p>
          <button type="button" className="link-button" onClick={() => onCompactChange(false)}>
            Edit concept
          </button>
        </div>
      )}

      <div className="concept-body" hidden={compact}>
        {hasConversation && (
          <button
            type="button"
            className="link-button concept-hide"
            onClick={() => onCompactChange(true)}
          >
            Done editing
          </button>
        )}
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
          {running && <Progress steps={liveSteps} running />}
          {status.kind === "done" && (
            <details className="progress-done-summary">
              <summary>
                Done in {(status.ms / 1000).toFixed(1)} s · {liveSteps.length} Qloo{" "}
                {liveSteps.length === 1 ? "call" : "calls"}
              </summary>
              <Progress steps={liveSteps} running={false} />
            </details>
          )}
          {status.kind === "error" && <p className="error">{status.message}</p>}
        </div>
      </div>

      {chat}
    </section>
  );
}
