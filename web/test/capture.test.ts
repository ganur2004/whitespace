import { afterEach, describe, expect, it, vi } from "vitest";
import { captureNextFrame } from "../src/map/capture.js";

function fakeMap() {
  const listeners = new Set<() => void>();
  const map = {
    on: (_type: string, listener: () => void) => listeners.add(listener),
    off: (_type: string, listener: () => void) => listeners.delete(listener),
    triggerRepaint: vi.fn(),
  };
  return {
    map: map as unknown as Parameters<typeof captureNextFrame>[0],
    listeners,
    render: () => [...listeners].forEach((listener) => listener()),
    repaints: map.triggerRepaint,
  };
}

describe("captureNextFrame", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the image on the next rendered frame", async () => {
    const { map, listeners, render, repaints } = fakeMap();
    const capture = captureNextFrame(map, () => "data:image/jpeg;base64,AAAA");

    expect(repaints).toHaveBeenCalledOnce();
    render();

    await expect(capture).resolves.toBe("data:image/jpeg;base64,AAAA");
    expect(listeners.size).toBe(0);
  });

  it("gives up without an image when no frame is rendered in time", async () => {
    vi.useFakeTimers();
    const { map, listeners } = fakeMap();
    const draw = vi.fn(() => "data:image/jpeg;base64,AAAA");
    const capture = captureNextFrame(map, draw, 2000);

    await vi.advanceTimersByTimeAsync(2000);

    await expect(capture).resolves.toBeUndefined();
    expect(draw).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});
