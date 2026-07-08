import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import handoffModule from "./verify-handoff-receipts.js";

const {
  FIXTURE_MANIFEST_SCHEMA_VERSION,
  HOST_READY_SCHEMA_VERSION,
  OWNER_RECEIPT_SCHEMA_VERSION,
  collectStringFields,
  evidenceReferenceProblem,
  fixtureManifestSecretProblems,
  hasExactlyOneQueryParam,
  parseArgs,
  redactedOrPlaceholder,
  receiptGitIntegrityBlockers,
  receiptPathLifecycleProblem,
  singlePathSegment,
  unredactedEmailDomains,
  urlPathname,
  validateHandoffReceipts,
  writeHandoffReceiptTemplates,
} = handoffModule;

const DATE = "2026-07-01";

function writeJson(root, relativePath, value) {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
}

function completeOwnerReceipt() {
  return {
    schemaVersion: OWNER_RECEIPT_SCHEMA_VERSION,
    reviewer: "@release-reviewer",
    reviewedAt: "2026-07-01T12:00:00Z",
    owners: {
      android: "@android-validator",
      ios: "@ios-validator",
      iosExecutor: "workflow-run-123",
      gsavHost: "@gsav-host-owner",
      releaseTooling: "@release-tooling",
      evidenceReviewer: "@evidence-reviewer",
      nativeRelease: "@native-release",
    },
  };
}

function completeFixtureManifest() {
  return {
    schemaVersion: FIXTURE_MANIFEST_SCHEMA_VERSION,
    evidenceDate: DATE,
    gsavHostUrl: "https://gsav.opsiclear.dev",
    gsavHostingCommit: "gsav-host-abc1234",
    fixtureAccountAlias: "fixture-account-redacted",
    resetCommand: "npm run fixtures:reset -- --account fixture-account-redacted",
    searchQuery: "gallery test",
    creatorHandle: "fixture-creator",
    sceneIds: {
      watchTest: "test",
      aliasStartTime: "test",
    },
    savedFollowPreset: "saved scene and followed creator preset applied",
    expectedStates: {
      emptyState: "empty library copy visible",
      errorState: "native nonblank error state visible",
    },
    expectedFinalEmbeddedUrls: {
      "/explore": "https://gsav.opsiclear.dev/explore?embed=native&dataSaver=1",
      "/gsav-diagnostics": "https://gsav.opsiclear.dev/native-diagnostics?embed=native",
      "/watch/test": "https://gsav.opsiclear.dev/watch/test?embed=native",
      "/gsav/test?t=2.5": "https://gsav.opsiclear.dev/watch/test?t=2.5&embed=native",
    },
    redactionNotes: "account identifiers redacted",
  };
}

function completeHostReadyReceipt() {
  return {
    schemaVersion: HOST_READY_SCHEMA_VERSION,
    evidenceDate: DATE,
    reviewer: "@host-reviewer",
    reviewedAt: "2026-07-01T12:05:00Z",
    gsavHostingCommit: "gsav-host-abc1234",
    gsavHostUrl: "https://gsav.opsiclear.dev",
    gsavHostIdentityUrl: "https://gsav.opsiclear.dev/build.json",
    observedIdentity: "gsav-host-abc1234",
    routeGuardTest: {
      command: "npm test -- apps/web/native-route-guard.test.ts",
      status: "pass",
      outputPath: "docs/qa-evidence/2026-07-01/gsav-host-route-guard.txt",
    },
    preflightOutputPath: "docs/qa-evidence/2026-07-01/gsav-preflight.json",
    runtimeSmokeOutputPath: "docs/qa-evidence/2026-07-01/gsav-runtime-smoke.json",
    range: {
      url: "https://cdn.opsiclear.dev/fixtures/test.gsav",
      status: 206,
      contentRange: "bytes 0-0/12345",
      accessControlAllowOrigin: "*",
      accessControlExposeHeaders: "Accept-Ranges, Content-Length, Content-Range, ETag",
    },
    bridge: {
      version: "0.1.0",
      minVersion: "0.1.0",
    },
  };
}

