import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import finalReceiptContract from "./final-readiness-receipt-contract.js";
import receiptsModule from "./run-final-readiness-receipts.js";

const {
  FINAL_FOCUSED_TESTS,
  FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV,
  FINAL_RECEIPT_MODE,
  FINAL_RECEIPT_EXPECTED_STEP_LABELS,
  finalReceiptSteps,
  finalReceiptStepSetProblem,
  finalReceiptSuccessMessage,
  parseArgs,
  runFinalReadinessReceipts,
  validateIsoDate,
} = receiptsModule;

const CANDIDATE_SHA = "3d243f51497982d1c741e28d7f6ed2e90c99ba50";
const DATE = "2026-07-01";
const INVENTORY_PATH = "docs/qa-evidence/2026-07-01/external-evidence-inventory.json";
const PACKET_PATH = "docs/qa-evidence/2026-07-01/device-evidence-packet-reviewed.json";
const STACK_RECEIPT_PATH = "docs/qa-evidence/2026-07-01/stack-architecture-receipt.json";
const EVIDENCE_DIR = "docs/qa-evidence/2026-07-01/final-command-receipts";
const REVIEWER = "codex-local-verifier";
const DEFAULT_ENV = { FINAL_READINESS_REVIEWER: REVIEWER };
const CAPTURE_NOW = new Date("2026-07-01T12:00:00Z");

function withTempCwd(callback) {
  const previousCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diveo-final-receipts-"));
  process.chdir(tmp);
  try {
    return callback(tmp);
  } finally {
    process.chdir(previousCwd);
  }
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}

function liveOutputPayload(args, overrides = {}) {
  const reviewedAt = argValue(args, "--reviewed-at") ?? "2026-07-01T12:00:00.000Z";
  return {
    status: "pass",
    ok: true,
    checkedAt: reviewedAt,
    repository: argValue(args, "--repo") ?? "OpsiClear-Web/diveo",
    review: {
      reviewer: argValue(args, "--reviewer") ?? REVIEWER,
      reviewedAt,
    },
    releaseReadinessImpact: {
      status: "ready",
    },
    ...overrides,
  };
}

