# diveo Native + Web Player Architecture

diveo is no longer a pure WebView wrapper. The current product architecture is a
native mobile app that embeds the GSAV web runtime only where browser APIs are
required.

## Ownership Boundary

| Area | Owner |
| --- | --- |
| Mobile home/feed, search, creator, library, login, settings | `diveo` React Native |
| Native navigation, Android back handling, retry/error panels, APK updater | `diveo` React Native |
| Saved/follow state and auth persistence | `diveo` over the shared GSAV Supabase/client packages |
| `.gsav` decode/render/playback runtime | `../gsav-hosting/apps/web` |
| Web-player chrome suppression, diagnostics, runtime bridge event emission | `../gsav-hosting/apps/web` in native embed mode |
| Public web product | `../gsav-hosting/apps/web` served directly |

The native app may consume catalog/social APIs through shared packages, but it
does not own the catalog schema, CDN/R2 URLs, decoder, or renderer.

## Route Ownership Contract

`app/` files are Expo Router adapters only. They should be a single default
re-export of the mapped feature-owned screen or layout, with no business logic,
data fetching, WebView setup, or bridge handling. The enforced route owner map lives in
`scripts/verify-import-boundaries.js` and is the source of truth for route
ownership reviews.

`features/app-shell/AppStack.tsx` is a stack-option surface, not a complete
ownership manifest. Routes that need custom transitions or gestures can appear
there; routes that use default stack behavior may be discovered by Expo Router
without a matching `Stack.Screen` entry. If a future change makes `AppStack` the
canonical route manifest, add every route there first and extend
`npm run verify:import-boundaries` to check it.

`/explore` is the only release-scoped hosted browse exception. It remains in
`features/player` because it validates gsav-hosting embed-mode discovery and
chrome suppression. Native Home, Search, Creator, Library, Login, and Settings
stay React Native-owned product routes.

## Route Taxonomy And Navigation Outcomes

Use this taxonomy when reviewing route changes:

| Route type | Examples | Owner | Expected behavior |
| --- | --- | --- | --- |
| Expo route adapters | `app/index.tsx`, `app/search.tsx`, `app/watch/[id].tsx` | React Native feature screens | Export-only adapters to mapped feature owners; no fetching, WebView setup, or bridge logic |
| Native product routes | `/`, `/search`, `/library`, `/creator/:handle`, `/login`, `/settings` | React Native | Render native browse, auth, saved, and settings surfaces without hosted web chrome |
| Native player aliases | `/watch/:id`, `/gsav/:id?t=<seconds>` | `features/player/GsavScreen.tsx` | Build the hosted watch path and append `embed=native`; `/gsav/:id` is a native deep-link alias for `/watch/:id` |
| Hosted embed routes | `/watch/:id`, `/explore`, `/native-diagnostics` | `../gsav-hosting/apps/web` in native embed mode | May remain inside the WebView only when same-origin and native embed rules pass |
| Native diagnostics route | `/gsav-diagnostics` | React Native route adapter plus `features/player/GsavDiagnosticsScreen.tsx` | App-facing route embeds hosted `/native-diagnostics`; same-origin hosted `/gsav-diagnostics` is blocked unless gsav-hosting adds a reviewed redirect contract |
| Legacy Bilibili/proxy/DASH paths | Historical proxy, DASH, static-server, or Bilibili surfaces | Frozen legacy | Removal, quarantine, or safety fixes only; do not add new route ownership for this release |

Blocked WebView navigation must have an explicit product outcome:

| Attempted URL | Outcome |
| --- | --- |
| Same-origin hosted player route in the allowlist with exactly one `embed=native` marker | Stay embedded |
| Native-owned hosted path such as `/`, `/creator/*`, `/account/*`, `/studio`, `/upload`, `/watchlist`, or `/explore-preview` | Fail closed with a nonblank native blocked state for this release; future native handoff requires ADR 0002, `features/player/nativeNavigation.ts`, focused tests, QA rows, and Android/iOS evidence in a no-publish pass |
| External `http(s)` origin | Block WebView navigation and open externally only through the native external-link path |
| Invalid, non-HTTP, or malformed URL | Block and keep the user in a nonblank native state |

