import type { Config } from "../config.js";
import { SyntheticFixtures } from "../demo/fixtures.js";
import { FileStore } from "./cache.js";
import { QlooClient } from "./client.js";
import { Limiter } from "./limiter.js";
import { S3Store } from "./s3-store.js";

export function createQlooClient(config: Config): QlooClient {
  return new QlooClient({
    baseUrl: config.qlooBaseUrl,
    apiKey: config.qlooApiKey,
    demo: config.demoMode,
    store: config.cacheBucket ? new S3Store(config.cacheBucket) : new FileStore(config.cacheDir),
    demoSource: new SyntheticFixtures(config.fixturesDir),
    limiter: new Limiter({ maxConcurrent: 4, ratePerSecond: 4 }),
  });
}
