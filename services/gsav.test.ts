import { afterEach, describe, it, expect, vi } from "vitest";

import {
  CATALOG_SCHEMA_VERSION,
  assertVersionedCatalogPayload,
  createVersionedGsavCatalog,
  normalizeCatalogPage,
  normalizeContentItem,
  normalizeCreator,
  normalizeDanmaku,
} from "./gsav";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeContentItem", () => {
  it("maps a full catalog video", () => {
    const item = normalizeContentItem({
      id: "elly",
      backendId: "vid-uuid",
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
      backendId: "vid-uuid",
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
    expect(normalizeCreator({ id: "c1", backendId: "ch-uuid", displayName: "Lab" })).toMatchObject({
      backendId: "ch-uuid",
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

describe("versioned catalog contract", () => {
  it("requires schemaVersion 1 and a videos array", () => {
    expect(() => assertVersionedCatalogPayload({
      schemaVersion: CATALOG_SCHEMA_VERSION,
      videos: [],
    })).not.toThrow();

    expect(() => assertVersionedCatalogPayload({ videos: [] })).toThrow(/missing schemaVersion/);
    expect(() => assertVersionedCatalogPayload({ schemaVersion: CATALOG_SCHEMA_VERSION + 1, videos: [] })).toThrow(/not supported/);
    expect(() => assertVersionedCatalogPayload({ schemaVersion: CATALOG_SCHEMA_VERSION })).toThrow(/videos array/);
    expect(() => assertVersionedCatalogPayload([])).toThrow(/must be an object/);
  });

  it("fetches catalog pages through the versioned shared contract", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        schemaVersion: CATALOG_SCHEMA_VERSION,
        videos: [{ id: "scene-1", backendId: "video-uuid", title: "Scene 1", author: "Lab", gsavUrl: "https://cdn/scene.gsav" }],
        creators: [{ id: "lab", handle: "lab", displayName: "Lab", avatarUrl: "https://cdn/avatar.jpg" }],
        page: { nextCursor: "30", total: 42 },
      }),
    }));
    const catalog = createVersionedGsavCatalog({
      catalogUrl: "https://api.example.com/functions/v1/catalog",
      anonKey: "anon-key",
    }, fetchMock);

    await expect(catalog.search("capture", { cursor: "10" })).resolves.toMatchObject({
      videos: [{ id: "scene-1", backendId: "video-uuid" }],
      creators: [{ id: "lab" }],
      nextCursor: "30",
      total: 42,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/functions/v1/catalog?q=capture&limit=30&cursor=10",
      {
        headers: {
          Accept: "application/json",
          apikey: "anon-key",
          Authorization: "Bearer anon-key",
        },
      },
    );
  });

  it("rejects unversioned or invalid catalog rows before native UI receives them", async () => {
    const missingVersionFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ videos: [{ id: "scene-1", gsavUrl: "https://cdn/scene.gsav" }] }),
    }));
    const invalidRowFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        schemaVersion: CATALOG_SCHEMA_VERSION,
        videos: [{ id: "missing-gsav-url" }],
      }),
    }));

    await expect(createVersionedGsavCatalog({
      catalogUrl: "https://api.example.com/functions/v1/catalog",
    }, missingVersionFetch).feed()).rejects.toThrow(/missing schemaVersion/);

    await expect(createVersionedGsavCatalog({
      catalogUrl: "https://api.example.com/functions/v1/catalog",
    }, invalidRowFetch).feed()).rejects.toThrow(/invalid video entries/);
  });

  it("surfaces non-ok catalog responses with the shared client error shape", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));

    await expect(createVersionedGsavCatalog({
      catalogUrl: "https://api.example.com/functions/v1/catalog",
    }, fetchMock).feed()).rejects.toThrow(/GSAV catalog 503/);
  });
});
