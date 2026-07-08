import { describe, expect, it } from "vitest";

import { buildGsavWatchPath } from "./gsavRoutes";

describe("buildGsavWatchPath", () => {
  it("builds a bare path and encodes the id", () => {
    expect(buildGsavWatchPath("elly")).toBe("/watch/elly");
    expect(buildGsavWatchPath("a/b c")).toBe("/watch/a%2Fb%20c");
  });

  it("preserves start times and unlisted share tokens", () => {
    expect(buildGsavWatchPath("unlisted scene", { startTime: "2.5", share: "share-token_123" })).toBe(
      "/watch/unlisted%20scene?t=2.5&share=share-token_123",
    );
  });

  it("throws on an empty scene id", () => {
    expect(() => buildGsavWatchPath("")).toThrow("sceneId must be a non-empty string");
  });
});
