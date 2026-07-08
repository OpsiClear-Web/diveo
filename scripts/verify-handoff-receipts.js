#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { trackedCleanPathProblems } = require("./git-integrity.js");

const SCHEMA_VERSION = "handoff-receipts/v1";
const OWNER_RECEIPT_SCHEMA_VERSION = "handoff-owner-assignment/v1";
const FIXTURE_MANIFEST_SCHEMA_VERSION = "fixture-manifest/v1";
const HOST_READY_SCHEMA_VERSION = "gsav-host-ready/v2";

const TRUSTED_EVIDENCE_REPOSITORIES = [
  "opsiclear/diveo",
  "opsiclear-web/diveo",
  "opsiclear/gsav-hosting",
];

const OWNER_FIELDS = [
  ["android", "Android validation owner"],
  ["ios", "iOS validation owner"],
  ["iosExecutor", "iOS validation executor"],
  ["gsavHost", "GSAV host owner"],
  ["releaseTooling", "release tooling owner"],
  ["evidenceReviewer", "evidence reviewer"],
  ["nativeRelease", "native release owner"],
];

const EMBEDDED_FIXTURE_ROUTES = [
  "/explore",
  "/gsav-diagnostics",
  "/watch/test",
  "/gsav/test?t=2.5",
];

const REQUIRED_RANGE_EXPOSED_HEADERS = [
  "accept-ranges",
  "content-length",
  "content-range",
  "etag",
];
const PREPARATION_RECEIPT_BASENAME_PATTERN = /(?:^|[._-])(?:template|example|pending|scaffold|candidate)(?:[._-]|$)/i;

function defaultDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const date = env.EVIDENCE_DATE || defaultDate();
  const options = {
    root: process.cwd(),
    date,
    allowPending: false,
    ownerReceiptPath: `docs/qa-evidence/${date}/owner-assignment.json`,
    fixtureManifestPath: `docs/qa-evidence/${date}/fixture-manifest.json`,
    hostReadyPath: `docs/qa-evidence/${date}/gsav-host-ready.json`,
    writeTemplateDir: null,
    outputPath: null,
    requireGitIntegrity: false,
  };
  const explicitlyProvidedReceiptPaths = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-pending") {
      options.allowPending = true;
    } else if (arg === "--require-git-integrity") {
      options.requireGitIntegrity = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a non-empty value.`);
      if (!(key in options)) throw new Error(usage());
      options[key] = value;
      if (["ownerReceiptPath", "fixtureManifestPath", "hostReadyPath"].includes(key)) {
        explicitlyProvidedReceiptPaths.add(key);
      }
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!validIsoDate(options.date)) throw new Error("--date must be YYYY-MM-DD.");
  if (!explicitlyProvidedReceiptPaths.has("ownerReceiptPath")) {
    options.ownerReceiptPath = `docs/qa-evidence/${options.date}/owner-assignment.json`;
  }
  if (!explicitlyProvidedReceiptPaths.has("fixtureManifestPath")) {
    options.fixtureManifestPath = `docs/qa-evidence/${options.date}/fixture-manifest.json`;
  }
  if (!explicitlyProvidedReceiptPaths.has("hostReadyPath")) {
    options.hostReadyPath = `docs/qa-evidence/${options.date}/gsav-host-ready.json`;
  }
  return options;
}

function usage() {
  return "Usage: node scripts/verify-handoff-receipts.js [--date <YYYY-MM-DD>] [--owner-receipt-path <path>] [--fixture-manifest-path <path>] [--host-ready-path <path>] [--output-path <path>] [--write-template-dir <dir>] [--allow-pending] [--require-git-integrity]";
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isoTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function normalizeSlash(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function absoluteOrUrlPath(value) {
  const normalized = normalizeSlash(value);
  return path.isAbsolute(normalized)
    || /^[a-z][a-z0-9+.-]*:/i.test(normalized)
    || /^\/\/[^/]/.test(normalized);
}

function weakValue(value) {
  const text = String(value ?? "").trim();
  return !text || /^(?:<.*>|owner|reviewer|release owner|native release owner|todo|tbd|pending|unknown|placeholder|example)$/i.test(text);
}

function concrete(value) {
  return !weakValue(value) && !/\b(?:pending|placeholder|example|unknown|todo|tbd)\b/i.test(String(value ?? ""));
}

const REDACTION_NOTE_PATTERN = /(?:account[- ]safe|redact(?:ed|ion)?|anonymized|pseudonym)/i;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const URL_CREDENTIAL_PATTERN = /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@/i;
const ACCOUNT_IDENTIFIER_PATTERN = /\b(?:account|user|customer|member|profile)[_-]?id\s*[:=]\s*[A-Za-z0-9._-]{6,}\b/i;
const TOKEN_ASSIGNMENT_PATTERN = /\b(?:access|refresh|id|session)[_-]?token\s*[:=]\s*[A-Za-z0-9._~+/=-]{8,}\b/i;
const SECRET_SHAPE_PATTERNS = [
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{16,}\b/],
  ["GitHub token", /\b(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["Supabase service key", /\bsbp_[A-Za-z0-9_-]{16,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/],
];

function redactedOrPlaceholder(value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (/^<[^>]+>$/.test(text)) return true;
  if (/^(?:fixture[-_\s])?(?:account[-_\s])?(?:redacted|anonymous|anonymized|pseudonym|placeholder)(?:[-_\s](?:account|user|id|fixture|value))*$/i.test(text)) {
    return true;
  }
  return /^(?:account[- ]safe|account identifiers redacted|redacted account identifiers|redacted)$/i.test(text);
}

function unredactedEmailDomains(value) {
  const domains = [];
  for (const match of String(value ?? "").matchAll(EMAIL_PATTERN)) {
    const domain = String(match[1] ?? "").toLowerCase();
    if (domain === "example.com" || domain === "example.org" || domain === "example.net") continue;
    domains.push(domain);
  }
  return domains;
}

function fixtureManifestSecretProblems(label, value) {
  const text = String(value ?? "");
  const problems = [];
  for (const [secretLabel, pattern] of SECRET_SHAPE_PATTERNS) {
    if (pattern.test(text) && !redactedOrPlaceholder(text)) {
      problems.push(`fixture manifest ${label} contains ${secretLabel}`);
    }
  }
  if (TOKEN_ASSIGNMENT_PATTERN.test(text) && !redactedOrPlaceholder(text)) {
    problems.push(`fixture manifest ${label} contains raw auth token assignment`);
  }
  if (URL_CREDENTIAL_PATTERN.test(text)) {
    problems.push(`fixture manifest ${label} contains URL credentials`);
  }
  const emailDomains = unredactedEmailDomains(text);
  if (emailDomains.length > 0 && !redactedOrPlaceholder(text)) {
    problems.push(`fixture manifest ${label} contains unredacted email domain ${Array.from(new Set(emailDomains)).join(", ")}`);
  }
  if (ACCOUNT_IDENTIFIER_PATTERN.test(text) && !redactedOrPlaceholder(text)) {
    problems.push(`fixture manifest ${label} contains raw account identifier`);
  }
  if (/account|user|customer|member|profile/i.test(label) && UUID_PATTERN.test(text) && !redactedOrPlaceholder(text)) {
    problems.push(`fixture manifest ${label} contains raw account UUID`);
  }
  return problems;
}

function collectStringFields(value, prefix = "") {
  if (typeof value === "string") return [[prefix, value]];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStringFields(entry, `${prefix}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, entry]) => (
    collectStringFields(entry, prefix ? `${prefix}.${key}` : key)
  ));
}

function nonLocalHttpsUrl(value, { mustEndWithGsav = false } = {}) {
  try {
    const parsed = new URL(String(value ?? "").trim());
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (parsed.protocol !== "https:") return false;
    if (host === "localhost" || host === "::1" || /^(?:127|10|192\.168|169\.254)\./.test(host)) return false;
    const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
    if (ipv4) {
      const first = Number(ipv4[1]);
      const second = Number(ipv4[2]);
      if (first === 172 && second >= 16 && second <= 31) return false;
      if (first === 100 && second >= 64 && second <= 127) return false;
    }
    if (/^(?:fc|fd|fe80:)/i.test(host)) return false;
    if (mustEndWithGsav && !parsed.pathname.toLowerCase().endsWith(".gsav")) return false;
    return true;
  } catch {
    return false;
  }
}

function urlOrigin(value) {
  try {
    return new URL(String(value ?? "").trim()).origin;
  } catch {
    return null;
  }
}

function urlPathname(value) {
  try {
    return new URL(String(value ?? "").trim()).pathname;
  } catch {
    return null;
  }
}

function queryParamValues(value, paramName) {
  try {
    return new URL(String(value ?? "").trim()).searchParams.getAll(paramName);
  } catch {
    return [];
  }
}

