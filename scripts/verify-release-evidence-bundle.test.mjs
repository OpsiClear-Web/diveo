import crypto from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import summaryModule from "./write-release-evidence-summary.js";
import verifier from "./verify-release-evidence-bundle.js";

const { writeReleaseEvidenceSummary } = summaryModule;
const {
  gsavPackageProvenanceSha256,
  normalizeBooleanOption,
  normalizeMode,
  parseArgs,
  parseSignoffDiffText,
  publishArtifactIdentityText,
  sha256Text: verifierSha256Text,
  trustedGithubEvidenceUrl,
  trustedGithubRunUrl,
  validateGsavPackageProvenance,
  verifyReleaseEvidenceBundle,
} = verifier;

const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
const appJson = JSON.parse(readFileSync(join(process.cwd(), "app.json"), "utf8"));
const releaseVersion = packageJson.version;
const versionCode = String(appJson.expo.android.versionCode);
const releaseCandidateSha = "abcdef1234567890abcdef1234567890abcdef12";
const IOS_ARTIFACT_PATH = "release-evidence/ios-wkwebview-evidence.zip";
const IOS_ARTIFACT_CONTENT = "iOS WKWebView evidence bytes\n";

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const IOS_ARTIFACT_SHA256 = sha256Text(IOS_ARTIFACT_CONTENT);

function isIosArtifactEvidencePath(filePath) {
  return String(filePath).replace(/\\/g, "/").endsWith(IOS_ARTIFACT_PATH);
}

function validPreflight({ baseUrl = "https://gsav.example.com", rangeUrl = "https://gsav.example.com/test.gsav" } = {}) {
  return {
    baseUrl,
    checkedAt: "2026-06-30T00:00:00.000Z",
    nodeVersion: "v20.0.0",
    npmVersion: "10.0.0",
    diveoCommit: releaseCandidateSha.slice(0, 7),
    gsavHostingCommit: "def5678",
    hostIdentity: {
      url: `${baseUrl}/build.json`,
      status: 200,
      contentType: "application/json",
      expectedIdentity: "def5678",
      observedIdentity: "def5678",
      matched: true,
    },
    hostIdentityVerified: true,
    routes: [
      { name: "home direct web", url: `${baseUrl}/`, status: 200, hasAppRoot: true },
      { name: "explore native data saver", url: `${baseUrl}/explore?embed=native&dataSaver=1`, status: 200, hasAppRoot: true },
      { name: "native diagnostics", url: `${baseUrl}/native-diagnostics?embed=native`, status: 200, hasAppRoot: true },
      { name: "watch test", url: `${baseUrl}/watch/test?embed=native`, status: 200, hasAppRoot: true },
      { name: "watch test start time", url: `${baseUrl}/watch/test?t=2.5&embed=native`, status: 200, hasAppRoot: true },
      { name: "watch elly", url: `${baseUrl}/watch/elly?embed=native`, status: 200, hasAppRoot: true },
    ],
    rangeAsset: {
      url: rangeUrl,
      requestRange: "bytes=0-0",
      status: 206,
      acceptRanges: "bytes",
      contentRange: "bytes 0-0/100",
      contentLength: "1",
      etag: "\"abc123\"",
      accessControlAllowOrigin: "*",
      accessControlExposeHeaders: "Accept-Ranges, Content-Length, Content-Range, ETag",
      missingExposedHeaders: [],
    },
  };
}

function bridgeReady() {
  return [{ version: 1, minVersion: 1, commands: ["play"], events: ["GSAV_ROUTE_CHANGE"] }];
}

function validRuntimeSmoke({ baseUrl = "https://gsav.example.com" } = {}) {
  return {
    baseUrl,
    checkedAt: "2026-06-30T00:00:00.000Z",
    nodeVersion: "v20.0.0",
    npmVersion: "10.0.0",
    diveoCommit: releaseCandidateSha.slice(0, 7),
    gsavHostingCommit: "def5678",
    nativeBridgeVersion: 1,
    nativeBridgeMinVersion: 1,
    routes: [
      {
        name: "explore native data saver",
        url: `${baseUrl}/explore?embed=native&dataSaver=1`,
        state: { nativeEmbed: "true", shellNativeEmbed: "true", topNavCount: 0, miniPlayerCount: 0 },
        bridgeReady: bridgeReady(),
        bridgeTypes: ["GSAV_AUTH_READY", "GSAV_BRIDGE_READY", "GSAV_ROUTE_CHANGE"],
      },
      {
        name: "native diagnostics",
        url: `${baseUrl}/native-diagnostics?embed=native`,
        state: { nativeEmbed: "true", shellNativeEmbed: "true", topNavCount: 0, miniPlayerCount: 0 },
        bridgeReady: bridgeReady(),
        bridgeTypes: ["GSAV_AUTH_READY", "GSAV_BRIDGE_READY", "GSAV_ROUTE_CHANGE"],
      },
      {
        name: "watch test native embed",
        url: `${baseUrl}/watch/test?embed=native`,
        state: { nativeEmbed: "true", shellNativeEmbed: "true", topNavCount: 0, miniPlayerCount: 0, playbackObserved: true },
        bridgeReady: bridgeReady(),
        bridgeTypes: ["GSAV_AUTH_READY", "GSAV_BRIDGE_READY", "GSAV_ROUTE_CHANGE", "GSAV_PLAYBACK_STATE"],
      },
    ],
  };
}

