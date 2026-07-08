#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { appRouteOwnerMap } = require("./verify-import-boundaries.js");
const { requiredEvidence } = require("./verify-release-readiness.js");
const { DEFAULT_EXPECTED_PENDING_ROWS } = require("./verify-no-publish-baseline.js");
const { deviceRequirements } = require("./device-evidence-packet.js");

const EXPECTED_RELEASE_READINESS_CHECKED = requiredEvidence.length;
const EXPECTED_PENDING_PUBLISH_ROWS = DEFAULT_EXPECTED_PENDING_ROWS;
const EXPECTED_DEVICE_PACKET_COUNT = deviceRequirements().length;

function requiredTextMarker(description, terms) {
  const marker = (text) => terms.every((term) => text.includes(term));
  marker.description = description;
  return marker;
}

function markerMatches(marker, text) {
  return typeof marker === "function" ? marker(text) : marker.test(text);
}

function markerDescription(marker) {
  return marker.description ?? String(marker);
}

const productJourneyRequiredEntryIdTerms = [
  "product-journey-manifest.json",
  "first-launch-home",
  "search",
  "creator",
  "library",
  "login-auth-return",
  "watch-alias",
  "explore",
  "diagnostics-hierarchy",
  "settings",
  "accessibility-ergonomics",
  "degraded-blocked-states",
];

const productJourneySemanticSignalTerms = [
  "product-journey-manifest.json",
  "observedSignals",
  "native Home feed state",
  "keyboard visible without overlap",
  "follow signed-out to login and return",
  "signed-in seeded saved scenes",
  "keyboard-visible native Login UI",
  "/gsav/test?t=2.5",
  "progress saves and resume works",
  "exactly one",
  "embed=native",
  "dataSaver=1",
  "vertical swipe/scroll changing the active scene",
  "visible active-scene change",
  "/native-diagnostics?embed=native",
  "44dp touch targets",
  "no blank WebView",
];

