import crypto from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import summaryModule from "./write-release-evidence-summary.js";

const {
  gsavPackageProvenanceSha256,
  gsavPackageProvenanceText,
  parseArgs,
  publishArtifactIdentityText,
  releaseCandidateIdentityProblems,
  sha256Text: summarySha256Text,
  writeReleaseEvidenceSummary,
} = summaryModule;

function tempReleaseFiles() {
  const root = mkdtempSync(join(tmpdir(), "diveo-release-evidence-"));
  const evidenceDir = join(root, "release-evidence");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "native-production-config.json"), "{\"status\":\"pass\"}\n");
  writeFileSync(join(evidenceDir, "release-artifact.json"), "{\"checksums\":true}\n");
  writeFileSync(join(evidenceDir, "release-candidate.txt"), [
    "releaseCandidateSha=abcdef1234567890abcdef1234567890abcdef12",
    "appVersion=1.0.20",
    "packageVersion=1.0.20",
    "androidVersionCode=10020",
    "",
  ].join("\n"));
  const apkPath = join(root, "app-release.apk");
  const manifestPath = join(root, "AndroidManifest.xml");
  writeFileSync(apkPath, "apk bytes");
  writeFileSync(manifestPath, "<manifest />");
  return { root, evidenceDir, apkPath, manifestPath };
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function addGsavPackageFixtures(root, { bridgeBytes = "bridge bytes", clientBytes = "client bytes", clientVersion = "0.2.0" } = {}) {
  const vendorDir = join(root, "vendor");
  mkdirSync(vendorDir, { recursive: true });
  writeFileSync(join(vendorDir, "opsiclear-gsav-bridge-0.1.0.tgz"), bridgeBytes);
  writeFileSync(join(vendorDir, `opsiclear-gsav-client-${clientVersion}.tgz`), clientBytes);
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    dependencies: {
      "@opsiclear/gsav-bridge": "file:vendor/opsiclear-gsav-bridge-0.1.0.tgz",
      "@opsiclear/gsav-client": `file:vendor/opsiclear-gsav-client-${clientVersion}.tgz`,
    },
  }, null, 2)}\n`);
}

describe("release evidence summary writer", () => {
  it("parses CLI flags", () => {
    expect(parseArgs([
      "--evidence-dir", "release-evidence",
      "--apk-path", "app.apk",
      "--manifest-path", "AndroidManifest.xml",
      "--artifact-name", "diveo-release-evidence-v1.0.20",
      "--release-version", "1.0.20",
      "--release-candidate-sha", "abcdef1234567890abcdef1234567890abcdef12",
    ])).toEqual({
      evidenceDir: "release-evidence",
      apkPath: "app.apk",
      manifestPath: "AndroidManifest.xml",
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      releaseCandidateSha: "abcdef1234567890abcdef1234567890abcdef12",
    });
  });

  it("writes dry-run summary and checksum evidence", () => {
    const { evidenceDir, apkPath, manifestPath } = tempReleaseFiles();
    const result = writeReleaseEvidenceSummary({
      evidenceDir,
      apkPath,
      manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {
        GITHUB_EVENT_NAME: "workflow_dispatch",
        PUBLISH_RELEASE: "false",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "opsiclear/diveo",
        GITHUB_RUN_ID: "12345",
        GITHUB_SHA: "abc123",
        RELEASE_CANDIDATE_SHA: "abcdef1234567890abcdef1234567890abcdef12",
        GSAV_RANGE_PROBE_URL: "https://gsav.example.com/test.gsav",
      },
    });

    expect(existsSync(result.summaryPath)).toBe(true);
    expect(existsSync(result.checksumPath)).toBe(true);
    expect(result.summary).toMatchObject({
      workflow: "release.yml",
      workflowDispatch: true,
      eventName: "workflow_dispatch",
      publishRelease: false,
      noPublishSideEffectExpected: true,
      runUrl: "https://github.com/opsiclear/diveo/actions/runs/12345",
      commit: "abcdef1234567890abcdef1234567890abcdef12",
      releaseCandidateSha: "abcdef1234567890abcdef1234567890abcdef12",
      workflowSha: "abc123",
      releaseVersion: "1.0.20",
      appVersion: "1.0.20",
      packageVersion: "1.0.20",
      androidVersionCode: "10020",
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseEvidenceGlob: "release-evidence/**",
      rangeProbeUrl: "https://gsav.example.com/test.gsav",
      rangeRequest: "bytes=0-0",
      rangeProbeUrlPresent: true,
    });
    expect(result.summary.apkSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.summary.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.summary.evidenceBundleSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.summary.evidenceChecksumManifestSha256).toBe(result.summary.evidenceBundleSha256);
    expect(result.summary.gsavPackageProvenanceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.summary.gsavPackageProvenanceSha256).toBe(
      gsavPackageProvenanceSha256(result.summary.gsavPackageProvenance),
    );
    expect(result.summary.publishArtifactIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.summary.publishArtifactIdentitySha256).toBe(summarySha256Text(publishArtifactIdentityText(result.summary)));

    const summaryJson = JSON.parse(readFileSync(result.summaryPath, "utf8"));
    expect(summaryJson.noPublishSideEffectExpected).toBe(true);
    expect(summaryJson.publishArtifactIdentitySha256).toBe(result.summary.publishArtifactIdentitySha256);
    const checksums = readFileSync(result.checksumPath, "utf8");
    expect(checksums).toContain("native-production-config.json");
    expect(checksums).toContain("release-artifact.json");
    expect(checksums).toContain("app-release.apk");
    expect(checksums).toContain("AndroidManifest.xml");
  });

  it("treats push-triggered release artifact runs as no-publish dry-run evidence", () => {
    const { evidenceDir, apkPath, manifestPath } = tempReleaseFiles();
    const result = writeReleaseEvidenceSummary({
      evidenceDir,
      apkPath,
      manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {
        GITHUB_EVENT_NAME: "push",
        PUBLISH_RELEASE: "false",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "opsiclear/diveo",
        GITHUB_RUN_ID: "12345",
        GITHUB_SHA: "abcdef1234567890abcdef1234567890abcdef12",
        RELEASE_CANDIDATE_SHA: "abcdef1234567890abcdef1234567890abcdef12",
        GSAV_RANGE_PROBE_URL: "https://gsav.example.com/test.gsav",
      },
    });

    expect(result.summary.workflowDispatch).toBe(false);
    expect(result.summary.eventName).toBe("push");
    expect(result.summary.publishRelease).toBe(false);
    expect(result.summary.noPublishSideEffectExpected).toBe(true);
  });


  it("records vendored GSAV package provenance", () => {
    const { root, evidenceDir, apkPath, manifestPath } = tempReleaseFiles();
    addGsavPackageFixtures(root);

    const result = writeReleaseEvidenceSummary({
      root,
      evidenceDir,
      apkPath,
      manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {
        GITHUB_EVENT_NAME: "workflow_dispatch",
        PUBLISH_RELEASE: "false",
        GITHUB_SHA: "abcdef1234567890abcdef1234567890abcdef12",
        GSAV_RANGE_PROBE_URL: "https://gsav.example.com/test.gsav",
      },
    });

    expect(result.summary.gsavPackageProvenance).toEqual([
      {
        packageName: "@opsiclear/gsav-bridge",
        specifier: "file:vendor/opsiclear-gsav-bridge-0.1.0.tgz",
        tarballPath: "vendor/opsiclear-gsav-bridge-0.1.0.tgz",
        tarballSha256: summarySha256Text("bridge bytes"),
      },
      {
        packageName: "@opsiclear/gsav-client",
        specifier: "file:vendor/opsiclear-gsav-client-0.2.0.tgz",
        tarballPath: "vendor/opsiclear-gsav-client-0.2.0.tgz",
        tarballSha256: summarySha256Text("client bytes"),
      },
    ]);
    expect(gsavPackageProvenanceText(result.summary.gsavPackageProvenance)).toBe([
      "gsavPackageProvenance:v1",
      "packageName=@opsiclear/gsav-bridge",
      "specifier=file:vendor/opsiclear-gsav-bridge-0.1.0.tgz",
      "tarballPath=vendor/opsiclear-gsav-bridge-0.1.0.tgz",
      `tarballSha256=${summarySha256Text("bridge bytes")}`,
      "packageName=@opsiclear/gsav-client",
      "specifier=file:vendor/opsiclear-gsav-client-0.2.0.tgz",
      "tarballPath=vendor/opsiclear-gsav-client-0.2.0.tgz",
      `tarballSha256=${summarySha256Text("client bytes")}`,
      "",
    ].join("\n"));
    expect(result.summary.gsavPackageProvenanceSha256).toBe(
      gsavPackageProvenanceSha256(result.summary.gsavPackageProvenance),
    );
    expect(JSON.parse(readFileSync(result.summaryPath, "utf8")).gsavPackageProvenance).toEqual(result.summary.gsavPackageProvenance);
    expect(JSON.parse(readFileSync(result.summaryPath, "utf8")).gsavPackageProvenanceSha256).toBe(result.summary.gsavPackageProvenanceSha256);
  });

  it("changes publish artifact identity when GSAV tarball bytes change", () => {
    const { root, evidenceDir, apkPath, manifestPath } = tempReleaseFiles();
    addGsavPackageFixtures(root);
    const options = {
      root,
      evidenceDir,
      apkPath,
      manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {
        GITHUB_EVENT_NAME: "workflow_dispatch",
        PUBLISH_RELEASE: "false",
        GITHUB_SHA: "abcdef1234567890abcdef1234567890abcdef12",
        GSAV_RANGE_PROBE_URL: "https://gsav.example.com/test.gsav",
      },
    };

    const first = writeReleaseEvidenceSummary(options);
    writeFileSync(join(root, "vendor", "opsiclear-gsav-bridge-0.1.0.tgz"), "changed bridge bytes");
    const second = writeReleaseEvidenceSummary(options);

    expect(second.summary.gsavPackageProvenanceSha256).not.toBe(first.summary.gsavPackageProvenanceSha256);
    expect(second.summary.publishArtifactIdentitySha256).not.toBe(first.summary.publishArtifactIdentitySha256);
  });

  it("changes publish artifact identity when GSAV package specifiers change", () => {
    const firstFiles = tempReleaseFiles();
    addGsavPackageFixtures(firstFiles.root, { clientVersion: "0.2.0" });
    const first = writeReleaseEvidenceSummary({
      root: firstFiles.root,
      evidenceDir: firstFiles.evidenceDir,
      apkPath: firstFiles.apkPath,
      manifestPath: firstFiles.manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {
        GITHUB_EVENT_NAME: "workflow_dispatch",
        PUBLISH_RELEASE: "false",
        GITHUB_SHA: "abcdef1234567890abcdef1234567890abcdef12",
        GSAV_RANGE_PROBE_URL: "https://gsav.example.com/test.gsav",
      },
    });

    const secondFiles = tempReleaseFiles();
    addGsavPackageFixtures(secondFiles.root, { clientVersion: "0.2.1" });
    const second = writeReleaseEvidenceSummary({
      root: secondFiles.root,
      evidenceDir: secondFiles.evidenceDir,
      apkPath: secondFiles.apkPath,
      manifestPath: secondFiles.manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {
        GITHUB_EVENT_NAME: "workflow_dispatch",
        PUBLISH_RELEASE: "false",
        GITHUB_SHA: "abcdef1234567890abcdef1234567890abcdef12",
        GSAV_RANGE_PROBE_URL: "https://gsav.example.com/test.gsav",
      },
    });

    expect(second.summary.apkSha256).toBe(first.summary.apkSha256);
    expect(second.summary.manifestSha256).toBe(first.summary.manifestSha256);
    expect(second.summary.gsavPackageProvenanceSha256).not.toBe(first.summary.gsavPackageProvenanceSha256);
    expect(second.summary.publishArtifactIdentitySha256).not.toBe(first.summary.publishArtifactIdentitySha256);
  });

  it("keeps generated summary/checksum files out of rerun inputs and hashes the checksum manifest exactly", () => {
    const { evidenceDir, apkPath, manifestPath } = tempReleaseFiles();
    const options = {
      evidenceDir,
      apkPath,
      manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {
        GITHUB_EVENT_NAME: "workflow_dispatch",
        PUBLISH_RELEASE: "false",
        GITHUB_SHA: "abcdef1234567890abcdef1234567890abcdef12",
        GSAV_RANGE_PROBE_URL: "https://gsav.example.com/test.gsav",
      },
    };

    writeReleaseEvidenceSummary(options);
    const rerun = writeReleaseEvidenceSummary(options);

    expect(rerun.summary.releaseEvidenceFiles.map((item) => item.path)).not.toEqual(expect.arrayContaining([
      expect.stringContaining("dry-run-summary.json"),
      expect.stringContaining("evidence-checksums.txt"),
    ]));
    const checksumText = readFileSync(rerun.checksumPath, "utf8");
    expect(rerun.summary.evidenceBundleSha256).toBe(sha256Text(checksumText));
    expect(rerun.summary.evidenceChecksumManifestSha256).toBe(rerun.summary.evidenceBundleSha256);
    expect(JSON.parse(readFileSync(rerun.summaryPath, "utf8")).evidenceBundleSha256).toBe(rerun.summary.evidenceBundleSha256);
    expect(rerun.summary.publishArtifactIdentitySha256).toBe(summarySha256Text(publishArtifactIdentityText(rerun.summary)));
    expect(checksumText).not.toContain("dry-run-summary.json");
    expect(checksumText).not.toContain("evidence-checksums.txt");
  });

  it("keeps publish artifact identity stable when dry-run-only proof changes", () => {
    const { evidenceDir, apkPath, manifestPath } = tempReleaseFiles();
    const options = {
      evidenceDir,
      apkPath,
      manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {
        GITHUB_EVENT_NAME: "workflow_dispatch",
        PUBLISH_RELEASE: "false",
        GITHUB_SHA: "abcdef1234567890abcdef1234567890abcdef12",
        GSAV_RANGE_PROBE_URL: "https://gsav.example.com/test.gsav",
      },
    };

    const first = writeReleaseEvidenceSummary(options);
    writeFileSync(join(evidenceDir, "no-publish-side-effect.txt"), "dry-run proof changed\n");
    const second = writeReleaseEvidenceSummary(options);

    expect(second.summary.evidenceChecksumManifestSha256).not.toBe(first.summary.evidenceChecksumManifestSha256);
    expect(second.summary.publishArtifactIdentitySha256).toBe(first.summary.publishArtifactIdentitySha256);
  });

  it("fails before writing a summary when release-candidate identity is incomplete", () => {
    const { evidenceDir, apkPath, manifestPath } = tempReleaseFiles();
    writeFileSync(join(evidenceDir, "release-candidate.txt"), [
      "releaseCandidateSha=abcdef1234567890abcdef1234567890abcdef12",
      "appVersion=1.0.20",
      "",
    ].join("\n"));

    expect(releaseCandidateIdentityProblems({
      releaseCandidateSha: "abcdef1234567890abcdef1234567890abcdef12",
      appVersion: "1.0.20",
    }, "abcdef1234567890abcdef1234567890abcdef12", "1.0.20")).toEqual([
      "release-candidate.txt must include packageVersion",
      "release-candidate.txt must include androidVersionCode",
    ]);
    expect(() => writeReleaseEvidenceSummary({
      evidenceDir,
      apkPath,
      manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {
        RELEASE_CANDIDATE_SHA: "abcdef1234567890abcdef1234567890abcdef12",
      },
    })).toThrow("release-candidate.txt must include packageVersion; release-candidate.txt must include androidVersionCode");
  });

  it("fails before writing a summary when release-candidate identity drifts from the workflow candidate", () => {
    const { evidenceDir, apkPath, manifestPath } = tempReleaseFiles();

    expect(releaseCandidateIdentityProblems({
      releaseCandidateSha: "abcdef1234567890abcdef1234567890abcdef12",
      appVersion: "1.0.20",
      packageVersion: "1.0.20",
      androidVersionCode: "10020",
    }, "1234567890abcdef1234567890abcdef12345678", "1.0.20")).toEqual([
      "release-candidate.txt releaseCandidateSha must match RELEASE_CANDIDATE_SHA",
    ]);
    expect(() => writeReleaseEvidenceSummary({
      evidenceDir,
      apkPath,
      manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {
        RELEASE_CANDIDATE_SHA: "1234567890abcdef1234567890abcdef12345678",
      },
    })).toThrow("release-candidate.txt releaseCandidateSha must match RELEASE_CANDIDATE_SHA");
  });

  it("fails before writing a summary when release-candidate version metadata is malformed", () => {
    const { evidenceDir, apkPath, manifestPath } = tempReleaseFiles();
    writeFileSync(join(evidenceDir, "release-candidate.txt"), [
      "releaseCandidateSha=abcdef1234567890abcdef1234567890abcdef12",
      "appVersion=1.0",
      "packageVersion=1.0.21",
      "androidVersionCode=code-10020",
      "",
    ].join("\n"));

    expect(releaseCandidateIdentityProblems({
      releaseCandidateSha: "abcdef1234567890abcdef1234567890abcdef12",
      appVersion: "1.0",
      packageVersion: "1.0.21",
      androidVersionCode: "code-10020",
    }, "abcdef1234567890abcdef1234567890abcdef12", "1.0.20")).toEqual([
      "release-candidate.txt appVersion must be semver",
      "release-candidate.txt appVersion must match releaseVersion",
      "release-candidate.txt packageVersion must match releaseVersion",
      "release-candidate.txt androidVersionCode must be numeric",
    ]);
    expect(() => writeReleaseEvidenceSummary({
      evidenceDir,
      apkPath,
      manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {
        RELEASE_CANDIDATE_SHA: "abcdef1234567890abcdef1234567890abcdef12",
      },
    })).toThrow("release-candidate.txt appVersion must be semver; release-candidate.txt appVersion must match releaseVersion; release-candidate.txt packageVersion must match releaseVersion; release-candidate.txt androidVersionCode must be numeric");
  });

  it("fails before writing a summary when the workflow candidate is not a SHA", () => {
    const { evidenceDir, apkPath, manifestPath } = tempReleaseFiles();

    expect(releaseCandidateIdentityProblems({
      releaseCandidateSha: "abcdef1234567890abcdef1234567890abcdef12",
      appVersion: "1.0.20",
      packageVersion: "1.0.20",
      androidVersionCode: "10020",
    }, "release/1.0.20", "1.0.20")).toEqual([
      "releaseCandidateSha must be a commit SHA",
      "release-candidate.txt releaseCandidateSha must match RELEASE_CANDIDATE_SHA",
    ]);
    expect(() => writeReleaseEvidenceSummary({
      evidenceDir,
      apkPath,
      manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {
        RELEASE_CANDIDATE_SHA: "release/1.0.20",
      },
    })).toThrow("releaseCandidateSha must be a commit SHA; release-candidate.txt releaseCandidateSha must match RELEASE_CANDIDATE_SHA");
  });

  it("fails when release artifacts are missing", () => {
    const { evidenceDir, manifestPath } = tempReleaseFiles();
    expect(() => writeReleaseEvidenceSummary({
      evidenceDir,
      apkPath: join(evidenceDir, "missing.apk"),
      manifestPath,
      artifactName: "diveo-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {},
    })).toThrow("APK file is missing");
  });

  it("requires the uploaded release evidence artifact name to match the release version", () => {
    const { evidenceDir, apkPath, manifestPath } = tempReleaseFiles();

    expect(() => writeReleaseEvidenceSummary({
      evidenceDir,
      apkPath,
      manifestPath,
      artifactName: "custom-release-evidence-v1.0.20",
      releaseVersion: "1.0.20",
      env: {},
    })).toThrow("artifactName must be diveo-release-evidence-v1.0.20");
  });
});
