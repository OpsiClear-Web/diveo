#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ENV_EXAMPLE_PATHS = [".env.example"];

const REQUIRED_NATIVE_ENV_KEYS = [
  "EXPO_PUBLIC_GSAV_WEB_URL",
  "EXPO_PUBLIC_GSAV_CATALOG_URL",
  "EXPO_PUBLIC_GSAV_SUPABASE_URL",
  "EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_APP_ENV",
];

const REQUIRED_PROFILE_GUIDANCE = [
  "npm run stack:env",
  "npm run dev:stack",
  "config/stack.local.json",
  "NOT secrets",
];

const PLACEHOLDER_MARKER_PATTERN = /(?:example|placeholder|public|anon|local|test|dummy|your|sample|redacted|changeme)/i;
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bghp_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsbp_[A-Za-z0-9_-]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
];

function normalizeSlash(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function stripInlineComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "\"" || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === "#" && quote === null) {
      const previous = value[index - 1];
      if (!previous || /\s/.test(previous)) {
        return value.slice(0, index).trimEnd();
      }
    }
  }
  return value.trimEnd();
}

function unquoteEnvValue(value) {
  const trimmed = stripInlineComment(String(value ?? "")).trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseEnvExampleText(text) {
  const entries = [];
  const invalidLines = [];
  const lines = String(text ?? "").split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!assignment) {
      invalidLines.push({ line: index + 1, text: rawLine });
      continue;
    }

    const [, key, rawValue] = assignment;
    entries.push({
      key,
      line: index + 1,
      rawValue,
      value: unquoteEnvValue(rawValue),
    });
  }

  return { entries, invalidLines };
}

function isAllowedPlaceholderUrl(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  return (
    hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.endsWith(".example.com")
    || hostname === "example.com"
  );
}

function isPlaceholderValue(value) {
  const normalized = unquoteEnvValue(value);
  if (!normalized) return true;
  if (/^(?:true|false|0|1)$/i.test(normalized)) return true;
  if (/^\d+$/.test(normalized)) return true;
  if (/^(?:development|production|local|test)$/i.test(normalized)) return true;
  if (normalized.includes(".example") || normalized.includes("example.com")) return true;
  if (normalized.includes("<") && normalized.includes(">")) return true;
  if (PLACEHOLDER_MARKER_PATTERN.test(normalized)) return true;
  return isAllowedPlaceholderUrl(normalized);
}

function looksLikeHighEntropyToken(value) {
  const normalized = unquoteEnvValue(value);
  if (normalized.length < 32) return false;
  if (PLACEHOLDER_MARKER_PATTERN.test(normalized)) return false;
  if (/^https?:\/\//i.test(normalized)) return false;
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(normalized)) return false;

  const classes = [
    /[a-z]/.test(normalized),
    /[A-Z]/.test(normalized),
    /[0-9]/.test(normalized),
    /[._~+/=-]/.test(normalized),
  ].filter(Boolean).length;

  return classes >= 2;
}

function hasSecretShape(value) {
  const normalized = unquoteEnvValue(value);
  if (!normalized || isPlaceholderValue(normalized)) return false;
  return SECRET_PATTERNS.some((pattern) => pattern.test(normalized))
    || looksLikeHighEntropyToken(normalized);
}

function validateRepoRelativePath(filePath) {
  const normalized = normalizeSlash(filePath).trim();
  if (!normalized) {
    throw new Error("env example path must not be empty");
  }
  if (path.isAbsolute(normalized)) {
    throw new Error(`env example path must be repo-relative: ${filePath}`);
  }
  const parts = normalized.split("/");
  if (parts.includes("..")) {
    throw new Error(`env example path must stay inside the repository: ${filePath}`);
  }
  return normalized;
}

function analyzeEnvExampleText(text, options = {}) {
  const filePath = options.filePath ?? ".env.example";
  const { entries, invalidLines } = parseEnvExampleText(text);
  const presentKeys = new Set(entries.map((entry) => entry.key));
  const problems = [];

  for (const invalidLine of invalidLines) {
    problems.push(`${filePath}:${invalidLine.line} is not a KEY=value assignment or comment.`);
  }

  for (const key of REQUIRED_NATIVE_ENV_KEYS) {
    if (!presentKeys.has(key)) {
      problems.push(`${filePath} is missing required native public env key ${key}.`);
    }
  }

  for (const marker of REQUIRED_PROFILE_GUIDANCE) {
    if (!String(text ?? "").includes(marker)) {
      problems.push(`${filePath} must mention profile guidance marker "${marker}".`);
    }
  }

  for (const entry of entries) {
    if (hasSecretShape(entry.value)) {
      problems.push(`${filePath}:${entry.line} ${entry.key} has a real-secret-looking value.`);
    } else if (!isPlaceholderValue(entry.value)) {
      problems.push(`${filePath}:${entry.line} ${entry.key} must use an empty value or obvious placeholder.`);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    checked: {
      filePath,
      requiredKeys: REQUIRED_NATIVE_ENV_KEYS.length,
      presentRequiredKeys: REQUIRED_NATIVE_ENV_KEYS.filter((key) => presentKeys.has(key)).length,
      profileGuidanceMarkers: REQUIRED_PROFILE_GUIDANCE.length,
      assignments: entries.length,
    },
  };
}

function verifyEnvExamples(options = {}) {
  const root = options.root ?? process.cwd();
  const envExamplePaths = options.envExamplePaths ?? DEFAULT_ENV_EXAMPLE_PATHS;
  const problems = [];
  const checked = [];

  for (const candidatePath of envExamplePaths) {
    let relativePath;
    try {
      relativePath = validateRepoRelativePath(candidatePath);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      problems.push(`${relativePath} does not exist.`);
      continue;
    }

    const text = fs.readFileSync(absolutePath, "utf8");
    const result = analyzeEnvExampleText(text, { filePath: relativePath });
    problems.push(...result.problems);
    checked.push(result.checked);
  }

  return {
    ok: problems.length === 0,
    status: problems.length === 0 ? "pass" : "fail",
    checked,
    problems,
  };
}

function main() {
  const envExamplePaths = process.argv.slice(2);
  const result = verifyEnvExamples({
    envExamplePaths: envExamplePaths.length > 0 ? envExamplePaths : DEFAULT_ENV_EXAMPLE_PATHS,
  });
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    ...result,
  }, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_ENV_EXAMPLE_PATHS,
  REQUIRED_NATIVE_ENV_KEYS,
  REQUIRED_PROFILE_GUIDANCE,
  analyzeEnvExampleText,
  hasSecretShape,
  isAllowedPlaceholderUrl,
  isPlaceholderValue,
  parseEnvExampleText,
  validateRepoRelativePath,
  verifyEnvExamples,
};
