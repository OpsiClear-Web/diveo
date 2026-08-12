import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { GSAV_ACCENT, GSAV_ACCENT_CONTRAST } from "../../shared/theme";
import { useTheme } from "../../shared/themeContext";
import { useGsavFollow } from "./useGsavFollow";

type FollowButtonProps = {
  channelId?: string;
  initialFollowerCount?: number;
  onFollowerCountChange?: (count: number) => void;
  onRequireLogin?: () => void;
};

export function FollowButton({
  channelId,
  initialFollowerCount,
  onFollowerCountChange,
  onRequireLogin,
}: FollowButtonProps) {
  const theme = useTheme();
  const follow = useGsavFollow(channelId, initialFollowerCount);

  // Notify through a ref so the effect tracks the count, not the callback
  // identity — an inline parent callback otherwise re-arms this effect every
  // render and the notify/setState cycle never settles (max update depth).
  const onFollowerCountChangeRef = React.useRef(onFollowerCountChange);
  React.useEffect(() => {
    onFollowerCountChangeRef.current = onFollowerCountChange;
  });
  React.useEffect(() => {
    onFollowerCountChangeRef.current?.(follow.followerCount);
  }, [follow.followerCount]);

  if (!channelId) return null;

  return (
    <Pressable
      style={[styles.followBtn, follow.following ? styles.followingBtn : styles.followActiveBtn]}
      onPress={() => {
        if (!follow.canFollow) {
          onRequireLogin?.();
          return;
        }
        follow.toggle();
      }}
      disabled={follow.busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: follow.busy, selected: follow.following }}
      accessibilityLabel={follow.following ? "Unfollow" : "Follow"}
    >
      <Text style={[styles.followText, { color: follow.following ? theme.text : GSAV_ACCENT_CONTRAST }]}>
        {follow.following ? "Following" : "Follow"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  followBtn: {
    marginTop: 14,
    minWidth: 130,
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  followActiveBtn: { backgroundColor: GSAV_ACCENT },
  followingBtn: { borderWidth: StyleSheet.hairlineWidth, borderColor: GSAV_ACCENT },
  followText: { fontFamily: "Roboto_700Bold", fontSize: 14 },
});
