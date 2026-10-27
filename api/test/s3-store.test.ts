import { describe, expect, it, vi } from "vitest";
import type { StoredResponse } from "../src/qloo/cache.js";
import { S3Store, type S3Sender } from "../src/qloo/s3-store.js";

function memoryBucket() {
  const objects = new Map<string, string>();
  const send = vi.fn(
    async (command: { constructor: { name: string }; input: Record<string, string> }) => {
      const { Key, Body } = command.input;
      if (command.constructor.name === "PutObjectCommand") {
        objects.set(Key!, Body!);
        return {};
      }
      const body = objects.get(Key!);
      if (body === undefined) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      return { Body: { transformToString: async () => body } };
    },
  );
  return { objects, client: { send } as unknown as S3Sender };
}

const entry: StoredResponse = {
  key: "/search?query=ramen",
  endpoint: "/search",
  params: { query: "ramen" },
  savedAt: "2026-10-20T00:00:00.000Z",
  data: { results: [] },
};

describe("S3Store", () => {
  it("saves responses under a hashed key and reads them back", async () => {
    const { objects, client } = memoryBucket();
    const store = new S3Store("cache-bucket", client);

    expect(await store.get(entry.key)).toBeUndefined();
    await store.set(entry);

    expect([...objects.keys()]).toEqual([expect.stringMatching(/^qloo\/[0-9a-f]{32}\.json$/)]);
    expect(await store.get(entry.key)).toEqual(entry);
  });

  it("ignores an object that belongs to another key", async () => {
    const { objects, client } = memoryBucket();
    const store = new S3Store("cache-bucket", client);
    await store.set(entry);
    const [objectKey] = [...objects.keys()];
    objects.set(objectKey!, JSON.stringify({ ...entry, key: "/search?query=other" }));

    expect(await store.get(entry.key)).toBeUndefined();
  });

  it("passes other S3 errors on", async () => {
    const client = { send: vi.fn().mockRejectedValue(new Error("AccessDenied")) } as never;
    await expect(new S3Store("cache-bucket", client).get(entry.key)).rejects.toThrow(
      "AccessDenied",
    );
  });
});
