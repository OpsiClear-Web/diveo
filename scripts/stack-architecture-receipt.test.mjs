import path from "node:path";
import { describe, expect, it } from "vitest";

import receiptModule from "./stack-architecture-receipt.js";

const {
  RECEIPT_SCHEMA_VERSION,
  buildReceipt,
  canonicalJson,
  classifyUrl,
  compareReceipt,
  isVersionRangeCompatible,
  parseExportedNumber,
  parseDoctorCatalogSummary,
  redactUrl,
  validateReceipt,
} = receiptModule;

const localProfile = {
  profile: "local",
  backendUrl: "http://127.0.0.1:54321",
  catalogUrl: "http://127.0.0.1:54321/functions/v1/catalog",
  webUrl: "http://localhost:5173",
  nativePreviewUrl: "http://127.0.0.1:8082",
  allowedShellOrigins: ["http://127.0.0.1:8082", "http://localhost:8082"],
};

function fixturePaths(root = path.resolve("repo")) {
  return {
    diveoRoot: root,
    functionsEnvPath: path.join(root, "..", "gsav-hosting", "supabase", "functions", ".env.local"),
    gsavHostingRoot: path.join(root, "..", "gsav-hosting"),
    gsavWebRoot: path.join(root, "..", "gsav-hosting", "apps", "web"),
    nativeEnvPath: path.join(root, ".env.local"),
    stackConfigPath: path.join(root, "config", "stack.local.json"),
    webEnvPath: path.join(root, "..", "gsav-hosting", "apps", "web", ".env.local"),
  };
}

const doctorResult = {
  checks: [
    { name: "diveo env drift", ok: true, detail: "ok" },
    { name: "Catalog function", ok: true, detail: "http://127.0.0.1:54321/functions/v1/catalog schema=1 first=capture-room" },
    { name: "GSAV web app", ok: true, detail: "http://localhost:5173" },
  ],
  failed: [],
};

function fixtureReceipt() {
  return buildReceipt({
    bridge: {
      nativeMinVersion: 1,
      nativeVersion: 1,
      sessionVersion: 1,
    },
    doctorResult,
    gitCommitSha: "a".repeat(40),
    options: {
      requireAssets: true,
      skipNetwork: false,
    },
    paths: fixturePaths(),
    profile: localProfile,
    webBridge: {
      compatible: true,
      minVersion: 1,
      sourcePath: "../gsav-hosting/apps/web/src/native/bridge.ts",
      version: 1,
    },
  });
}

describe("stack architecture receipt", () => {
  it("classifies local and public URLs", () => {
    expect(classifyUrl("http://127.0.0.1:54321")).toBe("local-private");
    expect(classifyUrl("https://gsav.example.com")).toBe("public-https");
    expect(classifyUrl("http://gsav.example.com")).toBe("public-http");
  });

  it("redacts sensitive URL query values", () => {
    expect(redactUrl("https://gsav.example.com/catalog?token=abc&scene=one")).toBe(
      "https://gsav.example.com/catalog?token=%5Bredacted%5D&scene=one",
    );
  });

  it("parses catalog schema and first item from doctor output", () => {
    expect(parseDoctorCatalogSummary(doctorResult)).toEqual({
      firstVideoId: "capture-room",
      schemaVersion: 1,
    });
  });

  it("parses and compares native/web bridge versions", () => {
    expect(parseExportedNumber("export const GSAV_NATIVE_BRIDGE_VERSION = 2;", "GSAV_NATIVE_BRIDGE_VERSION")).toBe(2);
    expect(isVersionRangeCompatible({
      nativeMinVersion: 1,
      nativeVersion: 1,
      webMinVersion: 1,
      webVersion: 2,
    })).toBe(true);
    expect(isVersionRangeCompatible({
      nativeMinVersion: 1,
      nativeVersion: 1,
      webMinVersion: 2,
      webVersion: 2,
    })).toBe(false);
  });

  it("builds a deterministic receipt with required architecture fields", () => {
    const receipt = fixtureReceipt();

    expect(validateReceipt(receipt)).toEqual([]);
    expect(receipt).toMatchObject({
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      catalog: {
        firstVideoId: "capture-room",
        schemaVersion: 1,
      },
      bridge: {
        nativeMinVersion: 1,
        nativeVersion: 1,
        sessionVersion: 1,
        web: {
          compatible: true,
          minVersion: 1,
          sourcePath: "../gsav-hosting/apps/web/src/native/bridge.ts",
          version: 1,
        },
      },
      doctor: {
        ok: true,
        requireAssets: true,
        skipNetwork: false,
      },
      stackProfile: {
        profile: "local",
        path: "config/stack.local.json",
      },
    });
    expect(receipt.stackProfile.backend.class).toBe("local-private");
    expect(receipt.stackProfile.web.url).toBe("http://localhost:5173");
  });

  it("canonicalizes JSON key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("rejects missing receipt fields", () => {
    expect(validateReceipt({})).toContain(`schemaVersion must be ${RECEIPT_SCHEMA_VERSION}.`);
    expect(validateReceipt({}).join("\n")).toContain("stackProfile must be an object.");
  });

  it("rejects stale receipt fields against the current expected receipt", () => {
    const expected = fixtureReceipt();
    const stale = {
      ...expected,
      bridge: {
        ...expected.bridge,
        nativeVersion: 0,
      },
    };

    expect(compareReceipt(stale, expected)).toEqual([
      "receipt is stale or does not match the current stack architecture at receipt.bridge.nativeVersion.",
    ]);
  });
});
