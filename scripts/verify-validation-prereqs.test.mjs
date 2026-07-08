import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import verifier from "./verify-validation-prereqs.js";

const {
  DEFAULT_APK_PATH,
  DEFAULT_MANIFEST_PATH,
  analyzeValidationPrereqs,
  collectAndroidDeviceMetadata,
  connectedAndroidDevices,
  pathContainmentProblem,
  isLocalOrPrivateHostname,
  parseAdbDevicesOutput,
  parseWebViewPackageOutput,
  parseArgs,
  trustedGithubEvidenceUrl,
  urlProblems,
  weakIdentityValue,
  writeJsonOutput,
} = verifier;

const IOS_ARTIFACT_CONTENT = "iOS WKWebView validation artifact\n";
const IOS_ARTIFACT_SHA256 = crypto.createHash("sha256").update(IOS_ARTIFACT_CONTENT).digest("hex");

const completeEnv = {
  EXPO_PUBLIC_GSAV_WEB_URL: "https://gsav.example.com",
  EXPO_PUBLIC_GSAV_CATALOG_URL: "https://gsav.example.com/functions/v1/catalog",
  EXPO_PUBLIC_GSAV_SUPABASE_URL: "https://supabase.example.com",
  EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: "public-anon-key",
  GSAV_RANGE_PROBE_URL: "https://gsav.example.com/fixtures/test.gsav",
  GSAV_HOSTING_COMMIT: "abc1234def5678",
  GSAV_HOST_IDENTITY_URL: "https://gsav.example.com/build.json",
  IOS_VALIDATION_OWNER: "@ios-validator",
  IOS_VALIDATION_EXECUTOR_PROOF: "macOS 15.5 with Xcode 17 and xcrun simctl proof captured",
  IOS_VALIDATION_DEVICE: "iPhone 15 simulator",
  IOS_VALIDATION_VERSION: "iOS 18.5",
  IOS_WKWEBVIEW_VERSION: "WKWebView 18.5",
  IOS_VALIDATION_ARTIFACT_URL: "https://github.com/opsiclear/diveo/actions/runs/123/artifacts/ios-wkwebview-evidence",
  IOS_VALIDATION_ARTIFACT_SHA256: IOS_ARTIFACT_SHA256,
  IOS_VALIDATION_ARTIFACT_PATH: "ios-wkwebview-evidence.txt",
  EXPO_PUBLIC_GSAV_QA_CONTROLS: "0",
  EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "0",
};

function tempRootWithArtifacts() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "validation-prereqs-"));
  fs.mkdirSync(path.dirname(path.join(root, DEFAULT_APK_PATH)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(root, DEFAULT_MANIFEST_PATH)), { recursive: true });
  fs.mkdirSync(path.join(root, "android"), { recursive: true });
  fs.writeFileSync(path.join(root, DEFAULT_APK_PATH), "apk");
  fs.writeFileSync(path.join(root, DEFAULT_MANIFEST_PATH), "<manifest />");
  fs.writeFileSync(path.join(root, completeEnv.IOS_VALIDATION_ARTIFACT_PATH), IOS_ARTIFACT_CONTENT);
  return root;
}

function allCommandsAvailable() {
  return true;
}

function noCommandsAvailable() {
  return false;
}

function adbDeviceRunner(command, args = []) {
  const propValues = new Map([
    ["ro.product.model", "Pixel 8"],
    ["ro.build.version.release", "15"],
    ["ro.build.version.sdk", "35"],
    ["ro.build.fingerprint", "google/shiba/shiba:15/AP3A.240905.015/1234567:user/release-keys"],
    ["ro.build.version.incremental", "1234567"],
  ]);
  if (command !== "adb") {
    return { status: 1, stdout: "", stderr: `unexpected command ${command}` };
  }
  if (args[0] === "devices") {
    return {
      status: 0,
      stdout: "List of devices attached\nemulator-5554\tdevice\nunauthorized-1\tunauthorized\n",
      stderr: "",
    };
  }
  const shellIndex = args.indexOf("shell");
  const shellArgs = shellIndex === -1 ? [] : args.slice(shellIndex + 1);
  if (shellArgs[0] === "getprop") {
    return {
      status: 0,
      stdout: `${propValues.get(shellArgs[1]) || ""}\n`,
      stderr: "",
    };
  }
  if (shellArgs[0] === "dumpsys" && shellArgs[1] === "webviewupdate") {
    return {
      status: 0,
      stdout: "Current WebView package (name, version): (com.google.android.webview, 125.0.6422.147)\n",
      stderr: "",
    };
  }
  return { status: 1, stdout: "", stderr: `unexpected adb args ${args.join(" ")}` };
}

