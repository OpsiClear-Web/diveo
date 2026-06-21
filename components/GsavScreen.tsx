import React, { useMemo } from "react";
import { useLocalSearchParams } from "expo-router";

import { GsavWebView } from "./GsavWebView";
import { buildGsavWatchPath, firstParam } from "../utils/gsavBridge";

/**
 * Shared GSAV scene screen rendered by both the /watch/:id and /gsav/:id routes.
 * Both routes resolve to the same web /watch path (buildGsavWatchPath); /gsav is
 * kept as an inbound deep-link alias. Keep this as the single source of truth so
 * the two route files cannot drift.
 */
export default function GsavScreen() {
  const params = useLocalSearchParams<{ id?: string; t?: string; share?: string }>();
  const sceneId = firstParam(params.id) ?? "elly";
  const startTime = firstParam(params.t);
  const share = firstParam(params.share);
  const path = useMemo(
    () => buildGsavWatchPath(sceneId, { startTime, share }),
    [sceneId, share, startTime],
  );

  return <GsavWebView path={path} title="Diveo" />;
}
