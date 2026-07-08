import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import verifier from "./verify-doc-drift.js";

const {
  activeDocs,
  analyzeDocDrift,
  routePresentationRegisterErrors,
  routeStubMapErrors,
} = verifier;
const gsavPackageProvenanceMarker = "gsavPackageProvenanceSha256=<64-hex sha> gsavPackageProvenance @opsiclear/gsav-bridge specifier=file:vendor/opsiclear-gsav-bridge-<version>.tgz tarballSha256=<64-hex sha> gsavPackageProvenance @opsiclear/gsav-client specifier=file:vendor/opsiclear-gsav-client-<version>.tgz tarballSha256=<64-hex sha>";

function supersededDocBanner(target, noun) {
  return `> Superseded by \`${target}\`.
> This file is historical and is not the active ${noun}.

`;
}

const historicalOwnershipWarning = `> Historical ownership warning: ADR 0002 supersedes launcher/no-catalog guidance below.
> React Native now owns native browse/search/creator/library product UX as a consumer of shared GSAV catalog contracts; gsav-hosting owns decode/render/playback/runtime.
> Do not use this file for ownership decisions.

`;

function writeDocs(root, overrides = {}) {
  for (const relativePath of Object.keys(activeDocs)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, docMarkers(relativePath));
  }
  const appStackPath = path.join(root, "features/app-shell/AppStack.tsx");
  fs.mkdirSync(path.dirname(appStackPath), { recursive: true });
  fs.writeFileSync(appStackPath, appStackFixture());
  for (const [relativePath, text] of Object.entries(overrides)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text);
  }
}

function docMarkers(relativePath, omit = () => false) {
  const includedPatterns = activeDocs[relativePath]
    .filter((pattern) => !omit(pattern.description ?? String(pattern)));
  const markers = includedPatterns
    .filter((pattern) => !(relativePath === "docs/IMPLEMENTATION_VALIDATION_AUDIT.md" && (pattern.description ?? String(pattern)).includes("Latest Command Summary")))
    .map((pattern) => markerForPattern(pattern))
    .join("\n");
  const includesAdrSupersedes = includedPatterns.some((pattern) => (pattern.description ?? String(pattern)).includes("Supersedes"));
  if (relativePath === "docs/adr/0002-native-app-with-web-player.md" && includesAdrSupersedes) {
    return `${markers}
Supersedes:** Runtime and native catalog/product-surface ownership portions of \`0001-gsav-pivot.md\`
`;
  }
  if (relativePath === "docs/IMPLEMENTATION_VALIDATION_AUDIT.md") {
    return `${markers}
## External Evidence Review Ledger
release dry run, validation prerequisites/device-validation bundle, APK/generated metadata, installed APK smoke, production runtime/range, product journey manifest, Android/iOS route rows, negative rows, branch protection
durable reviewed artifact reference concrete reviewer ISO timestamp category-specific proof
64-hex hashes trusted GitHub artifact URLs generated versionCode GSAV_HOSTING_COMMIT Content-Range CORS header
npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json>
npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json> --require-git-integrity
device packet path

## Final Publish Signoff
decision=no-publish; reviewer=_pending_; reviewedAt=_pending_;
publishScope=android-apk-only; iosDistributionDecision=no-publish;
payloadSha=_pending_; signoffSha=_pending_;
artifactName=_pending_; runUrl=_pending_;
checksumManifestSha256=_pending_; publishArtifactIdentitySha256=_pending_;
externalEvidenceInventoryPath=_pending_; deviceEvidencePacketPath=_pending_;
protectedCandidateProof=_pending_; finalCommandReceiptsPath=_pending_;
Last-mile GitHub release-state evidence
Last-mile publish-hash variable guard
lastMileReleaseStateEvidence=_pending_; lastMilePublishHashGuardEvidence=_pending_;
expected_apk_sha256=_pending_; expected_publish_identity_sha256=_pending_;
externalEvidenceInventoryPath=docs/qa-evidence/<date>/external-evidence-inventory.json
deviceEvidencePacketPath=<reviewed-packet.json>
lastMileReleaseStateEvidence=docs/qa-evidence/<date>/github-release-state-prepublish.json
lastMilePublishHashGuardEvidence=docs/qa-evidence/<date>/publish-hash-variable-guard-prepublish.json
The release-state JSON must show \`status=pass\`, concrete reviewer metadata,
passing query summaries, zero GitHub releases, releaseReadinessImpact.status=ready,
and a successful \`workflow_dispatch\` dry run; the publish-hash guard JSON must
show GitHub CLI query provenance, releaseReadinessImpact.status=ready,
\`EXPECTED_RELEASE_APK_SHA256\` and
\`EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256\` absent.
expectReadinessStatus=0 publishSignoffReady=true noPublishRehearsal=false status=pass status=expected-readiness-fail
EXPECTED_RELEASE_APK_SHA256=absent; EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256=absent.

## Latest Command Summary
npm run verify:release-readiness failed with 30 checked rows and 29 pending publish evidence rows and 22 pending device packets
capturesGsavHostIdentity=true

## Current Release Blockers
Android WebView QA
iOS WKWebView QA
Validation executor readiness
Negative fixture readiness
Production JS runtime smoke
Production \`.gsav\` range probe
Access-Control-Expose-Headers
Release APK, manifest scan, and installed APK smoke
Generated version metadata
Release dry run
Evidence artifact review signoff
Publish readiness
release-evidence/release-candidate.txt
checksum-manifest SHA
expected_apk_sha256 expected_publish_identity_sha256 manual publish reviewed dry-run artifact dry-run-summary.json apkSha256 publishArtifactIdentitySha256 publishArtifactIdentitySha256=<64-hex sha>
${gsavPackageProvenanceMarker}

## Remaining Validation Gaps
Release-candidate identity ordering
`;
  }
  if (relativePath === "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md") {
    return `${markers}
Current release state: 30 checked rows with 29 pending publish evidence rows and 22 pending device packets.
${routeStubMapFixture()}
${routePresentationRegisterFixture()}
`;
  }
  return `${markers}\n`;
}

function insertBeforeHistoricalPhaseAppendix(text, insertion) {
  const phaseStart = text.indexOf("\n## Phase 1 - Preserve The Baseline (Historical Appendix / Local Rehearsal Only)");
  if (phaseStart === -1) return `${text}\n${insertion}`;
  return `${text.slice(0, phaseStart)}\n${insertion}${text.slice(phaseStart)}`;
}

function appStackFixture() {
  return `
import { Stack } from "expo-router";

export function AppStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="search" />
      <Stack.Screen name="explore" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="creator" />
      <Stack.Screen name="gsav" />
      <Stack.Screen name="gsav-diagnostics" />
      <Stack.Screen name="watch" />
    </Stack>
  );
}
`;
}

function routeStubMapFixture() {
  return `Route stub map:

| Expo route | Feature owner |
| --- | --- |
| \`app/_layout.tsx\` | \`features/app-shell/RootLayout.tsx\` |
| \`app/creator/_layout.tsx\` | \`features/app-shell/CreatorLayout.tsx\` |
| \`app/index.tsx\` | \`features/catalog/HomeScreen.tsx\` |
| \`app/search.tsx\` | \`features/catalog/SearchScreen.tsx\` |
| \`app/creator/[handle].tsx\` | \`features/catalog/CreatorScreen.tsx\` |
| \`app/library.tsx\` | \`features/social/LibraryScreen.tsx\` |
| \`app/login.tsx\` | \`features/social/LoginScreen.tsx\` |
| \`app/settings.tsx\` | \`features/settings/SettingsScreen.tsx\` |
| \`app/explore.tsx\` | \`features/player/ExploreScreen.tsx\` hosted runtime exception |
| \`app/gsav-diagnostics.tsx\` | \`features/player/GsavDiagnosticsScreen.tsx\` |
| \`app/watch/[id].tsx\` | \`features/player/GsavScreen.tsx\` |
| \`app/gsav/[id].tsx\` | \`features/player/GsavScreen.tsx\` alias |

Hosted-runtime path contract:
`;
}

function routePresentationRegisterFixture() {
  return `Route presentation register:

| \`appRouteOwnerMap\` entry | Current presentation decision | Review rule |
| --- | --- | --- |
| \`app/_layout\` | Root layout wrapper; not an \`AppStack\` child screen | Keep shell/provider logic in \`features/app-shell/RootLayout.tsx\`; route ownership stays in \`appRouteOwnerMap\` |
| \`app/index\` | Explicit \`AppStack\` screen using default options | Home remains the native first screen |
| \`app/search\` | Explicit \`AppStack\` screen with slide transition | Search keeps native catalog navigation behavior |
| \`app/creator/_layout\` and \`app/creator/[handle]\` | \`creator\` group has explicit \`AppStack\` presentation; \`[handle]\` uses the nested creator layout | New creator subroutes must update the route owner map and nested layout review |
| \`app/explore\` | Explicit \`AppStack\` screen with slide transition | Hosted exception remains player-owned and device-validated |
| \`app/gsav-diagnostics\` | Explicit \`AppStack\` screen with slide transition | Diagnostics remains secondary/settings-owned in navigation UX |
| \`app/gsav/[id]\` | \`gsav\` group has explicit \`AppStack\` presentation | Native alias builds hosted \`/watch/:id\` and must not become a hosted \`/gsav/:id\` embed route |
| \`app/watch/[id]\` | \`watch\` group has explicit \`AppStack\` presentation | Player route evidence records final hosted watch URL |
| \`app/library\` | Intentional Expo Router default stack behavior | Add \`Stack.Screen name="library"\` only when a product decision needs custom transition or gesture options |
| \`app/login\` | Intentional Expo Router default stack behavior | Add \`Stack.Screen name="login"\` only when auth UX requires custom presentation |
| \`app/settings\` | Explicit \`AppStack\` screen with slide transition | Settings owns secondary diagnostics and maintenance entry points |

Degraded-state acceptance matrix:
`;
}

