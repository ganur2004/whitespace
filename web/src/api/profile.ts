import type { Polygon } from "geojson";
import type { ZoneProfile } from "@whitespace/shared";

export interface ProfileRequestBody {
  anchorIds: string[];
  categoryTagIds: string[];
  zones: { id: string; rank: number; polygon: Polygon }[];
}

export async function fetchProfiles(
  body: ProfileRequestBody,
  signal?: AbortSignal,
): Promise<Record<string, ZoneProfile>> {
  const response = await fetch("/api/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload = (await response.json().catch(() => null)) as {
    profiles?: Record<string, ZoneProfile>;
    error?: string;
  } | null;
  if (!response.ok || !payload?.profiles) {
    throw new Error(payload?.error ?? `Zone profiles failed (HTTP ${response.status}).`);
  }
  return payload.profiles;
}
