import type { SupportedCity } from "./types.js";

const AUSTIN: SupportedCity = {
  id: "austin",
  name: "Austin, TX",
  center: [-97.7431, 30.2672],
  bbox: [-97.94, 30.1, -97.56, 30.52],
  localityId: "C93C0541-F43D-484E-AC86-E27A54E5B1D0",
};

export const CITIES: readonly SupportedCity[] = [
  AUSTIN,
  {
    id: "brooklyn",
    name: "Brooklyn, NY",
    center: [-73.9442, 40.6782],
    bbox: [-74.05, 40.56, -73.83, 40.74],
    localityId: "86BAEBAE-2980-43B6-9E75-2A5CDB898628",
  },
  {
    id: "chicago",
    name: "Chicago, IL",
    center: [-87.6298, 41.8781],
    bbox: [-87.94, 41.64, -87.52, 42.03],
    localityId: "27748652-BB63-461D-9C65-207D06E18716",
  },
];

export const DEFAULT_CITY = AUSTIN;

export const DEFAULT_CITY_ID = AUSTIN.id;

export function findCity(id: string): SupportedCity | undefined {
  return CITIES.find((city) => city.id === id);
}