`features/player/nativeNavigation.ts` is the current navigation decision point.
If the product outcome changes, update ADR 0002, focused navigation tests, this
taxonomy, the same-origin handoff policy in the implementation plan, and
Android/iOS negative evidence requirements together.

## Why WebView Still Exists

The GSAV player depends on browser APIs such as WebGL/WebGPU, Workers, and
WebCodecs. React Native does not provide those APIs, so mobile playback embeds
the hosted web runtime through `react-native-webview`. Reimplementing that stack
inside native code is intentionally out of scope.

## Embedded Route Contract

Every RN-owned web embed loads the configured GSAV web origin with
`embed=native`. This tells gsav-hosting to hide desktop web chrome and enable the
native bridge.

Examples:

- `/watch/elly` -> `${EXPO_PUBLIC_GSAV_WEB_URL}/watch/elly?embed=native`
- `/watch/elly?t=12` -> `${EXPO_PUBLIC_GSAV_WEB_URL}/watch/elly?t=12&embed=native`
- data saver -> append `dataSaver=1`

Only these hosted paths may remain inside the embedded player boundary:

| Hosted path | Native route owner |
| --- | --- |
| `/watch/:id` and `/watch/:id?t=<seconds>` | `features/player/GsavScreen.tsx` |
| `/explore` | `features/player/ExploreScreen.tsx` as the release-scoped hosted browse exception |
| `/native-diagnostics` | `features/player/GsavDiagnosticsScreen.tsx`, reached from the app-facing `/gsav-diagnostics` route |

Same-origin hosted product paths fail closed with a nonblank native blocked
state for this release. Future native handoff requires ADR 0002,
`features/player/nativeNavigation.ts`, focused tests, QA rows, and Android/iOS
evidence in a no-publish pass.

Same-origin hosted product paths such as `/`, `/creator/*`, `/creators`,
`/account/*`, `/studio`, `/upload`, `/watch`, `/watchlist`, and
`/explore-preview` must not stay embedded in the player shell. They fail closed
with a nonblank native blocked state for this release. Future native
handoff requires ADR 0002, `features/player/nativeNavigation.ts`, focused
tests, QA rows, and Android/iOS evidence in a no-publish pass. Cross-origin
links are the external-browser case; same-origin product paths are not opened as
generic external links from the embedded shell.

`EXPO_PUBLIC_GSAV_WEB_URL` must point at the hosted GSAV web app. Development
falls back to `http://127.0.0.1:5191` for host-side checks and iOS simulator
runs. Android emulator validation must set `EXPO_PUBLIC_GSAV_WEB_URL` to a
reachable target such as `http://10.0.2.2:5191`; physical devices need the host
LAN URL. Production builds fail closed when the origin is missing or invalid.
Production config verification also requires
`EXPO_PUBLIC_GSAV_CATALOG_URL`, `EXPO_PUBLIC_GSAV_SUPABASE_URL`, and
`EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY` for the native catalog/social surfaces.

## Component Map

