import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";

/** Get total size (bytes) of a directory recursively */
async function dirSize(dirUri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(dirUri);
    if (!info.exists) return 0;
    const entries = await FileSystem.readDirectoryAsync(dirUri);
    let total = 0;
    for (const entry of entries) {
      const entryUri = dirUri.endsWith('/') ? `${dirUri}${entry}` : `${dirUri}/${entry}`;
      const entryInfo = await FileSystem.getInfoAsync(entryUri);
      if (!entryInfo.exists) continue;
      if (entryInfo.isDirectory) {
        total += await dirSize(entryUri);
      } else {
        total += (entryInfo as any).size ?? 0;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/** Format bytes to human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Calculate image cache size (expo-image uses its own cache dirs) */
export async function getImageCacheSize(): Promise<number> {
  if (Platform.OS === "web") return 0;
  const cacheDir = FileSystem.cacheDirectory ?? "";
  return dirSize(cacheDir);
}

/** Clear expo-image disk cache + expo-file-system cache directory */
export async function clearImageCache(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Image.clearDiskCache();
    await Image.clearMemoryCache();
  } catch {}
  // Also clear the general cache directory for feature-level cached assets.
  try {
    const cacheDir = FileSystem.cacheDirectory ?? "";
    const entries = await FileSystem.readDirectoryAsync(cacheDir);
    await Promise.all(
      entries.map(async (entry) => {
        const uri = `${cacheDir}${entry}`;
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {}
      }),
    );
  } catch {}
}
