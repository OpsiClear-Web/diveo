import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import finalReceiptContract from "./final-readiness-receipt-contract.js";
import verifier from "./verify-release-readiness.js";

const {
  analyzeReleaseReadiness,
  apkArtifactChecksumProblems,
  auditSignoffProblems,
  branchProtectionDetailProblems,
  candidateIdentityIntegrityProblems,
  checksumManifestDetailProblems,
  commitMatches,
  detailProblem,
  deferredFinalInputProblems,
  deviceEvidencePacketProblems,
  deviceValidationHelperEvidenceCandidates,
  evidenceDateProblem,
  evidenceLogDuplicateRowProblems,
  evidenceLogRowSetProblems,
  evidenceLogSchemaProblems,
  evidenceIntegrityProblems,
  evidenceProblem,
  externalEvidenceInventoryProblems,
  externalReviewLedgerCoverageProblems,
  exceptionProblems,
  findEvidence,
  isAllowedEvidenceSignoffPath,
  parseArgs,
  parseEvidenceRows,
  negativeCaseCoverageProblems,
  parseExternalReviewLedgerRows,
  parseReleaseEvidenceRequirementRows,
  publishArtifactIdentityDetailProblems,
  rangeProbeDetailProblems,
  readCandidateIdentity,
  releaseDryRunHostIdentityProblems,
  releaseEvidenceRequirementsProblems,
  releaseSignoffIntegrityProblems,
  resultStatusProblem,
  routeOrNegativeEvidencePathProblems,
  routeMatrixCoverageProblems,
  runtimeSmokeHostIdentityValue,
  runtimeSmokeDetailProblems,
  validationPrereqDetailProblems,
  requiredEvidence,
  DEFAULT_MAX_EVIDENCE_AGE_DAYS,
  FINAL_RECEIPT_EXPECTED_STEP_LABELS,
  REQUIRED_RELEASE_EVIDENCE_REQUIREMENT_ROWS,
  REQUIRED_EXTERNAL_REVIEW_LEDGER_CATEGORIES,
  DEVICE_PACKET_ENV,
  EXTERNAL_EVIDENCE_INVENTORY_ENV,
} = verifier;

const CANDIDATE = {
  commit: "abc1234567890abcdef1234567890abcdef12345",
  appVersion: "1.0.19",
  packageVersion: "1.0.19",
  versionCode: 10019,
};
const CHECKSUM_MANIFEST_SHA = "feedbeadfeedbeadfeedbeadfeedbeadfeedbeadfeedbeadfeedbeadfeedbead";
const APK_SHA = "abcdefffabcdefffabcdefffabcdefffabcdefffabcdefffabcdefffabcdefff";
const MANIFEST_SHA = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const PUBLISH_ARTIFACT_IDENTITY_SHA = "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00";
const GSAV_PROVENANCE_SHA = "6a57a0016a57a0016a57a0016a57a0016a57a0016a57a0016a57a0016a57a001";
const GSAV_BRIDGE_SHA = "b1d9e001b1d9e001b1d9e001b1d9e001b1d9e001b1d9e001b1d9e001b1d9e001";
const GSAV_CLIENT_SHA = "c1e47001c1e47001c1e47001c1e47001c1e47001c1e47001c1e47001c1e47001";
const RANGE_CORS_PROOF = "Access-Control-Allow-Origin=*; Access-Control-Expose-Headers=Accept-Ranges, Content-Length, Content-Range, ETag;";

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-30T22:35:00.000Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("commitMatches", () => {
  it("accepts full or 7+ hex commit prefixes only", () => {
    const fullSha = "abc1234567890abcdef1234567890abcdef12345";

    expect(commitMatches(fullSha, fullSha)).toBe(true);
    expect(commitMatches("abc1234", fullSha)).toBe(true);
    expect(commitMatches(fullSha, "abc1234")).toBe(true);
    expect(commitMatches("abc123", fullSha)).toBe(false);
    expect(commitMatches("a", fullSha)).toBe(false);
    expect(commitMatches("release-build-2026", "release-build-2026")).toBe(false);
    expect(commitMatches("abc123g", fullSha)).toBe(false);
  });
});

describe("parseArgs", () => {
  it("parses strict final input diagnostics mode", () => {
    expect(parseArgs([])).toEqual({ strictFinalInputs: false });
    expect(parseArgs(["--strict-final-inputs"])).toEqual({ strictFinalInputs: true });
    expect(() => parseArgs(["--unknown"])).toThrow(/Usage:/);
  });
});

describe("final receipt shared contract", () => {
  it("exports canonical final receipt constants from the shared module", () => {
    expect(FINAL_RECEIPT_EXPECTED_STEP_LABELS)
      .toEqual(finalReceiptContract.FINAL_RECEIPT_EXPECTED_STEP_LABELS);
    expect(verifier.FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV)
      .toBe(finalReceiptContract.FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV);
  });
});

function qaDoc(rows) {
  return `# QA

## Required Route Matrix

| diveo route | Expected embedded URL behavior |
| --- | --- |
${routeMatrixRows().join("\n")}

## Negative Fixture Inventory

| Case | Exact trigger to use | Expected signal | Fixture status |
| --- | --- | --- | --- |
${negativeFixtureInventoryRows().join("\n")}

## Release Evidence Requirements

| Evidence row | Required observed signal |
| --- | --- |
${releaseEvidenceRequirementRows().join("\n")}

## Evidence Log

| Date | Platform | Device/Emulator | GSAV web URL | diveo route | Result | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

## Environment Gaps
`;
}

function auditDoc({
  decision = "publish",
  publishScope = "android-apk-only",
  iosDistributionDecision = "no-publish",
  reviewer = "@release-reviewer",
  reviewedAt = "2026-06-30T22:35:00Z",
  payloadSha = CANDIDATE.commit,
  signoffSha = CANDIDATE.commit,
  artifactName = "diveo-release-evidence-v1.0.19",
  runUrl = "https://github.com/OpsiClear-Web/diveo/actions/runs/1",
  checksumManifestSha256 = CHECKSUM_MANIFEST_SHA,
  publishArtifactIdentitySha256 = PUBLISH_ARTIFACT_IDENTITY_SHA,
  externalEvidenceInventoryPath = "docs/qa-evidence/2026-06-30/external-evidence-inventory.json",
  deviceEvidencePacketPath = "docs/qa-evidence/2026-06-30/device-evidence-packet-reviewed.json",
  stackReceiptPath = "docs/qa-evidence/2026-06-30/stack-architecture-receipt.json",
  protectedCandidateProof = "docs/qa-evidence/2026-06-30/final-command-receipts/08-protected-candidate-ancestry-proof.stdout.log",
  finalCommandReceiptsPath = "docs/qa-evidence/2026-06-30/final-command-receipts/verification-summary.json",
  lastMileReleaseStateEvidence = "docs/qa-evidence/2026-06-30/github-release-state-prepublish.json",
  lastMilePublishHashGuardEvidence = "docs/qa-evidence/2026-06-30/publish-hash-variable-guard-prepublish.json",
  expectedApkSha256 = APK_SHA,
  expectedPublishIdentitySha256 = PUBLISH_ARTIFACT_IDENTITY_SHA,
  ledgerStatus = "Reviewed",
  ledgerReviewer = "@release-reviewer / 2026-06-30T22:35:00Z",
  ledgerRows,
} = {}) {
  const defaultLedgerRows = [
    `| Release workflow dry run | ${artifactName} | ${ledgerReviewer} | Run conclusion=success, downloaded checksum-manifest SHA256=${checksumManifestSha256}, publishArtifactIdentitySha256=${publishArtifactIdentitySha256}, gsavPackageProvenanceSha256=${GSAV_PROVENANCE_SHA}, and npm run verify:release-evidence-bundle rerun against the downloaded bundle passed | ${ledgerStatus} |`,
    `| Release validation prerequisites | diveo-device-validation-2026-06-30-1 | ${ledgerReviewer} | validation-prereqs.json, attach-validation-prereqs output, --require-validation-prereqs true, device-validation-bundle-verifier.json, downloaded-release/release-evidence/**, iOS artifact URL=https://github.com/opsiclear/diveo/actions/runs/123/artifacts/ios-wkwebview-evidence, and iOS artifact SHA256=${CHECKSUM_MANIFEST_SHA} reviewed | ${ledgerStatus} |`,
    `| Release APK artifact and generated version metadata | ${artifactName} APK and manifest | ${ledgerReviewer} | apkSha256=${APK_SHA}, manifestSha256=${MANIFEST_SHA}, generated versionCode 10019, and apk-version-metadata reviewed | ${ledgerStatus} |`,
    `| Release-installed APK smoke | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-installed-smoke | ${ledgerReviewer} | Exact dry-run APK installed, apkSha256=${APK_SHA}, dry-run-summary match, productionHostUrl=https://gsav.example.com, productionHostReleaseReady=true, Android OS and WebView version, and per-route log markers reviewed | ${ledgerStatus} |`,
    `| Production runtime smoke and range probe | ${artifactName} preflight/runtime evidence | ${ledgerReviewer} | Runtime smoke, GSAV_HOSTING_COMMIT=def5678abc1234 host identity, range probe 206, Content-Range=bytes 0-0/12345, Access-Control-Allow-Origin, and Access-Control-Expose-Headers reviewed | ${ledgerStatus} |`,
    `| Product journey manifest | docs/qa-evidence/2026-06-30/product-journey-manifest.json | ${ledgerReviewer} | product-journey-manifest.json, artifactPurpose=product-journey-manifest, helperOnly=false, releaseCandidateSha=${CANDIDATE.commit}, first-launch-home, search, creator, library, login-auth-return, watch-alias, explore, diagnostics-hierarchy, settings, accessibility-ergonomics, degraded-blocked-states, distinct Android and iOS evidence paths, manifestSha256=${CHECKSUM_MANIFEST_SHA}, mediaSha256=${CHECKSUM_MANIFEST_SHA}, external-evidence-inventory.json inventoryEntryId=product-journey-manifest, and fixture-manifest.json inventory entry with artifactPurpose=fixture-manifest, helperOnly=false, sha256 matching fixtureManifestSha256=${CHECKSUM_MANIFEST_SHA} reviewed | ${ledgerStatus} |`,
    `| Android/iOS route rows | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-ios-route-evidence | ${ledgerReviewer} | Android and iOS evidence, releaseCandidateSha=${CANDIDATE.commit}, dry-run artifact=diveo-release-evidence-v1.0.19, dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1, artifactPurpose=route-evidence, routeEvidenceManifest=route-evidence-manifest.json, evidenceManifestSha256=${CHECKSUM_MANIFEST_SHA}, sourceRunId=1, sourceArtifactId=android-ios-route-evidence, mediaSha256=${CHECKSUM_MANIFEST_SHA}, helperOnly=false, device identity, OS and WebView/WKWebView version, route observed signal, and account-safe redaction reviewed | ${ledgerStatus} |`,
    `| Negative validation rows | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-ios-negative-evidence | ${ledgerReviewer} | Android and iOS evidence, releaseCandidateSha=${CANDIDATE.commit}, dry-run artifact=diveo-release-evidence-v1.0.19, dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1, artifactPurpose=negative-evidence, negativeEvidenceManifest=negative-evidence-manifest.json, evidenceManifestSha256=${CHECKSUM_MANIFEST_SHA}, sourceRunId=1, sourceArtifactId=android-ios-negative-evidence, mediaSha256=${CHECKSUM_MANIFEST_SHA}, helperOnly=false, trigger/action, observed signal, OS and WebView/WKWebView version, and GSAV host identity reviewed | ${ledgerStatus} |`,
    `| Branch protection | docs/qa-evidence/2026-06-30/master-branch-protection.json | ${ledgerReviewer} | protected branch master, quality / quality, reviewer ISO timestamp, and raw evidence path reviewed | ${ledgerStatus} |`,
  ];
  return `# Implementation Validation Audit

## External Evidence Review Ledger

| QA row or artifact | URL or artifact | Reviewer / timestamp | Required review proof | Status |
| --- | --- | --- | --- | --- |
${(ledgerRows ?? defaultLedgerRows).join("\n")}

## Final Publish Signoff

decision=${decision}; publishScope=${publishScope}; iosDistributionDecision=${iosDistributionDecision}; reviewer=${reviewer}; reviewedAt=${reviewedAt}; payloadSha=${payloadSha}; signoffSha=${signoffSha}; artifactName=${artifactName}; runUrl=${runUrl}; checksumManifestSha256=${checksumManifestSha256}; publishArtifactIdentitySha256=${publishArtifactIdentitySha256}; externalEvidenceInventoryPath=${externalEvidenceInventoryPath}; deviceEvidencePacketPath=${deviceEvidencePacketPath}; stackReceiptPath=${stackReceiptPath}; protectedCandidateProof=${protectedCandidateProof}; finalCommandReceiptsPath=${finalCommandReceiptsPath}; lastMileReleaseStateEvidence=${lastMileReleaseStateEvidence}; lastMilePublishHashGuardEvidence=${lastMilePublishHashGuardEvidence}; expected_apk_sha256=${expectedApkSha256}; expected_publish_identity_sha256=${expectedPublishIdentitySha256}; EXPECTED_RELEASE_APK_SHA256=${expectedApkSha256}; EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256=${expectedPublishIdentitySha256}; branchProtectionReady=true; protected branch=master; required check=quality / quality.
`;
}

function sha256Text(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function safeEvidenceName(index, label, suffix) {
  const safeLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${String(index + 1).padStart(2, "0")}-${safeLabel || "step"}.${suffix}`;
}

function writeReceiptStepLogs(root, receiptDir, step, index) {
  const stdout = `${step.label} stdout\n`;
  const stderr = `${step.label} stderr\n`;
  const stdoutPath = safeEvidenceName(index, step.label, "stdout.log");
  const stderrPath = safeEvidenceName(index, step.label, "stderr.log");
  fs.mkdirSync(path.join(root, receiptDir), { recursive: true });
  fs.writeFileSync(path.join(root, receiptDir, stdoutPath), stdout);
  fs.writeFileSync(path.join(root, receiptDir, stderrPath), stderr);
  return {
    ...step,
    index: index + 1,
    expectedStatus: step.expectedStatus ?? 0,
    stdoutPath,
    stderrPath,
    stdoutSha256: sha256Text(stdout),
    stderrSha256: sha256Text(stderr),
    combinedSha256: sha256Text(`${stdout}${stderr}`),
  };
}

function releaseStateEvidenceJson({
  date,
  repository,
  reviewer,
  reviewedAt,
  overrides = {},
}) {
  return {
    checkedAt: `${date}T22:35:00.000Z`,
    status: "pass",
    ok: true,
    repository,
    review: {
      reviewer,
      reviewedAt,
    },
    querySummaries: {
      workflows: { exitCode: 0 },
      releaseRuns: { exitCode: 0 },
      workflowDispatchRuns: { exitCode: 0 },
      releases: { exitCode: 0 },
    },
    commands: {
      workflows: `gh api repos/${repository}/actions/workflows`,
      releaseRuns: `gh run list -R ${repository} --workflow 'Release APK' --limit 10 --json databaseId,workflowName,url`,
      workflowDispatchRuns: `gh run list -R ${repository} --event workflow_dispatch --limit 20 --json databaseId,workflowName,url`,
      releases: `gh release list -R ${repository} --limit 20 --json tagName,name,publishedAt`,
    },
    releaseState: {
      releaseCount: 0,
      noGitHubReleasesObserved: true,
    },
    releases: [],
    successfulReleaseWorkflowDispatchRuns: [
      {
        status: "completed",
        conclusion: "success",
        event: "workflow_dispatch",
        url: "https://github.com/OpsiClear-Web/diveo/actions/runs/1",
      },
    ],
    releaseReadinessImpact: {
      status: "ready",
    },
    ...overrides,
  };
}

function publishHashGuardEvidenceJson({
  date,
  repository,
  reviewer,
  reviewedAt,
  overrides = {},
}) {
  return {
    checkedAt: `${date}T22:35:00.000Z`,
    status: "pass",
    ok: true,
    repository,
    review: {
      reviewer,
      reviewedAt,
    },
    variableQueries: [
      {
        name: "EXPECTED_RELEASE_APK_SHA256",
        status: "absent",
        absent: true,
        command: `gh variable get EXPECTED_RELEASE_APK_SHA256 --repo ${repository} --json name,value,updatedAt`,
      },
      {
        name: "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256",
        status: "absent",
        absent: true,
        command: `gh variable get EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256 --repo ${repository} --json name,value,updatedAt`,
      },
    ],
    releaseReadinessImpact: {
      status: "ready",
    },
    ...overrides,
  };
}

function stackArchitectureReceiptJson({
  gitSha = CANDIDATE.commit,
  overrides = {},
} = {}) {
  return {
    schemaVersion: "stack-architecture-receipt/v1",
    gitSha,
    stackProfile: {
      allowedShellOrigins: ["https://native.example.com"],
      backend: {
        class: "public-https",
        origin: "https://api.example.com",
        url: "https://api.example.com",
      },
      catalog: {
        class: "public-https",
        origin: "https://api.example.com",
        url: "https://api.example.com/functions/v1/catalog",
      },
      nativePreview: {
        class: "public-https",
        origin: "https://native.example.com",
        url: "https://native.example.com",
      },
      path: "config/stack.production.json",
      profile: "production",
      web: {
        class: "public-https",
        origin: "https://gsav.example.com",
        url: "https://gsav.example.com",
      },
    },
    catalog: {
      firstVideoId: "capture-room",
      schemaVersion: 1,
    },
    bridge: {
      nativeMinVersion: 1,
      nativeVersion: 1,
      sessionVersion: 1,
      web: {
        compatible: true,
        minVersion: 1,
        sourcePath: "../gsav-hosting/apps/web/src/native/bridge.ts",
        version: 1,
      },
    },
    doctor: {
      ok: true,
      requireAssets: true,
      skipNetwork: false,
      checks: [
        {
          detail: "https://api.example.com/functions/v1/catalog schema=1 first=capture-room",
          name: "Catalog function",
          ok: true,
        },
      ],
    },
    ...overrides,
  };
}

function writeJsonFile(root, relativePath, value) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFinalReceiptSummary(root, {
  receiptPath = "docs/qa-evidence/2026-06-30/final-command-receipts/verification-summary.json",
  date = "2026-06-30",
  candidateSha = CANDIDATE.commit,
  inventoryPath = "docs/qa-evidence/2026-06-30/external-evidence-inventory.json",
  packetPath = "docs/qa-evidence/2026-06-30/device-evidence-packet-reviewed.json",
  stackReceiptPath = "docs/qa-evidence/2026-06-30/stack-architecture-receipt.json",
  qaPath = "docs/GSAV_NATIVE_QA.md",
  evidenceDir = null,
  protectedRef = "origin/master",
  repository = "OpsiClear-Web/diveo",
  reviewer = "@release-reviewer",
  reviewedAt = `${date}T22:35:00.000Z`,
  startedAt = `${date}T22:34:00.000Z`,
  finishedAt = `${date}T22:36:00.000Z`,
  lastMileReleaseStateLivePath = "docs/qa-evidence/2026-06-30/final-command-receipts/github-release-state-prepublish-live.json",
  lastMilePublishHashGuardLivePath = "docs/qa-evidence/2026-06-30/final-command-receipts/publish-hash-variable-guard-prepublish-live.json",
  ok = true,
  status = "pass",
  expectReadinessStatus = 0,
  publishSignoffReady = true,
  noPublishRehearsal = false,
  writeLiveEvidence = true,
  writeStackReceipt = true,
  liveReleaseState = {},
  livePublishHashGuard = {},
  stackReceipt = {},
} = {}) {
  const absolutePath = path.join(root, receiptPath);
  const receiptDir = path.posix.dirname(receiptPath);
  const summaryEvidenceDir = evidenceDir ?? receiptDir;
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const steps = [
    {
      label: "Documentation drift audit",
      command: "node scripts/verify-doc-drift.js",
      status: 0,
    },
    {
      label: "Final readiness focused tests",
      command: "node node_modules/vitest/vitest.mjs run scripts/verify-release-readiness.test.mjs scripts/verify-doc-drift.test.mjs scripts/verify-external-evidence-inventory.test.mjs scripts/device-evidence-packet.test.mjs scripts/verify-handoff-receipts.test.mjs scripts/stack-architecture-receipt.test.mjs",
      status: 0,
    },
    {
      label: "External evidence inventory replay",
      command: `node scripts/verify-external-evidence-inventory.js --inventory-path ${inventoryPath} --qa-path ${qaPath} --packet-path ${packetPath} --require-git-integrity`,
      status: 0,
    },
    {
      label: "Device packet reconciliation",
      command: `node scripts/device-evidence-packet.js --check --input-path ${packetPath} --qa-path ${qaPath} --candidate-sha ${candidateSha} --require-git-integrity`,
      status: 0,
    },
    {
      label: "Strict handoff receipt replay",
      command: `node scripts/verify-handoff-receipts.js --date ${date} --require-git-integrity`,
      status: 0,
    },
    {
      label: "Stack architecture receipt replay",
      command: `node scripts/stack-architecture-receipt.js --require-assets --verify ${stackReceiptPath}`,
      status: 0,
    },
    {
      label: "Protected master ref refresh",
      command: "git fetch --no-tags origin master",
      status: 0,
    },
    {
      label: "Protected candidate ancestry proof",
      command: `git merge-base --is-ancestor ${candidateSha} origin/master`,
      status: 0,
    },
    {
      label: "Last-mile GitHub release-state evidence",
      command: `node scripts/capture-github-release-state-evidence.js --repo ${repository} --output-path ${lastMileReleaseStateLivePath} --reviewer ${reviewer} --reviewed-at ${reviewedAt}`,
      status: 0,
    },
    {
      label: "Last-mile publish-hash variable guard",
      command: `node scripts/capture-publish-hash-variable-guard.js --repo ${repository} --output-path ${lastMilePublishHashGuardLivePath} --reviewer ${reviewer} --reviewed-at ${reviewedAt}`,
      status: 0,
    },
    {
      label: "Final release readiness",
      command: "node scripts/verify-release-readiness.js --strict-final-inputs",
      env: {
        EXTERNAL_EVIDENCE_INVENTORY_PATH: inventoryPath,
        FINAL_READINESS_RECEIPT_BOOTSTRAP: receiptPath,
        DEVICE_EVIDENCE_PACKET_PATH: packetPath,
        RELEASE_CANDIDATE_SHA: candidateSha,
      },
      status: expectReadinessStatus,
      expectedStatus: expectReadinessStatus,
    },
  ].map((step, index) => writeReceiptStepLogs(root, receiptDir, step, index));
  if (writeLiveEvidence) {
    writeJsonFile(root, lastMileReleaseStateLivePath, releaseStateEvidenceJson({
      date,
      repository,
      reviewer,
      reviewedAt,
      overrides: liveReleaseState,
    }));
    writeJsonFile(root, lastMilePublishHashGuardLivePath, publishHashGuardEvidenceJson({
      date,
      repository,
      reviewer,
      reviewedAt,
      overrides: livePublishHashGuard,
    }));
  }
  if (writeStackReceipt) {
    writeJsonFile(root, stackReceiptPath, stackArchitectureReceiptJson({
      overrides: stackReceipt,
    }));
  }
  expect(steps.map((step) => step.label)).toEqual(FINAL_RECEIPT_EXPECTED_STEP_LABELS);
  fs.writeFileSync(absolutePath, `${JSON.stringify({
    mode: "final-readiness-receipts",
    startedAt,
    finishedAt,
    ok,
    status,
    inputs: {
      date,
      candidateSha,
      inventoryPath,
      packetPath,
      stackReceiptPath,
      qaPath,
      evidenceDir: summaryEvidenceDir,
      expectReadinessStatus,
      protectedRef,
      repository,
      reviewer,
      reviewedAt,
      lastMileReleaseStateLivePath,
      lastMilePublishHashGuardLivePath,
    },
    publishSignoffReady,
    noPublishRehearsal,
    steps,
  }, null, 2)}\n`);
  return receiptPath;
}

function writeLastMileEvidence(root, {
  date = "2026-06-30",
  releaseState = {},
  publishHashGuard = {},
} = {}) {
  const evidenceDir = path.join(root, "docs", "qa-evidence", date);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const releaseStatePath = path.join(evidenceDir, "github-release-state-prepublish.json");
  const publishHashGuardPath = path.join(evidenceDir, "publish-hash-variable-guard-prepublish.json");
  fs.writeFileSync(releaseStatePath, `${JSON.stringify({
    checkedAt: `${date}T22:35:00.000Z`,
    status: "pass",
    ok: true,
    repository: "OpsiClear-Web/diveo",
    review: {
      reviewer: "@release-reviewer",
      reviewedAt: `${date}T22:35:00.000Z`,
    },
    querySummaries: {
      workflows: { exitCode: 0 },
      releaseRuns: { exitCode: 0 },
      workflowDispatchRuns: { exitCode: 0 },
      releases: { exitCode: 0 },
    },
    commands: {
      workflows: "gh api repos/OpsiClear-Web/diveo/actions/workflows",
      releaseRuns: "gh run list -R OpsiClear-Web/diveo --workflow 'Release APK' --limit 10 --json databaseId,workflowName,url",
      workflowDispatchRuns: "gh run list -R OpsiClear-Web/diveo --event workflow_dispatch --limit 20 --json databaseId,workflowName,url",
      releases: "gh release list -R OpsiClear-Web/diveo --limit 20 --json tagName,name,publishedAt",
    },
    releaseState: {
      releaseCount: 0,
      noGitHubReleasesObserved: true,
    },
    releases: [],
    successfulReleaseWorkflowDispatchRuns: [
      {
        status: "completed",
        conclusion: "success",
        event: "workflow_dispatch",
        url: "https://github.com/OpsiClear-Web/diveo/actions/runs/1",
      },
    ],
    releaseReadinessImpact: {
      status: "ready",
    },
    ...releaseState,
  }, null, 2)}\n`);
  fs.writeFileSync(publishHashGuardPath, `${JSON.stringify({
    checkedAt: `${date}T22:35:00.000Z`,
    status: "pass",
    ok: true,
    repository: "OpsiClear-Web/diveo",
    review: {
      reviewer: "@release-reviewer",
      reviewedAt: `${date}T22:35:00.000Z`,
    },
    variableQueries: [
      {
        name: "EXPECTED_RELEASE_APK_SHA256",
        status: "absent",
        absent: true,
        command: "gh variable get EXPECTED_RELEASE_APK_SHA256 --repo OpsiClear-Web/diveo --json name,value,updatedAt",
      },
      {
        name: "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256",
        status: "absent",
        absent: true,
        command: "gh variable get EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256 --repo OpsiClear-Web/diveo --json name,value,updatedAt",
      },
    ],
    releaseReadinessImpact: {
      status: "ready",
    },
    ...publishHashGuard,
  }, null, 2)}\n`);
}

function routeMatrixRows(routes = requiredEvidence
  .filter((requirement) => requirement.platform === "Android")
  .map((requirement) => requirement.route)) {
  return routes.map((route) => `| \`${route}\` | Expected behavior for ${route} |`);
}

function negativeFixtureInventoryRows(cases = requiredEvidence
  .filter((requirement) => requirement.platform === "Android/iOS")
  .map((requirement) => requirement.route)) {
  const inventoryDetails = {
    "Missing host config": {
      trigger: "Launch `/watch/test` with `EXPO_PUBLIC_GSAV_WEB_URL` unset",
      expectedSignal: "Native configuration/error UI is visible and no blank WebView is shown",
      status: "Available through app config",
    },
    "Host offline/retry": {
      trigger: "Open `/watch/test`, stop the GSAV host, then tap retry after host recovery",
      expectedSignal: "Error/retry UI appears, then recovers on retry",
      status: "Available through host control",
    },
    "Cross-origin navigation": {
      trigger: "Use `/gsav-diagnostics` with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1`, then tap `Cross-origin`",
      expectedSignal: "Navigation is blocked and the app stays on the trusted native route",
      status: "Available through diveo diagnostics QA controls",
    },
    "Unsupported renderer": {
      trigger: "Use `/gsav-diagnostics` with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1`, then tap `Unsupported`",
      expectedSignal: "Native overlay reports the QA unsupported renderer state without a blank WebView",
      status: "Available through diveo diagnostics QA controls",
    },
    "Auth initialization gate": {
      trigger: "Build with `EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000`, then mount `/watch/test` while auth restore is delayed",
      expectedSignal: "No clear-session bridge message is sent before auth initialization completes",
      status: "Available through diveo auth delay QA flag",
    },
    "Ended playback": {
      trigger: "Use `/gsav-diagnostics` with `EXPO_PUBLIC_GSAV_QA_CONTROLS=1`, tap `Ended`, then reopen `/watch/test`",
      expectedSignal: "Saved progress is cleared and stale resume is not offered",
      status: "Available through diveo diagnostics QA controls",
    },
  };
  return cases.map((fixtureCase) => {
    const detail = inventoryDetails[fixtureCase] ?? {
      trigger: `Trigger for ${fixtureCase}`,
      expectedSignal: `Expected signal for ${fixtureCase}`,
      status: "Owner-blocked until fixture is named",
    };
    return `| ${fixtureCase} | ${detail.trigger} | ${detail.expectedSignal} | ${detail.status} |`;
  });
}

