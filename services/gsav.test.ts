import { describe, it, expect } from "vitest";

import {
  normalizeCatalogPage,
  normalizeContentItem,
  normalizeCreator,
  normalizeDanmaku,
} from "./gsav";

describe("normalizeContentItem", () => {
  it("maps a full catalog video", () => {
    const item = normalizeContentItem({
      id: "elly",
      title: "Elly Portrait Capture",
      author: "OpsiClear",
      creatorId: "opsiclear",
      posterUrl: "https://cdn/posters/elly.svg",
      gsavUrl: "https://cdn/processed/elly.gsav",
      durationSec: 12,
      gaussians: 1000,
      category: "Featured",
      tags: ["portrait", "4d"],
      danmakus: [{ time: 1, mode: 1, fontSize: 24, color: 16777215, text: "hi" }],
    });
    expect(item).toMatchObject({
      id: "elly",
      title: "Elly Portrait Capture",
      author: "OpsiClear",
      gsavUrl: "https://cdn/processed/elly.gsav",
      tags: ["portrait", "4d"],
    });
    expect(item?.danmakus).toHaveLength(1);
  });

  it("requires id and gsavUrl", () => {
    expect(normalizeContentItem({ id: "x" })).toBeNull(); // no gsavUrl
    expect(normalizeContentItem({ gsavUrl: "u" })).toBeNull(); // no id
    expect(normalizeContentItem(null)).toBeNull();
    expect(normalizeContentItem("nope")).toBeNull();
  });

  it("fills sane defaults and drops bad tags/danmakus", () => {
    const item = normalizeContentItem({
      id: "test",
      gsavUrl: "u",
      tags: ["ok", 5, null],
      danmakus: [{ text: "no-time" }, { time: 2, text: "good" }],
    });
    expect(item?.title).toBe("Untitled scene");
    expect(item?.author).toBe("Unknown");
    expect(item?.posterUrl).toBe("");
    expect(item?.tags).toEqual(["ok"]);
    expect(item?.danmakus).toEqual([{ time: 2, mode: 1, fontSize: 24, color: 0xffffff, text: "good" }]);
  });
});

describe("normalizeDanmaku", () => {
  it("keeps valid modes and defaults the rest", () => {
    expect(normalizeDanmaku({ time: 0, text: "a", mode: 5 })?.mode).toBe(5);
    expect(normalizeDanmaku({ time: 0, text: "a", mode: 9 })?.mode).toBe(1); // invalid → scroll
  });
  it("rejects entries without time or text", () => {
    expect(normalizeDanmaku({ time: 1 })).toBeNull();
    expect(normalizeDanmaku({ text: "x" })).toBeNull();
  });
});

describe("normalizeCreator", () => {
  it("maps a creator and falls back handle→id", () => {
    expect(normalizeCreator({ id: "c1", displayName: "Lab" })).toMatchObject({
      handle: "c1",
      displayName: "Lab",
      avatarUrl: "",
    });
  });
  it("requires a handle/id and a display name", () => {
    expect(normalizeCreator({ displayName: "x" })).toBeNull();
    expect(normalizeCreator({ handle: "h" })).toBeNull();
  });
});

describe("normalizeCatalogPage", () => {
  it("filters invalid rows and reads pagination", () => {
    const page = normalizeCatalogPage({
      videos: [
        { id: "a", gsavUrl: "u" },
        { id: "bad" }, // dropped (no gsavUrl)
      ],
      creators: [{ id: "c", displayName: "C" }, { nope: 1 }],
      page: { total: 42, nextCursor: "30" },
    });
    expect(page.videos.map((v) => v.id)).toEqual(["a"]);
    expect(page.creators.map((c) => c.id)).toEqual(["c"]);
    expect(page.total).toBe(42);
    expect(page.nextCursor).toBe("30");
  });

  it("is total-safe on garbage input", () => {
    expect(normalizeCatalogPage(null)).toEqual({ videos: [], creators: [] });
    expect(normalizeCatalogPage({})).toEqual({ videos: [], creators: [] });
  });
});
