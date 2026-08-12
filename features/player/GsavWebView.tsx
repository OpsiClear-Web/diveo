import React, { useRef } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { GSAV_ACCENT, GSAV_ACCENT_CONTRAST } from "../../shared/theme";
import { useTheme } from "../../shared/themeContext";
import { FloatingBackButton } from "../../shared/ui/FloatingBackButton";
import { NativeCenterState, NativeStatePanel } from "../../shared/ui/NativeScreen";
import type { NativeQaControl } from "./nativeQaControls";
import type { GsavEmbedRoute } from "./routes";
import { useGsavEmbedHost } from "./useGsavEmbedHost";

type GsavWebViewProps = {
  /** Validated path within the hosted GSAV web app, e.g. "/watch/elly" or "/explore". */
  path: GsavEmbedRoute;
  qaControls?: NativeQaControl[];
};

// Native app + hosted player: React Native owns mobile browse/social/settings,
// while gsav-hosting owns the browser-only GSAV runtime. Native embeds hosted
// routes with ?embed=native so the web app hides desktop chrome and enables the
// native bridge used for auth handoff, playback progress, and diagnostics.
export function GsavWebView({ path, qaControls = [] }: GsavWebViewProps) {
  const theme = useTheme();
  const webViewRef = useRef<WebView>(null);
  const host = useGsavEmbedHost({ path, qaControls, webViewRef });

  if (!host.isConfigured) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
        <NativeCenterState
          title="diveo not configured"
          message="This build has no valid GSAV web origin. Set EXPO_PUBLIC_GSAV_WEB_URL to the GSAV web app origin and rebuild."
        />
        <FloatingBackButton />
      </SafeAreaView>
    );
  }

  if (!host.isReady) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
        <NativeCenterState loading />
        <FloatingBackButton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={["top", "left", "right"]}>
      <View style={styles.content}>
        <WebView
          key={host.loadKey}
          ref={webViewRef}
          source={{ uri: host.uri }}
          originWhitelist={[host.allowedOrigin]}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          androidLayerType="hardware"
          setSupportMultipleWindows={false}
          mixedContentMode={Platform.OS === "android" ? (__DEV__ ? "compatibility" : "never") : undefined}
          onNavigationStateChange={host.handleNavigationStateChange}
          onMessage={host.handleMessage}
          onShouldStartLoadWithRequest={host.handleShouldStartLoadWithRequest}
          onLoadStart={host.handleLoadStart}
          onLoadEnd={host.handleLoadEnd}
          onError={host.handleError}
          style={styles.webView}
        />

        {host.loading && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color={GSAV_ACCENT} />
          </View>
        )}

        {Boolean(host.loadError ?? host.bridgeError) && (
          <View style={[styles.errorPanel, { backgroundColor: theme.card }]}>
            <NativeStatePanel
              title="diveo unavailable"
              message={host.loadError ?? host.bridgeError ?? undefined}
              actionLabel="Retry"
              onAction={host.retry}
            />
          </View>
        )}

        {host.blockedNavigationMessage && (
          <View style={[styles.errorPanel, { backgroundColor: theme.card }]}>
            <NativeStatePanel
              title="Navigation blocked"
              message={host.blockedNavigationMessage}
              actionLabel="Stay here"
              onAction={() => host.setBlockedNavigationMessage(null)}
            />
          </View>
        )}

        {qaControls.length > 0 && (
          <View style={[styles.qaPanel, { backgroundColor: theme.card }]}>
            <View style={styles.qaButtons}>
              {qaControls.map((control) => (
                <Pressable
                  key={control.id}
                  style={styles.qaButton}
                  onPress={() => host.runQaControl(control)}
                >
                  <Text style={styles.qaButtonText}>{control.label}</Text>
                </Pressable>
              ))}
            </View>
            {host.qaStatus && <Text style={[styles.qaStatus, { color: theme.textSub }]}>{host.qaStatus}</Text>}
          </View>
        )}

        <FloatingBackButton />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
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
  qaPanel: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    gap: 8,
    padding: 10,
    borderRadius: 8,
  },
  qaButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  qaButton: {
    minHeight: 44,
    minWidth: 104,
    flexGrow: 1,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: GSAV_ACCENT,
  },
  qaButtonText: { color: GSAV_ACCENT_CONTRAST, fontSize: 12, fontFamily: "Roboto_700Bold" },
  qaStatus: { fontSize: 12, lineHeight: 16, fontFamily: "Roboto_400Regular" },
});
