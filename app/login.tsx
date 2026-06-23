import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "../utils/theme";
import { GSAV_ACCENT, GSAV_ACCENT_CONTRAST } from "../utils/gsavBridge";
import { useGsavAuthStore } from "../store/gsavAuthStore";

// World B: native auth (Supabase) for diveo social. Email/password sign in or
// sign up against gsav-hosting's Supabase project; on success returns to caller.
const FONT = { regular: "Roboto_400Regular", medium: "Roboto_500Medium", bold: "Roboto_700Bold" } as const;

export default function LoginScreen() {
  const router = useRouter();
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
    router.back();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={[styles.topBar, { borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: theme.text }]}>{mode === "signin" ? "Log in" : "Sign up"}</Text>
        <View style={styles.back} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.brand, { color: GSAV_ACCENT }]}>diveo</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text }]}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={theme.textSub}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          inputMode="email"
        />
        <TextInput
          style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text }]}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={theme.textSub}
          secureTextEntry
          autoCapitalize="none"
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
        <Pressable
          style={[styles.cta, busy && styles.ctaBusy]}
          onPress={submit}
          disabled={busy}
          accessibilityLabel={mode === "signin" ? "Log in" : "Create account"}
        >
          {busy ? (
            <ActivityIndicator color={GSAV_ACCENT_CONTRAST} />
          ) : (
            <Text style={styles.ctaText}>{mode === "signin" ? "Log in" : "Create account"}</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          hitSlop={8}
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  topTitle: { flex: 1, textAlign: "center", fontFamily: FONT.bold, fontSize: 16 },
  body: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  brand: { fontFamily: "Roboto_900Black", fontSize: 28, textAlign: "center", marginBottom: 12, letterSpacing: 0.2 },
  input: { height: 46, borderRadius: 8, paddingHorizontal: 14, fontFamily: FONT.regular, fontSize: 15 },
  error: { fontFamily: FONT.regular, fontSize: 13 },
  cta: { height: 46, borderRadius: 8, backgroundColor: GSAV_ACCENT, alignItems: "center", justifyContent: "center", marginTop: 4 },
  ctaBusy: { opacity: 0.6 },
  ctaText: { color: GSAV_ACCENT_CONTRAST, fontFamily: FONT.bold, fontSize: 15 },
  toggle: { textAlign: "center", fontFamily: FONT.medium, fontSize: 13, marginTop: 8 },
});