function releaseEvidenceRequirementRows(rows = REQUIRED_RELEASE_EVIDENCE_REQUIREMENT_ROWS) {
  return rows.map((row) => `| ${row} | Required observed signal for ${row} |`);
}

function negativeParityNote(route) {
  if (route === "Missing host config" || route === "Host offline/retry") {
    return "; intended GSAV host for missing/offline cases=https://gsav.example.com";
  }
  if (["Cross-origin navigation", "Unsupported renderer", "Ended playback"].includes(route)) {
    return "; QA validation build parity=dry-run artifact diveo-release-evidence-v1.0.19; QA flag used=EXPO_PUBLIC_GSAV_QA_CONTROLS=1; production prerequisite evidence no QA flags=true";
  }
  if (route === "Auth initialization gate") {
    return "; QA validation build parity=dry-run artifact diveo-release-evidence-v1.0.19; QA flag used=EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000; production prerequisite evidence no QA flags=true";
  }
  return "";
}

function completeRow(requirement) {
  const isDeviceRoute = requirement.platform === "Android" || requirement.platform === "iOS";
  const isEmbeddedRoute = ["/explore", "/gsav-diagnostics", "/watch/test", "/gsav/test?t=2.5"].includes(requirement.route);
  const isNegativeCase = requirement.platform === "Android/iOS";
  const resultDetails = {
    "JS runtime smoke": "Passed: npm run gsav:runtime-smoke verified /explore?embed=native&dataSaver=1 with exactly one embed=native, exactly one dataSaver=1, one .shortsFeed, multiple .shortsItem scenes, vertical scroll snap, visible scene change after scroll, topNav absent, miniPlayer absent, captured GSAV_AUTH_READY, compatible GSAV_BRIDGE_READY bridge v1/minVersion v1, and GSAV_ROUTE_CHANGE",
    "/": "Passed: native home rendered with no web chrome",
    "/search": "Passed: native search opened /watch/test with no web chrome",
    "/library": "Passed: native saved and follow-state scenes rendered with no web chrome using a seeded release-owned test account; account-safe logs redacted",
    "/creator/:handle": "Passed: native creator profile opened /watch/:id",
    "/explore": "Passed: embed=native dataSaver=1 hidden web chrome",
    "/gsav-diagnostics": "Passed: embed=native diagnostics capabilities bridge visible",
    "/watch/test": "Passed: embed=native ready state progress saved and resume verified",
    "/gsav/test?t=2.5": "Passed: embed=native /watch/test start time 2.5 preserved",
    "Missing host config": "Passed: Android and iOS configuration error shown, no blank WebView",
    "Host offline/retry": "Passed: Android and iOS retry error appeared and recovered",
    "Cross-origin navigation": "Passed: Android and iOS cross-origin navigation blocked",
    "Unsupported renderer": "Passed: Android and iOS unsupported renderer error shown",
    "Auth initialization gate": "Passed: Android and iOS no clear-session before auth initialization",
    "Ended playback": "Passed: Android and iOS GSAV_ENDED cleared resume progress",
    "Validation prerequisites": `Passed: npm run verify:validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --apk-path android/app/build/outputs/apk/release/app-release.apk --manifest-path android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml --ios-artifact-path release-evidence/ios-wkwebview-evidence.zip --output-path release-evidence/validation-prereqs.json passed with production env/secrets configured; output path release-evidence/validation-prereqs.json captured; adb devices listed Pixel_8 in device state; validation-prereqs.json checked.android.deviceMetadata metadataOk=true; Android device model=Pixel 8; Android OS version: Android 15 API 35; Android build fingerprint=google/shiba/shiba:15/AP3A.240905.015/1234567:user/release-keys; Android WebView package=com.google.android.webview; Android WebView version=125.0.6422.147; java available; npx available; gh GitHub CLI available; generated APK metadata tool aapt available; APK path android/app/build/outputs/apk/release/app-release.apk exists; merged manifest path android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml exists; validation-prereqs.json checked.ios fields captured from IOS_VALIDATION_OWNER, IOS_VALIDATION_EXECUTOR_PROOF, IOS_VALIDATION_DEVICE, IOS_VALIDATION_VERSION, IOS_WKWEBVIEW_VERSION, IOS_VALIDATION_ARTIFACT_URL, IOS_VALIDATION_ARTIFACT_SHA256, and IOS_VALIDATION_ARTIFACT_PATH; iOS validation owner=@ios-validator; macOS 15.5 with Xcode 17 and xcrun simctl proof captured; iOS simulator iPhone 15; iOS version: iOS 18.5; iOS WKWebView version: 18.5; iOS validation artifact URL: https://github.com/opsiclear/diveo/actions/runs/123/artifacts/ios-wkwebview-evidence; iOS validation artifact SHA256=${CHECKSUM_MANIFEST_SHA}; computed iOS validation artifact SHA256=${CHECKSUM_MANIFEST_SHA}; artifactSha256Matches=true; EXPO_PUBLIC_GSAV_WEB_URL=https://gsav.example.com; EXPO_PUBLIC_GSAV_CATALOG_URL=https://catalog.example.com; EXPO_PUBLIC_GSAV_SUPABASE_URL=https://supabase.example.com; EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY present and redacted; GSAV_RANGE_PROBE_URL=https://gsav.example.com/test.gsav; GSAV_HOST_IDENTITY_URL=https://gsav.example.com/build.json; GSAV_HOSTING_COMMIT=def5678abc1234; no production QA flags; npm run release-evidence:attach-validation-prereqs attached validation-prereqs.json to downloaded-release/release-evidence/**; npm run verify:release-evidence-bundle -- --require-validation-prereqs true passed; device-validation-evidence/device-validation-bundle-verifier.json captured outside the attached bundle; uploaded attached downloaded-release/release-evidence/** and installed-smoke evidence as diveo-device-validation-2026-06-30-1`,
    "Release APK artifact": `Passed: releaseCandidateSha=abc1234567890abcdef1234567890abcdef12345; evidenceSignoffSha=abc1234567890abcdef1234567890abcdef12345; artifact name diveo-release-evidence-v1.0.19; checksum-manifest SHA256=${CHECKSUM_MANIFEST_SHA}; workflow run URL https://github.com/opsiclear/diveo/actions/runs/1; verify:release-artifact APK verifier output checked production GSAV web URL, GSAV catalog URL, Supabase URL, and Supabase anon key present; APK bundle path and merged manifest path checked; cleartext disabled; debuggable disabled; local markers absent; legacy Bilibili/proxy/DASH markers absent; apkSha256=${APK_SHA}; manifestSha256=${MANIFEST_SHA}`,
    "Release-installed APK smoke": `Passed: installed exact release APK on Pixel 8; releaseCandidateSha=abc1234567890abcdef1234567890abcdef12345; Android OS version: Android 15 API 35; Android WebView version: 125; packageName=com.opsiclear.diveo; command: npm run android:installed-smoke -- --apk-path android/app/build/outputs/apk/release/app-release.apk --output-path docs/qa-evidence/2026-06-30/android-installed-release-smoke.txt --dry-run-summary-path release-evidence/dry-run-summary.json --production-host-url https://gsav.example.com --ci-artifact-url https://github.com/opsiclear/diveo/actions/runs/1/artifacts/2; apkSha256=${APK_SHA}; apkSha256MatchesDryRunSummary=true; dumpsys package captured installedVersionCode=10019; installedVersionCodeMatchesDryRunSummary=true; productionHostUrl: https://gsav.example.com; productionHostReleaseReady=true; allowPartialRoutes=false; allowMissingLogMarkers=false; allowMissingDeviceMetadata=false; allowRehearsalHost=false; observedSignalsOk=true; observedSignalChecks passed route-change and bridge-ready-or-error markers; launched app; production GSAV host URL https://gsav.example.com; opened /explore, /gsav-diagnostics, and /watch/test deep links gsav://explore, gsav://gsav-diagnostics, and gsav://watch/test with embed=native, hidden web chrome, bridge readiness, retry UI, and resume progress behavior; filtered logcat captured ReactNativeJS, chromium, WebView, GSAV_ROUTE_CHANGE, and GSAV_BRIDGE_READY logs`,
    "Generated versionCode metadata": `Passed: versionCode releaseCandidateSha=abc1234567890abcdef1234567890abcdef12345; evidenceSignoffSha=abc1234567890abcdef1234567890abcdef12345; artifact name diveo-release-evidence-v1.0.19; checksum-manifest SHA256=${CHECKSUM_MANIFEST_SHA}; workflow run URL https://github.com/opsiclear/diveo/actions/runs/1; command: npm run android:version-metadata -- --apk-path android/app/build/outputs/apk/release/app-release.apk --expected-version-code 10019 --output-path release-evidence/apk-version-metadata.txt; release-evidence/apk-version-metadata.txt captured; Gradle versionCode: 10019, app.json versionCode: 10019, and APK badging versionCode: 10019 match`,
    "Production .gsav range probe": `Passed: release workflow production preflight used GSAV_RANGE_PROBE_URL=https://gsav.example.com/test.gsav with Range: bytes=0-0 and returned 206 plus Content-Range bytes 0-0/12345; ${RANGE_CORS_PROOF}`,
    "Release workflow dry run": `Passed: workflow_dispatch manual GitHub Actions workflow run URL https://github.com/opsiclear/diveo/actions/runs/1 used candidate_ref=abc1234567890abcdef1234567890abcdef12345, releaseCandidateSha=abc1234567890abcdef1234567890abcdef12345, evidenceSignoffSha=abc1234567890abcdef1234567890abcdef12345, production secrets, and publish_release=false; signoff diff checked as QA/audit/evidence-only; GSAV_HOSTING_COMMIT=def5678abc1234; GSAV_HOST_IDENTITY_URL=https://gsav.example.com/build.json; hostIdentityVerified=true; hostIdentity.url=https://gsav.example.com/build.json; hostIdentity.expectedIdentity=def5678abc1234; hostIdentity.observedIdentity=def5678abc1234; completed production preflight with release-evidence/gsav-preflight.json; dry-run-summary.rangeProbeUrl matched gsav-preflight.json rangeAsset.url; dry-run-summary.rangeRequest matched rangeAsset.requestRange; production preflight checked /explore?embed=native&dataSaver=1, /native-diagnostics?embed=native, /watch/test?embed=native, /watch/test?t=2.5&embed=native, and /watch/elly?embed=native; gsav-preflight.json diveoCommit matched releaseCandidateSha and recorded GSAV_HOSTING_COMMIT=def5678abc1234; gsav:runtime-smoke output release-evidence/gsav-runtime-smoke.json; gsav-runtime-smoke.json diveoCommit matched releaseCandidateSha and recorded gsavHostingCommit=def5678abc1234; Android build assembleRelease; APK verifier; artifact verification; bundle verifier npm run verify:release-evidence-bundle passed; evidence upload status uploaded release evidence including release-evidence/release-candidate.txt, release-evidence/signoff-diff-files.txt, release-evidence/no-publish-side-effect.txt, release-evidence/gsav-preflight.json, release-evidence/gsav-runtime-smoke.json, release-evidence/dry-run-summary.json, and release-evidence/evidence-checksums.txt; artifact name diveo-release-evidence-v1.0.19; checksum-manifest SHA256=${CHECKSUM_MANIFEST_SHA}; publishArtifactIdentitySha256=${PUBLISH_ARTIFACT_IDENTITY_SHA}; gsavPackageProvenanceSha256=${GSAV_PROVENANCE_SHA}; gsavPackageProvenance @opsiclear/gsav-bridge specifier=file:vendor/opsiclear-gsav-bridge-0.1.0.tgz tarballSha256=${GSAV_BRIDGE_SHA}; gsavPackageProvenance @opsiclear/gsav-client specifier=file:vendor/opsiclear-gsav-client-0.2.0.tgz tarballSha256=${GSAV_CLIENT_SHA}; publish hash pins expected_apk_sha256=${APK_SHA}, expected_publish_identity_sha256=${PUBLISH_ARTIFACT_IDENTITY_SHA}, repository variables EXPECTED_RELEASE_APK_SHA256=${APK_SHA} and EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256=${PUBLISH_ARTIFACT_IDENTITY_SHA} set for push publish; artifact review signoff reviewer=@release-reviewer; artifactReviewArtifact=diveo-release-evidence-v1.0.19; reviewedAt=2026-06-30T22:30:00Z; GitHub run conclusion=success; downloaded checksum-manifest SHA256=${CHECKSUM_MANIFEST_SHA}; verify:release-evidence-bundle rerun against downloaded bundle passed; no-publish proof recorded githubReleaseLookup=not_found and githubReleasePresent=false; git status only showed generated release-evidence outputs; git rev-parse HEAD and remote ref HEAD matched workflowSha; gh release view v1.0.19 returned authenticated not found; no GitHub release, commit, push, version bump, or publish side effect`,
    "Master branch protection": "Passed: gh api repos/opsiclear/diveo/branches/master/protection captured raw evidence path docs/qa-evidence/2026-06-30/master-branch-protection.json; protected branch=master; required status checks include quality / quality; reviewer=@release-reviewer; reviewedAt=2026-06-30T22:35:00Z; trusted GitHub evidence URL https://github.com/opsiclear/diveo/actions/runs/1/artifacts/branch-protection",
  };
  const result = resultDetails[requirement.route] ?? "Passed and validated";
  const versionCodeNote = /Android/.test(requirement.platform) || requirement.platform === "GitHub Actions release dry run"
    ? "; Android versionCode: 10019"
    : "";
  const deviceNote = isDeviceRoute
    ? `; releaseCandidateSha=${CANDIDATE.commit}; dry-run artifact=diveo-release-evidence-v1.0.19; dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1; build profile: release; ${requirement.platform} OS version: ${requirement.platform === "Android" ? "Android 15 API 35" : "iOS 18.5"}; ${requirement.platform === "Android" ? "WebView version: 125" : "WKWebView version: 18.5"}; manual action: opened ${requirement.route}; gsav-hosting commit def5678; ergonomic check: rotation portrait/landscape, safe areas around notch/home indicator, hardware back/back gesture, no clipped text, no nested touch ambiguity, and 44dp touch targets verified${isEmbeddedRoute ? `; final embedded WebView URL: https://gsav.example.com${requirement.route === "/gsav/test?t=2.5" ? "/watch/test?t=2.5&embed=native" : `${requirement.route}?embed=native`}` : ""}`
    : requirement.route === "JS runtime smoke"
      ? "; Node: v24.14.0; npm: 11.9.0; gsav-hosting commit def5678"
      : isNegativeCase
      ? `; releaseCandidateSha=${CANDIDATE.commit}; dry-run artifact=diveo-release-evidence-v1.0.19; dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1; build profile: release; Android OS version: Android 15 API 35; Android WebView version: 125; iOS OS version: iOS 18.5; iOS WKWebView version: 18.5; trigger: ${requirement.route}; manual action: executed negative validation; gsav-hosting commit def5678${negativeParityNote(requirement.route)}`
      : "; gsav-hosting commit def5678";
  const notes = `owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19${versionCodeNote}${deviceNote}`;
  const evidenceSlug = requirement.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const evidencePath = requirement.platform === "Android/iOS"
    ? `https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-${evidenceSlug}; https://github.com/opsiclear/diveo/actions/runs/1/artifacts/ios-${evidenceSlug}`
    : `https://github.com/opsiclear/diveo/actions/runs/1/artifacts/${evidenceSlug}`;
  const artifactPurposeNote = isDeviceRoute
    ? `; artifactPurpose=route-evidence; routeEvidenceManifest=route-evidence-manifest.json; evidenceManifestSha256=${CHECKSUM_MANIFEST_SHA}; sourceRunId=1; sourceArtifactId=${evidenceSlug}; mediaSha256=${CHECKSUM_MANIFEST_SHA}; helperOnly=false`
    : isNegativeCase
      ? `; artifactPurpose=negative-evidence; negativeEvidenceManifest=negative-evidence-manifest.json; evidenceManifestSha256=${CHECKSUM_MANIFEST_SHA}; sourceRunId=1; sourceArtifactId=android-${evidenceSlug}+ios-${evidenceSlug}; mediaSha256=${CHECKSUM_MANIFEST_SHA}; helperOnly=false`
      : "";

  return `| 2026-06-30 | ${requirement.platform} | Pixel 8 / iPhone 15 / CI | https://gsav.example.com | ${requirement.route} | ${result} | ${evidencePath} | ${notes}${artifactPurposeNote} |`;
}

function exceptionText({
  gate,
  reason = "external validation fixture unavailable pending release owner review",
  affected = "release validation evidence",
  approver = "@release-lead",
  revisit = "2026-07-31",
} = {}) {
  return `exception gate=${gate}; owner=@native-release; reason=${reason}; affected=${affected}; approver=${approver}; revisit=${revisit}`;
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function commitAll(root, message) {
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    message,
  ], { cwd: root, stdio: "ignore" });
  return git(root, ["rev-parse", "HEAD"]);
}

function createReleaseIdentityRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-signoff-"));
  fs.mkdirSync(path.join(root, "docs", "qa-evidence", "2026-06-30"), { recursive: true });
  fs.writeFileSync(path.join(root, "app.json"), `${JSON.stringify({
    expo: {
      version: "1.0.19",
      android: { versionCode: 10019 },
    },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ version: "1.0.19" }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "package-lock.json"), `${JSON.stringify({
    version: "1.0.19",
    packages: { "": { version: "1.0.19" } },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "docs", "GSAV_NATIVE_QA.md"), "initial QA\n");
  fs.writeFileSync(path.join(root, "docs", "IMPLEMENTATION_VALIDATION_AUDIT.md"), "initial audit\n");
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  const payloadSha = commitAll(root, "payload candidate");
  return { root, payloadSha };
}

describe("release readiness verifier", () => {
  it("requires generated versionCode metadata evidence separately from the APK scan", () => {
    expect(requiredEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "Android generated versionCode metadata",
        platform: "Android release",
        route: "Generated versionCode metadata",
        resultIncludes: "versionCode",
      }),
    ]));
  });

  it("requires JS runtime smoke evidence as part of release readiness", () => {
    expect(requiredEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "JS runtime smoke",
        platform: "JS runtime smoke",
        route: "JS runtime smoke",
      }),
    ]));
  });

  it("requires installed release APK smoke evidence separately from the APK scan", () => {
    expect(requiredEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "Android release installed APK smoke",
        platform: "Android release",
        route: "Release-installed APK smoke",
      }),
    ]));
  });

  it("requires validation prerequisite evidence before release artifact evidence", () => {
    expect(requiredEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "Release validation prerequisites",
        platform: "Release validation prerequisites",
        route: "Validation prerequisites",
      }),
    ]));
    expect(REQUIRED_RELEASE_EVIDENCE_REQUIREMENT_ROWS).toContain("Release validation prerequisites");
  });

  it("requires branch protection governance evidence before publish readiness", () => {
    expect(requiredEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "branch protection governance",
        platform: "Branch protection",
        route: "Master branch protection",
      }),
    ]));
    expect(REQUIRED_RELEASE_EVIDENCE_REQUIREMENT_ROWS).toContain("Branch protection");
  });

  it("parses QA evidence rows", () => {
    const rows = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android | Pixel 8 | https://gsav.example.com | / | Passed | docs/qa-evidence/2026-06-30/android-home.png | Notes |",
    ]));

    expect(rows).toEqual([
      {
        date: "2026-06-30",
        platform: "Android",
        device: "Pixel 8",
        gsavWebUrl: "https://gsav.example.com",
        route: "/",
        result: "Passed",
        evidencePath: "docs/qa-evidence/2026-06-30/android-home.png",
        notes: "Notes",
      },
    ]);
  });

  it("requires the QA Evidence Log schema to stay stable", () => {
    const qaText = qaDoc(requiredEvidence.map(completeRow))
      .replace("Evidence path", "Artifact");

    const result = analyzeReleaseReadiness(qaText, { candidate: CANDIDATE });

    expect(evidenceLogSchemaProblems(qaText)).toEqual([
      "QA Evidence Log columns must be: Date | Platform | Device/Emulator | GSAV web URL | diveo route | Result | Evidence path | Notes",
    ]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "evidence log schema",
        reason: "QA Evidence Log columns must be: Date | Platform | Device/Emulator | GSAV web URL | diveo route | Result | Evidence path | Notes",
      }),
    ]));
  });

  it("allows documented context-only Evidence Log rows", () => {
    const hostPreflightRow = "| 2026-06-30 | Host preflight | Windows host | http://127.0.0.1:5191 | GSAV target routes | Passed: host-root reachability context only | docs/qa-evidence/2026-06-30/diveo-gsav-preflight.txt | Historical pre-device gate; not publish evidence |";
    const qaText = qaDoc([...requiredEvidence.map(completeRow), hostPreflightRow]);

    const result = analyzeReleaseReadiness(qaText, { candidate: CANDIDATE });

    expect(evidenceLogRowSetProblems(qaText)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("requires duplicate Evidence Log rows to mark stale entries as context-only", () => {
    const stalePublishRow = "| 2026-06-30 | Android | Pixel 8 | https://gsav.example.com | / | Passed: stale route evidence | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-home | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |";
    const latestPublishRow = completeRow(requiredEvidence.find((item) => item.platform === "Android" && item.route === "/"));
    const qaText = qaDoc([
      ...requiredEvidence.filter((item) => !(item.platform === "Android" && item.route === "/")).map(completeRow),
      stalePublishRow,
      latestPublishRow,
    ]);

    expect(evidenceLogDuplicateRowProblems(qaText)).toEqual([
      "QA Evidence Log duplicate row Android / / must mark superseded/context rows as not publish evidence or keep only the latest publish row",
    ]);
    expect(analyzeReleaseReadiness(qaText, { candidate: CANDIDATE }).missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "evidence log duplicate rows",
      }),
    ]));
  });

  it("allows duplicate Evidence Log rows when stale entries are explicitly context-only", () => {
    const contextRow = "| 2026-06-30 | Android | Pixel 8 | https://gsav.example.com | / | Passed: local rehearsal route evidence | docs/qa-evidence/2026-06-30/android-home-local.txt | Local rehearsal only; not publish evidence; superseded by G3 capture |";
    const latestPublishRow = completeRow(requiredEvidence.find((item) => item.platform === "Android" && item.route === "/"));
    const qaText = qaDoc([
      ...requiredEvidence.filter((item) => !(item.platform === "Android" && item.route === "/")).map(completeRow),
      contextRow,
      latestPublishRow,
    ]);

    expect(evidenceLogDuplicateRowProblems(qaText)).toEqual([]);
  });

  it("rejects ad hoc Evidence Log rows outside the fixed row set", () => {
    const adHocPublishRow = "| 2026-06-30 | Android release | CI | https://gsav.example.com | Extra publish smoke | Passed: extra smoke row | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/extra | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |";
    const qaText = qaDoc([...requiredEvidence.map(completeRow), adHocPublishRow]);

    const result = analyzeReleaseReadiness(qaText, { candidate: CANDIDATE });

    expect(evidenceLogRowSetProblems(qaText)).toEqual([
      "QA Evidence Log row Android release / Extra publish smoke is not in the fixed publish-readiness row set or documented context-only rows",
    ]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "evidence log row set",
        reason: "QA Evidence Log row Android release / Extra publish smoke is not in the fixed publish-readiness row set or documented context-only rows",
      }),
    ]));
  });

  it("passes when all release-blocking evidence rows are complete", () => {
    const result = analyzeReleaseReadiness(qaDoc(requiredEvidence.map(completeRow)), { candidate: CANDIDATE });

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(requiredEvidence.length);
    expect(result.missing).toEqual([]);
  });

  it("requires strict device packet reconciliation when the final device-packet gate is enforced", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-packet-readiness-"));
    const result = analyzeReleaseReadiness(qaDoc(requiredEvidence.map(completeRow)), {
      root,
      qaPath: "docs/GSAV_NATIVE_QA.md",
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
      enforceDevicePacket: true,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "device evidence packet reconciliation",
        reason: "device evidence packet path is missing; set DEVICE_EVIDENCE_PACKET_PATH to the reviewed non-scaffold packet manifest for 2026-06-30",
      }),
    ]));
  });

  it("accepts an explicit device packet manifest when the strict packet checker passes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-packet-pass-"));
    const packetPath = "docs/qa-evidence/2026-06-30/reviewed-device-packet.json";
    fs.mkdirSync(path.join(root, "docs", "qa-evidence", "2026-06-30"), { recursive: true });
    fs.writeFileSync(path.join(root, packetPath), "{}\n");
    const checkerPath = path.join(root, "device-packet-checker.js");
    fs.writeFileSync(checkerPath, "console.log(JSON.stringify({ ok: true, status: 'pass', problems: [] }));\n");

    const result = analyzeReleaseReadiness(qaDoc(requiredEvidence.map(completeRow)), {
      root,
      qaPath: "docs/GSAV_NATIVE_QA.md",
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
      enforceDevicePacket: true,
      devicePacketPath: packetPath,
      devicePacketScriptPath: checkerPath,
    });

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("rejects planning packet paths before running device packet reconciliation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-packet-path-lifecycle-"));
    const checkerArgsPath = path.join(root, "checker-ran.json");
    const checkerPath = path.join(root, "device-packet-checker.js");
    fs.mkdirSync(path.join(root, "docs", "qa-evidence", "2026-06-30"), { recursive: true });
    fs.writeFileSync(
      checkerPath,
      `require("node:fs").writeFileSync(${JSON.stringify(checkerArgsPath)}, "ran"); console.log(JSON.stringify({ ok: true, status: "pass", problems: [] }));\n`,
    );

    for (const lifecycleName of ["scaffold", "candidate", "pending", "example"]) {
      const packetPath = `docs/qa-evidence/2026-06-30/device-evidence-packet-${lifecycleName}.json`;
      fs.writeFileSync(path.join(root, packetPath), "{}\n");

      const problems = deviceEvidencePacketProblems({
        root,
        rows: parseEvidenceRows(qaDoc(requiredEvidence.map(completeRow))),
        qaPath: "docs/GSAV_NATIVE_QA.md",
        devicePacketPath: packetPath,
        devicePacketScriptPath: checkerPath,
      });

      expect(problems).toEqual([
        "device evidence packet path must not reference a scaffold, candidate, pending, or example packet",
      ]);
    }
    expect(fs.existsSync(checkerArgsPath)).toBe(false);
  });

  it("passes the current candidate SHA into strict device packet reconciliation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-packet-candidate-"));
    const packetPath = "docs/qa-evidence/2026-06-30/reviewed-device-packet.json";
    const argsPath = path.join(root, "checker-args.json");
    fs.mkdirSync(path.join(root, "docs", "qa-evidence", "2026-06-30"), { recursive: true });
    fs.writeFileSync(path.join(root, packetPath), "{}\n");
    const checkerPath = path.join(root, "device-packet-checker.js");
    fs.writeFileSync(checkerPath, `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
if (!process.argv.includes("--candidate-sha") || !process.argv.includes(${JSON.stringify(CANDIDATE.commit)})) {
  console.log(JSON.stringify({ ok: false, status: "fail", problems: ["candidate sha was not forwarded"] }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, status: "pass", problems: [] }));
}
`);

    const result = analyzeReleaseReadiness(qaDoc(requiredEvidence.map(completeRow)), {
      root,
      qaPath: "docs/GSAV_NATIVE_QA.md",
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
      enforceDevicePacket: true,
      devicePacketPath: packetPath,
      devicePacketScriptPath: checkerPath,
    });

    const forwardedArgs = JSON.parse(fs.readFileSync(argsPath, "utf8"));
    expect(result.ok).toBe(true);
    expect(forwardedArgs).toEqual(expect.arrayContaining(["--candidate-sha", CANDIDATE.commit]));
  });

  it("surfaces strict device packet checker problems in release readiness", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-packet-fail-"));
    const packetPath = "docs/qa-evidence/2026-06-30/reviewed-device-packet.json";
    fs.mkdirSync(path.join(root, "docs", "qa-evidence", "2026-06-30"), { recursive: true });
    fs.writeFileSync(path.join(root, packetPath), "{}\n");
    const checkerPath = path.join(root, "device-packet-checker.js");
    fs.writeFileSync(
      checkerPath,
      "console.log(JSON.stringify({ ok: false, status: 'fail', problems: ['android-route-watch-test is still pending'] })); process.exitCode = 1;\n",
    );

    const problems = deviceEvidencePacketProblems({
      root,
      rows: parseEvidenceRows(qaDoc(requiredEvidence.map(completeRow))),
      qaPath: "docs/GSAV_NATIVE_QA.md",
      devicePacketPath: packetPath,
      devicePacketScriptPath: checkerPath,
    });

    expect(problems).toEqual([
      "device evidence packet android-route-watch-test is still pending",
    ]);
  });

  it("requires a reviewed external evidence inventory when the final inventory gate is enforced", () => {
    const result = analyzeReleaseReadiness(qaDoc(requiredEvidence.map(completeRow)), {
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
      enforceExternalEvidenceInventory: true,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "external evidence inventory replay",
        reason: `external evidence inventory path is missing; set ${EXTERNAL_EVIDENCE_INVENTORY_ENV}`,
      }),
    ]));
  });

  it("does not require the external inventory path while evidence rows are still incomplete", () => {
    const rows = requiredEvidence.map(completeRow);
    rows[0] = `| _pending_ | ${requiredEvidence[0].platform} | _pending_ | https://gsav.example.com | ${requiredEvidence[0].route} | _pending_ | _pending_ | Pending |`;

    const result = analyzeReleaseReadiness(qaDoc(rows), {
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
      enforceExternalEvidenceInventory: true,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      expect.objectContaining({ id: requiredEvidence[0].id }),
    ]);
    expect(result.missing).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "external evidence inventory replay" }),
    ]));
    expect(result.missing.map((problem) => problem.reason).join("\n")).not.toContain(EXTERNAL_EVIDENCE_INVENTORY_ENV);
  });

  it("reports deferred final input blockers when strict diagnostics are requested before rows are complete", () => {
    const rows = requiredEvidence.map(completeRow);
    rows[0] = `| _pending_ | ${requiredEvidence[0].platform} | _pending_ | https://gsav.example.com | ${requiredEvidence[0].route} | _pending_ | _pending_ | Pending |`;

    const result = analyzeReleaseReadiness(qaDoc(rows), {
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
      enforceDevicePacket: true,
      enforceExternalEvidenceInventory: true,
      enforceAuditSignoff: true,
      reportDeferredFinalInputs: true,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: requiredEvidence[0].id }),
      expect.objectContaining({
        id: "deferred device evidence packet input",
        reason: `device evidence packet path is missing; set ${DEVICE_PACKET_ENV} to the reviewed non-scaffold packet manifest`,
      }),
      expect.objectContaining({
        id: "deferred external evidence inventory input",
        reason: `external evidence inventory path is missing; set ${EXTERNAL_EVIDENCE_INVENTORY_ENV}`,
      }),
      expect.objectContaining({
        id: "deferred audit signoff input",
        reason: "audit signoff document is missing",
      }),
    ]));
  });

  it("validates deferred final input path lifecycle without running final replay checks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deferred-final-inputs-"));
    const inventoryPath = "docs/qa-evidence/2026-06-30/external-evidence-inventory.json";
    const packetPath = "docs/qa-evidence/2026-06-30/device-evidence-packet-candidate.json";
    fs.mkdirSync(path.join(root, "docs", "qa-evidence", "2026-06-30"), { recursive: true });
    fs.writeFileSync(path.join(root, inventoryPath), "{}\n");
    fs.writeFileSync(path.join(root, packetPath), "{}\n");

    const problems = deferredFinalInputProblems({
      root,
      devicePacketPath: packetPath,
      externalEvidenceInventoryPath: inventoryPath,
      auditText: [
        "## Final Publish Signoff",
        "decision=no-publish; externalEvidenceInventoryPath=docs/qa-evidence/2026-06-30/external-evidence-inventory.json; deviceEvidencePacketPath=docs/qa-evidence/2026-06-30/device-evidence-packet-candidate.json",
      ].join("\n"),
    });

    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "deferred device evidence packet input",
        reason: "device evidence packet path must not reference a scaffold, candidate, pending, or example packet",
      }),
      expect.objectContaining({
        id: "deferred audit signoff input",
        reason: "audit signoff deviceEvidencePacketPath must not reference a scaffold, candidate, pending, or example packet",
      }),
    ]));
  });

  it("accepts a reviewed external evidence inventory when the strict inventory verifier passes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "external-inventory-pass-"));
    const packetPath = "docs/qa-evidence/2026-06-30/reviewed-device-packet.json";
    const inventoryPath = "docs/qa-evidence/2026-06-30/external-evidence-inventory.json";
    const argsPath = path.join(root, "inventory-args.json");
    fs.mkdirSync(path.join(root, "docs", "qa-evidence", "2026-06-30"), { recursive: true });
    fs.writeFileSync(path.join(root, packetPath), "{}\n");
    fs.writeFileSync(path.join(root, inventoryPath), "{}\n");
    const inventoryCheckerPath = path.join(root, "inventory-checker.js");
    fs.writeFileSync(inventoryCheckerPath, `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ ok: true, status: "pass", problems: [] }));
`);

    const result = analyzeReleaseReadiness(qaDoc(requiredEvidence.map(completeRow)), {
      root,
      qaPath: "docs/GSAV_NATIVE_QA.md",
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
      enforceExternalEvidenceInventory: true,
      externalEvidenceInventoryPath: inventoryPath,
      externalEvidenceInventoryScriptPath: inventoryCheckerPath,
      devicePacketPath: packetPath,
    });

    const forwardedArgs = JSON.parse(fs.readFileSync(argsPath, "utf8"));
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(forwardedArgs).toEqual(expect.arrayContaining([
      "--inventory-path",
      path.join(root, inventoryPath),
      "--qa-path",
      path.join(root, "docs/GSAV_NATIVE_QA.md"),
      "--packet-path",
      path.join(root, packetPath),
      "--require-git-integrity",
    ]));
  });

  it("rejects planning packet paths before running external inventory replay", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "external-inventory-packet-lifecycle-"));
    const inventoryPath = "docs/qa-evidence/2026-06-30/external-evidence-inventory.json";
    const inventoryArgsPath = path.join(root, "inventory-ran.json");
    const inventoryCheckerPath = path.join(root, "inventory-checker.js");
    fs.mkdirSync(path.join(root, "docs", "qa-evidence", "2026-06-30"), { recursive: true });
    fs.writeFileSync(path.join(root, inventoryPath), "{}\n");
    fs.writeFileSync(
      inventoryCheckerPath,
      `require("node:fs").writeFileSync(${JSON.stringify(inventoryArgsPath)}, "ran"); console.log(JSON.stringify({ ok: true, status: "pass", problems: [] }));\n`,
    );

    for (const lifecycleName of ["scaffold", "candidate", "pending", "example"]) {
      const packetPath = `docs/qa-evidence/2026-06-30/device-evidence-packet-${lifecycleName}.json`;
      fs.writeFileSync(path.join(root, packetPath), "{}\n");

      const problems = externalEvidenceInventoryProblems({
        root,
        rows: parseEvidenceRows(qaDoc(requiredEvidence.map(completeRow))),
        qaPath: "docs/GSAV_NATIVE_QA.md",
        externalEvidenceInventoryPath: inventoryPath,
        externalEvidenceInventoryScriptPath: inventoryCheckerPath,
        devicePacketPath: packetPath,
      });

      expect(problems).toEqual([
        "external evidence inventory packet path must not reference a scaffold, candidate, pending, or example packet",
      ]);
    }
    expect(fs.existsSync(inventoryArgsPath)).toBe(false);
  });

  it("surfaces strict external inventory verifier problems in release readiness", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "external-inventory-fail-"));
    const inventoryPath = "docs/qa-evidence/2026-06-30/external-evidence-inventory.json";
    const packetPath = "docs/qa-evidence/2026-06-30/reviewed-device-packet.json";
    fs.mkdirSync(path.join(root, "docs", "qa-evidence", "2026-06-30"), { recursive: true });
    fs.writeFileSync(path.join(root, inventoryPath), "{}\n");
    fs.writeFileSync(path.join(root, packetPath), "{}\n");
    const inventoryCheckerPath = path.join(root, "inventory-checker.js");
    fs.writeFileSync(
      inventoryCheckerPath,
      "console.log(JSON.stringify({ ok: false, status: 'fail', problems: ['route artifact helperOnly must be false'] })); process.exitCode = 1;\n",
    );

    const problems = externalEvidenceInventoryProblems({
      root,
      rows: parseEvidenceRows(qaDoc(requiredEvidence.map(completeRow))),
      qaPath: "docs/GSAV_NATIVE_QA.md",
      externalEvidenceInventoryPath: inventoryPath,
      externalEvidenceInventoryScriptPath: inventoryCheckerPath,
      devicePacketPath: packetPath,
    });

    expect(problems).toEqual([
      "external evidence inventory route artifact helperOnly must be false",
    ]);
  });

  it("requires an explicit reviewed packet path instead of deriving a scaffold packet path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-packet-date-"));
    const packetPath = "docs/qa-evidence/2026-06-30/device-evidence-packet-scaffold.json";
    fs.mkdirSync(path.join(root, "docs", "qa-evidence", "2026-06-30"), { recursive: true });
    fs.writeFileSync(path.join(root, packetPath), "{}\n");
    const checkerPath = path.join(root, "device-packet-checker.js");
    fs.writeFileSync(checkerPath, "console.log(JSON.stringify({ ok: true, status: 'pass', problems: [] }));\n");
    const oldHistoricalDeviceRow = "| 2026-06-29 | Android | Pixel 7 | https://gsav.example.com | / | Passed: historical route rehearsal | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/old-home | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019; build profile: release; Android OS version: Android 14; WebView version: 124; manual action: opened /; gsav-hosting commit def5678; ergonomic check: rotation portrait/landscape, safe areas, hardware back, no clipped text, no nested touch ambiguity, and 44dp touch targets verified |";

    const problems = deviceEvidencePacketProblems({
      root,
      rows: parseEvidenceRows(qaDoc([oldHistoricalDeviceRow, ...requiredEvidence.map(completeRow)])),
      qaPath: "docs/GSAV_NATIVE_QA.md",
      devicePacketScriptPath: checkerPath,
    });

    expect(problems).toEqual([
      "device evidence packet path is missing; set DEVICE_EVIDENCE_PACKET_PATH to the reviewed non-scaffold packet manifest for 2026-06-30",
    ]);
  });

  it("passes the final audit gate when publish signoff and review ledger are complete", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-audit-receipts-"));
    writeFinalReceiptSummary(root);
    writeLastMileEvidence(root);
    const auditText = auditDoc();
    const result = analyzeReleaseReadiness(qaDoc(requiredEvidence.map(completeRow)), {
      root,
      auditText,
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
    });

    expect(parseExternalReviewLedgerRows(auditText)).toHaveLength(REQUIRED_EXTERNAL_REVIEW_LEDGER_CATEGORIES.length);
    expect(auditSignoffProblems(auditText, { root, candidate: CANDIDATE })).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("rejects audit validation-prereq ledger iOS artifact proof without a direct byte URL", () => {
    const directUrl = "iOS artifact URL=https://github.com/opsiclear/diveo/actions/runs/123/artifacts/ios-wkwebview-evidence";
    const bareRunAudit = auditDoc().replace(directUrl, "iOS artifact URL=https://github.com/opsiclear/diveo/actions/runs/123");
    const releaseTagAudit = auditDoc().replace(directUrl, "iOS artifact URL=https://github.com/opsiclear/diveo/releases/tag/v1.0.19");

    expect(auditSignoffProblems(bareRunAudit, { candidate: CANDIDATE })).toContain(
      "audit external evidence review ledger Release validation prerequisites and device-validation bundle row must include direct iOS artifact URL and SHA256 value",
    );
    expect(auditSignoffProblems(releaseTagAudit, { candidate: CANDIDATE })).toContain(
      "audit external evidence review ledger Release validation prerequisites and device-validation bundle row must include direct iOS artifact URL and SHA256 value",
    );
  });

  it("requires final audit signoff fields to live under the Final Publish Signoff section", () => {
    const weakAudit = auditDoc().replace("## Final Publish Signoff", "## Historical Publish Notes");

    const problems = auditSignoffProblems(weakAudit, { candidate: CANDIDATE });

    expect(problems).toEqual(expect.arrayContaining([
      "audit signoff must include ## Final Publish Signoff section",
      "audit signoff must include decision=publish or decision=no-publish",
      "audit signoff must include payloadSha=<sha>",
    ]));
  });

  it("requires final audit signoff to include concrete publish hash pins", () => {
    const rows = parseEvidenceRows(qaDoc(requiredEvidence.map(completeRow)));
    const missingPins = auditSignoffProblems(auditDoc({
      expectedApkSha256: "_pending_",
      expectedPublishIdentitySha256: "_pending_",
    }), { candidate: CANDIDATE, rows });
    const mismatchedPins = auditSignoffProblems(auditDoc({
      expectedApkSha256: MANIFEST_SHA,
      expectedPublishIdentitySha256: CHECKSUM_MANIFEST_SHA,
    }), { candidate: CANDIDATE, rows });

    expect(missingPins).toEqual(expect.arrayContaining([
      "audit signoff must include expected_apk_sha256=<64-hex sha> or EXPECTED_RELEASE_APK_SHA256=<64-hex sha>",
      "audit signoff must include expected_publish_identity_sha256=<64-hex sha> or EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256=<64-hex sha>",
    ]));
    expect(mismatchedPins).toEqual(expect.arrayContaining([
      "audit signoff expected_apk_sha256 must match the reviewed release APK apkSha256",
      "audit signoff expected_apk_sha256 must match the release dry-run QA row expected_apk_sha256",
      "audit signoff expected_publish_identity_sha256 must match publishArtifactIdentitySha256",
      "audit signoff expected_publish_identity_sha256 must match the release dry-run QA row expected_publish_identity_sha256",
    ]));
  });

  it("requires final audit signoff to name the reviewed inventory and packet paths", () => {
    const rows = parseEvidenceRows(qaDoc(requiredEvidence.map(completeRow)));
    const missingOrPending = auditSignoffProblems(auditDoc({
      externalEvidenceInventoryPath: "_pending_",
      deviceEvidencePacketPath: "docs/qa-evidence/2026-06-30/device-evidence-packet-scaffold.json",
    }), { candidate: CANDIDATE, rows });
    const mismatchedEnvPaths = auditSignoffProblems(auditDoc(), {
      candidate: CANDIDATE,
      rows,
      externalEvidenceInventoryPath: "docs/qa-evidence/2026-07-01/external-evidence-inventory.json",
      devicePacketPath: "docs/qa-evidence/2026-06-30/other-reviewed-packet.json",
    });

    expect(missingOrPending).toEqual(expect.arrayContaining([
      "audit signoff must include externalEvidenceInventoryPath=docs/qa-evidence/<date>/external-evidence-inventory.json",
      "audit signoff deviceEvidencePacketPath must not reference a scaffold, candidate, pending, or example packet",
    ]));
    expect(mismatchedEnvPaths).toEqual(expect.arrayContaining([
      "audit signoff externalEvidenceInventoryPath must match EXTERNAL_EVIDENCE_INVENTORY_PATH",
      "audit signoff deviceEvidencePacketPath must match DEVICE_EVIDENCE_PACKET_PATH",
    ]));
  });

  it("requires final audit inventory and packet paths to use the same evidence date", () => {
    const rows = parseEvidenceRows(qaDoc(requiredEvidence.map(completeRow)));
    const problems = auditSignoffProblems(auditDoc({
      externalEvidenceInventoryPath: "docs/qa-evidence/2026-07-01/external-evidence-inventory.json",
      deviceEvidencePacketPath: "docs/qa-evidence/2026-06-30/device-evidence-packet-reviewed.json",
    }), { candidate: CANDIDATE, rows });

    expect(problems).toContain(
      "audit signoff externalEvidenceInventoryPath and deviceEvidencePacketPath must use the same docs/qa-evidence/<date> folder",
    );
  });

  it("requires final audit protected-candidate proof and final command receipt summary", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-audit-"));
    const missingOrPending = auditSignoffProblems(auditDoc({
      protectedCandidateProof: "_pending_",
      finalCommandReceiptsPath: "_pending_",
    }), { root, candidate: CANDIDATE });
    const missingSummary = auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE });

    writeFinalReceiptSummary(root, {
      status: "expected-readiness-fail",
      expectReadinessStatus: 1,
      publishSignoffReady: false,
      noPublishRehearsal: true,
    });
    const rehearsalSummary = auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE });

    expect(missingOrPending).toEqual(expect.arrayContaining([
      "audit signoff must include protectedCandidateProof=<final receipt protected-candidate ancestry proof>",
      "audit signoff must include finalCommandReceiptsPath=docs/qa-evidence/<date>/final-command-receipts/verification-summary.json",
    ]));
    expect(missingSummary).toContain(
      "audit signoff finalCommandReceiptsPath missing at docs/qa-evidence/2026-06-30/final-command-receipts/verification-summary.json",
    );
    expect(rehearsalSummary).toEqual(expect.arrayContaining([
      "audit final command receipts summary must have status=pass and ok=true",
      "audit final command receipts summary must have inputs.expectReadinessStatus=0",
      "audit final command receipts summary must have publishSignoffReady=true",
      "audit final command receipts summary must have noPublishRehearsal=false",
    ]));
  });

  it("allows the final receipt wrapper to bootstrap the summary it is writing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-bootstrap-"));
    writeLastMileEvidence(root);
    const receiptPath = "docs/qa-evidence/2026-06-30/final-command-receipts/verification-summary.json";

    expect(auditSignoffProblems(auditDoc(), {
      root,
      candidate: CANDIDATE,
      finalReceiptBootstrapPath: receiptPath,
    })).toEqual([]);
  });

  it("requires the final receipt summary to match audit inputs and protected proof", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-summary-bindings-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root, {
      inventoryPath: "docs/qa-evidence/2026-06-30/other-inventory.json",
      packetPath: "docs/qa-evidence/2026-06-30/other-packet.json",
      protectedRef: "origin/develop",
    });
    const receiptPath = path.join(root, "docs", "qa-evidence", "2026-06-30", "final-command-receipts", "verification-summary.json");
    const summary = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    summary.steps = [];
    fs.writeFileSync(receiptPath, `${JSON.stringify(summary, null, 2)}\n`);

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit final command receipts summary inventoryPath must match externalEvidenceInventoryPath",
      "audit final command receipts summary packetPath must match deviceEvidencePacketPath",
      "audit final command receipts summary must have inputs.protectedRef=origin/master",
      "audit final command receipts summary must include a passing Protected candidate ancestry proof step",
      "audit final command receipts summary must include a passing Last-mile GitHub release-state evidence step",
      "audit final command receipts summary must include a passing Last-mile publish-hash variable guard step",
    ]));
  });

  it("rejects contradictory final receipt pass summaries with failure fields", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-pass-contradiction-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root);
    const receiptPath = path.join(root, "docs", "qa-evidence", "2026-06-30", "final-command-receipts", "verification-summary.json");
    const summary = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    summary.failedStep = { label: "Documentation drift audit" };
    summary.outputProblems = ["stale live output should not be present on a pass summary"];
    fs.writeFileSync(receiptPath, `${JSON.stringify(summary, null, 2)}\n`);

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit final command receipts summary must not include failedStep when status=pass",
      "audit final command receipts summary must not include outputProblems when status=pass",
    ]));
  });

  it("requires final receipt summary timing to stay on the evidence date and in order", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-timing-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root, {
      startedAt: "2026-06-29T22:36:00.000Z",
      finishedAt: "2026-06-29T22:35:00.000Z",
    });

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit final command receipts summary startedAt must be an ISO timestamp on the final evidence date",
      "audit final command receipts summary finishedAt must be an ISO timestamp on the final evidence date",
    ]));

    writeFinalReceiptSummary(root, {
      startedAt: "2026-06-30T22:36:00.000Z",
      finishedAt: "2026-06-30T22:35:00.000Z",
    });

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toContain(
      "audit final command receipts summary finishedAt must not be before startedAt",
    );
  });

  it("requires the complete ordered final receipt wrapper step set", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-step-set-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root);
    const receiptPath = path.join(root, "docs", "qa-evidence", "2026-06-30", "final-command-receipts", "verification-summary.json");
    const summary = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    const expectedError = `audit final command receipts summary must include exactly the ${FINAL_RECEIPT_EXPECTED_STEP_LABELS.length} final receipt wrapper steps in order: ${FINAL_RECEIPT_EXPECTED_STEP_LABELS.join("; ")}`;

    const missingStepSummary = {
      ...summary,
      steps: summary.steps.filter((step) => step.label !== "Documentation drift audit"),
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(missingStepSummary, null, 2)}\n`);

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toContain(expectedError);

    const duplicateStepSummary = JSON.parse(JSON.stringify(summary));
    duplicateStepSummary.steps[0].label = duplicateStepSummary.steps[1].label;
    fs.writeFileSync(receiptPath, `${JSON.stringify(duplicateStepSummary, null, 2)}\n`);

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toContain(expectedError);

    const reorderedStepSummary = JSON.parse(JSON.stringify(summary));
    [reorderedStepSummary.steps[0], reorderedStepSummary.steps[1]] = [
      reorderedStepSummary.steps[1],
      reorderedStepSummary.steps[0],
    ];
    fs.writeFileSync(receiptPath, `${JSON.stringify(reorderedStepSummary, null, 2)}\n`);

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toContain(expectedError);
  });

  it("requires every final receipt wrapper step to pass for publish signoff", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-step-status-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root);
    const receiptPath = path.join(root, "docs", "qa-evidence", "2026-06-30", "final-command-receipts", "verification-summary.json");
    const summary = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    const docsStep = summary.steps.find((step) => step.label === "Documentation drift audit");
    const finalReadinessStep = summary.steps.find((step) => step.label === "Final release readiness");
    docsStep.status = 1;
    finalReadinessStep.expectedStatus = 1;
    fs.writeFileSync(receiptPath, `${JSON.stringify(summary, null, 2)}\n`);

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit final command receipts step Documentation drift audit must have status=0 for publish signoff",
      "audit final command receipts step Final release readiness must have expectedStatus=0 for publish signoff",
    ]));
  });

  it("requires the final release readiness step to bind strict inputs through its safe env", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-readiness-env-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root);
    const receiptPath = path.join(root, "docs", "qa-evidence", "2026-06-30", "final-command-receipts", "verification-summary.json");
    const summary = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    const finalReadinessStep = summary.steps.find((step) => step.label === "Final release readiness");
    finalReadinessStep.command = "node scripts/verify-release-readiness.js";
    finalReadinessStep.env = {
      EXTERNAL_EVIDENCE_INVENTORY_PATH: "docs/qa-evidence/2026-06-30/other-inventory.json",
      FINAL_READINESS_RECEIPT_BOOTSTRAP: "docs/qa-evidence/2026-06-30/final-command-receipts/other-summary.json",
      DEVICE_EVIDENCE_PACKET_PATH: "docs/qa-evidence/2026-06-30/other-packet.json",
      RELEASE_CANDIDATE_SHA: "0000000000000000000000000000000000000000",
      SECRET_VALUE: "do-not-allow",
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(summary, null, 2)}\n`);

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit final command receipts Final release readiness step must run verify-release-readiness.js --strict-final-inputs",
      "audit final command receipts Final release readiness step env EXTERNAL_EVIDENCE_INVENTORY_PATH must match externalEvidenceInventoryPath",
      "audit final command receipts Final release readiness step env DEVICE_EVIDENCE_PACKET_PATH must match deviceEvidencePacketPath",
      "audit final command receipts Final release readiness step env FINAL_READINESS_RECEIPT_BOOTSTRAP must match finalCommandReceiptsPath",
      "audit final command receipts Final release readiness step env RELEASE_CANDIDATE_SHA must match the release candidate commit",
      "audit final command receipts Final release readiness step env must only include safe final input keys: EXTERNAL_EVIDENCE_INVENTORY_PATH, DEVICE_EVIDENCE_PACKET_PATH, RELEASE_CANDIDATE_SHA, FINAL_READINESS_RECEIPT_BOOTSTRAP",
    ]));
  });

  it("requires final receipt internal proof steps to run strict commands", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-internal-commands-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root);
    const receiptPath = path.join(root, "docs", "qa-evidence", "2026-06-30", "final-command-receipts", "verification-summary.json");
    const summary = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    for (const step of summary.steps) {
      if (step.label === "Documentation drift audit") {
        step.command = "node scripts/verify-whitespace.js";
      } else if (step.label === "Final readiness focused tests") {
        step.command = "node node_modules/vitest/vitest.mjs run scripts/verify-release-readiness.test.mjs";
      } else if (step.label === "External evidence inventory replay") {
        step.command = "node scripts/verify-external-evidence-inventory.js --inventory-path docs/qa-evidence/2026-06-30/external-evidence-inventory.json --qa-path docs/GSAV_NATIVE_QA.md --packet-path docs/qa-evidence/2026-06-30/device-evidence-packet-reviewed.json";
      } else if (step.label === "Device packet reconciliation") {
        step.command = "node scripts/device-evidence-packet.js --check --input-path docs/qa-evidence/2026-06-30/device-evidence-packet-reviewed.json --qa-path docs/GSAV_NATIVE_QA.md --require-git-integrity";
      } else if (step.label === "Strict handoff receipt replay") {
        step.command = "node scripts/verify-handoff-receipts.js --date 2026-06-29 --require-git-integrity";
      } else if (step.label === "Stack architecture receipt replay") {
        step.command = "node scripts/stack-architecture-receipt.js --verify docs/qa-evidence/2026-06-30/stack-architecture-receipt.json";
      } else if (step.label === "Protected master ref refresh") {
        step.command = "git fetch origin master";
      } else if (step.label === "Protected candidate ancestry proof") {
        step.command = "git merge-base --is-ancestor 0000000000000000000000000000000000000000 origin/master";
      }
    }
    fs.writeFileSync(receiptPath, `${JSON.stringify(summary, null, 2)}\n`);

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit final command receipts Documentation drift audit step must run verify-doc-drift.js",
      "audit final command receipts Final readiness focused tests step must run node_modules/vitest/vitest.mjs run scripts/verify-release-readiness.test.mjs scripts/verify-doc-drift.test.mjs scripts/verify-external-evidence-inventory.test.mjs scripts/device-evidence-packet.test.mjs scripts/verify-handoff-receipts.test.mjs scripts/stack-architecture-receipt.test.mjs",
      "audit final command receipts External evidence inventory replay step must run verify-external-evidence-inventory.js with reviewed inventory, QA path, packet path, and --require-git-integrity",
      "audit final command receipts Device packet reconciliation step must run device-evidence-packet.js --check with reviewed packet, QA path, candidate SHA, and --require-git-integrity",
      "audit final command receipts Strict handoff receipt replay step must run verify-handoff-receipts.js with final evidence date and --require-git-integrity",
      "audit final command receipts Stack architecture receipt replay step must run stack-architecture-receipt.js --require-assets --verify with the reviewed stack receipt",
      "audit final command receipts Protected master ref refresh step must run git fetch --no-tags origin master",
      "audit final command receipts Protected candidate ancestry proof step must run git merge-base --is-ancestor <candidate-sha> origin/master",
    ]));
  });

  it("requires final receipt summaries and replay commands to use the canonical QA path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-qa-path-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root, {
      qaPath: "docs/STALE_QA.md",
    });

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit final command receipts summary qaPath must be docs/GSAV_NATIVE_QA.md",
      "audit final command receipts External evidence inventory replay step must run verify-external-evidence-inventory.js with reviewed inventory, QA path, packet path, and --require-git-integrity",
      "audit final command receipts Device packet reconciliation step must run device-evidence-packet.js --check with reviewed packet, QA path, candidate SHA, and --require-git-integrity",
    ]));
  });

  it("requires final receipt summaries to bind evidenceDir to the audited receipt directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-evidence-dir-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root, {
      evidenceDir: "docs/qa-evidence/2026-06-30/custom-receipts",
    });

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toContain(
      "audit final command receipts summary evidenceDir must match finalCommandReceiptsPath directory",
    );
  });

  it("requires the final receipt summary to bind live last-mile evidence paths to its evidence date", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-last-mile-bindings-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root, {
      date: "2026-06-29",
      lastMileReleaseStateLivePath: "docs/qa-evidence/2026-06-29/final-command-receipts/github-release-state-prepublish-live.json",
      lastMilePublishHashGuardLivePath: "docs/qa-evidence/2026-06-29/final-command-receipts/publish-hash-variable-guard-prepublish-live.json",
    });

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit final command receipts summary date must match finalCommandReceiptsPath evidence date",
      "audit final command receipts summary lastMileReleaseStateLivePath must match the final receipt live release-state evidence path",
      "audit final command receipts summary lastMilePublishHashGuardLivePath must match the final receipt live publish-hash guard evidence path",
    ]));
  });

  it("requires final receipt last-mile steps to write to the summary live paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-step-output-bindings-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root);
    const receiptPath = path.join(root, "docs", "qa-evidence", "2026-06-30", "final-command-receipts", "verification-summary.json");
    const summary = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    for (const step of summary.steps) {
      if (step.label === "Last-mile GitHub release-state evidence") {
        step.command = step.command.replace(
          "docs/qa-evidence/2026-06-30/final-command-receipts/github-release-state-prepublish-live.json",
          "docs/qa-evidence/2026-06-29/final-command-receipts/github-release-state-prepublish-live.json",
        );
      }
      if (step.label === "Last-mile publish-hash variable guard") {
        step.command = step.command.replace(
          "docs/qa-evidence/2026-06-30/final-command-receipts/publish-hash-variable-guard-prepublish-live.json",
          "docs/qa-evidence/2026-06-29/final-command-receipts/publish-hash-variable-guard-prepublish-live.json",
        );
      }
    }
    fs.writeFileSync(receiptPath, `${JSON.stringify(summary, null, 2)}\n`);

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit final command receipts Last-mile GitHub release-state evidence step must write --output-path to inputs.lastMileReleaseStateLivePath",
      "audit final command receipts Last-mile publish-hash variable guard step must write --output-path to inputs.lastMilePublishHashGuardLivePath",
    ]));
  });

  it("requires final receipt live last-mile JSON to exist and match summary metadata", () => {
    const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-live-missing-"));
    writeLastMileEvidence(missingRoot);
    writeFinalReceiptSummary(missingRoot, {
      writeLiveEvidence: false,
    });

    expect(auditSignoffProblems(auditDoc(), { root: missingRoot, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit final command receipts live release-state evidence missing at docs/qa-evidence/2026-06-30/final-command-receipts/github-release-state-prepublish-live.json",
      "audit final command receipts live publish-hash guard evidence missing at docs/qa-evidence/2026-06-30/final-command-receipts/publish-hash-variable-guard-prepublish-live.json",
    ]));

    const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-live-stale-"));
    writeLastMileEvidence(staleRoot);
    writeFinalReceiptSummary(staleRoot, {
      liveReleaseState: {
        checkedAt: "2026-06-29T22:35:00.000Z",
        repository: "opsiclear/diveo",
        review: {
          reviewer: "@other-reviewer",
          reviewedAt: "2026-06-30T22:40:00.000Z",
        },
        releaseReadinessImpact: {
          status: "no-publish",
        },
      },
      livePublishHashGuard: {
        checkedAt: "2026-06-29T22:35:00.000Z",
        repository: "opsiclear/diveo",
        variableQueries: [
          {
            name: "EXPECTED_RELEASE_APK_SHA256",
            status: "absent",
            absent: true,
            command: "gh variable get EXPECTED_RELEASE_APK_SHA256 --repo opsiclear/diveo --json name,value,updatedAt",
          },
          {
            name: "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256",
            status: "present",
            absent: false,
            command: "gh variable get EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256 --repo OpsiClear-Web/diveo --json name,value,updatedAt",
          },
        ],
      },
    });

    expect(auditSignoffProblems(auditDoc(), { root: staleRoot, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit final command receipts live release-state evidence checkedAt must be an ISO timestamp on the final evidence date",
      "audit last-mile live release-state evidence repository must match final command receipt summary repository",
      "audit last-mile live release-state evidence review.reviewer must match final command receipt summary reviewer",
      "audit last-mile live release-state evidence review.reviewedAt must match final command receipt summary reviewedAt",
      "audit final command receipts live release-state evidence releaseReadinessImpact.status must be ready",
      "audit final command receipts live publish-hash guard evidence checkedAt must be an ISO timestamp on the final evidence date",
      "audit last-mile live publish-hash guard evidence repository must match final command receipt summary repository",
      "audit final command receipts live publish-hash guard evidence query for EXPECTED_RELEASE_APK_SHA256 must use final command receipt summary repository",
      "audit final command receipts live publish-hash guard evidence must prove EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256 is absent",
    ]));
  });

  it("requires final receipt last-mile commands to use summary review metadata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-last-mile-review-bindings-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root);
    const receiptPath = path.join(root, "docs", "qa-evidence", "2026-06-30", "final-command-receipts", "verification-summary.json");
    const summary = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    summary.inputs.repository = "example/not-diveo";
    summary.inputs.reviewer = "reviewer";
    summary.inputs.reviewedAt = "2026-06-29T22:35:00.000Z";
    fs.writeFileSync(receiptPath, `${JSON.stringify(summary, null, 2)}\n`);

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit final command receipts summary repository must target the trusted Diveo repository",
      "audit final command receipts summary reviewer must be concrete",
      "audit final command receipts summary reviewedAt must be an ISO timestamp on the final evidence date",
      "audit final command receipts Last-mile GitHub release-state evidence step must use summary repository, reviewer, and reviewedAt",
      "audit final command receipts Last-mile publish-hash variable guard step must use summary repository, reviewer, and reviewedAt",
    ]));
  });

  it("requires final receipt repository to match the final audit runUrl repository", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-run-url-repo-"));
    writeLastMileEvidence(root, {
      releaseState: {
        repository: "opsiclear/diveo",
      },
      publishHashGuard: {
        repository: "opsiclear/diveo",
      },
    });
    writeFinalReceiptSummary(root, {
      repository: "opsiclear/diveo",
    });

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toContain(
      "audit final command receipts summary repository must match audit runUrl repository",
    );
  });

  it("requires final receipt step logs to exist and match recorded hashes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "final-receipt-step-log-hashes-"));
    writeLastMileEvidence(root);
    writeFinalReceiptSummary(root);
    const receiptDir = path.join(root, "docs", "qa-evidence", "2026-06-30", "final-command-receipts");
    const receiptPath = path.join(receiptDir, "verification-summary.json");
    const summary = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    const protectedProofStep = summary.steps.find((step) => step.label === "Protected candidate ancestry proof");
    const releaseStateStep = summary.steps.find((step) => step.label === "Last-mile GitHub release-state evidence");
    const publishHashStep = summary.steps.find((step) => step.label === "Last-mile publish-hash variable guard");
    fs.unlinkSync(path.join(receiptDir, protectedProofStep.stdoutPath));
    fs.appendFileSync(path.join(receiptDir, releaseStateStep.stderrPath), "tampered\n");
    publishHashStep.stdoutPath = "../publish-hash.stdout.log";
    publishHashStep.combinedSha256 = "0".repeat(64);
    fs.writeFileSync(receiptPath, `${JSON.stringify(summary, null, 2)}\n`);

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      `audit final command receipts step Protected candidate ancestry proof stdoutPath missing at docs/qa-evidence/2026-06-30/final-command-receipts/${protectedProofStep.stdoutPath}`,
      "audit final command receipts step Last-mile GitHub release-state evidence stderr hash must match stderrPath bytes",
      "audit final command receipts step Last-mile GitHub release-state evidence combinedSha256 must match stdout plus stderr bytes",
      "audit final command receipts step Last-mile publish-hash variable guard stdoutPath must be a .stdout.log file under final-command-receipts",
    ]));
  });

  it("requires final audit last-mile release-state and publish-hash guard evidence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "last-mile-signoff-"));
    writeFinalReceiptSummary(root);
    const missingOrPending = auditSignoffProblems(auditDoc({
      lastMileReleaseStateEvidence: "_pending_",
      lastMilePublishHashGuardEvidence: "_pending_",
    }), { root, candidate: CANDIDATE });
    const missingFiles = auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE });

    writeLastMileEvidence(root, {
      releaseState: {
        status: "no-publish",
        ok: false,
        releaseState: {
          releaseCount: 1,
          noGitHubReleasesObserved: false,
        },
        releases: [{ tagName: "v1.0.19" }],
        successfulReleaseWorkflowDispatchRuns: [],
      },
      publishHashGuard: {
        variableQueries: [
          {
            name: "EXPECTED_RELEASE_APK_SHA256",
            status: "present",
            absent: false,
          },
        ],
      },
    });
    const weakEvidence = auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE });

    writeLastMileEvidence(root, {
      releaseState: {
        checkedAt: "2026-06-29T22:35:00.000Z",
        review: {
          reviewer: "owner",
          reviewedAt: "2026-06-29T22:35:00.000Z",
        },
        querySummaries: {
          workflows: { exitCode: 0 },
          releaseRuns: { exitCode: 1 },
          workflowDispatchRuns: { exitCode: 0 },
          releases: { exitCode: 0 },
        },
        successfulReleaseWorkflowDispatchRuns: [
          {
            status: "completed",
            conclusion: "success",
            event: "workflow_dispatch",
            url: "https://github.com/opsiclear/diveo/actions/runs/2",
          },
        ],
        releaseReadinessImpact: {
          status: "no-publish",
        },
      },
      publishHashGuard: {
        checkedAt: "2026-06-29T22:35:00.000Z",
        review: {
          reviewer: "owner",
          reviewedAt: "2026-06-29T22:35:00.000Z",
        },
        variableQueries: [
          {
            name: "EXPECTED_RELEASE_APK_SHA256",
            status: "absent",
            absent: true,
          },
          {
            name: "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256",
            status: "absent",
            absent: true,
          },
        ],
        releaseReadinessImpact: {
          status: "no-publish",
        },
      },
    });
    const staleEvidence = auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE });

    expect(missingOrPending).toEqual(expect.arrayContaining([
      "audit signoff must include lastMileReleaseStateEvidence=docs/qa-evidence/<date>/github-release-state-prepublish.json",
      "audit signoff must include lastMilePublishHashGuardEvidence=docs/qa-evidence/<date>/publish-hash-variable-guard-prepublish.json",
    ]));
    expect(missingFiles).toEqual(expect.arrayContaining([
      "audit signoff lastMileReleaseStateEvidence missing at docs/qa-evidence/2026-06-30/github-release-state-prepublish.json",
      "audit signoff lastMilePublishHashGuardEvidence missing at docs/qa-evidence/2026-06-30/publish-hash-variable-guard-prepublish.json",
    ]));
    expect(weakEvidence).toEqual(expect.arrayContaining([
      "audit last-mile release-state evidence must have status=pass and ok=true",
      "audit last-mile release-state evidence must prove no GitHub releases are present before publish",
      "audit last-mile release-state evidence must list zero GitHub releases before publish",
      "audit last-mile release-state evidence must include a successful workflow_dispatch dry run",
      "audit last-mile publish-hash guard evidence must prove EXPECTED_RELEASE_APK_SHA256 is absent",
      "audit last-mile publish-hash guard evidence must prove EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256 is absent",
    ]));
    expect(staleEvidence).toEqual(expect.arrayContaining([
      "audit last-mile release-state evidence checkedAt must be an ISO timestamp on the final evidence date",
      "audit last-mile release-state evidence review.reviewer must be concrete",
      "audit last-mile release-state evidence review.reviewedAt must be an ISO timestamp on the final evidence date",
      "audit last-mile release-state evidence releaseRuns query must exit 0",
      "audit last-mile release-state evidence releaseReadinessImpact.status must be ready",
      "audit last-mile release-state evidence successful workflow_dispatch dry run must match audit runUrl",
      "audit last-mile publish-hash guard evidence checkedAt must be an ISO timestamp on the final evidence date",
      "audit last-mile publish-hash guard evidence review.reviewer must be concrete",
      "audit last-mile publish-hash guard evidence review.reviewedAt must be an ISO timestamp on the final evidence date",
      "audit last-mile publish-hash guard evidence releaseReadinessImpact.status must be ready",
      "audit last-mile publish-hash guard evidence must include GitHub CLI query provenance for EXPECTED_RELEASE_APK_SHA256",
      "audit last-mile publish-hash guard evidence must include GitHub CLI query provenance for EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256",
    ]));
  });

  it("requires static last-mile evidence review metadata to match the final receipt summary", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "last-mile-review-binding-"));
    writeFinalReceiptSummary(root);
    writeLastMileEvidence(root, {
      releaseState: {
        repository: "opsiclear/diveo",
        review: {
          reviewer: "@other-reviewer",
          reviewedAt: "2026-06-30T22:40:00.000Z",
        },
      },
      publishHashGuard: {
        repository: "opsiclear/diveo",
        review: {
          reviewer: "@other-reviewer",
          reviewedAt: "2026-06-30T22:40:00.000Z",
        },
      },
    });

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit last-mile release-state evidence repository must match final command receipt summary repository",
      "audit last-mile release-state evidence review.reviewer must match final command receipt summary reviewer",
      "audit last-mile release-state evidence review.reviewedAt must match final command receipt summary reviewedAt",
      "audit last-mile publish-hash guard evidence repository must match final command receipt summary repository",
      "audit last-mile publish-hash guard evidence review.reviewer must match final command receipt summary reviewer",
      "audit last-mile publish-hash guard evidence review.reviewedAt must match final command receipt summary reviewedAt",
    ]));
  });

  it("requires release-state query commands to target the final receipt repository", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-state-query-repo-"));
    writeFinalReceiptSummary(root);
    writeLastMileEvidence(root, {
      releaseState: {
        commands: {
          workflows: "gh api repos/opsiclear/diveo/actions/workflows",
          releaseRuns: "gh run list -R opsiclear/diveo --workflow 'Release APK' --limit 10 --json databaseId,workflowName,url",
          workflowDispatchRuns: "gh run list --event workflow_dispatch --limit 20 --json databaseId,workflowName,url",
          releases: "gh release list -R opsiclear/diveo --limit 20 --json tagName,name,publishedAt",
        },
      },
    });

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit last-mile release-state evidence workflows query must use final command receipt summary repository",
      "audit last-mile release-state evidence releaseRuns query must use final command receipt summary repository",
      "audit last-mile release-state evidence workflowDispatchRuns query must use final command receipt summary repository",
      "audit last-mile release-state evidence releases query must use final command receipt summary repository",
    ]));
  });

  it("requires publish-hash guard query commands to target the final receipt repository", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-hash-query-repo-"));
    writeFinalReceiptSummary(root);
    writeLastMileEvidence(root, {
      publishHashGuard: {
        variableQueries: [
          {
            name: "EXPECTED_RELEASE_APK_SHA256",
            status: "absent",
            absent: true,
            command: "gh variable get EXPECTED_RELEASE_APK_SHA256 --repo opsiclear/diveo --json name,value,updatedAt",
          },
          {
            name: "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256",
            status: "absent",
            absent: true,
            command: "gh variable get EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256 --json name,value,updatedAt",
          },
        ],
      },
    });

    expect(auditSignoffProblems(auditDoc(), { root, candidate: CANDIDATE })).toEqual(expect.arrayContaining([
      "audit last-mile publish-hash guard evidence query for EXPECTED_RELEASE_APK_SHA256 must use final command receipt summary repository",
      "audit last-mile publish-hash guard evidence query for EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256 must use final command receipt summary repository",
    ]));
  });

  it("rejects final audit packet paths that still use planning packet filenames", () => {
    const rows = parseEvidenceRows(qaDoc(requiredEvidence.map(completeRow)));

    for (const lifecycleName of ["scaffold", "candidate", "pending", "example"]) {
      const problems = auditSignoffProblems(auditDoc({
        deviceEvidencePacketPath: `docs/qa-evidence/2026-06-30/device-evidence-packet-${lifecycleName}.json`,
      }), { candidate: CANDIDATE, rows });

      expect(problems).toContain(
        "audit signoff deviceEvidencePacketPath must not reference a scaffold, candidate, pending, or example packet",
      );
    }
  });

  it("requires the final audit review ledger to cover each external evidence category", () => {
    const minimalLedger = [
      `| Release workflow dry run | diveo-release-evidence-v1.0.19 | @release-reviewer / 2026-06-30T22:35:00Z | Run conclusion success and downloaded checksum-manifest SHA256=${CHECKSUM_MANIFEST_SHA} | Reviewed |`,
      "| Branch protection | docs/qa-evidence/2026-06-30/master-branch-protection.json | @release-reviewer / 2026-06-30T22:35:00Z | protected branch master, quality / quality, reviewer ISO timestamp, and raw evidence path reviewed | Reviewed |",
    ];
    const problems = auditSignoffProblems(auditDoc({ ledgerRows: minimalLedger }), {
      candidate: CANDIDATE,
    });

    expect(externalReviewLedgerCoverageProblems(parseExternalReviewLedgerRows(auditDoc()))).toEqual([]);
    expect(problems).toEqual(expect.arrayContaining([
      "audit external evidence review ledger must include reviewed Release validation prerequisites and device-validation bundle",
      "audit external evidence review ledger must include reviewed Release APK artifact and generated version metadata",
      "audit external evidence review ledger must include reviewed Release-installed APK smoke",
      "audit external evidence review ledger must include reviewed Production runtime smoke and range probe",
      "audit external evidence review ledger must include reviewed Product journey manifest",
      "audit external evidence review ledger must include reviewed Android/iOS route rows",
      "audit external evidence review ledger must include reviewed Negative validation rows",
      "audit external evidence review ledger Release workflow dry run row must include publishArtifactIdentitySha256 value",
      "audit external evidence review ledger Release workflow dry run row must include gsavPackageProvenanceSha256 value",
      "audit external evidence review ledger Release workflow dry run row must include release evidence bundle verifier rerun pass",
    ]));
  });

  it("requires reviewed audit ledger rows to have concrete reviewer timestamps and artifact references", () => {
    const weakAudit = auditDoc().replace(
      "| Android/iOS route rows | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-ios-route-evidence | @release-reviewer / 2026-06-30T22:35:00Z |",
      "| Android/iOS route rows | Device screenshots | reviewer |",
    );

    const problems = auditSignoffProblems(weakAudit, { candidate: CANDIDATE });

    expect(problems).toEqual(expect.arrayContaining([
      "audit external evidence review ledger Android/iOS route rows row must include ISO reviewer timestamp",
      "audit external evidence review ledger Android/iOS route rows row must include concrete reviewer",
      "audit external evidence review ledger Android/iOS route rows row must include durable reviewed artifact reference",
    ]));
  });

  it("requires reviewed audit ledger proof fields to contain concrete values", () => {
    const weakAudit = auditDoc()
      .replace(`downloaded checksum-manifest SHA256=${CHECKSUM_MANIFEST_SHA}`, "downloaded checksum-manifest SHA256=<64-hex sha>")
      .replace(`apkSha256=${APK_SHA}`, "apkSha256=<64-hex sha>")
      .replace("productionHostReleaseReady=true", "productionHostReleaseReady=<true>")
      .replace("Content-Range=bytes 0-0/12345", "Content-Range=<bytes>");

    const problems = auditSignoffProblems(weakAudit, { candidate: CANDIDATE });

    expect(problems).toEqual(expect.arrayContaining([
      "audit external evidence review ledger Release workflow dry run row must include downloaded checksum-manifest SHA256 value",
      "audit external evidence review ledger Release APK artifact and generated version metadata row must include apkSha256 value",
      "audit external evidence review ledger Release-installed APK smoke row must include production host release-ready proof",
      "audit external evidence review ledger Production runtime smoke and range probe row must include Content-Range bytes 0-0 value",
    ]));
  });

  it("requires reviewed product journey ledger rows to include concrete manifest proof", () => {
    const weakAudit = auditDoc().replace(
      /product-journey-manifest\.json, artifactPurpose=product-journey-manifest,[^|]+ reviewed/,
      "product-journey-manifest.json reviewed",
    );

    const problems = auditSignoffProblems(weakAudit, { candidate: CANDIDATE });

    expect(problems).toEqual(expect.arrayContaining([
      "audit external evidence review ledger Product journey manifest row must include artifactPurpose=product-journey-manifest",
      "audit external evidence review ledger Product journey manifest row must include helperOnly=false",
      "audit external evidence review ledger Product journey manifest row must include releaseCandidateSha value",
      "audit external evidence review ledger Product journey manifest row must include required product journey IDs",
      "audit external evidence review ledger Product journey manifest row must include distinct Android and iOS evidence paths",
      "audit external evidence review ledger Product journey manifest row must include manifest or media SHA256 value",
      "audit external evidence review ledger Product journey manifest row must include external inventory entry",
      "audit external evidence review ledger Product journey manifest row must include fixture manifest inventory entry",
      "audit external evidence review ledger Product journey manifest row must include artifactPurpose=fixture-manifest",
      "audit external evidence review ledger Product journey manifest row must include fixture manifest helperOnly=false",
      "audit external evidence review ledger Product journey manifest row must include sha256 matching fixtureManifestSha256",
    ]));
  });

  it("requires reviewed product journey ledger rows to include fixture manifest inventory proof", () => {
    const weakAudit = auditDoc().replace(
      /, and fixture-manifest\.json inventory entry with artifactPurpose=fixture-manifest, helperOnly=false, sha256 matching fixtureManifestSha256=[a-f0-9]{64}/,
      "",
    );

    const problems = auditSignoffProblems(weakAudit, { candidate: CANDIDATE });

    expect(problems).toEqual(expect.arrayContaining([
      "audit external evidence review ledger Product journey manifest row must include fixture manifest inventory entry",
      "audit external evidence review ledger Product journey manifest row must include artifactPurpose=fixture-manifest",
      "audit external evidence review ledger Product journey manifest row must include fixture manifest helperOnly=false",
      "audit external evidence review ledger Product journey manifest row must include sha256 matching fixtureManifestSha256",
    ]));
  });

  it("rejects product journey ledger rows with generic platform evidence wording", () => {
    const weakAudit = auditDoc().replace(
      "distinct Android and iOS evidence paths",
      "Android and iOS evidence",
    );

    const problems = auditSignoffProblems(weakAudit, { candidate: CANDIDATE });

    expect(problems).toEqual(expect.arrayContaining([
      "audit external evidence review ledger Product journey manifest row must include distinct Android and iOS evidence paths",
    ]));
  });

  it("requires reviewed route and negative ledger rows to include external artifact manifest proof", () => {
    const weakAudit = auditDoc()
      .replace(/, artifactPurpose=route-evidence, routeEvidenceManifest=[^|]+ reviewed/, " reviewed")
      .replace(/, artifactPurpose=negative-evidence, negativeEvidenceManifest=[^|]+ reviewed/, " reviewed");

    const problems = auditSignoffProblems(weakAudit, { candidate: CANDIDATE });

    expect(problems).toEqual(expect.arrayContaining([
      "audit external evidence review ledger Android/iOS route rows row must include artifactPurpose=route-evidence",
      "audit external evidence review ledger Android/iOS route rows row must include route evidence manifest",
      "audit external evidence review ledger Android/iOS route rows row must include evidenceManifestSha256 value",
      "audit external evidence review ledger Android/iOS route rows row must include sourceRunId value",
      "audit external evidence review ledger Android/iOS route rows row must include sourceArtifactId value",
      "audit external evidence review ledger Android/iOS route rows row must include media/file SHA256",
      "audit external evidence review ledger Android/iOS route rows row must include helperOnly=false review assertion",
      "audit external evidence review ledger Negative validation rows row must include artifactPurpose=negative-evidence",
      "audit external evidence review ledger Negative validation rows row must include negative evidence manifest",
      "audit external evidence review ledger Negative validation rows row must include helperOnly=false review assertion",
    ]));
  });

  it("requires reviewed route and negative ledger rows to include dry-run identity proof", () => {
    const dryRunProof = `, releaseCandidateSha=${CANDIDATE.commit}, dry-run artifact=diveo-release-evidence-v1.0.19, dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1`;
    const weakAudit = auditDoc().split(dryRunProof).join("");

    const problems = auditSignoffProblems(weakAudit, { candidate: CANDIDATE });

    expect(problems).toEqual(expect.arrayContaining([
      "audit external evidence review ledger Android/iOS route rows row must include releaseCandidateSha value",
      "audit external evidence review ledger Android/iOS route rows row must include dry-run artifact identity",
      "audit external evidence review ledger Android/iOS route rows row must include dry-run run URL",
      "audit external evidence review ledger Negative validation rows row must include releaseCandidateSha value",
      "audit external evidence review ledger Negative validation rows row must include dry-run artifact identity",
      "audit external evidence review ledger Negative validation rows row must include dry-run run URL",
    ]));
  });

  it("requires final audit signoff only after evidence rows are otherwise complete", () => {
    const rows = requiredEvidence.map(completeRow);
    rows[0] = `| _pending_ | ${requiredEvidence[0].platform} | _pending_ | https://gsav.example.com | ${requiredEvidence[0].route} | _pending_ | _pending_ | Pending |`;

    const incomplete = analyzeReleaseReadiness(qaDoc(rows), {
      auditText: "",
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
    });
    const complete = analyzeReleaseReadiness(qaDoc(requiredEvidence.map(completeRow)), {
      auditText: "",
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
    });

    expect(incomplete.missing).toEqual([
      expect.objectContaining({ id: requiredEvidence[0].id }),
    ]);
    expect(complete.missing).toEqual([
      expect.objectContaining({
        id: "audit publish signoff",
        reason: "audit signoff document is missing",
      }),
    ]);
  });

  it("rejects no-publish audit decisions and unresolved review-ledger rows", () => {
    const auditText = auditDoc({
      decision: "no-publish",
      ledgerReviewer: "_pending_",
      ledgerStatus: "Pending production dry run",
    });

    const problems = auditSignoffProblems(auditText, { candidate: CANDIDATE });
    const result = analyzeReleaseReadiness(qaDoc(requiredEvidence.map(completeRow)), {
      auditText,
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
    });

    expect(problems).toEqual(expect.arrayContaining([
      "audit signoff decision must be decision=publish for release readiness",
      expect.stringContaining("audit external evidence review ledger has unresolved rows"),
    ]));
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "audit publish signoff",
        reason: "audit signoff decision must be decision=publish for release readiness",
      }),
    ]));
  });

  it("requires final audit signoff to preserve the current Android-only publish scope", () => {
    const problems = auditSignoffProblems(auditDoc({
      publishScope: "android-and-ios",
      iosDistributionDecision: "testflight",
    }), { candidate: CANDIDATE });

    expect(problems).toEqual(expect.arrayContaining([
      "audit signoff must include publishScope=android-apk-only for the current release scope",
      "audit signoff must include iosDistributionDecision=no-publish unless iOS distribution rows are added",
    ]));
  });

  it("requires audit signoff identity, artifact, checksum, run, and branch-protection fields", () => {
    const problems = auditSignoffProblems(auditDoc({
      reviewer: "owner",
      reviewedAt: "soon",
      payloadSha: "deadbeef1234567890abcdef1234567890abcdef",
      signoffSha: "not-a-sha",
      artifactName: "artifact",
      runUrl: "https://example.com/run/1",
      checksumManifestSha256: "feedbead",
      publishArtifactIdentitySha256: "c0ffee",
    }).replace("branchProtectionReady=true; protected branch=master; required check=quality / quality.", ""), {
      candidate: CANDIDATE,
    });

    expect(problems).toEqual(expect.arrayContaining([
      "audit signoff must include a concrete reviewer=<person|team|issue|run>",
      "audit signoff must include reviewedAt=<ISO timestamp>",
      "audit signoff payloadSha must match the release candidate commit",
      "audit signoff must include signoffSha=<sha>",
      "audit signoff must include artifactName=diveo-release-evidence-v<semver>",
      "audit signoff must include runUrl=<exact trusted Diveo release Actions run URL>",
      "audit signoff must include checksumManifestSha256=<64-hex sha>",
      "audit signoff must include publishArtifactIdentitySha256=<64-hex sha>",
      "audit signoff must include branchProtectionReady=true with protected master and quality / quality evidence",
    ]));
  });

  it("rejects final audit signoff runUrl values that are not exact Diveo release run URLs", () => {
    const weakRunUrls = [
      "https://github.com/opsiclear/gsav-hosting/actions/runs/1",
      "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/release",
      "https://github.com/opsiclear/diveo/actions/runs/1?check_suite_focus=true",
      "https://github.com/opsiclear/diveo/actions/runs/1#artifacts",
      "https://github.com/opsiclear/diveo/actions/runs/1/",
      "https://token@github.com/opsiclear/diveo/actions/runs/1",
    ];

    for (const runUrl of weakRunUrls) {
      expect(auditSignoffProblems(auditDoc({ runUrl }), { candidate: CANDIDATE })).toContain(
        "audit signoff must include runUrl=<exact trusted Diveo release Actions run URL>",
      );
    }

    expect(auditSignoffProblems(auditDoc({
      runUrl: "https://github.com/opsiclear-web/diveo/actions/runs/1",
    }), { candidate: CANDIDATE })).not.toContain(
      "audit signoff must include runUrl=<exact trusted Diveo release Actions run URL>",
    );
  });

  it("requires audit signoff payload and signoff SHAs to be full 40-hex values", () => {
    const problems = auditSignoffProblems(auditDoc({
      payloadSha: "abc1234",
      signoffSha: "abc1234",
    }), { candidate: CANDIDATE });

    expect(problems).toEqual(expect.arrayContaining([
      "audit signoff payloadSha abc1234 must be a full 40-hex SHA",
      "audit signoff signoffSha abc1234 must be a full 40-hex SHA",
    ]));
  });

  it("requires audit signoff fields to agree with the release dry-run QA row", () => {
    const differentSha = "fedcba9876543210fedcba9876543210fedcba98";
    const rows = parseEvidenceRows(qaDoc(requiredEvidence.map(completeRow)));
    const problems = auditSignoffProblems(auditDoc({
      payloadSha: differentSha,
      signoffSha: differentSha,
      artifactName: "diveo-release-evidence-v9.9.9",
      runUrl: "https://github.com/opsiclear/diveo/actions/runs/2",
      checksumManifestSha256: "1".repeat(64),
      publishArtifactIdentitySha256: "2".repeat(64),
    }), {
      candidate: {
        commit: differentSha,
        signoffCommit: differentSha,
      },
      rows,
    });

    expect(problems).toEqual(expect.arrayContaining([
      "audit signoff payloadSha must match the release dry-run QA row releaseCandidateSha",
      "audit signoff signoffSha must match the release dry-run QA row evidenceSignoffSha",
      "audit signoff artifactName must match the release dry-run QA row artifact name",
      "audit signoff runUrl must match the release dry-run QA row workflow run",
      "audit signoff checksumManifestSha256 must match the release dry-run QA row checksum-manifest SHA256",
      "audit signoff publishArtifactIdentitySha256 must match the release dry-run QA row",
    ]));
  });

  it("requires the release dry-run QA row identity fields compared by audit signoff to be full length", () => {
    const dryRunRequirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const rows = parseEvidenceRows(qaDoc([
      completeRow(dryRunRequirement)
        .replace("releaseCandidateSha=abc1234567890abcdef1234567890abcdef12345", "releaseCandidateSha=abc1234")
        .replace("evidenceSignoffSha=abc1234567890abcdef1234567890abcdef12345", "evidenceSignoffSha=abc1234"),
    ]));
    const problems = auditSignoffProblems(auditDoc(), { candidate: CANDIDATE, rows });

    expect(problems).toEqual(expect.arrayContaining([
      "release dry-run QA row releaseCandidateSha must be a full 40-hex SHA",
      "release dry-run QA row evidenceSignoffSha must be a full 40-hex SHA",
    ]));
  });

  it("fails final readiness when audit signoff disagrees with the dry-run QA row", () => {
    const result = analyzeReleaseReadiness(qaDoc(requiredEvidence.map(completeRow)), {
      auditText: auditDoc({ artifactName: "diveo-release-evidence-v9.9.9" }),
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "audit publish signoff",
        reason: "audit signoff artifactName must match the release dry-run QA row artifact name",
      }),
    ]));
  });

  it("requires completed rows to use canonical result prefixes", () => {
    expect(resultStatusProblem("Passed: native home rendered")).toBeNull();
    expect(resultStatusProblem("Passed with scoped exception: fixture unavailable")).toBeNull();
    expect(resultStatusProblem("Verified: native home rendered")).toBe("result must start with Passed: or Passed with scoped exception:");
    expect(resultStatusProblem("Not passed: native home did not render")).toBe("result must start with Passed: or Passed with scoped exception:");
    expect(resultStatusProblem("Passed with versionCode: Gradle versionCode: 10019")).toBe("result must start with Passed: or Passed with scoped exception:");
    expect(resultStatusProblem("Passed: skipped because device was unavailable")).toBe("result must not contain failed, skipped, pending, or blocker status language");
    expect(resultStatusProblem("Passed: cross-origin navigation blocked")).toBeNull();
  });

  it("rejects otherwise complete evidence rows with non-canonical result text", () => {
    const rows = requiredEvidence.map(completeRow);
    const rowIndex = requiredEvidence.findIndex((requirement) => requirement.platform === "Android" && requirement.route === "/");
    const requirement = requiredEvidence[rowIndex];
    rows[rowIndex] = rows[rowIndex].replace(
      "| Passed: native home rendered with no web chrome |",
      "| Verified: native home rendered with no web chrome |",
    );

    const result = analyzeReleaseReadiness(qaDoc(rows), { candidate: CANDIDATE });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      expect.objectContaining({
        id: requirement.id,
        reason: "result must start with Passed: or Passed with scoped exception:",
      }),
    ]);
  });

  it("rejects otherwise complete evidence rows that contain failure or skip status language", () => {
    const rows = requiredEvidence.map(completeRow);
    const rowIndex = requiredEvidence.findIndex((requirement) => requirement.platform === "Android" && requirement.route === "/");
    const requirement = requiredEvidence[rowIndex];
    rows[rowIndex] = rows[rowIndex].replace(
      "| Passed: native home rendered with no web chrome |",
      "| Passed: skipped because device was unavailable |",
    );

    const result = analyzeReleaseReadiness(qaDoc(rows), { candidate: CANDIDATE });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      expect.objectContaining({
        id: requirement.id,
        reason: "result must not contain failed, skipped, pending, or blocker status language",
      }),
    ]);
  });

  it("fails otherwise complete readiness when a row mixes in unsupported evidence", () => {
    const rows = requiredEvidence.map(completeRow);
    const rowIndex = requiredEvidence.findIndex((requirement) => requirement.platform === "Android" && requirement.route === "/");
    const requirement = requiredEvidence[rowIndex];
    rows[rowIndex] = rows[rowIndex].replace(
      `https://github.com/opsiclear/diveo/actions/runs/1/artifacts/${requirement.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      `https://github.com/opsiclear/diveo/actions/runs/1/artifacts/${requirement.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}; docs/not-qa/android-home.png`,
    );

    const result = analyzeReleaseReadiness(qaDoc(rows), { candidate: CANDIDATE });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      expect.objectContaining({
        id: requirement.id,
        reason: "unsupported evidence path entry: docs/not-qa/android-home.png",
      }),
    ]);
  });

  it("fails otherwise complete readiness when release identity files are dirty", () => {
    const dirtyCandidate = {
      ...CANDIDATE,
      dirtyIdentityFiles: ["M app.json", "M package.json"],
    };

    const result = analyzeReleaseReadiness(qaDoc(requiredEvidence.map(completeRow)), { candidate: dirtyCandidate });

    expect(candidateIdentityIntegrityProblems(dirtyCandidate)).toEqual([
      "release identity files must be committed before readiness: M app.json, M package.json",
    ]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      {
        id: "release candidate identity integrity",
        platform: "Git",
        route: "Release candidate identity",
        reason: "release identity files must be committed before readiness: M app.json, M package.json",
      },
    ]);
  });

  it("keeps incomplete evidence failures focused on evidence rows before dirty identity files", () => {
    const dirtyCandidate = {
      ...CANDIDATE,
      dirtyIdentityFiles: ["M app.json"],
    };
    const rows = requiredEvidence.map(completeRow);
    rows[0] = `| _pending_ | ${requiredEvidence[0].platform} | _pending_ | https://gsav.example.com | ${requiredEvidence[0].route} | _pending_ | _pending_ | Pending |`;

    const result = analyzeReleaseReadiness(qaDoc(rows), { candidate: dirtyCandidate });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      expect.objectContaining({ id: requiredEvidence[0].id }),
    ]);
  });

  it("allows a docs and QA evidence-only signoff commit after payload capture", () => {
    const { root, payloadSha } = createReleaseIdentityRepo();
    fs.writeFileSync(path.join(root, "docs", "GSAV_NATIVE_QA.md"), "updated QA\n");
    fs.writeFileSync(path.join(root, "docs", "IMPLEMENTATION_VALIDATION_AUDIT.md"), "updated audit\n");
    fs.writeFileSync(path.join(root, "docs", "qa-evidence", "2026-06-30", "android-home.txt"), "evidence\n");
    const signoffSha = commitAll(root, "evidence signoff");

    expect(isAllowedEvidenceSignoffPath("docs/GSAV_NATIVE_QA.md")).toBe(true);
    expect(isAllowedEvidenceSignoffPath("docs/qa-evidence/2026-06-30/android-home.txt")).toBe(true);
    expect(isAllowedEvidenceSignoffPath("app.json")).toBe(false);
    expect(releaseSignoffIntegrityProblems({
      root,
      candidateCommit: payloadSha,
      signoffCommit: signoffSha,
    })).toEqual([]);

    const candidate = readCandidateIdentity(root, {
      env: { RELEASE_CANDIDATE_SHA: payloadSha },
    });
    expect(candidate.commit).toBe(payloadSha);
    expect(candidate.signoffCommit).toBe(signoffSha);
    expect(candidate.signoffIntegrityProblems).toEqual([]);
  });

  it("rejects source or release identity changes after payload capture", () => {
    const { root, payloadSha } = createReleaseIdentityRepo();
    const appJsonPath = path.join(root, "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    appJson.expo.version = "1.0.20";
    fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);
    const signoffSha = commitAll(root, "mutate app after payload");

    const problems = releaseSignoffIntegrityProblems({
      root,
      candidateCommit: payloadSha,
      signoffCommit: signoffSha,
    });
    expect(problems).toEqual([
      expect.stringContaining("release evidence signoff commit may only change"),
    ]);
    expect(problems[0]).toContain("app.json");
  });

  it("reports signoff integrity problems only after evidence rows are otherwise complete", () => {
    const invalidCandidate = {
      ...CANDIDATE,
      signoffIntegrityProblems: ["release evidence signoff commit may only change docs evidence: app.json"],
    };
    const complete = analyzeReleaseReadiness(qaDoc(requiredEvidence.map(completeRow)), { candidate: invalidCandidate });
    const incompleteRows = requiredEvidence.map(completeRow);
    incompleteRows[0] = `| _pending_ | ${requiredEvidence[0].platform} | _pending_ | https://gsav.example.com | ${requiredEvidence[0].route} | _pending_ | _pending_ | Pending |`;
    const incomplete = analyzeReleaseReadiness(qaDoc(incompleteRows), { candidate: invalidCandidate });

    expect(candidateIdentityIntegrityProblems(invalidCandidate)).toContain("release evidence signoff commit may only change docs evidence: app.json");
    expect(complete.ok).toBe(false);
    expect(complete.missing).toEqual([
      {
        id: "release candidate identity integrity",
        platform: "Git",
        route: "Release candidate identity",
        reason: "release evidence signoff commit may only change docs evidence: app.json",
      },
    ]);
    expect(incomplete.missing).toEqual([
      expect.objectContaining({ id: requiredEvidence[0].id }),
    ]);
  });

  it("fails when QA route matrix adds a route that is not release-gated", () => {
    const qaText = qaDoc(requiredEvidence.map(completeRow))
      .replace(
        "| `/gsav/test?t=2.5` | Expected behavior for /gsav/test?t=2.5 |",
        "| `/gsav/test?t=2.5` | Expected behavior for /gsav/test?t=2.5 |\n| `/legacy-video` | Expected behavior for /legacy-video |",
      );

    const result = analyzeReleaseReadiness(qaText, { candidate: CANDIDATE });

    expect(routeMatrixCoverageProblems(qaText)).toContain(
      "QA required route matrix route /legacy-video is not release-readiness required evidence",
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "required route matrix alignment",
        reason: "QA required route matrix route /legacy-video is not release-readiness required evidence",
      }),
    ]));
  });

  it("fails when a release-gated route is missing from the QA route matrix", () => {
    const qaText = qaDoc(requiredEvidence.map(completeRow))
      .replace("| `/search` | Expected behavior for /search |\n", "");

    const result = analyzeReleaseReadiness(qaText, { candidate: CANDIDATE });

    expect(routeMatrixCoverageProblems(qaText)).toContain("QA required route matrix is missing /search");
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "required route matrix alignment",
        reason: "QA required route matrix is missing /search",
      }),
    ]));
  });

  it("fails when QA negative fixture inventory adds a case that is not release-gated", () => {
    const endedPlaybackRow = negativeFixtureInventoryRows(["Ended playback"])[0];
    const qaText = qaDoc(requiredEvidence.map(completeRow))
      .replace(
        endedPlaybackRow,
        `${endedPlaybackRow}\n| Renderer crash fixture | Use a renderer-crash QA fixture | Renderer crash error is shown | Owner-blocked until fixture is named |`,
      );

    const result = analyzeReleaseReadiness(qaText, { candidate: CANDIDATE });

    expect(negativeCaseCoverageProblems(qaText)).toContain(
      "QA negative fixture inventory case Renderer crash fixture is not release-readiness required evidence",
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "negative fixture inventory alignment",
        reason: "QA negative fixture inventory case Renderer crash fixture is not release-readiness required evidence",
      }),
    ]));
  });

  it("fails when a release-gated negative case is missing from the QA inventory", () => {
    const qaText = qaDoc(requiredEvidence.map(completeRow))
      .replace(`${negativeFixtureInventoryRows(["Host offline/retry"])[0]}\n`, "");

    const result = analyzeReleaseReadiness(qaText, { candidate: CANDIDATE });

    expect(negativeCaseCoverageProblems(qaText)).toContain("QA negative fixture inventory is missing Host offline/retry");
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "negative fixture inventory alignment",
        reason: "QA negative fixture inventory is missing Host offline/retry",
      }),
    ]));
  });

  it("fails when QA negative fixture inventory uses placeholder trigger details", () => {
    const missingHostRow = negativeFixtureInventoryRows(["Missing host config"])[0];
    const crossOriginRow = negativeFixtureInventoryRows(["Cross-origin navigation"])[0];
    const qaText = qaDoc(requiredEvidence.map(completeRow))
      .replace(
        missingHostRow,
        "| Missing host config | Trigger for Missing host config | Expected signal for Missing host config | Available through app config |",
      )
      .replace(
        crossOriginRow,
        "| Cross-origin navigation | Use QA route | Navigation blocked | Owner-blocked until QA decides |",
      );

    const result = analyzeReleaseReadiness(qaText, { candidate: CANDIDATE });

    expect(negativeCaseCoverageProblems(qaText)).toEqual(expect.arrayContaining([
      "QA negative fixture inventory Missing host config must name an exact trigger, route, QA flag, command, or hosted control",
      "QA negative fixture inventory Missing host config must name the expected observed signal",
      "QA negative fixture inventory Cross-origin navigation owner-blocked status must name the missing fixture, flag, route, or control",
    ]));
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "negative fixture inventory alignment",
        reason: "QA negative fixture inventory Missing host config must name an exact trigger, route, QA flag, command, or hosted control",
      }),
    ]));
  });

  it("fails when QA release evidence requirements add a row that is not release-gated", () => {
    const qaText = qaDoc(requiredEvidence.map(completeRow))
      .replace(
        "| Release workflow dry run | Required observed signal for Release workflow dry run |",
        "| Release workflow dry run | Required observed signal for Release workflow dry run |\n| Store publish checklist | Required observed signal for Store publish checklist |",
      );

    const result = analyzeReleaseReadiness(qaText, { candidate: CANDIDATE });

    expect(releaseEvidenceRequirementsProblems(qaText)).toContain(
      "QA release evidence requirements row Store publish checklist is not release-readiness required evidence",
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "release evidence requirements alignment",
        reason: "QA release evidence requirements row Store publish checklist is not release-readiness required evidence",
      }),
    ]));
  });

  it("fails when a release-gated requirement row is missing from QA release evidence requirements", () => {
    const qaText = qaDoc(requiredEvidence.map(completeRow))
      .replace("| Production .gsav range probe | Required observed signal for Production .gsav range probe |\n", "");

    const result = analyzeReleaseReadiness(qaText, { candidate: CANDIDATE });

    expect(releaseEvidenceRequirementsProblems(qaText)).toContain(
      "QA release evidence requirements table is missing Production .gsav range probe",
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "release evidence requirements alignment",
        reason: "QA release evidence requirements table is missing Production .gsav range probe",
      }),
    ]));
  });

  it("fails when the QA release evidence requirements section is missing", () => {
    const qaText = qaDoc(requiredEvidence.map(completeRow))
      .replace(/## Release Evidence Requirements[\s\S]*?\n## Evidence Log/, "## Evidence Log");

    const result = analyzeReleaseReadiness(qaText, { candidate: CANDIDATE });

    expect(releaseEvidenceRequirementsProblems(qaText)).toContain(
      "QA release evidence requirements table is missing required rows",
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "release evidence requirements alignment",
        reason: "QA release evidence requirements table is missing required rows",
      }),
    ]));
  });

  it("normalizes inline code in QA release evidence requirement row labels", () => {
    const qaText = `# QA

## Release Evidence Requirements

| Evidence row | Required observed signal |
| --- | --- |
| Production \`.gsav\` range probe | Range signal |
`;

    expect(parseReleaseEvidenceRequirementRows(qaText)).toEqual(["Production .gsav range probe"]);
  });

  it("fails when a required row is pending or uses ephemeral terminal evidence", () => {
    const rows = requiredEvidence.map(completeRow);
    rows[0] = `| _pending_ | ${requiredEvidence[0].platform} | _pending_ | https://gsav.example.com | ${requiredEvidence[0].route} | _pending_ | _pending_ | Pending |`;
    rows[1] = `| 2026-06-30 | ${requiredEvidence[1].platform} | iPhone 15 | https://gsav.example.com | ${requiredEvidence[1].route} | Passed | Terminal: manual output | Ephemeral |`;

    const result = analyzeReleaseReadiness(qaDoc(rows), { candidate: CANDIDATE });

    expect(result.ok).toBe(false);
    expect(result.missing.map((item) => item.id)).toEqual([
      requiredEvidence[0].id,
      requiredEvidence[1].id,
    ]);
  });

  it("requires completed evidence rows to use non-future ISO dates", () => {
    const rows = requiredEvidence.map(completeRow);
    rows[0] = rows[0].replace("| 2026-06-30 |", "| 06/30/2026 |");
    rows[1] = rows[1].replace("| 2026-06-30 |", "| 2026-07-01 |");
    rows[2] = rows[2].replace("| 2026-06-30 |", "| 2026-06-22 |");

    const result = analyzeReleaseReadiness(qaDoc(rows), {
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
    });

    expect(DEFAULT_MAX_EVIDENCE_AGE_DAYS).toBe(7);
    expect(evidenceDateProblem("2026-02-30", { currentDate: "2026-06-30" })).toBe("evidence date must use ISO YYYY-MM-DD");
    expect(evidenceDateProblem("2026-07-01", { currentDate: "2026-06-30" })).toBe("evidence date cannot be after 2026-06-30");
    expect(evidenceDateProblem("2026-06-22", { currentDate: "2026-06-30" })).toBe("evidence date 2026-06-22 is older than 7 days before 2026-06-30");
    expect(evidenceDateProblem("2026-06-22", { currentDate: "2026-06-30", maxEvidenceAgeDays: false })).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: requiredEvidence[0].id,
        reason: "evidence date must use ISO YYYY-MM-DD",
      }),
      expect.objectContaining({
        id: requiredEvidence[1].id,
        reason: "evidence date cannot be after 2026-06-30",
      }),
      expect.objectContaining({
        id: requiredEvidence[2].id,
        reason: "evidence date 2026-06-22 is older than 7 days before 2026-06-30",
      }),
    ]));
  });

  it("requires publish-candidate identity in completed rows", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android | Pixel 8 | https://gsav.example.com | / | Passed: native home rendered with no web chrome | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-home | Verified |",
    ]))[0];

    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("diveo commit");
    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("app version");
    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("package.json version");
  });

  it("requires completed rows to name an evidence owner", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android | Pixel 8 | https://gsav.example.com | / | Passed: native home rendered with no web chrome | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-home | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android OS version: Android 15 API 35; WebView version: 125; build profile: release; manual action: opened /; gsav-hosting commit def5678 |",
    ]))[0];

    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("evidence owner");
  });

  it("rejects placeholder release-owner labels in completed evidence rows", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android | Pixel 8 | https://gsav.example.com | / | Passed: native home rendered with no web chrome | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-home | owner=native release owner; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android OS version: Android 15 API 35; WebView version: 125; build profile: release; manual action: opened /; gsav-hosting commit def5678 |",
    ]))[0];

    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("concrete evidence owner");
  });

  it("compares completed rows to the current publish candidate identity", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android | Pixel 8 | https://gsav.example.com | / | Passed: native home rendered with no web chrome | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-home | diveo commit deadbee; app version 9.9.9; package.json version: 9.9.8; Android versionCode: 99999 |",
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("does not match current");
    expect(problem).toContain("app version 9.9.9");
    expect(problem).toContain("package.json version 9.9.8");
    expect(problem).toContain("Android versionCode 99999");
  });

  it("compares releaseCandidateSha, candidate_ref, and evidenceSignoffSha fields to the current candidate", () => {
    const wrongSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const signoffSha = "fedcba9876543210fedcba9876543210fedcba98";
    const artifactRequirement = requiredEvidence.find((item) => item.route === "Release APK artifact");
    const dryRunRequirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const artifactRow = parseEvidenceRows(qaDoc([
      completeRow(artifactRequirement).replace(
        "releaseCandidateSha=abc1234567890abcdef1234567890abcdef12345",
        `releaseCandidateSha=${wrongSha}`,
      ),
    ]))[0];
    const dryRunRow = parseEvidenceRows(qaDoc([
      completeRow(dryRunRequirement).replace(
        "candidate_ref=abc1234567890abcdef1234567890abcdef12345",
        `candidate_ref=${wrongSha}`,
      ),
    ]))[0];
    const signoffRow = parseEvidenceRows(qaDoc([
      completeRow(artifactRequirement),
    ]))[0];

    expect(detailProblem(artifactRow, artifactRequirement, { candidate: CANDIDATE })).toContain(
      `releaseCandidateSha ${wrongSha} does not match current abc123456789`,
    );
    expect(detailProblem(dryRunRow, dryRunRequirement, { candidate: CANDIDATE })).toContain(
      `candidate_ref ${wrongSha} does not match current abc123456789`,
    );
    expect(detailProblem(signoffRow, artifactRequirement, {
      candidate: { ...CANDIDATE, signoffCommit: signoffSha },
    })).toContain(`evidenceSignoffSha ${CANDIDATE.commit.slice(0, 40)} does not match current signoff fedcba987654`);
  });

  it("requires authoritative release identity fields in completed rows to use full 40-hex SHAs", () => {
    const artifactRequirement = requiredEvidence.find((item) => item.route === "Release APK artifact");
    const dryRunRequirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const artifactShortCandidate = parseEvidenceRows(qaDoc([
      completeRow(artifactRequirement).replace(
        "releaseCandidateSha=abc1234567890abcdef1234567890abcdef12345",
        "releaseCandidateSha=abc1234",
      ),
    ]))[0];
    const artifactShortSignoff = parseEvidenceRows(qaDoc([
      completeRow(artifactRequirement).replace(
        "evidenceSignoffSha=abc1234567890abcdef1234567890abcdef12345",
        "evidenceSignoffSha=abc1234",
      ),
    ]))[0];
    const dryRunShortCandidateRef = parseEvidenceRows(qaDoc([
      completeRow(dryRunRequirement).replace(
        "candidate_ref=abc1234567890abcdef1234567890abcdef12345",
        "candidate_ref=abc1234",
      ),
    ]))[0];

    expect(detailProblem(artifactShortCandidate, artifactRequirement, { candidate: CANDIDATE })).toContain(
      "release identity detail releaseCandidateSha abc1234 must be a full 40-hex SHA",
    );
    expect(detailProblem(artifactShortSignoff, artifactRequirement, { candidate: CANDIDATE })).toContain(
      "release identity detail evidenceSignoffSha abc1234 must be a full 40-hex SHA",
    );
    expect(detailProblem(dryRunShortCandidateRef, dryRunRequirement, { candidate: CANDIDATE })).toContain(
      "dry-run identity detail candidate_ref abc1234 must be a full 40-hex SHA",
    );
  });

  it("requires Android and iOS route rows to include device, build, host, and action details", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/watch/test");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android | Pixel 8 | https://gsav.example.com | /watch/test | Passed: embed=native ready state progress saved and resume verified | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-watch | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |",
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("device detail build profile");
    expect(problem).toContain("device detail Android OS version");
    expect(problem).toContain("device detail WebView version");
    expect(problem).toContain("device detail command/manual action");
    expect(problem).toContain("device detail GSAV host identity");
    expect(problem).toContain("device detail rotation check");
    expect(problem).toContain("device detail safe-area check");
    expect(problem).toContain("device detail 44dp touch target check");
    expect(problem).toContain("device detail clipped text check");
    expect(problem).toContain("device detail nested-touch check");
    expect(problem).toContain("device detail back gesture check");
    expect(problem).toContain("device detail final embedded WebView URL");
  });

  it("rejects device-validation helper artifacts as route row evidence", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace(
        "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-route-",
        "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/diveo-device-validation-2026-06-30-1",
      ),
    ]))[0];

    expect(deviceValidationHelperEvidenceCandidates(row.evidencePath)).toEqual([
      "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/diveo-device-validation-2026-06-30-1",
    ]);
    expect(routeOrNegativeEvidencePathProblems(row, requirement)).toEqual([
      "device-validation helper evidence cannot satisfy route or negative rows: https://github.com/opsiclear/diveo/actions/runs/1/artifacts/diveo-device-validation-2026-06-30-1",
    ]);
    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain(
      "device-validation helper evidence cannot satisfy route or negative rows",
    );
  });

  it("rejects bare run URLs and unmanaged external artifacts as route row evidence", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/");
    const bareRunRow = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace(
        /https:\/\/github\.com\/opsiclear\/diveo\/actions\/runs\/1\/artifacts\/[^ |;]+/,
        "https://github.com/opsiclear/diveo/actions/runs/1",
      ),
    ]))[0];
    const renamedArtifactRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace(/https:\/\/github\.com\/opsiclear\/diveo\/actions\/runs\/1\/artifacts\/[^ |;]+/, "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-ios-route-evidence")
        .replace(/; artifactPurpose=route-evidence; routeEvidenceManifest=[^|]+/, ""),
    ]))[0];

    expect(routeOrNegativeEvidencePathProblems(bareRunRow, requirement)).toContain(
      "route or negative evidence must use a direct artifact/blob with a manifest, not bare Actions run URLs: https://github.com/opsiclear/diveo/actions/runs/1",
    );
    expect(routeOrNegativeEvidencePathProblems(renamedArtifactRow, requirement)).toEqual(expect.arrayContaining([
      "external route or negative evidence artifact must include artifactPurpose=route-evidence",
      "external route or negative evidence artifact must include route/negative evidence manifest",
      "external route or negative evidence artifact must include evidenceManifestSha256=<64-hex>",
      "external route or negative evidence artifact must include sourceRunId=<digits>",
      "external route or negative evidence artifact must include sourceArtifactId=<id>",
      "external route or negative evidence artifact must include mediaSha256=<64-hex>",
      "external route or negative evidence artifact must include helperOnly=false",
    ]));
  });

  it("rejects external route artifact rows with mismatched or placeholder manifest metadata", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/");
    const mismatchedRunRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace("actions/runs/1/artifacts/", "actions/runs/999/artifacts/"),
    ]))[0];
    const placeholderMetadataRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace("routeEvidenceManifest=route-evidence-manifest.json", "routeEvidenceManifest=<manifest>")
        .replace(`sourceArtifactId=${requirement.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, "sourceArtifactId=<id>"),
    ]))[0];
    const helperAssertionRow = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace("; helperOnly=false", ""),
    ]))[0];

    expect(routeOrNegativeEvidencePathProblems(mismatchedRunRow, requirement)).toContain(
      "external route or negative evidence sourceRunId must match evidence artifact URL run 999",
    );
    expect(routeOrNegativeEvidencePathProblems(placeholderMetadataRow, requirement)).toEqual(expect.arrayContaining([
      "external route or negative evidence artifact must include concrete route/negative evidence manifest",
      "external route or negative evidence artifact must include concrete sourceArtifactId",
    ]));
    expect(routeOrNegativeEvidencePathProblems(helperAssertionRow, requirement)).toContain(
      "external route or negative evidence artifact must include helperOnly=false",
    );
  });

  it("requires external negative artifacts to include a negative evidence manifest", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android/iOS" && item.route === "Cross-origin navigation");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace(/; artifactPurpose=negative-evidence; negativeEvidenceManifest=[^|]+/, ""),
    ]))[0];

    expect(routeOrNegativeEvidencePathProblems(row, requirement)).toEqual(expect.arrayContaining([
      "external route or negative evidence artifact must include artifactPurpose=negative-evidence",
      "external route or negative evidence artifact must include route/negative evidence manifest",
    ]));
  });

  it("rejects publish-counted device route rows with local GSAV URLs or placeholder devices", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/explore");
    const localHostRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace("Pixel 8 / iPhone 15 / CI", "TBD")
        .replace("https://gsav.example.com | /explore", "http://127.0.0.1:5191 | /explore"),
    ]))[0];

    const problem = detailProblem(localHostRow, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("device detail concrete device identity");
    expect(problem).toContain("device detail production/staging HTTPS GSAV URL");
  });

  it("rejects publish-counted device route rows with development build profiles", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/explore");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace("build profile: release", "build profile: development"),
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("device detail release or production validation build profile");
  });

  it("rejects publish-counted device route rows without fixed dry-run identity", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/explore");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace(`; releaseCandidateSha=${CANDIDATE.commit}`, "")
        .replace("; dry-run artifact=diveo-release-evidence-v1.0.19", "")
        .replace("; dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1", ""),
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("device detail releaseCandidateSha");
    expect(problem).toContain("device detail fixed dry-run artifact identity");
    expect(problem).toContain("device detail fixed exact trusted Diveo release Actions run URL");
  });

  it("rejects publish-counted device route rows whose dry-run URL is not the exact Diveo release run", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/explore");
    const weakRows = [
      completeRow(requirement).replace(
        "; dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1",
        "; dry-run run URL=https://github.com/opsiclear/gsav-hosting/actions/runs/1",
      ),
      completeRow(requirement).replace(
        "; dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1",
        "; dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1/artifacts/release",
      ),
    ];

    for (const weakRow of weakRows) {
      const row = parseEvidenceRows(qaDoc([weakRow]))[0];
      expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain(
        "device detail fixed exact trusted Diveo release Actions run URL",
      );
    }
  });

  it("allows release-equivalent route evidence only as a no-publish scoped exception", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/explore");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace("; dry-run artifact=diveo-release-evidence-v1.0.19", "")
        .replace("; dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1", "")
        .replace(
          "Passed: embed=native dataSaver=1 hidden web chrome",
          `Passed with scoped exception: embed=native dataSaver=1 hidden web chrome; release-equivalent validation build; releaseEquivalentNoPublish=true; releaseEquivalentReviewer=@release-reviewer; ${exceptionText({ gate: "/explore", reason: "release-equivalent validation build used before fixed dry-run artifact exists", affected: "Android /explore route evidence" })}`,
        ),
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" });

    expect(problem).not.toContain("device detail fixed dry-run artifact identity");
    expect(problem).not.toContain("device detail fixed exact trusted Diveo release Actions run URL");
    expect(problem).toContain("scoped exception is a no-publish blocker");
  });

  it("requires library route evidence to describe the signed-in test-account fixture", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/library");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android | Pixel 8 | https://gsav.example.com | /library | Passed: native saved scenes rendered with no web chrome | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-library | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019; build profile: release; Android OS version: Android 15 API 35; WebView version: 125; manual action: opened /library; gsav-hosting commit def5678 |",
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("route signal /follow/i");
    expect(problem).toContain("route signal /release-owned test account|test account/i");
    expect(problem).toContain("route signal /seeded/i");
    expect(problem).toContain("route signal /account-safe|redacted/i");
  });

  it("requires combined negative rows to prove both platforms unless an exception is recorded", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Cross-origin navigation");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android/iOS | Pixel 8 | https://gsav.example.com | Cross-origin navigation | Passed: Android and iOS cross-origin navigation blocked | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-cross-origin | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |",
    ]))[0];
    const exceptionRow = parseEvidenceRows(qaDoc([
      `| 2026-06-30 | Android/iOS | Pixel 8 | https://gsav.example.com | Cross-origin navigation | Passed: Android cross-origin navigation blocked | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-cross-origin | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019; build profile: release; Android OS version: Android 15 API 35; Android WebView version: 125; iOS OS version: iOS 18.5; iOS WKWebView version: 18.5; trigger: cross-origin navigation; manual action: injected blocked URL; gsav-hosting commit def5678; ${exceptionText({ gate: "Cross-origin navigation", reason: "iOS fixture unavailable pending host QA control", affected: "iOS WKWebView cross-origin evidence" })} |`,
    ]))[0];

    expect(detailProblem(row, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toContain("distinct Android and iOS evidence paths");
    expect(detailProblem(exceptionRow, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toContain("scoped exception is a no-publish blocker");
  });

  it("does not pass final readiness with a negative-case scoped exception row", () => {
    const exceptionRow = completeRow(requiredEvidence.find((item) => item.route === "Cross-origin navigation")).replace(
      "Passed: Android and iOS cross-origin navigation blocked",
      `Passed with scoped exception: Android cross-origin navigation blocked; ${exceptionText({ gate: "Cross-origin navigation", reason: "iOS fixture unavailable until host QA control exists", affected: "iOS WKWebView cross-origin evidence" })}`,
    );
    const rows = requiredEvidence.map((requirement) => (
      requirement.route === "Cross-origin navigation" ? exceptionRow : completeRow(requirement)
    ));

    const result = analyzeReleaseReadiness(qaDoc(rows), {
      candidate: CANDIDATE,
      currentDate: "2026-06-30",
      maxEvidenceAgeDays: null,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "negative validation Cross-origin navigation",
        reason: expect.stringContaining("scoped exception is a no-publish blocker"),
      }),
    ]));
  });

  it("requires negative rows to include device, build, and trigger details", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Host offline/retry");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android/iOS | Pixel 8 / iPhone 15 | https://gsav.example.com | Host offline/retry | Passed: Android and iOS retry error appeared and recovered | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-offline; https://github.com/opsiclear/diveo/actions/runs/1/artifacts/ios-offline | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |",
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("negative detail build profile");
    expect(problem).toContain("negative detail Android OS version");
    expect(problem).toContain("negative detail Android WebView version");
    expect(problem).toContain("negative detail iOS OS version");
    expect(problem).toContain("negative detail iOS WKWebView version");
    expect(problem).toContain("negative detail trigger/action");
    expect(problem).toContain("negative detail GSAV host identity");
  });

  it("rejects publish-counted negative rows with development build profiles", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Host offline/retry");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace("build profile: release", "build profile: development"),
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("negative detail release or production validation build profile");
  });

  it("rejects publish-counted negative rows without fixed dry-run identity", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Host offline/retry");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace(`; releaseCandidateSha=${CANDIDATE.commit}`, "")
        .replace("; dry-run artifact=diveo-release-evidence-v1.0.19", "")
        .replace("; dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1", ""),
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("negative detail releaseCandidateSha");
    expect(problem).toContain("negative detail fixed dry-run artifact identity");
    expect(problem).toContain("negative detail fixed exact trusted Diveo release Actions run URL");
  });

  it("rejects publish-counted negative rows whose dry-run URL is not the exact Diveo release run", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Host offline/retry");
    const weakRows = [
      completeRow(requirement).replace(
        "; dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1",
        "; dry-run run URL=https://github.com/opsiclear/gsav-hosting/actions/runs/1",
      ),
      completeRow(requirement).replace(
        "; dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1",
        "; dry-run run URL=https://github.com/opsiclear/diveo/actions/runs/1/artifacts/release",
      ),
    ];

    for (const weakRow of weakRows) {
      const row = parseEvidenceRows(qaDoc([weakRow]))[0];
      expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain(
        "negative detail fixed exact trusted Diveo release Actions run URL",
      );
    }
  });

  it("requires negative rows to prove missing/offline host intent and QA-flag release parity", () => {
    const missingHostRequirement = requiredEvidence.find((item) => item.route === "Missing host config");
    const crossOriginRequirement = requiredEvidence.find((item) => item.route === "Cross-origin navigation");
    const missingHostRow = parseEvidenceRows(qaDoc([
      completeRow(missingHostRequirement)
        .replace("; intended GSAV host for missing/offline cases=https://gsav.example.com", ""),
    ]))[0];
    const crossOriginRow = parseEvidenceRows(qaDoc([
      completeRow(crossOriginRequirement)
        .replace("; QA validation build parity=dry-run artifact diveo-release-evidence-v1.0.19", "")
        .replace("; QA flag used=EXPO_PUBLIC_GSAV_QA_CONTROLS=1", "")
        .replace("; production prerequisite evidence no QA flags=true", ""),
    ]))[0];

    const missingHostProblem = detailProblem(missingHostRow, missingHostRequirement, { candidate: CANDIDATE });
    const crossOriginProblem = detailProblem(crossOriginRow, crossOriginRequirement, { candidate: CANDIDATE });

    expect(missingHostProblem).toContain("negative detail intended production/staging GSAV host");
    expect(crossOriginProblem).toContain("negative detail QA validation build parity");
    expect(crossOriginProblem).toContain("negative detail QA flag used");
    expect(crossOriginProblem).toContain("negative detail production no-QA-flag proof");
  });

  it("rejects device-validation helper artifacts as negative row evidence", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Cross-origin navigation");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace(
          "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-negative-validation-cross-origin-navigation",
          "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-diveo-device-validation-2026-06-30-1",
        )
        .replace(
          "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/ios-negative-validation-cross-origin-navigation",
          "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/ios-diveo-device-validation-2026-06-30-1",
        ),
    ]))[0];

    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain(
      "device-validation helper evidence cannot satisfy route or negative rows",
    );
  });

  it("rejects publish-counted negative rows with local GSAV URLs or missing platform device identities", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Host offline/retry");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace("Pixel 8 / iPhone 15 / CI", "Pixel 8")
        .replace("https://gsav.example.com | Host offline/retry", "http://10.0.2.2:5191 | Host offline/retry"),
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("negative detail concrete Android and iOS device identities");
    expect(problem).toContain("negative detail production/staging HTTPS GSAV URL");
  });

  it("requires exception rows to include scoped review details and an unexpired ISO revisit date", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Cross-origin navigation");
    const weakExceptionRow = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android/iOS | Pixel 8 | https://gsav.example.com | Cross-origin navigation | Passed: Android cross-origin navigation blocked | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-cross-origin | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019; exception revisit soon |",
    ]))[0];
    const expiredExceptionRow = parseEvidenceRows(qaDoc([
      `| 2026-06-30 | Android/iOS | Pixel 8 | https://gsav.example.com | Cross-origin navigation | Passed: Android cross-origin navigation blocked | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-cross-origin | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019; ${exceptionText({ gate: "Cross-origin navigation", revisit: "2026-06-29" })} |`,
    ]))[0];
    const wrongGateRow = parseEvidenceRows(qaDoc([
      `| 2026-06-30 | Android/iOS | Pixel 8 | https://gsav.example.com | Cross-origin navigation | Passed: Android cross-origin navigation blocked | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-cross-origin | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019; ${exceptionText({ gate: "Host offline/retry" })} |`,
    ]))[0];

    expect(exceptionProblems(exceptionText({ gate: "Cross-origin navigation", revisit: "2026-06-29" }), { currentDate: "2026-06-30" })).toContain("expired revisit date 2026-06-29");
    expect(detailProblem(weakExceptionRow, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toContain("exception detail scoped gate name");
    expect(detailProblem(weakExceptionRow, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toContain("exception detail evidence owner");
    expect(detailProblem(weakExceptionRow, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toContain("exception detail exact reason");
    expect(detailProblem(weakExceptionRow, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toContain("exception detail affected platform/artifact");
    expect(detailProblem(weakExceptionRow, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toContain("exception detail ISO revisit date");
    expect(exceptionProblems("exception gate=Cross-origin navigation; owner=@native-release; reason=fixture missing; affected=iOS evidence; revisit=2026-07-31", { currentDate: "2026-06-30" })).toContain("approver or issue/run link");
    expect(detailProblem(expiredExceptionRow, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toContain("expired revisit date 2026-06-29");
    expect(detailProblem(wrongGateRow, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toContain("scoped gate name Host offline/retry must match");
  });

  it("requires release artifact rows to include scan details and checksums", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release APK artifact");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android release | CI | https://gsav.example.com | Release APK artifact | Passed: APK build completed | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/apk | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |",
    ]))[0];

    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("artifact detail");
    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("apkSha256");
    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("manifestSha256");
  });

  it("requires release artifact rows to prove the manifest is non-debuggable", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release APK artifact");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android release | CI | https://gsav.example.com | Release APK artifact | Passed: verify:release-artifact APK verifier output checked production GSAV web URL, GSAV catalog URL, Supabase URL, and Supabase anon key present; APK bundle path and merged manifest path checked; cleartext disabled; local markers absent; legacy Bilibili/proxy/DASH markers absent; apkSha256 checksum recorded; manifestSha256 checksum recorded | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/apk | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |",
    ]))[0];

    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("debuggable");
  });

  it("requires release artifact rows to prove production endpoint and secret-shape checks", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release APK artifact");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android release | CI | https://gsav.example.com | Release APK artifact | Passed: APK verifier output checked APK bundle path and merged manifest path, cleartext disabled, debuggable disabled, local markers absent, legacy markers absent, apkSha256 checksum recorded; manifestSha256 checksum recorded | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/apk | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |",
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("production GSAV web URL");
    expect(problem).toContain("GSAV catalog URL");
    expect(problem).toContain("Supabase URL");
    expect(problem).toContain("Supabase anon key");
  });

  it("requires validation-prerequisite rows to prove tooling, env, device, and artifact paths", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Validation prerequisites");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Release validation prerequisites | CI | https://gsav.example.com | Validation prerequisites | Passed: prerequisite check ran | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/validation-prereqs | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19 |",
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("validation-prereq detail validation command");
    expect(problem).toContain("--apk-path");
    expect(problem).toContain("--manifest-path");
    expect(problem).toContain("--output-path");
    expect(problem).toContain("adb devices");
    expect(problem).toContain("connected Android device");
    expect(problem).toContain("Android device model");
    expect(problem).toContain("Android OS/API");
    expect(problem).toContain("Android build identity");
    expect(problem).toContain("Android WebView package/version");
    expect(problem).toContain("GitHub CLI");
    expect(problem).toContain("generated APK metadata tool");
    expect(problem).toContain("iOS validation environment");
    expect(problem).toContain("checked.ios metadata");
    expect(problem).toContain("IOS_VALIDATION_OWNER");
    expect(problem).toContain("IOS_VALIDATION_EXECUTOR_PROOF");
    expect(problem).toContain("IOS_VALIDATION_DEVICE");
    expect(problem).toContain("IOS_VALIDATION_VERSION");
    expect(problem).toContain("IOS_WKWEBVIEW_VERSION");
    expect(problem).toContain("IOS_VALIDATION_ARTIFACT_URL");
    expect(problem).toContain("IOS_VALIDATION_ARTIFACT_SHA256");
    expect(problem).toContain("IOS_VALIDATION_ARTIFACT_PATH");
    expect(problem).toContain("iOS validation artifact URL");
    expect(problem).toContain("iOS validation artifact SHA256");
    expect(problem).toContain("computed iOS validation artifact SHA256");
    expect(problem).toContain("iOS artifact SHA256 match");
    expect(problem).toContain("iOS device identity");
    expect(problem).toContain("iOS version");
    expect(problem).toContain("iOS WKWebView/WebKit version");
    expect(problem).toContain("iOS validation owner");
    expect(problem).toContain("EXPO_PUBLIC_GSAV_WEB_URL non-local HTTPS URL");
    expect(problem).toContain("GSAV_HOSTING_COMMIT");
    expect(problem).toContain("release-evidence:attach-validation-prereqs");
    expect(problem).toContain("strict release-evidence bundle verifier");
    expect(problem).toContain("device-validation-bundle-verifier.json");
    expect(problem).toContain("downloaded-release/release-evidence upload");
    expect(problem).toContain("diveo-device-validation artifact");
  });

  it("requires branch-protection rows to prove protected master required checks and review metadata", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Master branch protection");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Branch protection | GitHub | https://github.com/opsiclear/diveo | Master branch protection | Passed: branch protection checked | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/branch-protection | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19 |",
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });
    const detailProblems = branchProtectionDetailProblems(row);

    expect(detailProblems).toEqual(expect.arrayContaining([
      "branch protection query",
      "protected branch master",
      "required status checks",
      "quality / quality required check",
      "branch protection reviewer must be concrete",
      "branch protection reviewedAt must be an ISO timestamp",
    ]));
    expect(problem).toContain("branch-protection detail quality / quality required check");
  });

  it("validates local branch-protection JSON evidence content", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-protection-readiness-"));
    const evidencePath = "docs/qa-evidence/2026-06-30/master-branch-protection.json";
    fs.mkdirSync(path.dirname(path.join(root, evidencePath)), { recursive: true });
    fs.writeFileSync(path.join(root, evidencePath), `${JSON.stringify({
      status: "pass",
      ok: true,
      repository: "OpsiClear-Web/diveo",
      branch: "master",
      requiredChecks: ["quality / quality"],
      observedRequiredChecks: ["quality / quality"],
      review: {
        reviewer: "@release-reviewer",
        reviewedAt: "2026-06-30T22:35:00Z",
      },
      branchQuery: {
        command: "gh api repos/OpsiClear-Web/diveo/branches/master",
        exitCode: 0,
        output: {
          name: "master",
          protected: true,
          protectionUrl: "https://api.github.com/repos/OpsiClear-Web/diveo/branches/master/protection",
          commitSha: "abc1234567890abcdef1234567890abcdef12345",
        },
      },
      protectionQuery: {
        command: "gh api repos/OpsiClear-Web/diveo/branches/master/protection",
        exitCode: 0,
        output: {
          requiredStatusChecks: {
            contexts: [],
            checks: [{ context: "quality / quality" }],
          },
        },
      },
      releaseReadinessImpact: {
        status: "ready",
      },
    }, null, 2)}\n`);
    const row = parseEvidenceRows(qaDoc([
      `| 2026-06-30 | Branch protection | GitHub | https://github.com/OpsiClear-Web/diveo | Master branch protection | Passed: command: npm run release-evidence:branch-protection -- --repo OpsiClear-Web/diveo --branch master --output-path ${evidencePath} --reviewer @release-reviewer; branch protection query: gh api repos/OpsiClear-Web/diveo/branches/master/protection; raw evidence path: ${evidencePath}; protected branch=master; required status checks include quality / quality; reviewer=@release-reviewer; reviewedAt=2026-06-30T22:35:00Z; | ${evidencePath} | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19 |`,
    ]))[0];

    expect(branchProtectionDetailProblems(row, { root })).toEqual([]);
  });

  it("rejects local branch-protection JSON evidence that is still a no-publish blocker", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Master branch protection");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-protection-readiness-"));
    const evidencePath = "docs/qa-evidence/2026-06-30/master-branch-protection.json";
    fs.mkdirSync(path.dirname(path.join(root, evidencePath)), { recursive: true });
    fs.writeFileSync(path.join(root, evidencePath), `${JSON.stringify({
      status: "no-publish",
      ok: false,
      repository: "OpsiClear-Web/diveo",
      branch: "master",
      requiredChecks: ["quality / quality"],
      observedRequiredChecks: [],
      review: {
        reviewer: "@release-reviewer",
        reviewedAt: "2026-06-30T22:35:00Z",
      },
      branchQuery: {
        command: "gh api repos/OpsiClear-Web/diveo/branches/master",
        exitCode: 0,
        output: {
          name: "master",
          protected: false,
          protectionUrl: "https://api.github.com/repos/OpsiClear-Web/diveo/branches/master/protection",
        },
      },
      protectionQuery: {
        command: "gh api repos/OpsiClear-Web/diveo/branches/master/protection",
        exitCode: 1,
        output: {
          message: "Branch not protected",
          status: "404",
        },
      },
      releaseReadinessImpact: {
        status: "no-publish",
      },
    }, null, 2)}\n`);
    const row = parseEvidenceRows(qaDoc([
      `| 2026-06-30 | Branch protection | GitHub | https://github.com/OpsiClear-Web/diveo | Master branch protection | Passed: command: npm run release-evidence:branch-protection -- --repo OpsiClear-Web/diveo --branch master --output-path ${evidencePath} --reviewer @release-reviewer; branch protection query: gh api repos/OpsiClear-Web/diveo/branches/master/protection; raw evidence path: ${evidencePath}; protected branch=master; required status checks include quality / quality; reviewer=@release-reviewer; reviewedAt=2026-06-30T22:35:00Z; | ${evidencePath} | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19 |`,
    ]))[0];

    const detailProblems = branchProtectionDetailProblems(row, { root });
    const problem = detailProblem(row, requirement, { candidate: CANDIDATE, root });

    expect(detailProblems).toEqual(expect.arrayContaining([
      `${evidencePath} must report ok=true and status=pass`,
      `${evidencePath} branchQuery.output.protected must be true`,
      `${evidencePath} protectionQuery.exitCode must be 0`,
      `${evidencePath} observedRequiredChecks must include quality / quality`,
      `${evidencePath} releaseReadinessImpact.status must be ready`,
    ]));
    expect(problem).toContain("branch-protection detail docs/qa-evidence/2026-06-30/master-branch-protection.json must report ok=true and status=pass");
  });

  it("rejects validation-prerequisite rows with local production URLs", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Validation prerequisites");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace("EXPO_PUBLIC_GSAV_WEB_URL=https://gsav.example.com", "EXPO_PUBLIC_GSAV_WEB_URL=http://127.0.0.1:5191")
        .replace("GSAV_RANGE_PROBE_URL=https://gsav.example.com/test.gsav", "GSAV_RANGE_PROBE_URL=http://10.0.2.2:5191/test.gsav"),
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });
    const prereqProblems = validationPrereqDetailProblems(`${row.result}; ${row.notes}`);

    expect(prereqProblems).toEqual(expect.arrayContaining([
      "EXPO_PUBLIC_GSAV_WEB_URL must use https",
      "EXPO_PUBLIC_GSAV_WEB_URL must not use local/private host",
      "GSAV_RANGE_PROBE_URL must use https",
      "GSAV_RANGE_PROBE_URL must not use local/private host",
    ]));
    expect(problem).toContain("validation-prereq detail EXPO_PUBLIC_GSAV_WEB_URL must use https");
    expect(problem).toContain("validation-prereq detail GSAV_RANGE_PROBE_URL must not use local/private host");
  });

  it("requires artifact and generated-version rows to include release evidence identity details", () => {
    const artifactRequirement = requiredEvidence.find((item) => item.route === "Release APK artifact");
    const versionRequirement = requiredEvidence.find((item) => item.route === "Generated versionCode metadata");
    const artifactRow = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android release | CI | https://gsav.example.com | Release APK artifact | Passed: verify:release-artifact APK verifier output checked production GSAV web URL, GSAV catalog URL, Supabase URL, and Supabase anon key present; APK bundle path and merged manifest path checked; cleartext disabled; debuggable disabled; local markers absent; legacy markers absent; apkSha256 checksum recorded; manifestSha256 checksum recorded | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/apk | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |",
    ]))[0];
    const versionRow = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android release | CI | https://gsav.example.com | Generated versionCode metadata | Passed: versionCode Gradle versionCode: 10019, app.json versionCode: 10019, and APK badging versionCode: 10019 match | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/version | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |",
    ]))[0];

    const artifactProblem = detailProblem(artifactRow, artifactRequirement, { candidate: CANDIDATE });
    const versionProblem = detailProblem(versionRow, versionRequirement, { candidate: CANDIDATE });

    for (const problem of [artifactProblem, versionProblem]) {
      expect(problem).toContain("release identity detail");
      expect(problem).toContain("releaseCandidateSha");
      expect(problem).toContain("evidenceSignoffSha");
      expect(problem).toContain("artifact name");
      expect(problem).toContain("checksum-manifest SHA");
    }
    expect(versionProblem).toContain("version detail android:version-metadata command");
    expect(versionProblem).toContain("version detail release-evidence/apk-version-metadata.txt");
  });

  it("requires release evidence artifact URLs to match the row workflow run", () => {
    const artifactRequirement = requiredEvidence.find((item) => item.route === "Release APK artifact");
    const dryRunRequirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const artifactRow = parseEvidenceRows(qaDoc([
      completeRow(artifactRequirement).replace(
        "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-release-apk-artifact-scan",
        "https://github.com/opsiclear/diveo/actions/runs/2/artifacts/android-release-apk-artifact-scan",
      ),
    ]))[0];
    const dryRunRow = parseEvidenceRows(qaDoc([
      completeRow(dryRunRequirement).replace(
        "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/non-publishing-release-dry-run",
        "https://github.com/opsiclear/diveo/actions/runs/2/artifacts/non-publishing-release-dry-run",
      ),
    ]))[0];

    expect(detailProblem(artifactRow, artifactRequirement, { candidate: CANDIDATE })).toContain(
      "release identity detail evidence path run 2 must match row workflow run URL 1",
    );
    expect(detailProblem(dryRunRow, dryRunRequirement, { candidate: CANDIDATE })).toContain(
      "dry-run identity detail evidence path run 2 must match row workflow run URL 1",
    );
  });

  it("rejects untrusted GitHub-like evidence URLs embedded in release row details", () => {
    const artifactRequirement = requiredEvidence.find((item) => item.route === "Release APK artifact");
    const installedRequirement = requiredEvidence.find((item) => item.route === "Release-installed APK smoke");
    const generatedRequirement = requiredEvidence.find((item) => item.route === "Generated versionCode metadata");
    const artifactRow = parseEvidenceRows(qaDoc([
      completeRow(artifactRequirement).replace(
        "https://github.com/opsiclear/diveo/actions/runs/1",
        "https://example.com/actions/runs/1",
      ),
    ]))[0];
    const installedRow = parseEvidenceRows(qaDoc([
      completeRow(installedRequirement).replace(
        "--ci-artifact-url https://github.com/opsiclear/diveo/actions/runs/1/artifacts/2",
        "--ci-artifact-url https://github.com/other/repo/actions/runs/1/artifacts/2",
      ),
    ]))[0];
    const generatedRow = parseEvidenceRows(qaDoc([
      completeRow(generatedRequirement).replace(
        "https://github.com/opsiclear/diveo/actions/runs/1",
        "https://github.com/opsiclear/diveo/releases/tag/v1.0.19",
      ),
    ]))[0];

    expect(detailProblem(artifactRow, artifactRequirement, { candidate: CANDIDATE })).toContain(
      "trusted URL detail row detail evidence URL must be trusted GitHub evidence: https://example.com/actions/runs/1",
    );
    expect(detailProblem(installedRow, installedRequirement, { candidate: CANDIDATE })).toContain(
      "trusted URL detail row detail evidence URL must be trusted GitHub evidence: https://github.com/other/repo/actions/runs/1/artifacts/2",
    );
    expect(detailProblem(generatedRow, generatedRequirement, { candidate: CANDIDATE })).toContain(
      "trusted URL detail row detail evidence URL must be trusted GitHub evidence: https://github.com/opsiclear/diveo/releases/tag/v1.0.19",
    );
  });

  it("requires checksum-manifest rows to include an explicit 64-hex SHA256 value", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release APK artifact");
    const weakRow = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace(CHECKSUM_MANIFEST_SHA, "feedbead"),
    ]))[0];

    expect(checksumManifestDetailProblems(`checksum-manifest SHA256=${CHECKSUM_MANIFEST_SHA}`)).toEqual([]);
    expect(checksumManifestDetailProblems("checksum-manifest SHA256=feedbead")).toEqual([
      "explicit 64-hex checksum-manifest SHA256 value",
    ]);
    expect(detailProblem(weakRow, requirement, { candidate: CANDIDATE })).toContain(
      "explicit 64-hex checksum-manifest SHA256 value",
    );
  });

  it("requires release dry-run rows to include stable publish artifact and provenance identity SHAs", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const missingRow = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace(`publishArtifactIdentitySha256=${PUBLISH_ARTIFACT_IDENTITY_SHA}; `, ""),
    ]))[0];
    const weakRow = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace(`publishArtifactIdentitySha256=${PUBLISH_ARTIFACT_IDENTITY_SHA}`, "publishArtifactIdentitySha256=feedbead"),
    ]))[0];
    const missingProvenanceRow = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace(`gsavPackageProvenanceSha256=${GSAV_PROVENANCE_SHA}; `, ""),
    ]))[0];
    const weakProvenanceRow = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace(`gsavPackageProvenanceSha256=${GSAV_PROVENANCE_SHA}`, "gsavPackageProvenanceSha256=feedbead"),
    ]))[0];

    expect(publishArtifactIdentityDetailProblems(`publishArtifactIdentitySha256=${PUBLISH_ARTIFACT_IDENTITY_SHA}; gsavPackageProvenanceSha256=${GSAV_PROVENANCE_SHA}`)).toEqual([]);
    expect(publishArtifactIdentityDetailProblems("publishArtifactIdentitySha256=feedbead")).toEqual([
      "publishArtifactIdentitySha256=<64-hex>",
      "gsavPackageProvenanceSha256=<64-hex>",
    ]);
    expect(detailProblem(missingRow, requirement, { candidate: CANDIDATE })).toContain(
      "publishArtifactIdentitySha256",
    );
    expect(detailProblem(weakRow, requirement, { candidate: CANDIDATE })).toContain(
      "publishArtifactIdentitySha256=<64-hex>",
    );
    expect(detailProblem(missingProvenanceRow, requirement, { candidate: CANDIDATE })).toContain(
      "gsavPackageProvenanceSha256",
    );
    expect(detailProblem(weakProvenanceRow, requirement, { candidate: CANDIDATE })).toContain(
      "gsavPackageProvenanceSha256=<64-hex>",
    );
  });

  it("requires release dry-run rows to include vendored GSAV package provenance", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const missingRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace(`gsavPackageProvenance @opsiclear/gsav-bridge specifier=file:vendor/opsiclear-gsav-bridge-0.1.0.tgz tarballSha256=${GSAV_BRIDGE_SHA}; `, "")
        .replace(`gsavPackageProvenance @opsiclear/gsav-client specifier=file:vendor/opsiclear-gsav-client-0.2.0.tgz tarballSha256=${GSAV_CLIENT_SHA}; `, ""),
    ]))[0];
    const weakRow = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace(`tarballSha256=${GSAV_BRIDGE_SHA}`, "tarballSha256=feedbead"),
    ]))[0];

    const missingProblem = detailProblem(missingRow, requirement, { candidate: CANDIDATE });
    const weakProblem = detailProblem(weakRow, requirement, { candidate: CANDIDATE });

    expect(missingProblem).toContain("gsavPackageProvenance");
    expect(missingProblem).toContain("@opsiclear\\/gsav-bridge");
    expect(missingProblem).toContain("@opsiclear\\/gsav-client");
    expect(weakProblem).toContain("tarballSha256");
  });

  it("requires release dry-run rows to include publish hash pin evidence", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace(`expected_apk_sha256=${APK_SHA}, `, "")
        .replace(`expected_publish_identity_sha256=${PUBLISH_ARTIFACT_IDENTITY_SHA}, `, "")
        .replace(`repository variables EXPECTED_RELEASE_APK_SHA256=${APK_SHA} and EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256=${PUBLISH_ARTIFACT_IDENTITY_SHA} set for push publish; `, ""),
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("expected_apk_sha256");
    expect(problem).toContain("expected_publish_identity_sha256");
    expect(problem).toContain("EXPECTED_RELEASE_APK_SHA256");
    expect(problem).toContain("EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256");
  });

  it("requires release APK artifact rows to include explicit APK and manifest SHA256 values", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release APK artifact");
    const weakRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace(`apkSha256=${APK_SHA}`, "apkSha256 checksum recorded")
        .replace(`manifestSha256=${MANIFEST_SHA}`, "manifestSha256 checksum recorded"),
    ]))[0];

    expect(apkArtifactChecksumProblems(`apkSha256=${APK_SHA}; manifestSha256=${MANIFEST_SHA}`)).toEqual([]);
    expect(apkArtifactChecksumProblems("apkSha256 checksum recorded; manifestSha256 checksum recorded")).toEqual([
      "explicit 64-hex apkSha256 value",
      "explicit 64-hex manifestSha256 value",
    ]);
    expect(detailProblem(weakRow, requirement, { candidate: CANDIDATE })).toContain(
      "explicit 64-hex apkSha256 value",
    );
    expect(detailProblem(weakRow, requirement, { candidate: CANDIDATE })).toContain(
      "explicit 64-hex manifestSha256 value",
    );
  });

  it("requires installed release APK smoke rows to prove artifact launch and player routes", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release-installed APK smoke");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android release | Pixel 8 | https://gsav.example.com | Release-installed APK smoke | Passed: installed APK and launched app | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/release-installed-smoke | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |",
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("installed-apk detail");
    expect(problem).toContain("/explore");
    expect(problem).toContain("/gsav-diagnostics");
    expect(problem).toContain("\\/watch\\/test");
    expect(problem).toContain("embed=native");
    expect(problem).toContain("retry");
    expect(problem).toContain("resume");
    expect(problem).toContain("android:installed-smoke");
    expect(problem).toContain("--apk-path");
    expect(problem).toContain("--output-path");
    expect(problem).toContain("--production-host-url");
    expect(problem).toContain("Android OS version");
    expect(problem).toContain("Android WebView version");
    expect(problem).toContain("packageName");
    expect(problem).toContain("apkSha256");
    expect(problem).toContain("dry-run-summary");
    expect(problem).toContain("apkSha256MatchesDryRunSummary");
    expect(problem).toContain("dumpsys package");
    expect(problem).toContain("installedVersionCodeMatchesDryRunSummary");
    expect(problem).toContain("productionHostReleaseReady");
    expect(problem).toContain("allowPartialRoutes=false");
    expect(problem).toContain("allowMissingLogMarkers=false");
    expect(problem).toContain("allowMissingDeviceMetadata=false");
    expect(problem).toContain("allowRehearsalHost=false");
    expect(problem).toContain("observedSignalsOk");
    expect(problem).toContain("observedSignalChecks");
    expect(problem).toContain("releaseCandidateSha");
    expect(problem).toContain("ciArtifactUrl");
    expect(problem).toContain("gsav:\\/\\/explore");
    expect(problem).toContain("gsav:\\/\\/gsav-diagnostics");
    expect(problem).toContain("gsav:\\/\\/watch\\/test");
    expect(problem).toContain("filtered logcat");
  });

  it("requires installed APK smoke rows to include exact hash and version matches", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release-installed APK smoke");
    const weakRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace(`apkSha256=${APK_SHA}`, "apkSha256=feedbead")
        .replace("apkSha256MatchesDryRunSummary=true", "APK sha256 matched dry-run-summary")
        .replace("installedVersionCode=10019", "installedVersionCode=10020")
        .replace("installedVersionCodeMatchesDryRunSummary=true", "installed versionCode matched dry-run-summary")
        .replace("observedSignalsOk=true", "observed signals checked")
        .replace("observedSignalChecks passed route-change and bridge-ready-or-error markers", "observed markers checked")
        .replace("filtered logcat captured ReactNativeJS, chromium, WebView, GSAV_ROUTE_CHANGE, and GSAV_BRIDGE_READY logs", "filtered logcat captured ReactNativeJS, chromium, and WebView logs"),
    ]))[0];

    const problem = detailProblem(weakRow, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("explicit 64-hex apkSha256 value");
    expect(problem).toContain("apkSha256MatchesDryRunSummary=true");
    expect(problem).toContain("installedVersionCodeMatchesDryRunSummary=true");
    expect(problem).toContain("installedVersionCode must match app.json 10019");
    expect(problem).toContain("observedSignalsOk=true");
    expect(problem).toContain("observedSignalChecks");
    expect(problem).toContain("route-change observed signal");
    expect(problem).toContain("bridge-ready/error observed signal");
  });

  it("requires installed APK smoke rows to use a release-ready production host", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release-installed APK smoke");
    const missingFlagRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace(" --production-host-url https://gsav.example.com", ""),
    ]))[0];
    const localHostRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace("--production-host-url https://gsav.example.com", "--production-host-url http://10.0.2.2:5191")
        .replace("productionHostUrl: https://gsav.example.com", "productionHostUrl: http://10.0.2.2:5191"),
    ]))[0];
    const rehearsalRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace("productionHostReleaseReady=true", "productionHostReleaseReady=false")
        .replace("allowRehearsalHost=false", "allowRehearsalHost=true"),
    ]))[0];

    const missingFlagProblem = detailProblem(missingFlagRow, requirement, { candidate: CANDIDATE });
    const localHostProblem = detailProblem(localHostRow, requirement, { candidate: CANDIDATE });
    const rehearsalProblem = detailProblem(rehearsalRow, requirement, { candidate: CANDIDATE });

    expect(missingFlagProblem).toContain("--production-host-url");
    expect(localHostProblem).toContain("productionHostUrl must use https");
    expect(localHostProblem).toContain("productionHostUrl must not use local/private host");
    expect(rehearsalProblem).toContain("productionHostReleaseReady=true");
    expect(rehearsalProblem).toContain("release installed-smoke must not use --allow-rehearsal-host");
  });

  it("rejects installed APK smoke rows captured with relaxation flags", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release-installed APK smoke");
    const relaxedRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace("allowPartialRoutes=false", "allowPartialRoutes=true")
        .replace("allowMissingLogMarkers=false", "allowMissingLogMarkers=true")
        .replace("allowMissingDeviceMetadata=false", "allowMissingDeviceMetadata=true")
        .replace("allowRehearsalHost=false", "allowRehearsalHost=true"),
    ]))[0];
    const cliRelaxedRow = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace(
        "--production-host-url https://gsav.example.com",
        "--production-host-url https://gsav.example.com --allow-partial-routes true --allow-missing-log-markers true --allow-missing-device-metadata true --allow-rehearsal-host true",
      ),
    ]))[0];

    const relaxedProblem = detailProblem(relaxedRow, requirement, { candidate: CANDIDATE });
    const cliRelaxedProblem = detailProblem(cliRelaxedRow, requirement, { candidate: CANDIDATE });

    expect(relaxedProblem).toContain("release installed-smoke must not use --allow-partial-routes");
    expect(relaxedProblem).toContain("release installed-smoke must not use --allow-missing-log-markers");
    expect(relaxedProblem).toContain("release installed-smoke must not use --allow-missing-device-metadata");
    expect(relaxedProblem).toContain("release installed-smoke must not use --allow-rehearsal-host");
    expect(cliRelaxedProblem).toContain("release installed-smoke must not use --allow-partial-routes");
    expect(cliRelaxedProblem).toContain("release installed-smoke must not use --allow-missing-log-markers");
    expect(cliRelaxedProblem).toContain("release installed-smoke must not use --allow-missing-device-metadata");
    expect(cliRelaxedProblem).toContain("release installed-smoke must not use --allow-rehearsal-host");
  });

  it("requires runtime-smoke release evidence or an explicit exception row", () => {
    const rows = requiredEvidence
      .filter((item) => item.route !== "JS runtime smoke")
      .map(completeRow);

    const result = analyzeReleaseReadiness(qaDoc(rows), { candidate: CANDIDATE });

    expect(result.ok).toBe(false);
    expect(result.missing.map((item) => item.id)).toContain("JS runtime smoke");
  });

  it("requires runtime-smoke evidence to mention bridge-version compatibility", () => {
    const requirement = requiredEvidence.find((item) => item.route === "JS runtime smoke");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | JS runtime smoke | Chromium | https://gsav.example.com | JS runtime smoke | Passed: npm run gsav:runtime-smoke verified embed=native, topNav absent, miniPlayer absent, captured GSAV_AUTH_READY, GSAV_BRIDGE_READY, and GSAV_ROUTE_CHANGE | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/runtime | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Node: v24.14.0; npm: 11.9.0; gsav-hosting commit def5678 |",
    ]))[0];

    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("runtime-smoke detail");
    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("compatible.*bridge");
  });

  it("requires runtime-smoke evidence to include GSAV_BRIDGE_READY version and minVersion", () => {
    const requirement = requiredEvidence.find((item) => item.route === "JS runtime smoke");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace("bridge v1/minVersion v1", "bridge v1"),
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("GSAV_BRIDGE_READY minVersion");
    expect(runtimeSmokeDetailProblems(row)).toContain("GSAV_BRIDGE_READY minVersion");
  });

  it("requires runtime-smoke evidence to include Explore Shorts structure and scroll proof", () => {
    const requirement = requiredEvidence.find((item) => item.route === "JS runtime smoke");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace("/explore?embed=native&dataSaver=1", "/explore")
        .replace("with exactly one embed=native, exactly one dataSaver=1, one .shortsFeed, multiple .shortsItem scenes, vertical scroll snap, visible scene change after scroll, ", ""),
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("\\/explore\\?embed=native&dataSaver=1");
    expect(problem).toContain("shortsFeed");
    expect(problem).toContain("shortsItem");
    expect(problem).toContain("scroll");
    expect(problem).toContain("visible");
  });

  it("requires runtime-smoke evidence to include command metadata", () => {
    const requirement = requiredEvidence.find((item) => item.route === "JS runtime smoke");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | JS runtime smoke | Chromium | https://gsav.example.com | JS runtime smoke | Passed: npm run gsav:runtime-smoke verified embed=native, topNav absent, miniPlayer absent, captured GSAV_AUTH_READY, compatible GSAV_BRIDGE_READY bridge v1/minVersion v1, and GSAV_ROUTE_CHANGE | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/runtime | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; gsav-hosting commit def5678 |",
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("nodeVersion|Node");
    expect(problem).toContain("npmVersion|npm");
  });

  it("rejects publish-counted runtime-smoke evidence from local or private GSAV hosts", () => {
    const requirement = requiredEvidence.find((item) => item.route === "JS runtime smoke");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | JS runtime smoke | Chromium | http://127.0.0.1:5191 | JS runtime smoke | Passed: npm run gsav:runtime-smoke verified embed=native, topNav absent, miniPlayer absent, captured GSAV_AUTH_READY, compatible GSAV_BRIDGE_READY bridge v1/minVersion v1, and GSAV_ROUTE_CHANGE | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/runtime | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Node: v24.14.0; npm: 11.9.0; gsav-hosting commit def5678 |",
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("runtime-smoke GSAV URL must use https");
    expect(problem).toContain("runtime-smoke GSAV URL must not use local/private host");
  });

  it("rejects publish-counted runtime-smoke evidence with unavailable GSAV host identity", () => {
    const requirement = requiredEvidence.find((item) => item.route === "JS runtime smoke");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | JS runtime smoke | Chromium | https://gsav.example.com | JS runtime smoke | Passed: npm run gsav:runtime-smoke verified embed=native, topNav absent, miniPlayer absent, captured GSAV_AUTH_READY, compatible GSAV_BRIDGE_READY bridge v1/minVersion v1, and GSAV_ROUTE_CHANGE | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/runtime | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Node: v24.14.0; npm: 11.9.0; gsav-hosting commit: unavailable because the host checkout was not a git repo |",
    ]))[0];

    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("explicit GSAV host/build identity value");
  });

  it("requires runtime-smoke evidence to include an explicit host identity value", () => {
    const requirement = requiredEvidence.find((item) => item.route === "JS runtime smoke");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace("gsav-hosting commit def5678", "GSAV host identity present"),
    ]))[0];

    expect(runtimeSmokeHostIdentityValue("gsavHostingCommit=def5678abc1234")).toBe("def5678abc1234");
    expect(runtimeSmokeHostIdentityValue("GSAV host identity present")).toBe("present");
    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain(
      "explicit GSAV host/build identity value",
    );
  });

  it("rejects runtime-smoke scoped exceptions as publish-readiness evidence", () => {
    const row = parseEvidenceRows(qaDoc([
      `| 2026-06-30 | JS runtime smoke | Chromium | http://127.0.0.1:5191 | JS runtime smoke | Passed: npm run gsav:runtime-smoke verified embed=native, topNav absent, miniPlayer absent, captured GSAV_AUTH_READY, compatible GSAV_BRIDGE_READY bridge v1/minVersion v1, and GSAV_ROUTE_CHANGE | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/runtime | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Node: v24.14.0; npm: 11.9.0; gsav-hosting commit: unavailable; ${exceptionText({ gate: "JS runtime smoke", reason: "production host identity unavailable for local pre-release smoke", affected: "production runtime smoke evidence" })} |`,
    ]))[0];

    expect(runtimeSmokeDetailProblems(row, { currentDate: "2026-06-30" })).toEqual(expect.arrayContaining([
      "runtime-smoke scoped exception is a no-publish blocker",
      "runtime-smoke GSAV URL must use https",
      "runtime-smoke GSAV URL must not use local/private host",
      "explicit GSAV host/build identity value",
    ]));
  });

  it("does not pass final readiness with a runtime-smoke scoped exception row", () => {
    const runtimeRequirement = requiredEvidence.find((item) => item.route === "JS runtime smoke");
    const rows = requiredEvidence.map((requirement) => (
      requirement === runtimeRequirement
        ? `| 2026-06-30 | JS runtime smoke | Chromium | http://127.0.0.1:5191 | JS runtime smoke | Passed: npm run gsav:runtime-smoke verified embed=native, topNav absent, miniPlayer absent, captured GSAV_AUTH_READY, compatible GSAV_BRIDGE_READY bridge v1/minVersion v1, and GSAV_ROUTE_CHANGE | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/runtime | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Node: v24.14.0; npm: 11.9.0; gsav-hosting commit: unavailable; ${exceptionText({ gate: "JS runtime smoke", reason: "production host identity unavailable for local pre-release smoke", affected: "production runtime smoke evidence" })} |`
        : completeRow(requirement)
    ));

    const result = analyzeReleaseReadiness(qaDoc(rows), { candidate: CANDIDATE, currentDate: "2026-06-30" });

    expect(result.ok).toBe(false);
    expect(result.missing.map((item) => item.id)).toContain("JS runtime smoke");
    expect(result.missing.find((item) => item.id === "JS runtime smoke").reason).toContain(
      "runtime-smoke scoped exception is a no-publish blocker",
    );
  });

  it("rejects stale duplicate rows by using the latest matching evidence row", () => {
    const requirement = requiredEvidence.find((item) => item.platform === "Android" && item.route === "/");
    const rows = requiredEvidence.map(completeRow);
    rows.push("| _pending_ | Android | _pending_ | https://gsav.example.com | / | _pending_ | _pending_ | superseded by rerun |");

    const parsedRows = parseEvidenceRows(qaDoc(rows));
    const latest = findEvidence(parsedRows, requirement);
    const result = analyzeReleaseReadiness(qaDoc(rows), { candidate: CANDIDATE });

    expect(latest.result).toBe("_pending_");
    expect(result.ok).toBe(false);
    expect(result.missing.map((item) => item.id)).toContain("Android route /");
  });

  it("requires generated Gradle, app.json, and APK versionCode values to match", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Generated versionCode metadata");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Android release | CI | https://gsav.example.com | Generated versionCode metadata | Passed: versionCode Gradle versionCode: 10019, app.json versionCode: 10019, APK badging versionCode: 10020 | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/version | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |",
    ]))[0];

    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("versionCode value must match app.json 10019");
  });

  it("requires release artifact rows to state the exact Diveo release workflow run URL", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release APK artifact");
    const weakRows = [
      completeRow(requirement).replace(
        "workflow run URL https://github.com/opsiclear/diveo/actions/runs/1",
        "workflow run URL https://github.com/opsiclear/gsav-hosting/actions/runs/1",
      ),
      completeRow(requirement).replace(
        "workflow run URL https://github.com/opsiclear/diveo/actions/runs/1",
        "workflow run URL https://github.com/opsiclear/diveo/actions/runs/1/artifacts/release",
      ),
    ];

    for (const weakRow of weakRows) {
      const row = parseEvidenceRows(qaDoc([weakRow]))[0];
      expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain(
        "release identity detail workflow run URL matching evidence path run",
      );
    }
  });

  it("requires generated version metadata rows to pass the expected versionCode argument", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Generated versionCode metadata");
    const row = parseEvidenceRows(qaDoc([
      completeRow(requirement).replace(" --expected-version-code 10019", ""),
    ]))[0];

    expect(detailProblem(row, requirement, { candidate: CANDIDATE })).toContain("--expected-version-code argument");
  });

  it("requires a generated APK metadata source when APK badging has an exception", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Generated versionCode metadata");
    const weakExceptionRow = parseEvidenceRows(qaDoc([
      `| 2026-06-30 | Android release | CI | https://gsav.example.com | Generated versionCode metadata | Passed: versionCode Gradle versionCode: 10019 and app.json versionCode: 10019; APK badging unavailable | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/version | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019; ${exceptionText({ gate: "Generated versionCode metadata", reason: "default APK badging tool unavailable on runner", affected: "APK version metadata evidence" })} |`,
    ]))[0];
    const acceptedSourceRow = parseEvidenceRows(qaDoc([
      `| 2026-06-30 | Android release | CI | https://gsav.example.com | Generated versionCode metadata | Passed: versionCode releaseCandidateSha=abc1234567890abcdef1234567890abcdef12345; evidenceSignoffSha=abc1234567890abcdef1234567890abcdef12345; artifact name diveo-release-evidence-v1.0.19; checksum-manifest SHA256=${CHECKSUM_MANIFEST_SHA}; workflow run URL https://github.com/opsiclear/diveo/actions/runs/1; command: npm run android:version-metadata -- --apk-path android/app/build/outputs/apk/release/app-release.apk --expected-version-code 10019 --output-path release-evidence/apk-version-metadata.txt; release-evidence/apk-version-metadata.txt captured; Gradle versionCode: 10019, app.json versionCode: 10019, and bundletool dump manifest versionCode: 10019 match; APK badging unavailable | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/version | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019; ${exceptionText({ gate: "Generated versionCode metadata", reason: "default APK badging tool unavailable on runner", affected: "APK version metadata evidence" })} |`,
    ]))[0];

    expect(detailProblem(weakExceptionRow, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toContain("accepted generated APK metadata source");
    expect(detailProblem(acceptedSourceRow, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toContain("scoped exception is a no-publish blocker");
  });

  it("accepts generated APK metadata sources without requiring an exception", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Generated versionCode metadata");
    const analyzerRow = parseEvidenceRows(qaDoc([
      `| 2026-06-30 | Android release | CI | https://gsav.example.com | Generated versionCode metadata | Passed: versionCode releaseCandidateSha=abc1234567890abcdef1234567890abcdef12345; evidenceSignoffSha=abc1234567890abcdef1234567890abcdef12345; artifact name diveo-release-evidence-v1.0.19; checksum-manifest SHA256=${CHECKSUM_MANIFEST_SHA}; workflow run URL https://github.com/opsiclear/diveo/actions/runs/1; command: npm run android:version-metadata -- --apk-path android/app/build/outputs/apk/release/app-release.apk --expected-version-code 10019 --output-path release-evidence/apk-version-metadata.txt; release-evidence/apk-version-metadata.txt captured; Gradle versionCode: 10019, app.json versionCode: 10019, and apkanalyzer manifest print versionCode: 10019 match | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/version | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |`,
    ]))[0];
    const metadataFileRow = parseEvidenceRows(qaDoc([
      `| 2026-06-30 | Android release | CI | https://gsav.example.com | Generated versionCode metadata | Passed: versionCode releaseCandidateSha=abc1234567890abcdef1234567890abcdef12345; evidenceSignoffSha=abc1234567890abcdef1234567890abcdef12345; artifact name diveo-release-evidence-v1.0.19; checksum-manifest SHA256=${CHECKSUM_MANIFEST_SHA}; workflow run URL https://github.com/opsiclear/diveo/actions/runs/1; command: npm run android:version-metadata -- --apk-path android/app/build/outputs/apk/release/app-release.apk --expected-version-code 10019 --output-path release-evidence/apk-version-metadata.txt; release-evidence/apk-version-metadata.txt captured; Gradle versionCode: 10019, app.json versionCode: 10019, and apk-version-metadata source=apkanalyzer manifest print versionCode=10019 match | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/version | owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |`,
    ]))[0];

    expect(detailProblem(analyzerRow, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toBeNull();
    expect(detailProblem(metadataFileRow, requirement, { candidate: CANDIDATE, currentDate: "2026-06-30" })).toBeNull();
  });

  it("requires production range-probe rows to include request and response details", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Production .gsav range probe");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | Production host | GitHub Actions | https://gsav.example.com | Production .gsav range probe | Passed: production range probe returned 206 | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/range | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; gsav-hosting commit def5678 |",
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("range-probe detail");
    expect(problem).toContain("GSAV_RANGE_PROBE_URL");
    expect(problem).toContain("Content-Range");
    expect(problem).toContain("Access-Control-Allow-Origin");
    expect(problem).toContain("Access-Control-Expose-Headers");
    expect(problem).toContain("production .gsav URL");
  });

  it("rejects local or non-HTTPS range-probe URLs", () => {
    expect(rangeProbeDetailProblems(
      `GSAV_RANGE_PROBE_URL=http://127.0.0.1/test.gsav Range: bytes=0-0 returned 206 Content-Range bytes 0-0/12345; ${RANGE_CORS_PROOF}`,
    )).toEqual(expect.arrayContaining([
      "production .gsav URL must use https",
      "production .gsav URL must not use local/private host",
    ]));

    expect(rangeProbeDetailProblems(
      `GSAV_RANGE_PROBE_URL=https://[fd00::1]/test.gsav Range: bytes=0-0 returned 206 Content-Range bytes 0-0/12345; ${RANGE_CORS_PROOF}`,
    )).toEqual(expect.arrayContaining([
      "production .gsav URL must not use local/private host",
    ]));

    expect(rangeProbeDetailProblems(
      `GSAV_RANGE_PROBE_URL=https://[::1]/test.gsav Range: bytes=0-0 returned 206 Content-Range bytes 0-0/12345; ${RANGE_CORS_PROOF}`,
    )).toEqual(expect.arrayContaining([
      "production .gsav URL must not use local/private host",
    ]));

    expect(rangeProbeDetailProblems(
      `GSAV_RANGE_PROBE_URL=https://127.0.0.2/test.gsav Range: bytes=0-0 returned 206 Content-Range bytes 0-0/12345; ${RANGE_CORS_PROOF}`,
    )).toEqual(expect.arrayContaining([
      "production .gsav URL must not use local/private host",
    ]));

    expect(rangeProbeDetailProblems(
      `GSAV_RANGE_PROBE_URL=https://cdn.example.com/test.gsav Range: bytes=0-0 returned 206 Content-Range bytes 0-0/12345; ${RANGE_CORS_PROOF}`,
    )).toEqual([]);
  });

  it("requires production range-probe rows to include the exact Content-Range value", () => {
    expect(rangeProbeDetailProblems(
      `GSAV_RANGE_PROBE_URL=https://cdn.example.com/test.gsav Range: bytes=0-0 returned 206 Content-Range in release workflow; ${RANGE_CORS_PROOF}`,
    )).toContain("Content-Range bytes 0-0/<size> value");
    expect(rangeProbeDetailProblems(
      `GSAV_RANGE_PROBE_URL=https://cdn.example.com/test.gsav Range: bytes=0-0 returned 206 Content-Range bytes 0-0/* in release workflow; ${RANGE_CORS_PROOF}`,
    )).toContain("Content-Range bytes 0-0/<size> value");
    expect(rangeProbeDetailProblems(
      `GSAV_RANGE_PROBE_URL=https://cdn.example.com/test.gsav Range: bytes=0-0 returned 206 Content-Range bytes 1-2/12345 in release workflow; ${RANGE_CORS_PROOF}`,
    )).toContain("Content-Range bytes 0-0/<size> value");
  });

  it("requires production range-probe rows to include browser-readable range CORS proof", () => {
    const base = "GSAV_RANGE_PROBE_URL=https://cdn.example.com/test.gsav Range: bytes=0-0 returned 206 Content-Range bytes 0-0/12345";

    expect(rangeProbeDetailProblems(
      `${base}; Access-Control-Expose-Headers=Accept-Ranges, Content-Length, Content-Range, ETag`,
    )).toContain("Access-Control-Allow-Origin");
    expect(rangeProbeDetailProblems(
      `${base}; Access-Control-Allow-Origin=*; Access-Control-Expose-Headers=Accept-Ranges, Content-Range, ETag`,
    )).toContain("Access-Control-Expose-Headers includes Content-Length");
    expect(rangeProbeDetailProblems(
      `GSAV web URL=https://gsav.example.com; ${base}; Access-Control-Allow-Origin=https://wrong.example; Access-Control-Expose-Headers=Accept-Ranges, Content-Length, Content-Range, ETag`,
    )).toContain("Access-Control-Allow-Origin must be * or production GSAV origin");
    expect(rangeProbeDetailProblems(
      `GSAV web URL=https://gsav.example.com; ${base}; Access-Control-Allow-Origin=https://gsav.example.com; Access-Control-Expose-Headers=Accept-Ranges, Content-Length, Content-Range, ETag`,
    )).toEqual([]);
    expect(rangeProbeDetailProblems(
      `${base}; ${RANGE_CORS_PROOF}`,
    )).toEqual([]);
  });

  it("rejects negated or ambiguous production range exposed-header prose", () => {
    const base = "GSAV_RANGE_PROBE_URL=https://cdn.example.com/test.gsav Range: bytes=0-0 returned 206 Content-Range bytes 0-0/12345; Access-Control-Allow-Origin=*";

    expect(rangeProbeDetailProblems(
      `${base}; Access-Control-Expose-Headers missing Accept-Ranges, Content-Length, Content-Range, ETag`,
    )).toEqual(expect.arrayContaining([
      "Access-Control-Expose-Headers includes Accept-Ranges",
      "Access-Control-Expose-Headers includes Content-Length",
      "Access-Control-Expose-Headers includes Content-Range",
      "Access-Control-Expose-Headers includes ETag",
    ]));
    expect(rangeProbeDetailProblems(
      `${base}; Access-Control-Expose-Headers=does not expose Accept-Ranges, Content-Length, Content-Range, ETag`,
    )).toContain("Access-Control-Expose-Headers includes Accept-Ranges");
    expect(rangeProbeDetailProblems(
      `${base}; Access-Control-Expose-Headers=Accept-Ranges, Content-Length not exposed, Content-Range, ETag`,
    )).toContain("Access-Control-Expose-Headers includes Content-Length");
  });

  it("requires detailed non-publishing release dry-run evidence", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const row = parseEvidenceRows(qaDoc([
      "| 2026-06-30 | GitHub Actions release dry run | GitHub Actions | https://gsav.example.com | Release workflow dry run | Passed: publish_release=false workflow run uploaded artifact with sha256 checksum | https://github.com/opsiclear/diveo/actions/runs/1/artifacts/dry-run | diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019 |",
    ]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("production preflight");
    expect(problem).toContain("\\/explore\\?embed=native&dataSaver=1");
    expect(problem).toContain("\\/native-diagnostics\\?embed=native");
    expect(problem).toContain("\\/watch\\/test\\?embed=native");
    expect(problem).toContain("\\/watch\\/test\\?t=2\\.5&embed=native");
    expect(problem).toContain("\\/watch\\/elly\\?embed=native");
    expect(problem).toContain("workflow_dispatch");
    expect(problem).toContain("production secrets");
    expect(problem).toContain("candidate_ref");
    expect(problem).toContain("evidenceSignoffSha");
    expect(problem).toContain("Android build");
    expect(problem).toContain("APK verifier");
    expect(problem).toContain("bundle verifier");
    expect(problem).toContain("release-evidence");
    expect(problem).toContain("release-candidate\\.txt");
    expect(problem).toContain("signoff-diff-files\\.txt");
    expect(problem).toContain("no-publish-side-effect\\.txt");
    expect(problem).toContain("signoff diff");
    expect(problem).toContain("QA.*audit.*evidence");
    expect(problem).toContain("gsav-preflight\\.json");
    expect(problem).toContain("gsav:runtime-smoke");
    expect(problem).toContain("gsav-runtime-smoke\\.json");
    expect(problem).toContain("dry-run-summary\\.json");
    expect(problem).toContain("evidence-checksums\\.txt");
    expect(problem).toContain("dry-run-summary\\.rangeProbeUrl");
    expect(problem).toContain("dry-run-summary\\.rangeRequest");
    expect(problem).toContain("diveoCommit.*releaseCandidateSha");
    expect(problem).toContain("GSAV_HOSTING_COMMIT");
    expect(problem).toContain("GSAV_HOST_IDENTITY_URL");
    expect(problem).toContain("hostIdentityVerified");
    expect(problem).toContain("hostIdentity\\.url");
    expect(problem).toContain("hostIdentity\\.expectedIdentity");
    expect(problem).toContain("observedIdentity");
    expect(problem).toContain("artifact name");
    expect(problem).toContain("checksum-manifest SHA");
    expect(problem).toContain("artifact review signoff");
    expect(problem).toContain("reviewer");
    expect(problem).toContain("artifact review artifact name or ID");
    expect(problem).toContain("reviewedAt");
    expect(problem).toContain("GitHub run conclusion");
    expect(problem).toContain("downloaded checksum-manifest");
    expect(problem).toContain("downloaded.*verify:release-evidence-bundle");
    expect(problem).toContain("no GitHub release");
    expect(problem).toContain("no (?:GitHub release, )?commit");
    expect(problem).toContain("no (?:GitHub release, commit, )?push");
    expect(problem).toContain("no (?:GitHub release, commit, push, )?version bump");
  });

  it("requires release dry-run rows to summarize production preflight route coverage", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const completeDryRun = completeRow(requirement);
    const weakRowText = completeDryRun.replace(
      "production preflight checked /explore?embed=native&dataSaver=1, /native-diagnostics?embed=native, /watch/test?embed=native, /watch/test?t=2.5&embed=native, and /watch/elly?embed=native; ",
      "",
    );
    const row = parseEvidenceRows(qaDoc([weakRowText]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("\\/explore\\?embed=native&dataSaver=1");
    expect(problem).toContain("\\/native-diagnostics\\?embed=native");
    expect(problem).toContain("\\/watch\\/test\\?embed=native");
    expect(problem).toContain("\\/watch\\/test\\?t=2\\.5&embed=native");
    expect(problem).toContain("\\/watch\\/elly\\?embed=native");
  });

  it("requires release dry-run rows to prove dry-run summary range metadata matches preflight", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const weakRowText = completeRow(requirement)
      .replace("dry-run-summary.rangeProbeUrl matched gsav-preflight.json rangeAsset.url; ", "")
      .replace("dry-run-summary.rangeRequest matched rangeAsset.requestRange; ", "");
    const row = parseEvidenceRows(qaDoc([weakRowText]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("dry-run-summary\\.rangeProbeUrl");
    expect(problem).toContain("dry-run-summary\\.rangeRequest");
  });

  it("requires dry-run preflight and runtime smoke outputs to each match the candidate commit", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const weakRowText = completeRow(requirement)
      .replace(/gsav-preflight\.json[^;]+; /, "gsav-preflight.json captured production preflight; ")
      .replace(/gsav-runtime-smoke\.json[^;]+; /, "gsav-runtime-smoke.json captured runtime smoke; ")
      .replace("no GitHub release created", "releaseCandidateSha matched workflow commit; no GitHub release created");
    const row = parseEvidenceRows(qaDoc([weakRowText]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("gsav-preflight\\.json");
    expect(problem).toContain("gsav-runtime-smoke\\.json");
    expect(problem).toContain("commit.*match");
  });

  it("requires release dry-run rows to prove host-served identity metadata matched GSAV_HOSTING_COMMIT", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const weakRowText = completeRow(requirement)
      .replace("GSAV_HOST_IDENTITY_URL=https://gsav.example.com/build.json; ", "")
      .replace("hostIdentityVerified=true; ", "")
      .replace("hostIdentity.url=https://gsav.example.com/build.json; ", "")
      .replace("hostIdentity.expectedIdentity=def5678abc1234; ", "")
      .replace("hostIdentity.observedIdentity=def5678abc1234; ", "");
    const row = parseEvidenceRows(qaDoc([weakRowText]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("GSAV_HOST_IDENTITY_URL");
    expect(problem).toContain("hostIdentityVerified");
    expect(problem).toContain("hostIdentity\\.url");
    expect(problem).toContain("hostIdentity\\.expectedIdentity");
    expect(problem).toContain("observedIdentity");
  });

  it("requires release dry-run rows to summarize no-publish side-effect proof fields", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const weakRowText = completeRow(requirement)
      .replace(/no-publish proof recorded [^;]+; /, "")
      .replace("git status only showed generated release-evidence outputs; ", "")
      .replace("git rev-parse HEAD and remote ref HEAD matched workflowSha; ", "")
      .replace(/gh release view v1\.0\.19 returned [^;]+; /, "");
    const row = parseEvidenceRows(qaDoc([weakRowText]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("githubReleaseLookup");
    expect(problem).toContain("githubReleasePresent");
    expect(problem).toContain("git status");
    expect(problem).toContain("git rev-parse HEAD");
    expect(problem).toContain("remote ref");
    expect(problem).toContain("gh release view");
    expect(problem).toContain("workflowSha");
  });

  it("rejects generic dry-run host identity wording without explicit compared values", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const genericRowText = completeRow(requirement)
      .replace("hostIdentity.expectedIdentity=def5678abc1234; ", "hostIdentity.expectedIdentity=GSAV_HOSTING_COMMIT; ")
      .replace("hostIdentity.observedIdentity=def5678abc1234; ", "hostIdentity.observedIdentity matched GSAV_HOSTING_COMMIT; ");
    const row = parseEvidenceRows(qaDoc([genericRowText]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("explicit hostIdentity.expectedIdentity value");
    expect(problem).toContain("explicit hostIdentity.observedIdentity value");
    expect(releaseDryRunHostIdentityProblems(genericRowText)).toEqual(expect.arrayContaining([
      "explicit hostIdentity.expectedIdentity value",
      "explicit hostIdentity.observedIdentity value",
    ]));
  });

  it("rejects local, non-HTTPS, or mismatched dry-run host identity metadata URLs", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const localUrlText = completeRow(requirement)
      .replace("GSAV_HOST_IDENTITY_URL=https://gsav.example.com/build.json; ", "GSAV_HOST_IDENTITY_URL=http://127.0.0.1/build.json; ")
      .replace("hostIdentity.url=https://gsav.example.com/build.json; ", "hostIdentity.url=http://127.0.0.1/build.json; ");
    const mismatchedUrlText = completeRow(requirement)
      .replace("hostIdentity.url=https://gsav.example.com/build.json; ", "hostIdentity.url=https://cdn.example.com/build.json; ");

    expect(releaseDryRunHostIdentityProblems(localUrlText)).toEqual(expect.arrayContaining([
      "GSAV_HOST_IDENTITY_URL must use https",
      "GSAV_HOST_IDENTITY_URL must not use local/private host",
      "hostIdentity.url must use https",
      "hostIdentity.url must not use local/private host",
    ]));
    expect(releaseDryRunHostIdentityProblems(mismatchedUrlText)).toEqual(expect.arrayContaining([
      "hostIdentity.url must match GSAV_HOST_IDENTITY_URL",
    ]));
  });

  it("rejects dry-run host identity values that do not match the hosting commit", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const mismatchedRowText = completeRow(requirement)
      .replace("hostIdentity.observedIdentity=def5678abc1234; ", "hostIdentity.observedIdentity=beef9876abc123; ");
    const row = parseEvidenceRows(qaDoc([mismatchedRowText]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("hostIdentity.observedIdentity must match GSAV_HOSTING_COMMIT");
    expect(releaseDryRunHostIdentityProblems(mismatchedRowText)).toEqual(expect.arrayContaining([
      "hostIdentity.observedIdentity must match GSAV_HOSTING_COMMIT",
    ]));
  });

  it("rejects dry-run host identity values that are too short to prove a commit match", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const shortPrefixRowText = completeRow(requirement)
      .replace("hostIdentity.expectedIdentity=def5678abc1234; ", "hostIdentity.expectedIdentity=d; ")
      .replace("hostIdentity.observedIdentity=def5678abc1234; ", "hostIdentity.observedIdentity=d; ");
    const row = parseEvidenceRows(qaDoc([shortPrefixRowText]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("explicit hostIdentity.expectedIdentity value");
    expect(problem).toContain("explicit hostIdentity.observedIdentity value");
    expect(releaseDryRunHostIdentityProblems(shortPrefixRowText)).toEqual(expect.arrayContaining([
      "explicit hostIdentity.expectedIdentity value",
      "explicit hostIdentity.observedIdentity value",
    ]));
  });

  it("requires release dry-run rows to prove candidate inputs, bundle verification, and no release-time mutations", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const weakRowText = completeRow(requirement)
      .replace("candidate_ref=abc1234567890abcdef1234567890abcdef12345, ", "")
      .replace("evidenceSignoffSha=abc1234567890abcdef1234567890abcdef12345, ", "")
      .replace("bundle verifier npm run verify:release-evidence-bundle passed; ", "")
      .replace("verify:release-evidence-bundle rerun against downloaded bundle passed; ", "")
      .replace("no GitHub release, commit, push, version bump, or publish side effect", "no GitHub release created and no publish side effect");
    const row = parseEvidenceRows(qaDoc([weakRowText]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("candidate_ref");
    expect(problem).toContain("evidenceSignoffSha");
    expect(problem).toContain("bundle verifier");
    expect(problem).toContain("downloaded.*verify:release-evidence-bundle");
    expect(problem).toContain("no (?:GitHub release, )?commit");
    expect(problem).toContain("no (?:GitHub release, commit, )?push");
    expect(problem).toContain("no (?:GitHub release, commit, push, )?version bump");
  });

  it("requires release dry-run rows to include human artifact review signoff", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const weakRowText = completeRow(requirement)
      .replace("artifact review signoff reviewer=@release-reviewer; ", "")
      .replace("artifactReviewArtifact=diveo-release-evidence-v1.0.19; ", "")
      .replace("reviewedAt=2026-06-30T22:30:00Z; ", "")
      .replace("GitHub run conclusion=success; ", "")
      .replace(`downloaded checksum-manifest SHA256=${CHECKSUM_MANIFEST_SHA}; `, "")
      .replace("verify:release-evidence-bundle rerun against downloaded bundle passed; ", "");
    const row = parseEvidenceRows(qaDoc([weakRowText]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("artifact review signoff");
    expect(problem).toContain("reviewer");
    expect(problem).toContain("artifact review artifact name or ID");
    expect(problem).toContain("reviewedAt");
    expect(problem).toContain("GitHub run conclusion");
    expect(problem).toContain("downloaded checksum-manifest");
    expect(problem).toContain("downloaded.*verify:release-evidence-bundle");
  });

  it("rejects weak release dry-run artifact review values", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const mismatchedDownloadedSha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const weakRowText = completeRow(requirement)
      .replace("artifact review signoff reviewer=@release-reviewer; ", "artifact review signoff reviewer=<reviewer>; ")
      .replace("artifactReviewArtifact=diveo-release-evidence-v1.0.19; ", "artifactReviewArtifact=<artifact>; ")
      .replace("reviewedAt=2026-06-30T22:30:00Z; ", "reviewedAt=June 30; ")
      .replace("GitHub run conclusion=success; ", "GitHub run conclusion=failure; ")
      .replace(`downloaded checksum-manifest SHA256=${CHECKSUM_MANIFEST_SHA}; `, `downloaded checksum-manifest SHA256=${mismatchedDownloadedSha}; `);
    const row = parseEvidenceRows(qaDoc([weakRowText]))[0];

    const problem = detailProblem(row, requirement, { candidate: CANDIDATE });

    expect(problem).toContain("artifact review reviewer must be concrete");
    expect(problem).toContain("artifact review artifact name or ID must be concrete");
    expect(problem).toContain("reviewedAt must be an ISO timestamp");
    expect(problem).toContain("GitHub run conclusion must be success");
    expect(problem).toContain("downloaded checksum-manifest SHA256 must match checksum-manifest SHA256");
  });

  it("requires artifact-review identity to match the named release artifact or use an artifact ID", () => {
    const requirement = requiredEvidence.find((item) => item.route === "Release workflow dry run");
    const mismatchedRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace("artifactReviewArtifact=diveo-release-evidence-v1.0.19; ", "artifactReviewArtifact=other-release-evidence-v1.0.19; "),
    ]))[0];
    const artifactIdRow = parseEvidenceRows(qaDoc([
      completeRow(requirement)
        .replace("artifactReviewArtifact=diveo-release-evidence-v1.0.19; ", "artifactReviewArtifact=123456789; "),
    ]))[0];

    expect(detailProblem(mismatchedRow, requirement, { candidate: CANDIDATE })).toContain(
      "artifactReviewArtifact must match artifact name or use artifact ID",
    );
    expect(detailProblem(artifactIdRow, requirement, { candidate: CANDIDATE })).toBeNull();
  });

  it("requires local docs/qa-evidence paths to exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-readiness-"));
    const evidencePath = "docs/qa-evidence/2026-06-30/android-home.png";

    expect(evidenceProblem(evidencePath, root)).toBe(`local evidence file missing: ${evidencePath}`);

    fs.mkdirSync(path.join(root, "docs", "qa-evidence", "2026-06-30"), { recursive: true });
    fs.writeFileSync(path.join(root, evidencePath), "screenshot placeholder");

    expect(evidenceProblem(evidencePath, root)).toBeNull();
  });

  it("requires local QA evidence files to be tracked and clean before final readiness", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-readiness-git-"));
    const qaPath = path.join(root, "docs", "GSAV_NATIVE_QA.md");
    const evidencePath = "docs/qa-evidence/2026-06-30/android-home.txt";
    fs.mkdirSync(path.dirname(qaPath), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(root, evidencePath)), { recursive: true });
    fs.writeFileSync(qaPath, qaDoc([]));
    fs.writeFileSync(path.join(root, evidencePath), "evidence\n");
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "docs/GSAV_NATIVE_QA.md", evidencePath], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "evidence"], { cwd: root, stdio: "ignore" });

    const row = parseEvidenceRows(qaDoc([
      `| 2026-06-30 | Android | Pixel 8 | https://gsav.example.com | / | Passed | ${evidencePath} | owner=@native-release |`,
    ]))[0];

    expect(evidenceIntegrityProblems({ root, rows: [row], qaPath })).toEqual([]);

    fs.appendFileSync(path.join(root, evidencePath), "mutated\n");
    fs.writeFileSync(path.join(root, "docs/qa-evidence/2026-06-30/untracked.txt"), "new\n");
    const dirtyRow = {
      ...row,
      evidencePath: `${evidencePath}; docs/qa-evidence/2026-06-30/untracked.txt`,
    };

    expect(evidenceIntegrityProblems({ root, rows: [dirtyRow], qaPath })).toEqual(expect.arrayContaining([
      "release evidence file must be tracked in git before readiness: docs/qa-evidence/2026-06-30/untracked.txt",
      expect.stringContaining("release evidence files must be committed before readiness:"),
    ]));
  });

  it("requires the audit signoff document to be tracked and clean before final readiness", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-readiness-audit-git-"));
    const qaPath = path.join(root, "docs", "GSAV_NATIVE_QA.md");
    const auditPath = path.join(root, "docs", "IMPLEMENTATION_VALIDATION_AUDIT.md");
    fs.mkdirSync(path.dirname(qaPath), { recursive: true });
    fs.writeFileSync(qaPath, qaDoc([]));
    fs.writeFileSync(auditPath, auditDoc());
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "docs/GSAV_NATIVE_QA.md", "docs/IMPLEMENTATION_VALIDATION_AUDIT.md"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "audit signoff"], { cwd: root, stdio: "ignore" });

    expect(evidenceIntegrityProblems({ root, rows: [], qaPath, auditPath })).toEqual([]);

    fs.appendFileSync(auditPath, "\nlocal uncommitted signoff edit\n");

    expect(evidenceIntegrityProblems({ root, rows: [], qaPath, auditPath })).toEqual(expect.arrayContaining([
      expect.stringContaining("release evidence files must be committed before readiness:"),
    ]));
  });

  it("requires reviewed final inventory and packet inputs to be tracked and clean before final readiness", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-readiness-final-inputs-"));
    const qaPath = path.join(root, "docs", "GSAV_NATIVE_QA.md");
    const auditPath = path.join(root, "docs", "IMPLEMENTATION_VALIDATION_AUDIT.md");
    const inventoryPath = "docs/qa-evidence/2026-06-30/external-evidence-inventory.json";
    const packetPath = "docs/qa-evidence/2026-06-30/device-evidence-packet-reviewed.json";
    fs.mkdirSync(path.dirname(qaPath), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(root, inventoryPath)), { recursive: true });
    fs.writeFileSync(qaPath, qaDoc([]));
    fs.writeFileSync(auditPath, auditDoc());
    fs.writeFileSync(path.join(root, inventoryPath), "{}\n");
    fs.writeFileSync(path.join(root, packetPath), "{}\n");
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "docs/GSAV_NATIVE_QA.md", "docs/IMPLEMENTATION_VALIDATION_AUDIT.md", inventoryPath, packetPath], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "final evidence inputs"], { cwd: root, stdio: "ignore" });

    expect(evidenceIntegrityProblems({
      root,
      rows: [],
      qaPath,
      auditPath,
      externalEvidenceInventoryPath: inventoryPath,
      devicePacketPath: packetPath,
    })).toEqual([]);

    fs.appendFileSync(path.join(root, packetPath), "dirty\n");
    const untrackedInventoryPath = "docs/qa-evidence/2026-06-30/external-evidence-inventory-untracked.json";
    fs.writeFileSync(path.join(root, untrackedInventoryPath), "{}\n");

    expect(evidenceIntegrityProblems({
      root,
      rows: [],
      qaPath,
      auditPath,
      externalEvidenceInventoryPath: untrackedInventoryPath,
      devicePacketPath: packetPath,
    })).toEqual(expect.arrayContaining([
      `release evidence file must be tracked in git before readiness: ${untrackedInventoryPath}`,
      expect.stringContaining("release evidence files must be committed before readiness:"),
    ]));
  });

  it("checks local evidence paths even when a durable URL is also present", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-readiness-"));
    const evidencePath = "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-home; docs/qa-evidence/2026-06-30/android-home.png";

    expect(evidenceProblem(evidencePath, root)).toContain("local evidence file missing");
  });

  it("rejects unsupported entries mixed with valid local evidence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-readiness-"));
    const evidencePath = "docs/qa-evidence/2026-06-30/android-home.png";
    fs.mkdirSync(path.dirname(path.join(root, evidencePath)), { recursive: true });
    fs.writeFileSync(path.join(root, evidencePath), "screenshot placeholder");

    expect(evidenceProblem(`${evidencePath}; manual note`, root)).toBe("unsupported evidence path entry: manual note");
    expect(evidenceProblem(`Android: ${evidencePath}`, root)).toBe(`unsupported evidence path entry: Android: ${evidencePath}`);
    expect(evidenceProblem(`${evidencePath}; docs/not-qa/android-home.png`, root)).toBe("unsupported evidence path entry: docs/not-qa/android-home.png");
    expect(evidenceProblem(`${evidencePath}; file:///tmp/android-home.png`, root)).toBe("unsupported evidence path entry: file:///tmp/android-home.png");
    expect(evidenceProblem(`${evidencePath}; ./docs/qa-evidence/2026-06-30/android-home.png`, root)).toBe(
      "unsupported evidence path entry: ./docs/qa-evidence/2026-06-30/android-home.png",
    );
  });

  it("rejects unsupported entries mixed with valid trusted URL evidence", () => {
    expect(evidenceProblem(
      "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-home; C:/tmp/log.txt",
    )).toBe("unsupported evidence path entry: C:/tmp/log.txt");
  });

  it("accepts markdown links whose targets are valid evidence entries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-readiness-"));
    const evidencePath = "docs/qa-evidence/2026-06-30/android-home.png";
    fs.mkdirSync(path.dirname(path.join(root, evidencePath)), { recursive: true });
    fs.writeFileSync(path.join(root, evidencePath), "screenshot placeholder");

    expect(evidenceProblem(
      `[Android](${evidencePath}); [CI](https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-home)`,
      root,
    )).toBeNull();
  });

  it("rejects arbitrary external evidence URLs", () => {
    expect(evidenceProblem("https://example.com/evidence")).toContain("trusted GitHub CI/artifact/release URL");
    expect(evidenceProblem("https://example.com/artifacts/android-home")).toContain("trusted GitHub CI/artifact/release URL");
    expect(evidenceProblem("https://github.com/other/repo/actions/runs/1/artifacts/android-home")).toContain("trusted GitHub CI/artifact/release URL");
  });

  it("rejects placeholder or generic GitHub evidence URLs", () => {
    expect(evidenceProblem("https://github.com/opsiclear/diveo/actions/runs/1/artifacts/<artifact>")).toContain(
      "evidence path contains placeholder value",
    );
    expect(evidenceProblem("https://github.com/OpsiClear-Web/diveo/releases/tag/v<version>")).toContain(
      "evidence path contains placeholder value",
    );
    expect(evidenceProblem("https://github.com/OpsiClear-Web/diveo/releases/tag/v1.0.19")).toContain(
      "release tag pages are context only and do not count as durable evidence",
    );
    expect(evidenceProblem("https://github.com/OpsiClear-Web/diveo/releases")).toContain(
      "trusted GitHub CI/artifact/release URL",
    );
  });

  it("rejects local or private external evidence artifact URLs", () => {
    expect(evidenceProblem("https://127.0.0.1/artifacts/android-home")).toContain("trusted GitHub CI/artifact/release URL");
    expect(evidenceProblem("https://[fd00::1]/artifacts/android-home")).toContain("trusted GitHub CI/artifact/release URL");
    expect(evidenceProblem("https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-home")).toBeNull();
    expect(evidenceProblem("https://github.com/OpsiClear-Web/diveo/actions/runs/1/artifacts/android-home")).toBeNull();
    expect(evidenceProblem("https://github.com/OpsiClear-Web/diveo/releases/download/v1.0.19/diveo-release.apk")).toBeNull();
    expect(evidenceProblem("https://github.com/opsiclear/diveo/releases/download/v1.0.19/diveo-release.apk")).toBeNull();
    expect(evidenceProblem("https://github.com/opsiclear/gsav-hosting/actions/runs/2/artifacts/production-runtime-smoke")).toBeNull();
  });
});
