import { resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  SCENARIOS,
  findCity,
  type ChatReply,
  type ChatState,
  type ScoutResult,
} from "@whitespace/shared";
import { chat, MAX_TOOL_CALLS } from "../src/agent/agent.js";
import { Analysis } from "../src/agent/analysis.js";
import { parseCommand } from "../src/agent/basic.js";
import { EntityRegistry, render } from "../src/agent/grounding.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { IpRateLimiter } from "../src/limits.js";
import { SyntheticFixtures } from "../src/demo/fixtures.js";
import { AnthropicLlm } from "../src/llm/anthropic.js";
import { BedrockLlm } from "../src/llm/bedrock.js";
import type { LlmClient, LlmRequest } from "../src/llm/client.js";
import { createLlmClient } from "../src/llm/create.js";
import { QlooClient } from "../src/qloo/client.js";
import { fallbackPlan, planConcept } from "../src/scout/concept.js";
import { runScout } from "../src/scout/pipeline.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "../fixtures");
const scenario = SCENARIOS[0]!;
const quiet = { warn: vi.fn() };

const demoClient = () =>
  new QlooClient({
    baseUrl: "https://hackathon.api.qloo.com",
    apiKey: undefined,
    demo: true,
    demoSource: new SyntheticFixtures(FIXTURES_DIR),
    fetch: vi.fn<typeof fetch>(),
    logger: quiet,
  });

let baseline: Promise<ScoutResult> | undefined;
const austin = () =>
  (baseline ??= runScout(
    {
      concept: scenario.concept,
      cityId: scenario.cityId,
      anchors: scenario.anchors,
      categoryTags: scenario.categoryTags,
    },
    demoClient(),
  ));

function stateOf(result: ScoutResult): ChatState {
  return {
    concept: result.concept,
    cityId: result.city.id,
    anchors: result.anchors,
    categoryTags: result.categoryTags,
    params: result.params,
    cells: result.cells.map((cell) =>
      cell.popularity === undefined
        ? [cell.geohash, cell.affinity]
        : [cell.geohash, cell.affinity, cell.popularity],
    ),
    competitors: result.competitors.map((place) => ({ ...place, tags: [] })),
    zones: result.zones.map((zone) =>
      zone.profile ? { id: zone.id, profile: zone.profile } : { id: zone.id },
    ),
    demo: result.demo,
  };
}

type Block = Anthropic.TextBlock | Anthropic.ToolUseBlock;

const message = (content: Block[], stop: Anthropic.StopReason = "end_turn"): Anthropic.Message =>
  ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: "test",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }) as unknown as Anthropic.Message;

const text = (value: string): Anthropic.TextBlock =>
  ({ type: "text", text: value, citations: null }) as Anthropic.TextBlock;

const toolUse = (name: string, input: unknown, id = `tu_${name}`): Anthropic.ToolUseBlock =>
  ({ type: "tool_use", id, name, input }) as Anthropic.ToolUseBlock;

class ScriptedLlm implements LlmClient {
  readonly model = "scripted";
  readonly requests: LlmRequest[] = [];
  constructor(private readonly script: (request: LlmRequest, index: number) => Anthropic.Message) {}
  create(request: LlmRequest): Promise<Anthropic.Message> {
    this.requests.push(structuredClone(request));
    return Promise.resolve(this.script(request, this.requests.length - 1));
  }
}

const isBrief = (request: LlmRequest) => String(request.system).includes("site briefs");

describe("grounding", () => {
  const registry = new EntityRegistry();
  const ramen = registry.add("anchor", "id-1", "Ramen Tatsu-Ya");
  const bar = registry.add("place", "id-2", "Vinyl Cellar");

  it("substitutes known tokens and allows neighborhoods from the data", () => {
    const rendered = render(
      `East End fits: locals love [[${bar}]] and the taste leans on [[${ramen}]].`,
      registry,
      ["East End", "Austin"],
    );
    expect(rendered).toEqual({
      ok: true,
      text: "East End fits: locals love Vinyl Cellar and the taste leans on Ramen Tatsu-Ya.",
    });
  });

  it("rejects unknown tokens, written-out entity names and invented names", () => {
    const rendered = render(
      "Try [[p9]] near Vinyl Cellar, or go to Blue Moon Tavern in Riverside Park.",
      registry,
      ["Austin"],
    );
    expect(rendered.ok).toBe(false);
    if (rendered.ok) return;
    expect(rendered.problems.join("\n")).toMatch(/\[\[p9\]\] is not an entity/);
    expect(rendered.problems.join("\n")).toMatch(/instead of the name "Vinyl Cellar"/);
    expect(rendered.problems.join("\n")).toMatch(/"Blue Moon Tavern" is not a name/);
  });

  it("ignores capitalized sentence starters", () => {
    expect(render("The Zone has room. Both Zones work.", registry, []).ok).toBe(true);
  });
});

