import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  materializeIosValidationArtifact,
  outputArtifactName,
  parseArgs,
  resolveDownloadPlan,
  selectArtifact,
} = require("./materialize-ios-validation-artifact.js");

function tempPath(fileName = "ios-validation.zip") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-artifact-"));
  return path.join(root, fileName);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

describe("iOS validation artifact materializer", () => {
  it("parses required CLI options and token env fallback", () => {
    const result = parseArgs([
      "--url",
      "https://github.com/opsiclear/diveo/blob/main/docs/qa-evidence/ios.txt",
      "--output-path",
      "release-evidence/ios.txt",
      "--expected-sha256",
      "a".repeat(64),
    ], { GITHUB_TOKEN: "token" });

    expect(result).toMatchObject({
      outputPath: "release-evidence/ios.txt",
      expectedSha256: "a".repeat(64),
      token: "token",
    });
  });

  it("rejects missing or weak expected checksums", () => {
    expect(() => parseArgs([
      "--url",
      "https://github.com/opsiclear/diveo/actions/runs/123",
      "--output-path",
      "release-evidence/ios.zip",
      "--expected-sha256",
      "abc",
    ], {})).toThrow("64-hex SHA256");
  });

  it("plans docs/qa-evidence blob URLs as raw downloads", async () => {
    const plan = await resolveDownloadPlan(
      "https://github.com/OpsiClear-Web/diveo/blob/main/docs/qa-evidence/2026-07-01/ios-log.txt",
      { outputPath: "release-evidence/ios-log.txt" },
    );

    expect(plan).toMatchObject({
      type: "direct",
      url: "https://raw.githubusercontent.com/OpsiClear-Web/diveo/main/docs/qa-evidence/2026-07-01/ios-log.txt",
    });
  });

  it("plans numeric action artifact URLs as zip API downloads", async () => {
    const plan = await resolveDownloadPlan(
      "https://github.com/opsiclear/gsav-hosting/actions/runs/123/artifacts/456",
      { outputPath: "release-evidence/ios.zip", token: "token" },
    );

    expect(plan).toMatchObject({
      type: "api-artifact",
      url: "https://api.github.com/repos/opsiclear/gsav-hosting/actions/artifacts/456/zip",
    });
    expect(plan.headers.Authorization).toBe("Bearer token");
  });

  it("rejects bare Actions run URLs for iOS artifact bytes", async () => {
    await expect(resolveDownloadPlan(
      "https://github.com/opsiclear/diveo/actions/runs/123",
      {
        outputPath: "release-evidence/ios-validation.zip",
        fetchJson: async () => ({
          artifacts: [
            { id: 11, name: "android-validation", expired: false },
            { id: 12, name: "ios-validation", expired: false },
          ],
        }),
      },
    )).rejects.toThrow("must point to a direct Actions artifact");
  });

  it("rejects release tag pages for iOS artifact bytes", async () => {
    await expect(resolveDownloadPlan(
      "https://github.com/opsiclear/diveo/releases/tag/v1.0.19",
      { outputPath: "release-evidence/ios-validation.zip" },
    )).rejects.toThrow("not a release tag page");
  });

  it("selects exact non-expired artifacts and rejects mismatched artifact names", () => {
    expect(selectArtifact([{ id: 1, name: "ios-validation", expired: false }], "ios-validation").id).toBe(1);
    expect(selectArtifact([{ id: 2, name: "ios-validation.zip", expired: false }], "ios-validation").id).toBe(2);
    expect(() => selectArtifact([{ id: 3, name: "only", expired: false }], "anything")).toThrow(
      "Could not identify one iOS validation artifact named anything.",
    );
    expect(() => selectArtifact([
      { id: 1, name: "one", expired: false },
      { id: 2, name: "two", expired: false },
    ], "ios")).toThrow("Could not identify one iOS validation artifact");
  });

  it("derives artifact names from output paths", () => {
    expect(outputArtifactName("release-evidence/ios-validation.zip")).toBe("ios-validation");
    expect(outputArtifactName("release-evidence/ios-validation.txt")).toBe("ios-validation.txt");
  });

  it("accepts an already-present artifact only when its SHA matches", async () => {
    const outputPath = tempPath("existing.bin");
    fs.writeFileSync(outputPath, "artifact");
    const expectedSha256 = sha256("artifact");

    await expect(materializeIosValidationArtifact({
      url: "https://github.com/opsiclear/diveo/blob/main/docs/qa-evidence/ios.bin",
      outputPath,
      expectedSha256,
    })).resolves.toMatchObject({
      status: "already-present",
      sha256: expectedSha256,
    });

    await expect(materializeIosValidationArtifact({
      url: "https://github.com/opsiclear/diveo/blob/main/docs/qa-evidence/ios.bin",
      outputPath,
      expectedSha256: "b".repeat(64),
    })).rejects.toThrow("Existing iOS artifact SHA256");
  });

  it("downloads artifact bytes and verifies their SHA", async () => {
    const outputPath = tempPath("downloaded.bin");
    const expectedSha256 = sha256("downloaded bytes");

    const result = await materializeIosValidationArtifact({
      url: "https://github.com/opsiclear/diveo/blob/main/docs/qa-evidence/ios.bin",
      outputPath,
      expectedSha256,
      downloadUrl: async (_url, target) => {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "downloaded bytes");
      },
    });

    expect(result).toMatchObject({
      status: "downloaded",
      sha256: expectedSha256,
    });
    expect(fs.readFileSync(outputPath, "utf8")).toBe("downloaded bytes");
  });
});
