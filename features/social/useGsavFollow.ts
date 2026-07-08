import { useCallback, useEffect, useState } from "react";

import { useGsavAuthStore } from "./gsavAuthStore";
import { loadChannelFollowerCount, loadIsChannelFollowed, updateChannelFollowed } from "./socialAdapter";

/**
 * Follow/unfollow a creator's channel. Backed by the feature-owned social
 * adapter (follows {profile_id, channel_id}; follower count from the public
 * channel_public_counts view). Reads follow + count on mount; toggle is
 * optimistic with rollback and requires a signed-in user.
 */
export function useGsavFollow(channelId: string | undefined, initialFollowerCount?: number) {
  const userId = useGsavAuthStore((s) => s.user?.id);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(initialFollowerCount ?? 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialFollowerCount !== undefined) setFollowerCount(initialFollowerCount);
  }, [initialFollowerCount]);

  useEffect(() => {
    if (!channelId) return;
    let active = true;
    (async () => {
      try {
        const count = await loadChannelFollowerCount(channelId);
        if (active && count !== null) setFollowerCount(count);
      } catch {
        // keep current count
      }
      if (!userId) {
        if (active) setFollowing(false);
        return;
      }
      try {
        const followed = await loadIsChannelFollowed(userId, channelId);
        if (active) setFollowing(followed);
      } catch {
        // keep current state
      }
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
      await updateChannelFollowed(userId, channelId, next);
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
