import { describe, expect, it, vi } from "vitest";

import { buildSceneShareUrl, shareScene } from "./sceneShare";
import type { SceneItem } from "./sceneTypes";

vi.mock("react-native", () => ({
  Share: {
    share: vi.fn(),
  },
}));

const scene: SceneItem = {
  id: "scene id",
  backendId: "backend-id",
  title: "Scene Title",
  author: "Creator",
  creatorId: "creator",
  posterUrl: "",
};

describe("scene sharing", () => {
  it("builds a GSAV web watch URL for a scene", () => {
    expect(buildSceneShareUrl(scene, "https://gsav.example.com/app/")).toBe(
      "https://gsav.example.com/app/watch/scene%20id",
    );
  });

  it("skips sharing when no configured base URL exists", async () => {
    await expect(shareScene(scene)).resolves.toBeUndefined();
  });
});
