import { useEffect, useMemo } from "react";

import { useGsavProgressStore } from "./gsavProgressStore";

export type GsavResumeCandidate = {
  id: string;
  title: string;
  posterUrl?: string;
};

type GsavResumeRecord = {
  videoId: string;
  time: number;
  duration: number;
  ts: number;
};

export type GsavResumeState = GsavResumeCandidate & {
  time: number;
  duration: number;
  updatedAt: number;
  progressPercent: number;
};

export function selectLatestGsavResume(
  candidates: readonly GsavResumeCandidate[],
  records: Record<string, GsavResumeRecord>,
): GsavResumeState | null {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const record = Object.values(records)
    .sort((a, b) => b.ts - a.ts)
    .find((candidate) => candidateById.has(candidate.videoId));

  if (!record) return null;
  const candidate = candidateById.get(record.videoId);
  if (!candidate) return null;

  return {
    ...candidate,
    time: record.time,
    duration: record.duration,
    updatedAt: record.ts,
    progressPercent:
      record.duration > 0
        ? Math.min(100, Math.round((record.time / record.duration) * 100))
        : 0,
  };
}

export function useLatestGsavResume(candidates: readonly GsavResumeCandidate[]) {
  const records = useGsavProgressStore((s) => s.records);
  const hydrated = useGsavProgressStore((s) => s.hydrated);
  const hydrate = useGsavProgressStore((s) => s.hydrate);
  const clear = useGsavProgressStore((s) => s.clear);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const item = useMemo(() => selectLatestGsavResume(candidates, records), [candidates, records]);

  return {
    hydrated,
    item,
    clearResume: () => {
      if (item) clear(item.id);
    },
  };
}
