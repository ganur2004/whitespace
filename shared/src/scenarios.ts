import type { Anchor } from "./types.js";

export interface Scenario {
  id: string;
  cityId: string;
  concept: string;
  anchors: Anchor[];
  categoryTags: { id: string; name: string }[];
}

export const RAMEN_RESTAURANT_TAG = {
  id: "urn:tag:genre:place:restaurant:ramen",
  name: "Ramen restaurant",
};

const RAMEN_CONCEPT = "A ramen bar with a vinyl listening corner and craft beer.";

const anchor = (id: string, name: string, type: string): Anchor => ({
  id,
  name,
  type,
  source: "agent",
});

const KHRUANGBIN = anchor(
  "BAF6317A-DF94-4C90-92AE-63F86560C21B",
  "Khruangbin",
  "urn:entity:artist",
);
const LAGUNITAS = anchor(
  "9C29D334-A23A-4E91-814E-7AAA7BF713BA",
  "Lagunitas Brewing Company",
  "urn:entity:brand",
);
const LP_VINYL_BAR = anchor(
  "785479F2-6223-4A7D-8221-B74420A8A229",
  "LP Vinyl Bar",
  "urn:entity:place",
);

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "austin-ramen",
    cityId: "austin",
    concept: RAMEN_CONCEPT,
    anchors: [
      anchor("07C23A4E-B920-4848-BB97-0DCBBF6C7DB8", "Ramen Tatsu-Ya", "urn:entity:place"),
      anchor("BEA491B9-9224-4258-9DCF-67070EC44987", "Kitty Cohen's", "urn:entity:place"),
      KHRUANGBIN,
      LAGUNITAS,
    ],
    categoryTags: [RAMEN_RESTAURANT_TAG],
  },
  {
    id: "brooklyn-ramen",
    cityId: "brooklyn",
    concept: RAMEN_CONCEPT,
    anchors: [
      anchor("2659F34F-0D6E-4A33-A566-28D477184961", "Ivan Ramen", "urn:entity:place"),
      KHRUANGBIN,
      LAGUNITAS,
      LP_VINYL_BAR,
    ],
    categoryTags: [RAMEN_RESTAURANT_TAG],
  },
  {
    id: "chicago-ramen",
    cityId: "chicago",
    concept: RAMEN_CONCEPT,
    anchors: [
      anchor("8473EEF4-8863-4965-A8DE-DB370C0E4FDC", "RAMEN-SAN", "urn:entity:place"),
      KHRUANGBIN,
      LAGUNITAS,
      LP_VINYL_BAR,
    ],
    categoryTags: [RAMEN_RESTAURANT_TAG],
  },
];

export function scenarioFor(cityId: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.cityId === cityId);
}
