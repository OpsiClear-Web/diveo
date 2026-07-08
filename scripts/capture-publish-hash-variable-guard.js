#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const DEFAULT_VARIABLES = [
  "EXPECTED_RELEASE_APK_SHA256",
  "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256",
];

function parseArgs(argv = process.argv.slice(2)) {
  const options = { variables: [] };
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
    if (key === "variable") {
      options.variables.push(value);
    } else {
      options[key] = value;
    }
    i += 1;
  }
  if (options.variables.length === 0) {
    options.variables = [...DEFAULT_VARIABLES];
  }
  return options;
}

function normalizeSlash(value) {
  return String(value).replace(/\\/g, "/");
}

function normalizeRepo(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("repo is required");
  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    if (parsed.hostname.toLowerCase() !== "github.com") {
      throw new Error("repo URL must be on github.com");
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error("repo URL must include owner and repo");
    return `${parts[0]}/${parts[1]}`;
  }
  const normalized = raw.replace(/^github\.com\//i, "").replace(/^\/+|\/+$/g, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) {
    throw new Error("repo must be owner/name");
  }
  return normalized;
}

function parseJson(text) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch {
    return null;
  }
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function isNotFoundResult(query) {
  const text = [
    query.stderr,
    query.stdout,
    query.output?.message,
    query.error,
  ].filter(Boolean).join("\n");
  return /not\s*found|does\s+not\s+exist|no\s+variable|HTTP\s+404|\b404\b/i.test(text);
}

function summarizeVariableOutput(output) {
  if (!output || typeof output !== "object") return null;
  const value = typeof output.value === "string" ? output.value : null;
  return {
    name: output.name ?? null,
    present: true,
    updatedAt: output.updatedAt ?? output.updated_at ?? null,
    valueLooksSha256: value ? /^[a-f0-9]{64}$/i.test(value) : null,
    valueSha256: value ? sha256(value) : null,
  };
}

function runGhVariableGet({ repo, variable, runCommand }) {
  const args = ["variable", "get", variable, "--repo", repo, "--json", "name,value,updatedAt"];
  const result = runCommand("gh", args);
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  return {
    command: formatCommand("gh", args),
    exitCode: result.status ?? (result.error ? 1 : 0),
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    output: parseJson(stdout),
    error: result.error?.message ?? null,
  };
}

function reviewerErrors({ reviewer, reviewedAt }) {
  const errors = [];
  if (!reviewer || /^<.+>$/.test(reviewer) || /^(?:owner|reviewer|release owner|native release owner)$/i.test(reviewer)) {
    errors.push("reviewer is required for release-readiness evidence");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(reviewedAt) || Number.isNaN(Date.parse(reviewedAt))) {
    errors.push("reviewedAt must be an ISO timestamp");
  }
  return errors;
}

function capturePublishHashVariableGuard({
  repo,
  variables = DEFAULT_VARIABLES,
  reviewer = process.env.GITHUB_ACTOR ?? null,
  reviewedAt = new Date().toISOString(),
  runCommand = (command, args) => spawnSync(command, args, { encoding: "utf8" }),
} = {}) {
  const normalizedRepo = normalizeRepo(repo ?? process.env.GITHUB_REPOSITORY);
  const checkedVariables = [...new Set(variables.map((variable) => String(variable).trim()).filter(Boolean))];
  if (checkedVariables.length === 0) throw new Error("at least one variable is required");

  const variableQueries = checkedVariables.map((variable) => {
    const query = runGhVariableGet({ repo: normalizedRepo, variable, runCommand });
    const absent = query.exitCode !== 0 && isNotFoundResult(query);
    const present = query.exitCode === 0;
    const unknown = !present && !absent;
    return {
      name: variable,
      status: present ? "present" : absent ? "absent" : "unknown",
      present,
      absent,
      unknown,
      command: query.command,
      exitCode: query.exitCode,
      stderr: query.stderr,
      message: query.output?.message ?? query.error ?? (query.stderr || null),
      output: summarizeVariableOutput(query.output),
      error: query.error,
    };
  });

  const errors = [
    ...reviewerErrors({ reviewer, reviewedAt }),
    ...variableQueries.flatMap((query) => {
      if (query.present) return [`publish hash repository variable is set before signoff: ${query.name}`];
      if (query.unknown) return [`could not prove publish hash repository variable is absent: ${query.name}`];
      return [];
    }),
  ];

  return {
    checkedAt: new Date().toISOString(),
    status: errors.length === 0 ? "pass" : "no-publish",
    ok: errors.length === 0,
    errors,
    repository: normalizedRepo,
    variables: checkedVariables,
    review: {
      reviewer,
      reviewedAt,
    },
    variableQueries,
    releaseReadinessImpact: {
      status: errors.length === 0 ? "ready" : "no-publish",
      auditBlocker: "Publish expected-hash variable guard",
      requiredBeforePass: errors,
    },
  };
}

function writePublishHashVariableGuardEvidence(options) {
  if (!options.outputPath) throw new Error("outputPath is required");
  const result = capturePublishHashVariableGuard(options);
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(result, null, 2)}\n`);
  return { result, outputPath: options.outputPath };
}

function main() {
  const options = parseArgs();
  const { result, outputPath } = writePublishHashVariableGuardEvidence({
    repo: options.repo,
    variables: options.variables,
    outputPath: options.outputPath,
    reviewer: options.reviewer,
    reviewedAt: options.reviewedAt,
  });
  console.log(JSON.stringify({
    status: result.status,
    ok: result.ok,
    outputPath: normalizeSlash(outputPath),
    repository: result.repository,
    variables: result.variableQueries.map((query) => ({
      name: query.name,
      status: query.status,
      exitCode: query.exitCode,
    })),
    errors: result.errors,
  }, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_VARIABLES,
  capturePublishHashVariableGuard,
  normalizeRepo,
  parseArgs,
  writePublishHashVariableGuardEvidence,
};
