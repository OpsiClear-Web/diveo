import {
  getChannelFollowerCount,
  getSavedVideoIds,
  isChannelFollowed,
  setChannelFollowed,
  setVideoSaved,
} from "@opsiclear/gsav-client";

import { supabase } from "../../services/supabase";

type SocialClient = Parameters<typeof getSavedVideoIds>[0];

export function loadSavedVideoIds(userId: string, client: SocialClient = supabase) {
  return getSavedVideoIds(client, userId);
}

export function updateVideoSaved(
  userId: string,
  videoBackendId: string,
  saved: boolean,
  client: SocialClient = supabase,
) {
  return setVideoSaved(client, userId, videoBackendId, saved);
}

export function loadChannelFollowerCount(channelId: string, client: SocialClient = supabase) {
  return getChannelFollowerCount(client, channelId);
}

export function loadIsChannelFollowed(userId: string, channelId: string, client: SocialClient = supabase) {
  return isChannelFollowed(client, userId, channelId);
}

export function updateChannelFollowed(
  userId: string,
  channelId: string,
  followed: boolean,
  client: SocialClient = supabase,
) {
  return setChannelFollowed(client, userId, channelId, followed);
}
