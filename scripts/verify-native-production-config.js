#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadResolvedAppConfig(root, env = process.env) {
  const appJson = readJson(path.join(root, "app.json"));
  const appConfigPath = path.join(root, "app.config.js");
  if (!fs.existsSync(appConfigPath)) {
    return {
      appConfig: appJson,
      source: "app.json"
    };
  }

  delete require.cache[require.resolve(appConfigPath)];
  const dynamicConfig = require(appConfigPath);
  if (typeof dynamicConfig.resolveExpoConfig === "function") {
    return {
      appConfig: { expo: dynamicConfig.resolveExpoConfig(env, appJson.expo ?? {}) },
      source: "app.config.js#resolveExpoConfig"
    };
  }
  if (typeof dynamicConfig === "function") {
    return {
      appConfig: { expo: dynamicConfig({ config: appJson.expo ?? {} }) },
      source: "app.config.js"
    };
  }
  return {
    appConfig: dynamicConfig?.expo ? dynamicConfig : { expo: dynamicConfig },
    source: "app.config.js"
  };
}

// Security gate: reject any production GSAV origin that resolves to a local/private host.
// This is what stops a release accidentally shipping with a dev URL baked into the APK
// (127.0.0.1:5191, the Android emulator's 10.0.2.2, link-local, or a LAN box).
function isLocalHostname(hostname) {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized === "10.0.2.2" ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [first, second] = parts;
    if (first === 10) return true;
    if (first === 127) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;
  }

  return false;
}

function productionGsavUrl(env, easConfig) {
  const easProductionEnv = easConfig?.build?.production?.env ?? {};
  return env.EXPO_PUBLIC_GSAV_WEB_URL || easProductionEnv.EXPO_PUBLIC_GSAV_WEB_URL || "";
}

function validateNativeProductionConfig({ appConfig, easConfig, packageJson, env = {} }) {
  const errors = [];
  const warnings = [];
  const expo = appConfig?.expo ?? {};
  const android = expo.android ?? {};
  const schemes = Array.isArray(expo.scheme) ? expo.scheme : [expo.scheme].filter(Boolean);
  const productionEnv = easConfig?.build?.production?.env ?? {};
  const gsavUrl = productionGsavUrl(env, easConfig);

  if (!packageJson?.scripts?.["gsav:preflight"]) {
    errors.push("package.json must expose gsav:preflight.");
  }

  if (!packageJson?.scripts?.["verify:native-production-config"]) {
    errors.push("package.json must expose verify:native-production-config.");
  }

  if (!schemes.includes("gsav")) {
    errors.push("app config must include the gsav URL scheme.");
  }

  if (android.usesCleartextTraffic === true) {
    errors.push("android.usesCleartextTraffic must be false or omitted for production builds.");
  }

  if (!gsavUrl) {
    errors.push("Production must provide EXPO_PUBLIC_GSAV_WEB_URL in the environment or EAS production profile.");
  } else {
    try {
      const parsed = new URL(gsavUrl);
      if (parsed.protocol !== "https:") {
        errors.push("Production EXPO_PUBLIC_GSAV_WEB_URL must use https.");
      }
      if (isLocalHostname(parsed.hostname)) {
        errors.push("Production EXPO_PUBLIC_GSAV_WEB_URL must not point at localhost, emulator, link-local, or private LAN hosts.");
      }
      if (parsed.username || parsed.password) {
        errors.push("Production EXPO_PUBLIC_GSAV_WEB_URL must not contain credentials.");
      }
    } catch {
      errors.push("Production EXPO_PUBLIC_GSAV_WEB_URL must be a valid absolute URL.");
    }
  }

  if (productionEnv.EXPO_PUBLIC_APP_ENV !== "production" && env.EXPO_PUBLIC_APP_ENV !== "production") {
    warnings.push("EAS production profile should set EXPO_PUBLIC_APP_ENV=production.");
  }

  // (The missing-URL case is already covered by the `!gsavUrl` check above,
  // which merges the env and EAS-profile sources via productionGsavUrl.)

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checked: {
      gsavUrl: gsavUrl || null,
      androidUsesCleartextTraffic: android.usesCleartextTraffic ?? null,
      schemes,
      hasProductionProfile: Boolean(easConfig?.build?.production)
    }
  };
}

function main() {
  const root = process.cwd();
  const productionEnv = { ...process.env, EXPO_PUBLIC_APP_ENV: "production", EAS_BUILD_PROFILE: "production" };
  const { appConfig, source: appConfigSource } = loadResolvedAppConfig(root, productionEnv);
  const easConfig = fs.existsSync(path.join(root, "eas.json"))
    ? readJson(path.join(root, "eas.json"))
    : {};
  const packageJson = readJson(path.join(root, "package.json"));
  const result = validateNativeProductionConfig({
    appConfig,
    easConfig,
    packageJson,
    env: productionEnv
  });

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    appConfigSource,
    status: result.ok ? "pass" : "fail",
    ...result
  }, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  isLocalHostname,
  loadResolvedAppConfig,
  productionGsavUrl,
  validateNativeProductionConfig
};
