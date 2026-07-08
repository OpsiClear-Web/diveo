import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import captureModule from "./capture-github-release-state-evidence.js";

const {
  captureGitHubReleaseStateEvidence,
  normalizeRepo,
  parseArgs,
  writeGitHubReleaseStateEvidence,
} = captureModule;

function ghRunner({
  workflows = [],
  releaseRuns = [],
  workflowDispatchRuns = [],
  releases = [],
  failure = null,
} = {}) {
  return (command, args) => {
    expect(command).toBe("gh");
    if (failure && args.join(" ").includes(failure.includes)) {
      return {
        status: 1,
        stdout: JSON.stringify({ message: failure.message }),
        stderr: failure.stderr ?? failure.message,
      };
    }
    if (args[0] === "api") {
      return { status: 0, stdout: JSON.stringify({ workflows }), stderr: "" };
    }
    if (args[0] === "run" && args.includes("--workflow")) {
      return { status: 0, stdout: JSON.stringify(releaseRuns), stderr: "" };
    }
    if (args[0] === "run" && args.includes("--event")) {
      return { status: 0, stdout: JSON.stringify(workflowDispatchRuns), stderr: "" };
    }
    if (args[0] === "release") {
      return { status: 0, stdout: JSON.stringify(releases), stderr: "" };
    }
    return {
      status: 1,
      stdout: JSON.stringify({ message: "not mocked" }),
      stderr: "not mocked",
    };
  };
}

