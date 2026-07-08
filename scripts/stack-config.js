#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const GENERATED_BLOCK_NAME = "GSAV_STACK_GENERATED";
const NATIVE_ENV_KEYS = [
  "EXPO_PUBLIC_GSAV_WEB_URL",
  "EXPO_PUBLIC_GSAV_CATALOG_URL",
  "EXPO_PUBLIC_GSAV_SUPABASE_URL",
  "EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY",
];
const WEB_ENV_KEYS = [
  "VITE_GSAV_CATALOG_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_GSAV_ALLOWED_SHELL_ORIGINS",
];
const FUNCTIONS_ENV_KEYS = [
  "GSAV_PUBLIC_STORAGE_URL",
];
const REDACTED_ENV_KEYS = new Set([
  "EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
]);

function resolveStackPaths(root = process.cwd(), configPath = "") {
  const diveoRoot = path.resolve(root);
  const gsavHostingRoot = path.resolve(diveoRoot, "..", "gsav-hosting");
  const gsavWebRoot = path.join(gsavHostingRoot, "apps", "web");

  return {
    diveoRoot,
    gsavHostingRoot,
    gsavWebRoot,
    stackConfigPath: configPath ? path.resolve(diveoRoot, configPath) : path.join(diveoRoot, "config", "stack.local.json"),
    nativeEnvPath: path.join(diveoRoot, ".env.local"),
    webEnvPath: path.join(gsavWebRoot, ".env.local"),
    functionsEnvPath: path.join(gsavHostingRoot, "supabase", "functions", ".env.local"),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function normalizeUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function urlOrigin(value) {
  return new URL(value).origin;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalHostname(hostname) {
  const normalized = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "::1" ||
    normalized === "10.0.2.2"
  ) {
    return true;
  }

  const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [first, second] = parts;
    if (first === 10 || first === 127) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;
  }

  return normalized.endsWith(".local");
}

function validateStackProfile(profile, options = {}) {
  const errors = [];
  const requiredUrlFields = ["backendUrl", "catalogUrl", "webUrl", "nativePreviewUrl"];

  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return ["Stack profile must be a JSON object."];
  }

  for (const key of requiredUrlFields) {
    if (!isHttpUrl(profile[key])) {
      errors.push(`${key} must be an http(s) URL.`);
    }
  }

  if (!Array.isArray(profile.allowedShellOrigins) || profile.allowedShellOrigins.length === 0) {
    errors.push("allowedShellOrigins must be a non-empty array.");
  } else {
    for (const origin of profile.allowedShellOrigins) {
      if (!isHttpUrl(origin)) {
        errors.push(`allowedShellOrigins entry must be an http(s) origin: ${origin}`);
        continue;
      }
      try {
        if (normalizeUrl(origin) !== urlOrigin(origin)) {
          errors.push(`allowedShellOrigins entries must be origins without paths: ${origin}`);
        }
      } catch {
        errors.push(`allowedShellOrigins entry is invalid: ${origin}`);
      }
    }
  }

  if (errors.length === 0) {
    const backendOrigin = urlOrigin(profile.backendUrl);
    const catalogOrigin = urlOrigin(profile.catalogUrl);
    if (backendOrigin !== catalogOrigin) {
      errors.push(`catalogUrl origin (${catalogOrigin}) must match backendUrl origin (${backendOrigin}).`);
    }

    if (!new URL(profile.catalogUrl).pathname.includes("/functions/v1/catalog")) {
      errors.push("catalogUrl must point at the catalog Edge Function path.");
    }

    const nativeOrigin = urlOrigin(profile.nativePreviewUrl);
    const allowedShellOrigins = new Set(profile.allowedShellOrigins.map((origin) => urlOrigin(origin)));
    if (!allowedShellOrigins.has(nativeOrigin)) {
      errors.push(`allowedShellOrigins must include nativePreviewUrl origin (${nativeOrigin}).`);
    }

    if (options.production || profile.profile === "production") {
      for (const key of requiredUrlFields) {
        const url = new URL(profile[key]);
        if (url.protocol !== "https:") errors.push(`Production ${key} must use https.`);
        if (isLocalHostname(url.hostname)) errors.push(`Production ${key} must not use a local/private host.`);
      }
    }
  }

  return errors;
}

function loadStackProfile(paths = resolveStackPaths()) {
  const profile = readJson(paths.stackConfigPath);
  const errors = validateStackProfile(profile);
  if (errors.length) {
    const detail = errors.map((error) => `- ${error}`).join("\n");
    throw new Error(`Invalid stack profile ${paths.stackConfigPath}:\n${detail}`);
  }
  return profile;
}

