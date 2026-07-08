import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "./preferencesStore";

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

function resetStore() {
  storage.values.clear();
  storage.failReads = false;
  usePreferencesStore.setState({
    darkMode: true,
    trafficSaving: false,
    hydrated: false,
  });
}

describe("preferences store", () => {
  beforeEach(resetStore);

  it("persists dark-mode and traffic-saving preferences", async () => {
    await usePreferencesStore.getState().setDarkMode(false);
    await usePreferencesStore.getState().setTrafficSaving(true);

    expect(storage.values.get("DARK_MODE")).toBe("0");
    expect(storage.values.get("TRAFFIC_SAVING")).toBe("1");
    expect(usePreferencesStore.getState().darkMode).toBe(false);
    expect(usePreferencesStore.getState().trafficSaving).toBe(true);
  });

  it("restores saved preferences and marks hydration complete", async () => {
    storage.values.set("DARK_MODE", "0");
    storage.values.set("TRAFFIC_SAVING", "1");

    await usePreferencesStore.getState().restore();

    expect(usePreferencesStore.getState()).toMatchObject({
      darkMode: false,
      trafficSaving: true,
      hydrated: true,
    });
  });

  it("falls back to defaults when restore fails", async () => {
    storage.failReads = true;

    await usePreferencesStore.getState().restore();

    expect(usePreferencesStore.getState()).toMatchObject({
      darkMode: true,
      trafficSaving: false,
      hydrated: true,
    });
  });
});
