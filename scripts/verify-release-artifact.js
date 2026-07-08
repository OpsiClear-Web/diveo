#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { isLocalHostname } = require("./verify-native-production-config.js");

const DEFAULT_APK_PATH = "android/app/build/outputs/apk/release/app-release.apk";
const DEFAULT_MANIFEST_PATH = "android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml";

const requiredBundleEnvNames = [
  { name: "EXPO_PUBLIC_GSAV_WEB_URL", redactValue: false },
  { name: "EXPO_PUBLIC_GSAV_CATALOG_URL", redactValue: false },
  { name: "EXPO_PUBLIC_GSAV_SUPABASE_URL", redactValue: false },
  { name: "EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY", redactValue: true }
];

const requiredUrlEnvNames = requiredBundleEnvNames
  .filter(({ name }) => name.endsWith("_URL"))
  .map(({ name }) => name);

const forbiddenBundlePatterns = [
  { label: "localhost", pattern: /\blocalhost\b/i },
  { label: "127.0.0.1", pattern: /\b127\.0\.0\.1\b/ },
  { label: "0.0.0.0", pattern: /\b0\.0\.0\.0\b/ },
  { label: "10.0.2.2", pattern: /\b10\.0\.2\.2\b/ },
  { label: "private 192.168.x.x URL", pattern: /https?:\/\/192\.168\.\d{1,3}\.\d{1,3}/i },
  { label: "private 10.x.x.x URL", pattern: /https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}/i },
  { label: "private 172.16-31.x.x URL", pattern: /https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}/i },
  { label: "bilibili", pattern: /bilibili/i },
  { label: "dev-proxy", pattern: /dev-proxy/i },
  { label: "react-native-video", pattern: /react-native-video/i },
  { label: "static-server", pattern: /static-server/i },
  { label: "buildMpd", pattern: /buildMpd/i },
  { label: "pako", pattern: /\bpako\b/i }
];

function envValue(env, name) {
  return (env[name] ?? "").trim();
}

function validateProductionArtifactUrl(name, value, errors) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      errors.push(`Release artifact ${name} must use https.`);
    }
    if (isLocalHostname(parsed.hostname)) {
      errors.push(`Release artifact ${name} must not point at localhost, emulator, link-local, or private LAN hosts.`);
    }
    if (parsed.username || parsed.password) {
      errors.push(`Release artifact ${name} must not contain credentials.`);
    }
  } catch {
    errors.push(`Release artifact ${name} must be a valid absolute URL.`);
  }
}

function verifyReleaseArtifactText({ bundleText, manifestText, env = process.env }) {
  const errors = [];
  const checked = {
    requiredBundleValues: {},
    requiredUrls: {},
    forbiddenBundleMatches: [],
    androidUsesCleartextTraffic: null,
    androidDebuggable: null
  };

  if (typeof bundleText !== "string" || bundleText.length === 0) {
    errors.push("Release APK JS bundle text is empty or unavailable.");
  }

  if (typeof manifestText !== "string" || manifestText.trim().length === 0) {
    errors.push("Release AndroidManifest text is empty or unavailable.");
  }

  for (const { name, redactValue } of requiredBundleEnvNames) {
    const value = envValue(env, name);
    const state = value ? "present" : "missing";
    checked.requiredBundleValues[name] = state;
    if (requiredUrlEnvNames.includes(name)) {
      checked.requiredUrls[name] = state;
    }
    if (!value) {
      errors.push(`Missing ${name}; cannot verify release artifact.`);
    } else {
      if (requiredUrlEnvNames.includes(name)) {
        validateProductionArtifactUrl(name, value, errors);
      }
      if (!bundleText.includes(value)) {
        const suffix = redactValue ? "." : ` (${value}).`;
        errors.push(`Release APK does not bake ${name}${suffix}`);
      }
    }
  }

  for (const { label, pattern } of forbiddenBundlePatterns) {
    if (pattern.test(bundleText)) {
      checked.forbiddenBundleMatches.push(label);
      errors.push(`Release APK bundle contains forbidden ${label} marker.`);
    }
  }

  const hasCleartext = /usesCleartextTraffic\s*=\s*["']true["']/i.test(manifestText ?? "");
  checked.androidUsesCleartextTraffic = hasCleartext;
  if (hasCleartext) {
    errors.push("Merged AndroidManifest has usesCleartextTraffic=true.");
  }

  const hasDebuggable = /debuggable\s*=\s*["']true["']/i.test(manifestText ?? "");
  checked.androidDebuggable = hasDebuggable;
  if (hasDebuggable) {
    errors.push("Merged AndroidManifest has android:debuggable=true.");
  }

  return {
    ok: errors.length === 0,
    errors,
    checked
  };
}

function findEndOfCentralDirectory(zipBuffer) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, zipBuffer.length - 65557);
  for (let offset = zipBuffer.length - 22; offset >= minOffset; offset -= 1) {
    if (zipBuffer.readUInt32LE(offset) === signature) {
      return {
        centralDirectoryEntries: zipBuffer.readUInt16LE(offset + 10),
        centralDirectorySize: zipBuffer.readUInt32LE(offset + 12),
        centralDirectoryOffset: zipBuffer.readUInt32LE(offset + 16),
      };
    }
  }
  throw new Error("APK is not a readable ZIP file: missing central directory.");
}