function adbIncompleteMetadataRunner(command, args = []) {
  if (command !== "adb") {
    return { status: 1, stdout: "", stderr: `unexpected command ${command}` };
  }
  if (args[0] === "devices") {
    return {
      status: 0,
      stdout: "List of devices attached\nemulator-5554\tdevice\n",
      stderr: "",
    };
  }
  const shellIndex = args.indexOf("shell");
  const shellArgs = shellIndex === -1 ? [] : args.slice(shellIndex + 1);
  if (shellArgs[0] === "getprop" && shellArgs[1] === "ro.product.model") {
    return { status: 0, stdout: "Android SDK built for x86\n", stderr: "" };
  }
  if (shellArgs[0] === "getprop") {
    return { status: 0, stdout: "\n", stderr: "" };
  }
  if (shellArgs[0] === "dumpsys" && shellArgs[1] === "webviewupdate") {
    return { status: 0, stdout: "Current WebView package: null\n", stderr: "" };
  }
  if (shellArgs[0] === "cmd" && shellArgs[1] === "webviewupdate") {
    return { status: 1, stdout: "", stderr: "No WebView package" };
  }
  return { status: 1, stdout: "", stderr: `unexpected adb args ${args.join(" ")}` };
}

function adbNoDeviceRunner() {
  return {
    status: 0,
    stdout: "List of devices attached\n",
    stderr: "",
  };
}

