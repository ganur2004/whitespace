import { describe, expect, it } from "vitest";
import { splitSse } from "../src/api/sse.js";

describe("splitSse", () => {
  it("splits complete messages and keeps the unfinished tail", () => {
    const { messages, rest } = splitSse(
      'event: step\ndata: {"a":1}\n\nevent: result\ndata: {"b":2}\n\nevent: par',
    );

    expect(messages).toEqual([
      { event: "step", data: '{"a":1}' },
      { event: "result", data: '{"b":2}' },
    ]);
    expect(rest).toBe("event: par");
  });

  it("joins multi-line data, accepts CRLF and skips comments", () => {
    const { messages } = splitSse(": keep-alive\r\n\r\nevent: x\r\ndata: one\r\ndata: two\r\n\r\n");

    expect(messages).toEqual([{ event: "x", data: "one\ntwo" }]);
  });

  it("works when a message arrives in pieces", () => {
    const first = splitSse("event: step\nda");
    expect(first.messages).toEqual([]);
    const second = splitSse(`${first.rest}ta: {}\n\n`);
    expect(second.messages).toEqual([{ event: "step", data: "{}" }]);
  });
});
