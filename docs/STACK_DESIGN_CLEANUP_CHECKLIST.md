# Stack Design Cleanup Checklist

Date: 2026-07-06

This checklist improves the diveo plus gsav-hosting stack design without
changing the core architecture: one GSAV backend, two first-class clients, one
shared contract layer, and a narrow native-to-web embed bridge.

## Target Architecture

```text
Supabase database, storage, auth, and Edge Functions
        ^
        |
Shared GSAV client contracts and API adapters
        ^
        |
+----------------------+----------------------+
| diveo native shell   | gsav-hosting web app |
| Expo / React Native  | Vite / React         |
+----------------------+----------------------+
        |
        v
Native embeds gsav-hosting only for GSAV runtime/player routes.
```

## Verification And Validation Definitions

Verification proves implementation correctness through local checks, tests,
static analysis, scripts, and deterministic command output.

Validation proves the integrated product works in real or release-like
environments: browser, Android WebView, iOS WKWebView, Supabase local/staging,
production host, or CI evidence.

Do not count local Expo web preview as publish validation. It is useful for
fast iteration and smoke checks only.

## Checklist Operating Rules

- Check an item only when both its verification and validation evidence exist.
- Record evidence as commands, screenshots, device notes, CI artifacts, or
  linked QA rows. Do not rely on memory.
- Keep local smoke evidence separate from release validation evidence.
- Redact keys, tokens, account identifiers, and signed URLs in copied output.
- Prefer automated checks for invariants that can drift: env URLs, origins,
  schema versions, bridge versions, import boundaries, and docs references.
- Use manual validation for product behavior that automation cannot prove:
  Android WebView behavior, iOS WKWebView behavior, review clarity, and
  fail-closed route handling.
- If a validation step cannot be run, leave the item unchecked and record the
  exact blocker.

## Design Principles

- Native and web are sibling clients of the backend.
- The native app does not call web routes for data.
- The web app does not assume native state except through the documented embed
  bridge.
- Backend-generated URLs must be reachable by the browser or device consuming
  them.
- Environment config has one source of truth per stack profile.
- Dev startup should be one command with a clear health report.
- The bridge is for session handoff, playback/runtime events, route safety, and
  diagnostics only.
- Shared contracts are typed, tested, and owned outside UI components.

## Current Implementation Status

Implemented locally:

- Shared local profile: `config/stack.local.json`.
- Env generation and drift check: `npm run stack:env` and
  `npm run stack:env:check`.
- Local catalog public asset seeding: `npm run stack:seed-assets`.
- Stack launcher and stop command: `npm run dev:stack` and
  `npm run dev:stop`.
- Stack doctor: `npm run dev:doctor`.
- Stack architecture receipt: `npm run stack:receipt` and
  `npm run stack:receipt:check`.
- Bridge schema and native-side origin rules documented in
  `docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md`, with focused tests in
  `features/player/bridge.test.ts`.
- Backend public asset URL canonicalization in gsav-hosting's Supabase storage
  helper.

Validation note: `npm run dev:doctor` proves stack coherence and rejects
container-internal catalog URLs. `npm run stack:seed-assets` uploads local
catalog fixture bytes, and `npm run dev:doctor -- --require-assets` probes the
seeded poster and GSAV assets.

## Baseline Evidence Captured

Captured on 2026-07-06 from the diveo root:

- `npm run stack:env:check` passed.
- `npm run dev:doctor -- --skip-network` passed.
- `npm run dev:doctor -- --require-assets` passed:
  - diveo env drift: ok.
  - gsav-hosting web env drift: ok.
  - gsav-hosting functions env drift: ok.
  - native shell origin allowlist includes `http://127.0.0.1:8082`.
  - Supabase API reachable at `http://127.0.0.1:54321/auth/v1/health`.
  - catalog function returned schema version `1` and first item `capture-room`.
  - every first-page poster, animated poster, and GSAV asset byte probe passed
    from browser-reachable `127.0.0.1:54321` storage URLs.
  - GSAV web app reachable at `http://localhost:5173`.
  - diveo Expo preview reachable at `http://127.0.0.1:8082`.
- `npm run stack:receipt` wrote
  `docs/qa-evidence/local-stack-architecture-receipt.json`.
