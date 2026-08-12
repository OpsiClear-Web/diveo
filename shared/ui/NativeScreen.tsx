import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { GSAV_ACCENT, GSAV_ACCENT_CONTRAST, radius } from "../theme";
import { useTheme } from "../themeContext";

const FONT = { regular: "Roboto_400Regular", bold: "Roboto_700Bold" } as const;

export function NativeScreenHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
      <Pressable
        onPress={onBack}
        hitSlop={8}
        style={styles.headerButton}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={24} color={theme.text} />
      </Pressable>
      <Text
        style={[styles.headerTitle, { color: theme.text }]}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </Text>
      <View style={styles.headerButton} />
    </View>
  );
}

export function NativeCenterState({
  title,
  message,
  loading = false,
  actionLabel,
  onAction,
  actionAccessibilityLabel,
}: {
  title?: string;
  message?: string;
  loading?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  actionAccessibilityLabel?: string;
}) {
  return (
    <View style={styles.centerState}>
      <NativeStatePanel
        title={title}
        message={message}
        loading={loading}
        actionLabel={actionLabel}
        onAction={onAction}
        actionAccessibilityLabel={actionAccessibilityLabel}
      />
    </View>
  );
}

export function NativeStatePanel({
  title,
  message,
  loading = false,
  actionLabel,
  onAction,
  actionAccessibilityLabel,
}: {
  title?: string;
  message?: string;
  loading?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  actionAccessibilityLabel?: string;
}) {
  const theme = useTheme();

  return (
    <View style={styles.statePanel}>
      {loading ? <ActivityIndicator color={GSAV_ACCENT} /> : null}
      {title ? <Text style={[styles.stateTitle, { color: theme.text }]}>{title}</Text> : null}
      {message ? <Text style={[styles.centerMessage, { color: theme.textSub }]}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          style={styles.centerAction}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
        >
          <Text style={styles.centerActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontFamily: FONT.bold,
    fontSize: 16,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  statePanel: {
    alignItems: "center",
    gap: 12,
  },
  stateTitle: {
    fontFamily: FONT.bold,
    fontSize: 16,
    textAlign: "center",
  },
  centerMessage: {
    fontFamily: FONT.regular,
    fontSize: 13,
    textAlign: "center",
  },
  centerAction: {
    minWidth: 104,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: GSAV_ACCENT,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  centerActionText: {
    color: GSAV_ACCENT_CONTRAST,
    fontFamily: FONT.bold,
    fontSize: 14,
  },
});
