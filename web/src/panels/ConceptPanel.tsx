import { CITIES, type Anchor, type TraceStep } from "@whitespace/shared";

export type RunStatus =
  { kind: "idle" } | { kind: "running" } | { kind: "done" } | { kind: "error"; message: string };

export interface ConceptPanelProps {
  badge: React.ReactNode;
  concept: string;
  cityId: string;
  anchors: readonly Anchor[] | undefined;
  status: RunStatus;
  liveSteps: readonly TraceStep[];
  onConceptChange: (concept: string) => void;
  onCityChange: (cityId: string) => void;
  onRun: () => void;
}

export function ConceptPanel({
  badge,
  concept,
  cityId,
  anchors,
  status,
  liveSteps,
  onConceptChange,
  onCityChange,
  onRun,
}: ConceptPanelProps): React.JSX.Element {
  const running = status.kind === "running";
  const lastStep = liveSteps.at(-1);
  return (
    <section className="panel panel-left" aria-label="Concept">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <h1>Whitespace</h1>
        {badge}
      </header>
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

      <button type="button" className="primary" onClick={onRun} disabled={running || !anchors}>
        {running ? "Analysing…" : "Find spots"}
      </button>

      {!anchors && (
        <p className="muted small">
          A ready scenario for this city arrives with live Qloo data. Try Austin for now.
        </p>
      )}

      {anchors && (
        <div className="anchors">
          <span className="field-label">Taste anchors</span>
          <ul className="chips">
            {anchors.map((anchor) => (
              <li key={anchor.id} className="chip">
                {anchor.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="status small" role="status" aria-live="polite">
        {running &&
          (lastStep
            ? `Asking Qloo · ${liveSteps.length} ${liveSteps.length === 1 ? "call" : "calls"} · ${lastStep.label}`
            : "Asking Qloo…")}
        {status.kind === "error" && <span className="error">{status.message}</span>}
      </p>
    </section>
  );
}
