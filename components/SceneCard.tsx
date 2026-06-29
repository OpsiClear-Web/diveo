import React from "react";
import { View, Text, Pressable, StyleSheet, Share } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { useTheme, radius } from "../utils/theme";
import { GSAV_ACCENT, getConfiguredGsavWebUrl, buildGsavWatchPath } from "../utils/gsavBridge";
import type { GsavContentItem } from "../services/gsav";
import { useGsavAuthStore } from "../store/gsavAuthStore";
import { useSavedScenesStore } from "../store/savedScenesStore";

// Share a scene via the system share sheet, using its public web /watch URL.
async function shareScene(item: GsavContentItem) {
  const base = getConfiguredGsavWebUrl();
  if (!base) return;
  const url = `${base.replace(/\/+$/, "")}${buildGsavWatchPath(item.id)}`;
  try {
    await Share.share({ message: `${item.title}\n${url}`, url });
  } catch {
    // dismissed or unavailable — no-op
  }
}

// Shared 16:9 scene card for the GSAV browse surfaces (feed, search, creator).
// Self-themed; renders the real poster over a cube-icon fallback.
export function SceneCard({
  item,
  onPress,
  onAuthorPress,
}: {
  item: GsavContentItem;
  onPress: () => void;
  onAuthorPress?: () => void;
}) {
  const theme = useTheme();
  const userId = useGsavAuthStore((s) => s.user?.id);
  const saved = useSavedScenesStore((s) => (item.backendId ? s.savedIds.has(item.backendId) : false));
  const toggleSave = useSavedScenesStore((s) => s.toggle);
  const showSave = Boolean(userId && item.backendId);
  return (
    <Pressable
      style={[styles.card, { backgroundColor: theme.card }]}
      onPress={onPress}
      onLongPress={() => {
        void shareScene(item);
      }}
      accessibilityLabel={`Open ${item.title}`}
    >
      <View style={[styles.thumb, { backgroundColor: theme.placeholder }]}>
        <Ionicons name="cube-outline" size={26} color={GSAV_ACCENT} />
        {item.posterUrl ? (
          <Image source={{ uri: item.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        ) : null}
        {showSave ? (
          <Pressable
            style={styles.saveBtn}
            onPress={() => item.backendId && toggleSave(item.backendId)}
            hitSlop={6}
            accessibilityLabel={saved ? "Remove from library" : "Save to library"}
          >
            <Ionicons name={saved ? "bookmark" : "bookmark-outline"} size={15} color={saved ? GSAV_ACCENT : "#ededed"} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.info}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>{item.title}</Text>
        {onAuthorPress ? (
          <Pressable onPress={onAuthorPress} hitSlop={4} accessibilityLabel={`Open ${item.author}`}>
            <Text numberOfLines={1} style={[styles.sub, { color: theme.textSub }]}>{item.author}</Text>
          </Pressable>
        ) : (
          <Text numberOfLines={1} style={[styles.sub, { color: theme.textSub }]}>{item.author}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "47.5%",
    flexGrow: 1,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  thumb: { aspectRatio: 16 / 9, alignItems: "center", justifyContent: "center" },
  saveBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: "rgba(5,5,5,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  info: { padding: 8 },
  title: { fontFamily: "Roboto_500Medium", fontSize: 13 },
  sub: { fontFamily: "Roboto_400Regular", fontSize: 11, marginTop: 2 },
});
