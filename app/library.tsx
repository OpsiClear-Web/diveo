import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "../utils/theme";
import { GSAV_ACCENT, GSAV_ACCENT_CONTRAST } from "../utils/gsavBridge";
import { SceneCard } from "../components/SceneCard";
import { useGsavFeed } from "../hooks/useGsavFeed";
import { useSavedScenesStore } from "../store/savedScenesStore";
import { useGsavAuthStore } from "../store/gsavAuthStore";

// World B: the signed-in user's saved scenes. Intersects the user's saved set
// (savedScenesStore) with the catalog feed; bookmark toggles live via SceneCard.
const FONT = { regular: "Roboto_400Regular", bold: "Roboto_700Bold" } as const;

export default function LibraryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const user = useGsavAuthStore((s) => s.user);
  const savedIds = useSavedScenesStore((s) => s.savedIds);
  const { items, loading } = useGsavFeed();

  const saved = items.filter((i) => i.backendId && savedIds.has(i.backendId));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={["top", "left", "right"]}>
      <View style={[styles.topBar, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]}>Library</Text>
        <View style={styles.back} />
      </View>

      {!user ? (
        <View style={styles.fill}>
          <Text style={[styles.msg, { color: theme.textSub }]}>Log in to save scenes to your library.</Text>
          <Pressable style={styles.cta} onPress={() => router.push("/login" as never)} accessibilityLabel="Log in">
            <Text style={styles.ctaText}>Log in</Text>
          </Pressable>
        </View>
      ) : loading && saved.length === 0 ? (
        <View style={styles.fill}>
          <ActivityIndicator color={GSAV_ACCENT} />
        </View>
      ) : saved.length === 0 ? (
        <View style={styles.fill}>
          <Text style={[styles.msg, { color: theme.textSub }]}>No saved scenes yet. Tap the bookmark on any scene to save it.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.grid}>
            {saved.map((s) => (
              <SceneCard key={s.id} item={s} onPress={() => router.push(`/watch/${s.id}` as never)} />
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontFamily: FONT.bold, fontSize: 16 },
  fill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  msg: { fontFamily: FONT.regular, fontSize: 13, textAlign: "center" },
  cta: {
    minWidth: 100,
    height: 38,
    borderRadius: 8,
    backgroundColor: GSAV_ACCENT,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  ctaText: { color: GSAV_ACCENT_CONTRAST, fontFamily: FONT.bold, fontSize: 14 },
  scroll: { padding: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
});
