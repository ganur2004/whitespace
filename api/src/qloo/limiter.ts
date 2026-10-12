export interface LimiterOptions {
  maxConcurrent: number;
  ratePerSecond: number;
  burst?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class Limiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private tokens: number;
  private refilledAt: number;
  private readonly burst: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: LimiterOptions) {
    this.burst = options.burst ?? options.ratePerSecond;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? sleep;
    this.tokens = this.burst;
    this.refilledAt = this.now();
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    try {
      await this.takeToken();
      return await task();
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.active < this.options.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }

  private async takeToken(): Promise<void> {
    const now = this.now();
    const refill = ((now - this.refilledAt) / 1000) * this.options.ratePerSecond;
    this.tokens = Math.min(this.burst, this.tokens + refill);
    this.refilledAt = now;
    this.tokens -= 1;
    if (this.tokens < 0) await this.sleep((-this.tokens / this.options.ratePerSecond) * 1000);
  }
}
