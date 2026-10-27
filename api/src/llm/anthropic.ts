import Anthropic from "@anthropic-ai/sdk";
import { MessagesLlm, type MessagesApi, type MessagesLlmOptions } from "./messages.js";

export interface AnthropicLlmOptions extends MessagesLlmOptions {
  apiKey: string;
  timeoutMs?: number;
}

export class AnthropicLlm extends MessagesLlm {
  constructor(options: AnthropicLlmOptions, messages?: MessagesApi) {
    super(
      options,
      messages ??
        new Anthropic({
          apiKey: options.apiKey,
          timeout: options.timeoutMs ?? 60_000,
          maxRetries: 2,
        }).messages,
    );
  }
}
