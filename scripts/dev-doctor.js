#!/usr/bin/env node
const path = require("node:path");

const {
  compareEnv,
  expectedFunctionsEnv,
  expectedNativeEnv,
  expectedWebEnv,
  formatEnvMismatches,
  loadStackProfile,
  readEnvFile,
  resolveStackPaths,
  resolveSupabaseAnonKey,
  urlOrigin,
} = require("./stack-config");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    configPath: "",
    root: process.cwd(),
    timeoutMs: 10000,
    skipNetwork: false,
    requireAssets: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      const next = argv[index + 1];
      if (!next) throw new Error("--config requires a path.");
      options.configPath = next;
      index += 1;
    } else if (arg === "--root") {
      const next = argv[index + 1];
      if (!next) throw new Error("--root requires a path.");
      options.root = path.resolve(next);
      index += 1;
    } else if (arg === "--timeout-ms") {
      const next = argv[index + 1];
      if (!next) throw new Error("--timeout-ms requires a number.");
      options.timeoutMs = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--skip-network") {
      options.skipNetwork = true;
    } else if (arg === "--require-assets") {
      options.requireAssets = true;
    } else {
      throw new Error("Usage: node scripts/dev-doctor.js [--config <path>] [--root <path>] [--timeout-ms <ms>] [--skip-network] [--require-assets]");
    }
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be an integer >= 1000.");
  }

  return options;
}

function isContainerInternalUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "kong" || hostname.startsWith("supabase_") || hostname.endsWith("_gsav-stack");
  } catch {
    return false;
  }
}

