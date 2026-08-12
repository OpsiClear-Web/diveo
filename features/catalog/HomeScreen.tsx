import React from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { buildGsavWatchPath } from "../../shared/gsavRoutes";
import { GSAV_ACCENT, GSAV_ACCENT_CONTRAST, radius } from "../../shared/theme";
import { useTheme } from "../../shared/themeContext";
import { Brand } from "../../shared/ui/Brand";
import { SceneCard } from "../scene/SceneCard";
import { shareScene } from "../scene/sceneShare";
import { SaveSceneButton } from "../social/SaveSceneButton";
import { ContinueWatchingPill } from "./ContinueWatchingPill";
import { useGsavFeed } from "./useGsavFeed";

// Native home: a diveo-content feed read live through the GSAV catalog adapter.
// Tapping a scene opens the GSAV player
// (the WebView watch route). gsav-hosting remains the source of truth for content;
// the native app owns the browse experience.
const FONT = {
  regular: "Roboto_400Regular",
  bold: "Roboto_700Bold",
  black: "Roboto_900Black",
} as const;

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { items, loading, refreshing, loadingMore, hasMore, error, reload, refresh, loadMore } =
    useGsavFeed();

  const openScene = (id: string) => router.push(buildGsavWatchPath(id) as never);
  const featured = items[0];
  // The featured scene already fills the hero; the grid lists the rest so one
  // scene never appears twice in the same viewport.
  const gridItems = items.slice(1);

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <View
        style={[
          styles.topNav,
          { paddingTop: insets.top + 8, backgroundColor: theme.card, borderBottomColor: theme.border },
        ]}
      >
        <Brand color={theme.text} />
        <View style={styles.topNavActions}>
          <Pressable
            onPress={() => router.push("/explore" as never)}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Explore"
          >
            <Ionicons name="play-circle-outline" size={22} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/search" as never)}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Search"
          >
            <Ionicons name="search" size={20} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/library" as never)}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Library"
          >
            <Ionicons name="bookmark-outline" size={19} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/settings" as never)}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Ionicons name="settings-outline" size={20} color={theme.text} />
          </Pressable>
        </View>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.fill}>
          <ActivityIndicator color={GSAV_ACCENT} />
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.fill}>
          <Text style={[styles.msgTitle, { color: theme.text }]}>Unable to load the catalog</Text>
          <Text style={[styles.msgSub, { color: theme.textSub }]}>{error}</Text>
          <Pressable style={styles.retry} onPress={reload} accessibilityRole="button" accessibilityLabel="Retry">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.fill}>
          <Text style={[styles.msgSub, { color: theme.textSub }]}>No scenes published yet.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={GSAV_ACCENT} />}
          onScroll={({ nativeEvent }) => {
            const distanceFromBottom =
              nativeEvent.contentSize.height -
              nativeEvent.layoutMeasurement.height -
              nativeEvent.contentOffset.y;
            if (distanceFromBottom < 400 && hasMore && !loadingMore) loadMore();
          }}
          scrollEventThrottle={200}
        >
          {featured ? (
            <Pressable
              style={[styles.hero, { backgroundColor: theme.card }]}
              onPress={() => openScene(featured.id)}
              accessibilityRole="button"
              accessibilityLabel={`Play ${featured.title}`}
            >
              <View style={[styles.heroThumb, { backgroundColor: theme.placeholder }]}>
                <Ionicons name="cube-outline" size={48} color={GSAV_ACCENT} />
                {featured.posterUrl ? (
                  <Image
                    source={{ uri: featured.posterUrl }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={150}
                    alt={`${featured.title} poster`}
                  />
                ) : null}
              </View>
              <View style={styles.heroOverlay}>
                <Text numberOfLines={1} style={[styles.heroTitle, { color: theme.text }]}>{featured.title}</Text>
                <Text numberOfLines={1} style={[styles.heroSub, { color: theme.textSub }]}>{featured.author}</Text>
              </View>
            </Pressable>
          ) : null}

          {gridItems.length > 0 ? (
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Scenes</Text>
          ) : null}
          <View style={styles.grid}>
            {gridItems.map((s) => (
              <SceneCard
                colors={theme}
                key={s.id}
                item={s}
                onPress={() => openScene(s.id)}
                onLongPress={() => {
                  void shareScene(s);
                }}
                onAuthorPress={s.creatorId ? () => router.push(`/creator/${s.creatorId}` as never) : undefined}
                thumbnailAccessory={<SaveSceneButton backendId={s.backendId} />}
              />
            ))}
          </View>
          {loadingMore && <ActivityIndicator color={GSAV_ACCENT} style={styles.feedFooter} />}
        </ScrollView>
      )}

      <ContinueWatchingPill items={items} bottomOffset={insets.bottom + 16} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  msgTitle: { fontFamily: FONT.bold, fontSize: 16 },
  msgSub: { fontFamily: FONT.regular, fontSize: 13, textAlign: "center" },
  retry: {
    marginTop: 8,
    minWidth: 100,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: GSAV_ACCENT,
    borderRadius: radius.md,
  },
  retryText: { color: GSAV_ACCENT_CONTRAST, fontFamily: FONT.bold, fontSize: 14 },
  topNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topNavActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  iconBtn: { width: 34, height: 34, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  scroll: { padding: 16, gap: 16 },
  hero: {
    borderRadius: radius.md,
    overflow: "hidden",
  },
  heroThumb: { aspectRatio: 16 / 9, alignItems: "center", justifyContent: "center" },
  heroOverlay: { padding: 14 },
  heroTitle: { fontFamily: FONT.bold, fontSize: 18 },
  heroSub: { fontFamily: FONT.regular, fontSize: 13, marginTop: 2 },
  sectionTitle: { fontFamily: FONT.bold, fontSize: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  feedFooter: { marginTop: 16 },
});