function parseEnvText(text) {
  const values = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readEnvFile(filePath) {
  const text = readTextIfExists(filePath);
  return {
    path: filePath,
    text,
    values: parseEnvText(text),
  };
}

function resolveSupabaseAnonKey(profile, nativeEnv = {}, webEnv = {}, env = process.env) {
  return String(
    profile.supabaseAnonKey ||
    env.GSAV_STACK_SUPABASE_ANON_KEY ||
    nativeEnv.EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY ||
    webEnv.VITE_SUPABASE_ANON_KEY ||
    ""
  );
}

function expectedNativeEnv(profile, anonKey = "") {
  return {
    EXPO_PUBLIC_GSAV_WEB_URL: normalizeUrl(profile.webUrl),
    EXPO_PUBLIC_GSAV_CATALOG_URL: normalizeUrl(profile.catalogUrl),
    EXPO_PUBLIC_GSAV_SUPABASE_URL: normalizeUrl(profile.backendUrl),
    EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: anonKey,
  };
}

function expectedWebEnv(profile, anonKey = "") {
  return {
    VITE_GSAV_CATALOG_URL: normalizeUrl(profile.catalogUrl),
    VITE_SUPABASE_URL: normalizeUrl(profile.backendUrl),
    VITE_SUPABASE_ANON_KEY: anonKey,
    VITE_GSAV_ALLOWED_SHELL_ORIGINS: profile.allowedShellOrigins.map((origin) => urlOrigin(origin)).join(","),
  };
}

function expectedFunctionsEnv(profile) {
  return {
    GSAV_PUBLIC_STORAGE_URL: normalizeUrl(profile.backendUrl),
  };
}

function removeGeneratedBlock(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const output = [];
  let inGeneratedBlock = false;
  for (const line of lines) {
    if (line.trim() === `# BEGIN ${GENERATED_BLOCK_NAME}`) {
      inGeneratedBlock = true;
      continue;
    }
    if (line.trim() === `# END ${GENERATED_BLOCK_NAME}`) {
      inGeneratedBlock = false;
      continue;
    }
    if (!inGeneratedBlock) output.push(line);
  }
  return output.join("\n");
}

function removeEnvKeys(text, keys) {
  const keySet = new Set(keys);
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) return true;
      const equals = line.indexOf("=");
      if (equals <= 0) return true;
      return !keySet.has(line.slice(0, equals).trim());
    })
    .join("\n");
}

function formatEnvValue(value) {
  const text = String(value ?? "");
  if (/[\r\n]/.test(text)) throw new Error("Environment values must be single-line strings.");
  return text;
}

function renderManagedEnvText(existingText, values, sourceLabel = "config/stack.local.json") {
  const withoutBlock = removeGeneratedBlock(existingText);
  const withoutManagedKeys = removeEnvKeys(withoutBlock, Object.keys(values)).trimEnd();
  const block = [
    `# BEGIN ${GENERATED_BLOCK_NAME}`,
    `# Generated by npm run stack:env from ${sourceLabel}.`,
    ...Object.entries(values).map(([key, value]) => `${key}=${formatEnvValue(value)}`),
    `# END ${GENERATED_BLOCK_NAME}`,
  ].join("\n");
  return `${withoutManagedKeys ? `${withoutManagedKeys}\n\n` : ""}${block}\n`;
}

function compareEnv(actual, expected) {
  const mismatches = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key] ?? "";
    if (String(actualValue) !== String(expectedValue)) {
      mismatches.push({ key, expected: String(expectedValue), actual: String(actualValue) });
    }
  }
  return mismatches;
}

function displayEnvValue(key, value) {
  if (!value) return "[empty]";
  if (REDACTED_ENV_KEYS.has(key)) return "[redacted]";
  return value;
}

function formatEnvMismatches(label, mismatches) {
  if (!mismatches.length) return `${label}: ok`;
  return [
    `${label}: ${mismatches.length} mismatch(es)`,
    ...mismatches.map((item) => (
      `- ${item.key}: expected ${displayEnvValue(item.key, item.expected)}, found ${displayEnvValue(item.key, item.actual)}`
    )),
  ].join("\n");
}

module.exports = {
  GENERATED_BLOCK_NAME,
  FUNCTIONS_ENV_KEYS,
  NATIVE_ENV_KEYS,
  WEB_ENV_KEYS,
  compareEnv,
  displayEnvValue,
  expectedFunctionsEnv,
  expectedNativeEnv,
  expectedWebEnv,
  formatEnvMismatches,
  isLocalHostname,
  loadStackProfile,
  normalizeUrl,
  parseEnvText,
  readEnvFile,
  renderManagedEnvText,
  resolveStackPaths,
  resolveSupabaseAnonKey,
  urlOrigin,
  validateStackProfile,
};
