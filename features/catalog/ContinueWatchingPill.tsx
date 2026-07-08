import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { buildGsavWatchPath } from "../../shared/gsavRoutes";
import { GSAV_ACCENT, radius, space } from "../../shared/theme";
import { useTheme } from "../../shared/themeContext";
import { useLatestGsavResume, type GsavResumeCandidate } from "../player/resumeAccess";

type ContinueWatchingItem = GsavResumeCandidate;

// The WebView player cannot float live across native screens, so catalog owns
// this native resume affordance while player owns the progress contract.
export function ContinueWatchingPill({
  items,
  bottomOffset = 16,
}: {
  items: ContinueWatchingItem[];
  bottomOffset?: number;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { item, clearResume } = useLatestGsavResume(items);

  if (!item) return null;

  return (
    <View style={[styles.pill, { backgroundColor: theme.card, bottom: bottomOffset }]}>
      <Pressable
        style={styles.main}
        onPress={() => router.push(buildGsavWatchPath(item.id) as never)}
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
            <View style={[styles.progressFill, { width: `${item.progressPercent}%` }]} />
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
        onPress={clearResume}
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