describe("GitHub release state evidence capture", () => {
  it("parses CLI flags", () => {
    expect(parseArgs([
      "--repo", "OpsiClear-Web/diveo",
      "--workflow-name", "Release APK",
      "--device-workflow-name", "Device Validation",
      "--output-path", "docs/qa-evidence/date/github-release-state-blocker.json",
      "--release-run-limit", "5",
      "--workflow-dispatch-limit", "7",
      "--release-limit", "3",
      "--reviewer", "@release",
      "--reviewed-at", "2026-07-01T09:00:00Z",
    ])).toEqual({
      repo: "OpsiClear-Web/diveo",
      workflowName: "Release APK",
      deviceWorkflowName: "Device Validation",
      outputPath: "docs/qa-evidence/date/github-release-state-blocker.json",
      releaseRunLimit: "5",
      workflowDispatchLimit: "7",
      releaseLimit: "3",
      reviewer: "@release",
      reviewedAt: "2026-07-01T09:00:00Z",
    });
  });

  it("normalizes repository inputs", () => {
    expect(normalizeRepo("OpsiClear-Web/diveo")).toBe("OpsiClear-Web/diveo");
    expect(normalizeRepo("github.com/OpsiClear-Web/diveo")).toBe("OpsiClear-Web/diveo");
    expect(normalizeRepo("https://github.com/OpsiClear-Web/diveo")).toBe("OpsiClear-Web/diveo");
  });

  it("records no-publish state when no fixed-candidate dispatch exists", () => {
    const result = captureGitHubReleaseStateEvidence({
      repo: "OpsiClear-Web/diveo",
      reviewer: "codex-local-verifier",
      reviewedAt: "2026-07-01T09:00:00Z",
      runCommand: ghRunner({
        workflows: [
          { id: 1, name: "Quality", path: ".github/workflows/quality.yml", state: "active" },
          { id: 2, name: "Release APK", path: ".github/workflows/release.yml", state: "active" },
        ],
        releaseRuns: [
          {
            databaseId: 28015257532,
            workflowName: "Release APK",
            displayTitle: "historical push",
            headBranch: "master",
            headSha: "fdc88ec053ecd4bb2a0a7f489a927eaa02146017",
            status: "completed",
            conclusion: "success",
            event: "push",
            createdAt: "2026-06-23T09:09:12Z",
            updatedAt: "2026-06-23T09:09:54Z",
            url: "https://github.com/OpsiClear-Web/diveo/actions/runs/28015257532",
          },
        ],
        workflowDispatchRuns: [],
        releases: [],
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("no-publish");
    expect(result.releaseWorkflowPresent).toBe(true);
    expect(result.deviceValidationWorkflowPresent).toBe(false);
    expect(result.latestReleaseApkRun.databaseId).toBe(28015257532);
    expect(result.latestReleaseApkRun.event).toBe("push");
    expect(result.workflowDispatchRuns).toEqual([]);
    expect(result.releaseState.noGitHubReleasesObserved).toBe(true);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "Device Validation workflow is not active or not present",
      "no workflow_dispatch runs found for the current fixed-candidate dry-run requirement",
      "latest Release APK run is push, not a fixed-candidate dry run",
    ]));
    expect(result.releaseReadinessImpact.status).toBe("no-publish");
    expect(result.querySummaries.releaseRuns.output.runCount).toBe(1);
  });

  it("passes release-state inventory when a successful release workflow dispatch exists", () => {
    const dispatchRun = {
      databaseId: 281,
      workflowName: "Release APK",
      displayTitle: "dry run",
      headBranch: "evidence-signoff",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "completed",
      conclusion: "success",
      event: "workflow_dispatch",
      createdAt: "2026-07-01T10:00:00Z",
      updatedAt: "2026-07-01T10:10:00Z",
      url: "https://github.com/OpsiClear-Web/diveo/actions/runs/281",
    };
    const result = captureGitHubReleaseStateEvidence({
      repo: "OpsiClear-Web/diveo",
      reviewer: "codex-local-verifier",
      reviewedAt: "2026-07-01T10:15:00Z",
      runCommand: ghRunner({
        workflows: [
          { id: 2, name: "Release APK", path: ".github/workflows/release.yml", state: "active" },
          { id: 3, name: "Device Validation", path: ".github/workflows/device-validation.yml", state: "active" },
        ],
        releaseRuns: [dispatchRun],
        workflowDispatchRuns: [dispatchRun],
        releases: [],
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("pass");
    expect(result.deviceValidationWorkflowPresent).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.successfulReleaseWorkflowDispatchRuns).toEqual([dispatchRun]);
    expect(result.releaseReadinessImpact.status).toBe("ready");
  });

  it("records query failures and reviewer errors", () => {
    const result = captureGitHubReleaseStateEvidence({
      repo: "OpsiClear-Web/diveo",
      reviewer: "reviewer",
      reviewedAt: "not-a-date",
      runCommand: ghRunner({
        workflows: [],
        failure: {
          includes: "actions/workflows",
          message: "bad credentials",
        },
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "reviewer is required for release-state evidence",
      "reviewedAt must be an ISO timestamp",
      "workflows query failed: bad credentials",
      "Release APK workflow is not active or not present",
      "Device Validation workflow is not active or not present",
    ]));
    expect(result.querySummaries.workflows.message).toBe("bad credentials");
  });

  it("writes structured JSON evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "github-release-state-evidence-"));
    const outputPath = join(root, "github-release-state.json");
    const { result } = writeGitHubReleaseStateEvidence({
      repo: "OpsiClear-Web/diveo",
      outputPath,
      reviewer: "codex-local-verifier",
      reviewedAt: "2026-07-01T09:00:00Z",
      runCommand: ghRunner({
        workflows: [
          { id: 2, name: "Release APK", path: ".github/workflows/release.yml", state: "active" },
        ],
        releaseRuns: [],
        workflowDispatchRuns: [],
        releases: [],
      }),
    });

    expect(result.ok).toBe(false);
    expect(existsSync(outputPath)).toBe(true);
    const written = JSON.parse(readFileSync(outputPath, "utf8"));
    expect(written.repository).toBe("OpsiClear-Web/diveo");
    expect(written.deviceWorkflowName).toBe("Device Validation");
    expect(written.deviceValidationWorkflowPresent).toBe(false);
    expect(written.commands.releaseRuns).toContain("gh run list");
    expect(written.commands.releaseRuns).toContain("'Release APK'");
    expect(written.querySummaries.workflows).not.toHaveProperty("stdout");
    expect(written.releaseReadinessImpact.qaRow).toBe("GitHub Actions release dry run / Release workflow dry run");
  });
});
