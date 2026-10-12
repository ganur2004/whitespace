import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

serve({ fetch: createApp(config).fetch, port: config.port }, ({ port }) => {
  const mode = config.demoMode ? "demo data" : config.qlooApiKey ? "live Qloo API" : "no Qloo key";
  console.log(`Whitespace API on http://localhost:${port} (${mode})`);
});
