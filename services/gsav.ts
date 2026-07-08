import {
  normalizeCatalogPage,
  normalizeContentItem,
  normalizeCreator,
  normalizeDanmaku,
} from "@opsiclear/gsav-client";
import type {
  GsavCatalogConfig,
  GsavCatalogPage,
  GsavContentItem,
  GsavCreator,
  GsavDanmaku,
  GsavQuery,
} from "@opsiclear/gsav-client";
export {
  normalizeCatalogPage,
  normalizeContentItem,
  normalizeCreator,
  normalizeDanmaku,
};
export type {
  GsavCatalogConfig,
  GsavCatalogPage,
  GsavContentItem,
  GsavCreator,
  GsavDanmaku,
  GsavQuery,
};

const DEV_LOOPBACK_HOST = ["127", "0", "0", "1"].join(".");

export const CATALOG_SCHEMA_VERSION = 1;
export const DEFAULT_CATALOG_URL = `http://${DEV_LOOPBACK_HOST}:54321/functions/v1/catalog`;

type CatalogPayload = {
  schemaVersion?: unknown;
  videos?: unknown;
  creators?: unknown;
};

type CatalogFetchResponse = Pick<Response, "json" | "ok" | "status">;
type CatalogFetch = (input: string, init?: { headers: Record<string, string> }) => Promise<CatalogFetchResponse>;

export type GsavCatalog = {
  fetchCatalog: (query?: GsavQuery) => Promise<GsavCatalogPage>;
  feed: (query?: GsavQuery) => Promise<GsavCatalogPage>;
  search: (q: string, query?: GsavQuery) => Promise<GsavCatalogPage>;
  byCreator: (channel: string, query?: GsavQuery) => Promise<GsavCatalogPage>;
  scene: (id: string) => Promise<GsavContentItem | null>;
  related: (id: string) => Promise<GsavContentItem[]>;
};

export function assertVersionedCatalogPayload(payload: unknown): asserts payload is CatalogPayload & { videos: unknown[] } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Catalog API response must be an object.");
  }
  const raw = payload as CatalogPayload;
  if (raw.schemaVersion === undefined) {
    throw new Error("Catalog API response is missing schemaVersion.");
  }
  if (raw.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    throw new Error(`Catalog API schemaVersion ${String(raw.schemaVersion)} is not supported.`);
  }
  if (!Array.isArray(raw.videos)) {
    throw new Error("Catalog API response must include a videos array.");
  }
}

function queryUrl(endpoint: string, query: GsavQuery = {}) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function authHeaders(anonKey?: string): Record<string, string> {
  return anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {};
}

function assertSharedNormalizerAcceptedAllRows(payload: CatalogPayload, page: GsavCatalogPage) {
  const videos = Array.isArray(payload.videos) ? payload.videos : [];
  const creators = Array.isArray(payload.creators) ? payload.creators : [];
  if (page.videos.length !== videos.length) {
    throw new Error("Catalog API response contains invalid video entries.");
  }
  if (page.creators.length !== creators.length) {
    throw new Error("Catalog API response contains invalid creator entries.");
  }
}

export function createVersionedGsavCatalog(config: GsavCatalogConfig, fetchImpl: CatalogFetch = fetch): GsavCatalog {
  async function fetchCatalog(query: GsavQuery = {}) {
    const url = queryUrl(config.catalogUrl, query);
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", ...authHeaders(config.anonKey) },
    });
    if (!response.ok) {
      throw new Error(`GSAV catalog ${response.status}`);
    }

    const payload = await response.json();
    assertVersionedCatalogPayload(payload);
    const page = normalizeCatalogPage(payload);
    assertSharedNormalizerAcceptedAllRows(payload, page);
    return page;
  }

  return {
    fetchCatalog,
    feed: (query: GsavQuery = {}) => fetchCatalog({ limit: 30, ...query }),
    search: (q: string, query: GsavQuery = {}) => fetchCatalog({ q, limit: 30, ...query }),
    byCreator: (channel: string, query: GsavQuery = {}) => fetchCatalog({ channel, limit: 60, ...query }),
    async scene(id: string): Promise<GsavContentItem | null> {
      const page = await fetchCatalog({ id });
      return page.videos.find((video) => video.id === id || video.backendId === id) ?? page.videos[0] ?? null;
    },
    async related(id: string) {
      const page = await fetchCatalog({ limit: 12 });
      return page.videos.filter((video) => video.id !== id);
    },
  };
}

export const gsavCatalog = createVersionedGsavCatalog({
  catalogUrl: process.env.EXPO_PUBLIC_GSAV_CATALOG_URL ?? DEFAULT_CATALOG_URL,
  anonKey: process.env.EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY,
});
