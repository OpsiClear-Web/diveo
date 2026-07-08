import { Share } from "react-native";

import { buildGsavWatchPath } from "../../shared/gsavRoutes";
import { getConfiguredGsavWebUrl } from "../../shared/gsavWeb";
import type { SceneItem } from "./sceneTypes";

export function buildSceneShareUrl(item: SceneItem, baseUrl = getConfiguredGsavWebUrl()) {
  if (!baseUrl) return null;
  return `${baseUrl.replace(/\/+$/, "")}${buildGsavWatchPath(item.id)}`;
}

export async function shareScene(item: SceneItem) {
  const url = buildSceneShareUrl(item);
  if (!url) return;
  try {
    await Share.share({ message: `${item.title}\n${url}`, url });
  } catch {
    // dismissed or unavailable, no-op
  }
}
