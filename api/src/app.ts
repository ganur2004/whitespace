import { Hono } from "hono";
import type { HealthStatus } from "@whitespace/shared";
import type { Config } from "./config.js";

export function createApp(config: Config): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    const body: HealthStatus = {
      ok: true,
      demo: config.demoMode,
      qlooKey: config.qlooApiKey !== undefined,
    };
    return c.json(body);
  });

  return app;
}
