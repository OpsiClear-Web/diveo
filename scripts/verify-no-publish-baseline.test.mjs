import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
  DEFAULT_EXPECTED_MISSING_IDS,
  DEFAULT_EXPECTED_REPOSITORY,
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
} = require("./verify-no-publish-baseline.js");
const {
  createDeviceEvidencePacket,
} = require("./device-evidence-packet.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const DATE = "2026-07-01";
const CANDIDATE_SHA = "3d243f51497982d1c741e28d7f6ed2e90c99ba50";
const OTHER_CANDIDATE_SHA = "0123456789abcdef0123456789abcdef01234567";

function strictSourceEvidenceOptions(overrides = {}) {
  return {
    branchProtectionPath: `docs/qa-evidence/${DATE}/master-branch-protection.json`,
    publishHashGuardPath: `docs/qa-evidence/${DATE}/publish-hash-variable-guard.json`,
    releaseStatePath: `docs/qa-evidence/${DATE}/github-release-state-blocker.json`,
    devicePacketPath: `docs/qa-evidence/${DATE}/device-evidence-packet-scaffold.json`,
    validationPrereqsPath: `docs/qa-evidence/${DATE}/validation-prereqs-blocker.json`,
    handoffReceiptsPath: `docs/qa-evidence/${DATE}/handoff-receipts-blocker.json`,
    qaPath: "docs/GSAV_NATIVE_QA.md",
    auditPath: "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
    ...overrides,
  };
}

function git(root, args) {
  execFileSync("git", args, {
    cwd: root,
    stdio: "ignore",
  });
}

function createStrictSourceEvidenceRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "diveo-no-publish-source-"));
  const options = strictSourceEvidenceOptions();
  const paths = [
    options.branchProtectionPath,
    options.publishHashGuardPath,
    options.releaseStatePath,
    options.devicePacketPath,
    options.validationPrereqsPath,
    options.handoffReceiptsPath,
    options.qaPath,
    options.auditPath,
  ];
  for (const filePath of paths) {
    const absolutePath = path.join(root, filePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, `${filePath}\n`);
  }
  git(root, ["init"]);
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test User",
    "commit",
    "-m",
    "source evidence fixture",
  ]);
  return { root, options };
}

function createReadinessBaselineFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "diveo-no-publish-readiness-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    version: "1.0.19",
  }));
  fs.writeFileSync(path.join(root, "app.json"), JSON.stringify({
    expo: {
      version: "1.0.19",
      android: {
        versionCode: 19,
      },
    },
  }));
  fs.mkdirSync(path.join(root, `docs/qa-evidence/${DATE}`), { recursive: true });
  fs.writeFileSync(path.join(root, `docs/qa-evidence/${DATE}/dry-run-summary.json`), "{}\n");
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  const qaText = [
    "# QA",
    "",
    "## Evidence Log",
    "",
    "| Date | Platform | Device/Emulator | GSAV web URL | diveo route | Result | Evidence path | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    `| 2026-07-01 | GitHub Actions release dry run | GitHub Actions | https://gsav.example.com | Release workflow dry run | Passed: publish_release=false dry run reviewed | docs/qa-evidence/${DATE}/dry-run-summary.json | releaseCandidateSha=${OTHER_CANDIDATE_SHA}; evidenceSignoffSha=${OTHER_CANDIDATE_SHA}; candidate_ref=${OTHER_CANDIDATE_SHA}; artifactName=diveo-release-evidence-v1.0.19 |`,
  ].join("\n");
  fs.writeFileSync(path.join(root, "docs/GSAV_NATIVE_QA.md"), qaText);
  fs.writeFileSync(path.join(root, "docs/IMPLEMENTATION_VALIDATION_AUDIT.md"), [
    "# Implementation Validation Audit",
    "",
    "## Final Publish Signoff",
    "",
    "decision=no-publish; reviewer=_pending_; reviewedAt=_pending_;",
  ].join("\n"));
  git(root, ["init"]);
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test User",
    "commit",
    "-m",
    "readiness fixture",
  ]);
  return root;
}

