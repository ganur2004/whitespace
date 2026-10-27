import { streamHandle } from "@hono/aws-lambda";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

export const handler: ReturnType<typeof streamHandle> = streamHandle(createApp(loadConfig()));
