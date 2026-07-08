# GSAV Native WebView QA

This checklist validates the current diveo architecture: React Native owns the
product shell, native navigation, browse, search, library, auth, saved/follow,
and settings surfaces; `../gsav-hosting/apps/web` owns GSAV
decode/render/playback/runtime chrome. `/explore` remains the documented
hosted-runtime browse exception.

## Prerequisites

- `../gsav-hosting/apps/web` is built and reachable.
- `EXPO_PUBLIC_GSAV_WEB_URL` points at that GSAV web origin.
- Native catalog and signed-in social flows have local or staging values for
  `EXPO_PUBLIC_GSAV_CATALOG_URL`, `EXPO_PUBLIC_GSAV_SUPABASE_URL`, and
  `EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY`.
- The web origin supports native embed routes:
  - `/explore?embed=native&dataSaver=1`
  - `/native-diagnostics?embed=native`
  - `/watch/test?embed=native`
  - `/watch/elly?embed=native`
- Android SDK tooling is available for Android QA.
- macOS + Xcode simulator or a physical iOS device is available for iOS QA.
- Before collecting publish-counted evidence, run
  `npm run verify:validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --ios-artifact-path "$IOS_VALIDATION_ARTIFACT_PATH" --output-path "$VALIDATION_PREREQS_PATH"`
  to inventory missing Android tools, connected `adb devices` proof, GitHub
  CLI, generated APK metadata tooling (`aapt`, `apkanalyzer`, or
  `bundletool`), production env/secrets, QA-only production flags, host
  identity, range-probe URL, APK path, merged-manifest path, iOS validation
  owner, iOS executor proof, iOS device identity, iOS version,
  WKWebView/WebKit version, trusted iOS artifact URL that points to a direct
  Actions artifact, release asset download, or `docs/qa-evidence` blob, and 64-hex
  iOS artifact SHA256. A failure is expected on a local workstation without those inputs; the
  evidence-collection machine or CI run must pass with the exact APK and
  manifest paths before artifact rows move to `Passed:`.

## Release Target Scope

This gate is Android publish readiness plus Android and iOS embedded route
validation. Android artifact evidence covers the APK, merged manifest,
generated `versionCode`, checksums, and installed release smoke. iOS currently
requires WKWebView route and negative validation only; this repository does not
yet define an iOS archive, signing, or TestFlight artifact gate. The
`IOS_VALIDATION_ARTIFACT_*` inputs are evidence artifact inputs, not a
distributable iOS app artifact. In G4 they prove iOS executor/prerequisite bytes
and checksum replay. They do not replace G6 WKWebView route or negative
evidence unless the same trusted artifact was captured after the G3 dry run and
contains route/negative manifests, screenshots/logs, source IDs, and SHA256
proof for the same candidate. Add archive/signing/TestFlight rows, workflow
evidence, and readiness checks before using this runbook for an iOS
distribution publish.
Final signoff must therefore record `publishScope=android-apk-only` and
`iosDistributionDecision=no-publish` unless separate iOS archive, signing,
TestFlight, and distribution rows are added to this QA matrix and verifier.
Because `app.json` keeps `ios.supportsTablet=true`, any future iOS distribution
claim must also include iPad/tablet ergonomics evidence or a scoped no-publish
exception with owner and revisit date; phone-only WKWebView evidence is not
enough for that claim.

## Signed-In Test Account

Use a release-owned test account for `/library`, save, and follow evidence.
Before capture, seed at least one saved scene and one follow relationship; after
capture, reset the account state or record the preserved fixture state. Do not
use a personal account. Do not commit emails, access tokens, refresh tokens,
cookies, Supabase JWTs, or account-specific identifiers in screenshots or logs.
Evidence rows should say the signed-in fixture was seeded and account-safe; raw
logs should be redacted before they are saved under `docs/qa-evidence/<date>/`.

## Local Web Target

Start the GSAV web preview first:

```powershell
cd ..\gsav-hosting
npm run smoke:web:local
```

If `smoke:web:local` is blocked by GSAV host asset CORS or deployment-smoke
failures, start the direct Vite preview in a dedicated terminal and use it only
for Diveo local preflight/runtime smoke:

```powershell
cd ..\gsav-hosting
npm run deploy:web:local
```

Record the fallback as an environment gap. Direct preview evidence does not
replace fixing the GSAV host or collecting production range/runtime evidence.

Expected local browser target:

```text
http://127.0.0.1:5191
```

Android emulator target:

```text
http://10.0.2.2:5191
```

Run host preflight before launching Expo:

```powershell
cd ..\diveo
npm run gsav:preflight
npm run gsav:preflight -- --output-path docs/qa-evidence/<date>/gsav-preflight.json
```

Preflight checks that the hosted app shell, native embed routes, data-saver
query, and local `/test.gsav` range serving are reachable from the host. The
range probe sends `Range: bytes=0-0` and records whether `Content-Range` is
exact. Local Vite preview output is reachability evidence only; production
preflight with `GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE=1` and
`GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS=1` must return exact
`Content-Range: bytes 0-0/<decimal-size>`,
`Access-Control-Allow-Origin=*` or the production GSAV origin, and
`Access-Control-Expose-Headers` set to `Accept-Ranges, Content-Length,
Content-Range, ETag`. It does not replace real WebView QA.

Run JS runtime smoke against the same preview:

```powershell
npm run gsav:runtime-smoke
npm run gsav:runtime-smoke -- --output-path docs/qa-evidence/<date>/gsav-runtime-smoke.json
```

Runtime smoke launches Chromium through Playwright, installs a
`window.ReactNativeWebView.postMessage` capture shim, and verifies native embed
markers, hidden web chrome, data-saver behavior, and bridge readiness events.
Both `npm run gsav:preflight` and `npm run gsav:runtime-smoke` include
`nodeVersion`, `npmVersion`, `diveoCommit`, and `gsavHostingCommit` when
available in their JSON output; keep that raw output with the evidence row.
Use `-- --output-path <file>` or `GSAV_NATIVE_PREFLIGHT_OUTPUT_PATH` /
`GSAV_NATIVE_RUNTIME_SMOKE_OUTPUT_PATH` when the command output should be
durable. The scripts write the same JSON they print, including failure payloads,
and create parent directories automatically.
Publish-counted runtime rows must name a concrete deployed value such as
`gsavHostingCommit=<sha/build>` or `GSAV_HOSTING_COMMIT=<sha/build>`.
After the Phase 0 hosting snapshot, use a real `gsav-hosting` git SHA for this
field. The current local baseline is
`8c34bca78067f732e09307e4c833038e9637b0b4`; production evidence must use the
exact SHA served by the deployed host.

For release-candidate validation, save raw command output, screenshots, videos,
or filtered device logs under `docs/qa-evidence/<date>/`. The QA table row must
summarize the checked fields, and the linked artifact should contain the raw
supporting output. Record the diveo commit, app version, Android `versionCode`
when relevant, package version, gsav-hosting commit or deployed host/build
identity, Node/npm versions for command-based checks, GSAV web URL, device or
browser target, route, result, and the exact command or manual action used.
Release artifact evidence must also record the workflow run URL when CI produced
it, payload candidate SHA, evidence signoff SHA when different, artifact name,
APK path, manifest path, explicit 64-hex `apkSha256`, explicit 64-hex
`manifestSha256`, and the 64-hex SHA256 of `evidence-checksums.txt`.
The release workflow uploads `release-evidence/**` alongside the APK and merged
manifest with `if-no-files-found: error`. The generated bundle must include:

- `release-evidence/native-production-config-before-bump.json`
- `release-evidence/native-production-config-after-bump.json`
- `release-evidence/version.txt`
- `release-evidence/release-candidate.txt`
- `release-evidence/signoff-diff-files.txt`
- `release-evidence/gsav-preflight.json`
- `release-evidence/gsav-runtime-smoke.json`
- `release-evidence/app-version-metadata.json`
- `release-evidence/gradle-version-code.txt`
- `release-evidence/release-artifact.json`
- `release-evidence/apk-version-metadata.txt`
- `release-evidence/dry-run-summary.json`
- `release-evidence/evidence-checksums.txt`
- `release-evidence/no-publish-side-effect.txt` for dry-run mode

Before upload, `scripts/write-release-evidence-summary.js` refuses to create
`dry-run-summary.json` unless `release-evidence/release-candidate.txt` contains
`releaseCandidateSha`, `appVersion`, `packageVersion`, and
`androidVersionCode`; its `releaseCandidateSha` must match
`RELEASE_CANDIDATE_SHA`, `appVersion` and `packageVersion` must be semver
values matching `releaseVersion`, and `androidVersionCode` must be numeric.
Then `npm run verify:release-evidence-bundle` checks the generated bundle
contents, checksum manifest, APK/manifest hashes, release-candidate SHA,
signoff diff identity and QA/audit/evidence-only changed-file list, production
preflight/runtime-smoke JSON, `dry-run-summary.json` `gsavPackageProvenance`
for `@opsiclear/gsav-bridge` and `@opsiclear/gsav-client` with
`specifier=file:vendor/...`, `tarballSha256=<64-hex sha>`, and
`gsavPackageProvenanceSha256=<64-hex sha>` bound into
`publishArtifactIdentitySha256`, release mode (`dry-run` or `publish`),
no-publish proof for dry runs, and generated `versionCode` consistency.
Production
preflight and runtime smoke must run after `release-candidate.txt` is captured;
`gsav-preflight.json` and
`gsav-runtime-smoke.json` must include `diveoCommit` matching
`releaseCandidateSha` from `dry-run-summary.json`.
The separate `device-validation.yml` workflow is the device-capable lane: it
validates dispatch inputs before download (`release_run_id` digits only,
`artifact_name` exactly `diveo-release-evidence-v<semver>`, `evidence_date`
valid `YYYY-MM-DD`, and optional `release_artifact_url` as a trusted Diveo GitHub Actions run, Actions artifact, or release asset download URL), downloads the exact
release artifact, verifies downloaded APK, manifest, and release-evidence paths,
verifies `dry-run-summary.json` `artifactName` matches `inputs.artifact_name`
and verifies `runUrl` is an exact trusted Diveo release Actions run URL whose parsed
repository and run ID match `${{ github.repository }}` and
`inputs.release_run_id`, and for
pre-publish readiness `release_evidence_mode` only accepts `dry-run`, so
`dry-run-summary.json` must record `publishRelease=false`. Post-release
publish-mode validation must use a separate lane or a future reviewed workflow
change; it cannot complete pre-publish QA rows. The workflow writes the trusted
iOS artifact bytes with
`node scripts/materialize-ios-validation-artifact.js --url "$IOS_VALIDATION_ARTIFACT_URL" --output-path "$DOWNLOADED_RELEASE_DIR/$IOS_VALIDATION_ARTIFACT_PATH" --expected-sha256 "$IOS_VALIDATION_ARTIFACT_SHA256"`,
then writes
`release-evidence/validation-prereqs.json` with
`npm run verify:validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --ios-artifact-path "$IOS_VALIDATION_ARTIFACT_PATH" --output-path "$VALIDATION_PREREQS_PATH"`,
verifies `$DOWNLOADED_RELEASE_DIR/$VALIDATION_PREREQS_PATH` exists before
attachment,
runs `npm run release-evidence:attach-validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --evidence-dir release-evidence --validation-prereqs-path "$VALIDATION_PREREQS_PATH" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH"`
to refresh `dry-run-summary.json` and `evidence-checksums.txt`, reruns
`npm run verify:release-evidence-bundle -- --root "$DOWNLOADED_RELEASE_DIR" --evidence-dir release-evidence --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --mode dry-run --require-validation-prereqs true`,
which requires the materialized iOS artifact path to stay under
`release-evidence/`, appear in `dry-run-summary.json` and
`evidence-checksums.txt`, and recomputes its SHA256 from current bytes,
captures `device-validation-evidence/device-validation-bundle-verifier.json`
outside the attached release bundle, captures installed-APK smoke evidence, and
uploads the attached `downloaded-release/release-evidence/**` bundle plus the
separate verifier and smoke outputs as
`diveo-device-validation-${{ inputs.evidence_date }}-${{ inputs.release_run_id }}`
with `if-no-files-found: error`.
The GitHub release-state blocker must also record whether the remote
`Device Validation` workflow is active. A local or untracked
`.github/workflows/device-validation.yml` file is not enough to rely on that
lane for publish-counted evidence; if the remote workflow is absent, keep the
affected validation rows pending and record a no-publish blocker.
This workflow does not replace the full Android/iOS route and negative matrix:
it proves downloaded dry-run artifact identity, validation-prerequisite
attachment, strict bundle verification, and Android installed APK smoke. Route
and negative rows still need distinct Android WebView and iOS WKWebView
screenshots, recordings, or filtered logs. Final release readiness rejects
Android/iOS route and negative rows whose evidence path points at
`diveo-device-validation-*`, `device-validation-bundle-verifier.json`,
`validation-prereqs.json`, or attached `downloaded-release/release-evidence/**`
helper artifacts instead of route-specific evidence.
Bare `actions/runs/<id>` URLs are supporting context only for route and
negative rows. Publish-counted route or negative evidence must be a committed
`docs/qa-evidence/...` file, a trusted GitHub `docs/qa-evidence` blob, or a
direct artifact/download URL whose row text includes
`artifactPurpose=route-evidence` or `artifactPurpose=negative-evidence`, a
route or negative evidence manifest path, `evidenceManifestSha256=<64-hex>`,
`sourceRunId=<digits>`, `sourceArtifactId=<id>`, a media or file SHA256, and
`helperOnly=false`. For GitHub Actions artifact URLs, `sourceRunId` and each
`sourceArtifactId` segment must match the artifact URL.
The route or negative `manifestPath`/`evidenceManifestPath` used for replay must
live under the same `docs/qa-evidence/<date>/` folder as the inventory evidence date;
inventory replay rejects stale route or negative manifests from another
evidence date even when their hashes and artifact IDs match.
Artifacts whose contents are only release-bundle helpers, validation-prereq
JSON, bundle-verifier output, installed-smoke output, or attached
`downloaded-release/release-evidence/**` are not route/negative proof even when
renamed; final signoff requires the External Evidence Review Ledger to record
that the reviewer inspected the route/negative manifest and confirmed the
manifest contents include the matching `artifactPurpose=route-evidence` or
`artifactPurpose=negative-evidence` plus `helperOnly=false` and, for
URL-backed artifacts, `sourceRunId`/`sourceArtifactId` values matching the
artifact URL.
The workflow requires `ios_validation_owner`,
`ios_validation_executor_proof`, `ios_validation_device`,
`ios_validation_version`, `ios_wkwebview_version`,
`ios_validation_artifact_url` as a trusted direct GitHub Actions artifact,
release asset download, or `docs/qa-evidence` blob under `opsiclear/diveo`,
`OpsiClear-Web/diveo`, or `opsiclear/gsav-hosting`, not a bare Actions run,
`ios_validation_artifact_sha256` as a 64-hex iOS
artifact SHA256 dispatch input, and `ios_validation_artifact_path` as a
`release-evidence/` path whose bytes are hashed during validation; Android and
iOS evidence can be collected on
separate devices, but the strict prerequisite JSON must name both lanes and the
reviewed iOS artifact before it is attached. In this lane,
validation-prereq APK, manifest, and output paths must stay inside
`$DOWNLOADED_RELEASE_DIR`.
`npm run verify:release-readiness` accepts evidence paths only when they are an
existing `docs/qa-evidence/...` file or a trusted GitHub CI/artifact/release URL
under `opsiclear/diveo`, `OpsiClear-Web/diveo`, or `opsiclear/gsav-hosting`;
terminal-only notes, generic web links, labels, absolute local paths,
`file://` URLs, and artifact-looking URLs from other hosts or repositories do
not count for publishing. If an Evidence path cell has multiple entries, every
comma- or semicolon-separated entry must independently use one of the accepted
forms. Release tag pages such as `/releases/tag/<tag>` are context only; use
the Actions run, direct Actions artifact, release asset download, or tracked
`docs/qa-evidence` blob that contains the reviewed bytes or logs. For release
evidence rows, row detail evidence URLs in Device, GSAV web
URL, Result, or Notes that look like GitHub Actions runs, releases, or
`docs/qa-evidence` blobs must also be trusted GitHub evidence under the same
repositories. It also
enforces publish-candidate identity against `RELEASE_CANDIDATE_SHA` when set or
the current checkout otherwise, required route/negative-case observed signals,
runtime-smoke evidence, release artifact scan details, generated version
metadata, production range-probe `206`, dry-run markers, and checksum or
artifact details where applicable.
Once all release evidence rows are complete, readiness also fails if
`app.json`, `package.json`, or `package-lock.json` has uncommitted changes; the
publish candidate must be an already-committed identity. If readiness runs from
an evidence signoff commit, the signoff must descend from the payload candidate
and change only `docs/GSAV_NATIVE_QA.md`,
`docs/IMPLEMENTATION_VALIDATION_AUDIT.md`, or `docs/qa-evidence/**`.
After all rows are otherwise complete, a future publish-ready run also requires
the audit to record `decision=publish`, reviewer, `reviewedAt`, payload SHA, signoff SHA,
artifact name, run URL, checksum-manifest SHA256,
`publishArtifactIdentitySha256`, branch-protection-ready evidence for
`master` with `quality / quality`, and zero unresolved external-review ledger
rows. That ledger must include reviewed rows for release dry run,
validation prerequisites/device-validation bundle, APK and generated metadata,
installed APK smoke, production runtime smoke and range probe, product journey
manifest, Android/iOS route rows, negative validation rows, and branch
protection. The audit payload
SHA, signoff SHA, artifact name, run URL, checksum-manifest SHA256, and
`publishArtifactIdentitySha256` must match the Release workflow dry-run QA row.
Every reviewed ledger row must include a durable reviewed artifact reference,
concrete reviewer, ISO timestamp, and category-specific proof; placeholder
artifact names such as `<version>` or `<date>` do not pass final readiness.
Reviewed proof must use concrete values such as 64-hex hashes, trusted GitHub
artifact URLs, generated `versionCode`, `GSAV_HOSTING_COMMIT`, and exact
`Content-Range`/CORS header observations, not field-name-only notes.
Local evidence files must be tracked and committed before final readiness; an
existing but untracked or dirty `docs/qa-evidence/...` file is not publish-ready.

