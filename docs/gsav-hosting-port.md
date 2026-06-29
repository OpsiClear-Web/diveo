# gsav-hosting port: data-saver (web half of diveo `feat/native-feed` 43354b1)

The diveo native commit **43354b1** added a data-saver feature whose native half
(`GsavWebView` appends `?dataSaver=1` to the WebView URL when the "Data saver"
setting is on) is committed in *this* repo. The **web half that honors it** lives
in the sibling **gsav-hosting** app, which is not a git repo in this workspace —
so it is recorded here, against the durable native commit, to keep the two halves
from drifting. Apply these to the real gsav-hosting repo (find → replace; or hand
to an agent), then `npm run type:check && npm run build && npx vitest run`
(verified green: type:check 0, build 0, 106 tests).

Three files: `apps/web/src/native/embedMode.ts`, `apps/web/src/router.tsx`,
`apps/web/src/routes/explore.tsx`.

---

## 1. `apps/web/src/native/embedMode.ts` — add the param parser

Append after the existing `withNativeEmbedSearch` function.

FIND:
```ts
export function withNativeEmbedSearch<TSearch extends Record<string, unknown>>(
    search: TSearch,
    enabled: boolean
): TSearch & { embed: typeof NATIVE_EMBED_VALUE | undefined } {
    return { ...search, embed: enabled ? NATIVE_EMBED_VALUE : undefined };
}
```

REPLACE:
```ts
export function withNativeEmbedSearch<TSearch extends Record<string, unknown>>(
    search: TSearch,
    enabled: boolean
): TSearch & { embed: typeof NATIVE_EMBED_VALUE | undefined } {
    return { ...search, embed: enabled ? NATIVE_EMBED_VALUE : undefined };
}

export const DATA_SAVER_PARAM = 'dataSaver';

/**
 * The native shell signals data-saver mode via ?dataSaver=1 on the WebView URL.
 * Surfaces (e.g. Explore) honor it by skipping autoplay/animation to cut data.
 */
export function parseDataSaverValue(value: unknown): boolean {
    return value === '1' || value === 1 || value === true || value === 'true';
}
```

---

## 2. `apps/web/src/router.tsx` — parse `dataSaver` on the explore route

### 2a. import

FIND:
```ts
import { parseNativeEmbedValue } from './native/embedMode';
```

REPLACE:
```ts
import { parseNativeEmbedValue, parseDataSaverValue } from './native/embedMode';
```

### 2b. explore route `validateSearch` (optional key via spread — making it a
required key breaks `TopNav`'s explore `<Link>`, which doesn't pass it)

FIND:
```ts
    validateSearch: (search: Record<string, unknown>) => ({
        id: typeof search.id === 'string' ? search.id : undefined,
        embed: parseNativeEmbedValue(search.embed)
    }),
    component: lazyRouteComponent(() => import('./routes/explore'), 'ExploreRoute'),
```

REPLACE:
```ts
    validateSearch: (search: Record<string, unknown>) => ({
        id: typeof search.id === 'string' ? search.id : undefined,
        embed: parseNativeEmbedValue(search.embed),
        ...(parseDataSaverValue(search.dataSaver) ? { dataSaver: true as const } : {})
    }),
    component: lazyRouteComponent(() => import('./routes/explore'), 'ExploreRoute'),
```

---

## 3. `apps/web/src/routes/explore.tsx` — honor `dataSaver` (posters, no autoplay)

### 3a. read it from search

FIND:
```tsx
    const { id } = search;
```

REPLACE:
```tsx
    const { id, dataSaver } = search;
```

### 3b. when on, render the poster instead of the live viewer, and don't animate

FIND:
```tsx
                                {isActive ? (
                                    <Suspense fallback={<div className="shortsLoading">Loading scene…</div>}>
                                        <LazyGsavViewer key={video.id} video={video} />
                                    </Suspense>
                                ) : (
                                    <PosterPreview
                                        posterUrl={video.posterUrl}
                                        animatedPosterUrl={video.animatedPosterUrl}
                                        loading="lazy"
                                        animated={!nativeEmbed}
                                    />
                                )}
```

REPLACE:
```tsx
                                {isActive && !dataSaver ? (
                                    <Suspense fallback={<div className="shortsLoading">Loading scene…</div>}>
                                        <LazyGsavViewer key={video.id} video={video} />
                                    </Suspense>
                                ) : (
                                    <PosterPreview
                                        posterUrl={video.posterUrl}
                                        animatedPosterUrl={video.animatedPosterUrl}
                                        loading="lazy"
                                        animated={!nativeEmbed && !dataSaver}
                                    />
                                )}
```

---

## Also pending port (this session, NOT in this doc yet)

Earlier in the same session, public-display **capture-metadata removal** was applied
to gsav-hosting (`routes/explore.tsx` shortsStats, `routes/watch.$id.tsx`,
`components/VideoCard.tsx`, `components/HeroCard.tsx` — drop duration/splats/frames/fps).
Those are independent regions from the data-saver edits above. Ask to have them
added here as find→replace blocks too if they haven't already been ported.