function hasExactlyOneQueryParam(value, paramName, expectedValue) {
  const values = queryParamValues(value, paramName);
  return values.length === 1 && values[0] === expectedValue;
}

function singlePathSegment(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && !/[/?#]/.test(text);
}

function trustedGithubEvidenceUrl(value) {
  try {
    const parsed = new URL(String(value ?? "").trim());
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return false;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const repository = parts.slice(0, 2).join("/").toLowerCase();
    if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) return false;
    const rest = parts.slice(2).join("/");
    return /^actions\/runs\/\d+(?:\/artifacts\/[^/]+)?$/i.test(rest)
      || /^releases\/download\/[^/]+\/[^/]+$/i.test(rest)
      || /^blob\/[^/]+\/docs\/qa-evidence\/.+/i.test(rest);
  } catch {
    return false;
  }
}

function evidenceReferenceProblem(value, root) {
  const raw = String(value ?? "").trim();
  if (!raw) return "evidence reference is empty";
  if (/^https?:\/\//i.test(raw)) {
    return trustedGithubEvidenceUrl(raw) ? null : "evidence URL must be trusted GitHub evidence";
  }
  if (/^file:\/\//i.test(raw) || path.isAbsolute(raw)) return "evidence reference must be repository-relative";
  const normalized = normalizeSlash(raw);
  if (!normalized.startsWith("docs/qa-evidence/") && !normalized.startsWith("release-evidence/")) {
    return "evidence reference must be under docs/qa-evidence, release-evidence, or trusted GitHub evidence";
  }
  if (normalized.startsWith("docs/qa-evidence/") && !fs.existsSync(path.join(root, normalized))) {
    return "local docs/qa-evidence reference does not exist";
  }
  return null;
}

function evidenceReferenceDateProblem(value, date) {
  const normalized = normalizeSlash(value);
  if (!normalized.startsWith("docs/qa-evidence/")) return null;
  if (!normalized.startsWith(`docs/qa-evidence/${date}/`)) {
    return `local docs/qa-evidence reference must be under docs/qa-evidence/${date}/`;
  }
  return null;
}

function receiptPathLifecycleProblem(root, relativePath) {
  const normalized = normalizeSlash(relativePath);
  if (!normalized) return "receipt path is empty";
  if (absoluteOrUrlPath(normalized)) {
    return "receipt path must be repository-relative";
  }
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, normalized);
  const relative = path.relative(absoluteRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return "receipt path must stay inside the repository root";
  }
  if (path.extname(normalized).toLowerCase() !== ".json") {
    return "receipt path must be a JSON file";
  }
  const basename = path.basename(normalized);
  if (PREPARATION_RECEIPT_BASENAME_PATTERN.test(basename)) {
    return "receipt path basename must not contain template, example, pending, scaffold, or candidate";
  }
  return null;
}

function receiptGitIntegrityBlockers(root, receiptPaths) {
  const normalizedPaths = receiptPaths
    .map(normalizeSlash)
    .filter(Boolean);
  if (normalizedPaths.length === 0) return [];

  return trackedCleanPathProblems(root, normalizedPaths, {
    insideRepositoryMessage: (receiptPath) => `handoff receipt must be inside the repository before final readiness: ${receiptPath}`,
    untrackedMessage: (receiptPath) => `handoff receipt must be tracked in git before final readiness: ${receiptPath}`,
    dirtyMessage: (status) => `handoff receipt files must be committed before final readiness: ${status}`,
    noGitMessage: () => "handoff receipt files must be checked in a git workspace before final readiness.",
  }).map((reason) => ({
      id: "receipt-git-integrity",
      kind: "invalid",
      path: normalizedPaths.join(", "),
      reason,
      nextAction: reason.includes("tracked in git")
        ? "Commit reviewed handoff receipt JSON before running final readiness."
        : reason.includes("checked in a git workspace")
          ? "Run final readiness from a git checkout with committed handoff receipts."
          : "Commit or revert local handoff receipt edits before running final readiness.",
    }));
}

