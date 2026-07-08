import { useEffect } from "react";
import { Platform } from "react-native";

import { useStartupUpdateCheck } from "../app-update/updateAccess";
import { usePreferenceBootstrap } from "../preferences/preferenceAccess";
import { initializeAuth, useAuthUserId } from "../social/authSession";
import { loadSavedScenesForCurrentUser } from "../social/savedSceneAccess";

export function useAppBootstrap() {
  const { darkMode, restorePreferences } = usePreferenceBootstrap();
  const { checkUpdate } = useStartupUpdateCheck();
  const authUserId = useAuthUserId();

  useEffect(() => {
    restorePreferences();
    initializeAuth();
    if (Platform.OS === "android") {
      void checkUpdate({ silent: true });
    }
  }, [checkUpdate, restorePreferences]);

  useEffect(() => {
    void loadSavedScenesForCurrentUser();
  }, [authUserId]);

  return { darkMode };
}
