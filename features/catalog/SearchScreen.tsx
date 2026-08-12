import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { buildGsavWatchPath } from "../../shared/gsavRoutes";
import { useTheme } from "../../shared/themeContext";
import { NativeCenterState } from "../../shared/ui/NativeScreen";
import { SceneCard } from "../scene/SceneCard";
import { shareScene } from "../scene/sceneShare";
import { SaveSceneButton } from "../social/SaveSceneButton";
import { useGsavSearch } from "./useGsavSearch";

// Native search over gsav-hosting's catalog (the `q` param). Debounced
// while typing; submit forces an immediate query. Reuses the shared SceneCard.
export default function SearchScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { results, loading, error, searched, search, history, pushHistory, removeHistory, clearHistory } =
    useGsavSearch();
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChange = useCallback(
    (value: string) => {
      setText(value);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => search(value), 350);
    },
    [search],
  );

  const submit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const trimmed = text.trim();
    if (trimmed) pushHistory(trimmed);
    search(text);
  }, [pushHistory, search, text]);

  const runQuery = useCallback(
    (q: string) => {
      if (timer.current) clearTimeout(timer.current);
      setText(q);
      pushHistory(q);
      search(q);
    },
    [pushHistory, search],
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={["top", "left", "right"]}>
      <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <Pressable
          style={styles.iconBtn}
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={theme.text} />
        </Pressable>
        <View style={[styles.inputWrap, { backgroundColor: theme.inputBg }]}>
          <Ionicons name="search" size={16} color={theme.textSub} />
          <TextInput
            style={[styles.input, { color: theme.text }]}
            value={text}
            onChangeText={onChange}
            onSubmitEditing={submit}
            placeholder="Search scenes"
            placeholderTextColor={theme.textSub}
            autoFocus
            returnKeyType="search"
            autoCorrect={false}
          />
          {text.length > 0 ? (
            <Pressable
              onPress={() => onChange("")}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={16} color={theme.textSub} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {loading ? (
        <NativeCenterState loading />
      ) : error ? (
        <NativeCenterState
          message={error}
          actionLabel="Retry"
          onAction={() => search(text)}
        />
      ) : searched && results.length === 0 ? (
        <NativeCenterState
          message={`No scenes match “${text.trim()}”.`}
          actionLabel="Clear search"
          onAction={() => onChange("")}
        />
      ) : results.length === 0 ? (
        history.length > 0 ? (
          <ScrollView contentContainerStyle={styles.recent} keyboardShouldPersistTaps="handled">
            <View style={styles.recentHeader}>
              <Text style={[styles.recentTitle, { color: theme.textSub }]}>Recent</Text>
              <Pressable
                onPress={clearHistory}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Clear search history"
              >
                <Text style={[styles.recentClear, { color: theme.textSub }]}>Clear</Text>
              </Pressable>
            </View>
            {/* No button role on history rows: each contains the remove button
                and nested <button> elements are invalid HTML on web. */}
            {history.map((entry) => (
              <Pressable
                key={entry}
                style={styles.recentRow}
                onPress={() => runQuery(entry)}
                accessibilityLabel={`Search ${entry}`}
              >
                <Ionicons name="time-outline" size={16} color={theme.textSub} />
                <Text style={[styles.recentText, { color: theme.text }]} numberOfLines={1}>
                  {entry}
                </Text>
                <Pressable
                  onPress={() => removeHistory(entry)}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${entry}`}
                >
                  <Ionicons name="close" size={15} color={theme.textSub} />
                </Pressable>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <NativeCenterState message="Search by scene title or creator name." />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.grid}>
            {results.map((s) => (
              <SceneCard
                colors={theme}
                key={s.id}
                item={s}
                onPress={() => router.push(buildGsavWatchPath(s.id) as never)}
                onLongPress={() => {
                  void shareScene(s);
                }}
                onAuthorPress={s.creatorId ? () => router.push(`/creator/${s.creatorId}` as never) : undefined}
                thumbnailAccessory={<SaveSceneButton backendId={s.backendId} />}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 8,
  },
  input: { flex: 1, fontFamily: "Roboto_400Regular", fontSize: 14, padding: 0 },
  recent: { padding: 16, gap: 2, width: "100%", maxWidth: 1120, alignSelf: "center" },
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  recentTitle: { fontFamily: "Roboto_500Medium", fontSize: 13 },
  recentClear: { fontFamily: "Roboto_400Regular", fontSize: 13 },
  recentRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  recentText: { flex: 1, fontFamily: "Roboto_400Regular", fontSize: 14 },
  scroll: { padding: 16, width: "100%", maxWidth: 1120, alignSelf: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
});
