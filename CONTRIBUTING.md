# Contributing Guide

## Development Setup

Install the locked dependencies with a project-compatible Node runtime:

```powershell
npm ci
```

The latest local verification evidence used Node `v24.14.0` and npm `11.9.0`.
Node 20 LTS is acceptable when `npm ci` and `npm run verify:local` pass; record
the Node/npm versions in QA evidence for release-signoff commands.

For GSAV playback work, start the sibling web app first:

```powershell
cd ..\gsav-hosting
npm run smoke:web:local
```

If that smoke command is blocked by GSAV host asset CORS, run
`npm run deploy:web:local` from `..\gsav-hosting` as a local preview fallback
and record the environment gap. The fallback is not publish evidence.

Then launch diveo against that origin:

```powershell
cd ..\diveo
$env:EXPO_PUBLIC_GSAV_WEB_URL='http://127.0.0.1:5191'
npm start
```

Use `http://10.0.2.2:5191` for Android emulator runs.

## Active Contribution Area

Active work should target the GSAV-native product: native browse/social/settings
screens plus embedded GSAV web player routes. The Bilibili client surface is
frozen legacy code. Do not add Bilibili features or new proxy behavior.

## Quality Gates

Use the table below as a quick gate router for each change type; the active
implementation plan wins if there is any conflict. Run the full local bundle as
the baseline for app, feature, service, script, or dependency changes:

```bash
npm ci
npm run verify:workflows
npm run verify:local
```

For docs-only changes, run `npm run verify:docs-drift`,
`npm test -- scripts/verify-doc-drift.test.mjs`, and
`npm run verify:whitespace`. If docs change release rules, evidence schemas,
QA row counts, pending/pass state, device packet requirements, or no-publish
controls, also run `npm test -- scripts/verify-release-readiness.test.mjs` and
`npm run verify:no-publish-baseline -- --date <YYYY-MM-DD> --candidate-sha <payload-sha>` only while the
release is still in the G0/pre-G3 no-publish baseline state. After the first
fixed-candidate `Release APK` `workflow_dispatch` dry run, use candidate-pinned
`npm run verify:release-readiness` plus the affected G3-G7 evidence verifier
instead of regenerating the aggregate baseline. A current baseline JSON must
report `scope=pre-g3-no-publish-baseline` and
`invalidAfter=first Release APK workflow_dispatch fixed-candidate dry run`;
its source evidence must match the evidence date, target `OpsiClear-Web/diveo`
where applicable, include concrete reviewer/query provenance, and use a packet
scaffold whose `target.evidenceDate` and `generatedAt` are same-day. The
baseline summary must also expose the GitHub-derived reviewers and
`reviewedAt` timestamps. While external rows are still incomplete, also record
the expected failure of `RELEASE_CANDIDATE_SHA=<payload-sha> npm run
verify:release-readiness`; it should fail only on the known pending evidence
rows. In the PR
template, mark non-applicable checks as N/A with a reason instead of
leaving them ambiguous. If a change affects WebView behavior, GSAV routes, runtime
URLs, or the native/web bridge, also run `npm run gsav:preflight`,
`npm run gsav:runtime-smoke`, and the manual checklist in
[`docs/GSAV_NATIVE_QA.md`](docs/GSAV_NATIVE_QA.md). If a change affects release
configuration or native/web boundaries, run
`npm run verify:native-production-config` both without production env
(expected failure) and with safe HTTPS placeholders or real release secrets
(expected pass). For release-safety edits, run `npm run verify:release-candidate`
before payload freeze or `npm run verify:release-candidate -- --candidate-sha
<payload-sha>` after freeze; the bundle runs `verify:local`, both
production-config verifier directions, and the focused release verifier tests.
Before collecting publish-counted external release evidence, run
`npm run verify:validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --ios-artifact-path "$IOS_VALIDATION_ARTIFACT_PATH" --output-path "$VALIDATION_PREREQS_PATH"`
against the downloaded dry-run artifact root to inventory missing SDK tools,
production env/secrets, QA-flag drift, artifact paths, durable evidence path,
named iOS owner, executor proof, device/version,
WKWebView/WebKit version, trusted iOS artifact URL that points to a direct
Actions artifact, release asset download, or `docs/qa-evidence` blob, and
64-hex iOS artifact SHA256; it must pass on the evidence machine before
artifact rows are marked complete. Before final publish readiness, replay the
reviewed inventory with
`npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json> --require-git-integrity`.
Final publish evidence must be replayed through
`npm run verify:final-readiness-receipts -- --candidate-sha <payload-sha> --date <YYYY-MM-DD> --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --packet-path <reviewed-packet.json> --stack-receipt-path docs/qa-evidence/<date>/stack-architecture-receipt.json`
from the frozen payload or evidence-signoff context. Raw packet/inventory-aware
`verify:release-readiness` is the underlying diagnostic only outside that
wrapper.
The final audit signoff must also record
`externalEvidenceInventoryPath=docs/qa-evidence/<date>/external-evidence-inventory.json`,
`deviceEvidencePacketPath=<reviewed-packet.json>`, and
`stackReceiptPath=docs/qa-evidence/<date>/stack-architecture-receipt.json` so
readiness can compare the audit to the reviewed command inputs.

