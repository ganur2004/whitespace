import type { Anchor } from "./types.js";

export interface Scenario {
  id: string;
  cityId: string;
  concept: string;
  anchors: Anchor[];
  categoryTags: { id: string; name: string }[];
}

export const SYNTHETIC_RAMEN_TAG = { id: "urn:tag:genre:place:restaurant:ramen", name: "Ramen" };

export const SYNTHETIC_ANCHORS: Anchor[] = [
  {
    id: "00000000-0000-4000-a000-000000000001",
    name: "Ramen bar (synthetic)",
    type: "urn:entity:place",
    source: "agent",
  },
  {
    id: "00000000-0000-4000-a000-000000000002",
    name: "Listening bar (synthetic)",
    type: "urn:entity:place",
    source: "agent",
  },
  {
    id: "00000000-0000-4000-a000-000000000003",
    name: "Craft brewery (synthetic)",
    type: "urn:entity:brand",
    source: "agent",
  },
];

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "austin-ramen",
    cityId: "austin",
    concept: "A ramen bar with a vinyl listening corner and craft beer.",
    anchors: SYNTHETIC_ANCHORS,
    categoryTags: [SYNTHETIC_RAMEN_TAG],
  },
];

export function scenarioFor(cityId: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.cityId === cityId);
}
