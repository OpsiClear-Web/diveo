# GSAV Native Implementation Plan

Date: 2026-07-03

## How To Use This Plan

This is the active release runbook. `AGENTS.md` already exists at the repository
root; do not overwrite or modify it during implementation-plan work. Follow its
repo defaults: install with `npm ci`, keep work GSAV-native, freeze legacy
Bilibili/proxy code except removal or safety fixes, use strict TypeScript with
two-space indentation and double quotes, keep reusable logic in feature modules,
`services/`, or `utils/`, and never commit secrets.

Active read path: ADR 0002, `docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md`, Ordered
Evidence Gate Sequence, G0 through G7, `docs/GSAV_NATIVE_QA.md`,
`docs/IMPLEMENTATION_VALIDATION_AUDIT.md`, and the final publish or no-publish
decision. Verification is local proof from tests, static checks, scripts, or CI.
Validation is observed Android WebView, iOS WKWebView, production GSAV host,
generated APK/manifest, or GitHub Actions proof. Current release state:
30 checked rows with 29 pending publish evidence rows and 22 pending device packets.
scope=pre-g3-no-publish-baseline; invalidAfter=first Release APK
workflow_dispatch fixed-candidate dry run.
Active read path: ADR 0002 shell architecture Ordered Evidence Gate Sequence G0
through G7 QA audit final decision.

### Current Execution Snapshot

Current status is no-publish. Canonical operator path:

| Step | Required proof |
| --- | --- |
| Architecture lock | `npm run verify:import-boundaries`; `npm run verify:docs-drift` |
| External artifact materialization | Record `downloadedPath`, `sha256`, `sourceRunId`, and `sourceArtifactId` under `docs/qa-evidence/<date>/external/<sourceRunId>/<sourceArtifactId>/` |
| Packet lifecycle | Use a reviewed non-scaffold packet plus `product-journey-manifest.json`; scaffold, candidate, pending, or example packets are planning evidence only |
| Final local gate | `npm run verify:final-readiness-receipts` is the canonical final wrapper; raw packet/inventory-aware `verify:release-readiness` is diagnostic outside the wrapper |

Freshness rule: publish-counted rows must be same-candidate, non-future-dated,
inside the 7-day freshness window, and recaptured when source, workflow,
dependency, route ownership, GSAV host URL, host identity, APK/manifest,
WebView/WKWebView version, fixture, evidence schema, QA schema, or verifier
rules change.

### Detailed Implementation Roadmap

Reviewer lenses for this pass: architecture boundary, product workflow, and
release evidence. Detailed V&V workstream plan:

| Workstream | Scope | Proof |
| --- | --- | --- |
| W0 boundary lock | Expo route stubs, one embed boundary, `/explore` exception, no new legacy/Bilibili coupling | `npm run verify:import-boundaries`, route tests |
| W1 native product journey | Home, Search, Creator, Library, Login, Settings native-owned | Typecheck, lint, focused tests, G6 product evidence |
| W2 hosted Explore runtime | Browser-usable like YouTube Shorts/TikTok: vertical feed, URL restore, keyboard/touch/wheel/trackpad navigation | Hosted tests, Playwright desktop/mobile, runtime smoke, Android/iOS/browser active-scene evidence |
| W3 player/degraded states | One native player surface for `/watch/:id` and `/gsav/:id` | Player tests, preflight, runtime smoke, Android/iOS rows |
| W4 evidence packet | Reviewed route, negative, and product-journey manifests with stable IDs, hashes, metadata, `artifactPurpose`, `helperOnly=false`, and semantic `observedSignals` | Packet check plus inventory replay |
| W5 release validation sequence | Execute only G0 through G7 from no-publish baseline to final receipts | Dated receipts, fixed G3 artifact, reviewed G6 packet/inventory, protected-candidate proof, G7 final receipts |

R0 structure lock blocks route/import drift and a second hosted browse system.
R7 final review and release decision requires reviewed inventory, reviewed
packet, QA/audit alignment, protected-candidate proof, final command receipts,
strict handoff replay, and `verify:final-readiness-receipts`. G0 through G7
remain authoritative; decision=no-publish is the default. Operator execution
sequence: three-agent architecture decision, G0/G1 baseline, G3 dry run, G6
device/product validation, and G7 final receipts; local-only evidence cannot
promote publish rows; noPublishRehearsal=false.

### Release Structure Lock

React Native owns native browse/search/creator/library/login/settings.
`features/player/` is the only native WebView/iframe boundary. `/explore` is
the only release-scoped hosted browse exception. The sibling allowlist remains
at 12 entries. Expo web iframe evidence remains rehearsal-only.

Target module structure: `app/` One-line Expo Router adapters;
`features/app-shell/` Bootstrap, providers; `features/catalog/`,
`features/social/`, `features/settings/`, `features/preferences/`,
`features/scene/`, `features/app-update/` Native product surfaces;
`features/player/` Only WebView/iframe host; `shared/` Pure
route/config/auth-return/theme/UI primitives; `services/` Thin vendor/client
adapters. Structure cleanup implemented locally:
`features/catalog/ContinueWatchingPill.tsx` is Catalog-owned and
`features/player/resumeAccess.ts` exposes only the resume state/action contract
so catalog owns placement and presentation. `services/gsav.ts` is the allowed
catalog facade for `@opsiclear/gsav-client`; `shared/themeContext.tsx` owns
app-wide theme reads.

Public contract inventory: `features/player/resumeAccess.ts`,
`features/social/authSession.ts`, `features/social/savedSceneAccess.ts`,
`features/preferences/preferenceAccess.ts`,
`features/app-update/updateAccess.ts`, `features/scene/sceneShare.ts`,
`features/social/FollowButton.tsx`, `features/social/SaveSceneButton.tsx`,
`shared/routeParams.ts`, `shared/gsavRoutes.ts`, and `shared/gsavWeb.ts`.
Verification and validation: import-boundary checks, focused tests, and
product-journey evidence.

Feature contract ledger for the current sibling allowlist: The current sibling
allowlist budget is 12 entries; touched entries must be removed, narrowed, or
renewed with owner, expiry, and exit criteria. Post-release elegance target:
reduce the sibling allowlist below 12 by moving UI composition edges toward
props or facades while keeping cross-feature imports limited to access
contracts; `npm run verify:import-boundaries` and product-journey evidence
prove behavior did not drift. Scene composition boundary: Catalog should pass
IDs, not social stores, player resume state, bridge state, Supabase clients, or
follow reconciliation rules; `npm run verify:import-boundaries` enforces the
direct catalog-composition guard.

