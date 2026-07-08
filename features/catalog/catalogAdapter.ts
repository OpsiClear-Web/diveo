import { gsavCatalog, type GsavCatalog, type GsavContentItem, type GsavCreator } from "../../services/gsav";

export type CatalogClient = Pick<GsavCatalog, "byCreator" | "feed" | "scene" | "search">;
export type { GsavContentItem, GsavCreator };

export function loadCatalogFeed(
  options: Parameters<CatalogClient["feed"]>[0] = undefined,
  catalog: Pick<CatalogClient, "feed"> = gsavCatalog,
) {
  return catalog.feed(options);
}

export function searchCatalogScenes(query: string, catalog: Pick<CatalogClient, "search"> = gsavCatalog) {
  return catalog.search(query);
}

export function loadCreatorCatalog(handle: string, catalog: Pick<CatalogClient, "byCreator"> = gsavCatalog) {
  return catalog.byCreator(handle);
}

export function loadCatalogSceneByBackendId(backendId: string, catalog: Pick<CatalogClient, "scene"> = gsavCatalog) {
  return catalog.scene(backendId);
}
