import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import whitespaceModule from "./verify-whitespace.js";

const {
  isGeneratedEvidenceLog,
  isUntrackedTextCandidate,
  skipReason,
  toRepoPath,
  trailingWhitespaceErrorsForText,
  verifyWhitespace,
} = whitespaceModule;

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "diveo-whitespace-"));
}

function writeFile(root, repoPath, text) {
  const filePath = path.join(root, repoPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

describe("whitespace verifier", () => {
  it("normalizes repository paths", () => {
    expect(toRepoPath(".\\scripts\\verify-whitespace.js")).toBe("scripts/verify-whitespace.js");
    expect(toRepoPath("./docs/plan.md")).toBe("docs/plan.md");
  });

  it("classifies source, doc, and config text files", () => {
    expect(isUntrackedTextCandidate("scripts/new-verifier.js")).toBe(true);
    expect(isUntrackedTextCandidate("features/player/NewScreen.tsx")).toBe(true);
    expect(isUntrackedTextCandidate("docs/new-plan.md")).toBe(true);
    expect(isUntrackedTextCandidate(".github/workflows/new.yml")).toBe(true);
    expect(isUntrackedTextCandidate("AGENTS.md")).toBe(true);
    expect(isUntrackedTextCandidate("package.json")).toBe(true);
    expect(isUntrackedTextCandidate("assets/logo.png")).toBe(false);
    expect(isUntrackedTextCandidate("node_modules/pkg/index.js")).toBe(false);
  });

  it("skips generated evidence logs", () => {
    expect(isGeneratedEvidenceLog("docs/qa-evidence/2026-07-01/verify-local/08-coverage.stdout.log")).toBe(true);
    expect(isGeneratedEvidenceLog("docs/qa-evidence/2026-07-01/gsav-preview.out.log")).toBe(true);
    expect(skipReason("docs/qa-evidence/2026-07-01/verify-local/08-coverage.stdout.log"))
      .toBe("generated evidence log");
    expect(isUntrackedTextCandidate("docs/qa-evidence/2026-07-01/verify-local/verification-summary.json"))
      .toBe(true);
  });

  it("detects trailing whitespace without treating CRLF as an error", () => {
    expect(trailingWhitespaceErrorsForText("ok\r\nnext\n", "docs/example.md")).toEqual([]);
    expect(trailingWhitespaceErrorsForText("bad  \n\tbad\t\r\n", "docs/example.md")).toEqual([
      {
        path: "docs/example.md",
        line: 1,
        message: "trailing whitespace in untracked file",
      },
      {
        path: "docs/example.md",
        line: 2,
        message: "trailing whitespace in untracked file",
      },
    ]);
  });

  it("runs git diff check and scans untracked source/docs/config files", () => {
    const root = tempRoot();
    writeFile(root, "scripts/new-script.js", "const ok = true;\n");
    writeFile(root, "docs/new-doc.md", "bad  \n");
    writeFile(root, "docs/qa-evidence/2026-07-01/verify-local/08-coverage.stdout.log", "table cell   \n");
    writeFile(root, "assets/image.bin", "binary-ish  \n");

    const calls = [];
    const result = verifyWhitespace({
      root,
      now: new Date("2026-07-01T08:00:00Z"),
      runCommand: (command, args) => {
        calls.push([command, ...args]);
        return { status: 0, stdout: "", stderr: "" };
      },
      listFiles: () => [
        "scripts/new-script.js",
        "docs/new-doc.md",
        "docs/qa-evidence/2026-07-01/verify-local/08-coverage.stdout.log",
        "assets/image.bin",
      ],
    });

    expect(calls).toEqual([["git", "diff", "--check"]]);
    expect(result.checkedAt).toBe("2026-07-01T08:00:00.000Z");
    expect(result.status).toBe("fail");
    expect(result.checkedUntrackedFiles).toEqual([
      "scripts/new-script.js",
      "docs/new-doc.md",
    ]);
    expect(result.skippedUntrackedFiles).toContainEqual({
      path: "docs/qa-evidence/2026-07-01/verify-local/08-coverage.stdout.log",
      reason: "generated evidence log",
    });
    expect(result.skippedUntrackedFiles).toContainEqual({
      path: "assets/image.bin",
      reason: "not source/doc/config text",
    });
    expect(result.errors).toEqual([
      {
        path: "docs/new-doc.md",
        line: 1,
        message: "trailing whitespace in untracked file",
      },
    ]);
  });

  it("fails when git diff check fails even if untracked files are clean", () => {
    const result = verifyWhitespace({
      now: new Date("2026-07-01T08:05:00Z"),
      runCommand: () => ({
        status: 2,
        stdout: "tracked.ts:1: trailing whitespace.\n",
        stderr: "",
      }),
      listFiles: () => [],
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("fail");
    expect(result.gitDiff.status).toBe(2);
    expect(result.gitDiff.stdout).toContain("tracked.ts:1");
    expect(result.errors).toEqual([]);
  });
});