function readJsonReceipt(root, relativePath, id, label) {
  const normalizedPath = normalizeSlash(relativePath);
  const lifecycleProblem = receiptPathLifecycleProblem(root, normalizedPath);
  if (lifecycleProblem) {
    return {
      value: null,
      blockers: [{
        id,
        kind: "invalid",
        path: normalizedPath,
        reason: `${label} ${lifecycleProblem}`,
        nextAction: `Move completed receipt evidence to the required non-template JSON path before promotion.`,
      }],
    };
  }
  const fullPath = path.resolve(root, normalizedPath);
  if (!fs.existsSync(fullPath)) {
    return {
      value: null,
      blockers: [{
        id,
        kind: "missing",
        path: normalizedPath,
        reason: `${label} is missing`,
        nextAction: `Create ${normalizedPath} before promoting G3/G6 evidence.`,
      }],
    };
  }
  try {
    return {
      value: JSON.parse(fs.readFileSync(fullPath, "utf8")),
      blockers: [],
    };
  } catch (error) {
    return {
      value: null,
      blockers: [{
        id,
        kind: "invalid",
        path: normalizedPath,
        reason: `${label} is not valid JSON: ${error.message}`,
        nextAction: `Fix ${normalizedPath}.`,
      }],
    };
  }
}

function validationBlockers(id, pathValue, problems) {
  return problems.map((reason) => ({
    id,
    kind: "invalid",
    path: normalizeSlash(pathValue),
    reason,
    nextAction: `Update ${normalizeSlash(pathValue)} with the required handoff fields.`,
  }));
}

function validateReviewedHeader(receipt, label) {
  const problems = [];
  if (!concrete(receipt?.reviewer)) problems.push(`${label} must include a concrete reviewer`);
  if (!isoTimestamp(receipt?.reviewedAt)) problems.push(`${label} must include reviewedAt ISO timestamp`);
  return problems;
}

function validateOwnerReceipt(receipt) {
  const problems = [];
  if (receipt?.schemaVersion !== OWNER_RECEIPT_SCHEMA_VERSION) {
    problems.push(`owner assignment receipt must use schemaVersion=${OWNER_RECEIPT_SCHEMA_VERSION}`);
  }
  problems.push(...validateReviewedHeader(receipt, "owner assignment receipt"));
  for (const [key, label] of OWNER_FIELDS) {
    if (!concrete(receipt?.owners?.[key])) {
      problems.push(`owner assignment receipt must include concrete ${label} at owners.${key}`);
    }
  }
  return problems;
}

