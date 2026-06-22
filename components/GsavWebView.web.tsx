import React, { useMemo } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { buildNativeEmbedUrl, getConfiguredGsavWebUrl } from "../utils/gsavBridge";
import { useTheme } from "../utils/theme";

type GsavWebViewProps = {
  path: string;
  title: string;
};

/**
 * Web variant of the GSAV player surface. react-native-webview has no web target,
 * BUT the web build runs in a real browser, which provides the WebGL/WebGPU, Web
 * Workers, and WebCodecs the player needs. So instead of redirecting away, we embed
 * the hosted diveo player in an <iframe> -- the web equivalent of the native WebView
 * -- keeping the diveo shell chrome around it. We load the ?embed=native URL (via
 * buildNativeEmbedUrl, the same URL the native WebView uses) so gsav-hosting hides
 * its own header/social chrome and renders player-only. The ReactNativeWebView
 * bridge is absent in a plain iframe, so gsav-hosting's bridge calls no-op
 * gracefully; playback is unaffected. The native in-shell player lives in
 * GsavWebView.tsx.
 *
 * Cross-origin framing note: gsav-hosting's Vite dev server sends no framing
 * headers, so this works in dev. Its production _headers set `frame-ancestors
 * 'self'` + `X-Frame-Options: SAMEORIGIN`; to embed in production, either serve the
 * shell same-origin as gsav-hosting or add the shell origin to frame-ancestors.
 */
export function GsavWebView({ path, title }: GsavWebViewProps) {
  const router = useRouter();
  const theme = useTheme();
  const baseUrl = useMemo(() => getConfiguredGsavWebUrl(), []);
  const embedSrc = useMemo(() => (baseUrl ? buildNativeEmbedUrl(path, baseUrl) : ""), [baseUrl, path]);
  const externalUrl = useMemo(() => {
    if (!baseUrl) return "";
    const base = baseUrl.replace(/\/+$/, "");
    const route = path.startsWith("/") ? path : `/${path}`;
    return `${base}${route}`;
  }, [baseUrl, path]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={["top", "left", "right"]}>
      <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <Pressable style={styles.headerButton} onPress={() => router.back()} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={theme.text} />
        </Pressable>
        <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>{title}</Text>
        {externalUrl ? (
          <Pressable
            style={styles.headerButton}
            onPress={() => Linking.openURL(externalUrl)}
            accessibilityLabel="Open in a new tab"
          >
            <Ionicons name="open-outline" size={18} color={theme.text} />
          </Pressable>
        ) : (
          <View style={styles.headerButton} />
        )}
      </View>

      <View style={styles.content}>
        {embedSrc ? (
          <iframe
            src={embedSrc}
            title={title}
            allow="autoplay; fullscreen; xr-spatial-tracking; accelerometer; gyroscope; magnetometer"
            style={{ border: 0, width: "100%", height: "100%", display: "block", backgroundColor: "#050505" }}
          />
        ) : (
          <View style={styles.panel}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>diveo player not configured</Text>
            <Text style={[styles.panelText, { color: theme.textSub }]}>
              Set EXPO_PUBLIC_GSAV_WEB_URL to the diveo web app origin to enable playback on web.
            </Text>
          </View>
        )}
      </View>
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
  headerButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 16, fontFamily: "Roboto_700Bold" },
  content: { flex: 1, backgroundColor: "#050505" },
  panel: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  panelTitle: { fontSize: 16, fontFamily: "Roboto_700Bold" },
  panelText: { fontSize: 13, fontFamily: "Roboto_400Regular", textAlign: "center" },
});
