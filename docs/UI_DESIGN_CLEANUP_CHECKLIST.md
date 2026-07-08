# UI Design Cleanup Checklist

Date: 2026-07-07

This checklist is for making diveo and the embedded GSAV web runtime clearer,
cleaner, and more elegant without changing the ownership model: React Native
owns the product shell, gsav-hosting owns GSAV decode/render/playback/runtime,
and both clients share backend contracts.

## Verification And Validation Definitions

Verification proves the implementation is correct through repeatable checks:
typecheck, lint, unit tests, import-boundary checks, source scans, runtime smoke
tests, and deterministic screenshot or console output.

Validation proves the product experience works for a person in the target
environment: desktop browser, mobile web preview, Android WebView, iOS
WKWebView, release-equivalent build, or reviewed QA evidence.

Do not mark an item complete from a static code review alone. Visual quality
requires screenshots or device/browser observation.

## Operating Rules

- Check an item only when both verification and validation evidence exist.
- Save evidence under `docs/qa-evidence/<date>/design/` or link a trusted
  GitHub Actions/artifact URL.
- Capture before and after screenshots for every visible design change.
- Capture at least one narrow mobile viewport and one desktop viewport for web.
- Capture Android and iOS evidence for embedded WebView claims.
- Record the exact command, URL, viewport, device, OS, and build profile used.
- Keep local Expo web preview evidence separate from release validation.
- Do not commit account identifiers, tokens, signed URLs, or private user data.
- Prefer smaller focused UI changes with proof over broad unverified redesigns.

## Product Design Direction

- The app should feel like a focused GSAV browsing product, not a generic demo.
- Native Home, Search, Creator, Library, Login, and Settings should be the
  primary product shell.
- Embedded web routes should feel like a runtime/player surface, not a second
  competing app inside the app.
- Visual hierarchy should come from spacing, alignment, type weight, and clear
  grouping before color.
- Use color for state, navigation, selection, and brand accent. Avoid noisy
  gradients, decorative blobs, nested cards, and one-note palettes.
- Keep one obvious primary action per decision point.
- Make loading, empty, error, blocked, signed-out, and completed states calm,
  compact, and recoverable.
- Keep terminology consistent: scene, creator, saved, library, upload, publish,
  watch, explore.

## Evidence Packet Template

Use this table for each design pass.

| Field | Required value |
| --- | --- |
| Change ID | Stable ID, for example `ux-home-card-density` |
| Owner | Person, team, or issue that owns the change |
| Screens touched | Route list, for example `/`, `/search`, `/watch/:id` |
| Verification | Commands and test output |
| Validation | Browser/device observations and screenshot/video paths |
| Before evidence | Screenshot, recording, or notes |
| After evidence | Screenshot, recording, or notes |
| Known risk | Remaining unverified surface or accepted limitation |
| Status | `pending`, `verified-local`, `validated-device`, or `done` |

## Phase 0: Baseline Capture

- [ ] Capture the current product journey before making visual changes.
  - Scope:
    - Home/feed.
    - Search.
    - Creator profile.
    - Library.
    - Login.
    - Settings.
    - Watch embed.
    - Explore embed.
    - Diagnostics/error/blocked states.
  - Verification:
    - `npm run dev:doctor -- --require-assets`
    - `npm run verify:import-boundaries`
    - `npm run gsav:runtime-smoke`
  - Validation:
    - Save desktop browser screenshots for the GSAV web app.
    - Save narrow mobile screenshots for the Expo web preview.
    - Record any blank, clipped, overlapping, noisy, or confusing areas.

- [ ] Create a design issue list from the baseline.
  - Required categories:
    - hierarchy.
    - layout density.
    - repeated actions.
    - confusing labels.
    - weak empty/error states.
    - native/web inconsistency.
    - accessibility risk.
    - responsive or safe-area risk.
  - Verification:
    - Each issue has a route, screenshot path, and expected improvement.
  - Validation:
    - A reviewer can reproduce each issue from the saved evidence.

## Phase 1: Information Architecture And Workflow

- [ ] Confirm the primary task on every top-level route.
  - Expected:
    - Home helps users choose a scene.
    - Search helps users find a scene or creator.
    - Creator helps users evaluate a creator and open scenes.
    - Library helps users resume saved scenes.
    - Watch helps users view one GSAV scene.
    - Explore helps users browse runtime previews quickly.
    - Settings helps users adjust app behavior and account state.
  - Verification:
    - Route files remain thin adapters.
    - `npm run verify:import-boundaries`
  - Validation:
    - Reviewer can name the primary action on each route in five seconds.