### Which Gates Apply?

| Change path | Required plan section | PR evidence |
| --- | --- | --- |
| Docs-only | `docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md` WP-3 | `npm run verify:docs-drift`, `npm test -- scripts/verify-doc-drift.test.mjs`, `npm run verify:whitespace`, plus release-readiness checks when release evidence rules or row state change; run `verify:no-publish-baseline -- --candidate-sha <payload-sha>` only before G3 |
| App, feature, service, script, or dependency change | WP-1 through WP-3 | `npm run verify:local` |
| WebView, bridge, GSAV route, runtime, or player URL change | WP-1 through WP-4 | Local quality bundle, `npm run gsav:preflight`, `npm run gsav:runtime-smoke`, focused player tests, and QA evidence or an explicit environment gap |
| Release config, artifact, range-probe, or publish-flow change | WP-3 through WP-8 | `npm run verify:release-candidate` before freeze or `npm run verify:release-candidate -- --candidate-sha <payload-sha>` after freeze, `npm run verify:validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --ios-artifact-path "$IOS_VALIDATION_ARTIFACT_PATH" --output-path "$VALIDATION_PREREQS_PATH"` before external evidence signoff with trusted direct iOS artifact URL, 64-hex iOS artifact SHA256, and byte-verified iOS artifact path, `npm run android:version-metadata -- --apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH" --expected-version-code <app.json versionCode> --output-path <evidence>` for generated APK version evidence, `npm run android:installed-smoke -- --apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH" --output-path docs/qa-evidence/<date>/android-installed-release-smoke.txt --dry-run-summary-path "$DOWNLOADED_RELEASE_DIR/release-evidence/dry-run-summary.json" --production-host-url <https production GSAV host> --ci-artifact-url <artifact URL>` for exact APK install evidence with `productionHostReleaseReady=true`, `npm run verify:release-evidence-bundle -- --root "$DOWNLOADED_RELEASE_DIR" --evidence-dir release-evidence --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --mode dry-run` while `decision=no-publish`, `npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json> --require-git-integrity` after artifact review, release artifact/range/dry-run evidence when available, `npm run verify:workflows` for publish dispatch path guards, and `npm run verify:final-readiness-receipts -- --candidate-sha <payload-sha> --date <YYYY-MM-DD> --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --packet-path <reviewed-packet.json> --stack-receipt-path docs/qa-evidence/<date>/stack-architecture-receipt.json` before manual publish; raw `verify:release-readiness` is diagnostic-only outside that wrapper, and `--mode publish` is only for a later `decision=publish` path after WP-8 passes |

## Commit Messages

Use Conventional Commits:

```text
feat(native): add saved-scene empty state
fix(player): preserve start time in embedded watch URL
docs: update native WebView QA matrix
chore(diveo): prune legacy proxy script
```

## Pull Requests

PRs should include:

- a concise summary of the change;
- linked issue or context when available;
- commands run and results;
- device/platform validation for UI or WebView changes;
- screenshots or recordings for visible UI changes;
- confirmation that no credentials, session cookies, or account identifiers were
  committed.

## Configuration Safety

Values prefixed `EXPO_PUBLIC_*` are bundled into the client and must be treated
as public. Do not commit real secrets, private tokens, SESSDATA, or user account
identifiers.
