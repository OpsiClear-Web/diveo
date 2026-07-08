#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createEvidenceMetadata } = require("./evidence-metadata");

const defaultRoutes = [
  { name: "home direct web", path: "/" },
  { name: "explore native data saver", path: "/explore?embed=native&dataSaver=1" },
  { name: "native diagnostics", path: "/native-diagnostics?embed=native" },
  { name: "watch test", path: "/watch/test?embed=native" },
  { name: "watch test start time", path: "/watch/test?t=2.5&embed=native" },
  { name: "watch elly", path: "/watch/elly?embed=native" },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function exactRangeContentRange(value) {
  return /^bytes\s+0-0\/\d+$/i.test(String(value ?? "").trim());
}

const requiredExposedRangeHeaders = [
  "Accept-Ranges",
  "Content-Length",
  "Content-Range",
  "ETag",
];

function hasExposedHeader(exposeHeaders, headerName) {
  if (!exposeHeaders) return false;
  const normalized = headerName.toLowerCase();
  return String(exposeHeaders)
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .includes(normalized);
}

function missingExposedRangeHeaders(exposeHeaders) {
  return requiredExposedRangeHeaders.filter((header) => !hasExposedHeader(exposeHeaders, header));
}

function corsAllowOriginMatches(allowOrigin, baseUrl) {
  const value = String(allowOrigin ?? "").trim();
  if (value === "*") return true;
  if (!value) return false;

  try {
    return new URL(value).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function createConfig(env = process.env) {
  const timeoutMs = Number.parseInt(env.GSAV_NATIVE_PREFLIGHT_TIMEOUT_MS || "10000", 10);
  return {
    baseUrl: (env.EXPO_PUBLIC_GSAV_WEB_URL || env.GSAV_WEB_URL || "http://127.0.0.1:5191").replace(/\/+$/, ""),
    timeoutMs,
    skipLocalAsset: env.GSAV_NATIVE_PREFLIGHT_SKIP_LOCAL_ASSET === "1",
    rangeProbeUrl: (env.GSAV_NATIVE_PREFLIGHT_RANGE_URL || env.GSAV_RANGE_PROBE_URL || "").trim(),
    requireRangeProbe: env.GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE === "1",
    requireCors: env.GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS === "1",
    hostIdentityUrl: (env.GSAV_HOST_IDENTITY_URL || env.GSAV_HOST_BUILD_METADATA_URL || "").trim(),
    requireHostIdentity: env.GSAV_NATIVE_PREFLIGHT_REQUIRE_HOST_IDENTITY === "1",
  };
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    outputPath: (env.GSAV_NATIVE_PREFLIGHT_OUTPUT_PATH || "").trim(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-path") {
      const next = argv[index + 1];
      if (!next) throw new Error("--output-path requires a non-empty value.");
      options.outputPath = next;
      index += 1;
    } else {
      throw new Error("Usage: node scripts/gsav-native-preflight.js [--output-path <path>]");
    }
  }

  return options;
}

function writeJsonOutput(outputPath, payload) {
  if (!outputPath) return null;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return outputPath;
}

function toUrl(config, routePath) {
  return new URL(routePath, `${config.baseUrl}/`).toString();
}

async function fetchWithTimeout(url, options = {}, config = createConfig(), fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Timed out after ${config.timeoutMs}ms`));
  }, config.timeoutMs);

  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkRoute(route, config = createConfig(), fetchImpl = fetch) {
  const url = toUrl(config, route.path);
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
  }, config, fetchImpl);
  const text = await response.text();
  const contentType = response.headers.get("content-type");
  const result = {
    name: route.name,
    url,
    status: response.status,
    contentType,
    hasAppRoot: text.includes('id="root"'),
  };

  assert(response.ok, `${route.name} returned ${response.status}`);
  assert(result.hasAppRoot, `${route.name} did not return the GSAV app shell`);
  return result;
}

async function checkRangeAsset(config = createConfig(), fetchImpl = fetch) {
  if (config.skipLocalAsset && !config.rangeProbeUrl) {
    assert(!config.requireRangeProbe, "GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE=1 but no GSAV_NATIVE_PREFLIGHT_RANGE_URL was provided");
    return {
      skipped: true,
      reason: "GSAV_NATIVE_PREFLIGHT_SKIP_LOCAL_ASSET=1",
    };
  }

  const url = config.rangeProbeUrl || toUrl(config, "/test.gsav");
  const label = config.rangeProbeUrl ? "configured range probe" : "/test.gsav";
  const requestHeaders = {
    Range: "bytes=0-0",
  };
  if (config.requireCors) {
    requestHeaders.Origin = new URL(config.baseUrl).origin;
  }
  const response = await fetchWithTimeout(url, {
    headers: requestHeaders,
  }, config, fetchImpl);
  const result = {
    url,
    requestRange: "bytes=0-0",
    status: response.status,
    acceptRanges: response.headers.get("accept-ranges"),
    contentRange: response.headers.get("content-range"),
    contentLength: response.headers.get("content-length"),
    etag: response.headers.get("etag"),
    accessControlAllowOrigin: response.headers.get("access-control-allow-origin"),
    accessControlExposeHeaders: response.headers.get("access-control-expose-headers"),
  };

  assert(response.status === 206, `${label} range request returned ${response.status}, expected 206`);
  assert(result.acceptRanges?.toLowerCase() === "bytes", `${label} did not advertise Accept-Ranges: bytes`);
  assert(Boolean(result.contentRange), `${label} did not return Content-Range`);
  result.contentRangeExact = exactRangeContentRange(result.contentRange);
  result.missingExposedHeaders = missingExposedRangeHeaders(result.accessControlExposeHeaders);
  if (config.requireRangeProbe) {
    assert(result.contentRangeExact, `${label} did not return exact Content-Range: bytes 0-0/<size>`);
  }
  if (config.requireCors) {
    assert(Boolean(result.accessControlAllowOrigin), `${label} did not return Access-Control-Allow-Origin`);
    assert(
      corsAllowOriginMatches(result.accessControlAllowOrigin, config.baseUrl),
      `${label} Access-Control-Allow-Origin must be * or match the GSAV web origin`,
    );
    assert(
      result.missingExposedHeaders.length === 0,
      `${label} did not expose browser-readable range headers: ${result.missingExposedHeaders.join(", ")}`,
    );
  }
  return result;
}

function weakIdentity(value) {
  return !value || /^(unavailable|unknown|n\/a|null|none)$/i.test(String(value).trim());
}

function extractHostIdentity(payload) {
  if (!payload || typeof payload !== "object") return null;
  for (const key of [
    "gsavHostingCommit",
    "gsavHostBuild",
    "gsavHostIdentity",
    "deployedHostIdentity",
    "commit",
    "gitCommit",
    "sha",
    "build",
    "buildId",
    "buildSha",
  ]) {
    if (!weakIdentity(payload[key])) {
      return String(payload[key]).trim();
    }
  }
  return null;
}

function identityMatches(observed, expected) {
  if (weakIdentity(observed) || weakIdentity(expected)) return false;
  const normalizedObserved = String(observed).trim().toLowerCase();
  const normalizedExpected = String(expected).trim().toLowerCase();
  if (Math.min(normalizedObserved.length, normalizedExpected.length) < 7) return false;
  return normalizedExpected.startsWith(normalizedObserved) || normalizedObserved.startsWith(normalizedExpected);
}

async function checkHostIdentity(config = createConfig(), expectedIdentity, fetchImpl = fetch) {
  if (!config.hostIdentityUrl) {
    assert(!config.requireHostIdentity, "GSAV_NATIVE_PREFLIGHT_REQUIRE_HOST_IDENTITY=1 but no GSAV_HOST_IDENTITY_URL was provided");
    return {
      skipped: true,
      reason: "GSAV_HOST_IDENTITY_URL not provided",
    };
  }
  assert(!weakIdentity(expectedIdentity), "GSAV host identity check requires GSAV_HOSTING_COMMIT or GSAV_HOST_BUILD_ID");

  const response = await fetchWithTimeout(config.hostIdentityUrl, {
    headers: {
      Accept: "application/json,text/plain;q=0.9",
    },
  }, config, fetchImpl);
  const text = await response.text();
  const contentType = response.headers.get("content-type");
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const observedIdentity = extractHostIdentity(parsed) ?? text.trim();
  const matched = identityMatches(observedIdentity, expectedIdentity);
  const result = {
    url: config.hostIdentityUrl,
    status: response.status,
    contentType,
    expectedIdentity,
    observedIdentity,
    matched,
  };

  assert(response.ok, `host identity metadata returned ${response.status}`);
  assert(!weakIdentity(observedIdentity), "host identity metadata did not include a concrete identity");
  assert(matched, "host identity metadata did not match GSAV_HOSTING_COMMIT");
  return result;
}

async function runPreflight({
  config = createConfig(),
  routes = defaultRoutes,
  fetchImpl = fetch,
  metadata = createEvidenceMetadata(),
} = {}) {
  assert(Number.isInteger(config.timeoutMs) && config.timeoutMs > 0, `Invalid timeout: ${config.timeoutMs}`);

  const routeResults = [];
  for (const route of routes) {
    routeResults.push(await checkRoute(route, config, fetchImpl));
  }

  const rangeAsset = await checkRangeAsset(config, fetchImpl);
  const hostIdentity = await checkHostIdentity(config, metadata.gsavHostingCommit, fetchImpl);
  return {
    baseUrl: config.baseUrl,
    checkedAt: new Date().toISOString(),
    ...metadata,
    routes: routeResults,
    rangeAsset,
    localAsset: rangeAsset,
    hostIdentity,
    hostIdentityVerified: hostIdentity.matched === true,
  };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  let options = { outputPath: (env.GSAV_NATIVE_PREFLIGHT_OUTPUT_PATH || "").trim() };
  let config = createConfig(env);
  try {
    options = parseArgs(argv, env);
    const result = await runPreflight({ config });
    writeJsonOutput(options.outputPath, result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const failure = {
      baseUrl: config.baseUrl,
      checkedAt: new Date().toISOString(),
      ...createEvidenceMetadata(),
      error: error instanceof Error ? error.message : String(error),
    };
    writeJsonOutput(options.outputPath, failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  assert,
  checkHostIdentity,
  checkRangeAsset,
  checkRoute,
  corsAllowOriginMatches,
  createConfig,
  defaultRoutes,
  exactRangeContentRange,
  extractHostIdentity,
  fetchWithTimeout,
  hasExposedHeader,
  identityMatches,
  missingExposedRangeHeaders,
  parseArgs,
  runPreflight,
  toUrl,
  writeJsonOutput,
};
