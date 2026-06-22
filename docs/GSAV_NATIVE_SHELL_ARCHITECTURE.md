# diveo Native Shell — Architecture

How the diveo React Native app delivers the GSAV 4DGS experience. diveo follows
**"World A"**: the **gsav-hosting** web app is the product and owns ALL user-facing UI
(home, browse, watch, and the 4DGS player); the React Native app is a thin **native
client** that wraps it. On the web, the product simply *is* gsav-hosting.

- **GSAV** = the codec / `.gsav` format / wire protocol (technical, stays "GSAV").
- **diveo** = the product / app (user-facing).
- Decision history: [`docs/adr/0001-gsav-pivot.md`](adr/0001-gsav-pivot.md).
- Cross-repo contract: [`GSAV_4DGS_HOSTING_IMPLEMENTATION_CHECKLIST.md`](../GSAV_4DGS_HOSTING_IMPLEMENTATION_CHECKLIST.md).

## Why a WebView at all

The 4DGS player is browser technology — WebGL/WebGPU + Web Workers + WebCodecs,
shipped as gsav-hosting. React Native's runtime has none of those APIs, so there is no
native renderer: the only way a phone runs this player is inside a browser engine. The
native client embeds one via `react-native-webview`. (A from-scratch native renderer
would mean reimplementing both the splat renderer on expo-gl/WebGPU AND a
non-WebCodecs/non-WASM decoder — an SDK-scale project, deliberately not taken.)

## Ownership boundary

```
  diveo native client (this repo)           gsav-hosting (../gsav-hosting)
  ──────────────────────────────            ──────────────────────────────
  • WebView host + lifecycle                • THE app: home, browse, watch, player
  • origin allowlist / trust gate           • .gsav decoding & rendering
  • Android hardware-back → WebView         • scene catalog, CDN/R2 URLs
  • deep links by scene id                  • account/entitlement (future)
  • self-updater (Android APK)              • owns ALL UI, navigation, playback

  Rule: the shell owns NO content UI and NO catalog. It loads the full hosted app
  ({origin}/ … /watch/:id) and lets gsav-hosting drive everything in-WebView.
```

## Platform delivery

| Target | How the player is delivered |
|---|---|
| iOS / Android | native client → `react-native-webview` embeds the full gsav-hosting app |
| Web (`expo start --web`, :8081) | **dev preview only** — a full-screen `<iframe>` of gsav-hosting |
| Web (production) | **gsav-hosting served directly** is the web product (no RN-web shell ships) |

## Component map

| File | Role |
|---|---|
| `components/GsavWebView.tsx` | native host: trust-gated WebView of the full app, loading/error, hardware-back |
| `components/GsavWebView.web.tsx` | web preview: full-screen `<iframe>` of the hosted app |
| `components/GsavScreen.tsx` | shared screen for the `/watch/:id` + `/gsav/:id` deep links |
| `app/index.tsx` | root — loads gsav-hosting's home (`/`) in the WebView |
| `app/watch/[id].tsx`, `app/gsav/[id].tsx` | deep-link route re-exports |
| `app/gsav-diagnostics.tsx` | diagnostics route (loads a hosted diagnostics page) |
| `utils/gsavBridge.ts` | pure helpers: origin/URL helpers, the navigation trust gate, `buildGsavWatchPath` |
| `hooks/useCheckUpdate.ts` | in-app APK self-updater (Android), checked silently on launch |

## WebView trust model

The shell loads the FULL hosted app, so navigation must stay inside the configured
origin. One fail-closed gate; an unconfigured/malformed origin renders a "diveo not
configured" panel instead of loading anything.

```
 configured origin: https://gsav.example   (getConfiguredGsavWebUrl → getOrigin)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ WebView (originWhitelist = [allowedOrigin], mixedContentMode=never*)   │
 │                                                                        │
 │  NAVIGATION GATE  onShouldStartLoadWithRequest                         │
 │    isAllowedGsavNavigation(url, allowedOrigin)                         │
 │      ├─ https://gsav.example/...       → ALLOW (exact origin match)    │
 │      ├─ https://evil.example/x         → BLOCK → Linking.openURL       │
 │      └─ about: / javascript: / empty   → BLOCK (no origin, fail-closed)│
 └──────────────────────────────────────────────────────────────────────┘
 * mixedContentMode: "never" in production, "compatibility" only in __DEV__.
```

## Native ↔ web bridge (dormant)

World A loads the full hosted app **without** `?embed=native`, so gsav-hosting renders
its own chrome and the native shell neither sends commands nor consumes bridge
messages. The typed bridge protocol (`reduceBridgeEvent`, `buildNativeCommandScript`,
message/version helpers in `gsavBridge.ts`) and its unit tests **remain in the repo but
are unused by app code** — kept only because they are still test-covered. Removing the
dead bridge infra is a tracked follow-up (below).

## Release / distribution pipeline

Sideloaded APK via GitHub Releases (not the Play Store). `release.yml` runs on push to
master and is gated so a broken or misconfigured build can never publish.

```
 push to master
   │
   ├─► quality.yml (reusable)      tsc · vitest · lint(diveo surface)   ── must pass
   │
   └─► release  (needs: quality, gate)
         gate: GSAV_WEB_URL set?  ── no → release SKIPPED (stays green)
                                  ── yes ▼
         verify-native-production-config   (https, non-local origin, no creds)
         expo prebuild → gradlew assembleRelease
         verify artifact:  bundle contains the configured origin
                           merged manifest usesCleartextTraffic=false
         bump version → commit [skip ci] → gh release create (APK)
```

Defense in depth against shipping a localhost/dev player: (1) `app.config.js` forces
`usesCleartextTraffic=false` in prod, (2) `getConfiguredGsavWebUrl` returns `null`
(fail-loud panel) in prod when unset, (3) the release gate + artifact check above.

## Testing

Pure logic is unit-tested (`utils/*.test.ts`, `scripts/*.test.mjs`, `app.config.test.mjs`).
Component-level render tests (react-native-testing-library) are not yet set up — the RN
render harness under vitest is the remaining test-infra gap.

## Follow-ups (World A cleanup)

- **Remove the dead native↔web bridge infra** (`reduceBridgeEvent`, command/version
  helpers, the `?embed=native` builder) and their tests, now that the shell wraps the
  full app rather than driving a chrome-less player.
- **Delete the frozen Bilibili legacy** (video / live / search / downloads / creator
  screens + their stores, `MiniPlayer` / `LiveMiniPlayer`) — unreachable under World A.
- **Web production embedding**, if ever wanted in-shell, needs same-origin hosting or
  gsav-hosting's CSP `frame-ancestors` to include the shell origin. Otherwise the web
  product is simply gsav-hosting served directly.
