import { useCallback, useEffect, useRef, useState } from "react";

import { gsavCatalog, type GsavContentItem } from "../services/gsav";

/**
 * Native GSAV feed (World B): reads the diveo catalog from gsav-hosting via
 * services/gsav. Auto-loads the first page on mount; exposes pull-to-refresh,
 * retry, and cursor-based infinite scroll (loadMore) so the native home can
 * browse the whole catalog, not just the first page. The GSAV replacement for
 * the legacy Bilibili useVideoList.
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
      const page = await gsavCatalog.feed();
      setItems(page.videos);
      cursorRef.current = page.nextCursor;
      setHasMore(Boolean(page.nextCursor));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the diveo catalog.");
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
      const page = await gsavCatalog.feed({ cursor: cursorRef.current });
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