- `npm run stack:receipt:check` passed against the saved receipt.
- `EXPO_PUBLIC_GSAV_WEB_URL=http://localhost:5173 npm run gsav:runtime-smoke
  -- --output-path docs/qa-evidence/local-gsav-runtime-smoke.json` passed.

These checks are local verification and local smoke validation. They do not
replace Android, iOS, staging, production, or CI release evidence.

Bridge runtime validation blocker resolved on 2026-07-07:

- `EXPO_PUBLIC_GSAV_WEB_URL=http://localhost:5173 npm run gsav:runtime-smoke`
  originally failed `/explore` because the hosted router rewrote
  `dataSaver=1` to non-contract values. The gsav-hosting web router now
  normalizes data-saver search to numeric `1`, preserving the WebView URL
  contract.

## Phase 0: Baseline Inventory

- [ ] Document current local ports and owners.
  - Owner: `docs/`, no code change.
  - Expected:
    - diveo Expo preview: `http://127.0.0.1:8082` or documented active port.
    - gsav-hosting web: `http://localhost:5173`.
    - Supabase API: `http://127.0.0.1:54321`.
    - Supabase Edge Functions: `http://127.0.0.1:54321/functions/v1/*`.
  - Verification:
    - `Invoke-WebRequest http://127.0.0.1:54321/functions/v1/catalog`
    - `Invoke-WebRequest http://localhost:5173`
    - `Invoke-WebRequest http://127.0.0.1:8082`
  - Validation:
    - Browser opens native preview and shows catalog scenes.
    - Browser opens gsav-hosting web app and can navigate to a watch route.

- [ ] Inventory every env var used by native and web.
  - Native:
    - `EXPO_PUBLIC_GSAV_WEB_URL`
    - `EXPO_PUBLIC_GSAV_CATALOG_URL`
    - `EXPO_PUBLIC_GSAV_SUPABASE_URL`
    - `EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY`
  - Web:
    - `VITE_GSAV_CATALOG_URL`
    - `VITE_SUPABASE_URL`
    - `VITE_SUPABASE_ANON_KEY`
    - `VITE_GSAV_ALLOWED_SHELL_ORIGINS`
  - Verification:
    - `rg -n "EXPO_PUBLIC_GSAV|VITE_GSAV|VITE_SUPABASE|SUPABASE_URL" . ../gsav-hosting/apps/web`
  - Validation:
    - Document one local and one production/staging mapping table with no
      secrets committed.

- [ ] Capture current architecture drift points.
  - Known drift candidates:
    - Multiple startup commands.
    - Different env names for the same backend concepts.
    - Catalog returns container-internal `http://kong:8000` asset URLs.
    - Native/web shell origin allowlists can drift from active Expo ports.
  - Verification:
    - Add the drift list to this document or a linked architecture note.
  - Validation:
    - Confirm with one browser run and one native preview run which issues are
      visible to users.

## Phase 1: Single Stack Configuration

- [ ] Add a stack profile file as the source of truth for URLs.
  - Suggested file:
    - `stack.local.json` or `config/stack.local.json`.
  - Suggested fields:
    - `backendUrl`
    - `catalogUrl`
    - `webUrl`
    - `nativePreviewUrl`
    - `allowedShellOrigins`
  - Verification:
    - Add a script that validates required keys and URL schemes.
    - Script fails on missing keys, unsupported schemes, localhost in production
      profile, and mismatched catalog/backend origins.
  - Validation:
    - Running the script prints a concise local stack summary with all expected
      URLs.

- [ ] Generate Expo and Vite env files from the stack profile.
  - Native output:
    - `.env.local` with `EXPO_PUBLIC_GSAV_*`.
  - Web output:
    - `../gsav-hosting/apps/web/.env.local` with `VITE_*`.
  - Verification:
    - Generated files match the stack profile.
    - Existing production verifier still rejects local/private production URLs.
    - `npm run verify:native-production-config` still passes with safe
      placeholder HTTPS values and fails without required production values.
  - Validation:
    - Delete local env files, regenerate them, start the stack, and verify both
      clients load the same catalog.

