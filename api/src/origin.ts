import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const ORIGIN_SECRET_HEADER = "x-origin-secret";

export function requireOriginSecret(secret: string): MiddlewareHandler {
  const expected = Buffer.from(secret);
  return async (c, next) => {
    const given = Buffer.from(c.req.header(ORIGIN_SECRET_HEADER) ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  };
}
