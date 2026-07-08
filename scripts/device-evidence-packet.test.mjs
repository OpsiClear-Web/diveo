import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  createDeviceEvidencePacket,
  createDeviceEvidencePacketExample,
  evidencePathProblem,
  packetSlug,
  productJourneyManifestProblems,
  PRODUCT_JOURNEY_ARTIFACT_PURPOSE,
  PRODUCT_JOURNEY_ENTRY_REQUIREMENTS,
  PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS,
  strictPacketInputPathProblems,
  validateDeviceEvidencePacket,
} = require("./device-evidence-packet.js");

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-evidence-packet-"));
  fs.writeFileSync(path.join(root, "app.json"), JSON.stringify({
    expo: {
      version: "1.0.19",
      android: { versionCode: 10019 },
    },
  }));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.0.19" }));
  return root;
}

function writeEvidence(root, relativePath, contents = "evidence") {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
  return relativePath;
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

const DEFAULT_EVIDENCE_SHA = sha256("evidence");
const FIXTURE_MANIFEST_CONTENTS = "{\"fixtures\":[]}\n";

const PRODUCT_JOURNEY_SIGNAL_TEXT = {
  "first-launch-home": [
    "native Home feed populated state visible",
    "no hosted web chrome visible",
    "Search Library and Settings visible",
    "Explore placement clear and not a competing catalog shell",
    "Explore is secondary/runtime-scoped action and not the primary Home browse surface",
  ],
  search: [
    "empty first-run search and result list plus no-results state reviewed",
    "keyboard visible without overlap",
    "result opens /watch route",
  ],
  creator: [
    "real creator content shown",
    "follow signed-out opens login and return",
    "scene opens /watch route",
  ],
  library: [
    "logged-out call to action visible",
    "signed-in seeded saved scenes visible",
    "account-safe redaction applied",
  ],
  "login-auth-return": [
    "signed-out Library entry visible before auth",
    "keyboard-visible native Login UI shown",
    "account-safe redaction applied",
    "return to requested native route completed",
    "no hosted account chrome visible",
  ],
  "watch-alias": [
    "/watch/test reaches ready state",
    "/gsav/test?t=2.5 embeds /watch/test?t=2.5&embed=native",
    "progress saves and resume works",
  ],
  explore: [
    "exactly one embed=native marker observed",
    "data saver adds dataSaver=1",
    "vertical swipe/scroll changes active scene",
    "visible active-scene change observed",
    "hidden hosted public/account chrome",
    "native-shell back behavior returns to native shell",
    "same-origin hosted product routes do not escape the player boundary",
  ],
  "diagnostics-hierarchy": [
    "Home does not expose diagnostics as primary",
    "Settings exposes secondary diagnostics action",
    "diagnostics embeds /native-diagnostics?embed=native",
  ],
  settings: [
    "scrollable settings operational sections reviewed",
    "secondary diagnostics action remains in Settings",
    "settings touch targets checked",
  ],
  "accessibility-ergonomics": [
    "safe-area coverage checked",
    "no clipped text observed",
    "44dp touch targets checked",
    "no nested touch conflicts observed",
  ],
  "degraded-blocked-states": [
    "nonblank native blocked state shown",
    "unsupported or retry error state shown",
    "no blank WebView observed",
  ],
};

function productJourneySignalsForId(id) {
  return PRODUCT_JOURNEY_SIGNAL_TEXT[id] ?? [`${id} reviewed`];
}

function initGitRepo(root) {
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "codex@example.test"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Codex Test"], { cwd: root, stdio: "ignore" });
}

function gitCommitAll(root, message = "test evidence") {
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", message], { cwd: root, stdio: "ignore" });
}

function writeJson(root, relativePath, value) {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
  return relativePath;
}

function writeProductJourneyManifest(root, target, overrides = {}) {
  const fixtureManifestPath = `docs/qa-evidence/${target.evidenceDate}/fixture-manifest.json`;
  writeEvidence(root, fixtureManifestPath, FIXTURE_MANIFEST_CONTENTS);
  const entries = PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS.map((id) => {
    const evidencePaths = [
      `docs/qa-evidence/${target.evidenceDate}/android-${id}.txt`,
      `docs/qa-evidence/${target.evidenceDate}/ios-${id}.txt`,
    ];
    for (const evidencePath of evidencePaths) writeEvidence(root, evidencePath);
    return {
      id,
      platforms: ["Android", "iOS"],
      evidencePaths,
      mediaSha256: [DEFAULT_EVIDENCE_SHA, DEFAULT_EVIDENCE_SHA],
      observedSignals: productJourneySignalsForId(id),
    };
  });
  const manifest = {
    artifactPurpose: PRODUCT_JOURNEY_ARTIFACT_PURPOSE,
    helperOnly: false,
    releaseCandidateSha: target.releaseCandidateSha,
    dryRunArtifact: target.dryRunArtifact,
    dryRunRunUrl: target.dryRunRunUrl,
    gsavHostUrl: target.gsavHostUrl,
    gsavHostingCommit: target.gsavHostingCommit,
    fixtureManifestPath,
    fixtureManifestSha256: sha256(FIXTURE_MANIFEST_CONTENTS),
    reviewer: "@product-review",
    reviewedAt: "2026-07-01T16:10:00Z",
    android: {
      device: "Pixel 8 emulator",
      osVersion: "Android 15 API 35",
      webViewVersion: "126.0.0.1",
      apkSha256: "b".repeat(64),
    },
    ios: {
      device: "iPhone 15 simulator",
      osVersion: "iOS 18.5",
      wkWebViewVersion: "WebKit 619.1",
      artifactSha256: "c".repeat(64),
    },
    entries,
    ...overrides,
  };
  writeJson(root, target.productJourneyManifestPath, manifest);
  return manifest;
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
  platform = "Android",
  route = "/",
  device = "Pixel 8 emulator",
  gsavWebUrl = "https://gsav.example.com",
  result = "Passed: native home/feed rendered; no hosted web chrome visible",
  evidencePath = "docs/qa-evidence/2026-07-01/android-route-home.txt, docs/qa-evidence/2026-07-01/android-route-home.png",
  notes = "account-safe evidence",
} = {}) {
  return `| 2026-07-01 | ${platform} | ${device} | ${gsavWebUrl} | ${route} | ${result} | ${evidencePath} | ${notes} |`;
}

const VALID_CANDIDATE_SHA = "abc1234567890abcdef1234567890abcdef12345";
const VALID_DRY_RUN_ARTIFACT = "diveo-release-evidence-v1.0.19";
const VALID_DRY_RUN_RUN_URL = "https://github.com/OpsiClear-Web/diveo/actions/runs/123";
const VALID_GSAV_HOST_URL = "https://gsav.opsiclear.dev";
const VALID_GSAV_HOSTING_COMMIT = "gsav-host-abc1234";

function completePacketOptions(root, overrides = {}) {
  return {
    root,
    date: "2026-07-01",
    owner: "@native-validation",
    candidateSha: VALID_CANDIDATE_SHA,
    dryRunArtifact: VALID_DRY_RUN_ARTIFACT,
    dryRunRunUrl: VALID_DRY_RUN_RUN_URL,
    gsavHostUrl: VALID_GSAV_HOST_URL,
    gsavHostingCommit: VALID_GSAV_HOSTING_COMMIT,
    now: new Date("2026-07-01T10:00:00.000Z"),
    ...overrides,
  };
}

