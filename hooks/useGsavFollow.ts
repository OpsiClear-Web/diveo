import { useCallback, useEffect, useState } from "react";

import { supabase } from "../services/supabase";
import { useGsavAuthStore } from "../store/gsavAuthStore";

/**
 * Follow/unfollow a creator's channel (World B social). Mirrors gsav-hosting's
 * socialApi: follows is {profile_id, channel_id}; follower count comes from the
 * public channel_public_counts view. Reads follow + count on mount; toggle is
 * optimistic with rollback and requires a signed-in user (canFollow).
 */
export function useGsavFollow(channelId: string | undefined, initialFollowerCount?: number) {
  const userId = useGsavAuthStore((s) => s.user?.id);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(initialFollowerCount ?? 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialFollowerCount !== undefined) setFollowerCount(initialFollowerCount);
  }, [initialFollowerCount]);

  useEffect(() => {
    if (!channelId) return;
    let active = true;
    (async () => {
      const { data: countRow } = await supabase
        .from("channel_public_counts")
        .select("follower_count")
        .eq("channel_id", channelId)
        .maybeSingle();
      if (active && countRow) setFollowerCount(Number(countRow.follower_count ?? 0));

      if (!userId) {
        if (active) setFollowing(false);
        return;
      }
      const { data: followRow } = await supabase
        .from("follows")
        .select("channel_id")
        .eq("channel_id", channelId)
        .eq("profile_id", userId)
        .maybeSingle();
      if (active) setFollowing(Boolean(followRow));
    })();
    return () => {
      active = false;
    };
  }, [channelId, userId]);

  const toggle = useCallback(async () => {
    if (!channelId || !userId || busy) return;
    const next = !following;
    setBusy(true);
    setFollowing(next);
    setFollowerCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      const result = next
        ? await supabase.from("follows").upsert({ profile_id: userId, channel_id: channelId })
        : await supabase.from("follows").delete().eq("profile_id", userId).eq("channel_id", channelId);
      if (result.error) throw result.error;
    } catch {
      // rollback the optimistic update
      setFollowing(!next);
      setFollowerCount((c) => Math.max(0, c + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }, [channelId, userId, following, busy]);

  return { following, followerCount, busy, canFollow: Boolean(userId), toggle };
}
