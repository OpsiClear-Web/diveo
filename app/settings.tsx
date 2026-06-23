import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useGsavAuthStore } from '../store/gsavAuthStore';
import { useSettingsStore } from '../store/settingsStore';
import { useTheme } from '../utils/theme';
import { useCheckUpdate } from '../hooks/useCheckUpdate';
import { getImageCacheSize, clearImageCache, formatBytes } from '../utils/cache';
import { GSAV_ACCENT, GSAV_ACCENT_CONTRAST } from '../utils/gsavBridge';

export default function SettingsScreen() {
  const router = useRouter();
  const user = useGsavAuthStore((s) => s.user);
  const signOut = useGsavAuthStore((s) => s.signOut);
  const { darkMode, setDarkMode, trafficSaving, setTrafficSaving } = useSettingsStore();
  const theme = useTheme();
  const { currentVersion, isChecking, downloadProgress, checkUpdate } = useCheckUpdate();
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
    Alert.alert('Clear cache', 'Remove all cached data?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          setClearingCache(true);
          await clearImageCache();
          setClearingCache(false);
          setCacheSize(0);
          Alert.alert('Done', 'Cache cleared.');
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: theme.text }]}>Settings</Text>
        <View style={styles.spacer} />
      </View>

      <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.sectionLabel, { color: theme.textSub }]}>Account</Text>
        {user ? (
          <View style={styles.versionRow}>
            <Text style={[styles.versionLabel, { color: theme.text }]} numberOfLines={1}>{user.email}</Text>
            <TouchableOpacity onPress={handleLogout} activeOpacity={0.7}>
              <Text style={[styles.updateBtnText, { color: theme.danger }]}>Log out</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.updateBtn} onPress={() => router.push('/login' as never)} activeOpacity={0.7}>
            <Text style={styles.updateBtnText}>Log in</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.sectionLabel, { color: theme.textSub }]}>Version</Text>
        <View style={styles.versionRow}>
          <Text style={[styles.versionLabel, { color: theme.text }]}>Current version</Text>
          <Text style={[styles.versionValue, { color: theme.textSub }]}>v{currentVersion}</Text>
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.sectionLabel, { color: theme.textSub }]}>Updates</Text>
        <TouchableOpacity
          style={styles.updateBtn}
          onPress={() => checkUpdate()}
          activeOpacity={0.7}
          disabled={isChecking || downloadProgress !== null}
        >
          {isChecking ? (
            <>
              <ActivityIndicator size="small" color={GSAV_ACCENT} style={{ marginRight: 8 }} />
              <Text style={styles.updateBtnText}>Checking…</Text>
            </>
          ) : downloadProgress !== null ? (
            <Text style={styles.updateBtnText}>Downloading {downloadProgress}%</Text>
          ) : (
            <Text style={styles.updateBtnText}>Check for updates</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.sectionLabel, { color: theme.textSub }]}>Appearance</Text>
        <View style={styles.optionRow}>
          <TouchableOpacity
            style={[styles.option, { backgroundColor: theme.inputBg }, !darkMode && styles.optionActive]}
            onPress={() => setDarkMode(false)}
            activeOpacity={0.7}
          >
            <Text style={[styles.optionText, { color: theme.text }, !darkMode && styles.optionTextActive]}>Light</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.option, { backgroundColor: theme.inputBg }, darkMode && styles.optionActive]}
            onPress={() => setDarkMode(true)}
            activeOpacity={0.7}
          >
            <Text style={[styles.optionText, { color: theme.text }, darkMode && styles.optionTextActive]}>Dark</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.sectionLabel, { color: theme.textSub }]}>Data</Text>
        <View style={styles.optionRow}>
          <TouchableOpacity
            style={[styles.option, { backgroundColor: theme.inputBg }, !trafficSaving && styles.optionActive]}
            onPress={() => setTrafficSaving(false)}
            activeOpacity={0.7}
          >
            <Text style={[styles.optionText, { color: theme.text }, !trafficSaving && styles.optionTextActive]}>Standard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.option, { backgroundColor: theme.inputBg }, trafficSaving && styles.optionActive]}
            onPress={() => setTrafficSaving(true)}
            activeOpacity={0.7}
          >
            <Text style={[styles.optionText, { color: theme.text }, trafficSaving && styles.optionTextActive]}>Data saver</Text>
          </TouchableOpacity>
        </View>
        {trafficSaving && (
          <Text style={[styles.hint, { color: theme.textSub }]}>
            Lower-res thumbnails · no autoplay on home · 360p default
          </Text>
        )}
      </View>

      <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.sectionLabel, { color: theme.textSub }]}>Storage</Text>
        <View style={styles.cacheRow}>
          <View>
            <Text style={[styles.cacheLabel, { color: theme.text }]}>Cache size</Text>
            <Text style={[styles.cacheValue, { color: theme.textSub }]}>
              {cacheSize === null ? 'Calculating…' : formatBytes(cacheSize)}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.clearBtn, clearingCache && { opacity: 0.5 }]}
            onPress={handleClearCache}
            disabled={clearingCache}
            activeOpacity={0.7}
          >
            {clearingCache
              ? <ActivityIndicator size="small" color={GSAV_ACCENT_CONTRAST} />
              : <Text style={styles.clearBtnText}>Clear cache</Text>
            }
          </TouchableOpacity>
        </View>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4, width: 32 },
  spacer: { width: 32 },
  topTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Roboto_700Bold',
    textAlign: 'center',
  },
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionLabel: { fontSize: 13, marginBottom: 10, fontFamily: 'Roboto_500Medium' },
  optionRow: { flexDirection: 'row', gap: 10 },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  optionActive: { backgroundColor: GSAV_ACCENT },
  optionText: { fontSize: 13, fontFamily: 'Roboto_500Medium' },
  optionTextActive: { color: GSAV_ACCENT_CONTRAST, fontFamily: 'Roboto_700Bold' },
  hint: { fontSize: 12, marginTop: 8, fontFamily: 'Roboto_400Regular' },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  versionLabel: { fontSize: 14, fontFamily: 'Roboto_400Regular' },
  versionValue: { fontSize: 14, fontFamily: 'Roboto_500Medium' },
  updateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  updateBtnText: { fontSize: 14, color: GSAV_ACCENT, fontFamily: 'Roboto_700Bold' },
  cacheRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cacheLabel: { fontSize: 14, fontFamily: 'Roboto_400Regular' },
  cacheValue: { fontSize: 12, marginTop: 2, fontFamily: 'Roboto_400Regular' },
  clearBtn: {
    backgroundColor: GSAV_ACCENT,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  clearBtnText: { color: GSAV_ACCENT_CONTRAST, fontSize: 13, fontFamily: 'Roboto_700Bold' },
});