function markerForPattern(pattern) {
  const text = pattern.description ?? String(pattern);
  if (text.includes("Current Execution Snapshot")) {
    return "### Current Execution Snapshot\nCurrent status is no-publish.\nCanonical operator path:\nExternal artifact materialization records downloadedPath sha256 sourceRunId sourceArtifactId.\nPacket lifecycle uses a reviewed non-scaffold packet and product-journey-manifest.json.\nFinal local gate treats verify:final-readiness-receipts as the canonical final wrapper.\nFreshness rule: publish-counted rows are same-candidate and non-future-dated, then recaptured when source, workflow, host, device, fixture, schema, or verifier rules change.";
  }
  if (text.includes("target module structure")) {
    return "Target module structure:\n`app/` One-line Expo Router adapters\n`features/app-shell/` Bootstrap, providers\n`features/catalog/`, `features/social/`, `features/settings/`, `features/preferences/`, `features/scene/`, `features/app-update/` Native product surfaces\n`features/player/` Only WebView/iframe host\n`shared/` Pure route/config/auth-return/theme/UI primitives\n`services/` Thin vendor/client adapters\nStructure cleanup implemented locally ContinueWatchingPill resumeAccess exposes only resume state catalog owns placement and presentation";
  }
  if (text.includes("public contract inventory")) {
    return "Public contract inventory:\nfeatures/player/resumeAccess.ts\nfeatures/social/authSession.ts\nfeatures/social/savedSceneAccess.ts\nfeatures/preferences/preferenceAccess.ts\nfeatures/app-update/updateAccess.ts\nfeatures/scene/sceneShare.ts\nfeatures/social/FollowButton.tsx\nfeatures/social/SaveSceneButton.tsx\nshared/routeParams.ts\nshared/gsavRoutes.ts\nshared/gsavWeb.ts\nVerification and validation";
  }
  if (text.includes("post-release elegance target")) {
    return "Post-release elegance target: reduce the sibling allowlist below 12 by moving UI composition edges toward props or facades while keeping cross-feature imports limited to access contracts. npm run verify:import-boundaries and product-journey evidence prove behavior did not drift.";
  }
  if (text.includes("AGENTS\\.md")) {
    return "AGENTS.md already exists; do not overwrite or modify it during implementation-plan work.";
  }
  if (text.includes("Active read path")) {
    return "Active read path:\nADR 0002\ndocs/GSAV_NATIVE_SHELL_ARCHITECTURE.md\nOrdered Evidence Gate Sequence\nG0 through G7\ndocs/GSAV_NATIVE_QA.md\ndocs/IMPLEMENTATION_VALIDATION_AUDIT.md\nfinal publish or no-publish decision";
  }
  if (text.includes("Detailed Implementation Roadmap")) {
    return "### Detailed Implementation Roadmap\nReviewer lenses for this pass:\nDetailed V&V workstream plan:\nW0 boundary lock\nW5 release validation sequence\nR0 structure lock\nR7 final review and release decision\nG0 through G7\ndecision=no-publish";
  }
  if (text.includes("canonical release dry-run dispatch")) {
    return 'Canonical dispatch uses gh workflow run "Release APK" -R OpsiClear-Web/diveo --ref <evidence-signoff-ref> -f candidate_ref=<payload-sha> -f publish_release=false; select the completed workflow_dispatch by run ID before downloading.';
  }
  if (text.includes("Release Structure Lock")) {
    return "### Release Structure Lock\nReact Native owns native browse/search/creator/library/login/settings. features/player/ is the only native WebView/iframe boundary. /explore is the only release-scoped hosted browse exception. sibling allowlist remains at 12 entries. Expo web iframe evidence remains rehearsal-only.";
  }
  if (text.includes("Validation promotion map")) {
    return "Validation promotion map:\nG3 production dry run and host/range/runtime proof\nG4 validation prerequisites and exact APK/manifest\nG5 generated metadata and installed smoke\nG6 Android/iOS route captures\nG6 negative captures\nG7 final review and signoff\nnpm run verify:external-evidence-inventory -- --require-git-integrity\nnpm run verify:final-readiness-receipts";
  }
  if (text.includes("G7 passes only")) {
    return "G7 passes only with `decision=publish`; `decision=no-publish` remains a valid hold or rehearsal state, and final receipts generated with `--expect-readiness-fail` are rehearsal only.";
  }
  if (text.includes("Final evidence filename map")) {
    return "Final evidence filename map:\ndocs/qa-evidence/<date>/github-release-state-prepublish.json\ndocs/qa-evidence/<date>/publish-hash-variable-guard-prepublish.json\ndocs/qa-evidence/<date>/final-command-receipts/github-release-state-prepublish-live.json\ndocs/qa-evidence/<date>/final-command-receipts/publish-hash-variable-guard-prepublish-live.json\ndocs/qa-evidence/<date>/final-command-receipts/verification-summary.json\nnoPublishRehearsal=false\nrelease-evidence/github-release-state-prepublish.json\nrelease-evidence/publish-hash-variable-guard-prepublish.json";
  }
  if (text.includes("final receipt last-mile live path binding")) {
    return "Final receipt live path binding: inputs.date inputs.lastMileReleaseStateLivePath inputs.lastMilePublishHashGuardLivePath finalCommandReceiptsPath evidence date final-command-receipts github-release-state-prepublish-live.json publish-hash-variable-guard-prepublish-live.json step commands --output-path.";
  }
  if (text.includes("final receipt last-mile review binding")) {
    return "Final receipt last-mile review binding: inputs.repository, inputs.reviewer, and inputs.reviewedAt must be concrete and must match the Last-mile GitHub release-state evidence and Last-mile publish-hash variable guard step commands through --repo, --reviewer, and --reviewed-at; inputs.repository must be the trusted Diveo repository, inputs.reviewer must be a concrete reviewer, and inputs.reviewedAt must be an ISO timestamp on the final evidence date; the wrapper rejects untrusted repository before helper commands run, wrapper rejects weak reviewer before helper commands run, and wrapper rejects stale reviewedAt before helper commands run; static last-mile JSON review metadata must match the final command receipt summary.";
  }
  if (text.includes("final receipt reviewer source fail-fast binding")) {
    return "Final receipt reviewer source fail-fast binding: inputs.reviewer must come from --reviewer, FINAL_READINESS_REVIEWER, GITHUB_ACTOR, USERNAME, or USER; the wrapper rejects missing reviewer and wrapper rejects final-readiness-runner before helper commands run.";
  }
  if (text.includes("final receipt summary timing binding")) {
    return "Final receipt summary timing binding: startedAt and finishedAt must be ISO timestamp on the final evidence date, and finishedAt must not be before startedAt.";
  }
  if (text.includes("final receipt pass-summary contradiction binding")) {
    return "Final receipt pass-summary contradiction binding: final command receipt summary with status=pass and ok=true must not include failedStep or non-empty outputProblems.";
  }
  if (text.includes("final receipt input fail-fast binding")) {
    return "Final receipt input fail-fast binding: inputs.date must be the current UTC capture date; the wrapper rejects stale date and wrapper rejects future date before helper commands run; inputs.qaPath must be docs/GSAV_NATIVE_QA.md; the wrapper rejects noncanonical QA path before helper commands run.";
  }
  if (text.includes("final receipt evidence-dir fail-fast binding")) {
    return "Final receipt evidence-dir fail-fast binding: inputs.evidenceDir must be docs/qa-evidence/<date>/final-command-receipts and match the finalCommandReceiptsPath directory; the wrapper rejects noncanonical evidence-dir before helper commands run.";
  }
  if (text.includes("final receipt inventory fail-fast binding")) {
    return "Final receipt inventory fail-fast binding: inputs.inventoryPath must be docs/qa-evidence/<date>/external-evidence-inventory.json; the wrapper rejects noncanonical inventory path before helper commands run.";
  }
  if (text.includes("final receipt runUrl repository binding")) {
    return "Final receipt runUrl repository binding: inputs.repository must match the audit runUrl repository so final receipts and release evidence use the same trusted Diveo repository.";
  }
  if (text.includes("final receipt release-state query repository binding")) {
    return "Final receipt release-state query repository binding: commands for workflows, releaseRuns, workflowDispatchRuns, and releases must use gh api repos/<owner>/<repo>/actions/workflows or gh run/release list with -R or --repo matching inputs.repository, the final command receipt summary repository.";
  }
  if (text.includes("final receipt live last-mile JSON binding")) {
    return "Final receipt live last-mile JSON binding: inputs.lastMileReleaseStateLivePath and inputs.lastMilePublishHashGuardLivePath must exist as valid JSON with status=pass, ok=true, repository, reviewer, reviewedAt, checkedAt on the final evidence date, and releaseReadinessImpact.status=ready.";
  }
  if (text.includes("final receipt live output creation binding")) {
    return "Final receipt live output creation binding: Last-mile GitHub release-state evidence and Last-mile publish-hash variable guard must create valid JSON at inputs.lastMileReleaseStateLivePath and inputs.lastMilePublishHashGuardLivePath; the wrapper removes stale live output before each capture step, validates repository, reviewer, reviewedAt, and checkedAt on the final evidence date, then for each live step with expectedStatus=0 requires status=pass, ok=true, and releaseReadinessImpact.status=ready before it can continue; the wrapper must stop before Final release readiness and record outputProblems if either file is missing, invalid, mismatched, or not ready.";
  }
  if (text.includes("final receipt publish-hash query repository binding")) {
    return "Final receipt publish-hash query repository binding: variableQueries[].command for EXPECTED_RELEASE_APK_SHA256 and EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256 must include --repo matching inputs.repository, the final command receipt summary repository.";
  }
  if (text.includes("final receipt step-log byte replay")) {
    return "Final receipt step-log byte replay: stdoutPath stderrPath stdoutSha256 stderrSha256 combinedSha256 final-command-receipts byte replay.";
  }
  if (text.includes("final receipt wrapper step set")) {
    return "Final receipt wrapper step set: all 11 final receipt wrapper steps in order: Documentation drift audit; Final readiness focused tests; External evidence inventory replay; Device packet reconciliation; Strict handoff receipt replay; Stack architecture receipt replay; Protected master ref refresh; Protected candidate ancestry proof; Last-mile GitHub release-state evidence; Last-mile publish-hash variable guard; Final release readiness. The wrapper rejects missing, duplicate, or reordered recorded step evidence before status=pass.";
  }
  if (text.includes("final receipt wrapper step status")) {
    return "Final receipt wrapper step status: every final wrapper step must record expectedStatus=0 and status=0 before publish signoff.";
  }
  if (text.includes("final receipt Final release readiness env binding")) {
    return "Final release readiness command/env binding: verify-release-readiness.js --strict-final-inputs must run with EXTERNAL_EVIDENCE_INVENTORY_PATH, DEVICE_EVIDENCE_PACKET_PATH, RELEASE_CANDIDATE_SHA, and FINAL_READINESS_RECEIPT_BOOTSTRAP matching finalCommandReceiptsPath; no other env values are allowed because these are the safe final input keys.";
  }
  if (text.includes("final receipt internal command binding")) {
    return "Final receipt internal command binding: node_modules/vitest/vitest.mjs run scripts/verify-release-readiness.test.mjs scripts/verify-doc-drift.test.mjs scripts/verify-external-evidence-inventory.test.mjs scripts/device-evidence-packet.test.mjs scripts/verify-handoff-receipts.test.mjs scripts/stack-architecture-receipt.test.mjs; inputs.qaPath must be docs/GSAV_NATIVE_QA.md; inventory replay uses --inventory-path, --qa-path, and --packet-path with --require-git-integrity; device packet uses --qa-path, --candidate-sha, and --require-git-integrity; stack receipt replay uses scripts/stack-architecture-receipt.js --require-assets --verify docs/qa-evidence/<date>/stack-architecture-receipt.json; protected proof uses git fetch --no-tags origin master and git merge-base --is-ancestor.";
  }
  if (text.includes("Reviewed device packet minimum schema")) {
    return "Reviewed device packet minimum schema:\nreleaseCandidateSha Android `versionCode` Android WebView package/version or iOS WKWebView/WebKit version evidenceManifestPath evidenceManifestSha256 helperOnly=false same-candidate proof";
  }
  if (text.includes("product-journey-manifest") && text.includes("distinct Android")) {
    return "docs/qa-evidence/<date>/product-journey-manifest.json requires distinct Android and iOS `evidencePaths` for every product journey entry.";
  }
  if (text.includes("Inventory replay") && text.includes("duplicate") && text.includes("product journey entry IDs")) {
    return "Inventory replay rejects missing, placeholder, `unknown`, or duplicate product journey entry IDs before any linked journey evidence can count.";
  }
  if (text.includes("product-journey-manifest") && text.includes("unique")) {
    return "docs/qa-evidence/<date>/product-journey-manifest.json requires unique product journey entry IDs.";
  }
  if (text.includes("product-journey-manifest") && text.includes("valid JSON")) {
    return "docs/qa-evidence/<date>/product-journey-manifest.json must be valid JSON with an entries array before inventory expansion can expand linked evidence.";
  }
  if (text.includes("product-journey-manifest") && text.includes("reviewed inventory")) {
    return "docs/qa-evidence/<date>/product-journey-manifest.json reviewed inventory row must include artifactPurpose=product-journey-manifest and helperOnly=false.";
  }
  if (text.includes("product-journey-manifest") && text.includes("manifest contents")) {
    return "Inventory replay checks product-journey-manifest.json manifest contents include artifactPurpose=product-journey-manifest and helperOnly=false.";
  }
  if (text.includes("fixture-manifest") && text.includes("fixture manifest") && text.includes("contents")) {
    return "Inventory replay opens fixture-manifest.json and verifies the fixture manifest contents include artifactPurpose=fixture-manifest and helperOnly=false before the fixture can count.";
  }
  if (text.includes("fixtureManifestPath") && text.includes("artifactPurpose=fixture-manifest")) {
    return "docs/qa-evidence/<date>/product-journey-manifest.json fixtureManifestPath must point at fixture-manifest.json; external evidence inventory replay requires the fixture-manifest.json reviewed inventory entry to include artifactPurpose=fixture-manifest, helperOnly=false, and sha256 matching fixtureManifestSha256.";
  }
  if (text.includes("product-journey-manifest") && text.includes("same docs/qa-evidence")) {
    return "docs/qa-evidence/<date>/product-journey-manifest.json requires the fixture manifest and local linked journey evidence to stay in the same docs/qa-evidence/<date>/ folder; inventory replay rejects stale local fixture or media paths from another evidence date.";
  }
  if (text.includes("product-journey-manifest") && text.includes("product-journey-evidence")) {
    return "docs/qa-evidence/<date>/product-journey-manifest.json linked journey evidence entry must include artifactPurpose=product-journey-evidence, helperOnly=false, and journeyEntryId or sourceRefs pointing back to the manifest entry ID. The reviewed inventory sha256 must match mediaSha256 for local evidence and fileSha256 for URL-backed evidence. For URL-backed evidence, inventory replay checks sourceRunId and sourceArtifactId against the evidence URL.";
  }
  if (text.includes("product-journey-manifest") && text.includes("observedSignals")) {
    return "product-journey-manifest.json observedSignals require native Home feed state keyboard visible without overlap follow signed-out to login and return signed-in seeded saved scenes keyboard-visible native Login UI no hosted account chrome /gsav/test?t=2.5 progress saves and resume works exactly one embed=native dataSaver=1 vertical swipe/scroll changing the active scene visible active-scene change /native-diagnostics?embed=native 44dp touch targets no blank WebView.";
  }
  if (text.includes("product-journey-manifest Explore restraint")) {
    return "product-journey-manifest Explore restraint requires Home to expose Explore only as a secondary/runtime-scoped action while the native feed, Search, Library, and Settings remain visible. Explore evidence must show exactly one `embed=native`, hidden hosted public/account chrome, native-shell back behavior, no primary Home browse surface replacement, and no same-origin hosted product routes escape the player boundary.";
  }
  if (text.includes("product-journey-manifest") && text.includes("evidencePaths")) {
    return "docs/qa-evidence/<date>/product-journey-manifest.json requires every manifest entry `evidencePaths` item as reviewed, byte-hashed inventory entries.";
  }
  if (text.includes("product-journey-manifest") && text.includes("first-launch-home")) {
    return "docs/qa-evidence/<date>/product-journey-manifest.json first-launch-home search creator library login-auth-return watch-alias explore diagnostics-hierarchy settings accessibility-ergonomics degraded-blocked-states";
  }
  if (text.includes("Negative trigger matrix")) {
    return "Negative trigger matrix:\nMissing host config\nproduction no-QA-flag proof\nHost offline/retry\nCross-origin navigation\nUnsupported renderer\nAuth initialization gate\nEnded playback";
  }
  if (text.includes("External artifact review procedure")) {
    return "External artifact review procedure:\nDownload or inspect every trusted GitHub artifact. Recompute every byte-sensitive hash. Unpack route or negative artifacts. Record proof in the External Evidence Review Ledger. Run strict git-integrity replay.";
  }
  if (text.includes("external artifact replay staging layout")) {
    return "URL-backed external artifact replay stages downloadedPath under docs/qa-evidence/<date>/external/<sourceRunId>/<sourceArtifactId>/ and records sourceRunId plus sourceArtifactId.";
  }
  if (text.includes("audit external evidence replay staging row")) {
    return "External evidence inventory replay staging hardening records docs/qa-evidence/<date>/external/<sourceRunId>/<sourceArtifactId>/, final replay against the scaffold failed as intended, and decision=no-publish.";
  }
  if (text.includes("Evidence invalidation rules")) {
    return "Evidence invalidation rules:\nPayload SHA\nReturn G3-G5 rows to pending\nGSAV host URL\nRoute ownership\nDevice OS\nQA schema\nRerun docs drift\ninventory replay\npacket check\ncandidate-pinned readiness\nMark rows stale\nrepeat the affected gate";
  }
  if (text.includes("--expected-version-code")) return "--expected-version-code";
  if (text.includes("--production-host-url")) return "--production-host-url <https production GSAV host>";
  if (text.includes("productionHostReleaseReady=true")) return "productionHostReleaseReady=true";
  if (text.includes("--root") && text.includes("--apk-path")) return "npm run verify:validation-prereqs -- --root \"$DOWNLOADED_RELEASE_DIR\" --apk-path \"$APK_PATH\" --manifest-path \"$MANIFEST_PATH\" --ios-artifact-path \"$IOS_VALIDATION_ARTIFACT_PATH\" --output-path \"$VALIDATION_PREREQS_PATH\"";
  if (text.includes("current sibling allowlist budget is 12")) return "The current sibling allowlist budget is 12 entries";
  if (text.includes("shared\\/themeContext")) return "shared/themeContext.tsx";
  if (text.includes("GsavWebView\\.web")) return "features/player/GsavWebView.web.tsx";
  if (text.includes("iOS simulator\\/device identity") || text.includes("iOS simulator\\/device")) return "iOS simulator/device identity";
  if (text.includes("iOS simulator or physical-device identity")) return "iOS simulator or physical-device identity";
  if (text.includes("frozen payload candidate")) return "frozen payload candidate";
  if (text.includes("frozen candidate SHA")) return "frozen candidate SHA";
  if (text.includes("downloaded checksum-manifest")) return "downloaded checksum-manifest SHA256";
  if (text.includes("downloaded (?:bundle|artifact)") || text.includes("exact downloaded bundle") || text.includes("bundle-verifier rerun")) return "verify:release-evidence-bundle rerun against the downloaded bundle";
  if (text.includes("release-evidence:attach-validation-prereqs") && text.includes("iOS artifact") && text.includes("recomput")) {
    return "release-evidence:attach-validation-prereqs adds the prerequisite JSON and iOS artifact under release-evidence/ to dry-run-summary.json and evidence-checksums.txt; strict verify:release-evidence-bundle -- --require-validation-prereqs true recomputes the current iOS artifact SHA256 bytes.";
  }
  if (text.includes("artifactReviewArtifact=<artifact name or ID>") && text.includes("artifact ID")) {
    return "artifactReviewArtifact=<artifact name or ID> matching the row artifact name unless it is an artifact ID";
  }
  if (text.includes("dry-run-summary\\.json") && text.includes("artifactName") && text.includes("inputs\\.artifact_name")) {
    return "dry-run-summary.json artifactName matches inputs.artifact_name";
  }
  if (text.includes("release_run_id") && text.includes("diveo-release-evidence-v<semver>")) {
    return "release_run_id digits artifact_name diveo-release-evidence-v<semver> evidence_date YYYY-MM-DD release_artifact_url trusted Diveo GitHub Actions run Actions artifact release asset download URL";
  }
  if (text.includes("device-evidence:packet -- --example")) {
    return "npm run device-evidence:packet -- --example reviewed packet excerpt documentation only";
  }
  if (text.includes("evidenceManifestPath") && text.includes("evidenceManifestSha256")) {
    return "actual.evidenceManifestPath points at docs/qa-evidence/... file, the packet verifier hashes it and compares it to actual.evidenceManifestSha256";
  }
  if (text.includes("route/negative manifest content classification")) {
    return "route/negative manifest contents include artifactPurpose=route-evidence or artifactPurpose=negative-evidence plus helperOnly=false and sourceRunId/sourceArtifactId matching the artifact URL";
  }
  if (text.includes("route/negative manifest same-date replay")) {
    return "route or negative manifestPath and evidenceManifestPath must live under the same docs/qa-evidence/<date>/ folder as the inventory evidence date; inventory replay rejects stale route or negative manifests from another evidence date.";
  }
  if (text.includes("packet local evidence same-date replay")) {
    return "actual.evidencePaths and actual.evidenceManifestPath must live under the packet target evidence date docs/qa-evidence/<date>/ folder; device packet replay rejects stale local route or negative packet evidence from another evidence date.";
  }
  if (text.includes("device-evidence:packet --check") && text.includes("mediaSha256")) {
    return "device-evidence:packet --check recomputes screenshot recording archive hashes and compares them to mediaSha256";
  }
  if (text.includes("product journey external evidence scaffold hints")) {
    return "npm run external-evidence:scaffold writes product-journey linked evidence hints productJourneyExpectedSha256Field productJourneyExpectedSha256 productJourneySourceRunId productJourneySourceArtifactId before reviewer promotion.";
  }
  if (text.includes("external-evidence:scaffold")) {
    return "npm run external-evidence:scaffold -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory-scaffold.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json>";
  }
  if (text.includes("Active Gate Cards") && text.includes("verify:external-evidence-inventory")) {
    return "#### Active Gate Cards\n| G7 | Completed QA rows | `npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json> --require-git-integrity` |";
  }
  if (text.includes("active G6/G7 command handoff")) {
    return "G6 command handoff:\n"
      + "npm run device-evidence:packet -- --date <YYYY-MM-DD> --owner <reviewer> --candidate-sha <payload-sha> --dry-run-artifact diveo-release-evidence-v<version> --dry-run-run-url <run-url> --output-path docs/qa-evidence/<date>/device-evidence-packet-candidate.json\n"
      + "npm run device-evidence:packet -- --check --input-path docs/qa-evidence/<date>/device-evidence-packet-reviewed.json --qa-path docs/GSAV_NATIVE_QA.md --candidate-sha <payload-sha> --require-git-integrity\n"
      + "G7 command handoff:\n"
      + "npm run external-evidence:scaffold -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory-scaffold.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path docs/qa-evidence/<date>/device-evidence-packet-reviewed.json\n"
      + "GitHub CLI or browser-authenticated download recompute SHA256\n"
      + "github-release-state-prepublish.json publish-hash-variable-guard-prepublish.json DEVICE_EVIDENCE_PACKET_PATH EXTERNAL_EVIDENCE_INVENTORY_PATH --strict-final-inputs verify:final-readiness-receipts";
  }
  if (text.includes("verify:external-evidence-inventory") && text.includes("--require-git-integrity")) {
    return "npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json> --require-git-integrity";
  }
  if (text.includes("Protected candidate ancestry proof") || text.includes("publishSignoffReady")) {
    return "npm run verify:final-readiness-receipts -- --candidate-sha <payload-sha> --date <YYYY-MM-DD> --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --packet-path <reviewed-packet.json> --stack-receipt-path docs/qa-evidence/<date>/stack-architecture-receipt.json\nProtected candidate ancestry proof with git fetch --no-tags origin master\nexpectReadinessStatus=0 publishSignoffReady=true noPublishRehearsal=false status=pass status=expected-readiness-fail";
  }
  if (text.includes("verify:final-readiness-receipts")) {
    return "npm run verify:final-readiness-receipts -- --candidate-sha <payload-sha> --date <YYYY-MM-DD> --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --packet-path <reviewed-packet.json> --stack-receipt-path docs/qa-evidence/<date>/stack-architecture-receipt.json";
  }
  if (text.includes("handoff-receipts blocker") || text.includes("handoff-receipts-blocker")) {
    return "G0 prerequisite source evidence: branch-protection publish-hash guard GitHub release-state validation-prereq blocker handoff-receipts blocker no-publish baseline\nnpm run verify:handoff-receipts -- --date <YYYY-MM-DD> --allow-pending --output-path docs/qa-evidence/<date>/handoff-receipts-blocker.json";
  }
  if (text.includes("materialize-ios-validation-artifact")) {
    return "node scripts/materialize-ios-validation-artifact.js --url <trusted direct GitHub artifact/release/blob URL> --output-path \"$DOWNLOADED_RELEASE_DIR/$IOS_VALIDATION_ARTIFACT_PATH\" --expected-sha256 <64-hex sha>";
  }
  if (text.includes("Release Owner Execution Checklist")) {
    return "### Release Owner Execution Checklist (Historical Appendix)\nThis numbered list is non-authoritative context. The active release execution order is G0 through G7.";
  }
  if (text.includes("verify:external-evidence-inventory")) {
    return "npm run verify:external-evidence-inventory -- --inventory-path docs/qa-evidence/<date>/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path <reviewed-packet.json>";
  }
  if (text.includes("reviewed\\s+non-scaffold")) {
    return "reviewed non-scaffold packet path rejects scaffold, candidate, pending, or example filenames";
  }
  if (text.includes("Scene composition boundary") && text.includes("direct catalog-composition guard")) {
    return "Scene composition boundary Catalog should pass IDs, display values, placement props, and callbacks instead of reading social stores, player resume state, bridge state, Supabase clients, or follow reconciliation rules. verify:import-boundaries now has a direct catalog-composition guard.";
  }
  if (text.includes("Native WebView route gate") && text.includes("Navigation blocked")) {
    return "Native WebView route gate configured GSAV origin embedded hosted route allowlist same-origin hosted catalog/account/studio/upload paths Navigation blocked Focused player tests cover";
  }
  if (text.includes("future native handoff requires ADR 0002")) {
    return "same-origin hosted product paths fail closed with a nonblank native blocked state for this release. Future native handoff requires ADR 0002, features/player/nativeNavigation.ts, focused tests, QA rows, and Android/iOS evidence in a no-publish pass.";
  }
  if (text.includes("same-origin native-owned hosted product paths fail closed")) {
    return "same-origin native-owned hosted product paths fail closed with a nonblank Navigation blocked state for this release.";
  }
  if (text.includes("device-evidence:packet --check") && text.includes("qa-native-blocked")) {
    return "device-evidence:packet --check sameOriginProductPathOutcome Same-origin /creator/qa-native-blocked Navigation blocked";
  }
  if (text.includes("qa-native-blocked")) {
    return "/gsav-diagnostics with EXPO_PUBLIC_GSAV_QA_CONTROLS=1 tap `Same-origin` /creator/qa-native-blocked sameOriginProductPathOutcome not as a separate negative readiness row";
  }
  if (text.includes("ContinueWatchingPill") && text.includes("resumeAccess")) {
    return "features/catalog/ContinueWatchingPill.tsx is Catalog-owned native presentation backed by features/player/resumeAccess.ts as the narrow resume state/action contract.";
  }
  if (text.includes("Phase 1 - Preserve The Baseline")) {
    return "## Phase 1 - Preserve The Baseline (Historical Appendix / Local Rehearsal Only)\n## Phase 2 - Consolidate Player Ownership (Historical Appendix / Local Rehearsal Only)\n## Phase 3 - Harden The Native/Web Boundary (Historical Appendix / Local Rehearsal Only)\n## Phase 4 - Split Native Product Features (Historical Appendix / Local Rehearsal Only)\n## Phase 5 - Expand Integration Smoke Coverage (Historical Appendix / Local Rehearsal Only)\n## Phase 6 - Quarantine Or Remove Legacy Bilibili Code (Historical Appendix / Local Rehearsal Only)\n## Phase 7 - Device QA And Release Readiness (Historical Appendix / Local Rehearsal Only)\n## Phase 8 - Refine The Dependency Graph (Historical Appendix / Local Rehearsal Only)";
  }
  if (text.includes("Focused Player Verification Matrix") || text.includes("features/player/useGsavEmbedHost.test.ts")) {
    return "### Focused Player Verification Matrix\nnpm test -- features/player/useGsavEmbedHost.test.ts features/player/bridge.test.ts features/player/progressBridge.test.ts features/player/gsavProgressStore.test.ts features/app-shell/navigationUx.test.ts shared/gsavRoutes.test.ts shared/gsavWeb.test.ts services/gsav.test.ts\nnpm test -- scripts/gsav-native-runtime-smoke.test.mjs scripts/gsav-native-preflight.test.mjs";
  }
  if (text.includes("Negative-path verifier passes")) {
    return "Negative-path verifier passes are different from expected-fail readiness. verify:validation-prereqs validation-prereq blocker and Production config negative native production-config negative are valid only for a known blocker inventory or known missing production env; unrelated crash is a gate failure.";
  }
  if (text.includes("ios\\.supportsTablet=true")) {
    return "Because app.json keeps ios.supportsTablet=true, iPad/tablet ergonomics evidence or tablet ergonomics evidence and a scoped no-publish exception are required; phone-only WKWebView evidence is not enough for an iOS distribution claim.";
  }
  if (text.includes("ios_validation_artifact_url") && text.includes("ios_validation_artifact_sha256") && text.includes("opsiclear")) {
    return "ios_validation_artifact_url trusted direct Actions artifact release asset download docs/qa-evidence blob OpsiClear-Web/diveo or opsiclear/gsav-hosting iOS evidence ios_validation_artifact_sha256 64-hex";
  }
  if (text.includes("expected_apk_sha256") && text.includes("expected_publish_identity_sha256")) {
    return "expected_apk_sha256 expected_publish_identity_sha256 manual publish reviewed dry-run artifact dry-run-summary.json apkSha256 publishArtifactIdentitySha256 publishArtifactIdentitySha256=<64-hex sha>";
  }
  if (text.includes("RELEASE_CANDIDATE_SHA=<payload-sha>")) {
    return "EXTERNAL_EVIDENCE_INVENTORY_PATH=docs/qa-evidence/<date>/external-evidence-inventory.json DEVICE_EVIDENCE_PACKET_PATH=<reviewed-packet.json> RELEASE_CANDIDATE_SHA=<payload-sha> npm run verify:release-readiness";
  }
  if (text.includes("fixed\\s+") && text.includes("30\\s+publish-readiness") && text.includes("Host\\s+preflight")) {
    return "Use the fixed row set below for publish readiness. The readiness verifier rejects Evidence Log rows outside the 30 publish-readiness platform/route pairs and the documented context-only Host preflight / GSAV target routes rows.";
  }
  if (text.includes("gsavPackageProvenance")) {
    return gsavPackageProvenanceMarker;
  }
  if (text.includes("write-release-evidence-summary")) {
    return "write-release-evidence-summary.js release-candidate.txt releaseCandidateSha appVersion packageVersion androidVersionCode RELEASE_CANDIDATE_SHA semver releaseVersion numeric";
  }
  if (text.includes("diveo-device-validation")) {
    return "diveo-device-validation-${{ inputs.evidence_date }}-${{ inputs.release_run_id }}";
  }
  if (text.includes("deviceValidationWorkflowPresent")) {
    return "deviceValidationWorkflowPresent remote Device Validation workflow local or untracked no-publish blocker active on GitHub";
  }
  if (text.includes("if-no-files-found")) return "if-no-files-found: error";
  if (text.includes("validation\\s+prerequisites\\/device-validation\\s+bundle")) {
    return "release dry run, validation prerequisites/device-validation bundle, APK/generated metadata, installed APK smoke, production runtime/range, product journey manifest, Android/iOS route rows, negative rows, and branch protection";
  }
  if (text.includes("durable\\s+reviewed\\s+artifact\\s+reference")) {
    return "durable reviewed artifact reference, concrete reviewer, ISO timestamp, and category-specific proof";
  }
  if (text.includes("64-hex\\s+hashes")) {
    return "64-hex hashes, trusted GitHub artifact URLs, generated `versionCode`, GSAV_HOSTING_COMMIT, and exact Content-Range/CORS header observations";
  }
  if (text.includes("diveo-release-evidence-v")) return "diveo-release-evidence-v<version>";
  if (text.includes("7-day freshness")) return "7-day freshness window";
  if (text.includes("Explore Hosted Exception Contract")) {
    return "### Explore Hosted Exception Contract\nShorts-style runtime discovery surface\nOwner features/player/ExploreScreen.tsx\nBrowser mode YouTube Shorts full-viewport vertical feed touch/wheel/trackpad navigation keyboard controls URL/deep-link restore\nNative embed mode /explore?embed=native dataSaver=1\nBoundary guard same-origin hosted product paths\nVerification npm run verify:import-boundaries browser Playwright desktop/mobile navigation tests\nValidation Android and iOS `/explore` rows vertical swipe/scroll visible active-scene change\nExit criteria to move native";
  }
  if (text.includes("React Native owns the mobile product shell")) return "React Native owns the mobile product shell";
  if (text.includes("docs\\/IMPLEMENTATION_VALIDATION_AUDIT")) return "docs/IMPLEMENTATION_VALIDATION_AUDIT.md";
  if (text.includes("publish\\/no-publish decision")) return "publish/no-publish decision";
  if (text.includes("gsav-hosting owns:")) return "gsav-hosting owns:";
  if (text.includes("decode\\/render\\/playback\\/runtime chrome")) return "../gsav-hosting/apps/web` owns GSAV decode/render/playback/runtime chrome";
  if (text.includes("Intentional hosted runtime")) return "Intentional hosted runtime route loads `/explore?embed=native`";
  if (text.includes("trusted GitHub CI\\/artifact\\/release URL\\s+under")) return "trusted GitHub CI/artifact/release URL under `opsiclear/diveo`, `OpsiClear-Web/diveo`, or `opsiclear/gsav-hosting`";
  if (text.includes("trusted GitHub CI\\/artifact\\/release URL under")) return "trusted GitHub CI/artifact/release URL under `opsiclear/diveo`, `OpsiClear-Web/diveo`, or `opsiclear/gsav-hosting`";
  if (text.includes("trusted GitHub CI\\/artifact\\/release URL")) return "trusted GitHub CI/artifact/release URL under `opsiclear/diveo`, `OpsiClear-Web/diveo`, or `opsiclear/gsav-hosting`";
  if (text.includes("row detail evidence URLs?")) return "row detail evidence URLs must be trusted GitHub evidence";
  if (text.includes("release\\s+tag\\s+pages?")) {
    return "Release tag pages are context only; use the Actions run, direct Actions artifact, release asset download, or tracked docs/qa-evidence blob.";
  }
  if (text.includes("comma- or semicolon-separated entry")) return "comma- or semicolon-separated entry";
  if (text.includes("tracked and committed")) return "tracked and committed";
  if (text.includes("unsupported mixed evidence")) return "unsupported mixed evidence entries";
  if (text.includes("Scoped exception fields")) return "Scoped exception fields";
  if (text.includes("local emulator or simulator URLs")) return "local emulator or simulator URLs are rehearsal evidence only. Publish-counted Android and iOS rows require a production HTTPS GSAV host or release-equivalent staging and a scoped no-publish blocker when missing.";
  if (text.includes("Publish-counted Android\\s+and iOS rows")) return "Publish-counted Android and iOS rows require a production HTTPS GSAV host or release-equivalent staging and a scoped no-publish blocker when missing.";
  if (text.includes("Local rehearsal may use the emulator")) return "Local rehearsal may use the emulator/simulator URLs. Publish-counted Android/iOS rows require production HTTPS or release-equivalent staging.";
  if (text.includes("Negative Fixture Inventory")) return "## Negative Fixture Inventory";
  if (text.includes("tap `Unsupported`")) return "tap `Unsupported`";
  if (text.includes("EXPO_PUBLIC_GSAV_QA_CONTROLS")) return "EXPO_PUBLIC_GSAV_QA_CONTROLS";
  if (text.includes("EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS")) return "EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS";
  if (text.includes("releaseWorkflowForbidsQaFlags")) return "releaseWorkflowForbidsQaFlags";
  if (text.includes("qaControlsDisabled")) return "qaControlsDisabled";
  if (text.includes("qaAuthDelayDisabled")) return "qaAuthDelayDisabled";
  if (text.includes("releaseCandidateSha") && text.includes("candidate_ref") && text.includes("evidenceSignoffSha")) return "releaseCandidateSha candidate_ref evidenceSignoffSha";
  if (text.includes("same run ID") || (text.includes("Evidence path cell") && text.includes("workflow run URL"))) return "Evidence path cell must match the workflow run URL on the same run ID";
  if (text.includes("Owner-blocked until")) return "Owner-blocked until";
  if (text.includes("gsav-hosting")) return "../gsav-hosting/apps/web` owns the browser-only GSAV runtime";
  if (text.includes("embed=native")) return "embed=native";
  if (text.includes("npm ci")) return "npm ci";
  if (text.includes("npm test -- scripts\\/verify-doc-drift")) return "npm test -- scripts/verify-doc-drift.test.mjs";
  if (text.includes("verify:whitespace")) return "npm run verify:whitespace";
  if (text.includes("scope=pre-g3-no-publish-baseline")) {
    return "scope=pre-g3-no-publish-baseline invalidAfter=first Release APK workflow_dispatch fixed-candidate dry run";
  }
  if (text.includes("verify:no-publish-baseline")) return "npm run verify:no-publish-baseline";
  if (text.includes("verify:dependency-audit")) return "npm run verify:dependency-audit";
  if (text.includes("verify:import-boundaries")) return "npm run verify:import-boundaries";
  if (text.includes("verify:docs-drift")) return "npm run verify:docs-drift";
  if (text.includes("verify:workflows")) return "npm run verify:workflows";
  if (text.includes("verify:local")) return "npm run verify:local";
  if (text.includes("verify:release-candidate")) return "npm run verify:release-candidate";
  if (text.includes("gsav:preflight")) return "npm run gsav:preflight";
  if (text.includes("verify:validation-prereqs -- --apk-path")) return "npm run verify:validation-prereqs -- --apk-path <apk> --manifest-path <manifest> --ios-artifact-path <release-evidence/ios-artifact> --output-path docs/qa-evidence/<date>/validation-prereqs.json";
  if (text.includes("release-evidence\\/validation-prereqs")) return "release-evidence/validation-prereqs.json";
  if (text.includes("diagnostic") && text.includes("verify:release-readiness")) return "Raw packet/inventory-aware `verify:release-readiness` is diagnostic-only outside the final wrapper.";
  if (text.includes("validation-prereqs\\.json")) return "docs/qa-evidence/<date>/validation-prereqs.json";
  if (text.includes("device-validation-evidence\\/device-validation-bundle-verifier")) return "device-validation-evidence/device-validation-bundle-verifier.json";
  if (text.includes("device-validation-bundle-verifier")) return "device-validation-evidence/device-validation-bundle-verifier.json";
  if (text.includes("device-validation")) return "device-validation.yml";
  if (text.includes("downloaded-release\\/release-evidence")) return "downloaded-release/release-evidence/**";
  if (text.includes("VALIDATION_PREREQS_PATH")) return "$DOWNLOADED_RELEASE_DIR/$VALIDATION_PREREQS_PATH";
  if (text.includes("--root")) return "--root \"$DOWNLOADED_RELEASE_DIR\"";
  if (text.includes("--require-validation-prereqs")) return "--require-validation-prereqs true";
  if (text.includes("verify:validation-prereqs")) return "npm run verify:validation-prereqs";
  if (text.includes("verify:release-readiness")) return "npm run verify:release-readiness";
  if (text.includes("verify:release-artifact")) return "npm run verify:release-artifact";
  if (text.includes("android:installed-smoke")) return "npm run android:installed-smoke";
  if (text.includes("android:version-metadata")) return "npm run android:version-metadata";
  if (text.includes("release-evidence:attach-validation-prereqs")) return "npm run release-evidence:attach-validation-prereqs";
  if (text.includes("verify:release-evidence-bundle")) return "npm run verify:release-evidence-bundle";
  if (text.includes("test:coverage")) return "npm run test:coverage";
  if (text.includes("git diff")) return "git diff --check";
  if (text.includes("GSAV_RANGE_PROBE_URL")) return "GSAV_RANGE_PROBE_URL";
  if (text.includes("EXPO_PUBLIC_GSAV_WEB_URL")) return "EXPO_PUBLIC_GSAV_WEB_URL";
  if (text.includes("native catalog")) return "native catalog browse/search/creator surfaces";
  if (text.includes("EXPO_PUBLIC_GSAV_CATALOG_URL")) return "EXPO_PUBLIC_GSAV_CATALOG_URL";
  if (text.includes("EXPO_PUBLIC_GSAV_SUPABASE_URL")) return "EXPO_PUBLIC_GSAV_SUPABASE_URL";
  if (text.includes("EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY")) return "EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY";
  if (text.includes("EXPO_PUBLIC_APP_ENV")) return "EXPO_PUBLIC_APP_ENV";
  if (text.includes("Access-Control-Expose-Headers")) return "Access-Control-Expose-Headers";
  if (text.includes("GSAV-native product")) return "GSAV-native product";
  if (text.includes("Bilibili client surface")) return "Bilibili client surface is frozen legacy";
  if (text.includes("verify:native-production-config")) return "npm run verify:native-production-config";
  if (text.includes("gsav:runtime-smoke")) return "npm run gsav:runtime-smoke";
  if (text.includes("route\\/negative iOS evidence")) return "route/negative iOS evidence may be committed `docs/qa-evidence` files, trusted `docs/qa-evidence` blobs, or direct artifact/download URLs with manifest and checksum proof";
  if (text.includes("externalEvidenceInventoryPath=docs\\/qa-evidence")) {
    return "externalEvidenceInventoryPath=docs/qa-evidence/<date>/external-evidence-inventory.json deviceEvidencePacketPath=<reviewed-packet.json>";
  }
  if (text.includes("docs\\/qa-evidence")) return "docs/qa-evidence/<date>";
  if (text.includes("native mobile app")) return "native mobile app that embeds the GSAV web runtime";
  if (text.includes("10\\.0\\.2\\.2")) return "http://10.0.2.2:5191";
  if (text.includes("host\\s+LAN URL")) return "host LAN URL";
  if (text.includes("GsavWebView")) return "features/player/GsavWebView.tsx";
  if (text.includes("catalog\\/product-surface ownership portions")) return "Supersedes:** Runtime and native catalog/product-surface ownership portions of `0001-gsav-pivot.md`";
  if (text.includes("Keep `\\/explore`")) return "Keep `/explore` as an intentional hosted runtime route";
  if (text.includes("`\\/explore` remains")) return "`/explore` remains an intentional hosted runtime route";
  if (text.includes("product shell, native navigation")) return "React Native owns the product shell, native navigation, browse, search, library, auth, saved/follow, and settings surfaces";
  if (text.includes("Status")) return "Status:** Accepted";
  if (text.includes("Supersedes")) return "Supersedes:** Runtime and native catalog/product-surface ownership portions of `0001-gsav-pivot.md`";
  if (text.includes("React Native owns:")) return "React Native owns:";
  if (text.includes("features\\/scene")) return "features/scene/      shared scene presentation, scene types, share helpers";
  if (text.includes("Architecture Snapshot")) return "## Architecture Snapshot";
  if (text.includes("Route stub map")) return "Route stub map:";
  if (text.includes("Implementation Work Packages")) return "## Implementation Work Packages";
  if (text.includes("Validation Owner Assignment")) return "### Validation Owner Assignment";
  if (text.includes("Current Execution Board")) return "### Current Execution Board (Runbook Appendix)";
  if (text.includes("Canonical Release Evidence Order")) return "### Canonical Release Evidence Order (Superseded Historical Appendix)";
  if (text.includes("Canonical Command Snippets")) return "### Canonical Command Snippets";
  if (text.includes("Detailed Execution Plan")) return "### Detailed Execution Plan (Historical Appendix)";
  if (text.includes("Active External Validation Pass Plan") && text.includes("G7 external review")) {
    return [
      "### Active External Validation Pass Plan",
      "#### Ordered Evidence Gate Sequence",
      "G0 no-publish baseline",
      "G1 local release-candidate health",
      "G2 production host identity",
      "G3 non-publishing release dry run",
      "G4 validation prerequisites and exact APK",
      "G5 generated metadata and installed smoke",
      "G6 Android/iOS route and negative validation",
      "G7 external review and final readiness",
    ].join("\n");
  }
  if (text.includes("Boundary Owner Matrix")) {
    return "### Boundary Owner Matrix\n| Boundary | Owner |\n| React Native shell | native architecture owner |\n| Player embed boundary | player owner |\n| Hosted GSAV runtime | GSAV host owner |\n| Evidence review | evidence reviewer |";
  }
  if (text.includes("G0 prerequisite source evidence")) {
    return "G0 prerequisite source evidence: branch-protection, publish-hash guard, GitHub release-state, pending packet scaffold, validation-prereq blocker, candidate-pinned expected-fail readiness, and no-publish baseline.";
  }
  if (text.includes("workflow readiness has packet\\/inventory path wiring")) {
    return "workflow readiness has packet/inventory path wiring";
  }
  if (text.includes("Release-candidate identity rule")) return "Release-candidate identity rule";
  if (text.includes("release-candidate")) return "release-evidence/release-candidate.txt";
  if (text.includes("GSAV_HOST_IDENTITY_URL")) return "GSAV_HOST_IDENTITY_URL";
  if (text.includes("hostIdentityVerified")) return "hostIdentityVerified=true";
  if (text.includes("hostIdentity\\.url")) return "hostIdentity.url=<metadata URL>";
  if (text.includes("hostIdentity\\.expectedIdentity")) return "hostIdentity.expectedIdentity=<GSAV_HOSTING_COMMIT>";
  if (text.includes("observedIdentity")) return "observedIdentity matched GSAV_HOSTING_COMMIT";
  if (text.includes("GSAV_HOSTING_COMMIT")) return "GSAV_HOSTING_COMMIT";
  if (text.includes("GSAV Host Handoff")) return "## GSAV Host Handoff Contract";
  if (text.includes("gsav-preflight")) return "release-evidence/gsav-preflight.json";
  if (text.includes("--target")) return "--target";
  if (text.includes("--output-path")) return "--output-path";
  if (text.includes("owner placeholders")) return "owner placeholders";
  if (text.includes("Exception policy")) return "Exception policy: exceptions are temporary validation blockers";
  if (text.includes("mismatched exception gates")) return "mismatched exception gates";
  if (text.includes("Publish ceremony")) return "Publish ceremony:";
  if (text.includes("Feature contract ledger")) return "Feature contract ledger for the current sibling allowlist:";
  if (text.includes("observed-signal")) return "required observed-signal, candidate-identity, artifact, range-probe, dry-run, and checksum details";
  if (text.includes("acceptedRisk")) return "expired `acceptedRisk.revisitBy` blocks automatically";
  if (text.includes("@opsiclear/native-release") || text.includes("@opsiclear\\/native-release")) return "@opsiclear/native-release";
  if (text.includes("Release Owner Execution Checklist")) return "### Release Owner Execution Checklist";
  if (text.includes("exact APK")) return "exact APK";
  if (text.includes("human release owner")) return "human release owner";
  if (text.includes("Current Release Blockers")) return "Current Release Blockers";
  if (text.includes("verify-release-readiness")) return "Strengthened `scripts/verify-release-readiness.js`";
  if (text.includes("publish-candidate identity")) return "publish-candidate identity";
  if (text.includes("verify-dependency-audit")) return "Strengthened `scripts/verify-dependency-audit.js`";
  if (text.includes("accepted Expo")) return "accepted Expo/Sentry tooling-chain advisory disposition fails automatically";
  if (text.includes("10 accepted moderate")) return "npm run verify:dependency-audit                         pass, 10 accepted moderate advisories, 0 high, 0 critical";
  if (text.includes("29 pending publish evidence rows")) return "npm run verify:release-readiness failed with 30 checked rows and 29 pending publish evidence rows and 22 pending device packets";
  if (text.includes("Latest Command Summary")) return "## Latest Command Summary";
  if (text.includes("capturesGsavHostIdentity")) return "capturesGsavHostIdentity";
  if (text.includes("scoped fields")) return "scoped fields: `gate`";
  if (text.includes("checksum-manifest")) return "checksum-manifest SHA";
  if (text.includes("Release Target Scope")) return "## Release Target Scope";
  if (text.includes("Android publish readiness")) return "Android publish readiness plus Android and iOS embedded route validation";
  if (text.includes("Android release APK plus Android and iOS embedded")) return "Android release APK plus Android and iOS embedded route behavior";
  if (text.includes("Signed-In Test Account")) return "## Signed-In Test Account";
  if (text.includes("release-owned test account")) return "release-owned test account";
  if (text.includes("redacted")) return "redacted";
  if (text.includes("native-production-config-before-bump")) return "release-evidence/native-production-config-before-bump.json";
  if (text.includes("native-production-config-after-bump")) return "release-evidence/native-production-config-after-bump.json";
  if (text.includes("version\\.txt")) return "release-evidence/version.txt";
  if (text.includes("app-version-metadata")) return "release-evidence/app-version-metadata.json";
  if (text.includes("gradle-version-code")) return "release-evidence/gradle-version-code.txt";
  if (text.includes("release-artifact")) return "release-evidence/release-artifact.json";
  if (text.includes("apk-version-metadata")) return "release-evidence/apk-version-metadata.txt";
  if (text.includes("dry-run-summary")) return "release-evidence/dry-run-summary.json";
  if (text.includes("evidence-checksums")) return "release-evidence/evidence-checksums.txt";
  if (text.includes("no-publish-side-effect")) return "release-evidence/no-publish-side-effect.txt";
  if (text.includes("--apk-path")) return "--root \"$DOWNLOADED_RELEASE_DIR\" --apk-path \"$APK_PATH\" --manifest-path \"$MANIFEST_PATH\" --ios-artifact-path \"$IOS_VALIDATION_ARTIFACT_PATH\" --output-path \"$VALIDATION_PREREQS_PATH\"";
  if (text.includes("ios_validation_owner")) return "ios_validation_owner";
  if (text.includes("ios_validation_executor_proof")) return "ios_validation_executor_proof";
  if (text.includes("ios_validation_device")) return "ios_validation_device";
  if (text.includes("ios_validation_version")) return "ios_validation_version";
  if (text.includes("ios_wkwebview_version")) return "ios_wkwebview_version";
  if (text.includes("ios_validation_artifact_url")) return "ios_validation_artifact_url";
  if (text.includes("ios_validation_artifact_sha256")) return "ios_validation_artifact_sha256";
  if (text.includes("IOS_VALIDATION_ARTIFACT_URL")) return "IOS_VALIDATION_ARTIFACT_URL";
  if (text.includes("IOS_VALIDATION_ARTIFACT_SHA256")) return "IOS_VALIDATION_ARTIFACT_SHA256";
  if (text.includes("trusted direct artifact\\/download\\/blob URL and 64-hex SHA256")) return "trusted direct artifact/download/blob URL and 64-hex SHA256";
  if (text.includes("trusted artifact URL and 64-hex SHA256")) return "trusted artifact URL and 64-hex SHA256";
  if (text.includes("trusted iOS artifact URL")) return "trusted iOS artifact URL";
  if (text.includes("64-hex iOS artifact SHA256")) return "64-hex iOS artifact SHA256";
  if (text.includes("executor proof")) return "executor proof";
  if (text.includes("device identity")) return "device identity";
  if (text.includes("iOS version")) return "iOS version";
  if (text.includes("connected `adb devices` proof")) return "connected `adb devices` proof";
  if (text.includes("adb devices")) return "adb devices has at least one device in device state";
  if (text.includes("GitHub CLI")) return "GitHub CLI";
  if (text.includes("generated APK metadata tooling")) return "generated APK metadata tooling";
  if (text.includes("generated APK metadata tool")) return "generated APK metadata tool";
  if (text.includes("aapt")) return "aapt apkanalyzer bundletool";
  if (text.includes("iOS validation owner")) return "iOS validation owner";
  if (text.includes("macOS\\/Xcode") || text.includes("physical iOS-device proof")) return "macOS/Xcode/`xcrun` or physical iOS-device proof";
  if (text.includes("physical-device proof")) return "macOS/Xcode/`xcrun` or physical-device proof";
  if (text.includes("WKWebView\\/WebKit") || text.includes("iOS WKWebView version")) return "WKWebView/WebKit version";
  if (text.includes("Evidence path cell")) return "Evidence path cell must contain only accepted paths or URLs";
  if (text.includes("Operator execution sequence")) {
    return "Operator execution sequence: three-agent review keeps the React Native product shell plus single player embed boundary; never promote a publish row from local-only evidence; G0/G1 local baseline; G3 dry-run artifact; G6 device/product validation; G7 final receipts; noPublishRehearsal=false.";
  }
  if (text.includes("Three-agent implementation-structure review")) return "Three-agent implementation-structure review";
  if (text.includes("signed-in test-account hygiene")) return "signed-in test-account hygiene";
  if (text.includes("Validation executor readiness")) return "Validation executor readiness";
  if (text.includes("Evidence artifact review signoff")) return "Evidence artifact review signoff";
  if (text.includes("Branch-protection governance")) return "Branch-protection governance";
  if (text.includes("Master branch protection")) return "Master branch protection";
  if (text.includes("Branch protection")) return "Branch protection";
  if (text.includes("quality\\s*\\/\\s*quality")) return "quality / quality";
  if (text.includes("evidence artifact review signoff")) return "evidence artifact review signoff";
  if (text.includes("artifact-review signoff")) return "artifact-review signoff";
  if (text.includes("artifact review signoff")) return "artifact review signoff";
  if (text.includes("reviewed timestamp") || text.includes("reviewedAt")) return "reviewed timestamp";
  if (text.includes("GitHub run conclusion")) return "GitHub run conclusion";
  if (text.includes("downloaded checksum-manifest")) return "downloaded checksum-manifest SHA256";
  if (text.includes("downloaded (?:bundle|artifact)") || text.includes("exact downloaded bundle") || text.includes("bundle-verifier rerun")) return "verify:release-evidence-bundle rerun against the downloaded bundle";
  if (text.includes("Negative Fixture Ownership")) return "## Negative Fixture Ownership";
  if (text.includes("Work Package Map")) return "### Work Package Map";
  if (text.includes("WP-1 architecture contract")) return "WP-1 architecture contract";
  if (text.includes("WP-8 publish readiness")) return "WP-8 publish readiness";
  if (text.includes("QA fixture controls")) return "QA fixture controls are platform-scoped";
  if (text.includes("iframe host has no native overlay")) return "ignores it because the iframe host has no native overlay controls";
  if (text.includes("allowed catalog facade")) return "services/gsav.ts is the allowed catalog facade";
  if (text.includes("Release Evidence Bundle File List")) return "### Release Evidence Bundle File List";
  if (text.includes("RELEASE_EVIDENCE_MODE")) return "RELEASE_EVIDENCE_MODE";
  if (text.includes("iOS dispatch inputs")) return "iOS dispatch inputs";
  if (text.includes("iOS validation inputs")) return "iOS validation inputs";
  if (text.includes("candidate\\/version\\/identity")) return "candidate/version/identity/preflight/runtime/artifact/metadata/no-publish-summary/bundle/publish-artifact-identity/upload/readiness/release order";
  throw new Error(`No marker mapping for ${text}`);
}

