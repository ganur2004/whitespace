import type { TraceStep } from "@whitespace/shared";
import { MemoryLru, type ResponseStore, type StoredResponse } from "./cache.js";
import { Limiter, sleep } from "./limiter.js";
import { assertAllowedParams, type QlooEndpoint, type QlooParams } from "./params.js";

export type ResponseSource = "live" | "cache" | "stale" | "recorded" | "synthetic";

export interface QlooResult<T = unknown> {
  data: T;
  source: ResponseSource;
  trace: TraceStep;
}

export interface DemoSource {
  match(
    endpoint: QlooEndpoint,
    params: QlooParams,
  ): Promise<{ data: unknown; savedAt: string } | undefined>;
}

export interface QlooClientOptions {
  baseUrl: string;
  apiKey: string | undefined;
  demo: boolean;
  store?: ResponseStore;
  demoSource?: DemoSource;
  fetch?: typeof fetch;
  limiter?: Limiter;
  memoryTtlMs?: number;
  memoryMaxEntries?: number;
  storeFreshMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  maxRetryDelayMs?: number;
  timeoutMs?: number;
  maxUrlLength?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Pick<Console, "warn">;
}

export class QlooError extends Error {
  override readonly name = "QlooError";
  readonly status: number | undefined;

  constructor(
    message: string,
    readonly endpoint: string,
    status?: number,
  ) {
    super(message);
    this.status = status;
  }
}

const HOUR_MS = 60 * 60 * 1000;
const RETRYABLE_STATUS = (status: number): boolean => status === 429 || status >= 500;

export class QlooClient {
  private readonly memory: MemoryLru<StoredResponse>;
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: Limiter;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: Pick<Console, "warn">;
  private readonly storeFreshMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly maxUrlLength: number;
  private sequence = 0;

  constructor(private readonly options: QlooClientOptions) {
    this.now = options.now ?? Date.now;
    this.memory = new MemoryLru(
      options.memoryMaxEntries ?? 100,
      options.memoryTtlMs ?? 6 * HOUR_MS,
      this.now,
    );
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.limiter = options.limiter ?? new Limiter({ maxConcurrent: 4, ratePerSecond: 4 });
    this.sleep = options.sleep ?? sleep;
    this.logger = options.logger ?? console;
    this.storeFreshMs = options.storeFreshMs ?? 7 * 24 * HOUR_MS;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 500;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 10_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxUrlLength = options.maxUrlLength ?? 8_000;
  }

  async get<T = unknown>(
    endpoint: QlooEndpoint,
    params: QlooParams,
    label: string,
  ): Promise<QlooResult<T>> {
    assertAllowedParams(endpoint, params);
    const query = encodeQuery(params);
    const key = `${endpoint}?${query}`;
    const started = this.now();

    const remembered = this.memory.get(key);
    if (remembered) return this.result(remembered, "cache", label, started);

    if (this.options.demo) return this.fromDemo(endpoint, params, key, label, started);

    const stored = await this.readStore(key);
    if (stored && this.now() - Date.parse(stored.savedAt) < this.storeFreshMs) {
      this.memory.set(key, stored);
      return this.result(stored, "cache", label, started);
    }

    try {
      const data = await this.fetchWithRetry(endpoint, query);
      const entry: StoredResponse = {
        key,
        endpoint,
        params: { ...params },
        savedAt: new Date(this.now()).toISOString(),
        data,
      };
      this.memory.set(key, entry);
      await this.writeStore(entry);
      const result = this.result<T>(entry, "live", label, started);
      if (result.trace.resultCount === 0) {
        this.logger.warn(`Qloo returned no results for ${endpoint}`, entry.params);
      }
      return result;
    } catch (error) {
      if (!stored) throw error;
      this.logger.warn(
        `Qloo failed for ${endpoint}; serving the response saved at ${stored.savedAt}`,
        describeError(error),
      );
      this.memory.set(key, stored);
      return this.result(stored, "stale", label, started);
    }
  }

  private async fromDemo<T>(
    endpoint: QlooEndpoint,
    params: QlooParams,
    key: string,
    label: string,
    started: number,
  ): Promise<QlooResult<T>> {
    const recorded = await this.readStore(key);
    if (recorded) {
      this.memory.set(key, recorded);
      return this.result(recorded, "recorded", label, started);
    }
    const synthetic = await this.options.demoSource?.match(endpoint, params);
    if (synthetic) {
      const entry: StoredResponse = { key, endpoint, params: { ...params }, ...synthetic };
      return this.result(entry, "synthetic", label, started);
    }
    throw new QlooError(`No demo data for ${endpoint} ${params["filter.type"] ?? ""}`, endpoint);
  }

  private async fetchWithRetry(endpoint: QlooEndpoint, query: string): Promise<unknown> {
    const apiKey = this.options.apiKey;
    if (!apiKey) throw new QlooError("QLOO_API_KEY is not set", endpoint);
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}${endpoint}?${query}`;
    if (url.length > this.maxUrlLength) {
      throw new QlooError(
        `Request URL is ${url.length} characters; split long ID lists into batches`,
        endpoint,
      );
    }

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.limiter.run(() =>
          this.fetchImpl(url, {
            headers: { "X-Api-Key": apiKey, Accept: "application/json" },
            signal: AbortSignal.timeout(this.timeoutMs),
          }),
        );
      } catch (error) {
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoff(attempt, null));
          continue;
        }
        throw new QlooError(`Qloo request failed: ${describeError(error)}`, endpoint);
      }

      if (response.ok) return (await response.json()) as unknown;

      if (RETRYABLE_STATUS(response.status) && attempt < this.maxRetries) {
        await this.sleep(this.backoff(attempt, response.headers.get("retry-after")));
        continue;
      }

      const body = (await response.text().catch(() => "")).slice(0, 300);
      throw new QlooError(
        `Qloo answered ${response.status}${body ? `: ${body}` : ""}`,
        endpoint,
        response.status,
      );
    }
  }

  private backoff(attempt: number, retryAfter: string | null): number {
    const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : this.retryBaseMs * 2 ** attempt;
    return Math.min(delay, this.maxRetryDelayMs);
  }

  private async readStore(key: string): Promise<StoredResponse | undefined> {
    try {
      return await this.options.store?.get(key);
    } catch (error) {
      this.logger.warn("Could not read the Qloo response cache", describeError(error));
      return undefined;
    }
  }

  private async writeStore(entry: StoredResponse): Promise<void> {
    try {
      await this.options.store?.set(entry);
    } catch (error) {
      this.logger.warn("Could not write the Qloo response cache", describeError(error));
    }
  }

  private result<T>(
    entry: StoredResponse,
    source: ResponseSource,
    label: string,
    started: number,
  ): QlooResult<T> {
    this.sequence += 1;
    const trace: TraceStep = {
      id: `q${this.sequence}`,
      label,
      endpoint: entry.endpoint,
      params: { ...entry.params },
      resultCount: countResults(entry.data),
      ms: Math.max(0, this.now() - started),
      cached: source !== "live",
    };
    if (source !== "live") trace.cachedAt = entry.savedAt;
    return { data: entry.data as T, source, trace };
  }
}

export function encodeQuery(params: QlooParams): string {
  return Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
}

export function countResults(data: unknown): number {
  if (!isRecord(data)) return 0;
  const results = data.results;
  if (Array.isArray(results)) return results.length;
  if (!isRecord(results)) return 0;
  for (const value of Object.values(results)) {
    if (Array.isArray(value)) return value.length;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