Native WebView route gate: configured GSAV origin, embedded hosted route
allowlist, same-origin hosted catalog/account/studio/upload paths, Navigation
blocked, and Focused player tests cover the fail-closed contract. same-origin
hosted product paths fail closed for this release; future native handoff
requires ADR 0002, `features/player/nativeNavigation.ts`, QA rows, and a
no-publish pass. same-origin product-path QA control trigger:
`/gsav-diagnostics` with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1`, tap `Same-origin`,
navigate to `/creator/qa-native-blocked`, record `sameOriginProductPathOutcome`,
and fill the negative readiness row. same-origin packet verifier:
`device-evidence:packet --check` verifies `sameOriginProductPathOutcome`,
`Same-origin`, `/creator/qa-native-blocked`, and `Navigation blocked`.

### Explore Hosted Exception Contract

`/explore` is a Shorts-style runtime discovery surface owned by
`features/player/ExploreScreen.tsx`; it must work like YouTube Shorts in a
browser while staying secondary/runtime-scoped in native.

| Mode | Contract | Proof |
| --- | --- | --- |
| Browser mode | Full-viewport vertical feed, touch/wheel/trackpad navigation, keyboard controls, URL/deep-link restore | Browser Playwright desktop/mobile navigation tests and hosted route tests |
| Native embed mode | Loads `/explore?embed=native`, carries exactly one `embed=native`, adds `dataSaver=1`, hides hosted public/account chrome, and blocks same-origin hosted product paths | `npm run verify:import-boundaries`, runtime smoke, Android and iOS `/explore` rows |

Validation must show vertical swipe/scroll and visible active-scene change. Exit
criteria to move native: replace ADR 0002, change route ownership, update
runtime smoke and import-boundary rules, and recapture Android/iOS evidence.

### Boundary Owner Matrix

| Boundary | Owner | Review lens |
| --- | --- | --- |
| React Native shell | `app/`, `features/app-shell/`, native feature folders | No business logic in route adapters |
| Player embed boundary | `features/player/` | Only owner of WebView/iframe and native embed URL construction |
| Hosted GSAV runtime | `../gsav-hosting/apps/web` | Decode/render/playback/runtime and `/explore` behavior |
| Evidence review | QA/audit docs and verifier scripts | Same-candidate, byte-backed, reviewed proof |

## Architecture Snapshot

```text
app/                 Expo Router route stubs and layouts only
features/app-shell/  app bootstrap, providers, fonts, startup effects
features/player/     WebView/iframe host, watch screen, bridge, resume, URL gates
features/catalog/    native feed, search, creator, catalog adapters
features/scene/      shared scene presentation, scene types, share helpers
features/social/     auth, saved scenes, follows, Supabase-facing state
features/preferences/ global settings store, theme preference, data saver state
features/settings/   settings screen and cache controls
features/app-update/ APK update flow
shared/              reusable UI, theme tokens, route/config helpers
services/            thin external clients only
utils/               pure generic helpers only
legacy/ or removed   frozen Bilibili/DASH/proxy code
```

Route stub map:

| Expo route | Feature owner |
| --- | --- |
| `app/_layout.tsx` | `features/app-shell/RootLayout.tsx` |
| `app/creator/_layout.tsx` | `features/app-shell/CreatorLayout.tsx` |
| `app/index.tsx` | `features/catalog/HomeScreen.tsx` |
| `app/search.tsx` | `features/catalog/SearchScreen.tsx` |
| `app/creator/[handle].tsx` | `features/catalog/CreatorScreen.tsx` |
| `app/library.tsx` | `features/social/LibraryScreen.tsx` |
| `app/login.tsx` | `features/social/LoginScreen.tsx` |
| `app/settings.tsx` | `features/settings/SettingsScreen.tsx` |
| `app/explore.tsx` | `features/player/ExploreScreen.tsx` hosted runtime exception |
| `app/gsav-diagnostics.tsx` | `features/player/GsavDiagnosticsScreen.tsx` |
| `app/watch/[id].tsx` | `features/player/GsavScreen.tsx` |
| `app/gsav/[id].tsx` | `features/player/GsavScreen.tsx` alias |

Hosted-runtime path contract: `/watch/:id` and `/gsav/:id` map to
`/watch/:id?embed=native`; `/explore` maps to `/explore?embed=native` plus
`dataSaver=1`; `/gsav-diagnostics` maps to `/native-diagnostics?embed=native`.
Rows must prove hidden chrome, bridge readiness, route change, resume/start-time,
active-scene change, or the expected negative state.

QA fixture controls are platform-scoped: native Android/iOS
`features/player/GsavWebView.tsx` renders QA buttons when
`EXPO_PUBLIC_GSAV_QA_CONTROLS=1`; Expo web preview
`features/player/GsavWebView.web.tsx` accepts `qaControls` for parity but
ignores it because the iframe host has no native overlay controls. Production
builds must have QA flags unset or `0`.

Route presentation register:

| `appRouteOwnerMap` entry | Current presentation decision |
| --- | --- |
| `app/_layout` | Root layout wrapper; not an `AppStack` child screen |
| `app/index` | Explicit `AppStack` presentation using default options |
| `app/search` | Explicit `AppStack` presentation with slide transition |
| `app/creator/_layout` and `app/creator/[handle]` | Explicit `AppStack` presentation for the creator group and handle route |
| `app/explore` | Explicit `AppStack` presentation with slide transition |
| `app/gsav-diagnostics` | Explicit `AppStack` presentation with slide transition |
| `app/gsav/[id]` | Explicit `AppStack` presentation for the GSAV alias group |
| `app/watch/[id]` | Explicit `AppStack` presentation for the player group |
| `app/library` | Intentional Expo Router default stack behavior |
| `app/login` | Intentional Expo Router default stack behavior |
| `app/settings` | Explicit `AppStack` presentation with slide transition |

## GSAV Host Handoff Contract

| Required input | Evidence field |
| --- | --- |
| GSAV web origin | `EXPO_PUBLIC_GSAV_WEB_URL` / QA row GSAV web URL |
| Host/build identity | `GSAV_HOSTING_COMMIT` in `release-evidence/gsav-preflight.json` and runtime smoke |
| Metadata endpoint | `GSAV_HOST_IDENTITY_URL`; preflight records `hostIdentityVerified=true`, `hostIdentity.url`, `hostIdentity.expectedIdentity`, and `observedIdentity` matching `GSAV_HOSTING_COMMIT` |
| Byte-range fixture | `GSAV_RANGE_PROBE_URL` returns `206`, exact `Content-Range: bytes 0-0/<decimal-size>`, and `Access-Control-Expose-Headers=Accept-Ranges, Content-Length, Content-Range, ETag` |

After the Phase 0 hosting snapshot, `GSAV_HOSTING_COMMIT` should be a real
`gsav-hosting` git SHA. The current local baseline is
`8c34bca78067f732e09307e4c833038e9637b0b4`; deployed evidence should use the
exact SHA served by the target host.

Local rehearsal may use the emulator/simulator URLs for confidence only.
Publish-counted Android/iOS rows must use production HTTPS or
release-equivalent staging. Android publish readiness plus Android and iOS
embedded route validation is in scope. Because `app.json` keeps
`ios.supportsTablet=true`, any iOS distribution claim must include iPad/tablet
ergonomics evidence or a scoped no-publish exception; Phone-only WKWebView
evidence is not enough for an iOS distribution claim.

Exception policy: exceptions are temporary validation blockers with owner, gate,
expiry, and revisit date. mismatched exception gates keep rows pending. expired
`acceptedRisk.revisitBy` blocks automatically. Negative-path verifier passes
expected-fail terminology only for the validation-prereq blocker /
`verify:validation-prereqs` case and the native production-config negative /
Production config negative case; known missing production env, unrelated crash,
or missing JSON is not a publish pass. Evidence invalidation rules: Payload SHA
change returns G3-G5 rows to pending; GSAV host URL, Route ownership, Device OS,
or QA schema change refresh packets, rerun docs drift, inventory replay, packet
check, and candidate-pinned readiness; mark rows stale and repeat the affected
gate.

## Verification And Validation

Minimum local verification:

```powershell
npm run verify:local
npm run verify:release-candidate
npm run verify:release-candidate -- --date <YYYY-MM-DD> --candidate-sha <payload-sha>
npm run verify:validation-prereqs
npm run verify:workflows
```

Release artifact prerequisite replay:

```powershell
npm run verify:validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --ios-artifact-path "$IOS_VALIDATION_ARTIFACT_PATH" --output-path "$VALIDATION_PREREQS_PATH"
npm run release-evidence:attach-validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --evidence-dir release-evidence --validation-prereqs-path "$VALIDATION_PREREQS_PATH" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH"
npm run verify:release-evidence-bundle -- --root "$DOWNLOADED_RELEASE_DIR" --evidence-dir release-evidence --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --mode dry-run --require-validation-prereqs true
```

Before G7, `$DOWNLOADED_RELEASE_DIR/$VALIDATION_PREREQS_PATH` must exist.
`release-evidence:attach-validation-prereqs` adds the prerequisite JSON
`validation-prereqs.json` and the iOS artifact under `release-evidence/`;
`dry-run-summary.json` and `evidence-checksums.txt` reference it; the
`--require-validation-prereqs true` replay recomputes current iOS artifact
SHA256 bytes. Keep
`device-validation-evidence/device-validation-bundle-verifier.json` outside
`downloaded-release/release-evidence/**`. Validation prereqs marker:
`release-evidence/validation-prereqs.json`.

For iOS materialization:

```powershell
node scripts/materialize-ios-validation-artifact.js --url "$IOS_VALIDATION_ARTIFACT_URL" --output-path "$DOWNLOADED_RELEASE_DIR/$IOS_VALIDATION_ARTIFACT_PATH" --expected-sha256 "$IOS_VALIDATION_ARTIFACT_SHA256"
```

`device-validation.yml` dispatch inputs: `release_run_id` digits only,
`artifact_name=diveo-release-evidence-v<semver>`, `evidence_date=YYYY-MM-DD`,
and `release_artifact_url` as a trusted Diveo GitHub Actions run, Actions
artifact, or release asset download URL. `dry-run-summary.json` `artifactName`
must match `inputs.artifact_name`. iOS validation inputs include
`ios_validation_owner`, `ios_validation_executor_proof`,
`ios_validation_device`, `ios_validation_version`, `ios_wkwebview_version`,
`ios_validation_artifact_url` as a trusted iOS artifact URL from a direct
Actions artifact, release asset download, or `docs/qa-evidence` blob under
`opsiclear/diveo`, `OpsiClear-Web/diveo`, or `opsiclear/gsav-hosting`, plus
`ios_validation_artifact_sha256` / `IOS_VALIDATION_ARTIFACT_SHA256` as a
64-hex iOS artifact SHA256. Upload name:
`diveo-device-validation-${{ inputs.evidence_date }}-${{ inputs.release_run_id }}`.
`deviceValidationWorkflowPresent` must show the remote `Device Validation`
workflow active on GitHub; a local or untracked workflow is a no-publish
blocker. `RELEASE_EVIDENCE_MODE` is dry-run for pre-publish validation.

### Release Evidence Bundle File List

The release workflow uploads `release-evidence/**` with `if-no-files-found:
error`. The dry-run evidence files are `release-evidence/release-candidate.txt`,
`release-evidence/signoff-diff-files.txt`,
`release-evidence/no-publish-side-effect.txt`,
`release-evidence/gsav-preflight.json`,
`release-evidence/gsav-runtime-smoke.json`,
`release-evidence/dry-run-summary.json`, and
`release-evidence/evidence-checksums.txt`. The full bundle also includes:
`release-evidence/native-production-config-before-bump.json`,
`release-evidence/native-production-config-after-bump.json`,
`release-evidence/version.txt`, `release-evidence/app-version-metadata.json`,
`release-evidence/gradle-version-code.txt`,
`release-evidence/release-artifact.json`, and
`release-evidence/apk-version-metadata.txt`.

`write-release-evidence-summary.js` requires `release-candidate.txt` to contain
`releaseCandidateSha`, `appVersion`, `packageVersion`, and
`androidVersionCode`; `RELEASE_CANDIDATE_SHA` must match, versions are semver
matching `releaseVersion`, and `androidVersionCode` is numeric. Dry-run
templates use `artifactName=diveo-release-evidence-v<version>` and
`publishArtifactIdentitySha256=<64-hex sha>`. They also record
`gsavPackageProvenanceSha256=<64-hex sha>`, `gsavPackageProvenance` for
`@opsiclear/gsav-bridge` with
`specifier=file:vendor/opsiclear-gsav-bridge-<version>.tgz` and
`tarballSha256=<64-hex sha>`, plus `gsavPackageProvenance` for
`@opsiclear/gsav-client` with
`specifier=file:vendor/opsiclear-gsav-client-<version>.tgz` and
`tarballSha256=<64-hex sha>`.

Manual publish dispatch inputs `expected_apk_sha256` and
`expected_publish_identity_sha256` come from the reviewed dry-run artifact and
must match `dry-run-summary.json` `apkSha256` and
`publishArtifactIdentitySha256`. Release-candidate identity rule:
`releaseCandidateSha`, `candidate_ref`, and `evidenceSignoffSha` describe the
same run ID and frozen payload candidate; publish uses `--target` for the
verified payload SHA. `releaseWorkflowForbidsQaFlags`, `qaControlsDisabled`,
and `qaAuthDelayDisabled` must be true.

## Reviewed Evidence And Packet Rules

Fixed row set: 30 publish-readiness rows include Host preflight and GSAV target
routes. Row detail evidence URLs must be trusted GitHub evidence, and the only
trusted GitHub CI/artifact/release URL under `opsiclear/diveo`,
`OpsiClear-Web/diveo`, or `opsiclear/gsav-hosting` may count; release tag pages
are context only unless paired with direct Actions artifacts, release asset
download, or `docs/qa-evidence` blob evidence. Unsupported mixed evidence
entries remain pending. Every completed row must include required
observed-signal, candidate-identity, artifact, range-probe, dry-run, and
checksum details, with downloaded checksum-manifest SHA256 when an artifact is
reviewed.

Reviewed device packet minimum schema: every final packet is reviewed
non-scaffold evidence with `helperOnly=false`, concrete same-candidate proof,
route and negative manifests, product-journey-manifest evidence, hashes,
platform metadata, QA row references, and no scaffold/candidate/example labels.
`npm run device-evidence:packet -- --example` is for a reviewed packet
excerpt/documentation only. `device-evidence:packet --check` recomputes or
byte-checks each screenshot, recording, archive, and `mediaSha256`. For local
manifest evidence, `evidenceManifestPath` under `docs/qa-evidence/...` hashes to
`evidenceManifestSha256`.

Product journey manifest rules:

- `product-journey-manifest.json` requires unique entry IDs:
  `first-launch-home`, `search`, `creator`, `library`, `login-auth-return`,
  `watch-alias`, `explore`, `diagnostics-hierarchy`, `settings`,
  `accessibility-ergonomics`, and `degraded-blocked-states`.
- It must be valid JSON with an `entries` array, distinct Android and iOS
  `evidencePaths`, and inventory expansion where every manifest entry
  `evidencePaths` item is reviewed as byte-hashed inventory entries.
- The reviewed inventory records `artifactPurpose=product-journey-manifest`
  and `helperOnly=false`; inventory replay checks
  `product-journey-manifest.json` manifest contents with
  `artifactPurpose=product-journey-manifest` and `helperOnly=false`.
- Inventory replay rejects missing, placeholder, `unknown`, or duplicate
  product journey entry IDs.
- product journey linked evidence classification:
  product-journey-manifest `artifactPurpose=product-journey-evidence`
  `helperOnly=false`, `journeyEntryId`, `sourceRefs`, inventory `sha256`,
  `mediaSha256`, `fileSha256`, `sourceRunId`, `sourceArtifactId`, and evidence
  URL.
- product-journey-manifest observedSignals semantic markers: native Home feed
  state, keyboard visible without overlap, follow signed-out to login and
  return, signed-in seeded saved scenes, keyboard-visible native Login UI,
  `/gsav/test?t=2.5`, progress saves and resume works, exactly one
  `embed=native`, `dataSaver=1`, vertical swipe/scroll changing the active
  scene, visible active-scene change, `/native-diagnostics?embed=native`, 44dp
  touch targets, and no blank WebView.
- product-journey-manifest Explore restraint: secondary/runtime-scoped action,
  native feed Search Library Settings, exactly one `embed=native`, hidden
  hosted public/account chrome, native-shell back behavior, primary Home browse
  surface, and same-origin hosted product routes escape player boundary.

Fixture and inventory rules: `fixtureManifestPath` in the external evidence
inventory points to `fixture-manifest.json` with
`artifactPurpose=fixture-manifest`, `helperOnly=false`, and
`fixtureManifestSha256` / sha256 matching. Inventory replay checks
`fixture-manifest.json` fixture manifest contents for
`artifactPurpose=fixture-manifest` and `helperOnly=false`. product journey
inventory same-date replay: `product-journey-manifest` stays in the same
`docs/qa-evidence/<date>/` folder; stale local fixture or media from another
evidence date is rejected. route/negative manifest content classification:
`artifactPurpose=route-evidence`, `artifactPurpose=negative-evidence`,
`helperOnly=false`, `sourceRunId`, `sourceArtifactId`, and matching artifact URL
contents. route/negative manifest same-date replay: `manifestPath` and
`evidenceManifestPath` stay in the same `docs/qa-evidence/<date>/` folder as
the inventory evidence date; stale route or negative manifests from another
evidence date are rejected. packet local evidence same-date replay:
`actual.evidencePaths`, `actual.evidenceManifestPath`, packet target evidence
date, `docs/qa-evidence/<date>/`, stale local route or negative packet evidence
from another evidence date are rejected.

External artifact review procedure: materialize each external artifact under
`docs/qa-evidence/<date>/external/<sourceRunId>/<sourceArtifactId>/`, record
`downloadedPath`, `sourceRunId`, `sourceArtifactId`, `sha256`, artifact URL,
reviewer, reviewedAt, and category-specific proof, then run strict
git-integrity replay. External evidence review ledger coverage must span
release dry run, validation prerequisites/device-validation bundle, APK and
generated metadata, installed APK smoke, production runtime smoke and range
probe, product journey manifest, Android/iOS route rows, negative validation
rows, and branch protection. Each ledger row needs durable reviewed artifact
reference, concrete reviewer, ISO timestamp, category-specific proof, 64-hex
hashes, trusted GitHub artifact URLs, generated `versionCode`,
`GSAV_HOSTING_COMMIT`, `Content-Range`, and CORS header.

External evidence commands:

```powershell
npm run external-evidence:scaffold -- --packet-path <reviewed-packet.json> --output-path docs/qa-evidence/<date>/external-evidence-inventory-scaffold.json
npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json>
npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json> --require-git-integrity
```

product journey external evidence scaffold hints:
`external-evidence:scaffold` product-journey
`productJourneyExpectedSha256Field`, `productJourneyExpectedSha256`,
`productJourneySourceRunId`, and `productJourneySourceArtifactId`.

Negative trigger matrix: missing host config, host offline/retry, cross-origin
navigation, unsupported renderer, auth initialization delay, same-origin product
path block, production no-QA-flag proof, and Ended playback must have named
Android and iOS triggers before promotion.

### Machine-Checked Anchors

These compact lines preserve verifier-readable contracts without re-expanding
historical narrative:

- Explore Hosted Exception Contract: Shorts-style browser mode native embed boundary verification validation exit criteria.
- Operator execution sequence: three-agent architecture decision G0/G1 baseline G3 dry run G6 device/product validation G7 final receipts local-only evidence cannot promote publish rows.
- G7 passes only with decision=publish; decision=no-publish hold or rehearsal; --expect-readiness-fail rehearsal only.
- active G6/G7 command handoff: device-evidence-packet-candidate reviewed packet diveo-release-evidence-v external inventory scaffold human CLI download SHA256 last-mile prepublish --strict-final-inputs env vars final readiness receipts.
- product-journey-manifest evidencePaths inventory expansion: every manifest entry evidencePaths item reviewed as byte-hashed inventory entries.
- product journey inventory same-date replay: product-journey-manifest.json same docs/qa-evidence/<date>/ folder stale local fixture media paths another evidence date.
- External artifact review procedure: materialize, hash, review, record category proof, then run strict git-integrity replay.
- route/negative manifest content classification: artifactPurpose=route-evidence artifactPurpose=negative-evidence helperOnly=false sourceRunId sourceArtifactId matching artifact URL contents.
- packet local evidence same-date replay: actual.evidencePaths actual.evidenceManifestPath packet target evidence date docs/qa-evidence/<date>/ stale local route or negative packet evidence another evidence date.
- Evidence invalidation rules: return rows pending refresh packets rerun docs drift inventory replay packet check candidate-pinned readiness mark rows stale repeat affected gate.
- Scene composition boundary: Catalog should pass IDs, not social stores, player resume state, bridge state, Supabase clients, or follow reconciliation rules; npm run verify:import-boundaries enforces the direct catalog-composition guard.
- Native WebView route gate: configured GSAV origin, embedded hosted route allowlist, same-origin hosted catalog/account/studio/upload paths, Navigation blocked, and Focused player tests cover the fail-closed contract.
- same-origin hosted product paths fail closed for this release; future native handoff requires ADR 0002, features/player/nativeNavigation.ts, QA rows, and a no-publish pass.
- target module structure: app features/app-shell native feature modules features/player shared services implemented ContinueWatchingPill cleanup.
- public contract inventory: resumeAccess authSession savedSceneAccess preferenceAccess updateAccess sceneShare social UI composition shared route helpers verification validation.
- post-release elegance target: reduce sibling allowlist below 12 props or facades access contracts verify import boundaries product-journey evidence.
- The current sibling allowlist budget is 12 entries.
- release_run_id digits artifact_name diveo-release-evidence-v<semver> evidence_date YYYY-MM-DD release_artifact_url trusted Diveo GitHub Actions run Actions artifact release asset download URL.
- final receipt internal command binding: focused tests inventory replay device packet handoff receipts protected master protected candidate required commands.
- product-journey-manifest.json valid JSON entries array inventory expansion.
- product journey linked evidence classification: product-journey-manifest artifactPurpose=product-journey-evidence helperOnly=false journeyEntryId sourceRefs inventory sha256 mediaSha256 fileSha256 sourceRunId sourceArtifactId evidence URL.
- product-journey-manifest observedSignals semantic markers: native Home feed state keyboard visible without overlap follow signed-out to login and return signed-in seeded saved scenes keyboard-visible native Login UI /gsav/test?t=2.5 progress saves and resume works exactly one embed=native dataSaver=1 vertical swipe/scroll changing the active scene visible active-scene change /native-diagnostics?embed=native 44dp touch targets no blank WebView.
- product-journey-manifest Explore restraint: secondary/runtime-scoped action native feed Search Library Settings exactly one embed=native hidden hosted public/account chrome native-shell back behavior primary Home browse surface same-origin hosted product routes escape player boundary.
- required observed-signal, candidate-identity, artifact, range-probe, dry-run, and checksum details.
- trusted GitHub CI/artifact/release URL under `opsiclear/diveo`, `OpsiClear-Web/diveo`, or `opsiclear/gsav-hosting`.
- row detail evidence URLs must be trusted GitHub evidence.
- unsupported mixed evidence entries.
- ios.supportsTablet=true requires iPad/tablet ergonomics evidence or a scoped no-publish exception; Phone-only WKWebView evidence is not enough for an iOS distribution claim.
- services/gsav.ts allowed catalog facade.
- Active read path: ADR 0002 docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md Ordered Evidence Gate Sequence G0 G7 docs/GSAV_NATIVE_QA.md docs/IMPLEMENTATION_VALIDATION_AUDIT.md final publish or no-publish decision.
- ### Explore Hosted Exception Contract terms: Shorts-style runtime discovery surface features/player/ExploreScreen.tsx Browser mode YouTube Shorts full-viewport vertical feed touch/wheel/trackpad navigation keyboard controls URL/deep-link restore Native embed mode /explore?embed=native dataSaver=1 same-origin hosted product paths npm run verify:import-boundaries browser Playwright desktop/mobile navigation tests Android and iOS `/explore` rows vertical swipe/scroll visible active-scene change Exit criteria to move native.
- Operator execution sequence: three-agent review React Native product shell plus single player embed boundary never promote a publish row local-only evidence G0/G1 local baseline G3 dry-run artifact G6 device/product validation G7 final receipts noPublishRehearsal=false.
- G7 passes only with `decision=publish`; `decision=no-publish` remains a valid hold or rehearsal state; `--expect-readiness-fail` is rehearsal only.
- G6 command handoff: device-evidence-packet-candidate.json device-evidence-packet-reviewed.json --dry-run-artifact diveo-release-evidence-v<version> --dry-run-run-url. G7 command handoff: external-evidence-inventory-scaffold.json GitHub CLI or browser-authenticated download recompute SHA256 github-release-state-prepublish.json publish-hash-variable-guard-prepublish.json DEVICE_EVIDENCE_PACKET_PATH EXTERNAL_EVIDENCE_INVENTORY_PATH --strict-final-inputs verify:final-readiness-receipts.
- product-journey-manifest.json every manifest entry evidencePaths item reviewed as byte-hashed inventory entries.
- route/negative manifest contents artifactPurpose=route-evidence artifactPurpose=negative-evidence helperOnly=false sourceRunId sourceArtifactId matching artifact URL.
- Evidence invalidation rules: Payload SHA Return G3-G5 rows to pending GSAV host URL Route ownership Device OS QA schema Rerun docs drift inventory replay packet check candidate-pinned readiness Mark rows stale repeat the affected gate.
- Target module structure: `app/` One-line Expo Router adapters `features/app-shell/` Bootstrap, providers `features/catalog/`, `features/social/`, `features/settings/`, `features/preferences/`, `features/scene/`, `features/app-update/` Native product surfaces `features/player/` Only WebView/iframe host `shared/` Pure route/config/auth-return/theme/UI primitives `services/` Thin vendor/client adapters Structure cleanup implemented locally ContinueWatchingPill resumeAccess exposes only resume state catalog owns placement and presentation.
- Final receipt internal command binding: node_modules/vitest/vitest.mjs run scripts/verify-release-readiness.test.mjs scripts/verify-doc-drift.test.mjs scripts/verify-external-evidence-inventory.test.mjs scripts/device-evidence-packet.test.mjs scripts/verify-handoff-receipts.test.mjs scripts/stack-architecture-receipt.test.mjs inputs.qaPath docs/GSAV_NATIVE_QA.md --qa-path --inventory-path --packet-path --require-git-integrity --candidate-sha scripts/stack-architecture-receipt.js --require-assets --verify stack-architecture-receipt.json git fetch --no-tags origin master git merge-base --is-ancestor.
- product-journey-manifest Explore restraint: secondary/runtime-scoped action native feed Search Library Settings exactly one `embed=native` hidden hosted public/account chrome native-shell back behavior primary Home browse surface same-origin hosted product routes escape the player boundary.

## Implementation Work Packages

Compact board; G0-G7 remain authoritative.

### Work Package Map

| Package | Scope | Verification | Validation |
| --- | --- | --- | --- |
| WP-1 architecture contract | Route stubs, feature boundaries, sibling allowlist, player-only host | `npm run verify:import-boundaries`; focused boundary tests | Reviewer trace and device route ownership |
| WP-2 runtime negative automation | Blocked navigation, unsupported, ended, auth gate, same-origin controls | Focused player/runtime tests | Android/iOS negative rows |
| WP-3 local quality baseline | Typecheck, lint, workflow, docs, unit, coverage, whitespace, audit | `npm run verify:local` | Audit command receipts |
| WP-4 device route validation | Android/iOS route matrix and product journey | Packet check and inventory replay | G6 route/product evidence |
| WP-5 release artifact validation | Exact APK, manifest, generated metadata, installed smoke | Artifact, version, installed-smoke verifiers | G4-G5 artifact evidence |
| WP-6 production release dry run | Fixed candidate `workflow_dispatch publish_release=false` | Bundle verifier and no-publish proof | G3 dry-run artifact |
| WP-7 readiness verifier maintenance | Readiness, packet, inventory, doc drift, handoff checks | Focused verifier tests | Expected-fail until rows complete |
| WP-8 publish readiness | Final receipts, protected candidate, audit signoff | `verify:final-readiness-receipts` | Release owner decision |

### Focused Player Verification Matrix

```powershell
npm test -- features/player/useGsavEmbedHost.test.ts features/player/bridge.test.ts features/player/progressBridge.test.ts features/player/gsavProgressStore.test.ts features/app-shell/navigationUx.test.ts shared/gsavRoutes.test.ts shared/gsavWeb.test.ts services/gsav.test.ts
npm test -- scripts/gsav-native-runtime-smoke.test.mjs scripts/gsav-native-preflight.test.mjs
```

### Validation Owner Assignment

Human release owner coordinates receipts, fixed-candidate dry run, signoff, and
publish/no-publish decision. Android executor captures `adb devices` device
state, Android WebView route/negative evidence, exact APK install proof, `aapt`,
`apkanalyzer`, or `bundletool` output, and `--production-host-url` installed
smoke with `productionHostReleaseReady=true`. iOS validation owner captures
macOS/Xcode/`xcrun` or physical iOS-device proof, iOS simulator/device identity,
iOS version, and WKWebView/WebKit version. Use a release-owned test account and
redacted evidence. Evidence artifact review signoff records
`artifactReviewArtifact=<artifact name or ID>` matching artifact name or
artifact ID, reviewed timestamp/reviewedAt, GitHub run conclusion, and
downloaded checksum-manifest SHA256. Branch-protection governance records
Branch protection, `quality / quality`, Master branch protection, and owner
handle @opsiclear/native-release.

### Current Execution Board (Runbook Appendix)

Done locally: R0 route-map coverage, import-boundary hardening, player degraded
states, AGENTS.md incorporation, and final receipt shared-contract
consolidation. Blocked externally: exact APK, release-owned test account,
manifest, host/range/runtime proof, Android/iOS rows, and protected-candidate
proof. Next: run G0-G7 and keep `decision=no-publish` until G7 passes.

### Canonical Release Evidence Order (Superseded Historical Appendix)

Non-authoritative summary: G0 no-publish; G1 local health; G2
owner/fixture/host receipts; G3 dry-run artifact; G4 APK/manifest; G5 metadata
and installed smoke; G6 route/negative/product evidence; G7 final reviewed
readiness.

### Canonical Command Snippets

```powershell
npm ci
npx tsc --noEmit
npm test
npm run lint
npm run verify:local
npm run verify:release-candidate -- --date <YYYY-MM-DD> --candidate-sha <payload-sha>
npm run android:version-metadata -- --apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH" --expected-version-code <app.json versionCode> --output-path docs/qa-evidence/<date>/apk-version-metadata.txt
npm run android:installed-smoke -- --apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH" --output-path docs/qa-evidence/<date>/android-installed-release-smoke.txt --dry-run-summary-path "$DOWNLOADED_RELEASE_DIR/release-evidence/dry-run-summary.json" --production-host-url <https production GSAV host> --ci-artifact-url <artifact URL>
npm run verify:final-readiness-receipts -- --candidate-sha <payload-sha> --date <YYYY-MM-DD> --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --packet-path <reviewed-packet.json> --stack-receipt-path docs/qa-evidence/<date>/stack-architecture-receipt.json
```

### Detailed Execution Plan (Historical Appendix)

Historical and non-authoritative. Use G0-G7 below; duplicated flow is collapsed.

### Release Owner Execution Checklist (Historical Appendix)

This checklist is non-authoritative; the active sequence is G0 through G7.
Confirm exact APK, release-owned test account, human release owner, GitHub CLI,
`adb devices` device state, `aapt`, `apkanalyzer`, `bundletool`, iOS validation
owner, macOS/Xcode/`xcrun` or physical iOS-device proof, iOS simulator/device
identity, WKWebView/WebKit version, artifact-review signoff, Branch protection,
`quality / quality`, Master branch protection, reviewed timestamp/reviewedAt,
GitHub run conclusion, downloaded checksum-manifest SHA256, and bundle-verifier
rerun against the downloaded artifact with `verify:release-evidence-bundle`,
`--production-host-url`, and `productionHostReleaseReady=true`.
`externalEvidenceInventoryPath=docs/qa-evidence/<date>/external-evidence-inventory.json`
and `deviceEvidencePacketPath=<reviewed-packet.json>` must be in signoff.
`artifactReviewArtifact=<artifact name or ID>` must match artifact name unless
it is an artifact ID.

Publish ceremony: wait for final receipts with reviewed packet, reviewed
inventory, protected-candidate proof, and `decision=publish`; publish with
`--target` for the verified payload SHA and make no version-bump, workflow,
verifier, route, bridge, or evidence-schema commits after readiness.

### Active External Validation Pass Plan

#### Ordered Evidence Gate Sequence

| Gate | Pass condition |
| --- | --- |
| G0 no-publish baseline | Baseline rows fail as intended and audit says `decision=no-publish` |
| G1 local release-candidate health | Local verification passes but external rows remain pending |
| G2 production host identity | `gsav-host-ready/v2` details match date and host identity |
| G3 non-publishing release dry run | Downloaded dry-run artifact proves no GitHub release side effect |
| G4 validation prerequisites and exact APK | Exact downloaded APK and manifest match evidence |
| G5 generated metadata and installed smoke | Generated and installed versionCode match app metadata |
| G6 Android/iOS route and negative validation | Reviewed packet and manifest evidence pass packet checks |
| G7 external review and final readiness | Final wrapper passes with `decision=publish`; otherwise hold |

#### Pre-G3 Assignment, Fixture, And Host Receipts

Required files: `docs/qa-evidence/<date>/owner-assignment.json`,
`docs/qa-evidence/<date>/fixture-manifest.json`, and
`docs/qa-evidence/<date>/gsav-host-ready.json`.

```powershell
npm run verify:handoff-receipts -- --date <YYYY-MM-DD> --allow-pending --output-path docs/qa-evidence/<date>/handoff-receipts-blocker.json
```

G0 prerequisite source evidence: branch-protection, publish-hash guard, GitHub
release-state, validation-prereq blocker, handoff-receipts blocker, and
no-publish baseline.

#### Active Gate Cards

| Gate | Command handoff |
| --- | --- |
| G3 | Canonical dispatch uses `gh workflow run "Release APK" -R OpsiClear-Web/diveo --ref <evidence-signoff-ref> -f candidate_ref=<payload-sha> -f publish_release=false`; select the completed `workflow_dispatch` by run ID before downloading. |
| G6 | G6 command handoff: start from `device-evidence-packet-candidate.json`, pass `--dry-run-artifact diveo-release-evidence-v<version>` and `--dry-run-run-url`, fill route, negative, product-journey, media/hash, platform, and QA-row fields, then rename only the reviewed final `device-evidence-packet-reviewed.json`. |
| G7 | G7 command handoff: generate `external-evidence-inventory-scaffold.json`, use human CLI download, recompute SHA256, record `github-release-state-prepublish.json`, `publish-hash-variable-guard-prepublish.json`, `stack-architecture-receipt.json`, `DEVICE_EVIDENCE_PACKET_PATH`, `EXTERNAL_EVIDENCE_INVENTORY_PATH`, and `--strict-final-inputs`, then run `npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json> --require-git-integrity` and `verify:final-readiness-receipts`. |

G7 strict command:

```powershell
npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json> --require-git-integrity
npm run verify:final-readiness-receipts -- --candidate-sha <payload-sha> --date <YYYY-MM-DD> --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --packet-path <reviewed-packet.json> --stack-receipt-path docs/qa-evidence/<date>/stack-architecture-receipt.json
```

Protected candidate ancestry proof: run `git fetch --no-tags origin master`,
then `git merge-base --is-ancestor`; require `expectReadinessStatus=0`,
`publishSignoffReady=true`, `noPublishRehearsal=false`, `status=pass`, and an
`expected-readiness-fail` rehearsal only when intentionally holding. G7 passes
only with `decision=publish`; `decision=no-publish` remains a valid hold or
rehearsal state, and final receipts generated with `--expect-readiness-fail` are
rehearsal only.

Final evidence filename map:

`docs/qa-evidence/<date>/github-release-state-prepublish.json`,
`docs/qa-evidence/<date>/publish-hash-variable-guard-prepublish.json`,
`docs/qa-evidence/<date>/stack-architecture-receipt.json`,
`docs/qa-evidence/<date>/final-command-receipts/github-release-state-prepublish-live.json`,
`docs/qa-evidence/<date>/final-command-receipts/publish-hash-variable-guard-prepublish-live.json`,
`docs/qa-evidence/<date>/final-command-receipts/verification-summary.json`,
`release-evidence/github-release-state-prepublish.json`, and
`release-evidence/publish-hash-variable-guard-prepublish.json`;
`noPublishRehearsal=false` is required.

Final receipt bindings:

- Final receipt live path binding: inputs.date inputs.lastMileReleaseStateLivePath inputs.lastMilePublishHashGuardLivePath finalCommandReceiptsPath evidence date final-command-receipts github-release-state-prepublish-live.json publish-hash-variable-guard-prepublish-live.json step commands --output-path.
- Final receipt last-mile review binding: inputs.repository inputs.reviewer inputs.reviewedAt `--repo` `--reviewer` `--reviewed-at` trusted Diveo repository concrete reviewer ISO timestamp on the final evidence date. Last-mile GitHub release-state evidence, Last-mile publish-hash variable guard, static last-mile JSON, and final command receipt summary must agree; wrapper rejects untrusted repository, wrapper rejects weak reviewer, and wrapper rejects stale reviewedAt before helper commands run.
- Final receipt reviewer source fail-fast binding: inputs.reviewer must come from `--reviewer`, `FINAL_READINESS_REVIEWER`, `GITHUB_ACTOR`, `USERNAME`, or `USER`; wrapper rejects missing reviewer and `final-readiness-runner` before helper commands run.
- Final receipt summary timing binding: startedAt and finishedAt must be ISO timestamp on the final evidence date, and finishedAt must not be before startedAt.
- Final receipt pass-summary contradiction binding: final command receipt summary with `status=pass` and `ok=true` must not include `failedStep` or non-empty `outputProblems`.
- Final receipt input fail-fast binding: inputs.date must be the current UTC capture date; wrapper rejects stale date and wrapper rejects future date before helper commands run; inputs.qaPath must be `docs/GSAV_NATIVE_QA.md`, and wrapper rejects noncanonical QA path before helper commands run.
- Final receipt evidence-dir fail-fast binding: inputs.evidenceDir must be `docs/qa-evidence/<date>/final-command-receipts` and match the finalCommandReceiptsPath directory; wrapper rejects noncanonical evidence-dir before helper commands run.
- Final receipt inventory fail-fast binding: inputs.inventoryPath must be `docs/qa-evidence/<date>/external-evidence-inventory.json`; wrapper rejects noncanonical inventory path before helper commands run.
- Final receipt runUrl repository binding: inputs.repository must match the audit runUrl repository so final receipts and release evidence use the same trusted Diveo repository.
- Final receipt release-state query repository binding: commands for workflows, releaseRuns, workflowDispatchRuns, and releases must use `gh api repos/<owner>/<repo>/actions/workflows`, `-R`, or `--repo` matching inputs.repository, the final command receipt summary repository.
- Final receipt live last-mile JSON binding: inputs.lastMileReleaseStateLivePath and inputs.lastMilePublishHashGuardLivePath must exist as valid JSON with `status=pass`, `ok=true`, repository, reviewer, reviewedAt, checkedAt, and `releaseReadinessImpact.status=ready`.
- Final receipt live output creation binding: Last-mile GitHub release-state evidence and Last-mile publish-hash variable guard must create valid JSON at inputs.lastMileReleaseStateLivePath and inputs.lastMilePublishHashGuardLivePath; remove stale live output before each capture step; validate repository, reviewer, reviewedAt, checkedAt, final evidence date, `expectedStatus=0`, `status=pass`, `ok=true`, and `releaseReadinessImpact.status=ready`; stop before Final release readiness on `outputProblems`.
- Final receipt publish-hash query repository binding: `variableQueries[].command` for `EXPECTED_RELEASE_APK_SHA256` and `EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256` must use `--repo inputs.repository` matching the final command receipt summary repository.
- Final receipt step-log byte replay: stdoutPath stderrPath stdoutSha256 stderrSha256 combinedSha256 final-command-receipts byte replay.
- Final receipt wrapper step set anchor: all 11 final receipt wrapper steps Documentation drift audit Final readiness focused tests External evidence inventory replay Device packet reconciliation Strict handoff receipt replay Stack architecture receipt replay Protected master ref refresh Protected candidate ancestry proof Last-mile GitHub release-state evidence Last-mile publish-hash variable guard Final release readiness; wrapper rejects missing, duplicate, or reordered recorded step evidence before status=pass.
- Final receipt wrapper step status marker: every final wrapper step requires `expectedStatus=0`, `status=0`, and publish signoff.
- Final receipt Final release readiness env binding: `verify-release-readiness.js --strict-final-inputs` uses `EXTERNAL_EVIDENCE_INVENTORY_PATH`, `DEVICE_EVIDENCE_PACKET_PATH`, `RELEASE_CANDIDATE_SHA`, `FINAL_READINESS_RECEIPT_BOOTSTRAP`, and `finalCommandReceiptsPath` as safe final input keys.
- Final receipt internal command binding: focused tests run `scripts/verify-release-readiness.test.mjs`, `scripts/verify-doc-drift.test.mjs`, `scripts/verify-external-evidence-inventory.test.mjs`, `scripts/device-evidence-packet.test.mjs`, `scripts/verify-handoff-receipts.test.mjs`, and `scripts/stack-architecture-receipt.test.mjs`; inventory replay uses `--qa-path`, `--inventory-path`, `--packet-path`, and `--require-git-integrity`; device packet and handoff receipts replay the reviewed paths; stack receipt replay runs `scripts/stack-architecture-receipt.js --require-assets --verify docs/qa-evidence/<date>/stack-architecture-receipt.json`; protected master and protected candidate required commands are `git fetch --no-tags origin master` and `git merge-base --is-ancestor`.

Validation promotion map:

| Gate | Promotes |
| --- | --- |
| G3 production dry run and host/range/runtime proof | Dry-run row and production runtime/range proof |
| G4 validation prerequisites and exact APK/manifest | Release APK and manifest rows |
| G5 generated metadata and installed smoke | Metadata and installed-smoke rows |
| G6 Android/iOS route captures | Route matrix rows |
| G6 negative captures | Negative validation rows |
| G7 final review and signoff | Audit signoff and release decision; requires `verify:final-readiness-receipts` |

Workflow readiness has packet/inventory path wiring:
`workflow_dispatch publish_release=true` must pass
`EXTERNAL_EVIDENCE_INVENTORY_PATH` and `DEVICE_EVIDENCE_PACKET_PATH` into final
readiness. Audit signoff fields:
`externalEvidenceInventoryPath=docs/qa-evidence/<date>/external-evidence-inventory.json`
and `deviceEvidencePacketPath=<reviewed-packet.json>`.

## Phase 1 - Preserve The Baseline (Historical Appendix / Local Rehearsal Only)

Historical appendix only.

## Phase 2 - Consolidate Player Ownership (Historical Appendix / Local Rehearsal Only)

Historical appendix only.

## Phase 3 - Harden The Native/Web Boundary (Historical Appendix / Local Rehearsal Only)

Historical appendix only.

## Phase 4 - Split Native Product Features (Historical Appendix / Local Rehearsal Only)

Historical appendix only.

## Phase 5 - Expand Integration Smoke Coverage (Historical Appendix / Local Rehearsal Only)

Historical appendix only.

## Phase 6 - Quarantine Or Remove Legacy Bilibili Code (Historical Appendix / Local Rehearsal Only)

Historical appendix only.

## Phase 7 - Device QA And Release Readiness (Historical Appendix / Local Rehearsal Only)

Historical appendix only.

## Phase 8 - Refine The Dependency Graph (Historical Appendix / Local Rehearsal Only)

Historical appendix only.
