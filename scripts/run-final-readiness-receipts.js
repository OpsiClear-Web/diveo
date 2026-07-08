#!/usr/bin/env node
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const { createEvidenceMetadata } = require("./evidence-metadata");
const {
  FULL_COMMIT_SHA_PATTERN,
  acquireEvidenceDirLock,
  cleanupGeneratedEvidenceFiles,
  runStep,
  writeEvidenceSummary,
} = require("./run-verification-bundle");
const {
  FINAL_FOCUSED_TESTS,
  FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV,
  FINAL_RECEIPT_EXPECTED_STEP_LABELS,
} = require("./final-readiness-receipt-contract");

const FINAL_RECEIPT_MODE = "final-readiness-receipts";
const PLANNING_BASENAME_PATTERN = /\b(scaffold|candidate|pending|example)\b/i;
const PROTECTED_REMOTE = "origin";
const PROTECTED_BRANCH = "master";
const PROTECTED_REF = `${PROTECTED_REMOTE}/${PROTECTED_BRANCH}`;
const DEFAULT_REPOSITORY = "OpsiClear-Web/diveo";
const CANONICAL_QA_PATH = "docs/GSAV_NATIVE_QA.md";
const CANONICAL_FINAL_RECEIPT_DIR_BASENAME = "final-command-receipts";
const CANONICAL_EXTERNAL_INVENTORY_FILENAME = "external-evidence-inventory.json";
const TRUSTED_DIVEO_REPOSITORIES = new Set(["opsiclear-web/diveo", "opsiclear/diveo"]);
const LAST_MILE_RELEASE_STATE_FILENAME = "github-release-state-prepublish-live.json";
const LAST_MILE_PUBLISH_HASH_GUARD_FILENAME = "publish-hash-variable-guard-prepublish-live.json";
const CANONICAL_STACK_RECEIPT_FILENAME = "stack-architecture-receipt.json";

function todayIsoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function validateIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateIsoTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(value ?? ""))) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const normalized = String(value).includes(".") ? String(value) : String(value).replace(/Z$/, ".000Z");
  return parsed.toISOString() === normalized;
}

function normalizeSlash(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function validateRepository(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) throw new Error("--repo or GITHUB_REPOSITORY is required.");
  const normalized = rawValue
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/^\/+|\/+$/g, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) {
    throw new Error("--repo must be owner/name.");
  }
  if (!TRUSTED_DIVEO_REPOSITORIES.has(normalized.toLowerCase())) {
    throw new Error("--repo or GITHUB_REPOSITORY must target the trusted Diveo repository.");
  }
  return normalized;
}

function defaultReviewer(env) {
  return env.FINAL_READINESS_REVIEWER || env.GITHUB_ACTOR || env.USERNAME || env.USER || null;
}

function validateReviewer(value) {
  const reviewer = String(value ?? "").trim();
  if (!reviewer
    || /<[^>]+>/.test(reviewer)
    || /^(?:unknown|unavailable|n\/a|null|none|present|provided|recorded|captured|available|configured|reviewer|owner|release owner|native release owner|final-readiness-runner)\b/i.test(reviewer)) {
    throw new Error("--reviewer or FINAL_READINESS_REVIEWER must be concrete.");
  }
  return reviewer;
}

function validateRepoRelativePath(value, label) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) throw new Error(`${label} is required.`);
  if (path.isAbsolute(rawValue)) throw new Error(`${label} must be repository-relative.`);
  const normalized = normalizeSlash(path.normalize(rawValue));
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new Error(`${label} must stay inside the repository root.`);
  }
  return normalized;
}

function validateFinalEvidenceJsonPath(value, {
  label,
  date,
}) {
  const normalized = validateRepoRelativePath(value, label);
  const expectedPrefix = `docs/qa-evidence/${date}/`;
  if (!normalized.startsWith(expectedPrefix)) {
    throw new Error(`${label} must stay under docs/qa-evidence/${date}/.`);
  }
  if (path.posix.dirname(normalized) !== `docs/qa-evidence/${date}`) {
    throw new Error(`${label} must be directly under docs/qa-evidence/${date}/.`);
  }
  if (path.posix.extname(normalized) !== ".json") {
    throw new Error(`${label} must be a JSON file.`);
  }
  const basename = path.posix.basename(normalized, ".json");
  if (PLANNING_BASENAME_PATTERN.test(basename)) {
    throw new Error(`${label} must be a reviewed final file, not a scaffold, candidate, pending, or example path.`);
  }
  return normalized;
}

