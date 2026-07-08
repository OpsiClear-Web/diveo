import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import bundleModule from "./run-verification-bundle.js";

const {
  EXPECTED_HANDOFF_BLOCKER_IDS,
  EXPECTED_NO_PUBLISH_DEVICE_PENDING_PACKETS,
  EXPECTED_NO_PUBLISH_MISSING_ROWS,
  EXPECTED_NO_PUBLISH_PENDING_ROWS,
  EXPECTED_RELEASE_READINESS_CHECKED,
  FULL_COMMIT_SHA_PATTERN,
  NO_PUBLISH_BASELINE_INVALID_AFTER,
  NO_PUBLISH_BASELINE_PHASE,
  NO_PUBLISH_BASELINE_SCOPE,
  PLACEHOLDER_PRODUCTION_ENV,
  QA_ONLY_ENV_KEYS,
  PRODUCTION_ENV_KEYS,
  acquireEvidenceDirLock,
  bundleForMode,
  cleanupGeneratedEvidenceFiles,
  commandName,
  commandLine,
  createCoverageReportsDirectory,
  evidenceEnvForStep,
  envForStep,
  expectedJsonProblems,
  outputProblems,
  parseArgs,
  parseJsonFromOutput,
  runBundle,
  runStep,
  safeRunLabel,
  sha256Text,
  stepWithRuntimeArgs,
  validEvidenceDate,
} = bundleModule;

const CANDIDATE_SHA = "3d243f51497982d1c741e28d7f6ed2e90c99ba50";
const HANDOFF_EVIDENCE_DATE = "2026-07-01";

function handoffReceiptPaths(date = HANDOFF_EVIDENCE_DATE) {
  return {
    ownerReceiptPath: `docs/qa-evidence/${date}/owner-assignment.json`,
    fixtureManifestPath: `docs/qa-evidence/${date}/fixture-manifest.json`,
    hostReadyPath: `docs/qa-evidence/${date}/gsav-host-ready.json`,
  };
}

function checkedHandoffReceiptPaths(paths = handoffReceiptPaths(), status = "missing") {
  return {
    ownerAssignment: {
      path: paths.ownerReceiptPath,
      status,
    },
    fixtureManifest: {
      path: paths.fixtureManifestPath,
      status,
    },
    hostReady: {
      path: paths.hostReadyPath,
      status,
    },
  };
}

function handoffReceiptBlockers(ids = EXPECTED_HANDOFF_BLOCKER_IDS, paths = handoffReceiptPaths()) {
  const pathById = {
    "owner-assignment-receipt": paths.ownerReceiptPath,
    "fixture-manifest": paths.fixtureManifestPath,
    "gsav-host-ready-receipt": paths.hostReadyPath,
  };
  return ids.map((id) => ({
    id,
    kind: "missing",
    path: pathById[id],
  }));
}

function noPublishBaselineHandoffReceipts(overrides = {}) {
  const paths = handoffReceiptPaths();
  return {
    status: "blocked",
    allowPending: true,
    blockerIds: [...EXPECTED_HANDOFF_BLOCKER_IDS],
    receiptPaths: { ...paths },
    expectedReceiptPaths: { ...paths },
    checked: checkedHandoffReceiptPaths(paths),
    ...overrides,
  };
}

