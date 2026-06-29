import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { gsavCatalog, type GsavContentItem } from "../services/gsav";

const HISTORY_KEY = "gsav_search_history";
const MAX_HISTORY = 20;

/**
 * GSAV catalog search (World B): full-text search via the catalog `q` param.
 * Last-write-wins (reqRef) so out-of-order responses can't clobber newer ones.
 * Also keeps a local recent-search history (AsyncStorage, max 20) — the catalog
 * has no suggest endpoint, so "suggestions" surface as recent searches.
 */
export function useGsavSearch() {
  const [results, setResults] = useState<GsavContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const reqRef = useRef(0);

  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setHistory(parsed.filter((entry): entry is string => typeof entry === "string"));
          }
        } catch {
          // ignore corrupt history
        }
      })
      .catch(() => {});
  }, []);

  const pushHistory = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const next = [trimmed, ...prev.filter((entry) => entry.toLowerCase() !== trimmed.toLowerCase())].slice(
        0,
        MAX_HISTORY,
      );
      AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const removeHistory = useCallback((q: string) => {
    setHistory((prev) => {
      const next = prev.filter((entry) => entry !== q);
      AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    AsyncStorage.removeItem(HISTORY_KEY).catch(() => {});
  }, []);

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      reqRef.current++;
      setResults([]);
      setError(null);
      setLoading(false);
      setSearched(false);
      return;
    }
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await gsavCatalog.search(trimmed);
      if (reqId === reqRef.current) {
        setResults(page.videos);
        setSearched(true);
      }
    } catch (e) {
      if (reqId === reqRef.current) setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  }, []);

  return { results, loading, error, searched, search, history, pushHistory, removeHistory, clearHistory };
}
