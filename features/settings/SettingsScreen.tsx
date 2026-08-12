import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { createLoginHref } from "../../shared/authReturn";
import { GSAV_ACCENT, GSAV_ACCENT_CONTRAST, radius } from "../../shared/theme";
import { useTheme } from "../../shared/themeContext";
import { useSettingsUpdateStatus } from "../app-update/updateAccess";
import { useEditablePreferences } from "../preferences/preferenceAccess";
import { useAuthAccount } from "../social/authSession";
import { clearImageCache, formatBytes, getImageCacheSize } from "./cache";

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuthAccount();
  const { darkMode, setDarkMode, trafficSaving, setTrafficSaving } = useEditablePreferences();
  const theme = useTheme();
  const { currentVersion, isChecking, downloadProgress, checkUpdate } = useSettingsUpdateStatus();
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const size = await getImageCacheSize();
      if (active) setCacheSize(size);
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleClearCache = async () => {
    Alert.alert("Clear cache", "Remove all cached data?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          setClearingCache(true);
          await clearImageCache();
          setClearingCache(false);
          setCacheSize(0);
          Alert.alert("Done", "Cache cleared.");
        },
      },
    ]);
  };

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={[styles.topBar, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: theme.text }]} accessibilityRole="header">Settings</Text>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.section, { backgroundColor: theme.card }]}>
          <Text style={[styles.sectionLabel, { color: theme.textSub }]} accessibilityRole="header">Account</Text>
          {user ? (
            <View style={styles.versionRow}>
              <Text style={[styles.versionLabel, { color: theme.text }]} numberOfLines={1}>{user.email}</Text>
              <TouchableOpacity
                onPress={handleLogout}
                activeOpacity={0.7}
                style={styles.inlineAction}
                accessibilityRole="button"
                accessibilityLabel="Log out"
              >
                <Text style={[styles.updateBtnText, { color: theme.danger }]}>Log out</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.updateBtn}
              onPress={() => router.push(createLoginHref("/settings") as never)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Log in"
            >
              <Text style={styles.updateBtnText}>Log in</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.textSub} style={styles.rowChevron} />
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.section, { backgroundColor: theme.card }]}>
          <Text style={[styles.sectionLabel, { color: theme.textSub }]} accessibilityRole="header">Version</Text>
          <View style={styles.versionRow}>
            <Text style={[styles.versionLabel, { color: theme.text }]}>Current version</Text>
            <Text style={[styles.versionValue, { color: theme.textSub }]}>v{currentVersion}</Text>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: theme.card }]}>
          <Text style={[styles.sectionLabel, { color: theme.textSub }]} accessibilityRole="header">Updates</Text>
          <TouchableOpacity
            style={styles.updateBtn}
            onPress={() => checkUpdate()}
            activeOpacity={0.7}
            disabled={isChecking || downloadProgress !== null}
            accessibilityRole="button"
            accessibilityLabel="Check for updates"
            accessibilityState={{ disabled: isChecking || downloadProgress !== null }}
          >
            {isChecking ? (
              <>
                <ActivityIndicator size="small" color={GSAV_ACCENT} style={{ marginRight: 8 }} />
                <Text style={styles.updateBtnText}>Checking...</Text>
              </>
            ) : downloadProgress !== null ? (
              <Text style={styles.updateBtnText}>Downloading {downloadProgress}%</Text>
            ) : (
              <Text style={styles.updateBtnText}>Check for updates</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={[styles.section, { backgroundColor: theme.card }]}>
          <Text style={[styles.sectionLabel, { color: theme.textSub }]} accessibilityRole="header">Appearance</Text>
          <View style={styles.optionRow}>
            <TouchableOpacity
              style={[styles.option, { borderColor: theme.border }, !darkMode && styles.optionActive]}
              onPress={() => setDarkMode(false)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: !darkMode }}
            >
              <Text style={[styles.optionText, { color: theme.text }, !darkMode && styles.optionTextActive]}>Light</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.option, { borderColor: theme.border }, darkMode && styles.optionActive]}
              onPress={() => setDarkMode(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: darkMode }}
            >
              <Text style={[styles.optionText, { color: theme.text }, darkMode && styles.optionTextActive]}>Dark</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: theme.card }]}>
          <Text style={[styles.sectionLabel, { color: theme.textSub }]} accessibilityRole="header">Data</Text>
          <View style={styles.optionRow}>
            <TouchableOpacity
              style={[styles.option, { borderColor: theme.border }, !trafficSaving && styles.optionActive]}
              onPress={() => setTrafficSaving(false)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: !trafficSaving }}
            >
              <Text style={[styles.optionText, { color: theme.text }, !trafficSaving && styles.optionTextActive]}>Standard</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.option, { borderColor: theme.border }, trafficSaving && styles.optionActive]}
              onPress={() => setTrafficSaving(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: trafficSaving }}
            >
              <Text style={[styles.optionText, { color: theme.text }, trafficSaving && styles.optionTextActive]}>Data saver</Text>
            </TouchableOpacity>
          </View>
          {trafficSaving ? (
            <Text style={[styles.hint, { color: theme.textSub }]}>
              No autoplay in Explore, static posters, lighter data use
            </Text>
          ) : null}
        </View>

        <View style={[styles.section, { backgroundColor: theme.card }]}>
          <Text style={[styles.sectionLabel, { color: theme.textSub }]} accessibilityRole="header">Storage</Text>
          <View style={styles.cacheRow}>
            <View>
              <Text style={[styles.cacheLabel, { color: theme.text }]}>Cache size</Text>
              <Text style={[styles.cacheValue, { color: theme.textSub }]}>
                {cacheSize === null ? "Calculating..." : formatBytes(cacheSize)}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.clearBtn, clearingCache && { opacity: 0.5 }]}
              onPress={handleClearCache}
              disabled={clearingCache}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Clear cache"
              accessibilityState={{ disabled: clearingCache }}
            >
              {clearingCache ? (
                <ActivityIndicator size="small" color={GSAV_ACCENT_CONTRAST} />
              ) : (
                <Text style={styles.clearBtnText}>Clear cache</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: theme.card }]}>
          <Text style={[styles.sectionLabel, { color: theme.textSub }]} accessibilityRole="header">Diagnostics</Text>
          <TouchableOpacity
            style={styles.updateBtn}
            onPress={() => router.push("/gsav-diagnostics" as never)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Open diagnostics"
          >
            <Ionicons name="pulse-outline" size={18} color={GSAV_ACCENT} style={styles.actionIcon} />
            <Text style={styles.updateBtnText}>Open diagnostics</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.textSub} style={styles.rowChevron} />
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  spacer: { width: 44 },
  topTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Roboto_700Bold",
    textAlign: "center",
  },
  content: { paddingBottom: 24 },
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sectionLabel: { fontSize: 13, marginBottom: 10, fontFamily: "Roboto_500Medium" },
  optionRow: { flexDirection: "row", gap: 10 },
  option: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  optionActive: { backgroundColor: GSAV_ACCENT, borderColor: GSAV_ACCENT },
  optionText: { fontSize: 13, fontFamily: "Roboto_500Medium" },
  optionTextActive: { color: GSAV_ACCENT_CONTRAST, fontFamily: "Roboto_700Bold" },
  hint: { fontSize: 12, marginTop: 8, fontFamily: "Roboto_400Regular" },
  versionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  versionLabel: { fontSize: 14, fontFamily: "Roboto_400Regular" },
  versionValue: { fontSize: 14, fontFamily: "Roboto_500Medium" },
  updateBtn: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingVertical: 6,
  },
  inlineAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  actionIcon: { marginRight: 8 },
  rowChevron: { marginLeft: "auto" },
  updateBtnText: { fontSize: 14, color: GSAV_ACCENT, fontFamily: "Roboto_700Bold" },
  cacheRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cacheLabel: { fontSize: 14, fontFamily: "Roboto_400Regular" },
  cacheValue: { fontSize: 12, marginTop: 2, fontFamily: "Roboto_400Regular" },
  clearBtn: {
    backgroundColor: GSAV_ACCENT,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: radius.md,
    minWidth: 80,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtnText: { color: GSAV_ACCENT_CONTRAST, fontSize: 13, fontFamily: "Roboto_700Bold" },
});
