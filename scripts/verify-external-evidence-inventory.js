#!/usr/bin/env node
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { trackedCleanPathProblems } = require("./git-integrity.js");

const {
  deviceValidationHelperEvidenceCandidates,
  parseEvidenceRows,
} = require("./verify-release-readiness.js");

const SCHEMA_VERSION = "external-evidence-inventory/v1";
const PRODUCT_JOURNEY_ARTIFACT_PURPOSE = "product-journey-manifest";
const PRODUCT_JOURNEY_EVIDENCE_ARTIFACT_PURPOSE = "product-journey-evidence";
const PRODUCT_JOURNEY_FIXTURE_ARTIFACT_PURPOSE = "fixture-manifest";
const TRUSTED_EVIDENCE_REPOSITORIES = [
  "opsiclear/diveo",
  "opsiclear-web/diveo",
  "opsiclear/gsav-hosting",
];

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    root: process.cwd(),
    inventoryPath: env.EXTERNAL_EVIDENCE_INVENTORY_PATH || null,
    qaPath: "docs/GSAV_NATIVE_QA.md",
    packetPath: env.DEVICE_EVIDENCE_PACKET_PATH || null,
    scaffold: false,
    force: false,
    reviewer: env.EXTERNAL_EVIDENCE_INVENTORY_REVIEWER || "_pending_",
    reviewedAt: env.EXTERNAL_EVIDENCE_INVENTORY_REVIEWED_AT || "_pending_",
    requireGitIntegrity: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index];
    };
    if (arg === "--root") options.root = path.resolve(next());
    else if (arg === "--inventory-path") options.inventoryPath = next();
    else if (arg === "--qa-path") options.qaPath = next();
    else if (arg === "--packet-path") options.packetPath = next();
    else if (arg === "--scaffold") options.scaffold = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--require-git-integrity") options.requireGitIntegrity = true;
    else if (arg === "--reviewer") options.reviewer = next();
    else if (arg === "--reviewed-at") options.reviewedAt = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.inventoryPath) {
    throw new Error("--inventory-path is required");
  }
  return options;
}

function normalizeSlash(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function normalizeKey(value) {
  return normalizeSlash(value).trim();
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isIsoTimestamp(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)
    && !Number.isNaN(Date.parse(text));
}

function weakValue(value) {
  return !String(value ?? "").trim()
    || /_pending_|pending|tbd|todo|placeholder|<[^>]+>/i.test(String(value));
}

function isPassedQaRow(row) {
  return Boolean(row)
    && [row.date, row.platform, row.device, row.gsavWebUrl, row.route, row.result, row.evidencePath]
      .every((value) => !weakValue(value))
    && /^Passed(?::|\s+with\s+scoped\s+exception:)/i.test(row.result);
}

function evidenceCandidates(value) {
  return String(value ?? "")
    .split(/[,;]/)
    .map((part) => part.trim())
    .map((part) => {
      const markdownLink = /\[[^\]]+\]\(([^)]+)\)/.exec(part);
      return markdownLink ? markdownLink[1] : part;
    })
    .map((part) => {
      const normalized = normalizeSlash(part);
      return normalized.startsWith("<") && normalized.endsWith(">")
        ? normalized.slice(1, -1)
        : normalized;
    })
    .filter(Boolean);
}

function pathKind(value) {
  const raw = String(value ?? "").trim();
  if (/^https?:\/\//i.test(raw)) return githubEvidencePathKind(raw);
  if (raw.startsWith("docs/qa-evidence/")) return "local";
  return "unsupported";
}

function trustedGithubEvidenceUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return false;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const repository = parts.slice(0, 2).join("/").toLowerCase();
    if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) return false;
    const rest = parts.slice(2).join("/");
    return /^actions\/runs\/\d+\/artifacts\/[^/]+$/i.test(rest)
      || /^releases\/download\/[^/]+\/[^/]+$/i.test(rest)
      || /^blob\/[^/]+\/docs\/qa-evidence\/.+/i.test(rest);
  } catch {
    return false;
  }
}

function githubEvidencePathKind(url) {
  if (!trustedGithubEvidenceUrl(url)) return "unsupported-url";
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const rest = parts.slice(2).join("/");
  if (/^actions\/runs\/\d+\/artifacts\/[^/]+$/i.test(rest)) return "actions-artifact";
  if (/^releases\/download\/[^/]+\/[^/]+$/i.test(rest)) return "release-download";
  if (/^blob\/[^/]+\/docs\/qa-evidence\/.+/i.test(rest)) return "qa-blob";
  return "unsupported-url";
}

function githubEvidenceIdentity(url) {
  const kind = githubEvidencePathKind(url);
  if (kind === "unsupported-url") return null;
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  if (kind === "actions-artifact") {
    return {
      kind,
      sourceRunId: parts[4],
      sourceArtifactId: decodeURIComponent(parts[6] ?? ""),
    };
  }
  if (kind === "release-download") {
    return {
      kind,
      sourceRunId: null,
      sourceArtifactId: decodeURIComponent(parts[4] ?? ""),
    };
  }
  return { kind, sourceRunId: null, sourceArtifactId: normalizeSlash(parts.slice(4).join("/")) };
}

function sanitizeReplaySegment(value) {
  const normalized = normalizeSlash(value)
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "artifact";
}

function replayPathDate(localPath) {
  return /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/external\//i.exec(normalizeKey(localPath))?.[1] ?? null;
}

