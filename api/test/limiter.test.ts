import { describe, expect, it, vi } from "vitest";
import { Limiter } from "../src/qloo/limiter.js";

describe("Limiter", () => {
  it("never runs more than maxConcurrent tasks at once", async () => {
    const limiter = new Limiter({ maxConcurrent: 2, ratePerSecond: 1000 });
    let running = 0;
    let peak = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    };

    await Promise.all(Array.from({ length: 7 }, () => limiter.run(task)));

    expect(peak).toBe(2);
    expect(running).toBe(0);
  });

  it("waits for a token once the burst is spent", async () => {
    const sleep = vi.fn(async () => {});
    const limiter = new Limiter({
      maxConcurrent: 5,
      ratePerSecond: 2,
      burst: 1,
      now: () => 0,
      sleep,
    });

    await limiter.run(async () => "first");
    await limiter.run(async () => "second");

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("releases its slot when a task fails", async () => {
    const limiter = new Limiter({ maxConcurrent: 1, ratePerSecond: 1000 });

    await expect(limiter.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    await expect(limiter.run(async () => "after")).resolves.toBe("after");
  });
});