function packetWithPassedAndroidHome(root) {
  const packet = createDeviceEvidencePacket(completePacketOptions(root));
  const androidHome = packet.packets.find((entry) => entry.id === "android-route-home");
  androidHome.status = "passed";
  androidHome.actual = {
    ...androidHome.actual,
    owner: "@native-validation",
    device: "Pixel 8 emulator",
    osVersion: "Android 15 API 35",
    androidWebViewVersion: "126.0.0.1",
    buildProfile: "release",
    gsavHostUrl: "https://gsav.example.com",
    gsavHostingCommit: "gsav-host-abc1234",
    observedSignals: ["native home/feed rendered", "no hosted web chrome visible"],
    evidencePaths: [
      writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.txt"),
      writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.png"),
    ],
    mediaSha256: [DEFAULT_EVIDENCE_SHA],
    ux: {
      rotation: "portrait and landscape checked",
      safeArea: "notch and gesture areas clear",
      backNavigation: "Android hardware back stays coherent",
      noClippedText: "no clipped text observed",
      noNestedTouch: "no nested-touch ambiguity observed",
      touchTarget44dp: "all primary controls at least 44dp",
    },
    redaction: "account-safe",
  };
  return packet;
}

function qaIdentityNotes(extra = "account-safe evidence") {
  return [
    `releaseCandidateSha=${VALID_CANDIDATE_SHA}`,
    `dry-run artifact=${VALID_DRY_RUN_ARTIFACT}`,
    `dry-run run URL=${VALID_DRY_RUN_RUN_URL}`,
    extra,
  ].join("; ");
}

