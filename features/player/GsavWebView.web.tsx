import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { getConfiguredGsavWebUrl, getOrigin } from "../../shared/gsavWeb";
import { GSAV_ACCENT } from "../../shared/theme";
import { useTheme } from "../../shared/themeContext";
import { usePlayerEmbedPreferences } from "../preferences/preferenceAccess";
import { useAuthBridgeSession } from "../social/authSession";
import type { NativeQaControl } from "./nativeQaControls";
import { buildNativeEmbedUrl, type GsavEmbedRoute } from "./routes";
import { isAuthReadyMessage, postSessionBridgeMessageForAuthState } from "./sessionBridge";

type GsavWebViewProps = {
  /** Validated path within the hosted GSAV web app, e.g. "/watch/elly" or "/explore". */
  path: GsavEmbedRoute;
  qaControls?: NativeQaControl[];
};

// react-native-webview has no web target, so Expo web previews use a full-screen
// iframe. It still enters ?embed=native so chrome/bridge behavior matches the
// native WebView. The real production web product remains gsav-hosting directly.
export function GsavWebView({ path }: GsavWebViewProps) {
  const theme = useTheme();
  const baseUrl = useMemo(() => getConfiguredGsavWebUrl(), []);
  const { hydrated: settingsHydrated, dataSaver } = usePlayerEmbedPreferences();
  const { initialized: authInitialized, tokens: sessionTokens } = useAuthBridgeSession();
  const src = useMemo(
    () => (baseUrl ? buildNativeEmbedUrl(path, baseUrl, { dataSaver }) : ""),
    [baseUrl, path, dataSaver],
  );
  const origin = useMemo(() => (baseUrl ? getOrigin(baseUrl) : ""), [baseUrl]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const postSession = useCallback(() => {
    postSessionBridgeMessageForAuthState(
      iframeRef.current?.contentWindow,
      origin,
      authInitialized,
      sessionTokens,
    );
  }, [authInitialized, sessionTokens, origin]);

  // The embedded player announces GSAV_AUTH_READY; reply with the session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: MessageEvent) => {
      if (event.origin === origin && isAuthReadyMessage(event.data)) postSession();
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [origin, postSession]);

  // Resend whenever the session changes (login/logout) while embedded.
  useEffect(() => {
    postSession();
  }, [postSession]);

  if (!src) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[styles.title, { color: theme.text }]}>diveo not configured</Text>
        <Text style={[styles.text, { color: theme.textSub }]}>
          Set EXPO_PUBLIC_GSAV_WEB_URL to the GSAV web app origin.
        </Text>
      </View>
    );
  }

  if (!settingsHydrated || !authInitialized) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={GSAV_ACCENT} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <iframe
        ref={iframeRef}
        src={src}
        title="diveo"
        allow="autoplay; fullscreen; xr-spatial-tracking; accelerometer; gyroscope; magnetometer"
        style={{ border: 0, width: "100%", height: "100%", display: "block", backgroundColor: "#050505" }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050505" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  title: { fontSize: 16, fontFamily: "Roboto_700Bold" },
  text: { fontSize: 13, fontFamily: "Roboto_400Regular", textAlign: "center" },
});