describe("verification bundle runner", () => {
  it("parses supported bundle modes", () => {
    expect(parseArgs([])).toEqual({ mode: "local", evidenceDir: null, candidateSha: null, evidenceDate: null });
    expect(parseArgs(["local"])).toEqual({ mode: "local", evidenceDir: null, candidateSha: null, evidenceDate: null });
    expect(parseArgs(["release-candidate"])).toEqual({ mode: "release-candidate", evidenceDir: null, candidateSha: null, evidenceDate: null });
    expect(parseArgs(["release-candidate", "--evidence-dir", "docs/qa-evidence/2026-07-01/local"]))
      .toEqual({ mode: "release-candidate", evidenceDir: "docs/qa-evidence/2026-07-01/local", candidateSha: null, evidenceDate: null });
    expect(parseArgs(["--evidence-dir", "docs/qa-evidence/2026-07-01/local"]))
      .toEqual({ mode: "local", evidenceDir: "docs/qa-evidence/2026-07-01/local", candidateSha: null, evidenceDate: null });
    expect(parseArgs(["release-candidate", "--candidate-sha", CANDIDATE_SHA]))
      .toEqual({ mode: "release-candidate", evidenceDir: null, candidateSha: CANDIDATE_SHA, evidenceDate: null });
    expect(parseArgs(["release-candidate", "--release-candidate-sha", CANDIDATE_SHA]))
      .toEqual({ mode: "release-candidate", evidenceDir: null, candidateSha: CANDIDATE_SHA, evidenceDate: null });
    expect(parseArgs(["release-candidate", "--date", HANDOFF_EVIDENCE_DATE]))
      .toEqual({ mode: "release-candidate", evidenceDir: null, candidateSha: null, evidenceDate: HANDOFF_EVIDENCE_DATE });
    expect(parseArgs(["release-candidate", "--evidence-date", HANDOFF_EVIDENCE_DATE]))
      .toEqual({ mode: "release-candidate", evidenceDir: null, candidateSha: null, evidenceDate: HANDOFF_EVIDENCE_DATE });
    expect(FULL_COMMIT_SHA_PATTERN.test(CANDIDATE_SHA)).toBe(true);
    expect(validEvidenceDate(HANDOFF_EVIDENCE_DATE)).toBe(true);
    expect(validEvidenceDate("2026-02-31")).toBe(false);
    expect(() => parseArgs(["unknown"])).toThrow(/Usage:/);
    expect(() => parseArgs(["local", "--evidence-dir"])).toThrow(/Usage:/);
    expect(() => parseArgs(["release-candidate", "--candidate-sha", "abc1234"])).toThrow(/full 40-hex/);
    expect(() => parseArgs(["local", "--candidate-sha", CANDIDATE_SHA])).toThrow(/only valid/);
    expect(() => parseArgs(["local", "--date", HANDOFF_EVIDENCE_DATE])).toThrow(/only valid/);
    expect(() => parseArgs(["release-candidate", "--date", "2026-02-31"])).toThrow(/YYYY-MM-DD/);
  });

  it("builds the local bundle in the documented order", () => {
    const labels = bundleForMode("local").map((step) => step.label);

    expect(labels).toEqual([
      "Type-check",
      "Lint",
      "Dependency audit disposition",
      "Environment example audit",
      "Workflow audit",
      "Import boundary audit",
      "Bridge origin contract audit",
      "Documentation drift audit",
      "Unit tests",
      "Coverage",
      "Whitespace check",
    ]);
    expect(bundleForMode("local").find((step) => step.label === "Environment example audit"))
      .toMatchObject({ command: "node", args: ["scripts/verify-env-examples.js"] });
    expect(bundleForMode("local").find((step) => step.label === "Bridge origin contract audit"))
      .toMatchObject({ command: "node", args: ["scripts/verify-bridge-origin-contract.js"] });
    expect(bundleForMode("local").find((step) => step.label === "Whitespace check"))
      .toMatchObject({ command: "node", args: ["scripts/verify-whitespace.js"] });
  });

  it("adds production-config and focused verifier checks for release candidates", () => {
    const steps = bundleForMode("release-candidate");
    const labels = steps.map((step) => step.label);

    expect(labels).toContain("Native production config negative");
    expect(labels).toContain("Native production config positive");
    expect(labels).toContain("Focused release verifier tests");
    expect(labels).toContain("Handoff receipts expected blockers");
    expect(labels).toContain("No-publish baseline verifier");
    expect(labels).toContain("Release readiness expected blockers");
    expect(steps.find((step) => step.label === "Native production config negative").expectedStatus).toBe(1);
    expect(steps.find((step) => step.label === "Release readiness expected blockers").expectedStatus).toBe(1);
    expect(steps.find((step) => step.label === "Native production config negative").expectedOutputIncludes)
      .toContain("Production must provide EXPO_PUBLIC_GSAV_WEB_URL");
    expect(steps.find((step) => step.label === "Native production config positive").expectedOutputIncludes)
      .toContain('"capturesGsavHostIdentity": true');
    expect(steps.find((step) => step.label === "Native production config positive").expectedOutputIncludes)
      .toContain('"verifiesReleaseEvidenceMode": true');
    expect(steps.find((step) => step.label === "Native production config positive").expectedOutputIncludes)
      .toContain('"resolvesFrozenPayloadCandidate": true');
    expect(steps.find((step) => step.label === "Native production config positive").expectedOutputIncludes)
      .toContain('"verifiesEvidenceSignoffDiff": true');
    expect(steps.find((step) => step.label === "Native production config positive").expectedOutputIncludes)
      .toContain('"verifiesSignoffDiffBundleContents": true');
    expect(steps.find((step) => step.label === "Native production config positive").expectedOutputIncludes)
      .toContain('"hasReleaseVersionBumpInWorkflow": false');
    expect(steps.find((step) => step.label === "Native production config positive").expectedOutputIncludes)
      .toContain('"releaseWorkflowForbidsQaFlags": true');
    expect(steps.find((step) => step.label === "Native production config positive").expectedOutputIncludes)
      .toContain('"qaControlsDisabled": true');
    expect(steps.find((step) => step.label === "Native production config positive").expectedOutputIncludes)
      .toContain('"qaAuthDelayDisabled": true');
    expect(steps.find((step) => step.label === "Focused release verifier tests").args)
      .toContain("scripts/verify-whitespace.test.mjs");
    expect(steps.find((step) => step.label === "Focused release verifier tests").args)
      .toContain("scripts/verify-env-examples.test.mjs");
    expect(steps.find((step) => step.label === "Focused release verifier tests").args)
      .toContain("scripts/verify-bridge-origin-contract.test.mjs");
    expect(steps.find((step) => step.label === "Focused release verifier tests").args)
      .toEqual(expect.arrayContaining([
        "scripts/materialize-ios-validation-artifact.test.mjs",
        "scripts/capture-branch-protection-evidence.test.mjs",
        "scripts/capture-github-release-state-evidence.test.mjs",
        "scripts/capture-publish-hash-variable-guard.test.mjs",
        "scripts/device-evidence-packet.test.mjs",
        "scripts/verify-handoff-receipts.test.mjs",
        "scripts/verify-no-publish-baseline.test.mjs",
      ]));
    expect(steps.find((step) => step.label === "Handoff receipts expected blockers"))
      .toMatchObject({
        command: "node",
        args: ["scripts/verify-handoff-receipts.js", "--allow-pending"],
        expectedJson: "handoff-receipts",
      });
    expect(steps.find((step) => step.label === "No-publish baseline verifier"))
      .toMatchObject({
        command: "node",
        args: ["scripts/verify-no-publish-baseline.js"],
        expectedOutputIncludes: expect.arrayContaining([
          `"scope": "${NO_PUBLISH_BASELINE_SCOPE}"`,
        ]),
        expectedJson: "no-publish-baseline",
      });
  });

  it("pins the no-publish baseline and release-readiness expected blocker steps when a candidate SHA is provided", () => {
    const steps = bundleForMode("release-candidate", { candidateSha: CANDIDATE_SHA });
    const readinessStep = steps.find((step) => step.label === "Release readiness expected blockers");
    const baselineStep = steps.find((step) => step.label === "No-publish baseline verifier");

    expect(readinessStep).toMatchObject({
      command: "node",
      args: ["scripts/verify-release-readiness.js"],
      env: {
        RELEASE_CANDIDATE_SHA: CANDIDATE_SHA,
      },
      expectedStatus: 1,
      expectedJson: "release-readiness-pending-evidence",
    });
    expect(baselineStep.env).toEqual({ RELEASE_CANDIDATE_SHA: CANDIDATE_SHA });
    expect(bundleForMode("release-candidate")
      .find((step) => step.label === "No-publish baseline verifier").env)
      .toBeUndefined();
    expect(bundleForMode("release-candidate")
      .find((step) => step.label === "Release readiness expected blockers").env)
      .toBeUndefined();
  });

  it("passes an explicit evidence date into release-candidate handoff and no-publish steps", () => {
    const steps = bundleForMode("release-candidate", {
      candidateSha: CANDIDATE_SHA,
      evidenceDate: HANDOFF_EVIDENCE_DATE,
    });
    const handoffStep = steps.find((step) => step.label === "Handoff receipts expected blockers");
    const baselineStep = steps.find((step) => step.label === "No-publish baseline verifier");
    const readinessStep = steps.find((step) => step.label === "Release readiness expected blockers");

    expect(handoffStep).toMatchObject({
      args: ["scripts/verify-handoff-receipts.js", "--allow-pending", "--date", HANDOFF_EVIDENCE_DATE],
      env: {
        EVIDENCE_DATE: HANDOFF_EVIDENCE_DATE,
      },
    });
    expect(baselineStep).toMatchObject({
      args: ["scripts/verify-no-publish-baseline.js", "--date", HANDOFF_EVIDENCE_DATE],
      env: {
        EVIDENCE_DATE: HANDOFF_EVIDENCE_DATE,
        RELEASE_CANDIDATE_SHA: CANDIDATE_SHA,
      },
    });
    expect(readinessStep).toMatchObject({
      args: ["scripts/verify-release-readiness.js"],
      env: {
        EVIDENCE_DATE: HANDOFF_EVIDENCE_DATE,
        RELEASE_CANDIDATE_SHA: CANDIDATE_SHA,
      },
    });
    expect(() => bundleForMode("local", { evidenceDate: HANDOFF_EVIDENCE_DATE })).toThrow(/only valid/);
  });

  it("uses shell-resolved command names across platforms", () => {
    expect(commandName("npm", "win32")).toBe("npm");
    expect(commandName("npx", "win32")).toBe("npx");
    expect(commandName("git", "win32")).toBe("git");
    expect(commandName("npm", "linux")).toBe("npm");
  });

  it("formats fixed Windows shell command lines", () => {
    expect(commandLine("npx", ["tsc", "--noEmit"])).toBe("npx tsc --noEmit");
    expect(commandLine("npm", ["test", "--", "scripts/a test.mjs"])).toBe("npm test -- \"scripts/a test.mjs\"");
  });

  it("builds isolated coverage report directories for bundle runs", () => {
    const first = createCoverageReportsDirectory({
      mode: "release-candidate",
      now: new Date("2026-07-01T07:00:00Z"),
      pid: 1234,
    });
    const second = createCoverageReportsDirectory({
      mode: "release-candidate",
      now: new Date("2026-07-01T07:00:00Z"),
      pid: 1234,
    });

    expect(safeRunLabel("release candidate")).toBe("release-candidate");
    expect(first).toContain(path.join("diveo-vitest-coverage", "release-candidate-1234-20260701T070000000Z-"));
    expect(second).toContain(path.join("diveo-vitest-coverage", "release-candidate-1234-20260701T070000000Z-"));
    expect(second).not.toBe(first);
  });

  it("passes an isolated coverage report directory only to the coverage step", () => {
    const coverageStep = bundleForMode("local").find((step) => step.label === "Coverage");
    const unitStep = bundleForMode("local").find((step) => step.label === "Unit tests");
    const coverageDir = path.join(os.tmpdir(), "diveo-coverage-test");

    expect(stepWithRuntimeArgs(unitStep, { coverageReportsDirectory: coverageDir }).args).toEqual(unitStep.args);
    expect(stepWithRuntimeArgs(coverageStep, { coverageReportsDirectory: coverageDir }).args).toEqual([
      ...coverageStep.args,
      "--coverage.reportsDirectory",
      coverageDir,
    ]);
  });

  it("clears or injects production config env per step", () => {
    const baseEnv = {
      EXPO_PUBLIC_GSAV_WEB_URL: "https://real.example.com",
      EXPO_PUBLIC_GSAV_CATALOG_URL: "https://real.example.com/catalog",
      EXPO_PUBLIC_GSAV_SUPABASE_URL: "https://supabase.real.example.com",
      EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: "real-key",
      EXPO_PUBLIC_GSAV_QA_CONTROLS: "1",
      EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "5000",
      KEEP_ME: "1",
    };

    const negative = envForStep({ envMode: "without-production-config" }, baseEnv);
    for (const key of PRODUCTION_ENV_KEYS) {
      expect(negative[key]).toBeUndefined();
    }
    for (const key of QA_ONLY_ENV_KEYS) {
      expect(negative[key]).toBeUndefined();
    }
    expect(negative.KEEP_ME).toBe("1");

    const positive = envForStep({ envMode: "placeholder-production-config" }, baseEnv);
    expect(positive).toMatchObject(PLACEHOLDER_PRODUCTION_ENV);
    expect(positive.KEEP_ME).toBe("1");

    const pinned = envForStep({ env: { RELEASE_CANDIDATE_SHA: CANDIDATE_SHA } }, baseEnv);
    expect(pinned.RELEASE_CANDIDATE_SHA).toBe(CANDIDATE_SHA);
    expect(pinned.KEEP_ME).toBe("1");
    expect(evidenceEnvForStep({ env: { RELEASE_CANDIDATE_SHA: CANDIDATE_SHA, SECRET_VALUE: "hidden" } }))
      .toEqual({ RELEASE_CANDIDATE_SHA: CANDIDATE_SHA });
  });

  it("stops at the first unexpected exit status", () => {
    const calls = [];
    const result = runBundle("local", {
      platform: "linux",
      runCommand: (command, args) => {
        calls.push([command, ...args]);
        return { status: calls.length === 2 ? 2 : 0 };
      },
      write: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.failed.step.label).toBe("Lint");
    expect(calls).toHaveLength(2);
  });

  it("writes a local verification evidence manifest and per-step logs when requested", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diveo-verification-evidence-"));
    const coverageDir = path.join(os.tmpdir(), "diveo-coverage-evidence-test");
    const result = runBundle("local", {
      evidenceDir: tmp,
      coverageReportsDirectory: coverageDir,
      evidenceMetadata: {
        nodeVersion: "v-test",
        npmVersion: "npm-test",
        diveoCommit: "abc1234",
        gsavHostingCommit: "def5678",
      },
      runCommand: (_command, args) => ({
        status: 0,
        stdout: `stdout for ${args.join(" ")}\n`,
        stderr: "",
      }),
      write: () => {},
    });

    expect(result.ok).toBe(true);
    const summary = JSON.parse(fs.readFileSync(path.join(tmp, "verification-summary.json"), "utf8"));
    expect(summary).toMatchObject({
      mode: "local",
      ok: true,
      status: "pass",
      metadata: {
        nodeVersion: "v-test",
        npmVersion: "npm-test",
        diveoCommit: "abc1234",
        gsavHostingCommit: "def5678",
      },
    });
    expect(summary.steps).toHaveLength(bundleForMode("local").length);
    expect(summary.steps[0]).toMatchObject({
      index: 1,
      label: "Type-check",
      status: 0,
      expectedStatus: 0,
      stdoutPath: "01-type-check.stdout.log",
      stderrPath: "01-type-check.stderr.log",
    });
    const stdout = fs.readFileSync(path.join(tmp, summary.steps[0].stdoutPath), "utf8");
    const stderr = fs.readFileSync(path.join(tmp, summary.steps[0].stderrPath), "utf8");
    expect(stdout).toContain("stdout for node_modules/typescript/bin/tsc --noEmit");
    expect(stderr).toBe("");
    expect(summary.steps[0].stdoutSha256).toBe(sha256Text(stdout));
    expect(summary.steps[0].stderrSha256).toBe(sha256Text(stderr));
    expect(summary.steps[0].combinedSha256).toBe(sha256Text(`${stdout}${stderr}`));
    const coverageCommand = summary.steps.find((step) => step.label === "Coverage").command;
    expect(coverageCommand).toContain("--coverage.reportsDirectory");
    expect(coverageCommand).toContain(coverageDir);
  });

  it("records the candidate SHA and evidence date env overrides in release-candidate evidence", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diveo-verification-candidate-env-"));
    const steps = bundleForMode("release-candidate", {
      candidateSha: CANDIDATE_SHA,
      evidenceDate: HANDOFF_EVIDENCE_DATE,
    });
    let calls = 0;
    const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
    const result = runBundle("release-candidate", {
      candidateSha: CANDIDATE_SHA,
      evidenceDate: HANDOFF_EVIDENCE_DATE,
      evidenceDir: tmp,
      runCommand: (_command, _args) => ({
        status: (() => {
          const step = steps[calls];
          calls += 1;
          return step.expectedStatus ?? 0;
        })(),
        stdout: (() => {
          const step = steps[calls - 1];
          if (step.label === "Native production config negative") {
            return json({
              ok: false,
              status: "fail",
              errors: PRODUCTION_ENV_KEYS.map((key) => (
                `Production must provide ${key} in the environment or EAS production profile.`
              )),
              checked: {
                qualityVerifiesLocalBundle: true,
              },
            });
          }
          if (step.label === "Native production config positive") {
            return json({
              ok: true,
              status: "pass",
              gsavUrl: "https://gsav.example.com",
              capturesGeneratedApkMetadata: true,
              capturesGsavHostIdentity: true,
              verifiesReleaseEvidenceMode: true,
              resolvesFrozenPayloadCandidate: true,
              verifiesEvidenceSignoffDiff: true,
              verifiesSignoffDiffBundleContents: true,
              hasReleaseVersionBumpInWorkflow: false,
              releaseWorkflowForbidsQaFlags: true,
              qaControlsDisabled: true,
              qaAuthDelayDisabled: true,
              qualityVerifiesLocalBundle: true,
            });
          }
          if (step.label === "Handoff receipts expected blockers") {
            const paths = handoffReceiptPaths();
            return json({
              schemaVersion: "handoff-receipts/v1",
              ok: false,
              status: "blocked",
              evidenceDate: HANDOFF_EVIDENCE_DATE,
              allowPending: true,
              receiptPaths: paths,
              checked: checkedHandoffReceiptPaths(paths),
              blockers: handoffReceiptBlockers(EXPECTED_HANDOFF_BLOCKER_IDS, paths),
            });
          }
          if (step.label === "No-publish baseline verifier") {
            return json({
              ok: true,
              status: "pass",
              scope: NO_PUBLISH_BASELINE_SCOPE,
              lifecycle: {
                phase: NO_PUBLISH_BASELINE_PHASE,
                invalidAfter: NO_PUBLISH_BASELINE_INVALID_AFTER,
              },
              releaseReadiness: {
                ok: false,
                checked: EXPECTED_RELEASE_READINESS_CHECKED,
                missing: EXPECTED_NO_PUBLISH_PENDING_ROWS,
              },
              devicePacket: {
                pendingPackets: EXPECTED_NO_PUBLISH_DEVICE_PENDING_PACKETS,
              },
              sourceEvidence: {
                evidenceDate: HANDOFF_EVIDENCE_DATE,
                expectedCandidateSha: CANDIDATE_SHA,
                devicePacketReleaseCandidateSha: CANDIDATE_SHA,
              },
              handoffReceipts: noPublishBaselineHandoffReceipts(),
              controls: {
                branchProtectionReady: true,
                publishHashVariablesAbsent: true,
                releaseStateNoPublish: true,
                validationPrereqsBlocked: true,
                handoffReceiptsBlocked: true,
              },
            });
          }
          if (step.label === "Release readiness expected blockers") {
            return json({
              ok: false,
              status: "fail",
              checked: EXPECTED_RELEASE_READINESS_CHECKED,
              missing: EXPECTED_NO_PUBLISH_MISSING_ROWS,
            });
          }
          return "";
        })(),
        stderr: "",
      }),
      write: () => {},
    });

    expect(result.ok).toBe(true);
    const summary = JSON.parse(fs.readFileSync(path.join(tmp, "verification-summary.json"), "utf8"));
    const handoffStep = summary.steps.find((step) => step.label === "Handoff receipts expected blockers");
    const readinessStep = summary.steps.find((step) => step.label === "Release readiness expected blockers");
    const baselineStep = summary.steps.find((step) => step.label === "No-publish baseline verifier");
    expect(handoffStep.env).toEqual({ EVIDENCE_DATE: HANDOFF_EVIDENCE_DATE });
    expect(handoffStep.command).toContain(`--date ${HANDOFF_EVIDENCE_DATE}`);
    expect(baselineStep.env).toEqual({
      EVIDENCE_DATE: HANDOFF_EVIDENCE_DATE,
      RELEASE_CANDIDATE_SHA: CANDIDATE_SHA,
    });
    expect(baselineStep.command).toContain(`--date ${HANDOFF_EVIDENCE_DATE}`);
    expect(readinessStep.env).toEqual({
      EVIDENCE_DATE: HANDOFF_EVIDENCE_DATE,
      RELEASE_CANDIDATE_SHA: CANDIDATE_SHA,
    });
    expect(summary.status).toBe("pass");
  });

  it("cleans stale generated evidence files without removing unrelated files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diveo-verification-cleanup-"));
    fs.writeFileSync(path.join(tmp, "13-release-readiness-expected-blockers.stdout.log"), "old stdout");
    fs.writeFileSync(path.join(tmp, "13-release-readiness-expected-blockers.stderr.log"), "old stderr");
    fs.writeFileSync(path.join(tmp, "verification-summary.json"), "{}\n");
    fs.writeFileSync(path.join(tmp, "review-note.txt"), "keep me");

    cleanupGeneratedEvidenceFiles(tmp);

    expect(fs.existsSync(path.join(tmp, "13-release-readiness-expected-blockers.stdout.log"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "13-release-readiness-expected-blockers.stderr.log"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "verification-summary.json"))).toBe(false);
    expect(fs.readFileSync(path.join(tmp, "review-note.txt"), "utf8")).toBe("keep me");
  });

  it("removes stale generated evidence before a fresh bundle run", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diveo-verification-evidence-stale-"));
    fs.writeFileSync(path.join(tmp, "13-release-readiness-expected-blockers.stdout.log"), "old stdout");
    fs.writeFileSync(path.join(tmp, "review-note.txt"), "keep me");

    const result = runBundle("local", {
      evidenceDir: tmp,
      runCommand: () => ({ status: 0, stdout: "", stderr: "" }),
      write: () => {},
    });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(tmp, "13-release-readiness-expected-blockers.stdout.log"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "11-whitespace-check.stdout.log"))).toBe(true);
    expect(fs.readFileSync(path.join(tmp, "review-note.txt"), "utf8")).toBe("keep me");
  });

  it("writes a failing evidence manifest with the failed step and output problems", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diveo-verification-evidence-fail-"));
    let calls = 0;
    const result = runBundle("release-candidate", {
      evidenceDir: tmp,
      evidenceMetadata: {
        nodeVersion: "v-test",
        npmVersion: "npm-test",
        diveoCommit: "abc1234",
        gsavHostingCommit: "def5678",
      },
      runCommand: () => {
        calls += 1;
        return { status: calls <= bundleForMode("local").length ? 0 : 1, stdout: "", stderr: "" };
      },
      write: () => {},
    });

    expect(result.ok).toBe(false);
    const summary = JSON.parse(fs.readFileSync(path.join(tmp, "verification-summary.json"), "utf8"));
    expect(summary.status).toBe("fail");
    expect(summary.failedStep.label).toBe("Native production config negative");
    expect(summary.outputProblems).toContain("missing expected output marker: \"status\": \"fail\"");
  });

  it("refuses to write evidence while another bundle owns the evidence directory", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diveo-verification-evidence-lock-"));
    const releaseLock = acquireEvidenceDirLock(tmp, {
      pid: 1234,
      now: new Date("2026-07-01T07:40:00Z"),
    });

    try {
      expect(() => runBundle("local", {
        evidenceDir: tmp,
        runCommand: () => ({ status: 0, stdout: "", stderr: "" }),
        write: () => {},
      })).toThrow(/Evidence directory is already in use/);
      expect(fs.readFileSync(path.join(tmp, ".verification-bundle.lock"), "utf8")).toContain('"pid": 1234');
    } finally {
      releaseLock();
    }

    expect(fs.existsSync(path.join(tmp, ".verification-bundle.lock"))).toBe(false);
  });

  it("removes the evidence directory lock after a failed bundle", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diveo-verification-evidence-lock-fail-"));

    const result = runBundle("local", {
      evidenceDir: tmp,
      runCommand: (_command, _args) => ({ status: 1, stdout: "", stderr: "" }),
      write: () => {},
    });

    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(tmp, ".verification-bundle.lock"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "verification-summary.json"))).toBe(true);
  });

  it("requires expected output markers for inspected steps", () => {
    expect(outputProblems({
      expectedOutputIncludes: ["alpha", "beta"],
    }, "alpha")).toEqual(["missing expected output marker: beta"]);

    const missingMarker = runStep({
      label: "Inspected",
      command: "node",
      args: ["script.js"],
      expectedOutputIncludes: ["expected marker"],
    }, {
      runCommand: () => ({ status: 0, stdout: "unexpected output", stderr: "" }),
      write: () => {},
    });

    expect(missingMarker.ok).toBe(false);
    expect(missingMarker.outputProblems).toEqual(["missing expected output marker: expected marker"]);

    const matched = runStep({
      label: "Inspected",
      command: "node",
      args: ["script.js"],
      expectedOutputIncludes: ["expected marker"],
    }, {
      runCommand: () => ({ status: 0, stdout: "expected marker", stderr: "" }),
      write: () => {},
    });

    expect(matched.ok).toBe(true);
  });

  it("parses JSON from inspected command output", () => {
    expect(parseJsonFromOutput("prefix\n{\"status\":\"pass\"}\n")).toEqual({ status: "pass" });
    expect(() => parseJsonFromOutput("no json here")).toThrow("output does not contain a JSON object");
  });

  it("accepts only the intended production-config missing-env failure", () => {
    const step = {
      expectedJson: "native-production-config-missing-env",
    };
    const expectedErrors = PRODUCTION_ENV_KEYS.map((key) => (
      `Production must provide ${key} in the environment or EAS production profile.`
    ));
    const goodOutput = JSON.stringify({
      ok: false,
      status: "fail",
      errors: expectedErrors,
      checked: { qualityVerifiesLocalBundle: true },
    });
    const badOutput = JSON.stringify({
      ok: false,
      status: "fail",
      errors: [...expectedErrors, "release workflow crashed before verification"],
      checked: { qualityVerifiesLocalBundle: true },
    });

    expect(expectedJsonProblems(step, goodOutput)).toEqual([]);
    expect(expectedJsonProblems(step, badOutput)).toEqual([
      "unexpected production config errors: release workflow crashed before verification",
    ]);
  });

  it("accepts only the current structured release-readiness pending-evidence inventory", () => {
    const step = {
      expectedJson: "release-readiness-pending-evidence",
    };
    const goodOutput = JSON.stringify({
      ok: false,
      status: "fail",
      checked: EXPECTED_RELEASE_READINESS_CHECKED,
      missing: EXPECTED_NO_PUBLISH_MISSING_ROWS,
    });
    const partiallyCompleteOutput = JSON.stringify({
      ok: false,
      status: "fail",
      checked: EXPECTED_RELEASE_READINESS_CHECKED,
      missing: EXPECTED_NO_PUBLISH_MISSING_ROWS.slice(0, -1),
    });
    const noMissingRowsOutput = JSON.stringify({
      ok: false,
      status: "fail",
      checked: EXPECTED_RELEASE_READINESS_CHECKED,
      missing: [],
    });
    const unnamedMissingRowOutput = JSON.stringify({
      ok: false,
      status: "fail",
      checked: EXPECTED_RELEASE_READINESS_CHECKED,
      missing: [{ id: EXPECTED_NO_PUBLISH_MISSING_ROWS[0].id, route: "" }],
    });
    const missingIdOutput = JSON.stringify({
      ok: false,
      status: "fail",
      checked: EXPECTED_RELEASE_READINESS_CHECKED,
      missing: [{ route: EXPECTED_NO_PUBLISH_MISSING_ROWS[0].route }],
    });
    const droppedInventoryOutput = JSON.stringify({
      ok: false,
      status: "fail",
      checked: EXPECTED_RELEASE_READINESS_CHECKED - 1,
      missing: EXPECTED_NO_PUBLISH_MISSING_ROWS,
    });
    const unknownMissingRouteOutput = JSON.stringify({
      ok: false,
      status: "fail",
      checked: EXPECTED_RELEASE_READINESS_CHECKED,
      missing: [
        { id: "Old removed release row", route: "Old removed release row" },
      ],
    });

    expect(expectedJsonProblems(step, goodOutput)).toEqual([]);
    expect(expectedJsonProblems(step, partiallyCompleteOutput)).toEqual([
      `release readiness expected blocker must report ${EXPECTED_NO_PUBLISH_PENDING_ROWS} pending publish rows, got ${EXPECTED_NO_PUBLISH_PENDING_ROWS - 1}`,
      `release readiness expected blocker lost expected missing rows: ${EXPECTED_NO_PUBLISH_MISSING_ROWS.at(-1).id}`,
    ]);
    expect(expectedJsonProblems(step, noMissingRowsOutput)).toEqual([
      `release readiness expected blocker must report ${EXPECTED_NO_PUBLISH_PENDING_ROWS} pending publish rows, got 0`,
      "release readiness expected blocker lost expected missing rows: JS runtime smoke, Android route /, iOS route /, Android route /search, iOS route /search, Android route /library, iOS route /library, Android route /creator/:handle, iOS route /creator/:handle, Android route /explore, iOS route /explore, Android route /gsav-diagnostics, iOS route /gsav-diagnostics, Android route /watch/test, iOS route /watch/test, Android route /gsav/test?t=2.5, iOS route /gsav/test?t=2.5, negative validation Missing host config, negative validation Host offline/retry, negative validation Cross-origin navigation, negative validation Unsupported renderer, negative validation Auth initialization gate, negative validation Ended playback, Release validation prerequisites, Android release APK artifact scan, Android release installed APK smoke, Android generated versionCode metadata, production .gsav range probe, non-publishing release dry run",
    ]);
    expect(expectedJsonProblems(step, unnamedMissingRowOutput)).toEqual([
      `release readiness expected blocker must report ${EXPECTED_NO_PUBLISH_PENDING_ROWS} pending publish rows, got 1`,
      "release readiness expected blocker must include route names for missing rows",
      "release readiness expected blocker lost expected missing rows: Android route /, iOS route /, Android route /search, iOS route /search, Android route /library, iOS route /library, Android route /creator/:handle, iOS route /creator/:handle, Android route /explore, iOS route /explore, Android route /gsav-diagnostics, iOS route /gsav-diagnostics, Android route /watch/test, iOS route /watch/test, Android route /gsav/test?t=2.5, iOS route /gsav/test?t=2.5, negative validation Missing host config, negative validation Host offline/retry, negative validation Cross-origin navigation, negative validation Unsupported renderer, negative validation Auth initialization gate, negative validation Ended playback, Release validation prerequisites, Android release APK artifact scan, Android release installed APK smoke, Android generated versionCode metadata, production .gsav range probe, non-publishing release dry run",
    ]);
    expect(expectedJsonProblems(step, missingIdOutput)).toEqual([
      `release readiness expected blocker must report ${EXPECTED_NO_PUBLISH_PENDING_ROWS} pending publish rows, got 1`,
      "release readiness expected blocker must include row ids for missing rows",
      "release readiness expected blocker lost expected missing rows: JS runtime smoke, Android route /, iOS route /, Android route /search, iOS route /search, Android route /library, iOS route /library, Android route /creator/:handle, iOS route /creator/:handle, Android route /explore, iOS route /explore, Android route /gsav-diagnostics, iOS route /gsav-diagnostics, Android route /watch/test, iOS route /watch/test, Android route /gsav/test?t=2.5, iOS route /gsav/test?t=2.5, negative validation Missing host config, negative validation Host offline/retry, negative validation Cross-origin navigation, negative validation Unsupported renderer, negative validation Auth initialization gate, negative validation Ended playback, Release validation prerequisites, Android release APK artifact scan, Android release installed APK smoke, Android generated versionCode metadata, production .gsav range probe, non-publishing release dry run",
    ]);
    expect(expectedJsonProblems(step, droppedInventoryOutput)).toEqual([
      `release readiness expected blocker must report ${EXPECTED_RELEASE_READINESS_CHECKED} checked rows, got ${EXPECTED_RELEASE_READINESS_CHECKED - 1}`,
    ]);
    expect(expectedJsonProblems(step, unknownMissingRouteOutput)).toEqual([
      `release readiness expected blocker must report ${EXPECTED_NO_PUBLISH_PENDING_ROWS} pending publish rows, got 1`,
      "release readiness expected blocker reported unknown missing rows: Old removed release row",
      "release readiness expected blocker lost expected missing rows: JS runtime smoke, Android route /, iOS route /, Android route /search, iOS route /search, Android route /library, iOS route /library, Android route /creator/:handle, iOS route /creator/:handle, Android route /explore, iOS route /explore, Android route /gsav-diagnostics, iOS route /gsav-diagnostics, Android route /watch/test, iOS route /watch/test, Android route /gsav/test?t=2.5, iOS route /gsav/test?t=2.5, negative validation Missing host config, negative validation Host offline/retry, negative validation Cross-origin navigation, negative validation Unsupported renderer, negative validation Auth initialization gate, negative validation Ended playback, Release validation prerequisites, Android release APK artifact scan, Android release installed APK smoke, Android generated versionCode metadata, production .gsav range probe, non-publishing release dry run",
      "release readiness expected blocker reported unexpected missing row ids: Old removed release row",
    ]);
  });

  it("accepts only complete or known-missing handoff receipt states", () => {
    const step = { expectedJson: "handoff-receipts" };
    const paths = handoffReceiptPaths();
    const completeOutput = JSON.stringify({
      schemaVersion: "handoff-receipts/v1",
      ok: true,
      status: "pass",
      evidenceDate: HANDOFF_EVIDENCE_DATE,
      allowPending: true,
      receiptPaths: paths,
      checked: checkedHandoffReceiptPaths(paths, "pass"),
      blockers: [],
    });
    const pendingOutput = JSON.stringify({
      schemaVersion: "handoff-receipts/v1",
      ok: false,
      status: "blocked",
      evidenceDate: HANDOFF_EVIDENCE_DATE,
      allowPending: true,
      receiptPaths: paths,
      checked: checkedHandoffReceiptPaths(paths),
      blockers: handoffReceiptBlockers(EXPECTED_HANDOFF_BLOCKER_IDS, paths),
    });
    const malformedOutput = JSON.stringify({
      schemaVersion: "handoff-receipts/v1",
      ok: false,
      status: "fail",
      allowPending: true,
      blockers: [
        { id: "fixture-manifest", kind: "invalid" },
        { id: "surprise-receipt", kind: "missing" },
      ],
    });

    expect(expectedJsonProblems(step, completeOutput)).toEqual([]);
    expect(expectedJsonProblems(step, pendingOutput)).toEqual([]);
    expect(expectedJsonProblems(step, malformedOutput)).toEqual([
      "handoff receipts verifier must report status=pass or status=blocked with ok=false",
      "handoff receipts reported unexpected blockers: surprise-receipt",
      "handoff receipts blockers must be missing-only in pending mode: fixture-manifest",
      "handoff receipts verifier must report evidenceDate",
    ]);
    const staleDetailOutput = JSON.stringify({
      schemaVersion: "handoff-receipts/v1",
      ok: false,
      status: "blocked",
      evidenceDate: HANDOFF_EVIDENCE_DATE,
      allowPending: true,
      receiptPaths: {
        ...paths,
        hostReadyPath: "docs/qa-evidence/2026-06-30/gsav-host-ready.json",
      },
      checked: {
        ...checkedHandoffReceiptPaths(paths),
        fixtureManifest: {
          path: "docs/qa-evidence/2026-06-30/fixture-manifest.json",
          status: "pass",
        },
      },
      blockers: handoffReceiptBlockers(EXPECTED_HANDOFF_BLOCKER_IDS, {
        ...paths,
        ownerReceiptPath: "docs/qa-evidence/2026-06-30/owner-assignment.json",
      }),
    });
    expect(expectedJsonProblems(step, staleDetailOutput)).toEqual([
      `handoff receipts receiptPaths.hostReadyPath must be ${paths.hostReadyPath}`,
      `handoff receipts checked.fixtureManifest.path must be ${paths.fixtureManifestPath}`,
      "handoff receipts checked.fixtureManifest.status must be missing",
      `handoff receipts blocker owner-assignment-receipt path must be ${paths.ownerReceiptPath}`,
    ]);
    expect(expectedJsonProblems({
      expectedJson: "handoff-receipts",
      env: {
        EVIDENCE_DATE: "2026-07-02",
      },
    }, pendingOutput)).toEqual([
      "handoff receipts verifier must report evidenceDate=2026-07-02",
    ]);
  });

  it("accepts only a complete no-publish baseline pass for release-candidate verification", () => {
    const step = {
      expectedJson: "no-publish-baseline",
      env: {
        RELEASE_CANDIDATE_SHA: CANDIDATE_SHA,
      },
    };
    const goodOutput = JSON.stringify({
      ok: true,
      status: "pass",
      scope: NO_PUBLISH_BASELINE_SCOPE,
      lifecycle: {
        phase: NO_PUBLISH_BASELINE_PHASE,
        invalidAfter: NO_PUBLISH_BASELINE_INVALID_AFTER,
      },
      releaseReadiness: {
        ok: false,
        checked: EXPECTED_RELEASE_READINESS_CHECKED,
        missing: EXPECTED_NO_PUBLISH_PENDING_ROWS,
      },
      devicePacket: {
        pendingPackets: EXPECTED_NO_PUBLISH_DEVICE_PENDING_PACKETS,
      },
      sourceEvidence: {
        evidenceDate: HANDOFF_EVIDENCE_DATE,
        expectedCandidateSha: CANDIDATE_SHA,
        devicePacketReleaseCandidateSha: CANDIDATE_SHA,
      },
      handoffReceipts: noPublishBaselineHandoffReceipts(),
      controls: {
        branchProtectionReady: true,
        publishHashVariablesAbsent: true,
        releaseStateNoPublish: true,
        validationPrereqsBlocked: true,
        handoffReceiptsBlocked: true,
      },
    });
    const badOutput = JSON.stringify({
      ok: true,
      status: "pass",
      scope: "generic-no-publish-baseline",
      lifecycle: {
        phase: "G3",
        invalidAfter: "never",
      },
      releaseReadiness: {
        ok: true,
        checked: EXPECTED_RELEASE_READINESS_CHECKED - 1,
        missing: EXPECTED_NO_PUBLISH_PENDING_ROWS - 1,
      },
      devicePacket: {
        pendingPackets: EXPECTED_NO_PUBLISH_DEVICE_PENDING_PACKETS - 1,
      },
      sourceEvidence: {
        evidenceDate: HANDOFF_EVIDENCE_DATE,
        expectedCandidateSha: null,
        devicePacketReleaseCandidateSha: "0123456789abcdef0123456789abcdef01234567",
      },
      handoffReceipts: {
        status: "pass",
        allowPending: false,
        blockerIds: [
          "owner-assignment-receipt",
          "owner-assignment-receipt",
          "surprise-receipt",
        ],
      },
      controls: {
        branchProtectionReady: false,
        publishHashVariablesAbsent: true,
        releaseStateNoPublish: false,
        validationPrereqsBlocked: false,
        handoffReceiptsBlocked: false,
      },
    });
    const paths = handoffReceiptPaths();
    const staleDetailOutput = JSON.stringify({
      ok: true,
      status: "pass",
      scope: NO_PUBLISH_BASELINE_SCOPE,
      lifecycle: {
        phase: NO_PUBLISH_BASELINE_PHASE,
        invalidAfter: NO_PUBLISH_BASELINE_INVALID_AFTER,
      },
      releaseReadiness: {
        ok: false,
        checked: EXPECTED_RELEASE_READINESS_CHECKED,
        missing: EXPECTED_NO_PUBLISH_PENDING_ROWS,
      },
      devicePacket: {
        pendingPackets: EXPECTED_NO_PUBLISH_DEVICE_PENDING_PACKETS,
      },
      sourceEvidence: {
        evidenceDate: HANDOFF_EVIDENCE_DATE,
        expectedCandidateSha: CANDIDATE_SHA,
        devicePacketReleaseCandidateSha: CANDIDATE_SHA,
      },
      handoffReceipts: noPublishBaselineHandoffReceipts({
        receiptPaths: {
          ...paths,
          hostReadyPath: "docs/qa-evidence/2026-06-30/gsav-host-ready.json",
        },
        expectedReceiptPaths: {
          ...paths,
          ownerReceiptPath: "docs/qa-evidence/2026-06-30/owner-assignment.json",
        },
        checked: {
          ...checkedHandoffReceiptPaths(paths),
          fixtureManifest: {
            path: "docs/qa-evidence/2026-06-30/fixture-manifest.json",
            status: "present",
          },
        },
      }),
      controls: {
        branchProtectionReady: true,
        publishHashVariablesAbsent: true,
        releaseStateNoPublish: true,
        validationPrereqsBlocked: true,
        handoffReceiptsBlocked: true,
      },
    });

    expect(expectedJsonProblems(step, goodOutput)).toEqual([]);
    expect(expectedJsonProblems(step, badOutput)).toEqual([
      `no-publish baseline must report scope=${NO_PUBLISH_BASELINE_SCOPE}`,
      `no-publish baseline must report lifecycle.phase=${NO_PUBLISH_BASELINE_PHASE}`,
      `no-publish baseline must report lifecycle.invalidAfter=${NO_PUBLISH_BASELINE_INVALID_AFTER}`,
      "no-publish baseline must prove release readiness still fails",
      `no-publish baseline must report ${EXPECTED_RELEASE_READINESS_CHECKED} checked rows, got ${EXPECTED_RELEASE_READINESS_CHECKED - 1}`,
      `no-publish baseline must report ${EXPECTED_NO_PUBLISH_PENDING_ROWS} pending publish rows, got ${EXPECTED_NO_PUBLISH_PENDING_ROWS - 1}`,
      `no-publish baseline must report ${EXPECTED_NO_PUBLISH_DEVICE_PENDING_PACKETS} pending device packets, got ${EXPECTED_NO_PUBLISH_DEVICE_PENDING_PACKETS - 1}`,
      "no-publish baseline handoff receipts must report status=blocked",
      "no-publish baseline handoff receipts must report allowPending=true",
      "no-publish baseline handoff receipts lost expected blockers: fixture-manifest, gsav-host-ready-receipt",
      "no-publish baseline handoff receipts reported unexpected blockers: surprise-receipt",
      "no-publish baseline handoff receipts reported duplicate blockers: owner-assignment-receipt",
      "no-publish baseline handoff receipts must report receiptPaths",
      "no-publish baseline handoff receipts must report expectedReceiptPaths",
      "no-publish baseline handoff receipts must report checked receipt status details",
      "no-publish baseline must record the expected candidate SHA",
      "no-publish baseline device packet target must match the expected candidate SHA",
      "no-publish baseline must prove branch protection ready",
      "no-publish baseline must prove release state no-publish",
      "no-publish baseline must prove validation prerequisites blocked",
      "no-publish baseline must prove handoff receipts blocked",
    ]);
    expect(expectedJsonProblems(step, staleDetailOutput)).toEqual([
      `no-publish baseline handoff receipts receiptPaths.hostReadyPath must be ${paths.hostReadyPath}`,
      `no-publish baseline handoff receipts expectedReceiptPaths.ownerReceiptPath must be ${paths.ownerReceiptPath}`,
      `no-publish baseline handoff receipts checked.fixtureManifest.path must be ${paths.fixtureManifestPath}`,
      "no-publish baseline handoff receipts checked.fixtureManifest.status must be missing",
    ]);
    expect(expectedJsonProblems({
      expectedJson: "no-publish-baseline",
      env: {
        EVIDENCE_DATE: "2026-07-02",
        RELEASE_CANDIDATE_SHA: CANDIDATE_SHA,
      },
    }, goodOutput)).toEqual([
      "no-publish baseline must report sourceEvidence.evidenceDate=2026-07-02",
    ]);
  });
});
