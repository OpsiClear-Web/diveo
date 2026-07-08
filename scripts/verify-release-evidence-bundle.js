#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isLocalHostname } = require("./verify-native-production-config.js");
const { isAllowedEvidenceSignoffPath } = require("./verify-release-readiness.js");

const DEFAULT_EVIDENCE_DIR = "release-evidence";
const DEFAULT_MODE = "dry-run";
const ALLOWED_MODES = new Set(["dry-run", "publish"]);
const ALLOWED_CLI_OPTIONS = new Set([
  "root",
  "evidenceDir",
  "apkPath",
  "manifestPath",
  "mode",
  "requireValidationPrereqs",
]);
const VALIDATION_PREREQS_FILE = "validation-prereqs.json";
const REQUIRED_EVIDENCE_FILES = [
  "native-production-config-before-bump.json",
  "gsav-preflight.json",
  "gsav-runtime-smoke.json",
  "version.txt",
  "native-production-config-after-bump.json",
  "release-candidate.txt",
  "signoff-diff-files.txt",
  "app-version-metadata.json",
  "gradle-version-code.txt",
  "release-artifact.json",
  "apk-version-metadata.txt",
];
const DRY_RUN_NO_PUBLISH_PROOF_FILE = "no-publish-side-effect.txt";

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (!ALLOWED_CLI_OPTIONS.has(key)) {
      throw new Error(`Unknown option: ${arg}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = value;
    i += 1;
  }
  return options;
}

function normalizeMode(mode = DEFAULT_MODE) {
  if (!ALLOWED_MODES.has(mode)) {
    throw new Error(`Invalid release evidence mode: ${mode}. Expected dry-run or publish.`);
  }
  return mode;
}

function normalizeBooleanOption(value, label) {
  if (value === undefined || value === null || value === false) return false;
  if (value === true) return true;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "required"].includes(normalized)) return true;
  if (["0", "false", "no", "optional"].includes(normalized)) return false;
  throw new Error(`Invalid ${label}: ${value}. Expected true/false.`);
}

function normalizeSlash(value) {
  return String(value).replace(/\\/g, "/");
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function publishArtifactIdentityText(summary) {
  return [
    "publishArtifactIdentity:v2",
    `releaseCandidateSha=${summary.releaseCandidateSha ?? ""}`,
    `releaseVersion=${summary.releaseVersion ?? ""}`,
    `appVersion=${summary.appVersion ?? ""}`,
    `packageVersion=${summary.packageVersion ?? ""}`,
    `androidVersionCode=${summary.androidVersionCode ?? ""}`,
    `artifactName=${summary.artifactName ?? ""}`,
    `apkSha256=${summary.apkSha256 ?? ""}`,
    `manifestSha256=${summary.manifestSha256 ?? ""}`,
    `gsavPackageProvenanceSha256=${summary.gsavPackageProvenanceSha256 ?? ""}`,
  ].join("\n") + "\n";
}

function gsavPackageProvenanceText(entries = []) {
  const entriesByName = new Map();
  for (const entry of entries) {
    if (entry && typeof entry === "object" && !Array.isArray(entry) && entry.packageName) {
      entriesByName.set(entry.packageName, entry);
    }
  }
  return [
    "gsavPackageProvenance:v1",
    ...REQUIRED_GSAV_PACKAGE_PROVENANCE.flatMap((packageName) => {
      const entry = entriesByName.get(packageName) ?? {};
      return [
        `packageName=${packageName}`,
        `specifier=${entry.specifier ?? ""}`,
        `tarballPath=${entry.tarballPath ?? ""}`,
        `tarballSha256=${entry.tarballSha256 ?? ""}`,
      ];
    }),
  ].join("\n") + "\n";
}

function gsavPackageProvenanceSha256(entries = []) {
  return sha256Text(gsavPackageProvenanceText(entries));
}

function resolveFromRoot(root, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

function isInsidePath(root, filePath) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function containmentRootFor({ root, evidenceDir }) {
  const resolvedRoot = path.resolve(root);
  const resolvedEvidenceDir = resolveFromRoot(resolvedRoot, evidenceDir);
  return isInsidePath(resolvedRoot, resolvedEvidenceDir)
    ? resolvedRoot
    : path.dirname(resolvedEvidenceDir);
}

function containedPath({ resolveRoot, containmentRoot, filePath, label }, errors) {
  const resolvedPath = resolveFromRoot(resolveRoot, filePath);
  if (!isInsidePath(containmentRoot, resolvedPath)) {
    errors.push(`${label} must stay inside artifact root: ${normalizeSlash(filePath)}`);
    return null;
  }
  return resolvedPath;
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function parseJsonFromText(text, label) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${label} does not contain a JSON object.`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

function parseKeyValueText(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9]*)=(.+)$/.exec(line.trim());
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}

function parseSignoffDiffText(text) {
  const fields = {};
  const files = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([A-Za-z][A-Za-z0-9]*)=(.+)$/.exec(line);
    if (match) {
      fields[match[1]] = match[2].trim();
    } else {
      files.push(normalizeSlash(line));
    }
  }
  return { fields, files };
}

function readJsonEvidence(filePath) {
  return parseJsonFromText(readText(filePath), normalizeSlash(filePath));
}

function readJsonFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(readText(filePath));
}

function gsavPackageSpecifier(packageJson, packageName) {
  return packageJson?.dependencies?.[packageName]
    ?? packageJson?.devDependencies?.[packageName]
    ?? null;
}

function isWeakValue(value) {
  return !value || /^(unavailable|unknown|n\/a|null|none|placeholder|example|todo|tbd|undefined|owner|release owner|native release owner)$/i.test(String(value).trim());
}

function hostIdentityProblems(label, json) {
  const identity = json.gsavHostingCommit ?? json.gsavHostBuild ?? json.gsavHostIdentity ?? json.deployedHostIdentity;
  if (isWeakValue(identity)) {
    return [`${label} must include concrete GSAV host/build identity.`];
  }
  return [];
}

function exactRangeContentRange(value) {
  return /^bytes\s+0-0\/\d+$/i.test(String(value ?? "").trim());
}

const REQUIRED_EXPOSED_RANGE_HEADERS = [
  "Accept-Ranges",
  "Content-Length",
  "Content-Range",
  "ETag",
];
const REQUIRED_GSAV_PACKAGE_PROVENANCE = [
  "@opsiclear/gsav-bridge",
  "@opsiclear/gsav-client",
];
const TRUSTED_RELEASE_REPOSITORIES = [
  "opsiclear/diveo",
  "opsiclear-web/diveo",
];
const TRUSTED_EVIDENCE_REPOSITORIES = [
  ...TRUSTED_RELEASE_REPOSITORIES,
  "opsiclear/gsav-hosting",
];

function hasExposedHeader(exposeHeaders, headerName) {
  if (!exposeHeaders) return false;
  const normalized = headerName.toLowerCase();
  return String(exposeHeaders)
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .includes(normalized);
}

function missingExposedRangeHeaders(exposeHeaders) {
  return REQUIRED_EXPOSED_RANGE_HEADERS.filter((header) => !hasExposedHeader(exposeHeaders, header));
}

