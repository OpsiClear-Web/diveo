import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import { safeAuthReturnTo } from "../../shared/authReturn";
import { firstParam } from "../../shared/routeParams";
import { GSAV_ACCENT, GSAV_ACCENT_CONTRAST, radius } from "../../shared/theme";
import { useTheme } from "../../shared/themeContext";
import { Brand } from "../../shared/ui/Brand";
import { NativeScreenHeader } from "../../shared/ui/NativeScreen";
import { useGsavAuthStore } from "./gsavAuthStore";

// Native auth (Supabase) for diveo social. Email/password sign in or
// sign up against gsav-hosting's Supabase project; on success returns to caller.
const FONT = { regular: "Roboto_400Regular", medium: "Roboto_500Medium", bold: "Roboto_700Bold" } as const;

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = safeAuthReturnTo(firstParam(params.returnTo));
  const theme = useTheme();
  const signIn = useGsavAuthStore((s) => s.signIn);
  const signUp = useGsavAuthStore((s) => s.signUp);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = mode === "signin" ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (returnTo) {
      router.replace(returnTo as never);
      return;
    }
    router.back();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <NativeScreenHeader title={mode === "signin" ? "Log in" : "Sign up"} onBack={() => router.back()} />

      <View style={styles.body}>
        <View style={styles.brandWrap}><Brand logoSize={34} fontSize={26} color={theme.text} /></View>
        <View style={styles.field}>
          <Text style={[styles.inputLabel, { color: theme.textSub }]}>Email</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text }]}
            value={email}
            onChangeText={setEmail}
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            inputMode="email"
          />
        </View>
        <View style={styles.field}>
          <Text style={[styles.inputLabel, { color: theme.textSub }]}>Password</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text }]}
            value={password}
            onChangeText={setPassword}
            accessibilityLabel="Password"
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={submit}
            returnKeyType="go"
          />
        </View>
        {error ? (
          <Text style={[styles.error, { color: theme.danger }]} accessibilityRole="alert">{error}</Text>
        ) : null}
        <Pressable
          style={[styles.cta, busy && styles.ctaBusy]}
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          accessibilityLabel={mode === "signin" ? "Log in" : "Sign up"}
        >
          {busy ? (
            <ActivityIndicator color={GSAV_ACCENT_CONTRAST} />
          ) : (
            <Text style={styles.ctaText}>{mode === "signin" ? "Log in" : "Sign up"}</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          hitSlop={8}
          style={styles.toggleBtn}
          accessibilityRole="button"
          accessibilityLabel={mode === "signin" ? "Switch to sign up" : "Switch to log in"}
        >
          <Text style={[styles.toggle, { color: theme.textSub }]}>
            {mode === "signin" ? "Need an account? Sign up" : "Have an account? Log in"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  brandWrap: { alignItems: "center", marginBottom: 12 },
  field: { gap: 6 },
  inputLabel: { fontFamily: FONT.medium, fontSize: 13 },
  input: { height: 46, borderRadius: radius.md, paddingHorizontal: 14, fontFamily: FONT.regular, fontSize: 15 },
  error: { fontFamily: FONT.regular, fontSize: 13 },
  cta: { height: 46, borderRadius: radius.md, backgroundColor: GSAV_ACCENT, alignItems: "center", justifyContent: "center", marginTop: 4 },
  ctaBusy: { opacity: 0.6 },
  ctaText: { color: GSAV_ACCENT_CONTRAST, fontFamily: FONT.bold, fontSize: 15 },
  toggleBtn: { minHeight: 44, justifyContent: "center", marginTop: 4 },
  toggle: { textAlign: "center", fontFamily: FONT.medium, fontSize: 13 },
});
