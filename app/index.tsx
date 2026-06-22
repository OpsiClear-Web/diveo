import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { type ThemeColors, useTheme } from "../utils/theme";
import { GSAV_ACCENT } from "../utils/gsavBridge";

// diveo-first home: a browse landing that deep-links into the hosted 4D player
// (gsav-hosting) by scene id. This is a launcher, NOT a catalog — the real catalog
// is owned by gsav-hosting and loads here once its origin is live (ADR-0001 / G1).
// Until then we surface a small curated set of the known local scenes.
type Scene = { id: string; title: string; subtitle: string };

const FEATURED: Scene = { id: "elly", title: "Elly", subtitle: "Featured 4D scene" };
const SCENES: Scene[] = [
  { id: "elly", title: "Elly", subtitle: "4D Gaussian scene" },
  { id: "test", title: "Test Scene", subtitle: "Diagnostics sample" },
];

const FONT = {
  regular: "Roboto_400Regular",
  medium: "Roboto_500Medium",
  bold: "Roboto_700Bold",
  black: "Roboto_900Black",
} as const;

function SceneCard({
  scene,
  theme,
  onPress,
}: {
  scene: Scene;
  theme: ThemeColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
      onPress={onPress}
      accessibilityLabel={`Open ${scene.title}`}
    >
      <View style={[styles.cardThumb, { backgroundColor: theme.placeholder }]}>
        <Ionicons name="cube-outline" size={26} color={GSAV_ACCENT} />
      </View>
      <View style={styles.cardInfo}>
        <Text numberOfLines={1} style={[styles.cardTitle, { color: theme.text }]}>{scene.title}</Text>
        <Text numberOfLines={1} style={[styles.cardSub, { color: theme.textSub }]}>{scene.subtitle}</Text>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const openScene = (id: string) => router.push(`/watch/${id}` as never);

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

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        <Pressable
          style={[styles.hero, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => openScene(FEATURED.id)}
          accessibilityLabel={`Play ${FEATURED.title}`}
        >
          <View style={[styles.heroThumb, { backgroundColor: theme.placeholder }]}>
            <Ionicons name="cube-outline" size={48} color={GSAV_ACCENT} />
          </View>
          <View style={styles.heroOverlay}>
            <Text numberOfLines={1} style={styles.heroTitle}>{FEATURED.title}</Text>
            <Text numberOfLines={1} style={styles.heroSub}>{FEATURED.subtitle}</Text>
          </View>
        </Pressable>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>Scenes</Text>
        <View style={styles.grid}>
          {SCENES.map((s) => (
            <SceneCard key={s.id} scene={s} theme={theme} onPress={() => openScene(s.id)} />
          ))}
        </View>

        <Text style={[styles.hint, { color: theme.textSub }]}>
          The full catalog loads from the diveo cloud once connected.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  card: {
    width: "47.5%",
    flexGrow: 1,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardThumb: { aspectRatio: 16 / 9, alignItems: "center", justifyContent: "center" },
  cardInfo: { padding: 8 },
  cardTitle: { fontFamily: FONT.medium, fontSize: 13 },
  cardSub: { fontFamily: FONT.regular, fontSize: 11, marginTop: 2 },
  hint: { fontFamily: FONT.regular, fontSize: 12, textAlign: "center", marginTop: 4 },
});