- [ ] Add a config drift check.
  - The check compares:
    - `EXPO_PUBLIC_GSAV_CATALOG_URL` to `VITE_GSAV_CATALOG_URL`.
    - `EXPO_PUBLIC_GSAV_SUPABASE_URL` to `VITE_SUPABASE_URL`.
    - `EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY` presence to
      `VITE_SUPABASE_ANON_KEY` presence, without printing key values.
    - `EXPO_PUBLIC_GSAV_WEB_URL` to the web app URL.
  - Verification:
    - Script exits nonzero on mismatch.
    - Script redacts secrets.
  - Validation:
    - Intentionally change one local URL and confirm the doctor reports the
      exact mismatch.

## Phase 2: One Command Developer Startup

- [ ] Add `npm run dev:stack` at the stack root or diveo root.
  - It should start:
    - Docker Desktop readiness check.
    - `gsav-hosting` Supabase.
    - Supabase Edge Functions.
    - `gsav-hosting` Vite web app.
    - diveo Expo preview or native target.
  - Verification:
    - Command starts each process once and writes logs to stable paths.
    - Command detects already-running services and reuses them.
    - Command exits with a clear error when Docker is not running.
  - Validation:
    - Fresh terminal run prints only the final service URLs and health status.
    - Browser opens native preview and web app from printed URLs.

- [ ] Add `npm run dev:doctor`.
  - Health checks:
    - Supabase API reachable.
    - Catalog function returns HTTP 200.
    - Catalog JSON includes `schemaVersion`.
    - First catalog item has browser-reachable poster and GSAV URLs.
    - Web app reachable.
    - Expo preview reachable.
    - Web allowed shell origins include active native preview origin.
  - Verification:
    - Unit test the doctor URL checks with mocked responses where practical.
    - Doctor fails fast with actionable messages.
  - Validation:
    - Stop Edge Functions and confirm doctor reports only the function failure.
    - Stop Vite and confirm doctor reports only the web failure.

- [ ] Add `npm run dev:stop`.
  - It should stop only processes started by the stack command where possible.
  - It must not stop unrelated user processes.
  - Verification:
    - PID files or process metadata identify owned processes.
    - No broad kill commands.
  - Validation:
    - Start stack, run stop, verify ports are released.

## Phase 3: Backend URL Canonicalization

- [ ] Fix catalog asset URLs at the backend boundary.
  - Backend must not return container-internal URLs such as:
    - `http://kong:8000/storage/v1/object/public/...`
  - Backend should return client-reachable URLs such as:
    - Local: `http://127.0.0.1:54321/storage/v1/object/public/...`
    - Production: configured public storage/CDN origin.
  - Verification:
    - Add tests in `../gsav-hosting` for catalog URL rewriting.
    - Add an assertion that no catalog payload contains `kong:8000`.
    - Add a diveo catalog normalization test if the client is expected to
      preserve backend URLs exactly.
  - Validation:
    - Browser native preview loads posters without `ERR_NAME_NOT_RESOLVED`.
    - Web app watch route fetches the GSAV asset from a browser-reachable URL.

- [ ] Define public asset origin config.
  - Suggested config:
    - local asset public origin derives from `SUPABASE_PUBLIC_URL` or stack
      `backendUrl`.
    - production asset public origin derives from CDN or Supabase public URL.
  - Verification:
    - Backend tests cover local, staging, and production origins.
    - Production verifier rejects local/private asset origins.
  - Validation:
    - Open first poster URL and first GSAV URL directly in a browser.
    - Confirm range requests work for GSAV assets where required.

- [x] Add catalog contract checks for all public URLs.
  - Required fields:
    - `posterUrl`
    - `animatedPosterUrl` when present.
    - `gsavUrl`
  - Verification:
    - Contract test rejects private/container hostnames for browser payloads.
  - Validation:
    - `dev:doctor` reports all first-page asset URLs reachable.
  - Evidence:
    - `scripts/dev-doctor.js` validates every catalog item URL and
      `--require-assets` probes every unique first-page asset URL.
    - `scripts/stack-config.test.mjs` rejects a container-internal URL in a
      non-first catalog item.
    - `npm run dev:doctor -- --require-assets` passed with poster, animated
      poster, and GSAV byte probes for all four local catalog scenes.

