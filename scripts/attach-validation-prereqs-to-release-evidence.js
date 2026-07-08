#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_EVIDENCE_DIR = "release-evidence";
const VALIDATION_PREREQS_FILE = "validation-prereqs.json";

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    root: process.cwd(),
    evidenceDir: DEFAULT_EVIDENCE_DIR,
    validationPrereqsPath: null,
    apkPath: null,
    manifestPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (!Object.prototype.hasOwnProperty.call(options, key)) {
      throw new Error(`Unknown option: ${arg}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function normalizeSlash(value) {
  return String(value).replace(/\\/g, "/");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function resolveFromRoot(root, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

function isInsidePath(root, filePath) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveInsideRoot(root, filePath, label) {
  const resolvedPath = resolveFromRoot(root, filePath);
  if (!isInsidePath(root, resolvedPath)) {
    throw new Error(`${label} must stay inside root: ${normalizeSlash(filePath)}`);
  }
  return resolvedPath;
}

function requireInsideDirectory(directory, filePath, label) {
  if (!isInsidePath(directory, filePath)) {
    throw new Error(`${label} must stay inside evidenceDir: ${normalizeSlash(filePath)}`);
  }
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} is missing: ${normalizeSlash(filePath)}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function concreteSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

function assertPathMatches(label, provided, summaryValue) {
  if (!provided || !summaryValue) return;
  if (normalizeSlash(provided) !== normalizeSlash(summaryValue)) {
    throw new Error(`${label} must match dry-run-summary.json (${summaryValue}).`);
  }
}

function validationAttachmentFiles({ root, evidenceDir, validationPath }) {
  requireInsideDirectory(evidenceDir, validationPath, VALIDATION_PREREQS_FILE);
  const validationPrereqs = readJson(validationPath);
  const validationRelativePath = normalizeSlash(path.relative(root, validationPath));
  const attachments = [{
    path: validationRelativePath,
    absolutePath: validationPath,
    label: VALIDATION_PREREQS_FILE,
  }];
  const ios = validationPrereqs.checked?.ios ?? {};
  const artifactPath = ios.artifactPath?.value;

  if (!artifactPath) {
    throw new Error("validation-prereqs.json must include checked.ios.artifactPath.value before attachment.");
  }
  if (ios.artifactPath?.exists !== true) {
    throw new Error("validation-prereqs.json must record checked.ios.artifactPath.exists=true before attachment.");
  }
  const resolvedArtifactPath = resolveInsideRoot(root, artifactPath, "iOS validation artifact path");
  requireInsideDirectory(evidenceDir, resolvedArtifactPath, "iOS validation artifact path");
  requireFile(resolvedArtifactPath, "iOS validation artifact");
  const actualSha256 = sha256File(resolvedArtifactPath);
  const computedSha256 = ios.computedArtifactSha256?.value;
  const declaredSha256 = ios.artifactSha256?.value;
  if (!concreteSha256(computedSha256)) {
    throw new Error("validation-prereqs.json must include checked.ios.computedArtifactSha256.value before attachment.");
  }
  if (!concreteSha256(declaredSha256)) {
    throw new Error("validation-prereqs.json must include checked.ios.artifactSha256.value before attachment.");
  }
  if (actualSha256 !== String(computedSha256).toLowerCase()) {
    throw new Error("iOS validation artifact SHA256 does not match validation-prereqs.json computedArtifactSha256.");
  }
  if (actualSha256 !== String(declaredSha256).toLowerCase()) {
    throw new Error("iOS validation artifact SHA256 does not match validation-prereqs.json artifactSha256.");
  }
  if (ios.artifactSha256Matches !== true) {
    throw new Error("validation-prereqs.json must record checked.ios.artifactSha256Matches=true before attachment.");
  }

  attachments.push({
    path: normalizeSlash(path.relative(root, resolvedArtifactPath)),
    absolutePath: resolvedArtifactPath,
    label: "iOS validation artifact",
  });
  return attachments;
}

function verifiedEvidenceFiles({ root, summary, attachedFiles }) {
  if (!Array.isArray(summary.releaseEvidenceFiles)) {
    throw new Error("dry-run-summary.json releaseEvidenceFiles must be an array.");
  }

  const nextFiles = [];
  const seen = new Set();
  const attachedPaths = new Set(attachedFiles.map((item) => item.path));
  for (const item of summary.releaseEvidenceFiles) {
    const itemPath = normalizeSlash(item.path ?? "");
    if (!itemPath || !item.sha256) {
      throw new Error("dry-run-summary.json releaseEvidenceFiles entries must include path and sha256.");
    }
    if (attachedPaths.has(itemPath)) continue;
    const absolutePath = resolveInsideRoot(root, itemPath, `release evidence file ${itemPath}`);
    requireFile(absolutePath, `release evidence file ${itemPath}`);
    const actual = sha256File(absolutePath);
    if (actual !== String(item.sha256).toLowerCase()) {
      throw new Error(`checksum mismatch before attaching validation prerequisites: ${itemPath}`);
    }
    if (seen.has(itemPath)) {
      throw new Error(`duplicate release evidence file in dry-run-summary.json: ${itemPath}`);
    }
    seen.add(itemPath);
    nextFiles.push({ path: itemPath, sha256: actual });
  }

  for (const attachedFile of attachedFiles) {
    if (seen.has(attachedFile.path)) {
      throw new Error(`duplicate release evidence file in attachment inputs: ${attachedFile.path}`);
    }
    seen.add(attachedFile.path);
    nextFiles.push({
      path: attachedFile.path,
      sha256: sha256File(attachedFile.absolutePath),
    });
  }
  return nextFiles.sort((a, b) => a.path.localeCompare(b.path));
}

function attachValidationPrereqsToReleaseEvidence({
  root = process.cwd(),
  evidenceDir = DEFAULT_EVIDENCE_DIR,
  validationPrereqsPath,
  apkPath,
  manifestPath,
  checkedAt = new Date().toISOString(),
} = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedEvidenceDir = resolveInsideRoot(resolvedRoot, evidenceDir, "evidenceDir");
  const summaryPath = path.join(resolvedEvidenceDir, "dry-run-summary.json");
  const checksumPath = path.join(resolvedEvidenceDir, "evidence-checksums.txt");
  const resolvedValidationPath = resolveInsideRoot(
    resolvedRoot,
    validationPrereqsPath || path.join(evidenceDir, VALIDATION_PREREQS_FILE),
    VALIDATION_PREREQS_FILE,
  );

  requireFile(summaryPath, "dry-run-summary.json");
  requireFile(checksumPath, "evidence-checksums.txt");
  requireFile(resolvedValidationPath, VALIDATION_PREREQS_FILE);

  const summary = readJson(summaryPath);
  const existingChecksumText = fs.readFileSync(checksumPath, "utf8");
  if (summary.evidenceBundleSha256
    && sha256Text(existingChecksumText) !== String(summary.evidenceBundleSha256).toLowerCase()) {
    throw new Error("existing evidence-checksums.txt does not match dry-run-summary.json evidenceBundleSha256.");
  }

  assertPathMatches("APK path", apkPath, summary.apkPath);
  assertPathMatches("merged manifest path", manifestPath, summary.manifestPath);
  const effectiveApkPath = apkPath || summary.apkPath;
  const effectiveManifestPath = manifestPath || summary.manifestPath;
  if (!effectiveApkPath || !effectiveManifestPath) {
    throw new Error("APK and manifest paths are required.");
  }

  const resolvedApkPath = resolveInsideRoot(resolvedRoot, effectiveApkPath, "APK path");
  const resolvedManifestPath = resolveInsideRoot(resolvedRoot, effectiveManifestPath, "merged manifest path");
  requireFile(resolvedApkPath, "APK file");
  requireFile(resolvedManifestPath, "merged manifest file");

  const apkSha256 = sha256File(resolvedApkPath);
  const manifestSha256 = sha256File(resolvedManifestPath);
  if (summary.apkSha256 && apkSha256 !== String(summary.apkSha256).toLowerCase()) {
    throw new Error("APK SHA256 does not match dry-run-summary.json.");
  }
  if (summary.manifestSha256 && manifestSha256 !== String(summary.manifestSha256).toLowerCase()) {
    throw new Error("manifest SHA256 does not match dry-run-summary.json.");
  }

  const attachedFiles = validationAttachmentFiles({
    root: resolvedRoot,
    evidenceDir: resolvedEvidenceDir,
    validationPath: resolvedValidationPath,
  });
  const validationRelativePath = normalizeSlash(path.relative(resolvedRoot, resolvedValidationPath));
  const releaseEvidenceFiles = verifiedEvidenceFiles({
    root: resolvedRoot,
    summary,
    attachedFiles,
  });

  const checksumText = [
    ...releaseEvidenceFiles.map((item) => `${item.sha256}  ${item.path}`),
    `${apkSha256}  ${normalizeSlash(effectiveApkPath)}`,
    `${manifestSha256}  ${normalizeSlash(effectiveManifestPath)}`,
  ].join("\n") + "\n";
  const evidenceBundleSha256 = sha256Text(checksumText);
  const nextSummary = {
    ...summary,
    releaseEvidenceFiles,
    apkSha256,
    manifestSha256,
    evidenceBundleSha256,
    evidenceChecksumManifestSha256: evidenceBundleSha256,
    validationPrereqsPath: validationRelativePath,
    validationPrereqsAttachedAt: checkedAt,
  };

  fs.writeFileSync(checksumPath, checksumText);
  fs.writeFileSync(summaryPath, `${JSON.stringify(nextSummary, null, 2)}\n`);
  return {
    summaryPath,
    checksumPath,
    validationPrereqsPath: resolvedValidationPath,
    evidenceBundleSha256,
    releaseEvidenceFiles,
  };
}

function main() {
  try {
    const result = attachValidationPrereqsToReleaseEvidence(parseArgs());
    console.log(JSON.stringify({
      status: "pass",
      summaryPath: normalizeSlash(result.summaryPath),
      checksumPath: normalizeSlash(result.checksumPath),
      validationPrereqsPath: normalizeSlash(result.validationPrereqsPath),
      evidenceBundleSha256: result.evidenceBundleSha256,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_EVIDENCE_DIR,
  VALIDATION_PREREQS_FILE,
  attachValidationPrereqsToReleaseEvidence,
  parseArgs,
  sha256File,
  sha256Text,
  resolveInsideRoot,
};
