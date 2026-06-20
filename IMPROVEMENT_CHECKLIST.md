# JKVideo Improvement Checklist

> Tracker for [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md). IDs match the plan. Check the task box only when its nested **✅ acceptance** check passes.
>
> **Legend:** 👤 needs a human (not code) · 🔗 has a dependency · ⛔ externally blocked · ⭐ quick win (front-load) · ⚠️ high-risk · 🔀 DG-1-conditional

---

## Implementation status — 2026-06-20 · branch `chore/maintainability-improvements`

Landed this pass (8 commits; `tsc --noEmit` clean, **61 vitest tests green**, not pushed):

- [x] **P0-2** secret hygiene — `eas.json` token → `$SENTRY_AUTH_TOKEN`, `.env` untracked, `.env.example`, gitignore (+`docs/adr` exception). _(P0-1 rotation still owner-only.)_
- [x] **P0-4** baseline — entire GSAV surface + pending work committed via explicit allowlist (planning docs kept separate).
- [x] **P4-3** credential fix — SESSDATA via `getSecure`; **buvid3 stays AsyncStorage** (correction: routing buvid3 through `getSecure` would have broken native downloads).
- [x] **P6-9** remove unused `expo-av`.
- [x] **P3-2** route de-dup — shared `components/GsavScreen`; `/gsav` alias preserved; `firstParam`→`gsavBridge` (+test).
- [x] **P6-6** `getConfiguredGsavWebUrl` loud-warn guard (+test; treats `""` as unset).
- [x] **P1-4** golden tests — wbi/dash/cache, 32 cases (authored via 3-agent workflow).
- [x] **P2-2/P2-3/P2-5/P2-6/P2-1/P2-7/P6-5a** docs — README contradiction fixed + en frozen notice + structure map; dropped `bilibili` scheme; deduped permissions; CHANGELOG 1.0.16–1.0.19; CONTRIBUTING language policy; ADR 0001 (Proposed) + catalog-ownership contract.
- [x] **P1-1/P1-3** `ci.yml` (tsc + test required; lint/coverage = TODO). **P0-5a-i** `release.yml` prod env (cleartext off) + advisory verifier.

