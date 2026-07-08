import { gsavCatalog, type GsavCatalog, type GsavContentItem } from "../../services/gsav";
import type { SceneItem } from "../scene/sceneTypes";

export type SavedSceneLookupClient = Pick<GsavCatalog, "scene">;

function toSceneItem(scene: GsavContentItem | null, expectedBackendId: string): SceneItem | null {
  if (!scene || scene.backendId !== expectedBackendId) return null;
  return {
    id: scene.id,
    backendId: scene.backendId,
    title: scene.title,
    author: scene.author,
    creatorId: scene.creatorId,
    posterUrl: scene.posterUrl,
  };
}

export async function loadSavedScenesByBackendIds(
  backendIds: Iterable<string>,
  catalog: SavedSceneLookupClient = gsavCatalog,
): Promise<SceneItem[]> {
  const uniqueIds = [...new Set([...backendIds].filter((id) => id.trim() !== ""))];
  const scenes = await Promise.all(
    uniqueIds.map(async (backendId) => {
      return toSceneItem(await catalog.scene(backendId), backendId);
    }),
  );
  return scenes.filter((scene): scene is SceneItem => scene !== null);
}
