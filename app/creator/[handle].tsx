import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "../../utils/theme";
import { GSAV_ACCENT, GSAV_ACCENT_CONTRAST, firstParam } from "../../utils/gsavBridge";
import { SceneCard } from "../../components/SceneCard";
import { useGsavCreator } from "../../hooks/useGsavCreator";
import { useGsavFollow } from "../../hooks/useGsavFollow";

// World B: creator profile, adapted from the original Bilibili app/creator/[mid].tsx
// (hero + avatar + bio + stats + scene list) to gsav-hosting's creators/channel data.
// Minimal/silver aesthetic; banner + avatar fall back to a placeholder when the asset
// is absent.
const FONT = { regular: "Roboto_400Regular", medium: "Roboto_500Medium", bold: "Roboto_700Bold" } as const;

function formatCount(n?: number): string {
  if (n === undefined || n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function CreatorScreen() {
  const params = useLocalSearchParams<{ handle?: string }>();
  const handle = firstParam(params.handle) ?? "";
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { creator, videos, loading, error } = useGsavCreator(handle);
  const follow = useGsavFollow(creator?.backendId, creator?.followerCount);

  const name = creator?.displayName ?? handle;
  const sceneCount = creator?.publishedVideoCount ?? videos.length;

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View style={[styles.hero, { backgroundColor: theme.card, paddingTop: insets.top + 56 }]}>
          {creator?.bannerUrl ? (
            <Image source={{ uri: creator.bannerUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : null}
          <View style={[styles.heroOverlay, { backgroundColor: theme.card }]} />
          <View style={styles.heroContent}>
            <View style={[styles.avatar, { backgroundColor: theme.placeholder, borderColor: theme.border }]}>
              {creator?.avatarUrl ? (
                <Image source={{ uri: creator.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Text style={[styles.avatarInitial, { color: GSAV_ACCENT }]}>{name.slice(0, 1).toUpperCase()}</Text>
              )}
            </View>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{name}</Text>
            {creator?.bio ? (
              <Text style={[styles.bio, { color: theme.textSub }]} numberOfLines={2}>{creator.bio}</Text>
            ) : null}
            <View style={styles.stats}>
              <View style={styles.statItem}>
                <Text style={[styles.statNum, { color: theme.text }]}>{formatCount(follow.followerCount)}</Text>
                <Text style={[styles.statLabel, { color: theme.textSub }]}>Followers</Text>
              </View>
              <View style={[styles.statDiv, { backgroundColor: theme.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statNum, { color: theme.text }]}>{formatCount(sceneCount)}</Text>
                <Text style={[styles.statLabel, { color: theme.textSub }]}>Scenes</Text>
              </View>
            </View>
            {creator ? (
              <Pressable
                style={[styles.followBtn, follow.following ? styles.followingBtn : styles.followActiveBtn]}
                onPress={() => {
                  if (!follow.canFollow) {
                    router.push("/login" as never);
                    return;
                  }
                  follow.toggle();
                }}
                disabled={follow.busy}
                accessibilityLabel={follow.following ? "Unfollow" : "Follow"}
              >
                <Text style={[styles.followText, { color: follow.following ? theme.text : GSAV_ACCENT_CONTRAST }]}>
                  {follow.following ? "Following" : "Follow"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {loading ? (
          <View style={styles.fill}>
            <ActivityIndicator color={GSAV_ACCENT} />
          </View>
        ) : error ? (
          <View style={styles.fill}>
            <Text style={[styles.msg, { color: theme.textSub }]}>{error}</Text>
          </View>
        ) : (
          <View style={styles.body}>
            <Text style={[styles.section, { color: theme.text }]}>Scenes</Text>
            {videos.length === 0 ? (
              <Text style={[styles.msg, { color: theme.textSub }]}>No scenes yet.</Text>
            ) : (
              <View style={styles.grid}>
                {videos.map((s) => (
                  <SceneCard key={s.id} item={s} onPress={() => router.push(`/watch/${s.id}` as never)} />
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <Pressable
        style={[styles.back, { top: insets.top + 8 }]}
        onPress={() => router.back()}
        hitSlop={8}
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={22} color="#ededed" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { overflow: "hidden", paddingBottom: 18 },
  heroOverlay: { ...StyleSheet.absoluteFillObject, opacity: 0.82 },
  heroContent: { alignItems: "center", paddingHorizontal: 24 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  avatarInitial: { fontFamily: FONT.bold, fontSize: 28 },
  name: { fontFamily: FONT.bold, fontSize: 18, marginBottom: 6 },
  bio: { fontFamily: FONT.regular, fontSize: 13, textAlign: "center", lineHeight: 19, marginBottom: 12 },
  stats: { flexDirection: "row", alignItems: "center" },
  statItem: { alignItems: "center", paddingHorizontal: 24 },
  statNum: { fontFamily: FONT.bold, fontSize: 18 },
  statLabel: { fontFamily: FONT.regular, fontSize: 12, marginTop: 2 },
  statDiv: { width: StyleSheet.hairlineWidth, height: 28 },
  followBtn: {
    marginTop: 14,
    minWidth: 130,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  followActiveBtn: { backgroundColor: GSAV_ACCENT },
  followingBtn: { borderWidth: StyleSheet.hairlineWidth, borderColor: GSAV_ACCENT },
  followText: { fontFamily: FONT.bold, fontSize: 14 },
  body: { padding: 16, gap: 12 },
  section: { fontFamily: FONT.bold, fontSize: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  fill: { padding: 32, alignItems: "center", justifyContent: "center" },
  msg: { fontFamily: FONT.regular, fontSize: 13, textAlign: "center" },
  back: {
    position: "absolute",
    left: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5,5,5,0.45)",
  },
});
