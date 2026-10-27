import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type LngLatBoundsLike,
  type MapMouseEvent,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Polygon } from "geojson";
import type { BBox, PlaceRef, ScoredCell, Zone } from "@whitespace/shared";
import {
  LAYERS,
  SOURCES,
  cellsGeoJSON,
  competitorsGeoJSON,
  excludedGeoJSON,
  installLayers,
  tastePlacesGeoJSON,
  setLayerMode,
  setSourceData,
  zonesGeoJSON,
  type LayerMode,
} from "./layers.js";
import { captureNextFrame, composeMapImage, type MapCapture } from "./capture.js";
import { describeCell, describeCompetitor, describeTastePlace, tipElement } from "./tooltip.js";

const STYLE_URL =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ||
  "https://tiles.openfreemap.org/styles/positron";

setWorkerUrl(workerUrl);

export interface MapFocus {
  key: string;
  bbox: BBox;
}

export interface MapViewProps {
  focus: MapFocus;
  cells: readonly ScoredCell[];
  competitors: readonly PlaceRef[];
  zones: readonly Zone[];
  tastePlaces: readonly PlaceRef[];
  anchorNames: Readonly<Record<string, string>>;
  excluded: readonly Polygon[];
  mode: LayerMode;
  selectedZoneId: string | undefined;
  hoveredZoneId: string | undefined;
  onSelectZone: (zoneId: string) => void;
  captureRef?: { current: MapCapture | null };
  conceptOpen?: boolean;
}

function focusPadding(width: number, height: number, conceptOpen: boolean) {
  if (width > 1180) return { top: 56, bottom: 200, left: 400, right: 460 };
  if (width > 960) return { top: 56, bottom: 280, left: 356, right: 420 };
  return conceptOpen
    ? { top: Math.round(height * 0.6) + 24, bottom: 24, left: 24, right: 24 }
    : { top: 88, bottom: Math.round(height * 0.4) + 24, left: 24, right: 24 };
}

export function MapView({
  focus,
  cells,
  competitors,
  zones,
  tastePlaces,
  anchorNames,
  excluded,
  mode,
  selectedZoneId,
  hoveredZoneId,
  onSelectZone,
  captureRef,
  conceptOpen = false,
}: MapViewProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const modeRef = useRef(mode);
  const selectRef = useRef(onSelectZone);
  const zonesRef = useRef(zones);
  const conceptOpenRef = useRef(conceptOpen);
  const initialBbox = useRef(focus.bbox);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    modeRef.current = mode;
    selectRef.current = onSelectZone;
    zonesRef.current = zones;
    conceptOpenRef.current = conceptOpen;
  });

  useEffect(() => {
    if (!captureRef) return;
    captureRef.current = {
      capture: () => {
        const instance = map.current;
        return instance
          ? captureNextFrame(instance, () => composeMapImage(instance, zonesRef.current))
          : Promise.resolve(undefined);
      },
    };
    return () => {
      captureRef.current = null;
    };
  }, [captureRef]);

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({
      container: container.current,
      style: STYLE_URL,
      bounds: initialBbox.current,
      attributionControl: { compact: true },
    });
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    const tip = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      className: "map-tip",
      maxWidth: "260px",
    });

    const showTip = (event: MapMouseEvent): boolean => {
      const [hit] = instance.queryRenderedFeatures(event.point, {
        layers: [LAYERS.competitors, LAYERS.tastePlaces, LAYERS.cells],
      });
      const lines =
        hit?.layer.id === LAYERS.competitors
          ? describeCompetitor(hit.properties)
          : hit?.layer.id === LAYERS.tastePlaces
            ? describeTastePlace(hit.properties)
            : hit
              ? describeCell(hit.properties, modeRef.current)
              : undefined;
      if (!lines) {
        tip.remove();
        return false;
      }
      tip.setLngLat(event.lngLat).setDOMContent(tipElement(lines)).addTo(instance);
      return hit?.layer.id === LAYERS.competitors || hit?.layer.id === LAYERS.tastePlaces;
    };

    const zoneAt = (event: MapMouseEvent): string | undefined => {
      const [zone] = instance.queryRenderedFeatures(event.point, { layers: [LAYERS.zonesFill] });
      const id = zone?.properties.id;
      return typeof id === "string" ? id : undefined;
    };

    const onMove = (event: MapMouseEvent) => {
      const overCompetitor = showTip(event);
      instance.getCanvas().style.cursor = overCompetitor || zoneAt(event) ? "pointer" : "";
    };

    const onClick = (event: MapMouseEvent) => {
      showTip(event);
      const id = zoneAt(event);
      if (id) selectRef.current(id);
    };

    instance.on("load", () => {
      installLayers(instance);
      instance.on("mousemove", onMove);
      instance.on("mouseout", () => tip.remove());
      instance.on("click", onClick);
      setReady(true);
    });
    map.current = instance;
    return () => {
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      tip.remove();
      instance.remove();
      map.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (ready && map.current) setSourceData(map.current, SOURCES.cells, cellsGeoJSON(cells));
  }, [ready, cells]);

  useEffect(() => {
    if (ready && map.current) setLayerMode(map.current, mode);
  }, [ready, mode]);

  useEffect(() => {
    if (ready && map.current) {
      setSourceData(map.current, SOURCES.competitors, competitorsGeoJSON(competitors));
    }
  }, [ready, competitors]);

  useEffect(() => {
    if (ready && map.current) {
      setSourceData(map.current, SOURCES.excluded, excludedGeoJSON(excluded));
    }
  }, [ready, excluded]);

  useEffect(() => {
    if (ready && map.current) {
      setSourceData(map.current, SOURCES.tastePlaces, tastePlacesGeoJSON(tastePlaces, anchorNames));
    }
  }, [ready, tastePlaces, anchorNames]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    setSourceData(instance, SOURCES.zones, zonesGeoJSON(zones, selectedZoneId, hoveredZoneId));
    markers.current.forEach((marker) => marker.remove());
    markers.current = zones.map((zone) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = [
        "zone-marker",
        zone.id === selectedZoneId ? "is-selected" : "",
        zone.id === hoveredZoneId ? "is-hovered" : "",
      ]
        .filter(Boolean)
        .join(" ");
      element.textContent = String(zone.rank);
      element.setAttribute("aria-label", `Zone ${zone.rank}`);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        selectRef.current(zone.id);
      });
      return new Marker({ element }).setLngLat(zone.centroid).addTo(instance);
    });
  }, [ready, zones, selectedZoneId, hoveredZoneId]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const { clientWidth, clientHeight } = instance.getContainer();
    instance.fitBounds(focus.bbox as LngLatBoundsLike, {
      padding: focusPadding(clientWidth, clientHeight, conceptOpenRef.current),
      duration: 1200,
      maxZoom: 14.5,
    });
  }, [ready, focus.key, focus.bbox]);

  return <div ref={container} className="map" aria-label="Map" />;
}