function validateInventoryPath(value, date) {
  const normalized = validateFinalEvidenceJsonPath(value, {
    label: "--inventory-path",
    date,
  });
  const expectedPath = `docs/qa-evidence/${date}/${CANONICAL_EXTERNAL_INVENTORY_FILENAME}`;
  if (normalized !== expectedPath) {
    throw new Error(`--inventory-path must be ${expectedPath} for final receipts.`);
  }
  return normalized;
}

function validateStackReceiptPath(value, date) {
  const normalized = validateFinalEvidenceJsonPath(value, {
    label: "--stack-receipt-path",
    date,
  });
  const expectedPath = `docs/qa-evidence/${date}/${CANONICAL_STACK_RECEIPT_FILENAME}`;
  if (normalized !== expectedPath) {
    throw new Error(`--stack-receipt-path must be ${expectedPath} for final receipts.`);
  }
  return normalized;
}

function validateEvidenceDir(value, date) {
  const normalized = validateRepoRelativePath(value, "--evidence-dir");
  const finalReceiptDir = normalized.replace(/\/+$/g, "");
  const expectedDir = `docs/qa-evidence/${date}/${CANONICAL_FINAL_RECEIPT_DIR_BASENAME}`;
  if (finalReceiptDir !== expectedDir) {
    throw new Error(`--evidence-dir must be ${expectedDir} for final receipts.`);
  }
  return finalReceiptDir;
}

function usage() {
  return [
    "Usage: node scripts/run-final-readiness-receipts.js --candidate-sha <40-hex-sha>",
    "[--date <YYYY-MM-DD>]",
    "[--inventory-path <path>]",
    "[--packet-path <path>]",
    "[--stack-receipt-path <path>]",
    "[--qa-path <path>]",
    "[--evidence-dir <dir>]",
    "[--repo <owner/name>]",
    "[--reviewer <reviewer>]",
    "[--reviewed-at <ISO timestamp>]",
    "[--expect-readiness-fail]",
  ].join(" ");
}