describe("validation prerequisite verifier", () => {
  it("reports expected blockers when local external validation prerequisites are absent", () => {
    const result = analyzeValidationPrereqs({
      root: fs.mkdtempSync(path.join(os.tmpdir(), "validation-prereqs-")),
      env: {},
      hasCommand: noCommandsAvailable,
      platform: "win32",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("fail");
    expect(result.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "android-adb",
      "android-java",
      "expo-npx",
      "github-cli",
      "android-version-metadata-tool",
      "production-gsav-web-url",
      "production-gsav-catalog-url",
      "production-supabase-url",
      "production-range-probe-url",
      "production-host-identity-url",
      "production-supabase-anon-key",
      "production-hosting-commit",
      "ios-executor-proof",
      "ios-owner",
      "ios-deviceIdentity",
      "ios-iosVersion",
      "ios-wkWebViewVersion",
      "ios-artifactUrl",
      "ios-artifactSha256",
      "ios-artifactPath",
      "release-apk",
      "merged-manifest",
    ]));
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("emulator"),
      expect.stringContaining("iOS WKWebView validation requires macOS"),
      expect.stringContaining("Generated android/ project is missing"),
    ]));
  });

  it("passes when commands, production env, APK, and manifest are present", () => {
    const root = tempRootWithArtifacts();
    const result = analyzeValidationPrereqs({
      root,
      env: completeEnv,
      hasCommand: allCommandsAvailable,
      runCommand: adbDeviceRunner,
      platform: "darwin",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("pass");
    expect(result.blockers).toEqual([]);
    expect(result.checked.env["production-supabase-anon-key"].value).toBe("[redacted]");
    expect(result.checked.android.connectedDevices).toEqual(["emulator-5554"]);
    expect(result.checked.android.deviceMetadata).toEqual([
      expect.objectContaining({
        serial: "emulator-5554",
        model: "Pixel 8",
        androidVersion: "15",
        apiLevel: "35",
        buildFingerprint: "google/shiba/shiba:15/AP3A.240905.015/1234567:user/release-keys",
        webViewPackageName: "com.google.android.webview",
        webViewVersion: "125.0.6422.147",
        metadataOk: true,
      }),
    ]);
    expect(result.checked.ios.artifactPath.value).toBe("ios-wkwebview-evidence.txt");
    expect(result.checked.ios.computedArtifactSha256.value).toBe(IOS_ARTIFACT_SHA256);
    expect(result.checked.ios.artifactSha256Matches).toBe(true);
  });

  it("requires connected Android device, GitHub CLI, and generated APK metadata tools", () => {
    const root = tempRootWithArtifacts();
    const availableCommands = new Set(["adb", "java", "npx", "emulator", "xcrun"]);
    const result = analyzeValidationPrereqs({
      root,
      env: completeEnv,
      hasCommand: (command) => availableCommands.has(command),
      runCommand: adbNoDeviceRunner,
      platform: "darwin",
    });

    expect(result.ok).toBe(false);
    expect(result.checked.android.connectedDevices).toEqual([]);
    expect(result.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "android-connected-device",
      "github-cli",
      "android-version-metadata-tool",
    ]));
  });

  it("rejects local, cleartext, or non-.gsav production validation URLs", () => {
    expect(isLocalOrPrivateHostname("127.0.0.1")).toBe(true);
    expect(isLocalOrPrivateHostname("10.0.2.2")).toBe(true);
    expect(isLocalOrPrivateHostname("192.168.1.10")).toBe(true);
    expect(isLocalOrPrivateHostname("fd00::1")).toBe(true);
    expect(isLocalOrPrivateHostname("gsav.example.com")).toBe(false);

    expect(urlProblems("http://gsav.example.com", { label: "GSAV web" })).toContain("GSAV web must use https.");
    expect(urlProblems("https://10.0.2.2/test.gsav", { label: "range", mustEndWithGsav: true })).toContain("range must not use localhost, emulator, link-local, or private LAN hosts.");
    expect(urlProblems("https://gsav.example.com/test.bin", { label: "range", mustEndWithGsav: true })).toContain("range must point to a .gsav fixture.");
  });

  it("rejects QA-only flags and weak host identity values for production validation", () => {
    const root = tempRootWithArtifacts();
    const result = analyzeValidationPrereqs({
      root,
      env: {
        ...completeEnv,
        GSAV_HOSTING_COMMIT: "placeholder",
        EXPO_PUBLIC_GSAV_QA_CONTROLS: "1",
        EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "5000",
      },
      hasCommand: allCommandsAvailable,
      runCommand: adbDeviceRunner,
      platform: "darwin",
    });

    expect(weakIdentityValue("placeholder")).toBe(true);
    expect(weakIdentityValue("abc1234def5678")).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "production-hosting-commit",
      "qa-flag-EXPO_PUBLIC_GSAV_QA_CONTROLS",
      "qa-flag-EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS",
    ]));
  });

  it("requires structured iOS validation owner and WKWebView executor proof", () => {
    const root = tempRootWithArtifacts();
    const envWithoutIos = { ...completeEnv };
    for (const key of [
      "IOS_VALIDATION_OWNER",
      "IOS_VALIDATION_EXECUTOR_PROOF",
      "IOS_VALIDATION_DEVICE",
      "IOS_VALIDATION_VERSION",
      "IOS_WKWEBVIEW_VERSION",
      "IOS_VALIDATION_ARTIFACT_URL",
      "IOS_VALIDATION_ARTIFACT_SHA256",
      "IOS_VALIDATION_ARTIFACT_PATH",
    ]) {
      delete envWithoutIos[key];
    }
    const result = analyzeValidationPrereqs({
      root,
      env: {
        ...envWithoutIos,
        IOS_VALIDATION_OWNER: "owner",
        IOS_VALIDATION_VERSION: "todo",
      },
      hasCommand: allCommandsAvailable,
      runCommand: adbDeviceRunner,
      platform: "win32",
    });

    expect(result.ok).toBe(false);
    expect(result.checked.ios.owner.value).toBe("owner");
    expect(result.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "ios-executor-proof",
      "ios-owner",
      "ios-deviceIdentity",
      "ios-iosVersion",
      "ios-wkWebViewVersion",
      "ios-artifactUrl",
      "ios-artifactSha256",
      "ios-artifactPath",
    ]));
  });

  it("requires Android model, OS/API, build, and WebView metadata", () => {
    const root = tempRootWithArtifacts();
    const result = analyzeValidationPrereqs({
      root,
      env: completeEnv,
      hasCommand: allCommandsAvailable,
      runCommand: adbIncompleteMetadataRunner,
      platform: "darwin",
    });

    expect(result.ok).toBe(false);
    expect(result.checked.android.connectedDevices).toEqual(["emulator-5554"]);
    expect(result.checked.android.deviceMetadata).toEqual([
      expect.objectContaining({
        serial: "emulator-5554",
        model: "Android SDK built for x86",
        metadataOk: false,
        missing: expect.arrayContaining([
          "Android version",
          "Android API level",
          "build fingerprint or incremental build",
          "WebView package",
          "WebView version",
        ]),
      }),
    ]);
    expect(result.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "android-device-metadata",
      "android-webview-version",
    ]));
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Android metadata incomplete for emulator-5554"),
    ]));
  });

  it("requires trusted durable iOS validation artifacts with checksum", () => {
    const root = tempRootWithArtifacts();
    const result = analyzeValidationPrereqs({
      root,
      env: {
        ...completeEnv,
        IOS_VALIDATION_ARTIFACT_URL: "https://github.com/other/repo/actions/runs/123/artifacts/ios",
        IOS_VALIDATION_ARTIFACT_SHA256: "not-a-sha",
      },
      hasCommand: allCommandsAvailable,
      runCommand: adbDeviceRunner,
      platform: "darwin",
    });

    expect(trustedGithubEvidenceUrl("https://github.com/opsiclear/diveo/blob/main/docs/qa-evidence/2026-07-01/ios.log")).toBe(true);
    expect(trustedGithubEvidenceUrl("https://github.com/OpsiClear-Web/diveo/actions/runs/123/artifacts/ios")).toBe(true);
    expect(trustedGithubEvidenceUrl("https://github.com/opsiclear/diveo/releases/download/v1.0.19/ios-wkwebview-evidence.zip")).toBe(true);
    expect(trustedGithubEvidenceUrl("https://github.com/OpsiClear-Web/diveo/actions/runs/123")).toBe(false);
    expect(trustedGithubEvidenceUrl("https://github.com/opsiclear/diveo/releases/tag/v1.0.19")).toBe(false);
    expect(trustedGithubEvidenceUrl("https://github.com/other/repo/actions/runs/123/artifacts/ios")).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "ios-artifactUrl",
      "ios-artifactSha256",
    ]));
  });

  it("requires byte-level iOS artifact SHA verification", () => {
    const root = tempRootWithArtifacts();
    const missingPathResult = analyzeValidationPrereqs({
      root,
      env: {
        ...completeEnv,
        IOS_VALIDATION_ARTIFACT_PATH: "missing-ios-evidence.txt",
      },
      hasCommand: allCommandsAvailable,
      runCommand: adbDeviceRunner,
      platform: "darwin",
    });
    const mismatchResult = analyzeValidationPrereqs({
      root,
      env: {
        ...completeEnv,
        IOS_VALIDATION_ARTIFACT_SHA256: "0".repeat(64),
      },
      hasCommand: allCommandsAvailable,
      runCommand: adbDeviceRunner,
      platform: "darwin",
    });

    expect(missingPathResult.ok).toBe(false);
    expect(missingPathResult.blockers.map((item) => item.id)).toContain("ios-artifactPath");
    expect(mismatchResult.ok).toBe(false);
    expect(mismatchResult.checked.ios.computedArtifactSha256.value).toBe(IOS_ARTIFACT_SHA256);
    expect(mismatchResult.checked.ios.artifactSha256Matches).toBe(false);
    expect(mismatchResult.blockers.map((item) => item.id)).toContain("ios-artifactSha256Matches");
  });

  it("parses artifact path arguments and manifest env fallback", () => {
    expect(parseArgs([], { ANDROID_MANIFEST_PATH: "custom/manifest.xml" })).toEqual({
      root: process.cwd(),
      apkPath: DEFAULT_APK_PATH,
      manifestPath: "custom/manifest.xml",
      iosArtifactPath: null,
      outputPath: null,
    });
    expect(parseArgs([
      "--root",
      "downloaded-release",
      "--apk-path",
      "android/app-release.apk",
      "--manifest-path",
      "android/AndroidManifest.xml",
      "--ios-artifact-path",
      "ios/ios-evidence.zip",
      "--output-path",
      "release-evidence/validation-prereqs.json",
    ], {})).toEqual({
      root: "downloaded-release",
      apkPath: "android/app-release.apk",
      manifestPath: "android/AndroidManifest.xml",
      iosArtifactPath: "ios/ios-evidence.zip",
      outputPath: "release-evidence/validation-prereqs.json",
    });
    expect(parseArgs([], { VALIDATION_PREREQS_ROOT: "artifact-root", IOS_VALIDATION_ARTIFACT_PATH: "ios.zip" }).iosArtifactPath).toBe("ios.zip");
    expect(parseArgs([], { VALIDATION_PREREQS_ROOT: "artifact-root" }).root).toBe("artifact-root");
    expect(() => parseArgs(["--output-path"], {})).toThrow(/non-empty/);
    expect(() => parseArgs(["--unknown"], {})).toThrow(/Usage:/);
  });

  it("writes validation-prerequisite JSON evidence when output path is provided", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "validation-prereqs-output-"));
    const outputPath = "docs/qa-evidence/2026-06-30/validation-prereqs.json";
    const absolutePath = writeJsonOutput(root, outputPath, {
      checkedAt: "2026-06-30T00:00:00.000Z",
      ok: true,
      status: "pass",
    });

    expect(absolutePath).toBe(path.join(root, outputPath));
    expect(JSON.parse(fs.readFileSync(absolutePath, "utf8"))).toMatchObject({
      checkedAt: "2026-06-30T00:00:00.000Z",
      ok: true,
      status: "pass",
    });
  });

  it("rejects output paths outside the validation root when required", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "validation-prereqs-output-"));

    expect(() => writeJsonOutput(root, "../outside-validation-prereqs.json", {
      checkedAt: "2026-06-30T00:00:00.000Z",
      ok: true,
      status: "pass",
    }, { requireInsideRoot: true })).toThrow("--output-path must stay inside validation root");
  });

  it("rejects APK and manifest paths outside explicit validation roots", () => {
    const root = tempRootWithArtifacts();
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "validation-prereqs-outside-"));
    const outsideApk = path.join(outsideRoot, "app-release.apk");
    const outsideManifest = path.join(outsideRoot, "AndroidManifest.xml");
    const outsideIosArtifact = path.join(outsideRoot, "ios.zip");
    fs.writeFileSync(outsideApk, "apk");
    fs.writeFileSync(outsideManifest, "<manifest />");
    fs.writeFileSync(outsideIosArtifact, IOS_ARTIFACT_CONTENT);

    const result = analyzeValidationPrereqs({
      root,
      env: {
        ...completeEnv,
        IOS_VALIDATION_ARTIFACT_PATH: outsideIosArtifact,
      },
      apkPath: outsideApk,
      manifestPath: outsideManifest,
      hasCommand: allCommandsAvailable,
      runCommand: adbDeviceRunner,
      platform: "darwin",
      requirePathsInsideRoot: true,
    });

    expect(pathContainmentProblem(root, outsideApk, "APK path")).toContain("must stay inside validation root");
    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "release-apk-path-outside-root",
      "merged-manifest-path-outside-root",
      "ios-artifact-path-outside-root",
    ]));
  });

  it("parses only adb devices in device state", () => {
    expect(parseAdbDevicesOutput(`List of devices attached
emulator-5554\tdevice
offline-device\toffline
unauthorized-device\tunauthorized

`)).toEqual(["emulator-5554"]);
    expect(connectedAndroidDevices({ runCommand: adbDeviceRunner })).toMatchObject({
      ok: true,
      devices: ["emulator-5554"],
    });
  });

  it("parses and collects Android WebView package metadata", () => {
    expect(parseWebViewPackageOutput("Current WebView package (name, version): (com.google.android.webview, 125.0.6422.147)")).toEqual({
      packageName: "com.google.android.webview",
      version: "125.0.6422.147",
    });
    expect(parseWebViewPackageOutput("packageName=com.android.chrome versionName=126.0.6478.40")).toEqual({
      packageName: "com.android.chrome",
      version: "126.0.6478.40",
    });
    expect(collectAndroidDeviceMetadata("emulator-5554", { runCommand: adbDeviceRunner })).toEqual(expect.objectContaining({
      serial: "emulator-5554",
      model: "Pixel 8",
      androidVersion: "15",
      apiLevel: "35",
      webViewPackageName: "com.google.android.webview",
      webViewVersion: "125.0.6422.147",
      metadataOk: true,
    }));
  });
});
