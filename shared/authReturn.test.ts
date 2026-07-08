import { describe, expect, it } from "vitest";

import { createLoginHref, creatorAuthReturnTo, safeAuthReturnTo } from "./authReturn";

describe("auth return route helpers", () => {
  it("accepts only native auth return targets", () => {
    expect(safeAuthReturnTo("/")).toBe("/");
    expect(safeAuthReturnTo("/library")).toBe("/library");
    expect(safeAuthReturnTo("/search")).toBe("/search");
    expect(safeAuthReturnTo("/settings")).toBe("/settings");
    expect(safeAuthReturnTo("/creator/alice")).toBe("/creator/alice");
  });

  it("rejects hosted, external, malformed, and auth-loop return targets", () => {
    for (const route of [
      undefined,
      "",
      "https://example.com/library",
      "//example.com/library",
      "/login",
      "/watch/test",
      "/gsav/test",
      "/explore",
      "/gsav-diagnostics",
      "/account/profile",
      "/creator/alice/settings",
      "/creator/",
      "/creator/..",
      "/library?tab=saved",
      "/settings#account",
      "\\library",
    ]) {
      expect(safeAuthReturnTo(route)).toBeUndefined();
    }
  });

  it("builds login hrefs with encoded safe return targets only", () => {
    expect(createLoginHref()).toBe("/login");
    expect(createLoginHref("/library")).toBe("/login?returnTo=%2Flibrary");
    expect(createLoginHref("/creator/alice")).toBe("/login?returnTo=%2Fcreator%2Falice");
    expect(createLoginHref("https://example.com/library")).toBe("/login");
  });

  it("normalizes creator handles into safe single-segment return targets", () => {
    expect(creatorAuthReturnTo("alice")).toBe("/creator/alice");
    expect(creatorAuthReturnTo("alice smith")).toBe("/creator/alice%20smith");
    expect(creatorAuthReturnTo("alice/settings")).toBeUndefined();
    expect(creatorAuthReturnTo("alice?tab=scenes")).toBeUndefined();
  });
});