function validateFixtureManifest(manifest, { date }) {
  const problems = [];
  if (manifest?.schemaVersion !== FIXTURE_MANIFEST_SCHEMA_VERSION) {
    problems.push(`fixture manifest must use schemaVersion=${FIXTURE_MANIFEST_SCHEMA_VERSION}`);
  }
  if (manifest?.evidenceDate !== date) {
    problems.push(`fixture manifest evidenceDate must be ${date}`);
  }
  if (!nonLocalHttpsUrl(manifest?.gsavHostUrl)) {
    problems.push("fixture manifest must include non-local HTTPS gsavHostUrl");
  }
  if (!concrete(manifest?.gsavHostingCommit)) {
    problems.push("fixture manifest must include concrete gsavHostingCommit");
  }
  for (const [key, label] of [
    ["fixtureAccountAlias", "redacted fixture account alias"],
    ["resetCommand", "fixture reset command"],
    ["searchQuery", "search query"],
    ["creatorHandle", "creator handle"],
    ["savedFollowPreset", "saved/follow preset"],
    ["redactionNotes", "redaction notes"],
  ]) {
    if (!concrete(manifest?.[key])) problems.push(`fixture manifest must include ${label}`);
  }
  if (!REDACTION_NOTE_PATTERN.test(String(manifest?.redactionNotes ?? ""))) {
    problems.push("fixture manifest redactionNotes must describe account-safe redaction");
  }
  for (const [fieldPath, value] of collectStringFields(manifest)) {
    problems.push(...fixtureManifestSecretProblems(fieldPath, value));
  }
  for (const [key, label] of [
    ["watchTest", "/watch/test scene id"],
    ["aliasStartTime", "/gsav/test?t=2.5 alias scene id"],
  ]) {
    if (!concrete(manifest?.sceneIds?.[key])) {
      problems.push(`fixture manifest must include ${label} at sceneIds.${key}`);
    } else if (!singlePathSegment(manifest.sceneIds[key])) {
      problems.push(`fixture manifest sceneIds.${key} must be a single URL path segment`);
    }
  }
  for (const [key, label] of [
    ["emptyState", "expected empty state"],
    ["errorState", "expected error state"],
  ]) {
    if (!concrete(manifest?.expectedStates?.[key])) problems.push(`fixture manifest must include ${label} at expectedStates.${key}`);
  }
  for (const route of EMBEDDED_FIXTURE_ROUTES) {
    const value = manifest?.expectedFinalEmbeddedUrls?.[route];
    if (!nonLocalHttpsUrl(value)) {
      problems.push(`fixture manifest expectedFinalEmbeddedUrls.${route} must be a non-local HTTPS URL`);
    }
    if (!hasExactlyOneQueryParam(value, "embed", "native")) {
      problems.push(`fixture manifest expectedFinalEmbeddedUrls.${route} must contain exactly one embed=native`);
    }
    if (urlOrigin(value) && urlOrigin(manifest?.gsavHostUrl) && urlOrigin(value) !== urlOrigin(manifest.gsavHostUrl)) {
      problems.push(`fixture manifest expectedFinalEmbeddedUrls.${route} must share gsavHostUrl origin`);
    }
  }
  const exploreUrl = manifest?.expectedFinalEmbeddedUrls?.["/explore"];
  if (exploreUrl && !hasExactlyOneQueryParam(exploreUrl, "dataSaver", "1")) {
    problems.push("fixture manifest expectedFinalEmbeddedUrls./explore must contain exactly one dataSaver=1");
  }
  const expectedFixturePaths = {
    "/explore": "/explore",
    "/gsav-diagnostics": "/native-diagnostics",
    "/watch/test": singlePathSegment(manifest?.sceneIds?.watchTest)
      ? `/watch/${manifest.sceneIds.watchTest}`
      : null,
    "/gsav/test?t=2.5": singlePathSegment(manifest?.sceneIds?.aliasStartTime)
      ? `/watch/${manifest.sceneIds.aliasStartTime}`
      : null,
  };
  for (const [route, expectedPath] of Object.entries(expectedFixturePaths)) {
    const value = manifest?.expectedFinalEmbeddedUrls?.[route];
    const observedPath = urlPathname(value);
    if (expectedPath && observedPath && observedPath !== expectedPath) {
      problems.push(`fixture manifest expectedFinalEmbeddedUrls.${route} must use hosted path ${expectedPath}`);
    }
  }
  const aliasUrl = manifest?.expectedFinalEmbeddedUrls?.["/gsav/test?t=2.5"];
  if (aliasUrl && !/[?&]t=2\.5(?:&|$)/.test(String(aliasUrl))) {
    problems.push("fixture manifest /gsav/test?t=2.5 expected URL must preserve t=2.5");
  }
  return problems;
}

function validateCrossReceiptContract(fixture, hostReady) {
  const problems = [];
  if (!fixture || !hostReady) return problems;
  const fixtureOrigin = urlOrigin(fixture.gsavHostUrl);
  const hostOrigin = urlOrigin(hostReady.gsavHostUrl);
  if (fixtureOrigin && hostOrigin && fixtureOrigin !== hostOrigin) {
    problems.push("fixture manifest gsavHostUrl origin must match host-ready gsavHostUrl origin");
  }
  if (concrete(fixture.gsavHostingCommit) && concrete(hostReady.gsavHostingCommit) && fixture.gsavHostingCommit !== hostReady.gsavHostingCommit) {
    problems.push("fixture manifest gsavHostingCommit must match host-ready gsavHostingCommit");
  }
  if (concrete(fixture.gsavHostingCommit) && concrete(hostReady.observedIdentity) && fixture.gsavHostingCommit !== hostReady.observedIdentity) {
    problems.push("fixture manifest gsavHostingCommit must match host-ready observedIdentity");
  }
  return problems;
}

