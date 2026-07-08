import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  commandVersion,
  createEvidenceMetadata,
  gitCommit,
  gitStatusShort,
  npmVersionFromEnv,
} = require("./evidence-metadata.js");

describe("evidence metadata", () => {
  it("collects command evidence metadata for raw JSON output", () => {
    const calls = [];
    const execFile = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === "npm" || command === "npm.cmd") return "11.9.0\n";
      if (options.cwd === "diveo" && args[0] === "status") return "";
      if (options.cwd === "diveo") return "abc1234\n";
      if (options.cwd === "gsav-hosting") return "def5678\n";
      throw new Error("unexpected command");
    };

    expect(createEvidenceMetadata({ diveoRoot: "diveo", gsavHostingRoot: "gsav-hosting", execFile })).toMatchObject({
      nodeVersion: process.version,
      npmVersion: "11.9.0",
      diveoCommit: "abc1234",
      diveoGitStatus: {
        status: "clean",
        entries: [],
      },
      gsavHostingCommit: "def5678",
    });
    expect(calls).toHaveLength(4);
  });

  it("returns null when command metadata cannot be read", () => {
    const execFile = () => {
      throw new Error("missing");
    };

    expect(commandVersion("missing", [], execFile)).toBeNull();
    expect(gitCommit("missing", execFile)).toBeNull();
    expect(gitStatusShort("missing", execFile)).toBeNull();
    expect(createEvidenceMetadata({ env: {}, execFile })).toMatchObject({
      nodeVersion: process.version,
      npmVersion: null,
      diveoCommit: null,
      diveoGitStatus: {
        status: "unknown",
        entries: null,
      },
      gsavHostingCommit: null,
    });
  });

  it("falls back to npm_config_user_agent when the npm executable cannot be read", () => {
    const execFile = (command, args, options) => {
      if (options?.cwd === "diveo" && args[0] === "status") return " M app.json\n?? docs/new.md\n";
      if (options?.cwd === "diveo") return "abc1234\n";
      if (options?.cwd === "gsav-hosting") return "def5678\n";
      throw new Error("npm executable unavailable");
    };

    expect(npmVersionFromEnv({ npm_config_user_agent: "npm/11.9.0 node/v24.14.0 win32 x64 workspaces/false" })).toBe("11.9.0");
    expect(createEvidenceMetadata({
      diveoRoot: "diveo",
      gsavHostingRoot: "gsav-hosting",
      env: { npm_config_user_agent: "npm/11.9.0 node/v24.14.0 win32 x64 workspaces/false" },
      execFile,
    })).toMatchObject({
      nodeVersion: process.version,
      npmVersion: "11.9.0",
      diveoCommit: "abc1234",
      diveoGitStatus: {
        status: "dirty",
        entries: [" M app.json", "?? docs/new.md"],
      },
      gsavHostingCommit: "def5678",
    });
  });

  it("uses explicit GSAV host identity from the environment before probing a sibling checkout", () => {
    const execFile = (command, args, options) => {
      if (command === "npm" || command === "npm.cmd") return "11.9.0\n";
      if (options.cwd === "diveo" && args[0] === "status") return "";
      if (options.cwd === "diveo") return "abc1234\n";
      throw new Error("gsav-hosting checkout should not be required");
    };

    expect(createEvidenceMetadata({
      diveoRoot: "diveo",
      gsavHostingRoot: "missing-gsav-hosting",
      env: { GSAV_HOSTING_COMMIT: "deployed-gsav-commit" },
      execFile,
    })).toMatchObject({
      nodeVersion: process.version,
      npmVersion: "11.9.0",
      diveoCommit: "abc1234",
      diveoGitStatus: {
        status: "clean",
        entries: [],
      },
      gsavHostingCommit: "deployed-gsav-commit",
    });
  });

  it("uses the release candidate SHA from the environment before probing the checkout", () => {
    const calls = [];
    const execFile = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === "npm" || command === "npm.cmd") return "11.9.0\n";
      if (options.cwd === "diveo" && args[0] === "status") return " M docs/GSAV_NATIVE_QA.md\n";
      if (options.cwd === "gsav-hosting") return "def5678\n";
      throw new Error("diveo checkout should not be required");
    };

    expect(createEvidenceMetadata({
      diveoRoot: "diveo",
      gsavHostingRoot: "gsav-hosting",
      env: {
        RELEASE_CANDIDATE_SHA: "abcdef1234567890abcdef1234567890abcdef12",
      },
      execFile,
    })).toMatchObject({
      nodeVersion: process.version,
      npmVersion: "11.9.0",
      diveoCommit: "abcdef1234567890abcdef1234567890abcdef12",
      diveoGitStatus: {
        status: "dirty",
        entries: [" M docs/GSAV_NATIVE_QA.md"],
      },
      gsavHostingCommit: "def5678",
    });
    expect(calls.filter((call) => call.cwd === "diveo").map((call) => call.args.join(" ")))
      .toEqual(["status --short"]);
  });
});