function requireClientReachableUrl(field, value) {
  if (!value || typeof value !== "string") {
    throw new Error(`${field} is missing.`);
  }
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${field} must be an http(s) URL.`);
  }
  if (url.hostname === "0.0.0.0" || isContainerInternalUrl(value)) {
    throw new Error(`${field} is not browser-reachable: ${value}`);
  }
  return value;
}

function validateCatalogPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Catalog response is not a JSON object.");
  if (payload.schemaVersion !== 1) throw new Error(`Catalog schemaVersion must be 1, found ${payload.schemaVersion}.`);
  if (!Array.isArray(payload.videos)) throw new Error("Catalog response missing videos array.");
  if (!payload.videos.length) throw new Error("Catalog response returned no videos.");

  const assetUrls = [];
  for (const [index, video] of payload.videos.entries()) {
    if (!video || typeof video !== "object") throw new Error(`Catalog video[${index}] is invalid.`);
    const label = `catalog video[${index}]${video.id ? ` ${video.id}` : ""}`;
    assetUrls.push({
      label: `${label} poster`,
      url: requireClientReachableUrl(`${label} posterUrl`, video.posterUrl),
    });
    assetUrls.push({
      label: `${label} GSAV`,
      url: requireClientReachableUrl(`${label} gsavUrl`, video.gsavUrl),
    });
    if (video.animatedPosterUrl) {
      assetUrls.push({
        label: `${label} animated poster`,
        url: requireClientReachableUrl(`${label} animatedPosterUrl`, video.animatedPosterUrl),
      });
    }
  }

  const first = payload.videos[0];
  return {
    assetUrls,
    schemaVersion: payload.schemaVersion,
    firstVideoId: String(first.id ?? ""),
    firstPosterUrl: first.posterUrl,
    firstGsavUrl: first.gsavUrl,
  };
}

async function fetchWithTimeout(url, options, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requireOk(url, label, timeoutMs, fetchImpl = fetch) {
  const response = await fetchWithTimeout(url, { headers: { Accept: "text/html,application/json,*/*" } }, timeoutMs, fetchImpl);
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  return response;
}

async function probeAsset(url, label, timeoutMs, fetchImpl = fetch) {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "*/*",
      Range: "bytes=0-0",
    },
  }, timeoutMs, fetchImpl);
  if (!response.ok && response.status !== 206) {
    throw new Error(`${label} asset returned HTTP ${response.status}: ${url}`);
  }
}

function pushCheck(checks, name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail });
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function runNetworkChecks(profile, options, checks, fetchImpl = fetch) {
  const timeoutMs = options.timeoutMs;

  try {
    const healthUrl = new URL("/auth/v1/health", `${profile.backendUrl}/`).toString();
    await requireOk(healthUrl, "Supabase API", timeoutMs, fetchImpl);
    checks.push({ name: "Supabase API", ok: true, detail: healthUrl });
  } catch (error) {
    checks.push({ name: "Supabase API", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  let catalogSummary = null;
  try {
    const response = await requireOk(profile.catalogUrl, "Catalog function", timeoutMs, fetchImpl);
    catalogSummary = validateCatalogPayload(await response.json());
    checks.push({
      name: "Catalog function",
      ok: true,
      detail: `${profile.catalogUrl} schema=${catalogSummary.schemaVersion} first=${catalogSummary.firstVideoId}`,
    });
  } catch (error) {
    checks.push({ name: "Catalog function", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  if (catalogSummary && options.requireAssets) {
    const seenUrls = new Set();
    for (const { label, url } of catalogSummary.assetUrls) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      try {
        await probeAsset(url, label, timeoutMs, fetchImpl);
        checks.push({ name: `${label} asset`, ok: true, detail: url });
      } catch (error) {
        checks.push({ name: `${label} asset`, ok: false, detail: error instanceof Error ? error.message : String(error) });
      }
    }
  } else if (catalogSummary) {
    checks.push({
      name: "Catalog asset URL canonicalization",
      ok: true,
      detail: `${catalogSummary.assetUrls.length} catalog asset URL(s) use browser-addressable origins; byte probe skipped unless --require-assets is set`,
    });
  }

  try {
    await requireOk(profile.webUrl, "GSAV web app", timeoutMs, fetchImpl);
    checks.push({ name: "GSAV web app", ok: true, detail: profile.webUrl });
  } catch (error) {
    checks.push({ name: "GSAV web app", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    await requireOk(profile.nativePreviewUrl, "diveo native preview", timeoutMs, fetchImpl);
    checks.push({ name: "diveo native preview", ok: true, detail: profile.nativePreviewUrl });
  } catch (error) {
    checks.push({ name: "diveo native preview", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function run(options = parseArgs(), fetchImpl = fetch) {
  const paths = resolveStackPaths(options.root, options.configPath);
  const profile = loadStackProfile(paths);
  const nativeEnvFile = readEnvFile(paths.nativeEnvPath);
  const webEnvFile = readEnvFile(paths.webEnvPath);
  const functionsEnvFile = readEnvFile(paths.functionsEnvPath);
  const anonKey = resolveSupabaseAnonKey(profile, nativeEnvFile.values, webEnvFile.values, process.env);
  const nativeExpected = expectedNativeEnv(profile, anonKey);
  const webExpected = expectedWebEnv(profile, anonKey);
  const functionsExpected = expectedFunctionsEnv(profile);
  const nativeMismatches = compareEnv(nativeEnvFile.values, nativeExpected);
  const webMismatches = compareEnv(webEnvFile.values, webExpected);
  const functionsMismatches = compareEnv(functionsEnvFile.values, functionsExpected);
  const checks = [];

  pushCheck(checks, "diveo env drift", () => {
    if (nativeMismatches.length) throw new Error(formatEnvMismatches("diveo .env.local", nativeMismatches));
    return "ok";
  });
  pushCheck(checks, "gsav-hosting web env drift", () => {
    if (webMismatches.length) throw new Error(formatEnvMismatches("gsav-hosting apps/web .env.local", webMismatches));
    return "ok";
  });
  pushCheck(checks, "gsav-hosting functions env drift", () => {
    if (functionsMismatches.length) {
      throw new Error(formatEnvMismatches("gsav-hosting supabase/functions .env.local", functionsMismatches));
    }
    return "ok";
  });
  pushCheck(checks, "native shell origin allowlist", () => {
    const nativeOrigin = urlOrigin(profile.nativePreviewUrl);
    const allowed = new Set(profile.allowedShellOrigins.map((origin) => urlOrigin(origin)));
    if (!allowed.has(nativeOrigin)) throw new Error(`${nativeOrigin} is not in allowedShellOrigins.`);
    return nativeOrigin;
  });

  if (!options.skipNetwork) {
    await runNetworkChecks(profile, options, checks, fetchImpl);
  }

  if (!options.quiet) {
    for (const check of checks) {
      console.log(`${check.ok ? "ok" : "fail"} - ${check.name}: ${check.detail}`);
    }
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length) process.exitCode = 1;
  return { checks, failed };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  isContainerInternalUrl,
  parseArgs,
  requireClientReachableUrl,
  run,
  validateCatalogPayload,
};
