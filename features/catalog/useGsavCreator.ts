import { useEffect, useState } from "react";

import { formatGsavCatalogError } from "../../shared/gsavErrors";
import { loadCreatorCatalog, type GsavContentItem, type GsavCreator } from "./catalogAdapter";

/**
 * Native GSAV creator profile: one catalog call filtered by `channel` returns
 * the creator's scenes plus the creator record.
 */
export function useGsavCreator(handle: string) {
  const [creator, setCreator] = useState<GsavCreator | null>(null);
  const [videos, setVideos] = useState<GsavContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const page = await loadCreatorCatalog(handle);
        if (!active) return;
        setVideos(page.videos);
        setCreator(page.creators.find((c) => c.handle === handle || c.id === handle) ?? page.creators[0] ?? null);
      } catch (e) {
        if (active) setError(formatGsavCatalogError(e, "Failed to load creator."));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [handle]);

  if (!handle) return { creator: null, videos: [], loading: false, error: null };
  return { creator, videos, loading, error };
}
