import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import guardModule from "./capture-publish-hash-variable-guard.js";

const {
  DEFAULT_VARIABLES,
  capturePublishHashVariableGuard,
  normalizeRepo,
  parseArgs,
  writePublishHashVariableGuardEvidence,
} = guardModule;

function ghRunner(responses) {
  return (command, args) => {
    expect(command).toBe("gh");
    const variable = args[2];
    const response = responses[variable];
    if (!response) {
      return { status: 1, stdout: "", stderr: "not mocked" };
    }
    return {
      status: response.status,
      stdout: typeof response.output === "string" ? response.output : JSON.stringify(response.output ?? {}),
      stderr: response.stderr ?? "",
    };
  };
}

function absentResponses() {
  return Object.fromEntries(DEFAULT_VARIABLES.map((variable) => [
    variable,
    { status: 1, output: { message: "Not Found" }, stderr: "HTTP 404: Not Found" },
  ]));
}

describe("publish hash variable guard evidence", () => {
  it("parses CLI flags", () => {
    expect(parseArgs([
      "--repo", "OpsiClear-Web/diveo",
      "--output-path", "docs/qa-evidence/date/publish-hash-variable-guard.json",
      "--reviewer", "@release",
      "--reviewed-at", "2026-07-01T09:20:00Z",
      "--variable", "EXPECTED_RELEASE_APK_SHA256",
      "--variable", "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256",
    ])).toEqual({
      repo: "OpsiClear-Web/diveo",
      outputPath: "docs/qa-evidence/date/publish-hash-variable-guard.json",
      reviewer: "@release",
      reviewedAt: "2026-07-01T09:20:00Z",
      variables: ["EXPECTED_RELEASE_APK_SHA256", "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256"],
    });
  });

  it("normalizes GitHub repository inputs", () => {
    expect(normalizeRepo("OpsiClear-Web/diveo")).toBe("OpsiClear-Web/diveo");
    expect(normalizeRepo("github.com/OpsiClear-Web/diveo")).toBe("OpsiClear-Web/diveo");
    expect(normalizeRepo("https://github.com/OpsiClear-Web/diveo")).toBe("OpsiClear-Web/diveo");
  });

  it("passes when both expected publish hash variables are absent", () => {
    const result = capturePublishHashVariableGuard({
      repo: "OpsiClear-Web/diveo",
      reviewer: "@release-reviewer",
      reviewedAt: "2026-07-01T09:20:00Z",
      runCommand: ghRunner(absentResponses()),
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("pass");
    expect(result.errors).toEqual([]);
    expect(result.variableQueries.map((query) => query.status)).toEqual(["absent", "absent"]);
    expect(result.releaseReadinessImpact.status).toBe("ready");
    expect(result.variableQueries[0]).not.toHaveProperty("stdout");
  });

  it("records no-publish evidence when a publish hash variable is already set", () => {
    const result = capturePublishHashVariableGuard({
      repo: "OpsiClear-Web/diveo",
      reviewer: "@release-reviewer",
      reviewedAt: "2026-07-01T09:20:00Z",
      runCommand: ghRunner({
        EXPECTED_RELEASE_APK_SHA256: {
          status: 0,
          output: {
            name: "EXPECTED_RELEASE_APK_SHA256",
            value: "a".repeat(64),
            updatedAt: "2026-07-01T09:19:00Z",
          },
        },
        EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256: {
          status: 1,
          output: { message: "Not Found" },
          stderr: "HTTP 404: Not Found",
        },
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("no-publish");
    expect(result.errors).toContain("publish hash repository variable is set before signoff: EXPECTED_RELEASE_APK_SHA256");
    expect(result.variableQueries[0]).toMatchObject({
      name: "EXPECTED_RELEASE_APK_SHA256",
      status: "present",
      present: true,
      output: {
        name: "EXPECTED_RELEASE_APK_SHA256",
        present: true,
        valueLooksSha256: true,
      },
    });
    expect(result.variableQueries[0].output.valueSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("a".repeat(64));
  });

  it("fails closed when GitHub CLI cannot prove absence", () => {
    const result = capturePublishHashVariableGuard({
      repo: "OpsiClear-Web/diveo",
      reviewer: "@release-reviewer",
      reviewedAt: "2026-07-01T09:20:00Z",
      runCommand: ghRunner({
        EXPECTED_RELEASE_APK_SHA256: {
          status: 1,
          output: "",
          stderr: "gh auth required",
        },
        EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256: {
          status: 1,
          output: { message: "Not Found" },
          stderr: "HTTP 404: Not Found",
        },
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.variableQueries[0].status).toBe("unknown");
    expect(result.errors).toContain("could not prove publish hash repository variable is absent: EXPECTED_RELEASE_APK_SHA256");
  });

  it("requires concrete reviewer metadata", () => {
    const result = capturePublishHashVariableGuard({
      repo: "OpsiClear-Web/diveo",
      reviewer: "reviewer",
      reviewedAt: "not-a-date",
      runCommand: ghRunner(absentResponses()),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "reviewer is required for release-readiness evidence",
      "reviewedAt must be an ISO timestamp",
    ]));
  });

  it("writes structured JSON evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "publish-hash-variable-guard-"));
    const outputPath = join(root, "publish-hash-variable-guard.json");
    const { result } = writePublishHashVariableGuardEvidence({
      repo: "OpsiClear-Web/diveo",
      outputPath,
      reviewer: "@release-reviewer",
      reviewedAt: "2026-07-01T09:20:00Z",
      runCommand: ghRunner(absentResponses()),
    });

    expect(result.ok).toBe(true);
    expect(existsSync(outputPath)).toBe(true);
    const written = JSON.parse(readFileSync(outputPath, "utf8"));
    expect(written.repository).toBe("OpsiClear-Web/diveo");
    expect(written.variables).toEqual(DEFAULT_VARIABLES);
    expect(written.releaseReadinessImpact.auditBlocker).toBe("Publish expected-hash variable guard");
  });
});
