import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface PreferencesState {
  darkMode: boolean;
  trafficSaving: boolean;
  hydrated: boolean;
  setDarkMode: (value: boolean) => Promise<void>;
  setTrafficSaving: (value: boolean) => Promise<void>;
  restore: () => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  darkMode: true,
  trafficSaving: false,
  hydrated: false,

  setDarkMode: async (value) => {
    await AsyncStorage.setItem("DARK_MODE", value ? "1" : "0");
    set({ darkMode: value });
  },

  setTrafficSaving: async (value) => {
    await AsyncStorage.setItem("TRAFFIC_SAVING", value ? "1" : "0");
    set({ trafficSaving: value });
  },

  restore: async () => {
    try {
      const [darkMode, trafficSaving] = await Promise.all([
        AsyncStorage.getItem("DARK_MODE"),
        AsyncStorage.getItem("TRAFFIC_SAVING"),
      ]);
      set({
        darkMode: darkMode !== "0",
        trafficSaving: trafficSaving === "1",
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },
}));
