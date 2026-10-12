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
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: Number(env.PORT) || 8787,
    qlooBaseUrl: env.QLOO_BASE_URL || DEFAULT_QLOO_BASE_URL,
    qlooApiKey: env.QLOO_API_KEY || undefined,
    demoMode: env.DEMO_MODE === "true",
    cacheDir: env.QLOO_CACHE_DIR || resolve(API_ROOT, "recordings"),
    fixturesDir: env.FIXTURES_DIR || resolve(API_ROOT, "fixtures"),
  };
}
