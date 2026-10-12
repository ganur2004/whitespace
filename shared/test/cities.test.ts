import { describe, expect, it } from "vitest";
import { CITIES, DEFAULT_CITY_ID, distanceMeters, findCity, inBBox } from "@whitespace/shared";

describe("supported cities", () => {
  it("have unique ids and a center inside their bounding box", () => {
    expect(new Set(CITIES.map((city) => city.id)).size).toBe(CITIES.length);
    for (const city of CITIES) {
      expect(inBBox(city.center, city.bbox), city.id).toBe(true);
    }
  });

  it("include the default city", () => {
    expect(findCity(DEFAULT_CITY_ID)).toBeDefined();
    expect(findCity("atlantis")).toBeUndefined();
  });
});

describe("distanceMeters", () => {
  it("measures known distances", () => {
    expect(distanceMeters([-97.7431, 30.2672], [-97.7431, 30.2672])).toBe(0);
    const austinToBrooklyn = distanceMeters([-97.7431, 30.2672], [-73.9442, 40.6782]);
    expect(austinToBrooklyn / 1000).toBeCloseTo(2440, -1);
  });
});
