import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "gsav_play_progress";
const MAX_ENTRIES = 200;
const FINISH_RATIO = 0.95;
const MIN_SECONDS = 3;

type ProgressEntry = {
  videoId: string;
  time: number;
  duration: number;
  ts: number;
};

type GsavProgressStore = {
  records: Record<string, ProgressEntry>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  save: (videoId: string, time: number, duration: number) => void;
  get: (videoId: string) => number;
  clear: (videoId: string) => void;
};

const persist = (records: Record<string, ProgressEntry>) => {
  const trimmed = Object.values(records)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_ENTRIES);
  const map: Record<string, ProgressEntry> = {};
  trimmed.forEach((entry) => {
    map[entry.videoId] = entry;
  });
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map)).catch(() => {});
  return map;
};

export const useGsavProgressStore = create<GsavProgressStore>((set, get) => ({
  records: {},
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        set({ records: JSON.parse(raw), hydrated: true });
        return;
      }
    } catch {
      // Corrupt or unavailable storage should not block playback.
    }
    set({ hydrated: true });
  },
  save: (videoId, time, duration) => {
    if (!videoId || !duration || duration <= 0) return;
    if (time / duration >= FINISH_RATIO) {
      get().clear(videoId);
      return;
    }
    if (time < MIN_SECONDS) return;
    const records = {
      ...get().records,
      [videoId]: { videoId, time, duration, ts: Date.now() },
    };
    set({ records: persist(records) });
  },
  get: (videoId) => get().records[videoId]?.time ?? 0,
  clear: (videoId) => {
    const records = { ...get().records };
    if (records[videoId]) {
      delete records[videoId];
      set({ records: persist(records) });
    }
  },
}));
