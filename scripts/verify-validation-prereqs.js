#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const DEFAULT_APK_PATH = "android/app/build/outputs/apk/release/app-release.apk";
const DEFAULT_MANIFEST_PATH = "android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml";
const ANDROID_METADATA_TOOLS = [
  { command: "aapt", envName: "AAPT", label: "aapt dump badging" },
  { command: "apkanalyzer", envName: "APKANALYZER", label: "apkanalyzer manifest print" },
  { command: "bundletool", envName: "BUNDLETOOL", label: "bundletool dump manifest" },
];
const TRUSTED_EVIDENCE_REPOSITORIES = [
  "opsiclear/diveo",
  "opsiclear-web/diveo",
  "opsiclear/gsav-hosting",
];

const REQUIRED_PRODUCTION_URLS = [
  {
    id: "production-gsav-web-url",
    label: "production GSAV web URL",
    envNames: ["EXPO_PUBLIC_GSAV_WEB_URL", "GSAV_WEB_URL"],
  },
  {
    id: "production-gsav-catalog-url",
    label: "production GSAV catalog URL",
    envNames: ["EXPO_PUBLIC_GSAV_CATALOG_URL", "GSAV_CATALOG_URL"],
  },
  {
    id: "production-supabase-url",
    label: "production Supabase URL",
    envNames: ["EXPO_PUBLIC_GSAV_SUPABASE_URL", "GSAV_SUPABASE_URL"],
  },
  {
    id: "production-range-probe-url",
    label: "production .gsav range probe URL",
    envNames: ["GSAV_RANGE_PROBE_URL", "GSAV_NATIVE_PREFLIGHT_RANGE_URL"],
    mustEndWithGsav: true,
  },
  {
    id: "production-host-identity-url",
    label: "production GSAV host identity URL",
    envNames: ["GSAV_HOST_IDENTITY_URL", "GSAV_HOST_BUILD_METADATA_URL"],
  },
];

const REQUIRED_SECRET_VALUES = [
  {
    id: "production-supabase-anon-key",
    label: "production Supabase anon key",
    envNames: ["EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY", "GSAV_SUPABASE_ANON_KEY"],
  },
  {
    id: "production-hosting-commit",
    label: "production GSAV host/build identity",
    envNames: ["GSAV_HOSTING_COMMIT"],
  },
];