function validValidationPrereqs({ apkPath, manifestPath, rangeUrl = "https://gsav.example.com/test.gsav" }) {
  return {
    checkedAt: "2026-06-30T00:00:00.000Z",
    ok: true,
    status: "pass",
    checked: {
      commands: {
        adb: true,
        java: true,
        npx: true,
        gh: true,
        emulator: false,
        xcrun: false,
      },
      env: {
        "production-gsav-web-url": {
          name: "EXPO_PUBLIC_GSAV_WEB_URL",
          present: true,
          value: "https://gsav.example.com",
        },
        "production-gsav-catalog-url": {
          name: "EXPO_PUBLIC_GSAV_CATALOG_URL",
          present: true,
          value: "https://gsav.example.com/functions/v1/catalog",
        },
        "production-supabase-url": {
          name: "EXPO_PUBLIC_GSAV_SUPABASE_URL",
          present: true,
          value: "https://supabase.example.com",
        },
        "production-range-probe-url": {
          name: "GSAV_RANGE_PROBE_URL",
          present: true,
          value: rangeUrl,
        },
        "production-host-identity-url": {
          name: "GSAV_HOST_IDENTITY_URL",
          present: true,
          value: "https://gsav.example.com/build.json",
        },
        "production-supabase-anon-key": {
          name: "EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY",
          present: true,
          value: "[redacted]",
        },
        "production-hosting-commit": {
          name: "GSAV_HOSTING_COMMIT",
          present: true,
          value: "def5678",
        },
        EXPO_PUBLIC_GSAV_QA_CONTROLS: null,
        EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: null,
      },
      paths: {
        apk: { path: apkPath, exists: true },
        manifest: { path: manifestPath, exists: true },
        androidProject: { path: "android", exists: true },
      },
      android: {
        connectedDevices: ["emulator-5554"],
        adbDevicesOk: true,
        deviceMetadata: [
          {
            serial: "emulator-5554",
            model: "Pixel 8",
            androidVersion: "15",
            apiLevel: "35",
            buildFingerprint: "google/shiba/shiba:15/AP3A.240905.015/1234567:user/release-keys",
            buildIncremental: "1234567",
            webViewPackageName: "com.google.android.webview",
            webViewVersion: "125.0.6422.147",
            webViewSource: "dumpsys webviewupdate",
            metadataOk: true,
            missing: [],
            errors: [],
          },
        ],
      },
      ios: {
        executorProof: {
          present: true,
          source: "IOS_VALIDATION_EXECUTOR_PROOF",
          value: "macOS 15.5 with Xcode 17 and xcrun simctl proof captured",
        },
        owner: {
          name: "IOS_VALIDATION_OWNER",
          present: true,
          value: "@ios-validator",
        },
        deviceIdentity: {
          name: "IOS_VALIDATION_DEVICE",
          present: true,
          value: "iPhone 15 simulator",
        },
        iosVersion: {
          name: "IOS_VALIDATION_VERSION",
          present: true,
          value: "iOS 18.5",
        },
        wkWebViewVersion: {
          name: "IOS_WKWEBVIEW_VERSION",
          present: true,
          value: "WKWebView 18.5",
        },
        artifactUrl: {
          name: "IOS_VALIDATION_ARTIFACT_URL",
          present: true,
          value: "https://github.com/opsiclear/diveo/actions/runs/123/artifacts/ios-wkwebview-evidence",
        },
        artifactSha256: {
          name: "IOS_VALIDATION_ARTIFACT_SHA256",
          present: true,
          value: IOS_ARTIFACT_SHA256,
        },
        artifactPath: {
          name: "IOS_VALIDATION_ARTIFACT_PATH",
          present: true,
          value: IOS_ARTIFACT_PATH,
          exists: true,
          insideRoot: true,
        },
        computedArtifactSha256: {
          present: true,
          value: IOS_ARTIFACT_SHA256,
        },
        artifactSha256Matches: true,
      },
      androidMetadataTools: {
        aapt: {
          command: "aapt",
          envName: "AAPT",
          label: "aapt dump badging",
          commandAvailable: true,
          envConfigured: false,
          envValue: null,
        },
        apkanalyzer: {
          command: "apkanalyzer",
          envName: "APKANALYZER",
          label: "apkanalyzer manifest print",
          commandAvailable: false,
          envConfigured: false,
          envValue: null,
        },
        bundletool: {
          command: "bundletool",
          envName: "BUNDLETOOL",
          label: "bundletool dump manifest",
          commandAvailable: false,
          envConfigured: false,
          envValue: null,
        },
      },
    },
    blockers: [],
    warnings: [],
  };
}

function createBundle({
  preflight = validPreflight(),
  runtimeSmoke = validRuntimeSmoke(),
  validationPrereqs,
  validationPrereqsMutator,
  appVersionCode = versionCode,
  gradleVersionCode = versionCode,
  apkVersionCode = versionCode,
  noPublishProofText,
  releaseCandidateText,
  signoffDiffText,
  env = {},
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "diveo-release-bundle-"));
  const evidenceDir = join(root, "release-evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const apkPath = join(root, "app-release.apk");
  const manifestPath = join(root, "AndroidManifest.xml");
  writeFileSync(join(root, IOS_ARTIFACT_PATH), IOS_ARTIFACT_CONTENT);
  writeFileSync(apkPath, "apk bytes");
  writeFileSync(manifestPath, "<manifest />");

  writeJson(join(evidenceDir, "native-production-config-before-bump.json"), { status: "pass" });
  writeJson(join(evidenceDir, "gsav-preflight.json"), preflight);
  writeJson(join(evidenceDir, "gsav-runtime-smoke.json"), runtimeSmoke);
  writeFileSync(join(evidenceDir, "version.txt"), `${releaseVersion}\n`);
  writeJson(join(evidenceDir, "native-production-config-after-bump.json"), { status: "pass" });
  writeFileSync(join(evidenceDir, "release-candidate.txt"), releaseCandidateText ?? [
    `releaseCandidateSha=${releaseCandidateSha}`,
    `appVersion=${releaseVersion}`,
    `packageVersion=${releaseVersion}`,
    `androidVersionCode=${versionCode}`,
    "",
  ].join("\n"));
  writeFileSync(join(evidenceDir, "signoff-diff-files.txt"), signoffDiffText ?? [
    `payloadCandidateRef=${releaseCandidateSha}`,
    `payloadCandidateSha=${releaseCandidateSha}`,
    `evidenceSignoffSha=${releaseCandidateSha}`,
    "",
  ].join("\n"));
  writeJson(join(evidenceDir, "app-version-metadata.json"), {
    version: releaseVersion,
    androidVersionCode: Number(appVersionCode),
  });
  writeFileSync(join(evidenceDir, "gradle-version-code.txt"), `88:        versionCode ${gradleVersionCode}\n`);
  writeJson(join(evidenceDir, "release-artifact.json"), {
    status: "pass",
    checksums: {
      apkSha256: sha256File(apkPath),
      manifestSha256: sha256File(manifestPath),
    },
    checked: {
      requiredBundleValues: {
        EXPO_PUBLIC_GSAV_WEB_URL: "present",
        EXPO_PUBLIC_GSAV_CATALOG_URL: "present",
        EXPO_PUBLIC_GSAV_SUPABASE_URL: "present",
        EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: "present",
      },
      requiredUrls: {
        EXPO_PUBLIC_GSAV_WEB_URL: "present",
        EXPO_PUBLIC_GSAV_CATALOG_URL: "present",
        EXPO_PUBLIC_GSAV_SUPABASE_URL: "present",
      },
      forbiddenBundleMatches: [],
      androidUsesCleartextTraffic: false,
      androidDebuggable: false,
    },
  });
  writeFileSync(join(evidenceDir, "apk-version-metadata.txt"), [
    "status: pass",
    "source: aapt dump badging",
    `versionCode: ${apkVersionCode}`,
    "output:",
    `package: name='diveo' versionCode='${apkVersionCode}'`,
    "",
  ].join("\n"));
  const resolvedValidationPrereqs = validationPrereqs === undefined
    ? validValidationPrereqs({ apkPath, manifestPath, rangeUrl: preflight.rangeAsset.url })
    : validationPrereqs;
  if (resolvedValidationPrereqs !== null && validationPrereqsMutator) {
    validationPrereqsMutator(resolvedValidationPrereqs);
  }
  if (resolvedValidationPrereqs !== null) {
    writeJson(join(evidenceDir, "validation-prereqs.json"), resolvedValidationPrereqs);
  }
  const resolvedNoPublishProofText = noPublishProofText === undefined ? [
    "mode=dry-run",
    "publishRelease=false",
    `releaseCandidateSha=${releaseCandidateSha}`,
    `workflowSha=${env.GITHUB_SHA ?? releaseCandidateSha}`,
    "git status --short:",
    "?? release-evidence/",
    `git rev-parse HEAD: ${env.GITHUB_SHA ?? releaseCandidateSha}`,
    `remote ref HEAD: ${env.GITHUB_SHA ?? releaseCandidateSha}`,
    `gh release view v${releaseVersion}:`,
    "githubReleaseLookup=not_found",
    "githubReleasePresent=false",
    "",
  ].join("\n") : noPublishProofText;
  if (resolvedNoPublishProofText !== null) {
    writeFileSync(join(evidenceDir, "no-publish-side-effect.txt"), resolvedNoPublishProofText);
  }

  const summaryResult = writeReleaseEvidenceSummary({
    evidenceDir,
    apkPath,
    manifestPath,
    artifactName: `diveo-release-evidence-v${releaseVersion}`,
    releaseVersion,
    env: {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      PUBLISH_RELEASE: "false",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "opsiclear/diveo",
      GITHUB_RUN_ID: "123456789",
      GITHUB_SHA: "abcdef1234567890abcdef1234567890abcdef12",
      RELEASE_CANDIDATE_SHA: releaseCandidateSha,
      GSAV_RANGE_PROBE_URL: preflight.rangeAsset.url,
      ...env,
    },
  });
  if (resolvedValidationPrereqs !== null) {
    const summaryPath = summaryResult.summaryPath;
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.validationPrereqsPath = relative(process.cwd(), join(evidenceDir, "validation-prereqs.json")).replace(/\\/g, "/");
    summary.validationPrereqsAttachedAt = "2026-06-30T00:00:00.000Z";
    writeJson(summaryPath, summary);
  }

  return { root, evidenceDir, apkPath, manifestPath };
}

