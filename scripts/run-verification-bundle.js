#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createEvidenceMetadata } = require("./evidence-metadata");
const { requiredEvidence: RELEASE_READINESS_REQUIRED_EVIDENCE } = require("./verify-release-readiness");
const {
  DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
  DEFAULT_EXPECTED_MISSING_IDS: EXPECTED_NO_PUBLISH_MISSING_IDS,
  DEFAULT_EXPECTED_PENDING_ROWS: EXPECTED_NO_PUBLISH_PENDING_ROWS,
  HANDOFF_RECEIPT_CHECKS,
  NO_PUBLISH_BASELINE_INVALID_AFTER,
  NO_PUBLISH_BASELINE_PHASE,
  NO_PUBLISH_BASELINE_SCOPE,
  expectedHandoffReceiptPaths,
} = require("./verify-no-publish-baseline");

const PRODUCTION_ENV_KEYS = [
  "EXPO_PUBLIC_GSAV_WEB_URL",
  "EXPO_PUBLIC_GSAV_CATALOG_URL",
  "EXPO_PUBLIC_GSAV_SUPABASE_URL",
  "EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY",
];

const QA_ONLY_ENV_KEYS = [
  "EXPO_PUBLIC_GSAV_QA_CONTROLS",
  "EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS",
];
const COVERAGE_STEP_LABEL = "Coverage";
const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_EVIDENCE_ENV_KEYS = new Set([
  "DEVICE_EVIDENCE_PACKET_PATH",
  "EVIDENCE_DATE",
  "EVIDENCE_SIGNOFF_SHA",
  "EXTERNAL_EVIDENCE_INVENTORY_PATH",
  "FINAL_READINESS_RECEIPT_BOOTSTRAP",
  "RELEASE_CANDIDATE_SHA",
  "RELEASE_PAYLOAD_CANDIDATE_SHA",
]);
const EXPECTED_RELEASE_READINESS_CHECKED = RELEASE_READINESS_REQUIRED_EVIDENCE.length;
const EXPECTED_NO_PUBLISH_DEVICE_PENDING_PACKETS = 22;
const EXPECTED_RELEASE_READINESS_ROUTES = new Set(
  RELEASE_READINESS_REQUIRED_EVIDENCE.map((requirement) => requirement.route),
);
const EXPECTED_NO_PUBLISH_MISSING_ROWS = EXPECTED_NO_PUBLISH_MISSING_IDS
  .map((id) => RELEASE_READINESS_REQUIRED_EVIDENCE.find((requirement) => requirement.id === id))
  .filter(Boolean);
const EXPECTED_NO_PUBLISH_MISSING_ID_SET = new Set(EXPECTED_NO_PUBLISH_MISSING_IDS);
const EXPECTED_HANDOFF_BLOCKER_IDS = DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS;
const EXPECTED_HANDOFF_BLOCKER_ID_SET = new Set(EXPECTED_HANDOFF_BLOCKER_IDS);
const HANDOFF_RECEIPT_CHECK_TO_BLOCKER_ID = {
  ownerAssignment: "owner-assignment-receipt",
  fixtureManifest: "fixture-manifest",
  hostReady: "gsav-host-ready-receipt",
};

const PLACEHOLDER_PRODUCTION_ENV = {
  EXPO_PUBLIC_GSAV_WEB_URL: "https://gsav.example.com",
  EXPO_PUBLIC_GSAV_CATALOG_URL: "https://gsav.example.com/functions/v1/catalog",
  EXPO_PUBLIC_GSAV_SUPABASE_URL: "https://supabase.example.com",
  EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: "public-anon-key",
  EXPO_PUBLIC_GSAV_QA_CONTROLS: "0",
  EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "0",
};

const RELEASE_FOCUSED_TESTS = [
  "scripts/gsav-native-preflight.test.mjs",
  "scripts/gsav-native-runtime-smoke.test.mjs",
  "scripts/bump-version.test.mjs",
  "scripts/capture-android-installed-smoke.test.mjs",
  "scripts/capture-android-version-metadata.test.mjs",
  "scripts/attach-validation-prereqs-to-release-evidence.test.mjs",
  "scripts/verify-native-production-config.test.mjs",
  "scripts/verify-workflows.test.mjs",
  "scripts/verify-validation-prereqs.test.mjs",
  "scripts/materialize-ios-validation-artifact.test.mjs",
  "scripts/verify-release-artifact.test.mjs",
  "scripts/verify-release-evidence-bundle.test.mjs",
  "scripts/write-release-evidence-summary.test.mjs",
  "scripts/capture-branch-protection-evidence.test.mjs",
  "scripts/capture-github-release-state-evidence.test.mjs",
  "scripts/capture-publish-hash-variable-guard.test.mjs",
  "scripts/device-evidence-packet.test.mjs",
  "scripts/verify-handoff-receipts.test.mjs",
  "scripts/verify-no-publish-baseline.test.mjs",
  "scripts/verify-external-evidence-inventory.test.mjs",
  "scripts/run-final-readiness-receipts.test.mjs",
  "scripts/verify-dependency-audit.test.mjs",
  "scripts/verify-env-examples.test.mjs",
  "scripts/verify-release-readiness.test.mjs",
  "scripts/verify-doc-drift.test.mjs",
  "scripts/verify-import-boundaries.test.mjs",
  "scripts/verify-bridge-origin-contract.test.mjs",
  "scripts/verify-whitespace.test.mjs",
];