## Required Evidence Fields

Every completed release-candidate row must summarize the required fields in
the row text. Linked evidence files provide raw proof, but the readiness
verifier does not fetch arbitrary external URLs or infer missing details from
screenshots.
`device-evidence:packet --check` does recompute SHA256 for repository-local
screenshot, recording, and archive evidence paths under `docs/qa-evidence/...`,
and it byte-checks repository-local route/negative manifests against
`evidenceManifestSha256`. URL-backed artifacts still require a reviewed replay
inventory or ledger proof showing the artifact was downloaded or inspected,
hashes were recomputed, route/negative manifests were unpacked, and
`artifactPurpose=route-evidence` or `artifactPurpose=negative-evidence` plus
`helperOnly=false` plus URL-matched `sourceRunId`/`sourceArtifactId` were
verified from contents rather than URL shape. Generate a pending starting point
with
`npm run external-evidence:scaffold -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory-scaffold.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json>`,
which prepopulates product-journey linked evidence hints such as
`productJourneyExpectedSha256Field`, `productJourneyExpectedSha256`,
`productJourneySourceRunId`, and `productJourneySourceArtifactId` from the
manifest before reviewer promotion,
then copy reviewed values into
`docs/qa-evidence/<date>/external-evidence-inventory.json` and run
`npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json> --require-git-integrity`
before final readiness.
URL-backed inventory entries must stage reviewed downloads under
`docs/qa-evidence/<date>/external/...`; GitHub Actions artifacts use
`docs/qa-evidence/<date>/external/<sourceRunId>/<sourceArtifactId>/...`, and
the inventory `downloadedPath`, `sourceRunId`, and `sourceArtifactId` must match
the trusted URL and downloaded bytes.
before final readiness. The final publish gate must use the receipt wrapper so
packet replay, inventory replay, strict handoff receipts, stack architecture
receipt replay, protected-candidate ancestry proof, live last-mile release-state
and publish-hash captures, focused tests, and final readiness are preserved
together:
`npm run verify:final-readiness-receipts -- --candidate-sha <payload-sha> --date <YYYY-MM-DD> --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --packet-path <reviewed-packet.json> --stack-receipt-path docs/qa-evidence/<date>/stack-architecture-receipt.json`.
For publish signoff, the generated final-command receipt summary must include
protected `origin/master` ancestry proof, passing `Last-mile GitHub
release-state evidence` and `Last-mile publish-hash variable guard` steps, and
must show `inputs.expectReadinessStatus=0`, `publishSignoffReady=true`,
`noPublishRehearsal=false`, and `status=pass`; a
`status=expected-readiness-fail` summary is no-publish rehearsal evidence only
and cannot satisfy final publish readiness.
The summary `inputs.date`, `inputs.lastMileReleaseStateLivePath`, and
`inputs.lastMilePublishHashGuardLivePath` must match the
`finalCommandReceiptsPath evidence date` and the dated `final-command-receipts`
live paths ending in `github-release-state-prepublish-live.json` and
`publish-hash-variable-guard-prepublish-live.json`; the matching last-mile
step commands must use `--output-path` for those same live paths.
Final receipt last-mile review binding: `inputs.repository`, `inputs.reviewer`,
and `inputs.reviewedAt` must match the `Last-mile GitHub release-state evidence`
and `Last-mile publish-hash variable guard` step commands through `--repo`,
`--reviewer`, and `--reviewed-at`; `inputs.repository` must be the trusted
Diveo repository, `inputs.reviewer` must be a concrete reviewer, and
`inputs.reviewedAt` must be an ISO timestamp on the final evidence date. The
wrapper rejects untrusted repository before helper commands run, wrapper rejects
weak reviewer before helper commands run, and wrapper rejects stale reviewedAt
before helper commands run. The static last-mile JSON review metadata must match
the final command receipt summary.
Final receipt last-mile review binding marker: inputs.repository inputs.reviewer inputs.reviewedAt --repo --reviewer --reviewed-at trusted Diveo repository concrete reviewer ISO timestamp on the final evidence date wrapper rejects untrusted repository wrapper rejects weak reviewer wrapper rejects stale reviewedAt Last-mile GitHub release-state evidence Last-mile publish-hash variable guard static last-mile JSON final command receipt summary.
Final receipt reviewer source fail-fast binding: `inputs.reviewer` must come from `--reviewer`, `FINAL_READINESS_REVIEWER`, `GITHUB_ACTOR`, `USERNAME`, or `USER`; the wrapper rejects missing reviewer and wrapper rejects final-readiness-runner before helper commands run.
Final receipt summary timing binding: `startedAt` and `finishedAt` must be an
ISO timestamp on the final evidence date, and `finishedAt` must not be before
`startedAt`.
Final receipt summary timing binding marker: startedAt finishedAt ISO timestamp on the final evidence date finishedAt must not be before startedAt.
Final receipt pass-summary contradiction binding: a final command receipt summary
with `status=pass` and `ok=true` must not include `failedStep` or non-empty
`outputProblems`.
Final receipt pass-summary contradiction binding marker: final command receipt summary status=pass ok=true must not include failedStep or non-empty outputProblems.
Final receipt input fail-fast binding: `inputs.date` must be the current UTC capture date; the wrapper rejects stale date and wrapper rejects future date before helper commands run. `inputs.qaPath` must be `docs/GSAV_NATIVE_QA.md`; the wrapper rejects noncanonical QA path before helper commands run.
Final receipt evidence-dir fail-fast binding: `inputs.evidenceDir` must be `docs/qa-evidence/<date>/final-command-receipts` and match the finalCommandReceiptsPath directory; the wrapper rejects noncanonical evidence-dir before helper commands run.
Final receipt inventory fail-fast binding: `inputs.inventoryPath` must be `docs/qa-evidence/<date>/external-evidence-inventory.json`; the wrapper rejects noncanonical inventory path before helper commands run.
Final receipt runUrl repository binding: `inputs.repository` must match the
audit runUrl repository so final receipts and release evidence use the same
trusted Diveo repository.
Final receipt runUrl repository binding marker: inputs.repository audit runUrl repository same trusted Diveo repository.
Final receipt release-state query repository binding: release-state `commands`
for `workflows`, `releaseRuns`, `workflowDispatchRuns`, and `releases` must use
`gh api repos/<owner>/<repo>/actions/workflows` or `gh run/release list` with
`-R` or `--repo` matching `inputs.repository`, the final command receipt summary
repository.
Final receipt release-state query repository binding marker: commands workflows releaseRuns workflowDispatchRuns releases inputs.repository final command receipt summary repository gh api repos/<owner>/<repo>/actions/workflows -R --repo.
Final receipt live last-mile JSON binding: `inputs.lastMileReleaseStateLivePath`
and `inputs.lastMilePublishHashGuardLivePath` must exist as valid JSON with
`status=pass`, `ok=true`, matching repository, reviewer, `reviewedAt`,
`checkedAt` on the final evidence date, and `releaseReadinessImpact.status=ready`.
Final receipt live last-mile JSON binding marker: inputs.lastMileReleaseStateLivePath inputs.lastMilePublishHashGuardLivePath valid JSON status=pass ok=true repository reviewer reviewedAt checkedAt releaseReadinessImpact.status=ready.
Final receipt live output creation binding: `Last-mile GitHub release-state evidence`
and `Last-mile publish-hash variable guard` must create valid JSON at
`inputs.lastMileReleaseStateLivePath` and
`inputs.lastMilePublishHashGuardLivePath`; the wrapper removes stale live output
before each capture step, validates repository, reviewer, `reviewedAt`, and
`checkedAt` on the final evidence date, then requires `status=pass`, `ok=true`,
and `releaseReadinessImpact.status=ready` for every live step with
`expectedStatus=0`; it must stop before `Final release readiness` and record
`outputProblems` if either file is missing, invalid, mismatched, or not ready.
Final receipt publish-hash query repository binding: every
`variableQueries[].command` for `EXPECTED_RELEASE_APK_SHA256` and
`EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256` must include `--repo` matching
`inputs.repository`, the final command receipt summary repository.
Final receipt publish-hash query repository binding marker: variableQueries[].command --repo inputs.repository final command receipt summary repository EXPECTED_RELEASE_APK_SHA256 EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256.
Final receipt step-log byte replay: every final summary step must include
`stdoutPath`, `stderrPath`, `stdoutSha256`, `stderrSha256`, and
`combinedSha256`; readiness reopens the `final-command-receipts` logs and
verifies byte replay before publish signoff can pass.
Final receipt wrapper step set: readiness requires all 11 final receipt wrapper steps
in order: Documentation drift audit; Final readiness focused tests;
External evidence inventory replay; Device packet reconciliation; Strict
handoff receipt replay; Stack architecture receipt replay; Protected master ref
refresh; Protected candidate ancestry proof; Last-mile GitHub release-state
evidence; Last-mile publish-hash variable guard; Final release readiness. The
wrapper rejects missing, duplicate, or reordered recorded step evidence before
status=pass.
Final receipt wrapper step set marker: all 11 final receipt wrapper steps Documentation drift audit Final readiness focused tests External evidence inventory replay Device packet reconciliation Strict handoff receipt replay Stack architecture receipt replay Protected master ref refresh Protected candidate ancestry proof Last-mile GitHub release-state evidence Last-mile publish-hash variable guard Final release readiness wrapper rejects missing duplicate reordered recorded step evidence before status=pass.
Final receipt wrapper step status: every final wrapper step must record
`expectedStatus=0` and `status=0` before publish signoff.
Final receipt success output counts validated `evidenceSummary.steps` recorded
step evidence, not planned wrapper commands; missing recorded steps must stop the
success message path.
Final receipt wrapper constants live in
`scripts/final-readiness-receipt-contract.js`; runner and readiness verifier
changes must keep using that shared contract for final step labels, focused
tests, and `FINAL_READINESS_RECEIPT_BOOTSTRAP`.
Final release readiness command/env binding: `verify-release-readiness.js --strict-final-inputs`
must run with `EXTERNAL_EVIDENCE_INVENTORY_PATH`,
`DEVICE_EVIDENCE_PACKET_PATH`, `RELEASE_CANDIDATE_SHA`, and
`FINAL_READINESS_RECEIPT_BOOTSTRAP` matching `finalCommandReceiptsPath`; no
other env values are allowed because these are the safe final input keys.
Final receipt internal command binding: `Final readiness focused tests` must run
`node_modules/vitest/vitest.mjs run` with
`scripts/verify-release-readiness.test.mjs`, `scripts/verify-doc-drift.test.mjs`,
`scripts/verify-external-evidence-inventory.test.mjs`,
`scripts/device-evidence-packet.test.mjs`,
`scripts/verify-handoff-receipts.test.mjs`, and
`scripts/stack-architecture-receipt.test.mjs`; `inputs.qaPath` must be
`docs/GSAV_NATIVE_QA.md`; inventory replay and device packet steps must use
`--inventory-path`, `--qa-path`, `--packet-path`, `--candidate-sha`, and
`--require-git-integrity`; stack receipt replay must run
`scripts/stack-architecture-receipt.js --require-assets --verify docs/qa-evidence/<date>/stack-architecture-receipt.json`;
protected proof steps must run
`git fetch --no-tags origin master` and `git merge-base --is-ancestor`.
Immediately before raw diagnostic readiness checks, run
`npm run verify:handoff-receipts -- --date <YYYY-MM-DD> --require-git-integrity` without
`--allow-pending` for the same evidence date. Final publish cannot rely on the
pre-G3 blocker JSON or `.template.json` handoff files.
Before all publish rows are complete, reviewers may run
`$env:RELEASE_CANDIDATE_SHA="<payload-sha>"; npm run verify:release-readiness -- --strict-final-inputs`
as a diagnostic expected-fail check. It keeps the pending-row failure and also
reports missing or invalid `DEVICE_EVIDENCE_PACKET_PATH`,
`EXTERNAL_EVIDENCE_INVENTORY_PATH`, and final-audit path fields early; it does
not replace the final readiness command.
The `## Final Publish Signoff` audit section must also record full 40-hex
`payloadSha` and `signoffSha` values plus
`externalEvidenceInventoryPath=docs/qa-evidence/<date>/external-evidence-inventory.json`
and `deviceEvidencePacketPath=<reviewed-packet.json>`,
`stackReceiptPath=docs/qa-evidence/<date>/stack-architecture-receipt.json`,
`protectedCandidateProof=<final receipt protected-candidate ancestry proof>`,
and
`finalCommandReceiptsPath=docs/qa-evidence/<date>/final-command-receipts/verification-summary.json`;
`lastMileReleaseStateEvidence=docs/qa-evidence/<date>/github-release-state-prepublish.json`,
and
`lastMilePublishHashGuardEvidence=docs/qa-evidence/<date>/publish-hash-variable-guard-prepublish.json`;
readiness rejects a missing, mismatched, cross-date, or planning packet path,
missing protected-candidate proof, missing final receipt summary, no-publish
rehearsal summary, missing prepublish release-state proof, or missing prepublish
publish-hash guard after publish rows are otherwise complete. The inventory
path, reviewed packet path, final receipt path, and last-mile evidence paths
must use the same `docs/qa-evidence/<date>/` folder. The release-state JSON
must show `status=pass`, concrete review metadata on the final evidence date,
passing query summaries, zero GitHub releases,
`releaseReadinessImpact.status=ready`, and a successful `workflow_dispatch`
dry run whose URL matches the audit `runUrl`; the publish-hash guard JSON must
show concrete review metadata, `releaseReadinessImpact.status=ready`, GitHub
CLI query provenance, and both expected hash variables absent. The readiness wrapper rejects planning packet
paths before running device packet reconciliation or external inventory replay.
The audit
signoff, external inventory verifier, and strict packet checker also reject
reviewed non-scaffold packet filenames that still contain `scaffold`,
`candidate`, `pending`, or `example`; final replay must use the reviewed packet
JSON. Strict inventory replay requires the reviewed inventory JSON, reviewed
packet JSON, QA table, local `docs/qa-evidence/...` evidence bytes, downloaded
artifact replay files, and route/negative manifest files referenced by the
inventory to be tracked and clean.
Manual publish dispatch inputs `expected_apk_sha256` and
`expected_publish_identity_sha256` come from the reviewed dry-run artifact;
`dry-run-summary.json` must bind the reviewed `apkSha256` and
`publishArtifactIdentitySha256` values.

