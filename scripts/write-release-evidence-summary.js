#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = value;
    i += 1;
  }
  return options;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

const GSAV_PACKAGE_NAMES = [
  "@opsiclear/gsav-bridge",
  "@opsiclear/gsav-client",
];

function normalizeSlash(value) {
  return value.replace(/\\/g, "/");
}

function listFilesRecursive(dir) {
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir);
  return files.sort((a, b) => normalizeSlash(a).localeCompare(normalizeSlash(b)));
}

function boolFromString(value) {
  return String(value ?? "").toLowerCase() === "true";
}

function releaseRunUrl(env) {
  if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID) {
    return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  }
  return null;
}

function releaseCandidateSha(options, env) {
  return options.releaseCandidateSha || env.RELEASE_CANDIDATE_SHA || env.GITHUB_SHA || null;
}

function parseKeyValueText(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9]*)=(.+)$/.exec(line.trim());
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}

function readReleaseCandidateIdentity(evidenceDir) {
  const filePath = path.join(evidenceDir, "release-candidate.txt");
  if (!fs.existsSync(filePath)) return {};
  return parseKeyValueText(fs.readFileSync(filePath, "utf8"));
}

function readJsonFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function gsavPackageSpecifier(packageJson, packageName) {
  return packageJson?.dependencies?.[packageName]
    ?? packageJson?.devDependencies?.[packageName]
    ?? null;
}

