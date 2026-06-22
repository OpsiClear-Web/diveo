# diveo — Remaining Gaps Plan

Goal: take the diveo native shell from "wired but nothing to point at" to a **complete,
tested, shippable product**. Scope is *closing gaps in the current shell*, not building
the platform features (tiering / embed / supply motion) — those are the separate product
roadmap in `~/.gstack/projects/.../ceo-plans/2026-06-21-gsav-4d-platform.md`.

Legend: 👤 owner-only · ⛔ external (gsav-hosting) · 🛠 in-repo (buildable now) · 🔗 depends on.
Effort: human-team / with Claude Code.

## Gap inventory

| ID | Gap | Who | Effort | Blocked by |
|----|-----|-----|--------|-----------|
| G1 | Deploy gsav-hosting prod origin (HTTPS, byte-range, CORS) + set `GSAV_WEB_URL` secret (P2-4) | ⛔👤 | — / — | external |
| G2 | Rotate the leaked Sentry token (P0-1) | 👤 | 10 min | — |
| G3 | Real launcher — replace hard-coded `/watch/test` with a configurable default scene + deep-link entry, NOT a catalog (P3-3) | 🛠 | ~1 day / ~20 min | — (validation 🔗G1) |
| G4 | GSAV resume/persistence — persist `{videoId, progressPercent, currentTime}`, pass `startTime` on mount (P4-6) | 🛠 | ~0.5 day / ~15 min | — |
| G5 | GsavWebView render tests — RN test harness + render/interaction tests (T11) | 🛠 | ~1 day / ~30 min | — |
| G6 | expo-router type-gen in CI before `tsc` (P1-5) | 🛠 | ~0.5 day / ~15 min | — |
| G7 | Remove route `as any` casts (P3-4) | 🛠 | ~1 hr / ~10 min | 🔗G6 |
| G8 | Coverage gate in CI (threshold on `utils/`) (P1-3) | 🛠 | ~1 hr / ~10 min | — |
| G9 | Delete the frozen Bilibili legacy (T12) | 🛠 | ~1 day / ~30 min | 🔗G1, G3 validated, `legacy-final` tag |
| G10 | Rename local working folder `JKVideo` → `diveo` | 👤 | 2 min | — |
| G11 | (optional) Scrub the leaked token from git history (P0-3) | 👤 | — | 🔗G2; risky |

## Critical path

```
 G1 (deploy origin + GSAV_WEB_URL) ─────┬─► validates G3 launcher ─┐
   └─ flips release skip → publish      │                          ├─► G9 delete legacy
 G2 (rotate token) ── independent       │                          │   (+ legacy-final tag,
                                        │                          │    validate on preview)
 G3 (real launcher) ────────────────────┘                          │
 G4 (resume)        ── independent, now                             │
 G6 (type-gen) ─► G7 (drop casts)  ── independent, now              │
 G5 (render tests) ── independent, now                             │
 G8 (coverage gate) ── independent, now                            │
```

Everything in the 🛠 lane (G3-G8) can proceed now, in parallel, without waiting on the
owner/external items. G9 is last and gated.

## Phase 1 — Shell completeness (🛠 now)

- **G3 Real launcher.** Add `EXPO_PUBLIC_DEFAULT_SCENE` (fallback to `"elly"`, not `"test"`);
  `GsavHomeEntry` opens that scene; keep deep-link entry via `buildGsavWatchPath`. Stays a
  launcher, not a catalog (the boundary in ADR-0001).
  - ✅ `app/index.tsx` no longer hard-codes `/watch/test`; opens the configured default;
    deep links (`/watch/:id`, `/gsav/:id`) still resolve; unit test for the scene resolver.
- **G4 Resume/persistence.** New `store/gsavProgressStore` (mirror `playProgressStore`);
  `GsavWebView` persists snapshot on `GSAV_PROGRESS`/`GSAV_PLAYBACK_STATE`, reads it on mount,
  passes `startTime` into `buildGsavWatchPath`.
  - ✅ re-opening a scene resumes near last position; survives unmount; store unit-tested.

## Phase 2 — Test + type completeness (🛠 now)

- **G6 type-gen → G7 casts.** Add an expo-router type-generation step before `tsc` in
  `quality.yml`; then remove the route `as any` casts in `app/index.tsx` (+ any others).
  - ✅ `router.push('/does-not-exist')` fails `tsc` in CI; `git grep -c 'router\.\(push\|replace\|navigate\).*as any'` == 0.
- **G5 render tests.** Stand up an RN component-test harness (jest-expo, or vitest + RN
  preset) and cover `GsavWebView`: not-configured panel, load error → retry, bridge-error
  banner, theme sync. (The pure logic is already covered via `reduceBridgeEvent`.)
  - ✅ component render tests pass in CI.
- **G8 coverage gate.** Add a coverage threshold (start ~80% lines on `utils/`) to the CI
  test step using the already-installed `@vitest/coverage-v8`.
  - ✅ CI fails when `utils/` line coverage drops below the committed baseline.

## Phase 3 — Owner / external unblockers (👤⛔)

- **G1** deploy gsav-hosting + set `GSAV_WEB_URL` → playback runs end-to-end, release flips
  skip→publish, G3 launcher is validated on a device. ✅ `npm run verify:native-production-config`
  green with the build env; release publishes; a scene plays on a physical device.
- **G2** rotate the Sentry token. ✅ old token returns `401`; new token stored as GH secret.
- **G10** rename the local folder. **G11** optional history scrub (only after G2).

## Phase 4 — Legacy retirement (🛠, gated)

- **G9** delete the Bilibili surface once G1 is live and G3 is validated on `preview`:
  tag `legacy-final` first; delete `app/{video,live,creator,downloads,search}`,
  `services/bilibili.ts` + Bilibili-only stores/hooks/components, the mini-player mounts,
  the `bilibili` scheme; prune dead deps (`react-native-video`, `pako`,
  `react-native-static-server`, `react-native-qrcode-svg`, `react-native-pager-view`,
  re-audit `expo-clipboard`); delete legacy tests/fixtures.
  - ✅ app boots to diveo; `tsc` green; `npx depcheck` clean; no dangling imports.

## Definition of done (whole plan)

1. App opens to a real diveo entry point (no `/watch/test` placeholder).
2. A scene plays end-to-end on a physical device from a release APK (needs G1).
3. `tsc` + `vitest` (incl. GsavWebView render tests) + `lint` + coverage gate all green in CI;
   typed routes enforced (no route `as any`).
4. Release pipeline publishes a real APK (skip→publish once G1 lands).
5. Sentry token rotated; legacy Bilibili surface deleted; app is diveo-only.

## Not in this plan (separate roadmap)
- Platform features: public/private tiering, default-publish, embeddable player + attribution,
  per-scene visibility, public-creator supply motion (see the CEO plan).
- Bridge command UI for `pause`/`seek`/`loadScene`/etc. — forward-compat vocabulary; wire only
  if the shell needs those controls (the web player owns playback controls today).