| Field | Required for |
| --- | --- |
| Evidence Log `Date` in ISO `YYYY-MM-DD` format, not later than the day `npm run verify:release-readiness` runs and within the default 7-day freshness window for publish-counted evidence | Every completed row |
| `Result` starts with `Passed:` or `Passed with scoped exception:` and does not use failure, skip, pending, or blocker status language | Every completed row |
| diveo payload commit SHA, evidence signoff SHA when different, app version, package.json version, clean `app.json`/`package.json`/`package-lock.json` identity files, and Android `versionCode` when relevant | All publish-candidate evidence |
| Build profile, device/emulator model, OS version, and WebView/WKWebView version | Android/iOS device rows |
| Rotation, safe-area/notch/home-indicator check, hardware back or back gesture, no clipped text, no nested-touch ambiguity, and 44dp touch-target check or scoped exception | Android/iOS device rows |
| GSAV web URL, explicit `gsavHostingCommit=<sha/build>` or deployed build identity, and final embedded WebView URL | Embedded route and runtime rows |
| Route, data-saver state, command/manual action, and observed result | Route, negative, and runtime rows |
| Concrete owner as a named person, team handle, GitHub issue, or workflow run link; role placeholders such as `native release owner` do not pass final readiness | Every completed row |
| Release-owned test account, seeded saved/follow state, and account-safe or redacted evidence | `/library`, save, and follow rows |
| Observed bridge events such as `GSAV_AUTH_READY`, `GSAV_ROUTE_CHANGE`, `GSAV_READY`, `GSAV_ERROR`, `GSAV_PLAYBACK_STATE`, and `GSAV_ENDED` | Diagnostics, watch, auth, and resume rows |
| Evidence path entries using only existing `docs/qa-evidence/...` files or trusted GitHub CI/artifact/release URLs under `opsiclear/diveo`, `OpsiClear-Web/diveo`, or `opsiclear/gsav-hosting`; the Evidence path cell must contain only accepted paths or URLs, while owner/date belong in Date, Result, or Notes | Every completed row |
| Row detail evidence URLs that resemble GitHub Actions runs, releases, or `docs/qa-evidence` blobs must be trusted GitHub evidence under `opsiclear/diveo`, `OpsiClear-Web/diveo`, or `opsiclear/gsav-hosting` | Validation prerequisites, release artifact, installed APK smoke, generated version, and dry-run rows |
| APK path, merged manifest path, artifact name exactly `diveo-release-evidence-v<version>`, explicit 64-hex `apkSha256`, explicit 64-hex `manifestSha256`, release-candidate SHA, evidence signoff SHA, explicit 64-hex checksum-manifest SHA256, and workflow run URL when CI produced it | Release artifact, generated version, and dry-run rows |
| `release-evidence/release-candidate.txt`, `release-evidence/signoff-diff-files.txt`, `release-evidence/no-publish-side-effect.txt`, `release-evidence/dry-run-summary.json`, `gsavPackageProvenanceSha256=<64-hex sha>`, `gsavPackageProvenance` entries for `@opsiclear/gsav-bridge` and `@opsiclear/gsav-client` with `specifier=file:vendor/...` plus `tarballSha256=<64-hex sha>`, production preflight/runtime smoke after candidate identity capture, production preflight routes `/explore?embed=native&dataSaver=1`, `/native-diagnostics?embed=native`, `/watch/test?embed=native`, `/watch/test?t=2.5&embed=native`, and `/watch/elly?embed=native`, `GSAV_HOSTING_COMMIT=<actual build/commit>`, `GSAV_HOST_IDENTITY_URL`, `hostIdentityVerified=true`, `hostIdentity.url=<metadata URL>`, `hostIdentity.expectedIdentity=<actual GSAV_HOSTING_COMMIT value>`, `hostIdentity.observedIdentity=<host-served build/commit>`, expected and observed identities matching `GSAV_HOSTING_COMMIT`, `artifactReviewArtifact=<artifact name or ID>` matching the row artifact name unless it is an artifact ID, and `release-evidence/gsav-preflight.json`/`release-evidence/gsav-runtime-smoke.json` `diveoCommit` matching `releaseCandidateSha` plus an explicit runtime host identity value such as `gsavHostingCommit=<sha/build>` | Release dry-run row and uploaded `release-evidence/**` bundle |
| Production range-probe URL, `Range` request, `206`, concrete `Content-Range` bytes value, `Access-Control-Allow-Origin=*` or the production GSAV origin, concrete `Access-Control-Expose-Headers=Accept-Ranges, Content-Length, Content-Range, ETag`, and whether the check ran in release CI | Production `.gsav` range-probe row |
| Scoped exception fields: `exception gate=<row route or evidence row>; owner=<release owner>; reason=<exact blocker>; affected=<platform/artifact>; approver=<name>` or a GitHub issue/run link; `revisit=<YYYY-MM-DD>` | Any temporary exception row |

When a completed row names `releaseCandidateSha`, `candidate_ref`, or
`evidenceSignoffSha`, the value must be a full 40-hex SHA and must match the
current payload candidate or evidence signoff commit being checked by
`npm run verify:release-readiness`.
For release artifact, generated-version, and release dry-run rows, any GitHub
Actions run ID in the Evidence path cell must match the row's workflow run URL;
do not mix artifact links from one run with summary text from another run.
Pending rows do not count. Future-dated rows and rows older than the default
7-day freshness window do not count. Terminal-only notes do not count unless
the raw output is saved under `docs/qa-evidence/<date>/`.
Do not mark a result as `Verified`, `Complete`, `Skipped`, `Blocked`, or
`Not passed`; use `_pending_` plus an audit blocker until the row can truthfully
start with `Passed:` or `Passed with scoped exception:`.
`Passed with scoped exception:` rows are no-publish blocker evidence by
default. They preserve owner, reason, affected surface, approver, and revisit
details, but `npm run verify:release-readiness` still fails until the real
validation evidence replaces the exception or a future reviewed rule explicitly
allows that row type for publish.
Combined `Android/iOS` negative rows must use a two-link evidence format such as
`docs/qa-evidence/<date>/android-...; docs/qa-evidence/<date>/ios-...`, or
markdown links whose URLs point to those paths or to trusted GitHub evidence
URLs for `opsiclear/diveo`, `OpsiClear-Web/diveo`, or `opsiclear/gsav-hosting`. Do not prefix local paths with
`Android:` or `iOS:` because `verify:release-readiness` splits evidence entries
on semicolons and expects each local path entry to start with
`docs/qa-evidence/`. Do not mix in freeform notes, drive paths, `file://` URLs,
or non-QA local paths. A single-platform result must include the scoped exception
fields listed above. Exceptions are temporary validation blockers and cannot
replace candidate identity, production range probe, APK/manifest checksum, or
release dry-run identity proof.
For publish readiness, GSAV host identity must be a concrete deployed build,
commit SHA, CI run, release artifact, or a scoped release-owner exception.
`unavailable` is acceptable only for local pre-release smoke evidence and does
not satisfy a production publish row.

## Required Route Matrix

| diveo route | Expected embedded URL behavior |
| --- | --- |
| `/` | Native home/feed loads catalog cards without WebView chrome |
| `/search` | Native search queries catalog and opens `/watch/:id` |
| `/library` | Native saved-scenes UI loads for signed-in users |
| `/creator/:handle` | Native creator profile opens scenes via `/watch/:id` |
| `/explore` | Intentional hosted runtime route loads `/explore?embed=native`, plus `dataSaver=1` when enabled |
| `/gsav-diagnostics` | WebView loads `/native-diagnostics?embed=native` |
| `/watch/test` | WebView loads `/watch/test?embed=native` and reaches ready or explicit unsupported state |
| `/gsav/test?t=2.5` | Alias preserves id/start time and appends `embed=native` |

`/login` and `/settings` are still native React Native surfaces, but they are
not release-readiness route rows for this publish gate. Validate them through
local quality, import-boundary checks, any auth/settings-specific change tests,
and the G6 product journey manifest
`docs/qa-evidence/<date>/product-journey-manifest.json`. The reviewed device
packet target must carry
`productJourneyManifestPath=docs/qa-evidence/<date>/product-journey-manifest.json`,
and final packet validation checks that the manifest metadata matches the
packet target. If an auth or settings change affects embedded player session
timing, data saver, retry, or resume behavior, rerun the related runtime,
negative, and device rows above.

## Route Validation Steps

Use these steps for both Android and iOS route evidence unless a platform note
says otherwise.

| Route | Action | Pass criteria | Evidence |
| --- | --- | --- | --- |
| `/` | Launch the app to the home route | Feed cards render natively; no gsav-hosting top nav or mini player appears | Screenshot plus device target |
| `/search` | Search for a known scene, then open a result | Search UI stays native and navigates to `/watch/:id` | Screenshot or short recording |
| `/library` | Sign in, save a scene, then reopen Library | Saved-scenes list renders natively and opens watch routes | Screenshot plus account-safe log note |
| `/creator/:handle` | Open a known creator profile and tap a scene | Creator profile is native and scene navigation reaches `/watch/:id` | Screenshot or recording |
| `/explore` | Open Explore with data saver off, then on | WebView URL includes `embed=native`; data saver adds `dataSaver=1`; web chrome remains hidden; native Home/Search remain the catalog discovery surfaces | WebView URL/log plus screenshot |
| `/gsav-diagnostics` | Open diagnostics route | Capabilities and route-change bridge messages render or log clearly | Screenshot plus bridge log |
| `/watch/test` | Open watch, interact with playback, leave and return | Ready/unsupported state is explicit; progress saves; resume is near last time | Playback/resume recording or filtered log |
| `/gsav/test?t=2.5` | Open alias route directly or through native navigation | Alias preserves `test` and start time, then embeds `/watch/test?t=2.5&embed=native` | Route log or automated test output |

Shared device checks: rotate once, verify safe areas around notches/home
indicators, test retry UI when available, and on Android press hardware back
after WebView navigation to confirm history is traversed before the native route
closes.

Capture device details and filtered logs with the evidence. Useful filters:

```powershell
adb logcat -c
adb logcat ReactNativeJS:I chromium:I WebView:I *:S | Select-String -Pattern "GSAV_|navigation|blocked|retry|session|WebView"
adb shell dumpsys webviewupdate
```

Before a device run, create the packet scaffold so every route and negative case
has an expected evidence file name and metadata checklist:

```powershell
npm run device-evidence:packet -- --date <YYYY-MM-DD> --owner <reviewer> --candidate-sha <payload-sha> --gsav-host-url <https production GSAV host> --gsav-hosting-commit <GSAV_HOSTING_COMMIT> --output-path docs/qa-evidence/<date>/device-evidence-packet-scaffold.json
npm run device-evidence:packet -- --check --allow-pending --input-path docs/qa-evidence/<date>/device-evidence-packet-scaffold.json --qa-path docs/GSAV_NATIVE_QA.md --candidate-sha <payload-sha>
npm run verify:no-publish-baseline -- --date <YYYY-MM-DD> --candidate-sha <payload-sha> --output-path docs/qa-evidence/<date>/no-publish-baseline.json --require-source-evidence-git-integrity
```