describe("basic mode commands", () => {
  it.each([
    ["Compare zone 1 and zone 2", { tool: "compare_zones", input: { a: 1, b: 2 } }],
    [
      "Exclude downtown, rent is too high there.",
      { tool: "exclude_area", input: { neighborhood: "downtown" } },
    ],
    ["exclude zone 3", { tool: "exclude_area", input: { zone: 3 } }],
    ["reset exclusions", { tool: "reset_exclusions", input: {} }],
    [
      "I'm less worried about competition",
      { tool: "adjust_scoring", input: { competitionWeight: 0.3 } },
    ],
    ["avoid competitors more", { tool: "adjust_scoring", input: { competitionWeight: 0.9 } }],
    ["Why does zone 2 fit?", { tool: "profile_zone", input: { zone: 2 } }],
    ["explain Vinyl Cellar", { tool: "explain_place", input: { place: "Vinyl Cellar" } }],
  ])("parses %s", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it("returns nothing for small talk", () => {
    expect(parseCommand("hello there")).toBeUndefined();
  });
});

describe("concept planning", () => {
  const city = findCity("austin")!;

  it("falls back to keywords and named places", () => {
    const plan = fallbackPlan(
      "A ramen bar with vinyl and craft beer. Places like Ramen Tatsu-Ya and Kitty Cohen's.",
      [],
    );
    expect(plan.categoryQueries).toEqual(["ramen"]);
    expect(plan.anchorQueries.map((query) => query.query)).toEqual(
      expect.arrayContaining(["Ramen Tatsu-Ya", "Kitty Cohen's", "ramen", "Khruangbin"]),
    );
  });

  it("asks the LLM for structured queries and keeps the owner's places first", async () => {
    const llm = new ScriptedLlm(() =>
      message([
        text(
          JSON.stringify({
            anchorQueries: [
              { query: "Ivan Ramen", type: "place" },
              { query: "Khruangbin", type: "artist" },
            ],
            categoryQueries: ["ramen"],
          }),
        ),
      ]),
    );
    const { plan, plannedBy } = await planConcept(
      "Ramen and vinyl",
      city,
      ["Ramen Tatsu-Ya"],
      llm,
      quiet,
    );

    expect(plannedBy).toBe("llm");
    expect(plan.anchorQueries[0]).toEqual({
      query: "Ramen Tatsu-Ya",
      type: "place",
      reference: true,
    });
    expect(plan.anchorQueries.map((query) => query.query)).toContain("Khruangbin");
    expect(llm.requests[0]?.output_config?.format?.type).toBe("json_schema");
  });

  it("uses the keyword plan when the LLM answers garbage", async () => {
    const llm = new ScriptedLlm(() => message([text("not json")]));
    const { plannedBy } = await planConcept("ramen bar", city, [], llm, quiet);
    expect(plannedBy).toBe("fallback");
  });
});

describe("Bedrock client", () => {
  it("retries a refusal once on the fallback model", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(message([], "refusal"))
      .mockResolvedValueOnce(message([text("ok")]));
    const llm = new BedrockLlm(
      {
        region: "us-east-1",
        model: "anthropic.claude-opus-5-5",
        fallbackModel: "anthropic.claude-opus-4-8",
        logger: quiet,
      },
      { create } as never,
    );

    const result = await llm.create({
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.stop_reason).toBe("end_turn");
    expect(create.mock.calls.map(([params]) => (params as { model: string }).model)).toEqual([
      "anthropic.claude-opus-5-5",
      "anthropic.claude-opus-4-8",
    ]);
  });
});

describe("Anthropic API client", () => {
  it("is created from the config and sends requests to the configured model", async () => {
    expect(createLlmClient(loadConfig({ ANTHROPIC_API_KEY: "key" }))).toBeInstanceOf(AnthropicLlm);

    const create = vi.fn().mockResolvedValue(message([text("ok")]));
    const llm = new AnthropicLlm({ apiKey: "key", model: "claude-sonnet-5-5" }, { create });
    await llm.create({ max_tokens: 100, messages: [{ role: "user", content: "hi" }] });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-5-5", max_tokens: 100 }),
    );
  });
});

