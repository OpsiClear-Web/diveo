import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useTheme, radius, space } from "../utils/theme";
import { GSAV_ACCENT } from "../utils/gsavBridge";
import type { GsavContentItem } from "../services/gsav";
import { useGsavProgressStore } from "../store/gsavProgressStore";

// "Continue watching" pill — the pragmatic GSAV "PiP". The WebView player can't
// float live across native screens, so instead of a live mini-window we surface
// the most-recently-watched in-progress scene (from gsavProgressStore) as a
// dismissible poster pill; tapping reopens it at the saved offset (GsavScreen ?t=).
// Metadata comes from the feed items already loaded by the host screen, so there's
// no extra fetch; the pill self-hides when nothing is in progress.
export function ContinueWatchingPill({
  items,
  bottomOffset = 16,
}: {
  items: GsavContentItem[];
  bottomOffset?: number;
}) {
  const theme = useTheme();
  const router = useRouter();
  const records = useGsavProgressStore((s) => s.records);
  const hydrate = useGsavProgressStore((s) => s.hydrate);
  const clear = useGsavProgressStore((s) => s.clear);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Most-recently-watched in-progress scene that's present in the current feed.
  const record =
    Object.values(records)
      .sort((a, b) => b.ts - a.ts)
      .find((candidate) => items.some((item) => item.id === candidate.videoId)) ?? null;
  const item = record
    ? items.find((candidate) => candidate.id === record.videoId) ?? null
    : null;

  if (!record || !item) return null;
  const percent =
    record.duration > 0 ? Math.min(100, Math.round((record.time / record.duration) * 100)) : 0;

  return (
    <View style={[styles.pill, { backgroundColor: theme.card, bottom: bottomOffset }]}>
      <Pressable
        style={styles.main}
        onPress={() => router.push(`/watch/${item.id}` as never)}
        accessibilityLabel={`Continue watching ${item.title}`}
      >
        <View style={[styles.thumb, { backgroundColor: theme.placeholder }]}>
          <Ionicons name="cube-outline" size={18} color={GSAV_ACCENT} />
          {item.posterUrl ? (
            <Image
              source={{ uri: item.posterUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={120}
            />
          ) : null}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
        </View>
        <View style={styles.info}>
          <Text style={[styles.kicker, { color: theme.textSub }]}>Continue watching</Text>
          <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
            {item.title}
          </Text>
        </View>
        <Ionicons name="play" size={20} color={theme.text} style={styles.play} />
      </Pressable>
      <Pressable
        style={styles.close}
        onPress={() => clear(record.videoId)}
        hitSlop={8}
        accessibilityLabel="Dismiss continue watching"
      >
        <Ionicons name="close" size={16} color={theme.textSub} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.lg,
    paddingRight: space.sm,
    overflow: "hidden",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm },
  thumb: {
    width: 64,
    height: 40,
    borderRadius: radius.sm,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  progressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  progressFill: { height: 3, backgroundColor: GSAV_ACCENT },
  info: { flex: 1 },
  kicker: { fontFamily: "Roboto_400Regular", fontSize: 11 },
  title: { fontFamily: "Roboto_500Medium", fontSize: 13, marginTop: 1 },
  play: { marginLeft: space.sm },
  close: { padding: space.xs },
});