That pre-dry-run scaffold and `verify:no-publish-baseline` output are pending
G0/pre-G3 inventory only. The baseline JSON must report
`scope=pre-g3-no-publish-baseline`, audit `decision=no-publish`, and
`target.releaseCandidateSha=<payload-sha>` for the pending packet scaffold when
`--candidate-sha` is supplied. It is invalid after the first fixed-candidate
`Release APK` `workflow_dispatch` dry run. `--candidate-sha`,
`RELEASE_CANDIDATE_SHA`, and `RELEASE_PAYLOAD_CANDIDATE_SHA` must be full
40-hex SHAs before the baseline command will run. After the G3 dry run exists,
regenerate or update a post-G3 candidate packet with the fixed dry-run identity
before marking any route or negative packet `passed`:

```powershell
npm run device-evidence:packet -- --date <YYYY-MM-DD> --owner <reviewer> --candidate-sha <payload-sha> --dry-run-artifact diveo-release-evidence-v<version> --dry-run-run-url <https://github.com/.../actions/runs/...> --gsav-host-url <https production GSAV host> --gsav-hosting-commit <GSAV_HOSTING_COMMIT> --output-path docs/qa-evidence/<date>/device-evidence-packet-candidate.json
npm run device-evidence:packet -- --check --allow-pending --input-path docs/qa-evidence/<date>/device-evidence-packet-candidate.json --qa-path docs/GSAV_NATIVE_QA.md --candidate-sha <payload-sha>
```

When all 22 packets are complete and reviewed, save the final packet at a
non-scaffold path such as
`docs/qa-evidence/<date>/device-evidence-packet-reviewed.json`, rerun the check
without `--allow-pending`, and pass that same path through
`DEVICE_EVIDENCE_PACKET_PATH` and the audit
`deviceEvidencePacketPath=<reviewed-packet.json>` field.
In strict mode, `device-evidence:packet --check` enforces the lifecycle path:
the input must be a JSON file directly under `docs/qa-evidence/<date>/`, and
the basename must not contain `scaffold`, `candidate`, `pending`, or `example`.
Use `--allow-pending` only for scaffold or candidate packet checks before final
readiness.

The packet scaffold is not release evidence by itself. A completed packet still
needs route or negative-case screenshots, recordings, or filtered logs, and the
matching QA Evidence Log row must summarize the observed signal.
The final reviewed packet also requires
`docs/qa-evidence/<date>/product-journey-manifest.json` as
`target.productJourneyManifestPath`. That manifest must set
`artifactPurpose=product-journey-manifest`, `helperOnly=false`, match the packet
target release/host identity, include concrete `reviewer` and `reviewedAt`, and
contain `fixtureManifestPath=docs/qa-evidence/<date>/fixture-manifest.json`
plus `fixtureManifestSha256=<64-hex>` matching the fixture file's current
bytes, and contain Android plus iOS entries for `first-launch-home`, `search`,
`creator`, `library`, `login-auth-return`, `watch-alias`, `explore`,
`diagnostics-hierarchy`, `settings`, `accessibility-ergonomics`, and
`degraded-blocked-states`. Product journey entry IDs must be unique. Each entry
must include distinct Android and iOS `evidencePaths`, observations, one
`mediaSha256` per local
`docs/qa-evidence/...` evidence path, and one `fileSha256` plus URL-matched
`sourceRunId` and `sourceArtifactId` for each external evidence URL. Packet
check enforces product-journey semantic `observedSignals` for every required
entry: native Home feed state, no hosted web chrome, Search, Library, and
Settings visible, Explore placement not acting as a competing catalog shell,
search empty/results/no-results state, keyboard visible without overlap, search
result opens watch route, real creator content, follow signed-out to login and return,
scene opens watch route, logged-out Library CTA, signed-in seeded saved scenes,
account-safe redaction, keyboard-visible native Login UI, return to the
requested native route, no hosted account chrome, `/watch/test`
ready/unsupported/error state, `/gsav/test?t=2.5` embedding
`/watch/test?t=2.5&embed=native`, progress saves and resume works, exactly one
`embed=native` marker on Explore, data saver adding `dataSaver=1`, hosted chrome
hidden, vertical swipe/scroll changing the active scene, visible active-scene
change, back behavior returning to the native shell, Home not exposing
diagnostics as primary, Settings exposing a secondary diagnostics action,
`/native-diagnostics?embed=native`, scrollable settings, settings touch targets,
safe-area, no clipped text, 44dp touch targets, no nested touch conflicts,
nonblank native blocked state, unsupported/retry/error state, and no blank
WebView. For Explore, "not a competing catalog shell" means Home may expose
Explore only as a secondary/runtime-scoped action while the native feed, Search,
Library, and Settings remain visible and usable without entering hosted Explore.
Evidence passes only when the Explore capture shows exactly one `embed=native`,
hidden hosted public/account chrome, vertical swipe/scroll changing the active
scene, a visible active-scene change, native-shell back behavior, and no hosted
product route replacing the native catalog. Evidence fails if Explore becomes
the primary Home browse surface, exposes hosted top navigation/account/catalog
chrome, or lets same-origin hosted product routes escape the player boundary.
The external evidence inventory must include the product journey
manifest, the fixture manifest named by `fixtureManifestPath`, and every
manifest entry `evidencePaths` item as reviewed, SHA256-backed entries. The
fixture manifest and local linked journey evidence must live under the same
`docs/qa-evidence/<date>/` folder as `product-journey-manifest.json`; inventory
replay rejects stale local fixture or media paths from another evidence date.
The fixture manifest entry for `docs/qa-evidence/<date>/fixture-manifest.json` must
include `artifactPurpose=fixture-manifest`, `helperOnly=false`, and a `sha256`
matching `fixtureManifestSha256`. Each linked journey evidence entry must
include `artifactPurpose=product-journey-evidence`, `helperOnly=false`, and
either `journeyEntryId` or `sourceRefs` pointing back to the manifest entry ID.
Completed fixture manifests must use account-safe aliases and redaction notes;
raw emails, URL credentials, token assignments, and account IDs are invalid.
Its reviewed inventory `sha256` must match the manifest entry's `mediaSha256`
for local evidence or `fileSha256` for URL-backed evidence.
For URL-backed linked journey evidence, inventory replay also checks the
manifest entry's `sourceRunId` and `sourceArtifactId` against the evidence URL.
For `docs/qa-evidence/<date>/product-journey-manifest.json`, every manifest entry `evidencePaths` item is reviewed as SHA256-backed inventory entries.
Inventory replay opens `fixture-manifest.json` and verifies the fixture manifest
contents include `artifactPurpose=fixture-manifest` and `helperOnly=false`
before the fixture can count.
`product-journey-manifest.json` must be valid JSON with an entries array before
inventory expansion can expand linked evidence. Its reviewed inventory row must
include `artifactPurpose=product-journey-manifest` and `helperOnly=false`.
Inventory replay also opens `product-journey-manifest.json` and verifies the
manifest contents include `artifactPurpose=product-journey-manifest` and
`helperOnly=false` before expanding linked evidence. Inventory replay rejects
missing, placeholder, `unknown`, or duplicate product journey entry IDs before
any linked journey evidence can count.
To inspect a schema-backed reviewed packet excerpt before filling the real
22-packet file, run:

```powershell
npm run device-evidence:packet -- --example
```

