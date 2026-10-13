import { useEffect, useRef } from "react";
import type { PlaceRef, Zone } from "@whitespace/shared";

export interface ZoneCardsProps {
  zones: readonly Zone[];
  anchorNames: Readonly<Record<string, string>>;
  profilesLoading: ReadonlySet<string>;
  selectedZoneId: string | undefined;
  excludedCount: number;
  onSelect: (zoneId: string) => void;
  onHover: (zoneId: string | undefined) => void;
  onExclude: (zone: Zone) => void;
  onResetExclusions: () => void;
}

const topDrivers = (place: PlaceRef): string[] =>
  (place.drivers ?? []).slice(0, 2).map((driver) => driver.anchorId);

export function dominantDrivers(places: readonly PlaceRef[]): string[] {
  const totals = new Map<string, number>();
  for (const place of places) {
    for (const driver of place.drivers ?? []) {
      totals.set(driver.anchorId, (totals.get(driver.anchorId) ?? 0) + driver.score);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([anchorId]) => anchorId);
}

const names = (ids: readonly string[], anchorNames: Readonly<Record<string, string>>): string =>
  ids.flatMap((id) => anchorNames[id] ?? []).join(" and ");

export function ZoneCards({
  zones,
  anchorNames,
  profilesLoading,
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
          {zone.profile && zone.profile.tastePlaces.length > 0 && (
            <TastePlaces places={zone.profile.tastePlaces} anchorNames={anchorNames} />
          )}
          {!zone.profile && profilesLoading.has(zone.id) && (
            <p className="muted small">Finding what locals here love…</p>
          )}
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

function TastePlaces({
  places,
  anchorNames,
}: {
  places: readonly PlaceRef[];
  anchorNames: Readonly<Record<string, string>>;
}): React.JSX.Element {
  const dominant = dominantDrivers(places);
  const shown = places.slice(0, 3);
  return (
    <div className="taste-places">
      <span className="field-label">Locals here also love</span>
      <ul>
        {shown.map((place) => {
          const own = topDrivers(place);
          const differs = own.length > 0 && own.some((id) => !dominant.includes(id));
          return (
            <li key={place.id}>
              <span className="taste-name">{place.name}</span>
              {differs && <span className="muted"> via {names(own, anchorNames)}</span>}
            </li>
          );
        })}
      </ul>
      {dominant.length > 0 && (
        <span className="muted small">The match here leans on {names(dominant, anchorNames)}.</span>
      )}
    </div>
  );
}
