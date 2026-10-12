import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DemoSource } from "../qloo/client.js";
import { isNotFound } from "../qloo/cache.js";
import type { QlooEndpoint, QlooParams } from "../qloo/params.js";

const INSIGHT_FIXTURES: Readonly<Record<string, string>> = {
  "urn:heatmap": "heatmap",
  "urn:entity:place": "places",
  "urn:entity:artist": "artists",
  "urn:entity:brand": "brands",
  "urn:tag": "taste-tags",
  "urn:demographics": "demographics",
};

interface FixtureFile {
  synthetic: true;
  generatedAt: string;
  response: unknown;
}

export function fixtureName(endpoint: QlooEndpoint, params: QlooParams): string | undefined {
  if (endpoint === "/search") return "search";
  if (endpoint === "/v2/tags") return "tags";
  const filterType = params["filter.type"];
  return filterType === undefined ? undefined : INSIGHT_FIXTURES[filterType];
}

export class SyntheticFixtures implements DemoSource {
  constructor(private readonly dir: string) {}

  async match(
    endpoint: QlooEndpoint,
    params: QlooParams,
  ): Promise<{ data: unknown; savedAt: string } | undefined> {
    const name = fixtureName(endpoint, params);
    if (!name) return undefined;
    try {
      const file = JSON.parse(
        await readFile(join(this.dir, `${name}.json`), "utf8"),
      ) as FixtureFile;
      return { data: file.response, savedAt: file.generatedAt };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }
}
