import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { createLoginHref } from "../../shared/authReturn";
import { formatGsavCatalogError } from "../../shared/gsavErrors";
import { buildGsavWatchPath } from "../../shared/gsavRoutes";
import { useTheme } from "../../shared/themeContext";
import { NativeCenterState, NativeScreenHeader } from "../../shared/ui/NativeScreen";
import { SceneCard } from "../scene/SceneCard";
import { shareScene } from "../scene/sceneShare";
import type { SceneItem } from "../scene/sceneTypes";
import { useGsavAuthStore } from "./gsavAuthStore";
import { loadSavedScenesByBackendIds } from "./loadSavedScenesByBackendIds";
import { SaveSceneButton } from "./SaveSceneButton";
import { useSavedScenesStore } from "./savedScenesStore";

// Native library: load the user's saved scene backend IDs, then resolve those
// scenes directly through the catalog. Do not depend on the first feed page.
export default function LibraryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const user = useGsavAuthStore((s) => s.user);
  const savedIds = useSavedScenesStore((s) => s.savedIds);
  const savedIdList = useMemo(() => [...savedIds].sort(), [savedIds]);
  const [saved, setSaved] = useState<SceneItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shouldLoadSaved = Boolean(user && savedIdList.length > 0);
  const visibleSaved = shouldLoadSaved ? saved : [];
  const visibleLoading = shouldLoadSaved && loading;
  const visibleError = shouldLoadSaved ? error : null;

  const loadSaved = useCallback(async (ids: string[], isCancelled: () => boolean) => {
    setLoading(true);
    setError(null);
    try {
      const scenes = await loadSavedScenesByBackendIds(ids);
      if (!isCancelled()) setSaved(scenes);
    } catch (e) {
      if (!isCancelled()) setError(formatGsavCatalogError(e, "Unable to load saved scenes."));
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!shouldLoadSaved) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSaved(savedIdList, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, [loadSaved, savedIdList, shouldLoadSaved]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={["top", "left", "right"]}>
      <NativeScreenHeader title="Library" onBack={() => router.back()} />

      {!user ? (
        <NativeCenterState
          message="Log in to save scenes to your library."
          actionLabel="Log in"
          onAction={() => router.push(createLoginHref("/library") as never)}
        />
      ) : visibleLoading && visibleSaved.length === 0 ? (
        <NativeCenterState loading />
      ) : visibleError ? (
        <NativeCenterState message={visibleError} />
      ) : visibleSaved.length === 0 ? (
        <NativeCenterState message="No saved scenes yet." />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.grid}>
            {visibleSaved.map((s) => (
              <SceneCard
                colors={theme}
                key={s.id}
                item={s}
                onPress={() => router.push(buildGsavWatchPath(s.id) as never)}
                onLongPress={() => {
                  void shareScene(s);
                }}
                thumbnailAccessory={<SaveSceneButton backendId={s.backendId} />}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
});