## Phase 4: Shared Contract Layer

- [ ] Make `@opsiclear/gsav-client` the only catalog contract surface for both
  clients.
  - Native import path:
    - `services/gsav.ts`
  - Web import path:
    - web catalog provider or backend adapter, not component-level fetches.
  - Verification:
    - Import-boundary script rejects direct ad hoc catalog fetches in UI
      components.
    - Unit tests cover normalization for native and web expectations.
  - Validation:
    - Search, creator, feed, and watch routes return matching records in native
      and web for the same query.
  - Current evidence:
    - Native catalog access is centralized in `services/gsav.ts`.
    - gsav-hosting web `src/catalog/api-catalog.ts` now consumes the shared
      `normalizeCatalogPage` contract from `@opsiclear/gsav-client` and keeps
      facets/presentation extras as a web adapter layer.
    - `npm run verify:shared-catalog-contract` enforces the native and web
      catalog contract paths.
    - In `../gsav-hosting/apps/web`,
      `npm test -- src/catalog/api-catalog.test.ts` passed.
    - In `../gsav-hosting/apps/web`, `npm run type:check` passed.

- [ ] Add a versioned API contract for catalog responses.
  - Required:
    - `schemaVersion`.
    - Stable pagination semantics.
    - Stable item IDs, backend IDs, creator fields, asset URLs, and visibility
      behavior.
  - Verification:
    - Contract tests reject unknown required shapes.
    - Existing `schemaVersion === 1` test remains active.
  - Validation:
    - Browser and native preview both show the same first page after a backend
      reset.
  - Current evidence:
    - `services/gsav.ts` now requires `schemaVersion === 1`, a `videos`
      array, and shared-normalizer acceptance before native UI receives catalog
      rows.
    - `scripts/verify-shared-catalog-contract.js` enforces
      `CATALOG_SCHEMA_VERSION`, `assertVersionedCatalogPayload`,
      `createVersionedGsavCatalog`, and the shared `normalizeCatalogPage`
      boundary.
    - `npx vitest run services\gsav.test.ts
      features\catalog\catalogAdapter.test.ts
      features\social\loadSavedScenesByBackendIds.test.ts
      scripts\verify-shared-catalog-contract.test.mjs` passed.
    - `npx tsc --noEmit` passed.
    - `npm run verify:shared-catalog-contract` passed.
    - Validation still pending: capture browser and native preview first-page
      parity after a backend reset.

- [ ] Define social and auth contracts outside UI.
  - Contracts:
    - saved scenes.
    - follows.
    - comments.
    - danmaku.
    - notifications where web-owned.
  - Verification:
    - UI components import feature accessors or service adapters, not raw
      Supabase table logic unless explicitly allowed.
  - Validation:
    - Save/follow in one client and observe expected state in the other after
      refresh or session handoff.
  - Current evidence:
    - Native social writes and reads are centralized in
      `features/social/socialAdapter.ts` over shared `@opsiclear/gsav-client`
      helpers.
    - Native auth/session state is exposed through
      `features/social/authSession.ts`; player session handoff uses
      `features/player/sessionBridge.ts` and `@opsiclear/gsav-bridge`.
    - `npm run verify:import-boundaries` rejects UI-level direct Supabase,
      raw social-store, and direct shared-package access outside documented
      adapters.
    - `npx vitest run scripts\verify-import-boundaries.test.mjs` passed.
    - Validation still pending: save/follow in one client and observe matching
      state in the other after refresh or session handoff.

## Phase 5: Native/Web Ownership Boundary

- [ ] Write a concise ownership matrix.
  - Native owns:
    - Home/feed.
    - Search.
    - Creator profile.
    - Library.
    - Login/account entry.
    - Settings.
    - Native route transitions.
  - Web owns:
    - Browser product routes.
    - GSAV decode/render/playback.
    - Upload/publish web workflow unless explicitly moved native.
    - Hosted explore runtime exception.
  - Backend owns:
    - Catalog data.
    - Auth.
    - Social state.
    - Storage and asset publishing.
  - Verification:
    - `npm run verify:import-boundaries`.
    - `npm run verify:docs-drift`.
  - Validation:
    - Reviewer can map every top-level route to exactly one owner.
  - Current evidence:
    - `docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md` includes an ownership boundary
      table, route taxonomy, route outcomes, component map, and bridge owner
      table.
    - `scripts/verify-import-boundaries.js` enforces `appRouteOwnerMap`, route
      adapter shape, feature/service ownership, and documented sibling-feature
      exceptions.
    - `npm run verify:import-boundaries` passed.
    - `npm run verify:docs-drift` passed.
    - Validation still pending: reviewer route-owner mapping signoff.

