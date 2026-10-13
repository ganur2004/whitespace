import type { AnchorAudience, AudiencePortrait } from "./types.js";

export const AGE_BANDS: readonly (readonly [string, string])[] = [
  ["24_and_younger", "under 25"],
  ["25_to_29", "25–29"],
  ["30_to_34", "30–34"],
  ["35_to_44", "35–44"],
  ["45_to_54", "45–54"],
  ["55_and_older", "55+"],
];

const NOTICEABLE = 0.05;
const GENDER_LEAN = 0.1;

export function averageAudience(entries: readonly AnchorAudience[]): AudiencePortrait | undefined {
  if (entries.length === 0) return undefined;
  const mean = (pick: (entry: AnchorAudience) => number | undefined) =>
    entries.reduce((sum, entry) => sum + (pick(entry) ?? 0), 0) / entries.length;
  const age = Object.fromEntries(AGE_BANDS.map(([key]) => [key, mean((entry) => entry.age[key])]));
  const gender = {
    male: mean((entry) => entry.gender.male),
    female: mean((entry) => entry.gender.female),
  };
  return { age, gender, byAnchor: [...entries] };
}

export function peakAge(age: Readonly<Record<string, number>>): string | undefined {
  let best: readonly [string, string] | undefined;
  for (const band of AGE_BANDS) {
    const value = age[band[0]] ?? 0;
    if (value > NOTICEABLE && (!best || value > (age[best[0]] ?? 0))) best = band;
  }
  return best?.[1];
}

export function genderLean(gender: Readonly<Record<string, number>>): string {
  const male = gender.male ?? 0;
  if (male >= GENDER_LEAN) return "more men";
  if (male <= -GENDER_LEAN) return "more women";
  return "mixed";
}

export function describeAnchorAudience(entry: AnchorAudience): string {
  return `${peakAge(entry.age) ?? "all ages"} · ${genderLean(entry.gender)}`;
}

export function describeAudience(portrait: AudiencePortrait): string {
  const peaks = new Set(portrait.byAnchor.map((entry) => peakAge(entry.age) ?? "all ages"));
  const lean = genderLean(portrait.gender);
  const gender = lean === "mixed" ? "a mixed gender split" : lean;
  if (peaks.size > 2) {
    return `Your anchors pull different age groups; together they lean ${peakAge(portrait.age) ?? "toward no single age"}, with ${gender}.`;
  }
  return `Together your anchors lean ${peakAge(portrait.age) ?? "toward no single age"}, with ${gender}.`;
}