const qaNegativeFixtureInventory = `${docMarkers("docs/GSAV_NATIVE_QA.md")}
| Case | Exact trigger to use | Expected signal | Fixture status |
| --- | --- | --- | --- |
| Missing host config | Launch without config | Native configuration/error UI | Available through app config |
| Host offline/retry | Stop host and tap retry | Error/retry UI recovers | Available through host control |
| Cross-origin navigation | Tap Cross-origin in diagnostics QA controls | Navigation blocked | Available through diveo diagnostics QA controls |
| Auth initialization gate | Build with EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000 and mount an embedded route | No clear-session bridge message before auth initialization completes | Available through diveo auth delay QA flag |

## Negative Fixture Backlog

| Case | Target owner/repo | Required fixture shape | Acceptance criteria before device QA |
| --- | --- | --- | --- |
`;

const auditNegativeFixtureOwnership = `${docMarkers(
  "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
  (text) => text.includes("Negative Fixture Ownership"),
)}
## Negative Fixture Ownership
| Negative case | Current trigger status | Owner | Next action |
| --- | --- | --- | --- |
| Missing host config | Available through app config | native release owner | Capture evidence |
| Host offline/retry | Available through host control | native release owner | Capture evidence |
| Cross-origin navigation | Available through diveo diagnostics QA controls | native release owner | Capture evidence |
| Auth initialization gate | Available through EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000 | native release owner | Capture evidence |
`;

