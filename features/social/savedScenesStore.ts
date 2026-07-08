import { create } from "zustand";

import { useGsavAuthStore } from "./gsavAuthStore";
import { loadSavedVideoIds, updateVideoSaved } from "./socialAdapter";

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
    try {
      const ids = await loadSavedVideoIds(userId);
      set({ savedIds: new Set(ids) });
    } catch {
      // Keep current set on load failure.
    }
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
      await updateVideoSaved(userId, videoBackendId, !wasSaved);
    } catch {
      const rollback = new Set(get().savedIds);
      if (wasSaved) rollback.add(videoBackendId);
      else rollback.delete(videoBackendId);
      set({ savedIds: rollback });
    }
  },
}));
