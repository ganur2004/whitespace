import type { Config } from "../config.js";
import { AnthropicLlm } from "./anthropic.js";
import { BedrockLlm } from "./bedrock.js";
import type { LlmClient } from "./client.js";
import type { MessagesLlmOptions } from "./messages.js";

export function createLlmClient(config: Config): LlmClient | undefined {
  const llm = config.llm;
  if (!llm) return undefined;
  const models: MessagesLlmOptions = { model: llm.model };
  if (llm.fallbackModel) models.fallbackModel = llm.fallbackModel;
  return llm.provider === "anthropic"
    ? new AnthropicLlm({ ...models, apiKey: llm.apiKey })
    : new BedrockLlm({ ...models, region: llm.region });
}