function gsavPackageProvenance(root = process.cwd()) {
  const packageJson = readJsonFileIfExists(path.join(root, "package.json"));
  return GSAV_PACKAGE_NAMES.map((packageName) => {
    const specifier = gsavPackageSpecifier(packageJson, packageName);
    const entry = { packageName, specifier };
    const fileMatch = /^file:(.+)$/i.exec(specifier ?? "");
    if (fileMatch) {
      const tarballPath = normalizeSlash(fileMatch[1]);
      const resolvedTarballPath = path.resolve(root, fileMatch[1]);
      entry.tarballPath = tarballPath;
      entry.tarballSha256 = fs.existsSync(resolvedTarballPath)
        ? sha256File(resolvedTarballPath)
        : null;
    }
    return entry;
  });
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
    ...GSAV_PACKAGE_NAMES.flatMap((packageName) => {
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

function releaseCandidateIdentityProblems(identity, candidateSha, releaseVersion) {
  const errors = [];
  for (const field of ["releaseCandidateSha", "appVersion", "packageVersion", "androidVersionCode"]) {
    if (!identity[field]) {
      errors.push(`release-candidate.txt must include ${field}`);
    }
  }
  if (!candidateSha) {
    errors.push("releaseCandidateSha is required");
  } else {
    if (!/^[0-9a-f]{7,40}$/i.test(candidateSha)) {
      errors.push("releaseCandidateSha must be a commit SHA");
    }
    if (identity.releaseCandidateSha && identity.releaseCandidateSha !== candidateSha) {
      errors.push("release-candidate.txt releaseCandidateSha must match RELEASE_CANDIDATE_SHA");
    }
  }
  for (const field of ["appVersion", "packageVersion"]) {
    if (identity[field] && !/^\d+\.\d+\.\d+$/.test(identity[field])) {
      errors.push(`release-candidate.txt ${field} must be semver`);
    }
    if (identity[field] && releaseVersion && identity[field] !== releaseVersion) {
      errors.push(`release-candidate.txt ${field} must match releaseVersion`);
    }
  }
  if (identity.androidVersionCode && !/^\d+$/.test(identity.androidVersionCode)) {
    errors.push("release-candidate.txt androidVersionCode must be numeric");
  }
  return errors;
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

function buildReleaseEvidenceSummary({
  root = process.cwd(),
  evidenceDir,
  apkPath,
  manifestPath,
  artifactName,
  releaseVersion,
  releaseCandidateSha: optionReleaseCandidateSha,
  env = process.env,
  checkedAt = new Date().toISOString(),
}) {
  if (!evidenceDir) throw new Error("evidenceDir is required");
  if (!artifactName) throw new Error("artifactName is required");
  if (!releaseVersion) throw new Error("releaseVersion is required");
  const expectedArtifactName = `diveo-release-evidence-v${releaseVersion}`;
  if (artifactName !== expectedArtifactName) {
    throw new Error(`artifactName must be ${expectedArtifactName}`);
  }
  if (!apkPath || !fs.existsSync(apkPath)) throw new Error(`APK file is missing: ${apkPath}`);
  if (!manifestPath || !fs.existsSync(manifestPath)) throw new Error(`merged manifest file is missing: ${manifestPath}`);

  const evidenceFiles = listFilesRecursive(evidenceDir)
    .filter((filePath) => !["dry-run-summary.json", "evidence-checksums.txt"].includes(path.basename(filePath)))
    .map((filePath) => ({
      path: normalizeSlash(path.relative(process.cwd(), filePath)),
      sha256: sha256File(filePath),
    }));

  const artifactFiles = [
    { path: normalizeSlash(apkPath), sha256: sha256File(apkPath) },
    { path: normalizeSlash(manifestPath), sha256: sha256File(manifestPath) },
  ];
  const checksumText = [...evidenceFiles, ...artifactFiles]
    .map((item) => `${item.sha256}  ${item.path}`)
    .join("\n") + "\n";

  const eventName = env.GITHUB_EVENT_NAME ?? null;
  const publishRelease = boolFromString(env.PUBLISH_RELEASE);
  const workflowDispatch = eventName === "workflow_dispatch";
  const dryRunEvent = !publishRelease && (workflowDispatch || eventName === "push");
  const candidateIdentity = readReleaseCandidateIdentity(evidenceDir);
  const candidateSha = releaseCandidateSha({ releaseCandidateSha: optionReleaseCandidateSha }, env);
  const candidateIdentityErrors = releaseCandidateIdentityProblems(candidateIdentity, candidateSha, releaseVersion);
  if (candidateIdentityErrors.length > 0) {
    throw new Error(candidateIdentityErrors.join("; "));
  }
  const workflowSha = env.GITHUB_SHA ?? null;
  const rangeProbeUrl = env.GSAV_RANGE_PROBE_URL || env.GSAV_NATIVE_PREFLIGHT_RANGE_URL || null;
  const packageProvenance = gsavPackageProvenance(root);

  const summary = {
    checkedAt,
    workflow: "release.yml",
    workflowDispatch,
    eventName,
    publishRelease,
    noPublishSideEffectExpected: dryRunEvent,
    runUrl: releaseRunUrl(env),
    commit: candidateSha,
    releaseCandidateSha: candidateSha,
    workflowSha,
    releaseVersion,
    appVersion: candidateIdentity.appVersion ?? releaseVersion,
    packageVersion: candidateIdentity.packageVersion ?? releaseVersion,
    androidVersionCode: candidateIdentity.androidVersionCode ?? null,
    artifactName,
    releaseEvidenceGlob: "release-evidence/**",
    releaseEvidenceFiles: evidenceFiles,
    apkPath: normalizeSlash(apkPath),
    manifestPath: normalizeSlash(manifestPath),
    apkSha256: artifactFiles[0].sha256,
    manifestSha256: artifactFiles[1].sha256,
    evidenceBundleSha256: sha256Text(checksumText),
    evidenceChecksumManifestSha256: sha256Text(checksumText),
    gsavPackageProvenance: packageProvenance,
    gsavPackageProvenanceSha256: gsavPackageProvenanceSha256(packageProvenance),
    rangeProbeUrl,
    rangeRequest: "bytes=0-0",
    rangeProbeUrlPresent: Boolean(rangeProbeUrl),
  };
  summary.publishArtifactIdentitySha256 = sha256Text(publishArtifactIdentityText(summary));
  return summary;
}

function writeReleaseEvidenceSummary(options) {
  const evidenceDir = options.evidenceDir;
  fs.mkdirSync(evidenceDir, { recursive: true });
  const summary = buildReleaseEvidenceSummary(options);
  const checksumLines = [
    ...summary.releaseEvidenceFiles.map((item) => `${item.sha256}  ${item.path}`),
    `${summary.apkSha256}  ${summary.apkPath}`,
    `${summary.manifestSha256}  ${summary.manifestPath}`,
  ].join("\n") + "\n";

  const checksumPath = path.join(evidenceDir, "evidence-checksums.txt");
  const summaryPath = path.join(evidenceDir, "dry-run-summary.json");
  fs.writeFileSync(checksumPath, checksumLines);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  return { summary, checksumPath, summaryPath };
}

function main() {
  const options = parseArgs();
  const result = writeReleaseEvidenceSummary({
    evidenceDir: options.evidenceDir,
    apkPath: options.apkPath,
    manifestPath: options.manifestPath,
    artifactName: options.artifactName,
    releaseVersion: options.releaseVersion,
    releaseCandidateSha: options.releaseCandidateSha,
  });
  console.log(JSON.stringify({
    status: "pass",
    summaryPath: normalizeSlash(result.summaryPath),
    checksumPath: normalizeSlash(result.checksumPath),
    artifactName: result.summary.artifactName,
    evidenceBundleSha256: result.summary.evidenceBundleSha256,
    publishArtifactIdentitySha256: result.summary.publishArtifactIdentitySha256,
    gsavPackageProvenanceSha256: result.summary.gsavPackageProvenanceSha256,
    apkSha256: result.summary.apkSha256,
    manifestSha256: result.summary.manifestSha256,
    noPublishSideEffectExpected: result.summary.noPublishSideEffectExpected,
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReleaseEvidenceSummary,
  gsavPackageProvenance,
  gsavPackageProvenanceSha256,
  gsavPackageProvenanceText,
  parseArgs,
  parseKeyValueText,
  publishArtifactIdentityText,
  releaseCandidateIdentityProblems,
  sha256File,
  sha256Text,
  writeReleaseEvidenceSummary,
};
