import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform, Text, View } from 'react-native';
import { useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { useCheckUpdate } from '../hooks/useCheckUpdate';
import { useGsavAuthStore } from '../store/gsavAuthStore';
import { useSavedScenesStore } from '../store/savedScenesStore';
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
  const restoreSettings = useSettingsStore(s => s.restore);
  const darkMode = useSettingsStore(s => s.darkMode);
  const { checkUpdate } = useCheckUpdate();
  const authUserId = useGsavAuthStore(s => s.user?.id);

  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
    Roboto_400Regular,
    Roboto_500Medium,
    Roboto_700Bold,
    Roboto_900Black,
  });

  useEffect(() => {
    restoreSettings();
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
              name="search"
              options={{
                animation: "slide_from_right",
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="explore"
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
      </View>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
