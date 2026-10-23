import type { ChatAction } from "@whitespace/shared";
import type { Analysis } from "./analysis.js";
import { substitute } from "./grounding.js";
import { executeTool, type ToolContext, type ToolName } from "./tools.js";

export type BasicCommand =
  | { tool: Extract<ToolName, "compare_zones">; input: { a: number; b: number } }
  | { tool: Extract<ToolName, "exclude_area">; input: { zone: number } | { neighborhood: string } }
  | { tool: Extract<ToolName, "reset_exclusions">; input: Record<string, never> }
  | { tool: Extract<ToolName, "adjust_scoring">; input: { competitionWeight: number } }
  | { tool: Extract<ToolName, "profile_zone">; input: { zone: number } }
  | { tool: Extract<ToolName, "explain_place">; input: { place: string } };

export const LOW_COMPETITION_WEIGHT = 0.3;
export const HIGH_COMPETITION_WEIGHT = 0.9;

export const BASIC_HELP =
  'Basic mode understands: "exclude downtown", "exclude zone 2", "reset exclusions", "compare zone 1 and zone 2", "tell me about zone 3", "explain <place>", "I am less worried about competition" or "avoid competitors more".';

export function parseCommand(message: string): BasicCommand | undefined {
  const text = message.trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();

  const compare = /\bcompare\b\D*(\d)\D+(\d)/i.exec(text);
  if (compare)
    return { tool: "compare_zones", input: { a: Number(compare[1]), b: Number(compare[2]) } };

  if (/\b(reset|clear|undo|remove)\b.*\bexclu/.test(lower)) {
    return { tool: "reset_exclusions", input: {} };
  }

  const exclude = /\b(?:exclude|remove|skip|avoid|drop|without|not in)\s+(?:the\s+)?(.+)/i.exec(
    text,
  );
  if (exclude?.[1] && !/compet|rival/i.test(exclude[1])) {
    const target = exclude[1].split(/[,.;!?(]|\bbecause\b|\bsince\b|\bas\b/i)[0]?.trim() ?? "";
    const zone = /^zone\s*(\d)/i.exec(target);
    if (zone) return { tool: "exclude_area", input: { zone: Number(zone[1]) } };
    const neighborhood = target.replace(/\b(area|neighbou?rhood|district|zone)\b/gi, "").trim();
    if (neighborhood.length >= 2) return { tool: "exclude_area", input: { neighborhood } };
  }

  if (/\bcompet|\brival/.test(lower)) {
    const lessWorried =
      /\b(less|not|don'?t|do not|never)\b.*\b(afraid|worried|scared|care|mind)\b/.test(lower) ||
      /\b(ignore|fine with|ok with|okay with|welcome)\b/.test(lower);
    const moreWorried =
      /\b(more|very|really)\b.*\b(afraid|worried|scared|careful)\b/.test(lower) ||
      /\b(avoid|fewer|less|away from|stay away)\b/.test(lower);
    if (lessWorried)
      return { tool: "adjust_scoring", input: { competitionWeight: LOW_COMPETITION_WEIGHT } };
    if (moreWorried)
      return { tool: "adjust_scoring", input: { competitionWeight: HIGH_COMPETITION_WEIGHT } };
  }

  const explain = /\b(?:explain|why)\b\s+(?:is\s+|does\s+)?(.+)/i.exec(text);
  if (explain?.[1]) {
    const target = explain[1].replace(/[?.!]+$/, "").trim();
    const zone = /^zone\s*(\d)/i.exec(target);
    if (zone) return { tool: "profile_zone", input: { zone: Number(zone[1]) } };
    if (target)
      return {
        tool: "explain_place",
        input: {
          place: target.replace(/\b(match(es)?|fit(s)?|so high)\b.*$/i, "").trim() || target,
        },
      };
  }

  const zone = /\bzone\s*(\d)\b/i.exec(text);
  if (zone) return { tool: "profile_zone", input: { zone: Number(zone[1]) } };
  return undefined;
}

export async function runBasic(
  message: string,
  context: ToolContext,
): Promise<{ text: string; actions: ChatAction[] }> {
  const { analysis } = context;
  if (!analysis.result) {
    return {
      text: "Describe your concept, pick a city and press Find spots first. Then I can exclude areas, compare zones and explain places.",
      actions: [],
    };
  }
  const command = parseCommand(message);
  if (!command) return { text: `${BASIC_HELP}\n${analysis.summary()}`, actions: [] };

  try {
    const outcome = await executeTool(command.tool, command.input, context);
    const actions: ChatAction[] = [];
    if (outcome.focusZoneId) actions.push({ type: "focusZone", zoneId: outcome.focusZoneId });
    if (outcome.highlightPlaceIds?.length) {
      actions.push({ type: "highlightPlaces", placeIds: outcome.highlightPlaceIds });
    }
    const changesZones =
      command.tool === "exclude_area" ||
      command.tool === "reset_exclusions" ||
      command.tool === "adjust_scoring";
    const text = changesZones
      ? `${outcome.text.split("\n")[0] ?? ""}\n${analysis.summary()}`
      : substitute(compactText(command, analysis) ?? outcome.text, analysis.registry).replace(
          /\n[ \t]*/g,
          "\n",
        );
    return { text: text.trim(), actions };
  } catch (error) {
    const reason =
      error instanceof Error && error.name !== "Error" ? error.message : "That did not work.";
    return { text: `${reason} ${BASIC_HELP}`, actions: [] };
  }
}

function compactText(command: BasicCommand, analysis: Analysis): string | undefined {
  const line = (rank: number) => {
    const zone = analysis.zone(rank);
    return zone ? analysis.zoneLine(zone) : undefined;
  };
  if (command.tool === "profile_zone") {
    const zone = analysis.zone(command.input.zone);
    if (!zone) return undefined;
    return [analysis.zoneLine(zone), ...(zone.profile?.brief ? [zone.profile.brief] : [])].join(
      "\n",
    );
  }
  if (command.tool === "compare_zones") {
    const lines = [line(command.input.a), line(command.input.b)];
    return lines.every(Boolean) ? lines.join("\n\n") : undefined;
  }
  return undefined;
}
