import { usePreferencesStore } from "./preferencesStore";

export function usePreferenceBootstrap() {
  return {
    darkMode: usePreferencesStore((state) => state.darkMode),
    restorePreferences: usePreferencesStore((state) => state.restore),
  };
}

export function usePlayerEmbedPreferences() {
  return {
    hydrated: usePreferencesStore((state) => state.hydrated),
    dataSaver: usePreferencesStore((state) => state.trafficSaving),
  };
}

export function useEditablePreferences() {
  return {
    darkMode: usePreferencesStore((state) => state.darkMode),
    setDarkMode: usePreferencesStore((state) => state.setDarkMode),
    trafficSaving: usePreferencesStore((state) => state.trafficSaving),
    setTrafficSaving: usePreferencesStore((state) => state.setTrafficSaving),
  };
}
