import { resolve } from "node:path";

const API_ROOT = resolve(import.meta.dirname, "..");

export const DEFAULT_QLOO_BASE_URL = "https://hackathon.api.qloo.com";
export const DEFAULT_BEDROCK_MODEL = "anthropic.claude-opus-5-5";
export const DEFAULT_BEDROCK_FALLBACK_MODEL = "anthropic.claude-opus-4-8";
export const DEFAULT_AWS_REGION = "us-east-1";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const DEFAULT_ANTHROPIC_FALLBACK_MODEL = "claude-opus-4-8";

interface LlmModels {
  model: string;
  fallbackModel?: string;
}

export interface BedrockLlmConfig extends LlmModels {
  provider: "bedrock";
  region: string;
}

export interface AnthropicLlmConfig extends LlmModels {
  provider: "anthropic";
  apiKey: string;
}

export type LlmConfig = BedrockLlmConfig | AnthropicLlmConfig;

export interface Config {
  port: number;
  qlooBaseUrl: string;
  qlooApiKey: string | undefined;
  demoMode: boolean;
  cacheDir: string;
  fixturesDir: string;
  webDist: string;
  trustProxy: boolean;
  scoutBurst: number;
  scoutPerMinute: number;
  profileBurst: number;
  profilePerMinute: number;
  chatBurst: number;
  chatPerMinute: number;
  llm: LlmConfig | undefined;
}

const positive = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const hasAwsCredentials = (env: Record<string, string | undefined>): boolean =>
  Boolean(
    env.AWS_BEARER_TOKEN_BEDROCK ||
    (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) ||
    env.AWS_PROFILE ||
    env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
    env.AWS_WEB_IDENTITY_TOKEN_FILE,
  );

const fallbackModel = (value: string | undefined, fallback: string): string | undefined => {
  const model = (value ?? fallback).trim();
  return model && model !== "none" ? model : undefined;
};

function loadBedrockConfig(env: Record<string, string | undefined>): BedrockLlmConfig {
  const config: BedrockLlmConfig = {
    provider: "bedrock",
    region: env.AWS_REGION || env.AWS_DEFAULT_REGION || DEFAULT_AWS_REGION,
    model: env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL,
  };
  const fallback = fallbackModel(env.BEDROCK_FALLBACK_MODEL_ID, DEFAULT_BEDROCK_FALLBACK_MODEL);
  if (fallback) config.fallbackModel = fallback;
  return config;
}

function loadAnthropicConfig(
  env: Record<string, string | undefined>,
): AnthropicLlmConfig | undefined {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return undefined;
  const config: AnthropicLlmConfig = {
    provider: "anthropic",
    apiKey,
    model: env.ANTHROPIC_MODEL_ID || DEFAULT_ANTHROPIC_MODEL,
  };
  const fallback = fallbackModel(env.ANTHROPIC_FALLBACK_MODEL_ID, DEFAULT_ANTHROPIC_FALLBACK_MODEL);
  if (fallback) config.fallbackModel = fallback;
  return config;
}

export function loadLlmConfig(env: Record<string, string | undefined>): LlmConfig | undefined {
  const provider = env.LLM_PROVIDER?.trim().toLowerCase();
  if (provider === "none") return undefined;
  if (provider === "anthropic") return loadAnthropicConfig(env);
  if (provider === "bedrock") return loadBedrockConfig(env);
  return loadAnthropicConfig(env) ?? (hasAwsCredentials(env) ? loadBedrockConfig(env) : undefined);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: Number(env.PORT) || 8787,
    qlooBaseUrl: env.QLOO_BASE_URL || DEFAULT_QLOO_BASE_URL,
    qlooApiKey: env.QLOO_API_KEY || undefined,
    demoMode: env.DEMO_MODE === "true",
    cacheDir: env.QLOO_CACHE_DIR || resolve(API_ROOT, "recordings"),
    fixturesDir: env.FIXTURES_DIR || resolve(API_ROOT, "fixtures"),
    webDist: env.WEB_DIST || resolve(API_ROOT, "../web/dist"),
    trustProxy: env.TRUST_PROXY !== "false",
    scoutBurst: positive(env.SCOUT_LIMIT_BURST, 8),
    scoutPerMinute: positive(env.SCOUT_LIMIT_PER_MINUTE, 3),
    profileBurst: positive(env.PROFILE_LIMIT_BURST, 20),
    profilePerMinute: positive(env.PROFILE_LIMIT_PER_MINUTE, 10),
    chatBurst: positive(env.CHAT_LIMIT_BURST, 12),
    chatPerMinute: positive(env.CHAT_LIMIT_PER_MINUTE, 4),
    llm: loadLlmConfig(env),
  };
}
