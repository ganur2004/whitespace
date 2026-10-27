import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { clientAddress } from "../src/limits.js";

describe("requests through CloudFront", () => {
  it("rejects requests without the origin secret", async () => {
    const app = createApp(loadConfig({ DEMO_MODE: "true", ORIGIN_SECRET: "s3cret" }));

    expect((await app.request("/health")).status).toBe(403);
    expect(
      (await app.request("/health", { headers: { "x-origin-secret": "wrong!" } })).status,
    ).toBe(403);
    expect(
      (await app.request("/health", { headers: { "x-origin-secret": "s3cret" } })).status,
    ).toBe(200);
  });

  it("takes the client address from CloudFront-Viewer-Address", async () => {
    const app = new Hono().get("/", (c) => c.text(clientAddress(c, true)));
    const address = async (viewer: string) =>
      (
        await app.request("/", {
          headers: { "cloudfront-viewer-address": viewer, "x-forwarded-for": "198.51.100.1" },
        })
      ).text();

    expect(await address("203.0.113.9:46532")).toBe("203.0.113.9");
    expect(await address("2001:db8::7:46532")).toBe("2001:db8::7");
  });
});