const LOCAL_STEPS = [
  { label: "Type-check", command: "node", args: ["node_modules/typescript/bin/tsc", "--noEmit"] },
  {
    label: "Lint",
    command: "node",
    args: ["node_modules/eslint/bin/eslint.js", "app", "features", "shared", "services", "utils", "scripts", "vitest.config.mjs", "--max-warnings", "0"],
  },
  { label: "Dependency audit disposition", command: "node", args: ["scripts/verify-dependency-audit.js"] },
  { label: "Environment example audit", command: "node", args: ["scripts/verify-env-examples.js"] },
  { label: "Workflow audit", command: "node", args: ["scripts/verify-workflows.js"] },
  { label: "Import boundary audit", command: "node", args: ["scripts/verify-import-boundaries.js"] },
  { label: "Bridge origin contract audit", command: "node", args: ["scripts/verify-bridge-origin-contract.js"] },
  { label: "Documentation drift audit", command: "node", args: ["scripts/verify-doc-drift.js"] },
  { label: "Unit tests", command: "node", args: ["node_modules/vitest/vitest.mjs", "run"] },
  { label: "Coverage", command: "node", args: ["node_modules/vitest/vitest.mjs", "run", "--coverage"] },
  { label: "Whitespace check", command: "node", args: ["scripts/verify-whitespace.js"] },
];

const RELEASE_CANDIDATE_EXTRA_STEPS = [
  {
    label: "Native production config negative",
    command: "node",
    args: ["scripts/verify-native-production-config.js"],
    expectedStatus: 1,
    expectedOutputIncludes: [
      '"status": "fail"',
      "Production must provide EXPO_PUBLIC_GSAV_WEB_URL",
      "Production must provide EXPO_PUBLIC_GSAV_CATALOG_URL",
      "Production must provide EXPO_PUBLIC_GSAV_SUPABASE_URL",
      "Production must provide EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY",
      '"qualityVerifiesLocalBundle": true',
    ],
    expectedJson: "native-production-config-missing-env",
    envMode: "without-production-config",
  },
  {
    label: "Native production config positive",
    command: "node",
    args: ["scripts/verify-native-production-config.js"],
    expectedOutputIncludes: [
      '"status": "pass"',
      '"gsavUrl": "https://gsav.example.com"',
      '"capturesGeneratedApkMetadata": true',
      '"capturesGsavHostIdentity": true',
      '"verifiesReleaseEvidenceMode": true',
      '"resolvesFrozenPayloadCandidate": true',
      '"verifiesEvidenceSignoffDiff": true',
      '"verifiesSignoffDiffBundleContents": true',
      '"hasReleaseVersionBumpInWorkflow": false',
      '"releaseWorkflowForbidsQaFlags": true',
      '"qaControlsDisabled": true',
      '"qaAuthDelayDisabled": true',
      '"qualityVerifiesLocalBundle": true',
    ],
    envMode: "placeholder-production-config",
  },
  {
    label: "Focused release verifier tests",
    command: "node",
    args: ["node_modules/vitest/vitest.mjs", "run", ...RELEASE_FOCUSED_TESTS],
  },
  {
    label: "Handoff receipts expected blockers",
    command: "node",
    args: ["scripts/verify-handoff-receipts.js", "--allow-pending"],
    expectedOutputIncludes: [
      '"schemaVersion": "handoff-receipts/v1"',
    ],
    expectedJson: "handoff-receipts",
  },
  {
    label: "No-publish baseline verifier",
    command: "node",
    args: ["scripts/verify-no-publish-baseline.js"],
    expectedOutputIncludes: [
      '"status": "pass"',
      `"scope": "${NO_PUBLISH_BASELINE_SCOPE}"`,
      '"validationPrereqsBlocked": true',
      '"handoffReceiptsBlocked": true',
    ],
    expectedJson: "no-publish-baseline",
  },
  {
    label: "Release readiness expected blockers",
    command: "node",
    args: ["scripts/verify-release-readiness.js"],
    expectedStatus: 1,
    expectedOutputIncludes: [
      '"status": "fail"',
    ],
    expectedJson: "release-readiness-pending-evidence",
  },
];

function usage() {
  return "Usage: node scripts/run-verification-bundle.js [local|release-candidate] [--evidence-dir <dir>] [--candidate-sha <40-hex-sha>] [--date <YYYY-MM-DD>]";
}

