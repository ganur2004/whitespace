import type Anthropic from "@anthropic-ai/sdk";
import type { ChatAction, ChatMessage, ChatReply } from "@whitespace/shared";
import { assertUsable, describeLlmError, textOf, type LlmClient } from "../llm/client.js";
import type { QlooClient } from "../qloo/client.js";
import type { Analysis } from "./analysis.js";
import { NoAnalysisError } from "./analysis.js";
import { runBasic } from "./basic.js";
import { writeBriefs } from "./briefs.js";
import { render } from "./grounding.js";
import { executeTool, TOOLS, type ToolContext, type ToolOutcome } from "./tools.js";

export const MAX_TOOL_CALLS = 6;
const MAX_ROUNDS = 10;
const HISTORY_MESSAGES = 12;

export const SYSTEM_PROMPT = `You are Whitespace, a site-selection analyst for new venues.
You find neighborhoods where people with the right taste already are, but similar businesses are still rare.
The data comes from the Qloo taste graph: a taste-match map of the city, similar venues (competitors) with their taste match, and places the audience of each zone likes.
Use tools for every factual claim. Never invent numbers, places or neighborhoods.
Refer to places, artists and brands only as [[id]] tokens taken from the analysis or tool results, for example [[p1]] or [[a2]]; never write their names yourself. City and neighborhood names from the data may be written as plain text.
Zones are numbered 1 to 3 as on the map. After the zones change, talk about the new numbering.
Keep replies short: 2 to 4 sentences of plain text, no markdown, then point to the map.
Taste match is one signal, not a full site analysis: when recommending, remind the user to check rent, foot traffic and visit in person.
Only the supported cities can be analysed; say so if the user asks for another one.`;

export interface AgentDeps {
  qloo: QlooClient;
  llm: LlmClient | undefined;
  logger?: Pick<Console, "warn">;
}

export async function chat(
  messages: readonly ChatMessage[],
  analysis: Analysis,
  deps: AgentDeps,
): Promise<ChatReply> {
  const logger = deps.logger ?? console;
  const context: ToolContext = { analysis, qloo: deps.qloo, llm: deps.llm, logger };
  if (deps.llm) {
    try {
      const { text, actions } = await runAgent(messages, context, deps.llm);
      if (analysis.changed && analysis.result && analysis.result.zones.length > 0) {
        await writeBriefs(analysis, deps.llm, logger);
      }
      return reply(text, "agent", actions, analysis);
    } catch (error) {
      logger.warn(`The agent failed; answering in basic mode. ${describeLlmError(error)}`);
    }
  }
  const basic = await runBasic(messages.at(-1)?.text ?? "", context);
  return reply(basic.text, "basic", basic.actions, analysis);
}

function reply(
  text: string,
  mode: ChatReply["mode"],
  actions: ChatAction[],
  analysis: Analysis,
): ChatReply {
  const result: ChatReply = { reply: text, mode, actions };
  const output = analysis.changed ? analysis.output() : undefined;
  if (output) {
    result.result = output;
    result.fresh = analysis.fresh;
  }
  return result;
}

export async function runAgent(
  history: readonly ChatMessage[],
  context: ToolContext,
  llm: LlmClient,
): Promise<{ text: string; actions: ChatAction[] }> {
  const { analysis } = context;
  const recent = history.slice(-HISTORY_MESSAGES);
  const last = recent.at(-1);
  if (!last || last.role !== "user") throw new Error("The last message must come from the user");

  const messages: Anthropic.MessageParam[] = [
    ...recent
      .slice(0, -1)
      .map((message): Anthropic.MessageParam => ({ role: message.role, content: message.text })),
    {
      role: "user",
      content: [
        { type: "text", text: `<analysis>\n${analysis.context()}\n</analysis>` },
        { type: "text", text: last.text },
      ],
    },
  ];
  while (messages[0]?.role === "assistant") messages.shift();

  const actions: ChatAction[] = [];
  let toolCalls = 0;
  let rewrites = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const allowTools = toolCalls < MAX_TOOL_CALLS && rewrites === 0;
    const response = assertUsable(
      await llm.create({
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        tool_choice: allowTools ? { type: "auto" } : { type: "none" },
        output_config: { effort: "medium" },
        messages,
      }),
    );
    messages.push({ role: "assistant", content: response.content });

    const uses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (response.stop_reason === "tool_use" && uses.length > 0) {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        toolCalls += 1;
        if (toolCalls > MAX_TOOL_CALLS) {
          results.push(
            errorResult(use.id, "Tool limit reached for this message. Answer with what you have."),
          );
          continue;
        }
        try {
          const outcome = await executeTool(use.name, use.input, context);
          collectActions(outcome, actions);
          results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.text });
        } catch (error) {
          results.push(errorResult(use.id, describeToolError(error)));
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const rendered = render(textOf(response), analysis.registry, analysis.allowedNames());
    if (rendered.ok && rendered.text) return { text: rendered.text, actions };
    if (rewrites > 0) break;
    rewrites += 1;
    messages.push({
      role: "user",
      content: rendered.ok
        ? "Your reply was empty. Answer the user in 2 to 4 sentences."
        : `Your reply breaks the grounding rules: ${rendered.problems.join("; ")}. Rewrite it using only [[id]] tokens for places, artists and brands.`,
    });
  }
  return { text: analysis.summary(), actions };
}

function collectActions(outcome: ToolOutcome, actions: ChatAction[]): void {
  if (outcome.focusZoneId) actions.push({ type: "focusZone", zoneId: outcome.focusZoneId });
  if (outcome.highlightPlaceIds?.length) {
    actions.push({ type: "highlightPlaces", placeIds: outcome.highlightPlaceIds });
  }
}

function errorResult(toolUseId: string, message: string): Anthropic.ToolResultBlockParam {
  return { type: "tool_result", tool_use_id: toolUseId, content: message, is_error: true };
}

function describeToolError(error: unknown): string {
  if (error instanceof NoAnalysisError) return error.message;
  if (
    error instanceof Error &&
    (error.name === "ToolInputError" ||
      error.name === "ZodError" ||
      error.name === "ScoutInputError")
  ) {
    return error.message;
  }
  if (error instanceof Error && error.name === "QlooError") {
    return "Qloo is not answering right now. Tell the user to try again in a minute.";
  }
  return "The tool failed unexpectedly.";
}