const REQUIRED_IOS_VALIDATION_FIELDS = [
  {
    id: "owner",
    label: "iOS validation owner",
    envNames: ["IOS_VALIDATION_OWNER", "GSAV_IOS_VALIDATION_OWNER"],
    nextAction: "Set IOS_VALIDATION_OWNER to the person, team handle, GitHub issue, or workflow run that owns iOS validation.",
  },
  {
    id: "deviceIdentity",
    label: "iOS simulator/device identity",
    envNames: ["IOS_VALIDATION_DEVICE", "IOS_SIMULATOR_DEVICE", "GSAV_IOS_DEVICE"],
    nextAction: "Set IOS_VALIDATION_DEVICE to the simulator or physical device name/UDID used for WKWebView validation.",
  },
  {
    id: "iosVersion",
    label: "iOS version",
    envNames: ["IOS_VALIDATION_VERSION", "IOS_VERSION", "GSAV_IOS_VERSION"],
    pattern: /(?:^|\b)i?OS?\s*\d|^\d+(?:\.\d+){0,2}$/i,
    nextAction: "Set IOS_VALIDATION_VERSION to the iOS version observed during validation.",
  },
  {
    id: "wkWebViewVersion",
    label: "WKWebView/WebKit version",
    envNames: ["IOS_WKWEBVIEW_VERSION", "IOS_WEBKIT_VERSION", "GSAV_IOS_WKWEBVIEW_VERSION"],
    pattern: /(?:WKWebView|WebKit|Safari)?\s*\d+(?:\.\d+){0,3}/i,
    nextAction: "Set IOS_WKWEBVIEW_VERSION or IOS_WEBKIT_VERSION to the WebKit/WKWebView version observed during validation.",
  },
  {
    id: "artifactUrl",
    label: "iOS validation artifact URL",
    envNames: ["IOS_VALIDATION_ARTIFACT_URL", "IOS_ARTIFACT_URL", "GSAV_IOS_VALIDATION_ARTIFACT_URL"],
    nextAction: "Set IOS_VALIDATION_ARTIFACT_URL to a trusted direct GitHub Actions artifact, release asset download, or docs/qa-evidence blob containing iOS screenshots, video, or filtered logs.",
  },
  {
    id: "artifactSha256",
    label: "iOS validation artifact SHA256",
    envNames: ["IOS_VALIDATION_ARTIFACT_SHA256", "IOS_ARTIFACT_SHA256", "GSAV_IOS_VALIDATION_ARTIFACT_SHA256"],
    pattern: /^[a-f0-9]{64}$/i,
    nextAction: "Set IOS_VALIDATION_ARTIFACT_SHA256 to the 64-hex checksum of the reviewed iOS screenshot, video, log bundle, or artifact manifest.",
  },
];
const IOS_VALIDATION_ARTIFACT_PATH_ENV_NAMES = [
  "IOS_VALIDATION_ARTIFACT_PATH",
  "IOS_ARTIFACT_PATH",
  "GSAV_IOS_VALIDATION_ARTIFACT_PATH",
];

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const iosArtifactPath = resolveEnvValue(env, IOS_VALIDATION_ARTIFACT_PATH_ENV_NAMES).value || null;
  const options = {
    root: env.VALIDATION_PREREQS_ROOT || process.cwd(),
    apkPath: DEFAULT_APK_PATH,
    manifestPath: env.ANDROID_MANIFEST_PATH || DEFAULT_MANIFEST_PATH,
    iosArtifactPath,
    outputPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      if (!argv[index + 1]) throw new Error("--root requires a non-empty value.");
      options.root = argv[index + 1];
      index += 1;
    } else if (arg === "--apk-path") {
      if (!argv[index + 1]) throw new Error("--apk-path requires a non-empty value.");
      options.apkPath = argv[index + 1];
      index += 1;
    } else if (arg === "--manifest-path") {
      if (!argv[index + 1]) throw new Error("--manifest-path requires a non-empty value.");
      options.manifestPath = argv[index + 1];
      index += 1;
    } else if (arg === "--ios-artifact-path") {
      if (!argv[index + 1]) throw new Error("--ios-artifact-path requires a non-empty value.");
      options.iosArtifactPath = argv[index + 1];
      index += 1;
    } else if (arg === "--output-path") {
      if (!argv[index + 1]) throw new Error("--output-path requires a non-empty value.");
      options.outputPath = argv[index + 1];
      index += 1;
    } else {
      throw new Error("Usage: node scripts/verify-validation-prereqs.js [--root <path>] [--apk-path <path>] [--manifest-path <path>] [--ios-artifact-path <path>] [--output-path <path>]");
    }
  }

  if (!options.apkPath || !options.manifestPath) {
    throw new Error("Both --apk-path and --manifest-path require non-empty values.");
  }
  if (!options.root) {
    throw new Error("--root requires a non-empty value.");
  }
  if (options.outputPath === "") {
    throw new Error("--output-path requires a non-empty value.");
  }

  return options;
}

function commandExists(command, {
  platform = process.platform,
  runCommand = spawnSync,
} = {}) {
  const result = platform === "win32"
    ? runCommand("where.exe", [command], { encoding: "utf8" })
    : runCommand("sh", ["-c", `command -v ${quoteSh(command)}`], { encoding: "utf8" });
  return result.status === 0;
}

function quoteSh(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function resolveEnvValue(env, names) {
  for (const name of names) {
    const value = (env[name] || "").trim();
    if (value) return { name, value };
  }
  return { name: names[0], value: "" };
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function isLocalOrPrivateHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (/^(?:127|10)\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  if (/^169\.254\./.test(normalized)) return true;
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 100 && second >= 64 && second <= 127) return true;
  }
  return normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:");
}

function urlProblems(value, { label, mustEndWithGsav = false } = {}) {
  const problems = [];
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return [`${label} must be a valid URL.`];
  }

  if (parsed.protocol !== "https:") {
    problems.push(`${label} must use https.`);
  }
  if (isLocalOrPrivateHostname(parsed.hostname)) {
    problems.push(`${label} must not use localhost, emulator, link-local, or private LAN hosts.`);
  }
  if (mustEndWithGsav && !parsed.pathname.toLowerCase().endsWith(".gsav")) {
    problems.push(`${label} must point to a .gsav fixture.`);
  }

  return problems;
}

function trustedGithubEvidenceUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
      return false;
    }
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const repository = pathParts.slice(0, 2).join("/").toLowerCase();
    if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) {
      return false;
    }
    const rest = pathParts.slice(2).join("/");
    return /^actions\/runs\/\d+\/artifacts\/[^/]+$/i.test(rest)
      || /^releases\/download\/[^/]+\/[^/]+$/i.test(rest)
      || /^blob\/[^/]+\/docs\/qa-evidence\/.+/i.test(rest);
  } catch {
    return false;
  }
}

function weakIdentityValue(value) {
  return !value
    || /^(?:unknown|unavailable|placeholder|example|todo|tbd|null|undefined|owner|release owner|native release owner)$/i.test(value)
    || /^<.+>$/.test(value);
}

function iosExecutorProof({ env, platform, xcrunAvailable }) {
  const explicit = resolveEnvValue(env, [
    "IOS_VALIDATION_EXECUTOR_PROOF",
    "IOS_EXECUTOR_PROOF",
    "GSAV_IOS_EXECUTOR_PROOF",
  ]);
  if (explicit.value) {
    return {
      present: true,
      source: explicit.name,
      value: explicit.value,
    };
  }
  if (platform === "darwin" && xcrunAvailable) {
    return {
      present: true,
      source: "platform+xcrun",
      value: "macOS with xcrun available",
    };
  }
  return {
    present: false,
    source: explicit.name,
    value: null,
  };
}

function iosValidationStatus({ env, platform, xcrunAvailable }) {
  const fields = {};
  for (const spec of REQUIRED_IOS_VALIDATION_FIELDS) {
    const resolved = resolveEnvValue(env, spec.envNames);
    fields[spec.id] = {
      name: resolved.name,
      present: Boolean(resolved.value),
      value: resolved.value || null,
    };
  }
  return {
    ...fields,
    executorProof: iosExecutorProof({ env, platform, xcrunAvailable }),
  };
}

function pathStatus(root, relativeOrAbsolutePath) {
  const absolutePath = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(root, relativeOrAbsolutePath);
  return {
    path: relativeOrAbsolutePath,
    exists: fs.existsSync(absolutePath),
  };
}

function isInsidePath(root, filePath) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveFromRoot(root, relativeOrAbsolutePath) {
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(root, relativeOrAbsolutePath);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function pathContainmentProblem(root, relativeOrAbsolutePath, label) {
  const absolutePath = resolveFromRoot(root, relativeOrAbsolutePath);
  return isInsidePath(root, absolutePath)
    ? null
    : `${label} must stay inside validation root: ${relativeOrAbsolutePath}`;
}

function parseAdbDevicesOutput(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^List of devices/i.test(line))
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    })
    .filter((device) => device.serial && device.state === "device")
    .map((device) => device.serial);
}

function firstNonEmptyLine(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function adbText({
  runCommand = spawnSync,
  args,
}) {
  const result = runCommand("adb", args, { encoding: "utf8" });
  if (result.status !== 0) {
    return {
      ok: false,
      stdout: "",
      error: (result.stderr || result.stdout || `adb ${args.join(" ")} failed`).trim(),
    };
  }
  return {
    ok: true,
    stdout: result.stdout || "",
    error: "",
  };
}

function adbShellText({ serial, shellArgs, runCommand = spawnSync }) {
  return adbText({
    runCommand,
    args: ["-s", serial, "shell", ...shellArgs],
  });
}

function cleanPackageName(value) {
  const text = String(value || "").trim().replace(/[),;]+$/g, "");
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/i.test(text) ? text : "";
}

