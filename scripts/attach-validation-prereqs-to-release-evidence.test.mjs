import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import attachModule from "./attach-validation-prereqs-to-release-evidence.js";

const {
  attachValidationPrereqsToReleaseEvidence,
  parseArgs,
  sha256File,
  sha256Text,
} = attachModule;

const IOS_ARTIFACT_PATH = "release-evidence/ios-wkwebview-evidence.zip";
const IOS_ARTIFACT_CONTENT = "iOS WKWebView evidence bytes\n";
const IOS_ARTIFACT_SHA256 = sha256Text(IOS_ARTIFACT_CONTENT);

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createDownloadedBundle() {
  const root = mkdtempSync(join(tmpdir(), "diveo-attach-validation-"));
  const evidenceDir = join(root, "release-evidence");
  const apkPath = join(root, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
  const manifestPath = join(
    root,
    "android",
    "app",
    "build",
    "intermediates",
    "merged_manifests",
    "release",
    "processReleaseManifest",
    "AndroidManifest.xml",
  );
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(join(root, "android", "app", "build", "outputs", "apk", "release"), { recursive: true });
  mkdirSync(join(root, "android", "app", "build", "intermediates", "merged_manifests", "release", "processReleaseManifest"), { recursive: true });
  writeFileSync(join(evidenceDir, "version.txt"), "1.0.19\n");
  writeFileSync(join(evidenceDir, "release-candidate.txt"), "releaseCandidateSha=abcdef1234567890abcdef1234567890abcdef12\n");
  writeFileSync(join(root, IOS_ARTIFACT_PATH), IOS_ARTIFACT_CONTENT);
  writeFileSync(apkPath, "apk bytes");
  writeFileSync(manifestPath, "<manifest />");
  writeJson(join(evidenceDir, "validation-prereqs.json"), {
    ok: true,
    status: "pass",
    checkedAt: "2026-06-30T00:00:00.000Z",
    checked: {
      ios: {
        artifactPath: {
          value: IOS_ARTIFACT_PATH,
          exists: true,
        },
        artifactSha256: {
          value: IOS_ARTIFACT_SHA256,
        },
        computedArtifactSha256: {
          value: IOS_ARTIFACT_SHA256,
        },
        artifactSha256Matches: true,
      },
    },
  });

  const releaseEvidenceFiles = [
    {
      path: "release-evidence/release-candidate.txt",
      sha256: sha256File(join(evidenceDir, "release-candidate.txt")),
    },
    {
      path: "release-evidence/version.txt",
      sha256: sha256File(join(evidenceDir, "version.txt")),
    },
  ];
  const summary = {
    releaseEvidenceFiles,
    apkPath: "android/app/build/outputs/apk/release/app-release.apk",
    manifestPath: "android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml",
    apkSha256: sha256File(apkPath),
    manifestSha256: sha256File(manifestPath),
  };
  const checksumText = [
    ...releaseEvidenceFiles.map((item) => `${item.sha256}  ${item.path}`),
    `${summary.apkSha256}  ${summary.apkPath}`,
    `${summary.manifestSha256}  ${summary.manifestPath}`,
  ].join("\n") + "\n";
  const evidenceBundleSha256 = sha256Text(checksumText);
  writeJson(join(evidenceDir, "dry-run-summary.json"), {
    ...summary,
    evidenceBundleSha256,
    evidenceChecksumManifestSha256: evidenceBundleSha256,
  });
  writeFileSync(join(evidenceDir, "evidence-checksums.txt"), checksumText);
  return { root, evidenceDir, apkPath, manifestPath };
}

describe("validation prereq release evidence attachment", () => {
  it("parses CLI flags", () => {
    expect(parseArgs([
      "--root", "downloaded-release",
      "--evidence-dir", "release-evidence",
      "--validation-prereqs-path", "release-evidence/validation-prereqs.json",
      "--apk-path", "android/app-release.apk",
      "--manifest-path", "android/AndroidManifest.xml",
    ])).toEqual({
      root: "downloaded-release",
      evidenceDir: "release-evidence",
      validationPrereqsPath: "release-evidence/validation-prereqs.json",
      apkPath: "android/app-release.apk",
      manifestPath: "android/AndroidManifest.xml",
    });
    expect(() => parseArgs(["--unknown", "x"])).toThrow("Unknown option");
  });

  it("adds validation prerequisites to the summary and checksum manifest", () => {
    const { root } = createDownloadedBundle();

    const result = attachValidationPrereqsToReleaseEvidence({
      root,
      evidenceDir: "release-evidence",
      apkPath: "android/app/build/outputs/apk/release/app-release.apk",
      manifestPath: "android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml",
      checkedAt: "2026-06-30T00:00:00.000Z",
    });

    const summary = JSON.parse(readFileSync(join(root, "release-evidence", "dry-run-summary.json"), "utf8"));
    const checksumText = readFileSync(join(root, "release-evidence", "evidence-checksums.txt"), "utf8");
    expect(summary.validationPrereqsPath).toBe("release-evidence/validation-prereqs.json");
    expect(summary.validationPrereqsAttachedAt).toBe("2026-06-30T00:00:00.000Z");
    expect(summary.releaseEvidenceFiles.map((item) => item.path)).toContain("release-evidence/validation-prereqs.json");
    expect(summary.releaseEvidenceFiles.map((item) => item.path)).toContain(IOS_ARTIFACT_PATH);
    expect(checksumText).toContain("release-evidence/validation-prereqs.json");
    expect(checksumText).toContain(IOS_ARTIFACT_PATH);
    expect(summary.evidenceBundleSha256).toBe(sha256Text(checksumText));
    expect(result.evidenceBundleSha256).toBe(summary.evidenceBundleSha256);
  });

  it("rejects a stale existing evidence checksum before attaching validation prerequisites", () => {
    const { root } = createDownloadedBundle();
    writeFileSync(join(root, "release-evidence", "version.txt"), "mutated\n");

    expect(() => attachValidationPrereqsToReleaseEvidence({ root })).toThrow(
      "checksum mismatch before attaching validation prerequisites: release-evidence/version.txt",
    );
  });

  it("rejects artifact path drift from the original release summary", () => {
    const { root } = createDownloadedBundle();

    expect(() => attachValidationPrereqsToReleaseEvidence({
      root,
      apkPath: "different/app.apk",
    })).toThrow("APK path must match dry-run-summary.json");
  });

  it("rejects validation prerequisite paths outside the downloaded artifact root", () => {
    const { root } = createDownloadedBundle();
    writeJson(join(root, "..", "validation-prereqs-outside.json"), {
      ok: true,
      status: "pass",
    });

    expect(() => attachValidationPrereqsToReleaseEvidence({
      root,
      validationPrereqsPath: "../validation-prereqs-outside.json",
    })).toThrow("validation-prereqs.json must stay inside root");
  });

  it("rejects validation prerequisite paths outside the uploaded release evidence directory", () => {
    const { root } = createDownloadedBundle();
    const validationPrereqs = JSON.parse(readFileSync(join(root, "release-evidence", "validation-prereqs.json"), "utf8"));
    writeJson(join(root, "validation-prereqs.json"), validationPrereqs);

    expect(() => attachValidationPrereqsToReleaseEvidence({
      root,
      validationPrereqsPath: "validation-prereqs.json",
    })).toThrow("validation-prereqs.json must stay inside evidenceDir");
  });

  it("rejects stale iOS artifact checksum proof before attachment", () => {
    const { root } = createDownloadedBundle();
    writeFileSync(join(root, IOS_ARTIFACT_PATH), "mutated iOS bytes\n");

    expect(() => attachValidationPrereqsToReleaseEvidence({ root }))
      .toThrow("iOS validation artifact SHA256 does not match validation-prereqs.json computedArtifactSha256");
  });

  it("rejects iOS artifact paths outside the uploaded release evidence directory", () => {
    const { root } = createDownloadedBundle();
    const outsideArtifactPath = "ios-wkwebview-evidence.zip";
    writeFileSync(join(root, outsideArtifactPath), IOS_ARTIFACT_CONTENT);
    const validationPrereqsPath = join(root, "release-evidence", "validation-prereqs.json");
    const validationPrereqs = JSON.parse(readFileSync(validationPrereqsPath, "utf8"));
    validationPrereqs.checked.ios.artifactPath.value = outsideArtifactPath;
    writeJson(validationPrereqsPath, validationPrereqs);

    expect(() => attachValidationPrereqsToReleaseEvidence({ root }))
      .toThrow("iOS validation artifact path must stay inside evidenceDir");
  });

  it("rejects release evidence file paths outside the downloaded artifact root", () => {
    const { root } = createDownloadedBundle();
    const summaryPath = join(root, "release-evidence", "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.releaseEvidenceFiles.push({
      path: "../outside.txt",
      sha256: "0".repeat(64),
    });
    writeJson(summaryPath, summary);

    expect(() => attachValidationPrereqsToReleaseEvidence({ root }))
      .toThrow("release evidence file ../outside.txt must stay inside root");
  });
});
