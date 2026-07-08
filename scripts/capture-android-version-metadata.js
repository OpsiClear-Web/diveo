#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = value;
    i += 1;
  }
  return options;
}

function normalizeSlash(value) {
  return value.replace(/\\/g, "/");
}

function isExecutableName(fileName, baseName) {
  const lower = fileName.toLowerCase();
  return lower === baseName || lower === `${baseName}.exe` || lower === `${baseName}.bat` || lower === `${baseName}.cmd`;
}

function findFilesByName(root, baseName) {
  const matches = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (isExecutableName(entry.name, baseName)) {
        matches.push(fullPath);
      }
    }
  }
  walk(root);
  return matches.sort((a, b) => normalizeSlash(a).localeCompare(normalizeSlash(b)));
}

function uniqueCommands(commands) {
  const seen = new Set();
  return commands.filter((command) => {
    const key = `${command.source}\0${command.command}\0${command.args.join("\0")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function discoverMetadataCommands(apkPath, env = process.env) {
  const commands = [];
  const add = (source, command, args) => {
    if (command) commands.push({ source, command, args });
  };

  add("aapt dump badging", env.AAPT, ["dump", "badging", apkPath]);
  if (env.ANDROID_HOME) {
    for (const aapt of findFilesByName(path.join(env.ANDROID_HOME, "build-tools"), "aapt")) {
      add("aapt dump badging", aapt, ["dump", "badging", apkPath]);
    }
  }
  add("aapt dump badging", "aapt", ["dump", "badging", apkPath]);

  add("apkanalyzer manifest print", env.APKANALYZER, ["manifest", "print", apkPath]);
  if (env.ANDROID_HOME) {
    for (const analyzer of findFilesByName(path.join(env.ANDROID_HOME, "cmdline-tools"), "apkanalyzer")) {
      add("apkanalyzer manifest print", analyzer, ["manifest", "print", apkPath]);
    }
  }
  add("apkanalyzer manifest print", "apkanalyzer", ["manifest", "print", apkPath]);

  add("bundletool dump manifest", env.BUNDLETOOL, ["dump", "manifest", "--apk", apkPath]);
  add("bundletool dump manifest", "bundletool", ["dump", "manifest", "--apk", apkPath]);

  return uniqueCommands(commands);
}

function extractVersionCode(text) {
  const match = /versionCode(?:=|\s*[: ]\s*)['"]?(\d+)/i.exec(text);
  return match?.[1] ?? null;
}

function formatCommand(command) {
  return [command.command, ...command.args].join(" ");
}

function commandResultReason(result) {
  if (result.error) return result.error.message;
  if (result.status !== 0) return `exit ${result.status}`;
  return "no versionCode in output";
}

function normalizeExpectedVersionCode(expectedVersionCode) {
  if (expectedVersionCode == null || expectedVersionCode === "") return null;
  const normalized = String(expectedVersionCode);
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`expectedVersionCode must be numeric: ${expectedVersionCode}`);
  }
  return normalized;
}

function captureAndroidVersionMetadata({
  apkPath,
  expectedVersionCode = null,
  commands = discoverMetadataCommands(apkPath),
  runCommand = (command, args) => spawnSync(command, args, { encoding: "utf8" }),
}) {
  if (!apkPath) throw new Error("apkPath is required");
  if (!fs.existsSync(apkPath)) throw new Error(`APK file is missing: ${apkPath}`);

  const expected = normalizeExpectedVersionCode(expectedVersionCode);
  const attempts = [];
  let mismatch = null;
  for (const command of commands) {
    const result = runCommand(command.command, command.args);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const versionCode = result.status === 0 ? extractVersionCode(output) : null;
    const isMismatch = versionCode && expected && versionCode !== expected;
    attempts.push({
      source: command.source,
      command: formatCommand(command),
      status: result.status ?? null,
      reason: isMismatch
        ? `versionCode ${versionCode} did not match expected ${expected}`
        : versionCode ? "versionCode found" : commandResultReason(result),
    });

    if (isMismatch) {
      mismatch = {
        source: command.source,
        command: formatCommand(command),
        versionCode,
        output,
      };
      continue;
    }

    if (versionCode) {
      return {
        ok: true,
        status: "pass",
        source: command.source,
        command: formatCommand(command),
        versionCode,
        expectedVersionCode: expected,
        output,
        attempts,
      };
    }
  }

  return {
    ok: false,
    status: mismatch ? "fail" : "exception-required",
    source: mismatch?.source ?? "unavailable",
    command: mismatch?.command ?? null,
    versionCode: mismatch?.versionCode ?? null,
    expectedVersionCode: expected,
    output: mismatch?.output ?? "",
    attempts,
  };
}

function formatMetadataCapture(result) {
  const lines = [
    `status: ${result.status ?? (result.ok ? "pass" : "exception-required")}`,
    `source: ${result.source}`,
  ];
  if (result.command) lines.push(`command: ${result.command}`);
  if (result.expectedVersionCode) lines.push(`expectedVersionCode: ${result.expectedVersionCode}`);
  if (result.versionCode) lines.push(`versionCode: ${result.versionCode}`);
  lines.push("attempts:");
  for (const attempt of result.attempts) {
    lines.push(`- ${attempt.source}: ${attempt.reason}; command: ${attempt.command}`);
  }
  if (result.output.trim()) {
    lines.push("output:");
    lines.push(result.output.trimEnd());
  } else {
    lines.push("output:");
    lines.push("No generated APK metadata command produced versionCode output. Record a release-owner exception with an accepted generated APK metadata source: aapt dump badging, apkanalyzer manifest print, or bundletool dump manifest output with versionCode.");
  }
  return `${lines.join("\n")}\n`;
}

function writeAndroidVersionMetadata(options) {
  const outputPath = options.outputPath;
  if (!outputPath) throw new Error("outputPath is required");
  const result = captureAndroidVersionMetadata(options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, formatMetadataCapture(result));
  return { result, outputPath };
}

function runCli(argv = process.argv.slice(2), {
  write = writeAndroidVersionMetadata,
  log = console.log,
} = {}) {
  const options = parseArgs(argv);
  const { result, outputPath } = write({
    apkPath: options.apkPath,
    outputPath: options.outputPath,
    expectedVersionCode: options.expectedVersionCode,
  });
  const summary = {
    status: result.status ?? (result.ok ? "pass" : "exception-required"),
    outputPath: normalizeSlash(outputPath),
    source: result.source,
    versionCode: result.versionCode,
    expectedVersionCode: result.expectedVersionCode,
    attempts: result.attempts.map((attempt) => attempt.source),
  };
  log(JSON.stringify(summary, null, 2));
  return { result, outputPath, summary };
}

function main() {
  const { result } = runCli();
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  captureAndroidVersionMetadata,
  discoverMetadataCommands,
  extractVersionCode,
  formatMetadataCapture,
  normalizeExpectedVersionCode,
  parseArgs,
  runCli,
  writeAndroidVersionMetadata,
};
