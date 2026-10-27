import type Anthropic from "@anthropic-ai/sdk";
import { describeAudience, type Zone } from "@whitespace/shared";
import { assertUsable, describeLlmError, textOf, type LlmClient } from "../llm/client.js";
import type { Analysis } from "./analysis.js";
import { render, substitute } from "./grounding.js";

const BRIEF_SYSTEM = `You write short site briefs for a business owner choosing where to open a new venue.
Write 4 to 6 plain sentences, no headings, no lists, no markdown.
Cover: why this zone fits, who the audience is, which similar venues are close, what to watch out for, and what to check next (rent, foot traffic, a visit in person).
Use only the facts you are given. Never invent numbers.
Refer to places, artists and brands only as their [[id]] tokens, for example [[p1]] or [[a2]]; never write their names yourself.
You may write the city and neighborhood names that appear in the facts as plain text.
Talk about the audience only using the audience line and the anchors that drive places.`;

export async function writeBriefs(
  analysis: Analysis,
  llm: LlmClient,
  logger: Pick<Console, "warn"> = console,
): Promise<void> {
  const result = analysis.require();
  const pending = result.zones.filter((zone) => zone.profile && !zone.profile.brief);
  const briefs = await Promise.all(
    pending.map(async (zone) => {
      try {
        return [zone.id, await writeBrief(analysis, zone, llm)] as const;
      } catch (error) {
        logger.warn(
          `Brief for zone ${zone.rank} failed; using the template. ${describeLlmError(error)}`,
        );
        return [zone.id, templateBrief(analysis, zone)] as const;
      }
    }),
  );
  for (const [zoneId, brief] of briefs) analysis.setBrief(zoneId, brief);
}

async function writeBrief(analysis: Analysis, zone: Zone, llm: LlmClient): Promise<string> {
  const result = analysis.require();
  const facts = [
    `City: ${result.city.name}`,
    `Concept: ${result.concept || "(not given)"}`,
    `Anchors: ${result.anchors.map((anchor) => `${analysis.registry.ref("anchor", anchor.id, anchor.name)} (${anchor.type.replace("urn:entity:", "")})`).join(", ")}`,
    result.audience ? `Audience: ${describeAudience(result.audience)}` : "Audience: unknown",
    analysis.zoneFacts(zone, true),
  ].join("\n");
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Facts:\n${facts}\n\nWrite the brief for zone ${zone.rank}.` },
  ];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const message = assertUsable(
      await llm.create({
        max_tokens: 16000,
        system: BRIEF_SYSTEM,
        output_config: { effort: "low" },
        messages,
      }),
    );
    const rendered = render(textOf(message), analysis.registry, analysis.allowedNames());
    if (rendered.ok) return rendered.text;
    messages.push(
      { role: "assistant", content: message.content },
      {
        role: "user",
        content: `The brief breaks the naming rules: ${rendered.problems.join("; ")}. Rewrite it with [[id]] tokens only.`,
      },
    );
  }
  return templateBrief(analysis, zone);
}

export function templateBrief(analysis: Analysis, zone: Zone): string {
  const sentences = zone.reasons.map((reason) => `${reason}.`);
  const places = (zone.profile?.tastePlaces ?? []).slice(0, 2);
  if (places.length > 0) {
    sentences.push(
      `Locals here also like ${places.map((place) => analysis.registry.ref("place", place.id, place.name)).join(" and ")}.`,
    );
  }
  const rival = analysis.rivalsNear(zone)[0];
  sentences.push(
    rival
      ? `The closest similar venue is ${analysis.registry.ref("competitor", rival.id, rival.name)}.`
      : "No similar venue is within 1.5 km of the zone center.",
  );
  sentences.push("Before committing, check rent, foot traffic and visit in person.");
  return substitute(sentences.join(" "), analysis.registry);
}
