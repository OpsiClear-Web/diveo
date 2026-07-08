import { useCallback, useEffect, useRef, useState } from "react";

import { formatGsavCatalogError } from "../../shared/gsavErrors";
import { loadCatalogFeed, type GsavContentItem } from "./catalogAdapter";

/**
 * Native GSAV feed: reads the diveo catalog through the feature-owned adapter.
 * Auto-loads the first page on mount; exposes pull-to-refresh, retry, and
 * cursor-based infinite scroll (loadMore) so the native home can browse the
 * whole catalog, not just the first page.
 */
export function useGsavFeed() {
  const [items, setItems] = useState<GsavContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const cursorRef = useRef<string | undefined>(undefined);

  const load = useCallback(async (isRefresh = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const page = await loadCatalogFeed();
      setItems(page.videos);
      cursorRef.current = page.nextCursor;
      setHasMore(Boolean(page.nextCursor));
    } catch (e) {
      setError(formatGsavCatalogError(e, "Failed to load the diveo catalog."));
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !cursorRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const page = await loadCatalogFeed({ cursor: cursorRef.current });
      setItems((prev) => {
        const seen = new Set(prev.map((video) => video.id));
        return [...prev, ...page.videos.filter((video) => !seen.has(video.id))];
      });
      cursorRef.current = page.nextCursor;
      setHasMore(Boolean(page.nextCursor));
    } catch {
      // Keep what we have; scrolling past the threshold again retries.
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch on mount; load() is async and guarded (loadingRef).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return {
    items,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    error,
    reload: () => load(false),
    refresh: () => load(true),
    loadMore,
  };
}
