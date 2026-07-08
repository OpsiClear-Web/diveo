# gsav-hosting port: data-saver (web half of diveo `feat/native-feed` 43354b1)

Historical note: this file is a preserved patch-transfer record for an older
sibling `gsav-hosting` change. It is not the canonical native/web contract.
`gsav-hosting` is now under local git as of
`8c34bca78067f732e09307e4c833038e9637b0b4`; use real hosting SHAs for new
release evidence instead of this patch-transfer note.
Use ADR 0002, `docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md`,
`docs/GSAV_NATIVE_QA.md`, `npm run gsav:runtime-smoke`, and the vendored
`@opsiclear/gsav-bridge` package as the current contract sources.

The diveo native commit **43354b1** added a data-saver feature whose native half
(`GsavWebView` appends `?dataSaver=1` to the WebView URL when the "Data saver"
setting is on) is committed in *this* repo. The **web half that honors it** lives
in the sibling **gsav-hosting** app, which is not a git repo in this workspace —
so it is recorded here, against the durable native commit, to keep the two halves
from drifting. Apply these to the real gsav-hosting repo (find → replace; or hand
to an agent), then `npm run type:check && npm run build && npx vitest run`
(verified green: type:check 0, build 0, 106 tests).

**Part 1 — data-saver** (below): three files — `apps/web/src/native/embedMode.ts`,
`apps/web/src/router.tsx`, `apps/web/src/routes/explore.tsx`. **Part 2 —
capture-metadata removal** (further below): four files. The two parts touch
independent regions (`explore.tsx` appears in both); apply in either order.

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

## Part 2 — capture-metadata removal (public-display cleanup, same session)

Strips technical capture stats (duration / splats / frames / fps) from public
surfaces, keeping titles/authors/descriptions. Four files. Independent regions
from Part 1. Assumes a baseline that still HAS the metadata (a gsav-hosting
checkout without these edits).

### 2A. `apps/web/src/routes/explore.tsx`

Drop the now-unused format import —

FIND:
```tsx
import { isNativeEmbedSearch, withNativeEmbedSearch } from '../native/embedMode';
import { formatCount, formatDuration } from '../utils/format';
```
REPLACE:
```tsx
import { isNativeEmbedSearch, withNativeEmbedSearch } from '../native/embedMode';
```

Drop the `shortsStats` row —

FIND:
```tsx
                                        {video.description && <p>{video.description}</p>}
                                        <div className="shortsStats">
                                            {video.durationSec !== undefined && <span>{formatDuration(video.durationSec)}</span>}
                                            {video.gaussians !== undefined && <span>{formatCount(video.gaussians)} splats</span>}
                                            {video.frames !== undefined && <span>{formatCount(video.frames)} frames</span>}
                                        </div>
                                    </div>
```
REPLACE:
```tsx
                                        {video.description && <p>{video.description}</p>}
                                    </div>
```

### 2B. `apps/web/src/routes/watch.$id.tsx`

Drop the format import —

FIND:
```tsx
import { isNativeEmbedSearch, withNativeEmbedSearch } from '../native/embedMode';
import { formatCount, formatDuration } from '../utils/format';
```
REPLACE:
```tsx
import { isNativeEmbedSearch, withNativeEmbedSearch } from '../native/embedMode';
```

Reduce `detailMeta` to just the author link —

FIND:
```tsx
                        <div className="detailMeta">
                            <CreatorAuthorLink video={video} nativeEmbed={nativeEmbed} />
                            {video.durationSec !== undefined && <span>{formatDuration(video.durationSec)}</span>}
                            {video.gaussians !== undefined && <span>{formatCount(video.gaussians)} splats</span>}
                            {video.frames !== undefined && <span>{formatCount(video.frames)} frames</span>}
                            {video.fps !== undefined && <span>{video.fps} fps</span>}
                        </div>
```
REPLACE:
```tsx
                        <div className="detailMeta">
                            <CreatorAuthorLink video={video} nativeEmbed={nativeEmbed} />
                        </div>
```

### 2C. `apps/web/src/components/VideoCard.tsx`

Drop the format + MaterialIcon imports —

FIND:
```tsx
import { withNativeEmbedSearch } from '../native/embedMode';
import { formatCount, formatDuration } from '../utils/format';
import { MaterialIcon } from './MaterialIcon';
import { PosterPreview } from './PosterPreview';
```
REPLACE:
```tsx
import { withNativeEmbedSearch } from '../native/embedMode';
import { PosterPreview } from './PosterPreview';
```

Drop the thumbnail badges (frame count + duration) —

FIND:
```tsx
                <span className="thumbBadge thumbBadgeLeft">
                    <MaterialIcon name="play_arrow" size={13} fill />
                    {video.frames !== undefined ? formatCount(video.frames) : 'GSAV'}
                </span>
                {video.durationSec !== undefined && (
                    <span className="thumbBadge thumbBadgeRight">
                        <MaterialIcon name="schedule" size={13} />
                        {formatDuration(video.durationSec)}
                    </span>
                )}
            </div>
```
REPLACE:
```tsx
            </div>
```

Drop the splats `cardStat` —

FIND:
```tsx
                <h2>{video.title}</h2>
                <p>{video.author}</p>
                {!compact && video.gaussians !== undefined && (
                    <span className="cardStat">
                        <MaterialIcon name="grain" size={14} />
                        {formatCount(video.gaussians)} splats
                    </span>
                )}
```
REPLACE:
```tsx
                <h2>{video.title}</h2>
                <p>{video.author}</p>
```

### 2D. `apps/web/src/components/HeroCard.tsx`

Drop the format import (keep MaterialIcon — still used by the "Watch" affordance) —

FIND:
```tsx
import { withNativeEmbedSearch } from '../native/embedMode';
import { formatCount, formatDuration } from '../utils/format';
import { MaterialIcon } from './MaterialIcon';
```
REPLACE:
```tsx
import { withNativeEmbedSearch } from '../native/embedMode';
import { MaterialIcon } from './MaterialIcon';
```

Reduce `heroMeta` to just the "Watch" affordance —

FIND:
```tsx
                    <span>
                        <MaterialIcon name="play_arrow" size={15} fill />
                        Watch
                    </span>
                    {video.durationSec !== undefined && <span>{formatDuration(video.durationSec)}</span>}
                    {video.gaussians !== undefined && (
                        <span>
                            <MaterialIcon name="grain" size={15} />
                            {formatCount(video.gaussians)} splats
                        </span>
                    )}
                </div>
```
REPLACE:
```tsx
                    <span>
                        <MaterialIcon name="play_arrow" size={15} fill />
                        Watch
                    </span>
                </div>
```

---

After applying Parts 1 + 2: `npm run type:check && npm run build && npx vitest run`.
Note: `utils/format` itself STAYS — it's still imported elsewhere in the web app
(e.g. `SocialPanel` counts, the `MiniPlayer` playback clock). Only the imports in
these four files are dropped.
