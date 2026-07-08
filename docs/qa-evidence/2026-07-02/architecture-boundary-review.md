# Architecture Boundary Review

Date: 2026-07-02
Reviewer: codex-local-verifier
Candidate SHA: 3d243f51497982d1c741e28d7f6ed2e90c99ba50
Status: local verification pass; not publish validation evidence
Raw verifier output: `docs/qa-evidence/2026-07-02/import-boundaries-2026-07-02.json`

## Scope

This artifact satisfies the WP-1 architecture review requirement before G3. It
does not complete Android/iOS route validation, production host validation,
release dry-run evidence, APK validation, product-journey evidence, or final
publish readiness.

## Verification Summary

- `node scripts/verify-import-boundaries.js` passed at
  `2026-07-02T08:57:16.633Z`.
- Checked source roots: `app`, `features`, `shared`, `services`, `utils`.
- Checked quarantined legacy roots: `components`, `hooks`, `store`.
- Checked classic root entries: `App.js`, `App.jsx`, `App.ts`, `App.tsx`,
  `index.js`, `index.jsx`, `index.ts`, `index.tsx`.
- Expected package main remains `expo-router/entry`.
- Reported violations: none.

## Route Ownership

| Expo route | Feature owner |
| --- | --- |
| `app/_layout` | `features/app-shell/RootLayout` |
| `app/index` | `features/catalog/HomeScreen` |
| `app/search` | `features/catalog/SearchScreen` |
| `app/creator/_layout` | `features/app-shell/CreatorLayout` |
| `app/creator/[handle]` | `features/catalog/CreatorScreen` |
| `app/explore` | `features/player/ExploreScreen` |
| `app/gsav-diagnostics` | `features/player/GsavDiagnosticsScreen` |
| `app/gsav/[id]` | `features/player/GsavScreen` |
| `app/watch/[id]` | `features/player/GsavScreen` |
| `app/library` | `features/social/LibraryScreen` |
| `app/login` | `features/social/LoginScreen` |
| `app/settings` | `features/settings/SettingsScreen` |

All route files are expected to remain export-only adapters. Full scans reject
mapped routes whose adapter files disappear.

## Route Presentation

`features/app-shell/AppStack.tsx` defines explicit stack screens for `index`,
`search`, `explore`, `settings`, `creator`, `gsav`, `gsav-diagnostics`, and
`watch`. `app/library` and `app/login` intentionally use Expo Router default
presentation until an auth/library UX decision requires custom stack options.

## Boundary Decisions

- React Native owns product shell, native browse/search/creator/library/login,
  settings, auth/session handoff, and native navigation.
- `features/player/` is the only native WebView/iframe boundary.
- `../gsav-hosting/apps/web` owns GSAV decode, render, playback, and runtime.
- `/explore` remains the only hosted browse exception for this release.
- Native `/gsav-diagnostics` embeds hosted `/native-diagnostics` as runtime
  tooling, not as a second hosted product shell.
- Same-origin hosted product paths attempted inside the WebView fail closed
  with a nonblank native blocked state for this release.

## Package And Feature Contracts

Approved GSAV package importers:

| Package | Importers | Owner |
| --- | --- | --- |
| `@opsiclear/gsav-bridge` | `features/player/bridgeTypes`, `features/player/sessionBridge`, `scripts/gsav-runtime-smoke-bridge` | `@opsiclear/player` |
| `@opsiclear/gsav-client` | `services/gsav`, `features/social/socialAdapter` | `@opsiclear/services` |

Catalog may compose only the documented social affordances and its
catalog-owned continue-watching presentation: `FollowButton`,
`SaveSceneButton`, and `ContinueWatchingPill`. Continue-watching may access
player-owned progress only through `features/player/resumeAccess`; catalog must
not read social stores, resume stores, bridge state, Supabase clients, or follow
reconciliation rules directly.

## Sibling Allowlist

Current sibling allowlist count: 12.
Current ceiling: 12.
Current expiry for every entry: `2026-07-31`.

This is a ratchet ceiling, not reusable capacity. Touched entries must be
removed, narrowed, or renewed with owner, reason, exit criteria, and expiry.
Post-release target remains reducing or eliminating `ui-composition` entries
where practical and keeping the player resume edge as a narrow access contract.

Per-entry allowlist review:

| From | To | Kind | Target | Owner | Exit criteria |
| --- | --- | --- | --- | --- | --- |
| app-shell | app-update | access-contract | `features/app-update/updateAccess` | @opsiclear/app-shell | Remove when app update checks move into app-shell-owned startup code |
| app-shell | preferences | access-contract | `features/preferences/preferenceAccess` | @opsiclear/preferences | Remove when startup preference hydration no longer runs in the app shell |
| app-shell | social | access-contract | `features/social/(authSession|savedSceneAccess)` | @opsiclear/social | Remove when auth restore and saved-scene preload move behind app-shell-owned bootstrap code |
| catalog | player | access-contract | `features/player/resumeAccess` | @opsiclear/player | Remove when resume state moves behind a shared non-feature contract or catalog no longer surfaces resume |
| catalog | scene | scene-contract | `features/scene/(SceneCard|sceneShare)` | @opsiclear/scene | Remove when scene presentation and sharing move behind a shared non-feature package |
| catalog | social | ui-composition | `features/social/(FollowButton|SaveSceneButton)` | @opsiclear/social | Remove when save and follow affordances move behind narrower action props |
| player | preferences | access-contract | `features/preferences/preferenceAccess` | @opsiclear/player | Remove when embed options are passed to player route roots as props |
| player | social | access-contract | `features/social/authSession` | @opsiclear/social | Remove when bridge session source moves into the bridge package or player-owned access contract |
| settings | app-update | access-contract | `features/app-update/updateAccess` | @opsiclear/settings | Remove when update status becomes settings-owned or moves behind a shared app contract |
| settings | preferences | access-contract | `features/preferences/preferenceAccess` | @opsiclear/preferences | Remove when settings owns preference editing or receives preference actions as props |
| settings | social | access-contract | `features/social/authSession` | @opsiclear/social | Remove when account status and sign-out move behind a shared account contract |
| social | scene | scene-contract | `features/scene/(SceneCard|sceneShare|sceneTypes)` | @opsiclear/scene | Remove when saved-scene rendering moves behind a social-owned scene facade |

## Degraded Player ID Decision

Missing or blank scene IDs use a nonblank native `Scene unavailable` state, and
progress hydration shows a visible preparing state. Unknown-but-present scene
IDs are still hosted-player behavior and require Android/iOS route evidence if
they become release-relevant.

## Validation Limits

This review is local source-structure proof only. Publish remains
`decision=no-publish` until the external G3-G7 evidence lands and final
`verify:final-readiness-receipts` passes with reviewed inventory and reviewed
device packet inputs.