describe("device evidence packet", () => {
  it("creates a reviewed packet excerpt example that matches the packet schema", () => {
    const root = tempRepo();
    const example = createDeviceEvidencePacketExample({
      root,
      date: "2026-07-01",
      now: new Date("2026-07-01T10:00:00.000Z"),
    });

    expect(example).toMatchObject({
      schemaVersion: "device-evidence-packet/v1/example",
      target: {
        releaseCandidateSha: "0123456789abcdef0123456789abcdef01234567",
        dryRunArtifact: "diveo-release-evidence-v1.0.19",
        dryRunRunUrl: "https://github.com/OpsiClear-Web/diveo/actions/runs/1234567890",
        gsavHostUrl: "https://gsav.opsiclear.dev",
      },
      commands: {
        example: "npm run device-evidence:packet -- --example",
        scaffold: expect.stringContaining("device-evidence-packet-scaffold.json"),
        candidate: expect.stringContaining("device-evidence-packet-candidate.json"),
        checkCandidate: expect.stringContaining("--allow-pending"),
        checkReviewed: expect.stringContaining("device-evidence-packet-reviewed.json"),
      },
    });
    expect(example.commands.scaffold).not.toContain("--dry-run-artifact");
    expect(example.commands.checkReviewed).not.toContain("--allow-pending");
    expect(example.routePacket).toMatchObject({
      id: "android-route-watch-test",
      status: "passed",
      requiredActualFields: expect.arrayContaining([
        "androidWebViewVersion",
        "sameOriginProductPathOutcome",
        "ux.rotation",
        "ux.touchTarget44dp",
      ]),
      actual: {
        owner: "@native-validation-owner",
        mediaSha256: ["a".repeat(64)],
        sameOriginProductPathOutcome: expect.stringContaining("/creator/qa-native-blocked"),
      },
    });
    expect(example.negativePacket).toMatchObject({
      id: "negative-cross-origin-navigation",
      status: "passed",
      actual: {
        android: {
          webViewVersion: "126.0.0.1",
        },
        ios: {
          wkWebViewVersion: "WebKit 619.1",
        },
      },
    });
  });

  it("keeps the reviewed packet excerpt valid when copied into the full packet scaffold", () => {
    const root = tempRepo();
    const example = createDeviceEvidencePacketExample({
      root,
      date: "2026-07-01",
      owner: "@native-validation",
      candidateSha: VALID_CANDIDATE_SHA,
      dryRunArtifact: VALID_DRY_RUN_ARTIFACT,
      dryRunRunUrl: VALID_DRY_RUN_RUN_URL,
      gsavHostUrl: VALID_GSAV_HOST_URL,
      gsavHostingCommit: VALID_GSAV_HOSTING_COMMIT,
      now: new Date("2026-07-01T10:00:00.000Z"),
    });
    const packet = createDeviceEvidencePacket(completePacketOptions(root));
    for (const examplePacket of [example.routePacket, example.negativePacket]) {
      const scaffoldPacket = packet.packets.find((entry) => entry.id === examplePacket.id);
      scaffoldPacket.status = examplePacket.status;
      scaffoldPacket.actual = examplePacket.actual;
      for (const evidencePath of examplePacket.actual.evidencePaths) {
        writeEvidence(root, evidencePath);
      }
      if (examplePacket.id === "android-route-watch-test") {
        scaffoldPacket.actual.mediaSha256 = [DEFAULT_EVIDENCE_SHA];
      }
    }

    expect(validateDeviceEvidencePacket(packet, { root, allowPending: true })).toMatchObject({
      ok: true,
    });
  });

  it("creates a pending packet scaffold for every Android, iOS, and negative QA row", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket({
      root,
      date: "2026-07-01",
      owner: "@native-validation",
      candidateSha: "abc1234567890abcdef1234567890abcdef12345",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      now: new Date("2026-07-01T10:00:00.000Z"),
    });

    expect(packet).toMatchObject({
      schemaVersion: "device-evidence-packet/v1",
      target: {
        evidenceDate: "2026-07-01",
        appVersion: "1.0.19",
        packageVersion: "1.0.19",
        androidVersionCode: 10019,
      },
      summary: {
        totalPackets: 22,
        routePackets: 16,
        negativePackets: 6,
      },
    });
    expect(packet.packets.map((entry) => entry.id)).toContain("android-route-home");
    expect(packet.packets.map((entry) => entry.id)).toContain("ios-route-gsav-test-t-2-5");
    expect(packet.packets.map((entry) => entry.id)).toContain("negative-cross-origin-navigation");
    expect(packet.packets.every((entry) => entry.status === "pending")).toBe(true);
    expect(validateDeviceEvidencePacket(packet, { root, allowPending: true })).toMatchObject({
      ok: true,
      checkedPackets: 22,
    });
  });

  it("keeps pending packets as no-publish blockers unless explicitly allowed", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket({
      root,
      date: "2026-07-01",
      owner: "@native-validation",
      now: new Date("2026-07-01T10:00:00.000Z"),
    });

    const result = validateDeviceEvidencePacket(packet, { root });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("android-route-home is still pending");
  });

  it("accepts strict reviewed packet input paths under dated QA evidence only", () => {
    const root = tempRepo();
    const reviewedPath = "docs/qa-evidence/2026-07-01/device-evidence-packet-reviewed.json";

    expect(strictPacketInputPathProblems(reviewedPath, { root })).toEqual([]);
    expect(strictPacketInputPathProblems(path.join(root, reviewedPath), { root })).toEqual([]);
    expect(strictPacketInputPathProblems("device-evidence-packet-reviewed.json", { root })).toContain(
      "device-evidence-packet-reviewed.json input path must be a reviewed packet JSON under docs/qa-evidence/<date>",
    );
  });

  it("rejects strict packet input filenames that still look like planning artifacts", () => {
    const root = tempRepo();

    for (const lifecycleName of ["scaffold", "candidate", "pending", "example"]) {
      const packetPath = `docs/qa-evidence/2026-07-01/device-evidence-packet-${lifecycleName}.json`;

      expect(strictPacketInputPathProblems(packetPath, { root })).toContain(
        `${packetPath} input path must not reference a scaffold, candidate, pending, or example packet`,
      );
    }
  });

  it("allows scaffold and candidate input paths only for explicit pending packet checks", () => {
    const root = tempRepo();

    expect(strictPacketInputPathProblems(
      "docs/qa-evidence/2026-07-01/device-evidence-packet-scaffold.json",
      { root, allowPending: true },
    )).toEqual([]);
    expect(strictPacketInputPathProblems(
      "docs/qa-evidence/2026-07-01/device-evidence-packet-candidate.json",
      { root, allowPending: true },
    )).toEqual([]);
  });

  it("requires reviewed packet, QA doc, and local evidence bytes to be tracked and clean in final mode", () => {
    const root = tempRepo();
    initGitRepo(root);
    const packet = packetWithPassedAndroidHome(root);
    const packetPath = writeJson(root, "docs/qa-evidence/2026-07-01/device-evidence-packet-reviewed.json", packet);
    const qaPath = writeEvidence(root, "docs/GSAV_NATIVE_QA.md", qaDoc([
      qaRow({ notes: qaIdentityNotes() }),
    ]));

    const untrackedResult = validateDeviceEvidencePacket(packet, {
      root,
      allowPending: true,
      inputPath: packetPath,
      qaPath,
      requireGitIntegrity: true,
    });
    expect(untrackedResult.ok).toBe(false);
    expect(untrackedResult.gitIntegrityRequired).toBe(true);
    expect(untrackedResult.problems).toContain(
      "device evidence file must be tracked in git before final readiness: docs/qa-evidence/2026-07-01/device-evidence-packet-reviewed.json",
    );
    expect(untrackedResult.problems).toContain(
      "device evidence file must be tracked in git before final readiness: docs/GSAV_NATIVE_QA.md",
    );
    expect(untrackedResult.problems).toContain(
      "device evidence file must be tracked in git before final readiness: docs/qa-evidence/2026-07-01/android-route-home.png",
    );

    gitCommitAll(root);
    expect(validateDeviceEvidencePacket(packet, {
      root,
      allowPending: true,
      inputPath: packetPath,
      qaPath,
      requireGitIntegrity: true,
    })).toMatchObject({
      ok: true,
      gitIntegrityRequired: true,
    });

    fs.appendFileSync(path.join(root, "docs/qa-evidence/2026-07-01/android-route-home.txt"), "\nlocal edit");
    const dirtyResult = validateDeviceEvidencePacket(packet, {
      root,
      allowPending: true,
      inputPath: packetPath,
      qaPath,
      requireGitIntegrity: true,
    });
    expect(dirtyResult.ok).toBe(false);
    expect(dirtyResult.problems).toEqual(expect.arrayContaining([
      expect.stringContaining("device evidence files must be committed before final readiness:"),
    ]));
  });

  it("surfaces strict input path lifecycle problems through packet validation", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));

    const reviewedResult = validateDeviceEvidencePacket(packet, {
      root,
      inputPath: "docs/qa-evidence/2026-07-01/device-evidence-packet-reviewed.json",
    });
    expect(reviewedResult.problems).not.toContain(
      "docs/qa-evidence/2026-07-01/device-evidence-packet-reviewed.json input path must not reference a scaffold, candidate, pending, or example packet",
    );
    expect(reviewedResult.problems).toContain("android-route-home is still pending");

    const candidateResult = validateDeviceEvidencePacket(packet, {
      root,
      inputPath: "docs/qa-evidence/2026-07-01/device-evidence-packet-candidate.json",
    });
    expect(candidateResult.problems).toContain(
      "docs/qa-evidence/2026-07-01/device-evidence-packet-candidate.json input path must not reference a scaffold, candidate, pending, or example packet",
    );
  });

  it("requires strict publish-counted packet target identity", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket({
      root,
      date: "2026-07-01",
      owner: "pending",
      candidateSha: "abc1234",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "pending-production-host-identity",
      now: new Date("2026-07-01T10:00:00.000Z"),
    });

    const result = validateDeviceEvidencePacket(packet, { root });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("target.releaseCandidateSha must be full 40-hex");
    expect(result.problems).toContain("target.dryRunArtifact must be diveo-release-evidence-v<semver>");
    expect(result.problems).toContain("target.dryRunRunUrl must be an exact trusted Diveo GitHub Actions run URL");
    expect(result.problems).toContain("target.gsavHostUrl must be a non-local non-example HTTPS URL");
    expect(result.problems).toContain("target.gsavHostingCommit must be a concrete deployed host/build identity");
    expect(result.problems).toContain("target.defaultOwner must be a concrete owner");
  });

  it("rejects non-exact or non-release-repo dry-run target run URLs", () => {
    const root = tempRepo();
    for (const dryRunRunUrl of [
      "https://github.com/opsiclear/gsav-hosting/actions/runs/123",
      "https://github.com/opsiclear/diveo/actions/runs/123/artifacts/release-evidence",
      "https://github.com/opsiclear/diveo/actions/runs/123/attempts/1",
      "https://github.com/opsiclear/diveo/actions/runs/123/",
      "https://github.com/opsiclear/diveo/actions/runs/123?check_suite_focus=true",
      "https://github.com/opsiclear/diveo/actions/runs/123#summary",
      "https://token@github.com/opsiclear/diveo/actions/runs/123",
      "http://github.com/opsiclear/diveo/actions/runs/123",
    ]) {
      const packet = createDeviceEvidencePacket(completePacketOptions(root, { dryRunRunUrl }));

      const result = validateDeviceEvidencePacket(packet, { root });

      expect(result.ok).toBe(false);
      expect(result.problems).toContain("target.dryRunRunUrl must be an exact trusted Diveo GitHub Actions run URL");
    }
  });

  it("requires dry-run target identity for passed packets even when pending packets are allowed", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket({
      root,
      date: "2026-07-01",
      owner: "@native-validation",
      candidateSha: VALID_CANDIDATE_SHA,
      gsavHostUrl: VALID_GSAV_HOST_URL,
      gsavHostingCommit: VALID_GSAV_HOSTING_COMMIT,
      now: new Date("2026-07-01T10:00:00.000Z"),
    });
    packet.packets.find((entry) => entry.id === "android-route-home").status = "passed";

    const result = validateDeviceEvidencePacket(packet, { root, allowPending: true });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("target.dryRunArtifact must be diveo-release-evidence-v<semver>");
    expect(result.problems).toContain("target.dryRunRunUrl must be an exact trusted Diveo GitHub Actions run URL");
  });

  it("requires final packet targets to carry a reviewed product journey manifest", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));
    for (const entry of packet.packets) {
      entry.status = "blocked";
      entry.blocker = {
        owner: "@native-validation",
        reason: "external validation evidence is not available in this unit test",
        revisit: "2026-07-15",
      };
    }

    expect(PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS).toContain("login-auth-return");
    expect(Object.keys(PRODUCT_JOURNEY_ENTRY_REQUIREMENTS)).toEqual([
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
    ]);

    const missingManifest = validateDeviceEvidencePacket(packet, { root });
    expect(missingManifest.ok).toBe(false);
    expect(missingManifest.problems).toContain(
      "target.productJourneyManifestPath does not exist: docs/qa-evidence/2026-07-01/product-journey-manifest.json",
    );

    const validManifest = writeProductJourneyManifest(root, packet.target);
    expect(productJourneyManifestProblems(packet.target, root)).toEqual([]);
    expect(validateDeviceEvidencePacket(packet, { root })).toMatchObject({
      ok: true,
    });

    writeProductJourneyManifest(root, packet.target, {
      fixtureManifestPath: "docs/qa-evidence/2026-07-01/missing-fixture-manifest.json",
      android: {
        device: "",
        osVersion: "Android 15 API 35",
        webViewVersion: "126.0.0.1",
        apkSha256: "not-a-sha",
      },
      ios: {
        device: "iPhone 15 simulator",
        osVersion: "",
        wkWebViewVersion: "WebKit 619.1",
        artifactSha256: "not-a-sha",
      },
    });
    expect(productJourneyManifestProblems(packet.target, root)).toEqual(expect.arrayContaining([
      "product journey manifest fixtureManifestPath must be docs/qa-evidence/<date>/fixture-manifest.json",
      "product journey manifest fixtureManifestPath does not exist: docs/qa-evidence/2026-07-01/missing-fixture-manifest.json",
      "product journey manifest android.device must be concrete",
      "product journey manifest ios.osVersion must be concrete",
      "product journey manifest android.apkSha256 must be 64-hex",
      "product journey manifest ios.artifactSha256 must be 64-hex",
    ]));

    writeProductJourneyManifest(root, packet.target, {
      fixtureManifestSha256: "d".repeat(64),
    });
    expect(productJourneyManifestProblems(packet.target, root)).toContain(
      `product journey manifest fixtureManifestSha256 mismatch for docs/qa-evidence/2026-07-01/fixture-manifest.json: expected ${"d".repeat(64)}, got ${sha256(FIXTURE_MANIFEST_CONTENTS)}`,
    );

    writeProductJourneyManifest(root, packet.target, {
      entries: [
        ...validManifest.entries,
        {
          ...validManifest.entries[0],
          observedSignals: ["duplicate first-launch-home reviewed"],
        },
      ],
    });
    expect(productJourneyManifestProblems(packet.target, root)).toContain(
      "product journey manifest has duplicate entry first-launch-home",
    );

    writeProductJourneyManifest(root, packet.target, {
      entries: [{
        id: "first-launch-home",
        platforms: ["Android"],
        evidencePaths: [],
        observedSignals: [],
      }],
    });
    const incompleteManifest = productJourneyManifestProblems(packet.target, root);
    expect(incompleteManifest).toEqual(expect.arrayContaining([
      "product journey entry first-launch-home must cover Android and iOS",
      "product journey entry first-launch-home must include evidencePaths",
      "product journey entry first-launch-home must include observedSignals or observations",
      "product journey manifest is missing entry search",
    ]));

    writeProductJourneyManifest(root, packet.target, {
      entries: PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS
        .filter((id) => id !== "login-auth-return")
        .map((id) => ({
          id,
          platforms: ["Android", "iOS"],
          evidencePaths: [
            writeEvidence(root, `docs/qa-evidence/2026-07-01/android-${id}.txt`),
            writeEvidence(root, `docs/qa-evidence/2026-07-01/ios-${id}.txt`),
          ],
          mediaSha256: [DEFAULT_EVIDENCE_SHA, DEFAULT_EVIDENCE_SHA],
          observedSignals: [`${id} reviewed`],
        })),
    });
    expect(productJourneyManifestProblems(packet.target, root)).toContain(
      "product journey manifest is missing entry login-auth-return",
    );

    writeProductJourneyManifest(root, packet.target, {
      entries: PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS.map((id) => ({
        id,
        platforms: ["Android", "iOS"],
        evidencePaths: [
          writeEvidence(root, `docs/qa-evidence/2026-07-01/android-${id}.txt`),
          writeEvidence(root, `docs/qa-evidence/2026-07-01/ios-${id}.txt`),
        ],
        mediaSha256: [DEFAULT_EVIDENCE_SHA, DEFAULT_EVIDENCE_SHA],
        observedSignals: [`${id} reviewed`],
      })),
    });
    const weakSemanticManifest = productJourneyManifestProblems(packet.target, root);
    expect(weakSemanticManifest).toEqual(expect.arrayContaining([
      "product journey entry first-launch-home observedSignals must include native Home feed state",
      "product journey entry search observedSignals must include keyboard visible without overlap",
      "product journey entry creator observedSignals must include follow signed-out to login and return",
      "product journey entry library observedSignals must include signed-in seeded saved scenes",
      "product journey entry login-auth-return observedSignals must include signed-out Library or save/follow entry",
      "product journey entry login-auth-return observedSignals must include keyboard-visible native Login UI",
      "product journey entry watch-alias observedSignals must include alias embeds hosted watch route with start time",
      "product journey entry explore observedSignals must include exactly one embed=native marker",
      "product journey entry explore observedSignals must include vertical swipe or scroll changes active scene",
      "product journey entry explore observedSignals must include visible active-scene change",
      "product journey entry diagnostics-hierarchy observedSignals must include Settings exposes secondary diagnostics action",
      "product journey entry settings observedSignals must include scrollable operational settings sections",
      "product journey entry accessibility-ergonomics observedSignals must include 44dp touch targets",
      "product journey entry degraded-blocked-states observedSignals must include no blank WebView",
    ]));

    writeProductJourneyManifest(root, packet.target, {
      entries: PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS.map((id) => ({
        id,
        platforms: ["Android", "iOS"],
        evidencePaths: [
          writeEvidence(root, `docs/qa-evidence/2026-07-01/android-${id}-explore-regression.txt`),
          writeEvidence(root, `docs/qa-evidence/2026-07-01/ios-${id}-explore-regression.txt`),
        ],
        mediaSha256: [DEFAULT_EVIDENCE_SHA, DEFAULT_EVIDENCE_SHA],
        observedSignals: id === "first-launch-home"
          ? [
            "native Home feed populated state visible",
            "no hosted web chrome visible",
            "Search Library and Settings visible",
            "Explore placement clear and not a competing catalog shell",
          ]
          : id === "explore"
            ? [
              "exactly one embed=native marker observed",
              "data saver adds dataSaver=1",
              "hosted chrome remains hidden",
              "back behavior returns to native shell",
            ]
            : productJourneySignalsForId(id),
      })),
    });
    const weakExploreManifest = productJourneyManifestProblems(packet.target, root);
    expect(weakExploreManifest).toEqual(expect.arrayContaining([
      "product journey entry first-launch-home observedSignals must include Explore is secondary or runtime-scoped",
      "product journey entry explore observedSignals must include vertical swipe or scroll changes active scene",
      "product journey entry explore observedSignals must include visible active-scene change",
      "product journey entry explore observedSignals must include hidden hosted public/account chrome",
      "product journey entry explore observedSignals must include same-origin hosted product routes stay inside the player boundary",
    ]));

    writeProductJourneyManifest(root, packet.target, {
      entries: PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS.map((id) => {
        const evidencePath = writeEvidence(root, `docs/qa-evidence/2026-07-01/${id}-android-ios.txt`);
        return {
          id,
          platforms: ["Android", "iOS"],
          evidencePaths: [evidencePath],
          mediaSha256: [DEFAULT_EVIDENCE_SHA],
          observedSignals: [`${id} reviewed`],
        };
      }),
    });
    expect(productJourneyManifestProblems(packet.target, root)).toContain(
      "product journey entry first-launch-home evidencePaths must include distinct Android and iOS evidence paths",
    );

    const evidencePath = writeEvidence(root, "docs/qa-evidence/2026-07-01/first-launch-home.txt");
    writeProductJourneyManifest(root, packet.target, {
      entries: PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS.map((id) => ({
        id,
        platforms: ["Android", "iOS"],
        evidencePaths: [id === "first-launch-home" ? evidencePath : writeEvidence(root, `docs/qa-evidence/2026-07-01/${id}.txt`)],
        mediaSha256: [id === "first-launch-home" ? "a".repeat(64) : DEFAULT_EVIDENCE_SHA],
        observedSignals: [`${id} reviewed`],
      })),
    });
    const staleHashManifest = productJourneyManifestProblems(packet.target, root);
    expect(staleHashManifest).toContain(
      `product journey entry first-launch-home mediaSha256 mismatch for ${evidencePath}: expected ${"a".repeat(64)}, got ${DEFAULT_EVIDENCE_SHA}`,
    );

    writeProductJourneyManifest(root, packet.target, {
      entries: PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS.map((id) => ({
        id,
        platforms: ["Android", "iOS"],
        evidencePaths: [writeEvidence(root, `docs/qa-evidence/2026-07-01/${id}.txt`)],
        observedSignals: [`${id} reviewed`],
      })),
    });
    expect(productJourneyManifestProblems(packet.target, root)).toContain(
      "product journey entry first-launch-home mediaSha256 must include one 64-hex hash per local evidence path (1 required)",
    );

    writeProductJourneyManifest(root, packet.target, {
      entries: PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS.map((id) => ({
        id,
        platforms: ["Android", "iOS"],
        evidencePaths: [
          id === "first-launch-home"
            ? "https://github.com/OpsiClear-Web/diveo/actions/runs/123/artifacts/product-journey"
            : writeEvidence(root, `docs/qa-evidence/2026-07-01/${id}.txt`),
        ],
        mediaSha256: id === "first-launch-home" ? [] : [DEFAULT_EVIDENCE_SHA],
        fileSha256: [],
        sourceRunId: "456",
        sourceArtifactId: "wrong-product-journey",
        observedSignals: [`${id} reviewed`],
      })),
    });
    expect(productJourneyManifestProblems(packet.target, root)).toEqual(expect.arrayContaining([
      "product journey entry first-launch-home fileSha256 must include one 64-hex hash per external evidence URL (1 required)",
      "product journey entry first-launch-home sourceRunId must match evidence URL run 123",
      "product journey entry first-launch-home sourceArtifactId must match evidence URL artifact product-journey",
    ]));
  });

  it("rejects a packet target candidate SHA mismatch even when pending packets are allowed", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket({
      root,
      date: "2026-07-01",
      owner: "@native-validation",
      candidateSha: "abc1234567890abcdef1234567890abcdef12345",
      gsavHostUrl: "https://staging-gsav.opsiclear.example",
      gsavHostingCommit: "gsav-host-abc1234",
      now: new Date("2026-07-01T10:00:00.000Z"),
    });

    const result = validateDeviceEvidencePacket(packet, {
      root,
      allowPending: true,
      expectedCandidateSha: "def1234567890abcdef1234567890abcdef12345",
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("target.releaseCandidateSha must match expected candidate def123456789");
  });

  it("validates completed route and negative packets with concrete metadata and evidence files", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));

    const androidHome = packet.packets.find((entry) => entry.id === "android-route-home");
    androidHome.status = "passed";
    androidHome.actual = {
      ...androidHome.actual,
      owner: "@native-validation",
      device: "Pixel 8 emulator",
      osVersion: "Android 15 API 35",
      androidWebViewVersion: "126.0.0.1",
      buildProfile: "release",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      observedSignals: ["native home/feed rendered", "no hosted web chrome visible"],
      evidencePaths: [
        writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.txt"),
        writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.png"),
      ],
      mediaSha256: [DEFAULT_EVIDENCE_SHA],
      ux: {
        rotation: "portrait and landscape checked",
        safeArea: "notch and gesture areas clear",
        backNavigation: "Android hardware back stays coherent",
        noClippedText: "no clipped text observed",
        noNestedTouch: "no nested-touch ambiguity observed",
        touchTarget44dp: "all primary controls at least 44dp",
      },
      redaction: "account-safe",
    };

    const negative = packet.packets.find((entry) => entry.id === "negative-cross-origin-navigation");
    negative.status = "passed";
    negative.owner = "@native-validation";
    negative.actual = {
      ...negative.actual,
      owner: "@native-validation",
      trigger: "Built with EXPO_PUBLIC_GSAV_QA_CONTROLS=1 and tapped Cross-origin.",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      observedSignals: ["untrusted navigation blocked", "app stays on trusted route"],
      evidencePaths: [
        writeEvidence(root, "docs/qa-evidence/2026-07-01/android-negative-cross-origin-navigation.txt"),
        writeEvidence(root, "docs/qa-evidence/2026-07-01/ios-negative-cross-origin-navigation.txt"),
      ],
      android: {
        device: "Pixel 8 emulator",
        osVersion: "Android 15 API 35",
        webViewVersion: "126.0.0.1",
      },
      ios: {
        device: "iPhone 15 simulator",
        osVersion: "iOS 18.5",
        wkWebViewVersion: "WebKit 619.1",
      },
      redaction: "account-safe",
    };

    const result = validateDeviceEvidencePacket(packet, { root, allowPending: true });
    expect(result.ok).toBe(true);
  });

  it("requires UX checks and same-origin product-route handoff proof for embedded route packets", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));
    const androidWatch = packet.packets.find((entry) => entry.id === "android-route-watch-test");
    androidWatch.status = "passed";
    androidWatch.actual = {
      ...androidWatch.actual,
      owner: "@native-validation",
      device: "Pixel 8 emulator",
      osVersion: "Android 15 API 35",
      androidWebViewVersion: "126.0.0.1",
      buildProfile: "release",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      observedSignals: ["GSAV_BRIDGE_READY or explicit unsupported/error state", "retry or resume signal"],
      evidencePaths: [
        writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-watch-test.txt"),
      ],
      sameOriginProductPathOutcome: "Tapped Same-origin in /gsav-diagnostics with EXPO_PUBLIC_GSAV_QA_CONTROLS=1; /creator/qa-native-blocked failed closed with visible Navigation blocked nonblank native state",
      ux: {
        rotation: "portrait and landscape checked",
        safeArea: "notch and gesture areas clear",
        backNavigation: "Android hardware back traversed WebView history first",
        noClippedText: "no clipped text observed",
        noNestedTouch: "no nested-touch ambiguity observed",
        touchTarget44dp: "all primary controls at least 44dp",
      },
      redaction: "account-safe",
    };

    expect(validateDeviceEvidencePacket(packet, { root, allowPending: true })).toMatchObject({
      ok: true,
    });

    androidWatch.actual.sameOriginProductPathOutcome = "same-origin route opened in embedded web shell";
    androidWatch.actual.ux.safeArea = "";
    const result = validateDeviceEvidencePacket(packet, { root, allowPending: true });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("android-route-watch-test passed packet missing actual.ux.safeArea");
    expect(result.problems).toContain("android-route-watch-test sameOriginProductPathOutcome must describe blocked, native-route, interstitial, or fail-closed behavior");
    expect(result.problems).toContain("android-route-watch-test sameOriginProductPathOutcome must name the same-origin product path that was attempted");
    expect(result.problems).toContain("android-route-watch-test sameOriginProductPathOutcome must name the Same-origin diagnostics control or reviewed route fixture trigger");
    expect(result.problems).toContain("android-route-watch-test sameOriginProductPathOutcome must name the visible Navigation blocked or nonblank native state");
  });

  it("rejects completed packets that rely on screenshots without metadata", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));
    const androidHome = packet.packets.find((entry) => entry.id === "android-route-home");
    androidHome.status = "passed";
    androidHome.actual.gsavHostUrl = "";
    androidHome.actual.evidencePaths = [
      writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.png"),
    ];

    const result = validateDeviceEvidencePacket(packet, { root, allowPending: true });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("android-route-home passed packet missing actual.device");
    expect(result.problems).toContain("android-route-home passed packet missing actual.gsavHostUrl");
    expect(result.problems).toContain("android-route-home missing observed signal: native home/feed");
  });

  it("requires one media SHA per local screenshot, recording, or binary evidence path", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));
    const androidHome = packet.packets.find((entry) => entry.id === "android-route-home");
    androidHome.status = "passed";
    androidHome.actual = {
      ...androidHome.actual,
      owner: "@native-validation",
      device: "Pixel 8 emulator",
      osVersion: "Android 15 API 35",
      androidWebViewVersion: "126.0.0.1",
      buildProfile: "release",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      observedSignals: ["native home/feed rendered", "no hosted web chrome visible"],
      evidencePaths: [
        writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.txt"),
        writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.png"),
        writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.mp4"),
      ],
      mediaSha256: ["a".repeat(64)],
      ux: {
        rotation: "portrait and landscape checked",
        safeArea: "notch and gesture areas clear",
        backNavigation: "Android hardware back stays coherent",
        noClippedText: "no clipped text observed",
        noNestedTouch: "no nested-touch ambiguity observed",
        touchTarget44dp: "all primary controls at least 44dp",
      },
      redaction: "account-safe",
    };

    const missingHashResult = validateDeviceEvidencePacket(packet, { root, allowPending: true });
    expect(missingHashResult.ok).toBe(false);
    expect(missingHashResult.problems).toContain(
      "android-route-home mediaSha256 must include one 64-hex hash per local media evidence path (2 required)",
    );

    androidHome.actual.mediaSha256 = ["a".repeat(64), DEFAULT_EVIDENCE_SHA];
    const mismatchResult = validateDeviceEvidencePacket(packet, { root, allowPending: true });
    expect(mismatchResult.ok).toBe(false);
    expect(mismatchResult.problems).toContain(
      `android-route-home mediaSha256 mismatch for docs/qa-evidence/2026-07-01/android-route-home.png: expected ${"a".repeat(64)}, got ${DEFAULT_EVIDENCE_SHA}`,
    );

    androidHome.actual.mediaSha256 = [DEFAULT_EVIDENCE_SHA, DEFAULT_EVIDENCE_SHA];
    expect(validateDeviceEvidencePacket(packet, { root, allowPending: true })).toMatchObject({
      ok: true,
    });
  });

  it("rejects passed packet local evidence outside the packet target evidence date", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));
    const androidHome = packet.packets.find((entry) => entry.id === "android-route-home");
    const staleEvidencePath = writeEvidence(root, "docs/qa-evidence/2026-06-30/android-route-home.txt");
    const currentEvidencePath = writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.txt");
    const staleManifestContents = "{\"artifactPurpose\":\"route-evidence\",\"helperOnly\":false}\n";
    const staleManifestPath = writeEvidence(
      root,
      "docs/qa-evidence/2026-06-30/android-route-home-manifest.json",
      staleManifestContents,
    );
    androidHome.status = "passed";
    androidHome.actual = {
      ...androidHome.actual,
      owner: "@native-validation",
      device: "Pixel 8 emulator",
      osVersion: "Android 15 API 35",
      androidWebViewVersion: "126.0.0.1",
      buildProfile: "release",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      observedSignals: ["native home/feed rendered", "no hosted web chrome visible"],
      evidencePaths: [staleEvidencePath],
      ux: {
        rotation: "portrait and landscape checked",
        safeArea: "notch and gesture areas clear",
        backNavigation: "Android hardware back stays coherent",
        noClippedText: "no clipped text observed",
        noNestedTouch: "no nested-touch ambiguity observed",
        touchTarget44dp: "all primary controls at least 44dp",
      },
      redaction: "account-safe",
    };

    const staleEvidenceResult = validateDeviceEvidencePacket(packet, { root, allowPending: true });
    expect(staleEvidenceResult.ok).toBe(false);
    expect(staleEvidenceResult.problems).toContain(
      "android-route-home actual.evidencePaths date must match packet target evidence date 2026-07-01: docs/qa-evidence/2026-06-30/android-route-home.txt",
    );

    androidHome.actual.evidencePaths = [currentEvidencePath];
    androidHome.actual.evidenceManifestPath = staleManifestPath;
    androidHome.actual.evidenceManifestSha256 = sha256(staleManifestContents);
    const staleManifestResult = validateDeviceEvidencePacket(packet, { root, allowPending: true });
    expect(staleManifestResult.ok).toBe(false);
    expect(staleManifestResult.problems).toContain(
      "android-route-home actual.evidenceManifestPath date must match packet target evidence date 2026-07-01: docs/qa-evidence/2026-06-30/android-route-home-manifest.json",
    );
  });

  it("reconciles passed packets with matching QA Evidence Log rows", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));
    const androidHome = packet.packets.find((entry) => entry.id === "android-route-home");
    androidHome.status = "passed";
    androidHome.actual = {
      ...androidHome.actual,
      owner: "@native-validation",
      device: "Pixel 8 emulator",
      osVersion: "Android 15 API 35",
      androidWebViewVersion: "126.0.0.1",
      buildProfile: "release",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      observedSignals: ["native home/feed rendered", "no hosted web chrome visible"],
      evidencePaths: [
        writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.txt"),
        writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.png"),
      ],
      mediaSha256: [DEFAULT_EVIDENCE_SHA],
      ux: {
        rotation: "portrait and landscape checked",
        safeArea: "notch and gesture areas clear",
        backNavigation: "Android hardware back stays coherent",
        noClippedText: "no clipped text observed",
        noNestedTouch: "no nested-touch ambiguity observed",
        touchTarget44dp: "all primary controls at least 44dp",
      },
      redaction: "account-safe",
    };

    const result = validateDeviceEvidencePacket(packet, {
      root,
      allowPending: true,
      qaText: qaDoc([qaRow({ notes: qaIdentityNotes() })]),
    });
    expect(result.ok).toBe(true);

    const missingEvidenceResult = validateDeviceEvidencePacket(packet, {
      root,
      allowPending: true,
      qaText: qaDoc([qaRow({
        evidencePath: "docs/qa-evidence/2026-07-01/android-route-home.txt",
        notes: qaIdentityNotes(),
      })]),
    });
    expect(missingEvidenceResult.ok).toBe(false);
    expect(missingEvidenceResult.problems).toContain(
      "android-route-home QA Evidence Log row must reference packet evidence path: docs/qa-evidence/2026-07-01/android-route-home.png",
    );

    const pendingQaResult = validateDeviceEvidencePacket(packet, {
      root,
      allowPending: true,
      qaText: qaDoc([qaRow({ result: "_pending_", evidencePath: "_pending_" })]),
    });
    expect(pendingQaResult.ok).toBe(false);
    expect(pendingQaResult.problems).toContain(
      "android-route-home passed packet requires matching QA Evidence Log row to be Passed",
    );
  });

  it("requires QA rows to carry packet target release and dry-run identity", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));
    const androidHome = packet.packets.find((entry) => entry.id === "android-route-home");
    androidHome.status = "passed";
    androidHome.actual = {
      ...androidHome.actual,
      owner: "@native-validation",
      device: "Pixel 8 emulator",
      osVersion: "Android 15 API 35",
      androidWebViewVersion: "126.0.0.1",
      buildProfile: "release",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      observedSignals: ["native home/feed rendered", "no hosted web chrome visible"],
      evidencePaths: [
        writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.txt"),
      ],
      ux: {
        rotation: "portrait and landscape checked",
        safeArea: "notch and gesture areas clear",
        backNavigation: "Android hardware back stays coherent",
        noClippedText: "no clipped text observed",
        noNestedTouch: "no nested-touch ambiguity observed",
        touchTarget44dp: "all primary controls at least 44dp",
      },
      redaction: "account-safe",
    };

    const missingIdentityResult = validateDeviceEvidencePacket(packet, {
      root,
      allowPending: true,
      qaText: qaDoc([qaRow({ evidencePath: "docs/qa-evidence/2026-07-01/android-route-home.txt" })]),
    });
    expect(missingIdentityResult.ok).toBe(false);
    expect(missingIdentityResult.problems).toContain(
      "android-route-home QA Evidence Log row must include packet target releaseCandidateSha",
    );
    expect(missingIdentityResult.problems).toContain(
      "android-route-home QA Evidence Log row must include packet target dryRunArtifact",
    );
    expect(missingIdentityResult.problems).toContain(
      "android-route-home QA Evidence Log row must include packet target dryRunRunUrl",
    );

    const notes = [
      `releaseCandidateSha=${VALID_CANDIDATE_SHA}`,
      `dry-run artifact=${VALID_DRY_RUN_ARTIFACT}`,
      `dry-run run URL=${VALID_DRY_RUN_RUN_URL}`,
      "account-safe evidence",
    ].join("; ");
    expect(validateDeviceEvidencePacket(packet, {
      root,
      allowPending: true,
      qaText: qaDoc([qaRow({
        evidencePath: "docs/qa-evidence/2026-07-01/android-route-home.txt",
        notes,
      })]),
    })).toMatchObject({
      ok: true,
    });
  });

  it("rejects passed QA rows when the matching packet is still pending", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket({
      root,
      date: "2026-07-01",
      owner: "@native-validation",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      now: new Date("2026-07-01T10:00:00.000Z"),
    });

    const result = validateDeviceEvidencePacket(packet, {
      root,
      allowPending: true,
      qaText: qaDoc([qaRow()]),
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("android-route-home QA Evidence Log row is Passed but packet status is pending");
  });

  it("rejects device-validation helper artifacts as packet route or negative evidence", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));

    const androidHome = packet.packets.find((entry) => entry.id === "android-route-home");
    androidHome.status = "passed";
    androidHome.actual = {
      ...androidHome.actual,
      owner: "@native-validation",
      device: "Pixel 8 emulator",
      osVersion: "Android 15 API 35",
      androidWebViewVersion: "126.0.0.1",
      buildProfile: "release",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      observedSignals: ["native home/feed rendered", "no hosted web chrome visible"],
      evidencePaths: [
        "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/diveo-device-validation-2026-07-01-1",
      ],
      ux: {
        rotation: "portrait and landscape checked",
        safeArea: "notch and gesture areas clear",
        backNavigation: "Android hardware back stays coherent",
        noClippedText: "no clipped text observed",
        noNestedTouch: "no nested-touch ambiguity observed",
        touchTarget44dp: "all primary controls at least 44dp",
      },
      redaction: "account-safe",
    };

    const negative = packet.packets.find((entry) => entry.id === "negative-cross-origin-navigation");
    negative.status = "passed";
    negative.owner = "@native-validation";
    negative.actual = {
      ...negative.actual,
      owner: "@native-validation",
      trigger: "Built with EXPO_PUBLIC_GSAV_QA_CONTROLS=1 and tapped Cross-origin.",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      observedSignals: ["untrusted navigation blocked", "app stays on trusted route"],
      evidencePaths: [
        writeEvidence(root, "docs/qa-evidence/2026-07-01/validation-prereqs.json"),
      ],
      android: {
        device: "Pixel 8 emulator",
        osVersion: "Android 15 API 35",
        webViewVersion: "126.0.0.1",
      },
      ios: {
        device: "iPhone 15 simulator",
        osVersion: "iOS 18.5",
        wkWebViewVersion: "WebKit 619.1",
      },
      redaction: "account-safe",
    };

    const result = validateDeviceEvidencePacket(packet, { root, allowPending: true });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      "android-route-home device-validation helper evidence cannot satisfy route or negative packets: https://github.com/opsiclear/diveo/actions/runs/1/artifacts/diveo-device-validation-2026-07-01-1",
    );
    expect(result.problems).toContain(
      "negative-cross-origin-navigation device-validation helper evidence cannot satisfy route or negative packets: docs/qa-evidence/2026-07-01/validation-prereqs.json",
    );
  });

  it("requires route and negative packet external artifacts to include manifest identity", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));
    const androidHome = packet.packets.find((entry) => entry.id === "android-route-home");
    androidHome.status = "passed";
    androidHome.actual = {
      ...androidHome.actual,
      owner: "@native-validation",
      device: "Pixel 8 emulator",
      osVersion: "Android 15 API 35",
      androidWebViewVersion: "126.0.0.1",
      buildProfile: "release",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      observedSignals: ["native home/feed rendered", "no hosted web chrome visible"],
      evidencePaths: ["https://github.com/opsiclear/diveo/actions/runs/1"],
      ux: {
        rotation: "portrait and landscape checked",
        safeArea: "notch and gesture areas clear",
        backNavigation: "Android hardware back stays coherent",
        noClippedText: "no clipped text observed",
        noNestedTouch: "no nested-touch ambiguity observed",
        touchTarget44dp: "all primary controls at least 44dp",
      },
      redaction: "account-safe",
    };

    const bareRunResult = validateDeviceEvidencePacket(packet, { root, allowPending: true });
    expect(bareRunResult.ok).toBe(false);
    expect(bareRunResult.problems).toContain(
      "android-route-home route or negative packet evidence must use a direct artifact/blob with a manifest, not a bare Actions run URL: https://github.com/opsiclear/diveo/actions/runs/1",
    );

    androidHome.actual.evidencePaths = ["https://github.com/opsiclear/diveo/actions/runs/1/artifacts/android-route-home"];
    const missingManifestResult = validateDeviceEvidencePacket(packet, { root, allowPending: true });
    expect(missingManifestResult.ok).toBe(false);
    expect(missingManifestResult.problems).toContain(
      "android-route-home external artifact evidence must set actual.artifactPurpose to route-evidence",
    );
    expect(missingManifestResult.problems).toContain(
      "android-route-home external artifact evidence must set actual.evidenceManifestSha256 to 64-hex",
    );
    expect(missingManifestResult.problems).toContain(
      "android-route-home fileSha256 must include one 64-hex hash per direct external artifact evidence path (1 required)",
    );

    const manifestContents = JSON.stringify({
      artifactPurpose: "route-evidence",
      route: "/",
      evidenceFiles: ["android-route-home.txt"],
      helperOnly: false,
    });
    const manifestPath = writeEvidence(
      root,
      "docs/qa-evidence/2026-07-01/android-route-home-manifest.json",
      manifestContents,
    );
    androidHome.actual = {
      ...androidHome.actual,
      artifactPurpose: "route-evidence",
      evidenceManifestPath: manifestPath,
      evidenceManifestSha256: "a".repeat(64),
      fileSha256: ["b".repeat(64)],
      sourceRunId: "2",
      sourceArtifactId: "wrong-artifact",
    };
    const mismatchedIdentityResult = validateDeviceEvidencePacket(packet, { root, allowPending: true });
    expect(mismatchedIdentityResult.ok).toBe(false);
    expect(mismatchedIdentityResult.problems).toContain(
      "android-route-home actual.sourceRunId must match evidence artifact URL run 1",
    );
    expect(mismatchedIdentityResult.problems).toContain(
      "android-route-home actual.sourceArtifactId must match evidence artifact URL segment android-route-home",
    );
    expect(mismatchedIdentityResult.problems).toContain(
      `android-route-home local evidenceManifestPath SHA256 mismatch: expected ${"a".repeat(64)}, got ${sha256(manifestContents)}`,
    );

    androidHome.actual = {
      ...androidHome.actual,
      sourceRunId: "1",
      sourceArtifactId: "android-route-home",
      evidenceManifestSha256: sha256(manifestContents),
    };
    expect(validateDeviceEvidencePacket(packet, { root, allowPending: true })).toMatchObject({
      ok: true,
    });
  });

  it("validates iOS packet artifactUrl as direct byte-backed evidence", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));
    const iosHome = packet.packets.find((entry) => entry.id === "ios-route-home");
    const artifactUrl = "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/ios-route-home";
    const artifactSha256 = "c".repeat(64);
    iosHome.status = "passed";
    iosHome.actual = {
      ...iosHome.actual,
      owner: "@ios-validation",
      device: "iPhone 15 simulator",
      osVersion: "iOS 18.5",
      wkWebViewVersion: "WebKit 619.1",
      executorProof: "macOS 15.5 xcrun simctl proof captured",
      buildProfile: "release",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      observedSignals: ["native home/feed rendered", "no hosted web chrome visible"],
      evidencePaths: [artifactUrl],
      artifactPurpose: "route-evidence",
      evidenceManifestPath: "ios-route-evidence-manifest.json",
      evidenceManifestSha256: "a".repeat(64),
      sourceRunId: "1",
      sourceArtifactId: "ios-route-home",
      fileSha256: [artifactSha256],
      artifactUrl,
      artifactSha256,
      ux: {
        rotation: "portrait and landscape checked",
        safeArea: "notch and gesture areas clear",
        backNavigation: "back gesture stays coherent",
        noClippedText: "no clipped text observed",
        noNestedTouch: "no nested-touch ambiguity observed",
        touchTarget44dp: "all primary controls at least 44dp",
      },
      redaction: "account-safe",
    };

    expect(validateDeviceEvidencePacket(packet, { root, allowPending: true })).toMatchObject({
      ok: true,
    });

    iosHome.actual.artifactUrl = "https://github.com/opsiclear/diveo/actions/runs/1";
    expect(validateDeviceEvidencePacket(packet, { root, allowPending: true }).problems).toContain(
      "ios-route-home actual.artifactUrl must use a direct artifact/blob, not a bare Actions run URL: https://github.com/opsiclear/diveo/actions/runs/1",
    );

    iosHome.actual.artifactUrl = "https://github.com/opsiclear/diveo/releases/tag/v1.0.19";
    expect(validateDeviceEvidencePacket(packet, { root, allowPending: true }).problems).toContain(
      "ios-route-home actual.artifactUrl must use a direct artifact/blob, not a release tag URL: https://github.com/opsiclear/diveo/releases/tag/v1.0.19",
    );

    iosHome.actual.artifactUrl = "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/ios-route-home";
    iosHome.actual.evidencePaths = ["https://github.com/opsiclear/diveo/actions/runs/1/artifacts/other-ios-evidence"];
    expect(validateDeviceEvidencePacket(packet, { root, allowPending: true }).problems).toContain(
      "ios-route-home actual.artifactUrl must also appear in actual.evidencePaths",
    );

    iosHome.actual.evidencePaths = [artifactUrl];
    iosHome.actual.fileSha256 = ["d".repeat(64)];
    expect(validateDeviceEvidencePacket(packet, { root, allowPending: true }).problems).toContain(
      "ios-route-home actual.artifactSha256 must match one mediaSha256 or fileSha256 evidence hash",
    );
  });

  it("requires combined negative packets to include distinct Android and iOS evidence paths", () => {
    const root = tempRepo();
    const packet = createDeviceEvidencePacket(completePacketOptions(root));
    const negative = packet.packets.find((entry) => entry.id === "negative-cross-origin-navigation");
    negative.status = "passed";
    negative.owner = "@native-validation";
    negative.actual = {
      ...negative.actual,
      owner: "@native-validation",
      trigger: "Built with EXPO_PUBLIC_GSAV_QA_CONTROLS=1 and tapped Cross-origin.",
      gsavHostUrl: "https://gsav.example.com",
      gsavHostingCommit: "gsav-host-abc1234",
      observedSignals: ["untrusted navigation blocked", "app stays on trusted route"],
      evidencePaths: [
        writeEvidence(root, "docs/qa-evidence/2026-07-01/android-ios-negative-cross-origin-navigation.txt"),
      ],
      android: {
        device: "Pixel 8 emulator",
        osVersion: "Android 15 API 35",
        webViewVersion: "126.0.0.1",
      },
      ios: {
        device: "iPhone 15 simulator",
        osVersion: "iOS 18.5",
        wkWebViewVersion: "WebKit 619.1",
      },
      redaction: "account-safe",
    };

    const onePathResult = validateDeviceEvidencePacket(packet, { root, allowPending: true });
    expect(onePathResult.ok).toBe(false);
    expect(onePathResult.problems).toContain(
      "negative-cross-origin-navigation negative packet evidencePaths must include distinct Android and iOS evidence paths",
    );

    negative.actual.evidencePaths = [
      writeEvidence(root, "docs/qa-evidence/2026-07-01/android-negative-cross-origin-navigation.txt"),
      writeEvidence(root, "docs/qa-evidence/2026-07-01/ios-negative-cross-origin-navigation.txt"),
    ];
    expect(validateDeviceEvidencePacket(packet, { root, allowPending: true })).toMatchObject({
      ok: true,
    });
  });

  it("validates local and trusted external evidence path shapes", () => {
    const root = tempRepo();
    const localPath = writeEvidence(root, "docs/qa-evidence/2026-07-01/android-route-home.txt");

    expect(evidencePathProblem(localPath, root)).toBeNull();
    expect(evidencePathProblem("https://github.com/OpsiClear-Web/diveo/actions/runs/123", root)).toBeNull();
    expect(evidencePathProblem("https://example.com/artifact.zip", root)).toBe("external evidence URL is not trusted GitHub evidence");
    expect(evidencePathProblem(path.resolve(root, "outside.txt"), root)).toBe("evidence path must be repository-relative");
    expect(evidencePathProblem("tmp/evidence.txt", root)).toBe("local evidence path must be under docs/qa-evidence");
    expect(evidencePathProblem("docs/qa-evidence/2026-07-01/missing.txt", root)).toBe("local evidence path does not exist");
  });

  it("uses stable packet slugs for QA rows", () => {
    expect(packetSlug({ platform: "Android", route: "/" })).toBe("android-route-home");
    expect(packetSlug({ platform: "iOS", route: "/gsav/test?t=2.5" })).toBe("ios-route-gsav-test-t-2-5");
    expect(packetSlug({ platform: "Android/iOS", route: "Auth initialization gate" })).toBe("negative-auth-initialization-gate");
  });
});
