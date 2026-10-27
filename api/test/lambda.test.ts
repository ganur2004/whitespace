import { resolve } from "node:path";
import { Writable } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { SCENARIOS } from "@whitespace/shared";

const FIXTURES_DIR = resolve(import.meta.dirname, "../fixtures");
const scenario = SCENARIOS[0]!;

describe("Lambda handler", () => {
  type Metadata = { statusCode: number; headers: Record<string, string> };
  type Handler = (event: unknown, stream: Writable, context: unknown) => Promise<void>;

  vi.stubGlobal("awslambda", {
    streamifyResponse: (handler: Handler) => handler,
    HttpResponseStream: {
      from: (stream: Writable & { metadata?: Metadata }, metadata: Metadata) =>
        Object.assign(stream, { metadata }),
    },
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const invoke = async (method: string, path: string, query: string, body?: unknown) => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("FIXTURES_DIR", FIXTURES_DIR);
    vi.stubEnv("QLOO_CACHE_DIR", resolve(FIXTURES_DIR, "missing"));
    vi.stubEnv("ORIGIN_SECRET", "s3cret");
    vi.stubEnv("LLM_PROVIDER", "none");
    const { handler } = (await import("../src/lambda.js")) as unknown as { handler: Handler };

    const chunks: Buffer[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    }) as Writable & { metadata?: Metadata };
    await handler(
      {
        version: "2.0",
        routeKey: "$default",
        rawPath: path,
        rawQueryString: query,
        headers: {
          host: "fn.lambda-url.ap-southeast-2.on.aws",
          "content-type": "application/json",
          "x-origin-secret": "s3cret",
          "cloudfront-viewer-address": "203.0.113.9:46532",
        },
        requestContext: {
          http: { method, path, protocol: "HTTP/1.1", sourceIp: "130.176.0.1", userAgent: "test" },
          domainName: "fn.lambda-url.ap-southeast-2.on.aws",
          requestId: "request",
          routeKey: "$default",
          stage: "$default",
          time: "27/Oct/2026:00:00:00 +0000",
          timeEpoch: 0,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        isBase64Encoded: false,
      },
      stream,
      {},
    );
    return { metadata: stream.metadata, text: Buffer.concat(chunks).toString("utf8") };
  };

  it("answers /health", async () => {
    const { metadata, text } = await invoke("GET", "/health", "");
    expect(metadata?.statusCode).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ ok: true, demo: true });
  });

  it("streams the scout events as server-sent events", async () => {
    const { metadata, text } = await invoke("POST", "/api/scout", "", {
      concept: scenario.concept,
      cityId: scenario.cityId,
      anchors: scenario.anchors,
      categoryTags: scenario.categoryTags,
    });

    expect(metadata?.statusCode).toBe(200);
    expect(metadata?.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(text).toMatch(/^event: step$/m);
    expect(text).toMatch(/^event: result$/m);
    expect(text).not.toMatch(/^event: error$/m);
  });
});
