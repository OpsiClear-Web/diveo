import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

// Floating back affordance for full-bleed surfaces (player embeds, hero
// headers) that render no NativeScreenHeader. 44px target per the
// interaction floor; callers position it below their own safe-area inset.
export function FloatingBackButton({ top = 8 }: { top?: number }) {
  const router = useRouter();
  return (
    <Pressable
      style={[styles.back, { top }]}
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace("/" as never);
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <Ionicons name="chevron-back" size={22} color="#ededed" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    position: "absolute",
    left: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5, 5, 5, 0.45)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.16)",
    zIndex: 10,
  },
});