The example output is documentation only; use `--output-path` to create the
real scaffold and `--check` to validate it.
`diveo-device-validation-*`, `device-validation-bundle-verifier.json`,
`validation-prereqs.json`, and attached `downloaded-release/release-evidence/**`
helper artifacts cannot satisfy completed route or negative packet evidence.
Bare `actions/runs/<id>` URLs also cannot satisfy completed route or negative
packet evidence. External packet artifacts must set `actual.artifactPurpose` to
`route-evidence` or `negative-evidence`, plus `actual.evidenceManifestPath`,
64-hex `actual.evidenceManifestSha256`, digit-only `actual.sourceRunId`, and
`actual.sourceArtifactId`; for GitHub Actions artifact URLs those source fields
must match the URL. Direct external artifact paths also need one matching
64-hex `actual.fileSha256` per artifact URL. When
`actual.evidenceManifestPath` points at a repository-local
`docs/qa-evidence/...` file, the packet verifier hashes that manifest and
requires it to match `actual.evidenceManifestSha256`. Packet local evidence
same-date replay: `actual.evidencePaths` and `actual.evidenceManifestPath` must
live under the packet target evidence date `docs/qa-evidence/<date>/` folder;
device packet replay rejects stale local route or negative packet evidence from
another evidence date. Local screenshots, recordings, zip/PDF files, or other
binary evidence paths need one matching 64-hex `mediaSha256` per local media
artifact; text logs do not. Combined negative packets must include distinct
Android and iOS evidence paths. When all packet entries are filled and marked `passed`, rerun the check without
`--allow-pending` before the final receipt wrapper. The final
`npm run verify:final-readiness-receipts -- --candidate-sha <payload-sha> --date <YYYY-MM-DD> --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --packet-path <reviewed-packet.json> --stack-receipt-path docs/qa-evidence/<date>/stack-architecture-receipt.json`
run enforces the same strict packet check through its underlying readiness
diagnostic after all evidence rows are otherwise complete. Pending baseline checks
may derive `docs/qa-evidence/<device-row-date>/device-evidence-packet-scaffold.json`;
final publish readiness must set
`DEVICE_EVIDENCE_PACKET_PATH=<reviewed packet json>` to a reviewed non-scaffold
packet path. The optional `--strict-final-inputs` readiness diagnostic reports
that missing reviewed packet path even before pending route/device rows are
complete. Strict packet
checks require `target.releaseCandidateSha` to be a full 40-hex payload SHA and
to match the `RELEASE_CANDIDATE_SHA` passed into final readiness. They also
require `target.dryRunArtifact=diveo-release-evidence-v<version>`,
`target.dryRunRunUrl=<exact trusted Diveo release Actions run URL>`, semver app/package
versions, a positive Android `versionCode`, a concrete owner, a non-local
non-example HTTPS GSAV host URL, and a concrete `target.gsavHostingCommit`
deployed host/build identity. These target requirements apply as soon as any
packet has `status=passed`, even if the check still uses `--allow-pending` for
the remaining packets. The packet check also reconciles passed packet
rows against the QA Evidence Log: a passed packet needs a matching `Passed:`
QA row that references the packet evidence paths, summarizes an observed
signal, and repeats the packet target release-candidate SHA, dry-run artifact,
and exact trusted Diveo release run URL. A passed QA row cannot exist while its packet is still
pending or blocked. The
completed route packets must fill UX checks for rotation, safe area, back
navigation, clipped text, nested-touch ambiguity, and 44dp touch targets.
Embedded route packets also need `sameOriginProductPathOutcome` proving
same-origin native-owned hosted product paths fail closed with a nonblank
`Navigation blocked` state for this release. The concrete validation trigger is
`/gsav-diagnostics` in a build with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1`, then tap
`Same-origin`; it navigates the embedded page to `/creator/qa-native-blocked`.
Attach that outcome to the embedded route packet instead of adding a separate
negative readiness row. `device-evidence:packet --check` rejects weak
`sameOriginProductPathOutcome` wording unless it names the `Same-origin`
diagnostics trigger or reviewed route fixture, the attempted product path such
as `/creator/qa-native-blocked`, and the visible `Navigation blocked` or
nonblank native state. The
no-publish baseline verifier should pass only while branch protection is ready,
expected publish hash variables are absent, no fixed-candidate dry-run artifact
or `Release APK` `workflow_dispatch` fixed-candidate dry run exists, all device
packets remain pending, handoff receipts are captured as the known missing-only
owner/fixture/host-ready blocker set, the handoff blocker JSON includes exact
dated `receiptPaths` plus `checked.*.status=missing` entries for those three
receipt paths, `no-publish-baseline.json` records matching
`handoffReceipts.expectedReceiptPaths` and `handoffReceipts.checked`, and
release readiness still fails for the expected pending rows. The
release-candidate bundle replays that baseline output shape and rejects
summary-only, stale-date, or swapped handoff receipt detail. Its direct
`verify:handoff-receipts --allow-pending` step must also report the same
`evidenceDate`, exact dated `receiptPaths`, blocker paths, and
`checked.*.status` values that align with each missing or passing receipt.
For release-candidate signoff evidence, run the bundle with
`npm run verify:release-candidate -- --date <YYYY-MM-DD> --candidate-sha <payload-sha>`
so the direct handoff and no-publish baseline child steps both use the same
explicit evidence date and record `EVIDENCE_DATE` in the step evidence summary.
The baseline reports `scope=pre-g3-no-publish-baseline`; after G3,
use candidate-pinned readiness plus the affected packet, inventory, artifact,
or bundle verifier instead of regenerating the aggregate baseline. The baseline
is a local blocker proof by default. Before treating it as promotion-grade G0
source evidence, rerun it from a clean checkout with
`--require-source-evidence-git-integrity`; that strict mode requires the
branch-protection, publish-hash, release-state, packet scaffold,
validation-prereq blocker, handoff blocker, QA, and audit files to be tracked
and clean. A passing local baseline with `gitIntegrityRequired=false` does not
approve promotion. The baseline
handoff receipt templates can be created with
`npm run verify:handoff-receipts -- --date <YYYY-MM-DD> --write-template-dir docs/qa-evidence/<date>/handoff-receipt-templates`;
those `.template.json` files are preparation aids only and do not count until
they are filled with concrete values, moved to the required receipt paths, and
`npm run verify:handoff-receipts` passes without `--allow-pending`. Final
readiness and publish workflows run
`npm run verify:handoff-receipts -- --date <YYYY-MM-DD> --require-git-integrity`,
so the three reviewed receipt JSON files must also be tracked and clean.
The completed fixture manifest must also name `gsavHostUrl` and
`gsavHostingCommit`; every expected embedded fixture URL must share that host
origin, and the commit must match the host-ready receipt's `gsavHostingCommit`
and `observedIdentity`. Every expected embedded fixture URL must contain exactly
one `embed=native`; the Explore fixture URL must also contain exactly one
`dataSaver=1`, matching the Shorts runtime-smoke target. The fixture URL paths
must match their native route contract: `/explore` loads hosted `/explore`,
`/gsav-diagnostics` loads hosted `/native-diagnostics`, and watch or alias
routes load `/watch/<single-segment scene id>` using the scene IDs recorded in
the manifest. The completed host-ready receipt must use
`schemaVersion=gsav-host-ready/v2`, set `evidenceDate` to the same
`<YYYY-MM-DD>` used by the verifier, keep `GSAV_HOST_IDENTITY_URL` on the same
origin as `gsavHostUrl`, and its
`routeGuardTest.command` must name the hosted native route guard, local
route-guard/preflight/runtime-smoke evidence paths must stay under the same
`docs/qa-evidence/<date>/` directory, and range
`Access-Control-Allow-Origin` must be `*` or the exact `gsavHostUrl` origin.
Explicit
handoff receipt paths must be repository-relative `.json` files inside the
repository, and their basenames must not contain `template`, `example`,
`pending`, `scaffold`, or `candidate`; otherwise the verifier treats them as
invalid even if their JSON contents are complete. The baseline
also compares the exact missing-row inventory, so a swapped, silently dropped,
or newly introduced publish evidence row cannot pass on count alone. Its
source evidence must be current for the same evidence date: branch-protection,
publish-hash, and release-state JSON must target `OpsiClear-Web/diveo`, include
concrete reviewer and ISO `reviewedAt`, and contain successful GitHub query
proof or deterministic absent-variable results. The packet scaffold must also
have `target.evidenceDate` matching the baseline date and same-day
`generatedAt`. The aggregate baseline output records the GitHub-derived
reviewers and `reviewedAt` timestamps so the source-control review is visible
without reopening each source JSON. Its
validation-prerequisite blocker inventory must also match the Android state it
records: missing `adb`, failed `adb devices`, no connected device, or connected
devices with incomplete model/OS/API/build/WebView metadata are distinct
expected blockers.

For iOS, capture the simulator/device model and OS version from Xcode or
`xcrun simctl list devices`, then filter Console/Xcode logs for:

```text
GSAV_
navigation
blocked
retry
session
WKWebView
```

## Publish Candidate Device Runbook

Use the Android and iOS sections below for local rehearsal. Android
publish-counted route and negative rows require the fixed payload SHA,
production HTTPS or release-equivalent staging GSAV host,
`GSAV_HOSTING_COMMIT`, and the exact downloaded G3 dry-run APK. A
release-equivalent Android validation build is rehearsal evidence or a scoped
no-publish exception only. iOS publish-counted route and negative rows require a
trusted WKWebView validation artifact tied to the same candidate. Completed
publish-counted route and negative rows must include
`releaseCandidateSha=<payload sha>`, `dry-run artifact=diveo-release-evidence-v<version>`,
and `dry-run run URL=<exact trusted Diveo release Actions run URL>`. Earlier
release-equivalent evidence must use a scoped exception with `releaseEquivalentNoPublish=true`
and a concrete reviewer, and remains a no-publish blocker.

Before device capture:

1. Run the release `workflow_dispatch` dry run with `publish_release=false`.
2. Download the `diveo-release-evidence-v<version>` artifact.
3. Run `npm run verify:release-evidence-bundle` against the downloaded
   `release-evidence/**`, APK, and manifest.
4. Run `npm run verify:validation-prereqs` or the `Device Validation` workflow
   so Android tools, iOS owner/device/artifact bytes, production env, and exact
   APK/manifest paths are recorded.
5. Generate or update the device packet scaffold and fill every route or
   negative packet with actual screenshot/video/log paths. Include one 64-hex
   `mediaSha256` for each local screenshot, recording, zip/PDF, or other binary
   evidence path.

Minimum publish evidence per platform:

| Platform | Minimum target | Required proof |
| --- | --- | --- |
| Android | One phone-class device or emulator with current WebView, installing the exact downloaded G3 dry-run APK for route, negative, and installed-smoke evidence | Device model, Android OS/API, WebView package/version, APK SHA256, installed `versionCode`, GSAV host/build identity, final route URL where relevant, screenshots/video/logs, rotation, safe-area, hardware-back, clipped-text, nested-touch, and 44dp checks |
| iOS | One iPhone-class simulator or physical device with WKWebView validation tied to a trusted artifact URL/path/SHA256 | Device/simulator model, iOS version, WKWebView/WebKit version, owner/executor proof, artifact SHA256 match, GSAV host/build identity, final route URL where relevant, screenshots/video/logs, rotation, safe-area/home-indicator, back gesture, clipped-text, nested-touch, and 44dp checks |

## Android Runbook

Local rehearsal only:

```powershell
cd ..\diveo
$env:EXPO_PUBLIC_GSAV_WEB_URL='http://10.0.2.2:5191'
npx expo run:android
```

Checklist:

- Home, search, creator, and library are native screens with no web top nav.
- Opening a scene enters the embedded player and hides gsav-hosting desktop
  chrome.
- `/gsav-diagnostics` reports capabilities in the WebView.
- `/watch/test` reaches ready state or an explicit unsupported message.
- Enabling data saver causes embedded `/explore` to include `dataSaver=1`.
- Playback progress is saved and reopening a scene resumes near the last time.
- Android hardware back traverses WebView history before exiting the route.
- Rotation and safe-area spacing remain usable.

## Android Installed Release Smoke

After downloading the exact G3 dry-run release artifact, use the helper below
on a machine with Android platform-tools. The local Gradle path is rehearsal
only; publish-counted evidence must use the APK and dry-run summary from the
downloaded artifact.

```powershell
npm run android:installed-smoke -- `
  --apk-path "$APK_PATH" `
  --output-path docs/qa-evidence/<date>/android-installed-release-smoke.txt `
  --dry-run-summary-path "$DOWNLOADED_RELEASE_DIR/release-evidence/dry-run-summary.json" `
  --production-host-url <https production GSAV host> `
  --ci-artifact-url <https://github.com/OpsiClear-Web/diveo/actions/runs/.../artifacts/...>
```

The helper installs the supplied APK, launches `com.opsiclear.diveo`, opens
`gsav://explore`, `gsav://gsav-diagnostics`, and `gsav://watch/test`, then
captures the APK SHA256, `dumpsys package` `versionCode`, WebView update info,
filtered React Native/Chromium/WebView logs, and optional dry-run summary/CI
artifact identity. Publish-counted evidence should pass
`--dry-run-summary-path` so the helper can compare `apkSha256` and installed
`versionCode` with `release-evidence/dry-run-summary.json`. The output is
supporting evidence only; the QA row still needs the device model, Android OS,
WebView version, production GSAV URL, and observed hidden chrome, bridge
readiness or explicit unsupported/error state, retry UI, and resume behavior.

## iOS Runbook

Local rehearsal only:

```bash
cd ../diveo
export EXPO_PUBLIC_GSAV_WEB_URL='http://127.0.0.1:5191'
npx expo run:ios
```

For publish-counted iOS evidence, capture the same route matrix against the
fixed production HTTPS or release-equivalent staging host and package screenshots, videos, or filtered
logs into a trusted GitHub artifact or committed `docs/qa-evidence/<date>/`
path. Record the artifact SHA256 with `shasum -a 256 <artifact>` or an
equivalent hashing command, and pass that value to
`ios_validation_artifact_sha256` in the `Device Validation` workflow.

Checklist:

- Native browse/search/library screens render without web chrome.
- Embedded player and diagnostics routes load in WKWebView.
- Capability/playback state is explicit.
- Back gestures and safe areas are usable around notches and home indicator.

## Bridge Smoke

Use diagnostics, WebView logs, or manual playback to confirm:

- Web to native: `GSAV_AUTH_READY`, `GSAV_CAPABILITIES`,
  `GSAV_ROUTE_CHANGE`, `GSAV_READY`, `GSAV_ERROR`,
  `GSAV_PLAYBACK_STATE`, `GSAV_FIRST_FRAME` when available, and
  `GSAV_ENDED`. If the renderer reports ready or an explicit error without
  first frame, record the renderer state instead of treating the missing
  first-frame event as a standalone failure.
- Native to web: session set/clear messages via `@opsiclear/gsav-bridge`.
- Native resume store updates on progress and clears on ended.
- Initial player mount waits for settings restore and auth initialization before
  sending a session message.

## Negative Fixture Inventory

Each negative case must name an exact trigger before a pending row can become
release evidence. Do not replace a pending row with "manual check passed" unless
the row names the route, fixture, command or device action, expected log/event
string, and evidence file. If the trigger does not exist yet, keep the row
pending and record the fixture as owner-blocked in the audit.

Publish-counted negative rows must also prove release parity. Missing-host rows
should record the intended production HTTPS or release-equivalent staging GSAV host/build identity,
then prove the unset app configuration fails closed. Offline/retry rows should
record the target host before it is blocked or stopped, then prove recovery
against that same host. QA-control rows may use
`EXPO_PUBLIC_GSAV_QA_CONTROLS=1` or `EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000`
only in a release-equivalent validation build; the row must name the matching
dry-run payload/artifact or production-config parity proof, the QA flag used,
and separate prerequisite evidence proving production publish config has no QA
flags.

| Case | Exact trigger to use | Expected signal | Fixture status |
| --- | --- | --- | --- |
| Missing host config | Launch `/watch/test` or `/gsav-diagnostics` with `EXPO_PUBLIC_GSAV_WEB_URL` unset | Native configuration/error UI is visible and no blank WebView is shown | Available through app config |
| Host offline/retry | Open `/watch/test`, stop the GSAV preview or block the staging host, then tap retry after the host returns | Error/retry UI appears, then recovers on retry | Available through host control |
| Cross-origin navigation | Build with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1`, open `/gsav-diagnostics`, and tap `Cross-origin` to set the embedded page location to `https://example.com` | Navigation is blocked and the app stays on the trusted native route; QA panel shows `Blocked external navigation` | Available through diveo diagnostics QA controls |
| Unsupported renderer | Build with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1`, open `/gsav-diagnostics`, and tap `Unsupported` to inject a trusted unsupported-capabilities bridge message | Native overlay reports the QA unsupported renderer state without a blank WebView | Available through diveo diagnostics QA controls |
| Auth initialization gate | Build with `EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000`, open `/gsav-diagnostics` or `/watch/test` while auth restore is delayed, and capture bridge logs | No clear-session bridge message is sent before auth initialization completes | Available through diveo auth delay QA flag |
| Ended playback | Build with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1`, open `/gsav-diagnostics`, tap `Ended`, then reopen `/watch/test` | Saved progress for `test` is cleared and stale resume is not offered | Available through diveo diagnostics QA controls |

## Negative Fixture Backlog

Use this backlog for owner-blocked or conditional cases. No negative fixture is
currently owner-blocked; keep this table empty unless a trigger is removed or a
new negative case is added without a runnable route, flag, command, or hosted
control.

| Case | Target owner/repo | Required fixture shape | Acceptance criteria before device QA |
| --- | --- | --- | --- |

The evidence log keeps one combined `Android/iOS` row per negative case because
`npm run verify:release-readiness` expects that schema. To complete one of those
rows, write separate path entries in the evidence field, for example:
`docs/qa-evidence/<date>/android-cross-origin-block.txt;
docs/qa-evidence/<date>/ios-cross-origin-block.txt`. Markdown links are also
valid when the link targets point to those paths or to trusted GitHub
CI/artifact/release URLs under `opsiclear/diveo`, `OpsiClear-Web/diveo`, or
`opsiclear/gsav-hosting`. A single-platform result is valid only with scoped
exception fields in the row.

## Negative Validation Steps

| Case | Trigger | Pass criteria | Suggested evidence file |
| --- | --- | --- | --- |
| Missing host config | Launch `/watch/test` or `/gsav-diagnostics` without `EXPO_PUBLIC_GSAV_WEB_URL` | Native configuration/error UI renders instead of a blank WebView | `docs/qa-evidence/<date>/missing-host-config.*` |
| Host offline/retry | Stop the GSAV preview after opening `/watch/test`, then restart and tap retry | Error/retry UI appears and recovers after the host returns | `docs/qa-evidence/<date>/offline-host-retry.*` |
| Cross-origin navigation | Use `/gsav-diagnostics` with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1`, then tap `Cross-origin` | Navigation is blocked and the app stays on the trusted native route | `docs/qa-evidence/<date>/cross-origin-block.*` |
| Unsupported renderer | Use `/gsav-diagnostics` with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1`, then tap `Unsupported` | Native overlay reports the QA unsupported renderer state without a blank WebView | `docs/qa-evidence/<date>/unsupported-renderer.*` |
| Auth initialization gate | Build with `EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000`, mount `/gsav-diagnostics` or `/watch/test`, and capture bridge logs before auth restore finishes | No clear-session bridge message is sent before auth initialization completes | `docs/qa-evidence/<date>/auth-init-gate.*` |
| Ended playback | Use `/gsav-diagnostics` with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1`, tap `Ended`, then reopen `/watch/test` | Saved progress is cleared and stale resume is not offered | `docs/qa-evidence/<date>/ended-clears-progress.*` |

Same-origin product-path blocking is a required route-packet subcheck rather
than a seventh negative readiness row. Use `/gsav-diagnostics` with
`EXPO_PUBLIC_GSAV_QA_CONTROLS=1`, tap `Same-origin`, confirm the nonblank native
`Navigation blocked` state for `/creator/qa-native-blocked`, and record the
result as `sameOriginProductPathOutcome` on the embedded route packet.

Local unit coverage proves the auth-init helpers and host-side effects emit no
native WebView injection or Expo web iframe `postMessage` before auth
initialization, then send clear/set-session only after initialization, target,
and origin are ready. Source-level tests also guard both host files against
bypassing those helpers. Native WebView message-routing tests also prove
untrusted page origins are ignored, `GSAV_AUTH_READY` applies session without
progress handling, missing platform page URLs follow the navigation-gate trust
model, and trusted `GSAV_ENDED` messages clear resume progress through the
native host path. Native WebView navigation-decision tests prove same-origin
GSAV routes stay inside the WebView only with exactly one `embed=native`
marker; hosted `/gsav/:id` and `/gsav-diagnostics` remain native-owned routes
and are rejected as embedded hosted paths; same-origin product routes such as
`/`, `/creator/*`, `/account/*`, `/studio`, `/upload`, `/watchlist`, and
`/explore-preview` fail closed instead of opening as generic external browser
links, with a visible `Navigation blocked` native overlay outside QA mode; true
external `http(s)` URLs are blocked from the WebView and marked for
system-browser handoff; and malformed/non-origin schemes fail closed with the
same visible native blocked-navigation state. Native WebView load-state tests
prove load errors hide the loading overlay, display a stable retryable error
message, clear stale errors on new load, and retry by remounting the WebView.
Native bridge-overlay tests
prove trusted unsupported `GSAV_CAPABILITIES`, `GSAV_ERROR`, and bridge-version
mismatch messages surface native errors and that ready/reset clears stale bridge
errors. That coverage is a pre-device guard; release validation still requires
Android and iOS WebView evidence for the observed bridge message timeline.

Combined `Android/iOS` negative-case rows must contain evidence for both
platforms. The result or linked files must explicitly show the required signal:
`blocked` for cross-origin navigation, `recovered` for offline retry,
`unsupported` or `error` for unsupported renderer, no clear-session message
before auth initialization, and `GSAV_ENDED` clearing resume state.
One-platform evidence requires scoped exception fields. Rows for missing-host
and offline/retry must include the intended production HTTPS or release-equivalent staging host even
when the immediate trigger is an unset or temporarily unavailable host. Rows
that use QA controls must name the QA flag, matching validation artifact, and
production no-QA-flag prerequisite proof.

## Release Evidence Requirements

| Evidence row | Required observed signal |
| --- | --- |
| Android/iOS route rows | Native routes show no gsav-hosting web chrome; embedded routes include `embed=native`; Explore with data saver includes `dataSaver=1`; watch/alias routes preserve scene ID and start time |
| JS runtime smoke | Publish-counted `npm run gsav:runtime-smoke` output showing `embed=native`, hidden `topNav`/`miniPlayer`, `/explore?embed=native&dataSaver=1` with exactly one `embed=native` and one `dataSaver=1`, one `.shortsFeed`, multiple `.shortsItem` scenes, vertical scroll snap, visible scene change after scroll, captured `GSAV_AUTH_READY`, compatible `GSAV_BRIDGE_READY` bridge version and `minVersion`, `GSAV_ROUTE_CHANGE`, Node/npm metadata, explicit `gsavHostingCommit=<sha/build>` or equivalent deployed GSAV host/build identity, and a non-local HTTPS GSAV URL; local preview smoke is a pre-release guard only. A scoped release-owner exception records a no-publish blocker until real production smoke evidence lands or the audit records an explicit no-publish decision |
| Negative validation rows | Distinct Android and iOS evidence paths, or scoped exception fields; result text must describe the trigger and the observed block/retry/auth/resume behavior, production HTTPS or release-equivalent staging host identity for missing-host and offline/retry rows, and QA validation build parity plus production no-QA-flag proof for rows that use QA controls |
| Release validation prerequisites | `npm run verify:validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --ios-artifact-path "$IOS_VALIDATION_ARTIFACT_PATH" --output-path "$VALIDATION_PREREQS_PATH"` passes on the evidence machine or CI runner with production env/secrets, connected `adb devices` device-state proof, structured `checked.android.deviceMetadata` with device model, Android OS/API, build fingerprint or incremental build, and WebView package/version, `java`, `npx`, GitHub CLI, generated APK metadata tooling through `aapt`, `apkanalyzer`, or `bundletool`, exact downloaded APK and merged-manifest paths, durable JSON output, structured `checked.ios` proof from `IOS_VALIDATION_OWNER`, `IOS_VALIDATION_EXECUTOR_PROOF` or macOS/`xcrun`, `IOS_VALIDATION_DEVICE`, `IOS_VALIDATION_VERSION`, `IOS_WKWEBVIEW_VERSION`/`IOS_WEBKIT_VERSION`, `IOS_VALIDATION_ARTIFACT_URL`, `IOS_VALIDATION_ARTIFACT_SHA256`, and `IOS_VALIDATION_ARTIFACT_PATH`, named iOS validation owner, macOS/Xcode/`xcrun` or physical iOS-device proof, iOS simulator/device identity, iOS version, WKWebView/WebKit version, trusted iOS artifact URL under `opsiclear/diveo`, `OpsiClear-Web/diveo`, or `opsiclear/gsav-hosting` that points to a direct Actions artifact, release asset download, or `docs/qa-evidence` blob, declared and computed 64-hex iOS artifact SHA256 values, `artifactSha256Matches=true`, non-local HTTPS GSAV/catalog/Supabase/range/host-identity URLs, redacted Supabase anon key, explicit `GSAV_HOSTING_COMMIT`, no production QA flags, downloaded-root proof that `$DOWNLOADED_RELEASE_DIR/$VALIDATION_PREREQS_PATH` exists before attachment, `release-evidence:attach-validation-prereqs` output that includes the prerequisite JSON and materialized iOS artifact under `release-evidence/` in `dry-run-summary.json` and `evidence-checksums.txt`, strict `verify:release-evidence-bundle -- --require-validation-prereqs true` proof that recomputes the iOS artifact SHA256 from current bytes, `device-validation-evidence/device-validation-bundle-verifier.json`, attached `downloaded-release/release-evidence/**`, and uploaded artifact `diveo-device-validation-<date>-<run_id>` |
| Release APK artifact | `verify:release-artifact` or APK verifier output shows production GSAV web URL, GSAV catalog URL, Supabase URL, and Supabase anon key are present; IPv4/IPv6 local-private and legacy markers are absent; APK bundle path and merged manifest path were checked; cleartext is disabled; the merged manifest is not debuggable; explicit 64-hex `apkSha256` and explicit 64-hex `manifestSha256` are recorded |
| Release-installed APK smoke | The exact downloaded release APK is installed and launched; `npm run android:installed-smoke -- --apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH" --dry-run-summary-path "$DOWNLOADED_RELEASE_DIR/release-evidence/dry-run-summary.json" --production-host-url <https production GSAV host>` output or equivalent evidence records the package name, Android OS version, Android WebView version, explicit 64-hex `apkSha256`, `apkSha256MatchesDryRunSummary=true`, downloaded `release-evidence/dry-run-summary.json`, `releaseCandidateSha`, CI artifact URL, `productionHostReleaseReady=true`, `allowPartialRoutes=false`, `allowMissingLogMarkers=false`, `allowMissingDeviceMetadata=false`, `allowRehearsalHost=false`, `dumpsys package` installed `versionCode` equal to `app.json`, `installedVersionCodeMatchesDryRunSummary=true`, opens `gsav://explore`, `gsav://gsav-diagnostics`, and `gsav://watch/test`, records `observedSignalsOk=true`, records passing per-route `observedSignalChecks` for route-change plus bridge-ready/error/unsupported markers, captures filtered React Native/Chromium/WebView logs for each route, and proves `/explore`, `/gsav-diagnostics`, and `/watch/test` reach the production GSAV host, hide web chrome, emit bridge readiness or explicit unsupported/error state, and preserve retry/resume behavior |
| Generated versionCode metadata | Generated Gradle `versionCode`, `app.json` `versionCode`, and APK version metadata output match numerically; release CI runs `npm run android:version-metadata -- --expected-version-code <app.json versionCode>` and writes `release-evidence/apk-version-metadata.txt` after trying `aapt dump badging`, `apkanalyzer manifest print`, then `bundletool dump manifest`; if all are unavailable, include scoped exception fields and an accepted generated APK metadata source with `versionCode` |
| Production `.gsav` range probe | Production HTTPS `GSAV_RANGE_PROBE_URL` receives `Range: bytes=0-0`, records `rangeRequest=bytes=0-0`, and returns `206` plus exact `Content-Range: bytes 0-0/<decimal-size>`, `Access-Control-Allow-Origin=*` or the production GSAV origin, and concrete `Access-Control-Expose-Headers=Accept-Ranges, Content-Length, Content-Range, ETag` during release preflight; wildcard sizes, mismatched offsets, wrong-origin CORS, negated/ambiguous exposed-header prose, missing browser-readable range headers, and IPv4/IPv6 local-private `.gsav` URLs do not count |
| Release workflow dry run | GitHub Actions `workflow_dispatch` manual run uses `candidate_ref`, production secrets, and `publish_release=false`, captures release-candidate identity before production preflight/runtime smoke, verifies signoff diff is QA/audit/evidence-only, completes production preflight, production runtime smoke, Android build, APK verifier, release evidence bundle verifier, evidence upload, records run URL, release-candidate SHA, evidence signoff SHA, app/package version, Android `versionCode`, artifact name, upload status, `release-evidence/**` contents including `release-evidence/release-candidate.txt`, `release-evidence/signoff-diff-files.txt`, `release-evidence/no-publish-side-effect.txt`, `release-evidence/gsav-preflight.json`, `release-evidence/gsav-runtime-smoke.json`, `release-evidence/dry-run-summary.json`, and `release-evidence/evidence-checksums.txt`, confirms preflight covered `/explore?embed=native&dataSaver=1`, `/native-diagnostics?embed=native`, `/watch/test?embed=native`, `/watch/test?t=2.5&embed=native`, and `/watch/elly?embed=native`, confirms preflight/runtime `diveoCommit` matches `releaseCandidateSha`, confirms `GSAV_HOSTING_COMMIT=<actual build/commit>`, `GSAV_HOST_IDENTITY_URL=<https metadata URL>`, `hostIdentityVerified=true`, `hostIdentity.url=<same metadata URL>`, `hostIdentity.expectedIdentity=<actual GSAV_HOSTING_COMMIT value>`, and `hostIdentity.observedIdentity=<host-served build/commit>` matching `GSAV_HOSTING_COMMIT`, records 64-hex checksum-manifest SHA256, `publishArtifactIdentitySha256`, `gsavPackageProvenanceSha256=<64-hex sha>`, and `dry-run-summary.json` `gsavPackageProvenance` for `@opsiclear/gsav-bridge` plus `@opsiclear/gsav-client` with `specifier=file:vendor/...` and `tarballSha256=<64-hex sha>`, records artifact review signoff with reviewer, `artifactReviewArtifact=<artifact name or ID>` matching the row artifact name unless it is an artifact ID, reviewed timestamp, GitHub run conclusion, downloaded checksum-manifest SHA256, and `verify:release-evidence-bundle` rerun against the downloaded bundle, and confirms `no-publish-side-effect.txt` contains `githubReleaseLookup=not_found`, `githubReleasePresent=false`, git status limited to generated `release-evidence/**` outputs, `git rev-parse HEAD` and remote ref matching `workflowSha`, authenticated `gh release view v<version>` not-found proof, plus no GitHub release, commit, push, version bump, or publish side effect. Push runs are dry-run evidence only. The only publish path is manual `workflow_dispatch publish_release=true`, which must pass `expected_apk_sha256`, `expected_publish_identity_sha256`, `external_evidence_inventory_path`, and `device_evidence_packet_path` from the reviewed dry-run and evidence signoff; before upload/readiness/release, the workflow validates that the reviewed inventory path is `docs/qa-evidence/<date>/external-evidence-inventory.json`, the reviewed packet path is a JSON file in the same `docs/qa-evidence/<date>/` folder, and the packet filename does not contain `scaffold`, `candidate`, `pending`, or `example`; the workflow then recomputes `app-release.apk` and the merged manifest before comparing `release-evidence/dry-run-summary.json` `apkSha256` plus `publishArtifactIdentitySha256`, captures live `release-evidence/github-release-state-prepublish.json` and `release-evidence/publish-hash-variable-guard-prepublish.json`, uploads the verified evidence, and runs readiness with the reviewed inventory and reviewed packet paths before release creation |
| Branch protection | Branch-protection evidence for `master` is captured with `npm run release-evidence:branch-protection -- --repo OpsiClear-Web/diveo --branch master --output-path docs/qa-evidence/<date>/master-branch-protection.json --reviewer <reviewer>` or equivalent trusted GitHub evidence; the row names protected branch `master`, required status checks including `quality / quality`, reviewer, ISO `reviewedAt` timestamp, and the raw evidence path or trusted GitHub artifact URL. Local JSON evidence must report `ok=true`, `status=pass`, `branchQuery.output.protected=true`, `protectionQuery.exitCode=0`, `observedRequiredChecks` including `quality / quality`, and `releaseReadinessImpact.status=ready` |

## Evidence Row Templates

Use these result templates when replacing pending rows. Keep the raw output,
screenshot, recording, or log in the evidence path; the row text is the
machine-checkable summary.

Template owner placeholders such as `owner=<release owner>` are examples only.
Pending rows and audit blockers may use role labels, but any row changed to
`Passed:` or `Passed with scoped exception:` must name a person, team handle,
GitHub issue, or workflow run link.

Canonical identity prefix for every publish-counted row:

```text
owner=<release owner>; diveo commit: <sha>; releaseCandidateSha=<payload sha when device, negative, artifact, generated metadata, installed-smoke, validation-prereq, or dry-run evidence>; app version: <version>; package.json version: <version>; Android versionCode: <code when Android, Android/iOS, Android release, or dry-run evidence>; GSAV host identity: <commit/build when embedded or production host evidence>.
```

Device route row:

```text
Passed: owner=<release owner>; diveo commit: <sha>; releaseCandidateSha=<payload sha>; dry-run artifact=diveo-release-evidence-v<version>; dry-run run URL=<exact https://github.com/OpsiClear-Web/diveo/actions/runs/... or https://github.com/opsiclear/diveo/actions/runs/...>; app version: <version>; package.json version: <version>; Android versionCode: <code for Android rows>; concrete device=<device model/simulator>; GSAV web URL column uses a production HTTPS or release-equivalent staging host; build profile: release or production validation build; command: npx expo run:<platform>; manual action: <tap path>; OS version: <version>; WebView/WKWebView version: <version>; GSAV host identity: <commit/build>; ergonomic check: rotation, safe areas, hardware back/back gesture, no clipped text, no nested-touch ambiguity, and 44dp touch targets verified or scoped exception recorded; final embedded WebView URL: <url when embedded>; observed: <no web chrome|dataSaver=1|GSAV_ROUTE_CHANGE|resume near saved time|blocked navigation>.
```

Passed negative validation row:

```text
Passed: owner=<release owner>; diveo commit: <sha>; releaseCandidateSha=<payload sha>; dry-run artifact=diveo-release-evidence-v<version>; dry-run run URL=<exact https://github.com/OpsiClear-Web/diveo/actions/runs/... or https://github.com/opsiclear/diveo/actions/runs/...>; app version: <version>; package.json version: <version>; Android versionCode: <code>; concrete devices=<Android model> and <iOS model/simulator>; GSAV web URL column uses a production HTTPS or release-equivalent staging host; intended GSAV host for missing/offline cases=<https url>; build profile: release or production validation build; QA validation build parity=<dry-run artifact or production-config proof when QA flags are used>; QA flag used=<none|EXPO_PUBLIC_GSAV_QA_CONTROLS=1|EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000>; production prerequisite evidence no QA flags=true; Android OS version: <version>; Android WebView version: <version>; iOS OS version: <version>; iOS WKWebView version: <version>; GSAV host identity: <commit/build>; trigger: <missing config/offline/cross-origin/etc.>; action: <manual step or command>; observed: <not blank|recovered|blocked|unsupported|no clear-session|GSAV_ENDED cleared resume>.
```

Scoped exception row:

```text
Passed with scoped exception: owner=<release owner>; diveo commit: <sha>; app version: <version>; package.json version: <version>; Android versionCode: <code when required>; exception gate=<row route or evidence row>; reason=<exact blocker>; affected=<platform/artifact>; approver=<name or GitHub issue/run link>; revisit=<YYYY-MM-DD>.
```

Release validation prerequisites row:

```text
Passed: owner=<release owner>; diveo commit: <sha>; releaseCandidateSha=<payload sha>; evidenceSignoffSha=<sha>; app version: <version>; package.json version: <version>; Android versionCode: <code>; command: npm run verify:validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --ios-artifact-path "$IOS_VALIDATION_ARTIFACT_PATH" --output-path "$VALIDATION_PREREQS_PATH"; output path: $DOWNLOADED_RELEASE_DIR/$VALIDATION_PREREQS_PATH; production env/secrets configured; adb devices showed <device> in device state; validation-prereqs.json checked.android.deviceMetadata metadataOk=true; Android device model=<model>; Android OS version: <version> API <api>; Android build fingerprint=<fingerprint or incremental build>; Android WebView package=<package>; Android WebView version=<version>; java available; npx available; gh GitHub CLI available; generated APK metadata tool <aapt|apkanalyzer|bundletool> available; APK path: $DOWNLOADED_RELEASE_DIR/$APK_PATH; merged manifest path: $DOWNLOADED_RELEASE_DIR/$MANIFEST_PATH; validation-prereqs.json checked.ios fields captured from IOS_VALIDATION_OWNER, IOS_VALIDATION_EXECUTOR_PROOF or macOS/xcrun, IOS_VALIDATION_DEVICE, IOS_VALIDATION_VERSION, IOS_WKWEBVIEW_VERSION or IOS_WEBKIT_VERSION, IOS_VALIDATION_ARTIFACT_URL, IOS_VALIDATION_ARTIFACT_SHA256, and IOS_VALIDATION_ARTIFACT_PATH; iOS validation owner=<owner>; macOS/Xcode/xcrun or physical iOS device proof captured; iOS simulator/device=<device>; iOS version: <version>; iOS WKWebView version: <version>; iOS validation artifact URL: <trusted direct GitHub artifact/release/blob URL>; iOS validation artifact URL is not a bare Actions run; iOS validation artifact SHA256=<64-hex sha>; computed iOS validation artifact SHA256=<64-hex sha>; artifactSha256Matches=true; EXPO_PUBLIC_GSAV_WEB_URL=<https url>; EXPO_PUBLIC_GSAV_CATALOG_URL=<https url>; EXPO_PUBLIC_GSAV_SUPABASE_URL=<https url>; EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY present and redacted; GSAV_RANGE_PROBE_URL=<https .gsav url>; GSAV_HOST_IDENTITY_URL=<https metadata URL>; GSAV_HOSTING_COMMIT=<actual sha/build>; no production QA flags; downloaded-root proof verified $DOWNLOADED_RELEASE_DIR/$VALIDATION_PREREQS_PATH before attachment; release-evidence:attach-validation-prereqs updated release-evidence/validation-prereqs.json and added the release-evidence iOS artifact path to dry-run-summary.json plus evidence-checksums.txt; strict verify:release-evidence-bundle -- --require-validation-prereqs true passed after confirming the artifact path remained under release-evidence/ and recomputing the iOS artifact SHA256 from current bytes; device-validation-evidence/device-validation-bundle-verifier.json captured outside the attached bundle; downloaded-release/release-evidence/** uploaded; device validation artifact=diveo-device-validation-<date>-<run_id>.
```

Release APK artifact row:

```text
Passed: owner=<release owner>; diveo commit: <sha>; releaseCandidateSha=<payload sha>; evidenceSignoffSha=<sha>; app version: <version>; package.json version: <version>; Android versionCode: <code>; workflow run URL: <https://github.com/.../actions/runs/...>; artifact name: diveo-release-evidence-v<version>; checksum-manifest SHA256=<64-hex sha>; verify:release-artifact output checked production GSAV web URL, GSAV catalog URL, Supabase URL, and Supabase anon key; APK path: <path>; merged manifest path: <path>; cleartext disabled; non-debuggable manifest; local/private markers absent; legacy/Bilibili/proxy/DASH markers absent; apkSha256=<64-hex sha>; manifestSha256=<64-hex sha>.
```

Release-installed APK smoke row:

```text
Passed: owner=<release owner>; diveo commit: <sha>; releaseCandidateSha=<payload sha>; evidenceSignoffSha=<sha>; app version: <version>; package.json version: <version>; Android versionCode: <code>; installed exact downloaded release APK on <device>; Android OS version: <version>; Android WebView version: <version>; packageName=com.opsiclear.diveo; command: npm run android:installed-smoke -- --apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH" --output-path <evidence> --dry-run-summary-path "$DOWNLOADED_RELEASE_DIR/release-evidence/dry-run-summary.json" --production-host-url <https url> --ci-artifact-url <artifact URL>; apkSha256=<64-hex sha>; apkSha256MatchesDryRunSummary=true; dumpsys package captured installedVersionCode=<same code as app.json>; installedVersionCodeMatchesDryRunSummary=true; production host URL: <https url>; productionHostReleaseReady=true; allowPartialRoutes=false; allowMissingLogMarkers=false; allowMissingDeviceMetadata=false; allowRehearsalHost=false; opened deep links gsav://explore, gsav://gsav-diagnostics, and gsav://watch/test; observedSignalsOk=true; observedSignalChecks passed per route for route-change plus bridge-ready/error/unsupported markers; observed /explore, /gsav-diagnostics, and /watch/test with embed=native, hidden web chrome, bridge readiness or explicit unsupported/error state, retry UI, and resume behavior; filtered logcat captured ReactNativeJS, chromium, and WebView logs for each route.
```

Generated versionCode metadata row:

```text
Passed: owner=<release owner>; diveo commit: <sha>; releaseCandidateSha=<payload sha>; evidenceSignoffSha=<sha>; app version: <version>; package.json version: <version>; Android versionCode: <code>; workflow run URL: <https://github.com/.../actions/runs/...>; artifact name: diveo-release-evidence-v<version>; checksum-manifest SHA256=<64-hex sha>; command: npm run android:version-metadata -- --apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH" --expected-version-code <code> --output-path release-evidence/apk-version-metadata.txt; Gradle versionCode: <code>; app.json versionCode: <code>; apk-version-metadata source=<aapt|apkanalyzer|bundletool|apk-version-metadata> versionCode: <code>; release-evidence/apk-version-metadata.txt captured and matches app.json.
```

Dry-run row:

```text
Passed: owner=<release owner>; diveo commit: <payload sha>; releaseCandidateSha=<payload sha>; evidenceSignoffSha=<sha>; app version: <version>; package.json version: <version>; Android versionCode: <code>; workflow_dispatch manual run URL: <https://github.com/.../actions/runs/...>; candidate_ref=<payload sha>; publish_release=false; production secrets configured; signoff diff checked as QA/audit/evidence-only; GSAV_HOSTING_COMMIT=<actual sha/build>; GSAV_HOST_IDENTITY_URL=<https metadata URL>; hostIdentityVerified=true; hostIdentity.url=<same https metadata URL>; hostIdentity.expectedIdentity=<same actual sha/build as GSAV_HOSTING_COMMIT>; hostIdentity.observedIdentity=<host-served sha/build>; production preflight and runtime smoke ran after release-candidate identity capture; production preflight wrote release-evidence/gsav-preflight.json with GSAV_RANGE_PROBE_URL=<https .gsav>; dry-run-summary.runUrl parsed as a trusted Diveo GitHub Actions run URL and matched the workflow_dispatch manual run URL; dry-run-summary.publishRelease=false; dry-run-summary.rangeProbeUrl matched gsav-preflight.json rangeAsset.url; dry-run-summary.rangeRequest matched rangeAsset.requestRange; production preflight checked /explore?embed=native&dataSaver=1, /native-diagnostics?embed=native, /watch/test?embed=native, /watch/test?t=2.5&embed=native, and /watch/elly?embed=native; rangeRequest=bytes=0-0; Range: bytes=0-0 returned 206 with Content-Range=bytes 0-0/<decimal-size>; Access-Control-Allow-Origin=<* or production GSAV origin>; Access-Control-Expose-Headers=Accept-Ranges, Content-Length, Content-Range, ETag; gsav-preflight.json diveoCommit matched releaseCandidateSha and recorded GSAV_HOSTING_COMMIT=<actual sha/build>; production runtime smoke: npm run gsav:runtime-smoke wrote release-evidence/gsav-runtime-smoke.json; gsav-runtime-smoke.json diveoCommit matched releaseCandidateSha and recorded gsavHostingCommit=<actual sha/build> plus `GSAV_BRIDGE_READY` version/minVersion; Android build: assembleRelease passed; APK verifier: verify:release-artifact passed; bundle verifier: npm run verify:release-evidence-bundle passed; evidence upload: uploaded release-evidence/** including release-evidence/release-candidate.txt, release-evidence/signoff-diff-files.txt, release-evidence/no-publish-side-effect.txt, release-evidence/gsav-preflight.json, release-evidence/gsav-runtime-smoke.json, release-evidence/dry-run-summary.json, and release-evidence/evidence-checksums.txt; artifact name: diveo-release-evidence-v<version>; checksum-manifest SHA256=<64-hex sha>; publishArtifactIdentitySha256=<64-hex sha>; gsavPackageProvenanceSha256=<64-hex sha>; gsavPackageProvenance @opsiclear/gsav-bridge specifier=file:vendor/opsiclear-gsav-bridge-<version>.tgz tarballSha256=<64-hex sha>; gsavPackageProvenance @opsiclear/gsav-client specifier=file:vendor/opsiclear-gsav-client-<version>.tgz tarballSha256=<64-hex sha>; manual publish hash inputs expected_apk_sha256=<64-hex sha> and expected_publish_identity_sha256=<64-hex sha> are pinned to this reviewed dry-run artifact; artifact review signoff reviewer=<reviewer>; artifactReviewArtifact=<same artifact name or artifact ID>; reviewedAt=<ISO timestamp>; GitHub run conclusion=success; downloaded checksum-manifest SHA256=<64-hex sha>; verify:release-evidence-bundle rerun against downloaded bundle passed; no-publish proof recorded githubReleaseLookup=not_found and githubReleasePresent=false; git status only showed generated release-evidence outputs; git rev-parse HEAD and remote ref matched workflowSha; gh release view v<version> returned authenticated not found; no GitHub release created; no commit, push, version bump, or publish side effect.
```

Branch-protection row:

```text
Passed: owner=<release owner>; diveo commit: <sha>; app version: <version>; package.json version: <version>; command: npm run release-evidence:branch-protection -- --repo OpsiClear-Web/diveo --branch master --output-path docs/qa-evidence/<date>/master-branch-protection.json --reviewer <reviewer>; branch protection query: gh api repos/OpsiClear-Web/diveo/branches/master/protection; raw evidence path: docs/qa-evidence/<date>/master-branch-protection.json; local JSON reports ok=true, status=pass, branchQuery.output.protected=true, protectionQuery.exitCode=0, observedRequiredChecks includes quality / quality, releaseReadinessImpact.status=ready; protected branch=master; required status checks include quality / quality; reviewer=<reviewer>; reviewedAt=<ISO timestamp>; trusted GitHub evidence URL=<https://github.com/OpsiClear-Web/diveo/...>.
```

## Evidence Log

Use the fixed row set below for publish readiness. Add supporting evidence per
tested route/device, but do not add ad hoc publish rows unless
`scripts/verify-release-readiness.js`, this table, and the plan are updated in
the same change.
The readiness verifier rejects Evidence Log rows outside the 30
publish-readiness platform/route pairs and the documented context-only
`Host preflight` / `GSAV target routes` rows.
The 30 publish-readiness rows exclude local or historical rehearsal rows; those
rows are retained as context only.
Duplicate rows for a publish-readiness pair are allowed only when every
non-latest row is explicitly marked as context, rehearsal, historical,
superseded, or not publish evidence in Result, Evidence path, or Notes. The
latest row remains the readiness candidate. Context-only host-preflight rows
must all be labeled context-only or not publish evidence.
`npm run verify:release-readiness` requires this exact header shape; keep owner
details in the Result or Notes cell. Use `owner=<release owner>` only in
pending templates; completed rows must name the actual person, team handle,
GitHub issue, or workflow run link.

Rows that use local emulator or simulator URLs such as `http://10.0.2.2:5191`
or `http://127.0.0.1:5191` are rehearsal evidence only. Publish-counted Android
and iOS rows must either rerun against a production HTTPS GSAV host, or staging
host with release-equivalent G3 candidate identity/config and concrete
host/build identity, or keep `_pending_` with a scoped no-publish blocker in the
audit.

| Date | Platform | Device/Emulator | GSAV web URL | diveo route | Result | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-06-30 | JS runtime smoke | Windows host / Playwright Chromium | `http://127.0.0.1:5191` | JS runtime smoke | Passed: `npm run gsav:runtime-smoke` checked `/explore?embed=native&dataSaver=1`, `/native-diagnostics?embed=native`, and `/watch/test?embed=native`; native embed markers were `true`; public `topNav` and `miniPlayer` were absent; Explore rendered 3 poster previews, 0 animated posters, and 0 live viewer hosts; diagnostics rendered capability status and route-change payload `{ path: "/native-diagnostics", embed: true }`; watch rendered native watch shell with no web back link or related rail, emitted route-change `{ path: "/watch/test", embed: true }`, accepted a native `play` command, and observed playback/error bridge events; captured `GSAV_AUTH_READY`, compatible `GSAV_BRIDGE_READY` bridge v1/minVersion v1 on Explore, diagnostics, and watch, `GSAV_CAPABILITIES`, `GSAV_ROUTE_CHANGE`, `GSAV_PROGRESS`, and `GSAV_ERROR`; latest run did not emit `GSAV_FIRST_FRAME` | `docs/qa-evidence/2026-06-30/diveo-gsav-runtime-smoke-refresh-2026-06-30.txt` | diveo commit: 3d243f5; app version: 1.0.19; package.json version: 1.0.19; Node: v24.14.0; npm: 11.9.0; gsav host identity: local-gsav-hosting-workspace-2026-06-30; `../gsav-hosting` is not a git repo in this workspace, so this is local pre-release evidence only; direct Vite preview was started from `../gsav-hosting/apps/web` and stopped after validation; preview log: `docs/qa-evidence/2026-06-30/gsav-preview-direct-2026-06-30.out.log` |
| _pending_ | JS runtime smoke | GitHub Actions / production Chromium | production GSAV URL | JS runtime smoke | _pending_ | _pending_ | Requires `npm run gsav:runtime-smoke` against a non-local HTTPS production GSAV URL, explicit `gsavHostingCommit=<sha/build>` or equivalent deployed GSAV host/build identity, Node/npm metadata, compatible `GSAV_BRIDGE_READY` version/minVersion, `/explore?embed=native&dataSaver=1` exact query proof, one `.shortsFeed`, multiple `.shortsItem` scenes, vertical scroll snap, visible scene change after scroll, and durable CI/artifact evidence |
| 2026-06-30 | Host preflight | Windows host | `http://127.0.0.1:5191` | GSAV target routes | Passed: app shell returned `200` for `/`, `/explore?embed=native&dataSaver=1`, `/native-diagnostics?embed=native`, `/watch/test?embed=native`, `/watch/test?t=2.5&embed=native`, `/watch/elly?embed=native`; `/test.gsav` accepted `Range: bytes=0-0` and returned `206` with `contentRangeExact=false` (`Content-Range: bytes 0-21368764/21368765`) | `docs/qa-evidence/2026-06-30/diveo-gsav-preflight-refresh-2026-06-30.txt` | The hosted `/` check is host-root reachability only; it is not an embedded browse row or a second hosted browse exception. Local Vite range behavior is not publish evidence; production range rows still require `GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE=1`, `GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS=1`, non-local HTTPS `.gsav`, exact `Content-Range: bytes 0-0/<decimal-size>`, `Access-Control-Allow-Origin=*` or the production GSAV origin, and concrete `Access-Control-Expose-Headers=Accept-Ranges, Content-Length, Content-Range, ETag`. Direct Vite preview was started from `../gsav-hosting/apps/web` and stopped after validation; preview log: `docs/qa-evidence/2026-06-30/gsav-preview-direct-2026-06-30.out.log` |
| 2026-06-18 | Host preflight | Windows host | `http://127.0.0.1:5191` | GSAV target routes | Passed: app shell returned `200`; `/test.gsav` range returned `206` | `docs/qa-evidence/2026-06-30/diveo-gsav-preflight-2026-06-30.txt` | Historical pre-device gate only; not publish evidence |
| _pending_ | Android | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/` | _pending_ | _pending_ | Native home/feed, no web chrome |
| _pending_ | Android | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/search` | _pending_ | _pending_ | Native search opens watch route |
| _pending_ | Android | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/library` | _pending_ | _pending_ | Signed-in saved-scenes flow with seeded follow-state visibility |
| _pending_ | Android | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/creator/:handle` | _pending_ | _pending_ | Creator profile and scene navigation |
| _pending_ | Android | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/explore` | _pending_ | _pending_ | WebView URL includes `embed=native`, plus `dataSaver=1` when enabled |
| _pending_ | Android | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/gsav-diagnostics` | _pending_ | _pending_ | Bridge capabilities and diagnostics render |
| _pending_ | Android | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/watch/test` | _pending_ | _pending_ | Playback/unsupported state, resume, hardware back |
| _pending_ | Android | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/gsav/test?t=2.5` | _pending_ | _pending_ | Alias preserves id/start time and appends `embed=native` |
| _pending_ | iOS | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/` | _pending_ | _pending_ | Native home/feed, no web chrome |
| _pending_ | iOS | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/search` | _pending_ | _pending_ | Native search opens watch route |
| _pending_ | iOS | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/library` | _pending_ | _pending_ | Signed-in saved-scenes flow with seeded follow-state visibility |
| _pending_ | iOS | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/creator/:handle` | _pending_ | _pending_ | Creator profile and scene navigation |
| _pending_ | iOS | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/explore` | _pending_ | _pending_ | WKWebView URL includes `embed=native`, plus `dataSaver=1` when enabled |
| _pending_ | iOS | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/gsav-diagnostics` | _pending_ | _pending_ | Bridge capabilities and diagnostics render |
| _pending_ | iOS | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/watch/test` | _pending_ | _pending_ | Playback/unsupported state, resume, gestures |
| _pending_ | iOS | _pending_ | production HTTPS or release-equivalent staging GSAV URL | `/gsav/test?t=2.5` | _pending_ | _pending_ | Alias preserves id/start time and appends `embed=native` |
| _pending_ | Android/iOS | _pending_ | _missing_ | Missing host config | _pending_ | _pending_ | Native config/error UI, not blank WebView; completed row must also name the intended production HTTPS or release-equivalent staging GSAV host/build identity that is intentionally unset for this trigger |
| _pending_ | Android/iOS | _pending_ | offline host | Host offline/retry | _pending_ | _pending_ | Retry UI appears and recovers after host returns; completed row must name the production HTTPS or release-equivalent staging GSAV host/build identity before it is blocked and after it recovers |
| _pending_ | Android/iOS | _pending_ | `/gsav-diagnostics` with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1` | Cross-origin navigation | _pending_ | _pending_ | Tap `Cross-origin`; untrusted navigation is blocked; completed row must name release-equivalent validation build parity and production prerequisite proof with QA flags disabled |
| _pending_ | Android/iOS | _pending_ | `/gsav-diagnostics` with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1` | Unsupported renderer | _pending_ | _pending_ | Tap `Unsupported`; native overlay reports QA unsupported state; completed row must name release-equivalent validation build parity and production prerequisite proof with QA flags disabled |
| _pending_ | Android/iOS | _pending_ | `EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000` | Auth initialization gate | _pending_ | _pending_ | No clear-session bridge message before auth init completes; completed row must name release-equivalent validation build parity and production prerequisite proof with QA flags disabled |
| _pending_ | Android/iOS | _pending_ | `/gsav-diagnostics` with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1` | Ended playback | _pending_ | _pending_ | Tap `Ended`; `GSAV_ENDED` clears saved progress; completed row must name release-equivalent validation build parity and production prerequisite proof with QA flags disabled |
| _pending_ | Release validation prerequisites | CI/evidence machine | production GSAV URL | Validation prerequisites | _pending_ | _pending_ | Requires `npm run verify:validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --ios-artifact-path "$IOS_VALIDATION_ARTIFACT_PATH" --output-path "$VALIDATION_PREREQS_PATH"` to pass with production env/secrets, connected `adb devices` proof, structured Android device metadata with model, OS/API, build fingerprint or incremental build, and WebView package/version, `java`, `npx`, `gh`, `aapt`/`apkanalyzer`/`bundletool`, exact downloaded APK and manifest paths, durable JSON output under the downloaded root, named iOS validation owner, macOS/Xcode/`xcrun` or physical iOS-device proof, iOS simulator/device identity, iOS version, WKWebView/WebKit version, trusted iOS artifact URL that points to a direct Actions artifact, release asset download, or `docs/qa-evidence` blob, declared and computed 64-hex iOS artifact SHA256 values, `artifactSha256Matches=true`, non-local HTTPS production URLs, `GSAV_HOSTING_COMMIT`, redacted Supabase anon key, no production QA flags, downloaded-root proof that `$DOWNLOADED_RELEASE_DIR/$VALIDATION_PREREQS_PATH` exists, `release-evidence:attach-validation-prereqs` adding the prerequisite JSON and release-evidence iOS artifact path to `dry-run-summary.json` plus `evidence-checksums.txt`, strict `verify:release-evidence-bundle -- --require-validation-prereqs true` confirming the artifact path remains under `release-evidence/` and recomputing the iOS artifact SHA256 from current bytes, `device-validation-evidence/device-validation-bundle-verifier.json`, attached `downloaded-release/release-evidence/**`, and `diveo-device-validation-<date>-<run_id>` upload proof |
| _pending_ | Android release | _pending_ | production GSAV URL | Release APK artifact | _pending_ | _pending_ | Requires Gradle build, merged manifest, generated Gradle/APK versionCode evidence, cleartext disabled, non-debuggable manifest, explicit 64-hex `apkSha256`, explicit 64-hex `manifestSha256`, and `npm run verify:release-artifact` |
| _pending_ | Android release | _pending_ | production GSAV URL | Release-installed APK smoke | _pending_ | _pending_ | Requires installing the exact downloaded release APK with `npm run android:installed-smoke -- --apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH" --output-path docs/qa-evidence/<date>/android-installed-release-smoke.txt --dry-run-summary-path "$DOWNLOADED_RELEASE_DIR/release-evidence/dry-run-summary.json" --production-host-url <https production GSAV host> --ci-artifact-url <artifact URL>`, matching explicit 64-hex `apkSha256` and installed `versionCode` to the downloaded dry-run summary, launching it, recording Android OS/WebView versions, proving `productionHostReleaseReady=true`, `allowPartialRoutes=false`, `allowMissingLogMarkers=false`, `allowMissingDeviceMetadata=false`, and `allowRehearsalHost=false`, and validating `/explore`, `/gsav-diagnostics`, `/watch/test`, production host URL, per-route `observedSignalsOk=true` marker checks, bridge readiness or explicit unsupported/error state, retry UI, and resume behavior |
| _pending_ | Android release | _pending_ | production GSAV URL | Generated versionCode metadata | _pending_ | _pending_ | Requires generated Gradle `versionCode` and `npm run android:version-metadata -- --expected-version-code <app.json versionCode>` output to match `app.json`; release CI writes `release-evidence/apk-version-metadata.txt`; if every generated APK metadata command is unavailable, include scoped exception fields plus `aapt dump badging`, `apkanalyzer manifest print`, or `bundletool dump manifest` output with `versionCode` |
| _pending_ | Production host | _pending_ | production GSAV URL | Production .gsav range probe | _pending_ | _pending_ | Requires live `GSAV_RANGE_PROBE_URL` returning `206`, exact `Content-Range: bytes 0-0/<decimal-size>`, `Access-Control-Allow-Origin=*` or the production GSAV origin, and concrete `Access-Control-Expose-Headers=Accept-Ranges, Content-Length, Content-Range, ETag` in release preflight |
| _pending_ | GitHub Actions release dry run | GitHub Actions | production GSAV URL | Release workflow dry run | _pending_ | _pending_ | Manual run with real secrets, `GSAV_HOST_IDENTITY_URL`, and `publish_release=false`; skipped runs and push dry-run uploads do not count for this row; production preflight/runtime smoke must run after release-candidate identity capture, report `diveoCommit` matching `releaseCandidateSha`, prove `hostIdentityVerified=true` with observed identity matching `GSAV_HOSTING_COMMIT`, and record artifact review signoff with reviewer, `artifactReviewArtifact=<artifact name or ID>` matching the row artifact name unless it is an artifact ID, reviewed timestamp, GitHub run conclusion, downloaded checksum-manifest SHA256, `publishArtifactIdentitySha256`, `gsavPackageProvenanceSha256=<64-hex sha>`, `gsavPackageProvenance` for `@opsiclear/gsav-bridge` and `@opsiclear/gsav-client` with `specifier=file:vendor/...` plus `tarballSha256=<64-hex sha>`, and `verify:release-evidence-bundle` rerun against the downloaded bundle. Manual publish evidence must reuse the reviewed dry-run hashes through `expected_apk_sha256` and `expected_publish_identity_sha256`; actual `app-release.apk`, merged manifest, `release-evidence/dry-run-summary.json` `apkSha256`, and `publishArtifactIdentitySha256` must match before upload/readiness/release |
| 2026-07-01 | Branch protection | GitHub | `https://github.com/OpsiClear-Web/diveo` | Master branch protection | Passed: command: `npm run release-evidence:branch-protection -- --repo OpsiClear-Web/diveo --branch master --output-path docs/qa-evidence/2026-07-01/master-branch-protection.json --reviewer codex-local-verifier --reviewed-at 2026-07-01T20:34:20Z`; branch protection query: `gh api repos/OpsiClear-Web/diveo/branches/master/protection`; raw evidence path: `docs/qa-evidence/2026-07-01/master-branch-protection.json`; local JSON reports ok=true, status=pass, branchQuery.output.protected=true, protectionQuery.exitCode=0, observedRequiredChecks includes quality / quality, releaseReadinessImpact.status=ready; protected branch=master; required status checks include quality / quality; reviewer=codex-local-verifier; reviewedAt=2026-07-01T20:34:20Z; enforceAdmins=true | `docs/qa-evidence/2026-07-01/master-branch-protection.json` | owner=codex-local-verifier; diveo commit: 3d243f51497982d1c741e28d7f6ed2e90c99ba50; app version: 1.0.19; package.json version: 1.0.19; branch commitSha=fdc88ec053ecd4bb2a0a7f489a927eaa02146017; checkedAt=2026-07-01T20:34:20.999Z; trusted GitHub repository=https://github.com/OpsiClear-Web/diveo |

## Environment Gaps

| Date | Platform | Gap | Impact | Next action |
| --- | --- | --- | --- | --- |
| 2026-06-30 | Android/release build | `adb`, `emulator`, and `java` commands unavailable; no generated `android/` directory present in this workspace | Cannot complete Android emulator WebView QA, release-profile Android install smoke, Gradle release build, or APK artifact scan here | Run Android QA/build on a machine with Android SDK/platform-tools and JDK, then fill route and artifact evidence rows |
| 2026-06-30 | Release artifact | No real release APK or Gradle merged manifest exists in this workspace | `npm run verify:release-artifact` is unit-tested but not validated against an actual artifact here | Run `npx expo prebuild --platform android --no-install`, `android/gradlew assembleRelease`, then `npm run verify:release-artifact -- android/app/build/outputs/apk/release/app-release.apk` with `ANDROID_MANIFEST_PATH` pointing at the merged manifest |
| 2026-06-30 | GSAV host local smoke | Direct Diveo preflight/runtime smoke passed against local Vite preview started with `cd ../gsav-hosting; npm run deploy:web:local`, but `../gsav-hosting` default `smoke-local-deploy.mjs` failed because the remote `elly` asset did not expose browser-readable CORS headers for `Accept-Ranges`, `Content-Length`, `Content-Range`, and `ETag` | Local Diveo embed validation can proceed with the `test` fixture, but production-host release validation must prove the selected `.gsav` range probe and live assets expose the required headers | GSAV host owner should fix/verify remote asset CORS before the production dry run; keep `docs/qa-evidence/2026-06-30/gsav-preview-refresh-2026-06-30.out.log` as supporting evidence |
| 2026-06-30 | Production host | Release CI now requires `GSAV_RANGE_PROBE_URL`, and `workflow_dispatch` can run a non-publishing release dry run, but no real production-secret workflow run has completed here | Production `.gsav` byte-range behavior is wired as a gate but not yet validated against the live host | Add the secret, run the release workflow manually with `publish_release=false`, and record the `npm run gsav:preflight`, APK verifier, manifest scan, and uploaded evidence artifact output |
| 2026-06-18 | Android | `adb` and `emulator` commands unavailable in the Windows environment used for that review | Cannot complete device WebView QA there | Run Android QA on a machine with SDK/platform-tools |
| 2026-06-18 | iOS | macOS/Xcode unavailable | Cannot complete WKWebView QA there | Run on macOS simulator or physical iOS device |

## Manual Issue Log

| Date | Route | Platform | Expected | Actual | Logs/evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
