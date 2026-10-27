import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { MessagesLlm, type MessagesApi, type MessagesLlmOptions } from "./messages.js";

export interface BedrockLlmOptions extends MessagesLlmOptions {
  region: string;
  timeoutMs?: number;
}

export class BedrockLlm extends MessagesLlm {
  constructor(options: BedrockLlmOptions, messages?: MessagesApi) {
    super(
      options,
      messages ??
        new AnthropicBedrockMantle({
          awsRegion: options.region,
          timeout: options.timeoutMs ?? 60_000,
          maxRetries: 2,
        }).messages,
    );
  }
}
