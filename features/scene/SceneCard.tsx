import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { GSAV_ACCENT, radius, type ThemeColors } from "../../shared/theme";
import type { SceneItem } from "./sceneTypes";

type SceneCardColors = Pick<ThemeColors, "card" | "placeholder" | "text" | "textSub">;

// Shared 16:9 scene card for native GSAV scene surfaces.
export function SceneCard({
  colors,
  item,
  onPress,
  onLongPress,
  onAuthorPress,
  thumbnailAccessory,
}: {
  colors: SceneCardColors;
  item: SceneItem;
  onPress: () => void;
  onLongPress?: () => void;
  onAuthorPress?: () => void;
  thumbnailAccessory?: React.ReactNode;
}) {
  return (
    <Pressable
      style={[styles.card, { backgroundColor: colors.card }]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={`Open ${item.title}`}
    >
      <View style={[styles.thumb, { backgroundColor: colors.placeholder }]}>
        <Ionicons name="cube-outline" size={26} color={GSAV_ACCENT} />
        {item.posterUrl ? (
          <Image source={{ uri: item.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        ) : null}
        {thumbnailAccessory ? (
          <View style={styles.thumbAccessory}>{thumbnailAccessory}</View>
        ) : null}
      </View>
      <View style={styles.info}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{item.title}</Text>
        {onAuthorPress ? (
          <Pressable onPress={onAuthorPress} hitSlop={4} accessibilityLabel={`Open ${item.author}`}>
            <Text numberOfLines={1} style={[styles.sub, { color: colors.textSub }]}>{item.author}</Text>
          </Pressable>
        ) : (
          <Text numberOfLines={1} style={[styles.sub, { color: colors.textSub }]}>{item.author}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "47.5%",
    flexGrow: 1,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  thumb: { aspectRatio: 16 / 9, alignItems: "center", justifyContent: "center" },
  thumbAccessory: {
    position: "absolute",
    top: 6,
    right: 6,
  },
  info: { padding: 8 },
  title: { fontFamily: "Roboto_500Medium", fontSize: 13 },
  sub: { fontFamily: "Roboto_400Regular", fontSize: 11, marginTop: 2 },
});
