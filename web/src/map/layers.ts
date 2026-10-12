import type {
  DataDrivenPropertyValueSpecification,
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import { cellPolygon, type PlaceRef, type ScoredCell, type Zone } from "@whitespace/shared";

export type LayerMode = "audience" | "opportunity";

export const SOURCES = {
  cells: "cells",
  competitors: "competitors",
  zones: "zones",
  excluded: "excluded",
} as const;
export const LAYERS = {
  cells: "cells-fill",
  excludedFill: "excluded-fill",
  excludedLine: "excluded-line",
  zonesFill: "zones-fill",
  zonesLine: "zones-line",
  competitors: "competitors-circle",
} as const;

export const AUDIENCE_RAMP: [number, string][] = [
  [0.5, "#cde2fb"],
  [0.7, "#86b6ef"],
  [0.85, "#3987e5"],
  [0.95, "#1c5cab"],
  [1, "#0d366b"],
];

export const OPPORTUNITY_RAMP: [number, string][] = [
  [0.25, "#fde1d3"],
  [0.5, "#f6a47f"],
  [0.75, "#eb6834"],
  [0.9, "#bf4a1b"],
  [1, "#7f2e0f"],
];

const INK = "#1f2328";
const MUTED = "#5f6670";
const HATCH = "hatch";
const HATCH_SIZE = 8;
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function ramp(property: string, stops: [number, string][]): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["get", property],
    ...stops.flatMap(([value, color]) => [value, color]),
  ] as ExpressionSpecification;
}

const FILL: Record<
  LayerMode,
  { color: ExpressionSpecification; opacity: DataDrivenPropertyValueSpecification<number> }
> = {
  audience: {
    color: ramp("affinity", AUDIENCE_RAMP),
    opacity: ["interpolate", ["linear"], ["get", "affinity"], 0.45, 0, 0.6, 0.3, 1, 0.72],
  },
  opportunity: {
    color: ramp("opportunity", OPPORTUNITY_RAMP),
    opacity: [
      "case",
      ["<=", ["get", "opportunity"], 0],
      0,
      ["interpolate", ["linear"], ["get", "opportunity"], 0.25, 0.3, 1, 0.8],
    ],
  },
};

export function cellsGeoJSON(cells: readonly ScoredCell[]): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: cells.map((cell): Feature<Polygon> => ({
      type: "Feature",
      geometry: cellPolygon(cell.geohash),
      properties: {
        geohash: cell.geohash,
        affinity: cell.affinity,
        opportunity: cell.opportunity,
        pressure: cell.pressure,
        popularity: cell.popularity ?? null,
      },
    })),
  };
}

export function competitorsGeoJSON(places: readonly PlaceRef[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: places.map((place): Feature<Point> => ({
      type: "Feature",
      id: place.id,
      geometry: { type: "Point", coordinates: [place.lon, place.lat] },
      properties: {
        id: place.id,
        name: place.name,
        neighborhood: place.neighborhood ?? null,
        affinity: place.affinity ?? null,
      },
    })),
  };
}

export function zonesGeoJSON(
  zones: readonly Zone[],
  selectedId: string | undefined,
  hoveredId: string | undefined,
): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: zones.map((zone): Feature<Polygon> => ({
      type: "Feature",
      geometry: zone.polygon,
      properties: {
        id: zone.id,
        rank: zone.rank,
        selected: zone.id === selectedId,
        highlighted: zone.id === selectedId || zone.id === hoveredId,
      },
    })),
  };
}

export function excludedGeoJSON(polygons: readonly Polygon[]): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: polygons.map((polygon): Feature<Polygon> => ({
      type: "Feature",
      geometry: polygon,
      properties: {},
    })),
  };
}

function hatchPattern(): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(HATCH_SIZE * HATCH_SIZE * 4);
  for (let y = 0; y < HATCH_SIZE; y += 1) {
    for (let x = 0; x < HATCH_SIZE; x += 1) {
      if ((x + y) % HATCH_SIZE > 1) continue;
      data.set([95, 102, 112, 150], (y * HATCH_SIZE + x) * 4);
    }
  }
  return { width: HATCH_SIZE, height: HATCH_SIZE, data };
}

export function installLayers(map: MapLibreMap): void {
  const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
  for (const source of Object.values(SOURCES)) {
    map.addSource(source, { type: "geojson", data: EMPTY });
  }
  map.addLayer(
    {
      id: LAYERS.cells,
      type: "fill",
      source: SOURCES.cells,
      paint: {
        "fill-color": FILL.audience.color,
        "fill-opacity": FILL.audience.opacity,
        "fill-outline-color": "rgba(0, 0, 0, 0)",
      },
    },
    firstLabel,
  );
  map.addImage(HATCH, hatchPattern(), { pixelRatio: 2 });
  map.addLayer({
    id: LAYERS.excludedFill,
    type: "fill",
    source: SOURCES.excluded,
    paint: { "fill-pattern": HATCH, "fill-opacity": 0.9 },
  });
  map.addLayer({
    id: LAYERS.excludedLine,
    type: "line",
    source: SOURCES.excluded,
    paint: { "line-color": MUTED, "line-width": 1.5, "line-dasharray": [2, 2] },
  });
  map.addLayer({
    id: LAYERS.zonesFill,
    type: "fill",
    source: SOURCES.zones,
    paint: {
      "fill-color": INK,
      "fill-opacity": ["case", ["boolean", ["get", "highlighted"], false], 0.1, 0.04],
    },
  });
  map.addLayer({
    id: LAYERS.zonesLine,
    type: "line",
    source: SOURCES.zones,
    layout: { "line-join": "round" },
    paint: {
      "line-color": INK,
      "line-width": ["case", ["boolean", ["get", "highlighted"], false], 4, 2.5],
    },
  });
  map.addLayer({
    id: LAYERS.competitors,
    type: "circle",
    source: SOURCES.competitors,
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "affinity"], 0.5],
        0,
        4,
        1,
        7.5,
      ],
      "circle-color": INK,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
}

export function setSourceData(map: MapLibreMap, source: string, data: FeatureCollection): void {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

export function setLayerMode(map: MapLibreMap, mode: LayerMode): void {
  map.setPaintProperty(LAYERS.cells, "fill-color", FILL[mode].color);
  map.setPaintProperty(LAYERS.cells, "fill-opacity", FILL[mode].opacity);
}
