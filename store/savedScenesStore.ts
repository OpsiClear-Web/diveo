import { create } from "zustand";

import { supabase } from "../services/supabase";
import { useGsavAuthStore } from "./gsavAuthStore";

// World B social: the signed-in user's saved (bookmarked) scenes. Mirrors
// gsav-hosting's saved_videos {profile_id, video_id}; holds a Set of video
// backendIds. Reloaded on auth change (see app/_layout). Toggle is optimistic
// with rollback.
type SavedScenesState = {
  savedIds: Set<string>;
  load: () => Promise<void>;
  toggle: (videoBackendId: string) => Promise<void>;
};

export const useSavedScenesStore = create<SavedScenesState>((set, get) => ({
  savedIds: new Set(),
  load: async () => {
    const userId = useGsavAuthStore.getState().user?.id;
    if (!userId) {
      set({ savedIds: new Set() });
      return;
    }
    const { data, error } = await supabase.from("saved_videos").select("video_id").eq("profile_id", userId);
    if (error) return;
    set({ savedIds: new Set((data ?? []).map((row) => String(row.video_id))) });
  },
  toggle: async (videoBackendId) => {
    const userId = useGsavAuthStore.getState().user?.id;
    if (!userId || !videoBackendId) return;
    const wasSaved = get().savedIds.has(videoBackendId);
    const optimistic = new Set(get().savedIds);
    if (wasSaved) optimistic.delete(videoBackendId);
    else optimistic.add(videoBackendId);
    set({ savedIds: optimistic });
    try {
      const result = wasSaved
        ? await supabase.from("saved_videos").delete().eq("profile_id", userId).eq("video_id", videoBackendId)
        : await supabase.from("saved_videos").upsert({ profile_id: userId, video_id: videoBackendId });
      if (result.error) throw result.error;
    } catch {
      const rollback = new Set(get().savedIds);
      if (wasSaved) rollback.add(videoBackendId);
      else rollback.delete(videoBackendId);
      set({ savedIds: rollback });
    }
  },
}));
