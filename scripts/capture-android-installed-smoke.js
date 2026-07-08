#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const DEFAULT_ROUTES = ["/explore", "/gsav-diagnostics", "/watch/test"];
const LOG_FILTER_ARGS = ["ReactNativeJS:I", "chromium:I", "WebView:I", "*:S"];
const DEFAULT_REQUIRED_LOG_MARKERS = [
  {
    id: "route-change",
    pattern: "GSAV_ROUTE_CHANGE|route-change|route change",
    description: "filtered logcat includes a GSAV route-change signal",
  },
  {
    id: "bridge-ready-or-error",
    pattern: "GSAV_BRIDGE_READY|GSAV_ERROR|unsupported",
    description: "filtered logcat includes bridge readiness or an explicit error/unsupported state",
  },
];
const BOOLEAN_TRUE_VALUES = new Set(["1", "true", "yes", "y"]);
const BOOLEAN_FALSE_VALUES = new Set(["0", "false", "no", "n"]);
const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
];

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = value;
    i += 1;
  }
  return options;
}

function normalizeSlash(value) {
  return String(value).replace(/\\/g, "/");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readAppDefaults(root = process.cwd()) {
  const appJson = readJson(path.join(root, "app.json"));
  const expo = appJson.expo ?? {};
  const scheme = Array.isArray(expo.scheme) ? expo.scheme[0] : expo.scheme;
  return {
    packageName: expo.android?.package ?? "com.opsiclear.diveo",
    scheme: scheme ?? "gsav",
  };
}

function routeUri(route, scheme) {
  const normalizedRoute = route.replace(/^\/+/, "");
  return normalizedRoute ? `${scheme}://${normalizedRoute}` : `${scheme}://`;
}

function parseRoutes(value) {
  if (!value) return DEFAULT_ROUTES;
  return value.split(",").map((route) => route.trim()).filter(Boolean);
}

function parseBooleanOption(value, optionName) {
  if (value == null || value === "") return false;
  const normalized = String(value).trim().toLowerCase();
  if (BOOLEAN_TRUE_VALUES.has(normalized)) return true;
  if (BOOLEAN_FALSE_VALUES.has(normalized)) return false;
  throw new Error(`Invalid boolean value for ${optionName}: ${value}`);
}

function parseRequiredLogMarkers(value) {
  if (value == null || value === "") return DEFAULT_REQUIRED_LOG_MARKERS;
  if (String(value).trim().toLowerCase() === "none") return [];
  return String(value).split(";").map((entry, index) => {
    const trimmed = entry.trim();
    const separator = trimmed.indexOf("=");
    const id = separator > 0 ? trimmed.slice(0, separator).trim() : `marker-${index + 1}`;
    const pattern = separator > 0 ? trimmed.slice(separator + 1).trim() : trimmed;
    if (!pattern) {
      throw new Error(`Missing required log marker pattern for ${id}`);
    }
    return {
      id,
      pattern,
      description: `filtered logcat matches ${pattern}`,
    };
  });
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function parsePackageVersionCode(text) {
  const match = /versionCode=(\d+)/i.exec(text);
  return match?.[1] ?? null;
}

function parseAndroidOsVersion(releaseText, sdkText) {
  const release = String(releaseText ?? "").trim().split(/\r?\n/).find(Boolean);
  const sdk = String(sdkText ?? "").trim().split(/\r?\n/).find(Boolean);
  if (!release && !sdk) return null;

  const releaseLabel = release
    ? /^android\b/i.test(release) ? release : `Android ${release}`
    : "Android";
  return sdk ? `${releaseLabel} API ${sdk}` : releaseLabel;
}

function parseAndroidWebViewVersion(text) {
  const normalizedText = String(text ?? "");
  const lines = normalizedText.split(/\r?\n/);
  const currentLine = lines.find((line) => /Current WebView package|WebView package/i.test(line))
    ?? normalizedText;
  const versionName = /versionName\s*[=:]\s*([0-9]+(?:\.[0-9]+){1,4})/i.exec(normalizedText);
  if (versionName) return versionName[1];

  const tupleVersion = /\bcom\.[\w.]*webview[\w.]*[^0-9]+([0-9]+(?:\.[0-9]+){1,4})\b/i.exec(currentLine);
  if (tupleVersion) return tupleVersion[1];

  const currentVersion = /\b([0-9]+(?:\.[0-9]+){1,4})\b/.exec(currentLine);
  if (currentVersion) return currentVersion[1];

  const fallbackVersion = /\b([0-9]+(?:\.[0-9]+){1,4})\b/.exec(normalizedText);
  return fallbackVersion?.[1] ?? null;
}

function isLocalHostname(hostname) {
  const normalized = String(hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost"
    || normalized === "::1"
    || normalized === "0:0:0:0:0:0:0:1"
    || PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(normalized))
    || /^fc/i.test(normalized)
    || /^fd/i.test(normalized)
    || /^fe80:/i.test(normalized);
}

function productionHostProblems(productionHostUrl, allowRehearsalHost = false) {
  const errors = [];
  if (!productionHostUrl) {
    if (!allowRehearsalHost) errors.push("productionHostUrl is required for release installed-smoke evidence");
    return errors;
  }

  try {
    const parsed = new URL(productionHostUrl);
    if (parsed.protocol !== "https:" && !allowRehearsalHost) {
      errors.push("productionHostUrl must use https for release installed-smoke evidence");
    }
    if (isLocalHostname(parsed.hostname) && !allowRehearsalHost) {
      errors.push("productionHostUrl must not use localhost, emulator, link-local, or private LAN hosts");
    }
  } catch {
    errors.push("productionHostUrl must be a valid absolute URL");
  }
  return errors;
}

function logMarkerMatches(marker, text) {
  try {
    return new RegExp(marker.pattern, "i").test(text);
  } catch {
    return text.toLowerCase().includes(String(marker.pattern).toLowerCase());
  }
}

function observedSignalChecks(logcat, requiredLogMarkers = DEFAULT_REQUIRED_LOG_MARKERS) {
  return requiredLogMarkers.map((marker) => ({
    id: marker.id,
    pattern: marker.pattern,
    description: marker.description,
    matched: logMarkerMatches(marker, logcat),
  }));
}

function missingReleaseRoutes(routes) {
  const routeSet = new Set(routes);
  return DEFAULT_ROUTES.filter((route) => !routeSet.has(route));
}

function readReleaseSummary(summaryPath) {
  if (!summaryPath) return null;
  const resolvedSummaryPath = path.resolve(summaryPath);
  if (!fs.existsSync(resolvedSummaryPath)) {
    throw new Error(`dry-run summary file is missing: ${resolvedSummaryPath}`);
  }
  const summary = readJson(resolvedSummaryPath);
  return {
    path: normalizeSlash(resolvedSummaryPath),
    apkSha256: summary.apkSha256 ? String(summary.apkSha256) : null,
    androidVersionCode: summary.androidVersionCode ? String(summary.androidVersionCode) : null,
    releaseCandidateSha: summary.releaseCandidateSha ? String(summary.releaseCandidateSha) : null,
    artifactName: summary.artifactName ? String(summary.artifactName) : null,
    runUrl: summary.runUrl ? String(summary.runUrl) : null,
  };
}

function runAdbCommand({ adb, args, runCommand }) {
  const result = runCommand(adb, args);
  return {
    command: formatCommand(adb, args),
    status: result.status ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ok: result.status === 0 && !result.error,
    error: result.error?.message ?? null,
  };
}

function sleepMs(ms) {
  if (ms > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
}

function captureAndroidInstalledSmoke({
  root = process.cwd(),
  apkPath,
  dryRunSummaryPath,
  ciArtifactUrl,
  productionHostUrl = process.env.EXPO_PUBLIC_GSAV_WEB_URL || null,
  packageName,
  scheme,
  routes,
  requiredLogMarkers = DEFAULT_REQUIRED_LOG_MARKERS,
  allowPartialRoutes = false,
  allowMissingLogMarkers = false,
  allowMissingDeviceMetadata = false,
  allowRehearsalHost = false,
  waitMs = 3000,
  adb = process.env.ADB || "adb",
  runCommand = (command, args) => spawnSync(command, args, { encoding: "utf8" }),
} = {}) {
  if (!apkPath) throw new Error("apkPath is required");
  const resolvedApkPath = path.resolve(root, apkPath);
  if (!fs.existsSync(resolvedApkPath)) throw new Error(`APK file is missing: ${resolvedApkPath}`);

  const releaseSummary = readReleaseSummary(dryRunSummaryPath);
  const apkSha256 = sha256File(resolvedApkPath);
  const expectedApkSha256 = releaseSummary?.apkSha256 ?? null;
  const apkSha256Matches = expectedApkSha256 ? apkSha256 === expectedApkSha256 : null;
  if (expectedApkSha256 && !apkSha256Matches) {
    throw new Error("APK SHA256 does not match dry-run-summary.json.");
  }

  const defaults = readAppDefaults(root);
  const effectivePackageName = packageName || defaults.packageName;
  const effectiveScheme = scheme || defaults.scheme;
  const effectiveRoutes = routes?.length ? routes : DEFAULT_ROUTES;
  const missingRoutes = missingReleaseRoutes(effectiveRoutes);
  if (missingRoutes.length > 0 && !allowPartialRoutes) {
    throw new Error(`required release routes missing: ${missingRoutes.join(", ")}`);
  }
  if (requiredLogMarkers.length === 0 && !allowMissingLogMarkers) {
    throw new Error("required log markers cannot be empty unless allowMissingLogMarkers is true");
  }
  const hostProblems = productionHostProblems(productionHostUrl, allowRehearsalHost);
  if (hostProblems.length > 0) {
    throw new Error(hostProblems.join("; "));
  }
  const commands = [];

  const run = (args) => {
    const command = runAdbCommand({ adb, args, runCommand });
    commands.push(command);
    return command;
  };

  run(["install", "-r", resolvedApkPath]);
  const androidRelease = run(["shell", "getprop", "ro.build.version.release"]);
  const androidSdk = run(["shell", "getprop", "ro.build.version.sdk"]);
  const webViewDump = run(["shell", "dumpsys", "webviewupdate"]);
  const packageDump = run(["shell", "dumpsys", "package", effectivePackageName]);
  run(["logcat", "-c"]);
  run(["shell", "monkey", "-p", effectivePackageName, "1"]);

  const androidOsVersion = parseAndroidOsVersion(androidRelease.stdout, androidSdk.stdout);
  const androidWebViewVersion = parseAndroidWebViewVersion(webViewDump.stdout);
  const routeResults = [];
  const routeLogcat = [];
  for (const route of effectiveRoutes) {
    const uri = routeUri(route, effectiveScheme);
    run(["logcat", "-c"]);
    const start = run([
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      uri,
      effectivePackageName,
    ]);
    if (waitMs > 0) {
      sleepMs(waitMs);
    }
    const routeLogs = run(["logcat", "-d", "-v", "time", ...LOG_FILTER_ARGS]);
    const routeSignalChecks = observedSignalChecks(routeLogs.stdout, requiredLogMarkers);
    const routeSignalsOk = routeSignalChecks.every((check) => check.matched);
    routeLogcat.push(`--- ${route} (${uri}) ---\n${routeLogs.stdout.trimEnd()}`);
    routeResults.push({
      route,
      uri,
      command: start.command,
      ok: start.ok,
      observedSignalsOk: routeSignalsOk,
      observedSignalChecks: routeSignalChecks,
      logcat: routeLogs.stdout,
    });
  }

  const signalChecks = routeResults.flatMap((routeResult) => (
    routeResult.observedSignalChecks.map((check) => ({
      route: routeResult.route,
      ...check,
    }))
  ));
  const observedSignalsOk = routeResults.every((routeResult) => routeResult.observedSignalsOk);
  const installedVersionCode = parsePackageVersionCode(packageDump.stdout);
  const expectedAndroidVersionCode = releaseSummary?.androidVersionCode ?? null;
  const installedVersionCodeMatches = expectedAndroidVersionCode
    ? installedVersionCode === expectedAndroidVersionCode
    : null;
  const deviceMetadataOk = Boolean(androidOsVersion && androidWebViewVersion) || allowMissingDeviceMetadata;
  const ok = commands.every((command) => command.ok)
    && Boolean(installedVersionCode)
    && deviceMetadataOk
    && installedVersionCodeMatches !== false
    && observedSignalsOk;
  return {
    ok,
    status: ok ? "pass" : "fail",
    checkedAt: new Date().toISOString(),
    manualReviewRequired: true,
    apkPath: normalizeSlash(resolvedApkPath),
    apkSha256,
    expectedApkSha256,
    apkSha256Matches,
    releaseSummary,
    ciArtifactUrl: ciArtifactUrl ?? null,
    productionHostUrl,
    productionHostReleaseReady: productionHostProblems(productionHostUrl, false).length === 0,
    allowPartialRoutes,
    allowMissingLogMarkers,
    allowMissingDeviceMetadata,
    allowRehearsalHost,
    packageName: effectivePackageName,
    androidOsVersion,
    androidWebViewVersion,
    deviceMetadataOk,
    installedVersionCode,
    expectedAndroidVersionCode,
    installedVersionCodeMatches,
    observedSignalsOk,
    observedSignalChecks: signalChecks,
    scheme: effectiveScheme,
    routes: routeResults,
    commands,
    logcat: routeLogcat.join("\n"),
  };
}

function formatInstalledSmokeEvidence(result) {
  const lines = [
    `status: ${result.status}`,
    "manualReviewRequired: true",
    `checkedAt: ${result.checkedAt}`,
    `apkPath: ${result.apkPath}`,
    `apkSha256: ${result.apkSha256}`,
    `expectedApkSha256: ${result.expectedApkSha256 ?? "not provided"}`,
    `apkSha256MatchesDryRunSummary=${result.apkSha256Matches ?? "not checked"}`,
    `dryRunSummaryPath: ${result.releaseSummary?.path ?? "not provided"}`,
    `releaseCandidateSha: ${result.releaseSummary?.releaseCandidateSha ?? "not provided"}`,
    `workflowRunUrl: ${result.releaseSummary?.runUrl ?? "not provided"}`,
    `artifactName: ${result.releaseSummary?.artifactName ?? "not provided"}`,
    `ciArtifactUrl: ${result.ciArtifactUrl ?? "not provided"}`,
    `productionHostUrl: ${result.productionHostUrl ?? "not provided"}`,
    `productionHostReleaseReady=${result.productionHostReleaseReady}`,
    `allowPartialRoutes=${result.allowPartialRoutes}`,
    `allowMissingLogMarkers=${result.allowMissingLogMarkers}`,
    `allowMissingDeviceMetadata=${result.allowMissingDeviceMetadata}`,
    `allowRehearsalHost=${result.allowRehearsalHost}`,
    `packageName: ${result.packageName}`,
    `Android OS version: ${result.androidOsVersion ?? "not captured"}`,
    `Android WebView version: ${result.androidWebViewVersion ?? "not captured"}`,
    `installedVersionCode: ${result.installedVersionCode ?? "not captured"}`,
    `expectedAndroidVersionCode: ${result.expectedAndroidVersionCode ?? "not provided"}`,
    `installedVersionCodeMatchesDryRunSummary=${result.installedVersionCodeMatches ?? "not checked"}`,
    `observedSignalsOk=${result.observedSignalsOk}`,
    `scheme: ${result.scheme}`,
    "routes:",
  ];

  for (const route of result.routes) {
    lines.push(`- ${route.route}: ${route.ok ? "launched" : "launch-failed"}; uri: ${route.uri}; observedSignalsOk=${route.observedSignalsOk}; command: ${route.command}`);
  }

  lines.push("commands:");
  for (const command of result.commands) {
    lines.push(`- ${command.ok ? "pass" : "fail"}: ${command.command}`);
    if (command.error) lines.push(`  error: ${command.error}`);
    if (command.stderr.trim()) lines.push(`  stderr: ${command.stderr.trimEnd()}`);
  }

  lines.push("requiredManualObservations:");
  lines.push("- /explore uses embed=native, hidden web chrome, and uses the production GSAV host");
  lines.push("- /gsav-diagnostics uses embed=native and emits bridge readiness or explicit unsupported/error state");
  lines.push("- /watch/test uses embed=native and reaches bridge readiness or explicit unsupported/error state");
  lines.push("- retry UI and resume/progress behavior are observed");
  lines.push("observedSignalChecks:");
  for (const check of result.observedSignalChecks) {
    lines.push(`- ${check.matched ? "pass" : "fail"}: ${check.route} ${check.id}; pattern: ${check.pattern}; ${check.description}`);
  }
  lines.push("filteredLogcat:");
  lines.push(result.logcat.trimEnd() || "No filtered logcat output captured.");
  return `${lines.join("\n")}\n`;
}

function writeAndroidInstalledSmoke(options) {
  const outputPath = options.outputPath;
  if (!outputPath) throw new Error("outputPath is required");
  const result = captureAndroidInstalledSmoke(options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, formatInstalledSmokeEvidence(result));
  return { result, outputPath };
}

function main() {
  const args = parseArgs();
  const routes = parseRoutes(args.routes);
  const requiredLogMarkers = parseRequiredLogMarkers(args.requiredLogMarkers);
  const { result, outputPath } = writeAndroidInstalledSmoke({
    apkPath: args.apkPath,
    dryRunSummaryPath: args.dryRunSummaryPath,
    ciArtifactUrl: args.ciArtifactUrl,
    productionHostUrl: args.productionHostUrl,
    outputPath: args.outputPath,
    packageName: args.packageName,
    scheme: args.scheme,
    routes,
    requiredLogMarkers,
    allowPartialRoutes: parseBooleanOption(args.allowPartialRoutes, "--allow-partial-routes"),
    allowMissingLogMarkers: parseBooleanOption(args.allowMissingLogMarkers, "--allow-missing-log-markers"),
    allowMissingDeviceMetadata: parseBooleanOption(args.allowMissingDeviceMetadata, "--allow-missing-device-metadata"),
    allowRehearsalHost: parseBooleanOption(args.allowRehearsalHost, "--allow-rehearsal-host"),
    waitMs: args.waitMs ? Number.parseInt(args.waitMs, 10) : undefined,
  });

  console.log(JSON.stringify({
    status: result.status,
    outputPath: normalizeSlash(outputPath),
    apkPath: result.apkPath,
    apkSha256: result.apkSha256,
    expectedApkSha256: result.expectedApkSha256,
    apkSha256Matches: result.apkSha256Matches,
    productionHostUrl: result.productionHostUrl,
    productionHostReleaseReady: result.productionHostReleaseReady,
    allowPartialRoutes: result.allowPartialRoutes,
    allowMissingLogMarkers: result.allowMissingLogMarkers,
    allowMissingDeviceMetadata: result.allowMissingDeviceMetadata,
    allowRehearsalHost: result.allowRehearsalHost,
    androidOsVersion: result.androidOsVersion,
    androidWebViewVersion: result.androidWebViewVersion,
    deviceMetadataOk: result.deviceMetadataOk,
    installedVersionCode: result.installedVersionCode,
    expectedAndroidVersionCode: result.expectedAndroidVersionCode,
    installedVersionCodeMatches: result.installedVersionCodeMatches,
    observedSignalsOk: result.observedSignalsOk,
    observedSignalChecks: result.observedSignalChecks,
    packageName: result.packageName,
    routes: result.routes.map((route) => route.route),
    manualReviewRequired: result.manualReviewRequired,
  }, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_ROUTES,
  DEFAULT_REQUIRED_LOG_MARKERS,
  captureAndroidInstalledSmoke,
  formatInstalledSmokeEvidence,
  isLocalHostname,
  missingReleaseRoutes,
  observedSignalChecks,
  parseArgs,
  parseAndroidOsVersion,
  parseAndroidWebViewVersion,
  parsePackageVersionCode,
  parseBooleanOption,
  parseRequiredLogMarkers,
  parseRoutes,
  productionHostProblems,
  readAppDefaults,
  readReleaseSummary,
  routeUri,
  sha256File,
  sleepMs,
  writeAndroidInstalledSmoke,
};
