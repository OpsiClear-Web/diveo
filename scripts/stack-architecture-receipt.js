#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  isLocalHostname,
  loadStackProfile,
  resolveStackPaths,
  urlOrigin,
} = require("./stack-config");
const devDoctor = require("./dev-doctor");
const {
  GSAV_NATIVE_BRIDGE_MIN_VERSION,
  GSAV_NATIVE_BRIDGE_VERSION,
  GSAV_SESSION_BRIDGE_VERSION,
} = require("@opsiclear/gsav-bridge");

const RECEIPT_SCHEMA_VERSION = "stack-architecture-receipt/v1";
const DEFAULT_RECEIPT_PATH = path.join("docs", "qa-evidence", "local-stack-architecture-receipt.json");
const SENSITIVE_QUERY_KEYS = /(?:access|api|auth|jwt|key|secret|session|token)/i;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function usage() {
  return [
    "Usage: node scripts/stack-architecture-receipt.js [--output <path>] [--verify <path>] [--check]",
    "       [--config <path>] [--root <path>] [--skip-network] [--require-assets] [--timeout-ms <ms>]",
  ].join(" ");
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    check: false,
    configPath: "",
    outputPath: "",
    requireAssets: false,
    root: process.cwd(),
    skipNetwork: false,
    timeoutMs: 10000,
    verifyPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--config") {
      const next = argv[index + 1];
      if (!next) throw new Error("--config requires a path.");
      options.configPath = next;
      index += 1;
    } else if (arg === "--output") {
      const next = argv[index + 1];
      if (!next) throw new Error("--output requires a path.");
      options.outputPath = next;
      index += 1;
    } else if (arg === "--verify") {
      const next = argv[index + 1];
      if (!next) throw new Error("--verify requires a path.");
      options.verifyPath = next;
      index += 1;
    } else if (arg === "--root") {
      const next = argv[index + 1];
      if (!next) throw new Error("--root requires a path.");
      options.root = path.resolve(next);
      index += 1;
    } else if (arg === "--skip-network") {
      options.skipNetwork = true;
    } else if (arg === "--require-assets") {
      options.requireAssets = true;
    } else if (arg === "--timeout-ms") {
      const next = argv[index + 1];
      if (!next) throw new Error("--timeout-ms requires a number.");
      options.timeoutMs = Number.parseInt(next, 10);
      index += 1;
    } else {
      throw new Error(usage());
    }
  }

  if (options.outputPath && options.verifyPath) {
    throw new Error("--output and --verify cannot be used together.");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be an integer >= 1000.");
  }

  return options;
}

function normalizeSlash(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function relativePath(root, filePath) {
  return normalizeSlash(path.relative(root, filePath)) || ".";
}

function redactUrl(value) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  for (const key of Array.from(url.searchParams.keys())) {
    if (SENSITIVE_QUERY_KEYS.test(key)) {
      url.searchParams.set(key, "[redacted]");
    }
  }
  return url.toString().replace(/\/$/, "");
}

function classifyUrl(value) {
  const url = new URL(value);
  if (isLocalHostname(url.hostname)) return "local-private";
  if (url.protocol === "https:") return "public-https";
  if (url.protocol === "http:") return "public-http";
  return "unsupported";
}

function urlReceipt(value) {
  const url = new URL(value);
  return {
    class: classifyUrl(value),
    origin: url.origin,
    url: redactUrl(value),
  };
}

function parseDoctorCatalogSummary(doctorResult) {
  const catalogCheck = doctorResult?.checks?.find((check) => check.name === "Catalog function");
  if (!catalogCheck?.ok || typeof catalogCheck.detail !== "string") {
    return {
      firstVideoId: null,
      schemaVersion: null,
    };
  }

  const schemaMatch = /\bschema=(\d+)\b/.exec(catalogCheck.detail);
  const firstMatch = /\bfirst=([^\s]+)/.exec(catalogCheck.detail);
  return {
    firstVideoId: firstMatch?.[1] ?? null,
    schemaVersion: schemaMatch ? Number.parseInt(schemaMatch[1], 10) : null,
  };
}

