import { Hono, type Context } from "hono";
import { z } from "zod";
import type { TraceStep } from "@whitespace/shared";
import { clientAddress, type IpRateLimiter } from "../limits.js";
import { QlooError, type QlooClient } from "../qloo/client.js";
import { profileZones, type ZoneShape } from "../profile/profile.js";

const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const profileRequestSchema = z.object({
  anchorIds: z.array(z.string().min(1).max(64)).min(1).max(10),
  categoryTagIds: z.array(z.string().min(1).max(120)).max(5).default([]),
  zones: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        rank: z.number().int().min(1).max(10).optional(),
        polygon: z.object({
          type: z.literal("Polygon"),
          coordinates: z.array(z.array(coordinate).min(4).max(120)).length(1),
        }),
      }),
    )
    .min(1)
    .max(5),
});

export interface ProfileRouteOptions {
  limiter: IpRateLimiter;
  trustProxy: boolean;
}

export function profileRoutes(qloo: QlooClient, options: ProfileRouteOptions): Hono {
  const routes = new Hono();

  routes.post("/api/profile", async (c: Context) => {
    const parsed = profileRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
    }

    const client = clientAddress(c, options.trustProxy);
    const verdict = options.limiter.take(client);
    if (!verdict.ok) {
      c.header("Retry-After", String(verdict.retryAfterSeconds));
      return c.json({ error: "Too many profile requests. Try again shortly." }, 429);
    }

    const trace: TraceStep[] = [];
    let demo = false;
    let failures = 0;
    const zones: ZoneShape[] = parsed.data.zones.map(({ id, rank, polygon }) =>
      rank === undefined ? { id, polygon } : { id, rank, polygon },
    );
    const profiles = await profileZones(
      zones,
      parsed.data.anchorIds.join(","),
      new Set(parsed.data.categoryTagIds),
      async (endpoint, params, label) => {
        const result = await qloo.get(endpoint, params, label);
        trace.push(result.trace);
        if (result.source === "recorded" || result.source === "synthetic") demo = true;
        return result;
      },
      (zone, error) => {
        failures += 1;
        if (!(error instanceof QlooError)) console.error(`profile of ${zone.id} failed`, error);
      },
    );

    if (trace.every((step) => step.cached)) options.limiter.refund(client);
    if (failures === zones.length) {
      return c.json({ error: "Qloo is not answering right now. Try again in a minute." }, 502);
    }
    return c.json({ profiles, trace, demo });
  });

  return routes;
}
