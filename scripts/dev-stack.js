#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { run: generateEnv } = require("./generate-stack-env");
const { run: seedAssets } = require("./seed-stack-assets");
const { loadStackProfile, resolveStackPaths } = require("./stack-config");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    configPath: "",
    root: process.cwd(),
    skipExpo: false,
    skipAssets: false,
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
    } else if (arg === "--skip-expo") {
      options.skipExpo = true;
    } else if (arg === "--skip-assets") {
      options.skipAssets = true;
    } else {
      throw new Error("Usage: node scripts/dev-stack.js [--config <path>] [--root <path>] [--skip-expo] [--skip-assets]");
    }
  }

  return options;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function stackStatePath(paths) {
  return path.join(paths.diveoRoot, ".codex", "dev-stack.json");
}

function logPath(paths, name, stream) {
  return path.join(paths.diveoRoot, ".codex", `${name}.${stream}.log`);
}

async function fetchOk(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntil(name, url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fetchOk(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`${name} did not become reachable at ${url} within ${timeoutMs}ms.`);
}

function runForeground(label, cwd, args) {
  console.log(`start - ${label}: npm ${args.join(" ")}`);
  const result = spawnSync(npmCommand, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`);
  }
}

function startBackground(paths, label, cwd, args) {
  ensureDirectory(path.join(paths.diveoRoot, ".codex"));
  const stdout = fs.openSync(logPath(paths, label, "out"), "a");
  const stderr = fs.openSync(logPath(paths, label, "err"), "a");
  const child = spawn(npmCommand, args, {
    cwd,
    detached: true,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
  child.unref();
  console.log(`start - ${label}: pid=${child.pid}, log=${logPath(paths, label, "out")}`);
  return {
    label,
    pid: child.pid,
    cwd,
    command: `npm ${args.join(" ")}`,
    stdout: logPath(paths, label, "out"),
    stderr: logPath(paths, label, "err"),
    startedAt: new Date().toISOString(),
  };
}

function expoArgsForNativePreview(nativePreviewUrl) {
  const url = new URL(nativePreviewUrl);
  const args = ["run", "web", "--", "--host", "lan"];
  if (url.port) args.push("--port", url.port);
  return args;
}

function saveStackState(paths, started) {
  ensureDirectory(path.dirname(stackStatePath(paths)));
  fs.writeFileSync(stackStatePath(paths), `${JSON.stringify({ started }, null, 2)}\n`);
}

async function run(options = parseArgs()) {
  const paths = resolveStackPaths(options.root, options.configPath);
  const profile = loadStackProfile(paths);
  const started = [];

  generateEnv({ root: paths.diveoRoot, configPath: options.configPath, check: false });

  if (!await fetchOk(new URL("/auth/v1/health", `${profile.backendUrl}/`).toString())) {
    runForeground("Supabase local stack", paths.gsavHostingRoot, ["run", "supabase:start"]);
  } else {
    console.log(`reuse - Supabase local stack: ${profile.backendUrl}`);
  }

  if (!await fetchOk(profile.catalogUrl)) {
    started.push(startBackground(paths, "supabase-functions", paths.gsavHostingRoot, ["run", "supabase:functions:serve"]));
    await waitUntil("Supabase Edge Functions", profile.catalogUrl);
  } else {
    console.log(`reuse - Supabase Edge Functions: ${profile.catalogUrl}`);
  }

  if (!await fetchOk(profile.webUrl)) {
    started.push(startBackground(paths, "gsav-web", paths.gsavHostingRoot, ["run", "dev:web"]));
    await waitUntil("GSAV web app", profile.webUrl);
  } else {
    console.log(`reuse - GSAV web app: ${profile.webUrl}`);
  }

  if (!options.skipAssets) {
    await seedAssets({
      root: paths.diveoRoot,
      configPath: options.configPath,
      dryRun: false,
      force: false,
    });
  }

  if (!options.skipExpo) {
    if (!await fetchOk(profile.nativePreviewUrl)) {
      started.push(startBackground(paths, "diveo-expo-web", paths.diveoRoot, expoArgsForNativePreview(profile.nativePreviewUrl)));
      await waitUntil("diveo native preview", profile.nativePreviewUrl, 90000);
    } else {
      console.log(`reuse - diveo native preview: ${profile.nativePreviewUrl}`);
    }
  }

  saveStackState(paths, started);

  console.log("");
  console.log("Stack URLs:");
  console.log(`- diveo native preview: ${profile.nativePreviewUrl}`);
  console.log(`- GSAV web app: ${profile.webUrl}`);
  console.log(`- Supabase backend: ${profile.backendUrl}`);
  console.log(`- Catalog: ${profile.catalogUrl}`);
  console.log("");

  const doctorArgs = [path.join(paths.diveoRoot, "scripts", "dev-doctor.js")];
  if (!options.skipAssets) doctorArgs.push("--require-assets");
  const doctor = spawnSync(process.execPath, doctorArgs, {
    cwd: paths.diveoRoot,
    stdio: "inherit",
  });
  if (doctor.status !== 0) process.exitCode = doctor.status ?? 1;

  return { started };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  expoArgsForNativePreview,
  parseArgs,
  run,
};
