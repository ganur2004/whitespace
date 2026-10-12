import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SCENARIOS } from "@whitespace/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SyntheticFixtures } from "../src/demo/fixtures.js";
import { IpRateLimiter } from "../src/limits.js";
import { QlooClient } from "../src/qloo/client.js";

const scenario = SCENARIOS[0]!;
const body = JSON.stringify({
  concept: scenario.concept,
  cityId: scenario.cityId,
  anchors: scenario.anchors,
  categoryTags: scenario.categoryTags,
});

const demoClient = () =>
  new QlooClient({
    baseUrl: "https://hackathon.api.qloo.com",
    apiKey: undefined,
    demo: true,
    demoSource: new SyntheticFixtures(resolve(import.meta.dirname, "../fixtures")),
    logger: { warn: vi.fn() },
  });

const scout = (app: ReturnType<typeof createApp>, address = "203.0.113.7") =>
  app.request("/api/scout?format=json", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${address}, 10.0.0.1` },
    body,
  });

describe("IpRateLimiter", () => {
  it("allows a burst, then refills over time", () => {
    let now = 0;
    const limiter = new IpRateLimiter(2, 6, () => now);

    expect(limiter.take("a")).toEqual({ ok: true });
    expect(limiter.take("a")).toEqual({ ok: true });
    expect(limiter.take("a")).toEqual({ ok: false, retryAfterSeconds: 10 });
    expect(limiter.take("b")).toEqual({ ok: true });

    now += 10_000;
    expect(limiter.take("a")).toEqual({ ok: true });
  });

  it("gives a token back on refund without exceeding the burst", () => {
    const limiter = new IpRateLimiter(1, 1, () => 0);
    limiter.take("a");
    limiter.refund("a");
    limiter.refund("a");
    expect(limiter.take("a")).toEqual({ ok: true });
    expect(limiter.take("a").ok).toBe(false);
  });

  it("forgets the oldest clients beyond its capacity", () => {
    const limiter = new IpRateLimiter(1, 1, () => 0, 2);
    limiter.take("a");
    limiter.take("b");
    limiter.take("c");
    expect(limiter.take("a")).toEqual({ ok: true });
  });
});

describe("rate limiting /api/scout", () => {
  it("answers 429 with Retry-After once an address runs out", async () => {
    const limiter = new IpRateLimiter(1, 3);
    limiter.take("203.0.113.7");
    const app = createApp(loadConfig({ DEMO_MODE: "true" }), {
      qloo: demoClient(),
      scoutLimiter: limiter,
    });

    const response = await scout(app);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("20");
    expect(await response.json()).toEqual({
      error: "Too many analyses from this address. Try again in 20 s.",
    });
  });

  it("does not charge for answers served entirely from cache", async () => {
    const app = createApp(loadConfig({ DEMO_MODE: "true" }), {
      qloo: demoClient(),
      scoutLimiter: new IpRateLimiter(1, 1),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect((await scout(app)).status).toBe(200);
    expect((await scout(app)).status).toBe(200);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^scout city=austin .* live=0 zones=3 demo$/),
    );
    log.mockRestore();
  });

  it("ignores forwarded addresses when the proxy is not trusted", async () => {
    const limiter = new IpRateLimiter(1, 1);
    limiter.take("203.0.113.7");
    const app = createApp(loadConfig({ DEMO_MODE: "true", TRUST_PROXY: "false" }), {
      qloo: demoClient(),
      scoutLimiter: limiter,
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    expect((await scout(app)).status).toBe(200);
    vi.restoreAllMocks();
  });
});

describe("serving the web build", () => {
  let webDist: string;

  beforeAll(async () => {
    webDist = await mkdtemp(join(tmpdir(), "whitespace-web-"));
    await mkdir(join(webDist, "assets"));
    await writeFile(join(webDist, "index.html"), "<!doctype html><title>Whitespace</title>");
    await writeFile(join(webDist, "assets", "app-123.js"), "console.log(1)");
    await writeFile(join(webDist, "favicon.svg"), "<svg/>");
  });

  afterAll(async () => {
    await rm(webDist, { recursive: true, force: true });
  });

  const app = () => createApp(loadConfig({ WEB_DIST: webDist }), { qloo: demoClient() });

  it("serves the page, hashed assets with a long cache, and other static files", async () => {
    const page = await app().request("/");
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(await page.text()).toContain("<title>Whitespace</title>");

    const asset = await app().request("/assets/app-123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    expect((await app().request("/favicon.svg")).status).toBe(200);
  });

  it("falls back to the page for client routes but not for unknown API paths", async () => {
    expect(await (await app().request("/some/route")).text()).toContain("Whitespace");
    const missing = await app().request("/api/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Not found" });
  });

  it("sets security headers and limits the request body", async () => {
    const page = await app().request("/");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("x-frame-options")).toBe("SAMEORIGIN");

    const huge = await app().request("/api/scout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ concept: "x".repeat(70_000) }),
    });
    expect(huge.status).toBe(413);
  });
});