- [ ] Remove competing primary actions.
  - Verification:
    - Source review confirms each screen has one dominant forward action.
    - Secondary actions are grouped into quiet controls or menus.
  - Validation:
    - Click-through review confirms no screen presents two equally loud next
      steps for the same decision.

- [ ] Keep native and web ownership visually clear.
  - Verification:
    - Native routes do not expose web-only product navigation inside WebView.
    - Embedded web routes hide public/account chrome in native mode.
  - Validation:
    - Watch and Explore feel like embedded runtime surfaces on Android/iOS.
    - Browser GSAV web app still feels complete when opened independently.

## Phase 2: Visual Hierarchy And Layout System

- [ ] Establish a consistent spacing scale.
  - Verification:
    - Reused spacing values live in shared theme/tokens or local constants.
    - No new one-off margins are introduced without a local reason.
  - Validation:
    - Screens look aligned at mobile, tablet, and desktop widths.

- [ ] Normalize typography hierarchy.
  - Verification:
    - Screen titles, section titles, card titles, metadata, buttons, and
      captions use consistent sizes and weights.
    - No viewport-width font scaling.
  - Validation:
    - Long scene titles, creator names, and error strings do not overlap,
      clip, or escape containers.

- [ ] Reduce visual noise.
  - Verification:
    - Remove redundant borders, shadows, nested cards, decorative gradients,
      and repeated status badges where they do not help a decision.
  - Validation:
    - The first viewport has a clear focal point and no more than one primary
      action group.

- [ ] Keep color restrained and meaningful.
  - Verification:
    - State colors are used consistently for selected, error, success,
      disabled, and destructive states.
    - Contrast-sensitive text is not placed over low-contrast media.
  - Validation:
    - Reviewer can identify interactive state without relying on color alone.

## Phase 3: Catalog Feed And Scene Cards

- [ ] Make scene cards scan-friendly.
  - Verification:
    - Poster aspect ratios are stable.
    - Card title, creator, duration/status, and save/follow affordances have a
      predictable order.
    - Dynamic metadata cannot resize the card unexpectedly.
  - Validation:
    - Reviewer can compare the first five scenes without opening details.

- [ ] Make card actions quiet until needed.
  - Verification:
    - Primary tap/click opens the scene.
    - Save/follow/share actions are visually secondary and touch accessible.
  - Validation:
    - No accidental action is triggered while scrolling on touch devices.

- [ ] Improve catalog loading, empty, and error states.
  - Verification:
    - Tests cover missing config or failed catalog fetch where practical.
    - Dev error copy points to backend reachability without exposing secrets.
  - Validation:
    - Stop the backend and confirm the user sees a recoverable state, not a
      blank list or raw exception.
  - Current evidence:
    - `shared/gsavErrors.ts` adds a local `npm run dev:doctor` reachability
      hint for native catalog fetch, catalog HTTP, and catalog contract
      failures in development.
    - Home/feed, Search, Creator, and Library saved-scene resolution use the
      shared formatter.
    - `npx vitest run shared\gsavErrors.test.ts` passed.
    - Validation still pending: backend-offline screenshot or device/browser
      observation.

## Phase 4: Search And Discovery

- [ ] Make search input behavior obvious.
  - Verification:
    - Search field has a clear label, placeholder, submit behavior, and clear
      affordance.
    - Keyboard submit and touch submit both work.
  - Validation:
    - Mobile keyboard does not cover the search field or first results.

- [ ] Make filters compact and understandable.
  - Verification:
    - Category/tag filters use stable controls and do not wrap into overlap.
    - Selected filter state is visible and keyboard reachable.
  - Validation:
    - Reviewer can apply and clear a filter without instruction text.

- [ ] Make no-results states useful.
  - Verification:
    - Empty search state includes the query and a clear reset path.
  - Validation:
    - Reviewer can recover from a zero-result search in one action.

## Phase 5: Creator, Social, And Library States

- [ ] Simplify creator headers.
  - Verification:
    - Avatar, name, handle, follow action, creator stats, and bio have a
      consistent order.
    - Long bios collapse or wrap without pushing key actions out of reach.
  - Validation:
    - Reviewer can identify the creator and open one scene from the first
      viewport.

