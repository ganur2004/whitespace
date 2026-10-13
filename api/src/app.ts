import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { HealthStatus } from "@whitespace/shared";
import type { Config } from "./config.js";
import { IpRateLimiter } from "./limits.js";
import type { QlooClient } from "./qloo/client.js";
import { createQlooClient } from "./qloo/create.js";
import { profileRoutes } from "./routes/profile.js";
import { scoutRoutes } from "./routes/scout.js";

export interface AppDeps {
  qloo?: QlooClient;
  scoutLimiter?: IpRateLimiter;
  profileLimiter?: IpRateLimiter;
}

const MAX_BODY_BYTES = 64 * 1024;

export function createApp(config: Config, deps: AppDeps = {}): Hono {
  const app = new Hono();
  const qloo = deps.qloo ?? createQlooClient(config);
  const limiter = deps.scoutLimiter ?? new IpRateLimiter(config.scoutBurst, config.scoutPerMinute);
  const profileLimiter =
    deps.profileLimiter ?? new IpRateLimiter(config.profileBurst, config.profilePerMinute);

  app.use(secureHeaders());
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "Request body is too large" }, 413),
    }),
  );

  app.get("/health", (c) => {
    const body: HealthStatus = {
      ok: true,
      demo: config.demoMode,
      qlooKey: config.qlooApiKey !== undefined,
    };
    return c.json(body);
  });

  app.route("/", scoutRoutes(qloo, { limiter, trustProxy: config.trustProxy }));
  app.route("/", profileRoutes(qloo, { limiter: profileLimiter, trustProxy: config.trustProxy }));
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  const indexFile = join(config.webDist, "index.html");
  if (existsSync(indexFile)) {
    const indexHtml = readFileSync(indexFile, "utf8");
    app.use("*", async (c, next) => {
      await next();
      if (c.req.path.startsWith("/api/") || c.res.status !== 200) return;
      if (c.req.path.startsWith("/assets/")) {
        c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      } else if (c.res.headers.get("content-type")?.startsWith("text/html")) {
        c.res.headers.set("Cache-Control", "no-cache");
      }
    });
    app.use("/*", serveStatic({ root: config.webDist }));
    app.get("*", (c) => c.html(indexHtml));
  }

  return app;
}
