import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { DEFAULT_QLOO_BASE_URL, loadConfig } from "../src/config.js";

describe("config", () => {
  it("defaults to the hackathon base URL and live mode", () => {
    const config = loadConfig({});
    expect(config.qlooBaseUrl).toBe(DEFAULT_QLOO_BASE_URL);
    expect(config.qlooApiKey).toBeUndefined();
    expect(config.demoMode).toBe(false);
    expect(config.port).toBe(8787);
    expect(config.cacheDir).toMatch(/api[/\\]recordings$/);
    expect(config.fixturesDir).toMatch(/api[/\\]fixtures$/);
  });

  it("reads the environment", () => {
    const config = loadConfig({ QLOO_API_KEY: "k", DEMO_MODE: "true", PORT: "9000" });
    expect(config).toMatchObject({ qlooApiKey: "k", demoMode: true, port: 9000 });
  });
});

describe("GET /health", () => {
  it("reports the data mode without exposing the key", async () => {
    const response = await createApp(loadConfig({ QLOO_API_KEY: "secret" })).request("/health");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, demo: false, qlooKey: true });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
