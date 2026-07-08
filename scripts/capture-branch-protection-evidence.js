#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_REQUIRED_CHECKS = ["quality / quality"];

function parseArgs(argv = process.argv.slice(2)) {
  const options = { requiredChecks: [] };
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
    if (key === "requiredCheck") {
      options.requiredChecks.push(value);
    } else {
      options[key] = value;
    }
    i += 1;
  }
  if (options.requiredChecks.length === 0) {
    options.requiredChecks = [...DEFAULT_REQUIRED_CHECKS];
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

function runGhApi(endpoint, runCommand) {
  const args = ["api", endpoint];
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

function sortedStrings(values) {
  return [...new Set((values ?? []).map(String))].sort((a, b) => a.localeCompare(b));
}

function summarizeStatusChecks(statusChecks) {
  return {
    strict: statusChecks?.strict ?? null,
    enforcementLevel: statusChecks?.enforcement_level ?? null,
    contexts: sortedStrings(statusChecks?.contexts),
    checks: (statusChecks?.checks ?? [])
      .map((check) => ({
        context: check?.context ?? null,
        name: check?.name ?? null,
        appId: check?.app_id ?? null,
      }))
      .sort((a, b) => String(a.context ?? a.name ?? "").localeCompare(String(b.context ?? b.name ?? ""))),
  };
}

function summarizeBranchOutput(output) {
  if (!output) return null;
  return {
    name: output.name ?? null,
    protected: output.protected === true,
    protectionUrl: output.protection_url ?? null,
    commitSha: output.commit?.sha ?? null,
    htmlUrl: output._links?.html ?? null,
    protection: output.protection
      ? {
        enabled: output.protection.enabled === true,
        requiredStatusChecks: summarizeStatusChecks(output.protection.required_status_checks),
      }
      : null,
  };
}

function summarizeProtectionOutput(output) {
  if (!output) return null;
  if (output.message || output.status) {
    return {
      message: output.message ?? null,
      status: output.status ?? null,
      documentationUrl: output.documentation_url ?? null,
    };
  }
  return {
    requiredStatusChecks: summarizeStatusChecks(output.required_status_checks),
    enforceAdmins: output.enforce_admins?.enabled ?? null,
    requiredPullRequestReviews: output.required_pull_request_reviews
      ? {
        dismissStaleReviews: output.required_pull_request_reviews.dismiss_stale_reviews ?? null,
        requiredApprovingReviewCount: output.required_pull_request_reviews.required_approving_review_count ?? null,
      }
      : null,
    restrictions: output.restrictions
      ? {
        users: (output.restrictions.users ?? []).map((user) => user.login).filter(Boolean).sort(),
        teams: (output.restrictions.teams ?? []).map((team) => team.slug).filter(Boolean).sort(),
        apps: (output.restrictions.apps ?? []).map((app) => app.slug ?? app.name).filter(Boolean).sort(),
      }
      : null,
  };
}

function summarizeGhQuery(query, summarizeOutput) {
  return {
    command: query.command,
    exitCode: query.exitCode,
    stderr: query.stderr,
    message: query.output?.message ?? query.error ?? (query.stderr || null),
    output: summarizeOutput(query.output),
    error: query.error,
  };
}

function requiredStatusCheckNames(protection) {
  const checks = new Set();
  const statusChecks = protection?.required_status_checks;
  for (const context of statusChecks?.contexts ?? []) {
    checks.add(String(context));
  }
  for (const check of statusChecks?.checks ?? []) {
    if (check?.context) checks.add(String(check.context));
    if (check?.name) checks.add(String(check.name));
  }
  return [...checks].sort((a, b) => a.localeCompare(b));
}

function outputMessage(query) {
  return query.output?.message ?? query.error ?? query.stderr ?? "unknown error";
}

function branchProtectionErrors({ branch, branchQuery, protectionQuery, requiredChecks, reviewer, reviewedAt }) {
  const errors = [];
  if (branchQuery.exitCode !== 0) {
    errors.push(`branch query failed: ${outputMessage(branchQuery)}`);
  }
  if (branchQuery.output?.protected !== true) {
    errors.push(`${branch} is not protected`);
  }
  if (protectionQuery.exitCode !== 0) {
    errors.push(`branch protection query failed: ${outputMessage(protectionQuery)}`);
  }

  const observedChecks = requiredStatusCheckNames(protectionQuery.output);
  for (const required of requiredChecks) {
    if (!observedChecks.includes(required)) {
      errors.push(`required status check missing: ${required}`);
    }
  }

  if (!reviewer || /^<.+>$/.test(reviewer) || /^(?:owner|reviewer|release owner|native release owner)$/i.test(reviewer)) {
    errors.push("reviewer is required for release-readiness evidence");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(reviewedAt) || Number.isNaN(Date.parse(reviewedAt))) {
    errors.push("reviewedAt must be an ISO timestamp");
  }
  return errors;
}

function captureBranchProtectionEvidence({
  repo,
  branch = "master",
  requiredChecks = DEFAULT_REQUIRED_CHECKS,
  reviewer = process.env.GITHUB_ACTOR ?? null,
  reviewedAt = new Date().toISOString(),
  runCommand = (command, args) => spawnSync(command, args, { encoding: "utf8" }),
} = {}) {
  const normalizedRepo = normalizeRepo(repo ?? process.env.GITHUB_REPOSITORY);
  const normalizedBranch = String(branch || "master").trim();
  if (!normalizedBranch) throw new Error("branch is required");

  const branchQuery = runGhApi(`repos/${normalizedRepo}/branches/${normalizedBranch}`, runCommand);
  const protectionQuery = runGhApi(`repos/${normalizedRepo}/branches/${normalizedBranch}/protection`, runCommand);
  const observedRequiredChecks = requiredStatusCheckNames(protectionQuery.output);
  const errors = branchProtectionErrors({
    branch: normalizedBranch,
    branchQuery,
    protectionQuery,
    requiredChecks,
    reviewer,
    reviewedAt,
  });

  return {
    checkedAt: new Date().toISOString(),
    status: errors.length === 0 ? "pass" : "no-publish",
    ok: errors.length === 0,
    errors,
    repository: normalizedRepo,
    branch: normalizedBranch,
    requiredChecks,
    observedRequiredChecks,
    review: {
      reviewer,
      reviewedAt,
    },
    branchQuery: summarizeGhQuery(branchQuery, summarizeBranchOutput),
    protectionQuery: summarizeGhQuery(protectionQuery, summarizeProtectionOutput),
    releaseReadinessImpact: {
      status: errors.length === 0 ? "ready" : "no-publish",
      qaRow: "Branch protection / Master branch protection",
      requiredBeforePass: errors,
    },
  };
}

function writeBranchProtectionEvidence(options) {
  if (!options.outputPath) throw new Error("outputPath is required");
  const result = captureBranchProtectionEvidence(options);
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(result, null, 2)}\n`);
  return { result, outputPath: options.outputPath };
}

function main() {
  const options = parseArgs();
  const { result, outputPath } = writeBranchProtectionEvidence({
    repo: options.repo,
    branch: options.branch,
    outputPath: options.outputPath,
    requiredChecks: options.requiredChecks,
    reviewer: options.reviewer,
    reviewedAt: options.reviewedAt,
  });
  console.log(JSON.stringify({
    status: result.status,
    ok: result.ok,
    outputPath: normalizeSlash(outputPath),
    repository: result.repository,
    branch: result.branch,
    observedRequiredChecks: result.observedRequiredChecks,
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
  captureBranchProtectionEvidence,
  normalizeRepo,
  parseArgs,
  requiredStatusCheckNames,
  summarizeBranchOutput,
  summarizeProtectionOutput,
  writeBranchProtectionEvidence,
};
