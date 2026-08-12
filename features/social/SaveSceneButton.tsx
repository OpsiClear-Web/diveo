import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { GSAV_ACCENT, radius } from "../../shared/theme";
import { useGsavAuthStore } from "./gsavAuthStore";
import { useSavedScenesStore } from "./savedScenesStore";

export function SaveSceneButton({ backendId }: { backendId?: string }) {
  const userId = useGsavAuthStore((s) => s.user?.id);
  const saved = useSavedScenesStore((s) => (backendId ? s.savedIds.has(backendId) : false));
  const toggleSave = useSavedScenesStore((s) => s.toggle);

  if (!userId || !backendId) return null;

  return (
    <Pressable
      style={styles.saveBtn}
      onPress={() => toggleSave(backendId)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ selected: saved }}
      accessibilityLabel={saved ? "Remove from library" : "Save to library"}
    >
      <Ionicons name={saved ? "bookmark" : "bookmark-outline"} size={15} color={saved ? GSAV_ACCENT : "#ededed"} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  saveBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: "rgba(5,5,5,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
});
