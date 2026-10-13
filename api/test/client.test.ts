import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyntheticFixtures } from "../src/demo/fixtures.js";
import { FileStore, type ResponseStore, type StoredResponse } from "../src/qloo/cache.js";
import {
  QlooClient,
  QlooError,
  countResults,
  encodeQuery,
  type QlooClientOptions,
} from "../src/qloo/client.js";
import { Limiter } from "../src/qloo/limiter.js";
import { QlooParamError } from "../src/qloo/params.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "../fixtures");
const HEATMAP_PARAMS = {
  "filter.type": "urn:heatmap",
  "signal.interests.entities": "B,A",
  "filter.location.query": "Austin",
};
const PLACE_BODY = { success: true, results: { entities: [{ name: "One" }, { name: "Two" }] } };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

class MapStore implements ResponseStore {
  readonly entries = new Map<string, StoredResponse>();
  async get(key: string): Promise<StoredResponse | undefined> {
    return this.entries.get(key);
  }
  async set(entry: StoredResponse): Promise<void> {
    this.entries.set(entry.key, entry);
  }
}

function setup(overrides: Partial<QlooClientOptions> = {}) {
  let clock = Date.parse("2026-10-12T00:00:00.000Z");
  const fetchMock = vi.fn<typeof fetch>();
  const sleep = vi.fn(async () => {});
  const logger = { warn: vi.fn() };
  const client = new QlooClient({
    baseUrl: "https://hackathon.api.qloo.com/",
    apiKey: "secret-key",
    demo: false,
    fetch: fetchMock,
    sleep,
    logger,
    now: () => clock,
    limiter: new Limiter({ maxConcurrent: 5, ratePerSecond: 1000 }),
    ...overrides,
  });
  return {
    client,
    fetchMock,
    sleep,
    logger,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("QlooClient live requests", () => {
  it("sends the key as X-Api-Key with sorted, encoded params and keeps it out of the trace", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(json(PLACE_BODY));

    const result = await client.get(
      "/v2/insights",
      {
        "filter.type": "urn:entity:place",
        "filter.location": "POINT(-97.74 30.27)",
        "signal.interests.entities": "a,b",
      },
      "Competitors",
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://hackathon.api.qloo.com/v2/insights?filter.location=POINT(-97.74%2030.27)&filter.type=urn%3Aentity%3Aplace&signal.interests.entities=a%2Cb",
    );
    expect(new Headers(init?.headers).get("X-Api-Key")).toBe("secret-key");
    expect(result.source).toBe("live");
    expect(result.trace).toMatchObject({
      label: "Competitors",
      endpoint: "/v2/insights",
      resultCount: 2,
      cached: false,
    });
    expect(result.trace.cachedAt).toBeUndefined();
    expect(JSON.stringify(result.trace)).not.toContain("secret-key");
  });

  it("answers a repeated request from memory regardless of param order", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(json(PLACE_BODY));

    await client.get("/search", { query: "ramen", types: "urn:entity:place" }, "Search");
    const again = await client.get(
      "/search",
      { types: "urn:entity:place", query: "ramen" },
      "Search",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.source).toBe("cache");
    expect(again.trace.cached).toBe(true);
    expect(again.trace.cachedAt).toBe("2026-10-12T00:00:00.000Z");
  });

  it("retries 429 and 5xx with exponential backoff, honouring Retry-After", async () => {
    const { client, fetchMock, sleep } = setup();
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "2" }))
      .mockResolvedValueOnce(json({}, 502))
      .mockResolvedValueOnce(json(PLACE_BODY));

    const result = await client.get("/v2/insights", HEATMAP_PARAMS, "Heatmap");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 1000]);
    expect(result.source).toBe("live");
  });

  it("gives up after three retries", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockImplementation(async () => json({ error: "busy" }, 503));

    const failure = client.get("/v2/insights", HEATMAP_PARAMS, "Heatmap");

    await expect(failure).rejects.toBeInstanceOf(QlooError);
    await expect(failure).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry other client errors", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(json({ error: "No API key found in request" }, 401));

    await expect(client.get("/v2/insights", HEATMAP_PARAMS, "Heatmap")).rejects.toThrow(
      /401.*No API key/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network errors and timeouts", async () => {
    const { client, fetchMock } = setup();
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError"))
      .mockResolvedValueOnce(json(PLACE_BODY));

    const result = await client.get("/v2/insights", HEATMAP_PARAMS, "Heatmap");

    expect(result.trace.resultCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses a fresh stored response without calling Qloo", async () => {
    const store = new MapStore();
    const { client, fetchMock } = setup({ store });
    fetchMock.mockResolvedValueOnce(json(PLACE_BODY));
    await client.get("/v2/insights", HEATMAP_PARAMS, "Heatmap");

    const { client: restarted, fetchMock: secondFetch } = setup({ store });
    const result = await restarted.get("/v2/insights", HEATMAP_PARAMS, "Heatmap");

    expect(secondFetch).not.toHaveBeenCalled();
    expect(result.source).toBe("cache");
    expect(result.trace.resultCount).toBe(2);
  });

  it("serves an old stored response when Qloo fails, and says when it was saved", async () => {
    const store = new MapStore();
    const first = setup({ store });
    first.fetchMock.mockResolvedValueOnce(json(PLACE_BODY));
    await first.client.get("/v2/insights", HEATMAP_PARAMS, "Heatmap");

    const later = setup({ store, storeFreshMs: 1000, memoryTtlMs: 1000 });
    later.advance(60_000);
    later.fetchMock.mockImplementation(async () => json({}, 500));

    const result = await later.client.get("/v2/insights", HEATMAP_PARAMS, "Heatmap");

    expect(result.source).toBe("stale");
    expect(result.trace.cached).toBe(true);
    expect(result.trace.cachedAt).toBe("2026-10-12T00:00:00.000Z");
    expect(later.logger.warn).toHaveBeenCalled();
  });

  it("refuses to call Qloo without a key", async () => {
    const { client, fetchMock } = setup({ apiKey: undefined });

    await expect(client.get("/v2/insights", HEATMAP_PARAMS, "Heatmap")).rejects.toThrow(
      /QLOO_API_KEY/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects parameters outside the allowlist before calling Qloo", async () => {
    const { client, fetchMock } = setup();

    await expect(
      client.get(
        "/v2/insights",
        { ...HEATMAP_PARAMS, "feature.explainability": "true" },
        "Heatmap",
      ),
    ).rejects.toBeInstanceOf(QlooParamError);
    await expect(
      client.get("/v2/insights", { "filter.type": "urn:entity:music" }, "Music"),
    ).rejects.toThrow(/Unsupported filter.type/);
    await expect(
      client.get("/v2/insights", { "filter.type": "urn:entity:place", "filter.tags": " " }, "x"),
    ).rejects.toThrow(/Empty parameter/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects request URLs longer than the limit", async () => {
    const { client, fetchMock } = setup({ maxUrlLength: 200 });
    const ids = Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-${i}`).join(",");

    await expect(
      client.get(
        "/v2/insights",
        { "filter.type": "urn:entity:place", "filter.results.entities": ids },
        "Affinity",
      ),
    ).rejects.toThrow(/split long ID lists/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("warns when a live request returns nothing", async () => {
    const { client, fetchMock, logger } = setup();
    fetchMock.mockResolvedValueOnce(json({ success: true, results: { entities: [] } }));

    const result = await client.get(
      "/v2/insights",
      { "filter.type": "urn:entity:artist", "signal.location.query": "Austin" },
      "Culture",
    );

    expect(result.trace.resultCount).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "Qloo returned no results for /v2/insights",
      expect.objectContaining({ "filter.type": "urn:entity:artist" }),
    );
  });
});

describe("QlooClient demo mode", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "whitespace-recordings-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("never calls Qloo: recorded responses first, then synthetic fixtures", async () => {
    const store = new FileStore(dir);
    const recorder = setup({ store });
    recorder.fetchMock.mockResolvedValueOnce(json(PLACE_BODY));
    await recorder.client.get("/v2/insights", HEATMAP_PARAMS, "Heatmap");

    const demo = setup({ demo: true, store, demoSource: new SyntheticFixtures(FIXTURES_DIR) });
    const recorded = await demo.client.get("/v2/insights", HEATMAP_PARAMS, "Heatmap");
    const synthetic = await demo.client.get(
      "/v2/insights",
      { ...HEATMAP_PARAMS, "filter.location.query": "Brooklyn" },
      "Heatmap",
    );

    expect(demo.fetchMock).not.toHaveBeenCalled();
    expect(recorded.source).toBe("recorded");
    expect(recorded.trace.resultCount).toBe(2);
    expect(synthetic.source).toBe("synthetic");
    expect(synthetic.trace.resultCount).toBeGreaterThan(1000);
    expect(synthetic.trace.cachedAt).toBe("2026-10-12T00:00:00.000Z");
  });

  it("fails clearly when there is no demo data for a request", async () => {
    const demo = setup({ demo: true, demoSource: new SyntheticFixtures(FIXTURES_DIR) });

    await expect(
      demo.client.get("/v2/insights", { "filter.type": "urn:entity:brand" }, "Brands"),
    ).rejects.toThrow(/No demo data/);
    expect(demo.fetchMock).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("encodeQuery sorts by name and percent-encodes values", () => {
    expect(encodeQuery({ b: "x y", a: "1,2" })).toBe("a=1%2C2&b=x%20y");
  });

  it("countResults finds the first result list", () => {
    expect(countResults({ results: [1, 2, 3] })).toBe(3);
    expect(countResults({ results: { heatmap: [1] } })).toBe(1);
    expect(countResults({ results: {} })).toBe(0);
    expect(countResults(null)).toBe(0);
  });
});
