import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import {
  buildNativeCommandScript,
  buildNativeEmbedUrl,
  GSAV_ACCENT,
  getBridgeStatusLabel,
  getCapabilityLabel,
  getConfiguredGsavWebUrl,
  getOrigin,
  getUnsupportedReason,
  isAllowedGsavNavigation,
  isTrustedBridgeOrigin,
  type GsavPlaybackSnapshot,
  type NativeGsavCommand,
  parseBridgeMessage,
  updatePlaybackSnapshot,
} from "../utils/gsavBridge";
import { useSettingsStore } from "../store/settingsStore";
import { useTheme } from "../utils/theme";

type GsavWebViewProps = {
  path: string;
  title: string;
};

export function GsavWebView({ path, title }: GsavWebViewProps) {
  const router = useRouter();
  const theme = useTheme();
  const darkMode = useSettingsStore((state) => state.darkMode);
  const webViewRef = useRef<WebView>(null);
  const playbackSnapshotRef = useRef<GsavPlaybackSnapshot>({});
  const gsavWebUrl = useMemo(() => getConfiguredGsavWebUrl(), []);
  const [loadKey, setLoadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [capabilityLabel, setCapabilityLabel] = useState("Checking");
  const [copiedUrl, setCopiedUrl] = useState(false);
  const uri = useMemo(() => (gsavWebUrl ? buildNativeEmbedUrl(path, gsavWebUrl) : ""), [gsavWebUrl, path]);
  // Empty when the build has no URL OR the configured URL is malformed; either way
  // the WebView is not rendered and the "not configured" panel shows instead.
  const allowedOrigin = useMemo(() => (gsavWebUrl ? getOrigin(gsavWebUrl) : ""), [gsavWebUrl]);

  const sendCommand = useCallback((command: NativeGsavCommand) => {
    webViewRef.current?.injectJavaScript(buildNativeCommandScript(command));
  }, []);

  const syncNativeTheme = useCallback(() => {
    sendCommand({ command: "setTheme", mode: darkMode ? "dark" : "light" });
  }, [darkMode, sendCommand]);

  useEffect(() => {
    syncNativeTheme();
  }, [syncNativeTheme, loadKey]);

  function handleBridgeMessage(event: WebViewMessageEvent) {
    // Trust gate: only act on messages from the allowed origin. nativeEvent.url is
    // the WebView's current page; together with the navigation gate below this drops
    // anything not served from the configured GSAV origin.
    if (!isTrustedBridgeOrigin(getOrigin(event.nativeEvent.url), allowedOrigin)) return;
    const message = parseBridgeMessage(event.nativeEvent.data);
    if (!message) return;
    const snapshot = (playbackSnapshotRef.current = updatePlaybackSnapshot(
      playbackSnapshotRef.current,
      message,
    ));
    // Surface live playback progress in the header subtitle while playing, so the
    // accumulated snapshot drives the UI; otherwise show the event's status label.
    const playbackLabel =
      snapshot.state === "playing" && typeof snapshot.progressPercent === "number"
        ? `Playing · ${Math.round(snapshot.progressPercent)}%`
        : getBridgeStatusLabel(message);
    if (playbackLabel) setCapabilityLabel(playbackLabel);

    if (message.type === "GSAV_ERROR") {
      const payload = message.payload as { message?: unknown };
      setBridgeError(typeof payload.message === "string" ? payload.message : "diveo playback error.");
    } else if (message.type === "GSAV_READY") {
      setBridgeError(null);
      syncNativeTheme();
    } else if (message.type === "GSAV_CAPABILITIES") {
      const payload = message.payload as { supported?: unknown; renderer?: unknown; reasons?: unknown };
      const supported = payload.supported === true;
      setCapabilityLabel(getCapabilityLabel(payload));
      if (!supported) {
        setBridgeError(getUnsupportedReason(payload) ?? "diveo playback is not supported on this device.");
      } else {
        setBridgeError(null);
        syncNativeTheme();
      }
    }
  }

  async function copyCurrentUrl() {
    await Clipboard.setStringAsync(uri);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1200);
  }

  function retry() {
    setLoadError(null);
    setBridgeError(null);
    setLoading(true);
    setLoadKey((value) => value + 1);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={["top", "left", "right"]}>
      <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <Pressable style={styles.headerButton} onPress={() => router.back()} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={theme.text} />
        </Pressable>
        <View style={styles.headerTitle}>
          <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: theme.textSub }]}>{capabilityLabel}</Text>
        </View>
        {__DEV__ && (
          <Pressable style={styles.headerButton} onPress={copyCurrentUrl} accessibilityLabel="Copy diveo URL">
            <Ionicons name={copiedUrl ? "checkmark" : "copy-outline"} size={18} color={theme.text} />
          </Pressable>
        )}
        <Pressable style={styles.headerButton} onPress={retry} accessibilityLabel="Reload diveo player">
          <Ionicons name="refresh" size={19} color={theme.text} />
        </Pressable>
      </View>

      <View style={styles.content}>
        {!allowedOrigin ? (
          <View style={[styles.errorPanel, { backgroundColor: theme.card }]}>
            <Text style={[styles.errorTitle, { color: theme.text }]}>diveo not configured</Text>
            <Text style={[styles.errorText, { color: theme.textSub }]}>
              This build has no valid diveo origin. Set EXPO_PUBLIC_GSAV_WEB_URL to the diveo web
              app origin and rebuild.
            </Text>
          </View>
        ) : (
          <>
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
              onLoadEnd={() => {
                setLoading(false);
                syncNativeTheme();
              }}
              onError={(event) => {
                setLoading(false);
                setLoadError(event.nativeEvent.description || "Unable to load diveo web player.");
              }}
              onMessage={handleBridgeMessage}
              style={styles.webView}
            />

            {loading && (
              <View style={styles.loadingOverlay} pointerEvents="none">
                <ActivityIndicator color={GSAV_ACCENT} />
              </View>
            )}

            {Boolean(loadError) && (
              <View style={[styles.errorPanel, { backgroundColor: theme.card }]}>
                <Text style={[styles.errorTitle, { color: theme.text }]}>diveo player unavailable</Text>
                <Text style={[styles.errorText, { color: theme.textSub }]}>{loadError}</Text>
                <Pressable style={styles.retryButton} onPress={retry}>
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </View>

      {Boolean(bridgeError) && !loadError && (
        <View style={[styles.bridgeBanner, { backgroundColor: theme.card, borderTopColor: theme.border }]}>
          <Text numberOfLines={2} style={[styles.bridgeText, { color: theme.textSub }]}>{bridgeError}</Text>
          <Pressable onPress={() => sendCommand({ command: "play" })} accessibilityLabel="Play diveo">
            <Ionicons name="play" size={18} color={GSAV_ACCENT} />
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: "700" },
  subtitle: { marginTop: 1, fontSize: 11 },
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
  errorTitle: { fontSize: 16, fontWeight: "800" },
  errorText: { marginTop: 8, textAlign: "center", lineHeight: 19 },
  retryButton: {
    minWidth: 88,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    backgroundColor: GSAV_ACCENT,
    borderRadius: 8,
  },
  retryText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  bridgeBanner: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bridgeText: { flex: 1, fontSize: 12, lineHeight: 17 },
});