function validationPrereqEvidence({
  commands = { npx: true, gh: true },
  android = { connectedDevices: [] },
  blockerIds = DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS,
} = {}) {
  return {
    checkedAt: "2026-07-01T10:00:00Z",
    ok: false,
    status: "fail",
    checked: {
      commands,
      android,
      ios: {
        artifactPath: {
          insideRoot: true,
        },
        computedArtifactSha256: {
          present: false,
          value: null,
        },
        artifactSha256Matches: null,
      },
    },
    blockers: blockerIds.map((id) => ({ id })),
  };
}

function handoffReceiptsEvidence({
  schemaVersion = HANDOFF_RECEIPTS_SCHEMA_VERSION,
  checkedAt = "2026-07-01T10:05:00Z",
  evidenceDate = DATE,
  status = "blocked",
  ok = false,
  allowPending = true,
  blockerIds = DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
  kind = "missing",
  receiptPaths = expectedHandoffReceiptPaths(evidenceDate),
  checked = {
    ownerAssignment: {
      path: receiptPaths.ownerReceiptPath,
      status: "missing",
    },
    fixtureManifest: {
      path: receiptPaths.fixtureManifestPath,
      status: "missing",
    },
    hostReady: {
      path: receiptPaths.hostReadyPath,
      status: "missing",
    },
  },
} = {}) {
  return {
    schemaVersion,
    checkedAt,
    evidenceDate,
    status,
    ok,
    allowPending,
    receiptPaths,
    checked,
    blockers: blockerIds.map((id) => ({ id, kind })),
  };
}

