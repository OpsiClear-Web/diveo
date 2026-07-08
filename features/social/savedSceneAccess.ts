import { useSavedScenesStore } from "./savedScenesStore";

export function loadSavedScenesForCurrentUser() {
  return useSavedScenesStore.getState().load();
}