- [ ] Keep Expo route files as adapters.
  - Verification:
    - Route files remain one-line or thin wrappers.
    - Business logic stays in `features/`.
  - Validation:
    - Deep links still open expected screens.
  - Current evidence:
    - `scripts/verify-import-boundaries.js` rejects app route files that are
      not export-only default re-export adapters.
    - `npx vitest run scripts\verify-import-boundaries.test.mjs` passed.
    - `npm run verify:import-boundaries` passed.
    - Validation still pending: deep-link smoke across expected screens.

- [ ] Keep web product routes out of native except documented embeds.
  - Allowed native embeds:
    - `/watch/:id?embed=native`
    - `/explore?embed=native&dataSaver=1`
    - `/native-diagnostics?embed=native`
  - Verification:
    - WebView route gate tests reject same-origin hosted product paths not in
      the allowlist.
  - Validation:
    - Android and iOS show fail-closed state for blocked same-origin product
      routes.
  - Current evidence:
    - `docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md` documents allowed embedded
      routes and fail-closed same-origin product routes.
    - `features/player/bridge.test.ts` covers route allowlists and navigation
      trust behavior.
    - `npm run verify:import-boundaries` enforces that native embed URL
      construction stays under `features/player`.
    - Validation still pending: Android/iOS blocked-route evidence.

## Phase 6: Embed Bridge Contract

- [x] Document the bridge message schema.
  - Allowed message groups:
    - auth ready.
    - set/clear session.
    - playback ready.
    - playback progress.
    - playback ended/error.
    - diagnostics events.
  - Verification:
    - Type tests or unit tests reject unknown message versions.
    - Bridge parser is resilient to malformed JSON and unrelated messages.
  - Validation:
    - Native route receives playback ready and progress from web player.
  - Current evidence:
    - Message groups and version/origin rules are documented in
      `docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md`.
    - `features/player/bridge.test.ts` covers malformed JSON, version
      compatibility, reducer behavior, session handoff, navigation trust, and
      route allowlists.
  - Validation evidence:
    - `docs/qa-evidence/local-gsav-runtime-smoke.json` shows
      `/explore?embed=native&dataSaver=1`, `/native-diagnostics?embed=native`,
      and `/watch/test?embed=native` emitted compatible `GSAV_BRIDGE_READY`
      messages.
    - The watch smoke accepted a native `play` command and observed playback
      bridge output.

- [ ] Define bridge origin rules.
  - Native should only trust configured web origin.
  - Web should only trust configured native shell origins.
  - Verification:
    - Tests cover allowed and rejected origins.
    - `dev:doctor` confirms active origins match env config.
  - Validation:
    - Browser console no longer logs target-origin mismatch for expected native
      preview origins.
  - Current evidence:
    - `features/player/navGate.ts` is the allowlist-positive navigation and
      bridge-origin trust gate for native embeds.
    - `features/player/nativeBridgeMessage.ts` derives inbound message origin
      from the platform-reported page URL and ignores untrusted origins before
      session or progress handling.
    - `features/player/useGsavEmbedHost.ts` derives `allowedOrigin` from the
      configured GSAV web URL and passes it into both navigation and bridge
      message handling.
    - `features/player/GsavWebView.web.tsx` answers iframe
      `GSAV_AUTH_READY` only when `event.origin` matches the configured origin,
      and `features/player/sessionBridge.ts` posts iframe session messages only
      with a non-empty strict `targetOrigin`.
    - `scripts/verify-bridge-origin-contract.js` enforces those source
      contracts and is included in `npm run verify:local` after import-boundary
      checks.
    - `npx vitest run scripts/verify-bridge-origin-contract.test.mjs` passed.
    - `node scripts/verify-bridge-origin-contract.js` passed.
    - Validation still pending: run browser/native preview and confirm the
      expected shell origins do not produce target-origin console warnings.

