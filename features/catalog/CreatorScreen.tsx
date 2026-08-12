import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { createLoginHref, creatorAuthReturnTo } from "../../shared/authReturn";
import { buildGsavWatchPath } from "../../shared/gsavRoutes";
import { GSAV_ACCENT } from "../../shared/theme";
import { useTheme } from "../../shared/themeContext";
import { firstParam } from "../../shared/routeParams";
import { SceneCard } from "../scene/SceneCard";
import { shareScene } from "../scene/sceneShare";
import { FollowButton } from "../social/FollowButton";
import { SaveSceneButton } from "../social/SaveSceneButton";
import { useGsavCreator } from "./useGsavCreator";

// Native creator profile adapted to gsav-hosting's creators/channel data.
// Minimal/silver aesthetic; banner + avatar fall back to a placeholder when the asset
// is absent.
const FONT = { regular: "Roboto_400Regular", medium: "Roboto_500Medium", bold: "Roboto_700Bold" } as const;

function formatCount(n?: number): string {
  if (n === undefined || n === null) return "-";
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
  const [followerCountOverride, setFollowerCountOverride] = useState<{
    channelId?: string;
    count: number;
  } | null>(null);

  const name = creator?.displayName ?? handle;
  const sceneCount = creator?.publishedVideoCount ?? videos.length;
  const matchingFollowerCountOverride = followerCountOverride?.channelId === creator?.backendId
    ? followerCountOverride
    : null;
  const displayFollowerCount = matchingFollowerCountOverride?.count ?? creator?.followerCount;
  const creatorReturnTo = creatorAuthReturnTo(handle);

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
              <Text style={[styles.avatarInitial, { color: GSAV_ACCENT }]}>{name.slice(0, 1).toUpperCase()}</Text>
              {creator?.avatarUrl ? (
                <Image source={{ uri: creator.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : null}
            </View>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1} accessibilityRole="header">{name}</Text>
            {creator?.bio ? (
              <Text style={[styles.bio, { color: theme.textSub }]} numberOfLines={2}>{creator.bio}</Text>
            ) : null}
            <View style={styles.stats}>
              <View style={styles.statItem}>
                <Text style={[styles.statNum, { color: theme.text }]}>{formatCount(displayFollowerCount)}</Text>
                <Text style={[styles.statLabel, { color: theme.textSub }]}>
                  {displayFollowerCount === 1 ? "Follower" : "Followers"}
                </Text>
              </View>
              <View style={[styles.statDiv, { backgroundColor: theme.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statNum, { color: theme.text }]}>{formatCount(sceneCount)}</Text>
                <Text style={[styles.statLabel, { color: theme.textSub }]}>
                  {sceneCount === 1 ? "Scene" : "Scenes"}
                </Text>
              </View>
            </View>
            {creator ? (
              <FollowButton
                channelId={creator.backendId}
                initialFollowerCount={creator.followerCount}
                onFollowerCountChange={(count) => {
                  setFollowerCountOverride({ channelId: creator.backendId, count });
                }}
                onRequireLogin={() => router.push(createLoginHref(creatorReturnTo) as never)}
              />
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
            <Text style={[styles.section, { color: theme.text }]} accessibilityRole="header">Scenes</Text>
            {videos.length === 0 ? (
              <Text style={[styles.msg, { color: theme.textSub }]}>No scenes yet.</Text>
            ) : (
              <View style={styles.grid}>
                {videos.map((s) => (
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
