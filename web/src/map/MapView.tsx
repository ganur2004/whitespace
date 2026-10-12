import { useEffect, useRef } from "react";
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { BBox } from "@whitespace/shared";

const STYLE_URL =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ||
  "https://tiles.openfreemap.org/styles/positron";

setWorkerUrl(workerUrl);

export interface MapViewProps {
  bbox: BBox;
}

export function MapView({ bbox }: MapViewProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const initialBbox = useRef(bbox);

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({
      container: container.current,
      style: STYLE_URL,
      bounds: initialBbox.current,
      attributionControl: { compact: true },
    });
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    map.current?.fitBounds(bbox, { padding: 32, duration: 1200 });
  }, [bbox]);

  return <div ref={container} className="map" aria-label="Map" />;
}
