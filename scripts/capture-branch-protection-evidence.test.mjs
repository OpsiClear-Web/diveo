import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import captureModule from "./capture-branch-protection-evidence.js";

const {
  captureBranchProtectionEvidence,
  normalizeRepo,
  parseArgs,
  requiredStatusCheckNames,
  summarizeBranchOutput,
  summarizeProtectionOutput,
  writeBranchProtectionEvidence,
} = captureModule;

function ghRunner(responses) {
  return (command, args) => {
    expect(command).toBe("gh");
    const endpoint = args[1];
    const response = responses[endpoint];
    if (!response) {
      return { status: 1, stdout: JSON.stringify({ message: "not mocked" }), stderr: "not mocked" };
    }
    return {
      status: response.status,
      stdout: JSON.stringify(response.output),
      stderr: response.stderr ?? "",
    };
  };
}

describe("branch protection evidence capture", () => {
  it("parses CLI flags", () => {
    expect(parseArgs([
      "--repo", "OpsiClear-Web/diveo",
      "--branch", "master",
      "--output-path", "docs/qa-evidence/date/master-branch-protection.json",
      "--required-check", "quality / quality",
      "--reviewer", "@release",
      "--reviewed-at", "2026-07-01T03:06:41Z",
    ])).toEqual({
      repo: "OpsiClear-Web/diveo",
      branch: "master",
      outputPath: "docs/qa-evidence/date/master-branch-protection.json",
      requiredChecks: ["quality / quality"],
      reviewer: "@release",
      reviewedAt: "2026-07-01T03:06:41Z",
    });
  });

  it("normalizes GitHub repository inputs", () => {
    expect(normalizeRepo("OpsiClear-Web/diveo")).toBe("OpsiClear-Web/diveo");
    expect(normalizeRepo("github.com/OpsiClear-Web/diveo")).toBe("OpsiClear-Web/diveo");
    expect(normalizeRepo("https://github.com/OpsiClear-Web/diveo")).toBe("OpsiClear-Web/diveo");
  });

  it("extracts required status check names from contexts and checks", () => {
    expect(requiredStatusCheckNames({
      required_status_checks: {
        contexts: ["legacy"],
        checks: [{ context: "quality / quality" }, { name: "build" }],
      },
    })).toEqual(["build", "legacy", "quality / quality"]);
  });

  it("summarizes branch output without raw commit payloads", () => {
    expect(summarizeBranchOutput({
      name: "master",
      protected: false,
      protection_url: "https://api.github.com/repos/OpsiClear-Web/diveo/branches/master/protection",
      commit: {
        sha: "fdc88ec053ecd4bb2a0a7f489a927eaa02146017",
        commit: {
          message: "long commit message that should not be written to evidence",
        },
      },
      _links: {
        html: "https://github.com/OpsiClear-Web/diveo/tree/master",
      },
      protection: {
        enabled: false,
        required_status_checks: {
          enforcement_level: "off",
          contexts: [],
          checks: [],
        },
      },
    })).toEqual({
      name: "master",
      protected: false,
      protectionUrl: "https://api.github.com/repos/OpsiClear-Web/diveo/branches/master/protection",
      commitSha: "fdc88ec053ecd4bb2a0a7f489a927eaa02146017",
      htmlUrl: "https://github.com/OpsiClear-Web/diveo/tree/master",
      protection: {
        enabled: false,
        requiredStatusChecks: {
          strict: null,
          enforcementLevel: "off",
          contexts: [],
          checks: [],
        },
      },
    });
  });

  it("summarizes protection errors and required checks", () => {
    expect(summarizeProtectionOutput({
      message: "Branch not protected",
      status: "404",
      documentation_url: "https://docs.github.com/rest/branches/branch-protection#get-branch-protection",
    })).toEqual({
      message: "Branch not protected",
      status: "404",
      documentationUrl: "https://docs.github.com/rest/branches/branch-protection#get-branch-protection",
    });

    expect(summarizeProtectionOutput({
      required_status_checks: {
        strict: true,
        contexts: ["legacy"],
        checks: [{ context: "quality / quality", app_id: 15368 }],
      },
      enforce_admins: { enabled: true },
      required_pull_request_reviews: {
        dismiss_stale_reviews: true,
        required_approving_review_count: 1,
      },
    })).toMatchObject({
      requiredStatusChecks: {
        strict: true,
        contexts: ["legacy"],
        checks: [{ context: "quality / quality", name: null, appId: 15368 }],
      },
      enforceAdmins: true,
      requiredPullRequestReviews: {
        dismissStaleReviews: true,
        requiredApprovingReviewCount: 1,
      },
    });
  });

  it("passes when master is protected and quality is required", () => {
    const result = captureBranchProtectionEvidence({
      repo: "OpsiClear-Web/diveo",
      branch: "master",
      reviewer: "@release-reviewer",
      reviewedAt: "2026-07-01T03:06:41Z",
      runCommand: ghRunner({
        "repos/OpsiClear-Web/diveo/branches/master": {
          status: 0,
          output: { name: "master", protected: true },
        },
        "repos/OpsiClear-Web/diveo/branches/master/protection": {
          status: 0,
          output: {
            required_status_checks: {
              checks: [{ context: "quality / quality" }],
            },
          },
        },
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("pass");
    expect(result.observedRequiredChecks).toEqual(["quality / quality"]);
    expect(result.errors).toEqual([]);
    expect(result.branchQuery).not.toHaveProperty("stdout");
    expect(result.branchQuery.output.protected).toBe(true);
    expect(result.branchQuery.output).not.toHaveProperty("commit");
    expect(result.protectionQuery.output.requiredStatusChecks.checks).toEqual([{
      context: "quality / quality",
      name: null,
      appId: null,
    }]);
  });

  it("records no-publish evidence when the branch is unprotected", () => {
    const result = captureBranchProtectionEvidence({
      repo: "OpsiClear-Web/diveo",
      branch: "master",
      reviewer: "@release-reviewer",
      reviewedAt: "2026-07-01T03:06:41Z",
      runCommand: ghRunner({
        "repos/OpsiClear-Web/diveo/branches/master": {
          status: 0,
          output: { name: "master", protected: false },
        },
        "repos/OpsiClear-Web/diveo/branches/master/protection": {
          status: 1,
          output: { message: "Branch not protected", status: "404" },
          stderr: "gh: Branch not protected (HTTP 404)",
        },
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("no-publish");
    expect(result.errors).toEqual(expect.arrayContaining([
      "master is not protected",
      "branch protection query failed: Branch not protected",
      "required status check missing: quality / quality",
    ]));
    expect(result.releaseReadinessImpact.status).toBe("no-publish");
    expect(result.branchQuery).not.toHaveProperty("stdout");
    expect(result.branchQuery.output).toEqual({
      name: "master",
      protected: false,
      protectionUrl: null,
      commitSha: null,
      htmlUrl: null,
      protection: null,
    });
    expect(result.protectionQuery).not.toHaveProperty("stdout");
    expect(result.protectionQuery.output).toEqual({
      message: "Branch not protected",
      status: "404",
      documentationUrl: null,
    });
  });

  it("fails when quality is not a required check or reviewer is missing", () => {
    const result = captureBranchProtectionEvidence({
      repo: "OpsiClear-Web/diveo",
      branch: "master",
      reviewer: "reviewer",
      reviewedAt: "2026-07-01T03:06:41Z",
      runCommand: ghRunner({
        "repos/OpsiClear-Web/diveo/branches/master": {
          status: 0,
          output: { name: "master", protected: true },
        },
        "repos/OpsiClear-Web/diveo/branches/master/protection": {
          status: 0,
          output: {
            required_status_checks: {
              contexts: ["build"],
            },
          },
        },
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "required status check missing: quality / quality",
      "reviewer is required for release-readiness evidence",
    ]));
  });

  it("writes structured JSON evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "branch-protection-evidence-"));
    const outputPath = join(root, "master-branch-protection.json");
    const { result } = writeBranchProtectionEvidence({
      repo: "OpsiClear-Web/diveo",
      branch: "master",
      outputPath,
      reviewer: "@release-reviewer",
      reviewedAt: "2026-07-01T03:06:41Z",
      runCommand: ghRunner({
        "repos/OpsiClear-Web/diveo/branches/master": {
          status: 0,
          output: { name: "master", protected: true },
        },
        "repos/OpsiClear-Web/diveo/branches/master/protection": {
          status: 0,
          output: {
            required_status_checks: {
              contexts: ["quality / quality"],
            },
          },
        },
      }),
    });

    expect(result.ok).toBe(true);
    expect(existsSync(outputPath)).toBe(true);
    const written = JSON.parse(readFileSync(outputPath, "utf8"));
    expect(written.repository).toBe("OpsiClear-Web/diveo");
    expect(JSON.stringify(written)).not.toContain("long commit message");
    expect(written.branchQuery).not.toHaveProperty("stdout");
    expect(written.releaseReadinessImpact.status).toBe("ready");
  });
});