Deferred (reason):
- **P0-1** 👤 rotate token in Sentry dashboard · **DG-1** 👤 flip ADR to Accepted + set deletion date.
- **P0-3** ⚠️ `git filter-repo` not installed; rotation is the real fix — optional.
- **P2-4/P0-5b** ⛔ need `../gsav-hosting` prod HTTPS origin + `GSAV_WEB_URL`/Sentry secrets.
- **P1-5 + P3-4** no clean headless expo-router type-gen (typedRoutes already on); cast removal unverifiable until type-gen runs in CI.
- **P1-2** lint enforcement needs eslint config · **P6-2** bridge union's catch-all arm defeats clean narrowing · **P6-7** needs jsdom + navigator mocks.
- **P5-5a / P4-5 / P3-1 / P4-6 / P3-3 / P4-1·2·4 / P5-3·5b / P6-1·3·4 / P6-5b** — legacy-investment pre-DG-1, DG-1-gated, or high-risk (per the plan's guiding principle).

> Review the branch, then `git push -u origin chore/maintainability-improvements` and open a PR.

---

## Implementation status — 2026-06-20 (pass 2: /plan-eng-review + Codex outside voice)

Decisions locked: **freeze Bilibili** (no investment; delete pre-public), **invest in
the GSAV shell**. Landed + verified this pass (`tsc --noEmit` clean, **84 vitest tests green**):

- [x] **T1** GSAV WebView trust boundary — allowlist-positive nav gate + message-origin
  trust gate (`isAllowedGsavNavigation` / `isTrustedBridgeOrigin` in `gsavBridge`),
  `mixedContentMode:'never'` in prod, external links via `Linking`; unit-tested.
- [x] **T3** fail-loud prod URL — `getConfiguredGsavWebUrl` returns `null` in production
  (no localhost fallback); shell renders a "GSAV not configured" panel; test updated.
- [x] **T4** exhaustive GSAV unit coverage + a **direct** `app.config.js` cleartext-flip test.
- [x] **T5** bridge contract fixes — `GSAV_FIRST_FRAME` payload type aligned; empty `sceneId` rejected.
- [x] **T6** dropped `RECORD_AUDIO`; kept `REQUEST_INSTALL_PACKAGES` (self-updater) + `MODIFY_AUDIO_SETTINGS`.
- [x] **T7** ADR → `Accepted` (Option A) with deletion gate + MIT-public hard trigger + permission rationale.
- [x] **T8** secret-history scan — only the known Sentry token present (no other secrets).
- [x] **T2** release pipeline — gated via reusable `quality.yml` (`needs:`); reordered to
  build → verify artifact (configured origin baked, cleartext off) → bump/commit/Release;
  refuses to publish when `GSAV_WEB_URL` is unset. **(YAML validated; needs a real CI run to verify end-to-end.)**

Still owner/external:
- **T9** 👤 rotate the Sentry auth token (hygiene only — repo stays private and only the APK ships; the token is build-time, never bundled. Rotate when convenient; no history scrub).
- **T12** 🔀 delete the Bilibili client — gated on GSAV prod origin live + launcher validated on `preview`.
- **P2-4** ⛔ set the `GSAV_WEB_URL` secret (needs `../gsav-hosting` origin) — releases are intentionally blocked until then.

---

## Decisions & owner actions (do these to unblock the rest)

- [ ] 👤 **P0-1 owner step** — rotate the Sentry auth token in the Sentry dashboard, issue a new one, store it as a GitHub Actions secret
- [ ] 👤 **DG-1** — decide legacy fate (A freeze+date / B delete / C keep) **and set a literal deletion date**
  - [ ] ✅ `docs/adr/0001-gsav-pivot.md` exists with `Status: Accepted`, chosen option, and deletion date
- [ ] 👤 **P2-4 owner step** — confirm `../gsav-hosting` public HTTPS origin is deployed (byte-range + CORS verified)

---

## ⭐ Quick wins — front-load (all S/XS, DG-1-independent)

- [ ] ⭐ **P0-4** — commit the entire untracked GSAV surface atomically
  - [ ] `git add` the 13 untracked GSAV paths + modified `app/_layout.tsx`, `app/index.tsx` + `app.config.js`; single commit
  - [ ] ✅ `git clone <tmp> && npm ci && npx tsc --noEmit && npx vitest run` all exit 0
  - [ ] ✅ `git ls-files | grep -c gsavBridge.test.ts` == 1
- [ ] ⭐ **P4-3** — single credential accessor (fixes silent download-auth loss)
  - [ ] add `getCredentials()` via `secureStorage.getSecure`; replace raw `AsyncStorage.getItem('SESSDATA')` reads
  - [ ] ✅ `git grep -nE "AsyncStorage.getItem\('(SESSDATA|buvid3)'\)" -- hooks/ services/ store/` == 0
  - [ ] ✅ `getCredentials()` unit test; device: logged-in download carries SESSDATA cookie
- [ ] ⭐ **P3-2** 🔗P0-4 — de-dup the two byte-identical GSAV route files
  - [ ] shared `GsavScreen`; both routes re-export default; move `firstParam` into `gsavBridge` (+test)
  - [ ] 👤 decide & record: keep `/gsav/:id` alias (parameterize `buildGsavWatchPath:65` prefix) or delete it
  - [ ] ✅ route-file `diff` gone; `firstParam` test green
- [ ] ⭐ **P5-5a** — centralize Bilibili request headers
  - [ ] create `utils/bilibiliHeaders.ts`; import in the 6 sites
  - [ ] ✅ `git grep -lc "User-Agent.*Chrome/120" -- components/ hooks/ services/` == 1
- [ ] ⭐ **P6-9** — remove unused `expo-av` dependency (0 imports)
  - [ ] ✅ `npx depcheck` reports no unused runtime deps

---

## Phase 0 — Emergency 🛑
**DoD:** leaked token rejected by Sentry API · GSAV surface committed · CI can clone-and-test green

- [ ] **P0-4** — *(see Quick wins)*
- [ ] **P0-1** 👤 — rotate leaked Sentry auth token
  - [ ] grep all token consumers first (only `eas.json:19` tracked) so rotation doesn't break source-map upload
  - [ ] ✅ `curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer <OLD>' https://sentry.io/api/0/organizations/jinsha-t0/` → `401`
- [ ] **P0-2** — untrack `.env`; replace `eas.json` token with `$SENTRY_AUTH_TOKEN` ref
  - [ ] `git rm --cached .env`; add `.env` + `.env.*` then `!.env.example` to `.gitignore`; commit `.env.example`
  - [ ] ✅ `git ls-files | grep -c '^.env$'` == 0
  - [ ] ✅ `git check-ignore .env` → hit, `git check-ignore .env.example` → miss
  - [ ] ✅ `git grep -nE 'sntrys_[A-Za-z0-9]' -- . ':!*.md'` == 0
  - [ ] note: DSN is public-by-design — no rotation/scrub needed
- [ ] **P0-5a** 🔗P0-4 — wire prod env into the real (Gradle) build path
  - [ ] set `EXPO_PUBLIC_APP_ENV=production` on the **Prebuild** step (manifest cleartext)
  - [ ] set `EXPO_PUBLIC_GSAV_WEB_URL=${{secrets.GSAV_WEB_URL}}` on the **Gradle** step (JS inlining) — or set both job-wide
  - [ ] run verifier **advisory** (`continue-on-error`) until P2-4 lands
  - [ ] ✅ after build: `unzip -p app-release.apk 'assets/*.bundle' | grep -c '127.0.0.1:5191'` == 0
  - [ ] ✅ merged `AndroidManifest.xml` has `usesCleartextTraffic="false"`
- [ ] ⚠️ **P0-3** *(optional / deferred)* 🔗P0-1 — scrub token from git history
  - [ ] only after P0-1 confirmed; `git clone --mirror` backup first
  - [ ] pause `release.yml` during window; `git filter-repo` on mirror; re-add `origin`; coordinate `tiajinsha` fork
  - [ ] ✅ `git log -p --all -S 'sntrys_' -- eas.json` returns nothing
  - [ ] note: rotation is the real fix; this is hygiene, **not** 5-min revertible
- [ ] **P0-7** 👤 — enable GitHub secret-scanning / push-protection
- [ ] **P6-6** *(promoted)* — `getConfiguredGsavWebUrl()` throws/warns when env unset && `!__DEV__`
  - [ ] ✅ unit test: throws when unset and not dev

---

## Phase 1 — Enforce quality ✅
**DoD:** `ci.yml` is a required check, green on master · route types generated in CI

- [ ] **P1-1** 🔗P0-4 — CI quality gate `ci.yml`
  - [ ] PR+push job: `npm ci` → type-gen (P1-5) → `tsc --noEmit` (required) → `vitest run --coverage` (required) → `expo lint` (advisory)
  - [ ] make the **release job** depend on these too (gate the artifact, not just merges)
  - [ ] ✅ a deliberate type error turns the check red & blocks merge
  - [ ] ✅ `gh api .../branches/master/protection/required_status_checks` lists the job
- [ ] **P1-5** 🔗P0-4 — generate expo-router types in CI before `tsc`
  - [ ] ✅ `router.push('/does-not-exist')` fails `tsc` in CI
- [ ] **P1-2** 🔗P1-1 — lint/format tooling, scoped to new code first
  - [ ] `npx expo lint` (flat config + eslint-config-expo) + Prettier; scope to `features/gsav`, `utils/gsavBridge`, `components/GsavWebView`, `scripts/`
  - [ ] capture baseline warning count; CI ratchets via `--max-warnings <N>`
  - [ ] ✅ `npx expo lint --max-warnings <N>` exit 0; `prettier --check` (scoped) exit 0
- [ ] **P1-3** *(folded into P1-1)* — coverage
  - [ ] add `--coverage` + `coverage.include=[utils/**,store/**]`
  - [ ] ✅ CI prints `utils/` coverage; fails below committed baseline
- [ ] **P1-4** 🔗P1-1 — golden-vector tests for pure legacy logic
  - [ ] `wbi` signing (≥3 golden vectors), `dash` MPD (fixture), `cache.formatBytes`, pure store reducers
  - [ ] ✅ `utils/` statement coverage ≥ target (e.g. 80%); green in CI

---

## Phase 2 — Resolve the pivot narrative 📖
**DoD:** DG-1 ADR `Accepted` with deletion date · READMEs internally consistent

- [ ] **P2-1** — decide DG-1; write ADR
  - [ ] fix gitignore first (`!docs/adr/` + `!docs/adr/**`, or put ADR outside `docs/`)
  - [ ] ✅ `git check-ignore docs/adr/0001-gsav-pivot.md` returns nothing; `git ls-files docs/adr/` shows it
- [ ] **P2-2** — reconcile both READMEs
  - [ ] one narrative (legacy frozen / GSAV active); fix `:29` vs `:220` PR contradiction; add frozen notice to `README.en.md`
  - [ ] ✅ `git grep -nE '(不再接受).*(Pull Request)' README*.md` and `git grep -nE '欢迎.*PR' README*.md` not both hit
- [ ] **P2-3** — update structure map + tech table; drop `bilibili` scheme
  - [ ] add GSAV files to structure block; add WebView-shell row; remove `"bilibili"` from `app.json:6` scheme
  - [ ] ✅ structure block matches `git ls-files`; `grep -c bilibili app.json` (scheme) == 0
- [ ] ⛔ **P2-4** 🔗external — provision prod GSAV origin
  - [ ] prereq: gsav-hosting public HTTPS origin live
  - [ ] set URL as GH Actions secret (load-bearing) + secondarily in `eas.json`; replace placeholder `SENTRY_ORG`/`SENTRY_PROJECT`
  - [ ] ✅ `grep -c 'your-org-slug\|your-project-slug' eas.json` == 0
- [ ] **P0-5b** 🔗P2-4 — flip to real URL; promote verifier to required gate
  - [ ] ✅ `npm run verify:native-production-config` green with the build's env; release job gated on it; APK grep (P0-5a) shows real origin
- [ ] **P2-5** — update or retire CHANGELOG
  - [ ] ✅ `grep -c '1.0.19' CHANGELOG.md` ≥ 1, or a delegation marker line present
- [ ] **P2-6** — comment/string language policy in CONTRIBUTING
  - [ ] ✅ policy line present
- [ ] **P2-7** 🔗P2-1 — document GSAV catalog ownership contract (cross-repo)
  - [ ] ✅ contract note in ADR/README; P3-3 references it

---

## Phase 3 — Structural: GSAV as the product 🏗️
**DoD:** app opens to a GSAV launcher · legacy only behind flag · clean typed-route compile

- [ ] **P3-2** — *(see Quick wins)*
- [ ] **P3-1** 🔗P1-1,P3-2 — create `features/gsav/` module
  - [ ] move `GsavWebView`, `gsavBridge`(+test), `GsavScreen`; `app/*` route files become default-only re-exports
  - [ ] ✅ tsc+test green after move; no route-level exports lost
- [ ] **P3-4** 🔗P1-5 — enforce typed routes + remove route casts
  - [ ] remove route `as any` casts (index/search/video/creator); **do NOT touch** non-route casts (`index:378,425` refs; `downloads:183` width)
  - [ ] ✅ `git grep -c 'router\.\(push\|replace\|navigate\).*as any'` == 0; `tsc --noEmit` exit 0
- [ ] ⚠️ **P3-3** 🔗P3-4,DG-1 — GSAV **launcher** (not catalog) as home; quarantine legacy
  - [ ] (a) thin launcher screen deep-linking via `buildGsavWatchPath` — not a catalog (boundary `checklist:16,68-69,175`)
  - [ ] (b) flag `EXPO_PUBLIC_HOME=gsav|legacy` (revert = 1 env change)
  - [ ] (c) relocate legacy under `legacy/` group after flag ships + validates on `preview`
  - [ ] tag `legacy-final` before any removal
  - [ ] ✅ flag flips home; `legacy` still renders/navigates; launcher reaches real GSAV

---

## Phase 4 — Data layer & type safety 🔀 (scope per DG-1)
**DoD:** no silent business-error swallowing on shipped paths · credentials via one accessor

- [ ] **P4-3** — *(pulled forward to Quick wins)*
- [ ] 🔀 **P4-1** 🔗DG-1 — runtime validation at service boundary (survivors only)
  - [ ] hand-rolled guards à la `gsavBridge` (NOT zod); return `T|null`; enumerate casts (`as VideoItem` = 5 in `bilibili.ts`)
  - [ ] ✅ malformed-payload test yields null/throw; `grep -c 'as VideoItem' services/bilibili.ts` == 0
  - [ ] *(Option B: delete instead — Phase 4B)*
- [ ] 🔀 **P4-2** 🔗DG-1 — centralize business-`code` check
  - [ ] `unwrap(res)` throwing `API ${code}: ${msg}`; note `bilibili.ts:101-104` JSDoc is correct (don't "fix")
  - [ ] ✅ test for `code:-352` path
  - [ ] *(Option B: delete instead)*
- [ ] 🔀 **P4-4** 🔗DG-1 — unify async error contract (no new abstraction/deps)
  - [ ] only add `error` exposure to list/search/comment hooks so legacy UI doesn't crash
  - [ ] ✅ those hooks expose `error`; UI shows retry
- [ ] **P4-5** — error swallowing + telemetry
  - [ ] log w/ endpoint name before swallow; wire `Sentry.captureException` in service error path
  - [ ] ✅ no fully-silent catch on critical paths
- [ ] **P4-6** 🔗P3-1 — GSAV resume/persistence
  - [ ] persist `{videoId, progressPercent, currentTime}` to a small store; pass `startTime` on mount
  - [ ] ✅ re-opening a scene resumes near last position; survives unmount

---

## Phase 4B / 5B — Legacy deletion (Option B only) 🗑️
**DoD:** app boots to GSAV · `tsc` green · no dangling imports · precondition: `legacy-final` tagged + GSAV launcher validated on preview

- [ ] delete `app/{video,live,creator,downloads,search}` routes
- [ ] delete `services/bilibili.ts` + Bilibili-only stores/hooks/components
- [ ] remove `MiniPlayer`/`LiveMiniPlayer` mounts (`app/_layout.tsx:128-129`) + `gsavShellActive` guard
- [ ] drop `"bilibili"` scheme (`app.json:6`)
- [ ] prune dead deps: `react-native-video`, `expo-av`, `react-native-static-server`, `pako`, `react-native-qrcode-svg`, `react-native-pager-view` (re-audit `expo-clipboard`)
- [ ] delete legacy tests/fixtures
- [ ] ✅ `npx depcheck` clean; `tsc` green; app boots to GSAV

---

## Phase 5 — Component dedup 🔀 (mostly dropped under A/B)

- [ ] **P5-5a** — *(see Quick wins)*
- [ ] 🔀 **P5-3** 🔗DG-1 — extract `<BottomSheet>` (only if these sheets survive)
  - [ ] ✅ sheets reduced to bodies
- [ ] 🔀 **P5-5b** *(defer)* 🔗DG-1 — brand-color token
  - [ ] add `primary` to `ThemeColors`; replace `#00AEEC` (~60 sites) **only in surviving files**
- [ ] ⛔ ~~**P5-1 / P5-2 / P5-4**~~ — native player decomposition — **DROPPED unless DG-1 keeps native playback**

---

## Phase 6 — Polish 🧹

- [ ] **P6-6** — *(promoted to Phase 0)*
- [ ] **P6-9** — *(see Quick wins)*
- [ ] **P6-1** — move stateful `useTheme` to `hooks/`; leave pure palette in `utils`
- [ ] **P6-2** — GSAV WebView: narrow on `message.type` instead of re-casting payloads
- [ ] **P6-3** — search-history/buvid3 → stores; central persisted-key registry
- [ ] **P6-4** — standardize `catch (e)` + `errMessage(e)` helper
- [ ] **P6-7** — web-shim contract test
- [ ] **P6-5a** — dedupe Android permissions (`app.json:27-34`); fix slug typo `jsvideo` (if no EAS project bound)
- [ ] ⚠️ **P6-5b** *(major version only)* — Android `package` rename (breaks app identity; needs migration plan)

---

## Top-level success metrics (whole-effort DoD)

- [ ] **M1** `git grep -nE 'sntrys_[A-Za-z0-9]' -- . ':!*.md'` == 0 **and** old token returns `401`
- [ ] **M2** `tsc --noEmit` == 0 **and** `vitest run` green in a **required** CI job; `utils/` coverage ≥ baseline
- [ ] **M3** release APK bakes the **configured https origin** (positive assert — `grep '127.0.0.1' == 0` is unreliable: the localhost default is a source constant always in the bundle), manifest `usesCleartextTraffic="false"`
- [ ] **M4** GSAV shell loads to first frame on a **physical Android device** from the release APK
- [ ] **M5** DG-1 ADR `Accepted` (done) + deletion gate; GSAV is home launcher (pending P3-3); checklist `:142-161` production-gate boxes ticked

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 10 real + 1 false positive; folded into T1/T2/T3/T6/T7 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 12 issues, 2 critical gaps — both fixed + verified this branch |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | n/a (no UI change) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **CODEX:** outside voice (`gpt-5.5`) independently confirmed both P1 findings (release pipeline + WebView trust boundary); surfaced the fake-safety-net (T3), `mixedContentMode` hole (T1), version-bump ordering (T2), permission minimization (T6). One false positive (mojibake — PowerShell ANSI read of clean UTF-8, verified byte-level).
- **CROSS-MODEL:** strong agreement, no genuine tension — both reviewers converged on the release pipeline and the GSAV WebView shell as the two weak spots.
- **VERDICT:** ENG review complete. P1 code fixes landed + verified (tsc clean, 84 tests; CI quality gate green on PR #1). Before releases resume: set `GSAV_WEB_URL` (P2-4). Repo stays private and only the APK ships, so the Bilibili-client deletion is a product decision (not a legal gate) and the token rotation (T9) is optional hygiene.

NO UNRESOLVED DECISIONS
