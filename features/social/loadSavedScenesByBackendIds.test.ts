import { describe, expect, it } from "vitest";

import { loadSavedScenesByBackendIds } from "./loadSavedScenesByBackendIds";

describe("loadSavedScenesByBackendIds", () => {
  it("loads saved scenes by backend id, de-dupes ids, and filters mismatches", async () => {
    const calls: string[] = [];
    const catalog = {
      scene: async (id: string) => {
        calls.push(id);
        if (id === "vid-1") {
          return {
            id: "elly",
            backendId: "vid-1",
            title: "Elly",
            author: "OpsiClear",
            creatorId: "opsiclear",
            posterUrl: "",
            gsavUrl: "https://cdn/elly.gsav",
            durationSec: 12,
            tags: [],
            danmakus: [],
          };
        }
        if (id === "vid-2") {
          return {
            id: "wrong",
            backendId: "other",
            title: "Wrong",
            author: "OpsiClear",
            posterUrl: "",
            gsavUrl: "https://cdn/wrong.gsav",
            tags: [],
            danmakus: [],
          };
        }
        return null;
      },
    };

    const scenes = await loadSavedScenesByBackendIds(["vid-1", "vid-1", "vid-2", ""], catalog);
    expect(calls).toEqual(["vid-1", "vid-2"]);
    expect(scenes).toEqual([
      {
        id: "elly",
        backendId: "vid-1",
        title: "Elly",
        author: "OpsiClear",
        creatorId: "opsiclear",
        posterUrl: "",
      },
    ]);
  });
});
