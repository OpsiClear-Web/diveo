import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import metadataModule from "./capture-android-version-metadata.js";

const {
  captureAndroidVersionMetadata,
  discoverMetadataCommands,
  extractVersionCode,
  formatMetadataCapture,
  normalizeExpectedVersionCode,
  parseArgs,
  runCli,
  writeAndroidVersionMetadata,
} = metadataModule;

function tempApk() {
  const root = mkdtempSync(join(tmpdir(), "diveo-apk-metadata-"));
  const apkPath = join(root, "app-release.apk");
  writeFileSync(apkPath, "apk bytes");
  return { root, apkPath };
}

describe("Android version metadata capture", () => {
  it("parses CLI flags", () => {
    expect(parseArgs([
      "--apk-path", "android/app/build/outputs/apk/release/app-release.apk",
      "--output-path", "release-evidence/apk-version-metadata.txt",
      "--expected-version-code", "10019",
    ])).toEqual({
      apkPath: "android/app/build/outputs/apk/release/app-release.apk",
      outputPath: "release-evidence/apk-version-metadata.txt",
      expectedVersionCode: "10019",
    });
  });

  it("rejects invalid expected versionCode values", () => {
    expect(() => normalizeExpectedVersionCode("v10019")).toThrow(
      "expectedVersionCode must be numeric: v10019",
    );
  });

  it("extracts versionCode from supported generated metadata formats", () => {
    expect(extractVersionCode("package: name='diveo' versionCode='10019'")).toBe("10019");
    expect(extractVersionCode("android:versionCode=\"10020\"")).toBe("10020");
    expect(extractVersionCode("versionCode: 10021")).toBe("10021");
  });

  it("captures aapt badging output when available", () => {
    const { apkPath } = tempApk();
    const result = captureAndroidVersionMetadata({
      apkPath,
      expectedVersionCode: "10019",
      commands: [
        { source: "aapt dump badging", command: "aapt", args: ["dump", "badging", apkPath] },
        { source: "apkanalyzer manifest print", command: "apkanalyzer", args: ["manifest", "print", apkPath] },
      ],
      runCommand: (command) => ({
        status: 0,
        stdout: command === "aapt" ? "package: name='diveo' versionCode='10019'\n" : "",
        stderr: "",
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe("aapt dump badging");
    expect(result.versionCode).toBe("10019");
    expect(result.expectedVersionCode).toBe("10019");
    expect(result.attempts).toHaveLength(1);
    expect(formatMetadataCapture(result)).toContain("command: aapt dump badging");
    expect(formatMetadataCapture(result)).toContain("expectedVersionCode: 10019");
  });

  it("falls back to apkanalyzer before bundletool", () => {
    const { apkPath } = tempApk();
    const calls = [];
    const result = captureAndroidVersionMetadata({
      apkPath,
      commands: [
        { source: "aapt dump badging", command: "aapt", args: ["dump", "badging", apkPath] },
        { source: "apkanalyzer manifest print", command: "apkanalyzer", args: ["manifest", "print", apkPath] },
        { source: "bundletool dump manifest", command: "bundletool", args: ["dump", "manifest", "--apk", apkPath] },
      ],
      runCommand: (command) => {
        calls.push(command);
        if (command === "aapt") return { status: 1, stdout: "", stderr: "missing badging" };
        if (command === "apkanalyzer") return { status: 0, stdout: "android:versionCode=\"10019\"\n", stderr: "" };
        return { status: 0, stdout: "versionCode: 10020", stderr: "" };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe("apkanalyzer manifest print");
    expect(result.versionCode).toBe("10019");
    expect(calls).toEqual(["aapt", "apkanalyzer"]);
  });

  it("continues after a metadata source reports the wrong expected versionCode", () => {
    const { apkPath } = tempApk();
    const result = captureAndroidVersionMetadata({
      apkPath,
      expectedVersionCode: "10019",
      commands: [
        { source: "aapt dump badging", command: "aapt", args: ["dump", "badging", apkPath] },
        { source: "apkanalyzer manifest print", command: "apkanalyzer", args: ["manifest", "print", apkPath] },
      ],
      runCommand: (command) => ({
        status: 0,
        stdout: command === "aapt"
          ? "package: name='diveo' versionCode='10018'\n"
          : "android:versionCode=\"10019\"\n",
        stderr: "",
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe("apkanalyzer manifest print");
    expect(result.versionCode).toBe("10019");
    expect(result.attempts[0].reason).toBe("versionCode 10018 did not match expected 10019");
  });

  it("fails evidence capture when every generated APK metadata source disagrees with the expected versionCode", () => {
    const { apkPath } = tempApk();
    const result = captureAndroidVersionMetadata({
      apkPath,
      expectedVersionCode: "10019",
      commands: [
        { source: "aapt dump badging", command: "aapt", args: ["dump", "badging", apkPath] },
        { source: "bundletool dump manifest", command: "bundletool", args: ["dump", "manifest", "--apk", apkPath] },
      ],
      runCommand: () => ({ status: 0, stdout: "versionCode: 10018\n", stderr: "" }),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("fail");
    expect(result.source).toBe("bundletool dump manifest");
    expect(result.versionCode).toBe("10018");
    expect(formatMetadataCapture(result)).toContain("status: fail");
    expect(formatMetadataCapture(result)).toContain("expectedVersionCode: 10019");
  });

  it("passes expected versionCode through the CLI entrypoint", () => {
    const { root, apkPath } = tempApk();
    const outputPath = join(root, "release-evidence", "apk-version-metadata.txt");
    const { result, summary } = runCli([
      "--apk-path", apkPath,
      "--output-path", outputPath,
      "--expected-version-code", "10019",
    ], {
      log: () => {},
      write: (options) => writeAndroidVersionMetadata({
        ...options,
        commands: [
          { source: "aapt dump badging", command: "aapt", args: ["dump", "badging", apkPath] },
        ],
        runCommand: () => ({
          status: 0,
          stdout: "package: name='diveo' versionCode='10018'\n",
          stderr: "",
        }),
      }),
    });

    expect(result.ok).toBe(false);
    expect(summary.expectedVersionCode).toBe("10019");
    const evidence = readFileSync(outputPath, "utf8");
    expect(evidence).toContain("status: fail");
    expect(evidence).toContain("expectedVersionCode: 10019");
    expect(evidence).toContain("versionCode: 10018");
  });

  it("writes exception-required evidence when no metadata source works", () => {
    const { root, apkPath } = tempApk();
    const outputPath = join(root, "release-evidence", "apk-version-metadata.txt");
    const { result } = writeAndroidVersionMetadata({
      apkPath,
      outputPath,
      commands: [
        { source: "aapt dump badging", command: "aapt", args: ["dump", "badging", apkPath] },
        { source: "apkanalyzer manifest print", command: "apkanalyzer", args: ["manifest", "print", apkPath] },
      ],
      runCommand: () => ({ status: 127, stdout: "", stderr: "not found" }),
    });

    expect(result.ok).toBe(false);
    expect(existsSync(outputPath)).toBe(true);
    const evidence = readFileSync(outputPath, "utf8");
    expect(evidence).toContain("status: exception-required");
    expect(evidence).toContain("aapt dump badging");
    expect(evidence).toContain("apkanalyzer manifest print");
    expect(evidence).toContain("bundletool dump manifest");
  });

  it("discovers configured Android metadata tools and removes duplicates", () => {
    const { root, apkPath } = tempApk();
    const androidHome = join(root, "android-home");
    const buildTools = join(androidHome, "build-tools", "35.0.0");
    const cmdlineTools = join(androidHome, "cmdline-tools", "latest", "bin");
    const aapt = join(buildTools, "aapt.exe");
    const analyzer = join(cmdlineTools, "apkanalyzer.cmd");
    const bundletool = join(root, "bundletool.cmd");

    mkdirSync(buildTools, { recursive: true });
    mkdirSync(cmdlineTools, { recursive: true });
    writeFileSync(aapt, "");
    writeFileSync(analyzer, "");
    writeFileSync(bundletool, "");
    writeFileSync(join(root, "not-a-tool.txt"), "");

    const commands = discoverMetadataCommands(apkPath, {
      AAPT: aapt,
      ANDROID_HOME: androidHome,
      APKANALYZER: analyzer,
      BUNDLETOOL: bundletool,
    });
    const commandKeys = commands.map((command) => [
      command.source,
      command.command,
      ...command.args,
    ].join("\0"));

    expect(new Set(commandKeys).size).toBe(commandKeys.length);
    expect(commands).toEqual(expect.arrayContaining([
      { source: "aapt dump badging", command: aapt, args: ["dump", "badging", apkPath] },
      { source: "apkanalyzer manifest print", command: analyzer, args: ["manifest", "print", apkPath] },
      { source: "bundletool dump manifest", command: bundletool, args: ["dump", "manifest", "--apk", apkPath] },
      { source: "bundletool dump manifest", command: "bundletool", args: ["dump", "manifest", "--apk", apkPath] },
    ]));
  });
});