function corsAllowOriginMatches(allowOrigin, baseUrl) {
  const value = String(allowOrigin ?? "").trim();
  if (value === "*") return true;
  if (!value) return false;

  try {
    return new URL(value).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function hostIdentityMatches(observed, expected) {
  if (isWeakValue(observed) || isWeakValue(expected)) return false;
  const normalizedObserved = String(observed).trim().toLowerCase();
  const normalizedExpected = String(expected).trim().toLowerCase();
  if (Math.min(normalizedObserved.length, normalizedExpected.length) < 7) return false;
  return normalizedExpected.startsWith(normalizedObserved)
    || normalizedObserved.startsWith(normalizedExpected);
}

function preflightHostIdentityProblems(preflight) {
  const errors = [];
  if (preflight.hostIdentityVerified !== true) {
    errors.push("gsav-preflight.json hostIdentityVerified must be true.");
  }

  const identity = preflight.hostIdentity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    errors.push("gsav-preflight.json must include hostIdentity metadata.");
    return errors;
  }

  errors.push(...productionUrlProblems("gsav-preflight.json hostIdentity.url", identity.url));
  if (identity.status !== 200) {
    errors.push("gsav-preflight.json hostIdentity.status must be 200.");
  }
  if (identity.matched !== true) {
    errors.push("gsav-preflight.json hostIdentity.matched must be true.");
  }
  if (isWeakValue(identity.expectedIdentity)) {
    errors.push("gsav-preflight.json hostIdentity.expectedIdentity is required.");
  }
  if (isWeakValue(identity.observedIdentity)) {
    errors.push("gsav-preflight.json hostIdentity.observedIdentity is required.");
  }
  if (!isWeakValue(identity.expectedIdentity)
    && !isWeakValue(identity.observedIdentity)
    && !hostIdentityMatches(identity.observedIdentity, identity.expectedIdentity)) {
    errors.push("gsav-preflight.json hostIdentity.observedIdentity must match expectedIdentity.");
  }
  if (!isWeakValue(preflight.gsavHostingCommit)) {
    if (!isWeakValue(identity.expectedIdentity) && !hostIdentityMatches(identity.expectedIdentity, preflight.gsavHostingCommit)) {
      errors.push("gsav-preflight.json hostIdentity.expectedIdentity must match gsavHostingCommit.");
    }
    if (!isWeakValue(identity.observedIdentity) && !hostIdentityMatches(identity.observedIdentity, preflight.gsavHostingCommit)) {
      errors.push("gsav-preflight.json hostIdentity.observedIdentity must match gsavHostingCommit.");
    }
  }

  return errors;
}

function commitMatches(observed, expected) {
  if (!observed || !expected) return false;
  const normalizedObserved = String(observed).toLowerCase();
  const normalizedExpected = String(expected).toLowerCase();
  if (!/^[0-9a-f]{7,40}$/i.test(normalizedObserved) || !/^[0-9a-f]{7,40}$/i.test(normalizedExpected)) {
    return false;
  }
  return normalizedExpected.startsWith(normalizedObserved)
    || normalizedObserved.startsWith(normalizedExpected);
}

function productionUrlProblems(label, value) {
  const errors = [];
  if (!value) {
    return [`${label} is missing.`];
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      errors.push(`${label} must use https.`);
    }
    if (isLocalHostname(parsed.hostname)) {
      errors.push(`${label} must not use localhost, emulator, link-local, or private LAN hosts.`);
    }
    if (parsed.username || parsed.password) {
      errors.push(`${label} must not contain credentials.`);
    }
  } catch {
    errors.push(`${label} must be a valid absolute URL.`);
  }
  return errors;
}

function trustedGithubEvidenceUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
      return false;
    }
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const repository = pathParts.slice(0, 2).join("/").toLowerCase();
    if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) {
      return false;
    }
    const rest = pathParts.slice(2).join("/");
    return /^actions\/runs\/\d+\/artifacts\/[^/]+$/i.test(rest)
      || /^releases\/download\/[^/]+\/[^/]+$/i.test(rest)
      || /^blob\/[^/]+\/docs\/qa-evidence\/.+/i.test(rest);
  } catch {
    return false;
  }
}

function trustedGithubRunUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
      return false;
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return false;
    }
    const match = /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)$/.exec(parsed.pathname);
    if (!match) {
      return false;
    }
    const repository = `${match[1]}/${match[2]}`.toLowerCase();
    return TRUSTED_RELEASE_REPOSITORIES.includes(repository);
  } catch {
    return false;
  }
}

function parseChecksums(text) {
  const entries = [];
  const errors = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64})\s+(.+)$/i.exec(line);
    if (!match) {
      errors.push(`evidence-checksums.txt line ${index + 1} is not '<sha256>  <path>'.`);
      continue;
    }
    entries.push({
      sha256: match[1].toLowerCase(),
      path: normalizeSlash(match[2].trim()),
    });
  }
  return { entries, errors };
}

function findEntryByResolvedPath(entries, root, expectedPath) {
  const normalizedExpected = normalizeSlash(path.resolve(expectedPath));
  return entries.find((entry) => (
    normalizeSlash(resolveFromRoot(root, entry.path)) === normalizedExpected
  )) ?? null;
}

function requireFile(filePath, label, errors) {
  if (!fs.existsSync(filePath)) {
    errors.push(`${label} is missing: ${normalizeSlash(filePath)}`);
    return false;
  }
  return true;
}

