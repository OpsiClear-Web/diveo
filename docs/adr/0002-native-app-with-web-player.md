# ADR 0002 - Native App With Embedded GSAV Web Player

- **Status:** Accepted
- **Date:** 2026-06-30
- **Supersedes:** Runtime and native catalog/product-surface ownership portions
  of `0001-gsav-pivot.md`

## Context

ADR 0001 described a pure WebView shell where gsav-hosting owned all product UI
and diveo owned only native delivery. The live app has moved to a different
shape: React Native now owns the mobile home/feed, search, creator, library,
login, settings, saved-scenes, and follow flows. The hosted web app remains
required for the GSAV renderer and diagnostics because playback depends on
browser APIs that React Native does not provide.

Keeping the docs on the pure-shell model made ownership unclear and caused
drift around `embed=native`, bridge behavior, and catalog/social boundaries.

## Decision

diveo is a native mobile app with an embedded GSAV web player.

React Native owns:

- mobile product navigation and screen composition;
- feed/search/creator/library/login/settings screens;
- native auth/session persistence and saved/follow state;
- WebView lifecycle, origin gating, retry/error UI, Android hardware back;
- deep links into `/watch/:id` and `/gsav/:id`;
- resume state captured from web playback events.

gsav-hosting owns:

- `.gsav` decoding and rendering;
- browser-only playback/runtime concerns;
- native embed behavior when `embed=native` is present;
- diagnostics routes and bridge event emission;
- catalog/social backend contracts shared through packages;
- the public web product when served directly.

Every RN-owned WebView or iframe embed must load gsav-hosting with
`embed=native`. Native may also append `dataSaver=1`.

`/explore` remains an intentional hosted runtime route, not a native catalog
screen. Native Home/Search/Creator/Library own mobile browse and social product
flows; hosted Explore is kept in `features/player/ExploreScreen.tsx` because it
validates gsav-hosting's embed-mode discovery, poster/data-saver behavior, and
runtime chrome suppression. Moving Explore to native catalog ownership requires
an ADR update, route tests, runtime-smoke expectation changes, and import-boundary
allowlist changes.

## Consequences

- The native home is not a WebView route.
- `/explore` is the documented hosted runtime exception to the native browse
  ownership rule.
- `features/player/GsavWebView.tsx` is a player/host adapter, not proof that the
  whole app is a thin wrapper.
- README, QA, preflight, and architecture docs must describe the native-product
  model.
- Native catalog/social code is valid only as a consumer of shared contracts; it
  must not become the canonical catalog schema or CDN URL owner.
- Bilibili-only code remains legacy debt and should be quarantined or deleted
  after the GSAV-native path is validated.

## Validation

Required checks after changes to this boundary:

```bash
npx tsc --noEmit
npm test
npm run lint
npm run verify:import-boundaries
npm run verify:docs-drift
npm run gsav:preflight
npm run gsav:runtime-smoke
```

Publish-candidate changes must also pass `npm run verify:release-readiness`
after the required QA evidence rows are complete. Manual QA must confirm native
browse/social screens render natively, embedded watch/diagnostics routes hide
web chrome, `GSAV_BRIDGE_READY` compatibility is observed, session handoff
works, progress is saved, `GSAV_ENDED` clears stale resume state, and resume
opens a scene near the saved playback time.
