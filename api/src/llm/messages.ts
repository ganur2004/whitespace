import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmRequest } from "./client.js";

export interface MessagesApi {
  create(params: Anthropic.MessageCreateParamsNonStreaming): PromiseLike<Anthropic.Message>;
}

export interface MessagesLlmOptions {
  model: string;
  fallbackModel?: string;
  logger?: Pick<Console, "warn">;
}

export class MessagesLlm implements LlmClient {
  readonly model: string;
  private readonly messages: MessagesApi;
  private readonly fallbackModel: string | undefined;
  private readonly logger: Pick<Console, "warn">;

  constructor(options: MessagesLlmOptions, messages: MessagesApi) {
    this.model = options.model;
    this.fallbackModel = options.fallbackModel;
    this.logger = options.logger ?? console;
    this.messages = messages;
  }

  async create(request: LlmRequest): Promise<Anthropic.Message> {
    const message = await this.messages.create({ ...request, model: this.model });
    if (message.stop_reason !== "refusal" || !this.fallbackModel) return message;
    this.logger.warn(`${this.model} declined; retrying on ${this.fallbackModel}`);
    return this.messages.create({ ...request, model: this.fallbackModel });
  }
}
