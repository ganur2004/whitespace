import { useEffect, useRef } from "react";
import type { Zone } from "@whitespace/shared";

export interface ZoneCardsProps {
  zones: readonly Zone[];
  selectedZoneId: string | undefined;
  excludedCount: number;
  onSelect: (zoneId: string) => void;
  onHover: (zoneId: string | undefined) => void;
  onExclude: (zone: Zone) => void;
  onResetExclusions: () => void;
}

export function ZoneCards({
  zones,
  selectedZoneId,
  excludedCount,
  onSelect,
  onHover,
  onExclude,
  onResetExclusions,
}: ZoneCardsProps): React.JSX.Element {
  const cards = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (selectedZoneId) {
      cards.current.get(selectedZoneId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedZoneId]);

  return (
    <div className="zone-list">
      {excludedCount > 0 && (
        <button type="button" className="chip chip-action" onClick={onResetExclusions}>
          {excludedCount} excluded {excludedCount === 1 ? "area" : "areas"} · Reset
        </button>
      )}
      {zones.length === 0 && (
        <p className="muted">
          No zone clears the bar. Move the competition slider left or reset exclusions.
        </p>
      )}
      {zones.map((zone) => (
        <article
          key={zone.id}
          ref={(element) => {
            if (element) cards.current.set(zone.id, element);
            else cards.current.delete(zone.id);
          }}
          className={`zone-card${zone.id === selectedZoneId ? " is-selected" : ""}`}
          onMouseEnter={() => onHover(zone.id)}
          onMouseLeave={() => onHover(undefined)}
          onFocus={() => onHover(zone.id)}
          onBlur={() => onHover(undefined)}
        >
          <header className="zone-card-header">
            <span className="zone-rank" aria-hidden="true">
              {zone.rank}
            </span>
            <button type="button" className="zone-title" onClick={() => onSelect(zone.id)}>
              {zone.profile?.neighborhood ?? `Zone ${zone.rank}`}
            </button>
            <span className="zone-score" title="Opportunity score, 0 to 1">
              {zone.score.toFixed(2)}
            </span>
          </header>
          <dl className="zone-stats">
            <div>
              <dt>Rivals inside</dt>
              <dd>{zone.competitorsInside}</dd>
            </div>
            <div>
              <dt>Within 1 km</dt>
              <dd>{zone.competitorsNearby}</dd>
            </div>
          </dl>
          <ul className="zone-reasons">
            {zone.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <div className="zone-actions">
            <button type="button" className="link-button" onClick={() => onSelect(zone.id)}>
              Show on map
            </button>
            <button type="button" className="link-button" onClick={() => onExclude(zone)}>
              Exclude this area
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