function suggestedExternalReplayPath(evidencePath, evidenceDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(evidenceDate ?? ""))) return null;
  const identity = githubEvidenceIdentity(evidencePath);
  if (!identity) return null;
  const artifactSegment = sanitizeReplaySegment(identity.sourceArtifactId || "artifact");
  if (identity.sourceRunId) {
    return `docs/qa-evidence/${evidenceDate}/external/${identity.sourceRunId}/${artifactSegment}/${artifactSegment}.zip`;
  }
  return `docs/qa-evidence/${evidenceDate}/external/${identity.kind}/${artifactSegment}/${artifactSegment}`;
}

function externalReplayPathProblems(evidencePath, localPath, evidenceDate) {
  const problems = [];
  const normalizedLocalPath = normalizeKey(localPath);
  if (!/^docs\/qa-evidence\/\d{4}-\d{2}-\d{2}\/external\//i.test(normalizedLocalPath)) {
    problems.push(`${evidencePath} downloadedPath must be under docs/qa-evidence/<date>/external/`);
    return problems;
  }

  const downloadedDate = replayPathDate(normalizedLocalPath);
  if (evidenceDate && downloadedDate && downloadedDate !== evidenceDate) {
    problems.push(`${evidencePath} downloadedPath date must match evidence date ${evidenceDate}`);
  }

  const identity = githubEvidenceIdentity(evidencePath);
  if (identity?.sourceRunId && identity?.sourceArtifactId) {
    const artifactSegment = sanitizeReplaySegment(identity.sourceArtifactId);
    const expectedPrefix = `docs/qa-evidence/${downloadedDate}/external/${identity.sourceRunId}/${artifactSegment}/`;
    if (!normalizedLocalPath.startsWith(expectedPrefix)) {
      problems.push(`${evidencePath} downloadedPath for Actions artifacts must be under ${expectedPrefix}`);
    }
  }

  return problems;
}

function resolveRepoPath(root, relativePath) {
  const normalized = normalizeSlash(relativePath);
  if (!normalized || path.isAbsolute(normalized) || /^file:\/\//i.test(normalized) || normalized.includes("../")) {
    return null;
  }
  return path.join(root, normalized);
}

