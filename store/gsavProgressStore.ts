import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Native playback-resume for GSAV scenes. Position is captured from the player's
// bridge events (GsavWebView) keyed by scene videoId, persisted to AsyncStorage,
// and replayed via the web /watch ?t= start offset (GsavScreen). This is the
// GSAV counterpart to the retired Bilibili playProgressStore (which keyed by bvid).
const STORAGE_KEY = "gsav_play_progress";
const MAX_ENTRIES = 200;
// >= 95% watched counts as finished — drop the record so it restarts next time.
const FINISH_RATIO = 0.95;
// Don't bother resuming the first few seconds.
const MIN_SECONDS = 3;

type ProgressEntry = {
  videoId: string;
  time: number; // seconds
  duration: number; // seconds
  ts: number; // last-write timestamp
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
  // Cap total stored: keep the most-recently-watched MAX_ENTRIES.
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
      // Corrupt/unavailable storage — start clean rather than block playback.
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
