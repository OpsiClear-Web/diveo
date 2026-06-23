/**
 * diveo native content layer (World B) — consumes gsav-hosting's catalog API
 * (a Supabase Edge Function) as the single source of truth for GSAV scenes.
 * This is the GSAV replacement for the legacy Bilibili `services/bilibili.ts`:
 * the native browse features (feed, search, creator) read content from here.
 *
 * Config via env (the Supabase anon key is public by design — safe to ship):
 *   EXPO_PUBLIC_GSAV_CATALOG_URL        catalog endpoint (default: dev functions)
 *   EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY  sent as apikey/Authorization when set
 *
 * The data model mirrors gsav-hosting's catalog `Video`/`Creator` types as a
 * deliberate cross-repo contract (a type mirror, NOT bundled catalog data).
 */

export const DEFAULT_CATALOG_URL = "http://127.0.0.1:54321/functions/v1/catalog";

export type GsavDanmaku = {
  time: number;
  mode: 1 | 4 | 5; // 1 = scroll, 4 = bottom-fixed, 5 = top-fixed
  fontSize: number;
  color: number; // 0xRRGGBB
  text: string;
  uname?: string;
};

export type GsavContentItem = {
  id: string;
  title: string;
  author: string;
  creatorId?: string;
  posterUrl: string;
  animatedPosterUrl?: string;
  gsavUrl: string;
  description?: string;
  durationSec?: number;
  gaussians?: number;
  frames?: number;
  fps?: number;
  category?: string;
  tags: string[];
  danmakus: GsavDanmaku[];
};

export type GsavCreator = {
  id: string;
  handle: string;
  displayName: string;
  bio?: string;
  avatarUrl: string;
  bannerUrl?: string;
  followerCount?: number;
  publishedVideoCount?: number;
};

export type GsavCatalogPage = {
  videos: GsavContentItem[];
  creators: GsavCreator[];
  total?: number;
  nextCursor?: string;
};

export type GsavQuery = {
  id?: string;
  share?: string;
  q?: string;
  category?: string;
  tag?: string;
  channel?: string;
  limit?: number;
  cursor?: string;
};

// --- pure normalizers (defensive; unit-tested; no network) ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeDanmaku(raw: unknown): GsavDanmaku | null {
  if (!isRecord(raw)) return null;
  const text = str(raw.text);
  const time = num(raw.time);
  if (text === undefined || time === undefined) return null;
  const mode = raw.mode === 4 || raw.mode === 5 ? raw.mode : 1;
  return {
    time,
    mode,
    fontSize: num(raw.fontSize) ?? 24,
    color: num(raw.color) ?? 0xffffff,
    text,
    uname: str(raw.uname),
  };
}

export function normalizeContentItem(raw: unknown): GsavContentItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const gsavUrl = str(raw.gsavUrl);
  // id + gsavUrl are the minimum needed to list and play a scene.
  if (id === undefined || gsavUrl === undefined) return null;
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === "string")
    : [];
  const danmakus = Array.isArray(raw.danmakus)
    ? raw.danmakus.map(normalizeDanmaku).filter((d): d is GsavDanmaku => d !== null)
    : [];
  return {
    id,
    title: str(raw.title) ?? "Untitled scene",
    author: str(raw.author) ?? "Unknown",
    creatorId: str(raw.creatorId),
    posterUrl: str(raw.posterUrl) ?? "",
    animatedPosterUrl: str(raw.animatedPosterUrl),
    gsavUrl,
    description: str(raw.description),
    durationSec: num(raw.durationSec),
    gaussians: num(raw.gaussians),
    frames: num(raw.frames),
    fps: num(raw.fps),
    category: str(raw.category),
    tags,
    danmakus,
  };
}

export function normalizeCreator(raw: unknown): GsavCreator | null {
  if (!isRecord(raw)) return null;
  const handle = str(raw.handle) ?? str(raw.id);
  const displayName = str(raw.displayName);
  if (handle === undefined || displayName === undefined) return null;
  return {
    id: str(raw.id) ?? handle,
    handle,
    displayName,
    bio: str(raw.bio),
    avatarUrl: str(raw.avatarUrl) ?? "",
    bannerUrl: str(raw.bannerUrl),
    followerCount: num(raw.followerCount),
    publishedVideoCount: num(raw.publishedVideoCount),
  };
}

export function normalizeCatalogPage(payload: unknown): GsavCatalogPage {
  if (!isRecord(payload)) return { videos: [], creators: [] };
  const videos = Array.isArray(payload.videos)
    ? payload.videos.map(normalizeContentItem).filter((v): v is GsavContentItem => v !== null)
    : [];
  const creators = Array.isArray(payload.creators)
    ? payload.creators.map(normalizeCreator).filter((c): c is GsavCreator => c !== null)
    : [];
  const page = isRecord(payload.page) ? payload.page : undefined;
  return {
    videos,
    creators,
    total: num(page?.total) ?? num(payload.total),
    nextCursor: str(page?.nextCursor) ?? str(payload.nextCursor),
  };
}

// --- network ---

function catalogUrl(): string {
  return process.env.EXPO_PUBLIC_GSAV_CATALOG_URL ?? DEFAULT_CATALOG_URL;
}
function authHeaders(): Record<string, string> {
  const key = process.env.EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY;
  return key ? { apikey: key, Authorization: `Bearer ${key}` } : {};
}

export async function fetchCatalog(query: GsavQuery = {}): Promise<GsavCatalogPage> {
  const url = new URL(catalogUrl());
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", ...authHeaders() },
  });
  if (!res.ok) throw new Error(`GSAV catalog ${res.status}`);
  return normalizeCatalogPage(await res.json());
}

/** High-level content queries used by the native browse features. */
export const gsavCatalog = {
  feed: (query: GsavQuery = {}) => fetchCatalog({ limit: 30, ...query }),
  search: (q: string, query: GsavQuery = {}) => fetchCatalog({ q, limit: 30, ...query }),
  byCreator: (channel: string, query: GsavQuery = {}) => fetchCatalog({ channel, limit: 60, ...query }),
  async scene(id: string): Promise<GsavContentItem | null> {
    const page = await fetchCatalog({ id });
    return page.videos.find((v) => v.id === id) ?? page.videos[0] ?? null;
  },
  async related(id: string): Promise<GsavContentItem[]> {
    // gsav-hosting has no dedicated "related" endpoint yet; approximate with the
    // feed minus the current scene. Swap in a real endpoint when it exists.
    const page = await fetchCatalog({ limit: 12 });
    return page.videos.filter((v) => v.id !== id);
  },
};
