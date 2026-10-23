import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type { LlmClient, LlmRequest } from "./client.js";

export interface BedrockLlmOptions {
  region: string;
  model: string;
  fallbackModel?: string;
  timeoutMs?: number;
  logger?: Pick<Console, "warn">;
}

type MessagesApi = Pick<AnthropicBedrockMantle["messages"], "create">;

export class BedrockLlm implements LlmClient {
  readonly model: string;
  private readonly messages: MessagesApi;
  private readonly fallbackModel: string | undefined;
  private readonly logger: Pick<Console, "warn">;

  constructor(options: BedrockLlmOptions, messages?: MessagesApi) {
    this.model = options.model;
    this.fallbackModel = options.fallbackModel;
    this.logger = options.logger ?? console;
    this.messages =
      messages ??
      new AnthropicBedrockMantle({
        awsRegion: options.region,
        timeout: options.timeoutMs ?? 60_000,
        maxRetries: 2,
      }).messages;
  }

  async create(request: LlmRequest): Promise<Anthropic.Message> {
    const message = await this.messages.create({ ...request, model: this.model });
    if (message.stop_reason !== "refusal" || !this.fallbackModel) return message;
    this.logger.warn(`${this.model} declined; retrying on ${this.fallbackModel}`);
    return this.messages.create({ ...request, model: this.fallbackModel });
  }
}
