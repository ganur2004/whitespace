import { resolve } from "node:path";

const API_ROOT = resolve(import.meta.dirname, "..");

export const DEFAULT_QLOO_BASE_URL = "https://hackathon.api.qloo.com";

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
}

const positive = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

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
  };
}
