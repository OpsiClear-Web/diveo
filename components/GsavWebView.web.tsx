import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { getConfiguredGsavWebUrl } from "../utils/gsavBridge";
import { useTheme } from "../utils/theme";

type GsavWebViewProps = {
  /** Path within the hosted diveo app, e.g. "/" (home) or "/watch/elly". */
  path: string;
};

// World A web preview: react-native-webview has no web target, but the web build
// runs in a browser, so we embed the hosted diveo app (gsav-hosting) in a
// full-screen <iframe>. gsav-hosting owns all UI; the shell adds nothing. The real
// web product is gsav-hosting served directly -- this build is only a dev preview
// of the native shell. Dev works (Vite sends no framing headers); production
// embedding needs same-origin hosting (gsav-hosting's prod _headers set
// frame-ancestors 'self').
function buildAppUrl(path: string, baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const route = path.startsWith("/") ? path : `/${path}`;
  return `${base}${route}`;
}

export function GsavWebView({ path }: GsavWebViewProps) {
  const theme = useTheme();
  const baseUrl = useMemo(() => getConfiguredGsavWebUrl(), []);
  const src = useMemo(() => (baseUrl ? buildAppUrl(path, baseUrl) : ""), [baseUrl, path]);

  if (!src) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[styles.title, { color: theme.text }]}>diveo not configured</Text>
        <Text style={[styles.text, { color: theme.textSub }]}>
          Set EXPO_PUBLIC_GSAV_WEB_URL to the diveo web app origin.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <iframe
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