function writeCompleteReceipts(root) {
  writeJson(root, `docs/qa-evidence/${DATE}/owner-assignment.json`, completeOwnerReceipt());
  writeJson(root, `docs/qa-evidence/${DATE}/fixture-manifest.json`, completeFixtureManifest());
  writeJson(root, `docs/qa-evidence/${DATE}/gsav-host-ready.json`, completeHostReadyReceipt());
  for (const file of [
    "gsav-host-route-guard.txt",
    "gsav-preflight.json",
    "gsav-runtime-smoke.json",
  ]) {
    fs.writeFileSync(path.join(root, `docs/qa-evidence/${DATE}/${file}`), "evidence\n");
  }
}

function writeCompleteReceiptEvidence(root) {
  for (const file of [
    "gsav-host-route-guard.txt",
    "gsav-preflight.json",
    "gsav-runtime-smoke.json",
  ]) {
    const fullPath = path.join(root, `docs/qa-evidence/${DATE}/${file}`);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "evidence\n");
  }
}

function git(root, args) {
  execFileSync("git", args, {
    cwd: root,
    stdio: "ignore",
  });
}

describe("handoff receipt verifier", () => {
  it("parses defaults and explicit receipt paths", () => {
    expect(parseArgs([], { EVIDENCE_DATE: DATE })).toMatchObject({
      date: DATE,
      allowPending: false,
      ownerReceiptPath: `docs/qa-evidence/${DATE}/owner-assignment.json`,
      fixtureManifestPath: `docs/qa-evidence/${DATE}/fixture-manifest.json`,
      hostReadyPath: `docs/qa-evidence/${DATE}/gsav-host-ready.json`,
    });
    expect(parseArgs(["--date", DATE], {})).toMatchObject({
      date: DATE,
      ownerReceiptPath: `docs/qa-evidence/${DATE}/owner-assignment.json`,
      fixtureManifestPath: `docs/qa-evidence/${DATE}/fixture-manifest.json`,
      hostReadyPath: `docs/qa-evidence/${DATE}/gsav-host-ready.json`,
    });
    expect(parseArgs([
      "--date",
      DATE,
      "--owner-receipt-path",
      "custom-owner.json",
    ], {})).toMatchObject({
      date: DATE,
      ownerReceiptPath: "custom-owner.json",
      fixtureManifestPath: `docs/qa-evidence/${DATE}/fixture-manifest.json`,
      hostReadyPath: `docs/qa-evidence/${DATE}/gsav-host-ready.json`,
    });
    expect(parseArgs([
      "--date",
      DATE,
      "--allow-pending",
      "--owner-receipt-path",
      "owners.json",
      "--fixture-manifest-path",
      "fixtures.json",
      "--host-ready-path",
      "host.json",
      "--output-path",
      "out.json",
      "--write-template-dir",
      `docs/qa-evidence/${DATE}/handoff-receipt-templates`,
    ], {})).toMatchObject({
      date: DATE,
      allowPending: true,
      ownerReceiptPath: "owners.json",
      fixtureManifestPath: "fixtures.json",
      hostReadyPath: "host.json",
      outputPath: "out.json",
      writeTemplateDir: `docs/qa-evidence/${DATE}/handoff-receipt-templates`,
    });
    expect(() => parseArgs(["--date", "2026-02-31"], {})).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(["--unknown", "value"], {})).toThrow(/Usage:/);
  });

  it("reports the current missing handoff receipts as structured pending blockers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-missing-"));
    const result = validateHandoffReceipts({ root, date: DATE, allowPending: true });

    expect(result.status).toBe("blocked");
    expect(result.ok).toBe(false);
    expect(result.allowPending).toBe(true);
    expect(result.blockers.map((blocker) => blocker.id)).toEqual([
      "owner-assignment-receipt",
      "fixture-manifest",
      "gsav-host-ready-receipt",
    ]);
    expect(result.blockers.every((blocker) => blocker.kind === "missing")).toBe(true);
  });

  it("writes preparation-only templates without satisfying default receipt paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-templates-"));
    const templateOutput = writeHandoffReceiptTemplates({
      root,
      date: DATE,
      writeTemplateDir: `docs/qa-evidence/${DATE}/handoff-receipt-templates`,
    });

    expect(templateOutput).toMatchObject({
      directory: `docs/qa-evidence/${DATE}/handoff-receipt-templates`,
      files: [
        `docs/qa-evidence/${DATE}/handoff-receipt-templates/owner-assignment.template.json`,
        `docs/qa-evidence/${DATE}/handoff-receipt-templates/fixture-manifest.template.json`,
        `docs/qa-evidence/${DATE}/handoff-receipt-templates/gsav-host-ready.template.json`,
      ],
    });
    for (const relativePath of templateOutput.files) {
      expect(fs.existsSync(path.join(root, relativePath))).toBe(true);
    }
    const ownerTemplate = JSON.parse(fs.readFileSync(path.join(root, templateOutput.files[0]), "utf8"));
    const fixtureTemplate = JSON.parse(fs.readFileSync(path.join(root, templateOutput.files[1]), "utf8"));
    const hostTemplate = JSON.parse(fs.readFileSync(path.join(root, templateOutput.files[2]), "utf8"));
    expect(ownerTemplate.owners.android).toBe("<android-validation-owner>");
    expect(fixtureTemplate.evidenceDate).toBe(DATE);
    expect(fixtureTemplate.gsavHostUrl).toBe("https://<production-gsav-host>");
    expect(fixtureTemplate.gsavHostingCommit).toBe("<GSAV_HOSTING_COMMIT>");
    expect(hostTemplate.evidenceDate).toBe(DATE);
    expect(hostTemplate.routeGuardTest.outputPath).toBe(`docs/qa-evidence/${DATE}/<route-guard-output>`);
    expect(hostTemplate.preflightOutputPath).toBe(`docs/qa-evidence/${DATE}/<gsav-preflight-output>`);
    expect(hostTemplate.runtimeSmokeOutputPath).toBe(`docs/qa-evidence/${DATE}/<runtime-smoke-output>`);
    expect(fixtureTemplate.expectedFinalEmbeddedUrls["/explore"]).toContain("dataSaver=1");

    const currentGate = validateHandoffReceipts({ root, date: DATE, allowPending: true });
    expect(currentGate.status).toBe("blocked");
    expect(currentGate.blockers.every((blocker) => blocker.kind === "missing")).toBe(true);
  });

  it("rejects template output directories outside the repository root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-template-root-"));

    expect(() => writeHandoffReceiptTemplates({
      root,
      date: DATE,
      writeTemplateDir: "../outside",
    })).toThrow("--write-template-dir must stay inside the repository root.");
    expect(() => writeHandoffReceiptTemplates({
      root,
      date: DATE,
      writeTemplateDir: path.join(root, "absolute"),
    })).toThrow("--write-template-dir must be repository-relative.");
  });

  it("classifies unsafe or preparation receipt paths before reading JSON", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-paths-"));

    expect(receiptPathLifecycleProblem(root, "")).toBe("receipt path is empty");
    expect(receiptPathLifecycleProblem(root, "../owner-assignment.json"))
      .toBe("receipt path must stay inside the repository root");
    expect(receiptPathLifecycleProblem(root, `docs/qa-evidence/${DATE}/owner-assignment.txt`))
      .toBe("receipt path must be a JSON file");

    for (const receiptPath of [
      `docs/qa-evidence/${DATE}/owner-assignment.template.json`,
      `docs/qa-evidence/${DATE}/fixture-manifest.example.json`,
      `docs/qa-evidence/${DATE}/fixture-manifest-pending.json`,
      `docs/qa-evidence/${DATE}/owner-assignment_scaffold.json`,
      `docs/qa-evidence/${DATE}/gsav-host-ready-candidate.json`,
    ]) {
      expect(receiptPathLifecycleProblem(root, receiptPath))
        .toBe("receipt path basename must not contain template, example, pending, scaffold, or candidate");
    }
  });

  it("rejects explicit preparation receipt paths even when contents are complete", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-prep-paths-"));
    const ownerReceiptPath = `docs/qa-evidence/${DATE}/owner-assignment.template.json`;
    const fixtureManifestPath = `docs/qa-evidence/${DATE}/fixture-manifest.example.json`;
    const hostReadyPath = `docs/qa-evidence/${DATE}/gsav-host-ready-candidate.json`;
    writeJson(root, ownerReceiptPath, completeOwnerReceipt());
    writeJson(root, fixtureManifestPath, completeFixtureManifest());
    writeJson(root, hostReadyPath, completeHostReadyReceipt());
    writeCompleteReceiptEvidence(root);

    const result = validateHandoffReceipts({
      root,
      date: DATE,
      allowPending: true,
      ownerReceiptPath,
      fixtureManifestPath,
      hostReadyPath,
    });

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual([
      expect.objectContaining({
        id: "owner-assignment-receipt",
        kind: "invalid",
        reason: expect.stringContaining("basename must not contain template"),
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: expect.stringContaining("basename must not contain template"),
      }),
      expect.objectContaining({
        id: "gsav-host-ready-receipt",
        kind: "invalid",
        reason: expect.stringContaining("basename must not contain template"),
      }),
    ]);
  });

  it("rejects absolute, outside-root, and non-json receipt paths as invalid blockers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-invalid-paths-"));
    const absoluteReceiptPath = path.resolve(root, "owner-assignment.json");
    writeJson(root, "docs/qa-evidence/outside.json", completeFixtureManifest());
    writeJson(root, `docs/qa-evidence/${DATE}/gsav-host-ready.txt`, completeHostReadyReceipt());
    writeCompleteReceiptEvidence(root);

    const result = validateHandoffReceipts({
      root,
      date: DATE,
      allowPending: true,
      ownerReceiptPath: absoluteReceiptPath,
      fixtureManifestPath: "../outside.json",
      hostReadyPath: `docs/qa-evidence/${DATE}/gsav-host-ready.txt`,
    });

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual([
      expect.objectContaining({
        id: "owner-assignment-receipt",
        kind: "invalid",
        reason: expect.stringContaining("must be repository-relative"),
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: expect.stringContaining("must stay inside the repository root"),
      }),
      expect.objectContaining({
        id: "gsav-host-ready-receipt",
        kind: "invalid",
        reason: expect.stringContaining("must be a JSON file"),
      }),
    ]);
  });

  it("passes when owner, fixture, and host-ready receipts are complete", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-complete-"));
    writeCompleteReceipts(root);

    const result = validateHandoffReceipts({ root, date: DATE });

    expect(result.status).toBe("pass");
    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.checked).toMatchObject({
      ownerAssignment: { status: "pass" },
      fixtureManifest: { status: "pass" },
      hostReady: { status: "pass" },
    });
  });

  it("ties fixture URLs and host identity to the host-ready receipt", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-cross-contract-"));
    writeCompleteReceipts(root);
    writeJson(root, `docs/qa-evidence/${DATE}/fixture-manifest.json`, {
      ...completeFixtureManifest(),
      gsavHostUrl: "https://other-gsav.opsiclear.dev",
      gsavHostingCommit: "gsav-host-different",
      expectedFinalEmbeddedUrls: {
        ...completeFixtureManifest().expectedFinalEmbeddedUrls,
        "/explore": "https://other-gsav.opsiclear.dev/explore?embed=native",
      },
    });

    const result = validateHandoffReceipts({ root, date: DATE, allowPending: true });

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: expect.stringContaining("fixture manifest gsavHostUrl origin must match host-ready gsavHostUrl origin"),
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: expect.stringContaining("fixture manifest gsavHostingCommit must match host-ready gsavHostingCommit"),
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: expect.stringContaining("fixture manifest gsavHostingCommit must match host-ready observedIdentity"),
      }),
    ]));
  });

  it("requires host-ready identity and CORS origin to match the GSAV host origin", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-host-origin-"));
    writeCompleteReceipts(root);
    writeJson(root, `docs/qa-evidence/${DATE}/gsav-host-ready.json`, {
      ...completeHostReadyReceipt(),
      gsavHostIdentityUrl: "https://metadata.opsiclear.dev/build.json",
      range: {
        ...completeHostReadyReceipt().range,
        accessControlAllowOrigin: "https://other.opsiclear.dev",
      },
    });

    const result = validateHandoffReceipts({ root, date: DATE, allowPending: true });

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "gsav-host-ready-receipt",
        kind: "invalid",
        reason: "host-ready receipt gsavHostIdentityUrl must share gsavHostUrl origin",
      }),
      expect.objectContaining({
        id: "gsav-host-ready-receipt",
        kind: "invalid",
        reason: "host-ready receipt range.accessControlAllowOrigin must be * or the gsavHostUrl origin",
      }),
    ]));
  });

  it("accepts range CORS when it allows the exact GSAV host origin", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-host-cors-"));
    writeCompleteReceipts(root);
    writeJson(root, `docs/qa-evidence/${DATE}/gsav-host-ready.json`, {
      ...completeHostReadyReceipt(),
      range: {
        ...completeHostReadyReceipt().range,
        accessControlAllowOrigin: "https://gsav.opsiclear.dev",
      },
    });

    const result = validateHandoffReceipts({ root, date: DATE });

    expect(result.status).toBe("pass");
    expect(result.blockers).toEqual([]);
  });

  it("requires local host-ready evidence paths to use the same evidence date", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-host-date-"));
    writeCompleteReceipts(root);
    for (const file of [
      "gsav-host-route-guard.txt",
      "gsav-preflight.json",
      "gsav-runtime-smoke.json",
    ]) {
      const fullPath = path.join(root, `docs/qa-evidence/2026-06-30/${file}`);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, "old evidence\n");
    }
    writeJson(root, `docs/qa-evidence/${DATE}/gsav-host-ready.json`, {
      ...completeHostReadyReceipt(),
      routeGuardTest: {
        ...completeHostReadyReceipt().routeGuardTest,
        outputPath: "docs/qa-evidence/2026-06-30/gsav-host-route-guard.txt",
      },
      preflightOutputPath: "docs/qa-evidence/2026-06-30/gsav-preflight.json",
      runtimeSmokeOutputPath: "docs/qa-evidence/2026-06-30/gsav-runtime-smoke.json",
    });

    const result = validateHandoffReceipts({ root, date: DATE, allowPending: true });

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "gsav-host-ready-receipt",
        kind: "invalid",
        reason: `host-ready receipt route guard test output local docs/qa-evidence reference must be under docs/qa-evidence/${DATE}/`,
      }),
      expect.objectContaining({
        id: "gsav-host-ready-receipt",
        kind: "invalid",
        reason: `host-ready receipt preflight output local docs/qa-evidence reference must be under docs/qa-evidence/${DATE}/`,
      }),
      expect.objectContaining({
        id: "gsav-host-ready-receipt",
        kind: "invalid",
        reason: `host-ready receipt runtime-smoke output local docs/qa-evidence reference must be under docs/qa-evidence/${DATE}/`,
      }),
    ]));
  });

  it("requires the host-ready receipt evidenceDate to match the requested date", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-host-evidence-date-"));
    writeCompleteReceipts(root);
    writeJson(root, `docs/qa-evidence/${DATE}/gsav-host-ready.json`, {
      ...completeHostReadyReceipt(),
      evidenceDate: "2026-06-30",
    });

    const result = validateHandoffReceipts({ root, date: DATE, allowPending: true });

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "gsav-host-ready-receipt",
        kind: "invalid",
        reason: `host-ready receipt evidenceDate must be ${DATE}`,
      }),
    ]));
  });

  it("requires the host-ready route guard command to name the hosted guard", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-host-guard-command-"));
    writeCompleteReceipts(root);
    writeJson(root, `docs/qa-evidence/${DATE}/gsav-host-ready.json`, {
      ...completeHostReadyReceipt(),
      routeGuardTest: {
        ...completeHostReadyReceipt().routeGuardTest,
        command: "npm test -- apps/web/routes.test.ts",
      },
    });

    const result = validateHandoffReceipts({ root, date: DATE, allowPending: true });

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "gsav-host-ready-receipt",
        kind: "invalid",
        reason: "host-ready receipt routeGuardTest.command must name the hosted native route guard test",
      }),
    ]));
  });

  it("requires exact native embed and Explore data-saver query params in fixture URLs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-fixture-query-"));
    writeCompleteReceipts(root);
    writeJson(root, `docs/qa-evidence/${DATE}/fixture-manifest.json`, {
      ...completeFixtureManifest(),
      expectedFinalEmbeddedUrls: {
        ...completeFixtureManifest().expectedFinalEmbeddedUrls,
        "/explore": "https://gsav.opsiclear.dev/explore?embed=native",
        "/watch/test": "https://gsav.opsiclear.dev/watch/test?embed=native&embed=native",
      },
    });

    const result = validateHandoffReceipts({ root, date: DATE, allowPending: true });

    expect(hasExactlyOneQueryParam("https://gsav.opsiclear.dev/explore?dataSaver=1&embed=native", "embed", "native")).toBe(true);
    expect(hasExactlyOneQueryParam("https://gsav.opsiclear.dev/explore?embed=native&embed=native", "embed", "native")).toBe(false);
    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest expectedFinalEmbeddedUrls./explore must contain exactly one dataSaver=1",
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest expectedFinalEmbeddedUrls./watch/test must contain exactly one embed=native",
      }),
    ]));
  });

  it("requires completed fixture manifests to be account-safe and redacted", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-fixture-redaction-"));
    writeCompleteReceipts(root);
    writeJson(root, `docs/qa-evidence/${DATE}/fixture-manifest.json`, {
      ...completeFixtureManifest(),
      fixtureAccountAlias: "real.user@opsiclear.dev",
      resetCommand: "npm run fixtures:reset -- --user_id=customer123 --access_token=live-access-token-12345",
      redactionNotes: "safe fixture",
      reviewerLogUrl: "https://reviewer:secret@example.com/fixture-log",
    });

    const result = validateHandoffReceipts({ root, date: DATE, allowPending: true });

    expect(redactedOrPlaceholder("fixture-account-redacted")).toBe(true);
    expect(redactedOrPlaceholder("live customer account")).toBe(false);
    expect(unredactedEmailDomains("fixture@example.com real.user@opsiclear.dev")).toEqual(["opsiclear.dev"]);
    expect(collectStringFields({ outer: { inner: "value" } })).toEqual([["outer.inner", "value"]]);
    expect(fixtureManifestSecretProblems("fixtureAccountAlias", "real.user@opsiclear.dev")).toContain(
      "fixture manifest fixtureAccountAlias contains unredacted email domain opsiclear.dev",
    );
    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest redactionNotes must describe account-safe redaction",
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest fixtureAccountAlias contains unredacted email domain opsiclear.dev",
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest resetCommand contains raw auth token assignment",
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest resetCommand contains raw account identifier",
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest reviewerLogUrl contains URL credentials",
      }),
    ]));
  });

  it("requires fixture URLs to target the expected hosted paths and scene IDs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-fixture-paths-"));
    writeCompleteReceipts(root);
    writeJson(root, `docs/qa-evidence/${DATE}/fixture-manifest.json`, {
      ...completeFixtureManifest(),
      sceneIds: {
        watchTest: "fixture-watch",
        aliasStartTime: "fixture-alias",
      },
      expectedFinalEmbeddedUrls: {
        "/explore": "https://gsav.opsiclear.dev/watch/fixture-watch?embed=native&dataSaver=1",
        "/gsav-diagnostics": "https://gsav.opsiclear.dev/diagnostics?embed=native",
        "/watch/test": "https://gsav.opsiclear.dev/watch/other-scene?embed=native",
        "/gsav/test?t=2.5": "https://gsav.opsiclear.dev/watch/fixture-watch?t=2.5&embed=native",
      },
    });

    const result = validateHandoffReceipts({ root, date: DATE, allowPending: true });

    expect(urlPathname("https://gsav.opsiclear.dev/native-diagnostics?embed=native")).toBe("/native-diagnostics");
    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest expectedFinalEmbeddedUrls./explore must use hosted path /explore",
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest expectedFinalEmbeddedUrls./gsav-diagnostics must use hosted path /native-diagnostics",
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest expectedFinalEmbeddedUrls./watch/test must use hosted path /watch/fixture-watch",
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest expectedFinalEmbeddedUrls./gsav/test?t=2.5 must use hosted path /watch/fixture-alias",
      }),
    ]));
  });

  it("requires fixture scene IDs to be single URL path segments", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-fixture-segment-"));
    writeCompleteReceipts(root);
    writeJson(root, `docs/qa-evidence/${DATE}/fixture-manifest.json`, {
      ...completeFixtureManifest(),
      sceneIds: {
        watchTest: "nested/test",
        aliasStartTime: "alias?bad=true",
      },
    });

    const result = validateHandoffReceipts({ root, date: DATE, allowPending: true });

    expect(singlePathSegment("test-scene")).toBe(true);
    expect(singlePathSegment("nested/test")).toBe(false);
    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest sceneIds.watchTest must be a single URL path segment",
      }),
      expect.objectContaining({
        id: "fixture-manifest",
        kind: "invalid",
        reason: "fixture manifest sceneIds.aliasStartTime must be a single URL path segment",
      }),
    ]));
  });

  it("requires complete final handoff receipt JSON to be tracked and clean in strict mode", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-git-integrity-"));
    writeCompleteReceipts(root);
    const receiptPaths = [
      `docs/qa-evidence/${DATE}/owner-assignment.json`,
      `docs/qa-evidence/${DATE}/fixture-manifest.json`,
      `docs/qa-evidence/${DATE}/gsav-host-ready.json`,
    ];
    git(root, ["init"]);

    let result = validateHandoffReceipts({
      root,
      date: DATE,
      requireGitIntegrity: true,
    });

    expect(result.status).toBe("fail");
    expect(result.gitIntegrityRequired).toBe(true);
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "receipt-git-integrity",
        reason: `handoff receipt must be tracked in git before final readiness: ${receiptPaths[0]}`,
      }),
    ]));

    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "handoff receipts"]);
    expect(receiptGitIntegrityBlockers(root, receiptPaths)).toEqual([]);
    expect(validateHandoffReceipts({
      root,
      date: DATE,
      requireGitIntegrity: true,
    }).status).toBe("pass");

    fs.appendFileSync(path.join(root, receiptPaths[0]), "\n");
    result = validateHandoffReceipts({
      root,
      date: DATE,
      requireGitIntegrity: true,
    });

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "receipt-git-integrity",
        reason: expect.stringContaining("handoff receipt files must be committed before final readiness:"),
      }),
    ]));
  });

  it("fails malformed receipts even when pending mode is allowed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-invalid-"));
    writeCompleteReceipts(root);
    writeJson(root, `docs/qa-evidence/${DATE}/owner-assignment.json`, {
      ...completeOwnerReceipt(),
      owners: {
        ...completeOwnerReceipt().owners,
        android: "owner",
      },
    });

    const result = validateHandoffReceipts({ root, date: DATE, allowPending: true });

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "owner-assignment-receipt",
        kind: "invalid",
        reason: expect.stringContaining("concrete Android validation owner"),
      }),
    ]));
  });

  it("requires host evidence references to be durable and local docs evidence to exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-reference-"));

    expect(evidenceReferenceProblem("https://github.com/OpsiClear-Web/diveo/actions/runs/123/artifacts/host-ready", root))
      .toBeNull();
    expect(evidenceReferenceProblem(`docs/qa-evidence/${DATE}/missing.txt`, root))
      .toBe("local docs/qa-evidence reference does not exist");
    expect(evidenceReferenceProblem("../gsav-hosting/output.txt", root))
      .toBe("evidence reference must be under docs/qa-evidence, release-evidence, or trusted GitHub evidence");
  });
});
