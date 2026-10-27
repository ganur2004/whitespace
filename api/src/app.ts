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
import type { LlmClient } from "./llm/client.js";
import { createLlmClient } from "./llm/create.js";
import { requireOriginSecret } from "./origin.js";
import { chatRoutes } from "./routes/chat.js";
import { profileRoutes } from "./routes/profile.js";
import { scoutRoutes } from "./routes/scout.js";

export interface AppDeps {
  qloo?: QlooClient;
  scoutLimiter?: IpRateLimiter;
  profileLimiter?: IpRateLimiter;
  chatLimiter?: IpRateLimiter;
  llm?: LlmClient | null;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CHAT_BODY_BYTES = 1024 * 1024;

export function createApp(config: Config, deps: AppDeps = {}): Hono {
  const app = new Hono();
  const qloo = deps.qloo ?? createQlooClient(config);
  const limiter = deps.scoutLimiter ?? new IpRateLimiter(config.scoutBurst, config.scoutPerMinute);
  const profileLimiter =
    deps.profileLimiter ?? new IpRateLimiter(config.profileBurst, config.profilePerMinute);
  const chatLimiter = deps.chatLimiter ?? new IpRateLimiter(config.chatBurst, config.chatPerMinute);
  const llm = deps.llm === null ? undefined : (deps.llm ?? createLlmClient(config));

  app.use(secureHeaders());
  if (config.originSecret) app.use(requireOriginSecret(config.originSecret));
  app.use("/api/*", (c, next) =>
    bodyLimit({
      maxSize: c.req.path === "/api/chat" ? MAX_CHAT_BODY_BYTES : MAX_BODY_BYTES,
      onError: (context) => context.json({ error: "Request body is too large" }, 413),
    })(c, next),
  );

  app.get("/health", (c) => {
    const body: HealthStatus = {
      ok: true,
      demo: config.demoMode,
      qlooKey: config.qlooApiKey !== undefined,
      llm: llm !== undefined,
    };
    return c.json(body);
  });

  app.route("/", scoutRoutes(qloo, { limiter, trustProxy: config.trustProxy, llm }));
  app.route("/", profileRoutes(qloo, { limiter: profileLimiter, trustProxy: config.trustProxy }));
  app.route("/", chatRoutes(qloo, llm, { limiter: chatLimiter, trustProxy: config.trustProxy }));
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
