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

  it("turns the LLM on only with Bedrock credentials or an explicit provider", () => {
    expect(loadConfig({}).llm).toBeUndefined();
    expect(loadConfig({ AWS_BEARER_TOKEN_BEDROCK: "token" }).llm).toEqual({
      provider: "bedrock",
      region: "us-east-1",
      model: "anthropic.claude-opus-5-5",
      fallbackModel: "anthropic.claude-opus-4-8",
    });
    expect(
      loadConfig({
        AWS_ACCESS_KEY_ID: "id",
        AWS_SECRET_ACCESS_KEY: "secret",
        AWS_REGION: "eu-west-1",
        BEDROCK_MODEL_ID: "anthropic.claude-sonnet-5-5",
        BEDROCK_FALLBACK_MODEL_ID: "none",
      }).llm,
    ).toEqual({ provider: "bedrock", region: "eu-west-1", model: "anthropic.claude-sonnet-5-5" });
    expect(loadConfig({ AWS_PROFILE: "demo", LLM_PROVIDER: "none" }).llm).toBeUndefined();
    expect(loadConfig({ LLM_PROVIDER: "bedrock" }).llm?.model).toBe("anthropic.claude-opus-5-5");
  });

  it("prefers the Anthropic API when its key is set", () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: "key" }).llm).toEqual({
      provider: "anthropic",
      apiKey: "key",
      model: "claude-sonnet-5-5",
      fallbackModel: "claude-opus-4-8",
    });
    expect(
      loadConfig({
        ANTHROPIC_API_KEY: "key",
        AWS_PROFILE: "demo",
        ANTHROPIC_MODEL_ID: "claude-opus-5-5",
        ANTHROPIC_FALLBACK_MODEL_ID: "none",
      }).llm,
    ).toEqual({ provider: "anthropic", apiKey: "key", model: "claude-opus-5-5" });
    expect(
      loadConfig({ ANTHROPIC_API_KEY: "key", AWS_PROFILE: "demo", LLM_PROVIDER: "bedrock" }).llm
        ?.provider,
    ).toBe("bedrock");
    expect(loadConfig({ LLM_PROVIDER: "anthropic", AWS_PROFILE: "demo" }).llm).toBeUndefined();
    expect(loadConfig({ ANTHROPIC_API_KEY: "key", LLM_PROVIDER: "none" }).llm).toBeUndefined();
    expect(loadConfig({ ANTHROPIC_API_KEY: "" }).llm).toBeUndefined();
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
    expect(body).toEqual({ ok: true, demo: false, qlooKey: true, llm: false });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("reports the LLM without exposing its key", async () => {
    const response = await createApp(loadConfig({ ANTHROPIC_API_KEY: "llm-secret" })).request(
      "/health",
    );

    const body = await response.json();
    expect(body).toMatchObject({ llm: true });
    expect(JSON.stringify(body)).not.toContain("llm-secret");
  });
});