function validateSummary(summary, errors, { mode = DEFAULT_MODE } = {}) {
  if (summary.workflow !== "release.yml") {
    errors.push("dry-run-summary.json workflow must be release.yml.");
  }
  if (summary.releaseEvidenceGlob !== "release-evidence/**") {
    errors.push("dry-run-summary.json must record releaseEvidenceGlob=release-evidence/**.");
  }
  if (!trustedGithubRunUrl(summary.runUrl)) {
    errors.push("dry-run-summary.json must include a trusted Diveo GitHub Actions runUrl.");
  }
  if (!/^[0-9a-f]{7,40}$/i.test(summary.commit ?? "")) {
    errors.push("dry-run-summary.json must include the release candidate commit SHA.");
  }
  if (!/^[0-9a-f]{7,40}$/i.test(summary.releaseCandidateSha ?? "")) {
    errors.push("dry-run-summary.json must include releaseCandidateSha.");
  }
  if (summary.releaseCandidateSha && summary.commit && summary.releaseCandidateSha !== summary.commit) {
    errors.push("dry-run-summary.json commit must match releaseCandidateSha.");
  }
  if (summary.workflowSha && !/^[0-9a-f]{7,40}$/i.test(summary.workflowSha)) {
    errors.push("dry-run-summary.json workflowSha must be a commit SHA when present.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(summary.releaseVersion ?? "")) {
    errors.push("dry-run-summary.json must include a semver releaseVersion.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(summary.appVersion ?? "")) {
    errors.push("dry-run-summary.json must include appVersion.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(summary.packageVersion ?? "")) {
    errors.push("dry-run-summary.json must include packageVersion.");
  }
  if (!/^\d+$/.test(String(summary.androidVersionCode ?? ""))) {
    errors.push("dry-run-summary.json must include androidVersionCode.");
  }
  if (summary.appVersion && summary.releaseVersion && summary.appVersion !== summary.releaseVersion) {
    errors.push("dry-run-summary.json appVersion must match releaseVersion.");
  }
  if (summary.packageVersion && summary.releaseVersion && summary.packageVersion !== summary.releaseVersion) {
    errors.push("dry-run-summary.json packageVersion must match releaseVersion.");
  }
  const expectedArtifactName = summary.releaseVersion
    ? `diveo-release-evidence-v${summary.releaseVersion}`
    : null;
  if (!summary.artifactName || (expectedArtifactName && summary.artifactName !== expectedArtifactName)) {
    errors.push("dry-run-summary.json artifactName must match diveo-release-evidence-v<releaseVersion>.");
  }
  if (!Array.isArray(summary.releaseEvidenceFiles) || summary.releaseEvidenceFiles.length === 0) {
    errors.push("dry-run-summary.json must include releaseEvidenceFiles.");
  }
  for (const field of ["workflowDispatch", "publishRelease", "noPublishSideEffectExpected", "rangeProbeUrlPresent"]) {
    if (typeof summary[field] !== "boolean") {
      errors.push(`dry-run-summary.json ${field} must be boolean.`);
    }
  }

  if (mode === "dry-run") {
    if (!["workflow_dispatch", "push"].includes(summary.eventName)) {
      errors.push("dry-run-summary.json eventName must be workflow_dispatch or push for dry-run evidence.");
    }
    if (summary.publishRelease !== false) {
      errors.push("dry-run-summary.json must record publishRelease=false for dry-run evidence.");
    }
    if (summary.noPublishSideEffectExpected !== true) {
      errors.push("dry-run-summary.json must prove no publish side effect for dry-run evidence.");
    }
  }

  if (mode === "publish") {
    if (summary.publishRelease !== true) {
      errors.push("dry-run-summary.json must record publishRelease=true for publish evidence.");
    }
    if (summary.noPublishSideEffectExpected !== false) {
      errors.push("dry-run-summary.json must not expect no publish side effect for publish evidence.");
    }
  }

  if (summary.publishRelease === true && summary.noPublishSideEffectExpected === true) {
    errors.push("dry-run-summary.json cannot expect no publish side effect when publishRelease=true.");
  }
  if (summary.rangeProbeUrlPresent !== true) {
    errors.push("dry-run-summary.json must record rangeProbeUrlPresent=true.");
  }
  errors.push(...productionUrlProblems("dry-run-summary.json rangeProbeUrl", summary.rangeProbeUrl));
  if (!String(summary.rangeProbeUrl ?? "").includes(".gsav")) {
    errors.push("dry-run-summary.json rangeProbeUrl must point at a .gsav asset.");
  }
  if (summary.rangeRequest !== "bytes=0-0") {
    errors.push("dry-run-summary.json must record rangeRequest=bytes=0-0.");
  }
  for (const field of ["apkPath", "manifestPath", "apkSha256", "manifestSha256", "evidenceBundleSha256", "gsavPackageProvenanceSha256", "publishArtifactIdentitySha256"]) {
    if (!summary[field]) {
      errors.push(`dry-run-summary.json must include ${field}.`);
    }
  }
  if (
    summary.gsavPackageProvenanceSha256
    && !/^[0-9a-f]{64}$/.test(String(summary.gsavPackageProvenanceSha256))
  ) {
    errors.push("dry-run-summary.json gsavPackageProvenanceSha256 must be a 64-hex SHA256.");
  }
  if (
    summary.publishArtifactIdentitySha256
    && !/^[0-9a-f]{64}$/.test(String(summary.publishArtifactIdentitySha256))
  ) {
    errors.push("dry-run-summary.json publishArtifactIdentitySha256 must be a 64-hex SHA256.");
  }
  if (
    summary.publishArtifactIdentitySha256
    && String(summary.publishArtifactIdentitySha256).toLowerCase() !== sha256Text(publishArtifactIdentityText(summary))
  ) {
    errors.push("dry-run-summary.json publishArtifactIdentitySha256 does not match the stable publish artifact identity.");
  }
}

function validateGsavPackageProvenance(summary, errors, { root = process.cwd() } = {}) {
  const entries = summary.gsavPackageProvenance;
  const recordedProvenanceSha = summary.gsavPackageProvenanceSha256;
  if (!recordedProvenanceSha) {
    errors.push("dry-run-summary.json must include gsavPackageProvenanceSha256.");
  } else if (!/^[0-9a-f]{64}$/.test(String(recordedProvenanceSha))) {
    errors.push("dry-run-summary.json gsavPackageProvenanceSha256 must be a 64-hex SHA256.");
  }
  if (!Array.isArray(entries)) {
    errors.push("dry-run-summary.json must include gsavPackageProvenance.");
    return;
  }

  if (
    recordedProvenanceSha
    && /^[0-9a-f]{64}$/.test(String(recordedProvenanceSha))
    && String(recordedProvenanceSha).toLowerCase() !== gsavPackageProvenanceSha256(entries)
  ) {
    errors.push("dry-run-summary.json gsavPackageProvenanceSha256 does not match gsavPackageProvenance.");
  }

  const packageJson = readJsonFileIfExists(path.join(root, "package.json"));
  const entriesByName = new Map();
  for (const entry of entries) {
    if (entry && typeof entry === "object" && !Array.isArray(entry) && entry.packageName) {
      entriesByName.set(entry.packageName, entry);
    }
  }

  for (const packageName of REQUIRED_GSAV_PACKAGE_PROVENANCE) {
    const matchingEntries = entries.filter((entry) => entry?.packageName === packageName);
    const entry = entriesByName.get(packageName);
    if (!entry) {
      errors.push(`dry-run-summary.json gsavPackageProvenance must include ${packageName}.`);
      continue;
    }
    if (matchingEntries.length > 1) {
      errors.push(`dry-run-summary.json gsavPackageProvenance must include only one ${packageName} entry.`);
    }

    const specifier = String(entry.specifier ?? "");
    const expectedSpecifier = gsavPackageSpecifier(packageJson, packageName);
    if (expectedSpecifier !== null && specifier !== expectedSpecifier) {
      errors.push(`dry-run-summary.json gsavPackageProvenance ${packageName} specifier must match package.json.`);
    }

    const fileMatch = /^file:(.+)$/i.exec(specifier);
    const specifierTarballPath = fileMatch ? normalizeSlash(fileMatch[1]) : null;
    if (!specifierTarballPath || !/^vendor\/[^/]+\.tgz$/i.test(specifierTarballPath)) {
      errors.push(`dry-run-summary.json gsavPackageProvenance ${packageName} specifier must be file:vendor/*.tgz.`);
    }

    const tarballPath = normalizeSlash(entry.tarballPath ?? "");
    if (!/^vendor\/[^/]+\.tgz$/i.test(tarballPath)) {
      errors.push(`dry-run-summary.json gsavPackageProvenance ${packageName} tarballPath must be vendor/*.tgz.`);
      continue;
    }
    if (specifierTarballPath && tarballPath !== specifierTarballPath) {
      errors.push(`dry-run-summary.json gsavPackageProvenance ${packageName} tarballPath must match its file: specifier.`);
    }

    if (!/^[0-9a-f]{64}$/i.test(String(entry.tarballSha256 ?? ""))) {
      errors.push(`dry-run-summary.json gsavPackageProvenance ${packageName} tarballSha256 must be a 64-hex SHA256.`);
      continue;
    }

    const resolvedTarballPath = resolveFromRoot(root, tarballPath);
    if (fs.existsSync(resolvedTarballPath)) {
      const actual = sha256File(resolvedTarballPath);
      if (actual !== String(entry.tarballSha256).toLowerCase()) {
        errors.push(`dry-run-summary.json gsavPackageProvenance ${packageName} tarballSha256 must match ${tarballPath}.`);
      }
    }
  }
}

function validateChecksumManifest({
  root,
  containmentRoot = root,
  summary,
  checksumPath,
  requiredEvidenceFiles = REQUIRED_EVIDENCE_FILES,
  optionalEvidenceFiles = [],
}, errors) {
  const checksumText = readText(checksumPath);
  const parsed = parseChecksums(checksumText);
  errors.push(...parsed.errors);

  if (summary.evidenceBundleSha256 && sha256Text(checksumText) !== String(summary.evidenceBundleSha256).toLowerCase()) {
    errors.push("evidence-checksums.txt SHA256 does not match dry-run-summary.json evidenceBundleSha256.");
  }
  if (summary.evidenceChecksumManifestSha256 && summary.evidenceChecksumManifestSha256 !== summary.evidenceBundleSha256) {
    errors.push("dry-run-summary.json evidenceChecksumManifestSha256 must match evidenceBundleSha256.");
  }

  for (const item of summary.releaseEvidenceFiles ?? []) {
    const itemPath = normalizeSlash(item.path ?? "");
    if (!containedPath({
      resolveRoot: root,
      containmentRoot,
      filePath: itemPath,
      label: `dry-run-summary.json releaseEvidenceFiles path ${itemPath}`,
    }, errors)) {
      continue;
    }
    const entry = parsed.entries.find((candidate) => candidate.path === normalizeSlash(item.path));
    if (!entry) {
      errors.push(`evidence-checksums.txt is missing ${item.path}.`);
      continue;
    }
    if (entry.sha256 !== String(item.sha256).toLowerCase()) {
      errors.push(`dry-run-summary.json checksum for ${item.path} does not match evidence-checksums.txt.`);
    }
  }

  for (const entry of parsed.entries) {
    const filePath = containedPath({
      resolveRoot: root,
      containmentRoot,
      filePath: entry.path,
      label: `evidence-checksums.txt path ${entry.path}`,
    }, errors);
    if (!filePath) continue;
    if (!fs.existsSync(filePath)) {
      errors.push(`checksummed file is missing: ${entry.path}`);
      continue;
    }
    const actual = sha256File(filePath);
    if (actual !== entry.sha256) {
      errors.push(`checksum mismatch for ${entry.path}.`);
    }
  }

  const evidenceDir = path.dirname(checksumPath);
  for (const basename of requiredEvidenceFiles) {
    const requiredPath = path.join(evidenceDir, basename);
    if (!findEntryByResolvedPath(parsed.entries, root, requiredPath)) {
      errors.push(`evidence-checksums.txt is missing required evidence file ${basename}.`);
    }
    if (!findEntryByResolvedPath(summary.releaseEvidenceFiles ?? [], root, requiredPath)) {
      errors.push(`dry-run-summary.json releaseEvidenceFiles is missing required evidence file ${basename}.`);
    }
  }

  for (const basename of optionalEvidenceFiles) {
    const optionalPath = path.join(evidenceDir, basename);
    if (fs.existsSync(optionalPath) && !findEntryByResolvedPath(parsed.entries, root, optionalPath)) {
      errors.push(`evidence-checksums.txt is missing optional evidence file ${basename} that exists in the bundle.`);
    }
    if (fs.existsSync(optionalPath) && !findEntryByResolvedPath(summary.releaseEvidenceFiles ?? [], root, optionalPath)) {
      errors.push(`dry-run-summary.json releaseEvidenceFiles is missing optional evidence file ${basename} that exists in the bundle.`);
    }
  }

  return parsed.entries;
}

function validateArtifactChecksumEntries({ root, checksumEntries, apkPath, manifestPath }, errors) {
  for (const [filePath, label] of [
    [apkPath, "APK"],
    [manifestPath, "merged manifest"],
  ]) {
    if (!filePath) continue;
    if (!findEntryByResolvedPath(checksumEntries ?? [], root, filePath)) {
      errors.push(`evidence-checksums.txt is missing ${label} file entry.`);
    }
  }
}

function validateValidationPrereqsAttachmentMetadata({ root, summary, validationPrereqsPath }, errors) {
  const expectedPath = normalizeSlash(path.relative(root, validationPrereqsPath));
  if (normalizeSlash(summary.validationPrereqsPath ?? "") !== expectedPath) {
    errors.push("dry-run-summary.json validationPrereqsPath must point to the attached release-evidence/validation-prereqs.json.");
  }
  const attachedAt = summary.validationPrereqsAttachedAt;
  if (typeof attachedAt !== "string" || Number.isNaN(Date.parse(attachedAt))) {
    errors.push("dry-run-summary.json validationPrereqsAttachedAt must be an ISO timestamp from release-evidence:attach-validation-prereqs.");
  }
}

function validateReleaseCandidateIdentity({ summary, evidenceDir }, errors) {
  const text = readText(path.join(evidenceDir, "release-candidate.txt"));
  const identity = parseKeyValueText(text);
  if (!summary.releaseCandidateSha || identity.releaseCandidateSha !== summary.releaseCandidateSha) {
    errors.push("release-candidate.txt must include the dry-run-summary.json releaseCandidateSha.");
  }
  for (const required of ["appVersion", "packageVersion", "androidVersionCode"]) {
    if (!identity[required]) {
      errors.push(`release-candidate.txt must include ${required}.`);
    }
  }
  for (const [field, label] of [
    ["appVersion", "appVersion"],
    ["packageVersion", "packageVersion"],
    ["androidVersionCode", "androidVersionCode"],
  ]) {
    if (identity[field] && summary[field] && String(identity[field]) !== String(summary[field])) {
      errors.push(`release-candidate.txt ${label} must match dry-run-summary.json ${label}.`);
    }
  }
}

function validateSignoffDiff({ summary, evidenceDir }, errors) {
  const text = readText(path.join(evidenceDir, "signoff-diff-files.txt"));
  const { fields, files } = parseSignoffDiffText(text);

  if (!fields.payloadCandidateRef) {
    errors.push("signoff-diff-files.txt must include payloadCandidateRef.");
  }
  if (!fields.payloadCandidateSha) {
    errors.push("signoff-diff-files.txt must include payloadCandidateSha.");
  } else if (!commitMatches(fields.payloadCandidateSha, summary.releaseCandidateSha)) {
    errors.push("signoff-diff-files.txt payloadCandidateSha must match releaseCandidateSha.");
  }
  if (!fields.evidenceSignoffSha) {
    errors.push("signoff-diff-files.txt must include evidenceSignoffSha.");
  } else if (summary.workflowSha && !commitMatches(fields.evidenceSignoffSha, summary.workflowSha)) {
    errors.push("signoff-diff-files.txt evidenceSignoffSha must match dry-run-summary.json workflowSha.");
  }

  const disallowed = files.filter((filePath) => !isAllowedEvidenceSignoffPath(filePath));
  if (disallowed.length > 0) {
    errors.push(
      `signoff-diff-files.txt may only list QA/audit/evidence files after payload capture: ${disallowed.join(", ")}`,
    );
  }
}

function lineValue(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}\\s*(?::|=)?\\s*(.*)$`, "im").exec(text);
  return match?.[1]?.trim() ?? null;
}

function blockLinesBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return [];
  const bodyStart = start + startMarker.length;
  const end = text.indexOf(endMarker, bodyStart);
  const body = end === -1 ? text.slice(bodyStart) : text.slice(bodyStart, end);
  return body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function validateNoPublishProof({ summary, evidenceDir }, errors, { mode = DEFAULT_MODE } = {}) {
  if (mode !== "dry-run") return;

  const proofPath = path.join(evidenceDir, DRY_RUN_NO_PUBLISH_PROOF_FILE);
  if (!requireFile(proofPath, DRY_RUN_NO_PUBLISH_PROOF_FILE, errors)) {
    return;
  }

  const text = readText(proofPath);
  const requiredMarkers = [
    "publishRelease=false",
    "git status --short:",
    "git rev-parse HEAD:",
    "remote ref HEAD:",
    "gh release view",
    "githubReleaseLookup=not_found",
    "githubReleasePresent=false",
  ];
  for (const marker of requiredMarkers) {
    if (!text.includes(marker)) {
      errors.push(`${DRY_RUN_NO_PUBLISH_PROOF_FILE} must include ${marker}.`);
    }
  }
  if (summary.releaseCandidateSha && !text.includes(`releaseCandidateSha=${summary.releaseCandidateSha}`)) {
    errors.push(`${DRY_RUN_NO_PUBLISH_PROOF_FILE} releaseCandidateSha must match dry-run-summary.json.`);
  }
  if (summary.workflowSha && !text.includes(`workflowSha=${summary.workflowSha}`)) {
    errors.push(`${DRY_RUN_NO_PUBLISH_PROOF_FILE} workflowSha must match dry-run-summary.json.`);
  }

  const statusLines = blockLinesBetween(text, "git status --short:", "git rev-parse HEAD:");
  const disallowedStatusLines = statusLines.filter((line) => !/^\?\?\s+release-evidence(?:[\\/]|$)/.test(line));
  if (disallowedStatusLines.length > 0) {
    errors.push(`${DRY_RUN_NO_PUBLISH_PROOF_FILE} git status must only show generated release-evidence outputs.`);
  }

  const headSha = lineValue(text, "git rev-parse HEAD");
  if (summary.workflowSha && (!headSha || !commitMatches(headSha, summary.workflowSha))) {
    errors.push(`${DRY_RUN_NO_PUBLISH_PROOF_FILE} git rev-parse HEAD must match dry-run-summary.json workflowSha.`);
  }

  const remoteRefSha = lineValue(text, "remote ref HEAD");
  if (summary.workflowSha && (!remoteRefSha || !commitMatches(remoteRefSha, summary.workflowSha))) {
    errors.push(`${DRY_RUN_NO_PUBLISH_PROOF_FILE} remote ref HEAD must match dry-run-summary.json workflowSha.`);
  }

  const releaseLookup = lineValue(text, "githubReleaseLookup");
  if (releaseLookup !== "not_found") {
    errors.push(`${DRY_RUN_NO_PUBLISH_PROOF_FILE} gh release view must prove an authenticated not-found result.`);
  }
}

function validateStatusPass(fileName, json, errors) {
  if (json.status !== "pass") {
    errors.push(`${fileName} must have status=pass.`);
  }
}

function validateEvidenceCommit(label, json, summary, errors) {
  if (isWeakValue(json.diveoCommit)) {
    errors.push(`${label} must include diveoCommit.`);
    return;
  }
  if (!commitMatches(json.diveoCommit, summary.releaseCandidateSha)) {
    errors.push(`${label} diveoCommit must match releaseCandidateSha.`);
  }
}

function validatePreflight(preflight, summary, errors) {
  if (preflight.error) {
    errors.push(`gsav-preflight.json contains error: ${preflight.error}`);
  }
  validateEvidenceCommit("gsav-preflight.json", preflight, summary, errors);
  errors.push(...hostIdentityProblems("gsav-preflight.json", preflight));
  errors.push(...preflightHostIdentityProblems(preflight));
  errors.push(...productionUrlProblems("gsav-preflight.json baseUrl", preflight.baseUrl));
  if (!Array.isArray(preflight.routes) || preflight.routes.length === 0) {
    errors.push("gsav-preflight.json must include route results.");
  } else {
    const requiredUrlParts = [
      "/explore?embed=native&dataSaver=1",
      "/native-diagnostics?embed=native",
      "/watch/test?embed=native",
      "/watch/test?t=2.5&embed=native",
      "/watch/elly?embed=native",
    ];
    for (const route of preflight.routes) {
      if (route.status !== 200 || route.hasAppRoot !== true) {
        errors.push(`gsav-preflight.json route ${route.name ?? route.url ?? "unknown"} must return 200 with app root.`);
      }
    }
    const routeUrls = preflight.routes.map((route) => String(route.url ?? ""));
    for (const part of requiredUrlParts) {
      if (!routeUrls.some((url) => url.includes(part))) {
        errors.push(`gsav-preflight.json is missing route URL containing ${part}.`);
      }
    }
  }

  const range = preflight.rangeAsset ?? preflight.localAsset;
  if (!range) {
    errors.push("gsav-preflight.json must include rangeAsset.");
    return;
  }
  errors.push(...productionUrlProblems("gsav-preflight.json rangeAsset.url", range.url));
  if (!String(range.url ?? "").includes(".gsav")) {
    errors.push("gsav-preflight.json rangeAsset.url must point at a .gsav asset.");
  }
  if (range.status !== 206) {
    errors.push("gsav-preflight.json rangeAsset.status must be 206.");
  }
  if (range.requestRange !== "bytes=0-0") {
    errors.push("gsav-preflight.json rangeAsset.requestRange must be bytes=0-0.");
  }
  if (summary.rangeProbeUrl && range.url !== summary.rangeProbeUrl) {
    errors.push("gsav-preflight.json rangeAsset.url must match dry-run-summary.json rangeProbeUrl.");
  }
  if (summary.rangeRequest && range.requestRange !== summary.rangeRequest) {
    errors.push("gsav-preflight.json rangeAsset.requestRange must match dry-run-summary.json rangeRequest.");
  }
  if (String(range.acceptRanges ?? "").toLowerCase() !== "bytes") {
    errors.push("gsav-preflight.json rangeAsset.acceptRanges must be bytes.");
  }
  if (!exactRangeContentRange(range.contentRange)) {
    errors.push("gsav-preflight.json rangeAsset.contentRange must be bytes 0-0/<size>.");
  }
  if (!range.accessControlAllowOrigin) {
    errors.push("gsav-preflight.json rangeAsset.accessControlAllowOrigin must be present.");
  } else if (!corsAllowOriginMatches(range.accessControlAllowOrigin, preflight.baseUrl)) {
    errors.push("gsav-preflight.json rangeAsset.accessControlAllowOrigin must be * or match gsav-preflight.json baseUrl origin.");
  }
  const missingExposed = missingExposedRangeHeaders(range.accessControlExposeHeaders);
  if (missingExposed.length > 0) {
    errors.push(`gsav-preflight.json rangeAsset.accessControlExposeHeaders must expose ${missingExposed.join(", ")}.`);
  }
}

function bridgeReadyIsCompatible(bridgeReady) {
  const entries = Array.isArray(bridgeReady) ? bridgeReady : [];
  return entries.some((entry) => Number(entry.version) >= 1 && Number(entry.minVersion) <= 1);
}

function validateRuntimeSmoke(runtimeSmoke, summary, errors) {
  if (runtimeSmoke.error) {
    errors.push(`gsav-runtime-smoke.json contains error: ${runtimeSmoke.error}`);
  }
  validateEvidenceCommit("gsav-runtime-smoke.json", runtimeSmoke, summary, errors);
  errors.push(...hostIdentityProblems("gsav-runtime-smoke.json", runtimeSmoke));
  errors.push(...productionUrlProblems("gsav-runtime-smoke.json baseUrl", runtimeSmoke.baseUrl));
  for (const field of ["nodeVersion", "npmVersion", "diveoCommit"]) {
    if (isWeakValue(runtimeSmoke[field])) {
      errors.push(`gsav-runtime-smoke.json must include ${field}.`);
    }
  }
  if (!Array.isArray(runtimeSmoke.routes) || runtimeSmoke.routes.length === 0) {
    errors.push("gsav-runtime-smoke.json must include route results.");
    return;
  }

  const requiredRoutes = [
    { name: /explore/i, url: /\/explore\?embed=native.*dataSaver=1/i },
    { name: /diagnostics/i, url: /\/native-diagnostics\?embed=native/i },
    { name: /watch/i, url: /\/watch\/test\?embed=native/i },
  ];
  for (const required of requiredRoutes) {
    const route = runtimeSmoke.routes.find((candidate) => required.name.test(candidate.name ?? ""));
    if (!route) {
      errors.push(`gsav-runtime-smoke.json is missing ${required.name} route.`);
      continue;
    }
    if (!required.url.test(route.url ?? "")) {
      errors.push(`gsav-runtime-smoke.json route ${route.name} has unexpected URL.`);
    }
    if (!bridgeReadyIsCompatible(route.bridgeReady)) {
      errors.push(`gsav-runtime-smoke.json route ${route.name} must include compatible bridgeReady metadata.`);
    }
    const types = new Set(route.bridgeTypes ?? []);
    for (const type of ["GSAV_AUTH_READY", "GSAV_BRIDGE_READY", "GSAV_ROUTE_CHANGE"]) {
      if (!types.has(type)) {
        errors.push(`gsav-runtime-smoke.json route ${route.name} must capture ${type}.`);
      }
    }
    const state = route.state ?? {};
    if (state.topNavCount !== 0 || state.miniPlayerCount !== 0) {
      errors.push(`gsav-runtime-smoke.json route ${route.name} must hide public web chrome.`);
    }
  }
}

function extractVersionCode(text) {
  const match = /versionCode(?:=|\s*[: ]\s*)['"]?(\d+)/i.exec(text);
  return match?.[1] ?? null;
}

function validateVersionMetadata({ summary, evidenceDir, root }, errors) {
  const versionText = readText(path.join(evidenceDir, "version.txt")).trim();
  if (versionText !== summary.releaseVersion) {
    errors.push(`version.txt (${versionText}) must match releaseVersion (${summary.releaseVersion}).`);
  }

  const appMetadata = readJsonEvidence(path.join(evidenceDir, "app-version-metadata.json"));
  if (appMetadata.version !== summary.releaseVersion) {
    errors.push("app-version-metadata.json version must match releaseVersion.");
  }
  const appVersionCode = String(appMetadata.androidVersionCode ?? "");
  if (!/^\d+$/.test(appVersionCode)) {
    errors.push("app-version-metadata.json must include androidVersionCode.");
  }
  if (summary.appVersion && appMetadata.version !== summary.appVersion) {
    errors.push("app-version-metadata.json version must match dry-run-summary.json appVersion.");
  }
  if (summary.androidVersionCode && appVersionCode && appVersionCode !== String(summary.androidVersionCode)) {
    errors.push("app-version-metadata.json androidVersionCode must match dry-run-summary.json androidVersionCode.");
  }

  const gradleVersionCode = extractVersionCode(readText(path.join(evidenceDir, "gradle-version-code.txt")));
  const apkMetadataText = readText(path.join(evidenceDir, "apk-version-metadata.txt"));
  const apkVersionCode = extractVersionCode(apkMetadataText);
  if (!/^status:\s*pass/im.test(apkMetadataText)) {
    errors.push("apk-version-metadata.txt must have status: pass.");
  }
  if (!gradleVersionCode) {
    errors.push("gradle-version-code.txt must include versionCode.");
  }
  if (!apkVersionCode) {
    errors.push("apk-version-metadata.txt must include versionCode.");
  }
  for (const [label, value] of [
    ["gradle-version-code.txt", gradleVersionCode],
    ["apk-version-metadata.txt", apkVersionCode],
  ]) {
    if (value && appVersionCode && value !== appVersionCode) {
      errors.push(`${label} versionCode ${value} must match app-version-metadata.json ${appVersionCode}.`);
    }
  }

  const packageJsonPath = path.join(root, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readText(packageJsonPath));
    if (packageJson.version && packageJson.version !== summary.releaseVersion) {
      errors.push(`releaseVersion ${summary.releaseVersion} must match package.json version ${packageJson.version}.`);
    }
  }
}

function validateReleaseArtifact({ releaseArtifact, summary, apkPath, manifestPath }, errors) {
  validateStatusPass("release-artifact.json", releaseArtifact, errors);
  if (releaseArtifact.checksums?.apkSha256 !== summary.apkSha256) {
    errors.push("release-artifact.json apkSha256 must match dry-run-summary.json.");
  }
  if (releaseArtifact.checksums?.manifestSha256 !== summary.manifestSha256) {
    errors.push("release-artifact.json manifestSha256 must match dry-run-summary.json.");
  }
  if (summary.apkSha256 && sha256File(apkPath) !== summary.apkSha256) {
    errors.push("APK file SHA256 must match dry-run-summary.json.");
  }
  if (summary.manifestSha256 && sha256File(manifestPath) !== summary.manifestSha256) {
    errors.push("manifest file SHA256 must match dry-run-summary.json.");
  }
  const checked = releaseArtifact.checked ?? {};
  for (const [name, state] of Object.entries(checked.requiredBundleValues ?? {})) {
    if (state !== "present") {
      errors.push(`release-artifact.json must record ${name} as present.`);
    }
  }
  if ((checked.forbiddenBundleMatches ?? []).length > 0) {
    errors.push("release-artifact.json must have no forbidden bundle matches.");
  }
  if (checked.androidUsesCleartextTraffic !== false) {
    errors.push("release-artifact.json must record androidUsesCleartextTraffic=false.");
  }
  if (checked.androidDebuggable !== false) {
    errors.push("release-artifact.json must record androidDebuggable=false.");
  }
}

const VALIDATION_PREREQ_URLS = [
  ["production-gsav-web-url", "validation-prereqs.json production GSAV web URL", false],
  ["production-gsav-catalog-url", "validation-prereqs.json production GSAV catalog URL", false],
  ["production-supabase-url", "validation-prereqs.json production Supabase URL", false],
  ["production-range-probe-url", "validation-prereqs.json production range probe URL", true],
  ["production-host-identity-url", "validation-prereqs.json production GSAV host identity URL", false],
];

function validationPathMatches({ root, observedPath, expectedPath }) {
  if (!observedPath || !expectedPath) return false;
  const resolvedObserved = resolveFromRoot(root, observedPath);
  const resolvedExpected = resolveFromRoot(root, expectedPath);
  return normalizeSlash(path.resolve(resolvedObserved)) === normalizeSlash(path.resolve(resolvedExpected));
}

function validationEnvEntry(validationPrereqs, id) {
  const entry = validationPrereqs.checked?.env?.[id];
  return entry && typeof entry === "object" && !Array.isArray(entry) ? entry : null;
}

function validationHasMetadataTool(validationPrereqs) {
  const tools = validationPrereqs.checked?.androidMetadataTools ?? {};
  return Object.values(tools).some((tool) => (
    tool && typeof tool === "object" && (tool.commandAvailable === true || tool.envConfigured === true)
  ));
}

function validationIosEntry(validationPrereqs, id) {
  const entry = validationPrereqs.checked?.ios?.[id];
  return entry && typeof entry === "object" && !Array.isArray(entry) ? entry : null;
}

function validationIosEntryIsConcrete(entry, pattern = null) {
  if (!entry || entry.present !== true || isWeakValue(entry.value)) return false;
  return pattern ? pattern.test(String(entry.value)) : true;
}

function validateValidationIosArtifactReplay({
  root,
  entryRoot,
  evidenceDir,
  artifactPath,
  artifactSha256,
  computedArtifactSha256,
  summary,
  checksumEntries,
}, errors) {
  if (!artifactPath?.value) return;
  if (artifactPath.insideRoot !== true) {
    errors.push("validation-prereqs.json iOS validation artifact path must be inside the downloaded artifact root.");
  }

  const artifactAbsolutePath = containedPath({
    resolveRoot: root,
    containmentRoot: root,
    filePath: artifactPath.value,
    label: "validation-prereqs.json iOS validation artifact path",
  }, errors);
  if (!artifactAbsolutePath) return;
  if (!isInsidePath(evidenceDir, artifactAbsolutePath)) {
    errors.push("validation-prereqs.json iOS validation artifact path must stay inside the release evidence directory.");
  }

  if (!findEntryByResolvedPath(summary.releaseEvidenceFiles ?? [], entryRoot, artifactAbsolutePath)) {
    errors.push("dry-run-summary.json releaseEvidenceFiles must include the iOS validation artifact path.");
  }
  if (!findEntryByResolvedPath(checksumEntries ?? [], entryRoot, artifactAbsolutePath)) {
    errors.push("evidence-checksums.txt must include the iOS validation artifact path.");
  }
  if (!fs.existsSync(artifactAbsolutePath)) {
    errors.push(`iOS validation artifact is missing: ${normalizeSlash(artifactPath.value)}`);
    return;
  }

  const actualSha256 = sha256File(artifactAbsolutePath);
  if (/^[a-f0-9]{64}$/i.test(String(computedArtifactSha256?.value || ""))
    && actualSha256 !== String(computedArtifactSha256.value).toLowerCase()) {
    errors.push("validation-prereqs.json computed iOS artifact SHA256 must match the current artifact bytes.");
  }
  if (/^[a-f0-9]{64}$/i.test(String(artifactSha256?.value || ""))
    && actualSha256 !== String(artifactSha256.value).toLowerCase()) {
    errors.push("validation-prereqs.json declared iOS artifact SHA256 must match the current artifact bytes.");
  }
}

function androidDeviceMetadataComplete(device) {
  if (!device || typeof device !== "object" || Array.isArray(device)) return false;
  return !isWeakValue(device.serial)
    && !isWeakValue(device.model)
    && !isWeakValue(device.androidVersion)
    && /^\d+$/.test(String(device.apiLevel || ""))
    && (!isWeakValue(device.buildFingerprint) || !isWeakValue(device.buildIncremental))
    && !isWeakValue(device.webViewPackageName)
    && !isWeakValue(device.webViewVersion)
    && device.metadataOk === true;
}

function validateValidationPrereqs({ validationPrereqs, summary, root, entryRoot = root, evidenceDir, apkPath, manifestPath, checksumEntries }, errors) {
  if (validationPrereqs.ok !== true || validationPrereqs.status !== "pass") {
    errors.push("validation-prereqs.json must have ok=true and status=pass.");
  }
  if (!validationPrereqs.checkedAt) {
    errors.push("validation-prereqs.json must include checkedAt.");
  }
  if (!Array.isArray(validationPrereqs.blockers) || validationPrereqs.blockers.length > 0) {
    errors.push("validation-prereqs.json must have no blockers.");
  }
  if (!Array.isArray(validationPrereqs.warnings)) {
    errors.push("validation-prereqs.json warnings must be an array.");
  }

  const commands = validationPrereqs.checked?.commands ?? {};
  for (const command of ["adb", "java", "npx", "gh"]) {
    if (commands[command] !== true) {
      errors.push(`validation-prereqs.json checked.commands.${command} must be true.`);
    }
  }

  const android = validationPrereqs.checked?.android ?? {};
  if (android.adbDevicesOk !== true) {
    errors.push("validation-prereqs.json checked.android.adbDevicesOk must be true.");
  }
  if (!Array.isArray(android.connectedDevices) || android.connectedDevices.length === 0) {
    errors.push("validation-prereqs.json must include at least one connected Android device.");
  }
  const deviceMetadata = Array.isArray(android.deviceMetadata) ? android.deviceMetadata : [];
  if (!deviceMetadata.some(androidDeviceMetadataComplete)) {
    errors.push("validation-prereqs.json must include Android device metadata with model, OS/API, build, and WebView package/version.");
  }

  if (!validationHasMetadataTool(validationPrereqs)) {
    errors.push("validation-prereqs.json must include aapt, apkanalyzer, or bundletool availability.");
  }

  const iosExecutorProof = validationIosEntry(validationPrereqs, "executorProof");
  if (!validationIosEntryIsConcrete(iosExecutorProof, /\bmacOS\b|\bXcode\b|\bxcrun\b|physical iOS device|physical-device/i)) {
    errors.push("validation-prereqs.json must include iOS executor proof with macOS/Xcode/xcrun or physical-device evidence.");
  }
  const iosOwner = validationIosEntry(validationPrereqs, "owner");
  if (!validationIosEntryIsConcrete(iosOwner)) {
    errors.push("validation-prereqs.json must include concrete iOS validation owner.");
  }
  const iosDevice = validationIosEntry(validationPrereqs, "deviceIdentity");
  if (!validationIosEntryIsConcrete(iosDevice)) {
    errors.push("validation-prereqs.json must include iOS simulator/device identity.");
  }
  const iosVersion = validationIosEntry(validationPrereqs, "iosVersion");
  if (!validationIosEntryIsConcrete(iosVersion, /(?:^|\b)i?OS?\s*\d|^\d+(?:\.\d+){0,2}$/i)) {
    errors.push("validation-prereqs.json must include concrete iOS version.");
  }
  const wkWebViewVersion = validationIosEntry(validationPrereqs, "wkWebViewVersion");
  if (!validationIosEntryIsConcrete(wkWebViewVersion, /(?:WKWebView|WebKit|Safari)?\s*\d+(?:\.\d+){0,3}/i)) {
    errors.push("validation-prereqs.json must include WKWebView/WebKit version.");
  }
  const artifactUrl = validationIosEntry(validationPrereqs, "artifactUrl");
  if (!validationIosEntryIsConcrete(artifactUrl) || !trustedGithubEvidenceUrl(artifactUrl.value)) {
    errors.push("validation-prereqs.json must include a trusted iOS validation artifact URL.");
  }
  const artifactSha256 = validationIosEntry(validationPrereqs, "artifactSha256");
  if (!validationIosEntryIsConcrete(artifactSha256, /^[a-f0-9]{64}$/i)) {
    errors.push("validation-prereqs.json must include 64-hex iOS validation artifact SHA256.");
  }
  const artifactPath = validationIosEntry(validationPrereqs, "artifactPath");
  if (!artifactPath || artifactPath.present !== true || !artifactPath.value || artifactPath.exists !== true) {
    errors.push("validation-prereqs.json must include an existing iOS validation artifact path.");
  }
  const computedArtifactSha256 = validationIosEntry(validationPrereqs, "computedArtifactSha256");
  if (!validationIosEntryIsConcrete(computedArtifactSha256, /^[a-f0-9]{64}$/i)) {
    errors.push("validation-prereqs.json must include computed iOS validation artifact SHA256.");
  }
  if (validationPrereqs.checked?.ios?.artifactSha256Matches !== true) {
    errors.push("validation-prereqs.json computed iOS artifact SHA256 must match the declared checksum.");
  }
  validateValidationIosArtifactReplay({
    root,
    entryRoot,
    evidenceDir,
    artifactPath,
    artifactSha256,
    computedArtifactSha256,
    summary,
    checksumEntries,
  }, errors);

  for (const [id, label, mustEndWithGsav] of VALIDATION_PREREQ_URLS) {
    const entry = validationEnvEntry(validationPrereqs, id);
    if (!entry || entry.present !== true || !entry.value) {
      errors.push(`validation-prereqs.json ${id} must be present.`);
      continue;
    }
    errors.push(...productionUrlProblems(label, entry.value));
    if (mustEndWithGsav) {
      try {
        if (!new URL(entry.value).pathname.toLowerCase().endsWith(".gsav")) {
          errors.push(`${label} must point at a .gsav asset.`);
        }
      } catch {
        // productionUrlProblems already reports the invalid URL.
      }
    }
  }

  const anonKey = validationEnvEntry(validationPrereqs, "production-supabase-anon-key");
  if (!anonKey || anonKey.present !== true || anonKey.value !== "[redacted]") {
    errors.push("validation-prereqs.json production Supabase anon key must be present and redacted.");
  }
  const hostingCommit = validationEnvEntry(validationPrereqs, "production-hosting-commit");
  if (!hostingCommit || hostingCommit.present !== true || isWeakValue(hostingCommit.value)) {
    errors.push("validation-prereqs.json production GSAV host/build identity must be concrete.");
  }

  for (const qaKey of ["EXPO_PUBLIC_GSAV_QA_CONTROLS", "EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS"]) {
    const value = validationPrereqs.checked?.env?.[qaKey];
    if (value && value !== "0") {
      errors.push(`validation-prereqs.json ${qaKey} must be unset or 0.`);
    }
  }

  for (const [field, expectedPath, label] of [
    ["apk", apkPath || summary.apkPath, "APK path"],
    ["manifest", manifestPath || summary.manifestPath, "merged manifest path"],
  ]) {
    const entry = validationPrereqs.checked?.paths?.[field];
    if (!entry || entry.exists !== true || !entry.path) {
      errors.push(`validation-prereqs.json ${label} must exist.`);
      continue;
    }
    if (!validationPathMatches({ root, observedPath: entry.path, expectedPath })) {
      errors.push(`validation-prereqs.json ${label} must match the verified release artifact path.`);
    }
  }
}

function verifyReleaseEvidenceBundle({
  root = process.cwd(),
  evidenceDir = DEFAULT_EVIDENCE_DIR,
  apkPath,
  manifestPath,
  mode = DEFAULT_MODE,
  requireValidationPrereqs = false,
} = {}) {
  const evidenceMode = normalizeMode(mode);
  const validationPrereqsRequired = normalizeBooleanOption(requireValidationPrereqs, "requireValidationPrereqs");
  const errors = [];
  const resolvedRoot = path.resolve(root);
  const containmentRoot = containmentRootFor({ root: resolvedRoot, evidenceDir });
  const resolvedEvidenceDir = resolveFromRoot(resolvedRoot, evidenceDir);
  const summaryPath = path.join(resolvedEvidenceDir, "dry-run-summary.json");
  const checksumPath = path.join(resolvedEvidenceDir, "evidence-checksums.txt");
  const validationPrereqsPath = path.join(resolvedEvidenceDir, VALIDATION_PREREQS_FILE);
  const requiredEvidenceFiles = validationPrereqsRequired
    ? [...REQUIRED_EVIDENCE_FILES, VALIDATION_PREREQS_FILE]
    : REQUIRED_EVIDENCE_FILES;

  for (const basename of [...requiredEvidenceFiles, "dry-run-summary.json", "evidence-checksums.txt"]) {
    requireFile(path.join(resolvedEvidenceDir, basename), basename, errors);
  }
  if (errors.length > 0) {
    return { ok: false, errors, checked: { evidenceDir: normalizeSlash(resolvedEvidenceDir) } };
  }

  let summary;
  try {
    summary = readJsonEvidence(summaryPath);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { ok: false, errors, checked: { evidenceDir: normalizeSlash(resolvedEvidenceDir) } };
  }

  validateSummary(summary, errors, { mode: evidenceMode });
  validateGsavPackageProvenance(summary, errors, { root: resolvedRoot });
  const checksumEntries = validateChecksumManifest({
    root,
    containmentRoot,
    summary,
    checksumPath,
    requiredEvidenceFiles,
    optionalEvidenceFiles: [VALIDATION_PREREQS_FILE],
  }, errors);

  const resolvedApkPath = containedPath({
    resolveRoot: resolvedRoot,
    containmentRoot,
    filePath: apkPath || summary.apkPath || "",
    label: "APK path",
  }, errors);
  const resolvedManifestPath = containedPath({
    resolveRoot: resolvedRoot,
    containmentRoot,
    filePath: manifestPath || summary.manifestPath || "",
    label: "merged manifest path",
  }, errors);
  validateArtifactChecksumEntries({
    root: resolvedRoot,
    checksumEntries,
    apkPath: resolvedApkPath,
    manifestPath: resolvedManifestPath,
  }, errors);
  if (validationPrereqsRequired) {
    validateValidationPrereqsAttachmentMetadata({
      root: resolvedRoot,
      summary,
      validationPrereqsPath,
    }, errors);
  }
  if (resolvedApkPath) requireFile(resolvedApkPath, "APK file", errors);
  if (resolvedManifestPath) requireFile(resolvedManifestPath, "merged manifest file", errors);
  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      checked: {
        evidenceDir: normalizeSlash(resolvedEvidenceDir),
        summaryPath: normalizeSlash(summaryPath),
      },
    };
  }

  try {
    validateStatusPass("native-production-config-before-bump.json", readJsonEvidence(path.join(resolvedEvidenceDir, "native-production-config-before-bump.json")), errors);
    validateStatusPass("native-production-config-after-bump.json", readJsonEvidence(path.join(resolvedEvidenceDir, "native-production-config-after-bump.json")), errors);
    validatePreflight(readJsonEvidence(path.join(resolvedEvidenceDir, "gsav-preflight.json")), summary, errors);
    validateRuntimeSmoke(readJsonEvidence(path.join(resolvedEvidenceDir, "gsav-runtime-smoke.json")), summary, errors);
    validateReleaseCandidateIdentity({ summary, evidenceDir: resolvedEvidenceDir }, errors);
    validateSignoffDiff({ summary, evidenceDir: resolvedEvidenceDir }, errors);
    validateNoPublishProof({ summary, evidenceDir: resolvedEvidenceDir }, errors, { mode: evidenceMode });
    validateVersionMetadata({ summary, evidenceDir: resolvedEvidenceDir, root }, errors);
    validateReleaseArtifact({
      releaseArtifact: readJsonEvidence(path.join(resolvedEvidenceDir, "release-artifact.json")),
      summary,
      apkPath: resolvedApkPath,
      manifestPath: resolvedManifestPath,
    }, errors);
    if (validationPrereqsRequired || fs.existsSync(validationPrereqsPath)) {
    validateValidationPrereqs({
      validationPrereqs: readJsonEvidence(validationPrereqsPath),
      summary,
      root: containmentRoot,
      entryRoot: root,
      evidenceDir: resolvedEvidenceDir,
      apkPath: resolvedApkPath,
      manifestPath: resolvedManifestPath,
      checksumEntries,
    }, errors);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return {
    ok: errors.length === 0,
    errors,
    checked: {
      evidenceDir: normalizeSlash(resolvedEvidenceDir),
      summaryPath: normalizeSlash(summaryPath),
      checksumPath: normalizeSlash(checksumPath),
      apkPath: normalizeSlash(resolvedApkPath),
      manifestPath: normalizeSlash(resolvedManifestPath),
      releaseVersion: summary.releaseVersion,
      artifactName: summary.artifactName,
      mode: evidenceMode,
      requireValidationPrereqs: validationPrereqsRequired,
    },
  };
}

function main() {
  let result;
  try {
    const args = parseArgs();
    result = verifyReleaseEvidenceBundle({
      root: args.root ?? process.cwd(),
      evidenceDir: args.evidenceDir ?? DEFAULT_EVIDENCE_DIR,
      apkPath: args.apkPath,
      manifestPath: args.manifestPath,
      mode: args.mode ?? DEFAULT_MODE,
      requireValidationPrereqs: args.requireValidationPrereqs,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    status: result.ok ? "pass" : "fail",
    ...result,
  }, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOWED_MODES,
  DEFAULT_EVIDENCE_DIR,
  DEFAULT_MODE,
  REQUIRED_EVIDENCE_FILES,
  REQUIRED_GSAV_PACKAGE_PROVENANCE,
  VALIDATION_PREREQS_FILE,
  normalizeBooleanOption,
  normalizeMode,
  parseArgs,
  parseChecksums,
  parseKeyValueText,
  parseSignoffDiffText,
  parseJsonFromText,
  gsavPackageProvenanceSha256,
  gsavPackageProvenanceText,
  publishArtifactIdentityText,
  productionUrlProblems,
  sha256Text,
  trustedGithubEvidenceUrl,
  trustedGithubRunUrl,
  validateGsavPackageProvenance,
  verifyReleaseEvidenceBundle,
};
