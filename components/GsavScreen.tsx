import React, { useEffect, useMemo } from "react";
import { useLocalSearchParams } from "expo-router";

import { GsavWebView } from "./GsavWebView";
import { buildGsavWatchPath, firstParam } from "../utils/gsavBridge";
import { useGsavProgressStore } from "../store/gsavProgressStore";

/**
 * Shared GSAV scene screen rendered by both the /watch/:id and /gsav/:id routes.
 * Both routes resolve to the same web /watch path (buildGsavWatchPath); /gsav is
 * kept as an inbound deep-link alias. Keep this as the single source of truth so
 * the two route files cannot drift.
 *
 * Resume: if the scene has a saved playback position (and the caller didn't pass
 * an explicit ?t=), reopen at that offset. Render is gated on the progress store
 * being hydrated so the WebView mounts once with the right start — never loading
 * at 0 and then reloading at the resume offset.
 */
export default function GsavScreen() {
  const params = useLocalSearchParams<{ id?: string; t?: string; share?: string }>();
  const sceneId = firstParam(params.id) ?? "elly";
  const startTime = firstParam(params.t);
  const share = firstParam(params.share);

  const hydrated = useGsavProgressStore((s) => s.hydrated);
  const hydrate = useGsavProgressStore((s) => s.hydrate);
  const storedStart = useGsavProgressStore((s) => s.records[sceneId]?.time ?? 0);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const effectiveStart =
    startTime ?? (storedStart > 0 ? String(Math.floor(storedStart)) : undefined);
  const path = useMemo(
    () => buildGsavWatchPath(sceneId, { startTime: effectiveStart, share }),
    [sceneId, share, effectiveStart],
  );

  if (!hydrated) return null;
  return <GsavWebView path={path} />;
}
