import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGsavProgressStore } from "./gsavProgressStore";
import { selectLatestGsavResume } from "./resumeAccess";

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  failReads: false,
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      if (storage.failReads) throw new Error("read failed");
      return storage.values.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.values.set(key, value);
    }),
  },
}));

const STORAGE_KEY = "gsav_play_progress";

function resetStore() {
  storage.values.clear();
  storage.failReads = false;
  useGsavProgressStore.setState({
    records: {},
    hydrated: false,
  });
}

describe("GSAV progress store", () => {
  beforeEach(resetStore);

  it("restores saved progress and marks hydration complete", async () => {
    storage.values.set(
      STORAGE_KEY,
      JSON.stringify({
        test: { videoId: "test", time: 12, duration: 60, ts: 1 },
      }),
    );

    await useGsavProgressStore.getState().hydrate();

    expect(useGsavProgressStore.getState().hydrated).toBe(true);
    expect(useGsavProgressStore.getState().get("test")).toBe(12);
  });

  it("falls back to an empty hydrated store when restore fails", async () => {
    storage.failReads = true;

    await useGsavProgressStore.getState().hydrate();

    expect(useGsavProgressStore.getState()).toMatchObject({
      records: {},
      hydrated: true,
    });
  });

  it("ignores invalid, very early, and zero-duration progress", () => {
    const store = useGsavProgressStore.getState();

    store.save("", 10, 60);
    store.save("early", 2.9, 60);
    store.save("zero", 10, 0);

    expect(useGsavProgressStore.getState().records).toEqual({});
    expect(storage.values.has(STORAGE_KEY)).toBe(false);
  });

  it("saves and clears resumable progress", () => {
    const store = useGsavProgressStore.getState();

    store.save("test", 10, 60);
    expect(useGsavProgressStore.getState().get("test")).toBe(10);
    expect(JSON.parse(storage.values.get(STORAGE_KEY) ?? "{}")).toMatchObject({
      test: { videoId: "test", time: 10, duration: 60 },
    });

    useGsavProgressStore.getState().clear("test");

    expect(useGsavProgressStore.getState().get("test")).toBe(0);
    expect(JSON.parse(storage.values.get(STORAGE_KEY) ?? "{}")).toEqual({});
  });

  it("clears progress when playback is saved near the end", () => {
    const store = useGsavProgressStore.getState();

    store.save("test", 10, 60);
    store.save("test", 57, 60);

    expect(useGsavProgressStore.getState().get("test")).toBe(0);
    expect(JSON.parse(storage.values.get(STORAGE_KEY) ?? "{}")).toEqual({});
  });

  it("selects the latest resumable catalog item without exposing the progress store", () => {
    expect(selectLatestGsavResume(
      [
        { id: "older", title: "Older scene" },
        { id: "latest", title: "Latest scene", posterUrl: "https://example.com/poster.jpg" },
      ],
      {
        orphan: { videoId: "orphan", time: 25, duration: 100, ts: 3 },
        older: { videoId: "older", time: 30, duration: 100, ts: 1 },
        latest: { videoId: "latest", time: 45, duration: 90, ts: 2 },
      },
    )).toEqual({
      id: "latest",
      title: "Latest scene",
      posterUrl: "https://example.com/poster.jpg",
      time: 45,
      duration: 90,
      updatedAt: 2,
      progressPercent: 50,
    });
  });

  it("does not surface resume state for records outside the current catalog items", () => {
    expect(selectLatestGsavResume(
      [{ id: "visible", title: "Visible scene" }],
      {
        hidden: { videoId: "hidden", time: 45, duration: 90, ts: 2 },
      },
    )).toBeNull();
  });
});
