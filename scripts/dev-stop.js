#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { resolveStackPaths } = require("./stack-config");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    configPath: "",
    root: process.cwd(),
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
    } else {
      throw new Error("Usage: node scripts/dev-stop.js [--config <path>] [--root <path>]");
    }
  }

  return options;
}

function stackStatePath(paths) {
  return path.join(paths.diveoRoot, ".codex", "dev-stack.json");
}

function stopProcessTree(pid) {
  if (process.platform === "win32") {
    return spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "pipe",
      encoding: "utf8",
    });
  }
  try {
    process.kill(-pid, "SIGTERM");
    return { status: 0, stdout: "", stderr: "" };
  } catch (error) {
    return { status: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

function run(options = parseArgs()) {
  const paths = resolveStackPaths(options.root, options.configPath);
  const statePath = stackStatePath(paths);
  if (!fs.existsSync(statePath)) {
    console.log(`No dev stack state found at ${statePath}.`);
    return { stopped: [] };
  }

  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const stopped = [];
  for (const item of state.started ?? []) {
    if (!item.pid) continue;
    const result = stopProcessTree(item.pid);
    if (result.status === 0) {
      console.log(`stopped - ${item.label}: pid=${item.pid}`);
      stopped.push(item);
    } else {
      console.warn(`warn - could not stop ${item.label} pid=${item.pid}: ${result.stderr || result.stdout}`);
    }
  }

  fs.unlinkSync(statePath);
  return { stopped };
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  run,
  stopProcessTree,
};
