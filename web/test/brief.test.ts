import { describe, expect, it } from "vitest";
import { findCity, type ScoutResult, type Zone } from "@whitespace/shared";
import { briefFileName, buildBrief, escapeMarkdown } from "../src/brief.js";

const austin = findCity("austin")!;
const zone: Zone = {
  id: "z1",
  rank: 1,
  score: 0.97,
  polygon: {
    type: "Polygon",
    coordinates: [
      [
        [-97.75, 30.26],
        [-97.74, 30.26],
        [-97.74, 30.27],
        [-97.75, 30.26],
      ],
    ],
  },
  centroid: [-97.746, 30.2666],
  cellCount: 110,
  meanAffinity: 0.95,
  competitorsInside: 0,
  competitorsNearby: 1,
  reasons: ["Taste match in the top 5% of Austin, TX"],
  profile: {
    neighborhood: "Downtown",
    tastePlaces: [
      {
        id: "p1",
        name: "Midnight Cowboy",
        lat: 30.267,
        lon: -97.739,
        neighborhood: "Sixth Street",
        affinity: 0.96,
        tags: [],
        drivers: [{ anchorId: "a1", score: 0.3 }],
      },
    ],
  },
};

const result: ScoutResult = {
  concept: "A ramen bar with a vinyl listening corner and craft beer.",
  city: austin,
  anchors: [{ id: "a1", name: "Kitty Cohen's", type: "urn:entity:place", source: "agent" }],
  categoryTags: [{ id: "urn:tag:genre:place:restaurant:ramen", name: "Ramen restaurant" }],
  affinityMode: "percentile",
  cells: [],
  competitors: [
    { id: "c1", name: "Ramen | Bar *Deluxe*", lat: 30.25, lon: -97.76, affinity: 0.85, tags: [] },
    { id: "c2", name: "No Match Noodles", lat: 30.24, lon: -97.77, tags: [] },
  ],
  zones: [zone],
  params: { competitionWeight: 0.6, minAffinity: 0.7, excludePolygons: [] },
  audience: {
    age: { "25_to_29": 0.2 },
    gender: { male: 0, female: 0 },
    byAnchor: [{ anchorId: "a1", age: { "55_and_older": 0.3 }, gender: { male: -0.2 } }],
  },
  trace: [
    {
      id: "q1",
      label: "Taste heatmap",
      endpoint: "/v2/insights",
      params: {},
      resultCount: 1653,
      ms: 900,
      cached: false,
    },
  ],
  demo: false,
};

const now = new Date("2026-10-13T12:00:00Z");
const base = {
  result,
  zones: [zone],
  competitionWeight: 0.6,
  competitionLabel: "Moderately",
  excludedCount: 0,
  now,
};

describe("buildBrief", () => {
  it("lists the setup, audience, zones, competitors and method", () => {
    const brief = buildBrief(base);

    expect(brief).toMatch(/^# Whitespace brief: A ramen bar with a vinyl listening corner/);
    expect(brief).toContain("- City: Austin, TX");
    expect(brief).toContain("- Data: live Qloo API");
    expect(brief).toContain("- How much competition matters: Moderately (0.60)");
    expect(brief).toContain("## Who this taste attracts");
    expect(brief).toContain("| Kitty Cohen's | 55+ · more women |");
    expect(brief).toContain("### 1. Downtown — score 0.97");
    expect(brief).toContain("- Taste match in the top 5% of Austin, TX");
    expect(brief).toContain(
      "**Midnight Cowboy** — Sixth Street, 96% taste match, via Kitty Cohen's",
    );
    expect(brief).toContain("https://www.openstreetmap.org/?mlat=30.26660&mlon=-97.74600");
    expect(brief).toContain("Qloo calls: 1 (Taste heatmap).");
    expect(brief).toContain("Taste match is a first filter, not a full site analysis.");
    expect(brief).not.toContain("![Map");
  });

  it("escapes Markdown in names from Qloo and sorts competitors by taste match", () => {
    const brief = buildBrief(base);
    const rows = brief.split("\n").filter((line) => line.startsWith("| ") && line.includes("%"));

    expect(rows[0]).toBe("| Ramen \\| Bar \\*Deluxe\\* | — | 85% |");
    expect(brief).toContain("| No Match Noodles | — | n/a |");
  });

  it("embeds the map image and flags demo data", () => {
    const brief = buildBrief({
      ...base,
      result: { ...result, demo: true },
      mapImage: "data:image/jpeg;base64,AAAA",
    });

    expect(brief).toContain("![Map of the top zones](data:image/jpeg;base64,AAAA)");
    expect(brief).toContain("demo data (recorded or synthetic), not a live Qloo call");
  });

  it("says so when no zone clears the bar", () => {
    expect(buildBrief({ ...base, zones: [] })).toContain(
      "No zone clears the bar with these settings.",
    );
  });
});

describe("brief helpers", () => {
  it("names the file after the city and date", () => {
    expect(briefFileName(result, now)).toBe("whitespace-brief-austin-2026-10-13.md");
  });

  it("escapes characters that would break Markdown", () => {
    expect(escapeMarkdown("A|B *c* [d] #1 <e>")).toBe("A\\|B \\*c\\* \\[d\\] \\#1 \\<e\\>");
    expect(escapeMarkdown("  two   spaces \n newline ")).toBe("two spaces newline");
  });
});