function relativeOrOriginal(root, filePath) {
  const raw = normalizeSlash(filePath);
  const absolutePath = path.isAbsolute(raw) ? raw : path.join(root, raw);
  const relativePath = normalizeSlash(path.relative(root, absolutePath));
  if (relativePath && relativePath !== ".." && !relativePath.startsWith("../") && !path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return raw;
}

function repoRelativePath(root, filePath) {
  const raw = normalizeSlash(filePath);
  if (!raw || /^https?:\/\//i.test(raw) || /^file:\/\//i.test(raw)) return null;
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(absoluteRoot, raw);
  const relativePath = normalizeSlash(path.relative(absoluteRoot, absolutePath));
  if (!relativePath || relativePath.startsWith("../") || path.isAbsolute(relativePath)) return null;
  return relativePath;
}

function reviewedPacketPathProblems(packetPath, root = process.cwd(), { scaffold = false } = {}) {
  if (!packetPath) return [];

  const displayPath = relativeOrOriginal(root, packetPath);
  const problems = [];
  if (!/^docs\/qa-evidence\/\d{4}-\d{2}-\d{2}\/[^/]+\.json$/i.test(displayPath)) {
    problems.push(
      `${displayPath} packet path must be a reviewed packet JSON under docs/qa-evidence/<date>`,
    );
  }

  const basename = path.basename(displayPath);
  if (!scaffold && /(?:scaffold|candidate|pending|example)/i.test(basename)) {
    problems.push(
      `${displayPath} packet path must not reference a scaffold, candidate, pending, or example packet`,
    );
  }

  return problems;
}

function reviewedInventoryPathProblems(inventoryPath, { root = process.cwd(), scaffold = false } = {}) {
  if (scaffold || !inventoryPath) return [];

  const displayPath = relativeOrOriginal(root, inventoryPath);
  if (!/^docs\/qa-evidence\/\d{4}-\d{2}-\d{2}\/external-evidence-inventory\.json$/i.test(displayPath)) {
    return [
      `${displayPath} inventory path must be docs/qa-evidence/<date>/external-evidence-inventory.json`,
    ];
  }
  return [];
}

function qaEvidenceDateFromPath(filePath, root = process.cwd(), pattern = /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\//i) {
  const displayPath = relativeOrOriginal(root, filePath);
  return pattern.exec(displayPath)?.[1] ?? null;
}

function inventoryPacketDateProblems({ inventoryPath = null, packetPath = null, root = process.cwd() } = {}) {
  if (!inventoryPath || !packetPath) return [];

  const inventoryDate = qaEvidenceDateFromPath(
    inventoryPath,
    root,
    /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/external-evidence-inventory\.json$/i,
  );
  const packetDate = qaEvidenceDateFromPath(packetPath, root);
  if (!inventoryDate || !packetDate || inventoryDate === packetDate) return [];

  return [
    "external evidence inventory path and packet path must use the same docs/qa-evidence/<date> folder",
  ];
}

function requiredReplayPacketPathProblems({ packetPath, scaffold }) {
  if (scaffold || packetPath) return [];
  return ["--packet-path <reviewed-packet.json> is required for external evidence replay"];
}

function qaRowId(row) {
  return `${row.platform} ${row.route}`;
}

function expectedPurposeForSource(source) {
  if (source.packetType === "negative" || source.platform === "Android/iOS") return "negative-evidence";
  if (source.platform === "Android" || source.platform === "iOS") return "route-evidence";
  return null;
}

function productJourneyManifestEvidenceRequirements({ root, manifestPath }) {
  const normalizedManifestPath = normalizeKey(manifestPath);
  if (!normalizedManifestPath || weakValue(normalizedManifestPath) || pathKind(normalizedManifestPath) !== "local") {
    return [];
  }
  const evidenceDate = qaEvidenceDateFromPath(normalizedManifestPath, root);
  const resolvedManifestPath = resolveRepoPath(root, normalizedManifestPath);
  if (!resolvedManifestPath || !fs.existsSync(resolvedManifestPath)) return [];

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(manifest.entries)) return [];

  const required = [];
  const fixtureManifestPath = normalizeKey(manifest.fixtureManifestPath);
  if (fixtureManifestPath && !weakValue(fixtureManifestPath)) {
    required.push({
      evidencePath: fixtureManifestPath,
      source: "product-journey-fixture",
      packetId: "fixture-manifest",
      evidenceDate,
      expectedPurpose: PRODUCT_JOURNEY_FIXTURE_ARTIFACT_PURPOSE,
      expectedSha256: normalizeKey(manifest.fixtureManifestSha256).toLowerCase(),
    });
  }
  for (const entry of manifest.entries) {
    const entryId = String(entry?.id ?? "").trim() || "unknown";
    const evidencePaths = Array.isArray(entry?.evidencePaths) ? entry.evidencePaths : [];
    const mediaSha256 = Array.isArray(entry?.mediaSha256) ? entry.mediaSha256 : [];
    const fileSha256 = Array.isArray(entry?.fileSha256) ? entry.fileSha256 : [];
    let localShaIndex = 0;
    let externalShaIndex = 0;
    for (const value of evidencePaths) {
      for (const candidate of evidenceCandidates(value)) {
        const evidencePath = normalizeKey(candidate);
        if (!evidencePath || weakValue(evidencePath)) continue;
        const candidateKind = pathKind(evidencePath);
        const expectedSha256 = candidateKind === "local"
          ? mediaSha256[localShaIndex++]
          : fileSha256[externalShaIndex++];
        required.push({
          evidencePath,
          source: "product-journey",
          packetId: entryId,
          evidenceDate,
          expectedPurpose: PRODUCT_JOURNEY_EVIDENCE_ARTIFACT_PURPOSE,
          expectedSha256: normalizeKey(expectedSha256).toLowerCase(),
          expectedSha256Field: candidateKind === "local" ? "mediaSha256" : "fileSha256",
          expectedSourceRunId: normalizeKey(entry?.sourceRunId),
          expectedSourceArtifactId: normalizeKey(entry?.sourceArtifactId),
        });
      }
    }
  }
  return required;
}

function productJourneyManifestExpansionProblems({ root, manifestPath }) {
  const normalizedManifestPath = normalizeKey(manifestPath);
  if (!normalizedManifestPath || weakValue(normalizedManifestPath)) return [];
  if (pathKind(normalizedManifestPath) !== "local") {
    return [`packet target productJourneyManifestPath must be repository-local for inventory expansion: ${normalizedManifestPath}`];
  }
  const resolvedManifestPath = resolveRepoPath(root, normalizedManifestPath);
  if (!resolvedManifestPath || !fs.existsSync(resolvedManifestPath)) {
    return [`product journey manifest does not exist for inventory expansion: ${normalizedManifestPath}`];
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, "utf8"));
    const problems = [];
    const manifestDate = qaEvidenceDateFromPath(normalizedManifestPath, root);
    const addLocalPathDateProblems = (label, evidencePath) => {
      const normalizedEvidencePath = normalizeKey(evidencePath);
      if (!normalizedEvidencePath || weakValue(normalizedEvidencePath) || pathKind(normalizedEvidencePath) !== "local") return;
      const linkedDate = qaEvidenceDateFromPath(normalizedEvidencePath, root);
      if (!linkedDate) {
        problems.push(`product journey manifest ${label} must be under docs/qa-evidence/<date>/ for inventory expansion: ${normalizedEvidencePath}`);
      } else if (manifestDate && linkedDate !== manifestDate) {
        problems.push(`product journey manifest ${label} date must match manifest date ${manifestDate}: ${normalizedEvidencePath}`);
      }
    };

    if (!manifestDate) {
      problems.push(`product journey manifest path must be under docs/qa-evidence/<date>/ for inventory expansion: ${normalizedManifestPath}`);
    }
    if (manifest.artifactPurpose !== PRODUCT_JOURNEY_ARTIFACT_PURPOSE) {
      problems.push(`product journey manifest artifactPurpose must be ${PRODUCT_JOURNEY_ARTIFACT_PURPOSE} for inventory expansion: ${normalizedManifestPath}`);
    }
    if (manifest.helperOnly !== false) {
      problems.push(`product journey manifest helperOnly must be false for inventory expansion: ${normalizedManifestPath}`);
    }
    addLocalPathDateProblems("fixtureManifestPath", manifest.fixtureManifestPath);
    if (!Array.isArray(manifest.entries)) {
      problems.push(`product journey manifest entries must be an array for inventory expansion: ${normalizedManifestPath}`);
    } else {
      const seenEntryIds = new Set();
      for (const [index, entry] of manifest.entries.entries()) {
        const entryId = String(entry?.id ?? "").trim();
        if (!entryId || weakValue(entryId) || /^unknown$/i.test(entryId)) {
          problems.push(`product journey manifest entry ${index} id must be concrete for inventory expansion: ${normalizedManifestPath}`);
          continue;
        }
        if (seenEntryIds.has(entryId)) {
          problems.push(`product journey manifest entry id ${entryId} is duplicated for inventory expansion: ${normalizedManifestPath}`);
        }
        seenEntryIds.add(entryId);
        if (Array.isArray(entry?.evidencePaths)) {
          for (const value of entry.evidencePaths) {
            for (const candidate of evidenceCandidates(value)) {
              addLocalPathDateProblems(`entry ${entryId} evidencePath`, candidate);
            }
          }
        }
      }
    }
    return problems;
  } catch (error) {
    return [`product journey manifest JSON is invalid for inventory expansion: ${normalizedManifestPath}: ${error.message}`];
  }
}