- [ ] Keep bridge out of backend responsibilities.
  - Bridge must not perform catalog CRUD, social writes, upload finalization, or
    moderation actions.
  - Verification:
    - Import-boundary or grep-based check rejects backend API names in bridge
      modules unless explicitly allowed.
  - Validation:
    - Product flows still work when bridge is disabled except embedded playback
      state and session handoff.
  - Current evidence:
    - `scripts/verify-import-boundaries.js` rejects catalog CRUD, social write,
      upload finalization, moderation, and Supabase table-operation markers in
      non-test player bridge modules.
    - `scripts/verify-import-boundaries.test.mjs` covers the bridge backend
      isolation rule.
    - `npm run verify:import-boundaries` passed.

## Phase 7: Auth And Session Model

- [ ] Define the canonical auth owner per runtime.
  - Backend owns auth records and tokens.
  - Native owns native session persistence.
  - Web owns browser session persistence.
  - Bridge owns explicit session handoff only during embed.
  - Verification:
    - `services/supabase.ts` uses native storage.
    - Web `supabaseClient.ts` uses browser storage.
    - No shared localStorage assumptions in native code.
  - Validation:
    - Sign in native, open embedded watch route, confirm web receives the
      intended session state.
    - Sign out native, confirm embedded web session clears.
  - Current evidence:
    - `services/supabase.ts` owns the native Supabase client, persists via
      AsyncStorage, and disables URL-session detection.
    - gsav-hosting `src/backend/supabaseClient.ts` owns the browser Supabase
      client and uses browser persistence.
    - `features/player/sessionBridge.ts` builds versioned session handoff
      messages from `@opsiclear/gsav-bridge`.
    - `scripts/verify-import-boundaries.js` now rejects browser
      `localStorage`/`sessionStorage` assumptions in native source and enforces
      the native Supabase auth-owner shape.
    - `npx vitest run scripts\verify-import-boundaries.test.mjs` passed.
    - `npm run verify:import-boundaries` passed.
    - Validation still pending: signed-in and signed-out session handoff on an
      embedded watch route.

- [ ] Add account-safe QA fixtures.
  - Verification:
    - Fixture seed script avoids real user identifiers in committed evidence.
    - Tests redact tokens and account identifiers in logs.
  - Validation:
    - Saved/followed state appears in native library and web account routes for
      the QA account.
  - Current evidence:
    - `scripts/verify-handoff-receipts.js` validates completed
      `fixture-manifest.json` files and now rejects raw email domains, URL
      credentials, secret-shaped tokens, raw auth-token assignments, raw
      account identifiers, and weak `redactionNotes`.
    - `scripts/verify-handoff-receipts.test.mjs` covers account-safe fixture
      manifests, unredacted email rejection, token assignment rejection, raw
      account ID rejection, URL credential rejection, and missing redaction
      notes.
    - `npx vitest run scripts/verify-handoff-receipts.test.mjs` passed.
    - `npm run verify:handoff-receipts -- --allow-pending` still reports the
      same missing owner, fixture, and host-ready receipt blockers without
      promoting incomplete evidence.
    - Validation still pending: create the reviewed release-owned QA account
      fixture, seed saved/follow state, and prove it appears in native Library
      plus web account routes with account-safe evidence.

## Phase 8: UX Consistency Across Clients

- [ ] Run the dedicated UI design cleanup checklist.
  - Checklist:
    - `docs/UI_DESIGN_CLEANUP_CHECKLIST.md`
  - Verification:
    - Each completed UI item has command evidence, source checks, or focused
      tests.
    - Before/after screenshots are saved under
      `docs/qa-evidence/<date>/design/`.
  - Validation:
    - Browser, native preview, Android WebView, and iOS WKWebView evidence is
      recorded for every claimed surface.
    - Any unvalidated surface remains unchecked with a blocker note.

- [ ] Align catalog terminology and empty/error states.
  - Native and web should use consistent words for:
    - scene.
    - creator/channel.
    - saved/library.
    - upload/publish.
  - Verification:
    - Snapshot or source checks for key visible strings if drift matters.
  - Validation:
    - Reviewer confirms the same catalog item reads coherently in native and
      web.

