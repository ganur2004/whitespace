import type { LayerMode } from "./layers.js";

export interface TipLine {
  text: string;
  strong?: boolean;
}

export function tipElement(lines: readonly TipLine[]): HTMLElement {
  const root = document.createElement("div");
  root.className = "map-tip-body";
  for (const line of lines) {
    const element = document.createElement(line.strong ? "strong" : "div");
    element.textContent = line.text;
    root.append(element);
  }
  return root;
}

export function topShare(affinity: number): string {
  return `top ${Math.max(1, Math.round((1 - affinity) * 100))}%`;
}

export function audienceSize(popularity: number): string {
  return popularity >= 2 / 3 ? "large" : popularity >= 1 / 3 ? "mid-size" : "niche";
}

function competitionLevel(pressure: number): string {
  return pressure < 0.25 ? "low" : pressure < 0.6 ? "moderate" : "high";
}

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export function describeCell(
  properties: Record<string, unknown>,
  mode: LayerMode,
): TipLine[] | undefined {
  const affinity = asNumber(properties.affinity);
  const opportunity = asNumber(properties.opportunity);
  const pressure = asNumber(properties.pressure);
  const popularity = asNumber(properties.popularity);
  if (affinity === undefined) return undefined;

  if (mode === "audience") {
    if (affinity < 0.45) return undefined;
    const lines: TipLine[] = [{ text: `Taste match: ${topShare(affinity)}`, strong: true }];
    if (popularity !== undefined)
      lines.push({ text: `Audience size: ${audienceSize(popularity)}` });
    return lines;
  }

  if (opportunity === undefined || opportunity <= 0) return undefined;
  const lines: TipLine[] = [
    { text: `Opportunity ${opportunity.toFixed(2)}`, strong: true },
    { text: `Taste match: ${topShare(affinity)}` },
  ];
  if (pressure !== undefined) lines.push({ text: `Competition: ${competitionLevel(pressure)}` });
  return lines;
}

export function describeCompetitor(properties: Record<string, unknown>): TipLine[] {
  const lines: TipLine[] = [{ text: String(properties.name ?? "Competitor"), strong: true }];
  if (typeof properties.neighborhood === "string") lines.push({ text: properties.neighborhood });
  const affinity = asNumber(properties.affinity);
  lines.push({
    text:
      affinity === undefined
        ? "Taste match unknown"
        : `Taste match with your audience: ${Math.round(affinity * 100)}%`,
  });
  return lines;
}

export function describeTastePlace(properties: Record<string, unknown>): TipLine[] {
  const lines: TipLine[] = [{ text: String(properties.name ?? "Place"), strong: true }];
  if (typeof properties.neighborhood === "string") lines.push({ text: properties.neighborhood });
  const affinity = asNumber(properties.affinity);
  lines.push({
    text:
      affinity === undefined
        ? "Locals with your taste love it"
        : `Locals with your taste love it: ${Math.round(affinity * 100)}% match`,
  });
  if (typeof properties.via === "string" && properties.via) {
    lines.push({ text: `Matched via ${properties.via}` });
  }
  return lines;
}
