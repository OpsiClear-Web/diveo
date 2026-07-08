const path = require("node:path");
const { execFileSync } = require("node:child_process");

function commandVersion(command, args, execFile = execFileSync) {
  try {
    return execFile(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function npmVersionFromEnv(env = process.env) {
  const match = /\bnpm\/([^\s]+)/i.exec(env.npm_config_user_agent || "");
  return match?.[1] ?? null;
}

function npmVersion(execFile = execFileSync, env = process.env) {
  return commandVersion(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"], execFile)
    || commandVersion("npm", ["--version"], execFile)
    || npmVersionFromEnv(env);
}

function gitCommit(cwd, execFile = execFileSync) {
  try {
    return execFile("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function gitStatusShort(cwd, execFile = execFileSync) {
  try {
    const output = execFile("git", ["status", "--short"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd();
    return output ? output.split(/\r?\n/) : [];
  } catch {
    return null;
  }
}

function createEvidenceMetadata({
  diveoRoot = path.resolve(__dirname, ".."),
  gsavHostingRoot = path.resolve(__dirname, "..", "..", "gsav-hosting"),
  env = process.env,
  execFile = execFileSync,
} = {}) {
  const diveoGitStatus = gitStatusShort(diveoRoot, execFile);
  return {
    nodeVersion: process.version,
    npmVersion: npmVersion(execFile, env),
    diveoCommit: env.RELEASE_CANDIDATE_SHA || env.RELEASE_PAYLOAD_CANDIDATE_SHA || gitCommit(diveoRoot, execFile),
    diveoGitStatus: {
      status: Array.isArray(diveoGitStatus) ? (diveoGitStatus.length === 0 ? "clean" : "dirty") : "unknown",
      entries: Array.isArray(diveoGitStatus) ? diveoGitStatus : null,
    },
    gsavHostingCommit: env.GSAV_HOSTING_COMMIT || env.GSAV_HOST_BUILD_ID || gitCommit(gsavHostingRoot, execFile),
  };
}

module.exports = {
  commandVersion,
  createEvidenceMetadata,
  gitCommit,
  gitStatusShort,
  npmVersion,
  npmVersionFromEnv,
};