function collectRequiredEvidence({ qaText, packet, root = process.cwd() }) {
  const required = [];
  for (const row of parseEvidenceRows(qaText).filter(isPassedQaRow)) {
    for (const candidate of evidenceCandidates(row.evidencePath)) {
      required.push({
        evidencePath: normalizeKey(candidate),
        source: "qa",
        qaRowId: qaRowId(row),
        platform: row.platform,
        route: row.route,
        evidenceDate: row.date,
        expectedPurpose: expectedPurposeForSource({ platform: row.platform }),
      });
    }
  }

  for (const packetEntry of packet?.packets ?? []) {
    if (packetEntry?.status !== "passed") continue;
    for (const candidate of packetEntry.actual?.evidencePaths ?? []) {
      required.push({
        evidencePath: normalizeKey(candidate),
        source: "packet",
        packetId: packetEntry.id,
        packetType: packetEntry.type,
        evidenceDate: qaEvidenceDateFromPath(normalizeKey(candidate), root),
        expectedPurpose: expectedPurposeForSource({ packetType: packetEntry.type }),
      });
    }
  }

  const productJourneyManifestPath = normalizeKey(packet?.target?.productJourneyManifestPath);
  if (productJourneyManifestPath && !weakValue(productJourneyManifestPath)) {
    required.push({
      evidencePath: productJourneyManifestPath,
      source: "packet-target",
      packetId: "product-journey-manifest",
      evidenceDate: qaEvidenceDateFromPath(productJourneyManifestPath, root),
      expectedPurpose: null,
    });
    required.push(...productJourneyManifestEvidenceRequirements({
      root,
      manifestPath: productJourneyManifestPath,
    }));
  }

  const seen = new Set();
  return required.filter((entry) => {
    const key = `${entry.source}:${entry.qaRowId ?? entry.packetId}:${entry.evidencePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inventoryEntryProblems(entry, requiredSource, root, inventoryDate = null) {
  const problems = [];
  const evidencePath = normalizeKey(entry.evidencePath);
  if (!evidencePath) {
    return ["inventory entry is missing evidencePath"];
  }
  if (entry.status !== "pass") problems.push(`${evidencePath} inventory status must be pass`);
  if (weakValue(entry.reviewer)) problems.push(`${evidencePath} inventory reviewer must be concrete`);
  if (!isIsoTimestamp(entry.reviewedAt)) problems.push(`${evidencePath} inventory reviewedAt must be ISO timestamp`);

  const kind = pathKind(evidencePath);
  if (kind === "unsupported") {
    problems.push(`${evidencePath} is not a supported docs/qa-evidence path`);
  }
  if (kind === "unsupported-url") {
    problems.push(`${evidencePath} must be a trusted direct GitHub artifact, release download, or docs/qa-evidence blob URL`);
  }

  const helperOnlyEvidence = deviceValidationHelperEvidenceCandidates(evidencePath);
  if (helperOnlyEvidence.length > 0) {
    problems.push(`${evidencePath} helper evidence cannot satisfy replay inventory: ${helperOnlyEvidence.join(", ")}`);
  }

  const localPath = kind === "local" ? evidencePath : normalizeKey(entry.downloadedPath);
  if (kind !== "local" && !localPath) {
    problems.push(`${evidencePath} URL-backed inventory entry requires downloadedPath`);
  }
  if (localPath && !localPath.startsWith("docs/qa-evidence/")) {
    problems.push(`${evidencePath} downloadedPath must be under docs/qa-evidence`);
  }
  if (kind !== "local" && localPath) {
    problems.push(...externalReplayPathProblems(
      evidencePath,
      localPath,
      inventoryDate ?? requiredSource?.evidenceDate ?? null,
    ));
  }

  const resolvedLocalPath = localPath ? resolveRepoPath(root, localPath) : null;
  if (localPath && !resolvedLocalPath) {
    problems.push(`${evidencePath} downloadedPath must be repository-relative`);
  } else if (resolvedLocalPath && !fs.existsSync(resolvedLocalPath)) {
    problems.push(`${evidencePath} downloadedPath does not exist: ${localPath}`);
  }

  const expectedSha = String(entry.sha256 ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/i.test(expectedSha)) {
    problems.push(`${evidencePath} inventory sha256 must be 64-hex`);
  } else if (resolvedLocalPath && fs.existsSync(resolvedLocalPath)) {
    const actualSha = sha256File(resolvedLocalPath);
    if (actualSha !== expectedSha) {
      problems.push(`${evidencePath} inventory sha256 mismatch: expected ${expectedSha}, got ${actualSha}`);
    }
  }

  if (kind !== "local") {
    const identity = githubEvidenceIdentity(evidencePath);
    if (identity?.sourceRunId && String(entry.sourceRunId ?? "") !== identity.sourceRunId) {
      problems.push(`${evidencePath} sourceRunId must match URL run ${identity.sourceRunId}`);
    }
    if (identity?.sourceArtifactId && String(entry.sourceArtifactId ?? "") !== identity.sourceArtifactId) {
      problems.push(`${evidencePath} sourceArtifactId must match URL artifact ${identity.sourceArtifactId}`);
    }
  }

  const expectedPurpose = requiredSource?.expectedPurpose;
  if (requiredSource?.source === "packet-target" && requiredSource?.packetId === "product-journey-manifest") {
    if (entry.artifactPurpose !== PRODUCT_JOURNEY_ARTIFACT_PURPOSE) {
      problems.push(`${evidencePath} artifactPurpose must be ${PRODUCT_JOURNEY_ARTIFACT_PURPOSE}`);
    }
    if (entry.helperOnly !== false) {
      problems.push(`${evidencePath} helperOnly must be false`);
    }
  }
  if (requiredSource?.source === "product-journey") {
    const journeyEntryId = String(requiredSource.packetId ?? "").trim();
    const hasDirectEntryId = String(entry.journeyEntryId ?? "").trim() === journeyEntryId;
    const hasSourceRef = Array.isArray(entry.sourceRefs)
      && entry.sourceRefs.some((ref) => (
        ref?.source === "product-journey"
        && String(ref?.packetId ?? "").trim() === journeyEntryId
      ));
    if (!hasDirectEntryId && !hasSourceRef) {
      problems.push(`${evidencePath} journeyEntryId or sourceRefs must reference product journey entry ${journeyEntryId}`);
    }
    const expectedJourneySha = String(requiredSource.expectedSha256 ?? "").trim().toLowerCase();
    const expectedJourneyShaField = String(requiredSource.expectedSha256Field ?? "sha256").trim();
    if (!/^[a-f0-9]{64}$/i.test(expectedJourneySha)) {
      problems.push(`${evidencePath} product journey ${expectedJourneyShaField} must be 64-hex for entry ${journeyEntryId}`);
    } else if (expectedSha && expectedSha !== expectedJourneySha) {
      problems.push(`${evidencePath} inventory sha256 must match product journey ${expectedJourneyShaField} ${expectedJourneySha}`);
    }
    const identity = githubEvidenceIdentity(evidencePath);
    if (identity?.sourceRunId && String(requiredSource.expectedSourceRunId ?? "") !== identity.sourceRunId) {
      problems.push(`${evidencePath} product journey sourceRunId must match evidence URL run ${identity.sourceRunId} for entry ${journeyEntryId}`);
    }
    if (identity?.sourceArtifactId && String(requiredSource.expectedSourceArtifactId ?? "") !== identity.sourceArtifactId) {
      problems.push(`${evidencePath} product journey sourceArtifactId must match evidence URL artifact ${identity.sourceArtifactId} for entry ${journeyEntryId}`);
    }
  }
  if (requiredSource?.source === "product-journey-fixture") {
    const expectedFixtureSha = String(requiredSource.expectedSha256 ?? "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/i.test(expectedFixtureSha)) {
      problems.push(`${evidencePath} product journey fixtureManifestSha256 must be 64-hex`);
    } else if (expectedSha && expectedSha !== expectedFixtureSha) {
      problems.push(`${evidencePath} inventory sha256 must match product journey fixtureManifestSha256 ${expectedFixtureSha}`);
    }
    if (resolvedLocalPath && fs.existsSync(resolvedLocalPath)) {
      try {
        const fixtureManifest = JSON.parse(fs.readFileSync(resolvedLocalPath, "utf8"));
        if (fixtureManifest.artifactPurpose !== PRODUCT_JOURNEY_FIXTURE_ARTIFACT_PURPOSE) {
          problems.push(`${evidencePath} fixture manifest artifactPurpose must be ${PRODUCT_JOURNEY_FIXTURE_ARTIFACT_PURPOSE}`);
        }
        if (fixtureManifest.helperOnly !== false) {
          problems.push(`${evidencePath} fixture manifest helperOnly must be false`);
        }
      } catch (error) {
        problems.push(`${evidencePath} fixture manifest JSON is invalid: ${error.message}`);
      }
    }
  }
  if (expectedPurpose) {
    if (entry.artifactPurpose !== expectedPurpose) {
      problems.push(`${evidencePath} artifactPurpose must be ${expectedPurpose}`);
    }
    if (entry.helperOnly !== false) {
      problems.push(`${evidencePath} helperOnly must be false`);
    }
    if (
      requiredSource?.source !== "product-journey"
      && requiredSource?.source !== "product-journey-fixture"
    ) {
      problems.push(...manifestProblems(
        entry,
        evidencePath,
        expectedPurpose,
        root,
        inventoryDate ?? requiredSource?.evidenceDate ?? null,
      ));
    }
  }

  return problems;
}

function localReplayPathsFromInventory(inventory, {
  inventoryPath = null,
  qaPath = null,
  packetPath = null,
  root = process.cwd(),
} = {}) {
  const paths = new Set();
  for (const value of [inventoryPath, qaPath, packetPath]) {
    const relativePath = repoRelativePath(root, value);
    if (relativePath) paths.add(relativePath);
  }
  for (const entry of inventory?.entries ?? []) {
    const evidencePath = normalizeKey(entry.evidencePath);
    const kind = pathKind(evidencePath);
    const localPath = kind === "local" ? evidencePath : normalizeKey(entry.downloadedPath);
    const manifestPath = normalizeKey(entry.manifestPath || entry.evidenceManifestPath);
    for (const value of [localPath, manifestPath]) {
      const relativePath = repoRelativePath(root, value);
      if (relativePath) paths.add(relativePath);
    }
  }
  return Array.from(paths);
}

function inventoryGitIntegrityProblems(root, replayPaths) {
  const paths = Array.from(new Set(replayPaths.map((filePath) => repoRelativePath(root, filePath) ?? normalizeSlash(filePath)).filter(Boolean)));
  if (paths.length === 0) return [];

  return trackedCleanPathProblems(root, paths, {
    insideRepositoryMessage: (filePath) => `external evidence inventory replay file must be inside the repository before final readiness: ${filePath}`,
    untrackedMessage: (relativePath) => `external evidence inventory replay file must be tracked in git before final readiness: ${relativePath}`,
    dirtyMessage: (status) => `external evidence inventory replay files must be committed before final readiness: ${status}`,
    noGitMessage: () => "external evidence inventory replay files must be checked in a git workspace before final readiness.",
  });
}

function manifestProblems(entry, evidencePath, expectedPurpose, root, expectedDate = null) {
  const problems = [];
  const manifestPath = normalizeKey(entry.manifestPath || entry.evidenceManifestPath);
  if (!manifestPath) {
    return [`${evidencePath} route/negative inventory requires manifestPath or evidenceManifestPath`];
  }
  if (!manifestPath.startsWith("docs/qa-evidence/")) {
    problems.push(`${evidencePath} manifestPath must be under docs/qa-evidence`);
  }
  const manifestDate = qaEvidenceDateFromPath(manifestPath, root);
  if (!manifestDate) {
    problems.push(`${evidencePath} manifestPath must be under docs/qa-evidence/<date>/`);
  } else if (expectedDate && manifestDate !== expectedDate) {
    problems.push(`${evidencePath} manifestPath date must match evidence date ${expectedDate}`);
  }
  const resolvedManifestPath = resolveRepoPath(root, manifestPath);
  if (!resolvedManifestPath) {
    problems.push(`${evidencePath} manifestPath must be repository-relative`);
    return problems;
  }
  if (!fs.existsSync(resolvedManifestPath)) {
    problems.push(`${evidencePath} manifestPath does not exist: ${manifestPath}`);
    return problems;
  }

  const expectedManifestSha = String(entry.manifestSha256 || entry.evidenceManifestSha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/i.test(expectedManifestSha)) {
    problems.push(`${evidencePath} manifestSha256 must be 64-hex`);
  } else {
    const actualManifestSha = sha256File(resolvedManifestPath);
    if (actualManifestSha !== expectedManifestSha) {
      problems.push(`${evidencePath} manifestSha256 mismatch: expected ${expectedManifestSha}, got ${actualManifestSha}`);
    }
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, "utf8"));
    if (manifest.helperOnly !== false) {
      problems.push(`${evidencePath} manifest helperOnly must be false`);
    }
    if (manifest.artifactPurpose !== expectedPurpose) {
      problems.push(`${evidencePath} manifest artifactPurpose must be ${expectedPurpose}`);
    }
    const identity = githubEvidenceIdentity(evidencePath);
    if (identity?.sourceRunId && String(manifest.sourceRunId ?? "") !== identity.sourceRunId) {
      problems.push(`${evidencePath} manifest sourceRunId must match URL run ${identity.sourceRunId}`);
    }
    if (identity?.sourceArtifactId && String(manifest.sourceArtifactId ?? "") !== identity.sourceArtifactId) {
      problems.push(`${evidencePath} manifest sourceArtifactId must match URL artifact ${identity.sourceArtifactId}`);
    }
  } catch (error) {
    problems.push(`${evidencePath} manifest JSON is invalid: ${error.message}`);
  }
  return problems;
}

function analyzeExternalEvidenceInventory({
  inventory,
  inventoryPath = null,
  qaText,
  packet = null,
  packetPath = null,
  root = process.cwd(),
  scaffold = false,
  qaPath = null,
  requireGitIntegrity = false,
}) {
  const problems = [];
  if (inventory?.schemaVersion !== SCHEMA_VERSION) problems.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (weakValue(inventory?.reviewer)) problems.push("inventory reviewer must be concrete");
  if (!isIsoTimestamp(inventory?.reviewedAt)) problems.push("inventory reviewedAt must be ISO timestamp");
  if (!Array.isArray(inventory?.entries)) problems.push("inventory entries must be an array");
  problems.push(...reviewedInventoryPathProblems(inventoryPath, { root, scaffold }));
  problems.push(...reviewedPacketPathProblems(packetPath, root, { scaffold }));
  problems.push(...inventoryPacketDateProblems({ inventoryPath, packetPath, root }));

  const required = collectRequiredEvidence({ qaText, packet, root });
  const inventoryDate = qaEvidenceDateFromPath(
    inventoryPath,
    root,
    /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/external-evidence-inventory\.json$/i,
  );
  const productJourneyManifestPath = normalizeKey(packet?.target?.productJourneyManifestPath);
  problems.push(...productJourneyManifestExpansionProblems({
    root,
    manifestPath: productJourneyManifestPath,
  }));
  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
  const entryByPath = new Map();
  for (const entry of entries) {
    const key = normalizeKey(entry.evidencePath);
    if (!key) continue;
    if (entryByPath.has(key)) {
      problems.push(`${key} has duplicate inventory entries`);
    } else {
      entryByPath.set(key, entry);
    }
  }

  const requiredEvidencePaths = new Set(required.map((entry) => normalizeKey(entry.evidencePath)).filter(Boolean));
  for (const requiredEntry of required) {
    const entry = entryByPath.get(requiredEntry.evidencePath);
    if (!entry) {
      problems.push(`${requiredEntry.source} ${requiredEntry.qaRowId ?? requiredEntry.packetId} is missing inventory entry for ${requiredEntry.evidencePath}`);
      continue;
    }
    problems.push(...inventoryEntryProblems(entry, requiredEntry, root, inventoryDate));
  }

  for (const entry of entries) {
    const key = normalizeKey(entry.evidencePath);
    const isPrimaryRequiredEntry = key && requiredEvidencePaths.has(key) && entryByPath.get(key) === entry;
    if (!isPrimaryRequiredEntry) {
      problems.push(...inventoryEntryProblems(entry, null, root, inventoryDate));
    }
  }

  if (requireGitIntegrity) {
    problems.push(...inventoryGitIntegrityProblems(root, localReplayPathsFromInventory(inventory, {
      inventoryPath,
      qaPath,
      packetPath,
      root,
    })));
  }

  return {
    ok: problems.length === 0,
    status: problems.length === 0 ? "pass" : "fail",
    gitIntegrityRequired: Boolean(requireGitIntegrity),
    checkedRequiredEvidence: required.length,
    checkedInventoryEntries: entries.length,
    problems,
  };
}

function buildExternalEvidenceInventoryScaffold({
  qaText,
  packet = null,
  root = process.cwd(),
  reviewer = "_pending_",
  reviewedAt = "_pending_",
  evidenceDate = null,
} = {}) {
  const required = collectRequiredEvidence({ qaText, packet, root });
  const entriesByPath = new Map();

  for (const requiredEntry of required) {
    const evidencePath = normalizeKey(requiredEntry.evidencePath);
    if (!entriesByPath.has(evidencePath)) {
      const entry = {
        evidencePath,
        status: "pending",
        reviewer,
        reviewedAt,
        pathKind: pathKind(evidencePath),
        sourceRefs: [],
      };
      hydrateScaffoldEntry(entry, requiredEntry, root, evidenceDate);
      entriesByPath.set(evidencePath, entry);
    }
    entriesByPath.get(evidencePath).sourceRefs.push(scaffoldSourceRef(requiredEntry));
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    reviewer,
    reviewedAt,
    generatedAt: new Date().toISOString(),
    entries: Array.from(entriesByPath.values()),
  };
}

function hydrateScaffoldEntry(entry, requiredEntry, root, scaffoldEvidenceDate = null) {
  const kind = pathKind(entry.evidencePath);
  if (kind === "local") {
    const localPath = resolveRepoPath(root, entry.evidencePath);
    if (localPath && fs.existsSync(localPath)) {
      entry.sha256 = sha256File(localPath);
    } else {
      entry.sha256 = "_pending_";
      entry.missingLocalFile = true;
    }
  } else if (kind !== "unsupported" && kind !== "unsupported-url") {
    const identity = githubEvidenceIdentity(entry.evidencePath);
    entry.downloadedPath = suggestedExternalReplayPath(
      entry.evidencePath,
      scaffoldEvidenceDate ?? requiredEntry.evidenceDate,
    ) ?? "_pending_";
    entry.sha256 = "_pending_";
    if (identity?.sourceRunId) entry.sourceRunId = identity.sourceRunId;
    if (identity?.sourceArtifactId) entry.sourceArtifactId = identity.sourceArtifactId;
  } else {
    entry.sha256 = "_pending_";
  }

  if (requiredEntry.expectedPurpose) {
    entry.artifactPurpose = requiredEntry.expectedPurpose;
    entry.helperOnly = "_pending_";
    if (requiredEntry.source === "product-journey") {
      entry.journeyEntryId = requiredEntry.packetId;
      entry.productJourneyExpectedSha256Field = requiredEntry.expectedSha256Field || "_pending_";
      entry.productJourneyExpectedSha256 = requiredEntry.expectedSha256 || "_pending_";
      if (requiredEntry.expectedSourceRunId) {
        entry.productJourneySourceRunId = requiredEntry.expectedSourceRunId;
      }
      if (requiredEntry.expectedSourceArtifactId) {
        entry.productJourneySourceArtifactId = requiredEntry.expectedSourceArtifactId;
      }
    } else if (requiredEntry.source === "product-journey-fixture") {
      entry.fixtureManifestSha256 = requiredEntry.expectedSha256 || "_pending_";
    } else {
      entry.manifestPath = "_pending_";
      entry.manifestSha256 = "_pending_";
    }
  }
}

function scaffoldSourceRef(requiredEntry) {
  const ref = {
    source: requiredEntry.source,
  };
  if (requiredEntry.qaRowId) ref.qaRowId = requiredEntry.qaRowId;
  if (requiredEntry.platform) ref.platform = requiredEntry.platform;
  if (requiredEntry.route) ref.route = requiredEntry.route;
  if (requiredEntry.packetId) ref.packetId = requiredEntry.packetId;
  if (requiredEntry.packetType) ref.packetType = requiredEntry.packetType;
  if (requiredEntry.evidenceDate) ref.evidenceDate = requiredEntry.evidenceDate;
  if (requiredEntry.expectedPurpose) ref.expectedPurpose = requiredEntry.expectedPurpose;
  if (requiredEntry.expectedSha256) ref.expectedSha256 = requiredEntry.expectedSha256;
  if (requiredEntry.expectedSha256Field) ref.expectedSha256Field = requiredEntry.expectedSha256Field;
  if (requiredEntry.expectedSourceRunId) ref.expectedSourceRunId = requiredEntry.expectedSourceRunId;
  if (requiredEntry.expectedSourceArtifactId) ref.expectedSourceArtifactId = requiredEntry.expectedSourceArtifactId;
  return ref;
}

function writeExternalEvidenceInventoryScaffold({
  inventoryPath,
  qaText,
  packet = null,
  root = process.cwd(),
  reviewer = "_pending_",
  reviewedAt = "_pending_",
  force = false,
}) {
  const outputPath = path.resolve(root, inventoryPath);
  if (fs.existsSync(outputPath) && !force) {
    throw new Error(`${normalizeSlash(inventoryPath)} already exists; use --force to overwrite the scaffold`);
  }
  const inventory = buildExternalEvidenceInventoryScaffold({
    qaText,
    packet,
    root,
    reviewer,
    reviewedAt,
    evidenceDate: qaEvidenceDateFromPath(
      inventoryPath,
      root,
      /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/external-evidence-inventory(?:-scaffold)?\.json$/i,
    ),
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
  return {
    inventory,
    outputPath: normalizeSlash(inventoryPath),
  };
}

function main() {
  try {
    const options = parseArgs();
    const root = path.resolve(options.root);
    const missingPacketPathProblems = requiredReplayPacketPathProblems(options);
    if (missingPacketPathProblems.length > 0) {
      console.log(JSON.stringify({
        checkedAt: new Date().toISOString(),
        inventoryPath: normalizeSlash(options.inventoryPath),
        qaPath: normalizeSlash(options.qaPath),
        packetPath: null,
        status: "fail",
        ok: false,
        problems: missingPacketPathProblems,
      }, null, 2));
      process.exitCode = 1;
      return;
    }

    const qaText = fs.readFileSync(path.resolve(root, options.qaPath), "utf8");
    const packetPathProblems = reviewedPacketPathProblems(options.packetPath, root, {
      scaffold: options.scaffold,
    });
    if (packetPathProblems.length > 0) {
      console.log(JSON.stringify({
        checkedAt: new Date().toISOString(),
        inventoryPath: normalizeSlash(options.inventoryPath),
        qaPath: normalizeSlash(options.qaPath),
        packetPath: options.packetPath ? normalizeSlash(options.packetPath) : null,
        status: "fail",
        ok: false,
        problems: packetPathProblems,
      }, null, 2));
      process.exitCode = 1;
      return;
    }

    const packet = options.packetPath
      ? JSON.parse(fs.readFileSync(path.resolve(root, options.packetPath), "utf8"))
      : null;

    if (options.scaffold) {
      const { inventory, outputPath } = writeExternalEvidenceInventoryScaffold({
        inventoryPath: options.inventoryPath,
        qaText,
        packet,
        root,
        reviewer: options.reviewer,
        reviewedAt: options.reviewedAt,
        force: options.force,
      });
      console.log(JSON.stringify({
        checkedAt: new Date().toISOString(),
        status: "scaffolded",
        ok: true,
        outputPath,
        qaPath: normalizeSlash(options.qaPath),
        packetPath: options.packetPath ? normalizeSlash(options.packetPath) : null,
        checkedRequiredEvidence: collectRequiredEvidence({ qaText, packet, root }).length,
        checkedInventoryEntries: inventory.entries.length,
      }, null, 2));
      return;
    }

    const inventory = JSON.parse(fs.readFileSync(path.resolve(root, options.inventoryPath), "utf8"));
    const result = analyzeExternalEvidenceInventory({
      inventory,
      inventoryPath: options.inventoryPath,
      qaText,
      packet,
      packetPath: options.packetPath,
      root,
      scaffold: options.scaffold,
      qaPath: options.qaPath,
      requireGitIntegrity: options.requireGitIntegrity,
    });
    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(),
      inventoryPath: normalizeSlash(options.inventoryPath),
      qaPath: normalizeSlash(options.qaPath),
      packetPath: options.packetPath ? normalizeSlash(options.packetPath) : null,
      gitIntegrityRequired: options.requireGitIntegrity,
      ...result,
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  SCHEMA_VERSION,
  analyzeExternalEvidenceInventory,
  buildExternalEvidenceInventoryScaffold,
  collectRequiredEvidence,
  evidenceCandidates,
  inventoryPacketDateProblems,
  inventoryGitIntegrityProblems,
  localReplayPathsFromInventory,
  parseArgs,
  repoRelativePath,
  requiredReplayPacketPathProblems,
  reviewedInventoryPathProblems,
  reviewedPacketPathProblems,
  writeExternalEvidenceInventoryScaffold,
};