- [ ] Align route identity.
  - Same scene should have stable links:
    - native route: `/watch/:id`.
    - web route: `/watch/:id`.
    - backend lookup: catalog `id` or `backendId`.
  - Verification:
    - Route helper tests cover ID normalization.
  - Validation:
    - Copy/open flow from native to web lands on the same scene.
  - Current evidence:
    - Home, Search, Creator, Library, Continue Watching, player embed routing,
      and scene sharing now build watch paths through
      `shared/gsavRoutes.ts`.
    - `scripts/verify-import-boundaries.js` rejects raw native
      `/watch/${id}` or `"/watch/" + id` construction outside
      `shared/gsavRoutes.ts`.
    - `shared/gsavRoutes.test.ts` covers scene ID encoding, start time, share
      tokens, and empty IDs.
    - `features/scene/sceneShare.test.ts` covers web watch share URL
      construction from the same helper.
    - `npx vitest run shared\gsavRoutes.test.ts
      features\scene\sceneShare.test.ts
      scripts\verify-import-boundaries.test.mjs` passed.
    - `npm run verify:import-boundaries` passed.
    - Validation still pending: copy/open flow from native to web lands on the
      same scene in browser/native preview.

- [ ] Make local failure states actionable.
  - Native catalog fetch failure should mention backend reachability in dev.
  - Web upload/auth failure should mention missing Supabase config in dev.
  - Verification:
    - Unit tests cover config-missing states.
  - Validation:
    - Stop Supabase and confirm users see a useful local-dev error.
  - Current evidence:
    - `shared/gsavErrors.ts` formats native GSAV catalog failures with a local
      `npm run dev:doctor` backend/Edge Functions hint in development while
      keeping production errors short.
    - Home/feed, Search, Creator, and Library saved-scene resolution use
      `formatGsavCatalogError`.
    - `shared/gsavErrors.test.ts` covers fetch failures, catalog HTTP
      failures, catalog contract failures, production copy, and fallback copy.
    - `npx vitest run shared\gsavErrors.test.ts` passed.
    - Validation still pending: stop Supabase and confirm the visible native
      error state is useful; web upload/auth config-missing copy remains to be
      verified in gsav-hosting.

## Phase 9: Release And Evidence Gates

- [ ] Keep local smoke separate from publish validation.
  - Verification:
    - Docs explicitly label Expo web and local Vite checks as rehearsal or local
      smoke only.
    - `npm run verify:docs-drift` stays green.
  - Validation:
    - Release evidence includes Android WebView and iOS WKWebView rows where
      claimed.

- [x] Add a stack architecture receipt.
  - Receipt should include:
    - Git SHA.
    - backend URL class, redacted where needed.
    - web URL.
    - native URL or app artifact.
    - catalog schema version.
    - bridge version.
    - native/web bridge compatibility.
    - doctor result.
  - Verification:
    - Receipt generator produces deterministic JSON.
    - Receipt verifier rejects missing or stale fields.
    - Receipt verifier rejects incompatible native/web bridge version ranges.
  - Validation:
    - Local evidence packet includes
      `docs/qa-evidence/local-stack-architecture-receipt.json`.
  - Evidence:
    - `scripts/stack-architecture-receipt.js`.
    - `scripts/stack-architecture-receipt.test.mjs`.
    - `npm run stack:receipt`.
    - `npm run stack:receipt:check`.

- [ ] Update final readiness checks to include stack coherence.
  - Required coherence:
    - Native and web point at same backend profile.
    - Catalog URLs are browser/device reachable.
    - Allowed origins include the actual app origins.
    - Bridge version is compatible.
  - Verification:
    - `npm run verify:final-readiness-receipts` or a linked verifier enforces
      these conditions.
  - Validation:
    - Release candidate evidence demonstrates the same configuration in the
      artifact under test.
  - Current evidence:
    - `scripts/run-final-readiness-receipts.js` now requires
      `--stack-receipt-path docs/qa-evidence/<date>/stack-architecture-receipt.json`
      and replays it with
      `scripts/stack-architecture-receipt.js --require-assets --verify`.
    - `scripts/verify-release-readiness.js` audits the final receipt summary
      for the `Stack architecture receipt replay` step and validates the
      signed-off stack receipt JSON has asset-required doctor evidence,
      catalog schema `1`, and compatible bridge versions.
    - Validation still pending: release candidate evidence must include the
      dated reviewed stack receipt for the artifact under test.

