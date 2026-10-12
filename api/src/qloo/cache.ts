import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface StoredResponse {
  key: string;
  endpoint: string;
  params: Record<string, string>;
  savedAt: string;
  data: unknown;
}

export interface ResponseStore {
  get(key: string): Promise<StoredResponse | undefined>;
  set(entry: StoredResponse): Promise<void>;
}

export class MemoryLru<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export class FileStore implements ResponseStore {
  constructor(private readonly dir: string) {}

  async get(key: string): Promise<StoredResponse | undefined> {
    try {
      const entry = JSON.parse(await readFile(this.path(key), "utf8")) as StoredResponse;
      return entry.key === key ? entry : undefined;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async set(entry: StoredResponse): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.path(entry.key);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entry));
    await rename(temporary, target);
  }

  private path(key: string): string {
    return join(this.dir, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  }
}

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