describe("docs drift verifier", () => {
  it("accepts active docs with required architecture and gate markers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root);

    const result = analyzeDocDrift(root);

    expect(result.checkedSupersededFiles).toEqual([]);
    expect(result.checkedFiles).toEqual(Object.keys(activeDocs));
    expect(result.checkedFiles).toHaveLength(10);
    expect(result.checkedFiles).toContain(".env.example");
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects audit docs that omit final signoff or external review ledger sections", () => {
    const missingSignoffRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(missingSignoffRoot, {
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers("docs/IMPLEMENTATION_VALIDATION_AUDIT.md")
        .replace(/\n## Final Publish Signoff[\s\S]*?(?=\n## Latest Command Summary)/, "\n"),
    });

    const missingLedgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(missingLedgerRoot, {
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers("docs/IMPLEMENTATION_VALIDATION_AUDIT.md")
        .replace(/\n## External Evidence Review Ledger[\s\S]*?(?=\n## Final Publish Signoff)/, "\n"),
    });

    expect(analyzeDocDrift(missingSignoffRoot).errors).toContain(
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing section ## Final Publish Signoff.",
    );
    expect(analyzeDocDrift(missingLedgerRoot).errors).toContain(
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing section ## External Evidence Review Ledger.",
    );
  });

  it("rejects audit docs that omit the external replay staging hardening row", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("audit external evidence replay staging row"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker")
      && error.includes("External evidence inventory replay staging hardening")
      && error.includes("docs/qa-evidence/<date>/external/<sourceRunId>/<sourceArtifactId>/")
      && error.includes("decision=no-publish")
    ))).toBe(true);
  });

  it("rejects final signoff docs that omit current release scope fields", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers("docs/IMPLEMENTATION_VALIDATION_AUDIT.md")
        .replace("publishScope=android-apk-only; iosDistributionDecision=no-publish;\n", ""),
    });

    const result = analyzeDocDrift(root);

    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Final Publish Signoff is missing required marker /publishScope=android-apk-only/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Final Publish Signoff is missing required marker /iosDistributionDecision=no-publish/.",
    ]));
  });

  it("rejects final signoff docs that omit last-mile prepublish evidence details", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers("docs/IMPLEMENTATION_VALIDATION_AUDIT.md")
        .replace("lastMileReleaseStateEvidence=docs/qa-evidence/<date>/github-release-state-prepublish.json\n", "")
        .replace("lastMilePublishHashGuardEvidence=docs/qa-evidence/<date>/publish-hash-variable-guard-prepublish.json\n", "")
        .replace(/The release-state JSON must show[\s\S]*?`EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256` absent\.\n/, ""),
    });

    const result = analyzeDocDrift(root);

    expect(result.errors.some((error) => error.includes("github-release-state-prepublish"))).toBe(true);
    expect(result.errors.some((error) => error.includes("publish-hash-variable-guard-prepublish"))).toBe(true);
    expect(result.errors.some((error) => error.includes("workflow_dispatch"))).toBe(true);
    expect(result.errors.some((error) => error.includes("EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256"))).toBe(true);
  });

  it("rejects docs that omit final receipt live last-mile path binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitLivePathBinding = (text) => text.includes("final receipt last-mile live path binding");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitLivePathBinding),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitLivePathBinding,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitLivePathBinding,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt last-mile live path binding")
        && error.includes("inputs.lastMileReleaseStateLivePath")
        && error.includes("inputs.lastMilePublishHashGuardLivePath")
        && error.includes("finalCommandReceiptsPath evidence date")
        && error.includes("--output-path")
    ))).toBe(true);
  });

  it("rejects docs that omit final receipt last-mile review binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitReviewBinding = (text) => text.includes("final receipt last-mile review binding");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitReviewBinding),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitReviewBinding,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitReviewBinding,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt last-mile review binding")
        && error.includes("inputs.repository")
        && error.includes("--reviewed-at")
        && error.includes("trusted Diveo repository")
    ))).toBe(true);
  });

  it("rejects docs that omit final receipt summary timing binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitTimingBinding = (text) => text.includes("final receipt summary timing binding");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitTimingBinding),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitTimingBinding,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitTimingBinding,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt summary timing binding")
        && error.includes("startedAt")
        && error.includes("finishedAt")
        && error.includes("final evidence date")
    ))).toBe(true);
  });

  it("rejects docs that omit final receipt pass-summary contradiction binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitContradictionBinding = (text) => text.includes("final receipt pass-summary contradiction binding");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitContradictionBinding),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitContradictionBinding,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitContradictionBinding,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt pass-summary contradiction binding")
        && error.includes("status=pass")
        && error.includes("failedStep")
        && error.includes("outputProblems")
    ))).toBe(true);
  });

  it("rejects docs that omit final receipt runUrl repository binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitRunUrlRepositoryBinding = (text) => text.includes("final receipt runUrl repository binding");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitRunUrlRepositoryBinding),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitRunUrlRepositoryBinding,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitRunUrlRepositoryBinding,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt runUrl repository binding")
        && error.includes("inputs.repository")
        && error.includes("audit runUrl repository")
        && error.includes("same trusted Diveo repository")
    ))).toBe(true);
  });

  it("rejects docs that omit final receipt publish-hash query repository binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitPublishHashQueryRepositoryBinding = (text) => text.includes("final receipt publish-hash query repository binding");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitPublishHashQueryRepositoryBinding),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitPublishHashQueryRepositoryBinding,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitPublishHashQueryRepositoryBinding,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt publish-hash query repository binding")
        && error.includes("variableQueries[].command")
        && error.includes("--repo")
        && error.includes("final command receipt summary repository")
    ))).toBe(true);
  });

  it("rejects docs that omit final receipt release-state query repository binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitReleaseStateQueryRepositoryBinding = (text) => text.includes("final receipt release-state query repository binding");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitReleaseStateQueryRepositoryBinding),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitReleaseStateQueryRepositoryBinding,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitReleaseStateQueryRepositoryBinding,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt release-state query repository binding")
        && error.includes("workflows")
        && error.includes("releaseRuns")
        && error.includes("final command receipt summary repository")
    ))).toBe(true);
  });

  it("rejects docs that omit final receipt live last-mile JSON binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitLiveLastMileJsonBinding = (text) => text.includes("final receipt live last-mile JSON binding");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitLiveLastMileJsonBinding),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitLiveLastMileJsonBinding,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitLiveLastMileJsonBinding,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt live last-mile JSON binding")
        && error.includes("inputs.lastMileReleaseStateLivePath")
        && error.includes("valid JSON")
        && error.includes("releaseReadinessImpact")
    ))).toBe(true);
  });

  it("rejects docs that omit final receipt live output creation binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitLiveOutputCreationBinding = (text) => text.includes("final receipt live output creation binding");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitLiveOutputCreationBinding),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitLiveOutputCreationBinding,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitLiveOutputCreationBinding,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt live output creation binding")
        && error.includes("Last-mile GitHub release-state evidence")
        && error.includes("outputProblems")
    ))).toBe(true);
  });

  it("rejects docs that omit final receipt step-log byte replay", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitStepLogReplay = (text) => text.includes("final receipt step-log byte replay");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitStepLogReplay),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitStepLogReplay,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitStepLogReplay,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt step-log byte replay")
        && error.includes("stdoutPath")
        && error.includes("combinedSha256")
    ))).toBe(true);
  });

  it("rejects docs that omit the final receipt wrapper step set", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitStepSet = (text) => text.includes("final receipt wrapper step set");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitStepSet),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitStepSet,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitStepSet,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt wrapper step set")
        && error.includes("Documentation drift audit")
        && error.includes("Final release readiness")
    ))).toBe(true);
  });

  it("rejects docs that omit final receipt wrapper step status", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitStepStatus = (text) => text.includes("final receipt wrapper step status");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitStepStatus),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitStepStatus,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitStepStatus,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt wrapper step status")
        && error.includes("expectedStatus=0")
        && error.includes("status=0")
    ))).toBe(true);
  });

  it("rejects docs that omit final receipt readiness env binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitReadinessEnv = (text) => text.includes("final receipt Final release readiness env binding");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitReadinessEnv),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitReadinessEnv,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitReadinessEnv,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt Final release readiness env binding")
        && error.includes("FINAL_READINESS_RECEIPT_BOOTSTRAP")
        && error.includes("finalCommandReceiptsPath")
    ))).toBe(true);
  });

  it("rejects docs that omit final receipt internal command binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitInternalCommandBinding = (text) => text.includes("final receipt internal command binding");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitInternalCommandBinding),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitInternalCommandBinding,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitInternalCommandBinding,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.includes("final receipt internal command binding")
        && error.includes("focused tests")
        && error.includes("protected candidate")
    ))).toBe(true);
  });

  it("rejects stale current release-readiness and device-packet counts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md")
        .replaceAll("30 checked rows", "31 checked rows"),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers("docs/IMPLEMENTATION_VALIDATION_AUDIT.md")
        .replaceAll("22 pending device packets", "23 pending device packets"),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md must summarize current release-readiness count as 30 checked rows.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md must summarize current device packet count as 22 pending device packets.",
    ]));
  });

  it("rejects evidence docs that omit the fixed Evidence Log row-set contract", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitFixedRowSet = (text) => text.includes("fixed\\s+row\\s+set")
      || text.includes("30\\s+publish-readiness")
      || text.includes("Host\\s+preflight");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitFixedRowSet),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md", omitFixedRowSet),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("30\\s+publish-readiness")
        && error.includes("Host\\s+preflight")
        && error.includes("GSAV\\s+target\\s+routes")
      ))).toBe(true);
    }
  });

  it("rejects an implementation plan that omits the current execution snapshot front door", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("Current Execution Snapshot"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("Current Execution Snapshot")
      && error.includes("verify:final-readiness-receipts")
      && error.includes("product-journey-manifest")
    ))).toBe(true);
  });

  it("rejects an implementation plan that omits active final receipt publish-ready proof", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("publishSignoffReady") || text.includes("Protected candidate ancestry proof"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("publishSignoffReady")
      && error.includes("noPublishRehearsal")
      && error.includes("expected-readiness-fail")
    ))).toBe(true);
  });

  it("rejects docs that omit required product journey manifest IDs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      writeDocs(root, {
        [file]: docMarkers(
          file,
          (text) => text.includes("first-launch-home") || text.includes("accessibility-ergonomics"),
        ),
      });
      const result = analyzeDocDrift(root);

      expect(result.ok).toBe(false);
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("product-journey-manifest")
        && error.includes("first-launch-home")
        && error.includes("degraded-blocked-states")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit product journey evidence-path inventory expansion", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitProductJourneyInventoryExpansion = (text) => (
      text.includes("product-journey-manifest")
      && text.includes("evidencePaths")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitProductJourneyInventoryExpansion,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitProductJourneyInventoryExpansion,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("product-journey-manifest")
        && error.includes("evidencePaths")
        && error.includes("byte-hashed")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit distinct product journey platform evidence paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitDistinctProductJourneyEvidence = (text) => (
      text.includes("product-journey-manifest")
      && text.includes("distinct Android")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitDistinctProductJourneyEvidence,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitDistinctProductJourneyEvidence,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("product-journey-manifest")
        && error.includes("distinct Android")
        && error.includes("evidence")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit unique product journey manifest entry IDs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitUniqueProductJourneyIds = (text) => (
      text.includes("product-journey-manifest")
      && text.includes("unique")
      && text.includes("entry IDs")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitUniqueProductJourneyIds,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitUniqueProductJourneyIds,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("product-journey-manifest")
        && error.includes("unique")
        && error.includes("entry IDs")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit inventory replay product journey entry ID rejection", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitProductJourneyInventoryEntryIdReplay = (text) => (
      text.includes("Inventory replay")
      && text.includes("duplicate")
      && text.includes("product journey entry IDs")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitProductJourneyInventoryEntryIdReplay,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitProductJourneyInventoryEntryIdReplay,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("Inventory replay")
        && error.includes("duplicate")
        && error.includes("product journey entry IDs")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit product journey inventory expansion validity", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitProductJourneyExpansionValidity = (text) => (
      text.includes("product-journey-manifest")
      && text.includes("valid JSON")
      && text.includes("entries array")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitProductJourneyExpansionValidity,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitProductJourneyExpansionValidity,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("product-journey-manifest")
        && error.includes("valid JSON")
        && error.includes("entries array")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit product journey inventory classification", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitProductJourneyInventoryClassification = (text) => (
      text.includes("product-journey-manifest")
      && text.includes("reviewed inventory")
      && text.includes("artifactPurpose=product-journey-manifest")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitProductJourneyInventoryClassification,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitProductJourneyInventoryClassification,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("product-journey-manifest")
        && error.includes("artifactPurpose=product-journey-manifest")
        && error.includes("helperOnly=false")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit route/negative manifest source identity replay", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitRouteNegativeManifestContentClassification = (text) => (
      text.includes("route/negative manifest content classification")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitRouteNegativeManifestContentClassification,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitRouteNegativeManifestContentClassification,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("route/negative manifest content classification")
        && error.includes("sourceRunId")
        && error.includes("sourceArtifactId")
        && error.includes("artifact URL")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit route/negative same-date manifest replay", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitRouteNegativeSameDateManifestReplay = (text) => (
      text.includes("route/negative manifest same-date replay")
      || (
        text.includes("stale route or negative manifests")
        && text.includes("inventory evidence date")
      )
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitRouteNegativeSameDateManifestReplay,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitRouteNegativeSameDateManifestReplay,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("route/negative manifest same-date replay")
        && error.includes("manifestPath")
        && error.includes("evidenceManifestPath")
        && error.includes("another evidence date")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit packet-local same-date evidence replay", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitPacketLocalSameDateReplay = (text) => (
      text.includes("packet local evidence same-date replay")
      || (
        text.includes("actual.evidencePaths")
        && text.includes("actual.evidenceManifestPath")
        && text.includes("stale local route or negative packet evidence")
      )
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitPacketLocalSameDateReplay,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitPacketLocalSameDateReplay,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitPacketLocalSameDateReplay,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("packet local evidence same-date replay")
        && error.includes("actual.evidencePaths")
        && error.includes("actual.evidenceManifestPath")
        && error.includes("another evidence date")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit product journey manifest content classification", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitProductJourneyManifestContentClassification = (text) => (
      text.includes("product-journey-manifest")
      && text.includes("manifest contents")
      && text.includes("artifactPurpose=product-journey-manifest")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitProductJourneyManifestContentClassification,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitProductJourneyManifestContentClassification,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("product-journey-manifest")
        && error.includes("manifest contents")
        && error.includes("artifactPurpose=product-journey-manifest")
        && error.includes("helperOnly=false")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit product journey fixture inventory replay", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitProductJourneyFixtureInventory = (text) => (
      text.includes("fixtureManifestPath")
      && text.includes("artifactPurpose=fixture-manifest")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitProductJourneyFixtureInventory,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitProductJourneyFixtureInventory,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("fixtureManifestPath")
        && error.includes("artifactPurpose=fixture-manifest")
        && error.includes("helperOnly=false")
        && error.includes("fixtureManifestSha256")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit product journey fixture manifest content replay", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitProductJourneyFixtureContentReplay = (text) => (
      text.includes("fixture-manifest")
      && text.includes("fixture manifest")
      && text.includes("contents")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitProductJourneyFixtureContentReplay,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitProductJourneyFixtureContentReplay,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("fixture-manifest")
        && error.includes("fixture manifest")
        && error.includes("contents")
        && error.includes("artifactPurpose=fixture-manifest")
        && error.includes("helperOnly=false")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit product journey same-date inventory replay", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitProductJourneySameDateReplay = (text) => (
      text.includes("same docs/qa-evidence/<date>/ folder")
      && text.includes("stale local fixture")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitProductJourneySameDateReplay,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitProductJourneySameDateReplay,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("product journey inventory same-date replay")
        && error.includes("product-journey-manifest")
        && error.includes("stale local fixture")
        && error.includes("another evidence date")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit product journey linked evidence classification", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitProductJourneyLinkedEvidenceClassification = (text) => (
      text.includes("product-journey-manifest")
      && text.includes("product-journey-evidence")
      && text.includes("journeyEntryId")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitProductJourneyLinkedEvidenceClassification,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitProductJourneyLinkedEvidenceClassification,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("product-journey-manifest")
        && error.includes("artifactPurpose=product-journey-evidence")
        && error.includes("helperOnly=false")
        && error.includes("journeyEntryId")
        && error.includes("mediaSha256")
        && error.includes("fileSha256")
        && error.includes("sourceRunId")
        && error.includes("sourceArtifactId")
        && error.includes("evidence URL")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit product journey scaffold hints", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitProductJourneyScaffoldHints = (text) => (
      text.includes("product journey external evidence scaffold hints")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitProductJourneyScaffoldHints,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitProductJourneyScaffoldHints,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("product journey external evidence scaffold hints")
        && error.includes("productJourneyExpectedSha256Field")
        && error.includes("productJourneyExpectedSha256")
        && error.includes("productJourneySourceRunId")
        && error.includes("productJourneySourceArtifactId")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit product journey semantic observed signals", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitProductJourneySemanticSignals = (text) => (
      text.includes("product-journey-manifest")
      && text.includes("observedSignals")
      && text.includes("keyboard-visible native Login UI")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitProductJourneySemanticSignals,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitProductJourneySemanticSignals,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("product-journey-manifest")
        && error.includes("observedSignals")
        && error.includes("native Home feed state")
        && error.includes("keyboard-visible native Login UI")
        && error.includes("no blank WebView")
      ))).toBe(true);
    }
  });

  it("rejects docs that omit product journey Explore restraint criteria", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitProductJourneyExploreRestraint = (text) => (
      text.includes("product-journey-manifest Explore restraint")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitProductJourneyExploreRestraint,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitProductJourneyExploreRestraint,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("Explore restraint")
        && error.includes("secondary/runtime-scoped action")
        && error.includes("hidden hosted public/account chrome")
        && error.includes("same-origin hosted product routes")
      ))).toBe(true);
    }
  });

  it("rejects an implementation plan that omits the focused player verification matrix", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const weakPlan = docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md")
      .replace(
        /### Focused Player Verification Matrix[\s\S]*?scripts\/gsav-native-preflight\.test\.mjs\n?/,
        "",
      );
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": weakPlan,
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("Focused Player Verification Matrix")
      && error.includes("useGsavEmbedHost")
      && error.includes("gsav-native-preflight")
    ))).toBe(true);
  });

  it("rejects an implementation plan that omits the G0 handoff blocker receipt command", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("handoff-receipts blocker") || text.includes("handoff-receipts-blocker"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("handoff-receipts")
      && error.includes("no-publish baseline")
    ))).toBe(true);
  });

  it("rejects an implementation plan that omits iOS artifact materialization from active validation commands", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("materialize-ios-validation-artifact"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("materialize-ios-validation-artifact")
    ))).toBe(true);
  });

  it("rejects an implementation plan that omits the catalog composition boundary guard", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitCatalogCompositionBoundary = (text) => text.includes("Scene composition boundary")
      || text.includes("direct catalog-composition guard");
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitCatalogCompositionBoundary,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("Scene composition boundary")
      && error.includes("direct catalog-composition guard")
    ))).toBe(true);
  });

  it("rejects an implementation plan that omits the native WebView route-gate contract", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitNativeWebViewRouteGate = (text) => text.includes("Native WebView route gate")
      || text.includes("Navigation blocked");
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitNativeWebViewRouteGate,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("Native WebView route gate")
      && error.includes("Navigation blocked")
    ))).toBe(true);
  });

  it("rejects docs that omit the same-origin fail-closed release policy", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitSameOriginFailClosedPolicy = (text) => text.includes("future native handoff requires ADR 0002");
    writeDocs(root, {
      "docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md": docMarkers(
        "docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md",
        omitSameOriginFailClosedPolicy,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitSameOriginFailClosedPolicy,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("future native handoff requires ADR 0002")
        && error.includes("features\\/player\\/nativeNavigation")
        && error.includes("no-publish pass")
      ))).toBe(true);
    }
  });

  it("rejects QA docs that omit same-origin native-owned fail-closed evidence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("same-origin native-owned hosted product paths fail closed"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_QA.md is missing required marker")
      && error.includes("same-origin native-owned hosted product paths fail closed")
      && error.includes("Navigation blocked")
      && error.includes("for this release")
    ))).toBe(true);
  });

  it("rejects docs that omit the implemented ContinueWatchingPill cleanup contract", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitContinueWatchingDebt = (text) => text.includes("ContinueWatchingPill")
      && text.includes("resumeAccess");
    writeDocs(root, {
      "docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md": docMarkers(
        "docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md",
        omitContinueWatchingDebt,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitContinueWatchingDebt,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("ContinueWatchingPill")
        && error.includes("resumeAccess")
        && error.includes("resume state")
      ))).toBe(true);
    }
  });

  it("rejects an implementation plan that omits the target module structure", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("target module structure"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("target module structure")
      && error.includes("ContinueWatchingPill")
      && error.includes("features/player")
    ))).toBe(true);
  });

  it("rejects an implementation plan that omits public contracts and the post-release elegance target", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("public contract inventory") || text.includes("post-release elegance target"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("public contract inventory")
      && error.includes("resumeAccess")
      && error.includes("authSession")
    ))).toBe(true);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("post-release elegance target")
      && error.includes("sibling allowlist")
      && error.includes("product-journey evidence")
    ))).toBe(true);
  });

  it("rejects an implementation plan that omits active G6 and G7 command handoffs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("active G6/G7 command handoff"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("active G6/G7 command handoff")
      && error.includes("device-evidence-packet-candidate")
      && error.includes("--strict-final-inputs")
    ))).toBe(true);
  });

  it("rejects historical implementation phases that lose local-rehearsal labels", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md")
        .replaceAll("(Historical Appendix / Local Rehearsal Only)", "(Historical Appendix)"),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("Phase 1 - Preserve The Baseline")
      && error.includes("Phase 8 - Refine The Dependency Graph")
      && error.includes("Local Rehearsal Only")
    ))).toBe(true);
  });

  it("rejects an implementation plan that omits the detailed verification and validation promotion contracts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omittedMarkers = [
      "Active read path",
      "Detailed Implementation Roadmap",
      "Release Structure Lock",
      "Operator execution sequence",
      "G7 passes only",
      "Final evidence filename map",
      "Validation promotion map",
      "Reviewed device packet minimum schema",
      "Negative trigger matrix",
      "External artifact review procedure",
      "Evidence invalidation rules",
    ];

    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => omittedMarkers.some((marker) => text.includes(marker)),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const marker of omittedMarkers) {
      expect(result.errors.some((error) => (
        error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
        && error.includes(marker)
      ))).toBe(true);
    }
  });

  it("rejects implementation-plan invalidation rules that omit concrete rerun actions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md")
        .replace("Return G3-G5 rows to pending\n", "")
        .replace("Mark rows stale\n", "")
        .replace("repeat the affected gate", "review the affected gate"),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("Evidence invalidation rules")
      && error.includes("return rows pending")
      && error.includes("repeat affected gate")
    ))).toBe(true);
  });

  it("rejects docs that omit remote Device Validation workflow state evidence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitRemoteDeviceValidationState = (text) => text.includes("deviceValidationWorkflowPresent");
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitRemoteDeviceValidationState),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md", omitRemoteDeviceValidationState),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers("docs/IMPLEMENTATION_VALIDATION_AUDIT.md", omitRemoteDeviceValidationState),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("deviceValidationWorkflowPresent")
      ))).toBe(true);
    }
  });

  it("rejects an implementation plan that omits the active G0-G7 evidence sequence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("Active External Validation Pass Plan") && text.includes("G7 external review"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /(?=[\\s\\S]*### Active External Validation Pass Plan)"),
    ]));
  });

  it("rejects an active G7 gate card that omits strict inventory replay paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("Active Gate Cards") && text.includes("verify:external-evidence-inventory"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => (
      error.startsWith("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker")
      && error.includes("Active Gate Cards")
      && error.includes("verify:external-evidence-inventory")
      && error.includes("--require-git-integrity")
    ))).toBe(true);
  });

  it("rejects implementation-plan order appendices that lose appendix labels", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md")
        .replace("### Current Execution Board (Runbook Appendix)", "### Current Execution Board")
        .replace("### Canonical Release Evidence Order (Superseded Historical Appendix)", "### Canonical Release Evidence Order")
        .replace("### Detailed Execution Plan (Historical Appendix)", "### Detailed Execution Plan")
        .replaceAll("### Release Owner Execution Checklist (Historical Appendix)", "### Release Owner Execution Checklist"),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /### Current Execution Board \\(Runbook Appendix\\)/.",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /### Canonical Release Evidence Order \\(Superseded Historical Appendix\\)/.",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /### Detailed Execution Plan \\(Historical Appendix\\)/.",
      expect.stringContaining("Release Owner Execution Checklist"),
    ]));
  });

  it("rejects route stub map drift from the import-boundary owner map", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md")
        .replace("features/catalog/SearchScreen.tsx", "features/catalog/HomeScreen.tsx"),
    });

    expect(routeStubMapErrors(root)).toContain(
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route stub map app/search.tsx must point to features/catalog/SearchScreen.tsx, not features/catalog/HomeScreen.tsx.",
    );
    expect(analyzeDocDrift(root).ok).toBe(false);
  });

  it("rejects route presentation register drift from AppStack defaults", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md")
        .replace(
          "| `app/library` | Intentional Expo Router default stack behavior |",
          "| `app/library` | Explicit `AppStack` screen with slide transition |",
        ),
    });

    expect(routePresentationRegisterErrors(root)).toContain(
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route presentation register app/library must describe intentional Expo Router default stack behavior.",
    );
    expect(analyzeDocDrift(root).ok).toBe(false);
  });

  it("rejects AppStack screens that are documented as Expo Router defaults", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "features/app-shell/AppStack.tsx": `${appStackFixture()}
        <Stack.Screen name="library" />
      `,
    });

    expect(routePresentationRegisterErrors(root)).toContain(
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route presentation register app/library must describe explicit AppStack presentation for screen library.",
    );
    expect(analyzeDocDrift(root).ok).toBe(false);
  });

  it("rejects AppStack screens that are not represented by any route", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "features/app-shell/AppStack.tsx": `${appStackFixture()}
        <Stack.Screen name="admin" />
      `,
    });

    expect(routePresentationRegisterErrors(root)).toContain(
      "features/app-shell/AppStack.tsx screen admin must have an explicit route presentation register entry.",
    );
    expect(analyzeDocDrift(root).ok).toBe(false);
  });

  it("rejects missing required markers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "README.md": "React Native owns the mobile product shell\n",
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("README.md is missing required marker"),
    ]));
  });

  it("rejects PR templates that omit release validation gates", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      ".github/PULL_REQUEST_TEMPLATE.md": docMarkers(
        ".github/PULL_REQUEST_TEMPLATE.md",
        (text) => (
          text.includes("npm ci")
          || text.includes("GSAV_RANGE_PROBE_URL")
          || text.includes("verify:local")
          || text.includes("verify:release-candidate")
          || text.includes("verify:release-artifact")
          || text.includes("android:installed-smoke")
          || text.includes("android:version-metadata")
          || text.includes("expected-version-code")
          || text.includes("production-host-url")
          || text.includes("productionHostReleaseReady")
          || text.includes("verify:release-evidence-bundle")
        ),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      ".github/PULL_REQUEST_TEMPLATE.md is missing required marker /npm ci/.",
      ".github/PULL_REQUEST_TEMPLATE.md is missing required marker /GSAV_RANGE_PROBE_URL/.",
      ".github/PULL_REQUEST_TEMPLATE.md is missing required marker /npm run verify:local/.",
      ".github/PULL_REQUEST_TEMPLATE.md is missing required marker /npm run verify:release-candidate/.",
      ".github/PULL_REQUEST_TEMPLATE.md is missing required marker /npm run verify:release-artifact/.",
      ".github/PULL_REQUEST_TEMPLATE.md is missing required marker /npm run android:installed-smoke/.",
      ".github/PULL_REQUEST_TEMPLATE.md is missing required marker /--production-host-url/.",
      ".github/PULL_REQUEST_TEMPLATE.md is missing required marker /productionHostReleaseReady=true/.",
      ".github/PULL_REQUEST_TEMPLATE.md is missing required marker /npm run android:version-metadata/.",
      ".github/PULL_REQUEST_TEMPLATE.md is missing required marker /--expected-version-code/.",
      ".github/PULL_REQUEST_TEMPLATE.md is missing required marker /npm run verify:release-evidence-bundle/.",
    ]));
  });

  it("rejects stale architecture shorthand in env examples", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      ".env.example": `${docMarkers(".env.example")}
# diveo catalog API (World B native browse)
`,
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(".env.example contains stale marker /World A|World B|Plan B/.");
  });

  it("rejects missing QA negative fixture inventory markers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", (text) => (
        text.includes("Negative Fixture Inventory") || text.includes("Owner-blocked until")
        || text.includes("EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS")
      )),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/GSAV_NATIVE_QA.md is missing required marker /## Negative Fixture Inventory/.",
      "docs/GSAV_NATIVE_QA.md is missing required marker /EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS/.",
    ]));
  });

  it("rejects missing audit negative fixture ownership markers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => (
          text.includes("Negative Fixture Ownership")
          || text.includes("tap `Unsupported`")
          || text.includes("EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS")
        ),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /## Negative Fixture Ownership/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /tap `Unsupported`/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS/.",
    ]));
  });

  it("rejects shell architecture docs without Android emulator URL guidance", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md": docMarkers(
        "docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md",
        (text) => text.includes("10\\.0\\.2\\.2") || text.includes("host\\s+LAN URL"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md is missing required marker /http:\\/\\/10\\.0\\.2\\.2:5191/.",
      "docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md is missing required marker /host\\s+LAN URL/.",
    ]));
  });

  it("rejects ADR boundary validation docs that omit enforced gates", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/adr/0002-native-app-with-web-player.md": docMarkers(
        "docs/adr/0002-native-app-with-web-player.md",
        (text) => (
          text.includes("verify:import-boundaries")
          || text.includes("verify:docs-drift")
          || text.includes("verify:release-readiness")
        ),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/adr/0002-native-app-with-web-player.md is missing required marker /npm run verify:import-boundaries/.",
      "docs/adr/0002-native-app-with-web-player.md is missing required marker /npm run verify:docs-drift/.",
      "docs/adr/0002-native-app-with-web-player.md is missing required marker /npm run verify:release-readiness/.",
    ]));
  });

  it("rejects ADR 0002 docs without catalog/product-surface supersession scope", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/adr/0002-native-app-with-web-player.md": docMarkers(
        "docs/adr/0002-native-app-with-web-player.md",
        (text) => text.includes("Supersedes"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "docs/adr/0002-native-app-with-web-player.md is missing required marker /Supersedes:\\*\\* Runtime and native catalog\\/product-surface ownership portions\\s+of `0001-gsav-pivot\\.md`/.",
    );
  });

  it("rejects QA negative fixture cases missing from the audit ownership table", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": qaNegativeFixtureInventory,
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": auditNegativeFixtureOwnership
        .replace("| Host offline/retry | Available through host control | native release owner | Capture evidence |\n", ""),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing negative fixture ownership row for Host offline/retry.",
    );
  });

  it("rejects negative fixture ownership status drift", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": qaNegativeFixtureInventory,
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": auditNegativeFixtureOwnership
        .replace(
          "| Host offline/retry | Available through host control | native release owner | Capture evidence |\n",
          "| Host offline/retry | Owner-blocked until host fixture exists | native release owner | Capture evidence |\n",
        )
        .replace(
          "| Cross-origin navigation | Available through diveo diagnostics QA controls | native release owner | Capture evidence |\n",
          "| Cross-origin navigation | Owner-blocked until diveo exposes a diagnostics control | native release owner | Capture evidence |\n",
        ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md negative fixture ownership status for Host offline/retry must remain available.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md negative fixture ownership status for Cross-origin navigation must remain available.",
    ]));
  });

  it("rejects unknown negative fixture status wording", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": qaNegativeFixtureInventory
        .replace(
          "| Host offline/retry | Stop host and tap retry | Error/retry UI recovers | Available through host control |",
          "| Host offline/retry | Stop host and tap retry | Error/retry UI recovers | Manual check needed |",
        ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": auditNegativeFixtureOwnership
        .replace(
          "| Cross-origin navigation | Available through diveo diagnostics QA controls | native release owner | Capture evidence |",
          "| Cross-origin navigation | Manual check needed | native release owner | Capture evidence |",
        ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/GSAV_NATIVE_QA.md negative fixture inventory status for Host offline/retry must be available or owner-blocked.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md negative fixture ownership status for Cross-origin navigation must be available or owner-blocked.",
    ]));
  });

  it("rejects extra stale negative fixture ownership rows in the audit", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": qaNegativeFixtureInventory,
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": `${auditNegativeFixtureOwnership}
| Removed fixture | Available through deleted QA route | native release owner | Delete stale row |
`,
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md has stale negative fixture ownership row for Removed fixture.",
    );
  });

  it("rejects owner-blocked negative fixture cases missing from the QA backlog", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": qaNegativeFixtureInventory
        .replace(
          "| Cross-origin navigation | Tap Cross-origin in diagnostics QA controls | Navigation blocked | Available through diveo diagnostics QA controls |",
          "| Cross-origin navigation | Tap Cross-origin in diagnostics QA controls | Navigation blocked | Owner-blocked until diveo exposes diagnostics controls |",
        ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": auditNegativeFixtureOwnership,
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "docs/GSAV_NATIVE_QA.md negative fixture backlog is missing owner-blocked case Cross-origin navigation.",
    );
  });

  it("rejects stale or weak negative fixture backlog rows", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": `${qaNegativeFixtureInventory}
| Cross-origin navigation | native release owner / diveo | TBD | Android and iOS logs show blocked navigation |
`
        .replace(
          "| Cross-origin navigation | Tap Cross-origin in diagnostics QA controls | Navigation blocked | Available through diveo diagnostics QA controls |",
          "| Cross-origin navigation | Tap Cross-origin in diagnostics QA controls | Navigation blocked | Owner-blocked until diveo exposes diagnostics controls |",
        ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": auditNegativeFixtureOwnership,
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/GSAV_NATIVE_QA.md negative fixture backlog Cross-origin navigation must include concrete required fixture shape.",
    ]));
  });

  it("requires current audit sections to carry release identity markers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const historicalMarkers = docMarkers("docs/IMPLEMENTATION_VALIDATION_AUDIT.md")
      .replace(/## Current Release Blockers[\s\S]*?## Remaining Validation Gaps[\s\S]*?(?=##|$)/, "");
    writeDocs(root, {
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": `${historicalMarkers}
## Current Release Blockers
historical text without current candidate evidence

## Remaining Validation Gaps
historical text without current release identity gap

## Negative Fixture Ownership
| Negative case | Current trigger status | Owner | Next action |
| --- | --- | --- | --- |
| Missing host config | Available through app config | native release owner | Capture evidence |
| Host offline/retry | Available through host control | native release owner | Capture evidence |
| Cross-origin navigation | Available through diveo diagnostics QA controls | native release owner | Capture evidence |
| Unsupported renderer | Available through /gsav-diagnostics; tap \`Unsupported\` | native release owner | Capture evidence |
| Auth initialization gate | Available through EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000 | native release owner | Capture evidence |
`,
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /Android WebView QA/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /iOS WKWebView QA/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /Negative fixture readiness/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /Production JS runtime smoke/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /Production `\\.gsav` range probe/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /Access-Control-Expose-Headers/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /Release APK, manifest scan, and installed APK smoke/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /Generated version metadata/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /Release dry run/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /Publish readiness/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /release-candidate\\.txt/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /checksum-manifest SHA/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Remaining Validation Gaps is missing required marker /Release-candidate identity ordering/.",
    ]));
  });

  it("rejects stale route and compatibility markers in active docs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "README.en.md": `${docMarkers("README.en.md")}components/GsavWebView.tsx\n`,
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("README.en.md contains stale marker /components\\/GsavWebView/.");
  });

  it("rejects documented npm scripts that package.json does not define", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "README.md": `${docMarkers("README.md")}npm run missing-script\n`,
    });
    fs.copyFileSync(path.join(process.cwd(), "package.json"), path.join(root, "package.json"));

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "README.md references npm run missing-script, but package.json does not define that script.",
    );
  });

  it("rejects missing npm scripts in the active implementation plan but ignores historical phase notes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": `${insertBeforeHistoricalPhaseAppendix(
        docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md"),
        "npm run missing-plan-script\n",
      )}

Historical note: npm run old-missing-phase-script
`,
    });
    fs.copyFileSync(path.join(process.cwd(), "package.json"), path.join(root, "package.json"));

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md references npm run missing-plan-script, but package.json does not define that script.",
    );
    expect(result.errors).not.toContain(
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md references npm run old-missing-phase-script, but package.json does not define that script.",
    );
  });

  it("rejects missing npm scripts in current audit sections but ignores completed-history notes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": `${docMarkers("docs/IMPLEMENTATION_VALIDATION_AUDIT.md").replace(
        "capturesGsavHostIdentity=true",
        "capturesGsavHostIdentity=true\nnpm run missing-audit-script",
      )}
## Completed In This Pass

Historical note: npm run old-missing-audit-script
`,
    });
    fs.copyFileSync(path.join(process.cwd(), "package.json"), path.join(root, "package.json"));

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md references npm run missing-audit-script, but package.json does not define that script.",
    );
    expect(result.errors).not.toContain(
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md references npm run old-missing-audit-script, but package.json does not define that script.",
    );
  });

  it("uses verifier-derived evidence counts rather than ad hoc QA table size", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": `${docMarkers("docs/GSAV_NATIVE_QA.md")}
## Evidence Log
| Date | Platform | Device/Emulator | GSAV web URL | diveo route | Result | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-06-30 | JS runtime smoke | Chromium | https://gsav.example.com | JS runtime smoke | Passed | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/runtime | owner=native release owner |
| _pending_ | Android | _pending_ | https://gsav.example.com | / | _pending_ | _pending_ | Pending |
`,
    });

    const result = analyzeDocDrift(root);

    expect(result.errors.filter((error) => error.includes("must summarize current"))).toEqual([]);
  });

  it("rejects dry-run docs that omit required release evidence files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": `${docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md", (text) => text.includes("gsav-preflight"))}
Release workflow dry run uploads release-evidence/release-candidate.txt and release-evidence/gsav-runtime-smoke.json.
`,
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md must mention dry-run evidence file release-evidence/gsav-preflight.json.",
    );
  });

  it("rejects dry-run docs that omit the concrete publish artifact identity field", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": `${docMarkers("docs/GSAV_NATIVE_QA.md").replaceAll(" publishArtifactIdentitySha256=<64-hex sha>", "")}
Release workflow dry run requires publish artifact identity evidence.
`,
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": `${docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md").replaceAll(" publishArtifactIdentitySha256=<64-hex sha>", "")}
Release workflow dry run requires publish artifact identity evidence.
`,
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/GSAV_NATIVE_QA.md must include publishArtifactIdentitySha256=<64-hex sha> in dry-run evidence templates.",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md must include publishArtifactIdentitySha256=<64-hex sha> in dry-run evidence templates.",
    ]));
  });

  it("rejects dry-run docs that omit GSAV package provenance", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": `${docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("gsavPackageProvenance"),
      )}
Release workflow dry run requires package provenance.
`,
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": `${docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("gsavPackageProvenance"),
      )}
Release workflow dry run requires package provenance.
`,
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("gsavPackageProvenance"),
      ).replaceAll(gsavPackageProvenanceMarker, ""),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /(?=[\\s\\S]*gsavPackageProvenance)"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /(?=[\\s\\S]*gsavPackageProvenance)"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /(?=[\\s\\S]*gsavPackageProvenance)"),
      "docs/GSAV_NATIVE_QA.md must include gsavPackageProvenanceSha256=<64-hex sha> plus bridge/client specifier and tarballSha256=<64-hex sha> in dry-run evidence templates.",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md must include gsavPackageProvenanceSha256=<64-hex sha> plus bridge/client specifier and tarballSha256=<64-hex sha> in dry-run evidence templates.",
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /(?=[\\s\\S]*gsavPackageProvenance)"),
    ]));
  });

  it("rejects release validation docs that omit the downloaded-root prereq JSON path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md")
        .replaceAll("$DOWNLOADED_RELEASE_DIR/$VALIDATION_PREREQS_PATH", "$DOWNLOADED_RELEASE_DIR/prereqs.json"),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "docs/GSAV_NATIVE_QA.md is missing required marker /\\$DOWNLOADED_RELEASE_DIR\\/\\$VALIDATION_PREREQS_PATH/.",
    );
  });

  it("rejects active evidence docs that omit the iOS validation owner marker", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("iOS validation owner"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("iOS validation owner"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("iOS validation owner"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/GSAV_NATIVE_QA.md is missing required marker /iOS validation owner/.",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /iOS validation owner/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /iOS validation owner/.",
    ]));
  });

  it("rejects active docs that omit iOS validation artifact URL and SHA markers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitIosArtifact = (text) => (
      text.includes("artifact URL")
      || text.includes("artifact SHA")
      || text.includes("ios_validation_artifact")
      || text.includes("IOS_VALIDATION_ARTIFACT")
    );
    writeDocs(root, {
      "CONTRIBUTING.md": docMarkers("CONTRIBUTING.md", omitIosArtifact),
      ".github/PULL_REQUEST_TEMPLATE.md": docMarkers(".github/PULL_REQUEST_TEMPLATE.md", omitIosArtifact),
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitIosArtifact),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md", omitIosArtifact),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers("docs/IMPLEMENTATION_VALIDATION_AUDIT.md", omitIosArtifact),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("CONTRIBUTING.md is missing required marker /trusted iOS artifact URL/"),
      expect.stringContaining(".github/PULL_REQUEST_TEMPLATE.md is missing required marker /IOS_VALIDATION_ARTIFACT_URL/"),
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /trusted iOS artifact URL/"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /trusted iOS artifact URL/"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /64-hex iOS artifact SHA256/"),
    ]));
  });

  it("rejects active docs that omit local rehearsal versus publish evidence rules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("local emulator or simulator URLs"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("Local rehearsal may use the emulator"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /local emulator or simulator URLs"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /Local rehearsal may use the emulator"),
    ]));
  });

  it("rejects publish-path docs that omit raw readiness diagnostic wording", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitRawReadinessDiagnostic = (text) => text.includes("diagnostic") && text.includes("verify:release-readiness");
    writeDocs(root, {
      "CONTRIBUTING.md": docMarkers("CONTRIBUTING.md", omitRawReadinessDiagnostic),
      ".github/PULL_REQUEST_TEMPLATE.md": docMarkers(".github/PULL_REQUEST_TEMPLATE.md", omitRawReadinessDiagnostic),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md", omitRawReadinessDiagnostic),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("CONTRIBUTING.md") && error.includes("diagnostic"))).toBe(true);
    expect(result.errors.some((error) => error.includes(".github/PULL_REQUEST_TEMPLATE.md") && error.includes("diagnostic"))).toBe(true);
    expect(result.errors.some((error) => error.includes("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md") && error.includes("diagnostic"))).toBe(true);
  });

  it("rejects publish-path docs that omit the external evidence inventory replay command", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitExternalInventoryReplay = (text) => text.includes("verify:external-evidence-inventory");
    writeDocs(root, {
      "CONTRIBUTING.md": docMarkers("CONTRIBUTING.md", omitExternalInventoryReplay),
      ".github/PULL_REQUEST_TEMPLATE.md": docMarkers(".github/PULL_REQUEST_TEMPLATE.md", omitExternalInventoryReplay),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md", omitExternalInventoryReplay),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("CONTRIBUTING.md is missing required marker /npm run verify:external-evidence-inventory"),
      expect.stringContaining(".github/PULL_REQUEST_TEMPLATE.md is missing required marker /npm run verify:external-evidence-inventory"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /npm run verify:external-evidence-inventory"),
    ]));
  });

  it("rejects publish-path docs that omit strict external evidence inventory replay", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitStrictExternalInventoryReplay = (text) => (
      text.includes("verify:external-evidence-inventory")
      && text.includes("--require-git-integrity")
    );
    writeDocs(root, {
      "CONTRIBUTING.md": docMarkers("CONTRIBUTING.md", omitStrictExternalInventoryReplay),
      ".github/PULL_REQUEST_TEMPLATE.md": docMarkers(
        ".github/PULL_REQUEST_TEMPLATE.md",
        omitStrictExternalInventoryReplay,
      ),
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitStrictExternalInventoryReplay),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitStrictExternalInventoryReplay,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "CONTRIBUTING.md",
      ".github/PULL_REQUEST_TEMPLATE.md",
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("--require-git-integrity")
      ))).toBe(true);
    }
  });

  it("rejects publish-path docs that omit final readiness receipt verification", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitFinalReadinessReceipts = (text) => (
      text.includes("verify:final-readiness-receipts")
      && text.includes("--candidate-sha")
    ) || text.includes("publishSignoffReady");
    writeDocs(root, {
      ".github/PULL_REQUEST_TEMPLATE.md": docMarkers(
        ".github/PULL_REQUEST_TEMPLATE.md",
        omitFinalReadinessReceipts,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitFinalReadinessReceipts,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitFinalReadinessReceipts,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      ".github/PULL_REQUEST_TEMPLATE.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("verify:final-readiness-receipts")
      ))).toBe(true);
    }
  });

  it("rejects the implementation plan when the compact Explore exception contract is removed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("Explore Hosted Exception Contract"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker Explore Hosted Exception Contract"),
    ]));
  });

  it("rejects active evidence docs that omit row-detail trusted evidence URL rules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("row detail evidence URLs?"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("row detail evidence URLs?"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("row detail evidence URLs?"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /row detail evidence URLs?"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /row detail evidence URLs?"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /row detail evidence URLs?"),
    ]));
  });

  it("rejects active evidence docs that omit release-tag context-only rules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("release\\s+tag\\s+pages?"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("release\\s+tag\\s+pages?"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("release\\s+tag\\s+pages?"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /release\\s+tag\\s+pages?"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /release\\s+tag\\s+pages?"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /release\\s+tag\\s+pages?"),
    ]));
  });

  it("rejects active evidence docs that use generic device release artifact URL wording", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitPreciseReleaseArtifactUrl = (text) => (
      text.includes("release_run_id")
      && text.includes("diveo-release-evidence-v<semver>")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        omitPreciseReleaseArtifactUrl,
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitPreciseReleaseArtifactUrl,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitPreciseReleaseArtifactUrl,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /release_run_id"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /release_run_id"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /release_run_id"),
    ]));
  });

  it("rejects active evidence docs that omit reviewed-artifact identity match rules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("artifactReviewArtifact=<artifact name or ID>") && text.includes("artifact ID"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("artifactReviewArtifact=<artifact name or ID>") && text.includes("artifact ID"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("artifactReviewArtifact=<artifact name or ID>") && text.includes("artifact ID"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /artifactReviewArtifact=<artifact name or ID>`"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /artifactReviewArtifact=<artifact name or ID>`"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /artifactReviewArtifact=<artifact name or ID>`"),
    ]));
  });

  it("rejects active evidence docs that omit the exact release evidence artifact name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("diveo-release-evidence-v"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("diveo-release-evidence-v"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("diveo-release-evidence-v"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /diveo-release-evidence-v"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /diveo-release-evidence-v"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /diveo-release-evidence-v"),
    ]));
  });

  it("rejects active evidence docs that omit publish artifact identity hash rules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("expected_apk_sha256") && text.includes("expected_publish_identity_sha256"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("expected_apk_sha256") && text.includes("expected_publish_identity_sha256"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("expected_apk_sha256") && text.includes("expected_publish_identity_sha256"),
      ).replace(
        "\nexpected_apk_sha256 expected_publish_identity_sha256 manual publish reviewed dry-run artifact dry-run-summary.json apkSha256 publishArtifactIdentitySha256 publishArtifactIdentitySha256=<64-hex sha>\n",
        "\n",
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /expected_apk_sha256"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /expected_apk_sha256"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /expected_apk_sha256"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md section ## Current Release Blockers is missing required marker /expected_apk_sha256"),
    ]));
  });

  it("rejects active evidence docs that omit summary-writer candidate identity hardening", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("write-release-evidence-summary"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("write-release-evidence-summary"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("write-release-evidence-summary"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /(?=[\\s\\S]*write-release-evidence-summary\\.js"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /(?=[\\s\\S]*write-release-evidence-summary\\.js"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /(?=[\\s\\S]*write-release-evidence-summary\\.js"),
    ]));
  });

  it("rejects active evidence docs that omit device-validation downloaded artifact identity checks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("dry-run-summary\\.json") && text.includes("inputs\\.artifact_name"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("dry-run-summary\\.json") && text.includes("inputs\\.artifact_name"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("dry-run-summary\\.json") && text.includes("inputs\\.artifact_name"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /dry-run-summary\\.json"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /dry-run-summary\\.json"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /dry-run-summary\\.json"),
    ]));
  });

  it("rejects active evidence docs that omit release-evidence-contained iOS prerequisite artifacts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitContainedIosPrereq = (text) => (
      text.includes("release-evidence:attach-validation-prereqs")
      && text.includes("iOS artifact")
      && text.includes("recomput")
    );
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitContainedIosPrereq),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitContainedIosPrereq,
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        omitContainedIosPrereq,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    for (const file of [
      "docs/GSAV_NATIVE_QA.md",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
    ]) {
      expect(result.errors.some((error) => (
        error.startsWith(`${file} is missing required marker`)
        && error.includes("release-evidence:attach-validation-prereqs")
        && error.includes("iOS artifact")
      ))).toBe(true);
    }
  });

  it("rejects active evidence docs that omit device-validation dispatch input validation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("release_run_id") && text.includes("diveo-release-evidence-v<semver>"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("release_run_id") && text.includes("diveo-release-evidence-v<semver>"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("release_run_id") && text.includes("diveo-release-evidence-v<semver>"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /release_run_id"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /release_run_id"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /release_run_id"),
    ]));
  });

  it("rejects active evidence docs that omit the device-validation upload artifact name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("diveo-device-validation"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("diveo-device-validation"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("diveo-device-validation"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /diveo-device-validation"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /diveo-device-validation"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /diveo-device-validation"),
    ]));
  });

  it("rejects active evidence docs that omit fail-closed upload behavior", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("if-no-files-found"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("if-no-files-found"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("if-no-files-found"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /if-no-files-found"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /if-no-files-found"),
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /if-no-files-found"),
    ]));
  });

  it("rejects active evidence docs that omit downloaded artifact review proof", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("downloaded checksum-manifest"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("downloaded checksum-manifest"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("downloaded checksum-manifest"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "docs/GSAV_NATIVE_QA.md is missing required marker /downloaded checksum-manifest SHA256/.",
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /downloaded checksum-manifest SHA256/.",
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing required marker /downloaded checksum-manifest SHA256/.",
    ]));
  });

  it("rejects active evidence docs that omit final external review ledger category coverage", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("validation\\s+prerequisites\\/device-validation\\s+bundle"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("validation\\s+prerequisites\\/device-validation\\s+bundle"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("validation\\s+prerequisites\\/device-validation\\s+bundle"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /release\\s+dry\\s+run"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /release\\s+dry\\s+run"),
    ]));
  });

  it("rejects active evidence docs that omit final external review ledger row quality rules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("durable\\s+reviewed\\s+artifact\\s+reference"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("durable\\s+reviewed\\s+artifact\\s+reference"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("durable\\s+reviewed\\s+artifact\\s+reference"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /durable\\s+reviewed\\s+artifact"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /durable\\s+reviewed\\s+artifact"),
    ]));
  });

  it("rejects active evidence docs that omit concrete reviewed proof values", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": docMarkers(
        "docs/GSAV_NATIVE_QA.md",
        (text) => text.includes("64-hex\\s+hashes"),
      ),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("64-hex\\s+hashes"),
      ),
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": docMarkers(
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        (text) => text.includes("64-hex\\s+hashes"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker /64-hex\\s+hashes"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /64-hex\\s+hashes"),
    ]));
  });

  it("rejects docs that omit the downloaded-artifact root marker", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        (text) => text.includes("--root"),
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker /--root "\\$DOWNLOADED_RELEASE_DIR"/.',
    );
  });

  it("rejects stale active-plan sibling budget and theme contract language", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": `${insertBeforeHistoricalPhaseAppendix(
        docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md"),
        `
A new exception may raise the 14-entry ceiling.
The current 14 sibling-feature allowlist entries are the ratchet.
Theme policy: features/preferences/useTheme.ts is currently blessed as the app-wide UI-state contract.
Current baseline: features/preferences/ now owns global preference state and the useTheme hook.
The old utils/gsavBridge.ts compatibility barrel has been removed; bridge, URL, route, navigation, and reducer helpers now live under features/player/.
`,
      )}
`,
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("raise the 14-entry ceiling"),
      expect.stringContaining("current 14 sibling-feature allowlist entries"),
      expect.stringContaining("features\\/preferences\\/useTheme\\.ts"),
      expect.stringContaining("features\\/preferences\\/`?"),
      expect.stringContaining("bridge,\\s*URL,\\s*route"),
    ]));
  });

  it("rejects device validation verifier output inside the attached release bundle", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": `${docMarkers("docs/GSAV_NATIVE_QA.md")}
Stale placement: downloaded-release/release-evidence/device-validation-bundle-verifier.json
`,
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "docs/GSAV_NATIVE_QA.md must keep device-validation-bundle-verifier.json outside downloaded-release/release-evidence/**; use device-validation-evidence/device-validation-bundle-verifier.json.",
    );
  });

  it("rejects stale generic evidence URL wording in active evidence docs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/GSAV_NATIVE_QA.md": `${docMarkers("docs/GSAV_NATIVE_QA.md")}
Evidence links may use durable HTTPS CI/artifact URLs.
`,
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": `${docMarkers("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md")}
External evidence can use a non-local HTTPS durable CI/artifact URL.
`,
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("docs/GSAV_NATIVE_QA.md uses stale generic evidence URL wording /durable HTTPS CI\\/artifact URLs?/i"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md uses stale generic evidence URL wording /non-local HTTPS durable CI\\/artifact URL/i"),
    ]));
  });

  it("requires active docs to scope the no-publish baseline to pre-G3", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    const omitNoPublishScope = (text) => text.includes("scope=pre-g3-no-publish-baseline");
    writeDocs(root, {
      "CONTRIBUTING.md": docMarkers("CONTRIBUTING.md", omitNoPublishScope),
      "docs/GSAV_NATIVE_QA.md": docMarkers("docs/GSAV_NATIVE_QA.md", omitNoPublishScope),
      "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": docMarkers(
        "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
        omitNoPublishScope,
      ),
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("CONTRIBUTING.md is missing required marker"),
      expect.stringContaining("docs/GSAV_NATIVE_QA.md is missing required marker"),
      expect.stringContaining("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md is missing required marker"),
      expect.stringContaining("scope=pre-g3-no-publish-baseline"),
    ]));
  });

  it("allows stale evidence wording only in historical audit sections", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": `${docMarkers("docs/IMPLEMENTATION_VALIDATION_AUDIT.md")}
## Historical Notes
Old history mentioned durable HTTPS CI/artifact/release URLs before the trusted-repo rule.
`,
    });

    const result = analyzeDocDrift(root);

    expect(result.errors).not.toEqual(expect.arrayContaining([
      expect.stringContaining("docs/IMPLEMENTATION_VALIDATION_AUDIT.md uses stale generic evidence URL wording"),
    ]));
  });

  it("requires known historical planning docs to carry superseded banners", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "IMPROVEMENT_PLAN.md": "# Old plan\nNo active banner\n",
      "SCALE_PLAN.md": "# Old scale\nNo active banner\n",
      "GSAV_4DGS_HOSTING_IMPLEMENTATION_CHECKLIST.md": "# Old GSAV checklist\nKeep diveo as a React Native WebView shell.\n",
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "IMPROVEMENT_PLAN.md is missing superseded-doc marker /Superseded by `docs\\/GSAV_NATIVE_IMPLEMENTATION_PLAN\\.md`/i.",
      "IMPROVEMENT_PLAN.md is missing superseded-doc marker /historical/i.",
      "IMPROVEMENT_PLAN.md is missing superseded-doc marker /not the active release runbook/i.",
      "SCALE_PLAN.md is missing superseded-doc marker /Superseded by `docs\\/GSAV_NATIVE_IMPLEMENTATION_PLAN\\.md`/i.",
      "SCALE_PLAN.md is missing superseded-doc marker /historical/i.",
      "SCALE_PLAN.md is missing superseded-doc marker /not the active scale plan/i.",
      "SCALE_PLAN.md is missing superseded-doc marker /do not use it as an implementation checklist/i.",
      "GSAV_4DGS_HOSTING_IMPLEMENTATION_CHECKLIST.md is missing superseded-doc marker /superseded historical checklist/i.",
      "GSAV_4DGS_HOSTING_IMPLEMENTATION_CHECKLIST.md is missing superseded-doc marker /docs\\/GSAV_NATIVE_IMPLEMENTATION_PLAN\\.md/.",
      "GSAV_4DGS_HOSTING_IMPLEMENTATION_CHECKLIST.md is missing superseded-doc marker /ADR 0002/.",
    ]));
  });

  it("rejects root planning or checklist docs that are not active or superseded", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "EXPERIMENT_PLAN.md": "# Experiment\nLooks actionable\n",
      "RELEASE_CHECKLIST.md": "# Release\nLooks actionable\n",
    });

    const result = analyzeDocDrift(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "EXPERIMENT_PLAN.md is a root planning/checklist doc but is not listed in activeDocs or supersededDocs.",
      "RELEASE_CHECKLIST.md is a root planning/checklist doc but is not listed in activeDocs or supersededDocs.",
    ]));
  });

  it("accepts historical planning docs when they point to current canonical docs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-drift-"));
    writeDocs(root, {
      "docs/adr/0001-gsav-pivot.md": `> Superseded by ADR 0002.
> This file is not the active product contract. See docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md.
`,
      "IMPROVEMENT_PLAN.md": `${supersededDocBanner("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md", "release runbook")}${historicalOwnershipWarning}# Old plan\n`,
      "IMPROVEMENT_CHECKLIST.md": `${supersededDocBanner("docs/IMPLEMENTATION_VALIDATION_AUDIT.md", "release checklist")}${historicalOwnershipWarning}# Old checklist\n`,
      "REMAINING_GAPS_PLAN.md": `${supersededDocBanner("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md", "validation plan")}${historicalOwnershipWarning}# Old gaps\n`,
      "SCALE_PLAN.md": `${supersededDocBanner("docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md", "scale plan")}> The body below is retained for historical context only; do not use it as an implementation checklist.\n${historicalOwnershipWarning}# Old scale\n`,
      "GSAV_4DGS_HOSTING_IMPLEMENTATION_CHECKLIST.md": `# Historical checklist

Status: superseded historical checklist. The active release plan is
docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md, release evidence belongs in
docs/GSAV_NATIVE_QA.md, current blockers and signoff live in
docs/IMPLEMENTATION_VALIDATION_AUDIT.md, and the boundary decision is ADR 0002.

React Native owns native browse, social, settings, auth, saved/follow, and navigation surfaces.
../gsav-hosting/apps/web\` owns GSAV decode/render/playback/runtime diagnostics.
Historical ownership warning: ADR 0002 supersedes launcher/no-catalog guidance below.
React Native now owns native browse/search/creator/library product UX as a consumer of shared GSAV catalog contracts; gsav-hosting owns decode/render/playback/runtime.
Do not use this file for ownership decisions.
`,
    });

    const result = analyzeDocDrift(root);

    expect(result.checkedSupersededFiles).toEqual([
      "docs/adr/0001-gsav-pivot.md",
      "IMPROVEMENT_PLAN.md",
      "IMPROVEMENT_CHECKLIST.md",
      "REMAINING_GAPS_PLAN.md",
      "SCALE_PLAN.md",
      "GSAV_4DGS_HOSTING_IMPLEMENTATION_CHECKLIST.md",
    ]);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
