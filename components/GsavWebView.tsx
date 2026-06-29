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
  buildSessionBridgeScript,
  getConfiguredGsavWebUrl,
  getOrigin,
  isAllowedGsavNavigation,
  isAuthReadyMessage,
  parseBridgeMessage,
} from "../utils/gsavBridge";
import { useGsavAuthStore } from "../store/gsavAuthStore";
import { useGsavProgressStore } from "../store/gsavProgressStore";
import { useSettingsStore } from "../store/settingsStore";
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
  const trafficSaving = useSettingsStore((s) => s.trafficSaving);
  // Data-saver: hint the hosted app via ?dataSaver=1 (Explore skips autoplay).
  const uri = useMemo(() => {
    if (!gsavWebUrl) return "";
    const base = buildAppUrl(path, gsavWebUrl);
    return trafficSaving ? `${base}${base.includes("?") ? "&" : "?"}dataSaver=1` : base;
  }, [gsavWebUrl, path, trafficSaving]);
  // Empty when the build has no URL OR the configured URL is malformed; either way
  // the WebView is not rendered and the "not configured" panel shows instead.
  const allowedOrigin = useMemo(() => (gsavWebUrl ? getOrigin(gsavWebUrl) : ""), [gsavWebUrl]);
  const session = useGsavAuthStore((s) => s.session);
  const saveProgress = useGsavProgressStore((s) => s.save);
  const clearProgress = useGsavProgressStore((s) => s.clear);
  const lastProgressSaveRef = useRef(0);

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

  // Scene-social bridge: hand the native Supabase session to the embedded player
  // (so its comments/danmaku/like are authed). Applied when the page signals
  // readiness (onMessage GSAV_AUTH_READY) and re-applied whenever the session
  // changes (login/logout) while the player is open.
  const applySession = useCallback(() => {
    webViewRef.current?.injectJavaScript(
      buildSessionBridgeScript(
        session ? { accessToken: session.access_token, refreshToken: session.refresh_token } : null,
      ),
    );
  }, [session]);

  useEffect(() => {
    applySession();
  }, [applySession]);

  // Capture playback position from the bridge so /watch can resume the scene.
  // GSAV_FRAME is high-frequency (throttled to ~4s); GSAV_PLAYBACK_STATE
  // (play/pause/seek) saves promptly; GSAV_ENDED clears the record (finished).
  const captureProgress = useCallback(
    (data: string) => {
      const message = parseBridgeMessage(data);
      if (!message) return;
      const payload = (message.payload ?? {}) as {
        videoId?: unknown;
        currentTime?: unknown;
        duration?: unknown;
      };
      const videoId = typeof payload.videoId === "string" ? payload.videoId : undefined;
      if (!videoId) return;
      if (message.type === "GSAV_ENDED") {
        clearProgress(videoId);
        return;
      }
      if (message.type === "GSAV_FRAME" || message.type === "GSAV_PLAYBACK_STATE") {
        const time = typeof payload.currentTime === "number" ? payload.currentTime : undefined;
        const duration = typeof payload.duration === "number" ? payload.duration : undefined;
        if (time === undefined || duration === undefined) return;
        const now = Date.now();
        if (message.type === "GSAV_FRAME" && now - lastProgressSaveRef.current < 4000) return;
        lastProgressSaveRef.current = now;
        saveProgress(videoId, time, duration);
      }
    },
    [saveProgress, clearProgress],
  );

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
          onMessage={(event) => {
            const data = event.nativeEvent.data;
            if (isAuthReadyMessage(data)) {
              applySession();
              return;
            }
            captureProgress(data);
          }}
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