function summarizeDoctorResult(doctorResult, options = {}) {
  const checks = Array.isArray(doctorResult?.checks) ? doctorResult.checks : [];
  return {
    ok: checks.length > 0 && checks.every((check) => check.ok === true),
    requireAssets: Boolean(options.requireAssets),
    skipNetwork: Boolean(options.skipNetwork),
    checks: checks.map((check) => ({
      detail: String(check.detail ?? ""),
      name: String(check.name ?? ""),
      ok: check.ok === true,
    })),
  };
}

function bridgeInfo() {
  return {
    nativeMinVersion: GSAV_NATIVE_BRIDGE_MIN_VERSION,
    nativeVersion: GSAV_NATIVE_BRIDGE_VERSION,
    sessionVersion: GSAV_SESSION_BRIDGE_VERSION,
  };
}

function parseExportedNumber(sourceText, exportName) {
  const match = new RegExp(`export\\s+const\\s+${exportName}\\s*=\\s*(\\d+)\\s*;`).exec(sourceText);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isVersionRangeCompatible({
  nativeMinVersion,
  nativeVersion,
  webMinVersion,
  webVersion,
}) {
  if (!Number.isInteger(nativeMinVersion) || !Number.isInteger(nativeVersion)) return false;
  if (!Number.isInteger(webMinVersion) || !Number.isInteger(webVersion)) return false;
  return webVersion >= nativeMinVersion && nativeVersion >= webMinVersion;
}

function readWebBridgeInfo(paths, fsImpl = fs) {
  const sourcePath = path.join(paths.gsavWebRoot, "src", "native", "bridge.ts");
  if (!fsImpl.existsSync(sourcePath)) {
    return {
      compatible: null,
      minVersion: null,
      sourcePath: relativePath(paths.diveoRoot, sourcePath),
      version: null,
    };
  }

  const sourceText = fsImpl.readFileSync(sourcePath, "utf8");
  const version = parseExportedNumber(sourceText, "GSAV_NATIVE_BRIDGE_VERSION");
  const minVersion = parseExportedNumber(sourceText, "GSAV_NATIVE_BRIDGE_MIN_VERSION");
  const native = bridgeInfo();
  return {
    compatible: isVersionRangeCompatible({
      nativeMinVersion: native.nativeMinVersion,
      nativeVersion: native.nativeVersion,
      webMinVersion: minVersion,
      webVersion: version,
    }),
    minVersion,
    sourcePath: relativePath(paths.diveoRoot, sourcePath),
    version,
  };
}

function gitSha(root, env = process.env, runCommand = spawnSync) {
  if (FULL_SHA_PATTERN.test(env.GITHUB_SHA ?? "")) return env.GITHUB_SHA;
  const result = runCommand("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  const sha = String(result.stdout ?? "").trim();
  return FULL_SHA_PATTERN.test(sha) ? sha : "unknown";
}

function buildReceipt({
  bridge = bridgeInfo(),
  doctorResult,
  gitCommitSha,
  options = {},
  paths,
  profile,
  webBridge = readWebBridgeInfo(paths),
}) {
  const catalog = parseDoctorCatalogSummary(doctorResult);
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    gitSha: gitCommitSha,
    stackProfile: {
      allowedShellOrigins: profile.allowedShellOrigins.map((origin) => urlOrigin(origin)),
      backend: urlReceipt(profile.backendUrl),
      catalog: urlReceipt(profile.catalogUrl),
      nativePreview: urlReceipt(profile.nativePreviewUrl),
      path: relativePath(paths.diveoRoot, paths.stackConfigPath),
      profile: profile.profile,
      web: urlReceipt(profile.webUrl),
    },
    catalog: {
      firstVideoId: catalog.firstVideoId,
      schemaVersion: catalog.schemaVersion,
    },
    bridge: {
      ...bridge,
      web: webBridge,
    },
    doctor: summarizeDoctorResult(doctorResult, options),
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function canonicalJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredObject(problems, value, pathLabel) {
  if (!isPlainObject(value)) {
    problems.push(`${pathLabel} must be an object.`);
    return false;
  }
  return true;
}

function validateReceipt(receipt) {
  const problems = [];
  if (!requiredObject(problems, receipt, "receipt")) return problems;

  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${RECEIPT_SCHEMA_VERSION}.`);
  }
  if (!FULL_SHA_PATTERN.test(receipt.gitSha ?? "") && receipt.gitSha !== "unknown") {
    problems.push("gitSha must be a full 40-hex SHA or unknown.");
  }

  if (requiredObject(problems, receipt.stackProfile, "stackProfile")) {
    for (const key of ["backend", "catalog", "nativePreview", "web"]) {
      if (requiredObject(problems, receipt.stackProfile[key], `stackProfile.${key}`)) {
        for (const field of ["class", "origin", "url"]) {
          if (typeof receipt.stackProfile[key][field] !== "string" || !receipt.stackProfile[key][field]) {
            problems.push(`stackProfile.${key}.${field} must be a non-empty string.`);
          }
        }
      }
    }
    if (!Array.isArray(receipt.stackProfile.allowedShellOrigins) || receipt.stackProfile.allowedShellOrigins.length === 0) {
      problems.push("stackProfile.allowedShellOrigins must be a non-empty array.");
    }
    if (typeof receipt.stackProfile.path !== "string" || !receipt.stackProfile.path) {
      problems.push("stackProfile.path must be a non-empty string.");
    }
    if (typeof receipt.stackProfile.profile !== "string" || !receipt.stackProfile.profile) {
      problems.push("stackProfile.profile must be a non-empty string.");
    }
  }

  if (requiredObject(problems, receipt.catalog, "catalog")) {
    if (receipt.catalog.schemaVersion !== null && !Number.isInteger(receipt.catalog.schemaVersion)) {
      problems.push("catalog.schemaVersion must be an integer or null.");
    }
    if (receipt.catalog.firstVideoId !== null && typeof receipt.catalog.firstVideoId !== "string") {
      problems.push("catalog.firstVideoId must be a string or null.");
    }
  }

  if (requiredObject(problems, receipt.bridge, "bridge")) {
    for (const key of ["nativeMinVersion", "nativeVersion", "sessionVersion"]) {
      if (!Number.isInteger(receipt.bridge[key])) {
        problems.push(`bridge.${key} must be an integer.`);
      }
    }
    if (requiredObject(problems, receipt.bridge.web, "bridge.web")) {
      if (receipt.bridge.web.version !== null && !Number.isInteger(receipt.bridge.web.version)) {
        problems.push("bridge.web.version must be an integer or null.");
      }
      if (receipt.bridge.web.minVersion !== null && !Number.isInteger(receipt.bridge.web.minVersion)) {
        problems.push("bridge.web.minVersion must be an integer or null.");
      }
      if (receipt.bridge.web.compatible !== true) {
        problems.push("bridge.web.compatible must be true.");
      }
      if (typeof receipt.bridge.web.sourcePath !== "string" || !receipt.bridge.web.sourcePath) {
        problems.push("bridge.web.sourcePath must be a non-empty string.");
      }
    }
  }

  if (requiredObject(problems, receipt.doctor, "doctor")) {
    if (typeof receipt.doctor.ok !== "boolean") problems.push("doctor.ok must be boolean.");
    if (typeof receipt.doctor.skipNetwork !== "boolean") problems.push("doctor.skipNetwork must be boolean.");
    if (typeof receipt.doctor.requireAssets !== "boolean") problems.push("doctor.requireAssets must be boolean.");
    if (!Array.isArray(receipt.doctor.checks) || receipt.doctor.checks.length === 0) {
      problems.push("doctor.checks must be a non-empty array.");
    }
  }

  return problems;
}

function firstDiffPath(actual, expected, pathLabel = "receipt") {
  if (Object.is(actual, expected)) return null;
  if (typeof actual !== typeof expected) return pathLabel;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return pathLabel;
    if (actual.length !== expected.length) return `${pathLabel}.length`;
    for (let index = 0; index < actual.length; index += 1) {
      const diff = firstDiffPath(actual[index], expected[index], `${pathLabel}[${index}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (isPlainObject(actual) && isPlainObject(expected)) {
    const keys = Array.from(new Set([...Object.keys(actual), ...Object.keys(expected)])).sort();
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(actual, key) || !Object.prototype.hasOwnProperty.call(expected, key)) {
        return `${pathLabel}.${key}`;
      }
      const diff = firstDiffPath(actual[key], expected[key], `${pathLabel}.${key}`);
      if (diff) return diff;
    }
    return null;
  }
  return pathLabel;
}

function compareReceipt(actual, expected) {
  const shapeProblems = validateReceipt(actual);
  if (shapeProblems.length) return shapeProblems;
  const actualCanonical = canonicalJson(actual);
  const expectedCanonical = canonicalJson(expected);
  if (actualCanonical === expectedCanonical) return [];
  return [
    `receipt is stale or does not match the current stack architecture at ${firstDiffPath(stableValue(actual), stableValue(expected))}.`,
  ];
}

async function collectReceipt(options = parseArgs(), dependencies = {}) {
  const paths = resolveStackPaths(options.root, options.configPath);
  const profile = loadStackProfile(paths);
  const runDoctor = dependencies.runDoctor ?? devDoctor.run;
  const doctorResult = await runDoctor({
    configPath: options.configPath,
    quiet: true,
    requireAssets: options.requireAssets,
    root: options.root,
    skipNetwork: options.skipNetwork,
    timeoutMs: options.timeoutMs,
  });

  return buildReceipt({
    bridge: dependencies.bridge ?? bridgeInfo(),
    doctorResult,
    gitCommitSha: dependencies.gitSha ?? gitSha(paths.diveoRoot, process.env, dependencies.runCommand ?? spawnSync),
    options,
    paths,
    profile,
    webBridge: dependencies.webBridge ?? readWebBridgeInfo(paths),
  });
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function run(options = parseArgs()) {
  if (options.verifyPath) {
    const verifyPath = path.resolve(options.root, options.verifyPath);
    if (!fs.existsSync(verifyPath)) {
      throw new Error(`Stack architecture receipt is missing: ${verifyPath}`);
    }
    const actual = JSON.parse(fs.readFileSync(verifyPath, "utf8"));
    const expected = await collectReceipt(options);
    const problems = compareReceipt(actual, expected);
    const result = {
      ok: problems.length === 0,
      path: relativePath(options.root, verifyPath),
      problems,
      status: problems.length === 0 ? "pass" : "fail",
    };
    console.log(canonicalJson(result));
    if (problems.length) process.exitCode = 1;
    return result;
  }

  const receipt = await collectReceipt(options);
  const problems = validateReceipt(receipt);
  if (problems.length) {
    const result = { ok: false, problems, status: "fail" };
    console.log(canonicalJson(result));
    process.exitCode = 1;
    return result;
  }

  if (options.check) {
    const result = {
      ok: true,
      problems: [],
      status: "pass",
    };
    console.log(canonicalJson(result));
    return result;
  }

  const outputPath = options.outputPath ? path.resolve(options.root, options.outputPath) : null;
  if (outputPath) {
    ensureParentDirectory(outputPath);
    fs.writeFileSync(outputPath, canonicalJson(receipt));
    console.log(`Wrote ${relativePath(options.root, outputPath)}`);
    return { ok: true, path: outputPath, receipt, status: "pass" };
  }

  process.stdout.write(canonicalJson(receipt));
  return { ok: true, receipt, status: "pass" };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_RECEIPT_PATH,
  RECEIPT_SCHEMA_VERSION,
  buildReceipt,
  canonicalJson,
  classifyUrl,
  collectReceipt,
  compareReceipt,
  firstDiffPath,
  parseArgs,
  parseDoctorCatalogSummary,
  parseExportedNumber,
  redactUrl,
  readWebBridgeInfo,
  run,
  summarizeDoctorResult,
  urlReceipt,
  validateReceipt,
  isVersionRangeCompatible,
};
