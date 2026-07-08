const path = require("node:path");
const { execFileSync } = require("node:child_process");

function normalizeSlash(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function repoRelativePath(root, filePath) {
  const raw = normalizeSlash(filePath).trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;

  const absoluteRoot = path.resolve(root);
  const absolutePath = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(absoluteRoot, raw);
  const relativePath = normalizeSlash(path.relative(absoluteRoot, absolutePath));

  if (
    !relativePath
    || relativePath === "."
    || relativePath === ".."
    || relativePath.startsWith("../")
    || path.isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath;
}

function gitOutput(root, args, execFile = execFileSync) {
  return execFile("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function uniqueRelativePaths(root, filePaths) {
  const paths = [];
  const seen = new Set();
  for (const filePath of filePaths ?? []) {
    const relativePath = repoRelativePath(root, filePath);
    const key = relativePath ?? normalizeSlash(filePath);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    paths.push({ original: normalizeSlash(filePath), relativePath });
  }
  return paths;
}

function trackedCleanPathProblems(root, filePaths, {
  insideRepositoryMessage = (filePath) => `file must be inside the repository before final readiness: ${filePath}`,
  untrackedMessage = (relativePath) => `file must be tracked in git before final readiness: ${relativePath}`,
  dirtyMessage = (status) => `files must be committed before final readiness: ${status}`,
  noGitMessage = () => "files must be checked in a git workspace before final readiness.",
} = {}) {
  const paths = uniqueRelativePaths(root, filePaths);
  if (paths.length === 0) return [];

  const problems = [];
  const trackedPaths = [];
  for (const { original, relativePath } of paths) {
    if (!relativePath) {
      problems.push(insideRepositoryMessage(original));
      continue;
    }
    try {
      gitOutput(root, ["ls-files", "--error-unmatch", "--", relativePath]);
      trackedPaths.push(relativePath);
    } catch {
      problems.push(untrackedMessage(relativePath));
    }
  }

  if (trackedPaths.length > 0) {
    try {
      const status = gitOutput(root, ["status", "--porcelain", "--untracked-files=normal", "--", ...trackedPaths]);
      if (status) {
        const normalizedStatus = status
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .join(", ");
        problems.push(dirtyMessage(normalizedStatus));
      }
    } catch {
      problems.push(noGitMessage());
    }
  }

  return problems;
}

module.exports = {
  gitOutput,
  normalizeSlash,
  repoRelativePath,
  trackedCleanPathProblems,
  uniqueRelativePaths,
};
