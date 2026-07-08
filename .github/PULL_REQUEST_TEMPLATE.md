## Summary

Describe the change and the user-visible behavior it affects.

## Change Type

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor
- [ ] Documentation
- [ ] Release/build
- [ ] Other:

## Verification

Run the applicable gates and mark completed items.

- [ ] `npm ci`
- [ ] `npm run verify:local`
- [ ] `npm run verify:docs-drift` for docs-only changes
- [ ] `npm test -- scripts/verify-doc-drift.test.mjs` and `npm run verify:whitespace` for docs-only changes
- [ ] `npm test -- scripts/verify-release-readiness.test.mjs`, expected-fail `RELEASE_CANDIDATE_SHA=<payload-sha> npm run verify:release-readiness`, and `npm run verify:no-publish-baseline -- --date <YYYY-MM-DD> --candidate-sha <payload-sha>` for release-rule, evidence-schema, QA row-count/status, packet, or no-publish-control docs changes while still pre-G3; after G3, use candidate-pinned readiness plus the affected G3-G7 verifier instead
- [ ] `npm run verify:native-production-config` fails as expected without production env
- [ ] `npm run verify:native-production-config` passes with HTTPS production env placeholders or real secrets
- [ ] N/A with reason:

## Architecture Boundaries

- [ ] Expo route files stay as thin stubs; business logic lives under `features/`
- [ ] No feature screen or layout imports service clients directly
- [ ] Any new sibling-feature or `@opsiclear/gsav-*` allowlist entry includes owner, reason, exit criteria, focused tests, and docs updates
- [ ] N/A with reason:

## GSAV Native/Web Validation

Required when a change touches `app/`, `features/`, `services/`, GSAV config,
release workflows, WebView behavior, or the native/web bridge.

- [ ] `npm run gsav:preflight`
- [ ] `npm run gsav:runtime-smoke`
- [ ] Android QA rows updated in `docs/GSAV_NATIVE_QA.md`, or the exact environment gap is documented
- [ ] iOS QA rows updated in `docs/GSAV_NATIVE_QA.md`; route/negative iOS evidence may be committed `docs/qa-evidence` files, trusted `docs/qa-evidence` blobs, or direct artifact/download URLs with manifest and checksum proof, while validation-prerequisite byte proof uses `IOS_VALIDATION_ARTIFACT_URL` plus `IOS_VALIDATION_ARTIFACT_SHA256`
- [ ] Screenshots, videos, logs, or release artifacts are saved under `docs/qa-evidence/<date>/` when needed

## Release Checklist

Required for release or production-config changes.

- [ ] `npm run verify:release-candidate` before payload freeze, or `npm run verify:release-candidate -- --candidate-sha <payload-sha>` after payload freeze
- [ ] `npm run verify:validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --ios-artifact-path "$IOS_VALIDATION_ARTIFACT_PATH" --output-path "$VALIDATION_PREREQS_PATH"` run before external evidence signoff; blockers recorded, or passed with exact downloaded APK/manifest paths plus `IOS_VALIDATION_ARTIFACT_URL`, `IOS_VALIDATION_ARTIFACT_SHA256`, and byte-verified `IOS_VALIDATION_ARTIFACT_PATH` on the evidence machine
- [ ] Production `.gsav` range probe validated with `GSAV_RANGE_PROBE_URL`
- [ ] Real APK built and scanned with `$env:ANDROID_MANIFEST_PATH="$DOWNLOADED_RELEASE_DIR/$MANIFEST_PATH"; npm run verify:release-artifact -- "$DOWNLOADED_RELEASE_DIR/$APK_PATH"`
- [ ] Exact release APK installed and launched with `npm run android:installed-smoke -- --apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH" --output-path docs/qa-evidence/<date>/android-installed-release-smoke.txt --dry-run-summary-path "$DOWNLOADED_RELEASE_DIR/release-evidence/dry-run-summary.json" --production-host-url <https production GSAV host> --ci-artifact-url <artifact URL>` and evidence records `productionHostReleaseReady=true`
- [ ] Merged Android manifest evidence confirms cleartext traffic is disabled
- [ ] Generated Gradle/APK versionCode captured with `npm run android:version-metadata -- --apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH" --expected-version-code <app.json versionCode> --output-path <evidence>` and matches `app.json`
- [ ] Generated release evidence bundle passes `npm run verify:release-evidence-bundle -- --root "$DOWNLOADED_RELEASE_DIR" --evidence-dir release-evidence --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --mode dry-run` while `decision=no-publish`; publish mode is only for a later `decision=publish` path after WP-8 passes
- [ ] Device validation workflow or self-hosted runner passes `ios_validation_artifact_url` as a direct artifact/download/blob URL plus `ios_validation_artifact_sha256`, runs `npm run release-evidence:attach-validation-prereqs`, and re-verifies the downloaded bundle with `--require-validation-prereqs true` after writing `release-evidence/validation-prereqs.json`
- [ ] GitHub Actions release dry run completed with `publish_release=false`
- [ ] `docs/IMPLEMENTATION_VALIDATION_AUDIT.md` updated with current blockers, command results, and evidence artifact review signoff
- [ ] Completed evidence rows replace owner placeholders with a person, team handle, GitHub issue, or workflow run link
- [ ] Dry-run artifact review records reviewer, reviewed timestamp, GitHub run conclusion, downloaded checksum-manifest SHA256, and a `verify:release-evidence-bundle` rerun against the downloaded bundle
- [ ] Reviewed external evidence inventory is committed at `docs/qa-evidence/<date>/external-evidence-inventory.json`
- [ ] `npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json> --require-git-integrity` passes after artifact review
- [ ] `npm run verify:final-readiness-receipts -- --candidate-sha <payload-sha> --date <YYYY-MM-DD> --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --packet-path <reviewed-packet.json> --stack-receipt-path docs/qa-evidence/<date>/stack-architecture-receipt.json` passes before final readiness
- [ ] Final audit signoff records `externalEvidenceInventoryPath=docs/qa-evidence/<date>/external-evidence-inventory.json`, `deviceEvidencePacketPath=<reviewed-packet.json>`, and `stackReceiptPath=docs/qa-evidence/<date>/stack-architecture-receipt.json`
- [ ] publish/no-publish decision recorded before any publish path
- [ ] Raw packet/inventory-aware `verify:release-readiness` output, if collected, is attached only as a diagnostic supplement; final publish readiness is the `verify:final-readiness-receipts` wrapper above

## Linked Issues

Closes #

## Notes

Call out migrations, follow-up work, accepted risks, or skipped checks with
reasons.