function parseArgs(argv = process.argv.slice(2)) {
  const positional = [];
  let evidenceDir = null;
  let candidateSha = null;
  let evidenceDate = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--evidence-dir") {
      evidenceDir = argv[index + 1] ?? null;
      index += 1;
      if (!evidenceDir) {
        throw new Error(usage());
      }
    } else if (arg === "--candidate-sha" || arg === "--release-candidate-sha") {
      candidateSha = argv[index + 1] ?? null;
      index += 1;
      if (!candidateSha) {
        throw new Error(usage());
      }
      if (!FULL_COMMIT_SHA_PATTERN.test(candidateSha)) {
        throw new Error("candidate SHA must be a full 40-hex commit SHA");
      }
    } else if (arg === "--date" || arg === "--evidence-date") {
      evidenceDate = argv[index + 1] ?? null;
      index += 1;
      if (!evidenceDate) {
        throw new Error(usage());
      }
      if (!validEvidenceDate(evidenceDate)) {
        throw new Error("--date must be YYYY-MM-DD");
      }
    } else if (arg.startsWith("--")) {
      throw new Error(usage());
    } else {
      positional.push(arg);
    }
  }

  const mode = positional[0] ?? "local";
  if (positional.length > 1 || !["local", "release-candidate"].includes(mode)) {
    throw new Error(usage());
  }
  if (candidateSha && mode !== "release-candidate") {
    throw new Error("--candidate-sha is only valid for release-candidate mode");
  }
  if (evidenceDate && mode !== "release-candidate") {
    throw new Error("--date is only valid for release-candidate mode");
  }
  return { mode, evidenceDir, candidateSha, evidenceDate };
}

function commandName(command) {
  return command;
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:=@\\-]+$/.test(value)) return value;
  return `"${value.replace(/(["^&|<>])/g, "^$1")}"`;
}

function commandLine(command, args) {
  return [command, ...args].map(quoteShellArg).join(" ");
}

function safeRunLabel(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "verification";
}

function createCoverageReportsDirectory({ mode = "local", now = new Date(), pid = process.pid } = {}) {
  const timestamp = now.toISOString().replace(/[^0-9A-Za-z]+/g, "");
  const nonce = crypto.randomBytes(4).toString("hex");
  return path.join(os.tmpdir(), "diveo-vitest-coverage", `${safeRunLabel(mode)}-${pid}-${timestamp}-${nonce}`);
}

function stepWithRuntimeArgs(step, { coverageReportsDirectory = null } = {}) {
  if (step.label !== COVERAGE_STEP_LABEL || !coverageReportsDirectory) return step;
  return {
    ...step,
    args: [...step.args, "--coverage.reportsDirectory", coverageReportsDirectory],
  };
}

function outputText(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function streamText(value) {
  if (value == null) return "";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEvidenceName(index, label, suffix) {
  const safeLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${String(index + 1).padStart(2, "0")}-${safeLabel || "step"}.${suffix}`;
}

function evidenceEnvForStep(step) {
  const stepEnv = step.env ?? {};
  const entries = Object.entries(stepEnv)
    .filter(([key, value]) => SAFE_EVIDENCE_ENV_KEYS.has(key) && typeof value === "string" && value.length > 0);
  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

function writeStepEvidence({ evidenceDir, step, index, result, startedAt, finishedAt }) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const stdout = streamText(result.stdout);
  const stderr = streamText(result.stderr);
  const stdoutPath = safeEvidenceName(index, step.label, "stdout.log");
  const stderrPath = safeEvidenceName(index, step.label, "stderr.log");
  fs.writeFileSync(path.join(evidenceDir, stdoutPath), stdout);
  fs.writeFileSync(path.join(evidenceDir, stderrPath), stderr);
  const evidenceEnv = evidenceEnvForStep(step);
  return {
    index: index + 1,
    label: step.label,
    command: commandLine(step.command, step.args),
    ...(evidenceEnv ? { env: evidenceEnv } : {}),
    expectedStatus: step.expectedStatus ?? 0,
    status: typeof result.status === "number" ? result.status : 1,
    startedAt,
    finishedAt,
    stdoutPath,
    stderrPath,
    stdoutSha256: sha256Text(stdout),
    stderrSha256: sha256Text(stderr),
    combinedSha256: sha256Text(`${stdout}${stderr}`),
    error: result.error?.message ?? null,
  };
}

function writeEvidenceSummary(evidenceDir, summary) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceDir, "verification-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
}

function cleanupGeneratedEvidenceFiles(evidenceDir) {
  if (!evidenceDir) return;
  fs.mkdirSync(evidenceDir, { recursive: true });
  const generatedEvidencePattern = /^\d{2}-[a-z0-9-]+\.(stdout|stderr)\.log$/;
  for (const entry of fs.readdirSync(evidenceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name === "verification-summary.json" || generatedEvidencePattern.test(entry.name)) {
      fs.unlinkSync(path.join(evidenceDir, entry.name));
    }
  }
}

function acquireEvidenceDirLock(evidenceDir, { pid = process.pid, now = new Date() } = {}) {
  if (!evidenceDir) return () => {};
  fs.mkdirSync(evidenceDir, { recursive: true });
  const lockPath = path.join(evidenceDir, ".verification-bundle.lock");
  let fd;
  try {
    fd = fs.openSync(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Evidence directory is already in use: ${evidenceDir}`);
    }
    throw error;
  }
  fs.writeFileSync(fd, `${JSON.stringify({
    pid,
    createdAt: now.toISOString(),
  }, null, 2)}\n`);
  fs.closeSync(fd);

  return () => {
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  };
}