function validateHostReadyReceipt(receipt, { root, date }) {
  const problems = [];
  if (receipt?.schemaVersion !== HOST_READY_SCHEMA_VERSION) {
    problems.push(`host-ready receipt must use schemaVersion=${HOST_READY_SCHEMA_VERSION}`);
  }
  if (receipt?.evidenceDate !== date) {
    problems.push(`host-ready receipt evidenceDate must be ${date}`);
  }
  problems.push(...validateReviewedHeader(receipt, "host-ready receipt"));
  if (!concrete(receipt?.gsavHostingCommit)) problems.push("host-ready receipt must include GSAV_HOSTING_COMMIT as gsavHostingCommit");
  if (!nonLocalHttpsUrl(receipt?.gsavHostUrl)) problems.push("host-ready receipt must include non-local HTTPS gsavHostUrl");
  if (!nonLocalHttpsUrl(receipt?.gsavHostIdentityUrl)) problems.push("host-ready receipt must include non-local HTTPS gsavHostIdentityUrl");
  const hostOrigin = urlOrigin(receipt?.gsavHostUrl);
  const identityOrigin = urlOrigin(receipt?.gsavHostIdentityUrl);
  if (hostOrigin && identityOrigin && hostOrigin !== identityOrigin) {
    problems.push("host-ready receipt gsavHostIdentityUrl must share gsavHostUrl origin");
  }
  if (!concrete(receipt?.observedIdentity)) problems.push("host-ready receipt must include observedIdentity");
  if (concrete(receipt?.gsavHostingCommit) && concrete(receipt?.observedIdentity) && receipt.observedIdentity !== receipt.gsavHostingCommit) {
    problems.push("host-ready receipt observedIdentity must match gsavHostingCommit");
  }
  const routeGuardCommand = String(receipt?.routeGuardTest?.command ?? "");
  if (!concrete(routeGuardCommand)) {
    problems.push("host-ready receipt must include routeGuardTest.command");
  } else if (!/route[-:]?guard/i.test(routeGuardCommand) && !/native.*guard/i.test(routeGuardCommand)) {
    problems.push("host-ready receipt routeGuardTest.command must name the hosted native route guard test");
  }
  if (receipt?.routeGuardTest?.status !== "pass") problems.push("host-ready receipt routeGuardTest.status must be pass");
  for (const [key, label] of [
    ["routeGuardTest.outputPath", "route guard test output"],
    ["preflightOutputPath", "preflight output"],
    ["runtimeSmokeOutputPath", "runtime-smoke output"],
  ]) {
    const value = key.includes(".")
      ? key.split(".").reduce((current, part) => current?.[part], receipt)
      : receipt?.[key];
    const problem = evidenceReferenceProblem(value, root);
    if (problem) problems.push(`host-ready receipt ${label} ${problem}`);
    if (!problem) {
      const dateProblem = evidenceReferenceDateProblem(value, date);
      if (dateProblem) problems.push(`host-ready receipt ${label} ${dateProblem}`);
    }
  }
  if (!nonLocalHttpsUrl(receipt?.range?.url, { mustEndWithGsav: true })) {
    problems.push("host-ready receipt range.url must be a non-local HTTPS .gsav URL");
  }
  if (Number(receipt?.range?.status) !== 206) problems.push("host-ready receipt range.status must be 206");
  if (!/^bytes 0-0\/\d+$/i.test(String(receipt?.range?.contentRange ?? ""))) {
    problems.push("host-ready receipt range.contentRange must match bytes 0-0/<decimal-size>");
  }
  const allowOrigin = String(receipt?.range?.accessControlAllowOrigin ?? "").trim();
  if (allowOrigin !== "*" && (!hostOrigin || allowOrigin !== hostOrigin)) {
    problems.push("host-ready receipt range.accessControlAllowOrigin must be * or the gsavHostUrl origin");
  }
  const exposeHeaders = String(receipt?.range?.accessControlExposeHeaders ?? "").toLowerCase();
  for (const header of REQUIRED_RANGE_EXPOSED_HEADERS) {
    if (!exposeHeaders.includes(header)) {
      problems.push(`host-ready receipt range.accessControlExposeHeaders must expose ${header}`);
    }
  }
  if (!concrete(receipt?.bridge?.version)) problems.push("host-ready receipt must include bridge.version");
  if (!concrete(receipt?.bridge?.minVersion)) problems.push("host-ready receipt must include bridge.minVersion");
  return problems;
}

function templateOwnerReceipt() {
  return {
    schemaVersion: OWNER_RECEIPT_SCHEMA_VERSION,
    reviewer: "<evidence-reviewer>",
    reviewedAt: "<ISO timestamp>",
    owners: {
      android: "<android-validation-owner>",
      ios: "<ios-validation-owner>",
      iosExecutor: "<ios-executor-proof>",
      gsavHost: "<gsav-host-owner>",
      releaseTooling: "<release-tooling-owner>",
      evidenceReviewer: "<evidence-reviewer>",
      nativeRelease: "<native-release-owner>",
    },
  };
}