describe("no-publish baseline verifier", () => {
  it("requires candidate inputs to be full 40-hex SHAs", () => {
    expect(() => parseArgs(["--candidate-sha", "abc1234"], {})).toThrow(
      "--candidate-sha, RELEASE_CANDIDATE_SHA, or RELEASE_PAYLOAD_CANDIDATE_SHA must be a full 40-hex SHA.",
    );
    expect(() => parseArgs([], { RELEASE_CANDIDATE_SHA: "abc1234" })).toThrow(
      "--candidate-sha, RELEASE_CANDIDATE_SHA, or RELEASE_PAYLOAD_CANDIDATE_SHA must be a full 40-hex SHA.",
    );

    expect(parseArgs(["--candidate-sha", CANDIDATE_SHA], {}).candidateSha).toBe(CANDIDATE_SHA);
    expect(parseArgs([], { RELEASE_PAYLOAD_CANDIDATE_SHA: CANDIDATE_SHA }).candidateSha).toBe(CANDIDATE_SHA);
  });

  it("uses dated handoff receipt blocker defaults", () => {
    const parsed = parseArgs([], { EVIDENCE_DATE: DATE });

    expect(parsed.handoffReceiptsPath).toBe(`docs/qa-evidence/${DATE}/handoff-receipts-blocker.json`);
    expect(parsed.expectedHandoffReceiptBlockerIds).toEqual(DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS);
    expect(parseArgs(["--date", DATE], {})).toMatchObject(strictSourceEvidenceOptions());
    expect(parseArgs([
      "--date",
      DATE,
      "--branch-protection-path",
      "custom-branch-protection.json",
    ], {})).toMatchObject({
      ...strictSourceEvidenceOptions({
        branchProtectionPath: "custom-branch-protection.json",
      }),
      date: DATE,
    });
    expect(parseArgs([
      "--expected-handoff-receipt-blocker-ids",
      "fixture-manifest,gsav-host-ready-receipt",
    ], {
      EVIDENCE_DATE: DATE,
    }).expectedHandoffReceiptBlockerIds).toEqual([
      "fixture-manifest",
      "gsav-host-ready-receipt",
    ]);
  });

  it("parses strict source evidence git integrity as an explicit promotion flag", () => {
    const parsed = parseArgs([
      "--require-source-evidence-git-integrity",
      "--candidate-sha",
      CANDIDATE_SHA,
    ], {
      EVIDENCE_DATE: DATE,
    });

    expect(parsed.requireSourceEvidenceGitIntegrity).toBe(true);
    expect(parseArgs([], { EVIDENCE_DATE: DATE }).requireSourceEvidenceGitIntegrity).toBe(false);
  });

  it("requires tracked and clean source evidence when strict promotion mode is enabled", () => {
    const { root, options } = createStrictSourceEvidenceRepo();

    expect(sourceEvidenceGitIntegrityProblems({ root, options }).problems).toEqual([]);

    fs.writeFileSync(path.join(root, options.branchProtectionPath), "dirty evidence\n");
    const untrackedPath = `docs/qa-evidence/${DATE}/validation-prereqs-untracked.json`;
    fs.writeFileSync(path.join(root, untrackedPath), "untracked evidence\n");

    const problems = sourceEvidenceGitIntegrityProblems({
      root,
      options: {
        ...options,
        validationPrereqsPath: untrackedPath,
      },
    }).problems;

    expect(problems).toEqual(expect.arrayContaining([
      `validation prerequisites blocker evidence must be tracked in git before promotion: ${untrackedPath}`,
    ]));
    expect(problems.some((problem) => (
      problem.startsWith("source evidence files must be committed before promotion:")
        && problem.includes(`M ${options.branchProtectionPath}`)
        && problem.includes(`?? ${untrackedPath}`)
    ))).toBe(true);
  });

  it("rejects source evidence paths outside the repository in strict promotion mode", () => {
    const { root, options } = createStrictSourceEvidenceRepo();

    expect(sourceEvidenceGitIntegrityProblems({
      root,
      options: {
        ...options,
        auditPath: "../outside-audit.md",
      },
    }).problems).toContain(
      "validation audit must be inside the repository before promotion: ../outside-audit.md",
    );
  });

  it("accepts the current repository no-publish evidence baseline", () => {
    const result = verifyNoPublishBaseline({
      root: repoRoot,
      date: DATE,
      expectedCheckedRows: 30,
      expectedPendingRows: 29,
      requiredCheck: "quality / quality",
      branchProtectionPath: "docs/qa-evidence/2026-07-01/master-branch-protection.json",
      publishHashGuardPath: "docs/qa-evidence/2026-07-01/publish-hash-variable-guard.json",
      releaseStatePath: "docs/qa-evidence/2026-07-01/github-release-state-blocker.json",
      devicePacketPath: "docs/qa-evidence/2026-07-01/device-evidence-packet-scaffold.json",
      validationPrereqsPath: "docs/qa-evidence/2026-07-01/validation-prereqs-blocker.json",
      handoffReceiptsPath: "docs/qa-evidence/2026-07-01/handoff-receipts-blocker.json",
      expectedValidationPrereqBlockerIds: DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS,
      expectedHandoffReceiptBlockerIds: DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
      candidateSha: CANDIDATE_SHA,
      qaPath: "docs/GSAV_NATIVE_QA.md",
      auditPath: "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
      expectedMissingIds: DEFAULT_EXPECTED_MISSING_IDS,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "pass",
      scope: NO_PUBLISH_BASELINE_SCOPE,
      lifecycle: {
        phase: NO_PUBLISH_BASELINE_PHASE,
        validBefore: "G3 non-publishing release dry run",
        invalidAfter: NO_PUBLISH_BASELINE_INVALID_AFTER,
        replacementAfterInvalidation: "candidate-pinned release-readiness expected-fail plus G3-G7 evidence-specific verification",
      },
      releaseReadiness: {
        ok: false,
        checked: 30,
        missing: 29,
      },
      devicePacket: {
        ok: true,
        checkedPackets: 22,
        pendingPackets: 22,
      },
      controls: {
        branchProtectionReady: true,
        publishHashVariablesAbsent: true,
        releaseStateNoPublish: true,
        validationPrereqsBlocked: true,
        handoffReceiptsBlocked: true,
      },
      sourceEvidence: {
        evidenceDate: DATE,
        expectedRepository: DEFAULT_EXPECTED_REPOSITORY,
        branchProtectionCheckedAt: expect.stringMatching(/^2026-07-01T/),
        branchProtectionReviewer: "codex-local-verifier",
        branchProtectionReviewedAt: expect.stringMatching(/^2026-07-01T/),
        publishHashGuardCheckedAt: expect.stringMatching(/^2026-07-01T/),
        publishHashGuardReviewer: "codex-local-verifier",
        publishHashGuardReviewedAt: expect.stringMatching(/^2026-07-01T/),
        releaseStateCheckedAt: expect.stringMatching(/^2026-07-01T/),
        releaseStateReviewer: "codex-local-verifier",
        releaseStateReviewedAt: expect.stringMatching(/^2026-07-01T/),
        releaseStateDeviceValidationWorkflowPresent: false,
        devicePacketGeneratedAt: expect.stringMatching(/^2026-07-01T/),
        devicePacketEvidenceDate: "2026-07-01",
        devicePacketReleaseCandidateSha: CANDIDATE_SHA,
        expectedCandidateSha: CANDIDATE_SHA,
        validationPrereqsCheckedAt: expect.stringMatching(/^2026-07-01T/),
        handoffReceiptsCheckedAt: expect.stringMatching(/^2026-07-01T/),
        handoffReceiptsEvidenceDate: DATE,
      },
      handoffReceipts: {
        ok: false,
        status: "blocked",
        allowPending: true,
        blockerIds: DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
        expectedBlockerIds: DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
        receiptPaths: {
          ownerReceiptPath: "docs/qa-evidence/2026-07-01/owner-assignment.json",
          fixtureManifestPath: "docs/qa-evidence/2026-07-01/fixture-manifest.json",
          hostReadyPath: "docs/qa-evidence/2026-07-01/gsav-host-ready.json",
        },
        expectedReceiptPaths: {
          ownerReceiptPath: "docs/qa-evidence/2026-07-01/owner-assignment.json",
          fixtureManifestPath: "docs/qa-evidence/2026-07-01/fixture-manifest.json",
          hostReadyPath: "docs/qa-evidence/2026-07-01/gsav-host-ready.json",
        },
        checked: {
          ownerAssignment: {
            path: "docs/qa-evidence/2026-07-01/owner-assignment.json",
            status: "missing",
          },
          fixtureManifest: {
            path: "docs/qa-evidence/2026-07-01/fixture-manifest.json",
            status: "missing",
          },
          hostReady: {
            path: "docs/qa-evidence/2026-07-01/gsav-host-ready.json",
            status: "missing",
          },
        },
      },
      problems: [],
    });
  });

  it("pins readiness analysis to the supplied no-publish candidate SHA", () => {
    const root = createReadinessBaselineFixture();

    const result = releaseReadinessBaseline({
      root,
      qaPath: "docs/GSAV_NATIVE_QA.md",
      auditPath: "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
      candidateSha: CANDIDATE_SHA,
    });

    const reasons = result.missing.map((entry) => entry.reason).join("\n");
    expect(reasons).toContain(`releaseCandidateSha ${OTHER_CANDIDATE_SHA} does not match current ${CANDIDATE_SHA.slice(0, 12)}`);
    expect(reasons).not.toContain("does not match current 0123456789ab");
  });

  it("requires the audit to remain decision=no-publish during the baseline", () => {
    expect(validateAuditNoPublishState([
      "# Implementation Validation Audit",
      "",
      "## Final Publish Signoff",
      "",
      "decision=no-publish; reviewer=_pending_; reviewedAt=_pending_;",
    ].join("\n"))).toEqual([]);

    expect(validateAuditNoPublishState([
      "# Implementation Validation Audit",
      "",
      "## Final Publish Signoff",
      "",
      "decision=publish; reviewer=@release; reviewedAt=2026-07-01T10:00:00Z;",
    ].join("\n"))).toContain(
      "audit final signoff must record decision=no-publish while the no-publish baseline is active",
    );
  });

  it("requires dated, reviewed provenance for GitHub-derived source evidence", () => {
    const problems = validateEvidenceProvenance({
      checkedAt: "2026-06-30T23:59:00Z",
      repository: "other/repo",
      review: {
        reviewer: "<reviewer>",
        reviewedAt: "not-a-date",
      },
    }, {
      label: "branch protection",
      date: "2026-07-01",
      expectedRepository: DEFAULT_EXPECTED_REPOSITORY,
      requireReview: true,
    });

    expect(problems).toEqual([
      "branch protection evidence checkedAt must match evidence date 2026-07-01",
      `branch protection evidence must be for repository ${DEFAULT_EXPECTED_REPOSITORY}`,
      "branch protection evidence must include concrete review.reviewer",
      "branch protection evidence must include review.reviewedAt ISO timestamp",
    ]);
  });

  it("rejects branch protection evidence that omits the required check", () => {
    expect(validateBranchProtection({
      ok: true,
      status: "pass",
      branch: "master",
      observedRequiredChecks: ["lint"],
      releaseReadinessImpact: { status: "ready" },
      branchQuery: { exitCode: 0, output: { protected: true } },
      protectionQuery: { exitCode: 0 },
    }, { requiredCheck: "quality / quality" })).toContain(
      "branch protection evidence must include required check quality / quality",
    );
  });

  it("rejects present publish hash variables before final signoff", () => {
    const problems = validatePublishHashGuard({
      ok: false,
      status: "no-publish",
      variableQueries: [
        {
          name: "EXPECTED_RELEASE_APK_SHA256",
          status: "present",
          absent: false,
        },
        {
          name: "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256",
          status: "absent",
          absent: true,
        },
      ],
    });

    expect(problems).toContain("publish hash guard must have ok=true and status=pass while no-publish");
    expect(problems).toContain("publish hash variable must be absent before signoff: EXPECTED_RELEASE_APK_SHA256");
  });

  it("rejects release-state evidence once a fixed-candidate workflow dispatch exists", () => {
    const problems = validateReleaseState({
      ok: true,
      status: "pass",
      releaseWorkflowPresent: true,
      releaseWorkflowDispatchRuns: [{ databaseId: 123 }],
      releases: [],
      releaseState: { noGitHubReleasesObserved: true },
      releaseReadinessImpact: { status: "ready" },
    });

    expect(problems).toContain("release-state evidence must record status=no-publish and ok=false");
    expect(problems).toContain("release-state evidence must have zero Release APK workflow_dispatch runs before G3; this no-publish baseline is invalid after the first fixed-candidate dry run");
    expect(problems).toContain("release-state releaseReadinessImpact.status must be no-publish");
  });

  it("rejects non-pending device packets in the no-publish baseline", () => {
    const packet = createDeviceEvidencePacket({
      root: repoRoot,
      date: "2026-07-01",
      owner: "@reviewer",
      candidateSha: CANDIDATE_SHA,
      now: new Date("2026-07-01T10:00:00Z"),
    });
    packet.packets[0].status = "blocked";
    packet.packets[0].blocker = {
      owner: "@reviewer",
      reason: "external device unavailable",
      revisit: "2026-07-08",
    };

    expect(validateDevicePacket(packet, { root: repoRoot }).problems).toContain(
      `device packet scaffold must stay pending in no-publish baseline: ${packet.packets[0].id}`,
    );
  });

  it("rejects stale device packet scaffold dates in the no-publish baseline", () => {
    const packet = createDeviceEvidencePacket({
      root: repoRoot,
      date: "2026-06-30",
      owner: "@reviewer",
      candidateSha: CANDIDATE_SHA,
      now: new Date("2026-06-30T23:55:00Z"),
    });

    expect(validateDevicePacket(packet, { root: repoRoot, date: "2026-07-01" }).problems).toEqual(
      expect.arrayContaining([
        "device packet scaffold target.evidenceDate must match evidence date 2026-07-01",
        "device packet scaffold generatedAt must match evidence date 2026-07-01",
      ]),
    );
  });

  it("requires pending no-publish packet scaffolds to identify the payload candidate", () => {
    const packet = createDeviceEvidencePacket({
      root: repoRoot,
      date: "2026-07-01",
      owner: "@reviewer",
      now: new Date("2026-07-01T10:00:00Z"),
    });

    expect(validateDevicePacket(packet, { root: repoRoot, date: "2026-07-01" }).problems).toContain(
      "device packet scaffold target.releaseCandidateSha must be a full 40-hex SHA",
    );

    packet.target.releaseCandidateSha = CANDIDATE_SHA;
    expect(validateDevicePacket(packet, {
      root: repoRoot,
      date: "2026-07-01",
      expectedCandidateSha: "0123456789abcdef0123456789abcdef01234567",
    }).problems).toContain(
      "target.releaseCandidateSha must match expected candidate 0123456789ab",
    );
  });

  it("reports malformed candidate SHAs for direct verifier callers", () => {
    const result = verifyNoPublishBaseline({
      root: repoRoot,
      date: "2026-07-01",
      expectedCheckedRows: 30,
      expectedPendingRows: 29,
      requiredCheck: "quality / quality",
      branchProtectionPath: "docs/qa-evidence/2026-07-01/master-branch-protection.json",
      publishHashGuardPath: "docs/qa-evidence/2026-07-01/publish-hash-variable-guard.json",
      releaseStatePath: "docs/qa-evidence/2026-07-01/github-release-state-blocker.json",
      devicePacketPath: "docs/qa-evidence/2026-07-01/device-evidence-packet-scaffold.json",
      validationPrereqsPath: "docs/qa-evidence/2026-07-01/validation-prereqs-blocker.json",
      expectedValidationPrereqBlockerIds: DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS,
      candidateSha: "abc1234",
      qaPath: "docs/GSAV_NATIVE_QA.md",
      auditPath: "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
      expectedMissingIds: DEFAULT_EXPECTED_MISSING_IDS,
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("candidateSha must be a full 40-hex SHA when supplied");
  });

  it("checks readiness row counts for the expected no-publish state", () => {
    expect(validateReleaseReadinessBaseline({
      ok: false,
      checked: 30,
      missing: Array.from({ length: 28 }, (_, index) => ({ id: `row-${index}` })),
    }, {
      expectedCheckedRows: 30,
      expectedPendingRows: 29,
    })).toContain("release readiness missing 28, expected 29");

    expect(validateReleaseReadinessBaseline({
      ok: true,
      checked: 30,
      missing: [],
    }, {
      expectedCheckedRows: 30,
      expectedPendingRows: 29,
    })).toContain("release readiness must fail while no-publish baseline is active");
  });

  it("rejects changed readiness missing-row inventory even when the count matches", () => {
    const expectedMissingIds = ["JS runtime smoke", "Android route /"];
    const problems = validateReleaseReadinessBaseline({
      ok: false,
      checked: 30,
      missing: [
        { id: "JS runtime smoke" },
        { id: "unexpected new row" },
      ],
    }, {
      expectedCheckedRows: 30,
      expectedPendingRows: 2,
      expectedMissingIds,
    });

    expect(problems).toContain("release readiness missing inventory lost expected rows: Android route /");
    expect(problems).toContain("release readiness missing inventory has unexpected rows: unexpected new row");
  });

  it("rejects validation-prereq blocker inventory drift", () => {
    const evidence = validationPrereqEvidence({
      blockerIds: [
        "android-adb",
        "unexpected-new-blocker",
      ],
    });

    const problems = validateValidationPrereqsBlocker(evidence, {
      expectedValidationPrereqBlockerIds: [
        "android-adb",
        "ios-artifactPath",
      ],
    });

    expect(problems).toContain("validation-prereqs blocker inventory lost expected blockers: ios-artifactPath");
    expect(problems).toContain("validation-prereqs blocker inventory has unexpected blockers: unexpected-new-blocker");
  });

  it("rejects handoff receipt blocker inventory drift", () => {
    const problems = validateHandoffReceiptsBlocker(handoffReceiptsEvidence({
      checkedAt: "2026-06-30T23:55:00Z",
      evidenceDate: "2026-06-30",
      blockerIds: [
        "owner-assignment-receipt",
        "owner-assignment-receipt",
        "surprise-receipt",
      ],
      kind: "invalid",
    }), {
      date: DATE,
      expectedHandoffReceiptBlockerIds: DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
    });

    expect(problems).toEqual([
      `handoff receipts blocker checkedAt must match evidence date ${DATE}`,
      `handoff receipts blocker evidenceDate must be ${DATE}`,
      `handoff receipts blocker receiptPaths.ownerReceiptPath must be docs/qa-evidence/${DATE}/owner-assignment.json`,
      `handoff receipts blocker receiptPaths.fixtureManifestPath must be docs/qa-evidence/${DATE}/fixture-manifest.json`,
      `handoff receipts blocker receiptPaths.hostReadyPath must be docs/qa-evidence/${DATE}/gsav-host-ready.json`,
      `handoff receipts blocker checked.ownerAssignment.path must be docs/qa-evidence/${DATE}/owner-assignment.json`,
      `handoff receipts blocker checked.fixtureManifest.path must be docs/qa-evidence/${DATE}/fixture-manifest.json`,
      `handoff receipts blocker checked.hostReady.path must be docs/qa-evidence/${DATE}/gsav-host-ready.json`,
      "handoff receipts blocker inventory lost expected blockers: fixture-manifest, gsav-host-ready-receipt",
      "handoff receipts blocker inventory has unexpected blockers: surprise-receipt",
      "handoff receipts blocker inventory has duplicate blockers: owner-assignment-receipt",
      "handoff receipts blocker inventory must be missing-only: owner-assignment-receipt, owner-assignment-receipt, surprise-receipt",
    ]);
  });

  it("rejects handoff blocker evidence that omits or swaps receipt path details", () => {
    expect(HANDOFF_RECEIPT_CHECKS.map(([checkedKey]) => checkedKey)).toEqual([
      "ownerAssignment",
      "fixtureManifest",
      "hostReady",
    ]);
    expect(validateHandoffReceiptsBlocker(handoffReceiptsEvidence({
      receiptPaths: {
        ownerReceiptPath: `docs/qa-evidence/${DATE}/fixture-manifest.json`,
        fixtureManifestPath: `docs/qa-evidence/${DATE}/owner-assignment.json`,
        hostReadyPath: `docs/qa-evidence/${DATE}/gsav-host-ready.json`,
      },
      checked: {
        ownerAssignment: {
          path: `docs/qa-evidence/${DATE}/fixture-manifest.json`,
          status: "missing",
        },
        fixtureManifest: {
          path: `docs/qa-evidence/${DATE}/owner-assignment.json`,
          status: "present",
        },
      },
    }), {
      date: DATE,
      expectedHandoffReceiptBlockerIds: DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
    })).toEqual([
      `handoff receipts blocker receiptPaths.ownerReceiptPath must be docs/qa-evidence/${DATE}/owner-assignment.json`,
      `handoff receipts blocker receiptPaths.fixtureManifestPath must be docs/qa-evidence/${DATE}/fixture-manifest.json`,
      `handoff receipts blocker checked.ownerAssignment.path must be docs/qa-evidence/${DATE}/owner-assignment.json`,
      `handoff receipts blocker checked.fixtureManifest.path must be docs/qa-evidence/${DATE}/fixture-manifest.json`,
      "handoff receipts blocker checked.fixtureManifest.status must be missing",
      "handoff receipts blocker checked.hostReady must be present",
    ]);

    expect(validateHandoffReceiptsBlocker(handoffReceiptsEvidence({
      receiptPaths: null,
      checked: null,
    }), {
      date: DATE,
      expectedHandoffReceiptBlockerIds: DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
    })).toEqual([
      "handoff receipts blocker must include receiptPaths",
      "handoff receipts blocker must include checked receipt status details",
    ]);
  });

  it("rejects completed handoff receipts in the pre-G3 blocker baseline", () => {
    expect(validateHandoffReceiptsBlocker(handoffReceiptsEvidence({
      status: "pass",
      ok: true,
      allowPending: false,
      blockerIds: [],
    }), {
      date: DATE,
      expectedHandoffReceiptBlockerIds: DEFAULT_EXPECTED_HANDOFF_RECEIPT_BLOCKER_IDS,
    })).toEqual([
      "handoff receipts blocker must record status=blocked and ok=false while no-publish",
      "handoff receipts blocker must be captured with allowPending=true",
      "handoff receipts blocker inventory lost expected blockers: owner-assignment-receipt, fixture-manifest, gsav-host-ready-receipt",
    ]);
  });

  it("derives Android validation-prereq blockers from adb and metadata evidence", () => {
    expect(deriveExpectedAndroidValidationPrereqBlockerIds(validationPrereqEvidence({
      commands: { adb: false, npx: true, gh: true },
    }))).toEqual(["android-adb"]);
    expect(deriveExpectedAndroidValidationPrereqBlockerIds(validationPrereqEvidence({
      commands: { adb: true, npx: true, gh: true },
      android: { adbDevicesOk: false, connectedDevices: [] },
    }))).toEqual(["android-adb-devices"]);
    expect(deriveExpectedAndroidValidationPrereqBlockerIds(validationPrereqEvidence({
      commands: { adb: true, npx: true, gh: true },
      android: { adbDevicesOk: true, connectedDevices: [] },
    }))).toEqual(["android-connected-device"]);
    expect(deriveExpectedAndroidValidationPrereqBlockerIds(validationPrereqEvidence({
      commands: { adb: true, npx: true, gh: true },
      android: {
        adbDevicesOk: true,
        connectedDevices: ["emulator-5554"],
        deviceMetadata: [{
          serial: "emulator-5554",
          metadataOk: false,
          missing: ["WebView package", "WebView version"],
        }],
      },
    }))).toEqual(["android-device-metadata", "android-webview-version"]);
    expect(deriveExpectedAndroidValidationPrereqBlockerIds(validationPrereqEvidence({
      commands: { adb: true, npx: true, gh: true },
      android: {
        adbDevicesOk: true,
        connectedDevices: ["emulator-5554"],
        deviceMetadata: [{
          serial: "emulator-5554",
          metadataOk: true,
          missing: [],
          webViewPackageName: "com.google.android.webview",
          webViewVersion: "125.0.6422.147",
        }],
      },
    }))).toEqual([]);
  });

  it("accepts conditional Android metadata blockers when adb evidence is incomplete", () => {
    const nonAndroidExpectedIds = DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS.filter(
      (id) => id !== "android-adb",
    );
    const evidence = validationPrereqEvidence({
      commands: { adb: true, npx: true, gh: true },
      android: {
        adbDevicesOk: true,
        connectedDevices: ["emulator-5554"],
        deviceMetadata: [{
          serial: "emulator-5554",
          model: "Android SDK built for x86",
          androidVersion: "",
          apiLevel: "",
          buildFingerprint: "",
          buildIncremental: "",
          webViewPackageName: "",
          webViewVersion: "",
          metadataOk: false,
          missing: [
            "Android version",
            "Android API level",
            "build fingerprint or incremental build",
            "WebView package",
            "WebView version",
          ],
        }],
      },
      blockerIds: [
        "android-device-metadata",
        "android-webview-version",
        ...nonAndroidExpectedIds,
      ],
    });

    expect(expectedValidationPrereqBlockerIdsForEvidence(
      evidence,
      DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS,
    )).toEqual([
      "android-device-metadata",
      "android-webview-version",
      ...nonAndroidExpectedIds,
    ]);
    expect(validateValidationPrereqsBlocker(evidence, {
      expectedValidationPrereqBlockerIds: DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS,
    })).toEqual([]);
  });

  it("requires Android metadata records when adb lists connected devices", () => {
    const evidence = validationPrereqEvidence({
      commands: { adb: true, npx: true, gh: true },
      android: {
        adbDevicesOk: true,
        connectedDevices: ["emulator-5554"],
      },
      blockerIds: [
        "android-device-metadata",
        "android-webview-version",
        ...DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS.filter((id) => id !== "android-adb"),
      ],
    });

    expect(validateAndroidMetadataShape(evidence)).toContain(
      "validation-prereqs blocker with connected Android devices must include checked.android.deviceMetadata records",
    );
    expect(validateValidationPrereqsBlocker(evidence, {
      expectedValidationPrereqBlockerIds: DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS,
    })).toContain(
      "validation-prereqs blocker with connected Android devices must include checked.android.deviceMetadata records",
    );
  });

  it("rejects Android metadata blockers when adb was not available", () => {
    const evidence = validationPrereqEvidence({
      commands: { adb: false, npx: true, gh: true },
      blockerIds: [
        ...DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS,
        "android-device-metadata",
      ],
    });

    expect(validateValidationPrereqsBlocker(evidence, {
      expectedValidationPrereqBlockerIds: DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS,
    })).toContain("validation-prereqs blocker inventory has unexpected blockers: android-device-metadata");
  });

  it("requires validation-prereq blocker iOS byte-proof fields", () => {
    const problems = validateValidationPrereqsBlocker({
      ok: false,
      status: "fail",
      checked: {
        commands: {
          npx: true,
          gh: true,
        },
        ios: {
          artifactPath: {
            insideRoot: false,
          },
        },
      },
      blockers: DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS.map((id) => ({ id })),
    }, {
      expectedValidationPrereqBlockerIds: DEFAULT_EXPECTED_VALIDATION_PREREQ_BLOCKER_IDS,
    });

    expect(problems).toContain("validation-prereqs blocker must include iOS artifact path root-containment proof");
    expect(problems).toContain("validation-prereqs blocker must include computed iOS artifact SHA256 field");
    expect(problems).toContain("validation-prereqs blocker must include iOS artifact SHA256 match field");
  });
});
