import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  SCHEMA_VERSION,
  analyzeExternalEvidenceInventory,
  buildExternalEvidenceInventoryScaffold,
  collectRequiredEvidence,
  evidenceCandidates,
  inventoryPacketDateProblems,
  requiredReplayPacketPathProblems,
  reviewedInventoryPathProblems,
  reviewedPacketPathProblems,
  writeExternalEvidenceInventoryScaffold,
} = require("./verify-external-evidence-inventory.js");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "external-evidence-inventory-"));
}

function writeFile(root, relativePath, contents = "evidence") {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
  return relativePath;
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function git(root, args) {
  execFileSync("git", args, {
    cwd: root,
    stdio: "ignore",
  });
}

function qaDoc(rows) {
  return `# QA

## Evidence Log

| Date | Platform | Device/Emulator | GSAV web URL | diveo route | Result | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
}

function qaRow({
  platform = "Branch protection",
  device = "GitHub",
  gsavWebUrl = "https://github.com/OpsiClear-Web/diveo",
  route = "Master branch protection",
  result = "Passed: branch protection reviewed",
  evidencePath = "docs/qa-evidence/2026-07-01/master-branch-protection.json",
  notes = "reviewer=release-reviewer; reviewedAt=2026-07-01T16:10:00Z",
} = {}) {
  return `| 2026-07-01 | ${platform} | ${device} | ${gsavWebUrl} | ${route} | ${result} | ${evidencePath} | ${notes} |`;
}

function baseInventory(entries) {
  return {
    schemaVersion: SCHEMA_VERSION,
    reviewer: "release-reviewer",
    reviewedAt: "2026-07-01T16:10:00Z",
    entries,
  };
}

describe("external evidence inventory verifier", () => {
  it("accepts byte-backed local QA evidence entries", () => {
    const root = tempRepo();
    const jsonPath = writeFile(root, "docs/qa-evidence/2026-07-01/master-branch-protection.json", "{\"ok\":true}\n");
    const logPath = writeFile(root, "docs/qa-evidence/2026-07-01/master-branch-protection-review.txt", "reviewed\n");
    const qaText = qaDoc([qaRow({ evidencePath: `${jsonPath}, ${logPath}` })]);
    const inventory = baseInventory([
      {
        evidencePath: jsonPath,
        sha256: sha256("{\"ok\":true}\n"),
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
      },
      {
        evidencePath: logPath,
        sha256: sha256("reviewed\n"),
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
      },
    ]);

    expect(analyzeExternalEvidenceInventory({ inventory, qaText, root })).toMatchObject({
      ok: true,
      checkedRequiredEvidence: 2,
      checkedInventoryEntries: 2,
    });
  });

  it("rejects missing inventory rows and local hash mismatches", () => {
    const root = tempRepo();
    const evidencePath = writeFile(root, "docs/qa-evidence/2026-07-01/master-branch-protection.json", "{\"ok\":true}\n");
    const qaText = qaDoc([qaRow({ evidencePath })]);
    const missing = analyzeExternalEvidenceInventory({
      inventory: baseInventory([]),
      qaText,
      root,
    });
    expect(missing.ok).toBe(false);
    expect(missing.problems).toContain(
      `qa Branch protection Master branch protection is missing inventory entry for ${evidencePath}`,
    );

    const mismatch = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath,
        sha256: "a".repeat(64),
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
      }]),
      qaText,
      root,
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.problems).toContain(
      `${evidencePath} inventory sha256 mismatch: expected ${"a".repeat(64)}, got ${sha256("{\"ok\":true}\n")}`,
    );
  });

  it("verifies direct GitHub route artifacts through downloaded bytes and manifest contents", () => {
    const root = tempRepo();
    const artifactUrl = "https://github.com/opsiclear/diveo/actions/runs/123/artifacts/android-route-home";
    const downloadedPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/external/123/android-route-home/android-route-home.zip",
      "zip-bytes\n",
    );
    const manifestContents = JSON.stringify({
      artifactPurpose: "route-evidence",
      helperOnly: false,
      sourceRunId: "123",
      sourceArtifactId: "android-route-home",
      route: "/",
      evidenceFiles: ["android-route-home.png"],
    });
    const manifestPath = writeFile(root, "docs/qa-evidence/2026-07-01/android-route-home-manifest.json", manifestContents);
    const qaText = qaDoc([qaRow({
      platform: "Android",
      device: "Pixel 8 / Android 15 / WebView 126",
      gsavWebUrl: "https://gsav.opsiclear.dev",
      route: "/",
      result: "Passed: native home/feed rendered; no hosted web chrome visible",
      evidencePath: artifactUrl,
      notes: "releaseCandidateSha=abc1234567890abcdef1234567890abcdef12345; dry-run artifact=diveo-release-evidence-v1.0.19",
    })]);
    const inventory = baseInventory([{
      evidencePath: artifactUrl,
      downloadedPath,
      sha256: sha256("zip-bytes\n"),
      status: "pass",
      reviewer: "release-reviewer",
      reviewedAt: "2026-07-01T16:10:00Z",
      artifactPurpose: "route-evidence",
      helperOnly: false,
      manifestPath,
      manifestSha256: sha256(manifestContents),
      sourceRunId: "123",
      sourceArtifactId: "android-route-home",
    }]);

    expect(analyzeExternalEvidenceInventory({ inventory, qaText, root })).toMatchObject({
      ok: true,
      checkedRequiredEvidence: 1,
    });
  });

  it("requires URL-backed artifact replay under the deterministic external staging path", () => {
    const root = tempRepo();
    const artifactUrl = "https://github.com/opsiclear/diveo/actions/runs/123/artifacts/android-route-home";
    const downloadedPath = writeFile(root, "docs/qa-evidence/2026-07-01/android-route-home.zip", "zip-bytes\n");
    const manifestContents = JSON.stringify({
      artifactPurpose: "route-evidence",
      helperOnly: false,
      sourceRunId: "123",
      sourceArtifactId: "android-route-home",
    });
    const manifestPath = writeFile(root, "docs/qa-evidence/2026-07-01/android-route-home-manifest.json", manifestContents);
    const qaText = qaDoc([qaRow({
      platform: "Android",
      device: "Pixel 8 / Android 15 / WebView 126",
      gsavWebUrl: "https://gsav.opsiclear.dev",
      route: "/",
      result: "Passed: native home/feed rendered; no hosted web chrome visible",
      evidencePath: artifactUrl,
    })]);

    const result = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: artifactUrl,
        downloadedPath,
        sha256: sha256("zip-bytes\n"),
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        artifactPurpose: "route-evidence",
        helperOnly: false,
        manifestPath,
        manifestSha256: sha256(manifestContents),
        sourceRunId: "123",
        sourceArtifactId: "android-route-home",
      }]),
      inventoryPath: "docs/qa-evidence/2026-07-01/external-evidence-inventory.json",
      qaText,
      root,
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([
      `${artifactUrl} downloadedPath must be under docs/qa-evidence/<date>/external/`,
    ]));
  });

  it("rejects route artifact manifests from a stale evidence date", () => {
    const root = tempRepo();
    const artifactUrl = "https://github.com/opsiclear/diveo/actions/runs/123/artifacts/android-route-home";
    const downloadedPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/external/123/android-route-home/android-route-home.zip",
      "zip-bytes\n",
    );
    const manifestContents = JSON.stringify({
      artifactPurpose: "route-evidence",
      helperOnly: false,
      sourceRunId: "123",
      sourceArtifactId: "android-route-home",
      route: "/",
      evidenceFiles: ["android-route-home.png"],
    });
    const staleManifestPath = writeFile(
      root,
      "docs/qa-evidence/2026-06-30/android-route-home-manifest.json",
      manifestContents,
    );
    const qaText = qaDoc([qaRow({
      platform: "Android",
      device: "Pixel 8 / Android 15 / WebView 126",
      gsavWebUrl: "https://gsav.opsiclear.dev",
      route: "/",
      result: "Passed: native home/feed rendered; no hosted web chrome visible",
      evidencePath: artifactUrl,
    })]);

    const result = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: artifactUrl,
        downloadedPath,
        sha256: sha256("zip-bytes\n"),
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        artifactPurpose: "route-evidence",
        helperOnly: false,
        manifestPath: staleManifestPath,
        manifestSha256: sha256(manifestContents),
        sourceRunId: "123",
        sourceArtifactId: "android-route-home",
      }]),
      inventoryPath: "docs/qa-evidence/2026-07-01/external-evidence-inventory.json",
      qaText,
      root,
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      `${artifactUrl} manifestPath date must match evidence date 2026-07-01`,
    );
  });

  it("validates URL-backed inventory entries even when no QA or packet row requires them", () => {
    const root = tempRepo();
    const artifactUrl = "https://github.com/opsiclear/diveo/actions/runs/123/artifacts/unreferenced-review-artifact";
    const result = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: artifactUrl,
        sha256: "a".repeat(64),
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
      }]),
      inventoryPath: "docs/qa-evidence/2026-07-01/external-evidence-inventory.json",
      qaText: qaDoc([]),
      root,
    });

    expect(result).toMatchObject({
      ok: false,
      checkedRequiredEvidence: 0,
      checkedInventoryEntries: 1,
    });
    expect(result.problems).toEqual(expect.arrayContaining([
      `${artifactUrl} URL-backed inventory entry requires downloadedPath`,
      `${artifactUrl} sourceRunId must match URL run 123`,
      `${artifactUrl} sourceArtifactId must match URL artifact unreferenced-review-artifact`,
    ]));
  });

  it("requires local replay files to be tracked and clean in strict git-integrity mode", () => {
    const root = tempRepo();
    const qaPath = "docs/GSAV_NATIVE_QA.md";
    const packetPath = "docs/qa-evidence/2026-07-01/device-evidence-packet-reviewed.json";
    const inventoryPath = "docs/qa-evidence/2026-07-01/external-evidence-inventory.json";
    const evidencePath = writeFile(root, "docs/qa-evidence/2026-07-01/master-branch-protection.json", "{\"ok\":true}\n");
    const qaText = qaDoc([qaRow({ evidencePath })]);
    writeFile(root, qaPath, qaText);
    writeFile(root, packetPath, "{\"packets\":[]}\n");
    const inventory = baseInventory([{
      evidencePath,
      sha256: sha256("{\"ok\":true}\n"),
      status: "pass",
      reviewer: "release-reviewer",
      reviewedAt: "2026-07-01T16:10:00Z",
    }]);
    writeFile(root, inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    git(root, ["init"]);

    let result = analyzeExternalEvidenceInventory({
      inventory,
      inventoryPath,
      qaText,
      qaPath,
      packet: { packets: [] },
      packetPath,
      root,
      requireGitIntegrity: true,
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      `external evidence inventory replay file must be tracked in git before final readiness: ${inventoryPath}`,
    );

    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "inventory replay evidence"]);

    result = analyzeExternalEvidenceInventory({
      inventory,
      inventoryPath,
      qaText,
      qaPath,
      packet: { packets: [] },
      packetPath,
      root,
      requireGitIntegrity: true,
    });

    expect(result.ok).toBe(true);
    expect(result.gitIntegrityRequired).toBe(true);

    fs.appendFileSync(path.join(root, evidencePath), "dirty\n");
    result = analyzeExternalEvidenceInventory({
      inventory,
      inventoryPath,
      qaText,
      qaPath,
      packet: { packets: [] },
      packetPath,
      root,
      requireGitIntegrity: true,
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([
      expect.stringContaining("external evidence inventory replay files must be committed before final readiness:"),
    ]));
  });

  it("rejects URL-backed route artifacts with mismatched identity or helper-only manifests", () => {
    const root = tempRepo();
    const artifactUrl = "https://github.com/opsiclear/diveo/actions/runs/123/artifacts/android-route-home";
    const downloadedPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/external/123/android-route-home/android-route-home.zip",
      "zip-bytes\n",
    );
    const manifestContents = JSON.stringify({
      artifactPurpose: "route-evidence",
      helperOnly: true,
    });
    const manifestPath = writeFile(root, "docs/qa-evidence/2026-07-01/android-route-home-manifest.json", manifestContents);
    const qaText = qaDoc([qaRow({
      platform: "Android",
      device: "Pixel 8 / Android 15 / WebView 126",
      gsavWebUrl: "https://gsav.opsiclear.dev",
      route: "/",
      result: "Passed: native home/feed rendered; no hosted web chrome visible",
      evidencePath: artifactUrl,
    })]);
    const result = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: artifactUrl,
        downloadedPath,
        sha256: sha256("zip-bytes\n"),
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        artifactPurpose: "route-evidence",
        helperOnly: false,
        manifestPath,
        manifestSha256: sha256(manifestContents),
        sourceRunId: "999",
        sourceArtifactId: "wrong",
      }]),
      qaText,
      root,
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([
      `${artifactUrl} sourceRunId must match URL run 123`,
      `${artifactUrl} sourceArtifactId must match URL artifact android-route-home`,
      `${artifactUrl} manifest helperOnly must be false`,
    ]));
  });

  it("rejects URL-backed route artifacts whose manifest source identity mismatches the artifact URL", () => {
    const root = tempRepo();
    const artifactUrl = "https://github.com/opsiclear/diveo/actions/runs/123/artifacts/android-route-home";
    const downloadedPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/external/123/android-route-home/android-route-home.zip",
      "zip-bytes\n",
    );
    const manifestContents = JSON.stringify({
      artifactPurpose: "route-evidence",
      helperOnly: false,
      sourceRunId: "999",
      sourceArtifactId: "wrong-artifact",
      route: "/",
      evidenceFiles: ["android-route-home.png"],
    });
    const manifestPath = writeFile(root, "docs/qa-evidence/2026-07-01/android-route-home-manifest.json", manifestContents);
    const qaText = qaDoc([qaRow({
      platform: "Android",
      device: "Pixel 8 / Android 15 / WebView 126",
      gsavWebUrl: "https://gsav.opsiclear.dev",
      route: "/",
      result: "Passed: native home/feed rendered; no hosted web chrome visible",
      evidencePath: artifactUrl,
    })]);

    const result = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: artifactUrl,
        downloadedPath,
        sha256: sha256("zip-bytes\n"),
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        artifactPurpose: "route-evidence",
        helperOnly: false,
        manifestPath,
        manifestSha256: sha256(manifestContents),
        sourceRunId: "123",
        sourceArtifactId: "android-route-home",
      }]),
      qaText,
      root,
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([
      `${artifactUrl} manifest sourceRunId must match URL run 123`,
      `${artifactUrl} manifest sourceArtifactId must match URL artifact android-route-home`,
    ]));
  });

  it("requires route artifact manifest contents to declare artifact purpose", () => {
    const root = tempRepo();
    const artifactUrl = "https://github.com/opsiclear/diveo/actions/runs/123/artifacts/android-route-home";
    const downloadedPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/external/123/android-route-home/android-route-home.zip",
      "zip-bytes\n",
    );
    const manifestContents = JSON.stringify({
      helperOnly: false,
      sourceRunId: "123",
      sourceArtifactId: "android-route-home",
      route: "/",
      evidenceFiles: ["android-route-home.png"],
    });
    const manifestPath = writeFile(root, "docs/qa-evidence/2026-07-01/android-route-home-manifest.json", manifestContents);
    const qaText = qaDoc([qaRow({
      platform: "Android",
      device: "Pixel 8 / Android 15 / WebView 126",
      gsavWebUrl: "https://gsav.opsiclear.dev",
      route: "/",
      result: "Passed: native home/feed rendered; no hosted web chrome visible",
      evidencePath: artifactUrl,
    })]);

    const result = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: artifactUrl,
        downloadedPath,
        sha256: sha256("zip-bytes\n"),
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        artifactPurpose: "route-evidence",
        helperOnly: false,
        manifestPath,
        manifestSha256: sha256(manifestContents),
        sourceRunId: "123",
        sourceArtifactId: "android-route-home",
      }]),
      qaText,
      root,
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      `${artifactUrl} manifest artifactPurpose must be route-evidence`,
    );
  });

  it("can require passed packet evidence in addition to QA row evidence", () => {
    const root = tempRepo();
    const qaEvidencePath = writeFile(root, "docs/qa-evidence/2026-07-01/master-branch-protection.json", "{\"ok\":true}\n");
    const packetEvidencePath = writeFile(root, "docs/qa-evidence/2026-07-01/android-watch-test.txt", "watch evidence\n");
    const packet = {
      packets: [{
        id: "android-route-watch-test",
        type: "route",
        status: "passed",
        actual: {
          evidencePaths: [packetEvidencePath],
        },
      }],
    };
    const qaText = qaDoc([qaRow({ evidencePath: qaEvidencePath })]);
    const required = collectRequiredEvidence({ qaText, packet });
    expect(required.map((entry) => entry.evidencePath)).toEqual([
      qaEvidencePath,
      packetEvidencePath,
    ]);

    const result = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: qaEvidencePath,
        sha256: sha256("{\"ok\":true}\n"),
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
      }]),
      qaText,
      packet,
      root,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      `packet android-route-watch-test is missing inventory entry for ${packetEvidencePath}`,
    );
  });

  it("requires packet target product journey manifest review in the inventory", () => {
    const root = tempRepo();
    const qaText = qaDoc([]);
    const manifestPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/product-journey-manifest.json",
      "{\"artifactPurpose\":\"product-journey-manifest\",\"helperOnly\":false,\"entries\":[]}\n",
    );
    const packet = {
      target: {
        productJourneyManifestPath: manifestPath,
      },
      packets: [],
    };

    expect(collectRequiredEvidence({ qaText, packet })).toEqual([expect.objectContaining({
      evidencePath: manifestPath,
      source: "packet-target",
      packetId: "product-journey-manifest",
    })]);

    const missingResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([]),
      qaText,
      packet,
      root,
    });
    expect(missingResult.ok).toBe(false);
    expect(missingResult.problems).toContain(
      `packet-target product-journey-manifest is missing inventory entry for ${manifestPath}`,
    );

    const reviewedResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: manifestPath,
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        sha256: sha256("{\"artifactPurpose\":\"product-journey-manifest\",\"helperOnly\":false,\"entries\":[]}\n"),
        artifactPurpose: "product-journey-manifest",
        helperOnly: false,
      }]),
      qaText,
      packet,
      root,
    });
    expect(reviewedResult).toMatchObject({
      ok: true,
      checkedRequiredEvidence: 1,
      checkedInventoryEntries: 1,
    });

    const unclassifiedResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: manifestPath,
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        sha256: sha256("{\"artifactPurpose\":\"product-journey-manifest\",\"helperOnly\":false,\"entries\":[]}\n"),
      }]),
      qaText,
      packet,
      root,
    });
    expect(unclassifiedResult.ok).toBe(false);
    expect(unclassifiedResult.problems).toEqual(expect.arrayContaining([
      `${manifestPath} artifactPurpose must be product-journey-manifest`,
      `${manifestPath} helperOnly must be false`,
    ]));
  });

  it("rejects product journey manifests that cannot be expanded during inventory replay", () => {
    const root = tempRepo();
    const qaText = qaDoc([]);
    const missingEntriesPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/product-journey-manifest.json",
      "{\"artifactPurpose\":\"product-journey-manifest\",\"helperOnly\":false}\n",
    );
    const missingEntriesPacket = {
      target: {
        productJourneyManifestPath: missingEntriesPath,
      },
      packets: [],
    };
    const missingEntriesResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: missingEntriesPath,
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        sha256: sha256("{\"artifactPurpose\":\"product-journey-manifest\",\"helperOnly\":false}\n"),
        artifactPurpose: "product-journey-manifest",
        helperOnly: false,
      }]),
      qaText,
      packet: missingEntriesPacket,
      root,
    });
    expect(missingEntriesResult.ok).toBe(false);
    expect(missingEntriesResult.problems).toContain(
      `product journey manifest entries must be an array for inventory expansion: ${missingEntriesPath}`,
    );

    const misclassifiedManifestPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/product-journey-manifest-misclassified.json",
      "{\"artifactPurpose\":\"route-evidence\",\"helperOnly\":true,\"entries\":[]}\n",
    );
    const misclassifiedResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: misclassifiedManifestPath,
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        sha256: sha256("{\"artifactPurpose\":\"route-evidence\",\"helperOnly\":true,\"entries\":[]}\n"),
        artifactPurpose: "product-journey-manifest",
        helperOnly: false,
      }]),
      qaText,
      packet: {
        target: {
          productJourneyManifestPath: misclassifiedManifestPath,
        },
        packets: [],
      },
      root,
    });
    expect(misclassifiedResult.ok).toBe(false);
    expect(misclassifiedResult.problems).toEqual(expect.arrayContaining([
      `product journey manifest artifactPurpose must be product-journey-manifest for inventory expansion: ${misclassifiedManifestPath}`,
      `product journey manifest helperOnly must be false for inventory expansion: ${misclassifiedManifestPath}`,
    ]));

    const duplicateEntryManifestContents = JSON.stringify({
      artifactPurpose: "product-journey-manifest",
      helperOnly: false,
      entries: [
        { id: "first-launch-home", evidencePaths: [] },
        { id: "first-launch-home", evidencePaths: [] },
      ],
    });
    const duplicateEntryManifestPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/product-journey-manifest-duplicate-entry.json",
      `${duplicateEntryManifestContents}\n`,
    );
    const duplicateEntryResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: duplicateEntryManifestPath,
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        sha256: sha256(`${duplicateEntryManifestContents}\n`),
        artifactPurpose: "product-journey-manifest",
        helperOnly: false,
      }]),
      qaText,
      packet: {
        target: {
          productJourneyManifestPath: duplicateEntryManifestPath,
        },
        packets: [],
      },
      root,
    });
    expect(duplicateEntryResult.ok).toBe(false);
    expect(duplicateEntryResult.problems).toContain(
      `product journey manifest entry id first-launch-home is duplicated for inventory expansion: ${duplicateEntryManifestPath}`,
    );

    const weakEntryManifestContents = JSON.stringify({
      artifactPurpose: "product-journey-manifest",
      helperOnly: false,
      entries: [{ id: "_pending_", evidencePaths: [] }],
    });
    const weakEntryManifestPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/product-journey-manifest-weak-entry.json",
      `${weakEntryManifestContents}\n`,
    );
    const weakEntryResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: weakEntryManifestPath,
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        sha256: sha256(`${weakEntryManifestContents}\n`),
        artifactPurpose: "product-journey-manifest",
        helperOnly: false,
      }]),
      qaText,
      packet: {
        target: {
          productJourneyManifestPath: weakEntryManifestPath,
        },
        packets: [],
      },
      root,
    });
    expect(weakEntryResult.ok).toBe(false);
    expect(weakEntryResult.problems).toContain(
      `product journey manifest entry 0 id must be concrete for inventory expansion: ${weakEntryManifestPath}`,
    );

    const invalidJsonPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/product-journey-manifest-invalid.json",
      "{\"artifactPurpose\":\"product-journey-manifest\"",
    );
    const invalidJsonResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: invalidJsonPath,
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        sha256: sha256("{\"artifactPurpose\":\"product-journey-manifest\""),
        artifactPurpose: "product-journey-manifest",
        helperOnly: false,
      }]),
      qaText,
      packet: {
        target: {
          productJourneyManifestPath: invalidJsonPath,
        },
        packets: [],
      },
      root,
    });
    expect(invalidJsonResult.ok).toBe(false);
    expect(invalidJsonResult.problems.some((problem) => (
      problem.startsWith(`product journey manifest JSON is invalid for inventory expansion: ${invalidJsonPath}:`)
    ))).toBe(true);
  });

  it("rejects product journey manifests that link stale dated local evidence", () => {
    const root = tempRepo();
    const qaText = qaDoc([]);
    const fixtureManifestContents = `${JSON.stringify({
      artifactPurpose: "fixture-manifest",
      helperOnly: false,
      fixtureAccountAlias: "qa-redacted",
    }, null, 2)}\n`;
    const staleFixtureManifestPath = writeFile(
      root,
      "docs/qa-evidence/2026-06-30/fixture-manifest.json",
      fixtureManifestContents,
    );
    const staleLocalEvidencePath = writeFile(
      root,
      "docs/qa-evidence/2026-06-30/android-first-launch-home.png",
      "png-bytes\n",
    );
    const manifest = {
      artifactPurpose: "product-journey-manifest",
      helperOnly: false,
      fixtureManifestPath: staleFixtureManifestPath,
      fixtureManifestSha256: sha256(fixtureManifestContents),
      entries: [{
        id: "first-launch-home",
        evidencePaths: [staleLocalEvidencePath],
        mediaSha256: [sha256("png-bytes\n")],
      }],
    };
    const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/product-journey-manifest.json",
      manifestContents,
    );
    const packet = {
      target: {
        productJourneyManifestPath: manifestPath,
      },
      packets: [],
    };
    const result = analyzeExternalEvidenceInventory({
      inventory: baseInventory([
        {
          evidencePath: manifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(manifestContents),
          artifactPurpose: "product-journey-manifest",
          helperOnly: false,
        },
        {
          evidencePath: staleFixtureManifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(fixtureManifestContents),
          artifactPurpose: "fixture-manifest",
          helperOnly: false,
        },
        {
          evidencePath: staleLocalEvidencePath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("png-bytes\n"),
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          journeyEntryId: "first-launch-home",
        },
      ]),
      qaText,
      packet,
      root,
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([
      `product journey manifest fixtureManifestPath date must match manifest date 2026-07-01: ${staleFixtureManifestPath}`,
      `product journey manifest entry first-launch-home evidencePath date must match manifest date 2026-07-01: ${staleLocalEvidencePath}`,
    ]));
  });

  it("requires product journey manifest evidence paths in the inventory", () => {
    const root = tempRepo();
    const qaText = qaDoc([]);
    const fixtureManifestContents = `${JSON.stringify({
      artifactPurpose: "fixture-manifest",
      helperOnly: false,
      fixtureAccountAlias: "qa-redacted",
    }, null, 2)}\n`;
    const fixtureManifestPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/fixture-manifest.json",
      fixtureManifestContents,
    );
    const localEvidencePath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/android-first-launch-home.png",
      "png-bytes\n",
    );
    const artifactUrl = "https://github.com/opsiclear/diveo/actions/runs/123/artifacts/ios-first-launch-home";
    const downloadedPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/external/123/ios-first-launch-home/ios-first-launch-home.zip",
      "zip-bytes\n",
    );
    const manifest = {
      artifactPurpose: "product-journey-manifest",
      helperOnly: false,
      fixtureManifestPath,
      fixtureManifestSha256: sha256(fixtureManifestContents),
      entries: [{
        id: "first-launch-home",
        evidencePaths: [
          localEvidencePath,
          artifactUrl,
        ],
        mediaSha256: [sha256("png-bytes\n")],
        fileSha256: [sha256("zip-bytes\n")],
        sourceRunId: "123",
        sourceArtifactId: "ios-first-launch-home",
      }],
    };
    const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/product-journey-manifest.json",
      manifestContents,
    );
    const packet = {
      target: {
        productJourneyManifestPath: manifestPath,
      },
      packets: [],
    };

    expect(collectRequiredEvidence({ qaText, packet, root }).map((entry) => ({
      source: entry.source,
      packetId: entry.packetId,
      evidencePath: entry.evidencePath,
      expectedPurpose: entry.expectedPurpose,
    }))).toEqual([
      {
        source: "packet-target",
        packetId: "product-journey-manifest",
        evidencePath: manifestPath,
        expectedPurpose: null,
      },
      {
        source: "product-journey-fixture",
        packetId: "fixture-manifest",
        evidencePath: fixtureManifestPath,
        expectedPurpose: "fixture-manifest",
      },
      {
        source: "product-journey",
        packetId: "first-launch-home",
        evidencePath: localEvidencePath,
        expectedPurpose: "product-journey-evidence",
      },
      {
        source: "product-journey",
        packetId: "first-launch-home",
        evidencePath: artifactUrl,
        expectedPurpose: "product-journey-evidence",
      },
    ]);

    const missingNestedResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([{
        evidencePath: manifestPath,
        status: "pass",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        sha256: sha256(manifestContents),
        artifactPurpose: "product-journey-manifest",
        helperOnly: false,
      }]),
      qaText,
      packet,
      root,
    });
    expect(missingNestedResult.ok).toBe(false);
    expect(missingNestedResult.problems).toEqual(expect.arrayContaining([
      `product-journey-fixture fixture-manifest is missing inventory entry for ${fixtureManifestPath}`,
      `product-journey first-launch-home is missing inventory entry for ${localEvidencePath}`,
      `product-journey first-launch-home is missing inventory entry for ${artifactUrl}`,
    ]));

    const unclassifiedNestedResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([
        {
          evidencePath: manifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(manifestContents),
          artifactPurpose: "product-journey-manifest",
          helperOnly: false,
        },
        {
          evidencePath: fixtureManifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(fixtureManifestContents),
        },
        {
          evidencePath: localEvidencePath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("png-bytes\n"),
        },
        {
          evidencePath: artifactUrl,
          downloadedPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("zip-bytes\n"),
          sourceRunId: "123",
          sourceArtifactId: "ios-first-launch-home",
        },
      ]),
      qaText,
      packet,
      root,
    });
    expect(unclassifiedNestedResult.ok).toBe(false);
    expect(unclassifiedNestedResult.problems).toEqual(expect.arrayContaining([
      `${localEvidencePath} artifactPurpose must be product-journey-evidence`,
      `${localEvidencePath} helperOnly must be false`,
      `${localEvidencePath} journeyEntryId or sourceRefs must reference product journey entry first-launch-home`,
      `${fixtureManifestPath} artifactPurpose must be fixture-manifest`,
      `${fixtureManifestPath} helperOnly must be false`,
      `${artifactUrl} artifactPurpose must be product-journey-evidence`,
      `${artifactUrl} helperOnly must be false`,
      `${artifactUrl} journeyEntryId or sourceRefs must reference product journey entry first-launch-home`,
    ]));

    const staleFixtureResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([
        {
          evidencePath: manifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(manifestContents),
          artifactPurpose: "product-journey-manifest",
          helperOnly: false,
        },
        {
          evidencePath: fixtureManifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: "a".repeat(64),
          artifactPurpose: "fixture-manifest",
          helperOnly: false,
        },
        {
          evidencePath: localEvidencePath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("png-bytes\n"),
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          journeyEntryId: "first-launch-home",
        },
        {
          evidencePath: artifactUrl,
          downloadedPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("zip-bytes\n"),
          sourceRunId: "123",
          sourceArtifactId: "ios-first-launch-home",
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          sourceRefs: [{
            source: "product-journey",
            packetId: "first-launch-home",
          }],
        },
      ]),
      qaText,
      packet,
      root,
    });
    expect(staleFixtureResult.ok).toBe(false);
    expect(staleFixtureResult.problems).toEqual(expect.arrayContaining([
      `${fixtureManifestPath} inventory sha256 mismatch: expected ${"a".repeat(64)}, got ${sha256(fixtureManifestContents)}`,
      `${fixtureManifestPath} inventory sha256 must match product journey fixtureManifestSha256 ${sha256(fixtureManifestContents)}`,
    ]));

    const helperFixtureContents = `${JSON.stringify({
      artifactPurpose: "fixture-manifest",
      helperOnly: true,
      fixtureAccountAlias: "qa-redacted",
    }, null, 2)}\n`;
    fs.writeFileSync(path.join(root, fixtureManifestPath), helperFixtureContents);
    const helperFixtureManifest = {
      ...manifest,
      fixtureManifestSha256: sha256(helperFixtureContents),
    };
    const helperFixtureManifestContents = `${JSON.stringify(helperFixtureManifest, null, 2)}\n`;
    fs.writeFileSync(path.join(root, manifestPath), helperFixtureManifestContents);
    const helperFixtureResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([
        {
          evidencePath: manifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(helperFixtureManifestContents),
          artifactPurpose: "product-journey-manifest",
          helperOnly: false,
        },
        {
          evidencePath: fixtureManifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(helperFixtureContents),
          artifactPurpose: "fixture-manifest",
          helperOnly: false,
        },
        {
          evidencePath: localEvidencePath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("png-bytes\n"),
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          journeyEntryId: "first-launch-home",
        },
        {
          evidencePath: artifactUrl,
          downloadedPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("zip-bytes\n"),
          sourceRunId: "123",
          sourceArtifactId: "ios-first-launch-home",
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          sourceRefs: [{
            source: "product-journey",
            packetId: "first-launch-home",
          }],
        },
      ]),
      qaText,
      packet,
      root,
    });
    expect(helperFixtureResult.ok).toBe(false);
    expect(helperFixtureResult.problems).toContain(
      `${fixtureManifestPath} fixture manifest helperOnly must be false`,
    );

    fs.writeFileSync(path.join(root, fixtureManifestPath), fixtureManifestContents);
    fs.writeFileSync(path.join(root, manifestPath), manifestContents);

    fs.writeFileSync(path.join(root, localEvidencePath), "stale-png-bytes\n");
    const staleLocalEvidenceResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([
        {
          evidencePath: manifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(manifestContents),
          artifactPurpose: "product-journey-manifest",
          helperOnly: false,
        },
        {
          evidencePath: fixtureManifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(fixtureManifestContents),
          artifactPurpose: "fixture-manifest",
          helperOnly: false,
        },
        {
          evidencePath: localEvidencePath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("stale-png-bytes\n"),
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          journeyEntryId: "first-launch-home",
        },
        {
          evidencePath: artifactUrl,
          downloadedPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("zip-bytes\n"),
          sourceRunId: "123",
          sourceArtifactId: "ios-first-launch-home",
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          sourceRefs: [{
            source: "product-journey",
            packetId: "first-launch-home",
          }],
        },
      ]),
      qaText,
      packet,
      root,
    });
    expect(staleLocalEvidenceResult.ok).toBe(false);
    expect(staleLocalEvidenceResult.problems).toContain(
      `${localEvidencePath} inventory sha256 must match product journey mediaSha256 ${sha256("png-bytes\n")}`,
    );

    fs.writeFileSync(path.join(root, localEvidencePath), "png-bytes\n");
    fs.writeFileSync(path.join(root, downloadedPath), "stale-zip-bytes\n");
    const staleExternalEvidenceResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([
        {
          evidencePath: manifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(manifestContents),
          artifactPurpose: "product-journey-manifest",
          helperOnly: false,
        },
        {
          evidencePath: fixtureManifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(fixtureManifestContents),
          artifactPurpose: "fixture-manifest",
          helperOnly: false,
        },
        {
          evidencePath: localEvidencePath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("png-bytes\n"),
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          journeyEntryId: "first-launch-home",
        },
        {
          evidencePath: artifactUrl,
          downloadedPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("stale-zip-bytes\n"),
          sourceRunId: "123",
          sourceArtifactId: "ios-first-launch-home",
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          sourceRefs: [{
            source: "product-journey",
            packetId: "first-launch-home",
          }],
        },
      ]),
      qaText,
      packet,
      root,
    });
    expect(staleExternalEvidenceResult.ok).toBe(false);
    expect(staleExternalEvidenceResult.problems).toContain(
      `${artifactUrl} inventory sha256 must match product journey fileSha256 ${sha256("zip-bytes\n")}`,
    );

    fs.writeFileSync(path.join(root, downloadedPath), "zip-bytes\n");

    const staleSourceIdentityManifest = {
      ...manifest,
      entries: [{
        ...manifest.entries[0],
        sourceRunId: "999",
        sourceArtifactId: "wrong-product-journey",
      }],
    };
    const staleSourceIdentityManifestContents = `${JSON.stringify(staleSourceIdentityManifest, null, 2)}\n`;
    fs.writeFileSync(path.join(root, manifestPath), staleSourceIdentityManifestContents);
    const staleSourceIdentityResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([
        {
          evidencePath: manifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(staleSourceIdentityManifestContents),
          artifactPurpose: "product-journey-manifest",
          helperOnly: false,
        },
        {
          evidencePath: fixtureManifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(fixtureManifestContents),
          artifactPurpose: "fixture-manifest",
          helperOnly: false,
        },
        {
          evidencePath: localEvidencePath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("png-bytes\n"),
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          journeyEntryId: "first-launch-home",
        },
        {
          evidencePath: artifactUrl,
          downloadedPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("zip-bytes\n"),
          sourceRunId: "123",
          sourceArtifactId: "ios-first-launch-home",
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          sourceRefs: [{
            source: "product-journey",
            packetId: "first-launch-home",
          }],
        },
      ]),
      qaText,
      packet,
      root,
    });
    expect(staleSourceIdentityResult.ok).toBe(false);
    expect(staleSourceIdentityResult.problems).toEqual(expect.arrayContaining([
      `${artifactUrl} product journey sourceRunId must match evidence URL run 123 for entry first-launch-home`,
      `${artifactUrl} product journey sourceArtifactId must match evidence URL artifact ios-first-launch-home for entry first-launch-home`,
    ]));

    fs.writeFileSync(path.join(root, manifestPath), manifestContents);

    const reviewedResult = analyzeExternalEvidenceInventory({
      inventory: baseInventory([
        {
          evidencePath: manifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(manifestContents),
          artifactPurpose: "product-journey-manifest",
          helperOnly: false,
        },
        {
          evidencePath: fixtureManifestPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256(fixtureManifestContents),
          artifactPurpose: "fixture-manifest",
          helperOnly: false,
        },
        {
          evidencePath: localEvidencePath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("png-bytes\n"),
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          journeyEntryId: "first-launch-home",
        },
        {
          evidencePath: artifactUrl,
          downloadedPath,
          status: "pass",
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-01T16:10:00Z",
          sha256: sha256("zip-bytes\n"),
          sourceRunId: "123",
          sourceArtifactId: "ios-first-launch-home",
          artifactPurpose: "product-journey-evidence",
          helperOnly: false,
          sourceRefs: [{
            source: "product-journey",
            packetId: "first-launch-home",
          }],
        },
      ]),
      qaText,
      packet,
      root,
    });
    expect(reviewedResult).toMatchObject({
      ok: true,
      checkedRequiredEvidence: 4,
      checkedInventoryEntries: 4,
    });
  });

  it("scaffolds product journey linked evidence with classification and entry refs", () => {
    const root = tempRepo();
    const fixtureManifestPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/fixture-manifest.json",
      "fixture-bytes\n",
    );
    const nestedEvidencePath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/android-first-launch-home.png",
      "png-bytes\n",
    );
    const manifest = {
      artifactPurpose: "product-journey-manifest",
      helperOnly: false,
      fixtureManifestPath,
      fixtureManifestSha256: sha256("fixture-bytes\n"),
      entries: [{
        id: "first-launch-home",
        evidencePaths: [
          nestedEvidencePath,
          "https://github.com/opsiclear/diveo/actions/runs/987/artifacts/ios-first-launch-home",
        ],
        mediaSha256: [sha256("png-bytes\n")],
        fileSha256: [sha256("ios-zip-bytes\n")],
        sourceRunId: "987",
        sourceArtifactId: "ios-first-launch-home",
      }],
    };
    const manifestPath = writeFile(
      root,
      "docs/qa-evidence/2026-07-01/product-journey-manifest.json",
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const packet = {
      target: {
        productJourneyManifestPath: manifestPath,
      },
      packets: [],
    };

    const scaffold = buildExternalEvidenceInventoryScaffold({
      qaText: qaDoc([]),
      packet,
      root,
    });

    expect(scaffold.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidencePath: fixtureManifestPath,
        artifactPurpose: "fixture-manifest",
        helperOnly: "_pending_",
        fixtureManifestSha256: sha256("fixture-bytes\n"),
        sourceRefs: [expect.objectContaining({
          source: "product-journey-fixture",
          packetId: "fixture-manifest",
          expectedPurpose: "fixture-manifest",
        })],
      }),
      expect.objectContaining({
        evidencePath: nestedEvidencePath,
        artifactPurpose: "product-journey-evidence",
        helperOnly: "_pending_",
        journeyEntryId: "first-launch-home",
        productJourneyExpectedSha256Field: "mediaSha256",
        productJourneyExpectedSha256: sha256("png-bytes\n"),
        sourceRefs: [expect.objectContaining({
          source: "product-journey",
          packetId: "first-launch-home",
          expectedPurpose: "product-journey-evidence",
          expectedSha256Field: "mediaSha256",
          expectedSha256: sha256("png-bytes\n"),
        })],
      }),
      expect.objectContaining({
        evidencePath: "https://github.com/opsiclear/diveo/actions/runs/987/artifacts/ios-first-launch-home",
        artifactPurpose: "product-journey-evidence",
        helperOnly: "_pending_",
        journeyEntryId: "first-launch-home",
        downloadedPath: "docs/qa-evidence/2026-07-01/external/987/ios-first-launch-home/ios-first-launch-home.zip",
        sourceRunId: "987",
        sourceArtifactId: "ios-first-launch-home",
        productJourneyExpectedSha256Field: "fileSha256",
        productJourneyExpectedSha256: sha256("ios-zip-bytes\n"),
        productJourneySourceRunId: "987",
        productJourneySourceArtifactId: "ios-first-launch-home",
        sourceRefs: [expect.objectContaining({
          source: "product-journey",
          packetId: "first-launch-home",
          expectedPurpose: "product-journey-evidence",
          expectedSha256Field: "fileSha256",
          expectedSha256: sha256("ios-zip-bytes\n"),
          expectedSourceRunId: "987",
          expectedSourceArtifactId: "ios-first-launch-home",
        })],
      }),
    ]));
  });

  it("rejects scaffold, candidate, pending, and example packet paths for final inventory replay", () => {
    const root = tempRepo();
    const qaText = qaDoc([]);
    const inventory = baseInventory([]);

    for (const token of ["scaffold", "candidate", "pending", "example"]) {
      const packetPath = `docs/qa-evidence/2026-07-01/device-evidence-packet-${token}.json`;
      const result = analyzeExternalEvidenceInventory({
        inventory,
        qaText,
        packet: { packets: [] },
        packetPath,
        root,
      });

      expect(result.ok).toBe(false);
      expect(result.problems).toContain(
        `${packetPath} packet path must not reference a scaffold, candidate, pending, or example packet`,
      );
    }
  });

  it("accepts reviewed packet paths under docs/qa-evidence", () => {
    const root = tempRepo();
    const reviewedPath = "docs/qa-evidence/2026-07-01/device-evidence-packet-reviewed.json";

    expect(reviewedPacketPathProblems(path.join(root, reviewedPath), root)).toEqual([]);
    expect(analyzeExternalEvidenceInventory({
      inventory: baseInventory([]),
      qaText: qaDoc([]),
      packet: { packets: [] },
      packetPath: reviewedPath,
      root,
    })).toMatchObject({
      ok: true,
      checkedRequiredEvidence: 0,
      checkedInventoryEntries: 0,
    });
  });

  it("rejects noncanonical inventory paths for final inventory replay", () => {
    const root = tempRepo();
    const packetPath = "docs/qa-evidence/2026-07-01/device-evidence-packet-reviewed.json";
    const scaffoldInventoryPath = "docs/qa-evidence/2026-07-01/external-evidence-inventory-scaffold.json";
    const arbitraryInventoryPath = "docs/qa-evidence/2026-07-01/reviewed-inventory.json";
    const expectedScaffoldProblem = `${scaffoldInventoryPath} inventory path must be docs/qa-evidence/<date>/external-evidence-inventory.json`;
    const expectedArbitraryProblem = `${arbitraryInventoryPath} inventory path must be docs/qa-evidence/<date>/external-evidence-inventory.json`;

    expect(reviewedInventoryPathProblems(scaffoldInventoryPath, { root })).toEqual([expectedScaffoldProblem]);
    expect(reviewedInventoryPathProblems("docs/qa-evidence/2026-07-01/external-evidence-inventory.json", { root })).toEqual([]);
    expect(analyzeExternalEvidenceInventory({
      inventory: baseInventory([]),
      inventoryPath: arbitraryInventoryPath,
      qaText: qaDoc([]),
      packet: { packets: [] },
      packetPath,
      root,
    })).toMatchObject({
      ok: false,
      problems: expect.arrayContaining([expectedArbitraryProblem]),
    });
  });

  it("allows scaffold inventory paths only while scaffolding", () => {
    const root = tempRepo();
    const scaffoldInventoryPath = "docs/qa-evidence/2026-07-01/external-evidence-inventory-scaffold.json";
    const scaffoldPacketPath = "docs/qa-evidence/2026-07-01/device-evidence-packet-scaffold.json";

    expect(reviewedInventoryPathProblems(scaffoldInventoryPath, { root, scaffold: true })).toEqual([]);
    expect(reviewedPacketPathProblems(scaffoldPacketPath, root, { scaffold: true })).toEqual([]);
    expect(analyzeExternalEvidenceInventory({
      inventory: baseInventory([]),
      inventoryPath: scaffoldInventoryPath,
      qaText: qaDoc([]),
      packet: { packets: [] },
      packetPath: scaffoldPacketPath,
      root,
      scaffold: true,
    })).toMatchObject({
      ok: true,
      checkedRequiredEvidence: 0,
      checkedInventoryEntries: 0,
    });
  });

  it("requires reviewed inventory and packet paths to use the same evidence date", () => {
    const root = tempRepo();
    const inventoryPath = "docs/qa-evidence/2026-07-01/external-evidence-inventory.json";
    const packetPath = "docs/qa-evidence/2026-06-30/device-evidence-packet-reviewed.json";
    const expectedProblem = "external evidence inventory path and packet path must use the same docs/qa-evidence/<date> folder";

    expect(inventoryPacketDateProblems({ inventoryPath, packetPath, root })).toEqual([expectedProblem]);
    expect(analyzeExternalEvidenceInventory({
      inventory: baseInventory([]),
      inventoryPath,
      qaText: qaDoc([]),
      packet: { packets: [] },
      packetPath,
      root,
    })).toMatchObject({
      ok: false,
      problems: expect.arrayContaining([expectedProblem]),
    });
  });

  it("requires a reviewed packet path for final inventory replay", () => {
    expect(requiredReplayPacketPathProblems({
      packetPath: null,
      scaffold: false,
    })).toEqual(["--packet-path <reviewed-packet.json> is required for external evidence replay"]);
    expect(requiredReplayPacketPathProblems({
      packetPath: null,
      scaffold: true,
    })).toEqual([]);

    const root = tempRepo();
    const inventoryPath = writeFile(root, "docs/qa-evidence/2026-07-01/external-evidence-inventory.json", "{}\n");
    const qaPath = writeFile(root, "docs/GSAV_NATIVE_QA.md", qaDoc([]));
    const cliResult = spawnSync(process.execPath, [
      path.resolve("scripts/verify-external-evidence-inventory.js"),
      "--root",
      root,
      "--inventory-path",
      inventoryPath,
      "--qa-path",
      qaPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(cliResult.status).toBe(1);
    expect(JSON.parse(cliResult.stdout)).toMatchObject({
      ok: false,
      status: "fail",
      problems: ["--packet-path <reviewed-packet.json> is required for external evidence replay"],
    });
  });

  it("parses comma-separated markdown evidence links", () => {
    expect(evidenceCandidates("[raw](docs/qa-evidence/a.json), <docs/qa-evidence/b.txt>")).toEqual([
      "docs/qa-evidence/a.json",
      "docs/qa-evidence/b.txt",
    ]);
  });

  it("builds a pending scaffold with local hashes and source references", () => {
    const root = tempRepo();
    const evidencePath = writeFile(root, "docs/qa-evidence/2026-07-01/master-branch-protection.json", "{\"ok\":true}\n");
    const qaText = qaDoc([qaRow({ evidencePath })]);

    const scaffold = buildExternalEvidenceInventoryScaffold({
      qaText,
      root,
      reviewer: "release-reviewer",
      reviewedAt: "2026-07-01T16:10:00Z",
    });

    expect(scaffold).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      reviewer: "release-reviewer",
      reviewedAt: "2026-07-01T16:10:00Z",
      entries: [{
        evidencePath,
        status: "pending",
        reviewer: "release-reviewer",
        reviewedAt: "2026-07-01T16:10:00Z",
        pathKind: "local",
        sha256: sha256("{\"ok\":true}\n"),
        sourceRefs: [{
          source: "qa",
          qaRowId: "Branch protection Master branch protection",
          platform: "Branch protection",
          route: "Master branch protection",
        }],
      }],
    });

    const verification = analyzeExternalEvidenceInventory({
      inventory: scaffold,
      qaText,
      root,
    });
    expect(verification.ok).toBe(false);
    expect(verification.problems).toContain(`${evidencePath} inventory status must be pass`);
  });

  it("builds route artifact scaffold entries with URL identity and pending manifest review fields", () => {
    const root = tempRepo();
    const artifactUrl = "https://github.com/OpsiClear-Web/diveo/actions/runs/987/artifacts/ios-route-watch";
    const qaText = qaDoc([qaRow({
      platform: "iOS",
      device: "iPhone 15 / iOS 18 / WKWebView 620",
      gsavWebUrl: "https://gsav.opsiclear.dev",
      route: "/watch/test",
      result: "Passed: embedded watch route reached ready state",
      evidencePath: artifactUrl,
    })]);

    const scaffold = buildExternalEvidenceInventoryScaffold({ qaText, root });

    expect(scaffold.entries).toEqual([expect.objectContaining({
      evidencePath: artifactUrl,
      status: "pending",
      pathKind: "actions-artifact",
      downloadedPath: "docs/qa-evidence/2026-07-01/external/987/ios-route-watch/ios-route-watch.zip",
      sha256: "_pending_",
      sourceRunId: "987",
      sourceArtifactId: "ios-route-watch",
      artifactPurpose: "route-evidence",
      helperOnly: "_pending_",
      manifestPath: "_pending_",
      manifestSha256: "_pending_",
      sourceRefs: [expect.objectContaining({
        source: "qa",
        qaRowId: "iOS /watch/test",
        expectedPurpose: "route-evidence",
      })],
    })]);
  });

  it("writes scaffolds without overwriting unless forced", () => {
    const root = tempRepo();
    const evidencePath = writeFile(root, "docs/qa-evidence/2026-07-01/master-branch-protection.json", "{\"ok\":true}\n");
    const qaText = qaDoc([qaRow({ evidencePath })]);
    const inventoryPath = "docs/qa-evidence/2026-07-01/external-evidence-inventory.json";

    const firstWrite = writeExternalEvidenceInventoryScaffold({
      inventoryPath,
      qaText,
      root,
    });
    expect(firstWrite.outputPath).toBe(inventoryPath);
    expect(fs.existsSync(path.join(root, inventoryPath))).toBe(true);

    expect(() => writeExternalEvidenceInventoryScaffold({
      inventoryPath,
      qaText,
      root,
    })).toThrow(`${inventoryPath} already exists; use --force to overwrite the scaffold`);

    expect(() => writeExternalEvidenceInventoryScaffold({
      inventoryPath,
      qaText,
      root,
      force: true,
    })).not.toThrow();
  });
});
