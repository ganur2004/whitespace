import type { Config } from "../config.js";
import { BedrockLlm } from "./bedrock.js";
import type { LlmClient } from "./client.js";

export function createLlmClient(config: Config): LlmClient | undefined {
  if (!config.llm) return undefined;
  const options: ConstructorParameters<typeof BedrockLlm>[0] = {
    region: config.llm.region,
    model: config.llm.model,
  };
  if (config.llm.fallbackModel) options.fallbackModel = config.llm.fallbackModel;
  return new BedrockLlm(options);
}
