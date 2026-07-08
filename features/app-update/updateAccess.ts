import { useCheckUpdate } from "./useCheckUpdate";

export function useStartupUpdateCheck() {
  const { checkUpdate } = useCheckUpdate();
  return { checkUpdate };
}

export function useSettingsUpdateStatus() {
  return useCheckUpdate();
}
