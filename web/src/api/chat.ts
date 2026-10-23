import type { ChatMessage, ChatReply, ChatState, ScoutResult, Zone } from "@whitespace/shared";
import type { Polygon } from "geojson";

export function chatState(
  result: ScoutResult,
  competitionWeight: number,
  excluded: Polygon[],
  zones: readonly Zone[],
): ChatState {
  const state: ChatState = {
    concept: result.concept,
    cityId: result.city.id,
    anchors: result.anchors,
    categoryTags: result.categoryTags,
    params: { ...result.params, competitionWeight, excludePolygons: excluded },
    cells: result.cells.map((cell) =>
      cell.popularity === undefined
        ? [cell.geohash, cell.affinity]
        : [cell.geohash, cell.affinity, cell.popularity],
    ),
    competitors: result.competitors.map((place) => ({ ...place, tags: [] })),
    zones: zones.map((zone) =>
      zone.profile ? { id: zone.id, profile: zone.profile } : { id: zone.id },
    ),
    demo: result.demo,
  };
  if (result.audience) state.audience = result.audience;
  return state;
}

export async function sendChat(
  messages: ChatMessage[],
  state: ChatState | undefined,
  signal?: AbortSignal,
): Promise<ChatReply> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state ? { messages, state } : { messages }),
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    (ChatReply & { error?: undefined }) | { error: string } | null;
  if (!response.ok || !payload || "error" in payload) {
    throw new Error(
      payload && "error" in payload && payload.error
        ? payload.error
        : `The assistant failed (HTTP ${response.status}).`,
    );
  }
  return payload;
}
