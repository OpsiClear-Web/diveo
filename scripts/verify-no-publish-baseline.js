#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  analyzeReleaseReadiness,
  readCandidateIdentity,
} = require("./verify-release-readiness.js");
const {
  validateDeviceEvidencePacket,
} = require("./device-evidence-packet.js");

const DEFAULT_EXPECTED_CHECKED_ROWS = 30;
const DEFAULT_REQUIRED_CHECK = "quality / quality";
const DEFAULT_EXPECTED_REPOSITORY = "OpsiClear-Web/diveo";
const NO_PUBLISH_BASELINE_SCOPE = "pre-g3-no-publish-baseline";
const NO_PUBLISH_BASELINE_PHASE = "G0";
const NO_PUBLISH_BASELINE_INVALID_AFTER = "first Release APK workflow_dispatch fixed-candidate dry run";
const HANDOFF_RECEIPTS_SCHEMA_VERSION = "handoff-receipts/v1";
const DEFAULT_EXPECTED_MISSING_IDS = [
  "JS runtime smoke",
  "Android route /",
  "iOS route /",
  "Android route /search",
  "iOS route /search",
  "Android route /library",
  "iOS route /library",
  "Android route /creator/:handle",
  "iOS route /creator/:handle",
  "Android route /explore",
  "iOS route /explore",
  "Android route /gsav-diagnostics",
  "iOS route /gsav-diagnostics",
  "Android route /watch/test",
  "iOS route /watch/test",
  "Android route /gsav/test?t=2.5",
  "iOS route /gsav/test?t=2.5",
  "negative validation Missing host config",
  "negative validation Host offline/retry",
  "negative validation Cross-origin navigation",
  "negative validation Unsupported renderer",
  "negative validation Auth initialization gate",
  "negative validation Ended playback",
  "Release validation prerequisites",
  "Android release APK artifact scan",
  "Android release installed APK smoke",
  "Android generated versionCode metadata",
  "production .gsav range probe",
  "non-publishing release dry run",
];
const DEFAULT_EXPECTED_PENDING_ROWS = DEFAULT_EXPECTED_MISSING_IDS.length;
const DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS = [
  "android-adb",
  "android-java",
  "android-version-metadata-tool",
  "ios-executor-proof",
  "ios-owner",
  "ios-deviceIdentity",
  "ios-iosVersion",
  "ios-wkWebViewVersion",
  "ios-artifactUrl",
  "ios-artifactSha256",
  "ios-artifactPath",
  "production-gsav-web-url",
  "production-gsav-catalog-url",
  "production-supabase-url",
  "production-range-probe-url",
  "production-host-identity-url",
  "production-supabase-anon-key",
  "production-hosting-commit",
  "release-apk",
  "merged-manifest",
];
const ANDROID_VALIDATION_PREREQ_BLOCKER_IDS = [
  "android-adb",
  "android-adb-devices",
  "android-connected-device",
  "android-device-metadata",
  "android-webview-version",
];
const DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS = [
  "owner-assignment-receipt",
  "fixture-manifest",
  "gsav-host-ready-receipt",
];
const HANDOFF_RECEIPT_CHECKS = [
  ["ownerAssignment", "ownerReceiptPath", "owner-assignment.json"],
  ["fixtureManifest", "fixtureManifestPath", "fixture-manifest.json"],
  ["hostReady", "hostReadyPath", "gsav-host-ready.json"],
];

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const date = env.EVIDENCE_DATE || new Date().toISOString().slice(0, 10);
  const datedPathKeys = new Set([
    "branchProtectionPath",
    "publishHashGuardPath",
    "releaseStatePath",
    "devicePacketPath",
    "validationPrereqsPath",
    "handoffReceiptsPath",
  ]);
  const explicitlyProvidedDatedPaths = new Set();
  const options = {
    root: process.cwd(),
    date,
    expectedCheckedRows: DEFAULT_EXPECTED_CHECKED_ROWS,
    expectedPendingRows: DEFAULT_EXPECTED_PENDING_ROWS,
    expectedMissingIds: DEFAULT_EXPECTED_MISSING_IDS,
    requiredCheck: DEFAULT_REQUIRED_CHECK,
    expectedRepository: DEFAULT_EXPECTED_REPOSITORY,
    branchProtectionPath: `docs/qa-evidence/${date}/master-branch-protection.json`,
    publishHashGuardPath: `docs/qa-evidence/${date}/publish-hash-variable-guard.json`,
    releaseStatePath: `docs/qa-evidence/${date}/github-release-state-blocker.json`,
    devicePacketPath: `docs/qa-evidence/${date}/device-evidence-packet-scaffold.json`,
    validationPrereqsPath: `docs/qa-evidence/${date}/validation-prereqs-blocker.json`,
    handoffReceiptsPath: `docs/qa-evidence/${date}/handoff-receipts-blocker.json`,
    expectedValidationPrereqBlockerIds: DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS,
    expectedHandoffReceiptBlockerIds: DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
    candidateSha: env.RELEASE_CANDIDATE_SHA || env.RELEASE_PAYLOAD_CANDIDATE_SHA || null,
    qaPath: "docs/GSAV_NATIVE_QA.md",
    auditPath: "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
    outputPath: null,
    requireSourceEvidenceGitIntegrity: false,
  };
  const booleanOptions = new Set(["requireSourceEvidenceGitIntegrity"]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a non-empty value.`);
    if (!(key in options)) throw new Error(`Unknown option: ${arg}`);
    if (key === "expectedMissingIds" || key === "expectedValidationPrereqBlockerIds" || key === "expectedHandoffReceiptBlockerIds") {
      options[key] = value.split(",").map((entry) => entry.trim()).filter(Boolean);
    } else {
      options[key] = key === "expectedCheckedRows" || key === "expectedPendingRows" ? Number(value) : value;
    }
    if (datedPathKeys.has(key)) {
      explicitlyProvidedDatedPaths.add(key);
    }
    index += 1;
  }

  const datedPathDefaults = {
    branchProtectionPath: `docs/qa-evidence/${options.date}/master-branch-protection.json`,
    publishHashGuardPath: `docs/qa-evidence/${options.date}/publish-hash-variable-guard.json`,
    releaseStatePath: `docs/qa-evidence/${options.date}/github-release-state-blocker.json`,
    devicePacketPath: `docs/qa-evidence/${options.date}/device-evidence-packet-scaffold.json`,
    validationPrereqsPath: `docs/qa-evidence/${options.date}/validation-prereqs-blocker.json`,
    handoffReceiptsPath: `docs/qa-evidence/${options.date}/handoff-receipts-blocker.json`,
  };
  for (const [key, value] of Object.entries(datedPathDefaults)) {
    if (!explicitlyProvidedDatedPaths.has(key)) {
      options[key] = value;
    }
  }

  if (!Number.isInteger(options.expectedCheckedRows) || options.expectedCheckedRows <= 0) {
    throw new Error("--expected-checked-rows must be a positive integer.");
  }
  if (!Number.isInteger(options.expectedPendingRows) || options.expectedPendingRows < 0) {
    throw new Error("--expected-pending-rows must be a non-negative integer.");
  }
  if (options.candidateSha && !fullSha(options.candidateSha)) {
    throw new Error("--candidate-sha, RELEASE_CANDIDATE_SHA, or RELEASE_PAYLOAD_CANDIDATE_SHA must be a full 40-hex SHA.");
  }
  return options;
}

function readJson(root, relativePath, label, problems) {
  const fullPath = path.resolve(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    problems.push(`${label} could not be read from ${relativePath}: ${error.message}`);
    return null;
  }
}

function normalizeSlash(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function isIsoTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isConcreteReviewer(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  return !/^(?:<.*>|owner|reviewer|release owner|native release owner|todo|tbd)$/i.test(value.trim());
}

function fullSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

function expectedHandoffReceiptPaths(date) {
  return {
    ownerReceiptPath: `docs/qa-evidence/${date}/owner-assignment.json`,
    fixtureManifestPath: `docs/qa-evidence/${date}/fixture-manifest.json`,
    hostReadyPath: `docs/qa-evidence/${date}/gsav-host-ready.json`,
  };
}

function gitOutput(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function repoRelativePath(root, filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) return null;
  const absolutePath = path.resolve(root, filePath);
  const relativePath = path.relative(root, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }
  return normalizeSlash(relativePath);
}

function sourceEvidencePathEntries(options, { handoffReceiptsPath } = {}) {
  return [
    { label: "branch protection evidence", path: options.branchProtectionPath },
    { label: "publish hash guard evidence", path: options.publishHashGuardPath },
    { label: "release state evidence", path: options.releaseStatePath },
    { label: "device packet scaffold evidence", path: options.devicePacketPath },
    { label: "validation prerequisites blocker evidence", path: options.validationPrereqsPath },
    { label: "handoff receipts blocker evidence", path: handoffReceiptsPath ?? options.handoffReceiptsPath },
    { label: "QA evidence table", path: options.qaPath },
    { label: "validation audit", path: options.auditPath },
  ];
}

function sourceEvidenceGitIntegrityProblems({
  root = process.cwd(),
  options,
  handoffReceiptsPath = null,
} = {}) {
  const problems = [];
  const relativePaths = [];
  const entries = sourceEvidencePathEntries(options, { handoffReceiptsPath });
  for (const entry of entries) {
    const relativePath = repoRelativePath(root, entry.path);
    if (!relativePath) {
      problems.push(`${entry.label} must be inside the repository before promotion: ${entry.path}`);
      continue;
    }
    relativePaths.push(relativePath);
    try {
      gitOutput(root, ["ls-files", "--error-unmatch", "--", relativePath]);
    } catch {
      problems.push(`${entry.label} must be tracked in git before promotion: ${relativePath}`);
    }
  }

  const uniquePaths = uniqueStrings(relativePaths);
  if (uniquePaths.length === 0) return { paths: [], problems };

  try {
    const status = gitOutput(root, ["status", "--porcelain", "--untracked-files=normal", "--", ...uniquePaths]);
    if (status) {
      problems.push(`source evidence files must be committed before promotion: ${status.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(", ")}`);
    }
  } catch {
    problems.push("source evidence files must be checked in a git workspace before promotion.");
  }

  return { paths: uniquePaths, problems };
}

function finalPublishSignoffSection(text) {
  const match = /^##\s+Final Publish Signoff\s*$/im.exec(text ?? "");
  if (!match) return null;
  const start = match.index + match[0].length;
  const next = /^##\s+/im.exec((text ?? "").slice(start));
  return next ? text.slice(start, start + next.index) : text.slice(start);
}

function extractAuditDecision(sectionText) {
  const match = /(?:^|[;\n]\s*)decision\s*=\s*([^;\s]+)/i.exec(sectionText ?? "");
  return match?.[1] ?? null;
}

function validateAuditNoPublishState(auditText) {
  const problems = [];
  if (typeof auditText !== "string" || auditText.length === 0) {
    return ["audit no-publish state could not be read"];
  }
  const section = finalPublishSignoffSection(auditText);
  if (!section) {
    return ["audit no-publish baseline must include ## Final Publish Signoff section"];
  }
  const decision = extractAuditDecision(section);
  if (decision !== "no-publish") {
    problems.push("audit final signoff must record decision=no-publish while the no-publish baseline is active");
  }
  return problems;
}

function validateEvidenceProvenance(evidence, {
  label,
  date = null,
  expectedRepository = null,
  requireReview = false,
} = {}) {
  const problems = [];
  if (!evidence) return problems;
  if (!isIsoTimestamp(evidence.checkedAt)) {
    problems.push(`${label} evidence must include checkedAt ISO timestamp`);
  } else if (date && evidence.checkedAt.slice(0, 10) !== date) {
    problems.push(`${label} evidence checkedAt must match evidence date ${date}`);
  }
  if (expectedRepository && evidence.repository !== expectedRepository) {
    problems.push(`${label} evidence must be for repository ${expectedRepository}`);
  }
  if (requireReview) {
    if (!isConcreteReviewer(evidence.review?.reviewer)) {
      problems.push(`${label} evidence must include concrete review.reviewer`);
    }
    if (!isIsoTimestamp(evidence.review?.reviewedAt)) {
      problems.push(`${label} evidence must include review.reviewedAt ISO timestamp`);
    } else if (date && evidence.review.reviewedAt.slice(0, 10) !== date) {
      problems.push(`${label} evidence review.reviewedAt must match evidence date ${date}`);
    }
  }
  return problems;
}

function validateBranchProtection(evidence, { requiredCheck, date = null, expectedRepository = DEFAULT_EXPECTED_REPOSITORY } = {}) {
  const problems = [];
  if (!evidence) return problems;
  problems.push(...validateEvidenceProvenance(evidence, {
    label: "branch protection",
    date,
    expectedRepository,
    requireReview: true,
  }));
  if (evidence.ok !== true || evidence.status !== "pass") {
    problems.push("branch protection evidence must have ok=true and status=pass");
  }
  if (evidence.branch !== "master") {
    problems.push("branch protection evidence must be for master");
  }
  if (!Array.isArray(evidence.observedRequiredChecks) || !evidence.observedRequiredChecks.includes(requiredCheck)) {
    problems.push(`branch protection evidence must include required check ${requiredCheck}`);
  }
  if (evidence.releaseReadinessImpact?.status !== "ready") {
    problems.push("branch protection releaseReadinessImpact.status must be ready");
  }
  if (evidence.branchQuery?.exitCode !== 0 || evidence.branchQuery?.output?.protected !== true) {
    problems.push("branch protection evidence must include successful protected branch query");
  }
  if (evidence.protectionQuery?.exitCode !== 0) {
    problems.push("branch protection evidence must include successful branch protection query");
  }
  return problems;
}

function validatePublishHashGuard(evidence, { date = null, expectedRepository = DEFAULT_EXPECTED_REPOSITORY } = {}) {
  const problems = [];
  if (!evidence) return problems;
  problems.push(...validateEvidenceProvenance(evidence, {
    label: "publish hash guard",
    date,
    expectedRepository,
    requireReview: true,
  }));
  if (evidence.ok !== true || evidence.status !== "pass") {
    problems.push("publish hash guard must have ok=true and status=pass while no-publish");
  }
  const queries = evidence.variableQueries ?? [];
  for (const variable of [
    "EXPECTED_RELEASE_APK_SHA256",
    "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256",
  ]) {
    const query = queries.find((entry) => entry.name === variable);
    if (!query) {
      problems.push(`publish hash guard missing variable query ${variable}`);
    } else if (query.status !== "absent" || query.absent !== true) {
      problems.push(`publish hash variable must be absent before signoff: ${variable}`);
    } else if (query.unknown === true || query.exitCode !== 1) {
      problems.push(`publish hash guard must prove variable absence through a deterministic missing-variable query: ${variable}`);
    }
  }
  return problems;
}

function validateReleaseState(evidence, { date = null, expectedRepository = DEFAULT_EXPECTED_REPOSITORY } = {}) {
  const problems = [];
  if (!evidence) return problems;
  problems.push(...validateEvidenceProvenance(evidence, {
    label: "release-state",
    date,
    expectedRepository,
    requireReview: true,
  }));
  if (evidence.status !== "no-publish" || evidence.ok !== false) {
    problems.push("release-state evidence must record status=no-publish and ok=false");
  }
  if (evidence.workflowName !== "Release APK") {
    problems.push("release-state evidence must inspect the Release APK workflow");
  }
  if (evidence.releaseWorkflowPresent !== true) {
    problems.push("release-state evidence must show active Release APK workflow");
  }
  if (typeof evidence.deviceValidationWorkflowPresent !== "boolean") {
    problems.push("release-state evidence must record remote Device Validation workflow presence");
  }
  if ((evidence.releaseWorkflowDispatchRuns ?? []).length !== 0) {
    problems.push("release-state evidence must have zero Release APK workflow_dispatch runs before G3; this no-publish baseline is invalid after the first fixed-candidate dry run");
  }
  if ((evidence.releases ?? []).length !== 0 || evidence.releaseState?.noGitHubReleasesObserved !== true) {
    problems.push("release-state evidence must show zero GitHub releases");
  }
  if (evidence.releaseReadinessImpact?.status !== "no-publish") {
    problems.push("release-state releaseReadinessImpact.status must be no-publish");
  }
  for (const key of ["workflows", "releaseRuns", "workflowDispatchRuns", "releases"]) {
    if (evidence.querySummaries?.[key]?.exitCode !== 0) {
      problems.push(`release-state evidence must include successful ${key} query`);
    }
  }
  return problems;
}

function validateDevicePacket(evidence, {
  root,
  qaPath = null,
  date = null,
  expectedCandidateSha = null,
}) {
  const absoluteQaPath = qaPath ? path.resolve(root, qaPath) : null;
  const qaText = absoluteQaPath && fs.existsSync(absoluteQaPath)
    ? fs.readFileSync(absoluteQaPath, "utf8")
    : null;
  const result = validateDeviceEvidencePacket(evidence, {
    root,
    allowPending: true,
    qaText,
    expectedCandidateSha,
  });
  const problems = [...result.problems];
  if (!result.ok) return { result, problems };
  if (date && evidence?.target?.evidenceDate !== date) {
    problems.push(`device packet scaffold target.evidenceDate must match evidence date ${date}`);
  }
  if (!fullSha(evidence?.target?.releaseCandidateSha)) {
    problems.push("device packet scaffold target.releaseCandidateSha must be a full 40-hex SHA");
  }
  if (expectedCandidateSha && evidence?.target?.releaseCandidateSha !== expectedCandidateSha) {
    problems.push(`device packet scaffold target.releaseCandidateSha must match expected candidate ${String(expectedCandidateSha).slice(0, 12)}`);
  }
  if (!isIsoTimestamp(evidence?.generatedAt)) {
    problems.push("device packet scaffold must include generatedAt ISO timestamp");
  } else if (date && evidence.generatedAt.slice(0, 10) !== date) {
    problems.push(`device packet scaffold generatedAt must match evidence date ${date}`);
  }
  if (!Array.isArray(evidence?.packets)) {
    return { result, problems: ["device packet evidence must include packets"] };
  }
  const nonPending = evidence.packets.filter((packet) => packet.status !== "pending");
  if (nonPending.length > 0) {
    problems.push(`device packet scaffold must stay pending in no-publish baseline: ${nonPending.map((packet) => packet.id).join(", ")}`);
  }
  if (evidence.summary?.totalPackets !== 22 || evidence.summary?.routePackets !== 16 || evidence.summary?.negativePackets !== 6) {
    problems.push("device packet scaffold must cover 22 packets: 16 route and 6 negative");
  }
  return { result, problems };
}

function deriveExpectedAndroidValidationPrereqBlockerIds(evidence) {
  if (evidence?.checked?.commands?.adb !== true) {
    return ["android-adb"];
  }

  const android = evidence.checked?.android ?? {};
  if (android.adbDevicesOk === false) {
    return ["android-adb-devices"];
  }

  const connectedDevices = Array.isArray(android.connectedDevices)
    ? android.connectedDevices
    : [];
  if (connectedDevices.length === 0) {
    return ["android-connected-device"];
  }

  const deviceMetadata = Array.isArray(android.deviceMetadata)
    ? android.deviceMetadata
    : [];
  const completeMetadata = deviceMetadata.some((device) => device?.metadataOk === true);
  const webViewMetadata = deviceMetadata.some((device) => (
    Boolean(device?.webViewPackageName) && Boolean(device?.webViewVersion)
  ));
  const blockerIds = [];
  if (!completeMetadata) blockerIds.push("android-device-metadata");
  if (!webViewMetadata) blockerIds.push("android-webview-version");
  return blockerIds;
}

function expectedValidationPrereqBlockerIdsForEvidence(evidence, expectedValidationPrereqBlockerIds) {
  const configured = expectedValidationPrereqBlockerIds ?? [];
  const nonAndroidIds = configured.filter((id) => !ANDROID_VALIDATION_PREREQ_BLOCKER_IDS.includes(id));
  return uniqueStrings([
    ...deriveExpectedAndroidValidationPrereqBlockerIds(evidence),
    ...nonAndroidIds,
  ]);
}

function validateAndroidMetadataShape(evidence) {
  const problems = [];
  if (evidence?.checked?.commands?.adb !== true) return problems;

  const android = evidence.checked?.android ?? {};
  const connectedDevices = Array.isArray(android.connectedDevices)
    ? android.connectedDevices
    : [];
  if (android.adbDevicesOk === false || connectedDevices.length === 0) {
    return problems;
  }

  if (!Array.isArray(android.deviceMetadata)) {
    problems.push("validation-prereqs blocker with connected Android devices must include checked.android.deviceMetadata records");
    return problems;
  }

  const metadataSerials = new Set(android.deviceMetadata.map((device) => device?.serial).filter(Boolean));
  for (const serial of connectedDevices) {
    if (!metadataSerials.has(serial)) {
      problems.push(`validation-prereqs Android metadata missing record for connected device ${serial}`);
    }
  }

  for (const device of android.deviceMetadata) {
    if (!device?.serial) {
      problems.push("validation-prereqs Android metadata record must include serial");
    }
    if (typeof device?.metadataOk !== "boolean") {
      problems.push(`validation-prereqs Android metadata for ${device?.serial || "unknown device"} must include metadataOk boolean`);
    }
    if (!Array.isArray(device?.missing)) {
      problems.push(`validation-prereqs Android metadata for ${device?.serial || "unknown device"} must include missing field inventory`);
    }
  }

  return problems;
}

function validateValidationPrereqsBlocker(evidence, {
  expectedValidationPrereqBlockerIds,
  date = null,
} = {}) {
  const problems = [];
  if (!evidence) return problems;
  problems.push(...validateEvidenceProvenance(evidence, {
    label: "validation-prereqs blocker",
    date,
    requireReview: false,
  }));
  if (evidence.ok !== false || evidence.status !== "fail") {
    problems.push("validation-prereqs blocker must have ok=false and status=fail while no-publish");
  }
  if (evidence.checked?.commands?.npx !== true) {
    problems.push("validation-prereqs blocker must show npx available");
  }
  if (evidence.checked?.commands?.gh !== true) {
    problems.push("validation-prereqs blocker must show gh available");
  }
  if (evidence.checked?.ios?.artifactPath?.insideRoot !== true) {
    problems.push("validation-prereqs blocker must include iOS artifact path root-containment proof");
  }
  if (!Object.prototype.hasOwnProperty.call(evidence.checked?.ios ?? {}, "computedArtifactSha256")) {
    problems.push("validation-prereqs blocker must include computed iOS artifact SHA256 field");
  }
  if (!Object.prototype.hasOwnProperty.call(evidence.checked?.ios ?? {}, "artifactSha256Matches")) {
    problems.push("validation-prereqs blocker must include iOS artifact SHA256 match field");
  }
  problems.push(...validateAndroidMetadataShape(evidence));
  const actualIds = (evidence.blockers ?? []).map((entry) => entry.id);
  const actualSet = new Set(actualIds);
  const expectedIds = expectedValidationPrereqBlockerIdsForEvidence(evidence, expectedValidationPrereqBlockerIds);
  const absentExpected = expectedIds.filter((id) => !actualSet.has(id));
  const expectedSet = new Set(expectedIds);
  const unexpected = actualIds.filter((id) => !expectedSet.has(id));
  if (absentExpected.length > 0) {
    problems.push(`validation-prereqs blocker inventory lost expected blockers: ${absentExpected.join(", ")}`);
  }
  if (unexpected.length > 0) {
    problems.push(`validation-prereqs blocker inventory has unexpected blockers: ${unexpected.join(", ")}`);
  }
  return problems;
}

function validateHandoffReceiptsBlocker(evidence, {
  expectedHandoffReceiptBlockerIds = DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
  date = null,
} = {}) {
  const problems = [];
  if (!evidence) return problems;
  if (evidence.schemaVersion !== HANDOFF_RECEIPTS_SCHEMA_VERSION) {
    problems.push(`handoff receipts blocker must use schemaVersion=${HANDOFF_RECEIPTS_SCHEMA_VERSION}`);
  }
  if (!isIsoTimestamp(evidence.checkedAt)) {
    problems.push("handoff receipts blocker must include checkedAt ISO timestamp");
  } else if (date && evidence.checkedAt.slice(0, 10) !== date) {
    problems.push(`handoff receipts blocker checkedAt must match evidence date ${date}`);
  }
  if (date && evidence.evidenceDate !== date) {
    problems.push(`handoff receipts blocker evidenceDate must be ${date}`);
  }
  if (evidence.status !== "blocked" || evidence.ok !== false) {
    problems.push("handoff receipts blocker must record status=blocked and ok=false while no-publish");
  }
  if (evidence.allowPending !== true) {
    problems.push("handoff receipts blocker must be captured with allowPending=true");
  }
  if (date) {
    const expectedPaths = expectedHandoffReceiptPaths(date);
    if (!evidence.receiptPaths || typeof evidence.receiptPaths !== "object") {
      problems.push("handoff receipts blocker must include receiptPaths");
    } else {
      for (const [pathKey, expectedPath] of Object.entries(expectedPaths)) {
        if (normalizeSlash(evidence.receiptPaths?.[pathKey]) !== expectedPath) {
          problems.push(`handoff receipts blocker receiptPaths.${pathKey} must be ${expectedPath}`);
        }
      }
    }
    if (!evidence.checked || typeof evidence.checked !== "object") {
      problems.push("handoff receipts blocker must include checked receipt status details");
    } else {
      for (const [checkedKey, pathKey] of HANDOFF_RECEIPT_CHECKS) {
        const expectedPath = expectedPaths[pathKey];
        const checkedEntry = evidence.checked?.[checkedKey];
        if (!checkedEntry || typeof checkedEntry !== "object") {
          problems.push(`handoff receipts blocker checked.${checkedKey} must be present`);
          continue;
        }
        if (normalizeSlash(checkedEntry.path) !== expectedPath) {
          problems.push(`handoff receipts blocker checked.${checkedKey}.path must be ${expectedPath}`);
        }
        if (checkedEntry.status !== "missing") {
          problems.push(`handoff receipts blocker checked.${checkedKey}.status must be missing`);
        }
      }
    }
  }
  if (!Array.isArray(evidence.blockers)) {
    problems.push("handoff receipts blocker must include blockers");
    return problems;
  }

  const actualIds = evidence.blockers.map((entry) => entry?.id).filter(Boolean);
  const actualSet = new Set(actualIds);
  const duplicateIds = uniqueStrings(actualIds.filter((id, index) => actualIds.indexOf(id) !== index));
  const absentExpected = expectedHandoffReceiptBlockerIds.filter((id) => !actualSet.has(id));
  const expectedSet = new Set(expectedHandoffReceiptBlockerIds);
  const unexpected = actualIds.filter((id) => !expectedSet.has(id));
  if (absentExpected.length > 0) {
    problems.push(`handoff receipts blocker inventory lost expected blockers: ${absentExpected.join(", ")}`);
  }
  if (unexpected.length > 0) {
    problems.push(`handoff receipts blocker inventory has unexpected blockers: ${unexpected.join(", ")}`);
  }
  if (duplicateIds.length > 0) {
    problems.push(`handoff receipts blocker inventory has duplicate blockers: ${duplicateIds.join(", ")}`);
  }
  const invalidBlockers = evidence.blockers.filter((blocker) => blocker?.kind !== "missing");
  if (invalidBlockers.length > 0) {
    problems.push(`handoff receipts blocker inventory must be missing-only: ${invalidBlockers.map((blocker) => blocker?.id ?? "unknown").join(", ")}`);
  }
  return problems;
}

function releaseReadinessBaseline({
  root,
  qaPath,
  auditPath,
  candidateSha = null,
}) {
  const absoluteQaPath = path.resolve(root, qaPath);
  const absoluteAuditPath = path.resolve(root, auditPath);
  const qaText = fs.readFileSync(absoluteQaPath, "utf8");
  const auditText = fs.existsSync(absoluteAuditPath) ? fs.readFileSync(absoluteAuditPath, "utf8") : "";
  const candidate = candidateSha
    ? readCandidateIdentity(root, {
        env: {
          ...process.env,
          RELEASE_CANDIDATE_SHA: candidateSha,
          RELEASE_PAYLOAD_CANDIDATE_SHA: candidateSha,
        },
      })
    : readCandidateIdentity(root);
  return analyzeReleaseReadiness(qaText, {
    root,
    candidate,
    qaPath: absoluteQaPath,
    enforceEvidenceGitIntegrity: true,
    auditText,
    enforceAuditSignoff: true,
  });
}

function validateReleaseReadinessBaseline(result, {
  expectedCheckedRows,
  expectedPendingRows,
  expectedMissingIds,
}) {
  const problems = [];
  if (result.ok !== false) {
    problems.push("release readiness must fail while no-publish baseline is active");
  }
  if (result.checked !== expectedCheckedRows) {
    problems.push(`release readiness checked ${result.checked}, expected ${expectedCheckedRows}`);
  }
  if ((result.missing ?? []).length !== expectedPendingRows) {
    problems.push(`release readiness missing ${result.missing?.length ?? 0}, expected ${expectedPendingRows}`);
  }
  if (Array.isArray(expectedMissingIds) && expectedMissingIds.length > 0) {
    const actualIds = (result.missing ?? []).map((entry) => entry.id);
    const actualSet = new Set(actualIds);
    const expectedSet = new Set(expectedMissingIds);
    const absentExpected = expectedMissingIds.filter((id) => !actualSet.has(id));
    const unexpected = actualIds.filter((id) => !expectedSet.has(id));
    if (absentExpected.length > 0) {
      problems.push(`release readiness missing inventory lost expected rows: ${absentExpected.join(", ")}`);
    }
    if (unexpected.length > 0) {
      problems.push(`release readiness missing inventory has unexpected rows: ${unexpected.join(", ")}`);
    }
  }
  return problems;
}

function verifyNoPublishBaseline(options) {
  const root = path.resolve(options.root);
  const problems = [];
  const handoffReceiptsPath = options.handoffReceiptsPath
    ?? `docs/qa-evidence/${options.date}/handoff-receipts-blocker.json`;
  const expectedHandoffReceiptBlockerIds = options.expectedHandoffReceiptBlockerIds
    ?? DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS;
  if (options.candidateSha && !fullSha(options.candidateSha)) {
    problems.push("candidateSha must be a full 40-hex SHA when supplied");
  }
  const branchProtection = readJson(root, options.branchProtectionPath, "branch protection evidence", problems);
  const publishHashGuard = readJson(root, options.publishHashGuardPath, "publish hash guard evidence", problems);
  const releaseState = readJson(root, options.releaseStatePath, "release state evidence", problems);
  const devicePacket = readJson(root, options.devicePacketPath, "device packet evidence", problems);
  const validationPrereqs = readJson(root, options.validationPrereqsPath, "validation prerequisites blocker evidence", problems);
  const handoffReceipts = readJson(root, handoffReceiptsPath, "handoff receipts blocker evidence", problems);
  const auditPath = path.resolve(root, options.auditPath);
  const auditText = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf8") : "";
  const sourceEvidenceGitIntegrity = options.requireSourceEvidenceGitIntegrity === true
    ? sourceEvidenceGitIntegrityProblems({ root, options, handoffReceiptsPath })
    : { paths: [], problems: [] };

  problems.push(...validateBranchProtection(branchProtection, options));
  problems.push(...validatePublishHashGuard(publishHashGuard, options));
  problems.push(...validateReleaseState(releaseState, options));
  problems.push(...validateValidationPrereqsBlocker(validationPrereqs, options));
  problems.push(...validateHandoffReceiptsBlocker(handoffReceipts, {
    ...options,
    expectedHandoffReceiptBlockerIds,
  }));
  problems.push(...validateAuditNoPublishState(auditText));
  problems.push(...sourceEvidenceGitIntegrity.problems);
  const devicePacketValidation = validateDevicePacket(devicePacket, {
    root,
    qaPath: options.qaPath,
    date: options.date,
    expectedCandidateSha: options.candidateSha,
  });
  problems.push(...devicePacketValidation.problems);

  let readiness = null;
  try {
    readiness = releaseReadinessBaseline({
      root,
      qaPath: options.qaPath,
      auditPath: options.auditPath,
      candidateSha: options.candidateSha,
    });
    problems.push(...validateReleaseReadinessBaseline(readiness, options));
  } catch (error) {
    problems.push(`release readiness baseline could not be analyzed: ${error.message}`);
  }

  return {
    checkedAt: new Date().toISOString(),
    scope: NO_PUBLISH_BASELINE_SCOPE,
    lifecycle: {
      phase: NO_PUBLISH_BASELINE_PHASE,
      validBefore: "G3 non-publishing release dry run",
      invalidAfter: NO_PUBLISH_BASELINE_INVALID_AFTER,
      replacementAfterInvalidation: "candidate-pinned release-readiness expected-fail plus G3-G7 evidence-specific verification",
    },
    status: problems.length === 0 ? "pass" : "fail",
    ok: problems.length === 0,
    root: normalizeSlash(root),
    evidence: {
      branchProtectionPath: normalizeSlash(options.branchProtectionPath),
      publishHashGuardPath: normalizeSlash(options.publishHashGuardPath),
      releaseStatePath: normalizeSlash(options.releaseStatePath),
      devicePacketPath: normalizeSlash(options.devicePacketPath),
      validationPrereqsPath: normalizeSlash(options.validationPrereqsPath),
      handoffReceiptsPath: normalizeSlash(handoffReceiptsPath),
    },
    sourceEvidence: {
      evidenceDate: options.date,
      expectedRepository: options.expectedRepository ?? DEFAULT_EXPECTED_REPOSITORY,
      branchProtectionCheckedAt: branchProtection?.checkedAt ?? null,
      branchProtectionReviewer: branchProtection?.review?.reviewer ?? null,
      branchProtectionReviewedAt: branchProtection?.review?.reviewedAt ?? null,
      publishHashGuardCheckedAt: publishHashGuard?.checkedAt ?? null,
      publishHashGuardReviewer: publishHashGuard?.review?.reviewer ?? null,
      publishHashGuardReviewedAt: publishHashGuard?.review?.reviewedAt ?? null,
      releaseStateCheckedAt: releaseState?.checkedAt ?? null,
      releaseStateReviewer: releaseState?.review?.reviewer ?? null,
      releaseStateReviewedAt: releaseState?.review?.reviewedAt ?? null,
      releaseStateDeviceValidationWorkflowPresent: releaseState?.deviceValidationWorkflowPresent ?? null,
      devicePacketGeneratedAt: devicePacket?.generatedAt ?? null,
      devicePacketEvidenceDate: devicePacket?.target?.evidenceDate ?? null,
      devicePacketReleaseCandidateSha: devicePacket?.target?.releaseCandidateSha ?? null,
      expectedCandidateSha: options.candidateSha ?? null,
      validationPrereqsCheckedAt: validationPrereqs?.checkedAt ?? null,
      handoffReceiptsCheckedAt: handoffReceipts?.checkedAt ?? null,
      handoffReceiptsEvidenceDate: handoffReceipts?.evidenceDate ?? null,
      gitIntegrityRequired: options.requireSourceEvidenceGitIntegrity === true,
      gitIntegrityPaths: sourceEvidenceGitIntegrity.paths,
    },
    releaseReadiness: readiness
      ? {
        ok: readiness.ok,
        checked: readiness.checked,
        missing: readiness.missing.length,
        missingIds: readiness.missing.map((entry) => entry.id),
        expectedMissingIds: options.expectedMissingIds,
      }
      : null,
    devicePacket: {
      ok: devicePacketValidation.result.ok,
      checkedPackets: devicePacketValidation.result.checkedPackets,
      pendingPackets: Array.isArray(devicePacket?.packets)
        ? devicePacket.packets.filter((packet) => packet.status === "pending").length
        : null,
    },
    validationPrereqs: {
      ok: validationPrereqs?.ok ?? null,
      status: validationPrereqs?.status ?? null,
      blockerIds: (validationPrereqs?.blockers ?? []).map((entry) => entry.id),
      expectedBlockerIds: expectedValidationPrereqBlockerIdsForEvidence(
        validationPrereqs,
        options.expectedValidationPrereqBlockerIds,
      ),
    },
    handoffReceipts: {
      ok: handoffReceipts?.ok ?? null,
      status: handoffReceipts?.status ?? null,
      allowPending: handoffReceipts?.allowPending ?? null,
      blockerIds: (handoffReceipts?.blockers ?? []).map((entry) => entry.id),
      expectedBlockerIds: expectedHandoffReceiptBlockerIds,
      receiptPaths: handoffReceipts?.receiptPaths ?? null,
      expectedReceiptPaths: expectedHandoffReceiptPaths(options.date),
      checked: handoffReceipts?.checked ?? null,
    },
    controls: {
      branchProtectionReady: branchProtection?.releaseReadinessImpact?.status === "ready",
      publishHashVariablesAbsent: publishHashGuard?.ok === true,
      releaseStateNoPublish: releaseState?.releaseReadinessImpact?.status === "no-publish",
      validationPrereqsBlocked: validationPrereqs?.ok === false && validationPrereqs?.status === "fail",
      handoffReceiptsBlocked: handoffReceipts?.ok === false
        && handoffReceipts?.status === "blocked"
        && handoffReceipts?.allowPending === true,
    },
    problems,
  };
}

function writeResult(options, result) {
  if (!options.outputPath) return;
  const outputPath = path.resolve(options.root, options.outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

function main() {
  try {
    const options = parseArgs();
    const result = verifyNoPublishBaseline(options);
    writeResult(options, result);
    console.log(JSON.stringify({
      ...result,
      outputPath: options.outputPath ? normalizeSlash(options.outputPath) : null,
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ANDROID_VALIDATION_PREREQ_BLOCKER_IDS,
  DEFAULT_EXPECTED_CHECKED_ROWS,
  DEFAULT_EXPECTED_MISSING_IDS,
  DEFAULT_EXPECTED_PENDING_ROWS,
  DEFAULT_EXPECTED_REPOSITORY,
  DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
  DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS,
  HANDOFF_RECEIPTS_SCHEMA_VERSION,
  HANDOFF_RECEIPT_CHECKS,
  NO_PUBLISH_BASELINE_INVALID_AFTER,
  NO_PUBLISH_BASELINE_PHASE,
  NO_PUBLISH_BASELINE_SCOPE,
  deriveExpectedAndroidValidationPrereqBlockerIds,
  expectedValidationPrereqBlockerIdsForEvidence,
  expectedHandoffReceiptPaths,
  parseArgs,
  releaseReadinessBaseline,
  sourceEvidenceGitIntegrityProblems,
  sourceEvidencePathEntries,
  validateAuditNoPublishState,
  validateEvidenceProvenance,
  validateBranchProtection,
  validateAndroidMetadataShape,
  validateDevicePacket,
  validatePublishHashGuard,
  validateReleaseReadinessBaseline,
  validateReleaseState,
  validateHandoffReceiptsBlocker,
  validateValidationPrereqsBlocker,
  verifyNoPublishBaseline,
};