describe("release evidence bundle verifier", () => {
  it("accepts evidence URLs from the active Diveo repository", () => {
    expect(trustedGithubEvidenceUrl("https://github.com/OpsiClear-Web/diveo/actions/runs/123/artifacts/ios")).toBe(true);
    expect(trustedGithubEvidenceUrl("https://github.com/opsiclear/diveo/releases/download/v1.0.19/ios-wkwebview-evidence.zip")).toBe(true);
    expect(trustedGithubEvidenceUrl("https://github.com/OpsiClear-Web/diveo/blob/master/docs/qa-evidence/2026-07-01/ios.log")).toBe(true);
    expect(trustedGithubEvidenceUrl("https://github.com/OpsiClear-Web/diveo/actions/runs/123")).toBe(false);
    expect(trustedGithubEvidenceUrl("https://github.com/opsiclear/diveo/releases/tag/v1.0.19")).toBe(false);
    expect(trustedGithubEvidenceUrl("https://github.com/other/repo/actions/runs/123/artifacts/ios")).toBe(false);
  });

  it("accepts exact run URLs from trusted Diveo repositories", () => {
    expect(trustedGithubRunUrl("https://github.com/OpsiClear-Web/diveo/actions/runs/123")).toBe(true);
    expect(trustedGithubRunUrl("https://github.com/opsiclear/diveo/actions/runs/123")).toBe(true);
    expect(trustedGithubRunUrl("https://github.com/opsiclear/gsav-hosting/actions/runs/123")).toBe(false);
    expect(trustedGithubRunUrl("https://github.com/other/repo/actions/runs/123")).toBe(false);
    expect(trustedGithubRunUrl("https://github.com/opsiclear/diveo/actions/runs/123/artifacts/ios")).toBe(false);
    expect(trustedGithubRunUrl("https://github.com/opsiclear/diveo/actions/runs/123/attempts/1")).toBe(false);
    expect(trustedGithubRunUrl("https://github.com/opsiclear/diveo/actions/runs/123/")).toBe(false);
    expect(trustedGithubRunUrl("https://github.com/opsiclear/diveo/actions/runs/not-a-run")).toBe(false);
    expect(trustedGithubRunUrl("https://github.com/opsiclear/diveo/actions/runs/123?check_suite_focus=true")).toBe(false);
    expect(trustedGithubRunUrl("https://github.com/opsiclear/diveo/actions/runs/123#summary")).toBe(false);
    expect(trustedGithubRunUrl("https://token@github.com/opsiclear/diveo/actions/runs/123")).toBe(false);
    expect(trustedGithubRunUrl("http://github.com/opsiclear/diveo/actions/runs/123")).toBe(false);
  });

  it("parses CLI flags", () => {
    expect(parseArgs([
      "--root", "downloaded-release",
      "--evidence-dir", "release-evidence",
      "--apk-path", "app.apk",
      "--manifest-path", "AndroidManifest.xml",
      "--mode", "publish",
      "--require-validation-prereqs", "true",
    ])).toEqual({
      root: "downloaded-release",
      evidenceDir: "release-evidence",
      apkPath: "app.apk",
      manifestPath: "AndroidManifest.xml",
      mode: "publish",
      requireValidationPrereqs: "true",
    });
    expect(() => parseArgs(["--require-validation-prereq", "true"]))
      .toThrow("Unknown option: --require-validation-prereq");
    expect(() => parseArgs(["--require-validation-prereqs"])).toThrow("Missing value");
    expect(normalizeMode("dry-run")).toBe("dry-run");
    expect(normalizeMode("publish")).toBe("publish");
    expect(() => normalizeMode("staging")).toThrow("Invalid release evidence mode");
    expect(normalizeBooleanOption("required", "test")).toBe(true);
    expect(normalizeBooleanOption("optional", "test")).toBe(false);
    expect(() => normalizeBooleanOption("maybe", "test")).toThrow("Invalid test");
  });

  it("parses signoff diff fields and changed files", () => {
    expect(parseSignoffDiffText([
      "payloadCandidateRef=release/1.0.19",
      `payloadCandidateSha=${releaseCandidateSha}`,
      "evidenceSignoffSha=1234567890abcdef1234567890abcdef12345678",
      "docs/GSAV_NATIVE_QA.md",
      "docs/qa-evidence/2026-06-30/android-watch.txt",
      "",
    ].join("\n"))).toEqual({
      fields: {
        payloadCandidateRef: "release/1.0.19",
        payloadCandidateSha: releaseCandidateSha,
        evidenceSignoffSha: "1234567890abcdef1234567890abcdef12345678",
      },
      files: [
        "docs/GSAV_NATIVE_QA.md",
        "docs/qa-evidence/2026-06-30/android-watch.txt",
      ],
    });
  });

  it("accepts a complete production release evidence bundle", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.checked.releaseVersion).toBe(releaseVersion);
    expect(existsSync(join(evidenceDir, "evidence-checksums.txt"))).toBe(true);
  });

  it("rejects release summaries with untrusted GitHub Actions run URLs", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.runUrl = "https://github.com/other/repo/actions/runs/123456789";
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("dry-run-summary.json must include a trusted Diveo GitHub Actions runUrl.");
  });

  it("rejects release summaries that use artifact URLs as run URLs", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.runUrl = "https://github.com/opsiclear/diveo/actions/runs/123456789/artifacts/release-evidence";
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("dry-run-summary.json must include a trusted Diveo GitHub Actions runUrl.");
  });

  it("rejects release summaries with non-exact trusted run URLs", () => {
    for (const runUrl of [
      "https://github.com/opsiclear/diveo/actions/runs/123456789/attempts/1",
      "https://github.com/opsiclear/diveo/actions/runs/123456789?check_suite_focus=true",
    ]) {
      const { evidenceDir, apkPath, manifestPath } = createBundle();
      const summaryPath = join(evidenceDir, "dry-run-summary.json");
      const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      summary.runUrl = runUrl;
      writeJson(summaryPath, summary);

      const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain("dry-run-summary.json must include a trusted Diveo GitHub Actions runUrl.");
    }
  });

  it("rejects release summaries without GSAV package provenance", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    delete summary.gsavPackageProvenance;
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("dry-run-summary.json must include gsavPackageProvenance.");
  });

  it("rejects release summaries without GSAV package provenance hash", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    delete summary.gsavPackageProvenanceSha256;
    summary.publishArtifactIdentitySha256 = verifierSha256Text(publishArtifactIdentityText(summary));
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("dry-run-summary.json must include gsavPackageProvenanceSha256.");
  });

  it("rejects release summaries with corrupt GSAV package provenance hash", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.gsavPackageProvenanceSha256 = "not-a-sha";
    summary.publishArtifactIdentitySha256 = verifierSha256Text(publishArtifactIdentityText(summary));
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("dry-run-summary.json gsavPackageProvenanceSha256 must be a 64-hex SHA256.");
  });

  it("rejects release summaries with tampered GSAV package provenance", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const bridgeEntry = summary.gsavPackageProvenance.find((entry) => entry.packageName === "@opsiclear/gsav-bridge");
    bridgeEntry.tarballSha256 = "0".repeat(64);
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "dry-run-summary.json gsavPackageProvenance @opsiclear/gsav-bridge tarballSha256 must match vendor/opsiclear-gsav-bridge-0.1.0.tgz.",
    );
    expect(result.errors).toContain("dry-run-summary.json gsavPackageProvenanceSha256 does not match gsavPackageProvenance.");
  });

  it("rejects release summaries with package specifier drift", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const clientEntry = summary.gsavPackageProvenance.find((entry) => entry.packageName === "@opsiclear/gsav-client");
    clientEntry.specifier = "file:vendor/opsiclear-gsav-client-0.1.0.tgz";
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "dry-run-summary.json gsavPackageProvenance @opsiclear/gsav-client specifier must match package.json.",
      "dry-run-summary.json gsavPackageProvenance @opsiclear/gsav-client tarballPath must match its file: specifier.",
    ]));
  });

  it("rejects downloaded evidence-only provenance tampering when vendor tarballs are unavailable", () => {
    const sourceSummary = JSON.parse(readFileSync(join(createBundle().evidenceDir, "dry-run-summary.json"), "utf8"));
    const summary = {
      gsavPackageProvenance: sourceSummary.gsavPackageProvenance.map((entry) => ({ ...entry })),
      gsavPackageProvenanceSha256: sourceSummary.gsavPackageProvenanceSha256,
    };
    const bridgeEntry = summary.gsavPackageProvenance.find((entry) => entry.packageName === "@opsiclear/gsav-bridge");
    bridgeEntry.tarballSha256 = "1".repeat(64);
    const errors = [];

    validateGsavPackageProvenance(summary, errors, { root: mkdtempSync(join(tmpdir(), "diveo-downloaded-evidence-")) });

    expect(errors).toContain("dry-run-summary.json gsavPackageProvenanceSha256 does not match gsavPackageProvenance.");
    expect(errors).not.toEqual(expect.arrayContaining([
      expect.stringContaining("tarballSha256 must match vendor/"),
    ]));
  });

  it("accepts headless release evidence without device validation prerequisites by default", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({ validationPrereqs: null });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("requires validation prerequisites when the device-validation gate is enabled", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({ validationPrereqs: null });

    const result = verifyReleaseEvidenceBundle({
      evidenceDir,
      apkPath,
      manifestPath,
      requireValidationPrereqs: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("validation-prereqs.json is missing"),
    ]));
  });

  it("accepts QA/audit/evidence-only signoff diffs", () => {
    const signoffSha = "1234567890abcdef1234567890abcdef12345678";
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      env: {
        GITHUB_SHA: signoffSha,
      },
      signoffDiffText: [
        "payloadCandidateRef=release/1.0.19",
        `payloadCandidateSha=${releaseCandidateSha}`,
        `evidenceSignoffSha=${signoffSha}`,
        "docs/GSAV_NATIVE_QA.md",
        "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
        "docs/qa-evidence/2026-06-30/android-watch.txt",
        "",
      ].join("\n"),
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects signoff diff files without payload or signoff identity", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      signoffDiffText: "",
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "signoff-diff-files.txt must include payloadCandidateRef.",
      "signoff-diff-files.txt must include payloadCandidateSha.",
      "signoff-diff-files.txt must include evidenceSignoffSha.",
    ]));
  });

  it("rejects signoff diff payload or signoff SHA drift", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      signoffDiffText: [
        "payloadCandidateRef=release/1.0.19",
        "payloadCandidateSha=deadbeef1234567890abcdef1234567890abcdef",
        "evidenceSignoffSha=1234567890abcdef1234567890abcdef12345678",
        "",
      ].join("\n"),
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "signoff-diff-files.txt payloadCandidateSha must match releaseCandidateSha.",
      "signoff-diff-files.txt evidenceSignoffSha must match dry-run-summary.json workflowSha.",
    ]));
  });

  it("rejects too-short commit prefixes in candidate identity evidence", () => {
    const preflight = validPreflight();
    preflight.diveoCommit = "a";
    const runtimeSmoke = validRuntimeSmoke();
    runtimeSmoke.diveoCommit = "a";
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      preflight,
      runtimeSmoke,
      signoffDiffText: [
        "payloadCandidateRef=release/1.0.19",
        "payloadCandidateSha=a",
        "evidenceSignoffSha=a",
        "",
      ].join("\n"),
      noPublishProofText: [
        "mode=dry-run",
        "publishRelease=false",
        `releaseCandidateSha=${releaseCandidateSha}`,
        `workflowSha=${releaseCandidateSha}`,
        "git status --short:",
        "?? release-evidence/",
        "git rev-parse HEAD: a",
        "remote ref HEAD: a",
        `gh release view v${releaseVersion}:`,
        "githubReleaseLookup=not_found",
        "githubReleasePresent=false",
        "",
      ].join("\n"),
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "gsav-preflight.json diveoCommit must match releaseCandidateSha.",
      "gsav-runtime-smoke.json diveoCommit must match releaseCandidateSha.",
      "signoff-diff-files.txt payloadCandidateSha must match releaseCandidateSha.",
      "signoff-diff-files.txt evidenceSignoffSha must match dry-run-summary.json workflowSha.",
      "no-publish-side-effect.txt git rev-parse HEAD must match dry-run-summary.json workflowSha.",
      "no-publish-side-effect.txt remote ref HEAD must match dry-run-summary.json workflowSha.",
    ]));
  });

  it("rejects signoff diffs that include source, workflow, or package changes", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      signoffDiffText: [
        `payloadCandidateRef=${releaseCandidateSha}`,
        `payloadCandidateSha=${releaseCandidateSha}`,
        `evidenceSignoffSha=${releaseCandidateSha}`,
        "docs/GSAV_NATIVE_QA.md",
        "features/player/GsavWebView.tsx",
        "package.json",
        "",
      ].join("\n"),
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "signoff-diff-files.txt may only list QA/audit/evidence files after payload capture: features/player/GsavWebView.tsx, package.json",
    );
  });

  it("rejects preflight evidence that omits the exact range request", () => {
    const preflight = validPreflight();
    delete preflight.rangeAsset.requestRange;
    const { evidenceDir, apkPath, manifestPath } = createBundle({ preflight });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("gsav-preflight.json rangeAsset.requestRange must be bytes=0-0.");
  });

  it("rejects preflight evidence that omits required native route coverage", () => {
    const preflight = validPreflight();
    preflight.routes = preflight.routes.filter((route) => !route.url.includes("/watch/elly?embed=native"));
    const { evidenceDir, apkPath, manifestPath } = createBundle({ preflight });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("gsav-preflight.json is missing route URL containing /watch/elly?embed=native.");
  });

  it("rejects preflight evidence without verified host identity metadata", () => {
    const preflight = validPreflight();
    delete preflight.hostIdentity;
    preflight.hostIdentityVerified = false;
    const { evidenceDir, apkPath, manifestPath } = createBundle({ preflight });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "gsav-preflight.json hostIdentityVerified must be true.",
      "gsav-preflight.json must include hostIdentity metadata.",
    ]));
  });

  it("rejects preflight evidence with mismatched host identity metadata", () => {
    const preflight = validPreflight();
    preflight.hostIdentity.observedIdentity = "abc1234";
    preflight.hostIdentity.matched = false;
    preflight.hostIdentityVerified = false;
    const { evidenceDir, apkPath, manifestPath } = createBundle({ preflight });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "gsav-preflight.json hostIdentityVerified must be true.",
      "gsav-preflight.json hostIdentity.matched must be true.",
      "gsav-preflight.json hostIdentity.observedIdentity must match expectedIdentity.",
      "gsav-preflight.json hostIdentity.observedIdentity must match gsavHostingCommit.",
    ]));
  });

  it("rejects preflight evidence with too-short host identity prefixes", () => {
    const preflight = validPreflight();
    preflight.gsavHostingCommit = "def567890abcdef";
    preflight.hostIdentity.expectedIdentity = "def567890abcdef";
    preflight.hostIdentity.observedIdentity = "d";
    const { evidenceDir, apkPath, manifestPath } = createBundle({ preflight });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "gsav-preflight.json hostIdentity.observedIdentity must match expectedIdentity.",
      "gsav-preflight.json hostIdentity.observedIdentity must match gsavHostingCommit.",
    ]));
  });

  it("rejects missing required evidence files", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    rmSync(join(evidenceDir, "gsav-runtime-smoke.json"));

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("gsav-runtime-smoke.json is missing"),
    ]));
  });

  it("requires exact release-evidence files in the checksum manifest and summary", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const otherDir = join(evidenceDir, "..", "other");
    mkdirSync(otherDir, { recursive: true });
    const otherCandidatePath = join(otherDir, "release-candidate.txt");
    writeFileSync(otherCandidatePath, "same basename outside release-evidence\n");

    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.releaseEvidenceFiles = summary.releaseEvidenceFiles
      .filter((item) => !item.path.endsWith("release-evidence/release-candidate.txt"));
    summary.releaseEvidenceFiles.push({
      path: relative(process.cwd(), otherCandidatePath).replace(/\\/g, "/"),
      sha256: sha256File(otherCandidatePath),
    });
    const checksumText = [
      ...summary.releaseEvidenceFiles.map((item) => `${item.sha256}  ${item.path}`),
      `${summary.apkSha256}  ${summary.apkPath}`,
      `${summary.manifestSha256}  ${summary.manifestPath}`,
    ].join("\n") + "\n";
    summary.evidenceBundleSha256 = sha256Text(checksumText);
    summary.evidenceChecksumManifestSha256 = summary.evidenceBundleSha256;
    writeJson(summaryPath, summary);
    writeFileSync(join(evidenceDir, "evidence-checksums.txt"), checksumText);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "evidence-checksums.txt is missing required evidence file release-candidate.txt.",
      "dry-run-summary.json releaseEvidenceFiles is missing required evidence file release-candidate.txt.",
    ]));
  });

  it("requires APK and manifest entries in the checksum manifest", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const checksumPath = join(evidenceDir, "evidence-checksums.txt");
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const checksumText = readFileSync(checksumPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.endsWith(`  ${apkPath.replace(/\\/g, "/")}`) && !line.endsWith(`  ${manifestPath.replace(/\\/g, "/")}`))
      .join("\n") + "\n";
    summary.evidenceBundleSha256 = sha256Text(checksumText);
    summary.evidenceChecksumManifestSha256 = summary.evidenceBundleSha256;
    writeJson(summaryPath, summary);
    writeFileSync(checksumPath, checksumText);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "evidence-checksums.txt is missing APK file entry.",
      "evidence-checksums.txt is missing merged manifest file entry.",
    ]));
  });

  it("rejects weak validation prerequisite evidence when present", () => {
    const weakPrereqs = validValidationPrereqs({
      apkPath: "wrong.apk",
      manifestPath: "wrong-manifest.xml",
    });
    weakPrereqs.ok = false;
    weakPrereqs.status = "fail";
    weakPrereqs.blockers = [{ id: "android-connected-device" }];
    weakPrereqs.checked.commands.gh = false;
    weakPrereqs.checked.android.connectedDevices = [];
    weakPrereqs.checked.android.deviceMetadata = [];
    weakPrereqs.checked.androidMetadataTools.aapt.commandAvailable = false;
    weakPrereqs.checked.env["production-range-probe-url"].value = "http://127.0.0.1/test.bin";
    weakPrereqs.checked.env["production-supabase-anon-key"].value = "public-anon-key";
    weakPrereqs.checked.env["production-hosting-commit"].value = "placeholder";
    weakPrereqs.checked.env.EXPO_PUBLIC_GSAV_QA_CONTROLS = "1";
    weakPrereqs.checked.paths.apk.exists = false;
    weakPrereqs.checked.ios.executorProof.present = false;
    weakPrereqs.checked.ios.executorProof.value = null;
    weakPrereqs.checked.ios.owner.value = "owner";
    weakPrereqs.checked.ios.deviceIdentity.present = false;
    weakPrereqs.checked.ios.iosVersion.value = "todo";
    weakPrereqs.checked.ios.wkWebViewVersion.value = "unknown";
    weakPrereqs.checked.ios.artifactUrl.value = "https://github.com/other/repo/actions/runs/123/artifacts/ios";
    weakPrereqs.checked.ios.artifactSha256.value = "not-a-sha";
    weakPrereqs.checked.ios.artifactPath.exists = false;
    weakPrereqs.checked.ios.computedArtifactSha256.value = "not-a-sha";
    weakPrereqs.checked.ios.artifactSha256Matches = false;
    const { evidenceDir, apkPath, manifestPath } = createBundle({ validationPrereqs: weakPrereqs });

    const result = verifyReleaseEvidenceBundle({
      evidenceDir,
      apkPath,
      manifestPath,
      requireValidationPrereqs: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "validation-prereqs.json must have ok=true and status=pass.",
      "validation-prereqs.json must have no blockers.",
      "validation-prereqs.json checked.commands.gh must be true.",
      "validation-prereqs.json must include at least one connected Android device.",
      "validation-prereqs.json must include Android device metadata with model, OS/API, build, and WebView package/version.",
      "validation-prereqs.json must include aapt, apkanalyzer, or bundletool availability.",
      "validation-prereqs.json must include iOS executor proof with macOS/Xcode/xcrun or physical-device evidence.",
      "validation-prereqs.json must include concrete iOS validation owner.",
      "validation-prereqs.json must include iOS simulator/device identity.",
      "validation-prereqs.json must include concrete iOS version.",
      "validation-prereqs.json must include WKWebView/WebKit version.",
      "validation-prereqs.json must include a trusted iOS validation artifact URL.",
      "validation-prereqs.json must include 64-hex iOS validation artifact SHA256.",
      "validation-prereqs.json must include an existing iOS validation artifact path.",
      "validation-prereqs.json must include computed iOS validation artifact SHA256.",
      "validation-prereqs.json computed iOS artifact SHA256 must match the declared checksum.",
      "validation-prereqs.json production range probe URL must use https.",
      "validation-prereqs.json production range probe URL must not use localhost, emulator, link-local, or private LAN hosts.",
      "validation-prereqs.json production range probe URL must point at a .gsav asset.",
      "validation-prereqs.json production Supabase anon key must be present and redacted.",
      "validation-prereqs.json production GSAV host/build identity must be concrete.",
      "validation-prereqs.json EXPO_PUBLIC_GSAV_QA_CONTROLS must be unset or 0.",
      "validation-prereqs.json APK path must exist.",
      "validation-prereqs.json merged manifest path must match the verified release artifact path.",
    ]));
  });

  it("rejects validation prerequisite artifact URLs that are only context pages", () => {
    for (const artifactUrl of [
      "https://github.com/OpsiClear-Web/diveo/actions/runs/123",
      "https://github.com/opsiclear/diveo/releases/tag/v1.0.19",
    ]) {
      const { root, evidenceDir, apkPath, manifestPath } = createBundle({
        validationPrereqsMutator(prereqs) {
          prereqs.checked.ios.artifactUrl.value = artifactUrl;
        },
      });
      const result = verifyReleaseEvidenceBundle({
        evidenceDir,
        apkPath,
        manifestPath,
        requireValidationPrereqs: true,
      });
      rmSync(root, { recursive: true, force: true });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain("validation-prereqs.json must include a trusted iOS validation artifact URL.");
    }
  });

  it("requires strict validation prerequisite attachment metadata", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    delete summary.validationPrereqsPath;
    summary.validationPrereqsAttachedAt = "not-a-date";
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({
      evidenceDir,
      apkPath,
      manifestPath,
      requireValidationPrereqs: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "dry-run-summary.json validationPrereqsPath must point to the attached release-evidence/validation-prereqs.json.",
      "dry-run-summary.json validationPrereqsAttachedAt must be an ISO timestamp from release-evidence:attach-validation-prereqs.",
    ]));
  });

  it("requires strict validation prerequisite replay to include the iOS artifact in bundle checksums", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const checksumPath = join(evidenceDir, "evidence-checksums.txt");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.releaseEvidenceFiles = summary.releaseEvidenceFiles.filter((item) => !isIosArtifactEvidencePath(item.path));
    const checksumText = [
      ...summary.releaseEvidenceFiles.map((item) => `${item.sha256}  ${item.path}`),
      `${summary.apkSha256}  ${summary.apkPath}`,
      `${summary.manifestSha256}  ${summary.manifestPath}`,
    ].join("\n") + "\n";
    summary.evidenceBundleSha256 = sha256Text(checksumText);
    summary.evidenceChecksumManifestSha256 = summary.evidenceBundleSha256;
    writeJson(summaryPath, summary);
    writeFileSync(checksumPath, checksumText);

    const result = verifyReleaseEvidenceBundle({
      evidenceDir,
      apkPath,
      manifestPath,
      requireValidationPrereqs: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "dry-run-summary.json releaseEvidenceFiles must include the iOS validation artifact path.",
      "evidence-checksums.txt must include the iOS validation artifact path.",
    ]));
  });

  it("recomputes strict validation prerequisite iOS artifact bytes during bundle replay", () => {
    const wrongSha = "f".repeat(64);
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      validationPrereqsMutator(prereqs) {
        prereqs.checked.ios.artifactSha256.value = wrongSha;
        prereqs.checked.ios.computedArtifactSha256.value = wrongSha;
      },
    });

    const result = verifyReleaseEvidenceBundle({
      evidenceDir,
      apkPath,
      manifestPath,
      requireValidationPrereqs: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "validation-prereqs.json computed iOS artifact SHA256 must match the current artifact bytes.",
      "validation-prereqs.json declared iOS artifact SHA256 must match the current artifact bytes.",
    ]));
  });

  it("rejects strict validation prerequisite iOS artifacts outside release evidence uploads", () => {
    const outsideArtifactPath = "ios-wkwebview-evidence.zip";
    const { root, evidenceDir, apkPath, manifestPath } = createBundle();
    const outsideAbsolutePath = join(root, outsideArtifactPath);
    writeFileSync(outsideAbsolutePath, IOS_ARTIFACT_CONTENT);

    const validationPrereqsPath = join(evidenceDir, "validation-prereqs.json");
    const validationPrereqs = JSON.parse(readFileSync(validationPrereqsPath, "utf8"));
    validationPrereqs.checked.ios.artifactPath.value = outsideArtifactPath;
    validationPrereqs.checked.ios.artifactPath.exists = true;
    validationPrereqs.checked.ios.artifactSha256.value = IOS_ARTIFACT_SHA256;
    validationPrereqs.checked.ios.computedArtifactSha256.value = IOS_ARTIFACT_SHA256;
    validationPrereqs.checked.ios.artifactSha256Matches = true;
    writeJson(validationPrereqsPath, validationPrereqs);

    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const validationPrereqsEntry = summary.releaseEvidenceFiles.find((item) => (
      String(item.path || "").replace(/\\/g, "/").endsWith("release-evidence/validation-prereqs.json")
    ));
    validationPrereqsEntry.sha256 = sha256File(validationPrereqsPath);
    summary.releaseEvidenceFiles.push({
      path: outsideAbsolutePath.replace(/\\/g, "/"),
      sha256: IOS_ARTIFACT_SHA256,
    });
    const checksumText = [
      ...summary.releaseEvidenceFiles.map((item) => `${item.sha256}  ${item.path}`),
      `${summary.apkSha256}  ${summary.apkPath}`,
      `${summary.manifestSha256}  ${summary.manifestPath}`,
    ].join("\n") + "\n";
    summary.evidenceBundleSha256 = sha256Text(checksumText);
    summary.evidenceChecksumManifestSha256 = summary.evidenceBundleSha256;
    writeJson(summaryPath, summary);
    writeFileSync(join(evidenceDir, "evidence-checksums.txt"), checksumText);

    const result = verifyReleaseEvidenceBundle({
      evidenceDir,
      apkPath,
      manifestPath,
      requireValidationPrereqs: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "validation-prereqs.json iOS validation artifact path must stay inside the release evidence directory.",
    );
  });

  it("rejects checksum mismatches", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    writeFileSync(join(evidenceDir, "gsav-preflight.json"), `${JSON.stringify(validPreflight())}\nmutated\n`);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("checksum mismatch"),
    ]));
  });

  it("rejects dry-run summaries without no-publish proof", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.noPublishSideEffectExpected = false;
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "dry-run-summary.json must prove no publish side effect for dry-run evidence.",
    );
  });

  it("rejects dry-run bundles without post-run no-publish side-effect proof", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({ noPublishProofText: null });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("no-publish-side-effect.txt is missing"),
    ]));
  });

  it("rejects dry-run bundles when a GitHub release is present", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      noPublishProofText: [
        "mode=dry-run",
        "publishRelease=false",
        `releaseCandidateSha=${releaseCandidateSha}`,
        `workflowSha=${releaseCandidateSha}`,
        "git status --short:",
        "git rev-parse HEAD:",
        "remote ref HEAD:",
        `gh release view v${releaseVersion}:`,
        "githubReleaseLookup=found",
        "githubReleasePresent=true",
        "",
      ].join("\n"),
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("no-publish-side-effect.txt must include githubReleasePresent=false.");
  });

  it("rejects dry-run no-publish proof with non-evidence git status changes", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      noPublishProofText: [
        "mode=dry-run",
        "publishRelease=false",
        `releaseCandidateSha=${releaseCandidateSha}`,
        `workflowSha=${releaseCandidateSha}`,
        "git status --short:",
        " M package.json",
        "?? release-evidence/",
        `git rev-parse HEAD: ${releaseCandidateSha}`,
        `remote ref HEAD: ${releaseCandidateSha}`,
        `gh release view v${releaseVersion}:`,
        "githubReleaseLookup=not_found",
        "githubReleasePresent=false",
        "",
      ].join("\n"),
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "no-publish-side-effect.txt git status must only show generated release-evidence outputs.",
    );
  });

  it("rejects dry-run no-publish proof with stale local or remote refs", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      noPublishProofText: [
        "mode=dry-run",
        "publishRelease=false",
        `releaseCandidateSha=${releaseCandidateSha}`,
        `workflowSha=${releaseCandidateSha}`,
        "git status --short:",
        "?? release-evidence/",
        "git rev-parse HEAD: deadbeef1234567890abcdef1234567890abcdef",
        "remote ref HEAD: feedface1234567890abcdef1234567890abcdef",
        `gh release view v${releaseVersion}:`,
        "githubReleaseLookup=not_found",
        "githubReleasePresent=false",
        "",
      ].join("\n"),
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "no-publish-side-effect.txt git rev-parse HEAD must match dry-run-summary.json workflowSha.",
      "no-publish-side-effect.txt remote ref HEAD must match dry-run-summary.json workflowSha.",
    ]));
  });

  it("rejects dry-run no-publish proof when release lookup is inconclusive", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      noPublishProofText: [
        "mode=dry-run",
        "publishRelease=false",
        `releaseCandidateSha=${releaseCandidateSha}`,
        `workflowSha=${releaseCandidateSha}`,
        "git status --short:",
        "?? release-evidence/",
        `git rev-parse HEAD: ${releaseCandidateSha}`,
        `remote ref HEAD: ${releaseCandidateSha}`,
        `gh release view v${releaseVersion}:`,
        "HTTP 401 Bad credentials",
        "githubReleaseLookup=inconclusive",
        "githubReleasePresent=false",
        "",
      ].join("\n"),
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "no-publish-side-effect.txt must include githubReleaseLookup=not_found.",
    );
    expect(result.errors).toContain(
      "no-publish-side-effect.txt gh release view must prove an authenticated not-found result.",
    );
  });

  it("accepts push-triggered dry-run release evidence with no-publish proof", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      env: {
        GITHUB_EVENT_NAME: "push",
        PUBLISH_RELEASE: "false",
      },
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects release evidence with publish intent in dry-run mode", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.workflowDispatch = false;
    summary.publishRelease = true;
    summary.noPublishSideEffectExpected = false;
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "dry-run-summary.json must record publishRelease=false for dry-run evidence.",
    ]));
  });

  it("rejects dry-run summaries from unsupported workflow events", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      env: {
        GITHUB_EVENT_NAME: "schedule",
      },
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "dry-run-summary.json eventName must be workflow_dispatch or push for dry-run evidence.",
    );
  });

  it("requires the release evidence artifact name to match the release version", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.artifactName = `custom-release-evidence-v${releaseVersion}`;
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "dry-run-summary.json artifactName must match diveo-release-evidence-v<releaseVersion>.",
    );
  });

  it("accepts publish evidence when publish mode is explicit", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      env: {
        GITHUB_EVENT_NAME: "push",
        PUBLISH_RELEASE: "true",
      },
    });

    const result = verifyReleaseEvidenceBundle({
      evidenceDir,
      apkPath,
      manifestPath,
      mode: "publish",
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.checked.mode).toBe("publish");
  });

  it("rejects non-publishing evidence in publish mode", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();

    const result = verifyReleaseEvidenceBundle({
      evidenceDir,
      apkPath,
      manifestPath,
      mode: "publish",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "dry-run-summary.json must record publishRelease=true for publish evidence.",
      "dry-run-summary.json must not expect no publish side effect for publish evidence.",
    ]));
  });

  it("rejects local or private preflight and runtime URLs", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      preflight: validPreflight({
        baseUrl: "https://gsav.example.com",
        rangeUrl: "http://127.0.0.1:5191/test.gsav",
      }),
      runtimeSmoke: validRuntimeSmoke({ baseUrl: "http://10.0.2.2:5191" }),
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "dry-run-summary.json rangeProbeUrl must use https.",
      "dry-run-summary.json rangeProbeUrl must not use localhost, emulator, link-local, or private LAN hosts.",
    ]));
  });

  it("rejects preflight and runtime evidence from a different diveo commit", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      preflight: {
        ...validPreflight(),
        diveoCommit: "deadbee",
      },
      runtimeSmoke: {
        ...validRuntimeSmoke(),
        diveoCommit: "deadbee",
      },
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "gsav-preflight.json diveoCommit must match releaseCandidateSha.",
      "gsav-runtime-smoke.json diveoCommit must match releaseCandidateSha.",
    ]));
  });

  it("requires preflight range evidence to be exactly bytes 0-0/<size>", () => {
    const wildcard = validPreflight();
    wildcard.rangeAsset.contentRange = "bytes 0-0/*";
    const mismatchedOffsets = validPreflight();
    mismatchedOffsets.rangeAsset.contentRange = "bytes 1-2/100";

    for (const preflight of [wildcard, mismatchedOffsets]) {
      const { evidenceDir, apkPath, manifestPath } = createBundle({ preflight });
      const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain("gsav-preflight.json rangeAsset.contentRange must be bytes 0-0/<size>.");
    }
  });

  it("requires preflight range evidence to include browser-readable CORS headers", () => {
    const missingAllowOrigin = validPreflight();
    delete missingAllowOrigin.rangeAsset.accessControlAllowOrigin;
    const weakExposeHeaders = validPreflight();
    weakExposeHeaders.rangeAsset.accessControlExposeHeaders = "Content-Range";
    const wrongAllowOrigin = validPreflight();
    wrongAllowOrigin.rangeAsset.accessControlAllowOrigin = "https://wrong.example";

    const missingAllowOriginBundle = createBundle({ preflight: missingAllowOrigin });
    const missingAllowOriginResult = verifyReleaseEvidenceBundle({
      evidenceDir: missingAllowOriginBundle.evidenceDir,
      apkPath: missingAllowOriginBundle.apkPath,
      manifestPath: missingAllowOriginBundle.manifestPath,
    });
    expect(missingAllowOriginResult.ok).toBe(false);
    expect(missingAllowOriginResult.errors).toContain("gsav-preflight.json rangeAsset.accessControlAllowOrigin must be present.");

    const weakExposeBundle = createBundle({ preflight: weakExposeHeaders });
    const weakExposeResult = verifyReleaseEvidenceBundle({
      evidenceDir: weakExposeBundle.evidenceDir,
      apkPath: weakExposeBundle.apkPath,
      manifestPath: weakExposeBundle.manifestPath,
    });
    expect(weakExposeResult.ok).toBe(false);
    expect(weakExposeResult.errors).toContain(
      "gsav-preflight.json rangeAsset.accessControlExposeHeaders must expose Accept-Ranges, Content-Length, ETag.",
    );

    const wrongAllowOriginBundle = createBundle({ preflight: wrongAllowOrigin });
    const wrongAllowOriginResult = verifyReleaseEvidenceBundle({
      evidenceDir: wrongAllowOriginBundle.evidenceDir,
      apkPath: wrongAllowOriginBundle.apkPath,
      manifestPath: wrongAllowOriginBundle.manifestPath,
    });
    expect(wrongAllowOriginResult.ok).toBe(false);
    expect(wrongAllowOriginResult.errors).toContain(
      "gsav-preflight.json rangeAsset.accessControlAllowOrigin must be * or match gsav-preflight.json baseUrl origin.",
    );
  });

  it("requires dry-run summary range probe metadata to match preflight evidence", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      env: {
        GSAV_RANGE_PROBE_URL: "https://cdn.example.com/different.gsav",
      },
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "gsav-preflight.json rangeAsset.url must match dry-run-summary.json rangeProbeUrl.",
    );
  });

  it("rejects preflight and runtime evidence without concrete GSAV host identity", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      preflight: {
        ...validPreflight(),
        gsavHostingCommit: "unavailable",
      },
      runtimeSmoke: {
        ...validRuntimeSmoke(),
        gsavHostingCommit: null,
      },
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "gsav-preflight.json must include concrete GSAV host/build identity.",
      "gsav-runtime-smoke.json must include concrete GSAV host/build identity.",
    ]));
  });

  it("rejects generated versionCode drift inside the bundle", () => {
    const mismatched = String(Number(versionCode) + 1);
    const { evidenceDir, apkPath, manifestPath } = createBundle({
      apkVersionCode: mismatched,
    });

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      `apk-version-metadata.txt versionCode ${mismatched} must match app-version-metadata.json ${versionCode}.`,
    );
  });

  it("rejects release candidate identity drift between summary and candidate files", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.androidVersionCode = String(Number(versionCode) + 1);
    summary.publishArtifactIdentitySha256 = verifierSha256Text(publishArtifactIdentityText(summary));
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release-candidate.txt androidVersionCode must match dry-run-summary.json androidVersionCode.",
    );
  });

  it("keeps the bundle checksum tied to evidence-checksums.txt", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.evidenceBundleSha256 = sha256Text("not the checksum file\n");
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "evidence-checksums.txt SHA256 does not match dry-run-summary.json evidenceBundleSha256.",
    );
  });

  it("keeps stable publish artifact identity tied to candidate and artifact hashes", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    expect(summary.publishArtifactIdentitySha256).toBe(verifierSha256Text(publishArtifactIdentityText(summary)));
    summary.publishArtifactIdentitySha256 = sha256Text("wrong identity\n");
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "dry-run-summary.json publishArtifactIdentitySha256 does not match the stable publish artifact identity.",
    );
  });

  it("keeps stable publish artifact identity tied to GSAV package provenance", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const clientEntry = summary.gsavPackageProvenance.find((entry) => entry.packageName === "@opsiclear/gsav-client");
    clientEntry.tarballSha256 = "2".repeat(64);
    summary.gsavPackageProvenanceSha256 = gsavPackageProvenanceSha256(summary.gsavPackageProvenance);
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "dry-run-summary.json publishArtifactIdentitySha256 does not match the stable publish artifact identity.",
    );
  });

  it("requires stable publish artifact identity in release summaries", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    delete summary.publishArtifactIdentitySha256;
    writeJson(summaryPath, summary);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("dry-run-summary.json must include publishArtifactIdentitySha256.");
  });

  it("rejects release evidence paths outside the artifact root", () => {
    const { root, evidenceDir, apkPath, manifestPath } = createBundle();
    const outsidePath = join(root, "..", "outside-release-evidence.txt");
    writeFileSync(outsidePath, "outside evidence\n");
    const outsideEntry = {
      path: relative(process.cwd(), outsidePath).replace(/\\/g, "/"),
      sha256: sha256File(outsidePath),
    };
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.releaseEvidenceFiles.push(outsideEntry);
    const checksumText = [
      ...summary.releaseEvidenceFiles.map((item) => `${item.sha256}  ${item.path}`),
      `${summary.apkSha256}  ${summary.apkPath}`,
      `${summary.manifestSha256}  ${summary.manifestPath}`,
    ].join("\n") + "\n";
    summary.evidenceBundleSha256 = sha256Text(checksumText);
    summary.evidenceChecksumManifestSha256 = summary.evidenceBundleSha256;
    writeJson(summaryPath, summary);
    writeFileSync(join(evidenceDir, "evidence-checksums.txt"), checksumText);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("must stay inside artifact root"),
    ]));
  });

  it("rejects release evidence without candidate identity proof", () => {
    const { evidenceDir, apkPath, manifestPath } = createBundle();
    writeFileSync(join(evidenceDir, "release-candidate.txt"), [
      "releaseCandidateSha=deadbeef",
      `appVersion=${releaseVersion}`,
      `packageVersion=${releaseVersion}`,
      `androidVersionCode=${versionCode}`,
      "",
    ].join("\n"));
    const summaryPath = join(evidenceDir, "dry-run-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const candidateEntry = summary.releaseEvidenceFiles.find((item) => item.path.endsWith("release-candidate.txt"));
    candidateEntry.sha256 = sha256File(join(evidenceDir, "release-candidate.txt"));
    const checksumText = [
      ...summary.releaseEvidenceFiles.map((item) => `${item.sha256}  ${item.path}`),
      `${summary.apkSha256}  ${summary.apkPath}`,
      `${summary.manifestSha256}  ${summary.manifestPath}`,
    ].join("\n") + "\n";
    summary.evidenceBundleSha256 = sha256Text(checksumText);
    summary.evidenceChecksumManifestSha256 = summary.evidenceBundleSha256;
    writeJson(summaryPath, summary);
    writeFileSync(join(evidenceDir, "evidence-checksums.txt"), checksumText);

    const result = verifyReleaseEvidenceBundle({ evidenceDir, apkPath, manifestPath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release-candidate.txt must include the dry-run-summary.json releaseCandidateSha.",
    ]));
  });
});
