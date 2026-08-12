import React, { useEffect, useMemo } from "react";
import { StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../../shared/themeContext";
import { FloatingBackButton } from "../../shared/ui/FloatingBackButton";
import { NativeCenterState } from "../../shared/ui/NativeScreen";
import { GsavWebView } from "./GsavWebView";
import { useGsavProgressStore } from "./gsavProgressStore";
import { buildGsavScreenWatchPath, resolveGsavScreenRouteParams } from "./routes";

/**
 * Shared GSAV scene screen rendered by both the /watch/:id and /gsav/:id routes.
 * Both routes resolve to the same web /watch path (buildGsavWatchPath); /gsav is
 * kept as an inbound deep-link alias. Keep this as the single source of truth so
 * the two route files cannot drift.
 *
 * Resume: if the scene has a saved playback position (and the caller didn't pass
 * an explicit ?t=), reopen at that offset. Render is gated on the progress store
 * being hydrated so the WebView mounts once with the right start, never loading
 * at 0 and then reloading at the resume offset.
 */
export default function GsavScreen() {
  const params = useLocalSearchParams<{ id?: string; t?: string; share?: string }>();
  const theme = useTheme();
  const route = useMemo(() => resolveGsavScreenRouteParams(params), [params]);

  const hydrated = useGsavProgressStore((s) => s.hydrated);
  const hydrate = useGsavProgressStore((s) => s.hydrate);
  const storedStart = useGsavProgressStore((s) => (
    route.ok ? s.records[route.sceneId]?.time ?? 0 : 0
  ));

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const path = useMemo(
    () => (
      route.ok
        ? buildGsavScreenWatchPath(route.sceneId, {
          explicitStartTime: route.startTime,
          storedStart,
          share: route.share,
        })
        : null
    ),
    [route, storedStart],
  );

  if (!route.ok) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
        <NativeCenterState
          title="Scene unavailable"
          message="This link is missing a GSAV scene id."
        />
        <FloatingBackButton />
      </SafeAreaView>
    );
  }

  if (!hydrated || !path) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
        <NativeCenterState loading message="Preparing playback..." />
        <FloatingBackButton />
      </SafeAreaView>
    );
  }

  return <GsavWebView path={path} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});
