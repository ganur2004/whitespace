import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

export type Verdict = { ok: true } | { ok: false; retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  updated: number;
}

export class IpRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly burst: number,
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly maxClients = 10_000,
  ) {}

  take(client: string): Verdict {
    const bucket = this.refill(client);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }
    const secondsPerToken = 60 / this.perMinute;
    return { ok: false, retryAfterSeconds: Math.ceil((1 - bucket.tokens) * secondsPerToken) };
  }

  refund(client: string): void {
    const bucket = this.refill(client);
    bucket.tokens = Math.min(this.burst, bucket.tokens + 1);
  }

  private refill(client: string): Bucket {
    const now = this.now();
    const existing = this.buckets.get(client);
    if (existing) {
      const elapsedMinutes = (now - existing.updated) / 60_000;
      existing.tokens = Math.min(this.burst, existing.tokens + elapsedMinutes * this.perMinute);
      existing.updated = now;
      this.buckets.delete(client);
      this.buckets.set(client, existing);
      return existing;
    }
    const created: Bucket = { tokens: this.burst, updated: now };
    this.buckets.set(client, created);
    for (const oldest of this.buckets.keys()) {
      if (this.buckets.size <= this.maxClients) break;
      this.buckets.delete(oldest);
    }
    return created;
  }
}

export function clientAddress(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded =
      c.req.header("fly-client-ip") ??
      c.req.header("cf-connecting-ip") ??
      withoutPort(c.req.header("cloudfront-viewer-address")) ??
      c.req.header("x-forwarded-for")?.split(",")[0];
    if (forwarded?.trim()) return forwarded.trim();
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

function withoutPort(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const colon = address.lastIndexOf(":");
  return colon > 0 ? address.slice(0, colon) : address;
}