| File | Role |
| --- | --- |
| `features/player/GsavWebView.tsx` | Trust-gated native WebView presenter for embedded GSAV routes |
| `features/player/useGsavEmbedHost.ts` | Native WebView controller for lifecycle, bridge/session, progress, retry, QA, and Android back behavior |
| `features/player/gsavEmbedNavigationRequest.ts` | Pure request-level navigation policy for allowed embeds, fail-closed same-origin routes, external handoff, and QA probes |
| `features/player/GsavWebView.web.tsx` | Expo web preview using an iframe with the same embed contract |
| `features/player/GsavScreen.tsx` | Shared `/watch/:id` and `/gsav/:id` route logic, including resume time |
| `features/player/resumeAccess.ts` | Narrow resume state/action contract over player-owned playback progress for native product surfaces |
| `features/catalog/ContinueWatchingPill.tsx` | Catalog-owned native continue-watching presentation backed by `features/player/resumeAccess.ts` as the narrow resume state/action contract |
| `features/player/ExploreScreen.tsx` | Intentional hosted runtime Explore route embedded in native mode |
| `features/player/GsavDiagnosticsScreen.tsx` | Hosted diagnostics route embedded in native mode |
| `app/*` | Expo Router adapters only; route bodies live under `features/*` |
| `features/app-shell/*` | Root bootstrap, Sentry, fonts, providers, startup effects, and route stack composition |
| `features/preferences/*` | Preference hydration and editing for dark-mode/data-saver settings; UI theme reads use `shared/themeContext.tsx` |
| `features/player/*` | URL, route, trust-gate, session, WebView/iframe host, resume access, and bridge helpers |
| `features/catalog/*` | Native feed, search, creator hooks, catalog adapters, continue-watching presentation, and composition of `features/scene` presentation plus social affordances |
| `features/social/*` | Native auth, saved-scenes state, saved-scene lookup, and follow/social hooks over shared Supabase contracts |
| `features/scene/*` | Shared scene presentation, scene item typing, and share helpers |
| `features/settings/*` | Settings screen and cache controls |
| `features/app-update/*` | Android APK update check and install flow |
| `shared/*` | Cross-feature theme/accent tokens, GSAV route/config helpers, and UI primitives such as the brand lockup |
| `utils/*` | Pure generic helpers only |
| `services/gsav.ts` | Catalog-facing adapter over the shared GSAV client package |
| `services/supabase.ts` | Native Supabase session client for social features |
| `features/social/socialAdapter.ts` | Social-facing saved/follow facade over the shared GSAV client package |

## Shared Helper Ownership

`shared/gsavRoutes.ts` owns pure public watch-path construction such as
`/watch/:id?t=<seconds>`. `shared/gsavWeb.ts` owns origin/config helpers. Player
code owns `GsavEmbedRoute` validation, native embed URL construction, and
WebView trust decisions. `GsavWebView` callers must use player-owned
constants/factories or route builders, not arbitrary strings. Do not re-export
shared route/config helpers through a player facade; import the shared helper
directly when the caller needs route/config behavior, and use `features/player`
only for embedded player behavior.

## Bridge Contract

The bridge is active for embedded routes:

- Native mounts embedded routes only after settings restore and auth
  initialization complete, so data saver and session state are stable on first
  load.
- Native sends the Supabase session when gsav-hosting emits `GSAV_AUTH_READY`.
- Web emits playback/progress/end events so native can persist resume state.
- Navigation remains origin-gated by `isAllowedGsavNavigation`; inbound bridge
  messages are origin-checked where the WebView reports a URL.
- The gate allows the hosted diagnostics page `/native-diagnostics` because
  `features/player/GsavDiagnosticsScreen.tsx` embeds that path from the native
  `/gsav-diagnostics` route. It does not allow a hosted `/gsav-diagnostics`
  page to remain embedded.

Bridge ownership is split across the runtime, the package contract, and the
native host:

| Owner | Responsibility |
| --- | --- |
| `@opsiclear/gsav-bridge` | Canonical session, native command, event, payload, and bridge-version wire contracts |
| `../gsav-hosting/apps/web` | Runtime bridge events, diagnostics messages, playback state, and native embed behavior |
| `diveo` React Native | WebView lifecycle, origin validation, session/native command sending, reducer state, and resume persistence |

Bridge messages are versioned JSON objects. The current native bridge version is
`1`; native accepts web bridge versions whose supported range overlaps the
native range.