function cleanVersion(value) {
  const text = String(value || "").trim().replace(/^[("']+|[)"',;]+$/g, "");
  const version = /([0-9]+(?:\.[0-9A-Za-z_-]+){1,6})/.exec(text)?.[1]
    || (/^[0-9][0-9A-Za-z._-]*$/.test(text) ? text : "");
  return version || "";
}

function parseWebViewPackageOutput(stdout) {
  const text = String(stdout || "");
  const tupleMatch = /Current WebView package[^:]*:\s*\(\s*([^,\s)]+)\s*,\s*([^)]+?)\s*\)/i.exec(text);
  const slashMatch = /\b([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)\/([0-9][0-9A-Za-z._-]*)\b/i.exec(text);
  const packageMatch = tupleMatch?.[1]
    || slashMatch?.[1]
    || /(?:packageName|package|name)\s*[:=]\s*([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)/i.exec(text)?.[1]
    || /\b([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*(?:webview|chrome)[a-z0-9_.]*)\b/i.exec(text)?.[1]
    || "";
  const versionMatch = tupleMatch?.[2]
    || slashMatch?.[2]
    || /versionName\s*=\s*([0-9][^\s,)]+)/i.exec(text)?.[1]
    || /version\s*[:=]\s*([0-9][^\s,)]+)/i.exec(text)?.[1]
    || "";
  return {
    packageName: cleanPackageName(packageMatch),
    version: cleanVersion(versionMatch),
  };
}

function androidDeviceProp({ serial, prop, label, runCommand }) {
  const result = adbShellText({ serial, shellArgs: ["getprop", prop], runCommand });
  return {
    value: result.ok ? firstNonEmptyLine(result.stdout) : "",
    error: result.ok ? "" : `${label}: ${result.error}`,
  };
}

function collectAndroidDeviceMetadata(serial, {
  runCommand = spawnSync,
} = {}) {
  const errors = [];
  const prop = (name, label) => {
    const result = androidDeviceProp({ serial, prop: name, label, runCommand });
    if (result.error) errors.push(result.error);
    return result.value;
  };

  const model = prop("ro.product.model", "model");
  const androidVersion = prop("ro.build.version.release", "Android release");
  const apiLevel = prop("ro.build.version.sdk", "Android API");
  const buildFingerprint = prop("ro.build.fingerprint", "build fingerprint");
  const buildIncremental = prop("ro.build.version.incremental", "build incremental");

  let webViewSource = null;
  let webView = { packageName: "", version: "" };
  const webViewUpdate = adbShellText({ serial, shellArgs: ["dumpsys", "webviewupdate"], runCommand });
  if (webViewUpdate.ok) {
    webView = parseWebViewPackageOutput(webViewUpdate.stdout);
    webViewSource = "dumpsys webviewupdate";
  } else {
    errors.push(`WebView update: ${webViewUpdate.error}`);
  }

  if (!webView.packageName || !webView.version) {
    const currentWebView = adbShellText({
      serial,
      shellArgs: ["cmd", "webviewupdate", "getCurrentWebViewPackage"],
      runCommand,
    });
    if (currentWebView.ok) {
      const parsed = parseWebViewPackageOutput(currentWebView.stdout);
      webView = {
        packageName: webView.packageName || parsed.packageName,
        version: webView.version || parsed.version,
      };
      if (parsed.packageName || parsed.version) webViewSource = "cmd webviewupdate getCurrentWebViewPackage";
    } else {
      errors.push(`Current WebView package: ${currentWebView.error}`);
    }
  }

  if (webView.packageName && !webView.version) {
    const packageDump = adbShellText({
      serial,
      shellArgs: ["dumpsys", "package", webView.packageName],
      runCommand,
    });
    if (packageDump.ok) {
      const parsed = parseWebViewPackageOutput(packageDump.stdout);
      webView.version = parsed.version;
      if (parsed.version) webViewSource = `dumpsys package ${webView.packageName}`;
    } else {
      errors.push(`WebView package dump: ${packageDump.error}`);
    }
  }

  const missing = [];
  if (!model) missing.push("model");
  if (!androidVersion) missing.push("Android version");
  if (!/^\d+$/.test(apiLevel)) missing.push("Android API level");
  if (!buildFingerprint && !buildIncremental) missing.push("build fingerprint or incremental build");
  if (!webView.packageName) missing.push("WebView package");
  if (!webView.version) missing.push("WebView version");

  return {
    serial,
    model,
    androidVersion,
    apiLevel,
    buildFingerprint,
    buildIncremental,
    webViewPackageName: webView.packageName,
    webViewVersion: webView.version,
    webViewSource,
    metadataOk: missing.length === 0,
    missing,
    errors,
  };
}

function collectAndroidDevicesMetadata({
  devices,
  runCommand = spawnSync,
} = {}) {
  return devices.map((serial) => collectAndroidDeviceMetadata(serial, { runCommand }));
}

function connectedAndroidDevices({
  runCommand = spawnSync,
} = {}) {
  const result = runCommand("adb", ["devices"], { encoding: "utf8" });
  if (result.status !== 0) {
    return {
      ok: false,
      devices: [],
      error: (result.stderr || result.stdout || "adb devices failed").trim(),
    };
  }
  return {
    ok: true,
    devices: parseAdbDevicesOutput(result.stdout),
    error: "",
  };
}

function metadataToolStatus({ env, hasCommand }) {
  const tools = {};
  for (const tool of ANDROID_METADATA_TOOLS) {
    const envValue = (env[tool.envName] || "").trim();
    tools[tool.command] = {
      command: tool.command,
      envName: tool.envName,
      label: tool.label,
      commandAvailable: hasCommand(tool.command),
      envConfigured: Boolean(envValue),
      envValue: envValue || null,
    };
  }
  return tools;
}

function hasMetadataTool(tools) {
  return Object.values(tools).some((tool) => tool.commandAvailable || tool.envConfigured);
}

function blocker(id, requirement, reason, nextAction) {
  return { id, requirement, reason, nextAction };
}

function analyzeValidationPrereqs({
  root = process.cwd(),
  env = process.env,
  platform = process.platform,
  apkPath = DEFAULT_APK_PATH,
  manifestPath = env.ANDROID_MANIFEST_PATH || DEFAULT_MANIFEST_PATH,
  iosArtifactPath = null,
  hasCommand = (command) => commandExists(command, { platform }),
  runCommand = spawnSync,
  requirePathsInsideRoot = false,
} = {}) {
  const blockers = [];
  const warnings = [];
  const checked = {
    commands: {},
    env: {},
    paths: {
      apk: pathStatus(root, apkPath),
      manifest: pathStatus(root, manifestPath),
      androidProject: pathStatus(root, "android"),
    },
    android: {
      connectedDevices: [],
      deviceMetadata: [],
    },
    androidMetadataTools: {},
    ios: {},
  };

  for (const command of ["adb", "java", "npx"]) {
    checked.commands[command] = hasCommand(command);
  }
  checked.commands.gh = hasCommand("gh");
  checked.commands.emulator = hasCommand("emulator");
  checked.commands.xcrun = hasCommand("xcrun");
  checked.androidMetadataTools = metadataToolStatus({ env, hasCommand });
  checked.ios = iosValidationStatus({
    env,
    platform,
    xcrunAvailable: checked.commands.xcrun,
  });
  const iosArtifactPathEnv = resolveEnvValue(env, IOS_VALIDATION_ARTIFACT_PATH_ENV_NAMES);
  const effectiveIosArtifactPath = iosArtifactPath || iosArtifactPathEnv.value || null;
  const iosArtifactAbsolutePath = effectiveIosArtifactPath
    ? resolveFromRoot(root, effectiveIosArtifactPath)
    : null;
  const iosArtifactPathInsideRoot = !iosArtifactAbsolutePath
    || !requirePathsInsideRoot
    || isInsidePath(root, iosArtifactAbsolutePath);
  const iosArtifactExists = Boolean(iosArtifactAbsolutePath && iosArtifactPathInsideRoot && fs.existsSync(iosArtifactAbsolutePath));
  const computedArtifactSha256 = iosArtifactExists && iosArtifactPathInsideRoot
    ? sha256File(iosArtifactAbsolutePath)
    : null;
  const declaredArtifactSha256 = checked.ios.artifactSha256?.value || null;
  const declaredArtifactSha256Concrete = /^[a-f0-9]{64}$/i.test(String(declaredArtifactSha256 || ""));
  checked.ios.artifactPath = {
    name: iosArtifactPath ? "--ios-artifact-path" : iosArtifactPathEnv.name,
    present: Boolean(effectiveIosArtifactPath),
    value: effectiveIosArtifactPath,
    exists: iosArtifactExists,
    insideRoot: iosArtifactPathInsideRoot,
  };
  checked.ios.computedArtifactSha256 = {
    present: Boolean(computedArtifactSha256),
    value: computedArtifactSha256,
  };
  checked.ios.artifactSha256Matches = computedArtifactSha256 && declaredArtifactSha256Concrete
    ? computedArtifactSha256.toLowerCase() === declaredArtifactSha256.toLowerCase()
    : null;

  if (!checked.commands.adb) {
    blockers.push(blocker(
      "android-adb",
      "Android device route QA and installed APK smoke",
      "`adb` is not available.",
      "Install Android SDK platform-tools or set PATH/ADB before Android validation.",
    ));
  } else {
    const deviceStatus = connectedAndroidDevices({ runCommand });
    checked.android.connectedDevices = deviceStatus.devices;
    checked.android.adbDevicesOk = deviceStatus.ok;
    if (deviceStatus.error) checked.android.adbDevicesError = deviceStatus.error;
    if (!deviceStatus.ok) {
      blockers.push(blocker(
        "android-adb-devices",
        "Android connected-device proof",
        "`adb devices` did not complete successfully.",
        "Start adb, connect a device or emulator, and rerun validation prerequisites.",
      ));
    } else if (deviceStatus.devices.length === 0) {
      blockers.push(blocker(
        "android-connected-device",
        "Android device route QA and installed APK smoke",
        "`adb devices` did not list a connected device in device state.",
        "Connect an Android device or start an emulator before Android validation.",
      ));
    } else {
      checked.android.deviceMetadata = collectAndroidDevicesMetadata({
        devices: deviceStatus.devices,
        runCommand,
      });
      const completeMetadata = checked.android.deviceMetadata.filter((device) => device.metadataOk);
      const webViewMetadata = checked.android.deviceMetadata.filter((device) => device.webViewPackageName && device.webViewVersion);
      for (const device of checked.android.deviceMetadata.filter((entry) => !entry.metadataOk)) {
        warnings.push(`Android metadata incomplete for ${device.serial}: ${device.missing.join(", ")}`);
      }
      if (completeMetadata.length === 0) {
        blockers.push(blocker(
          "android-device-metadata",
          "Android validation target identity",
          "No connected Android device had complete model, OS/API, build, and WebView metadata.",
          "Collect device metadata from adb getprop and WebView update info before publish-counted Android validation.",
        ));
      }
      if (webViewMetadata.length === 0) {
        blockers.push(blocker(
          "android-webview-version",
          "Android WebView validation target identity",
          "No connected Android device reported both WebView package and version.",
          "Run `adb shell dumpsys webviewupdate` on the validation target and rerun prerequisites.",
        ));
      }
    }
  }
  if (!checked.commands.java) {
    blockers.push(blocker(
      "android-java",
      "Gradle release APK build",
      "`java` is not available.",
      "Install JDK 17 before building the Android release artifact.",
    ));
  }
  if (!checked.commands.npx) {
    blockers.push(blocker(
      "expo-npx",
      "Expo prebuild and local device launch commands",
      "`npx` is not available.",
      "Install Node/npm dependencies before running Expo validation commands.",
    ));
  }
  if (!checked.commands.gh) {
    blockers.push(blocker(
      "github-cli",
      "release dry-run no-publish proof and evidence artifact review",
      "`gh` is not available.",
      "Install and authenticate GitHub CLI before collecting or reviewing release workflow evidence.",
    ));
  }
  if (!hasMetadataTool(checked.androidMetadataTools)) {
    blockers.push(blocker(
      "android-version-metadata-tool",
      "generated APK versionCode metadata",
      "No generated APK metadata tool is available.",
      "Install aapt, apkanalyzer, or bundletool, or set AAPT, APKANALYZER, or BUNDLETOOL before artifact validation.",
    ));
  }
  if (!checked.commands.emulator) {
    warnings.push("`emulator` is unavailable; Android validation must use a physical device or another machine.");
  }
  if (platform !== "darwin" || !checked.commands.xcrun) {
    warnings.push("iOS WKWebView validation requires macOS with Xcode/xcrun or a separate physical-device workflow.");
  }

  if (!checked.ios.executorProof.present || weakIdentityValue(checked.ios.executorProof.value)) {
    blockers.push(blocker(
      "ios-executor-proof",
      "iOS WKWebView route and negative validation",
      "iOS validation executor proof is missing.",
      "Set IOS_VALIDATION_EXECUTOR_PROOF to macOS/Xcode/xcrun evidence or physical iOS-device proof, or run on macOS with xcrun available.",
    ));
  }
  for (const spec of REQUIRED_IOS_VALIDATION_FIELDS) {
    const entry = checked.ios[spec.id];
    const weak = weakIdentityValue(entry?.value);
    const patternMismatch = entry?.value && spec.pattern && !spec.pattern.test(entry.value);
    if (!entry?.present || weak || patternMismatch) {
      blockers.push(blocker(
        `ios-${spec.id}`,
        "iOS WKWebView route and negative validation",
        `${spec.label} is missing or not concrete.`,
        spec.nextAction,
      ));
    }
  }
  if (checked.ios.artifactUrl?.present && !trustedGithubEvidenceUrl(checked.ios.artifactUrl.value)) {
    blockers.push(blocker(
      "ios-artifactUrl",
      "durable iOS WKWebView validation artifact",
      "iOS validation artifact URL must be a trusted direct GitHub Actions artifact, release asset download, or docs/qa-evidence blob under opsiclear/diveo, OpsiClear-Web/diveo, or opsiclear/gsav-hosting.",
      "Upload or link the reviewed iOS screenshot, recording, or filtered-log bundle as direct trusted GitHub evidence.",
    ));
  }
  if (!checked.ios.artifactPath.present) {
    blockers.push(blocker(
      "ios-artifactPath",
      "byte-verified iOS WKWebView validation artifact",
      "IOS_VALIDATION_ARTIFACT_PATH is missing.",
      "Download or place the reviewed iOS artifact in the validation root and set IOS_VALIDATION_ARTIFACT_PATH or --ios-artifact-path.",
    ));
  } else {
    if (requirePathsInsideRoot) {
      const iosArtifactContainmentProblem = pathContainmentProblem(root, checked.ios.artifactPath.value, "iOS artifact path");
      if (iosArtifactContainmentProblem) {
        blockers.push(blocker(
          "ios-artifact-path-outside-root",
          "downloaded iOS validation artifact path",
          iosArtifactContainmentProblem,
          "Use a validation-root-relative iOS artifact path when running with --root.",
        ));
      }
    }
    if (!checked.ios.artifactPath.exists) {
      blockers.push(blocker(
        "ios-artifactPath",
        "byte-verified iOS WKWebView validation artifact",
        `iOS validation artifact does not exist at ${checked.ios.artifactPath.value}.`,
        "Download or place the reviewed iOS artifact at IOS_VALIDATION_ARTIFACT_PATH before validation.",
      ));
    } else if (declaredArtifactSha256Concrete && checked.ios.artifactSha256Matches !== true) {
      blockers.push(blocker(
        "ios-artifactSha256Matches",
        "byte-verified iOS WKWebView validation artifact",
        "Computed iOS artifact SHA256 does not match IOS_VALIDATION_ARTIFACT_SHA256.",
        "Use the SHA256 of the exact reviewed iOS artifact bytes.",
      ));
    }
  }

  for (const spec of REQUIRED_PRODUCTION_URLS) {
    const resolved = resolveEnvValue(env, spec.envNames);
    checked.env[spec.id] = {
      name: resolved.name,
      present: Boolean(resolved.value),
      value: resolved.value || null,
    };
    if (!resolved.value) {
      blockers.push(blocker(
        spec.id,
        spec.label,
        `${spec.envNames.join(" or ")} is missing.`,
        "Set the production secret/env value before collecting publish-counted evidence.",
      ));
      continue;
    }
    for (const reason of urlProblems(resolved.value, spec)) {
      blockers.push(blocker(spec.id, spec.label, reason, "Use a non-local HTTPS production value."));
    }
  }

  for (const spec of REQUIRED_SECRET_VALUES) {
    const resolved = resolveEnvValue(env, spec.envNames);
    const present = Boolean(resolved.value);
    checked.env[spec.id] = {
      name: resolved.name,
      present,
      value: spec.id === "production-supabase-anon-key" && present ? "[redacted]" : resolved.value || null,
    };
    if (!present) {
      blockers.push(blocker(
        spec.id,
        spec.label,
        `${spec.envNames.join(" or ")} is missing.`,
        "Set the production secret/env value before release dry-run validation.",
      ));
    } else if (spec.id === "production-hosting-commit" && weakIdentityValue(resolved.value)) {
      blockers.push(blocker(
        spec.id,
        spec.label,
        "GSAV_HOSTING_COMMIT must be a concrete deployed commit/build identity.",
        "Use the exact deployed gsav-hosting commit, build ID, or release artifact identity.",
      ));
    }
  }

  for (const qaKey of ["EXPO_PUBLIC_GSAV_QA_CONTROLS", "EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS"]) {
    const value = (env[qaKey] || "").trim();
    checked.env[qaKey] = value || null;
    if (value && value !== "0") {
      blockers.push(blocker(
        `qa-flag-${qaKey}`,
        "production dry-run and artifact validation",
        `${qaKey} must be unset or 0 for production validation.`,
        "Use QA flags only for scoped device negative validation builds.",
      ));
    }
  }

  if (!checked.paths.androidProject.exists) {
    warnings.push("Generated android/ project is missing; run `npx expo prebuild --platform android --no-install` before local Gradle artifact validation.");
  }
  if (!checked.paths.apk.exists) {
    blockers.push(blocker(
      "release-apk",
      "real release APK artifact scan and installed APK smoke",
      `Release APK does not exist at ${apkPath}.`,
      "Build or download the exact release APK before artifact and installed-smoke validation.",
    ));
  }
  if (requirePathsInsideRoot) {
    const apkContainmentProblem = pathContainmentProblem(root, apkPath, "APK path");
    if (apkContainmentProblem) {
      blockers.push(blocker(
        "release-apk-path-outside-root",
        "downloaded release APK artifact path",
        apkContainmentProblem,
        "Use an artifact-root-relative APK path when running with --root.",
      ));
    }
    const manifestContainmentProblem = pathContainmentProblem(root, manifestPath, "merged manifest path");
    if (manifestContainmentProblem) {
      blockers.push(blocker(
        "merged-manifest-path-outside-root",
        "downloaded merged manifest artifact path",
        manifestContainmentProblem,
        "Use an artifact-root-relative manifest path when running with --root.",
      ));
    }
  }
  if (!checked.paths.manifest.exists) {
    blockers.push(blocker(
      "merged-manifest",
      "merged Android manifest scan",
      `Merged Android manifest does not exist at ${manifestPath}.`,
      "Point --manifest-path or ANDROID_MANIFEST_PATH at the generated release manifest.",
    ));
  }

  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? "pass" : "fail",
    checked,
    blockers,
    warnings,
  };
}

function writeJsonOutput(root, outputPath, payload, { requireInsideRoot = false } = {}) {
  if (!outputPath) return null;
  const absolutePath = resolveFromRoot(root, outputPath);
  if (requireInsideRoot && !isInsidePath(root, absolutePath)) {
    throw new Error(`--output-path must stay inside validation root when --root is set: ${outputPath}`);
  }
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(payload, null, 2)}\n`);
  return absolutePath;
}

function main() {
  try {
    const options = parseArgs();
    const explicitRoot = process.argv.slice(2).includes("--root")
      || Boolean(process.env.VALIDATION_PREREQS_ROOT);
    const result = analyzeValidationPrereqs({
      ...options,
      requirePathsInsideRoot: explicitRoot,
    });
    const payload = {
      checkedAt: new Date().toISOString(),
      ...result,
    };
    writeJsonOutput(options.root, options.outputPath, payload, { requireInsideRoot: explicitRoot });
    console.log(JSON.stringify(payload, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_APK_PATH,
  DEFAULT_MANIFEST_PATH,
  ANDROID_METADATA_TOOLS,
  REQUIRED_PRODUCTION_URLS,
  REQUIRED_SECRET_VALUES,
  REQUIRED_IOS_VALIDATION_FIELDS,
  IOS_VALIDATION_ARTIFACT_PATH_ENV_NAMES,
  analyzeValidationPrereqs,
  collectAndroidDeviceMetadata,
  collectAndroidDevicesMetadata,
  commandExists,
  connectedAndroidDevices,
  isInsidePath,
  isLocalOrPrivateHostname,
  parseAdbDevicesOutput,
  parseWebViewPackageOutput,
  parseArgs,
  pathContainmentProblem,
  trustedGithubEvidenceUrl,
  urlProblems,
  weakIdentityValue,
  writeJsonOutput,
};