function writeLiveOutputForStep(args, overrides = {}) {
  const outputPath = argValue(args, "--output-path");
  if (!outputPath) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(liveOutputPayload(args, overrides), null, 2)}\n`);
}

function recordedFinalSteps(labels = FINAL_RECEIPT_EXPECTED_STEP_LABELS) {
  return labels.map((label, index) => ({
    index: index + 1,
    label,
    status: 0,
    expectedStatus: 0,
  }));
}

describe("final readiness receipt runner", () => {
  it("exports the shared final receipt contract", () => {
    expect(FINAL_FOCUSED_TESTS).toEqual(finalReceiptContract.FINAL_FOCUSED_TESTS);
    expect(FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV)
      .toBe(finalReceiptContract.FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV);
    expect(FINAL_RECEIPT_EXPECTED_STEP_LABELS)
      .toEqual(finalReceiptContract.FINAL_RECEIPT_EXPECTED_STEP_LABELS);
  });

  it("parses final receipt inputs and defaults paths from the evidence date", () => {
    expect(parseArgs(["--candidate-sha", CANDIDATE_SHA], DEFAULT_ENV, CAPTURE_NOW))
      .toEqual({
        date: DATE,
        candidateSha: CANDIDATE_SHA,
        inventoryPath: INVENTORY_PATH,
        packetPath: PACKET_PATH,
        stackReceiptPath: STACK_RECEIPT_PATH,
        qaPath: "docs/GSAV_NATIVE_QA.md",
        evidenceDir: EVIDENCE_DIR,
        repository: "OpsiClear-Web/diveo",
        reviewer: REVIEWER,
        reviewedAt: "2026-07-01T12:00:00.000Z",
        lastMileReleaseStateLivePath: `${EVIDENCE_DIR}/github-release-state-prepublish-live.json`,
        lastMilePublishHashGuardLivePath: `${EVIDENCE_DIR}/publish-hash-variable-guard-prepublish-live.json`,
        expectReadinessStatus: 0,
      });

    expect(parseArgs([
      "--date",
      DATE,
      "--inventory-path",
      INVENTORY_PATH,
      "--packet-path",
      "docs/qa-evidence/2026-07-01/custom-packet.json",
      "--stack-receipt-path",
      STACK_RECEIPT_PATH,
      "--evidence-dir",
      EVIDENCE_DIR,
      "--reviewed-at",
      "2026-07-01T12:00:00.000Z",
      "--expect-readiness-fail",
    ], { ...DEFAULT_ENV, RELEASE_CANDIDATE_SHA: CANDIDATE_SHA }, CAPTURE_NOW))
      .toMatchObject({
        date: DATE,
        candidateSha: CANDIDATE_SHA,
        inventoryPath: INVENTORY_PATH,
        packetPath: "docs/qa-evidence/2026-07-01/custom-packet.json",
        stackReceiptPath: STACK_RECEIPT_PATH,
        qaPath: "docs/GSAV_NATIVE_QA.md",
        evidenceDir: EVIDENCE_DIR,
        expectReadinessStatus: 1,
      });

    expect(validateIsoDate(DATE)).toBe(true);
    expect(validateIsoDate("2026-02-31")).toBe(false);
    expect(() => parseArgs([], {}, CAPTURE_NOW)).toThrow(/full 40-hex SHA/);
    expect(() => parseArgs(["--candidate-sha", "abc123"], {}, CAPTURE_NOW)).toThrow(/full 40-hex SHA/);
    expect(() => parseArgs(["--candidate-sha", CANDIDATE_SHA, "--date", "2026-2-1"], {})).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--date",
      "2026-07-02",
      "--reviewed-at",
      "2026-07-02T12:00:00.000Z",
    ], {}, CAPTURE_NOW)).toThrow(/must not be in the future/);
    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--date",
      "2026-06-30",
      "--reviewer",
      REVIEWER,
      "--reviewed-at",
      "2026-06-30T12:00:00.000Z",
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/current UTC date/);
    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--date",
      DATE,
      "--repo",
      "example/not-diveo",
    ], {}, CAPTURE_NOW)).toThrow(/trusted Diveo repository/);
    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--date",
      DATE,
      "--reviewer",
      "reviewer",
      "--reviewed-at",
      "2026-07-01T12:00:00.000Z",
    ], {}, CAPTURE_NOW)).toThrow(/reviewer.*concrete/i);
    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--date",
      DATE,
      "--reviewed-at",
      "2026-07-01T12:00:00.000Z",
    ], {}, CAPTURE_NOW)).toThrow(/reviewer.*concrete/i);
    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--date",
      DATE,
      "--reviewer",
      "final-readiness-runner",
      "--reviewed-at",
      "2026-07-01T12:00:00.000Z",
    ], {}, CAPTURE_NOW)).toThrow(/reviewer.*concrete/i);
    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--date",
      DATE,
      "--reviewed-at",
      "2026-07-02T12:00:00.000Z",
    ], {}, CAPTURE_NOW)).toThrow(/final evidence date/);
  });

  it("rejects non-final or out-of-scope final receipt input paths before running helpers", () => {
    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--inventory-path",
      "docs/qa-evidence/2026-07-01/custom-inventory.json",
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/external-evidence-inventory\.json/);

    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--inventory-path",
      "docs/qa-evidence/2026-07-01/external-evidence-inventory-scaffold.json",
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/reviewed final file/);

    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--packet-path",
      "docs/qa-evidence/2026-07-01/device-evidence-packet-candidate.json",
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/reviewed final file/);

    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--stack-receipt-path",
      "docs/qa-evidence/2026-07-01/stack-architecture-receipt-candidate.json",
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/reviewed final file/);

    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--stack-receipt-path",
      "docs/qa-evidence/2026-07-01/custom-stack-receipt.json",
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/stack-architecture-receipt\.json/);

    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--inventory-path",
      "docs/qa-evidence/2026-07-02/external-evidence-inventory.json",
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/docs\/qa-evidence\/2026-07-01/);

    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--packet-path",
      "docs/qa-evidence/2026-07-01/review/device-evidence-packet-reviewed.json",
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/directly under docs\/qa-evidence\/2026-07-01/);

    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--inventory-path",
      "../external-evidence-inventory.json",
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/inside the repository root/);

    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--qa-path",
      path.resolve("docs/GSAV_NATIVE_QA.md"),
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/--qa-path must be repository-relative/);

    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--qa-path",
      "docs/custom-qa.md",
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/docs\/GSAV_NATIVE_QA\.md/);

    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--evidence-dir",
      "docs/qa-evidence/2026-07-01/custom-receipts",
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/final-command-receipts/);

    expect(() => parseArgs([
      "--candidate-sha",
      CANDIDATE_SHA,
      "--evidence-dir",
      "docs/qa-evidence/2026-07-01/final-command-receipts-template",
    ], DEFAULT_ENV, CAPTURE_NOW)).toThrow(/final-command-receipts/);
  });

  it("builds the final command sequence with explicit packet and inventory inputs", () => {
    const options = parseArgs(["--candidate-sha", CANDIDATE_SHA], DEFAULT_ENV, CAPTURE_NOW);
    const steps = finalReceiptSteps(options);

    expect(steps.map((step) => step.label)).toEqual(FINAL_RECEIPT_EXPECTED_STEP_LABELS);
    expect(steps.find((step) => step.label === "Final readiness focused tests").args)
      .toEqual(["node_modules/vitest/vitest.mjs", "run", ...FINAL_FOCUSED_TESTS]);
    expect(steps.find((step) => step.label === "External evidence inventory replay").args)
      .toEqual([
        "scripts/verify-external-evidence-inventory.js",
        "--inventory-path",
        INVENTORY_PATH,
        "--qa-path",
        "docs/GSAV_NATIVE_QA.md",
        "--packet-path",
        PACKET_PATH,
        "--require-git-integrity",
      ]);
    expect(steps.find((step) => step.label === "Device packet reconciliation").args)
      .toEqual([
        "scripts/device-evidence-packet.js",
        "--check",
        "--input-path",
        PACKET_PATH,
        "--qa-path",
        "docs/GSAV_NATIVE_QA.md",
        "--candidate-sha",
        CANDIDATE_SHA,
        "--require-git-integrity",
      ]);
    expect(steps.find((step) => step.label === "Strict handoff receipt replay").args)
      .toEqual([
        "scripts/verify-handoff-receipts.js",
        "--date",
        DATE,
        "--require-git-integrity",
      ]);
    expect(steps.find((step) => step.label === "Stack architecture receipt replay").args)
      .toEqual([
        "scripts/stack-architecture-receipt.js",
        "--require-assets",
        "--verify",
        STACK_RECEIPT_PATH,
      ]);
    expect(steps.find((step) => step.label === "Protected master ref refresh"))
      .toMatchObject({
        command: "git",
        args: ["fetch", "--no-tags", "origin", "master"],
      });
    expect(steps.find((step) => step.label === "Protected candidate ancestry proof"))
      .toMatchObject({
        command: "git",
        args: ["merge-base", "--is-ancestor", CANDIDATE_SHA, "origin/master"],
      });
    expect(steps.find((step) => step.label === "Last-mile GitHub release-state evidence"))
      .toMatchObject({
        command: "node",
        args: [
          "scripts/capture-github-release-state-evidence.js",
          "--repo",
          "OpsiClear-Web/diveo",
          "--output-path",
          `${EVIDENCE_DIR}/github-release-state-prepublish-live.json`,
          "--reviewer",
          REVIEWER,
          "--reviewed-at",
          "2026-07-01T12:00:00.000Z",
        ],
        expectedStatus: 0,
      });
    expect(steps.find((step) => step.label === "Last-mile publish-hash variable guard"))
      .toMatchObject({
        command: "node",
        args: [
          "scripts/capture-publish-hash-variable-guard.js",
          "--repo",
          "OpsiClear-Web/diveo",
          "--output-path",
          `${EVIDENCE_DIR}/publish-hash-variable-guard-prepublish-live.json`,
          "--reviewer",
          REVIEWER,
          "--reviewed-at",
          "2026-07-01T12:00:00.000Z",
        ],
        expectedStatus: 0,
      });
    expect(steps.at(-1)).toMatchObject({
      args: ["scripts/verify-release-readiness.js", "--strict-final-inputs"],
      expectedStatus: 0,
      env: {
        EXTERNAL_EVIDENCE_INVENTORY_PATH: INVENTORY_PATH,
        [FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV]: `${EVIDENCE_DIR}/verification-summary.json`,
        DEVICE_EVIDENCE_PACKET_PATH: PACKET_PATH,
        RELEASE_CANDIDATE_SHA: CANDIDATE_SHA,
      },
    });
  });

  it("writes a receipt manifest and per-step logs", () => {
    withTempCwd((tmp) => {
      const options = parseArgs([
        "--candidate-sha",
        CANDIDATE_SHA,
        "--date",
        DATE,
        "--reviewer",
        REVIEWER,
        "--reviewed-at",
        "2026-07-01T12:00:00.000Z",
      ], DEFAULT_ENV, CAPTURE_NOW);
      const calls = [];
      const result = runFinalReadinessReceipts(options, {
        runCommand: (command, args, runOptions) => {
          calls.push({ command, args, env: runOptions.env ?? null });
          if (args[0] === "scripts/capture-github-release-state-evidence.js"
            || args[0] === "scripts/capture-publish-hash-variable-guard.js") {
            writeLiveOutputForStep(args);
          }
          return {
            status: 0,
            stdout: `ok ${args.join(" ")}\n`,
            stderr: "",
          };
        },
        write: () => {},
        baseEnv: {
          npm_config_user_agent: "npm/11.9.0 node/v24.14.0",
          SECRET_VALUE: "do-not-record",
        },
      });

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(11);
      expect(calls.at(-1).env).toMatchObject({
        EXTERNAL_EVIDENCE_INVENTORY_PATH: INVENTORY_PATH,
        [FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV]: `${EVIDENCE_DIR}/verification-summary.json`,
        DEVICE_EVIDENCE_PACKET_PATH: PACKET_PATH,
        RELEASE_CANDIDATE_SHA: CANDIDATE_SHA,
      });

      const summary = JSON.parse(fs.readFileSync(path.join(tmp, EVIDENCE_DIR, "verification-summary.json"), "utf8"));
      expect(summary).toMatchObject({
        mode: FINAL_RECEIPT_MODE,
        ok: true,
        status: "pass",
        inputs: {
          date: DATE,
          candidateSha: CANDIDATE_SHA,
          inventoryPath: INVENTORY_PATH,
          packetPath: PACKET_PATH,
          stackReceiptPath: STACK_RECEIPT_PATH,
          qaPath: "docs/GSAV_NATIVE_QA.md",
          evidenceDir: EVIDENCE_DIR,
          expectReadinessStatus: 0,
          protectedRef: "origin/master",
          lastMileReleaseStateLivePath: `${EVIDENCE_DIR}/github-release-state-prepublish-live.json`,
          lastMilePublishHashGuardLivePath: `${EVIDENCE_DIR}/publish-hash-variable-guard-prepublish-live.json`,
        },
        publishSignoffReady: true,
        noPublishRehearsal: false,
      });
      expect(summary.steps).toHaveLength(11);
      expect(summary.steps.find((step) => step.label === "Strict handoff receipt replay")).toMatchObject({
        command: `node scripts/verify-handoff-receipts.js --date ${DATE} --require-git-integrity`,
        expectedStatus: 0,
      });
      expect(summary.steps.find((step) => step.label === "Stack architecture receipt replay")).toMatchObject({
        command: `node scripts/stack-architecture-receipt.js --require-assets --verify ${STACK_RECEIPT_PATH}`,
        expectedStatus: 0,
      });
      expect(summary.steps.find((step) => step.label === "Protected candidate ancestry proof")).toMatchObject({
        command: `git merge-base --is-ancestor ${CANDIDATE_SHA} origin/master`,
        expectedStatus: 0,
      });
      expect(summary.steps.find((step) => step.label === "Last-mile GitHub release-state evidence")).toMatchObject({
        command: `node scripts/capture-github-release-state-evidence.js --repo OpsiClear-Web/diveo --output-path ${EVIDENCE_DIR}/github-release-state-prepublish-live.json --reviewer ${REVIEWER} --reviewed-at 2026-07-01T12:00:00.000Z`,
        expectedStatus: 0,
        status: 0,
      });
      expect(summary.steps.find((step) => step.label === "Last-mile publish-hash variable guard")).toMatchObject({
        command: `node scripts/capture-publish-hash-variable-guard.js --repo OpsiClear-Web/diveo --output-path ${EVIDENCE_DIR}/publish-hash-variable-guard-prepublish-live.json --reviewer ${REVIEWER} --reviewed-at 2026-07-01T12:00:00.000Z`,
        expectedStatus: 0,
        status: 0,
      });
      const readinessStep = summary.steps.find((step) => step.label === "Final release readiness");
      expect(readinessStep.env).toEqual({
        EXTERNAL_EVIDENCE_INVENTORY_PATH: INVENTORY_PATH,
        [FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV]: `${EVIDENCE_DIR}/verification-summary.json`,
        DEVICE_EVIDENCE_PACKET_PATH: PACKET_PATH,
        RELEASE_CANDIDATE_SHA: CANDIDATE_SHA,
      });
      expect(readinessStep.env.SECRET_VALUE).toBeUndefined();
      expect(readinessStep.stdoutSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fs.existsSync(path.join(tmp, EVIDENCE_DIR, readinessStep.stdoutPath))).toBe(true);
    });
  });

  it("can record a no-publish rehearsal where final readiness is expected to fail", () => {
    withTempCwd((tmp) => {
      const options = parseArgs([
        "--candidate-sha",
        CANDIDATE_SHA,
        "--date",
        DATE,
        "--reviewer",
        REVIEWER,
        "--reviewed-at",
        "2026-07-01T12:00:00.000Z",
        "--expect-readiness-fail",
      ], DEFAULT_ENV, CAPTURE_NOW);
      const result = runFinalReadinessReceipts(options, {
        runCommand: (_command, args) => {
          if (args[0] === "scripts/capture-github-release-state-evidence.js") {
            writeLiveOutputForStep(args, {
              status: "no-publish",
              ok: false,
              releaseReadinessImpact: {
                status: "no-publish",
              },
            });
          } else if (args[0] === "scripts/capture-publish-hash-variable-guard.js") {
            writeLiveOutputForStep(args);
          }
          return {
            status: (
              args[0] === "scripts/capture-github-release-state-evidence.js"
              || args[0] === "scripts/verify-release-readiness.js"
            ) ? 1 : 0,
            stdout: "",
            stderr: "",
          };
        },
        write: () => {},
      });

      expect(result.ok).toBe(true);
      const summary = JSON.parse(fs.readFileSync(path.join(tmp, EVIDENCE_DIR, "verification-summary.json"), "utf8"));
      expect(summary).toMatchObject({
        status: "expected-readiness-fail",
        publishSignoffReady: false,
        noPublishRehearsal: true,
      });
      expect(summary.inputs.expectReadinessStatus).toBe(1);
      expect(summary.steps.find((step) => step.label === "Last-mile GitHub release-state evidence")).toMatchObject({
        status: 1,
        expectedStatus: 1,
      });
      expect(summary.steps.at(-1)).toMatchObject({
        label: "Final release readiness",
        status: 1,
        expectedStatus: 1,
      });
    });
  });

  it("uses distinct success messages for publish-ready receipts and no-publish rehearsals", () => {
    expect(finalReceiptSuccessMessage({
      steps: [{ label: "planned step count must not be used" }],
      evidenceSummary: {
        noPublishRehearsal: false,
        steps: recordedFinalSteps(),
      },
    })).toBe("\nFinal readiness receipt bundle passed (11 recorded steps).");
    expect(finalReceiptSuccessMessage({
      steps: [{ label: "planned step count must not be used" }],
      evidenceSummary: {
        noPublishRehearsal: true,
        steps: recordedFinalSteps(),
      },
    })).toBe("\nFinal readiness no-publish rehearsal completed (11 recorded steps).");
  });

  it("refuses to report success from planned steps when recorded evidence is incomplete", () => {
    expect(() => finalReceiptSuccessMessage({
      steps: recordedFinalSteps(),
      evidenceSummary: {
        noPublishRehearsal: false,
        steps: recordedFinalSteps().slice(0, -1),
      },
    })).toThrow(/complete recorded step evidence/);
  });

  it("rejects a passing wrapper summary when recorded step evidence is incomplete", () => {
    withTempCwd((tmp) => {
      const options = parseArgs([
        "--candidate-sha",
        CANDIDATE_SHA,
        "--date",
        DATE,
        "--reviewer",
        REVIEWER,
        "--reviewed-at",
        "2026-07-01T12:00:00.000Z",
      ], DEFAULT_ENV, CAPTURE_NOW);
      const result = runFinalReadinessReceipts(options, {
        buildSteps: (runtimeOptions) => finalReceiptSteps(runtimeOptions)
          .filter((step) => step.label !== "Final release readiness"),
        runCommand: (_command, args) => {
          if (args[0] === "scripts/capture-github-release-state-evidence.js"
            || args[0] === "scripts/capture-publish-hash-variable-guard.js") {
            writeLiveOutputForStep(args);
          }
          return {
            status: 0,
            stdout: "",
            stderr: "",
          };
        },
        write: () => {},
      });

      const expectedProblem = `Final receipt wrapper summary must include exactly the ${FINAL_RECEIPT_EXPECTED_STEP_LABELS.length} final receipt wrapper steps in order: ${FINAL_RECEIPT_EXPECTED_STEP_LABELS.join("; ")}.`;
      expect(result.ok).toBe(false);
      expect(result.failed).toMatchObject({
        step: {
          label: "Final receipt wrapper step set",
          status: 1,
          expectedStatus: 0,
        },
        outputProblems: [expectedProblem],
      });
      expect(finalReceiptStepSetProblem([{ label: "Documentation drift audit" }])).toBe(expectedProblem);

      const summary = JSON.parse(fs.readFileSync(path.join(tmp, EVIDENCE_DIR, "verification-summary.json"), "utf8"));
      expect(summary).toMatchObject({
        ok: false,
        status: "fail",
        failedStep: {
          label: "Final receipt wrapper step set",
          status: 1,
          expectedStatus: 0,
        },
        outputProblems: [expectedProblem],
      });
      expect(summary.publishSignoffReady).toBe(false);
      expect(summary.steps.map((step) => step.label)).not.toEqual(FINAL_RECEIPT_EXPECTED_STEP_LABELS);
    });
  });

  it("fails the receipt bundle when final readiness exits unexpectedly", () => {
    withTempCwd((tmp) => {
      const options = parseArgs([
        "--candidate-sha",
        CANDIDATE_SHA,
        "--date",
        DATE,
        "--reviewer",
        REVIEWER,
        "--reviewed-at",
        "2026-07-01T12:00:00.000Z",
      ], DEFAULT_ENV, CAPTURE_NOW);
      const result = runFinalReadinessReceipts(options, {
        runCommand: (_command, args) => {
          if (args[0] === "scripts/capture-github-release-state-evidence.js"
            || args[0] === "scripts/capture-publish-hash-variable-guard.js") {
            writeLiveOutputForStep(args);
          }
          return {
            status: args[0] === "scripts/verify-release-readiness.js" ? 1 : 0,
            stdout: "",
            stderr: "",
          };
        },
        write: () => {},
      });

      expect(result.ok).toBe(false);
      expect(result.failed.step.label).toBe("Final release readiness");
      const summary = JSON.parse(fs.readFileSync(path.join(tmp, EVIDENCE_DIR, "verification-summary.json"), "utf8"));
      expect(summary).toMatchObject({
        status: "fail",
        failedStep: {
          label: "Final release readiness",
          status: 1,
          expectedStatus: 0,
        },
      });
    });
  });

  it("fails before final readiness when a live last-mile step omits its output JSON", () => {
    withTempCwd((tmp) => {
      const options = parseArgs([
        "--candidate-sha",
        CANDIDATE_SHA,
        "--date",
        DATE,
        "--reviewer",
        REVIEWER,
        "--reviewed-at",
        "2026-07-01T12:00:00.000Z",
      ], DEFAULT_ENV, CAPTURE_NOW);
      const calls = [];
      const result = runFinalReadinessReceipts(options, {
        runCommand: (command, args) => {
          calls.push({ command, args });
          return {
            status: 0,
            stdout: "",
            stderr: "",
          };
        },
        write: () => {},
      });

      expect(result.ok).toBe(false);
      expect(result.failed.step.label).toBe("Last-mile GitHub release-state evidence");
      expect(result.failed.outputProblems).toEqual([
        `Last-mile GitHub release-state evidence did not create ${EVIDENCE_DIR}/github-release-state-prepublish-live.json`,
      ]);
      expect(calls.map((call) => call.args[0])).not.toContain("scripts/verify-release-readiness.js");
      const summary = JSON.parse(fs.readFileSync(path.join(tmp, EVIDENCE_DIR, "verification-summary.json"), "utf8"));
      expect(summary).toMatchObject({
        status: "fail",
        failedStep: {
          label: "Last-mile GitHub release-state evidence",
          status: 0,
          expectedStatus: 0,
        },
        outputProblems: [
          `Last-mile GitHub release-state evidence did not create ${EVIDENCE_DIR}/github-release-state-prepublish-live.json`,
        ],
      });
    });
  });

  it("does not accept stale live last-mile JSON from an earlier run", () => {
    withTempCwd((tmp) => {
      const options = parseArgs([
        "--candidate-sha",
        CANDIDATE_SHA,
        "--date",
        DATE,
        "--reviewer",
        REVIEWER,
        "--reviewed-at",
        "2026-07-01T12:00:00.000Z",
      ], DEFAULT_ENV, CAPTURE_NOW);
      const stalePath = path.join(tmp, EVIDENCE_DIR, "github-release-state-prepublish-live.json");
      fs.mkdirSync(path.dirname(stalePath), { recursive: true });
      fs.writeFileSync(stalePath, `${JSON.stringify({ status: "pass", ok: true, stale: true }, null, 2)}\n`);

      const result = runFinalReadinessReceipts(options, {
        runCommand: () => ({
          status: 0,
          stdout: "",
          stderr: "",
        }),
        write: () => {},
      });

      expect(result.ok).toBe(false);
      expect(result.failed.step.label).toBe("Last-mile GitHub release-state evidence");
      expect(result.failed.outputProblems).toEqual([
        `Last-mile GitHub release-state evidence did not create ${EVIDENCE_DIR}/github-release-state-prepublish-live.json`,
      ]);
      expect(fs.existsSync(stalePath)).toBe(false);
      const summary = JSON.parse(fs.readFileSync(path.join(tmp, EVIDENCE_DIR, "verification-summary.json"), "utf8"));
      expect(summary.outputProblems).toEqual([
        `Last-mile GitHub release-state evidence did not create ${EVIDENCE_DIR}/github-release-state-prepublish-live.json`,
      ]);
    });
  });

  it("fails before final readiness when a publish-ready live last-mile JSON is not ready", () => {
    withTempCwd((tmp) => {
      const options = parseArgs([
        "--candidate-sha",
        CANDIDATE_SHA,
        "--date",
        DATE,
        "--reviewer",
        REVIEWER,
        "--reviewed-at",
        "2026-07-01T12:00:00.000Z",
      ], DEFAULT_ENV, CAPTURE_NOW);
      const calls = [];
      const result = runFinalReadinessReceipts(options, {
        runCommand: (_command, args) => {
          calls.push(args[0]);
          if (args[0] === "scripts/capture-github-release-state-evidence.js") {
            writeLiveOutputForStep(args, {
              status: "no-publish",
              ok: false,
              releaseReadinessImpact: {
                status: "no-publish",
              },
            });
          }
          return {
            status: 0,
            stdout: "",
            stderr: "",
          };
        },
        write: () => {},
      });

      expect(result.ok).toBe(false);
      expect(result.failed.step.label).toBe("Last-mile GitHub release-state evidence");
      expect(result.failed.outputProblems).toEqual([
        `Last-mile GitHub release-state evidence output ${EVIDENCE_DIR}/github-release-state-prepublish-live.json must report status=pass and ok=true`,
      ]);
      expect(calls).not.toContain("scripts/verify-release-readiness.js");
      const summary = JSON.parse(fs.readFileSync(path.join(tmp, EVIDENCE_DIR, "verification-summary.json"), "utf8"));
      expect(summary.outputProblems).toEqual([
        `Last-mile GitHub release-state evidence output ${EVIDENCE_DIR}/github-release-state-prepublish-live.json must report status=pass and ok=true`,
      ]);
    });
  });

  it("fails before final readiness when live last-mile JSON metadata does not match inputs", () => {
    withTempCwd((tmp) => {
      const options = parseArgs([
        "--candidate-sha",
        CANDIDATE_SHA,
        "--date",
        DATE,
        "--reviewer",
        REVIEWER,
        "--reviewed-at",
        "2026-07-01T12:00:00.000Z",
      ], DEFAULT_ENV, CAPTURE_NOW);
      const calls = [];
      const result = runFinalReadinessReceipts(options, {
        runCommand: (_command, args) => {
          calls.push(args[0]);
          if (args[0] === "scripts/capture-github-release-state-evidence.js") {
            writeLiveOutputForStep(args, {
              repository: "opsiclear/diveo",
            });
          }
          return {
            status: 0,
            stdout: "",
            stderr: "",
          };
        },
        write: () => {},
      });

      expect(result.ok).toBe(false);
      expect(result.failed.step.label).toBe("Last-mile GitHub release-state evidence");
      expect(result.failed.outputProblems).toEqual([
        `Last-mile GitHub release-state evidence output ${EVIDENCE_DIR}/github-release-state-prepublish-live.json repository must match final receipt inputs.repository`,
      ]);
      expect(calls).not.toContain("scripts/verify-release-readiness.js");
      const summary = JSON.parse(fs.readFileSync(path.join(tmp, EVIDENCE_DIR, "verification-summary.json"), "utf8"));
      expect(summary.outputProblems).toEqual([
        `Last-mile GitHub release-state evidence output ${EVIDENCE_DIR}/github-release-state-prepublish-live.json repository must match final receipt inputs.repository`,
      ]);
    });
  });

  it("fails before final readiness when strict handoff receipts are missing", () => {
    withTempCwd((tmp) => {
      const options = parseArgs([
        "--candidate-sha",
        CANDIDATE_SHA,
        "--date",
        DATE,
        "--reviewer",
        REVIEWER,
        "--reviewed-at",
        "2026-07-01T12:00:00.000Z",
      ], DEFAULT_ENV, CAPTURE_NOW);
      const calls = [];
      const result = runFinalReadinessReceipts(options, {
        runCommand: (command, args) => {
          calls.push({ command, args });
          return {
            status: args.includes("scripts/verify-handoff-receipts.js") ? 1 : 0,
            stdout: "",
            stderr: "",
          };
        },
        write: () => {},
      });

      expect(result.ok).toBe(false);
      expect(result.failed.step.label).toBe("Strict handoff receipt replay");
      expect(calls.map((call) => call.args[0])).not.toContain("scripts/verify-release-readiness.js");
      const summary = JSON.parse(fs.readFileSync(path.join(tmp, EVIDENCE_DIR, "verification-summary.json"), "utf8"));
      expect(summary).toMatchObject({
        status: "fail",
        failedStep: {
          label: "Strict handoff receipt replay",
          status: 1,
          expectedStatus: 0,
        },
      });
    });
  });
});
