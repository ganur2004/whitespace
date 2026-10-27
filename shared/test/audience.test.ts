import { describe, expect, it } from "vitest";
import {
  averageAudience,
  describeAnchorAudience,
  describeAudience,
  genderLean,
  peakAge,
  type AnchorAudience,
} from "@whitespace/shared";

const entry = (anchorId: string, peak: string, male: number): AnchorAudience => ({
  anchorId,
  age: {
    "24_and_younger": -0.1,
    "25_to_29": -0.1,
    "30_to_34": -0.1,
    "35_to_44": -0.1,
    "45_to_54": -0.1,
    "55_and_older": -0.1,
    [peak]: 0.4,
  },
  gender: { male, female: -male },
});

describe("audience portrait", () => {
  it("averages anchors and keeps each one", () => {
    const portrait = averageAudience([entry("a", "25_to_29", 0.2), entry("b", "25_to_29", 0)])!;

    expect(portrait.age["25_to_29"]).toBeCloseTo(0.4);
    expect(portrait.age["55_and_older"]).toBeCloseTo(-0.1);
    expect(portrait.gender.male).toBeCloseTo(0.1);
    expect(portrait.byAnchor.map((anchor) => anchor.anchorId)).toEqual(["a", "b"]);
    expect(averageAudience([])).toBeUndefined();
  });

  it("names the peak age band only when it stands out", () => {
    expect(peakAge(entry("a", "35_to_44", 0).age)).toBe("35–44");
    expect(peakAge({ "25_to_29": 0.02, "55_and_older": -0.3 })).toBeUndefined();
  });

  it("calls a gender lean only past the threshold", () => {
    expect(genderLean({ male: 0.16 })).toBe("more men");
    expect(genderLean({ male: -0.2 })).toBe("more women");
    expect(genderLean({ male: 0.05 })).toBe("mixed");
  });

  it("describes one anchor and the whole set", () => {
    expect(describeAnchorAudience(entry("a", "55_and_older", -0.2))).toBe("55+ · more women");

    const agreeing = averageAudience([entry("a", "25_to_29", 0.3), entry("b", "25_to_29", 0.1)])!;
    expect(describeAudience(agreeing)).toBe("Together your anchors lean 25–29, with more men.");

    const mixed = averageAudience([
      entry("a", "25_to_29", 0),
      entry("b", "35_to_44", 0),
      entry("c", "55_and_older", 0),
    ])!;
    expect(describeAudience(mixed)).toBe(
      "Your anchors pull different age groups (25–29, 35–44 and 55+), with a mixed gender split.",
    );
  });
});