- [ ] Clarify signed-out social actions.
  - Verification:
    - Save/follow actions route through the social feature contracts.
    - Signed-out action copy is consistent across Home, Creator, and Watch.
  - Validation:
    - Signed-out user taps Save or Follow, reaches Login, and returns without
      losing the original scene context.

- [ ] Make Library useful in all states.
  - Verification:
    - Empty library, loading saved scenes, saved scene list, and fetch failure
      states are all implemented.
  - Validation:
    - Seeded saved scenes appear and can open the matching Watch route.

## Phase 6: Watch Embed And Player Boundary

- [ ] Make the Watch loading path nonblank.
  - Verification:
    - WebView host shows a native loading state before bridge readiness.
    - Runtime smoke still observes compatible `GSAV_BRIDGE_READY`.
  - Validation:
    - Android and iOS do not show a blank white or black screen during normal
      load, slow network, or retry.

- [ ] Make blocked navigation understandable.
  - Verification:
    - Route gate tests reject same-origin hosted product routes outside the
      allowlist.
    - Blocked state has a concise title, reason, and back/retry path.
  - Validation:
    - Android and iOS show a native blocked state for the same-origin product
      path QA trigger.

- [ ] Keep player controls legible and reachable.
  - Verification:
    - Controls have stable hit areas and visible focus where applicable.
    - Safe-area and orientation logic do not overlap the player surface.
  - Validation:
    - Validate portrait, landscape, hardware back, and back gesture behavior on
      Android and iOS.

## Phase 7: Explore Runtime

- [ ] Make Explore feel intentionally runtime-scoped.
  - Verification:
    - Native `/explore` builds exactly one `embed=native` URL and adds
      `dataSaver=1`.
    - Hosted public/account chrome is hidden in native embed mode.
  - Validation:
    - Swipe, wheel, trackpad, and keyboard navigation visibly change the active
      scene in browser validation.

- [ ] Preserve browser usability for GSAV web.
  - Verification:
    - Browser `/explore` route keeps full web navigation and recoverable errors.
  - Validation:
    - Desktop browser user can open Explore independently and then open Watch.

## Phase 8: Forms, Settings, And Account UX

- [ ] Clean up Login and auth-return flow.
  - Verification:
    - Inputs have labels, validation, loading, error, and disabled states.
    - Auth-return route handling is covered by focused tests or source checks.
  - Validation:
    - Keyboard-visible Login UI has no overlap on mobile.
    - Failed login shows field-specific or actionable error copy.

- [ ] Make Settings scannable.
  - Verification:
    - Settings are grouped by task, not implementation detail.
    - Binary settings use switches or checkboxes; destructive actions are
      clearly separated.
  - Validation:
    - Reviewer can find data saver, account, cache, and update status quickly.

## Phase 9: Cross-Client Copy And Terminology

- [ ] Align visible nouns and actions across native and web.
  - Required terms:
    - scene.
    - creator.
    - saved.
    - library.
    - watch.
    - explore.
    - upload.
    - publish.
  - Verification:
    - Source scan or snapshot check covers the key visible strings.
  - Validation:
    - Same catalog item reads coherently in native and web.

- [ ] Standardize error language.
  - Verification:
    - Error states use short human copy plus optional technical detail in dev.
    - No raw stack traces or internal URLs appear in production UI.
  - Validation:
    - Backend offline, missing host config, auth failure, and blocked
      navigation each produce a distinct recoverable state.
  - Current evidence:
    - Native catalog-related errors now use short original copy plus a
      development-only backend reachability hint for known catalog/network
      failure classes.
    - `shared/gsavErrors.test.ts` verifies production copy stays short and
      unknown errors use stable fallback text.
    - Validation still pending: backend offline, missing host config, auth
      failure, and blocked navigation observations.

## Phase 10: Accessibility And Input Coverage

- [ ] Meet a practical WCAG 2.2 AA baseline.
  - Verification:
    - Text contrast, focus visibility, semantic controls, labels, and touch
      targets are reviewed for changed screens.
    - Custom controls document keyboard behavior.
  - Validation:
    - Keyboard-only browser path reaches primary actions.
    - Touch targets are at least 44dp or have a documented exception.

- [ ] Support text and motion preferences.
  - Verification:
    - Dynamic text does not cause overlap on critical screens.
    - Reduced-motion preference is respected where animation is decorative.
  - Validation:
    - Larger text device/browser setting keeps Home, Search, Watch fallback,
      and Login usable.

## Phase 11: Responsiveness And Safe Areas

