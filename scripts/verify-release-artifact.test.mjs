import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import verifier from "./verify-release-artifact.js";

const {
  readBundleFromApk,
  readBundleFromZipBuffer,
  releaseArtifactChecksums,
  sha256Buffer,
  sha256File,
  verifyReleaseArtifactText
} = verifier;

const env = {
  EXPO_PUBLIC_GSAV_WEB_URL: "https://gsav.example.com",
  EXPO_PUBLIC_GSAV_CATALOG_URL: "https://gsav.example.com/functions/v1/catalog",
  EXPO_PUBLIC_GSAV_SUPABASE_URL: "https://supabase.example.com",
  EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: "public-anon-key"
};

const safeManifest = '<manifest package="com.opsiclear.diveo" />';

function validBundle(extra = "") {
  return [
    "bundle",
    env.EXPO_PUBLIC_GSAV_WEB_URL,
    env.EXPO_PUBLIC_GSAV_CATALOG_URL,
    env.EXPO_PUBLIC_GSAV_SUPABASE_URL,
    env.EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY,
    extra
  ].join("\n");
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data, "utf8");
    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    name.copy(localHeader, 30);
    localParts.push(localHeader, data);

    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    name.copy(centralHeader, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

describe("release artifact verifier", () => {
  it("accepts a bundle with required production URLs and cleartext disabled", () => {
    const result = verifyReleaseArtifactText({
      bundleText: validBundle(),
      manifestText: safeManifest,
      env
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects missing baked production URLs", () => {
    const result = verifyReleaseArtifactText({
      bundleText: `${env.EXPO_PUBLIC_GSAV_WEB_URL}\n${env.EXPO_PUBLIC_GSAV_SUPABASE_URL}`,
      manifestText: safeManifest,
      env
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "Release APK does not bake EXPO_PUBLIC_GSAV_CATALOG_URL (https://gsav.example.com/functions/v1/catalog)."
    );
  });

  it("rejects local origins and legacy markers in the bundle", () => {
    const result = verifyReleaseArtifactText({
      bundleText: validBundle("http://127.0.0.1:5191 bilibili react-native-video static-server pako"),
      manifestText: safeManifest,
      env
    });

    expect(result.ok).toBe(false);
    expect(result.checked.forbiddenBundleMatches).toEqual(
      expect.arrayContaining(["127.0.0.1", "bilibili", "react-native-video", "static-server", "pako"])
    );
  });

  it("rejects public HTTP production URL values even when they are baked into the bundle", () => {
    const unsafeEnv = {
      ...env,
      EXPO_PUBLIC_GSAV_WEB_URL: "http://gsav.example.com"
    };
    const result = verifyReleaseArtifactText({
      bundleText: validBundle(unsafeEnv.EXPO_PUBLIC_GSAV_WEB_URL),
      manifestText: safeManifest,
      env: unsafeEnv
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Release artifact EXPO_PUBLIC_GSAV_WEB_URL must use https.");
  });

  it("rejects IPv6 local and private production URL values in release artifacts", () => {
    const unsafeEnv = {
      ...env,
      EXPO_PUBLIC_GSAV_WEB_URL: "https://[fd00::1]",
      EXPO_PUBLIC_GSAV_CATALOG_URL: "https://[fe80::1]/functions/v1/catalog",
      EXPO_PUBLIC_GSAV_SUPABASE_URL: "https://[::1]"
    };
    const result = verifyReleaseArtifactText({
      bundleText: [
        validBundle(),
        unsafeEnv.EXPO_PUBLIC_GSAV_WEB_URL,
        unsafeEnv.EXPO_PUBLIC_GSAV_CATALOG_URL,
        unsafeEnv.EXPO_PUBLIC_GSAV_SUPABASE_URL
      ].join("\n"),
      manifestText: safeManifest,
      env: unsafeEnv
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "Release artifact EXPO_PUBLIC_GSAV_WEB_URL must not point at localhost, emulator, link-local, or private LAN hosts.",
      "Release artifact EXPO_PUBLIC_GSAV_CATALOG_URL must not point at localhost, emulator, link-local, or private LAN hosts.",
      "Release artifact EXPO_PUBLIC_GSAV_SUPABASE_URL must not point at localhost, emulator, link-local, or private LAN hosts.",
    ]));
  });

  it("rejects Android cleartext traffic in the generated manifest", () => {
    const result = verifyReleaseArtifactText({
      bundleText: validBundle(),
      manifestText: '<application android:usesCleartextTraffic="true" />',
      env
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Merged AndroidManifest has usesCleartextTraffic=true.");
  });

  it("rejects debuggable release manifests", () => {
    const result = verifyReleaseArtifactText({
      bundleText: validBundle(),
      manifestText: '<application android:debuggable="true" />',
      env
    });

    expect(result.ok).toBe(false);
    expect(result.checked.androidDebuggable).toBe(true);
    expect(result.errors).toContain("Merged AndroidManifest has android:debuggable=true.");
  });

  it("rejects missing manifest text", () => {
    const result = verifyReleaseArtifactText({
      bundleText: validBundle(),
      manifestText: "",
      env
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Release AndroidManifest text is empty or unavailable.");
  });

  it("rejects missing baked Supabase anon key without echoing the key", () => {
    const bundleText = [
      env.EXPO_PUBLIC_GSAV_WEB_URL,
      env.EXPO_PUBLIC_GSAV_CATALOG_URL,
      env.EXPO_PUBLIC_GSAV_SUPABASE_URL
    ].join("\n");
    const result = verifyReleaseArtifactText({
      bundleText,
      manifestText: safeManifest,
      env
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Release APK does not bake EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY.");
    expect(result.errors.join("\n")).not.toContain(env.EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY);
  });

  it("rejects missing verification env values", () => {
    const result = verifyReleaseArtifactText({
      bundleText: validBundle(),
      manifestText: safeManifest,
      env: {}
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Missing EXPO_PUBLIC_GSAV_WEB_URL; cannot verify release artifact.");
    expect(result.errors).toContain("Missing EXPO_PUBLIC_GSAV_CATALOG_URL; cannot verify release artifact.");
    expect(result.errors).toContain("Missing EXPO_PUBLIC_GSAV_SUPABASE_URL; cannot verify release artifact.");
    expect(result.errors).toContain("Missing EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY; cannot verify release artifact.");
  });

  it("extracts the JS bundle from an APK-style zip fixture", () => {
    const bundleText = validBundle("fixture-marker");
    const zip = storedZip([
      { name: "res/raw/ignored.txt", data: "ignored" },
      { name: "assets/index.android.bundle", data: bundleText }
    ]);
    const root = mkdtempSync(join(tmpdir(), "diveo-apk-"));
    const apkPath = join(root, "app-release.apk");
    writeFileSync(apkPath, zip);

    expect(readBundleFromZipBuffer(zip)).toContain("fixture-marker");
    expect(readBundleFromApk(apkPath)).toContain("fixture-marker");
  });

  it("computes APK and manifest SHA256 checksums used in release evidence", () => {
    const zip = storedZip([
      { name: "assets/index.android.bundle", data: validBundle("checksum-marker") }
    ]);
    const root = mkdtempSync(join(tmpdir(), "diveo-apk-checksum-"));
    const apkPath = join(root, "app-release.apk");
    const manifestPath = join(root, "AndroidManifest.xml");
    writeFileSync(apkPath, zip);
    writeFileSync(manifestPath, safeManifest);

    expect(sha256File(apkPath)).toBe(sha256Buffer(zip));
    expect(sha256File(apkPath)).toMatch(/^[a-f0-9]{64}$/);
    expect(releaseArtifactChecksums({ apkPath, manifestPath })).toEqual({
      apkSha256: sha256Buffer(zip),
      manifestSha256: sha256Buffer(Buffer.from(safeManifest)),
    });
  });
});
