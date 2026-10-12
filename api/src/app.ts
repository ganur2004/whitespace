import { Hono } from "hono";
import type { HealthStatus } from "@whitespace/shared";
import type { Config } from "./config.js";
import type { QlooClient } from "./qloo/client.js";
import { createQlooClient } from "./qloo/create.js";
import { scoutRoutes } from "./routes/scout.js";

export interface AppDeps {
  qloo?: QlooClient;
}

export function createApp(config: Config, deps: AppDeps = {}): Hono {
  const app = new Hono();
  const qloo = deps.qloo ?? createQlooClient(config);

  app.get("/health", (c) => {
    const body: HealthStatus = {
      ok: true,
      demo: config.demoMode,
      qlooKey: config.qlooApiKey !== undefined,
    };
    return c.json(body);
  });

  app.route("/", scoutRoutes(qloo));

  return app;
}