function templateFixtureManifest(date) {
  return {
    schemaVersion: FIXTURE_MANIFEST_SCHEMA_VERSION,
    evidenceDate: date,
    gsavHostUrl: "https://<production-gsav-host>",
    gsavHostingCommit: "<GSAV_HOSTING_COMMIT>",
    fixtureAccountAlias: "<redacted-fixture-account-alias>",
    resetCommand: "<fixture reset command>",
    searchQuery: "<search query>",
    creatorHandle: "<creator handle>",
    sceneIds: {
      watchTest: "<scene id for /watch/test>",
      aliasStartTime: "<scene id for /gsav/test?t=2.5>",
    },
    savedFollowPreset: "<saved/follow preset description>",
    expectedStates: {
      emptyState: "<expected empty state>",
      errorState: "<expected error state>",
    },
    expectedFinalEmbeddedUrls: {
      "/explore": "https://<production-gsav-host>/explore?embed=native&dataSaver=1",
      "/gsav-diagnostics": "https://<production-gsav-host>/native-diagnostics?embed=native",
      "/watch/test": "https://<production-gsav-host>/watch/<scene-id>?embed=native",
      "/gsav/test?t=2.5": "https://<production-gsav-host>/watch/<scene-id>?t=2.5&embed=native",
    },
    redactionNotes: "<redaction notes>",
  };
}

function templateHostReadyReceipt(date) {
  return {
    schemaVersion: HOST_READY_SCHEMA_VERSION,
    evidenceDate: date,
    reviewer: "<host-ready-reviewer>",
    reviewedAt: "<ISO timestamp>",
    gsavHostingCommit: "<GSAV_HOSTING_COMMIT>",
    gsavHostUrl: "https://<production-gsav-host>",
    gsavHostIdentityUrl: "https://<production-gsav-host>/<identity-path>",
    observedIdentity: "<GSAV_HOSTING_COMMIT>",
    routeGuardTest: {
      command: "<gsav-hosting native-route-guard command>",
      status: "pass",
      outputPath: `docs/qa-evidence/${date}/<route-guard-output>`,
    },
    preflightOutputPath: `docs/qa-evidence/${date}/<gsav-preflight-output>`,
    runtimeSmokeOutputPath: `docs/qa-evidence/${date}/<runtime-smoke-output>`,
    range: {
      url: "https://<production-cdn>/<fixture>.gsav",
      status: 206,
      contentRange: "bytes 0-0/<decimal-size>",
      accessControlAllowOrigin: "*",
      accessControlExposeHeaders: "Accept-Ranges, Content-Length, Content-Range, ETag",
    },
    bridge: {
      version: "<bridge-version>",
      minVersion: "<bridge-min-version>",
    },
  };
}