function parseJsonFromOutput(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("output does not contain a JSON object");
  }
  return JSON.parse(text.slice(start, end + 1));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSlash(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function validEvidenceDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nativeProductionConfigMissingEnvProblems(json) {
  const problems = [];
  const expectedErrors = PRODUCTION_ENV_KEYS.map((key) => (
    `Production must provide ${key} in the environment or EAS production profile.`
  ));
  const errors = Array.isArray(json.errors) ? json.errors : [];

  if (json.status !== "fail" || json.ok !== false) {
    problems.push("native production config negative must report status=fail and ok=false");
  }
  for (const expected of expectedErrors) {
    if (!errors.includes(expected)) {
      problems.push(`missing expected production config error: ${expected}`);
    }
  }
  const unexpectedErrors = errors.filter((error) => !expectedErrors.includes(error));
  if (unexpectedErrors.length > 0) {
    problems.push(`unexpected production config errors: ${unexpectedErrors.join("; ")}`);
  }
  if (json.checked?.qualityVerifiesLocalBundle !== true) {
    problems.push("native production config negative must report qualityVerifiesLocalBundle=true");
  }

  return problems;
}

function expectedJsonProblems(step, text) {
  if (!step.expectedJson) return [];

  let json;
  try {
    json = parseJsonFromOutput(text);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }

  if (step.expectedJson === "native-production-config-missing-env") {
    return nativeProductionConfigMissingEnvProblems(json);
  }
  if (step.expectedJson === "release-readiness-pending-evidence") {
    return releaseReadinessPendingEvidenceProblems(json);
  }
  if (step.expectedJson === "no-publish-baseline") {
    return noPublishBaselineProblems(json, step);
  }
  if (step.expectedJson === "handoff-receipts") {
    return handoffReceiptProblems(json, step);
  }

  return [`unknown expected JSON validator: ${step.expectedJson}`];
}

function handoffReceiptProblems(json, step = {}) {
  const expectedEvidenceDate = step.env?.EVIDENCE_DATE ?? null;
  const problems = [];
  if (json.schemaVersion !== "handoff-receipts/v1") {
    problems.push("handoff receipts verifier must report schemaVersion=handoff-receipts/v1");
  }
  if (json.status === "pass") {
    if (json.ok !== true) problems.push("passing handoff receipts must report ok=true");
    if (Array.isArray(json.blockers) && json.blockers.length > 0) {
      problems.push("passing handoff receipts must not report blockers");
    }
    problems.push(...handoffReceiptDetailProblems(json, [], { expectedEvidenceDate }));
    return problems;
  }
  if (json.status !== "blocked" || json.ok !== false) {
    problems.push("handoff receipts verifier must report status=pass or status=blocked with ok=false");
  }
  if (json.allowPending !== true) {
    problems.push("handoff receipts expected blocker step must run with allowPending=true");
  }
  if (!Array.isArray(json.blockers)) {
    problems.push("handoff receipts expected blocker step must report blockers as an array");
    return problems;
  }
  if (json.blockers.length === 0) {
    problems.push("blocked handoff receipts must report at least one blocker");
  }
  const ids = json.blockers.map((blocker) => blocker?.id).filter(Boolean);
  const unexpectedIds = ids.filter((id) => !EXPECTED_HANDOFF_BLOCKER_ID_SET.has(id));
  const duplicateIds = Array.from(new Set(ids.filter((id, index) => ids.indexOf(id) !== index)));
  if (unexpectedIds.length > 0) {
    problems.push(`handoff receipts reported unexpected blockers: ${unexpectedIds.join(", ")}`);
  }
  if (duplicateIds.length > 0) {
    problems.push(`handoff receipts reported duplicate blockers: ${duplicateIds.join(", ")}`);
  }
  const invalidBlockers = json.blockers.filter((blocker) => blocker?.kind !== "missing");
  if (invalidBlockers.length > 0) {
    problems.push(`handoff receipts blockers must be missing-only in pending mode: ${invalidBlockers.map((blocker) => blocker?.id ?? "unknown").join(", ")}`);
  }
  const missingExpected = EXPECTED_HANDOFF_BLOCKER_IDS.filter((id) => !ids.includes(id));
  if (ids.length > 0 && missingExpected.length === EXPECTED_HANDOFF_BLOCKER_IDS.length) {
    problems.push("handoff receipts blocked output did not include any expected blocker ids");
  }
  problems.push(...handoffReceiptDetailProblems(json, ids, { expectedEvidenceDate }));
  return problems;
}

function handoffReceiptDetailProblems(json, blockerIds, { expectedEvidenceDate = null } = {}) {
  const problems = [];
  if (!validEvidenceDate(json.evidenceDate)) {
    problems.push("handoff receipts verifier must report evidenceDate");
    return problems;
  }
  if (expectedEvidenceDate && json.evidenceDate !== expectedEvidenceDate) {
    problems.push(`handoff receipts verifier must report evidenceDate=${expectedEvidenceDate}`);
  }
  const expectedPaths = expectedHandoffReceiptPaths(json.evidenceDate);
  if (!isPlainObject(json.receiptPaths)) {
    problems.push("handoff receipts verifier must report receiptPaths");
  } else {
    for (const [pathKey, expectedPath] of Object.entries(expectedPaths)) {
      if (normalizeSlash(json.receiptPaths?.[pathKey]) !== expectedPath) {
        problems.push(`handoff receipts receiptPaths.${pathKey} must be ${expectedPath}`);
      }
    }
  }
  if (!isPlainObject(json.checked)) {
    problems.push("handoff receipts verifier must report checked receipt status details");
  } else {
    for (const [checkedKey, pathKey] of HANDOFF_RECEIPT_CHECKS) {
      const expectedPath = expectedPaths[pathKey];
      const checkedEntry = json.checked?.[checkedKey];
      const blockerId = HANDOFF_RECEIPT_CHECK_TO_BLOCKER_ID[checkedKey];
      const expectedStatus = blockerIds.includes(blockerId) ? "missing" : "pass";
      if (!isPlainObject(checkedEntry)) {
        problems.push(`handoff receipts checked.${checkedKey} must be present`);
        continue;
      }
      if (normalizeSlash(checkedEntry.path) !== expectedPath) {
        problems.push(`handoff receipts checked.${checkedKey}.path must be ${expectedPath}`);
      }
      if (checkedEntry.status !== expectedStatus) {
        problems.push(`handoff receipts checked.${checkedKey}.status must be ${expectedStatus}`);
      }
    }
  }
  if (Array.isArray(json.blockers)) {
    for (const blocker of json.blockers) {
      const checkedKey = Object.entries(HANDOFF_RECEIPT_CHECK_TO_BLOCKER_ID)
        .find(([, blockerId]) => blockerId === blocker?.id)?.[0];
      const pathKey = HANDOFF_RECEIPT_CHECKS.find(([key]) => key === checkedKey)?.[1];
      if (pathKey && normalizeSlash(blocker.path) !== expectedPaths[pathKey]) {
        problems.push(`handoff receipts blocker ${blocker.id} path must be ${expectedPaths[pathKey]}`);
      }
    }
  }
  return problems;
}

function releaseReadinessPendingEvidenceProblems(json) {
  const problems = [];
  if (json.status !== "fail" || json.ok !== false) {
    problems.push("release readiness expected blocker must report status=fail and ok=false");
  }
  if (!Number.isInteger(json.checked) || json.checked <= 0) {
    problems.push(`release readiness expected blocker must report a positive checked row count, got ${json.checked}`);
  } else if (json.checked !== EXPECTED_RELEASE_READINESS_CHECKED) {
    problems.push(`release readiness expected blocker must report ${EXPECTED_RELEASE_READINESS_CHECKED} checked rows, got ${json.checked}`);
  }
  if (!Array.isArray(json.missing)) {
    problems.push("release readiness expected blocker must report missing rows as an array");
  } else if (json.missing.length !== EXPECTED_NO_PUBLISH_PENDING_ROWS) {
    problems.push(`release readiness expected blocker must report ${EXPECTED_NO_PUBLISH_PENDING_ROWS} pending publish rows, got ${json.missing.length}`);
  }
  if (Array.isArray(json.missing) && json.missing.some((item) => !item || typeof item.route !== "string" || !item.route.trim())) {
    problems.push("release readiness expected blocker must include route names for missing rows");
  }
  if (Array.isArray(json.missing) && json.missing.some((item) => !item || typeof item.id !== "string" || !item.id.trim())) {
    problems.push("release readiness expected blocker must include row ids for missing rows");
  }
  const unknownRoutes = Array.isArray(json.missing)
    ? Array.from(new Set(
        json.missing
          .map((item) => item?.route)
          .filter((route) => typeof route === "string" && route.trim() && !EXPECTED_RELEASE_READINESS_ROUTES.has(route)),
      ))
    : [];
  if (unknownRoutes.length > 0) {
    problems.push(`release readiness expected blocker reported unknown missing rows: ${unknownRoutes.join(", ")}`);
  }
  const actualIds = Array.isArray(json.missing)
    ? json.missing.map((item) => item?.id).filter((id) => typeof id === "string" && id.trim())
    : [];
  const absentExpected = EXPECTED_NO_PUBLISH_MISSING_IDS.filter((id) => !actualIds.includes(id));
  const unexpectedIds = actualIds.filter((id) => !EXPECTED_NO_PUBLISH_MISSING_ID_SET.has(id));
  if (absentExpected.length > 0) {
    problems.push(`release readiness expected blocker lost expected missing rows: ${absentExpected.join(", ")}`);
  }
  if (unexpectedIds.length > 0) {
    problems.push(`release readiness expected blocker reported unexpected missing row ids: ${unexpectedIds.join(", ")}`);
  }
  return problems;
}

function noPublishBaselineProblems(json, step = {}) {
  const problems = [];
  const expectedCandidateSha = step.env?.RELEASE_CANDIDATE_SHA ?? null;
  const expectedEvidenceDate = step.env?.EVIDENCE_DATE ?? null;
  const evidenceDate = json.sourceEvidence?.evidenceDate;
  if (json.status !== "pass" || json.ok !== true) {
    problems.push("no-publish baseline verifier must report status=pass and ok=true");
  }
  if (json.scope !== NO_PUBLISH_BASELINE_SCOPE) {
    problems.push(`no-publish baseline must report scope=${NO_PUBLISH_BASELINE_SCOPE}`);
  }
  if (json.lifecycle?.phase !== NO_PUBLISH_BASELINE_PHASE) {
    problems.push(`no-publish baseline must report lifecycle.phase=${NO_PUBLISH_BASELINE_PHASE}`);
  }
  if (json.lifecycle?.invalidAfter !== NO_PUBLISH_BASELINE_INVALID_AFTER) {
    problems.push(`no-publish baseline must report lifecycle.invalidAfter=${NO_PUBLISH_BASELINE_INVALID_AFTER}`);
  }
  if (json.releaseReadiness?.ok !== false) {
    problems.push("no-publish baseline must prove release readiness still fails");
  }
  if (json.releaseReadiness?.checked !== EXPECTED_RELEASE_READINESS_CHECKED) {
    problems.push(`no-publish baseline must report ${EXPECTED_RELEASE_READINESS_CHECKED} checked rows, got ${json.releaseReadiness?.checked}`);
  }
  if (json.releaseReadiness?.missing !== EXPECTED_NO_PUBLISH_PENDING_ROWS) {
    problems.push(`no-publish baseline must report ${EXPECTED_NO_PUBLISH_PENDING_ROWS} pending publish rows, got ${json.releaseReadiness?.missing}`);
  }
  if (json.devicePacket?.pendingPackets !== EXPECTED_NO_PUBLISH_DEVICE_PENDING_PACKETS) {
    problems.push(`no-publish baseline must report ${EXPECTED_NO_PUBLISH_DEVICE_PENDING_PACKETS} pending device packets, got ${json.devicePacket?.pendingPackets}`);
  }
  if (typeof evidenceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(evidenceDate)) {
    problems.push("no-publish baseline must report sourceEvidence.evidenceDate");
  }
  if (expectedEvidenceDate && evidenceDate !== expectedEvidenceDate) {
    problems.push(`no-publish baseline must report sourceEvidence.evidenceDate=${expectedEvidenceDate}`);
  }
  if (json.handoffReceipts?.status !== "blocked") {
    problems.push("no-publish baseline handoff receipts must report status=blocked");
  }
  if (json.handoffReceipts?.allowPending !== true) {
    problems.push("no-publish baseline handoff receipts must report allowPending=true");
  }
  const handoffIds = Array.isArray(json.handoffReceipts?.blockerIds)
    ? json.handoffReceipts.blockerIds.filter((id) => typeof id === "string" && id.trim())
    : [];
  if (!Array.isArray(json.handoffReceipts?.blockerIds)) {
    problems.push("no-publish baseline handoff receipts must report blockerIds");
  }
  const absentHandoffIds = EXPECTED_HANDOFF_BLOCKER_IDS.filter((id) => !handoffIds.includes(id));
  const unexpectedHandoffIds = handoffIds.filter((id) => !EXPECTED_HANDOFF_BLOCKER_ID_SET.has(id));
  const duplicateHandoffIds = Array.from(new Set(
    handoffIds.filter((id, index) => handoffIds.indexOf(id) !== index),
  ));
  if (absentHandoffIds.length > 0) {
    problems.push(`no-publish baseline handoff receipts lost expected blockers: ${absentHandoffIds.join(", ")}`);
  }
  if (unexpectedHandoffIds.length > 0) {
    problems.push(`no-publish baseline handoff receipts reported unexpected blockers: ${unexpectedHandoffIds.join(", ")}`);
  }
  if (duplicateHandoffIds.length > 0) {
    problems.push(`no-publish baseline handoff receipts reported duplicate blockers: ${duplicateHandoffIds.join(", ")}`);
  }
  if (typeof evidenceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(evidenceDate)) {
    const expectedPaths = expectedHandoffReceiptPaths(evidenceDate);
    if (!isPlainObject(json.handoffReceipts?.receiptPaths)) {
      problems.push("no-publish baseline handoff receipts must report receiptPaths");
    } else {
      for (const [pathKey, expectedPath] of Object.entries(expectedPaths)) {
        if (normalizeSlash(json.handoffReceipts.receiptPaths?.[pathKey]) !== expectedPath) {
          problems.push(`no-publish baseline handoff receipts receiptPaths.${pathKey} must be ${expectedPath}`);
        }
      }
    }
    if (!isPlainObject(json.handoffReceipts?.expectedReceiptPaths)) {
      problems.push("no-publish baseline handoff receipts must report expectedReceiptPaths");
    } else {
      for (const [pathKey, expectedPath] of Object.entries(expectedPaths)) {
        if (normalizeSlash(json.handoffReceipts.expectedReceiptPaths?.[pathKey]) !== expectedPath) {
          problems.push(`no-publish baseline handoff receipts expectedReceiptPaths.${pathKey} must be ${expectedPath}`);
        }
      }
    }
    if (!isPlainObject(json.handoffReceipts?.checked)) {
      problems.push("no-publish baseline handoff receipts must report checked receipt status details");
    } else {
      for (const [checkedKey, pathKey] of HANDOFF_RECEIPT_CHECKS) {
        const expectedPath = expectedPaths[pathKey];
        const checkedEntry = json.handoffReceipts.checked?.[checkedKey];
        if (!isPlainObject(checkedEntry)) {
          problems.push(`no-publish baseline handoff receipts checked.${checkedKey} must be present`);
          continue;
        }
        if (normalizeSlash(checkedEntry.path) !== expectedPath) {
          problems.push(`no-publish baseline handoff receipts checked.${checkedKey}.path must be ${expectedPath}`);
        }
        if (checkedEntry.status !== "missing") {
          problems.push(`no-publish baseline handoff receipts checked.${checkedKey}.status must be missing`);
        }
      }
    }
  }
  if (expectedCandidateSha) {
    if (json.sourceEvidence?.expectedCandidateSha !== expectedCandidateSha) {
      problems.push("no-publish baseline must record the expected candidate SHA");
    }
    if (json.sourceEvidence?.devicePacketReleaseCandidateSha !== expectedCandidateSha) {
      problems.push("no-publish baseline device packet target must match the expected candidate SHA");
    }
  }
  for (const [key, label] of [
    ["branchProtectionReady", "branch protection ready"],
    ["publishHashVariablesAbsent", "publish hash variables absent"],
    ["releaseStateNoPublish", "release state no-publish"],
    ["validationPrereqsBlocked", "validation prerequisites blocked"],
    ["handoffReceiptsBlocked", "handoff receipts blocked"],
  ]) {
    if (json.controls?.[key] !== true) {
      problems.push(`no-publish baseline must prove ${label}`);
    }
  }
  return problems;
}

function outputProblems(step, text) {
  const expected = step.expectedOutputIncludes ?? [];
  const markerProblems = expected
    .filter((marker) => !text.includes(marker))
    .map((marker) => `missing expected output marker: ${marker}`);
  return [...markerProblems, ...expectedJsonProblems(step, text)];
}

function envForStep(step, baseEnv = process.env) {
  const env = { ...baseEnv };
  if (step.envMode === "without-production-config") {
    for (const key of PRODUCTION_ENV_KEYS) delete env[key];
    for (const key of QA_ONLY_ENV_KEYS) delete env[key];
  }
  if (step.envMode === "placeholder-production-config") {
    Object.assign(env, PLACEHOLDER_PRODUCTION_ENV);
  }
  if (step.env) {
    Object.assign(env, step.env);
  }
  return env;
}

function bundleForMode(mode, { candidateSha = null, evidenceDate = null } = {}) {
  if (mode === "local") {
    if (evidenceDate) {
      throw new Error("--date is only valid for release-candidate mode");
    }
    return [...LOCAL_STEPS];
  }
  if (mode === "release-candidate") {
    const extraSteps = RELEASE_CANDIDATE_EXTRA_STEPS.map((step) => {
      const env = {};
      let args = step.args;
      if (evidenceDate && [
        "Handoff receipts expected blockers",
        "No-publish baseline verifier",
        "Release readiness expected blockers",
      ].includes(step.label)) {
        env.EVIDENCE_DATE = evidenceDate;
      }
      if (evidenceDate && [
        "Handoff receipts expected blockers",
        "No-publish baseline verifier",
      ].includes(step.label)) {
        args = [...args, "--date", evidenceDate];
      }
      if (candidateSha && [
        "No-publish baseline verifier",
        "Release readiness expected blockers",
      ].includes(step.label)) {
        env.RELEASE_CANDIDATE_SHA = candidateSha;
      }
      if (Object.keys(env).length === 0 && args === step.args) {
        return step;
      }
      return {
        ...step,
        args,
        env: {
          ...(step.env ?? {}),
          ...env,
        },
      };
    });
    return [...LOCAL_STEPS, ...extraSteps];
  }
  throw new Error(`Unknown verification bundle: ${mode}`);
}

function runStep(step, {
  baseEnv = process.env,
  coverageReportsDirectory = null,
  runCommand = spawnSync,
  write = (message) => process.stdout.write(message),
  evidenceDir = null,
  stepIndex = 0,
} = {}) {
  const runtimeStep = stepWithRuntimeArgs(step, { coverageReportsDirectory });
  write(`\n==> ${runtimeStep.label}\n`);
  const shouldInspectOutput = Boolean(runtimeStep.expectedOutputIncludes?.length);
  const shouldCaptureOutput = shouldInspectOutput || Boolean(evidenceDir);
  const options = shouldCaptureOutput ? { encoding: "utf8" } : { stdio: "inherit" };
  if (runtimeStep.envMode || runtimeStep.env) options.env = envForStep(runtimeStep, baseEnv);
  const startedAt = new Date().toISOString();
  const result = runCommand(commandName(runtimeStep.command), runtimeStep.args, options);
  const finishedAt = new Date().toISOString();
  const text = shouldCaptureOutput ? outputText(result) : "";
  if (shouldCaptureOutput) write(text);
  const stepEvidence = evidenceDir
    ? writeStepEvidence({ evidenceDir, step: runtimeStep, index: stepIndex, result, startedAt, finishedAt })
    : null;
  const expectedStatus = runtimeStep.expectedStatus ?? 0;
  const status = typeof result.status === "number" ? result.status : 1;
  if (status !== expectedStatus) {
    return {
      ok: false,
      status,
      expectedStatus,
      error: result.error ?? null,
      step: runtimeStep,
      stepEvidence,
    };
  }
  const problems = shouldInspectOutput ? outputProblems(runtimeStep, text) : [];
  if (problems.length > 0) {
    return {
      ok: false,
      status,
      expectedStatus,
      outputProblems: problems,
      error: null,
      step: runtimeStep,
      stepEvidence,
    };
  }
  return { ok: true, status, expectedStatus, step: runtimeStep, stepEvidence };
}

function runBundle(mode, options = {}) {
  const steps = bundleForMode(mode, {
    candidateSha: options.candidateSha ?? null,
    evidenceDate: options.evidenceDate ?? null,
  });
  const evidenceDir = options.evidenceDir ? path.resolve(options.evidenceDir) : null;
  const coverageReportsDirectory = options.coverageReportsDirectory ?? createCoverageReportsDirectory({ mode });
  const releaseEvidenceLock = acquireEvidenceDirLock(evidenceDir);
  try {
    cleanupGeneratedEvidenceFiles(evidenceDir);
    const evidenceSummary = evidenceDir
      ? {
          mode,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          ok: false,
          status: "running",
          metadata: options.evidenceMetadata ?? createEvidenceMetadata({
            diveoRoot: process.cwd(),
            env: options.baseEnv ?? process.env,
          }),
          steps: [],
        }
      : null;

    for (const [index, step] of steps.entries()) {
      const result = runStep(step, {
        ...options,
        coverageReportsDirectory,
        evidenceDir,
        stepIndex: index,
      });
      if (evidenceSummary && result.stepEvidence) evidenceSummary.steps.push(result.stepEvidence);
      if (!result.ok) {
        if (evidenceSummary) {
          evidenceSummary.finishedAt = new Date().toISOString();
          evidenceSummary.status = "fail";
          evidenceSummary.failedStep = result.stepEvidence ?? {
            index: index + 1,
            label: step.label,
          };
          evidenceSummary.outputProblems = result.outputProblems ?? [];
          writeEvidenceSummary(evidenceDir, evidenceSummary);
        }
        return { ok: false, failed: result, mode, steps, evidenceSummary };
      }
    }
    if (evidenceSummary) {
      evidenceSummary.finishedAt = new Date().toISOString();
      evidenceSummary.ok = true;
      evidenceSummary.status = "pass";
      writeEvidenceSummary(evidenceDir, evidenceSummary);
    }
    return { ok: true, mode, steps, evidenceSummary };
  } finally {
    releaseEvidenceLock();
  }
}

function main() {
  try {
    const { mode, evidenceDir, candidateSha, evidenceDate } = parseArgs();
    const result = runBundle(mode, { evidenceDir, candidateSha, evidenceDate });
    if (!result.ok) {
      const { step, status, expectedStatus, error } = result.failed;
      console.error(`Verification bundle failed at "${step.label}". Expected exit ${expectedStatus}, got ${status}.`);
      for (const problem of result.failed.outputProblems ?? []) {
        console.error(problem);
      }
      if (error) console.error(error.message);
      process.exitCode = status || 1;
      return;
    }
    console.log(`\nVerification bundle "${mode}" passed (${result.steps.length} steps).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  EXPECTED_RELEASE_READINESS_CHECKED,
  EXPECTED_NO_PUBLISH_DEVICE_PENDING_PACKETS,
  EXPECTED_NO_PUBLISH_MISSING_IDS,
  EXPECTED_NO_PUBLISH_MISSING_ROWS,
  EXPECTED_NO_PUBLISH_PENDING_ROWS,
  EXPECTED_HANDOFF_BLOCKER_IDS,
  FULL_COMMIT_SHA_PATTERN,
  NO_PUBLISH_BASELINE_INVALID_AFTER,
  NO_PUBLISH_BASELINE_PHASE,
  NO_PUBLISH_BASELINE_SCOPE,
  LOCAL_STEPS,
  PLACEHOLDER_PRODUCTION_ENV,
  QA_ONLY_ENV_KEYS,
  PRODUCTION_ENV_KEYS,
  RELEASE_CANDIDATE_EXTRA_STEPS,
  RELEASE_FOCUSED_TESTS,
  acquireEvidenceDirLock,
  bundleForMode,
  commandName,
  commandLine,
  cleanupGeneratedEvidenceFiles,
  createCoverageReportsDirectory,
  evidenceEnvForStep,
  envForStep,
  expectedJsonProblems,
  outputProblems,
  parseArgs,
  parseJsonFromOutput,
  runBundle,
  runStep,
  safeEvidenceName,
  safeRunLabel,
  sha256Text,
  stepWithRuntimeArgs,
  streamText,
  validEvidenceDate,
  writeEvidenceSummary,
  writeStepEvidence,
};
