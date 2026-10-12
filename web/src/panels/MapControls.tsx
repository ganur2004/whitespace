import { AUDIENCE_RAMP, OPPORTUNITY_RAMP, type LayerMode } from "../map/layers.js";

export interface MapControlsProps {
  mode: LayerMode;
  competitionWeight: number;
  variant: "floating" | "sheet";
  onModeChange: (mode: LayerMode) => void;
  onCompetitionWeightChange: (value: number) => void;
}

const LEGEND: Record<
  LayerMode,
  { label: string; low: string; high: string; ramp: [number, string][] }
> = {
  audience: { label: "Taste match", low: "Lower", high: "Top of city", ramp: AUDIENCE_RAMP },
  opportunity: { label: "Opportunity", low: "Some", high: "Best", ramp: OPPORTUNITY_RAMP },
};

const gradient = (ramp: [number, string][]): string =>
  `linear-gradient(to right, ${ramp.map(([, color]) => color).join(", ")})`;

export function worryLabel(weight: number): string {
  if (weight === 0) return "Not at all";
  if (weight <= 0.3) return "A little";
  if (weight <= 0.7) return "Moderately";
  return "A lot";
}

export function MapControls({
  mode,
  competitionWeight,
  variant,
  onModeChange,
  onCompetitionWeightChange,
}: MapControlsProps): React.JSX.Element {
  const legend = LEGEND[mode];
  return (
    <section className={`map-controls map-controls-${variant}`} aria-label="Map controls">
      <div className="segmented" role="group" aria-label="Map layer">
        {(["audience", "opportunity"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            className={mode === option ? "is-active" : ""}
            onClick={() => onModeChange(option)}
          >
            {option === "audience" ? "Audience" : "Opportunity"}
          </button>
        ))}
      </div>

      <label className="slider">
        <span className="slider-head">
          <span>How much does competition worry you?</span>
          <strong>{worryLabel(competitionWeight)}</strong>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={competitionWeight}
          aria-valuetext={worryLabel(competitionWeight)}
          onChange={(event) => onCompetitionWeightChange(Number(event.target.value))}
        />
      </label>

      <div className="legend">
        <div className="legend-ramp">
          <span className="legend-label">{legend.label}</span>
          <span className="legend-bar" style={{ backgroundImage: gradient(legend.ramp) }} />
          <span className="legend-scale muted">
            <span>{legend.low}</span>
            <span>{legend.high}</span>
          </span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" aria-hidden="true" />
          Similar venue, larger = closer taste match
        </div>
        <div className="legend-item">
          <span className="legend-zone" aria-hidden="true" />
          Top zone
        </div>
        <div className="legend-item">
          <span className="legend-excluded" aria-hidden="true" />
          Excluded area
        </div>
      </div>
    </section>
  );
}
