import type { TraceStep } from "@whitespace/shared";

const MAX_VALUE_LENGTH = 72;

function shorten(value: string): string {
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
}

export function TracePanel({ steps }: { steps: readonly TraceStep[] }): React.JSX.Element | null {
  if (steps.length === 0) return null;
  return (
    <details className="trace">
      <summary>
        How Whitespace used Qloo · {steps.length} {steps.length === 1 ? "call" : "calls"}
      </summary>
      <ol className="trace-list">
        {steps.map((step) => (
          <li key={step.id}>
            <div className="trace-head">
              <strong>{step.label}</strong>
              <span className="muted">
                {step.resultCount} results · {step.ms} ms{step.cached ? " · cached" : ""}
              </span>
            </div>
            <code className="trace-endpoint">GET {step.endpoint}</code>
            <dl className="trace-params">
              {Object.entries(step.params).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd title={value}>{shorten(value)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
    </details>
  );
}
