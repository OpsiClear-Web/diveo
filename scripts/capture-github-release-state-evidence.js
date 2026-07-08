#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_WORKFLOW_NAME = "Release APK";
const DEFAULT_DEVICE_VALIDATION_WORKFLOW_NAME = "Device Validation";
const DEFAULT_RELEASE_RUN_LIMIT = 10;
const DEFAULT_WORKFLOW_DISPATCH_LIMIT = 20;
const DEFAULT_RELEASE_LIMIT = 20;
const RUN_JSON_FIELDS = [
  "databaseId",
  "workflowName",
  "displayTitle",
  "headBranch",
  "headSha",
  "status",
  "conclusion",
  "event",
  "createdAt",
  "updatedAt",
  "url",
];
const RELEASE_JSON_FIELDS = [
  "tagName",
  "name",
  "isDraft",
  "isImmutable",
  "isLatest",
  "isPrerelease",
  "publishedAt",
];

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

function shellQuote(value) {
  const text = String(value);
  if (!/[\s'"`]/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function formatCommand(command, args) {
  return [command, ...args].map(shellQuote).join(" ");
}

function positiveInt(value, fallback, label) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function runGhJson(args, runCommand) {
  const result = runCommand("gh", args);
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  return {
    command: formatCommand("gh", args),
    exitCode: result.status ?? (result.error ? 1 : 0),
    stderr: stderr.trim(),
    output: parseJson(stdout),
    error: result.error?.message ?? null,
  };
}

function runGhApi(endpoint, runCommand) {
  return runGhJson(["api", endpoint], runCommand);
}

function runGhRunList(args, runCommand) {
  return runGhJson(["run", "list", ...args], runCommand);
}

function runGhReleaseList(args, runCommand) {
  return runGhJson(["release", "list", ...args], runCommand);
}

function arrayOutput(query, pathKey = null) {
  if (Array.isArray(query.output)) return query.output;
  if (pathKey && Array.isArray(query.output?.[pathKey])) return query.output[pathKey];
  return [];
}

function messageFor(query) {
  return query.output?.message ?? query.error ?? query.stderr ?? "unknown error";
}

function summarizeQuery(query, output) {
  return {
    command: query.command,
    exitCode: query.exitCode,
    stderr: query.stderr,
    message: query.exitCode === 0 ? null : messageFor(query),
    output,
    error: query.error,
  };
}

function summarizeWorkflow(workflow) {
  return {
    id: workflow.id ?? null,
    nodeId: workflow.node_id ?? workflow.nodeId ?? null,
    name: workflow.name ?? null,
    path: workflow.path ?? null,
    state: workflow.state ?? null,
    createdAt: workflow.created_at ?? workflow.createdAt ?? null,
    updatedAt: workflow.updated_at ?? workflow.updatedAt ?? null,
    url: workflow.url ?? null,
    htmlUrl: workflow.html_url ?? workflow.htmlUrl ?? null,
    badgeUrl: workflow.badge_url ?? workflow.badgeUrl ?? null,
  };
}

function summarizeRun(run) {
  return {
    databaseId: run.databaseId ?? null,
    workflowName: run.workflowName ?? null,
    displayTitle: run.displayTitle ?? null,
    headBranch: run.headBranch ?? null,
    headSha: run.headSha ?? null,
    status: run.status ?? null,
    conclusion: run.conclusion ?? null,
    event: run.event ?? null,
    createdAt: run.createdAt ?? null,
    updatedAt: run.updatedAt ?? null,
    url: run.url ?? null,
  };
}

function summarizeRelease(release) {
  return {
    tagName: release.tagName ?? null,
    name: release.name ?? null,
    isDraft: release.isDraft ?? null,
    isImmutable: release.isImmutable ?? null,
    isLatest: release.isLatest ?? null,
    isPrerelease: release.isPrerelease ?? null,
    publishedAt: release.publishedAt ?? null,
  };
}

function reviewerErrors({ reviewer, reviewedAt }) {
  const errors = [];
  if (!reviewer || /^<.+>$/.test(reviewer) || /^(?:owner|reviewer|release owner|native release owner)$/i.test(reviewer)) {
    errors.push("reviewer is required for release-state evidence");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(reviewedAt) || Number.isNaN(Date.parse(reviewedAt))) {
    errors.push("reviewedAt must be an ISO timestamp");
  }
  return errors;
}

function releaseStateBlockers({
  workflowName,
  deviceWorkflowName,
  workflowsQuery,
  releaseRunsQuery,
  workflowDispatchRunsQuery,
  releasesQuery,
  releaseWorkflowPresent,
  deviceValidationWorkflowPresent,
  latestReleaseApkRun,
  releaseWorkflowDispatchRuns,
  successfulReleaseWorkflowDispatchRuns,
}) {
  const blockers = [];
  for (const [label, query] of [
    ["workflows query", workflowsQuery],
    ["Release APK run query", releaseRunsQuery],
    ["workflow_dispatch run query", workflowDispatchRunsQuery],
    ["GitHub release query", releasesQuery],
  ]) {
    if (query.exitCode !== 0) blockers.push(`${label} failed: ${messageFor(query)}`);
  }
  if (!releaseWorkflowPresent) {
    blockers.push(`${workflowName} workflow is not active or not present`);
  }
  if (!deviceValidationWorkflowPresent) {
    blockers.push(`${deviceWorkflowName} workflow is not active or not present`);
  }
  if (releaseWorkflowDispatchRuns.length === 0) {
    blockers.push("no workflow_dispatch runs found for the current fixed-candidate dry-run requirement");
  } else if (successfulReleaseWorkflowDispatchRuns.length === 0) {
    blockers.push(`no successful ${workflowName} workflow_dispatch dry run found`);
  }
  if (latestReleaseApkRun && latestReleaseApkRun.event !== "workflow_dispatch") {
    blockers.push(`latest ${workflowName} run is ${latestReleaseApkRun.event ?? "unknown"}, not a fixed-candidate dry run`);
  }
  return blockers;
}

function captureGitHubReleaseStateEvidence({
  repo,
  workflowName = DEFAULT_WORKFLOW_NAME,
  deviceWorkflowName = DEFAULT_DEVICE_VALIDATION_WORKFLOW_NAME,
  releaseRunLimit = DEFAULT_RELEASE_RUN_LIMIT,
  workflowDispatchLimit = DEFAULT_WORKFLOW_DISPATCH_LIMIT,
  releaseLimit = DEFAULT_RELEASE_LIMIT,
  reviewer = process.env.GITHUB_ACTOR ?? null,
  reviewedAt = new Date().toISOString(),
  runCommand = (command, args) => spawnSync(command, args, { encoding: "utf8" }),
} = {}) {
  const normalizedRepo = normalizeRepo(repo ?? process.env.GITHUB_REPOSITORY);
  const normalizedWorkflowName = String(workflowName || DEFAULT_WORKFLOW_NAME).trim();
  if (!normalizedWorkflowName) throw new Error("workflowName is required");
  const normalizedDeviceWorkflowName = String(deviceWorkflowName || DEFAULT_DEVICE_VALIDATION_WORKFLOW_NAME).trim();
  if (!normalizedDeviceWorkflowName) throw new Error("deviceWorkflowName is required");

  const normalizedReleaseRunLimit = positiveInt(releaseRunLimit, DEFAULT_RELEASE_RUN_LIMIT, "releaseRunLimit");
  const normalizedWorkflowDispatchLimit = positiveInt(workflowDispatchLimit, DEFAULT_WORKFLOW_DISPATCH_LIMIT, "workflowDispatchLimit");
  const normalizedReleaseLimit = positiveInt(releaseLimit, DEFAULT_RELEASE_LIMIT, "releaseLimit");

  const workflowsQuery = runGhApi(`repos/${normalizedRepo}/actions/workflows`, runCommand);
  const releaseRunsQuery = runGhRunList([
    "-R", normalizedRepo,
    "--workflow", normalizedWorkflowName,
    "--limit", String(normalizedReleaseRunLimit),
    "--json", RUN_JSON_FIELDS.join(","),
  ], runCommand);
  const workflowDispatchRunsQuery = runGhRunList([
    "-R", normalizedRepo,
    "--event", "workflow_dispatch",
    "--limit", String(normalizedWorkflowDispatchLimit),
    "--json", RUN_JSON_FIELDS.join(","),
  ], runCommand);
  const releasesQuery = runGhReleaseList([
    "-R", normalizedRepo,
    "--limit", String(normalizedReleaseLimit),
    "--json", RELEASE_JSON_FIELDS.join(","),
  ], runCommand);

  const workflows = arrayOutput(workflowsQuery, "workflows").map(summarizeWorkflow);
  const workflowNames = workflows.map((workflow) => workflow.name).filter(Boolean);
  const releaseWorkflowPresent = workflows.some((workflow) => (
    workflow.name === normalizedWorkflowName && (!workflow.state || workflow.state === "active")
  ));
  const deviceValidationWorkflowPresent = workflows.some((workflow) => (
    workflow.name === normalizedDeviceWorkflowName && (!workflow.state || workflow.state === "active")
  ));
  const latestReleaseApkRuns = arrayOutput(releaseRunsQuery).map(summarizeRun);
  const latestReleaseApkRun = latestReleaseApkRuns[0] ?? null;
  const workflowDispatchRuns = arrayOutput(workflowDispatchRunsQuery).map(summarizeRun);
  const releaseWorkflowDispatchRuns = workflowDispatchRuns
    .filter((run) => run.workflowName === normalizedWorkflowName);
  const successfulReleaseWorkflowDispatchRuns = releaseWorkflowDispatchRuns
    .filter((run) => run.status === "completed" && run.conclusion === "success");
  const releases = arrayOutput(releasesQuery).map(summarizeRelease);
  const blockers = [
    ...reviewerErrors({ reviewer, reviewedAt }),
    ...releaseStateBlockers({
      workflowName: normalizedWorkflowName,
      deviceWorkflowName: normalizedDeviceWorkflowName,
      workflowsQuery,
      releaseRunsQuery,
      workflowDispatchRunsQuery,
      releasesQuery,
      releaseWorkflowPresent,
      deviceValidationWorkflowPresent,
      latestReleaseApkRun,
      releaseWorkflowDispatchRuns,
      successfulReleaseWorkflowDispatchRuns,
    }),
  ];

  return {
    checkedAt: new Date().toISOString(),
    status: blockers.length === 0 ? "pass" : "no-publish",
    ok: blockers.length === 0,
    repository: normalizedRepo,
    workflowName: normalizedWorkflowName,
    deviceWorkflowName: normalizedDeviceWorkflowName,
    review: {
      reviewer,
      reviewedAt,
    },
    commands: {
      workflows: workflowsQuery.command,
      releaseRuns: releaseRunsQuery.command,
      workflowDispatchRuns: workflowDispatchRunsQuery.command,
      releases: releasesQuery.command,
    },
    workflows,
    workflowNames,
    releaseWorkflowPresent,
    deviceValidationWorkflowPresent,
    latestReleaseApkRuns,
    latestReleaseApkRun,
    workflowDispatchRuns,
    releaseWorkflowDispatchRuns,
    successfulReleaseWorkflowDispatchRuns,
    releases,
    releaseState: {
      releaseCount: releases.length,
      noGitHubReleasesObserved: releases.length === 0,
      latestReleaseApkRunEvent: latestReleaseApkRun?.event ?? null,
      latestReleaseWorkflowDispatchRun: releaseWorkflowDispatchRuns[0] ?? null,
    },
    querySummaries: {
      workflows: summarizeQuery(workflowsQuery, { workflowCount: workflows.length }),
      releaseRuns: summarizeQuery(releaseRunsQuery, { runCount: latestReleaseApkRuns.length }),
      workflowDispatchRuns: summarizeQuery(workflowDispatchRunsQuery, { runCount: workflowDispatchRuns.length }),
      releases: summarizeQuery(releasesQuery, { releaseCount: releases.length }),
    },
    blockers,
    releaseReadinessImpact: {
      status: blockers.length === 0 ? "ready" : "no-publish",
      qaRow: "GitHub Actions release dry run / Release workflow dry run",
      requiredBeforePass: blockers.length === 0
        ? []
        : [
          "workflow_dispatch publish_release=false run with fixed candidate_ref and production secrets",
          "artifact diveo-release-evidence-v<version> from that run",
          "reviewed dry-run summary, checksums, no-publish proof, and publishArtifactIdentitySha256",
          ...(deviceValidationWorkflowPresent ? [] : ["active Device Validation workflow in the remote repository"]),
        ],
    },
  };
}

function writeGitHubReleaseStateEvidence(options) {
  if (!options.outputPath) throw new Error("outputPath is required");
  const result = captureGitHubReleaseStateEvidence(options);
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(result, null, 2)}\n`);
  return { result, outputPath: options.outputPath };
}

function main() {
  const options = parseArgs();
  const { result, outputPath } = writeGitHubReleaseStateEvidence({
    repo: options.repo,
    workflowName: options.workflowName,
    deviceWorkflowName: options.deviceWorkflowName,
    releaseRunLimit: options.releaseRunLimit,
    workflowDispatchLimit: options.workflowDispatchLimit,
    releaseLimit: options.releaseLimit,
    outputPath: options.outputPath,
    reviewer: options.reviewer,
    reviewedAt: options.reviewedAt,
  });
  console.log(JSON.stringify({
    status: result.status,
    ok: result.ok,
    outputPath: normalizeSlash(outputPath),
    repository: result.repository,
    workflowName: result.workflowName,
    deviceWorkflowName: result.deviceWorkflowName,
    releaseWorkflowPresent: result.releaseWorkflowPresent,
    deviceValidationWorkflowPresent: result.deviceValidationWorkflowPresent,
    latestReleaseApkRun: result.latestReleaseApkRun
      ? {
        databaseId: result.latestReleaseApkRun.databaseId,
        event: result.latestReleaseApkRun.event,
        conclusion: result.latestReleaseApkRun.conclusion,
        url: result.latestReleaseApkRun.url,
      }
      : null,
    workflowDispatchRunCount: result.workflowDispatchRuns.length,
    releaseWorkflowDispatchRunCount: result.releaseWorkflowDispatchRuns.length,
    releaseCount: result.releases.length,
    blockers: result.blockers,
  }, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  captureGitHubReleaseStateEvidence,
  normalizeRepo,
  parseArgs,
  writeGitHubReleaseStateEvidence,
};
