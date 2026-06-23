import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform, Text, View } from 'react-native';
import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useDownloadStore } from '../store/downloadStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayProgressStore } from '../store/playProgressStore';
import { initMiniExclusion } from '../store/miniExclusion';
import { isGsavShellRoute } from '../utils/gsavBridge';
import { useTheme } from '../utils/theme';
import { useCheckUpdate } from '../hooks/useCheckUpdate';
import { useGsavAuthStore } from '../store/gsavAuthStore';
import { useSavedScenesStore } from '../store/savedScenesStore';
import { MiniPlayer } from '../components/MiniPlayer';
import { LiveMiniPlayer } from '../components/LiveMiniPlayer';
import * as Sentry from '@sentry/react-native';
import { ErrorBoundary } from '@sentry/react-native';
import { useFonts } from 'expo-font';
import {
  Roboto_400Regular,
  Roboto_500Medium,
  Roboto_700Bold,
  Roboto_900Black,
} from '@expo-google-fonts/roboto';
import { Ionicons } from '@expo/vector-icons';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  enabled: !__DEV__,
  tracesSampleRate: 0.05,
  environment: process.env.EXPO_PUBLIC_APP_ENV ?? 'production',
});

function RootLayout() {
  const restore = useAuthStore(s => s.restore);
  const loadDownloads = useDownloadStore(s => s.loadFromStorage);
  const restoreSettings = useSettingsStore(s => s.restore);
  const darkMode = useSettingsStore(s => s.darkMode);
  const { checkUpdate } = useCheckUpdate();
  const authUserId = useGsavAuthStore(s => s.user?.id);
  const pathname = usePathname();
  const gsavShellActive = isGsavShellRoute(pathname);

  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
    Roboto_400Regular,
    Roboto_500Medium,
    Roboto_700Bold,
    Roboto_900Black,
  });

  useEffect(() => {
    restore();
    loadDownloads();
    restoreSettings();
    usePlayProgressStore.getState().hydrate();
    initMiniExclusion();
    useGsavAuthStore.getState().init();
    // World A: the native client self-updates (APK). Check once on launch and
    // only prompt if a newer build exists; settings still has a manual check.
    if (Platform.OS === 'android') {
      void checkUpdate({ silent: true });
    }
  }, []);

  useEffect(() => {
    void useSavedScenesStore.getState().load();
  }, [authUserId]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style={darkMode ? 'light' : 'dark'} />
      <View style={{ flex: 1 }}>
        <ErrorBoundary fallback={<Text style={{ padding: 32, textAlign: 'center', color: '#ededed', fontFamily: 'Roboto_400Regular' }}>Something went wrong. Please restart the app.</Text>}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen
              name="video"
              options={{
                animation: "slide_from_right",
                gestureEnabled: true,
                gestureDirection: "horizontal",
              }}
            />
            <Stack.Screen
              name="live"
              options={{
                animation: "slide_from_right",
                gestureEnabled: true,
                gestureDirection: "horizontal",
              }}
            />
            <Stack.Screen
              name="search"
              options={{
                animation: "slide_from_right",
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="downloads"
              options={{
                animation: "slide_from_right",
                gestureEnabled: true,
                gestureDirection: "horizontal",
              }}
            />
            <Stack.Screen
              name="settings"
              options={{
                animation: "slide_from_right",
                gestureEnabled: true,
                gestureDirection: "horizontal",
              }}
            />
            <Stack.Screen
              name="creator"
              options={{
                animation: "slide_from_right",
                gestureEnabled: true,
                gestureDirection: "horizontal",
              }}
            />
            <Stack.Screen
              name="gsav"
              options={{
                animation: "slide_from_right",
                gestureEnabled: true,
                gestureDirection: "horizontal",
              }}
            />
            <Stack.Screen
              name="gsav-diagnostics"
              options={{
                animation: "slide_from_right",
                gestureEnabled: true,
                gestureDirection: "horizontal",
              }}
            />
            <Stack.Screen
              name="watch"
              options={{
                animation: "slide_from_right",
                gestureEnabled: true,
                gestureDirection: "horizontal",
              }}
            />
          </Stack>
        </ErrorBoundary>
        {!gsavShellActive && <MiniPlayer />}
        {!gsavShellActive && <LiveMiniPlayer />}
      </View>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
