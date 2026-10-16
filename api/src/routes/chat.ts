import { Hono, type Context } from "hono";
import { z } from "zod";
import { Analysis, type AnalysisState } from "../agent/analysis.js";
import { chat } from "../agent/agent.js";
import { clientAddress, type IpRateLimiter } from "../limits.js";
import type { LlmClient } from "../llm/client.js";
import type { QlooClient } from "../qloo/client.js";

const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const polygon = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(coordinate).min(4).max(400)).length(1),
});
const unit = z.number().min(0).max(1);

const placeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  neighborhood: z.string().max(200).optional(),
  affinity: unit.optional(),
  priceLevel: z.number().optional(),
  tags: z.array(z.string().max(120)).max(80).default([]),
  drivers: z
    .array(z.object({ anchorId: z.string().max(64), score: unit }))
    .max(10)
    .optional(),
  sharedTags: z.array(z.string().max(120)).max(20).optional(),
});

const anchorSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  type: z.string().max(64),
  source: z.enum(["agent", "user"]),
  localCompetitor: z.boolean().optional(),
});

const stateSchema = z.object({
  concept: z.string().max(1000),
  cityId: z.string().min(1).max(40),
  anchors: z.array(anchorSchema).min(1).max(10),
  categoryTags: z.array(z.object({ id: z.string().max(120), name: z.string().max(120) })).max(5),
  params: z.object({
    competitionWeight: unit,
    minAffinity: unit,
    excludePolygons: z.array(polygon).max(10),
  }),
  cells: z
    .array(
      z.union([
        z.tuple([z.string().min(1).max(12), unit]),
        z.tuple([z.string().min(1).max(12), unit, unit]),
      ]),
    )
    .max(8000),
  competitors: z.array(placeSchema).max(400),
  zones: z
    .array(
      z.object({
        id: z.string().max(64),
        profile: z
          .object({
            neighborhood: z.string().max(200).optional(),
            tastePlaces: z.array(placeSchema).max(12),
            brief: z.string().max(2000).optional(),
          })
          .optional(),
      }),
    )
    .max(10),
  audience: z
    .object({
      age: z.record(z.string(), z.number()),
      gender: z.record(z.string(), z.number()),
      byAnchor: z
        .array(
          z.object({
            anchorId: z.string().max(64),
            age: z.record(z.string(), z.number()),
            gender: z.record(z.string(), z.number()),
          }),
        )
        .max(10),
    })
    .optional(),
  demo: z.boolean().default(false),
});

const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(2000) }))
    .min(1)
    .max(40)
    .refine((messages) => messages.at(-1)?.role === "user", "The last message must be the user's"),
  state: stateSchema.optional(),
});

export interface ChatRouteOptions {
  limiter: IpRateLimiter;
  trustProxy: boolean;
}

export function chatRoutes(
  qloo: QlooClient,
  llm: LlmClient | undefined,
  options: ChatRouteOptions,
): Hono {
  const routes = new Hono();

  routes.post("/api/chat", async (c: Context) => {
    const parsed = chatRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
    }

    const client = clientAddress(c, options.trustProxy);
    const verdict = options.limiter.take(client);
    if (!verdict.ok) {
      c.header("Retry-After", String(verdict.retryAfterSeconds));
      return c.json(
        {
          error: `Too many messages from this address. Try again in ${verdict.retryAfterSeconds} s.`,
        },
        429,
      );
    }

    let analysis: Analysis;
    try {
      analysis = new Analysis(qloo, parsed.data.state as unknown as AnalysisState | undefined);
    } catch (error) {
      options.limiter.refund(client);
      return c.json(
        { error: error instanceof Error ? error.message : "Invalid analysis state" },
        400,
      );
    }

    const started = Date.now();
    try {
      const reply = await chat(parsed.data.messages, analysis, { qloo, llm });
      console.log(
        `chat mode=${reply.mode} ms=${Date.now() - started} calls=${analysis.trace.length} live=${analysis.trace.filter((step) => !step.cached).length}${reply.result ? " result" : ""}`,
      );
      return c.json(reply);
    } catch (error) {
      console.error("chat failed", error);
      return c.json({ error: "The assistant could not answer. Try again in a minute." }, 500);
    }
  });

  return routes;
}