- [ ] Validate core breakpoints.
  - Required viewport/device set:
    - narrow mobile web.
    - medium mobile or Android emulator.
    - iPhone-class iOS simulator or device.
    - tablet or wide desktop browser.
  - Verification:
    - CSS/React Native layout uses stable dimensions, flex constraints, and
      aspect ratios instead of content-driven jumps.
  - Validation:
    - No horizontal scrolling, clipped controls, overlapping text, or unsafe
      notch/home-indicator placement.

- [ ] Validate orientation changes for embedded routes.
  - Verification:
    - Player and Explore layout code handles rotation without remount loops.
  - Validation:
    - Android and iOS route rows record portrait and landscape behavior.

## Phase 12: Performance And Perceived Quality

- [ ] Keep first interaction responsive.
  - Verification:
    - Avoid avoidable synchronous work in render paths.
    - Lists use stable keys and avoid rerendering the whole feed on small state
      changes.
  - Validation:
    - Home and Search feel responsive while images load and while scrolling.

- [ ] Make media loading feel intentional.
  - Verification:
    - Posters reserve space before loading.
    - Failed poster and GSAV asset states have fallbacks.
  - Validation:
    - Slow network review does not show layout jumps or blank cards.

## Phase 13: Automation And Evidence Gates

- [ ] Add targeted tests for design-sensitive logic.
  - Candidates:
    - route-to-owner presentation rules.
    - empty/error state helpers.
    - string terminology maps.
    - scene card metadata formatting.
    - player blocked-state reducer.
  - Verification:
    - `npm test` or focused Vitest command passes.
  - Validation:
    - Manual screenshot review confirms the tested state matches the intended
      UI.
  - Current evidence:
    - `shared/gsavErrors.test.ts` covers native catalog error copy behavior.
    - `shared/gsavRoutes.test.ts` and `features/scene/sceneShare.test.ts`
      cover canonical watch route identity and share URLs.
    - `scripts/verify-import-boundaries.test.mjs` covers route-owner, storage,
      auth-session, and canonical watch-route guardrails.
    - Focused command passed:
      `npx vitest run shared\gsavErrors.test.ts shared\gsavRoutes.test.ts
      features\scene\sceneShare.test.ts
      scripts\verify-import-boundaries.test.mjs`.
    - Validation still pending: manual screenshot review for the corresponding
      visible states.

- [ ] Add screenshot capture for changed web views when practical.
  - Verification:
    - Browser screenshot script records desktop and mobile viewports.
    - Console output is checked for errors.
  - Validation:
    - Screenshots are reviewed and saved with the change ID.

- [ ] Keep release validation gates intact.
  - Verification:
    - `npm run verify:local`
    - `npm run verify:release-candidate`
    - `npm run verify:docs-drift`
    - `npm run verify:import-boundaries`
  - Validation:
    - Android/iOS QA rows remain pending until real device or trusted artifact
      evidence exists.

## Final Acceptance Criteria

- [ ] Every top-level route has one clear primary task.
- [ ] Home, Search, Creator, Library, Login, Settings, Watch, Explore, and
  diagnostics states have before/after evidence.
- [ ] Empty, loading, error, blocked, signed-out, and offline states are
  recoverable and visually consistent.
- [ ] Scene cards are stable, scan-friendly, and touch safe.
- [ ] Native and web use consistent catalog terminology.
- [ ] Embedded web routes hide web chrome in native mode and never feel like a
  second product shell.
- [ ] Browser GSAV web still works independently.
- [ ] Keyboard and touch paths reach the primary actions.
- [ ] Mobile, desktop, Android WebView, and iOS WKWebView validation evidence is
  recorded where claims require it.
- [ ] `npm run verify:local` passes after the design changes.
- [ ] Remaining unvalidated areas are explicitly listed as blockers, not
  treated as complete.

## Suggested Verification Commands

```powershell
npm run dev:doctor -- --require-assets
npm run verify:local
npm run verify:docs-drift
npm run verify:import-boundaries
npm run gsav:preflight
npm run gsav:runtime-smoke
npx tsc --noEmit
npm test
npm run lint
```

## Suggested Validation Routes

```text
diveo native preview: http://127.0.0.1:8082
GSAV web app: http://localhost:5173
Home: /
Search: /search
Creator: /creator/<handle>
Library: /library
Login: /login
Settings: /settings
Watch: /watch/test
Explore: /explore
Diagnostics: /gsav-diagnostics
```