## Phase 10: Documentation Cleanup

- [ ] Add a short "Which app do I open?" section.
  - Suggested locations:
    - `README.md`
    - `README.en.md`
  - It should say:
    - open diveo for React Native shell preview.
    - open gsav-hosting for the web app.
    - both share Supabase.
  - Verification:
    - `npm run verify:docs-drift`.
  - Validation:
    - A new developer can start the stack from docs without asking which URL to
      open.
  - Current evidence:
    - `README.md` and `README.en.md` include "Which app do I open?" guidance
      that separates the diveo React Native shell, gsav-hosting standalone web
      app/runtime, and the shared Supabase backend.
    - Validation still pending: ask a new developer or reviewer to start from
      the docs and record whether the URL ownership is clear.

- [ ] Add a "Backend is shared, web is embedded only for runtime" note.
  - Verification:
    - Architecture docs include the one-backend/two-clients diagram.
  - Validation:
    - Reviewers agree no route/data ownership is ambiguous.
  - Current evidence:
    - `docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md` documents the native/web
      ownership boundary, embedded route contract, route taxonomy, and bridge
      responsibility limits.
    - `docs/adr/0002-native-app-with-web-player.md` records the native app
      with embedded web player decision.
    - Validation still pending: reviewer signoff that route/data ownership is
      unambiguous.

- [ ] Keep environment examples non-secret and profile-oriented.
  - Verification:
    - `.env.example` files contain placeholders only.
    - Secret scanners or dependency audit do not flag committed credentials.
  - Validation:
    - Local setup works after copying examples and running the env generation
      script.
  - Current evidence:
    - `.env.example` uses empty placeholder values for the GSAV public config
      keys and points local setup at `npm run stack:env`,
      `npm run dev:stack`, and `config/stack.local.json`.
    - `scripts/verify-env-examples.js` enforces required native public env
      keys, placeholder-only example values, secret-shaped value rejection, and
      profile-oriented setup guidance.
    - `npm run verify:env-examples` verifies the committed env example and is
      included in `npm run verify:local` after dependency-audit disposition.
    - `npx vitest run scripts/verify-env-examples.test.mjs
      scripts/run-verification-bundle.test.mjs` passed.
    - `npm run verify:env-examples` passed.
    - `npm run verify:docs-drift` passed.
    - `npm run lint` passed.
    - Validation still pending: copy examples or regenerate env files from a
      clean local setup and prove the stack still starts from generated config.

## Final Acceptance Criteria

- [ ] One command starts the local stack or reports the exact missing
  prerequisite.
- [ ] One doctor command verifies backend, functions, web, native preview,
  catalog, asset URLs, and allowed origins.
- [ ] Native and web env files are generated from one stack profile.
- [ ] Catalog responses never expose container-internal hosts to clients.
- [ ] Both clients consume the same typed catalog contract.
- [ ] The embed bridge has a documented versioned schema and origin rules.
- [ ] Import-boundary and docs-drift checks protect ownership boundaries.
- [ ] Browser validation proves the GSAV web app works independently.
- [ ] Native preview validation proves diveo loads the shared catalog.
- [ ] Android/iOS validation proves embedded runtime routes where release
  claims require it.

## Suggested Command Set

```powershell
npm run dev:stack
npm run dev:doctor
npm run dev:stop
npm run stack:receipt
npm run stack:receipt:check
npm run verify:import-boundaries
npm run verify:shared-catalog-contract
npm run verify:bridge-origin-contract
npm run verify:docs-drift
npm run verify:env-examples
npm run verify:handoff-receipts -- --allow-pending
npm run gsav:preflight
npm test
npx tsc --noEmit
npm run lint
```

For gsav-hosting:

```powershell
cd ..\gsav-hosting
npm run supabase:start
npm run supabase:functions:serve
npm run dev:web
npm run supabase:test
npm run catalog:validate
npm run test:web
```
