#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const {
  compareEnv,
  expectedFunctionsEnv,
  expectedNativeEnv,
  expectedWebEnv,
  formatEnvMismatches,
  loadStackProfile,
  readEnvFile,
  renderManagedEnvText,
  resolveStackPaths,
  resolveSupabaseAnonKey,
} = require("./stack-config");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    check: false,
    configPath: "",
    root: process.cwd(),
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
    } else if (arg === "--root") {
      const next = argv[index + 1];
      if (!next) throw new Error("--root requires a path.");
      options.root = path.resolve(next);
      index += 1;
    } else {
      throw new Error("Usage: node scripts/generate-stack-env.js [--check] [--config <path>] [--root <path>]");
    }
  }

  return options;
}

function buildExpectedEnv(paths, env = process.env) {
  const profile = loadStackProfile(paths);
  const nativeEnvFile = readEnvFile(paths.nativeEnvPath);
  const webEnvFile = readEnvFile(paths.webEnvPath);
  const functionsEnvFile = readEnvFile(paths.functionsEnvPath);
  const anonKey = resolveSupabaseAnonKey(profile, nativeEnvFile.values, webEnvFile.values, env);

  return {
    profile,
    nativeEnvFile,
    webEnvFile,
    functionsEnvFile,
    nativeExpected: expectedNativeEnv(profile, anonKey),
    webExpected: expectedWebEnv(profile, anonKey),
    functionsExpected: expectedFunctionsEnv(profile),
  };
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function run(options = parseArgs()) {
  const paths = resolveStackPaths(options.root, options.configPath);
  const {
    nativeEnvFile,
    webEnvFile,
    functionsEnvFile,
    nativeExpected,
    webExpected,
    functionsExpected,
  } = buildExpectedEnv(paths);

  const nativeMismatches = compareEnv(nativeEnvFile.values, nativeExpected);
  const webMismatches = compareEnv(webEnvFile.values, webExpected);
  const functionsMismatches = compareEnv(functionsEnvFile.values, functionsExpected);

  if (options.check) {
    console.log(formatEnvMismatches("diveo .env.local", nativeMismatches));
    console.log(formatEnvMismatches("gsav-hosting apps/web .env.local", webMismatches));
    console.log(formatEnvMismatches("gsav-hosting supabase/functions .env.local", functionsMismatches));
    if (nativeMismatches.length || webMismatches.length || functionsMismatches.length) {
      process.exitCode = 1;
    }
    return {
      nativeMismatches,
      webMismatches,
      functionsMismatches,
      wrote: [],
    };
  }

  const sourceLabel = path.relative(paths.diveoRoot, paths.stackConfigPath).replace(/\\/g, "/");
  const nativeText = renderManagedEnvText(nativeEnvFile.text, nativeExpected, sourceLabel);
  const webText = renderManagedEnvText(webEnvFile.text, webExpected, sourceLabel);
  const functionsText = renderManagedEnvText(functionsEnvFile.text, functionsExpected, sourceLabel);
  ensureParentDirectory(paths.nativeEnvPath);
  ensureParentDirectory(paths.webEnvPath);
  ensureParentDirectory(paths.functionsEnvPath);
  fs.writeFileSync(paths.nativeEnvPath, nativeText);
  fs.writeFileSync(paths.webEnvPath, webText);
  fs.writeFileSync(paths.functionsEnvPath, functionsText);

  console.log(`Wrote ${paths.nativeEnvPath}`);
  console.log(`Wrote ${paths.webEnvPath}`);
  console.log(`Wrote ${paths.functionsEnvPath}`);

  return {
    nativeMismatches,
    webMismatches,
    functionsMismatches,
    wrote: [paths.nativeEnvPath, paths.webEnvPath, paths.functionsEnvPath],
  };
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
  buildExpectedEnv,
  parseArgs,
  run,
};
