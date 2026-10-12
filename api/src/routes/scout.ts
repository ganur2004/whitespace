import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Anchor, ScoutEvent, ScoutResult } from "@whitespace/shared";
import { clientAddress, type IpRateLimiter } from "../limits.js";
import { QlooError, type QlooClient } from "../qloo/client.js";
import { QlooParamError } from "../qloo/params.js";
import { ScoutInputError, runScout, type ScoutInput } from "../scout/pipeline.js";

const anchorSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.string(),
  source: z.enum(["agent", "user"]),
  localCompetitor: z.boolean().optional(),
});

const scoutRequestSchema = z.object({
  concept: z.string().max(1000).default(""),
  cityId: z.string().min(1),
  anchors: z.array(anchorSchema).min(1).max(10),
  categoryTags: z
    .array(z.object({ id: z.string().min(1), name: z.string() }))
    .max(5)
    .default([]),
  params: z
    .object({
      competitionWeight: z.number().min(0).max(1).optional(),
      minAffinity: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

type ScoutRequest = z.infer<typeof scoutRequestSchema>;

function toInput(request: ScoutRequest): ScoutInput {
  const anchors: Anchor[] = request.anchors.map(({ localCompetitor, ...anchor }) =>
    localCompetitor === undefined ? anchor : { ...anchor, localCompetitor },
  );
  const input: ScoutInput = {
    concept: request.concept,
    cityId: request.cityId,
    anchors,
    categoryTags: request.categoryTags,
  };
  const params: ScoutInput["params"] = {};
  if (request.params?.competitionWeight !== undefined) {
    params.competitionWeight = request.params.competitionWeight;
  }
  if (request.params?.minAffinity !== undefined) params.minAffinity = request.params.minAffinity;
  if (Object.keys(params).length > 0) input.params = params;
  return input;
}

function describeFailure(error: unknown): { status: 400 | 502 | 500; message: string } {
  if (error instanceof ScoutInputError) return { status: 400, message: error.message };
  if (error instanceof QlooError) {
    return {
      status: 502,
      message: `Qloo is not answering right now${error.status ? ` (HTTP ${error.status})` : ""}. Try again in a minute.`,
    };
  }
  if (error instanceof QlooParamError) {
    return { status: 500, message: "The request to Qloo was malformed." };
  }
  return { status: 500, message: "Something went wrong while analysing this city." };
}

export interface ScoutRouteOptions {
  limiter: IpRateLimiter;
  trustProxy: boolean;
}

export function scoutRoutes(qloo: QlooClient, options: ScoutRouteOptions): Hono {
  const routes = new Hono();

  routes.post("/api/scout", async (c: Context) => {
    const parsed = scoutRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
    }
    const input = toInput(parsed.data);

    const client = clientAddress(c, options.trustProxy);
    const verdict = options.limiter.take(client);
    if (!verdict.ok) {
      c.header("Retry-After", String(verdict.retryAfterSeconds));
      return c.json(
        {
          error: `Too many analyses from this address. Try again in ${verdict.retryAfterSeconds} s.`,
        },
        429,
      );
    }

    const started = Date.now();
    const finish = (result: ScoutResult): ScoutResult => {
      const live = result.trace.filter((step) => !step.cached).length;
      if (live === 0) options.limiter.refund(client);
      console.log(
        `scout city=${input.cityId} ms=${Date.now() - started} calls=${result.trace.length} live=${live} zones=${result.zones.length}${result.demo ? " demo" : ""}`,
      );
      return result;
    };
    const fail = (error: unknown) => {
      const failure = describeFailure(error);
      if (failure.status === 400) options.limiter.refund(client);
      else console.error("scout failed", error);
      return failure;
    };

    if (c.req.query("format") === "json") {
      try {
        return c.json(finish(await runScout(input, qloo)));
      } catch (error) {
        const failure = fail(error);
        return c.json({ error: failure.message }, failure.status);
      }
    }

    return streamSSE(c, async (stream) => {
      let pending = Promise.resolve();
      const send = (event: ScoutEvent): void => {
        pending = pending.then(() =>
          stream.writeSSE({ event: event.type, data: JSON.stringify(event) }),
        );
      };
      try {
        finish(await runScout(input, qloo, send));
      } catch (error) {
        send({ type: "error", message: fail(error).message });
      }
      await pending;
    });
  });

  return routes;
}
