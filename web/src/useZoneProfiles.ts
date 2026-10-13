import { useEffect, useRef, useState } from "react";
import type { ScoutResult, Zone, ZoneProfile } from "@whitespace/shared";
import { fetchProfiles } from "./api/profile.js";

const SETTLE_MS = 700;

export interface ZoneProfiles {
  profiles: Readonly<Record<string, ZoneProfile>>;
  loading: ReadonlySet<string>;
  failed: ReadonlySet<string>;
}

export function useZoneProfiles(
  result: ScoutResult | null,
  zones: readonly Zone[] | undefined,
  ready: boolean,
): ZoneProfiles {
  const [profiles, setProfiles] = useState<Record<string, ZoneProfile>>({});
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const seededFrom = useRef<ScoutResult | null>(null);

  useEffect(() => {
    if (!result || seededFrom.current === result) return;
    seededFrom.current = result;
    const seeded: Record<string, ZoneProfile> = {};
    for (const zone of result.zones) if (zone.profile) seeded[zone.id] = zone.profile;
    setProfiles((current) => ({ ...current, ...seeded }));
  }, [result]);

  useEffect(() => {
    if (!result || !zones || !ready) return;
    const missing = zones.filter((zone) => !profiles[zone.id] && !failed.has(zone.id));
    if (missing.length === 0) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const ids = missing.map((zone) => zone.id);
      setLoading(new Set(ids));
      fetchProfiles(
        {
          anchorIds: result.anchors.map((anchor) => anchor.id),
          categoryTagIds: result.categoryTags.map((tag) => tag.id),
          zones: missing.map((zone) => ({ id: zone.id, rank: zone.rank, polygon: zone.polygon })),
        },
        controller.signal,
      )
        .then((fetched) => {
          setProfiles((current) => ({ ...current, ...fetched }));
          const unanswered = ids.filter((id) => !fetched[id]);
          if (unanswered.length > 0) {
            setFailed((current) => new Set([...current, ...unanswered]));
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.warn("Zone profiles failed", error);
          setFailed((current) => new Set([...current, ...ids]));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(new Set());
        });
    }, SETTLE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
      setLoading(new Set());
    };
  }, [result, zones, ready, profiles, failed]);

  return { profiles, loading, failed };
}
