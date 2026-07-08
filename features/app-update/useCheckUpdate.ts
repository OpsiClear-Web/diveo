import { useCallback, useState } from "react";
import { Alert, Linking, Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import Constants from "expo-constants";

import { compareVersions } from "../../utils/version";

const GITHUB_API = "https://api.github.com/repos/OpsiClear-Web/diveo/releases/latest";

export function useCheckUpdate() {
  const currentVersion = Constants.expoConfig?.version ?? "0.0.0";
  const [isChecking, setIsChecking] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  const openInstallSettings = useCallback(() => {
    IntentLauncher.startActivityAsync(
      "android.settings.MANAGE_UNKNOWN_APP_SOURCES",
      { data: "package:com.opsiclear.diveo" },
    ).catch(() => {
      void IntentLauncher.startActivityAsync("android.settings.SECURITY_SETTINGS");
    });
  }, []);

  const triggerInstall = useCallback(async (localUri: string) => {
    const contentUri = await FileSystem.getContentUriAsync(localUri);
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: contentUri,
      flags: 1,
      type: "application/vnd.android.package-archive",
    });
  }, []);

  const downloadAndInstall = useCallback(async (url: string, version: string) => {
    if (Platform.OS !== "android") {
      Alert.alert("Notice", "In-app install is only supported on Android.");
      return;
    }
    const localUri = `${FileSystem.cacheDirectory}diveo-${version}.apk`;
    try {
      setDownloadProgress(0);
      const downloadResumable = FileSystem.createDownloadResumable(
        url,
        localUri,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          if (totalBytesExpectedToWrite > 0) {
            setDownloadProgress(Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100));
          }
        },
      );
      await downloadResumable.downloadAsync();
      setDownloadProgress(null);

      Alert.alert(
        "Download complete",
        'If install is blocked, tap "Open settings" and allow diveo to install unknown apps, then return and retry.',
        [
          { text: "Open settings", onPress: openInstallSettings },
          {
            text: "Install",
            onPress: () => {
              triggerInstall(localUri).catch((e) => {
                Alert.alert("Install failed", e instanceof Error ? e.message : 'Enable "install unknown apps" in settings, then retry.');
              });
            },
          },
        ],
      );
    } catch (e) {
      setDownloadProgress(null);
      Alert.alert("Download failed", e instanceof Error ? e.message : "Please try again.");
    }
  }, [openInstallSettings, triggerInstall]);

  const checkUpdate = useCallback(async (options: { silent?: boolean } = {}) => {
    const silent = options.silent ?? false;
    setIsChecking(true);
    try {
      const res = await fetch(GITHUB_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = await res.json();

      const latestVersion: string = data.tag_name ?? "";
      const apkAsset = (data.assets as { name?: string; browser_download_url?: string }[]).find((asset) =>
        (asset.name ?? "").endsWith(".apk"),
      );
      const downloadUrl = apkAsset?.browser_download_url ?? "";
      const releaseNotes: string = data.body ?? "";

      if (compareVersions(latestVersion, currentVersion) <= 0) {
        if (!silent) Alert.alert("Up to date", `v${currentVersion} is the latest version.`);
        return;
      }

      Alert.alert(
        `New version ${latestVersion}`,
        releaseNotes || "A new version is available. Download now?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Browser",
            onPress: () => Linking.openURL(downloadUrl),
          },
          {
            text: "Install in app",
            onPress: () => downloadAndInstall(downloadUrl, latestVersion),
          },
        ],
      );
    } catch (e) {
      if (!silent) Alert.alert("Check failed", e instanceof Error ? e.message : "Network error. Please try again.");
    } finally {
      setIsChecking(false);
    }
  }, [currentVersion, downloadAndInstall]);

  return { currentVersion, isChecking, downloadProgress, checkUpdate };
}
