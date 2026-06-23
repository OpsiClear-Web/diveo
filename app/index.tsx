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

import { useTheme } from "../utils/theme";
import { GSAV_ACCENT, GSAV_ACCENT_CONTRAST } from "../utils/gsavBridge";
import { useGsavFeed } from "../hooks/useGsavFeed";
import { SceneCard } from "../components/SceneCard";

// World B: the native home is a diveo-content feed read live from gsav-hosting's
// catalog (services/gsav -> useGsavFeed). Tapping a scene opens the GSAV player
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
  const { items, loading, refreshing, error, reload, refresh } = useGsavFeed();

  const openScene = (id: string) => router.push(`/watch/${id}` as never);
  const featured = items[0];

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <View
        style={[
          styles.topNav,
          { paddingTop: insets.top + 8, backgroundColor: theme.card, borderBottomColor: theme.border },
        ]}
      >
        <Text style={[styles.brand, { color: GSAV_ACCENT }]}>diveo</Text>
        <View style={styles.topNavActions}>
          <Pressable
            onPress={() => router.push("/search" as never)}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityLabel="Search"
          >
            <Ionicons name="search" size={20} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/library" as never)}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityLabel="Library"
          >
            <Ionicons name="bookmark-outline" size={19} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/gsav-diagnostics" as never)}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityLabel="Diveo diagnostics"
          >
            <Ionicons name="pulse-outline" size={20} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/settings" as never)}
            hitSlop={8}
            style={styles.iconBtn}
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
          <Pressable style={styles.retry} onPress={reload} accessibilityLabel="Retry">
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
        >
          {featured ? (
            <Pressable
              style={[styles.hero, { backgroundColor: theme.card, borderColor: theme.border }]}
              onPress={() => openScene(featured.id)}
              accessibilityLabel={`Play ${featured.title}`}
            >
              <View style={[styles.heroThumb, { backgroundColor: theme.placeholder }]}>
                <Ionicons name="cube-outline" size={48} color={GSAV_ACCENT} />
                {featured.posterUrl ? (
                  <Image source={{ uri: featured.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                ) : null}
              </View>
              <View style={styles.heroOverlay}>
                <Text numberOfLines={1} style={styles.heroTitle}>{featured.title}</Text>
                <Text numberOfLines={1} style={styles.heroSub}>{featured.author}</Text>
              </View>
            </Pressable>
          ) : null}

          <Text style={[styles.sectionTitle, { color: theme.text }]}>Scenes</Text>
          <View style={styles.grid}>
            {items.map((s) => (
              <SceneCard
                key={s.id}
                item={s}
                onPress={() => openScene(s.id)}
                onAuthorPress={s.creatorId ? () => router.push(`/creator/${s.creatorId}` as never) : undefined}
              />
            ))}
          </View>
        </ScrollView>
      )}
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
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: GSAV_ACCENT,
    borderRadius: 8,
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
  brand: { fontFamily: FONT.black, fontSize: 22, letterSpacing: 0.2 },
  topNavActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  scroll: { padding: 16, gap: 16 },
  hero: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  heroThumb: { aspectRatio: 16 / 9, alignItems: "center", justifyContent: "center" },
  heroOverlay: { padding: 14 },
  heroTitle: { fontFamily: FONT.bold, fontSize: 18, color: "#ededed" },
  heroSub: { fontFamily: FONT.regular, fontSize: 13, color: "#a2a2a2", marginTop: 2 },
  sectionTitle: { fontFamily: FONT.bold, fontSize: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
});