| Group | Direction | Message types | Required version fields | Owner |
| --- | --- | --- | --- | --- |
| Auth readiness | web to native | `GSAV_AUTH_READY` | `bridgeVersion` | `@opsiclear/gsav-bridge` |
| Session handoff | native to web | `GSAV_SET_SESSION`, `GSAV_CLEAR_SESSION` | `bridgeVersion` | `@opsiclear/gsav-bridge` |
| Native commands | native to web | `GSAV_COMMAND` with `loadScene`, `play`, `pause`, `destroy` payloads | `bridgeVersion` | `@opsiclear/gsav-bridge` plus `features/player/bridgeState.ts` |
| Bridge readiness | web to native | `GSAV_BRIDGE_READY` | payload `version` and `minVersion` | `../gsav-hosting/apps/web` plus `@opsiclear/gsav-bridge` |
| Playback readiness | web to native | `GSAV_READY`, `GSAV_CAPABILITIES` | covered by `GSAV_BRIDGE_READY` compatibility | `../gsav-hosting/apps/web` |
| Playback progress | web to native | `GSAV_PROGRESS`, `GSAV_FRAME`, `GSAV_FIRST_FRAME`, `GSAV_PLAYBACK_STATE` | covered by `GSAV_BRIDGE_READY` compatibility | `../gsav-hosting/apps/web` |
| Playback terminal/error | web to native | `GSAV_PLAY`, `GSAV_PAUSE`, `GSAV_ENDED`, `GSAV_ERROR` | covered by `GSAV_BRIDGE_READY` compatibility | `../gsav-hosting/apps/web` |
| Diagnostics/navigation | web to native | `GSAV_ROUTE_CHANGE` and diagnostics capability payloads | covered by `GSAV_BRIDGE_READY` compatibility | `../gsav-hosting/apps/web` |

Malformed JSON and untyped messages are ignored. Unknown typed events are
preserved as no-op reducer events for forward compatibility, but incompatible
or missing `GSAV_BRIDGE_READY` version data surfaces a native bridge mismatch
error instead of silently accepting the runtime.

Bridge messages must not perform catalog CRUD, social writes, upload
finalization, moderation, or backend administrative work. Those actions belong
to shared client contracts and Supabase-backed service adapters, not to the
embed bridge.

The command/status reducer helpers now live in `features/player/bridgeState.ts`
and bridge/session helpers live under `features/player/`. Do not reintroduce a
deleted bridge compatibility barrel under `utils/`.

## Verification

Run these after changing the native/web boundary:

```bash
npx tsc --noEmit
npm test
npm run test:coverage
npm run lint
npm run verify:dependency-audit
npm run verify:import-boundaries
npm run verify:docs-drift
npm run verify:native-production-config
npm run gsav:preflight
npm run gsav:runtime-smoke
```

For local config verification, provide production-safe HTTPS placeholder values
for the GSAV web, catalog, Supabase URL, and Supabase anon key variables. Running
the verifier without those values should fail.

Manual smoke validation must confirm the core boundary below. It is not the
full release route matrix; publish validation must use
`docs/GSAV_NATIVE_QA.md` for `/`, `/search`, `/library`, `/creator/:handle`,
`/explore`, `/gsav-diagnostics`, `/watch/:id`, `/gsav/:id`, Android/iOS
WebView coverage, negative cases, and artifact evidence.

- Native browse/search/library screens still route into `/watch/:id`.
- Embedded player routes hide gsav-hosting desktop chrome.
- `dataSaver=1` reaches gsav-hosting when native data saver is enabled.
- Progress events persist and resume playback time.
- Android hardware back traverses WebView history before leaving the route.

## Follow-Ups

- Keep `/explore` as an intentional hosted runtime route unless product discovery
  requirements justify a new ADR, native route tests, and runtime-smoke updates.
- Keep canonical bridge event/command/version wire contracts in
  `@opsiclear/gsav-bridge`. Diveo should own reducers, persistence, origin
  gates, injected-script composition, and WebView lifecycle only; release
  validation still needs fresh diagnostics/watch bridge evidence.
- Shrink or justify remaining catalog/social/player composition exceptions in
  the import-boundary allowlist. Scene sharing now uses shared route/config
  contracts instead of player internals.
- Validate release artifacts with a real APK, merged manifest, production
  `.gsav` range probe, and generated versionCode evidence before publishing.