function readZipEntries(zipBuffer) {
  const eocd = findEndOfCentralDirectory(zipBuffer);
  const entries = [];
  let offset = eocd.centralDirectoryOffset;
  const endOffset = eocd.centralDirectoryOffset + eocd.centralDirectorySize;

  for (let index = 0; index < eocd.centralDirectoryEntries && offset < endOffset; index += 1) {
    if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("APK is not a readable ZIP file: invalid central directory entry.");
    }
    const flags = zipBuffer.readUInt16LE(offset + 8);
    const method = zipBuffer.readUInt16LE(offset + 10);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
    const name = zipBuffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    if ((flags & 0x1) === 0x1) {
      throw new Error(`APK ZIP entry is encrypted and cannot be inspected: ${name}`);
    }
    if (![0, 8].includes(method)) {
      throw new Error(`APK ZIP entry uses unsupported compression method ${method}: ${name}`);
    }
    if (zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`APK ZIP entry has invalid local header: ${name}`);
    }

    const localFileNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = zipBuffer.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 0 ? compressed : zlib.inflateRawSync(compressed);
    entries.push({ name, data });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readBundleFromZipBuffer(zipBuffer) {
  const bundleEntries = readZipEntries(zipBuffer)
    .filter((entry) => /^assets\/[^/]+\.bundle$/.test(entry.name));
  if (bundleEntries.length === 0) {
    throw new Error("Release APK does not contain an assets/*.bundle entry.");
  }
  return bundleEntries.map((entry) => entry.data.toString("utf8")).join("\n");
}

function readBundleFromApk(apkPath) {
  return readBundleFromZipBuffer(fs.readFileSync(apkPath));
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function releaseArtifactChecksums({ apkPath, manifestPath }) {
  return {
    apkSha256: fs.existsSync(apkPath) ? sha256File(apkPath) : null,
    manifestSha256: fs.existsSync(manifestPath) ? sha256File(manifestPath) : null
  };
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required manifest does not exist: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function main() {
  const root = process.cwd();
  const apkPath = path.resolve(root, process.argv[2] || DEFAULT_APK_PATH);
  const manifestPath = path.resolve(root, process.env.ANDROID_MANIFEST_PATH || DEFAULT_MANIFEST_PATH);
  const bundleTextPath = process.env.RELEASE_ARTIFACT_BUNDLE_TEXT_PATH;
  const bundleText = bundleTextPath
    ? fs.readFileSync(path.resolve(root, bundleTextPath), "utf8")
    : readBundleFromApk(apkPath);
  const manifestText = readTextIfExists(manifestPath);
  const result = verifyReleaseArtifactText({ bundleText, manifestText, env: process.env });
  const checksums = releaseArtifactChecksums({ apkPath, manifestPath });

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    apkPath,
    manifestPath,
    checksums,
    status: result.ok ? "pass" : "fail",
    ...result
  }, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  forbiddenBundlePatterns,
  requiredBundleEnvNames,
  requiredUrlEnvNames,
  findEndOfCentralDirectory,
  readBundleFromApk,
  readBundleFromZipBuffer,
  readZipEntries,
  releaseArtifactChecksums,
  sha256Buffer,
  sha256File,
  validateProductionArtifactUrl,
  verifyReleaseArtifactText
};
