import { Ionicons } from "@expo/vector-icons";
import {
  Roboto_400Regular,
  Roboto_500Medium,
  Roboto_700Bold,
  Roboto_900Black,
} from "@expo-google-fonts/roboto";
import { ErrorBoundary } from "@sentry/react-native";
import * as Sentry from "@sentry/react-native";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { getThemeColors } from "../../shared/theme";
import { ThemeProvider } from "../../shared/themeContext";
import { AppStack } from "./AppStack";
import { useAppBootstrap } from "./useAppBootstrap";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? "",
  enabled: !__DEV__,
  tracesSampleRate: 0.05,
  environment: process.env.EXPO_PUBLIC_APP_ENV ?? "production",
});

function RootLayout() {
  const { darkMode } = useAppBootstrap();
  const theme = getThemeColors(darkMode);

  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
    Roboto_400Regular,
    Roboto_500Medium,
    Roboto_700Bold,
    Roboto_900Black,
  });

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider colors={theme}>
        <StatusBar style={darkMode ? "light" : "dark"} />
        <View style={{ flex: 1 }}>
          <ErrorBoundary
            fallback={
              <Text style={{ padding: 32, textAlign: "center", color: theme.text, fontFamily: "Roboto_400Regular" }}>
                Something went wrong. Please restart the app.
              </Text>
            }
          >
            <AppStack />
          </ErrorBoundary>
        </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