const artifactReviewArtifactIdentityPattern =
  /artifactReviewArtifact=<artifact name or ID>`?[\s\S]{0,160}match(?:es|ing)?[\s\S]{0,160}artifact name[\s\S]{0,160}artifact ID/;
const releaseEvidenceArtifactNamePattern =
  /diveo-release-evidence-v<version>|artifactName must match diveo-release-evidence-v<releaseVersion>/;
const deviceValidationArtifactIdentityPattern =
  /dry-run-summary\.json[\s\S]{0,160}artifactName[\s\S]{0,160}inputs\.artifact_name|inputs\.artifact_name[\s\S]{0,160}dry-run-summary\.json[\s\S]{0,160}artifactName/;
const deviceValidationDispatchInputPattern =
  /release_run_id[\s\S]{0,400}digits[\s\S]{0,400}artifact_name[\s\S]{0,400}diveo-release-evidence-v<semver>[\s\S]{0,400}evidence_date[\s\S]{0,400}YYYY-MM-DD[\s\S]{0,400}release_artifact_url[\s\S]{0,400}trusted[\s\S]{0,120}Diveo GitHub Actions run[\s\S]{0,160}Actions artifact[\s\S]{0,160}release asset download URL/i;
const deviceValidationIosArtifactInputPattern =
  /ios_validation_artifact_url[\s\S]{0,400}trusted[\s\S]{0,160}(?:direct\s+)?(?:Actions\s+)?artifact[\s\S]{0,160}(?:release\s+(?:asset\s+download|download)|docs\/qa-evidence\s+blob)[\s\S]{0,240}(?:(?:opsiclear|opsiclear-web)\/diveo|opsiclear\/gsav-hosting|Diveo)[\s\S]{0,400}ios_validation_artifact_sha256[\s\S]{0,160}64-hex/i;
const releaseEvidenceContainedIosPrereqPattern =
  /(?=[\s\S]*release-evidence:attach-validation-prereqs)(?=[\s\S]*(?:prerequisite JSON|validation-prereqs\.json))(?=[\s\S]*iOS artifact)(?=[\s\S]*(?:under|inside|remains under)[\s\S]{0,160}`?release-evidence\/`?)(?=[\s\S]*dry-run-summary\.json)(?=[\s\S]*evidence-checksums\.txt)(?=[\s\S]*--require-validation-prereqs true)(?=[\s\S]*recomput(?:e|es|ing)[\s\S]{0,180}(?:current )?(?:iOS )?(?:artifact )?(?:SHA256|bytes))/i;
const deviceValidationUploadNamePattern =
  /diveo-device-validation-\$\{\{ inputs\.evidence_date \}\}-\$\{\{ inputs\.release_run_id \}\}/;
const publishArtifactIdentityPattern =
  /expected_apk_sha256[\s\S]{0,500}expected_publish_identity_sha256[\s\S]{0,500}(?:manual publish|dispatch inputs?|publish hash inputs?|reviewed dry-run artifact)[\s\S]{0,500}dry-run-summary\.json[\s\S]{0,500}apkSha256[\s\S]{0,500}publishArtifactIdentitySha256/;
const gsavPackageProvenancePattern =
  /(?=[\s\S]*gsavPackageProvenance)(?=[\s\S]*gsavPackageProvenanceSha256=<64-hex sha>)(?=[\s\S]*@opsiclear\/gsav-bridge)(?=[\s\S]*@opsiclear\/gsav-client)(?=[\s\S]*specifier=file:vendor\/)(?=[\s\S]*tarballSha256=<64-hex sha>)/;
const summaryCandidateIdentityPattern =
  /(?=[\s\S]*write-release-evidence-summary\.js)(?=[\s\S]*release-candidate\.txt)(?=[\s\S]*releaseCandidateSha)(?=[\s\S]*appVersion)(?=[\s\S]*packageVersion)(?=[\s\S]*androidVersionCode)(?=[\s\S]*RELEASE_CANDIDATE_SHA)(?=[\s\S]*semver)(?=[\s\S]*releaseVersion)(?=[\s\S]*numeric)/;
const downloadedValidationPrereqsCommandPattern =
  /npm run verify:validation-prereqs -- --root "\$DOWNLOADED_RELEASE_DIR" --apk-path "\$APK_PATH" --manifest-path "\$MANIFEST_PATH" --ios-artifact-path "\$IOS_VALIDATION_ARTIFACT_PATH" --output-path "\$VALIDATION_PREREQS_PATH"/;
const rawReadinessDiagnosticPattern =
  /raw[\s\S]{0,180}(?:packet\/inventory-aware\s+)?`?verify:release-readiness`?[\s\S]{0,220}diagnostic|`?verify:release-readiness`?[\s\S]{0,220}diagnostic[\s\S]{0,220}wrapper/i;
const uploadFailsOnMissingEvidencePattern = /if-no-files-found:\s*error/;
const externalReviewLedgerCoveragePattern =
  /release\s+dry\s+run[\s\S]{0,360}validation\s+prerequisites\/device-validation\s+bundle[\s\S]{0,360}(?:APK\/generated\s+metadata|APK\s+and\s+generated\s+metadata)[\s\S]{0,360}installed\s+APK\s+smoke[\s\S]{0,360}(?:production\s+runtime\/range|production\s+runtime\s+smoke\s+and\s+range\s+probe)[\s\S]{0,360}product\s+journey\s+manifest[\s\S]{0,360}Android\/iOS\s+route\s+rows[\s\S]{0,360}negative(?:\s+validation)?\s+rows[\s\S]{0,360}branch\s+protection/i;
const externalReviewLedgerRowQualityPattern =
  /durable\s+reviewed\s+artifact\s+reference[\s\S]{0,160}concrete\s+reviewer[\s\S]{0,160}ISO\s+timestamp[\s\S]{0,160}category-specific\s+proof/i;
const externalReviewLedgerConcreteProofPattern =
  /64-hex\s+hashes[\s\S]{0,160}trusted\s+GitHub\s+artifact\s+URLs[\s\S]{0,160}generated\s+`?versionCode`?[\s\S]{0,160}GSAV_HOSTING_COMMIT[\s\S]{0,160}Content-Range[\s\S]{0,160}CORS\s+header/i;
const releaseTagContextOnlyPattern =
  /release\s+tag\s+pages?[\s\S]{0,180}context\s+only[\s\S]{0,220}(?:direct\s+Actions\s+artifacts?|release\s+asset\s+download|docs\/qa-evidence\s+blob)/i;
const devicePacketExamplePattern =
  /npm run device-evidence:packet -- --example[\s\S]{0,240}(?:reviewed packet excerpt|documentation only)/i;
const localEvidenceManifestHashPattern =
  /evidenceManifestPath[\s\S]{0,180}docs\/qa-evidence\/\.\.\.[\s\S]{0,180}(?:hashes|hash)[\s\S]{0,180}evidenceManifestSha256/i;
const routeNegativeManifestContentClassificationPattern =
  /route\/negative manifest[\s\S]{0,240}contents[\s\S]{0,320}artifactPurpose=route-evidence[\s\S]{0,200}artifactPurpose=negative-evidence[\s\S]{0,200}helperOnly=false[\s\S]{0,260}sourceRunId[\s\S]{0,180}sourceArtifactId[\s\S]{0,240}(?:match(?:es|ing)?|URL-matched)[\s\S]{0,180}(?:artifact URL|trusted URL)/i;
routeNegativeManifestContentClassificationPattern.description =
  "route/negative manifest content classification: artifactPurpose=route-evidence artifactPurpose=negative-evidence helperOnly=false sourceRunId sourceArtifactId matching artifact URL contents";
const routeNegativeManifestSameDatePattern = requiredTextMarker(
  "route/negative manifest same-date replay: manifestPath evidenceManifestPath same docs/qa-evidence/<date>/ folder inventory evidence date stale route or negative manifests another evidence date",
  [
    "manifestPath",
    "evidenceManifestPath",
    "same",
    "docs/qa-evidence/<date>/",
    "inventory evidence date",
    "stale route or negative manifests",
    "another evidence date",
  ],
);
const packetLocalEvidenceSameDatePattern = requiredTextMarker(
  "packet local evidence same-date replay: actual.evidencePaths actual.evidenceManifestPath packet target evidence date docs/qa-evidence/<date>/ stale local route or negative packet evidence another evidence date",
  [
    "actual.evidencePaths",
    "actual.evidenceManifestPath",
    "packet target evidence date",
    "docs/qa-evidence/<date>/",
    "stale local route or negative packet evidence",
    "another evidence date",
  ],
);
const localMediaEvidenceHashPattern =
  /(?=[\s\S]*device-evidence:packet --check)(?=[\s\S]*(?:recomputes|hashes|byte-checks))(?=[\s\S]*(?:screenshot|recording|archive))(?=[\s\S]*mediaSha256)/i;
const externalEvidenceInventoryPattern =
  /npm run verify:external-evidence-inventory[\s\S]{0,260}external-evidence-inventory\.json[\s\S]{0,260}(?:reviewed-packet\.json|--packet-path)/i;
const externalEvidenceInventoryStrictPattern =
  /npm run verify:external-evidence-inventory[\s\S]{0,320}external-evidence-inventory\.json[\s\S]{0,320}(?:reviewed-packet\.json|--packet-path)[\s\S]{0,160}--require-git-integrity/i;
const externalEvidenceInventoryScaffoldPattern =
  /npm run external-evidence:scaffold[\s\S]{0,260}external-evidence-inventory-scaffold\.json[\s\S]{0,260}(?:reviewed-packet\.json|--packet-path)/i;
const productJourneyScaffoldHintsPattern =
  /external-evidence:scaffold[\s\S]{0,520}product-journey[\s\S]{0,260}productJourneyExpectedSha256Field[\s\S]{0,180}productJourneyExpectedSha256[\s\S]{0,180}productJourneySourceRunId[\s\S]{0,180}productJourneySourceArtifactId/i;
productJourneyScaffoldHintsPattern.description =
  "product journey external evidence scaffold hints: external-evidence:scaffold product-journey productJourneyExpectedSha256Field productJourneyExpectedSha256 productJourneySourceRunId productJourneySourceArtifactId";
const finalReadinessReceiptsPattern =
  /npm run verify:final-readiness-receipts[\s\S]{0,240}--candidate-sha <payload-sha>[\s\S]{0,240}--inventory-path docs\/qa-evidence\/<date>\/external-evidence-inventory\.json[\s\S]{0,240}--packet-path <reviewed-packet\.json>[\s\S]{0,240}--stack-receipt-path docs\/qa-evidence\/<date>\/stack-architecture-receipt\.json/i;
const finalReceiptPublishReadyPattern =
  /(?=[\s\S]*verify:final-readiness-receipts)(?=[\s\S]*(?:Protected candidate ancestry proof|protected `?origin\/master`? ancestry proof|git fetch --no-tags origin master))(?=[\s\S]*expectReadinessStatus=0)(?=[\s\S]*publishSignoffReady=true)(?=[\s\S]*noPublishRehearsal=false)(?=[\s\S]*status=pass)(?=[\s\S]*expected-readiness-fail)/i;
const finalReceiptLastMileLivePathBindingPattern = requiredTextMarker(
  "final receipt last-mile live path binding: inputs.date inputs.lastMileReleaseStateLivePath inputs.lastMilePublishHashGuardLivePath finalCommandReceiptsPath evidence date final-command-receipts live paths step commands --output-path",
  [
    "inputs.date",
    "inputs.lastMileReleaseStateLivePath",
    "inputs.lastMilePublishHashGuardLivePath",
    "finalCommandReceiptsPath evidence date",
    "final-command-receipts",
    "github-release-state-prepublish-live.json",
    "publish-hash-variable-guard-prepublish-live.json",
    "step commands",
    "--output-path",
  ],
);
const finalReceiptLastMileReviewBindingPattern = requiredTextMarker(
  "final receipt last-mile review binding: inputs.repository inputs.reviewer inputs.reviewedAt --repo --reviewer --reviewed-at trusted Diveo repository concrete reviewer ISO timestamp final evidence date wrapper rejects untrusted repository weak reviewer stale reviewedAt",
  [
    "Final receipt last-mile review binding",
    "inputs.repository",
    "inputs.reviewer",
    "inputs.reviewedAt",
    "--repo",
    "--reviewer",
    "--reviewed-at",
    "trusted Diveo repository",
    "concrete reviewer",
    "ISO timestamp on the final evidence date",
    "Last-mile GitHub release-state evidence",
    "Last-mile publish-hash variable guard",
    "static last-mile JSON",
    "final command receipt summary",
    "wrapper rejects untrusted repository",
    "wrapper rejects weak reviewer",
    "wrapper rejects stale reviewedAt",
  ],
);
const finalReceiptReviewerSourceFailFastPattern = requiredTextMarker(
  "final receipt reviewer source fail-fast binding: inputs.reviewer --reviewer FINAL_READINESS_REVIEWER GITHUB_ACTOR USERNAME USER wrapper rejects missing reviewer final-readiness-runner",
  [
    "Final receipt reviewer source fail-fast binding",
    "inputs.reviewer",
    "--reviewer",
    "FINAL_READINESS_REVIEWER",
    "GITHUB_ACTOR",
    "USERNAME",
    "USER",
    "wrapper rejects missing reviewer",
    "final-readiness-runner",
    "before helper commands run",
  ],
);
const finalReceiptSummaryTimingPattern = requiredTextMarker(
  "final receipt summary timing binding: startedAt finishedAt ISO timestamp final evidence date finishedAt not before startedAt",
  [
    "Final receipt summary timing binding",
    "startedAt",
    "finishedAt",
    "ISO timestamp on the final evidence date",
    "must not be before startedAt",
  ],
);
const finalReceiptPassSummaryContradictionPattern = requiredTextMarker(
  "final receipt pass-summary contradiction binding: final command receipt summary status=pass ok=true must not include failedStep non-empty outputProblems",
  [
    "Final receipt pass-summary contradiction binding",
    "final command receipt summary",
    "status=pass",
    "ok=true",
    "must not include",
    "failedStep",
    "non-empty",
    "outputProblems",
  ],
);
const finalReceiptInputFailFastPattern = requiredTextMarker(
  "final receipt input fail-fast binding: inputs.date current UTC capture date wrapper rejects stale date wrapper rejects future date inputs.qaPath docs/GSAV_NATIVE_QA.md wrapper rejects noncanonical QA path",
  [
    "Final receipt input fail-fast binding",
    "inputs.date",
    "current UTC capture date",
    "wrapper rejects stale date",
    "wrapper rejects future date",
    "inputs.qaPath",
    "docs/GSAV_NATIVE_QA.md",
    "wrapper rejects noncanonical QA path",
    "before helper commands run",
  ],
);
const finalReceiptEvidenceDirFailFastPattern = requiredTextMarker(
  "final receipt evidence-dir fail-fast binding: inputs.evidenceDir docs/qa-evidence/<date>/final-command-receipts finalCommandReceiptsPath directory wrapper rejects noncanonical evidence-dir",
  [
    "Final receipt evidence-dir fail-fast binding",
    "inputs.evidenceDir",
    "docs/qa-evidence/<date>/final-command-receipts",
    "finalCommandReceiptsPath directory",
    "wrapper rejects noncanonical evidence-dir",
    "before helper commands run",
  ],
);
const finalReceiptInventoryFailFastPattern = requiredTextMarker(
  "final receipt inventory fail-fast binding: inputs.inventoryPath docs/qa-evidence/<date>/external-evidence-inventory.json wrapper rejects noncanonical inventory path",
  [
    "Final receipt inventory fail-fast binding",
    "inputs.inventoryPath",
    "docs/qa-evidence/<date>/external-evidence-inventory.json",
    "wrapper rejects noncanonical inventory path",
    "before helper commands run",
  ],
);
const finalReceiptRunUrlRepositoryBindingPattern = requiredTextMarker(
  "final receipt runUrl repository binding: inputs.repository audit runUrl repository same trusted Diveo repository",
  [
    "Final receipt runUrl repository binding",
    "inputs.repository",
    "audit runUrl repository",
    "same trusted Diveo repository",
  ],
);
const finalReceiptReleaseStateQueryRepositoryBindingPattern = requiredTextMarker(
  "final receipt release-state query repository binding: commands workflows releaseRuns workflowDispatchRuns releases inputs.repository final command receipt summary repository",
  [
    "Final receipt release-state query repository binding",
    "commands",
    "workflows",
    "releaseRuns",
    "workflowDispatchRuns",
    "releases",
    "inputs.repository",
    "final command receipt summary repository",
    "gh api repos/<owner>/<repo>/actions/workflows",
    "-R",
    "--repo",
  ],
);
const finalReceiptLiveLastMileJsonBindingPattern = requiredTextMarker(
  "final receipt live last-mile JSON binding: inputs.lastMileReleaseStateLivePath inputs.lastMilePublishHashGuardLivePath valid JSON status pass ok true repository reviewer reviewedAt checkedAt releaseReadinessImpact",
  [
    "Final receipt live last-mile JSON binding",
    "inputs.lastMileReleaseStateLivePath",
    "inputs.lastMilePublishHashGuardLivePath",
    "valid JSON",
    "status=pass",
    "ok=true",
    "repository",
    "reviewer",
    "reviewedAt",
    "checkedAt",
    "releaseReadinessImpact.status=ready",
  ],
);
const finalReceiptLiveOutputCreationPattern = requiredTextMarker(
  "final receipt live output creation binding: Last-mile GitHub release-state evidence Last-mile publish-hash variable guard create valid JSON inputs.lastMileReleaseStateLivePath inputs.lastMilePublishHashGuardLivePath remove stale live output before capture step repository reviewer reviewedAt checkedAt final evidence date expectedStatus=0 status=pass ok=true releaseReadinessImpact.status=ready stop before Final release readiness outputProblems",
  [
    "Final receipt live output creation binding",
    "Last-mile GitHub release-state evidence",
    "Last-mile publish-hash variable guard",
    "must create valid JSON",
    "inputs.lastMileReleaseStateLivePath",
    "inputs.lastMilePublishHashGuardLivePath",
    "stale live output",
    "before each capture step",
    "repository",
    "reviewer",
    "reviewedAt",
    "checkedAt",
    "final evidence date",
    "expectedStatus=0",
    "status=pass",
    "ok=true",
    "releaseReadinessImpact.status=ready",
    "stop before",
    "Final release readiness",
    "outputProblems",
  ],
);
const finalReceiptPublishHashQueryRepositoryBindingPattern = requiredTextMarker(
  "final receipt publish-hash query repository binding: variableQueries[].command --repo inputs.repository final command receipt summary repository",
  [
    "Final receipt publish-hash query repository binding",
    "variableQueries[].command",
    "--repo",
    "inputs.repository",
    "final command receipt summary repository",
    "EXPECTED_RELEASE_APK_SHA256",
    "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256",
  ],
);
const finalReceiptStepLogByteReplayPattern = requiredTextMarker(
  "final receipt step-log byte replay: stdoutPath stderrPath stdoutSha256 stderrSha256 combinedSha256 final-command-receipts byte replay",
  [
    "stdoutPath",
    "stderrPath",
    "stdoutSha256",
    "stderrSha256",
    "combinedSha256",
    "final-command-receipts",
    "byte replay",
  ],
);
const finalReceiptStepSetPattern = requiredTextMarker(
  "final receipt wrapper step set: all 11 final receipt wrapper steps Documentation drift audit Final readiness focused tests External evidence inventory replay Device packet reconciliation Strict handoff receipt replay Stack architecture receipt replay Protected master ref refresh Protected candidate ancestry proof Last-mile GitHub release-state evidence Last-mile publish-hash variable guard Final release readiness wrapper rejects missing duplicate reordered recorded step evidence before status=pass",
  [
    "all 11 final receipt wrapper steps",
    "Documentation drift audit",
    "Final readiness focused tests",
    "External evidence inventory replay",
    "Device packet reconciliation",
    "Strict handoff receipt replay",
    "Stack architecture receipt replay",
    "Protected master ref refresh",
    "Protected candidate ancestry proof",
    "Last-mile GitHub release-state evidence",
    "Last-mile publish-hash variable guard",
    "Final release readiness",
    "wrapper rejects missing",
    "duplicate",
    "reordered recorded step evidence",
    "before status=pass",
  ],
);
const finalReceiptStepStatusPattern = requiredTextMarker(
  "final receipt wrapper step status: every final wrapper step expectedStatus=0 status=0 publish signoff",
  [
    "every final wrapper step",
    "expectedStatus=0",
    "status=0",
    "publish signoff",
  ],
);
const finalReceiptReadinessEnvPattern = requiredTextMarker(
  "final receipt Final release readiness env binding: verify-release-readiness.js --strict-final-inputs EXTERNAL_EVIDENCE_INVENTORY_PATH DEVICE_EVIDENCE_PACKET_PATH RELEASE_CANDIDATE_SHA FINAL_READINESS_RECEIPT_BOOTSTRAP finalCommandReceiptsPath safe final input keys",
  [
    "Final release readiness",
    "verify-release-readiness.js --strict-final-inputs",
    "EXTERNAL_EVIDENCE_INVENTORY_PATH",
    "DEVICE_EVIDENCE_PACKET_PATH",
    "RELEASE_CANDIDATE_SHA",
    "FINAL_READINESS_RECEIPT_BOOTSTRAP",
    "finalCommandReceiptsPath",
    "safe final input keys",
  ],
);
const finalReceiptInternalCommandPattern = requiredTextMarker(
  "final receipt internal command binding: focused tests inventory replay device packet handoff receipts protected master protected candidate required commands",
  [
    "Final receipt internal command binding",
    "node_modules/vitest/vitest.mjs run",
    "scripts/verify-release-readiness.test.mjs",
    "scripts/verify-doc-drift.test.mjs",
    "scripts/verify-external-evidence-inventory.test.mjs",
    "scripts/device-evidence-packet.test.mjs",
    "scripts/verify-handoff-receipts.test.mjs",
    "scripts/stack-architecture-receipt.test.mjs",
    "inputs.qaPath",
    "docs/GSAV_NATIVE_QA.md",
    "--qa-path",
    "--inventory-path",
    "--packet-path",
    "--require-git-integrity",
    "--candidate-sha",
    "scripts/stack-architecture-receipt.js",
    "--require-assets",
    "--verify",
    "stack-architecture-receipt.json",
    "git fetch --no-tags origin master",
    "git merge-base --is-ancestor",
  ],
);
const productJourneyManifestRequiredIdsPattern =
  requiredTextMarker(
    "product-journey-manifest required entry IDs: first-launch-home search creator library login-auth-return watch-alias explore diagnostics-hierarchy settings accessibility-ergonomics degraded-blocked-states",
    productJourneyRequiredEntryIdTerms,
  );
const productJourneyDistinctPlatformEvidencePattern =
  /product-journey-manifest\.json[\s\S]{0,1200}distinct Android and iOS[\s\S]{0,80}(?:`?evidencePaths`?|evidence paths)/i;
const productJourneyUniqueEntryIdsPattern =
  /product-journey-manifest\.json[\s\S]{0,1200}(?:unique[\s\S]{0,120}entry IDs|entry IDs[\s\S]{0,120}unique)/i;
const productJourneyInventoryEntryIdReplayPattern =
  /Inventory replay[\s\S]{0,260}rejects[\s\S]{0,160}missing[\s\S]{0,160}placeholder[\s\S]{0,160}`?unknown`?[\s\S]{0,160}duplicate[\s\S]{0,160}product journey entry IDs/i;
const productJourneyInventoryExpansionValidityPattern =
  /product-journey-manifest\.json[\s\S]{0,1200}valid JSON[\s\S]{0,240}entries array[\s\S]{0,320}(?:inventory expansion|expand)/i;
const productJourneyInventoryClassificationPattern =
  /product-journey-manifest\.json[\s\S]{0,1200}reviewed inventory[\s\S]{0,240}artifactPurpose=product-journey-manifest[\s\S]{0,160}helperOnly=false/i;
const productJourneyManifestContentClassificationPattern =
  /inventory replay[\s\S]{0,320}product-journey-manifest\.json[\s\S]{0,240}manifest contents[\s\S]{0,240}artifactPurpose=product-journey-manifest[\s\S]{0,160}helperOnly=false/i;
const productJourneyFixtureInventoryPattern =
  /(?=[\s\S]*fixtureManifestPath)(?=[\s\S]*(?:external evidence inventory|reviewed inventory|inventory replay))(?=[\s\S]*fixture-manifest\.json)(?=[\s\S]*artifactPurpose=fixture-manifest)(?=[\s\S]*helperOnly=false)(?=[\s\S]*(?:fixtureManifestSha256|sha256 matching))/i;
const productJourneyFixtureContentReplayPattern =
  /Inventory replay[\s\S]{0,320}fixture-manifest\.json[\s\S]{0,220}fixture manifest[\s\S]{0,80}contents[\s\S]{0,220}artifactPurpose=fixture-manifest[\s\S]{0,160}helperOnly=false/i;
const productJourneySameDateInventoryPattern = requiredTextMarker(
  "product journey inventory same-date replay: product-journey-manifest same docs/qa-evidence/<date>/ folder stale local fixture or media another evidence date",
  [
    "product-journey-manifest.json",
    "same",
    "docs/qa-evidence/<date>/",
    "stale local fixture",
    "media paths",
    "another evidence date",
  ],
);
const productJourneyLinkedEvidenceClassificationPattern =
  /(?=[\s\S]*product-journey-manifest\.json)(?=[\s\S]*(?:every manifest entry `?evidencePaths`? item|each manifest entry evidence path|linked journey evidence entry))(?=[\s\S]*artifactPurpose=product-journey-evidence)(?=[\s\S]*helperOnly=false)(?=[\s\S]*(?:journeyEntryId|sourceRefs))(?=[\s\S]*(?:reviewed inventory `?sha256`?|inventory sha256))(?=[\s\S]*mediaSha256)(?=[\s\S]*fileSha256)(?=[\s\S]*sourceRunId)(?=[\s\S]*sourceArtifactId)(?=[\s\S]*(?:evidence URL|URL-backed))/i;
productJourneyLinkedEvidenceClassificationPattern.description =
  "product journey linked evidence classification: product-journey-manifest artifactPurpose=product-journey-evidence helperOnly=false journeyEntryId sourceRefs inventory sha256 mediaSha256 fileSha256 sourceRunId sourceArtifactId evidence URL";
const productJourneySemanticSignalsPattern =
  requiredTextMarker(
    "product-journey-manifest observedSignals semantic markers: native Home feed state keyboard visible without overlap follow signed-out to login and return signed-in seeded saved scenes keyboard-visible native Login UI /gsav/test?t=2.5 progress saves and resume works exactly one embed=native dataSaver=1 vertical swipe/scroll changing the active scene visible active-scene change /native-diagnostics?embed=native 44dp touch targets no blank WebView",
    productJourneySemanticSignalTerms,
  );
const productJourneyExploreRestraintPattern = requiredTextMarker(
  "product-journey-manifest Explore restraint: secondary/runtime-scoped action native feed Search Library Settings exactly one embed=native hidden hosted public/account chrome native-shell back behavior primary Home browse surface same-origin hosted product routes escape player boundary",
  [
    "secondary/runtime-scoped action",
    "native feed",
    "Search",
    "Library",
    "Settings",
    "exactly one `embed=native`",
    "hidden hosted public/account chrome",
    "native-shell back behavior",
    "primary Home browse surface",
    "same-origin hosted product routes escape the player boundary",
  ],
);
const auditExternalReplayStagingRowPattern = requiredTextMarker(
  "audit external evidence replay staging row: External evidence inventory replay staging hardening docs/qa-evidence/<date>/external/<sourceRunId>/<sourceArtifactId>/ final replay scaffold failed as intended decision=no-publish",
  [
    "External evidence inventory replay staging hardening",
    "docs/qa-evidence/<date>/external/<sourceRunId>/<sourceArtifactId>/",
    "final replay",
    "scaffold",
    "failed as intended",
    "decision=no-publish",
  ],
);
const focusedPlayerVerificationMatrixPattern =
  /### Focused Player Verification Matrix[\s\S]{0,900}features\/player\/useGsavEmbedHost\.test\.ts[\s\S]{0,160}features\/player\/bridge\.test\.ts[\s\S]{0,160}features\/player\/progressBridge\.test\.ts[\s\S]{0,220}scripts\/gsav-native-runtime-smoke\.test\.mjs[\s\S]{0,160}scripts\/gsav-native-preflight\.test\.mjs/i;
const handoffReceiptsBlockerCommandPattern =
  /npm run verify:handoff-receipts[\s\S]{0,180}--date <YYYY-MM-DD>[\s\S]{0,120}--allow-pending[\s\S]{0,180}--output-path docs\/qa-evidence\/<date>\/handoff-receipts-blocker\.json/i;
const materializeIosValidationArtifactCommandPattern =
  /node scripts\/materialize-ios-validation-artifact\.js[\s\S]{0,260}--url[\s\S]{0,180}--output-path "\$DOWNLOADED_RELEASE_DIR\/\$IOS_VALIDATION_ARTIFACT_PATH"[\s\S]{0,180}--expected-sha256/i;
const releaseOwnerChecklistHistoricalPattern =
  /### Release Owner Execution Checklist \(Historical Appendix\)[\s\S]{0,2200}non-authoritative[\s\S]{0,260}G0[\s\S]{0,80}G7/i;
const agentsNoModifyPattern =
  /AGENTS\.md[\s\S]{0,180}(?:do not overwrite or modify|must not be modified)/i;
const reviewedPacketPathLifecyclePattern =
  /reviewed\s+non-scaffold[\s\S]{0,220}(?:scaffold,\s*candidate,\s*pending,\s*or\s*example|scaffold[\s\S]{0,80}candidate[\s\S]{0,80}pending[\s\S]{0,80}example)/i;
const negativePathVerifierPassPattern =
  /(?:Negative-path verifier passes[\s\S]{0,500}expected-fail[\s\S]{0,500}(?:validation-prereq blocker|verify:validation-prereqs)[\s\S]{0,500}(?:native production-config\s+negative|Production config negative)[\s\S]{0,500}(?:known blocker inventor|known missing production env|unrelated crash|missing JSON)|expected-fail terminology[\s\S]{0,500}validation-prereq blocker[\s\S]{0,500}native production-config negative[\s\S]{0,500}negative-path verifier passes[\s\S]{0,500}(?:known blocker inventor|unrelated crash|missing JSON))/i;
const tabletDistributionSignoffPattern =
  /ios\.supportsTablet=true[\s\S]{0,420}(?:iPad\/tablet ergonomics evidence|tablet ergonomics evidence)[\s\S]{0,320}scoped\s+no-publish\s+exception[\s\S]{0,320}(?:(?:phone-only|Phone-only) WKWebView[\s\S]{0,120}not\s+enough|iOS distribution claim)/i;
const activeEvidenceGateSequencePattern =
  /(?=[\s\S]*### Active External Validation Pass Plan)(?=[\s\S]*#### Ordered Evidence Gate Sequence)(?=[\s\S]*G0 no-publish baseline)(?=[\s\S]*G1 local release-candidate health)(?=[\s\S]*G2 production host identity)(?=[\s\S]*G3 non-publishing release dry run)(?=[\s\S]*G4 validation prerequisites and exact APK)(?=[\s\S]*G5 generated metadata and installed smoke)(?=[\s\S]*G6 Android\/iOS route and negative validation)(?=[\s\S]*G7 external review and final readiness)/;
const activeG7StrictInventoryCommandPattern =
  /(?:#### Active Gate Cards[\s\S]*\| G7 \|[\s\S]{0,1800}|G7 command handoff:[\s\S]{0,1800})npm run verify:external-evidence-inventory -- --inventory-path docs\/qa-evidence\/<date>\/external-evidence-inventory\.json --qa-path docs\/GSAV_NATIVE_QA\.md --packet-path (?:<reviewed-packet\.json>|docs\/qa-evidence\/<date>\/device-evidence-packet-reviewed\.json) --require-git-integrity/i;
const activeG6G7CommandHandoffPattern = requiredTextMarker(
  "active G6/G7 command handoff: device-evidence-packet-candidate reviewed packet diveo-release-evidence-v external inventory scaffold human CLI download SHA256 last-mile prepublish --strict-final-inputs env vars final readiness receipts",
  [
    "G6 command handoff:",
    "device-evidence-packet-candidate.json",
    "device-evidence-packet-reviewed.json",
    "--dry-run-artifact diveo-release-evidence-v<version>",
    "--dry-run-run-url",
    "G7 command handoff:",
    "external-evidence-inventory-scaffold.json",
    "GitHub CLI or browser-authenticated download",
    "recompute SHA256",
    "github-release-state-prepublish.json",
    "publish-hash-variable-guard-prepublish.json",
    "DEVICE_EVIDENCE_PACKET_PATH",
    "EXTERNAL_EVIDENCE_INVENTORY_PATH",
    "--strict-final-inputs",
    "verify:final-readiness-receipts",
  ],
);
const exploreHostedExceptionContractPattern = requiredTextMarker(
  "Explore Hosted Exception Contract: Shorts-style browser mode native embed boundary verification validation exit criteria",
  [
    "### Explore Hosted Exception Contract",
    "Shorts-style runtime discovery surface",
    "features/player/ExploreScreen.tsx",
    "Browser mode",
    "YouTube Shorts",
    "full-viewport vertical feed",
    "touch/wheel/trackpad navigation",
    "keyboard controls",
    "URL/deep-link restore",
    "Native embed mode",
    "/explore?embed=native",
    "dataSaver=1",
    "same-origin hosted product paths",
    "npm run verify:import-boundaries",
    "browser Playwright desktop/mobile navigation tests",
    "Android and iOS `/explore` rows",
    "vertical swipe/scroll",
    "visible active-scene change",
    "Exit criteria to move native",
  ],
);
const boundaryOwnerMatrixPattern =
  /(?=[\s\S]*### Boundary Owner Matrix)(?=[\s\S]*React Native shell)(?=[\s\S]*Player embed boundary)(?=[\s\S]*Hosted GSAV runtime)(?=[\s\S]*Evidence review)/i;
const g0PrerequisiteEvidencePattern =
  /G0 prerequisite source evidence:[\s\S]{0,140}branch-protection[\s\S]{0,140}publish-hash guard[\s\S]{0,140}GitHub\s+release-state[\s\S]{0,140}validation-prereq blocker[\s\S]{0,140}handoff-receipts blocker[\s\S]{0,160}no-publish baseline/i;
const workflowPacketInventoryWiringPattern =
  /workflow readiness has packet\/inventory path wiring|workflow_dispatch publish_release=true[\s\S]{0,360}EXTERNAL_EVIDENCE_INVENTORY_PATH[\s\S]{0,240}DEVICE_EVIDENCE_PACKET_PATH/i;
const auditSignoffReviewedPathFieldsPattern =
  /externalEvidenceInventoryPath=docs\/qa-evidence\/<date>\/external-evidence-inventory\.json[\s\S]{0,240}deviceEvidencePacketPath=<reviewed-packet\.json>/i;
const catalogCompositionBoundaryPattern =
  /Scene composition boundary[\s\S]{0,500}Catalog should pass IDs[\s\S]{0,500}social stores[\s\S]{0,180}player resume state[\s\S]{0,180}bridge state[\s\S]{0,180}Supabase clients[\s\S]{0,180}follow reconciliation rules[\s\S]{0,500}verify:import-boundaries[\s\S]{0,260}direct catalog-composition guard/i;
const nativeWebViewRouteGatePattern =
  /Native WebView route gate[\s\S]{0,500}configured GSAV origin[\s\S]{0,260}embedded hosted route allowlist[\s\S]{0,500}same-origin hosted catalog\/account\/studio\/upload paths[\s\S]{0,500}Navigation blocked[\s\S]{0,500}Focused player tests cover/i;
const sameOriginFailClosedReleasePolicyPattern =
  /same-origin[\s\S]{0,220}(?:hosted\s+)?product paths[\s\S]{0,220}fail closed[\s\S]{0,180}for this release[\s\S]{0,320}future native handoff requires ADR 0002[\s\S]{0,220}features\/player\/nativeNavigation\.ts[\s\S]{0,260}no-publish pass/i;
const sameOriginQaFailClosedPattern =
  /same-origin native-owned hosted product paths fail closed[\s\S]{0,160}Navigation blocked[\s\S]{0,120}for this release/i;
const sameOriginQaControlTriggerPattern = requiredTextMarker(
  "same-origin product-path QA control trigger: /gsav-diagnostics EXPO_PUBLIC_GSAV_QA_CONTROLS=1 tap `Same-origin` /creator/qa-native-blocked sameOriginProductPathOutcome negative readiness row",
  [
    "/gsav-diagnostics",
    "EXPO_PUBLIC_GSAV_QA_CONTROLS=1",
    "tap `Same-origin`",
    "/creator/qa-native-blocked",
    "sameOriginProductPathOutcome",
    "negative readiness row",
  ],
);
const sameOriginPacketVerifierPattern = requiredTextMarker(
  "same-origin packet verifier: device-evidence:packet --check sameOriginProductPathOutcome Same-origin /creator/qa-native-blocked Navigation blocked",
  [
    "device-evidence:packet --check",
    "sameOriginProductPathOutcome",
    "Same-origin",
    "/creator/qa-native-blocked",
    "Navigation blocked",
  ],
);
const targetModuleStructurePattern = requiredTextMarker(
  "target module structure: app features/app-shell native feature modules features/player shared services implemented ContinueWatchingPill cleanup",
  [
    "Target module structure:",
    "`app/`",
    "One-line Expo Router adapters",
    "`features/app-shell/`",
    "Bootstrap, providers",
    "`features/catalog/`, `features/social/`, `features/settings/`, `features/preferences/`, `features/scene/`, `features/app-update/`",
    "Native product surfaces",
    "`features/player/`",
    "Only WebView/iframe host",
    "`shared/`",
    "Pure route/config/auth-return/theme/UI primitives",
    "`services/`",
    "Thin vendor/client adapters",
    "Structure cleanup implemented locally",
    "ContinueWatchingPill",
    "resumeAccess",
    "exposes only resume state",
    "catalog owns placement and presentation",
  ],
);
const publicContractInventoryPattern = requiredTextMarker(
  "public contract inventory: resumeAccess authSession savedSceneAccess preferenceAccess updateAccess sceneShare social UI composition shared route helpers verification validation",
  [
    "Public contract inventory:",
    "features/player/resumeAccess.ts",
    "features/social/authSession.ts",
    "features/social/savedSceneAccess.ts",
    "features/preferences/preferenceAccess.ts",
    "features/app-update/updateAccess.ts",
    "features/scene/sceneShare.ts",
    "features/social/FollowButton.tsx",
    "features/social/SaveSceneButton.tsx",
    "shared/routeParams.ts",
    "shared/gsavRoutes.ts",
    "shared/gsavWeb.ts",
    "Verification and validation",
  ],
);
const postReleaseEleganceTargetPattern = requiredTextMarker(
  "post-release elegance target: reduce sibling allowlist below 12 props or facades access contracts verify import boundaries product-journey evidence",
  [
    "Post-release elegance target:",
    "reduce the sibling allowlist below 12",
    "props or facades",
    "access contracts",
    "npm run verify:import-boundaries",
    "product-journey evidence",
  ],
);
const continueWatchingPillCleanupPattern =
  /features\/catalog\/ContinueWatchingPill\.tsx[\s\S]{0,260}Catalog-owned[\s\S]{0,260}features\/player\/resumeAccess\.ts[\s\S]{0,260}resume state\/action contract/i;
const historicalPhaseHeadingsPattern =
  /## Phase 1 - Preserve The Baseline \(Historical Appendix \/ Local Rehearsal Only\)[\s\S]*## Phase 8 - Refine The Dependency Graph \(Historical Appendix \/ Local Rehearsal Only\)/;
const fixedEvidenceLogRowSetPattern =
  /(?=[\s\S]*fixed\s+(?:row\s+set|30\s+publish-readiness))(?=[\s\S]*30\s+publish-readiness)(?=[\s\S]*Host\s+preflight)(?=[\s\S]*GSAV\s+target\s+routes)/i;
const currentPendingEvidencePattern = new RegExp(
  `${EXPECTED_RELEASE_READINESS_CHECKED} checked rows[\\s\\S]{0,160}`
    + `(?:${EXPECTED_PENDING_PUBLISH_ROWS} pending publish evidence rows`
    + `|${EXPECTED_PENDING_PUBLISH_ROWS} publish evidence rows pending)`,
);
const noPublishBaselineScopePattern =
  /scope=pre-g3-no-publish-baseline[\s\S]{0,260}(?:invalidAfter=first Release APK workflow_dispatch fixed-candidate dry run|fixed-candidate[\s\S]{0,120}dry run)/i;
const remoteDeviceValidationWorkflowStatePattern =
  /(?=[\s\S]*(?:deviceValidationWorkflowPresent|release-state (?:blocker|JSON)[\s\S]{0,140}(?:remote\s+)?`?Device Validation`?\s+workflow))(?=[\s\S]*(?:local or untracked|active on GitHub|no-publish blocker))/i;
const activeReadPathPattern = requiredTextMarker(
  "Active read path: ADR 0002 shell architecture Ordered Evidence Gate Sequence G0 through G7 QA audit final decision",
  [
    "Active read path:",
    "ADR 0002",
    "docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md",
    "Ordered Evidence Gate Sequence",
    "G0",
    "G7",
    "docs/GSAV_NATIVE_QA.md",
    "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
    "final publish or no-publish decision",
  ],
);
const detailedImplementationRoadmapPattern = requiredTextMarker(
  "Detailed Implementation Roadmap: reviewer lenses W0 W5 R0 R7 G0 through G7 decision=no-publish",
  [
    "### Detailed Implementation Roadmap",
    "Reviewer lenses for this pass:",
    "Detailed V&V workstream plan:",
    "W0 boundary lock",
    "W5 release validation sequence",
    "R0 structure lock",
    "R7 final review and release decision",
    "G0",
    "G7",
    "decision=no-publish",
  ],
);
const canonicalReleaseDryRunDispatchPattern = requiredTextMarker(
  "canonical release dry-run dispatch uses gh workflow run Release APK -R OpsiClear-Web/diveo candidate_ref publish_release=false run ID",
  [
    "gh workflow run \"Release APK\"",
    "-R OpsiClear-Web/diveo",
    "candidate_ref=<payload-sha>",
    "publish_release=false",
    "select the completed",
    "run ID",
  ],
);
const releaseStructureLockPattern =
  /### Release Structure Lock[\s\S]{0,1400}Expo web iframe evidence remains rehearsal-only/i;
const validationPromotionMapPattern =
  /Validation promotion map:[\s\S]{0,6000}G7 final review and signoff[\s\S]{0,1200}verify:final-readiness-receipts/i;
const g7PublishHoldDecisionPattern = requiredTextMarker(
  "G7 passes only with decision=publish; decision=no-publish hold or rehearsal; --expect-readiness-fail rehearsal only",
  [
    "G7 passes only with `decision=publish`",
    "`decision=no-publish` remains a valid hold or rehearsal state",
    "`--expect-readiness-fail`",
    "rehearsal only",
  ],
);
const finalEvidenceFilenameMapPattern = requiredTextMarker(
  "Final evidence filename map: static prepublish JSON live final-command receipts verification summary release-evidence guards",
  [
    "Final evidence filename map:",
    "docs/qa-evidence/<date>/github-release-state-prepublish.json",
    "docs/qa-evidence/<date>/publish-hash-variable-guard-prepublish.json",
    "docs/qa-evidence/<date>/final-command-receipts/github-release-state-prepublish-live.json",
    "docs/qa-evidence/<date>/final-command-receipts/publish-hash-variable-guard-prepublish-live.json",
    "docs/qa-evidence/<date>/final-command-receipts/verification-summary.json",
    "noPublishRehearsal=false",
    "release-evidence/github-release-state-prepublish.json",
    "release-evidence/publish-hash-variable-guard-prepublish.json",
  ],
);
const reviewedDevicePacketSchemaPattern =
  /Reviewed device packet minimum schema:[\s\S]{0,1800}helperOnly=false[\s\S]{0,500}same-candidate proof/i;
const operatorExecutionSequencePattern = requiredTextMarker(
  "Operator execution sequence: three-agent architecture decision G0/G1 baseline G3 dry run G6 device/product validation G7 final receipts local-only evidence cannot promote publish rows",
  [
    "Operator execution sequence:",
    "three-agent review",
    "React Native product shell plus single player embed boundary",
    "never promote a publish row",
    "local-only evidence",
    "G0/G1 local baseline",
    "G3 dry-run artifact",
    "G6 device/product validation",
    "G7 final receipts",
    "noPublishRehearsal=false",
  ],
);
const productJourneyInventoryExpansionPattern =
  /product-journey-manifest\.json[\s\S]{0,900}(?:every manifest entry `?evidencePaths`? item|each manifest entry evidence path)[\s\S]{0,320}reviewed[\s\S]{0,240}(?:byte-hashed|SHA256-backed|hashed inventory entries)/i;
productJourneyInventoryExpansionPattern.description =
  "product-journey-manifest evidencePaths inventory expansion: every manifest entry evidencePaths item reviewed as byte-hashed inventory entries";
const negativeTriggerMatrixPattern =
  /Negative trigger matrix:[\s\S]{0,2200}production no-QA-flag proof[\s\S]{0,2200}Ended playback/i;
const externalArtifactReviewProcedurePattern =
  /External artifact review procedure:[\s\S]{0,1300}strict git-integrity replay/i;
const externalArtifactReplayStagingPattern = requiredTextMarker(
  "external artifact replay staging layout: docs/qa-evidence/<date>/external/<sourceRunId>/<sourceArtifactId>/ downloadedPath sourceRunId sourceArtifactId",
  [
    "docs/qa-evidence/<date>/external/<sourceRunId>/<sourceArtifactId>/",
    "downloadedPath",
    "sourceRunId",
    "sourceArtifactId",
  ],
);
const evidenceInvalidationRulesPattern = requiredTextMarker(
  "Evidence invalidation rules: return rows pending refresh packets rerun docs drift inventory replay packet check candidate-pinned readiness mark rows stale repeat affected gate",
  [
    "Evidence invalidation rules:",
    "Payload SHA",
    "Return G3-G5 rows to pending",
    "GSAV host URL",
    "Route ownership",
    "Device OS",
    "QA schema",
    "Rerun docs drift",
    "inventory replay",
    "packet check",
    "candidate-pinned readiness",
    "Mark rows stale",
    "repeat the affected gate",
  ],
);
const currentExecutionSnapshotPattern =
  /(?=[\s\S]*### Current Execution Snapshot)(?=[\s\S]*Current status[\s\S]{0,160}no-publish)(?=[\s\S]*Canonical operator path:)(?=[\s\S]*External artifact materialization[\s\S]{0,520}downloadedPath[\s\S]{0,160}sha256[\s\S]{0,160}sourceRunId[\s\S]{0,160}sourceArtifactId)(?=[\s\S]*Packet lifecycle[\s\S]{0,520}reviewed non-scaffold packet[\s\S]{0,260}product-journey-manifest\.json)(?=[\s\S]*Final local gate[\s\S]{0,420}verify:final-readiness-receipts[\s\S]{0,260}canonical final wrapper)(?=[\s\S]*Freshness rule:[\s\S]{0,300}same-candidate[\s\S]{0,140}non-future-dated[\s\S]{0,300}recaptured)/i;

const activeDocs = {
  "README.md": [
    /React Native owns the mobile product shell/,
    /\.\.\/gsav-hosting\/apps\/web` owns the browser-only GSAV runtime/,
    /embed=native/,
    /npm run verify:local/,
    /docs\/IMPLEMENTATION_VALIDATION_AUDIT\.md/,
    /publish\/no-publish decision/,
  ],
  "README.en.md": [
    /React Native owns the mobile product shell/,
    /\.\.\/gsav-hosting\/apps\/web` owns the browser-only GSAV runtime/,
    /embed=native/,
    /npm run verify:local/,
    /docs\/IMPLEMENTATION_VALIDATION_AUDIT\.md/,
    /publish\/no-publish decision/,
  ],
  "CONTRIBUTING.md": [
    /GSAV-native product/,
    /Bilibili client surface is\s+frozen legacy/,
    /npm ci/,
    /npm run verify:docs-drift/,
    /npm test -- scripts\/verify-doc-drift\.test\.mjs/,
    /npm run verify:whitespace/,
    /npm run verify:no-publish-baseline/,
    /npm run verify:workflows/,
    /npm run verify:local/,
    /npm run verify:release-candidate/,
    noPublishBaselineScopePattern,
    /npm run verify:validation-prereqs/,
    downloadedValidationPrereqsCommandPattern,
    /npm run verify:native-production-config/,
    /npm run gsav:runtime-smoke/,
    /npm run android:version-metadata/,
    /--expected-version-code/,
    /--production-host-url/,
    /productionHostReleaseReady=true/,
    /trusted iOS artifact URL/,
    /64-hex iOS artifact SHA256/,
    externalEvidenceInventoryPattern,
    externalEvidenceInventoryStrictPattern,
    auditSignoffReviewedPathFieldsPattern,
    finalReadinessReceiptsPattern,
    rawReadinessDiagnosticPattern,
  ],
  ".github/PULL_REQUEST_TEMPLATE.md": [
    /npm ci/,
    /npm run verify:local/,
    /npm run verify:native-production-config/,
    /npm run gsav:preflight/,
    /GSAV_RANGE_PROBE_URL/,
    /npm run verify:release-candidate/,
    /npm run verify:validation-prereqs/,
    downloadedValidationPrereqsCommandPattern,
    /npm run verify:release-artifact/,
    /npm run android:installed-smoke/,
    /--production-host-url/,
    /productionHostReleaseReady=true/,
    /npm run android:version-metadata/,
    /--expected-version-code/,
    /npm run release-evidence:attach-validation-prereqs/,
    /npm run verify:release-evidence-bundle/,
    externalEvidenceInventoryPattern,
    externalEvidenceInventoryStrictPattern,
    finalReadinessReceiptsPattern,
    auditSignoffReviewedPathFieldsPattern,
    rawReadinessDiagnosticPattern,
    /npm run gsav:runtime-smoke/,
    /--output-path/,
    /docs\/qa-evidence\/<date>/,
    /npm test -- scripts\/verify-doc-drift\.test\.mjs/,
    /npm run verify:whitespace/,
    /npm run verify:no-publish-baseline/,
    /docs\/IMPLEMENTATION_VALIDATION_AUDIT\.md/,
    /owner placeholders/,
    /evidence artifact review signoff/,
    /downloaded checksum-manifest SHA256/,
    /publish\/no-publish decision/,
    /route\/negative iOS evidence may be committed `docs\/qa-evidence` files, trusted `docs\/qa-evidence` blobs, or direct artifact\/download URLs with manifest and checksum proof/,
    /IOS_VALIDATION_ARTIFACT_URL/,
    /IOS_VALIDATION_ARTIFACT_SHA256/,
    /ios_validation_artifact_url/,
    /ios_validation_artifact_sha256/,
  ],
  ".env.example": [
    /EXPO_PUBLIC_GSAV_WEB_URL/,
    /native catalog browse\/search\/creator surfaces/,
    /EXPO_PUBLIC_GSAV_CATALOG_URL/,
    /EXPO_PUBLIC_GSAV_SUPABASE_URL/,
    /EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY/,
    /EXPO_PUBLIC_GSAV_QA_CONTROLS/,
    /EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS/,
    /EXPO_PUBLIC_APP_ENV/,
  ],
  "docs/GSAV_NATIVE_SHELL_ARCHITECTURE.md": [
    /native mobile app that embeds the GSAV web runtime/,
    /embed=native/,
    /features\/player\/GsavWebView\.tsx/,
    /http:\/\/10\.0\.2\.2:5191/,
    /host\s+LAN URL/,
    /npm run verify:native-production-config/,
    /npm run gsav:runtime-smoke/,
    sameOriginFailClosedReleasePolicyPattern,
    continueWatchingPillCleanupPattern,
    /Keep `\/explore` as an intentional hosted runtime route/,
  ],
  "docs/GSAV_NATIVE_QA.md": [
    /React Native owns the\s+product shell, native navigation, browse, search, library, auth, saved\/follow,\s+and settings surfaces/,
    /\.\.\/gsav-hosting\/apps\/web` owns GSAV\s+decode\/render\/playback\/runtime chrome/,
    /Intentional hosted runtime route loads `\/explore\?embed=native`/,
    /trusted GitHub CI\/artifact\/release URL\s+under `opsiclear\/diveo`, `OpsiClear-Web\/diveo`, or `opsiclear\/gsav-hosting`/,
    /row detail evidence URLs?[\s\S]*trusted GitHub evidence/,
    /comma- or semicolon-separated entry/,
    /tracked and committed/,
    productJourneyInventoryExpansionPattern,
    productJourneyDistinctPlatformEvidencePattern,
    productJourneyUniqueEntryIdsPattern,
    productJourneyInventoryEntryIdReplayPattern,
    productJourneyInventoryExpansionValidityPattern,
    productJourneyInventoryClassificationPattern,
    productJourneyManifestContentClassificationPattern,
    productJourneyLinkedEvidenceClassificationPattern,
    productJourneySameDateInventoryPattern,
    routeNegativeManifestSameDatePattern,
    packetLocalEvidenceSameDatePattern,
    productJourneyScaffoldHintsPattern,
    productJourneyFixtureContentReplayPattern,
    productJourneySemanticSignalsPattern,
    releaseTagContextOnlyPattern,
    /## Release Target Scope/,
    /Android publish readiness plus Android and iOS embedded\s+route\s+validation/,
    tabletDistributionSignoffPattern,
    /## Signed-In Test Account/,
    /release-owned test account/,
    /redacted/,
    /local emulator or simulator URLs[\s\S]{0,160}rehearsal evidence only/i,
    /Publish-counted Android\s+and iOS rows[\s\S]{0,240}(?:production HTTPS GSAV host|release-equivalent staging)[\s\S]{0,240}scoped no-publish\s+blocker/i,
    sameOriginQaFailClosedPattern,
    sameOriginQaControlTriggerPattern,
    sameOriginPacketVerifierPattern,
    /release-evidence\/native-production-config-before-bump\.json/,
    /release-evidence\/native-production-config-after-bump\.json/,
    /release-evidence\/version\.txt/,
    /release-evidence\/app-version-metadata\.json/,
    /release-evidence\/gradle-version-code\.txt/,
    /release-evidence\/release-artifact\.json/,
    /release-evidence\/apk-version-metadata\.txt/,
    /--expected-version-code/,
    /release-evidence\/dry-run-summary\.json/,
    /release-evidence\/evidence-checksums\.txt/,
    /release-evidence\/no-publish-side-effect\.txt/,
    releaseEvidenceArtifactNamePattern,
    publishArtifactIdentityPattern,
    summaryCandidateIdentityPattern,
    uploadFailsOnMissingEvidencePattern,
    /--root "\$DOWNLOADED_RELEASE_DIR" --apk-path "\$APK_PATH" --manifest-path "\$MANIFEST_PATH" --ios-artifact-path "\$IOS_VALIDATION_ARTIFACT_PATH" --output-path "\$VALIDATION_PREREQS_PATH"/,
    /\$DOWNLOADED_RELEASE_DIR\/\$VALIDATION_PREREQS_PATH/,
    /ios_validation_owner|iOS validation owner/,
    /ios_validation_executor_proof|executor proof/,
    /ios_validation_device|device identity/,
    /ios_validation_version|iOS version/,
    /ios_wkwebview_version|WKWebView\/WebKit version/,
    /ios_validation_artifact_url/,
    /ios_validation_artifact_sha256/,
    /IOS_VALIDATION_ARTIFACT_URL/,
    /IOS_VALIDATION_ARTIFACT_SHA256/,
    /trusted iOS artifact URL/,
    /64-hex iOS artifact SHA256/,
    /npm run verify:validation-prereqs/,
    /connected `adb devices` proof/,
    /GitHub CLI/,
    /generated APK metadata tooling/,
    /iOS validation owner/,
    /macOS\/Xcode\/`xcrun`|macOS\/Xcode\/xcrun|physical iOS-device proof/,
    /iOS simulator\/device identity|iOS simulator\/device=/,
    /WKWebView\/WebKit version|iOS WKWebView version/,
    /\$DOWNLOADED_RELEASE_DIR\/\$VALIDATION_PREREQS_PATH/,
    /release-evidence\/validation-prereqs\.json/,
    /npm run release-evidence:attach-validation-prereqs/,
    /device-validation-evidence\/device-validation-bundle-verifier\.json/,
    /downloaded-release\/release-evidence\/\*\*/,
    releaseEvidenceContainedIosPrereqPattern,
    deviceValidationDispatchInputPattern,
    deviceValidationIosArtifactInputPattern,
    deviceValidationArtifactIdentityPattern,
    deviceValidationUploadNamePattern,
    remoteDeviceValidationWorkflowStatePattern,
    /--root "\$DOWNLOADED_RELEASE_DIR"/,
    /--require-validation-prereqs true/,
    /Evidence path cell must contain only accepted paths or URLs/,
    /7-day freshness window/,
    /--output-path/,
    /--production-host-url/,
    /productionHostReleaseReady=true/,
    /Scoped exception fields/,
    /releaseCandidateSha[\s\S]*candidate_ref[\s\S]*evidenceSignoffSha/,
    /Evidence path cell[\s\S]*workflow run URL|workflow run URL[\s\S]*Evidence path cell/,
    /## Negative Fixture Inventory/,
    /EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS/,
    /release-candidate\.txt/,
    /GSAV_HOSTING_COMMIT/,
    /GSAV_HOST_IDENTITY_URL/,
    /hostIdentityVerified=true/,
    /hostIdentity\.url/,
    /hostIdentity\.expectedIdentity/,
    /observedIdentity.*GSAV_HOSTING_COMMIT|GSAV_HOSTING_COMMIT.*observedIdentity/,
    /Access-Control-Expose-Headers/,
    /checksum-manifest SHA/,
    /artifact review signoff/,
    /Branch protection/,
    /quality\s*\/\s*quality/,
    /Master branch protection/,
    artifactReviewArtifactIdentityPattern,
    /reviewed timestamp|reviewedAt/,
    /GitHub run conclusion/,
    /downloaded checksum-manifest SHA256/,
    /verify:release-evidence-bundle.*downloaded (?:bundle|artifact)|downloaded (?:bundle|artifact).*verify:release-evidence-bundle|bundle-verifier rerun against the downloaded artifact/,
    /npm run verify:release-readiness/,
    devicePacketExamplePattern,
    localEvidenceManifestHashPattern,
    routeNegativeManifestContentClassificationPattern,
    localMediaEvidenceHashPattern,
    externalArtifactReplayStagingPattern,
    noPublishBaselineScopePattern,
    fixedEvidenceLogRowSetPattern,
    externalEvidenceInventoryScaffoldPattern,
    externalEvidenceInventoryPattern,
    externalEvidenceInventoryStrictPattern,
    packetLocalEvidenceSameDatePattern,
    finalReadinessReceiptsPattern,
    finalReceiptPublishReadyPattern,
    finalReceiptLastMileLivePathBindingPattern,
    finalReceiptLastMileReviewBindingPattern,
    finalReceiptReviewerSourceFailFastPattern,
    finalReceiptSummaryTimingPattern,
    finalReceiptPassSummaryContradictionPattern,
    finalReceiptInputFailFastPattern,
    finalReceiptEvidenceDirFailFastPattern,
    finalReceiptInventoryFailFastPattern,
    finalReceiptRunUrlRepositoryBindingPattern,
    finalReceiptReleaseStateQueryRepositoryBindingPattern,
    finalReceiptLiveLastMileJsonBindingPattern,
    finalReceiptLiveOutputCreationPattern,
    finalReceiptPublishHashQueryRepositoryBindingPattern,
    finalReceiptStepLogByteReplayPattern,
    finalReceiptStepSetPattern,
    finalReceiptStepStatusPattern,
    finalReceiptReadinessEnvPattern,
    finalReceiptInternalCommandPattern,
    productJourneyManifestRequiredIdsPattern,
    reviewedPacketPathLifecyclePattern,
    productJourneyUniqueEntryIdsPattern,
    productJourneyInventoryEntryIdReplayPattern,
    productJourneyInventoryExpansionValidityPattern,
    productJourneyInventoryClassificationPattern,
    productJourneyManifestContentClassificationPattern,
    productJourneyFixtureInventoryPattern,
    productJourneyFixtureContentReplayPattern,
    productJourneyLinkedEvidenceClassificationPattern,
    productJourneySemanticSignalsPattern,
    productJourneyExploreRestraintPattern,
    gsavPackageProvenancePattern,
    externalReviewLedgerCoveragePattern,
    externalReviewLedgerRowQualityPattern,
    externalReviewLedgerConcreteProofPattern,
    /docs\/qa-evidence\/<date>/,
  ],
  "docs/adr/0002-native-app-with-web-player.md": [
    /Status:\*\* Accepted/,
    /Supersedes:\*\* Runtime and native catalog\/product-surface ownership portions\s+of `0001-gsav-pivot\.md`/,
    /React Native owns:/,
    /gsav-hosting owns:/,
    /`\/explore` remains an intentional hosted runtime route/,
    /embed=native/,
    /npm run verify:import-boundaries/,
    /npm run verify:docs-drift/,
    /npm run verify:release-readiness/,
  ],
  "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md": [
    activeReadPathPattern,
    currentExecutionSnapshotPattern,
    detailedImplementationRoadmapPattern,
    /### Work Package Map/,
    activeEvidenceGateSequencePattern,
    negativePathVerifierPassPattern,
    tabletDistributionSignoffPattern,
    /WP-1 architecture contract/,
    /WP-8 publish readiness/,
    /QA fixture controls are platform-scoped/,
    /features\/player\/GsavWebView\.web\.tsx/,
    /ignores it because the iframe host has no native overlay controls/,
    /services\/gsav\.ts.*allowed catalog facade|allowed catalog facade.*services\/gsav\.ts/,
    /### Release Evidence Bundle File List/,
    agentsNoModifyPattern,
    /native-production-config-before-bump\.json/,
    /native-production-config-after-bump\.json/,
    /app-version-metadata\.json/,
    /gradle-version-code\.txt/,
    /release-artifact\.json/,
    /apk-version-metadata\.txt/,
    /--expected-version-code/,
    /dry-run-summary\.json/,
    /evidence-checksums\.txt/,
    /no-publish-side-effect\.txt/,
    /ios_validation_owner/,
    /ios_validation_executor_proof/,
    /ios_validation_device/,
    /ios_validation_version/,
    /ios_wkwebview_version/,
    /ios_validation_artifact_url/,
    /ios_validation_artifact_sha256/,
    /IOS_VALIDATION_ARTIFACT_URL/,
    /IOS_VALIDATION_ARTIFACT_SHA256/,
    /trusted iOS artifact URL/,
    /64-hex iOS artifact SHA256/,
    /RELEASE_EVIDENCE_MODE/,
    /frozen candidate SHA|frozen payload candidate/,
    /features\/scene\/\s+shared scene presentation, scene types, share helpers/,
    /## Architecture Snapshot/,
    /Route stub map:/,
    /## Implementation Work Packages/,
    /### Validation Owner Assignment/,
    /### Current Execution Board \(Runbook Appendix\)/,
    /### Canonical Release Evidence Order \(Superseded Historical Appendix\)/,
    /### Canonical Command Snippets/,
    /### Detailed Execution Plan \(Historical Appendix\)/,
    exploreHostedExceptionContractPattern,
    boundaryOwnerMatrixPattern,
    canonicalReleaseDryRunDispatchPattern,
    releaseStructureLockPattern,
    g0PrerequisiteEvidencePattern,
    noPublishBaselineScopePattern,
    remoteDeviceValidationWorkflowStatePattern,
    operatorExecutionSequencePattern,
    g7PublishHoldDecisionPattern,
    finalEvidenceFilenameMapPattern,
    validationPromotionMapPattern,
    activeG7StrictInventoryCommandPattern,
    activeG6G7CommandHandoffPattern,
    handoffReceiptsBlockerCommandPattern,
    reviewedDevicePacketSchemaPattern,
    productJourneyInventoryExpansionPattern,
    productJourneySameDateInventoryPattern,
    productJourneyScaffoldHintsPattern,
    negativeTriggerMatrixPattern,
    externalArtifactReviewProcedurePattern,
    routeNegativeManifestContentClassificationPattern,
    routeNegativeManifestSameDatePattern,
    packetLocalEvidenceSameDatePattern,
    externalArtifactReplayStagingPattern,
    evidenceInvalidationRulesPattern,
    workflowPacketInventoryWiringPattern,
    auditSignoffReviewedPathFieldsPattern,
    catalogCompositionBoundaryPattern,
    nativeWebViewRouteGatePattern,
    sameOriginFailClosedReleasePolicyPattern,
    sameOriginQaControlTriggerPattern,
    sameOriginPacketVerifierPattern,
    targetModuleStructurePattern,
    publicContractInventoryPattern,
    postReleaseEleganceTargetPattern,
    continueWatchingPillCleanupPattern,
    historicalPhaseHeadingsPattern,
    fixedEvidenceLogRowSetPattern,
    /Local rehearsal may use the emulator\/simulator URLs[\s\S]{0,260}Publish-counted\s+Android\/iOS rows[\s\S]{0,260}(?:production HTTPS|release-equivalent staging)/i,
    /Release-candidate identity rule/,
    /## GSAV Host Handoff Contract/,
    /GSAV_HOSTING_COMMIT/,
    /GSAV_HOST_IDENTITY_URL/,
    /hostIdentityVerified=true/,
    /hostIdentity\.url/,
    /hostIdentity\.expectedIdentity/,
    /observedIdentity.*GSAV_HOSTING_COMMIT|GSAV_HOSTING_COMMIT.*observedIdentity/,
    /Access-Control-Expose-Headers/,
    /release-evidence\/gsav-preflight\.json/,
    /release-candidate\.txt/,
    /--target/,
    /--output-path/,
    /Exception policy: exceptions are temporary validation blockers/,
    /mismatched exception gates/,
    /npm run verify:local/,
    /npm run verify:release-candidate/,
    /npm run verify:validation-prereqs/,
    /\$DOWNLOADED_RELEASE_DIR\/\$VALIDATION_PREREQS_PATH/,
    /device-validation\.yml/,
    /release-evidence\/validation-prereqs\.json/,
    /npm run release-evidence:attach-validation-prereqs/,
    /device-validation-evidence\/device-validation-bundle-verifier\.json/,
    /downloaded-release\/release-evidence\/\*\*/,
    releaseEvidenceContainedIosPrereqPattern,
    materializeIosValidationArtifactCommandPattern,
    deviceValidationDispatchInputPattern,
    deviceValidationIosArtifactInputPattern,
    deviceValidationArtifactIdentityPattern,
    deviceValidationUploadNamePattern,
    /--root "\$DOWNLOADED_RELEASE_DIR"/,
    /--require-validation-prereqs true/,
    /npm run verify:workflows/,
    devicePacketExamplePattern,
    localEvidenceManifestHashPattern,
    localMediaEvidenceHashPattern,
    externalEvidenceInventoryScaffoldPattern,
    externalEvidenceInventoryPattern,
    externalEvidenceInventoryStrictPattern,
    packetLocalEvidenceSameDatePattern,
    finalReadinessReceiptsPattern,
    finalReceiptPublishReadyPattern,
    finalReceiptLastMileLivePathBindingPattern,
    finalReceiptLastMileReviewBindingPattern,
    finalReceiptReviewerSourceFailFastPattern,
    finalReceiptSummaryTimingPattern,
    finalReceiptPassSummaryContradictionPattern,
    finalReceiptInputFailFastPattern,
    finalReceiptEvidenceDirFailFastPattern,
    finalReceiptInventoryFailFastPattern,
    finalReceiptRunUrlRepositoryBindingPattern,
    finalReceiptReleaseStateQueryRepositoryBindingPattern,
    finalReceiptLiveLastMileJsonBindingPattern,
    finalReceiptLiveOutputCreationPattern,
    finalReceiptPublishHashQueryRepositoryBindingPattern,
    finalReceiptStepLogByteReplayPattern,
    finalReceiptStepSetPattern,
    finalReceiptStepStatusPattern,
    finalReceiptReadinessEnvPattern,
    finalReceiptInternalCommandPattern,
    productJourneyManifestRequiredIdsPattern,
    productJourneyDistinctPlatformEvidencePattern,
    productJourneyUniqueEntryIdsPattern,
    productJourneyInventoryEntryIdReplayPattern,
    productJourneyInventoryExpansionValidityPattern,
    productJourneyInventoryClassificationPattern,
    productJourneyManifestContentClassificationPattern,
    productJourneyFixtureInventoryPattern,
    productJourneyFixtureContentReplayPattern,
    productJourneyLinkedEvidenceClassificationPattern,
    productJourneySemanticSignalsPattern,
    productJourneyExploreRestraintPattern,
    focusedPlayerVerificationMatrixPattern,
    /npm run android:version-metadata/,
    /--expected-version-code/,
    /--production-host-url/,
    /productionHostReleaseReady=true/,
    rawReadinessDiagnosticPattern,
    /Publish ceremony:/,
    /Feature contract ledger for the current sibling allowlist:/,
    /The current sibling allowlist budget is 12 entries/,
    /shared\/themeContext\.tsx/,
    /required observed-signal, candidate-identity, artifact, range-probe, dry-run, and checksum details/,
    /trusted GitHub CI\/artifact\/release URL under `opsiclear\/diveo`, `OpsiClear-Web\/diveo`, or `opsiclear\/gsav-hosting`/,
    /row detail evidence URLs?[\s\S]*trusted GitHub evidence/,
    releaseTagContextOnlyPattern,
    /unsupported mixed evidence entries/,
    /7-day freshness window/,
    /releaseCandidateSha[\s\S]*candidate_ref[\s\S]*evidenceSignoffSha/,
    /same run ID/,
    releaseEvidenceArtifactNamePattern,
    publishArtifactIdentityPattern,
    localMediaEvidenceHashPattern,
    externalEvidenceInventoryScaffoldPattern,
    externalEvidenceInventoryPattern,
    reviewedPacketPathLifecyclePattern,
    gsavPackageProvenancePattern,
    summaryCandidateIdentityPattern,
    uploadFailsOnMissingEvidencePattern,
    /releaseWorkflowForbidsQaFlags/,
    /qaControlsDisabled/,
    /qaAuthDelayDisabled/,
    /expired\s+`acceptedRisk\.revisitBy` blocks automatically/,
    /@opsiclear\/native-release/,
    /### Release Owner Execution Checklist/,
    releaseOwnerChecklistHistoricalPattern,
    /exact APK/,
    /release-owned test account/,
    /human release owner/,
    /GitHub CLI/,
    /adb devices.*device.*state/,
    /aapt.*apkanalyzer.*bundletool/,
    /iOS validation owner/,
    /macOS\/Xcode\/`xcrun`|macOS\/Xcode\/xcrun|physical iOS-device proof/,
    /iOS simulator\/device identity|iOS simulator\/device/,
    /WKWebView\/WebKit version|iOS WKWebView version/,
    /artifact-review signoff|artifact review signoff/,
    /Branch protection/,
    /quality\s*\/\s*quality/,
    /Master branch protection/,
    artifactReviewArtifactIdentityPattern,
    /reviewed timestamp|reviewedAt/,
    /GitHub run conclusion/,
    /downloaded checksum-manifest SHA256/,
    auditSignoffReviewedPathFieldsPattern,
    /verify:release-evidence-bundle.*downloaded (?:bundle|artifact)|downloaded (?:bundle|artifact).*verify:release-evidence-bundle|bundle-verifier rerun against the downloaded artifact/,
    /--production-host-url/,
    /productionHostReleaseReady=true/,
    externalReviewLedgerCoveragePattern,
    externalReviewLedgerRowQualityPattern,
    externalReviewLedgerConcreteProofPattern,
  ],
  "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": [
    /Current Release Blockers/,
    /Strengthened `scripts\/verify-release-readiness\.js`/,
    /publish-candidate identity/,
    /Strengthened `scripts\/verify-dependency-audit\.js`/,
    /accepted Expo\/Sentry\s+tooling-chain advisory disposition fails automatically/,
    /10 accepted moderate advisories, 0 high, 0 critical/,
    currentPendingEvidencePattern,
    /## Latest Command Summary/,
    /capturesGsavHostIdentity/,
    /GSAV_HOST_IDENTITY_URL/,
    /hostIdentityVerified=true/,
    /hostIdentity\.url/,
    /hostIdentity\.expectedIdentity/,
    /observedIdentity.*GSAV_HOSTING_COMMIT|GSAV_HOSTING_COMMIT.*observedIdentity/,
    /Access-Control-Expose-Headers/,
    /scoped fields: `gate`/,
    /release-candidate\.txt/,
    /checksum-manifest SHA/,
    /## Negative Fixture Ownership/,
    /tap `Unsupported`/,
    sameOriginQaControlTriggerPattern,
    /EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS/,
    /trusted GitHub CI\/artifact\/release URL under `opsiclear\/diveo`, `OpsiClear-Web\/diveo`, or\s+`opsiclear\/gsav-hosting`/,
    /row detail evidence URLs?[\s\S]*trusted GitHub evidence/,
    releaseTagContextOnlyPattern,
    /unsupported mixed evidence/,
    auditExternalReplayStagingRowPattern,
    /releaseWorkflowForbidsQaFlags/,
    /qaControlsDisabled/,
    /qaAuthDelayDisabled/,
    /Three-agent implementation-structure review/,
    /signed-in test-account hygiene/,
    /npm run verify:validation-prereqs/,
    /\$DOWNLOADED_RELEASE_DIR\/\$VALIDATION_PREREQS_PATH/,
    /device-validation\.yml/,
    /release-evidence\/validation-prereqs\.json/,
    /npm run release-evidence:attach-validation-prereqs/,
    /device-validation-evidence\/device-validation-bundle-verifier\.json/,
    /downloaded-release\/release-evidence\/\*\*/,
    releaseEvidenceContainedIosPrereqPattern,
    deviceValidationDispatchInputPattern,
    deviceValidationArtifactIdentityPattern,
    deviceValidationUploadNamePattern,
    remoteDeviceValidationWorkflowStatePattern,
    /--root "\$DOWNLOADED_RELEASE_DIR"/,
    /--require-validation-prereqs true/,
    /Validation executor readiness/,
    /generated APK metadata tool/,
    /GitHub CLI/,
    /Evidence artifact review signoff/,
    /Branch-protection governance/,
    /Branch protection/,
    /quality\s*\/\s*quality/,
    /Master branch protection/,
    releaseEvidenceArtifactNamePattern,
    publishArtifactIdentityPattern,
    gsavPackageProvenancePattern,
    summaryCandidateIdentityPattern,
    uploadFailsOnMissingEvidencePattern,
    artifactReviewArtifactIdentityPattern,
    /iOS validation owner/,
    /macOS\/Xcode\/`xcrun`|macOS\/Xcode\/xcrun|physical-device proof/,
    /iOS simulator\/device identity|iOS simulator or physical-device identity/,
    /WKWebView\/WebKit version|WKWebView version/,
    /trusted iOS artifact URL/,
    /64-hex iOS artifact SHA256/,
    /ios_validation_artifact_url/,
    /ios_validation_artifact_sha256/,
    /reviewed timestamp|timestamp/,
    /GitHub run conclusion/,
    /downloaded checksum-manifest SHA256/,
    /verify:release-evidence-bundle.*downloaded (?:bundle|artifact)|downloaded (?:bundle|artifact).*verify:release-evidence-bundle|exact downloaded bundle/,
    /--production-host-url/,
    /productionHostReleaseReady=true/,
    /iOS dispatch inputs|iOS validation inputs/,
    /RELEASE_EVIDENCE_MODE/,
    /frozen candidate SHA/,
    /7-day freshness window/,
    /releaseCandidateSha[\s\S]*candidate_ref[\s\S]*evidenceSignoffSha/,
    /same run ID/,
    /candidate\/version\/identity\/preflight\/runtime\/artifact\/metadata\/no-publish-summary\/bundle\/publish-artifact-identity\/upload\/readiness\/release order/,
    externalEvidenceInventoryScaffoldPattern,
    externalEvidenceInventoryPattern,
    externalEvidenceInventoryStrictPattern,
    packetLocalEvidenceSameDatePattern,
    finalReadinessReceiptsPattern,
    finalReceiptPublishReadyPattern,
    finalReceiptLastMileLivePathBindingPattern,
    finalReceiptLastMileReviewBindingPattern,
    finalReceiptReviewerSourceFailFastPattern,
    finalReceiptSummaryTimingPattern,
    finalReceiptPassSummaryContradictionPattern,
    finalReceiptInputFailFastPattern,
    finalReceiptEvidenceDirFailFastPattern,
    finalReceiptInventoryFailFastPattern,
    finalReceiptRunUrlRepositoryBindingPattern,
    finalReceiptReleaseStateQueryRepositoryBindingPattern,
    finalReceiptLiveLastMileJsonBindingPattern,
    finalReceiptLiveOutputCreationPattern,
    finalReceiptPublishHashQueryRepositoryBindingPattern,
    finalReceiptStepLogByteReplayPattern,
    finalReceiptStepSetPattern,
    finalReceiptStepStatusPattern,
    finalReceiptReadinessEnvPattern,
    finalReceiptInternalCommandPattern,
    negativePathVerifierPassPattern,
    tabletDistributionSignoffPattern,
    externalReviewLedgerCoveragePattern,
    externalReviewLedgerRowQualityPattern,
    externalReviewLedgerConcreteProofPattern,
  ],
};

