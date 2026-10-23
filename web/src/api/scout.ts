import type { Anchor, ScoutEvent, ScoutResult } from "@whitespace/shared";
import { splitSse } from "./sse.js";

export interface ScoutRequestBody {
  concept: string;
  cityId: string;
  anchors?: Anchor[];
  categoryTags?: { id: string; name: string }[];
}

export async function streamScout(
  body: ScoutRequestBody,
  onEvent: (event: ScoutEvent) => void,
  signal?: AbortSignal,
): Promise<ScoutResult> {
  const response = await fetch("/api/scout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const failure = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(failure?.error ?? `The analysis failed (HTTP ${response.status}).`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let result: ScoutResult | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const { messages, rest } = splitSse(buffer + value);
    buffer = rest;
    for (const message of messages) {
      const event = JSON.parse(message.data) as ScoutEvent;
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "result") result = event.result;
      onEvent(event);
    }
  }
  if (!result) throw new Error("The analysis ended without a result.");
  return result;
}