function parseArgs(argv = process.argv.slice(2), env = process.env, now = new Date()) {
  const options = {
    date: env.EVIDENCE_DATE || todayIsoDate(now),
    candidateSha: env.RELEASE_CANDIDATE_SHA || env.RELEASE_PAYLOAD_CANDIDATE_SHA || null,
    inventoryPath: null,
    packetPath: null,
    stackReceiptPath: null,
    qaPath: "docs/GSAV_NATIVE_QA.md",
    evidenceDir: null,
    repository: env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
    reviewer: defaultReviewer(env),
    reviewedAt: env.FINAL_READINESS_REVIEWED_AT || now.toISOString(),
    expectReadinessStatus: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a non-empty value.`);
      index += 1;
      return value;
    };

    if (arg === "--date") options.date = nextValue();
    else if (arg === "--candidate-sha" || arg === "--release-candidate-sha") options.candidateSha = nextValue();
    else if (arg === "--inventory-path") options.inventoryPath = nextValue();
    else if (arg === "--packet-path") options.packetPath = nextValue();
    else if (arg === "--stack-receipt-path") options.stackReceiptPath = nextValue();
    else if (arg === "--qa-path") options.qaPath = nextValue();
    else if (arg === "--evidence-dir") options.evidenceDir = nextValue();
    else if (arg === "--repo") options.repository = nextValue();
    else if (arg === "--reviewer") options.reviewer = nextValue();
    else if (arg === "--reviewed-at") options.reviewedAt = nextValue();
    else if (arg === "--expect-readiness-fail") options.expectReadinessStatus = 1;
    else if (arg === "--expect-readiness-pass") options.expectReadinessStatus = 0;
    else throw new Error(usage());
  }

  if (!validateIsoDate(options.date)) {
    throw new Error("--date must be an ISO YYYY-MM-DD date.");
  }
  if (options.date > todayIsoDate(now)) {
    throw new Error("--date must not be in the future for final receipt capture.");
  }
  if (options.date !== todayIsoDate(now)) {
    throw new Error("--date must be the current UTC date for final receipt capture.");
  }
  if (!FULL_COMMIT_SHA_PATTERN.test(String(options.candidateSha ?? ""))) {
    throw new Error("--candidate-sha, RELEASE_CANDIDATE_SHA, or RELEASE_PAYLOAD_CANDIDATE_SHA must be a full 40-hex SHA.");
  }
  if (!validateIsoTimestamp(options.reviewedAt)) {
    throw new Error("--reviewed-at or FINAL_READINESS_REVIEWED_AT must be an ISO timestamp.");
  }
  if (String(options.reviewedAt).slice(0, 10) !== options.date) {
    throw new Error("--reviewed-at or FINAL_READINESS_REVIEWED_AT must be an ISO timestamp on the final evidence date.");
  }

  options.inventoryPath ??= `docs/qa-evidence/${options.date}/external-evidence-inventory.json`;
  options.packetPath ??= `docs/qa-evidence/${options.date}/device-evidence-packet-reviewed.json`;
  options.stackReceiptPath ??= `docs/qa-evidence/${options.date}/${CANONICAL_STACK_RECEIPT_FILENAME}`;
  options.evidenceDir ??= `docs/qa-evidence/${options.date}/final-command-receipts`;
  options.repository = validateRepository(options.repository);
  options.reviewer = validateReviewer(options.reviewer);
  options.inventoryPath = validateInventoryPath(options.inventoryPath, options.date);
  options.packetPath = validateFinalEvidenceJsonPath(options.packetPath, {
    label: "--packet-path",
    date: options.date,
  });
  options.stackReceiptPath = validateStackReceiptPath(options.stackReceiptPath, options.date);
  options.qaPath = validateRepoRelativePath(options.qaPath, "--qa-path");
  if (options.qaPath !== CANONICAL_QA_PATH) {
    throw new Error(`--qa-path must be ${CANONICAL_QA_PATH} for final receipts.`);
  }
  options.evidenceDir = validateEvidenceDir(options.evidenceDir, options.date);
  options.lastMileReleaseStateLivePath = normalizeSlash(path.join(options.evidenceDir, LAST_MILE_RELEASE_STATE_FILENAME));
  options.lastMilePublishHashGuardLivePath = normalizeSlash(path.join(options.evidenceDir, LAST_MILE_PUBLISH_HASH_GUARD_FILENAME));
  return options;
}

function finalReceiptSteps(options) {
  const readinessEnv = {
    EXTERNAL_EVIDENCE_INVENTORY_PATH: options.inventoryPath,
    [FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV]: normalizeSlash(path.join(options.evidenceDir, "verification-summary.json")),
    DEVICE_EVIDENCE_PACKET_PATH: options.packetPath,
    RELEASE_CANDIDATE_SHA: options.candidateSha,
  };

  return [
    {
      label: "Documentation drift audit",
      command: "node",
      args: ["scripts/verify-doc-drift.js"],
    },
    {
      label: "Final readiness focused tests",
      command: "node",
      args: ["node_modules/vitest/vitest.mjs", "run", ...FINAL_FOCUSED_TESTS],
    },
    {
      label: "External evidence inventory replay",
      command: "node",
      args: [
        "scripts/verify-external-evidence-inventory.js",
        "--inventory-path",
        options.inventoryPath,
        "--qa-path",
        options.qaPath,
        "--packet-path",
        options.packetPath,
        "--require-git-integrity",
      ],
    },
    {
      label: "Device packet reconciliation",
      command: "node",
      args: [
        "scripts/device-evidence-packet.js",
        "--check",
        "--input-path",
        options.packetPath,
        "--qa-path",
        options.qaPath,
        "--candidate-sha",
        options.candidateSha,
        "--require-git-integrity",
      ],
    },
    {
      label: "Strict handoff receipt replay",
      command: "node",
      args: [
        "scripts/verify-handoff-receipts.js",
        "--date",
        options.date,
        "--require-git-integrity",
      ],
    },
    {
      label: "Stack architecture receipt replay",
      command: "node",
      args: [
        "scripts/stack-architecture-receipt.js",
        "--require-assets",
        "--verify",
        options.stackReceiptPath,
      ],
    },
    {
      label: "Protected master ref refresh",
      command: "git",
      args: ["fetch", "--no-tags", PROTECTED_REMOTE, PROTECTED_BRANCH],
    },
    {
      label: "Protected candidate ancestry proof",
      command: "git",
      args: ["merge-base", "--is-ancestor", options.candidateSha, PROTECTED_REF],
    },
    {
      label: "Last-mile GitHub release-state evidence",
      command: "node",
      args: [
        "scripts/capture-github-release-state-evidence.js",
        "--repo",
        options.repository,
        "--output-path",
        options.lastMileReleaseStateLivePath,
        "--reviewer",
        options.reviewer,
        "--reviewed-at",
        options.reviewedAt,
      ],
      expectedStatus: options.expectReadinessStatus === 0 ? 0 : 1,
    },
    {
      label: "Last-mile publish-hash variable guard",
      command: "node",
      args: [
        "scripts/capture-publish-hash-variable-guard.js",
        "--repo",
        options.repository,
        "--output-path",
        options.lastMilePublishHashGuardLivePath,
        "--reviewer",
        options.reviewer,
        "--reviewed-at",
        options.reviewedAt,
      ],
      expectedStatus: 0,
    },
    {
      label: "Final release readiness",
      command: "node",
      args: ["scripts/verify-release-readiness.js", "--strict-final-inputs"],
      env: readinessEnv,
      expectedStatus: options.expectReadinessStatus,
    },
  ];
}

function createSummary(options, baseEnv) {
  return {
    mode: FINAL_RECEIPT_MODE,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ok: false,
    status: "running",
    inputs: {
      date: options.date,
      candidateSha: options.candidateSha,
      inventoryPath: normalizeSlash(options.inventoryPath),
      packetPath: normalizeSlash(options.packetPath),
      stackReceiptPath: normalizeSlash(options.stackReceiptPath),
      qaPath: normalizeSlash(options.qaPath),
      evidenceDir: normalizeSlash(options.evidenceDir),
      expectReadinessStatus: options.expectReadinessStatus,
      protectedRef: PROTECTED_REF,
      repository: options.repository,
      reviewer: options.reviewer,
      reviewedAt: options.reviewedAt,
      lastMileReleaseStateLivePath: normalizeSlash(options.lastMileReleaseStateLivePath),
      lastMilePublishHashGuardLivePath: normalizeSlash(options.lastMilePublishHashGuardLivePath),
    },
    publishSignoffReady: false,
    noPublishRehearsal: false,
    metadata: createEvidenceMetadata({
      diveoRoot: process.cwd(),
      env: baseEnv,
    }),
    steps: [],
  };
}

function liveLastMileOutputPath(step, options) {
  const expectedPaths = new Map([
    ["Last-mile GitHub release-state evidence", options.lastMileReleaseStateLivePath],
    ["Last-mile publish-hash variable guard", options.lastMilePublishHashGuardLivePath],
  ]);
  return expectedPaths.get(step.label) ?? null;
}

function resetLiveLastMileOutput(step, options) {
  const relativePath = liveLastMileOutputPath(step, options);
  if (!relativePath) return;
  const absolutePath = path.resolve(relativePath);
  if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
}

function liveLastMileOutputProblem(step, options) {
  const relativePath = liveLastMileOutputPath(step, options);
  if (!relativePath) return null;

  const absolutePath = path.resolve(relativePath);
  if (!fs.existsSync(absolutePath)) {
    return `${step.label} did not create ${normalizeSlash(relativePath)}`;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return `${step.label} output ${normalizeSlash(relativePath)} must be a JSON object`;
    }
    if (parsed.repository !== options.repository) {
      return `${step.label} output ${normalizeSlash(relativePath)} repository must match final receipt inputs.repository`;
    }
    if (parsed.review?.reviewer !== options.reviewer) {
      return `${step.label} output ${normalizeSlash(relativePath)} reviewer must match final receipt inputs.reviewer`;
    }
    if (parsed.review?.reviewedAt !== options.reviewedAt) {
      return `${step.label} output ${normalizeSlash(relativePath)} reviewedAt must match final receipt inputs.reviewedAt`;
    }
    if (!validateIsoTimestamp(parsed.checkedAt) || String(parsed.checkedAt).slice(0, 10) !== options.date) {
      return `${step.label} output ${normalizeSlash(relativePath)} checkedAt must be an ISO timestamp on the final evidence date`;
    }
    if ((step.expectedStatus ?? 0) === 0) {
      if (parsed.status !== "pass" || parsed.ok !== true) {
        return `${step.label} output ${normalizeSlash(relativePath)} must report status=pass and ok=true`;
      }
      if (parsed.releaseReadinessImpact?.status !== "ready") {
        return `${step.label} output ${normalizeSlash(relativePath)} releaseReadinessImpact.status must be ready`;
      }
    }
  } catch {
    return `${step.label} output ${normalizeSlash(relativePath)} must be valid JSON`;
  }
  return null;
}

function finalReceiptStepSetProblem(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return "Final receipt wrapper summary must include step receipt entries before pass.";
  }

  const actualLabels = steps.map((step) => String(step?.label ?? ""));
  const matchesExpected = actualLabels.length === FINAL_RECEIPT_EXPECTED_STEP_LABELS.length
    && FINAL_RECEIPT_EXPECTED_STEP_LABELS.every((label, index) => actualLabels[index] === label);

  if (matchesExpected) return null;

  return `Final receipt wrapper summary must include exactly the ${FINAL_RECEIPT_EXPECTED_STEP_LABELS.length} final receipt wrapper steps in order: ${FINAL_RECEIPT_EXPECTED_STEP_LABELS.join("; ")}.`;
}

function finalReceiptStepSetFailure(problem, summary) {
  const failedStep = {
    index: Array.isArray(summary.steps) ? summary.steps.length + 1 : 1,
    label: "Final receipt wrapper step set",
    status: 1,
    expectedStatus: 0,
  };
  summary.finishedAt = new Date().toISOString();
  summary.status = "fail";
  summary.failedStep = failedStep;
  summary.outputProblems = [problem];
  return {
    step: failedStep,
    status: 1,
    expectedStatus: 0,
    outputProblems: [problem],
  };
}

function runFinalReadinessReceipts(options, {
  buildSteps = finalReceiptSteps,
  runCommand = spawnSync,
  write = (message) => process.stdout.write(message),
  baseEnv = process.env,
} = {}) {
  const evidenceDir = path.resolve(options.evidenceDir);
  const steps = buildSteps(options);
  const releaseLock = acquireEvidenceDirLock(evidenceDir);
  try {
    cleanupGeneratedEvidenceFiles(evidenceDir);
    const summary = createSummary(options, baseEnv);
    for (const [index, step] of steps.entries()) {
      resetLiveLastMileOutput(step, options);
      const result = runStep(step, {
        runCommand,
        write,
        baseEnv,
        evidenceDir,
        stepIndex: index,
      });
      if (result.stepEvidence) summary.steps.push(result.stepEvidence);
      if (!result.ok) {
        summary.finishedAt = new Date().toISOString();
        summary.status = "fail";
        summary.failedStep = result.stepEvidence ?? {
          index: index + 1,
          label: step.label,
        };
        summary.outputProblems = result.outputProblems ?? [];
        writeEvidenceSummary(evidenceDir, summary);
        return { ok: false, failed: result, steps, evidenceSummary: summary };
      }
      const liveOutputProblem = liveLastMileOutputProblem(result.step, options);
      if (liveOutputProblem) {
        summary.finishedAt = new Date().toISOString();
        summary.status = "fail";
        summary.failedStep = result.stepEvidence ?? {
          index: index + 1,
          label: step.label,
        };
        summary.outputProblems = [liveOutputProblem];
        writeEvidenceSummary(evidenceDir, summary);
        return {
          ok: false,
          failed: {
            ...result,
            outputProblems: [liveOutputProblem],
          },
          steps,
          evidenceSummary: summary,
        };
      }
    }

    const stepSetProblem = finalReceiptStepSetProblem(summary.steps);
    if (stepSetProblem) {
      const failed = finalReceiptStepSetFailure(stepSetProblem, summary);
      writeEvidenceSummary(evidenceDir, summary);
      return { ok: false, failed, steps, evidenceSummary: summary };
    }

    summary.finishedAt = new Date().toISOString();
    summary.ok = true;
    summary.publishSignoffReady = options.expectReadinessStatus === 0;
    summary.noPublishRehearsal = options.expectReadinessStatus !== 0;
    summary.status = summary.publishSignoffReady ? "pass" : "expected-readiness-fail";
    writeEvidenceSummary(evidenceDir, summary);
    return { ok: true, steps, evidenceSummary: summary };
  } finally {
    releaseLock();
  }
}

function finalReceiptSuccessMessage(result) {
  const recordedStepProblem = finalReceiptStepSetProblem(result.evidenceSummary?.steps);
  if (recordedStepProblem) {
    throw new Error(`Final readiness receipt success requires complete recorded step evidence: ${recordedStepProblem}`);
  }
  const recordedStepCount = result.evidenceSummary.steps.length;
  if (result.evidenceSummary?.noPublishRehearsal) {
    return `\nFinal readiness no-publish rehearsal completed (${recordedStepCount} recorded steps).`;
  }
  return `\nFinal readiness receipt bundle passed (${recordedStepCount} recorded steps).`;
}

function main() {
  try {
    const options = parseArgs();
    const result = runFinalReadinessReceipts(options);
    if (!result.ok) {
      const { step, status, expectedStatus, error } = result.failed;
      console.error(`Final readiness receipts failed at "${step.label}". Expected exit ${expectedStatus}, got ${status}.`);
      for (const problem of result.failed.outputProblems ?? []) {
        console.error(problem);
      }
      if (error) console.error(error.message);
      process.exitCode = status || 1;
      return;
    }
    console.log(finalReceiptSuccessMessage(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  FINAL_FOCUSED_TESTS,
  FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV,
  FINAL_RECEIPT_MODE,
  FINAL_RECEIPT_EXPECTED_STEP_LABELS,
  finalReceiptSteps,
  finalReceiptStepSetProblem,
  finalReceiptSuccessMessage,
  parseArgs,
  runFinalReadinessReceipts,
  usage,
  validateIsoDate,
};