describe("agent", () => {
  it("excludes a zone through a tool, grounds the reply and writes briefs for the new zones", async () => {
    const result = await austin();
    const analysis = new Analysis(demoClient(), stateOf(result), quiet);
    const before = analysis.require().zones.map((zone) => zone.id);
    const llm = new ScriptedLlm((request, index) => {
      if (isBrief(request))
        return message([text("Locals here like [[p1]]. Check rent and visit.")]);
      if (index === 0) return message([toolUse("exclude_area", { zone: 1 })], "tool_use");
      return message([
        text("Done: the zones moved away from that area. Locals in the new zone 1 like [[p1]]."),
      ]);
    });

    const reply = await chat([{ role: "user", text: "Exclude zone 1" }], analysis, {
      qloo: demoClient(),
      llm,
      logger: quiet,
    });

    expect(reply.mode).toBe("agent");
    expect(reply.reply).not.toMatch(/\[\[/);
    expect(reply.result?.params.excludePolygons).toHaveLength(1);
    expect(reply.result?.zones.map((zone) => zone.id)).not.toEqual(before);
    expect(reply.result?.zones.every((zone) => zone.profile?.brief)).toBe(true);
    expect(reply.fresh).toBe(false);
    expect(reply.actions[0]).toMatchObject({ type: "focusZone" });
    const toolResult = llm.requests[1]?.messages.at(-1);
    expect(JSON.stringify(toolResult)).toContain("Excluded");
  });

  it("asks for one rewrite and falls back to a summary when names stay ungrounded", async () => {
    const result = await austin();
    const llm = new ScriptedLlm(() => message([text("Open next to Blue Moon Tavern.")]));
    const reply = await chat(
      [{ role: "user", text: "Where should I open?" }],
      new Analysis(demoClient(), stateOf(result), quiet),
      { qloo: demoClient(), llm, logger: quiet },
    );

    expect(llm.requests).toHaveLength(2);
    expect(String(llm.requests[1]?.messages.at(-1)?.content)).toMatch(/Blue Moon Tavern/);
    expect(llm.requests[1]?.tool_choice).toEqual({ type: "none" });
    expect(reply.reply).toMatch(/^Top zones in Austin/);
    expect(reply.result).toBeUndefined();
  });

  it(`stops running tools after ${MAX_TOOL_CALLS} calls`, async () => {
    const result = await austin();
    const llm = new ScriptedLlm((request) =>
      request.tool_choice?.type === "none"
        ? message([text("Here is what I found.")])
        : message([toolUse("profile_zone", { zone: 1 }, `tu_${Math.random()}`)], "tool_use"),
    );
    await chat(
      [{ role: "user", text: "Tell me everything" }],
      new Analysis(demoClient(), stateOf(result), quiet),
      { qloo: demoClient(), llm, logger: quiet },
    );

    const executed = llm.requests
      .flatMap((request) => request.messages)
      .flatMap((entry) => (Array.isArray(entry.content) ? entry.content : []))
      .filter(
        (block) =>
          block.type === "tool_result" && !(block as Anthropic.ToolResultBlockParam).is_error,
      );
    expect(new Set(executed.map((block) => JSON.stringify(block))).size).toBeLessThanOrEqual(
      MAX_TOOL_CALLS,
    );
    expect(llm.requests.at(-1)?.tool_choice).toEqual({ type: "none" });
  });

  it("answers in basic mode when the LLM throws", async () => {
    const result = await austin();
    const llm = new ScriptedLlm(() => {
      throw new Error("throttled");
    });
    const reply = await chat(
      [{ role: "user", text: "compare zone 1 and zone 2" }],
      new Analysis(demoClient(), stateOf(result), quiet),
      { qloo: demoClient(), llm, logger: quiet },
    );

    expect(reply.mode).toBe("basic");
    expect(reply.reply).toMatch(/Zone 1/);
    expect(reply.reply).toMatch(/Zone 2/);
    expect(reply.reply).not.toMatch(/\[\[/);
  });
});

describe("zone facts", () => {
  it("say where each competitor distance is measured from", async () => {
    const analysis = new Analysis(demoClient(), stateOf(await austin()), quiet);
    const facts = analysis.require().zones.map((zone) => analysis.zoneFacts(zone, true));

    expect(facts.every((fact) => fact.includes("within 1 km of its edge"))).toBe(true);
    expect(facts.join("\n")).toMatch(
      /Closest similar venues: \[\[\w+\]\][^;\n]*, \d+\.\d km from the zone center/,
    );
  });
});

describe("POST /api/chat", () => {
  const app = () =>
    createApp(
      loadConfig({
        DEMO_MODE: "true",
        FIXTURES_DIR,
        QLOO_CACHE_DIR: resolve(FIXTURES_DIR, "missing"),
      }),
      {
        llm: null,
      },
    );

  it("excludes a neighborhood in basic mode and returns the new result", async () => {
    const result = await austin();
    const response = await app().request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", text: "Exclude downtown, rent is too high" }],
        state: stateOf(result),
      }),
    });

    expect(response.status).toBe(200);
    const reply = (await response.json()) as ChatReply;
    expect(reply.mode).toBe("basic");
    expect(reply.reply).toMatch(/^Excluded Downtown/);
    expect(reply.result?.params.excludePolygons).toHaveLength(1);
  });

  it("explains how to start when there is no analysis", async () => {
    const response = await app().request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", text: "hi" }] }),
    });
    const reply = (await response.json()) as ChatReply;
    expect(reply.reply).toMatch(/Find spots/);
    expect(reply.result).toBeUndefined();
  });

  it("does not spend the chat limit on basic answers served from cache", async () => {
    const config = loadConfig({
      DEMO_MODE: "true",
      FIXTURES_DIR,
      QLOO_CACHE_DIR: resolve(FIXTURES_DIR, "missing"),
    });
    const limited = createApp(config, { llm: null, chatLimiter: new IpRateLimiter(1, 1) });
    const send = () =>
      limited.request("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", text: "hi" }] }),
      });

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
  });

  it("rejects a conversation that does not end with the user", async () => {
    const response = await app().request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "assistant", text: "hi" }] }),
    });
    expect(response.status).toBe(400);
  });
});