const forbiddenPatterns = [
  /World A|World B|Plan B/,
  /owns ALL/i,
  /full hosted app/i,
  /scripts\/proxy\.js/,
  /app\/video/,
  /downloads\.tsx/,
  /buildAppUrl/,
  /components\/GsavWebView/,
  /utils\/gsavBridge/,
  /Finish moving remaining GSAV-native code into feature modules/i,
  /catalog\s+adapters and GSAV-specific progress state/i,
];

const docsWithHistoricalMarkers = new Set([
  "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
  "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
]);

const historicalOwnershipWarningPattern =
  /Historical ownership warning:[\s\S]{0,240}ADR 0002 supersedes[\s\S]{0,260}React Native now owns[\s\S]{0,160}native browse\/search\/creator\/library[\s\S]{0,160}product UX[\s\S]{0,260}gsav-hosting owns[\s\S]{0,160}decode\/render\/playback\/runtime[\s\S]{0,220}Do not use this file for ownership decisions/i;

const supersededDocs = {
  "docs/adr/0001-gsav-pivot.md": [
    /Superseded by ADR 0002/i,
    /not the active product contract/i,
    /GSAV_NATIVE_IMPLEMENTATION_PLAN\.md/,
  ],
  "IMPROVEMENT_PLAN.md": [
    /Superseded by `docs\/GSAV_NATIVE_IMPLEMENTATION_PLAN\.md`/i,
    /historical/i,
    /not the active release runbook/i,
    historicalOwnershipWarningPattern,
  ],
  "IMPROVEMENT_CHECKLIST.md": [
    /Superseded by `docs\/IMPLEMENTATION_VALIDATION_AUDIT\.md`/i,
    /historical/i,
    /not the active release checklist/i,
    historicalOwnershipWarningPattern,
  ],
  "REMAINING_GAPS_PLAN.md": [
    /Superseded by `docs\/GSAV_NATIVE_IMPLEMENTATION_PLAN\.md`/i,
    /historical/i,
    /not the active validation plan/i,
    historicalOwnershipWarningPattern,
  ],
  "SCALE_PLAN.md": [
    /Superseded by `docs\/GSAV_NATIVE_IMPLEMENTATION_PLAN\.md`/i,
    /historical/i,
    /not the active scale plan/i,
    /do not use it as an implementation checklist/i,
    historicalOwnershipWarningPattern,
  ],
  "GSAV_4DGS_HOSTING_IMPLEMENTATION_CHECKLIST.md": [
    /superseded historical checklist/i,
    /docs\/GSAV_NATIVE_IMPLEMENTATION_PLAN\.md/,
    /docs\/GSAV_NATIVE_QA\.md/,
    /docs\/IMPLEMENTATION_VALIDATION_AUDIT\.md/,
    /ADR 0002/,
    /React Native owns\s+native browse, social, settings, auth, saved\/follow, and navigation surfaces/i,
    /\.\.\/gsav-hosting\/apps\/web` owns GSAV decode\/render\/playback\/runtime\s+diagnostics/i,
    historicalOwnershipWarningPattern,
  ],
};

const requiredSectionMarkers = {
  "docs/IMPLEMENTATION_VALIDATION_AUDIT.md": [
    {
      heading: "## Latest Command Summary",
      patterns: [currentPendingEvidencePattern, /capturesGsavHostIdentity/],
    },
    {
      heading: "## External Evidence Review Ledger",
      patterns: [
        externalReviewLedgerCoveragePattern,
        externalReviewLedgerRowQualityPattern,
        externalReviewLedgerConcreteProofPattern,
        externalEvidenceInventoryPattern,
        externalEvidenceInventoryStrictPattern,
        /device packet path/i,
      ],
    },
    {
      heading: "## Final Publish Signoff",
      patterns: [
        /decision=no-publish/,
        /publishScope=android-apk-only/,
        /iosDistributionDecision=no-publish/,
        /externalEvidenceInventoryPath=docs\/qa-evidence\/<date>\/external-evidence-inventory\.json/,
        /deviceEvidencePacketPath=<reviewed-packet\.json>/,
        /expected_apk_sha256/,
        /expected_publish_identity_sha256/,
        /EXPECTED_RELEASE_APK_SHA256=absent/,
        /EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256=absent/,
        /protectedCandidateProof/,
        /finalCommandReceiptsPath/,
        /Last-mile GitHub release-state evidence/,
        /Last-mile\s+publish-hash variable guard/,
        /lastMileReleaseStateEvidence=docs\/qa-evidence\/<date>\/github-release-state-prepublish\.json/,
        /lastMilePublishHashGuardEvidence=docs\/qa-evidence\/<date>\/publish-hash-variable-guard-prepublish\.json/,
        /release-state JSON must show `status=pass`[\s\S]*zero GitHub\s+releases[\s\S]*successful\s+`workflow_dispatch` dry run/i,
        /publish-hash guard\s+JSON must\s+show[\s\S]*EXPECTED_RELEASE_APK_SHA256[\s\S]*EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256[\s\S]*absent/i,
        /releaseReadinessImpact\.status=ready/,
        /GitHub CLI query provenance/,
        /expectReadinessStatus=0/,
        /publishSignoffReady=true/,
        /noPublishRehearsal=false/,
        /status=pass/,
        /expected-readiness-fail/,
      ],
    },
    {
      heading: "## Current Release Blockers",
      patterns: [
        /Android WebView QA/,
        /iOS WKWebView QA/,
        /Validation executor readiness/,
        /Negative fixture readiness/,
        /Production JS runtime smoke/,
        /Production `\.gsav` range probe/,
        /Access-Control-Expose-Headers/,
        /Release APK, manifest scan, and installed APK smoke/,
        /Generated version metadata/,
        /Release dry run/,
        /Evidence artifact review signoff/,
        /Publish readiness/,
        /release-candidate\.txt/,
        /checksum-manifest SHA/,
        publishArtifactIdentityPattern,
        gsavPackageProvenancePattern,
      ],
    },
    {
      heading: "## Remaining Validation Gaps",
      patterns: [/Release-candidate identity ordering/],
    },
  ],
};

const evidenceContractDocs = new Set([
  "docs/GSAV_NATIVE_QA.md",
  "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
  "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
]);

const staleEvidenceLanguagePatterns = [
  /durable HTTPS CI\/artifact URLs?/i,
  /non-local HTTPS durable CI\/artifact URL/i,
  /durable HTTPS CI\/artifact\/release URLs?/i,
];
const staleDeviceValidationVerifierPathPattern =
  /downloaded-release\/release-evidence\/device-validation-bundle-verifier\.json/;
const staleActivePlanArchitecturePatterns = [
  /raise the 14-entry ceiling/i,
  /current 14 sibling-feature allowlist entries/i,
  /budget of 14 sibling-feature entries/i,
  /14-entry sibling allowlist ratchet/i,
  /features\/preferences\/useTheme\.ts[\s\S]{0,180}(?:App-wide UI theme-state contract|app-wide UI-state contract|currently blessed)/i,
  /features\/preferences\/`?[\s\S]{0,180}`?useTheme`?\s+hook/i,
  /bridge,\s*URL,\s*route,\s*navigation,\s*and\s*reducer helpers now live under `?features\/player\/`?/i,
];

const allowedExternalNpmScripts = new Set([
  "deploy:web:local",
  "smoke:web:local",
]);

const dryRunEvidenceFiles = [
  "release-evidence/release-candidate.txt",
  "release-evidence/signoff-diff-files.txt",
  "release-evidence/no-publish-side-effect.txt",
  "release-evidence/gsav-preflight.json",
  "release-evidence/gsav-runtime-smoke.json",
  "release-evidence/dry-run-summary.json",
  "release-evidence/evidence-checksums.txt",
];
const dryRunPublishIdentityTemplatePattern = /publishArtifactIdentitySha256=<64-hex sha>/;
const dryRunGsavPackageProvenanceTemplatePattern =
  /gsavPackageProvenanceSha256=<64-hex sha>[\s\S]{0,300}gsavPackageProvenance[\s\S]{0,220}@opsiclear\/gsav-bridge[\s\S]{0,220}specifier=file:vendor\/[^;|\s]+\.tgz[\s\S]{0,220}tarballSha256=<64-hex sha>[\s\S]{0,300}gsavPackageProvenance[\s\S]{0,220}@opsiclear\/gsav-client[\s\S]{0,220}specifier=file:vendor\/[^;|\s]+\.tgz[\s\S]{0,220}tarballSha256=<64-hex sha>/;

function normalizeCell(value) {
  return value.trim().replace(/^`|`$/g, "").replace(/`/g, "");
}

function markdownSection(text, heading) {
  const start = text.indexOf(heading);
  if (start === -1) return "";
  const rest = text.slice(start);
  const nextSection = rest.indexOf("\n## ", 1);
  return nextSection === -1 ? rest : rest.slice(0, nextSection);
}

function parseMarkdownTableRows(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|") && line.trim().endsWith("|"))
    .map((line) => line.trim().slice(1, -1).split("|").map(normalizeCell))
    .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
    .filter((cells) => cells[0] !== "Case" && cells[0] !== "Negative case");
}

function routeStubMapSection(text) {
  const starts = [...text.matchAll(/Route stub map:/g)].map((match) => match.index);
  for (const start of starts.reverse()) {
    const rest = text.slice(start);
    const end = rest.search(/\n(?:Hosted-runtime path contract:|QA fixture controls|## )/);
    const section = end === -1 ? rest : rest.slice(0, end);
    if (/\|\s*Expo route\s*\|\s*Feature owner\s*\|/.test(section)) {
      return section;
    }
  }
  return "";
}

function routeOwnerPathFromPattern(pattern) {
  return `${pattern.source
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\\//g, "/")
    .replace(/\\-/g, "-")}.tsx`;
}

function expectedRouteStubRows() {
  return Object.entries(appRouteOwnerMap).map(([route, ownerPattern]) => ({
    route: `${route}.tsx`,
    owner: routeOwnerPathFromPattern(ownerPattern),
  }));
}

function routeStubMapRows(text) {
  return parseMarkdownTableRows(routeStubMapSection(text))
    .filter((cells) => cells.length >= 2 && cells[0] !== "Expo route")
    .map(([route, owner]) => ({ route, owner }))
    .filter((row) => row.route);
}

function routeStubMapErrors(root) {
  const planPath = path.join(root, "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md");
  if (!fs.existsSync(planPath)) return [];

  const rows = routeStubMapRows(fs.readFileSync(planPath, "utf8"));
  if (rows.length === 0) {
    return ["docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route stub map is missing route rows."];
  }

  const observed = new Map(rows.map((row) => [row.route, row.owner]));
  const expected = expectedRouteStubRows();
  const errors = [];

  for (const row of expected) {
    const owner = observed.get(row.route);
    if (!owner) {
      errors.push(`docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route stub map is missing ${row.route}.`);
    } else if (!owner.includes(row.owner)) {
      errors.push(`docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route stub map ${row.route} must point to ${row.owner}, not ${owner}.`);
    }
  }

  const expectedRoutes = new Set(expected.map((row) => row.route));
  for (const route of observed.keys()) {
    if (!expectedRoutes.has(route)) {
      errors.push(`docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route stub map has stale route ${route}.`);
    }
  }

  return errors;
}

function routePresentationRegisterSection(text) {
  const start = text.indexOf("Route presentation register:");
  if (start === -1) return "";
  const rest = text.slice(start);
  const end = rest.search(/\n(?:Degraded-state acceptance matrix:|## )/);
  return end === -1 ? rest : rest.slice(0, end);
}

function routePresentationKind(decision) {
  if (/root layout wrapper/i.test(decision)) return "root-layout";
  if (/explicit\s+AppStack|AppStack\s+presentation/i.test(decision)) return "appstack";
  if (/intentional\s+Expo Router default/i.test(decision)) return "default";
  return "unknown";
}

function routePresentationRegisterRows(text) {
  return parseMarkdownTableRows(routePresentationRegisterSection(text))
    .filter((cells) => cells.length >= 2 && cells[0] !== "appRouteOwnerMap entry")
    .flatMap(([routeCell, decision]) => routeCell
      .split(/\s+and\s+/)
      .map((route) => route.trim())
      .filter(Boolean)
      .map((route) => ({ route, kind: routePresentationKind(decision), decision })));
}

function appStackScreenNameForRoute(route) {
  const withoutAppPrefix = route.replace(/^app\//, "");
  if (withoutAppPrefix === "_layout") return null;
  return withoutAppPrefix.split("/")[0];
}

function appStackScreenNames(root) {
  const appStackPath = path.join(root, "features/app-shell/AppStack.tsx");
  if (!fs.existsSync(appStackPath)) return null;
  const text = fs.readFileSync(appStackPath, "utf8");
  return new Set([...text.matchAll(/<Stack\.Screen\b[^>]*\bname=["']([^"']+)["']/g)]
    .map((match) => match[1]));
}

function routePresentationRegisterErrors(root) {
  const planPath = path.join(root, "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md");
  if (!fs.existsSync(planPath)) return [];

  const appStackNames = appStackScreenNames(root);
  if (!appStackNames) {
    return ["features/app-shell/AppStack.tsx is missing for route presentation register checks."];
  }

  const rows = routePresentationRegisterRows(fs.readFileSync(planPath, "utf8"));
  if (rows.length === 0) {
    return ["docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route presentation register is missing route rows."];
  }

  const observed = new Map(rows.map((row) => [row.route, row]));
  const errors = [];
  const expectedRoutes = new Set(Object.keys(appRouteOwnerMap));
  const explicitlyDocumentedScreens = new Set();

  for (const route of expectedRoutes) {
    const row = observed.get(route);
    if (!row) {
      errors.push(`docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route presentation register is missing ${route}.`);
      continue;
    }

    const screenName = appStackScreenNameForRoute(route);
    if (!screenName) {
      if (row.kind !== "root-layout") {
        errors.push(`docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route presentation register ${route} must describe the root layout wrapper, not ${row.decision}.`);
      }
      continue;
    }

    if (appStackNames.has(screenName)) {
      explicitlyDocumentedScreens.add(screenName);
      if (row.kind !== "appstack") {
        errors.push(`docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route presentation register ${route} must describe explicit AppStack presentation for screen ${screenName}.`);
      }
    } else if (row.kind !== "default") {
      errors.push(`docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route presentation register ${route} must describe intentional Expo Router default stack behavior.`);
    }
  }

  for (const route of observed.keys()) {
    if (!expectedRoutes.has(route)) {
      errors.push(`docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md Route presentation register has stale route ${route}.`);
    }
  }

  for (const screenName of appStackNames) {
    if (!explicitlyDocumentedScreens.has(screenName)) {
      errors.push(`features/app-shell/AppStack.tsx screen ${screenName} must have an explicit route presentation register entry.`);
    }
  }

  return errors;
}

function qaEvidenceCounts(qaText) {
  const rows = parseMarkdownTableRows(markdownSection(qaText, "## Evidence Log"))
    .filter((cells) => cells.length >= 8 && cells[0] !== "Date");
  const pending = rows.filter((cells) => cells.some((cell) => /_pending_|pending/i.test(cell))).length;
  return {
    total: rows.length,
    pending,
    completed: rows.length - pending,
  };
}

function negativeFixtureCases(text, heading) {
  return negativeFixtureRows(text, heading)
    .map((row) => row.name)
    .filter(Boolean);
}

function negativeFixtureRows(text, heading) {
  return parseMarkdownTableRows(markdownSection(text, heading))
    .map((cells) => ({
      name: cells[0],
      status: heading === "## Negative Fixture Inventory" ? cells[3] : cells[1],
    }))
    .filter((row) => row.name);
}

function negativeFixtureBacklogRows(text) {
  return parseMarkdownTableRows(markdownSection(text, "## Negative Fixture Backlog"))
    .map((cells) => ({
      name: cells[0],
      owner: cells[1],
      requiredFixture: cells[2],
      acceptance: cells[3],
    }))
    .filter((row) => row.name);
}

function negativeFixtureStatusKind(status) {
  if (/owner-blocked|available only when/i.test(status)) return "owner-blocked";
  if (/available/i.test(status)) return "available";
  return "unknown";
}

function negativeFixtureStatusError(fixtureCase, qaStatus, auditStatus) {
  const qaKind = negativeFixtureStatusKind(qaStatus);
  const auditKind = negativeFixtureStatusKind(auditStatus);

  if (qaKind === "unknown") {
    return `docs/GSAV_NATIVE_QA.md negative fixture inventory status for ${fixtureCase} must be available or owner-blocked.`;
  }

  if (auditKind === "unknown") {
    return `docs/IMPLEMENTATION_VALIDATION_AUDIT.md negative fixture ownership status for ${fixtureCase} must be available or owner-blocked.`;
  }

  if (qaKind === "owner-blocked" && auditKind !== "owner-blocked") {
    return `docs/IMPLEMENTATION_VALIDATION_AUDIT.md negative fixture ownership status for ${fixtureCase} must remain owner-blocked.`;
  }

  if (qaKind === "available" && auditKind !== "available") {
    return `docs/IMPLEMENTATION_VALIDATION_AUDIT.md negative fixture ownership status for ${fixtureCase} must remain available.`;
  }

  return null;
}

function negativeFixtureOwnershipErrors(root, docs) {
  if (!docs["docs/GSAV_NATIVE_QA.md"] || !docs["docs/IMPLEMENTATION_VALIDATION_AUDIT.md"]) {
    return [];
  }

  const qaPath = path.join(root, "docs/GSAV_NATIVE_QA.md");
  const auditPath = path.join(root, "docs/IMPLEMENTATION_VALIDATION_AUDIT.md");
  if (!fs.existsSync(qaPath) || !fs.existsSync(auditPath)) {
    return [];
  }

  const qaText = fs.readFileSync(qaPath, "utf8");
  const auditText = fs.readFileSync(auditPath, "utf8");
  const qaRows = negativeFixtureRows(qaText, "## Negative Fixture Inventory");
  const qaCases = new Set(qaRows.map((row) => row.name));
  const auditRows = new Map(negativeFixtureRows(auditText, "## Negative Fixture Ownership")
    .map((row) => [row.name, row]));

  const errors = qaRows.flatMap((qaRow) => {
    const auditRow = auditRows.get(qaRow.name);
    if (!auditRow) {
      return [`docs/IMPLEMENTATION_VALIDATION_AUDIT.md is missing negative fixture ownership row for ${qaRow.name}.`];
    }

    const statusError = negativeFixtureStatusError(qaRow.name, qaRow.status, auditRow.status);
    return statusError ? [statusError] : [];
  });

  for (const auditCase of auditRows.keys()) {
    if (!qaCases.has(auditCase)) {
      errors.push(`docs/IMPLEMENTATION_VALIDATION_AUDIT.md has stale negative fixture ownership row for ${auditCase}.`);
    }
  }

  return errors;
}

function negativeFixtureBacklogErrors(root, docs) {
  if (!docs["docs/GSAV_NATIVE_QA.md"]) return [];

  const qaPath = path.join(root, "docs/GSAV_NATIVE_QA.md");
  if (!fs.existsSync(qaPath)) return [];

  const qaText = fs.readFileSync(qaPath, "utf8");
  const inventoryRows = negativeFixtureRows(qaText, "## Negative Fixture Inventory");
  if (inventoryRows.length === 0) return [];

  const ownerBlockedCases = new Set(inventoryRows
    .filter((row) => negativeFixtureStatusKind(row.status) === "owner-blocked")
    .map((row) => row.name));
  const backlogRows = new Map(negativeFixtureBacklogRows(qaText)
    .map((row) => [row.name, row]));
  const weakBacklogPattern = /\b(TBD|todo|placeholder|manual check|_pending_|pending)\b/i;
  const errors = [];

  for (const fixtureCase of ownerBlockedCases) {
    if (!backlogRows.has(fixtureCase)) {
      errors.push(`docs/GSAV_NATIVE_QA.md negative fixture backlog is missing owner-blocked case ${fixtureCase}.`);
    }
  }

  for (const [fixtureCase, row] of backlogRows.entries()) {
    if (!ownerBlockedCases.has(fixtureCase)) {
      errors.push(`docs/GSAV_NATIVE_QA.md negative fixture backlog has stale or non-blocked case ${fixtureCase}.`);
      continue;
    }
    for (const [field, value] of [
      ["target owner/repo", row.owner],
      ["required fixture shape", row.requiredFixture],
      ["acceptance criteria", row.acceptance],
    ]) {
      if (!value || weakBacklogPattern.test(value)) {
        errors.push(`docs/GSAV_NATIVE_QA.md negative fixture backlog ${fixtureCase} must include concrete ${field}.`);
      }
    }
  }

  return errors;
}

function requiredSectionMarkerErrors(root, docs) {
  const errors = [];
  for (const [relativePath, sections] of Object.entries(requiredSectionMarkers)) {
    if (!docs[relativePath]) continue;
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8");
    for (const section of sections) {
      const sectionText = markdownSection(text, section.heading);
      if (!sectionText) {
        errors.push(`${relativePath} is missing section ${section.heading}.`);
        continue;
      }
      for (const pattern of section.patterns) {
        if (!markerMatches(pattern, sectionText)) {
          errors.push(`${relativePath} section ${section.heading} is missing required marker ${markerDescription(pattern)}.`);
        }
      }
    }
  }
  return errors;
}

function packageScriptReferenceErrors(root, docs) {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) return [];

  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const scriptNames = new Set(Object.keys(packageJson.scripts ?? {}));
  const errors = [];

  for (const relativePath of Object.keys(docs)) {
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) continue;
    const text = packageScriptReferenceText(relativePath, fs.readFileSync(filePath, "utf8"));
    for (const match of text.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
      const scriptName = match[1];
      if (!scriptNames.has(scriptName) && !allowedExternalNpmScripts.has(scriptName)) {
        errors.push(`${relativePath} references npm run ${scriptName}, but package.json does not define that script.`);
      }
    }
  }

  return errors;
}

function packageScriptReferenceText(relativePath, text) {
  if (relativePath === "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md") {
    const phaseStart = text.indexOf("\n## Phase 1 - ");
    return [
      phaseStart === -1 ? text : text.slice(0, phaseStart),
      markdownSection(text, "## Release Gates"),
    ].join("\n");
  }

  if (relativePath === "docs/IMPLEMENTATION_VALIDATION_AUDIT.md") {
    return [
      markdownSection(text, "## Current Release Blockers"),
      markdownSection(text, "## Latest Command Summary"),
      markdownSection(text, "## Remaining Validation Gaps"),
      markdownSection(text, "## Negative Fixture Ownership"),
    ].join("\n");
  }

  return text;
}

function qaEvidenceCountErrors(root) {
  const qaPath = path.join(root, "docs/GSAV_NATIVE_QA.md");
  const planPath = path.join(root, "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md");
  const auditPath = path.join(root, "docs/IMPLEMENTATION_VALIDATION_AUDIT.md");
  if (!fs.existsSync(qaPath) || !fs.existsSync(planPath) || !fs.existsSync(auditPath)) return [];

  const expectedPendingForward = `${EXPECTED_PENDING_PUBLISH_ROWS} pending publish evidence rows`;
  const expectedPendingReverse = `${EXPECTED_PENDING_PUBLISH_ROWS} publish evidence rows pending`;
  const expectedChecked = `${EXPECTED_RELEASE_READINESS_CHECKED} checked rows`;
  const expectedPackets = `${EXPECTED_DEVICE_PACKET_COUNT} pending device packets`;
  const expectedPacketsShort = `${EXPECTED_DEVICE_PACKET_COUNT} pending packets`;
  const errors = [];
  for (const [label, filePath, section] of [
    ["docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md", planPath, null],
    ["docs/IMPLEMENTATION_VALIDATION_AUDIT.md", auditPath, "## Latest Command Summary"],
  ]) {
    const text = fs.readFileSync(filePath, "utf8");
    const haystack = section ? markdownSection(text, section) : text;
    if (!haystack.includes(expectedChecked)) {
      errors.push(`${label} must summarize current release-readiness count as ${expectedChecked}.`);
    }
    if (!haystack.includes(expectedPendingForward) && !haystack.includes(expectedPendingReverse)) {
      errors.push(`${label} must summarize current pending publish evidence count as ${expectedPendingForward} or ${expectedPendingReverse}.`);
    }
    if (!haystack.includes(expectedPackets) && !haystack.includes(expectedPacketsShort)) {
      errors.push(`${label} must summarize current device packet count as ${expectedPackets}.`);
    }
  }
  return errors;
}

function dryRunEvidenceFileErrors(root) {
  const errors = [];
  for (const relativePath of [
    "docs/GSAV_NATIVE_QA.md",
    "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md",
  ]) {
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8");
    if (!/Release workflow dry run|Release dry-run gate|Dry-run row/i.test(text)) continue;
    for (const evidenceFile of dryRunEvidenceFiles) {
      if (!text.includes(evidenceFile)) {
        errors.push(`${relativePath} must mention dry-run evidence file ${evidenceFile}.`);
      }
    }
    if (!dryRunPublishIdentityTemplatePattern.test(text)) {
      errors.push(`${relativePath} must include publishArtifactIdentitySha256=<64-hex sha> in dry-run evidence templates.`);
    }
    if (!dryRunGsavPackageProvenanceTemplatePattern.test(text)) {
      errors.push(`${relativePath} must include gsavPackageProvenanceSha256=<64-hex sha> plus bridge/client specifier and tarballSha256=<64-hex sha> in dry-run evidence templates.`);
    }
  }
  return errors;
}

function currentEvidenceContractText(relativePath, text) {
  if (relativePath !== "docs/IMPLEMENTATION_VALIDATION_AUDIT.md") {
    return text;
  }

  return [
    markdownSection(text, "## Current Release Blockers"),
    markdownSection(text, "## Latest Command Summary"),
    markdownSection(text, "## Completed In This Pass"),
  ].join("\n");
}

function staleEvidenceLanguageErrors(root, docs) {
  const errors = [];
  for (const relativePath of Object.keys(docs)) {
    if (!evidenceContractDocs.has(relativePath)) continue;
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) continue;

    const text = currentEvidenceContractText(relativePath, fs.readFileSync(filePath, "utf8"));
    for (const pattern of staleEvidenceLanguagePatterns) {
      if (pattern.test(text)) {
        errors.push(`${relativePath} uses stale generic evidence URL wording ${pattern}; use trusted GitHub CI/artifact/release URL under opsiclear/diveo, OpsiClear-Web/diveo, or opsiclear/gsav-hosting.`);
      }
    }
  }
  return errors;
}

function deviceValidationVerifierPathErrors(root, docs) {
  const errors = [];
  for (const relativePath of Object.keys(docs)) {
    if (!evidenceContractDocs.has(relativePath)) continue;
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) continue;

    const text = currentEvidenceContractText(relativePath, fs.readFileSync(filePath, "utf8"));
    if (staleDeviceValidationVerifierPathPattern.test(text)) {
      errors.push(`${relativePath} must keep device-validation-bundle-verifier.json outside downloaded-release/release-evidence/**; use device-validation-evidence/device-validation-bundle-verifier.json.`);
    }
  }
  return errors;
}

function activePlanArchitectureContractErrors(root, docs) {
  if (!docs["docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md"]) return [];
  const planPath = path.join(root, "docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md");
  if (!fs.existsSync(planPath)) return [];

  const text = fs.readFileSync(planPath, "utf8");
  const phaseStart = text.indexOf("\n## Phase 1 - ");
  const activeText = phaseStart === -1 ? text : text.slice(0, phaseStart);

  return staleActivePlanArchitecturePatterns
    .filter((pattern) => pattern.test(activeText))
    .map((pattern) => `docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md active plan contains stale architecture marker ${pattern}; use the 12-entry sibling allowlist and shared/themeContext.tsx contract.`);
}

function supersededDocMarkerErrors(root) {
  const errors = [];
  for (const [relativePath, requiredPatterns] of Object.entries(supersededDocs)) {
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8");
    for (const pattern of requiredPatterns) {
      if (!pattern.test(text)) {
        errors.push(`${relativePath} is missing superseded-doc marker ${pattern}.`);
      }
    }
  }
  return errors;
}

function rootPlanningDocDiscoveryErrors(root, docs) {
  const errors = [];
  const allowed = new Set([
    ...Object.keys(docs),
    ...Object.keys(supersededDocs),
  ]);

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.md$/i.test(entry.name)) continue;
    if (!/(?:PLAN|CHECKLIST)/i.test(entry.name)) continue;
    if (!allowed.has(entry.name)) {
      errors.push(`${entry.name} is a root planning/checklist doc but is not listed in activeDocs or supersededDocs.`);
    }
  }

  return errors;
}

function analyzeDocDrift(root, docs = activeDocs) {
  const errors = [];
  const checkedSupersededFiles = Object.keys(supersededDocs)
    .filter((relativePath) => fs.existsSync(path.join(root, relativePath)));

  for (const [relativePath, requiredPatterns] of Object.entries(docs)) {
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) {
      errors.push(`${relativePath} is missing.`);
      continue;
    }

    const text = fs.readFileSync(filePath, "utf8");
    for (const pattern of requiredPatterns) {
      if (!markerMatches(pattern, text)) {
        errors.push(`${relativePath} is missing required marker ${markerDescription(pattern)}.`);
      }
    }
    if (!docsWithHistoricalMarkers.has(relativePath)) {
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(text)) {
          errors.push(`${relativePath} contains stale marker ${pattern}.`);
        }
      }
    }
  }

  errors.push(...requiredSectionMarkerErrors(root, docs));
  errors.push(...negativeFixtureOwnershipErrors(root, docs));
  errors.push(...negativeFixtureBacklogErrors(root, docs));
  errors.push(...packageScriptReferenceErrors(root, docs));
  errors.push(...qaEvidenceCountErrors(root));
  errors.push(...dryRunEvidenceFileErrors(root));
  errors.push(...routeStubMapErrors(root));
  errors.push(...routePresentationRegisterErrors(root));
  errors.push(...staleEvidenceLanguageErrors(root, docs));
  errors.push(...deviceValidationVerifierPathErrors(root, docs));
  errors.push(...activePlanArchitectureContractErrors(root, docs));
  errors.push(...supersededDocMarkerErrors(root));
  errors.push(...rootPlanningDocDiscoveryErrors(root, docs));

  return {
    ok: errors.length === 0,
    checkedFiles: Object.keys(docs),
    checkedSupersededFiles,
    errors,
  };
}

function main() {
  const result = analyzeDocDrift(process.cwd());
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    status: result.ok ? "pass" : "fail",
    ...result,
  }, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  activeDocs,
  analyzeDocDrift,
  activePlanArchitectureContractErrors,
  docsWithHistoricalMarkers,
  deviceValidationVerifierPathErrors,
  forbiddenPatterns,
  negativeFixtureCases,
  packageScriptReferenceErrors,
  qaEvidenceCounts,
  requiredSectionMarkerErrors,
  routePresentationRegisterErrors,
  routeStubMapErrors,
  routeStubMapRows,
  staleEvidenceLanguageErrors,
  supersededDocMarkerErrors,
  supersededDocs,
  rootPlanningDocDiscoveryErrors,
  negativeFixtureRows,
  negativeFixtureOwnershipErrors,
};
