import {
  describeAnchorAudience,
  describeAudience,
  type PlaceRef,
  type ScoutResult,
  type Zone,
} from "@whitespace/shared";

export interface BriefInput {
  result: ScoutResult;
  zones: readonly Zone[];
  competitionWeight: number;
  competitionLabel: string;
  excludedCount: number;
  mapImage?: string;
  now: Date;
}

const MAX_COMPETITORS = 10;

export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]<>|#]/g, (char) => `\\${char}`)
    .replace(/\s+/g, " ")
    .trim();
}

const percent = (value: number | undefined): string =>
  value === undefined ? "n/a" : `${Math.round(value * 100)}%`;

const coordinates = ([lon, lat]: readonly [number, number]): string =>
  `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

const mapLink = ([lon, lat]: readonly [number, number]): string =>
  `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=16/${lat.toFixed(5)}/${lon.toFixed(5)}`;

export function briefFileName(result: ScoutResult, now: Date): string {
  return `whitespace-brief-${result.city.id}-${now.toISOString().slice(0, 10)}.md`;
}

function anchorNames(result: ScoutResult): Record<string, string> {
  return Object.fromEntries(result.anchors.map((anchor) => [anchor.id, anchor.name]));
}

function zoneSection(zone: Zone, names: Record<string, string>): string[] {
  const title = zone.profile?.neighborhood ?? `Zone ${zone.rank}`;
  const lines = [
    `### ${zone.rank}. ${escapeMarkdown(title)} — score ${zone.score.toFixed(2)}`,
    "",
    ...zone.reasons.map((reason) => `- ${escapeMarkdown(reason)}`),
    `- Similar venues inside the zone: ${zone.competitorsInside}; within 1 km: ${zone.competitorsNearby}`,
    `- Center: ${coordinates(zone.centroid)} ([open map](${mapLink(zone.centroid)}))`,
  ];
  const places = zone.profile?.tastePlaces.slice(0, 5) ?? [];
  if (places.length > 0) {
    lines.push("", "Locals here also love:", "");
    for (const place of places) lines.push(`- ${tastePlaceLine(place, names)}`);
  }
  return lines;
}

function tastePlaceLine(place: PlaceRef, names: Record<string, string>): string {
  const via = (place.drivers ?? [])
    .slice(0, 2)
    .flatMap((driver) => names[driver.anchorId] ?? [])
    .map(escapeMarkdown);
  const details = [
    place.neighborhood ? escapeMarkdown(place.neighborhood) : undefined,
    place.affinity === undefined ? undefined : `${percent(place.affinity)} taste match`,
    via.length > 0 ? `via ${via.join(" and ")}` : undefined,
  ].filter(Boolean);
  return `**${escapeMarkdown(place.name)}**${details.length > 0 ? ` — ${details.join(", ")}` : ""}`;
}

export function buildBrief(input: BriefInput): string {
  const { result, zones, now } = input;
  const names = anchorNames(result);
  const lines: string[] = [
    `# Whitespace brief: ${escapeMarkdown(result.concept || "New venue")}`,
    "",
    `- City: ${escapeMarkdown(result.city.name)}`,
    `- Date: ${now.toISOString().slice(0, 10)}`,
    `- Data: ${result.demo ? "demo data (recorded or synthetic), not a live Qloo call" : "live Qloo API"}`,
    `- Taste anchors: ${result.anchors.map((anchor) => escapeMarkdown(anchor.name)).join(", ")}`,
    `- How much competition matters: ${input.competitionLabel} (${input.competitionWeight.toFixed(2)})`,
    `- Excluded areas: ${input.excludedCount}`,
  ];

  if (input.mapImage) lines.push("", `![Map of the top zones](${input.mapImage})`);

  if (result.audience) {
    lines.push(
      "",
      "## Who this taste attracts",
      "",
      escapeMarkdown(describeAudience(result.audience)),
    );
    lines.push("", "| Anchor | Skews |", "|---|---|");
    const order = result.anchors.map((anchor) => anchor.id);
    const position = (anchorId: string) =>
      order.includes(anchorId) ? order.indexOf(anchorId) : order.length;
    const entries = [...result.audience.byAnchor].sort(
      (a, b) => position(a.anchorId) - position(b.anchorId),
    );
    for (const entry of entries) {
      lines.push(
        `| ${escapeMarkdown(names[entry.anchorId] ?? "Anchor")} | ${escapeMarkdown(describeAnchorAudience(entry))} |`,
      );
    }
  }

  lines.push("", "## Top zones", "");
  if (zones.length === 0) lines.push("No zone clears the bar with these settings.");
  for (const zone of zones) lines.push(...zoneSection(zone, names), "");

  const competitors = [...result.competitors]
    .sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1))
    .slice(0, MAX_COMPETITORS);
  if (competitors.length > 0) {
    lines.push(
      `## Similar venues in ${escapeMarkdown(result.city.name)}`,
      "",
      `${result.competitors.length} found; the ${competitors.length} closest to this taste:`,
      "",
      "| Venue | Neighborhood | Taste match |",
      "|---|---|---|",
      ...competitors.map(
        (place) =>
          `| ${escapeMarkdown(place.name)} | ${escapeMarkdown(place.neighborhood ?? "—")} | ${percent(place.affinity)} |`,
      ),
      "",
    );
  }

  lines.push(
    "## How this was made",
    "",
    "Whitespace asked Qloo's taste graph where people who like the anchors above already are (a heatmap of about 150 m cells), found every similar venue in the city and how much the same audience likes each of them, and scored each cell as taste match minus weighted competition. Zones are clusters of the best cells.",
    "",
    `Qloo calls: ${result.trace.length} (${[...new Set(result.trace.map((step) => escapeMarkdown(step.label)))].join(", ")}).`,
    "",
    "> Taste match is a first filter, not a full site analysis. Check rent, foot traffic and visit in person.",
    "",
  );
  return lines.join("\n");
}

export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
