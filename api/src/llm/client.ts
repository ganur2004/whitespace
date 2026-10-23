import type Anthropic from "@anthropic-ai/sdk";

export type LlmRequest = Omit<Anthropic.MessageCreateParamsNonStreaming, "model">;

export interface LlmClient {
  readonly model: string;
  create(request: LlmRequest): Promise<Anthropic.Message>;
}

export class LlmError extends Error {
  override readonly name = "LlmError";
}

export function textOf(message: Anthropic.Message): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

export function assertUsable(message: Anthropic.Message): Anthropic.Message {
  if (message.stop_reason === "refusal") throw new LlmError("The model declined the request");
  if (message.stop_reason === "max_tokens") throw new LlmError("The model ran out of tokens");
  return message;
}

export function describeLlmError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
