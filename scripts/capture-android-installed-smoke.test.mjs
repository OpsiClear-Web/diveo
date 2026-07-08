import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import smokeModule from "./capture-android-installed-smoke.js";
import readinessModule from "./verify-release-readiness.js";

const {
  captureAndroidInstalledSmoke,
  formatInstalledSmokeEvidence,
  isLocalHostname,
  missingReleaseRoutes,
  parseArgs,
  parseAndroidOsVersion,
  parseAndroidWebViewVersion,
  parseBooleanOption,
  parsePackageVersionCode,
  parseRequiredLogMarkers,
  parseRoutes,
  productionHostProblems,
  routeUri,
  sha256File,
  writeAndroidInstalledSmoke,
} = smokeModule;

const {
  detailProblem,
  requiredEvidence,
} = readinessModule;

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "diveo-android-smoke-"));
  writeFileSync(join(root, "app.json"), JSON.stringify({
    expo: {
      scheme: ["gsav"],
      android: {
        package: "com.opsiclear.diveo",
      },
    },
  }));
  const apkPath = join(root, "app-release.apk");
  writeFileSync(apkPath, "apk bytes");
  return { root, apkPath };
}

function successfulRunCommand({
  androidRelease = "15",
  androidSdk = "35",
  androidWebView = "Current WebView package (name, version): (com.google.android.webview, 125.0.6422.165)\n",
  packageVersionCode = "10019",
  logOutputs = [],
  installStatus = 0,
} = {}) {
  let logDumpIndex = 0;
  const defaultLogcat = "ReactNativeJS GSAV_ROUTE_CHANGE\nchromium GSAV_BRIDGE_READY\nWebView ready\n";

  return (_command, args) => {
    if (args[0] === "install") {
      return {
        status: installStatus,
        stdout: "",
        stderr: installStatus === 0 ? "" : "install failed",
      };
    }
    if (args[0] === "shell" && args[1] === "getprop" && args[2] === "ro.build.version.release") {
      return { status: 0, stdout: `${androidRelease}\n`, stderr: "" };
    }
    if (args[0] === "shell" && args[1] === "getprop" && args[2] === "ro.build.version.sdk") {
      return { status: 0, stdout: `${androidSdk}\n`, stderr: "" };
    }
    if (args[0] === "shell" && args[1] === "dumpsys" && args[2] === "webviewupdate") {
      return { status: 0, stdout: androidWebView, stderr: "" };
    }
    if (args[0] === "shell" && args[1] === "dumpsys" && args[2] === "package") {
      return { status: 0, stdout: `versionCode=${packageVersionCode} minSdk=24 targetSdk=35\n`, stderr: "" };
    }
    if (args[0] === "logcat" && args[1] === "-d") {
      const stdout = logOutputs[logDumpIndex] ?? defaultLogcat;
      logDumpIndex += 1;
      return { status: 0, stdout, stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
}

describe("Android installed APK smoke capture", () => {
  it("parses CLI flags and route lists", () => {
    expect(parseArgs([
      "--apk-path", "app.apk",
      "--output-path", "docs/qa-evidence/android-smoke.txt",
      "--routes", "/explore,/watch/test",
      "--required-log-markers", "route=GSAV_ROUTE_CHANGE;bridge=GSAV_BRIDGE_READY",
      "--allow-partial-routes", "true",
      "--allow-missing-log-markers", "true",
      "--allow-missing-device-metadata", "true",
      "--allow-rehearsal-host", "true",
      "--wait-ms", "0",
    ])).toEqual({
      apkPath: "app.apk",
      outputPath: "docs/qa-evidence/android-smoke.txt",
      routes: "/explore,/watch/test",
      requiredLogMarkers: "route=GSAV_ROUTE_CHANGE;bridge=GSAV_BRIDGE_READY",
      allowPartialRoutes: "true",
      allowMissingLogMarkers: "true",
      allowMissingDeviceMetadata: "true",
      allowRehearsalHost: "true",
      waitMs: "0",
    });
    expect(parseRoutes("/explore, /watch/test")).toEqual(["/explore", "/watch/test"]);
    expect(parseRequiredLogMarkers("route=GSAV_ROUTE_CHANGE;bridge=GSAV_BRIDGE_READY")).toEqual([
      {
        id: "route",
        pattern: "GSAV_ROUTE_CHANGE",
        description: "filtered logcat matches GSAV_ROUTE_CHANGE",
      },
      {
        id: "bridge",
        pattern: "GSAV_BRIDGE_READY",
        description: "filtered logcat matches GSAV_BRIDGE_READY",
      },
    ]);
    expect(parseRequiredLogMarkers("none")).toEqual([]);
    expect(parseBooleanOption("true", "--flag")).toBe(true);
    expect(parseBooleanOption("0", "--flag")).toBe(false);
    expect(parseAndroidOsVersion("15\n", "35\n")).toBe("Android 15 API 35");
    expect(parseAndroidWebViewVersion("Current WebView package (name, version): (com.google.android.webview, 125.0.6422.165)\n")).toBe("125.0.6422.165");
    expect(missingReleaseRoutes(["/explore"])).toEqual(["/gsav-diagnostics", "/watch/test"]);
    expect(routeUri("/watch/test", "gsav")).toBe("gsav://watch/test");
    expect(routeUri("/", "gsav")).toBe("gsav://");
    expect(parsePackageVersionCode("versionCode=10019 minSdk=24 targetSdk=35")).toBe("10019");
    expect(isLocalHostname("10.0.2.2")).toBe(true);
    expect(isLocalHostname("gsav.example.com")).toBe(false);
    expect(productionHostProblems("https://gsav.example.com")).toEqual([]);
    expect(productionHostProblems("http://127.0.0.1:5191")).toEqual([
      "productionHostUrl must use https for release installed-smoke evidence",
      "productionHostUrl must not use localhost, emulator, link-local, or private LAN hosts",
    ]);
  });

  it("installs the exact APK, verifies summary identity, opens required routes, and captures filtered logs", () => {
    const { root, apkPath } = tempRoot();
    const summaryPath = join(root, "release-evidence", "dry-run-summary.json");
    mkdirSync(join(root, "release-evidence"), { recursive: true });
    writeFileSync(summaryPath, JSON.stringify({
      apkSha256: sha256File(apkPath),
      androidVersionCode: "10019",
      releaseCandidateSha: "abcdef1234567890abcdef1234567890abcdef12",
      artifactName: "diveo-release-evidence-v1.0.19",
      runUrl: "https://github.com/opsiclear/diveo/actions/runs/1",
    }));
    const calls = [];
    const result = captureAndroidInstalledSmoke({
      root,
      apkPath,
      dryRunSummaryPath: summaryPath,
      ciArtifactUrl: "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/2",
      productionHostUrl: "https://gsav.example.com",
      waitMs: 0,
      runCommand: (command, args) => {
        calls.push([command, ...args]);
        return successfulRunCommand()(command, args);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.apkSha256).toBe(sha256File(apkPath));
    expect(result.apkSha256Matches).toBe(true);
    expect(result.installedVersionCode).toBe("10019");
    expect(result.installedVersionCodeMatches).toBe(true);
    expect(result.androidOsVersion).toBe("Android 15 API 35");
    expect(result.androidWebViewVersion).toBe("125.0.6422.165");
    expect(result.observedSignalsOk).toBe(true);
    expect(result.observedSignalChecks.filter((check) => check.route === "/watch/test").map((check) => [check.id, check.matched])).toEqual([
      ["route-change", true],
      ["bridge-ready-or-error", true],
    ]);
    expect(result.releaseSummary.releaseCandidateSha).toBe("abcdef1234567890abcdef1234567890abcdef12");
    expect(result.ciArtifactUrl).toBe("https://github.com/opsiclear/diveo/actions/runs/1/artifacts/2");
    expect(result.productionHostReleaseReady).toBe(true);
    expect(result.allowPartialRoutes).toBe(false);
    expect(result.allowMissingLogMarkers).toBe(false);
    expect(result.allowMissingDeviceMetadata).toBe(false);
    expect(result.allowRehearsalHost).toBe(false);
    expect(result.packageName).toBe("com.opsiclear.diveo");
    expect(result.routes.map((route) => route.uri)).toEqual([
      "gsav://explore",
      "gsav://gsav-diagnostics",
      "gsav://watch/test",
    ]);
    expect(calls).toEqual(expect.arrayContaining([
      ["adb", "install", "-r", apkPath],
      ["adb", "shell", "getprop", "ro.build.version.release"],
      ["adb", "shell", "getprop", "ro.build.version.sdk"],
      ["adb", "shell", "dumpsys", "webviewupdate"],
      ["adb", "shell", "dumpsys", "package", "com.opsiclear.diveo"],
      ["adb", "shell", "monkey", "-p", "com.opsiclear.diveo", "1"],
      ["adb", "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "gsav://watch/test", "com.opsiclear.diveo"],
      ["adb", "logcat", "-d", "-v", "time", "ReactNativeJS:I", "chromium:I", "WebView:I", "*:S"],
    ]));
    expect(result.logcat).toContain("GSAV_BRIDGE_READY");
  });

  it("writes a durable manual-review evidence file", () => {
    const { root, apkPath } = tempRoot();
    const outputPath = join(root, "docs", "qa-evidence", "android-installed-smoke.txt");
    const { result } = writeAndroidInstalledSmoke({
      root,
      apkPath,
      outputPath,
      productionHostUrl: "https://gsav.example.com",
      waitMs: 0,
      runCommand: successfulRunCommand(),
    });

    expect(result.ok).toBe(true);
    expect(existsSync(outputPath)).toBe(true);
    const evidence = readFileSync(outputPath, "utf8");
    expect(evidence).toContain("manualReviewRequired: true");
    expect(evidence).toContain("apkSha256:");
    expect(evidence).toContain("Android OS version: Android 15 API 35");
    expect(evidence).toContain("Android WebView version: 125.0.6422.165");
    expect(evidence).toContain("installedVersionCode: 10019");
    expect(evidence).toContain("productionHostUrl: https://gsav.example.com");
    expect(evidence).toContain("productionHostReleaseReady=true");
    expect(evidence).toContain("allowPartialRoutes=false");
    expect(evidence).toContain("allowMissingLogMarkers=false");
    expect(evidence).toContain("allowMissingDeviceMetadata=false");
    expect(evidence).toContain("allowRehearsalHost=false");
    expect(evidence).toContain("apkSha256MatchesDryRunSummary=not checked");
    expect(evidence).toContain("installedVersionCodeMatchesDryRunSummary=not checked");
    expect(evidence).toContain("observedSignalsOk=true");
    expect(evidence).toContain("observedSignalChecks:");
    expect(evidence).toContain("gsav://explore");
    expect(evidence).toContain("gsav://gsav-diagnostics");
    expect(evidence).toContain("gsav://watch/test");
    expect(evidence).toContain("requiredManualObservations:");
  });

  it("generates evidence text that satisfies release-readiness installed-smoke detail checks", () => {
    const { root, apkPath } = tempRoot();
    const summaryPath = join(root, "release-evidence", "dry-run-summary.json");
    mkdirSync(join(root, "release-evidence"), { recursive: true });
    writeFileSync(summaryPath, JSON.stringify({
      apkSha256: sha256File(apkPath),
      androidVersionCode: "10019",
      releaseCandidateSha: "abc1234567890abcdef1234567890abcdef12345",
      artifactName: "diveo-release-evidence-v1.0.19",
      runUrl: "https://github.com/opsiclear/diveo/actions/runs/1",
    }));
    const result = captureAndroidInstalledSmoke({
      root,
      apkPath,
      dryRunSummaryPath: summaryPath,
      ciArtifactUrl: "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/2",
      productionHostUrl: "https://gsav.example.com",
      waitMs: 0,
      runCommand: successfulRunCommand(),
    });
    const evidenceText = formatInstalledSmokeEvidence(result).replace(/\r?\n/g, "; ");
    const row = {
      device: "Pixel 8",
      gsavWebUrl: "https://gsav.example.com",
      result: `Passed: installed exact release APK on Pixel 8; command: npm run android:installed-smoke -- --apk-path app-release.apk --output-path docs/qa-evidence/2026-06-30/android-installed-release-smoke.txt --dry-run-summary-path release-evidence/dry-run-summary.json --production-host-url https://gsav.example.com --ci-artifact-url https://github.com/opsiclear/diveo/actions/runs/1/artifacts/2; ${evidenceText}`,
      evidencePath: "https://github.com/opsiclear/diveo/actions/runs/1/artifacts/release-installed-smoke",
      notes: "owner=@native-release; diveo commit abc1234; app version 1.0.19; package.json version: 1.0.19; Android versionCode: 10019",
    };
    const requirement = requiredEvidence.find((item) => item.route === "Release-installed APK smoke");

    expect(detailProblem(row, requirement, {
      candidate: {
        commit: "abc1234567890abcdef1234567890abcdef12345",
        versionCode: 10019,
      },
    })).toBeNull();
  });

  it("rejects partial release route coverage unless explicitly allowed", () => {
    const { root, apkPath } = tempRoot();

    expect(() => captureAndroidInstalledSmoke({
      root,
      apkPath,
      productionHostUrl: "https://gsav.example.com",
      routes: ["/explore"],
      waitMs: 0,
      runCommand: successfulRunCommand(),
    })).toThrow("required release routes missing: /gsav-diagnostics, /watch/test");

    const partialRoutes = captureAndroidInstalledSmoke({
      root,
      apkPath,
      productionHostUrl: "https://gsav.example.com",
      routes: ["/explore"],
      allowPartialRoutes: true,
      waitMs: 0,
      runCommand: successfulRunCommand(),
    });
    expect(partialRoutes.ok).toBe(true);
    expect(partialRoutes.allowPartialRoutes).toBe(true);
    expect(formatInstalledSmokeEvidence(partialRoutes)).toContain("allowPartialRoutes=true");
  });

  it("rejects empty release log-marker coverage unless explicitly allowed", () => {
    const { root, apkPath } = tempRoot();

    expect(() => captureAndroidInstalledSmoke({
      root,
      apkPath,
      productionHostUrl: "https://gsav.example.com",
      requiredLogMarkers: [],
      waitMs: 0,
      runCommand: successfulRunCommand(),
    })).toThrow("required log markers cannot be empty");

    const missingLogMarkers = captureAndroidInstalledSmoke({
      root,
      apkPath,
      productionHostUrl: "https://gsav.example.com",
      requiredLogMarkers: [],
      allowMissingLogMarkers: true,
      waitMs: 0,
      runCommand: successfulRunCommand(),
    });
    expect(missingLogMarkers.ok).toBe(true);
    expect(missingLogMarkers.allowMissingLogMarkers).toBe(true);
    expect(formatInstalledSmokeEvidence(missingLogMarkers)).toContain("allowMissingLogMarkers=true");
  });

  it("fails when ADB succeeds but filtered logcat does not include required observed signals", () => {
    const { root, apkPath } = tempRoot();
    const result = captureAndroidInstalledSmoke({
      root,
      apkPath,
      productionHostUrl: "https://gsav.example.com",
      waitMs: 0,
      runCommand: successfulRunCommand({
        logOutputs: [
          "ReactNativeJS app opened without bridge markers\n",
          "ReactNativeJS app opened without bridge markers\n",
          "ReactNativeJS app opened without bridge markers\n",
        ],
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.observedSignalsOk).toBe(false);
    expect(result.observedSignalChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "route-change", matched: false }),
      expect.objectContaining({ id: "bridge-ready-or-error", matched: false }),
    ]));
    const evidence = formatInstalledSmokeEvidence(result);
    expect(evidence).toContain("observedSignalsOk=false");
    expect(evidence).toContain("fail: /explore route-change");
    expect(evidence).toContain("fail: /explore bridge-ready-or-error");
  });

  it("fails when only one launched route emits the required observed signals", () => {
    const { root, apkPath } = tempRoot();
    const result = captureAndroidInstalledSmoke({
      root,
      apkPath,
      productionHostUrl: "https://gsav.example.com",
      waitMs: 0,
      runCommand: successfulRunCommand({
        logOutputs: [
          "GSAV_ROUTE_CHANGE\nGSAV_BRIDGE_READY\n",
          "ReactNativeJS diagnostics opened without bridge markers\n",
          "ReactNativeJS watch opened without bridge markers\n",
        ],
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.routes.map((route) => [route.route, route.observedSignalsOk])).toEqual([
      ["/explore", true],
      ["/gsav-diagnostics", false],
      ["/watch/test", false],
    ]);
  });

  it("marks command failures and includes stderr in the evidence", () => {
    const { root, apkPath } = tempRoot();
    const result = captureAndroidInstalledSmoke({
      root,
      apkPath,
      productionHostUrl: "https://gsav.example.com",
      waitMs: 0,
      runCommand: successfulRunCommand({ installStatus: 1 }),
    });

    expect(result.ok).toBe(false);
    const evidence = formatInstalledSmokeEvidence(result);
    expect(evidence).toContain("status: fail");
    expect(evidence).toContain("stderr: install failed");
  });

  it("fails when the APK hash does not match dry-run-summary.json", () => {
    const { root, apkPath } = tempRoot();
    const summaryPath = join(root, "dry-run-summary.json");
    writeFileSync(summaryPath, JSON.stringify({
      apkSha256: "0".repeat(64),
      androidVersionCode: "10019",
    }));

    expect(() => captureAndroidInstalledSmoke({
      root,
      apkPath,
      dryRunSummaryPath: summaryPath,
      productionHostUrl: "https://gsav.example.com",
      waitMs: 0,
      runCommand: () => {
        throw new Error("should not run adb");
      },
    })).toThrow("APK SHA256 does not match dry-run-summary.json");
  });

  it("fails when the installed package versionCode is missing or mismatched", () => {
    const { root, apkPath } = tempRoot();
    const summaryPath = join(root, "dry-run-summary.json");
    writeFileSync(summaryPath, JSON.stringify({
      apkSha256: sha256File(apkPath),
      androidVersionCode: "10019",
    }));

    const result = captureAndroidInstalledSmoke({
      root,
      apkPath,
      dryRunSummaryPath: summaryPath,
      productionHostUrl: "https://gsav.example.com",
      waitMs: 0,
      runCommand: successfulRunCommand({ packageVersionCode: "10020" }),
    });

    expect(result.ok).toBe(false);
    expect(result.installedVersionCode).toBe("10020");
    expect(result.installedVersionCodeMatches).toBe(false);
    expect(formatInstalledSmokeEvidence(result)).toContain("installedVersionCodeMatchesDryRunSummary=false");
  });

  it("requires a non-local HTTPS production host unless explicitly marked as rehearsal", () => {
    const { root, apkPath } = tempRoot();

    expect(() => captureAndroidInstalledSmoke({
      root,
      apkPath,
      waitMs: 0,
      runCommand: successfulRunCommand(),
    })).toThrow("productionHostUrl is required for release installed-smoke evidence");

    expect(() => captureAndroidInstalledSmoke({
      root,
      apkPath,
      productionHostUrl: "http://10.0.2.2:5191",
      waitMs: 0,
      runCommand: successfulRunCommand(),
    })).toThrow("productionHostUrl must use https for release installed-smoke evidence; productionHostUrl must not use localhost, emulator, link-local, or private LAN hosts");

    const rehearsal = captureAndroidInstalledSmoke({
      root,
      apkPath,
      productionHostUrl: "http://10.0.2.2:5191",
      allowRehearsalHost: true,
      waitMs: 0,
      runCommand: successfulRunCommand(),
    });
    expect(rehearsal.ok).toBe(true);
    expect(rehearsal.productionHostReleaseReady).toBe(false);
    expect(formatInstalledSmokeEvidence(rehearsal)).toContain("allowRehearsalHost=true");
  });

  it("fails before running adb when the APK is missing", () => {
    const { root } = tempRoot();
    expect(() => captureAndroidInstalledSmoke({
      root,
      apkPath: join(root, "missing.apk"),
      waitMs: 0,
      runCommand: () => {
        throw new Error("should not run");
      },
    })).toThrow("APK file is missing");
  });
});
