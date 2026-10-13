import type { Map as MapLibreMap } from "maplibre-gl";
import type { Zone } from "@whitespace/shared";

const MAX_WIDTH = 1600;
const INK = "#1f2328";
const ATTRIBUTION = "© OpenStreetMap contributors · OpenFreeMap · taste data: Qloo";

export interface MapCapture {
  capture: () => Promise<string | undefined>;
}

export function composeMapImage(map: MapLibreMap, zones: readonly Zone[]): string | undefined {
  try {
    const source = map.getCanvas();
    const ratio = Math.min(1, MAX_WIDTH / source.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(source.width * ratio);
    canvas.height = Math.round(source.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    const scale = canvas.width / source.clientWidth;
    for (const zone of zones) {
      const { x, y } = map.project(zone.centroid);
      const cx = x * scale;
      const cy = y * scale;
      context.beginPath();
      context.arc(cx, cy, 15 * scale, 0, 2 * Math.PI);
      context.fillStyle = INK;
      context.fill();
      context.lineWidth = 2 * scale;
      context.strokeStyle = "#ffffff";
      context.stroke();
      context.fillStyle = "#ffffff";
      context.font = `700 ${14 * scale}px Inter, system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(zone.rank), cx, cy + scale);
    }

    context.font = `${11 * scale}px Inter, system-ui, sans-serif`;
    const padding = 6 * scale;
    const width = context.measureText(ATTRIBUTION).width + padding * 2;
    const height = 18 * scale;
    context.fillStyle = "rgba(255, 255, 255, 0.85)";
    context.fillRect(canvas.width - width, canvas.height - height, width, height);
    context.fillStyle = INK;
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(ATTRIBUTION, canvas.width - padding, canvas.height - height / 2);

    return canvas.toDataURL("image/jpeg", 0.85);
  } catch (error) {
    console.warn("Could not capture the map", error);
    return undefined;
  }
}
