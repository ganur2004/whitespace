import { useEffect, useState } from "react";
import {
  CITIES,
  DEFAULT_CITY,
  DEFAULT_CITY_ID,
  findCity,
  type HealthStatus,
} from "@whitespace/shared";
import { MapView } from "./map/MapView.js";

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
  const city = findCity(cityId) ?? DEFAULT_CITY;

  return (
    <div className="app">
      <MapView bbox={city.bbox} />
      <header className="brand-panel">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>Whitespace</h1>
          <DataBadge api={api} />
        </div>
        <p className="tagline">Where your audience already is, and your competitors are not.</p>
        <label className="field">
          <span>City</span>
          <select value={city.id} onChange={(event) => setCityId(event.target.value)}>
            {CITIES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </header>
    </div>
  );
}
