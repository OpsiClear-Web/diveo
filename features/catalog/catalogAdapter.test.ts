import { describe, expect, it } from "vitest";

import {
  loadCatalogFeed,
  loadCatalogSceneByBackendId,
  loadCreatorCatalog,
  searchCatalogScenes,
} from "./catalogAdapter";

describe("catalog adapter", () => {
  it("delegates feed loads with options", async () => {
    const calls: unknown[] = [];
    const page = { videos: [], creators: [], nextCursor: "next" };
    const catalog = {
      feed: async (options?: unknown) => {
        calls.push(options);
        return page;
      },
    };

    await expect(loadCatalogFeed({ cursor: "10" }, catalog)).resolves.toBe(page);
    expect(calls).toEqual([{ cursor: "10" }]);
  });

  it("delegates search, creator, and scene lookups", async () => {
    const ops: string[] = [];
    const catalog = {
      search: async (query: string) => {
        ops.push(`search:${query}`);
        return { videos: [], creators: [] };
      },
      byCreator: async (handle: string) => {
        ops.push(`creator:${handle}`);
        return { videos: [], creators: [] };
      },
      scene: async (backendId: string) => {
        ops.push(`scene:${backendId}`);
        return null;
      },
    };

    await searchCatalogScenes("elly", catalog);
    await loadCreatorCatalog("opsiclear", catalog);
    await loadCatalogSceneByBackendId("vid-1", catalog);

    expect(ops).toEqual(["search:elly", "creator:opsiclear", "scene:vid-1"]);
  });
});
