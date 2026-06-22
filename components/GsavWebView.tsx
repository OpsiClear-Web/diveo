import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import {
  GSAV_ACCENT,
  GSAV_ACCENT_CONTRAST,
  getConfiguredGsavWebUrl,
  getOrigin,
  isAllowedGsavNavigation,
} from "../utils/gsavBridge";
import { useTheme } from "../utils/theme";

type GsavWebViewProps = {
  /** Path within the hosted diveo app, e.g. "/" (home) or "/watch/elly". */
  path: string;
};

// World A: the native app is a thin wrapper around the hosted diveo web app
// (gsav-hosting), which owns ALL UI -- home, browse, watch, and the player. We
// load the FULL app (no ?embed=native: gsav-hosting renders its own nav/chrome,
// so the native shell needs none) and let in-WebView navigation drive everything.
// The shell adds only a trust-gated WebView, loading/error states, and Android
// hardware-back -> WebView history. The player runs in the WebView's browser
// engine (WebGL/Workers/WebCodecs), which is why a native client can host it at
// all. The web build resolves GsavWebView.web.tsx (an iframe) instead.
function buildAppUrl(path: string, baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const route = path.startsWith("/") ? path : `/${path}`;
  return `${base}${route}`;
}

export function GsavWebView({ path }: GsavWebViewProps) {
  const theme = useTheme();
  const webViewRef = useRef<WebView>(null);
  const gsavWebUrl = useMemo(() => getConfiguredGsavWebUrl(), []);
  const [loadKey, setLoadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const uri = useMemo(() => (gsavWebUrl ? buildAppUrl(path, gsavWebUrl) : ""), [gsavWebUrl, path]);
  // Empty when the build has no URL OR the configured URL is malformed; either way
  // the WebView is not rendered and the "not configured" panel shows instead.
  const allowedOrigin = useMemo(() => (gsavWebUrl ? getOrigin(gsavWebUrl) : ""), [gsavWebUrl]);

  // Android hardware-back walks the WebView's own history before letting the OS
  // pop/exit. iOS relies on gsav-hosting's in-page navigation (it owns chrome).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const retry = useCallback(() => {
    setLoadError(null);
    setLoading(true);
    setLoadKey((value) => value + 1);
  }, []);

  if (!allowedOrigin) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[styles.errorTitle, { color: theme.text }]}>diveo not configured</Text>
        <Text style={[styles.errorText, { color: theme.textSub }]}>
          This build has no valid diveo origin. Set EXPO_PUBLIC_GSAV_WEB_URL to the diveo web app
          origin and rebuild.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={["top", "left", "right"]}>
      <View style={styles.content}>
        <WebView
          key={loadKey}
          ref={webViewRef}
          source={{ uri }}
          originWhitelist={[allowedOrigin]}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          androidLayerType="hardware"
          setSupportMultipleWindows={false}
          mixedContentMode={Platform.OS === "android" ? (__DEV__ ? "compatibility" : "never") : undefined}
          onNavigationStateChange={(navState) => setCanGoBack(navState.canGoBack)}
          onShouldStartLoadWithRequest={(request) => {
            if (isAllowedGsavNavigation(request.url, allowedOrigin)) return true;
            // Open genuine external http(s) links in the system browser instead
            // of navigating the shell; silently refuse everything else.
            if (/^https?:/i.test(request.url) && getOrigin(request.url) !== "") {
              Linking.openURL(request.url).catch(() => {});
            }
            return false;
          }}
          onLoadStart={() => {
            setLoading(true);
            setLoadError(null);
          }}
          onLoadEnd={() => setLoading(false)}
          onError={(event) => {
            setLoading(false);
            setLoadError(event.nativeEvent.description || "Unable to load diveo.");
          }}
          style={styles.webView}
        />

        {loading && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color={GSAV_ACCENT} />
          </View>
        )}

        {Boolean(loadError) && (
          <View style={[styles.errorPanel, { backgroundColor: theme.card }]}>
            <Text style={[styles.errorTitle, { color: theme.text }]}>diveo unavailable</Text>
            <Text style={[styles.errorText, { color: theme.textSub }]}>{loadError}</Text>
            <Pressable style={styles.retryButton} onPress={retry}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  content: { flex: 1, backgroundColor: "#050505" },
  webView: { flex: 1, backgroundColor: "#050505" },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.18)",
  },
  errorPanel: {
    position: "absolute",
    left: 18,
    right: 18,
    top: "34%",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  errorTitle: { fontSize: 16, fontFamily: "Roboto_700Bold" },
  errorText: { marginTop: 8, textAlign: "center", lineHeight: 19, fontFamily: "Roboto_400Regular" },
  retryButton: {
    minWidth: 88,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    backgroundColor: GSAV_ACCENT,
    borderRadius: 8,
  },
  retryText: { color: GSAV_ACCENT_CONTRAST, fontSize: 13, fontFamily: "Roboto_700Bold" },
});
