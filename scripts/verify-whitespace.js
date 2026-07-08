#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ps1",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const CONFIG_FILENAMES = new Set([
  ".env.example",
  ".gitignore",
  "AGENTS.md",
  "app.config.js",
  "app.json",
  "babel.config.js",
  "eas.json",
  "eslint.config.js",
  "metro.config.js",
  "package.json",
  "tsconfig.json",
  "vitest.config.mjs",
]);

const SOURCE_ROOTS = [
  ".github/",
  "app/",
  "docs/",
  "features/",
  "scripts/",
  "services/",
  "shared/",
  "shims/",
  "utils/",
];

const SKIPPED_DIRECTORIES = [
  ".expo/",
  ".git/",
  "android/",
  "build/",
  "coverage/",
  "dist/",
  "ios/",
  "node_modules/",
  "vendor/",
];

function toRepoPath(filePath) {
  return String(filePath).replace(/\\/g, "/").replace(/^\.\//, "");
}

function isGeneratedEvidenceLog(repoPath) {
  const normalized = toRepoPath(repoPath);
  return normalized.startsWith("docs/qa-evidence/")
    && (
      /\.log$/i.test(normalized)
      || /\.(?:out|err)\.txt$/i.test(normalized)
      || /(?:stdout|stderr)\.txt$/i.test(normalized)
    );
}

function skipReason(repoPath) {
  const normalized = toRepoPath(repoPath);
  if (isGeneratedEvidenceLog(normalized)) return "generated evidence log";
  if (SKIPPED_DIRECTORIES.some((directory) => normalized.startsWith(directory))) {
    return "skipped directory";
  }
  return null;
}

function isUntrackedTextCandidate(repoPath) {
  const normalized = toRepoPath(repoPath);
  if (skipReason(normalized)) return false;
  const basename = path.posix.basename(normalized);
  if (CONFIG_FILENAMES.has(basename)) return true;
  if (!SOURCE_ROOTS.some((root) => normalized.startsWith(root))) return false;
  return TEXT_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase());
}

function runGitDiffCheck({ root = process.cwd(), runCommand = spawnSync } = {}) {
  const result = runCommand("git", ["diff", "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? null,
  };
}

function listUntrackedFiles({ root = process.cwd(), runCommand = spawnSync } = {}) {
  const result = runCommand("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  const status = typeof result.status === "number" ? result.status : 1;
  if (status !== 0) {
    throw new Error(`git ls-files failed with exit ${status}: ${result.stderr || result.stdout || result.error?.message || "unknown error"}`);
  }
  return String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function fileHasBinaryNul(text) {
  return text.includes("\u0000");
}

function trailingWhitespaceErrorsForText(text, repoPath) {
  const errors = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].endsWith("\r") ? lines[index].slice(0, -1) : lines[index];
    if (/[ \t]+$/.test(line)) {
      errors.push({
        path: repoPath,
        line: index + 1,
        message: "trailing whitespace in untracked file",
      });
    }
  }
  return errors;
}

function scanUntrackedFile({ root, repoPath }) {
  const absolutePath = path.join(root, repoPath);
  const text = fs.readFileSync(absolutePath, "utf8");
  if (fileHasBinaryNul(text)) {
    return {
      skipped: true,
      reason: "binary file",
      errors: [],
    };
  }
  return {
    skipped: false,
    reason: null,
    errors: trailingWhitespaceErrorsForText(text, toRepoPath(repoPath)),
  };
}

function verifyWhitespace({
  root = process.cwd(),
  runCommand = spawnSync,
  now = new Date(),
  listFiles = listUntrackedFiles,
  scanFile = scanUntrackedFile,
} = {}) {
  const gitDiff = runGitDiffCheck({ root, runCommand });
  const untrackedFiles = listFiles({ root, runCommand }).map(toRepoPath);
  const checkedUntrackedFiles = [];
  const skippedUntrackedFiles = [];
  const errors = [];

  for (const repoPath of untrackedFiles) {
    const reason = skipReason(repoPath);
    if (reason) {
      skippedUntrackedFiles.push({ path: repoPath, reason });
      continue;
    }
    if (!isUntrackedTextCandidate(repoPath)) {
      skippedUntrackedFiles.push({ path: repoPath, reason: "not source/doc/config text" });
      continue;
    }
    const result = scanFile({ root, repoPath });
    if (result.skipped) {
      skippedUntrackedFiles.push({ path: repoPath, reason: result.reason });
      continue;
    }
    checkedUntrackedFiles.push(repoPath);
    errors.push(...result.errors);
  }

  const ok = gitDiff.status === 0 && errors.length === 0;
  return {
    checkedAt: now.toISOString(),
    status: ok ? "pass" : "fail",
    ok,
    gitDiff,
    checkedUntrackedFiles,
    checkedUntrackedCount: checkedUntrackedFiles.length,
    skippedUntrackedFiles,
    skippedUntrackedCount: skippedUntrackedFiles.length,
    errors,
  };
}

function main() {
  try {
    const result = verifyWhitespace();
    console.log(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = result.gitDiff.status || 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  CONFIG_FILENAMES,
  SOURCE_ROOTS,
  TEXT_EXTENSIONS,
  isGeneratedEvidenceLog,
  isUntrackedTextCandidate,
  listUntrackedFiles,
  runGitDiffCheck,
  skipReason,
  toRepoPath,
  trailingWhitespaceErrorsForText,
  verifyWhitespace,
};