function ensureRootContained(root, relativePath, label) {
  const normalized = normalizeSlash(relativePath);
  if (!normalized || path.isAbsolute(normalized)) {
    throw new Error(`${label} must be repository-relative.`);
  }
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, normalized);
  const relative = path.relative(absoluteRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository root.`);
  }
  return { normalized, absolutePath };
}

function writeHandoffReceiptTemplates(options = {}) {
  const root = options.root ?? process.cwd();
  const date = options.date ?? defaultDate();
  if (!options.writeTemplateDir) {
    throw new Error("--write-template-dir is required to write handoff templates.");
  }
  const { normalized, absolutePath } = ensureRootContained(root, options.writeTemplateDir, "--write-template-dir");
  fs.mkdirSync(absolutePath, { recursive: true });
  const templates = [
    ["owner-assignment.template.json", templateOwnerReceipt()],
    ["fixture-manifest.template.json", templateFixtureManifest(date)],
    ["gsav-host-ready.template.json", templateHostReadyReceipt(date)],
  ];
  const files = templates.map(([filename, value]) => {
    const fullPath = path.join(absolutePath, filename);
    fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
    return normalizeSlash(path.join(normalized, filename));
  });
  return {
    directory: normalized,
    files,
    note: "Templates are preparation-only. Fill concrete values, rename to the required receipt paths, and rerun without --allow-pending before promotion.",
  };
}

function validateHandoffReceipts(options = {}) {
  const root = options.root ?? process.cwd();
  const date = options.date ?? defaultDate();
  const ownerPath = options.ownerReceiptPath ?? `docs/qa-evidence/${date}/owner-assignment.json`;
  const fixturePath = options.fixtureManifestPath ?? `docs/qa-evidence/${date}/fixture-manifest.json`;
  const hostPath = options.hostReadyPath ?? `docs/qa-evidence/${date}/gsav-host-ready.json`;
  const blockers = [];
  const checked = {};

  const owner = readJsonReceipt(root, ownerPath, "owner-assignment-receipt", "owner assignment receipt");
  blockers.push(...owner.blockers);
  if (owner.value) {
    const problems = validateOwnerReceipt(owner.value);
    blockers.push(...validationBlockers("owner-assignment-receipt", ownerPath, problems));
    checked.ownerAssignment = { path: normalizeSlash(ownerPath), status: problems.length === 0 ? "pass" : "fail" };
  } else {
    checked.ownerAssignment = { path: normalizeSlash(ownerPath), status: "missing" };
  }

  const fixture = readJsonReceipt(root, fixturePath, "fixture-manifest", "route fixture manifest");
  blockers.push(...fixture.blockers);
  if (fixture.value) {
    const problems = validateFixtureManifest(fixture.value, { date });
    blockers.push(...validationBlockers("fixture-manifest", fixturePath, problems));
    checked.fixtureManifest = { path: normalizeSlash(fixturePath), status: problems.length === 0 ? "pass" : "fail" };
  } else {
    checked.fixtureManifest = { path: normalizeSlash(fixturePath), status: "missing" };
  }

  const host = readJsonReceipt(root, hostPath, "gsav-host-ready-receipt", "GSAV host-ready receipt");
  blockers.push(...host.blockers);
  if (host.value) {
    const problems = validateHostReadyReceipt(host.value, { root, date });
    blockers.push(...validationBlockers("gsav-host-ready-receipt", hostPath, problems));
    checked.hostReady = { path: normalizeSlash(hostPath), status: problems.length === 0 ? "pass" : "fail" };
  } else {
    checked.hostReady = { path: normalizeSlash(hostPath), status: "missing" };
  }

  if (fixture.value && host.value) {
    const problems = validateCrossReceiptContract(fixture.value, host.value);
    blockers.push(...validationBlockers("fixture-manifest", fixturePath, problems));
    if (problems.length > 0 && checked.fixtureManifest) checked.fixtureManifest.status = "fail";
  }

  if (options.requireGitIntegrity === true) {
    blockers.push(...receiptGitIntegrityBlockers(root, [
      ownerPath,
      fixturePath,
      hostPath,
    ]));
  }

  const hasInvalid = blockers.some((blocker) => blocker.kind === "invalid");
  const status = blockers.length === 0 ? "pass" : hasInvalid ? "fail" : "blocked";
  return {
    schemaVersion: SCHEMA_VERSION,
    checkedAt: new Date().toISOString(),
    status,
    ok: status === "pass",
    evidenceDate: date,
    allowPending: Boolean(options.allowPending),
    gitIntegrityRequired: options.requireGitIntegrity === true,
    receiptPaths: {
      ownerReceiptPath: normalizeSlash(ownerPath),
      fixtureManifestPath: normalizeSlash(fixturePath),
      hostReadyPath: normalizeSlash(hostPath),
    },
    checked,
    blockers,
  };
}

function main() {
  let options;
  try {
    options = parseArgs();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  if (options.writeTemplateDir) {
    try {
      const templateOutput = writeHandoffReceiptTemplates(options);
      process.stdout.write(`${JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        checkedAt: new Date().toISOString(),
        status: "templates-written",
        ok: true,
        evidenceDate: options.date,
        templateOutput,
      }, null, 2)}\n`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
    return;
  }
  const result = validateHandoffReceipts(options);
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(options.root, options.outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(options.root, options.outputPath), output);
  }
  process.stdout.write(output);
  if (result.status === "fail" || (result.status === "blocked" && !options.allowPending)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  FIXTURE_MANIFEST_SCHEMA_VERSION,
  HOST_READY_SCHEMA_VERSION,
  OWNER_RECEIPT_SCHEMA_VERSION,
  SCHEMA_VERSION,
  collectStringFields,
  concrete,
  evidenceReferenceProblem,
  fixtureManifestSecretProblems,
  parseArgs,
  hasExactlyOneQueryParam,
  queryParamValues,
  redactedOrPlaceholder,
  singlePathSegment,
  unredactedEmailDomains,
  urlPathname,
  receiptGitIntegrityBlockers,
  receiptPathLifecycleProblem,
  trustedGithubEvidenceUrl,
  templateFixtureManifest,
  templateHostReadyReceipt,
  templateOwnerReceipt,
  validateCrossReceiptContract,
  validateFixtureManifest,
  validateHandoffReceipts,
  validateHostReadyReceipt,
  validateOwnerReceipt,
  writeHandoffReceiptTemplates,
};
