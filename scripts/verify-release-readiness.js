#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const {
  FINAL_FOCUSED_TESTS: FINAL_RECEIPT_FOCUSED_TESTS,
  FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV,
  FINAL_RECEIPT_EXPECTED_STEP_LABELS,
} = require("./final-readiness-receipt-contract");
const {
  validateReceipt: validateStackArchitectureReceipt,
} = require("./stack-architecture-receipt");

const REQUIRED_ROUTES = [
  "/",
  "/search",
  "/library",
  "/creator/:handle",
  "/explore",
  "/gsav-diagnostics",
  "/watch/test",
  "/gsav/test?t=2.5",
];

const REQUIRED_NEGATIVE_CASES = [
  "Missing host config",
  "Host offline/retry",
  "Cross-origin navigation",
  "Unsupported renderer",
  "Auth initialization gate",
  "Ended playback",
];

const RELEASE_IDENTITY_FILES = [
  "app.json",
  "package.json",
  "package-lock.json",
];
const ALLOWED_SIGNOFF_FILES = new Set([
  "docs/GSAV_NATIVE_QA.md",
  "docs/IMPLEMENTATION_VALIDATION_AUDIT.md",
]);
const ALLOWED_SIGNOFF_PREFIXES = [
  "docs/qa-evidence/",
];
const TRUSTED_RELEASE_REPOSITORIES = [
  "opsiclear/diveo",
  "opsiclear-web/diveo",
];
const TRUSTED_EVIDENCE_REPOSITORIES = [
  ...TRUSTED_RELEASE_REPOSITORIES,
  "opsiclear/gsav-hosting",
];
const DEFAULT_MAX_EVIDENCE_AGE_DAYS = 7;
const QA_EVIDENCE_PATH = "docs/GSAV_NATIVE_QA.md";
const AUDIT_EVIDENCE_PATH = "docs/IMPLEMENTATION_VALIDATION_AUDIT.md";
const DEVICE_PACKET_ENV = "DEVICE_EVIDENCE_PACKET_PATH";
const EXTERNAL_EVIDENCE_INVENTORY_ENV = "EXTERNAL_EVIDENCE_INVENTORY_PATH";
const STACK_ARCHITECTURE_RECEIPT_FILENAME = "stack-architecture-receipt.json";
const FINAL_RECEIPT_ALLOWED_READINESS_ENV_KEYS = new Set([
  EXTERNAL_EVIDENCE_INVENTORY_ENV,
  DEVICE_PACKET_ENV,
  "RELEASE_CANDIDATE_SHA",
  FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV,
]);
const DEFAULT_DEVICE_PACKET_SCRIPT_PATH = path.join(__dirname, "device-evidence-packet.js");
const DEFAULT_EXTERNAL_EVIDENCE_INVENTORY_SCRIPT_PATH = path.join(__dirname, "verify-external-evidence-inventory.js");
const EVIDENCE_LOG_COLUMNS = [
  "Date",
  "Platform",
  "Device/Emulator",
  "GSAV web URL",
  "diveo route",
  "Result",
  "Evidence path",
  "Notes",
];

const requiredEvidence = [
  {
    id: "JS runtime smoke",
    platform: "JS runtime smoke",
    route: "JS runtime smoke",
  },
  ...REQUIRED_ROUTES.flatMap((route) => [
    { id: `Android route ${route}`, platform: "Android", route },
    { id: `iOS route ${route}`, platform: "iOS", route },
  ]),
  ...REQUIRED_NEGATIVE_CASES.map((route) => ({
    id: `negative validation ${route}`,
    platform: "Android/iOS",
    route,
  })),
  {
    id: "Release validation prerequisites",
    platform: "Release validation prerequisites",
    route: "Validation prerequisites",
  },
  {
    id: "Android release APK artifact scan",
    platform: "Android release",
    route: "Release APK artifact",
  },
  {
    id: "Android release installed APK smoke",
    platform: "Android release",
    route: "Release-installed APK smoke",
  },
  {
    id: "Android generated versionCode metadata",
    platform: "Android release",
    route: "Generated versionCode metadata",
    resultIncludes: "versionCode",
  },
  {
    id: "production .gsav range probe",
    platform: "Production host",
    route: "Production .gsav range probe",
  },
  {
    id: "non-publishing release dry run",
    platform: "GitHub Actions release dry run",
    route: "Release workflow dry run",
    resultIncludes: "publish_release=false",
  },
  {
    id: "branch protection governance",
    platform: "Branch protection",
    route: "Master branch protection",
  },
];

const CONTEXT_ONLY_EVIDENCE_ROWS = [
  {
    platform: "Host preflight",
    route: "GSAV target routes",
  },
];

function releaseEvidenceRequirementRowForRequirement(requirement) {
  if (requirement.platform === "Android" || requirement.platform === "iOS") {
    return "Android/iOS route rows";
  }

  if (requirement.platform === "Android/iOS") {
    return "Negative validation rows";
  }

  if (requirement.platform === "Release validation prerequisites") {
    return "Release validation prerequisites";
  }

  if (requirement.platform === "Branch protection") {
    return "Branch protection";
  }

  return requirement.route;
}

const REQUIRED_RELEASE_EVIDENCE_REQUIREMENT_ROWS = Array.from(new Set(
  requiredEvidence.map(releaseEvidenceRequirementRowForRequirement),
));

const REQUIRED_EXTERNAL_REVIEW_LEDGER_CATEGORIES = [
  {
    id: "Release workflow dry run",
    rowPattern: /^Release workflow dry run$/i,
    proof: [
      ["run conclusion success", /run conclusion\s*(?:=|:)?\s*success/i],
      ["downloaded checksum-manifest SHA256 value", /downloaded checksum-manifest SHA256\s*(?:=|:)?\s*[a-f0-9]{64}\b/i],
      ["publishArtifactIdentitySha256 value", /publishArtifactIdentitySha256\s*(?:=|:)?\s*[a-f0-9]{64}\b/i],
      ["gsavPackageProvenanceSha256 value", /gsavPackageProvenanceSha256\s*(?:=|:)?\s*[a-f0-9]{64}\b/i],
      ["release evidence bundle verifier rerun pass", /verify:release-evidence-bundle[\s\S]{0,120}rerun[\s\S]{0,120}(?:pass|success)/i],
    ],
  },
  {
    id: "Release validation prerequisites and device-validation bundle",
    rowPattern: /^(?:Release validation prerequisites|Device validation bundle)$/i,
    proof: [
      ["validation-prereqs JSON", /validation-prereqs\.json/i],
      ["attach-validation-prereqs", /attach-validation-prereqs/i],
      ["--require-validation-prereqs true", /--require-validation-prereqs\s+true/i],
      ["device-validation-bundle-verifier.json", /device-validation-bundle-verifier\.json/i],
      ["downloaded-release/release-evidence", /downloaded-release[\\/]release-evidence/i],
      ["direct iOS artifact URL and SHA256 value", /(?:iOS artifact URL|IOS_VALIDATION_ARTIFACT_URL)\s*(?:=|:)?\s*https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:actions\/runs\/\d+\/artifacts\/[^/\s;|]+|releases\/download\/[^/\s;|]+\/[^/\s;|]+|blob\/[^/\s;|]+\/docs\/qa-evidence\/[^\s;|]+)[\s\S]{0,240}(?:iOS artifact SHA256|IOS_VALIDATION_ARTIFACT_SHA256)\s*(?:=|:)?\s*[a-f0-9]{64}\b/i],
    ],
  },
  {
    id: "Release APK artifact and generated version metadata",
    rowPattern: /^(?:Release APK artifact(?: and generated (?:version )?metadata)?|Generated versionCode metadata)$/i,
    proof: [
      ["apkSha256 value", /apkSha256\s*(?:=|:)?\s*[a-f0-9]{64}\b/i],
      ["manifestSha256 value", /manifestSha256\s*(?:=|:)?\s*[a-f0-9]{64}\b/i],
      ["generated versionCode value", /versionCode\s*(?:=|:)?\s*\d+\b|versionCode\s+\d+\b/i],
      ["apk-version-metadata", /apk-version-metadata|android:version-metadata/i],
    ],
  },
  {
    id: "Release-installed APK smoke",
    rowPattern: /^Release-installed APK smoke$/i,
    proof: [
      ["exact dry-run APK", /exact dry-run APK|exact release APK/i],
      ["apkSha256 value", /apkSha256\s*(?:=|:)?\s*[a-f0-9]{64}\b/i],
      ["dry-run-summary match", /dry-run-summary[\s\S]{0,120}(?:match|matches|matched|=true)/i],
      ["production host release-ready proof", /productionHostReleaseReady\s*=\s*true/i],
      ["production host URL", /productionHostUrl\s*(?:=|:)?\s*https:\/\/[^\s;|]+|production\s+(?:GSAV\s+)?host\s+URL\s*(?:=|:)?\s*https:\/\/[^\s;|]+/i],
      ["Android OS/WebView version", /Android OS[\s\S]*WebView/i],
      ["per-route log markers", /per-route|route-change|GSAV_ROUTE_CHANGE|log markers/i],
    ],
  },
  {
    id: "Production runtime smoke and range probe",
    rowPattern: /^(?:Production runtime smoke and range probe|Production JS runtime smoke|Production \.gsav range probe)$/i,
    proof: [
      ["runtime smoke", /runtime smoke|gsav:runtime-smoke/i],
      ["GSAV host identity value", /(?:GSAV_HOSTING_COMMIT|gsavHostingCommit|host identity)\s*(?:=|:)?\s*[A-Za-z0-9._-]{7,}\b/i],
      ["range probe 206", /range probe[\s\S]{0,120}206|Range: bytes=0-0[\s\S]{0,120}206/i],
      ["Content-Range bytes 0-0 value", /Content-Range\s*(?:=|:)?\s*bytes\s+0-0\/\d+\b/i],
      ["range CORS headers", /Access-Control-Expose-Headers|Access-Control-Allow-Origin/i],
    ],
  },
  {
    id: "Product journey manifest",
    rowPattern: /^Product journey manifest$/i,
    proof: [
      ["product-journey-manifest.json", /product-journey-manifest\.json/i],
      ["artifactPurpose=product-journey-manifest", /\bartifactPurpose\s*=\s*product-journey-manifest\b/i],
      ["helperOnly=false", /\bhelperOnly\s*=\s*false\b/i],
      ["releaseCandidateSha value", /\breleaseCandidateSha\s*=\s*[0-9a-f]{40}\b/i],
      ["required product journey IDs", /first-launch-home[\s\S]*search[\s\S]*creator[\s\S]*library[\s\S]*login-auth-return[\s\S]*watch-alias[\s\S]*explore[\s\S]*diagnostics-hierarchy[\s\S]*settings[\s\S]*accessibility-ergonomics[\s\S]*degraded-blocked-states/i],
      ["distinct Android and iOS evidence paths", /distinct\s+Android\s+and\s+iOS\s+evidence\s+paths/i],
      ["manifest or media SHA256 value", /\b(?:manifestSha256|mediaSha256|fileSha256)\s*(?:=|:)?\s*[a-f0-9]{64}\b/i],
      ["external inventory entry", /external-evidence-inventory\.json|\binventoryEntryId\s*=\s*product-journey-manifest\b/i],
      ["fixture manifest inventory entry", /fixture[- ]manifest(?:\.json)?[\s\S]{0,180}(?:inventory entry|reviewed inventory|external-evidence-inventory\.json)|(?:inventory entry|reviewed inventory|external-evidence-inventory\.json)[\s\S]{0,180}fixture[- ]manifest(?:\.json)?/i],
      ["artifactPurpose=fixture-manifest", /\bartifactPurpose\s*=\s*fixture-manifest\b/i],
      ["fixture manifest helperOnly=false", /(?:fixture[- ]manifest(?:\.json)?|artifactPurpose\s*=\s*fixture-manifest)[\s\S]{0,180}\bhelperOnly\s*=\s*false\b|\bhelperOnly\s*=\s*false\b[\s\S]{0,180}(?:fixture[- ]manifest(?:\.json)?|artifactPurpose\s*=\s*fixture-manifest)/i],
      ["sha256 matching fixtureManifestSha256", /(?:\bsha256\s+(?:matches|matching)\s+fixtureManifestSha256\b|\bfixtureManifestSha256\s*(?:=|:)?\s*[a-f0-9]{64}\b|\bfixtureManifestSha256\b[\s\S]{0,120}\bsha256\b|\bsha256\b[\s\S]{0,120}\bfixtureManifestSha256\b)/i],
    ],
  },
  {
    id: "Android/iOS route rows",
    rowPattern: /^Android\/iOS route rows$/i,
    proof: [
      ["Android and iOS evidence", /Android[\s\S]*iOS|iOS[\s\S]*Android/i],
      ["releaseCandidateSha value", /\breleaseCandidateSha\s*=\s*[0-9a-f]{40}\b/i],
      ["dry-run artifact identity", /\bdry[- ]run artifact\s*=\s*diveo-release-evidence-v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/i],
      ["dry-run run URL", /\bdry[- ]run (?:run|workflow) URL\s*=\s*https:\/\/github\.com\/[^/\s;|]+\/[^/\s;|]+\/actions\/runs\/\d+\b/i],
      ["artifactPurpose=route-evidence", /\bartifactPurpose\s*=\s*route-evidence\b/i],
      ["route evidence manifest", /\b(?:routeEvidenceManifest|evidenceManifest)\s*=\s*(?!<|_pending_|pending|tbd|todo|placeholder)[^;\s|,]+/i],
      ["evidenceManifestSha256 value", /\bevidenceManifestSha256\s*=\s*[0-9a-f]{64}\b/i],
      ["sourceRunId value", /\bsourceRunId\s*=\s*\d+\b/i],
      ["sourceArtifactId value", /\bsourceArtifactId\s*=\s*(?!<|_pending_|pending|tbd|todo|placeholder)[^;\s|,]+/i],
      ["media/file SHA256", /\b(?:mediaSha256|fileSha256)\s*=\s*[0-9a-f]{64}\b/i],
      ["helperOnly=false review assertion", /\bhelperOnly\s*=\s*false\b/i],
      ["device identity", /device identity|device/i],
      ["OS and WebView/WKWebView version", /OS[\s\S]*(?:WebView|WKWebView)|(?:WebView|WKWebView)[\s\S]*OS/i],
      ["route observed signal", /route[\s\S]*observed signal|observed signal[\s\S]*route/i],
      ["account-safe redaction", /account-safe|redaction|redacted/i],
    ],
  },
  {
    id: "Negative validation rows",
    rowPattern: /^Negative validation rows$/i,
    proof: [
      ["Android and iOS evidence", /Android[\s\S]*iOS|iOS[\s\S]*Android/i],
      ["releaseCandidateSha value", /\breleaseCandidateSha\s*=\s*[0-9a-f]{40}\b/i],
      ["dry-run artifact identity", /\bdry[- ]run artifact\s*=\s*diveo-release-evidence-v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/i],
      ["dry-run run URL", /\bdry[- ]run (?:run|workflow) URL\s*=\s*https:\/\/github\.com\/[^/\s;|]+\/[^/\s;|]+\/actions\/runs\/\d+\b/i],
      ["artifactPurpose=negative-evidence", /\bartifactPurpose\s*=\s*negative-evidence\b/i],
      ["negative evidence manifest", /\b(?:negativeEvidenceManifest|routeNegativeEvidenceManifest|evidenceManifest)\s*=\s*(?!<|_pending_|pending|tbd|todo|placeholder)[^;\s|,]+/i],
      ["evidenceManifestSha256 value", /\bevidenceManifestSha256\s*=\s*[0-9a-f]{64}\b/i],
      ["sourceRunId value", /\bsourceRunId\s*=\s*\d+\b/i],
      ["sourceArtifactId value", /\bsourceArtifactId\s*=\s*(?!<|_pending_|pending|tbd|todo|placeholder)[^;\s|,]+/i],
      ["media/file SHA256", /\b(?:mediaSha256|fileSha256)\s*=\s*[0-9a-f]{64}\b/i],
      ["helperOnly=false review assertion", /\bhelperOnly\s*=\s*false\b/i],
      ["trigger/action", /trigger|action/i],
      ["observed negative signal", /observed signal|blocked|retry|unsupported|no clear-session|GSAV_ENDED/i],
      ["OS and WebView/WKWebView version", /OS[\s\S]*(?:WebView|WKWebView)|(?:WebView|WKWebView)[\s\S]*OS/i],
      ["GSAV host identity", /GSAV host identity|GSAV_HOSTING_COMMIT|gsavHostingCommit/i],
    ],
  },
  {
    id: "Branch protection",
    rowPattern: /^Branch protection$/i,
    proof: [
      ["protected master", /protected master|protected branch/i],
      ["quality / quality", /quality\s*\/\s*quality/i],
      ["reviewer and timestamp", /reviewer[\s\S]*timestamp|reviewedAt|ISO/i],
      ["raw evidence path", /raw evidence path|docs\/qa-evidence|trusted GitHub/i],
    ],
  },
];

function normalizeCell(value) {
  return value.trim().replace(/^`|`$/g, "").replace(/`/g, "");
}

function parseMarkdownTableRows(text, { includeHeader = false } = {}) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|") && line.trim().endsWith("|"))
    .map((line) => line.trim().slice(1, -1).split("|").map(normalizeCell))
    .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
    .filter((cells) => includeHeader || cells[0] !== "Date");
}

function evidenceLogSection(text) {
  const start = text.indexOf("## Evidence Log");
  if (start === -1) return "";
  const rest = text.slice(start);
  const nextSection = rest.indexOf("\n## ", 1);
  return nextSection === -1 ? rest : rest.slice(0, nextSection);
}

function markdownSection(text, heading) {
  const start = text.indexOf(heading);
  if (start === -1) return "";
  const rest = text.slice(start);
  const nextSection = rest.indexOf("\n## ", 1);
  return nextSection === -1 ? rest : rest.slice(0, nextSection);
}

function parseEvidenceRows(qaText) {
  return parseMarkdownTableRows(evidenceLogSection(qaText))
    .filter((cells) => cells.length >= 8)
    .map(([date, platform, device, gsavWebUrl, route, result, evidencePath, notes]) => ({
      date,
      platform,
      device,
      gsavWebUrl,
      route,
      result,
      evidencePath,
      notes,
    }));
}

function evidenceRowKey(row) {
  return `${normalizeCell(row.platform)}\u0000${normalizeCell(row.route)}`;
}

const REQUIRED_EVIDENCE_ROW_KEYS = new Set(requiredEvidence.map(evidenceRowKey));
const CONTEXT_ONLY_EVIDENCE_ROW_KEYS = new Set(CONTEXT_ONLY_EVIDENCE_ROWS.map(evidenceRowKey));

function evidenceLogRowSetProblems(qaText) {
  return parseEvidenceRows(qaText)
    .filter((row) => {
      const key = evidenceRowKey(row);
      return !REQUIRED_EVIDENCE_ROW_KEYS.has(key) && !CONTEXT_ONLY_EVIDENCE_ROW_KEYS.has(key);
    })
    .map((row) => (
      `QA Evidence Log row ${row.platform} / ${row.route} is not in the fixed publish-readiness row set or documented context-only rows`
    ));
}

function isContextOnlyEvidenceRow(row) {
  return /\b(?:context only|not publish evidence|local pre-release evidence only|historical|rehearsal|superseded)\b/i.test([
    row.result,
    row.evidencePath,
    row.notes,
  ].join(" "));
}

function evidenceLogDuplicateRowProblems(qaText) {
  const rows = parseEvidenceRows(qaText);
  const groups = new Map();
  for (const row of rows) {
    const key = evidenceRowKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const problems = [];
  for (const [key, matchingRows] of groups.entries()) {
    if (matchingRows.length <= 1) continue;
    if (!REQUIRED_EVIDENCE_ROW_KEYS.has(key) && !CONTEXT_ONLY_EVIDENCE_ROW_KEYS.has(key)) continue;

    const label = `${matchingRows[0].platform} / ${matchingRows[0].route}`;
    const staleRows = matchingRows.slice(0, -1).filter((row) => (
      !isPending(row.result) && !isContextOnlyEvidenceRow(row)
    ));
    if (staleRows.length > 0) {
      problems.push(
        `QA Evidence Log duplicate row ${label} must mark superseded/context rows as not publish evidence or keep only the latest publish row`,
      );
    }

    if (CONTEXT_ONLY_EVIDENCE_ROW_KEYS.has(key)) {
      const unmarkedContextRows = matchingRows.filter((row) => !isContextOnlyEvidenceRow(row));
      if (unmarkedContextRows.length > 0) {
        problems.push(`QA Evidence Log context-only duplicate row ${label} must mark every row as context-only or not publish evidence`);
      }
    }
  }
  return problems;
}

function evidenceLogSchemaProblems(qaText) {
  const section = evidenceLogSection(qaText);
  if (!section) return ["QA Evidence Log section is missing"];

  const rows = parseMarkdownTableRows(section, { includeHeader: true });
  const header = rows.find((cells) => cells[0] === "Date");
  if (!header) return ["QA Evidence Log table header is missing"];

  if (header.length !== EVIDENCE_LOG_COLUMNS.length
    || EVIDENCE_LOG_COLUMNS.some((column, index) => header[index] !== column)) {
    return [`QA Evidence Log columns must be: ${EVIDENCE_LOG_COLUMNS.join(" | ")}`];
  }

  return [];
}

function parseNegativeFixtureInventoryRows(qaText) {
  return parseMarkdownTableRows(markdownSection(qaText, "## Negative Fixture Inventory"))
    .filter((cells) => cells.length >= 4 && cells[0] !== "Case")
    .map(([fixtureCase, trigger, expectedSignal, status]) => ({
      case: fixtureCase,
      trigger,
      expectedSignal,
      status,
    }))
    .filter((row) => row.case);
}

function parseNegativeFixtureInventoryCases(qaText) {
  return parseNegativeFixtureInventoryRows(qaText)
    .map((row) => row.case);
}

function parseRequiredRouteMatrixRoutes(qaText) {
  return parseMarkdownTableRows(markdownSection(qaText, "## Required Route Matrix"))
    .filter((cells) => cells.length >= 2 && cells[0] !== "diveo route")
    .map((cells) => cells[0])
    .filter(Boolean);
}

function parseReleaseEvidenceRequirementRows(qaText) {
  return parseMarkdownTableRows(markdownSection(qaText, "## Release Evidence Requirements"))
    .filter((cells) => cells.length >= 2 && cells[0] !== "Evidence row")
    .map((cells) => cells[0])
    .filter(Boolean);
}

function parseExternalReviewLedgerRows(auditText) {
  return parseMarkdownTableRows(markdownSection(auditText, "## External Evidence Review Ledger"))
    .filter((cells) => cells.length >= 5 && cells[0] !== "QA row or artifact")
    .map(([qaRowOrArtifact, urlOrArtifact, reviewerTimestamp, requiredReviewProof, status]) => ({
      qaRowOrArtifact,
      urlOrArtifact,
      reviewerTimestamp,
      requiredReviewProof,
      status,
    }))
    .filter((row) => row.qaRowOrArtifact);
}

function externalReviewLedgerRowIsUnresolved(row) {
  const rowText = [
    row.reviewerTimestamp,
    row.status,
  ].join(" ");
  return /_pending_|pending|unresolved|no-publish|blocker|missing|not reviewed/i.test(rowText)
    || !/(reviewed|ready|accepted|complete)/i.test(row.status)
    || /_pending_|pending|tbd|todo/i.test(row.reviewerTimestamp);
}

function ledgerArtifactReferenceIsDurable(value) {
  const text = String(value ?? "").trim();
  if (!text || /_pending_|pending|tbd|todo|placeholder/i.test(text) || /<[^>]+>/.test(text)) {
    return false;
  }

  const candidates = evidenceCandidates(text);
  if (candidates.some((candidate) => candidate.startsWith("docs/qa-evidence/"))) {
    return true;
  }
  if (httpEvidenceCandidates(text).some(trustedGithubEvidenceUrl)) {
    return true;
  }
  return /\bdiveo-release-evidence-v\d+\.\d+\.\d+\b/i.test(text)
    || /\bdiveo-device-validation-\d{4}-\d{2}-\d{2}-\d+\b/i.test(text)
    || /\brelease-evidence\/(?:[A-Za-z0-9._-]+\/?)*[A-Za-z0-9._-]+\b/i.test(text);
}

function externalReviewLedgerRowDetailProblems(row, categoryId) {
  const errors = [];
  const timestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/.exec(row.reviewerTimestamp ?? "")?.[0];
  if (!isIsoTimestamp(timestamp)) {
    errors.push(`audit external evidence review ledger ${categoryId} row must include ISO reviewer timestamp`);
  }

  const reviewerText = String(row.reviewerTimestamp ?? "")
    .replace(timestamp ?? "", "")
    .replace(/[\/|,;-]+/g, " ")
    .trim();
  if (!reviewerText || /^(?:owner|release owner|native release owner|reviewer|tbd|todo|pending|unassigned)$/i.test(reviewerText)) {
    errors.push(`audit external evidence review ledger ${categoryId} row must include concrete reviewer`);
  }

  if (!ledgerArtifactReferenceIsDurable(row.urlOrArtifact)) {
    errors.push(`audit external evidence review ledger ${categoryId} row must include durable reviewed artifact reference`);
  }

  return errors;
}

function externalReviewLedgerCoverageProblems(ledgerRows) {
  const reviewedRows = ledgerRows.filter((row) => !externalReviewLedgerRowIsUnresolved(row));
  return REQUIRED_EXTERNAL_REVIEW_LEDGER_CATEGORIES.flatMap((category) => {
    const row = reviewedRows.find((candidateRow) => category.rowPattern.test(candidateRow.qaRowOrArtifact));
    if (!row) {
      return [`audit external evidence review ledger must include reviewed ${category.id}`];
    }

    const rowText = [
      row.qaRowOrArtifact,
      row.urlOrArtifact,
      row.reviewerTimestamp,
      row.requiredReviewProof,
      row.status,
    ].join(" ");
    return [
      ...externalReviewLedgerRowDetailProblems(row, category.id),
      ...category.proof
      .filter(([, pattern]) => !pattern.test(rowText))
      .map(([label]) => `audit external evidence review ledger ${category.id} row must include ${label}`),
    ];
  });
}

function routeMatrixCoverageProblems(qaText) {
  const matrixRoutes = parseRequiredRouteMatrixRoutes(qaText);
  if (matrixRoutes.length === 0) {
    return ["QA required route matrix is missing required route rows"];
  }

  const matrixSet = new Set(matrixRoutes);
  const requiredSet = new Set(REQUIRED_ROUTES);

  return [
    ...REQUIRED_ROUTES
      .filter((requiredRoute) => !matrixSet.has(requiredRoute))
      .map((requiredRoute) => `QA required route matrix is missing ${requiredRoute}`),
    ...matrixRoutes
      .filter((matrixRoute) => !requiredSet.has(matrixRoute))
      .map((matrixRoute) => `QA required route matrix route ${matrixRoute} is not release-readiness required evidence`),
  ];
}

function negativeCaseCoverageProblems(qaText) {
  const inventoryRows = parseNegativeFixtureInventoryRows(qaText);
  const inventoryCases = inventoryRows.map((row) => row.case);
  if (inventoryCases.length === 0) {
    return ["QA negative fixture inventory is missing required case rows"];
  }

  const inventorySet = new Set(inventoryCases);
  const requiredSet = new Set(REQUIRED_NEGATIVE_CASES);
  const placeholderPattern = /\b(TBD|todo|placeholder|manual check|_pending_|pending)\b|^(trigger|expected signal) for /i;

  const detailProblems = inventoryRows.flatMap((row) => {
    const problems = [];
    if (!row.trigger || placeholderPattern.test(row.trigger)) {
      problems.push(`QA negative fixture inventory ${row.case} must name an exact trigger, route, QA flag, command, or hosted control`);
    }
    if (!row.expectedSignal || placeholderPattern.test(row.expectedSignal)) {
      problems.push(`QA negative fixture inventory ${row.case} must name the expected observed signal`);
    }
    const status = row.status ?? "";
    const isAvailable = /available/i.test(status);
    const isOwnerBlocked = /owner-blocked|available only when/i.test(status);
    if (!isAvailable && !isOwnerBlocked) {
      problems.push(`QA negative fixture inventory ${row.case} must mark fixture status as available or owner-blocked`);
    }
    if (isOwnerBlocked && !/(until|when).*(named|fixture|flag|control|route|debug action|exposes)/i.test(status)) {
      problems.push(`QA negative fixture inventory ${row.case} owner-blocked status must name the missing fixture, flag, route, or control`);
    }
    return problems;
  });

  return [
    ...REQUIRED_NEGATIVE_CASES
      .filter((requiredCase) => !inventorySet.has(requiredCase))
      .map((requiredCase) => `QA negative fixture inventory is missing ${requiredCase}`),
    ...inventoryCases
      .filter((inventoryCase) => !requiredSet.has(inventoryCase))
      .map((inventoryCase) => `QA negative fixture inventory case ${inventoryCase} is not release-readiness required evidence`),
    ...detailProblems,
  ];
}

function releaseEvidenceRequirementsProblems(qaText) {
  const requirementRows = parseReleaseEvidenceRequirementRows(qaText);
  if (requirementRows.length === 0) {
    return ["QA release evidence requirements table is missing required rows"];
  }

  const requirementSet = new Set(requirementRows);
  const requiredSet = new Set(REQUIRED_RELEASE_EVIDENCE_REQUIREMENT_ROWS);

  return [
    ...REQUIRED_RELEASE_EVIDENCE_REQUIREMENT_ROWS
      .filter((requiredRow) => !requirementSet.has(requiredRow))
      .map((requiredRow) => `QA release evidence requirements table is missing ${requiredRow}`),
    ...requirementRows
      .filter((requirementRow) => !requiredSet.has(requirementRow))
      .map((requirementRow) => `QA release evidence requirements row ${requirementRow} is not release-readiness required evidence`),
  ];
}

function isPending(value) {
  return !value || /_pending_|pending/i.test(value);
}

function localEvidenceCandidates(evidencePath) {
  return evidenceCandidates(evidencePath)
    .filter((part) => part.startsWith("docs/qa-evidence/"));
}

function evidenceCandidates(evidencePath) {
  return evidencePath
    .split(/[,;]/)
    .map((part) => part.trim())
    .map((part) => {
      const markdownLink = /\[[^\]]+\]\(([^)]+)\)/.exec(part);
      return markdownLink ? markdownLink[1] : part;
    })
    .map((part) => {
      const normalized = part.replace(/\\/g, "/");
      return normalized.startsWith("<") && normalized.endsWith(">")
        ? normalized.slice(1, -1)
        : normalized;
    })
    .filter(Boolean);
}

function httpEvidenceCandidates(evidencePath) {
  return evidenceCandidates(evidencePath).filter((part) => /^https?:\/\//i.test(part));
}

function unsupportedEvidenceCandidates(evidencePath) {
  return evidenceCandidates(evidencePath).filter((part) => (
    !part.startsWith("docs/qa-evidence/") && !/^https?:\/\//i.test(part)
  ));
}

function hasPlaceholderToken(value) {
  return /<[^>\s]+>/.test(String(value ?? ""));
}

function trustedGithubEvidenceUrl(url) {
  if (hasPlaceholderToken(url)) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
      return false;
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return false;
    }

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const repository = pathParts.slice(0, 2).join("/").toLowerCase();
    if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) {
      return false;
    }

    const rest = pathParts.slice(2).join("/");
    return /^actions\/runs\/\d+(?:\/artifacts\/[^/]+)?$/i.test(rest)
      || /^releases\/download\/[^/]+\/[^/]+$/i.test(rest)
      || /^blob\/[^/]+\/docs\/qa-evidence\/.+/i.test(rest);
  } catch {
    return false;
  }
}

function trustedGithubReleaseTagUrl(url) {
  if (hasPlaceholderToken(url)) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
      return false;
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return false;
    }

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const repository = pathParts.slice(0, 2).join("/").toLowerCase();
    if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) {
      return false;
    }

    return /^releases\/tag\/[^/]+$/i.test(pathParts.slice(2).join("/"));
  } catch {
    return false;
  }
}

function trustedGithubReleaseRunUrl(url) {
  if (hasPlaceholderToken(url)) {
    return false;
  }
  try {
    const parsed = new URL(url);
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

function githubReleaseRunRepository(url) {
  if (!trustedGithubReleaseRunUrl(url)) {
    return null;
  }
  const match = /^\/([^/]+)\/([^/]+)\/actions\/runs\/\d+$/.exec(new URL(url).pathname);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

function githubReleaseRunId(url) {
  if (!trustedGithubReleaseRunUrl(url)) {
    return null;
  }
  return /^\/[^/]+\/[^/]+\/actions\/runs\/(\d+)$/.exec(new URL(url).pathname)?.[1] ?? null;
}

function githubReleaseRunIdsFromText(text) {
  const urls = String(text).match(/https:\/\/github\.com\/[^\s;|),>]+/gi) ?? [];
  return Array.from(new Set(urls.map(githubReleaseRunId).filter(Boolean)));
}

function githubActionsRunId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const repository = pathParts.slice(0, 2).join("/").toLowerCase();
    if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) {
      return null;
    }
    return pathParts[2] === "actions" && pathParts[3] === "runs" && /^\d+$/.test(pathParts[4] ?? "")
      ? pathParts[4]
      : null;
  } catch {
    return null;
  }
}

function githubActionsRunIdsFromUrls(urls) {
  return Array.from(new Set(urls.map(githubActionsRunId).filter(Boolean)));
}

function durableUrlProblem(evidencePath) {
  const urls = httpEvidenceCandidates(evidencePath);
  if (urls.length === 0) return "evidence path must be a URL or docs/qa-evidence file";

  const releaseTagUrls = urls.filter(trustedGithubReleaseTagUrl);
  if (releaseTagUrls.length > 0) {
    return `release tag pages are context only and do not count as durable evidence: ${releaseTagUrls.join(", ")}`;
  }

  const weakUrls = urls.filter((url) => {
    if (!/^https:\/\//i.test(url)) return true;
    try {
      if (isLocalOrPrivateHostname(new URL(url).hostname)) return true;
    } catch {
      return true;
    }
    return !trustedGithubEvidenceUrl(url);
  });

  if (weakUrls.length > 0) {
    return `external evidence URL must be a trusted GitHub CI/artifact/release URL: ${weakUrls.join(", ")}`;
  }
  return null;
}

function releaseEvidenceRunConsistencyProblems(row, requirement) {
  if (!["Release APK artifact", "Generated versionCode metadata", "Release workflow dry run"].includes(requirement.route)) {
    return [];
  }

  const evidenceRunIds = githubActionsRunIdsFromUrls(httpEvidenceCandidates(row.evidencePath));
  if (evidenceRunIds.length === 0) return [];

  const rowRunIds = githubReleaseRunIdsFromText([
    row.device,
    row.gsavWebUrl,
    row.result,
    row.notes,
  ].filter(Boolean).join(" "));
  if (rowRunIds.length === 0) {
    return ["workflow run URL matching evidence path run"];
  }

  const mismatched = evidenceRunIds.filter((runId) => !rowRunIds.includes(runId));
  if (mismatched.length > 0) {
    return [`evidence path run ${mismatched.join(", ")} must match row workflow run URL ${rowRunIds.join(", ")}`];
  }
  return [];
}

function trustedEvidenceDetailUrlProblems(row, requirement) {
  const releaseEvidenceRoutes = new Set([
    "Validation prerequisites",
    "Release APK artifact",
    "Release-installed APK smoke",
    "Generated versionCode metadata",
    "Release workflow dry run",
  ]);
  if (!releaseEvidenceRoutes.has(requirement.route)) return [];

  const text = [
    row.device,
    row.gsavWebUrl,
    row.result,
    row.notes,
  ].filter(Boolean).join(" ");
  const urls = text.match(/https?:\/\/[^\s;|),>]+/gi) ?? [];
  const evidenceLikeUrls = urls.filter((url) => {
    try {
      const parsed = new URL(url);
      const pathName = parsed.pathname;
      return /\/actions\/runs\/\d+/i.test(pathName)
        || /\/releases(?:\/|$)/i.test(pathName)
        || /\/blob\/[^/]+\/docs\/qa-evidence\//i.test(pathName);
    } catch {
      return false;
    }
  });
  const weakUrls = evidenceLikeUrls.filter((url) => !trustedGithubEvidenceUrl(url));
  return weakUrls.length > 0
    ? [`row detail evidence URL must be trusted GitHub evidence: ${weakUrls.join(", ")}`]
    : [];
}

function evidenceProblem(evidencePath, root = process.cwd()) {
  if (isPending(evidencePath)) return "evidence path is pending";
  if (/^Terminal:/i.test(evidencePath)) return "terminal-only evidence is not durable";

  const placeholderEntries = evidenceCandidates(evidencePath).filter(hasPlaceholderToken);
  if (placeholderEntries.length > 0) {
    return `evidence path contains placeholder value: ${placeholderEntries.join(", ")}`;
  }

  const localPaths = localEvidenceCandidates(evidencePath);
  const urlIssue = /https?:\/\//i.test(evidencePath) ? durableUrlProblem(evidencePath) : null;
  if (urlIssue) return urlIssue;

  const unsupportedEntries = unsupportedEvidenceCandidates(evidencePath);
  if (unsupportedEntries.length > 0) {
    return `unsupported evidence path entry: ${unsupportedEntries.join(", ")}`;
  }

  if (localPaths.length === 0 && httpEvidenceCandidates(evidencePath).length === 0) {
    return "evidence path must be a URL or docs/qa-evidence file";
  }

  const missingPaths = localPaths.filter((localPath) => !fs.existsSync(path.join(root, localPath)));
  if (missingPaths.length > 0) {
    return `local evidence file missing: ${missingPaths.join(", ")}`;
  }
  return null;
}

function deviceValidationHelperEvidenceCandidates(evidencePath) {
  return evidenceCandidates(evidencePath).filter((candidate) => (
    /\bdiveo-device-validation-\d{4}-\d{2}-\d{2}-\d+\b/i.test(candidate)
    || /device-validation-evidence[\\/]device-validation-bundle-verifier\.json/i.test(candidate)
    || /\bdevice-validation-bundle-verifier\.json\b/i.test(candidate)
    || /downloaded-release[\\/]release-evidence[\\/]/i.test(candidate)
    || /release-evidence[\\/]validation-prereqs\.json/i.test(candidate)
    || /\bvalidation-prereqs\.json\b/i.test(candidate)
  ));
}

function githubEvidencePathKind(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return "other";
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const repository = pathParts.slice(0, 2).join("/").toLowerCase();
    if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) return "other";
    const rest = pathParts.slice(2).join("/");
    if (/^actions\/runs\/\d+$/i.test(rest)) return "actions-run";
    if (/^actions\/runs\/\d+\/artifacts\/[^/]+$/i.test(rest)) return "actions-artifact";
    if (/^blob\/[^/]+\/docs\/qa-evidence\/.+/i.test(rest)) return "qa-blob";
    if (/^releases\/download\/[^/]+\/[^/]+$/i.test(rest)) return "release-download";
    if (/^releases\/tag\/[^/]+$/i.test(rest)) return "release-tag";
    return "other";
  } catch {
    return "other";
  }
}

function githubEvidenceIdentity(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return null;
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const repository = pathParts.slice(0, 2).join("/").toLowerCase();
    if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) return null;
    const rest = pathParts.slice(2);
    if (
      rest.length === 5
      && rest[0]?.toLowerCase() === "actions"
      && rest[1]?.toLowerCase() === "runs"
      && /^\d+$/.test(rest[2])
      && rest[3]?.toLowerCase() === "artifacts"
    ) {
      return {
        sourceRunId: rest[2],
        sourceArtifactId: decodeURIComponent(rest[4] ?? ""),
      };
    }
    if (
      rest.length === 4
      && rest[0]?.toLowerCase() === "releases"
      && rest[1]?.toLowerCase() === "download"
    ) {
      return {
        sourceRunId: null,
        sourceArtifactId: decodeURIComponent(rest[3] ?? ""),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function detailFieldValue(text, labels) {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = new RegExp(`\\b(?:${labelPattern})\\s*=\\s*([^;\\s|,]+)`, "i").exec(text);
  return match?.[1] ?? null;
}

function weakMetadataValue(value) {
  const text = String(value ?? "").trim();
  return !text
    || hasPlaceholderToken(text)
    || /^_?pending_?$/i.test(text)
    || /^(?:tbd|todo|placeholder|unknown|id|manifest|path|sha|hash|artifact)$/i.test(text);
}

function externalRouteEvidenceManifestProblems(row, requirement) {
  const urls = httpEvidenceCandidates(row.evidencePath);
  if (urls.length === 0) return [];

  const bareRunUrls = urls.filter((url) => githubEvidencePathKind(url) === "actions-run");
  const nonDirectUrls = urls.filter((url) => githubEvidencePathKind(url) === "release-tag");
  const externalArtifactUrls = urls.filter((url) => (
    githubEvidencePathKind(url) === "actions-artifact"
    || githubEvidencePathKind(url) === "release-download"
  ));
  const problems = [];

  if (bareRunUrls.length > 0) {
    problems.push(`route or negative evidence must use a direct artifact/blob with a manifest, not bare Actions run URLs: ${bareRunUrls.join(", ")}`);
  }
  if (nonDirectUrls.length > 0) {
    problems.push(`route or negative evidence must use a direct artifact/blob with a manifest, not release tag URLs: ${nonDirectUrls.join(", ")}`);
  }
  if (externalArtifactUrls.length === 0) return problems;

  const text = detailText(row);
  const expectedPurpose = requirement.platform === "Android/iOS" ? "negative-evidence" : "route-evidence";
  const manifestLabelPattern = requirement.platform === "Android/iOS"
    ? /\b(?:negativeEvidenceManifest|routeNegativeEvidenceManifest|evidenceManifest)\s*=/i
    : /\b(?:routeEvidenceManifest|evidenceManifest)\s*=/i;
  const manifestValue = requirement.platform === "Android/iOS"
    ? detailFieldValue(text, ["negativeEvidenceManifest", "routeNegativeEvidenceManifest", "evidenceManifest"])
    : detailFieldValue(text, ["routeEvidenceManifest", "evidenceManifest"]);
  const sourceRunId = detailFieldValue(text, ["sourceRunId"]);
  const sourceArtifactId = detailFieldValue(text, ["sourceArtifactId"]);
  const identities = externalArtifactUrls.map(githubEvidenceIdentity).filter(Boolean);
  const actionRunIds = Array.from(new Set(identities.map((identity) => identity.sourceRunId).filter(Boolean)));
  const artifactIds = identities.map((identity) => identity.sourceArtifactId).filter(Boolean);
  const declaredArtifactIds = String(sourceArtifactId ?? "").split(/[+]/).map((value) => value.trim()).filter(Boolean);

  const requiredFields = [
    [`artifactPurpose=${expectedPurpose}`, new RegExp(`\\bartifactPurpose\\s*=\\s*${expectedPurpose}\\b`, "i")],
    ["route/negative evidence manifest", manifestLabelPattern],
    ["evidenceManifestSha256=<64-hex>", /\bevidenceManifestSha256\s*=\s*[0-9a-f]{64}\b/i],
    ["sourceRunId=<digits>", /\bsourceRunId\s*=\s*\d+\b/i],
    ["sourceArtifactId=<id>", /\bsourceArtifactId\s*=\s*[^;\s|,]+/i],
    ["mediaSha256=<64-hex>", /\b(?:mediaSha256|fileSha256)\s*=\s*[0-9a-f]{64}\b/i],
    ["helperOnly=false", /\bhelperOnly\s*=\s*false\b/i],
  ];
  const fieldProblems = requiredFields
    .filter(([, pattern]) => !pattern.test(text))
    .map(([label]) => `external route or negative evidence artifact must include ${label}`);
  if (manifestLabelPattern.test(text) && weakMetadataValue(manifestValue)) {
    fieldProblems.push("external route or negative evidence artifact must include concrete route/negative evidence manifest");
  }
  if (/\bsourceArtifactId\s*=/i.test(text) && weakMetadataValue(sourceArtifactId)) {
    fieldProblems.push("external route or negative evidence artifact must include concrete sourceArtifactId");
  }
  if (actionRunIds.length === 1 && sourceRunId && sourceRunId !== actionRunIds[0]) {
    fieldProblems.push(`external route or negative evidence sourceRunId must match evidence artifact URL run ${actionRunIds[0]}`);
  }
  if (actionRunIds.length > 1) {
    fieldProblems.push(`external route or negative evidence artifacts must come from one source run, got ${actionRunIds.join(", ")}`);
  }
  for (const artifactId of artifactIds) {
    if (declaredArtifactIds.length > 0 && !declaredArtifactIds.includes(artifactId)) {
      fieldProblems.push(`external route or negative evidence sourceArtifactId must include evidence artifact URL segment ${artifactId}`);
    }
  }

  return [
    ...problems,
    ...fieldProblems,
  ];
}

function routeOrNegativeEvidencePathProblems(row, requirement) {
  if (!["Android", "iOS", "Android/iOS"].includes(requirement?.platform)) return [];
  const helperEvidence = deviceValidationHelperEvidenceCandidates(row.evidencePath);
  if (helperEvidence.length > 0) {
    return [`device-validation helper evidence cannot satisfy route or negative rows: ${helperEvidence.join(", ")}`];
  }
  return externalRouteEvidenceManifestProblems(row, requirement);
}

function detailText(row) {
  return [
    row.device,
    row.gsavWebUrl,
    row.result,
    row.evidencePath,
    row.notes,
  ].filter(Boolean).join(" ");
}

function currentDateString(options = {}) {
  const date = options.currentDate ? new Date(options.currentDate) : new Date();
  return date.toISOString().slice(0, 10);
}

function isRealIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isoDateDayNumber(value) {
  const [, yearText, monthText, dayText] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)) / 86_400_000;
}

function evidenceDateProblem(date, options = {}) {
  if (!isRealIsoDate(date)) return "evidence date must use ISO YYYY-MM-DD";
  const today = currentDateString(options);
  if (date > today) return `evidence date cannot be after ${today}`;
  const maxAgeDays = Object.prototype.hasOwnProperty.call(options, "maxEvidenceAgeDays")
    ? options.maxEvidenceAgeDays
    : DEFAULT_MAX_EVIDENCE_AGE_DAYS;
  if (maxAgeDays !== null && maxAgeDays !== false) {
    const maxAgeNumber = Number(maxAgeDays);
    if (Number.isFinite(maxAgeNumber) && maxAgeNumber >= 0) {
      const ageDays = isoDateDayNumber(today) - isoDateDayNumber(date);
      if (ageDays > maxAgeNumber) {
        return `evidence date ${date} is older than ${maxAgeNumber} days before ${today}`;
      }
    }
  }
  return null;
}

function labeledField(text, label) {
  const pattern = new RegExp(`${label}\\s*[:=]\\s*([^;|]+)`, "i");
  return pattern.exec(text)?.[1]?.trim() ?? null;
}

function exceptionGateNames(requirement) {
  if (!requirement) return [];
  return Array.from(new Set([
    requirement.id,
    requirement.route,
    releaseEvidenceRequirementRowForRequirement(requirement),
  ].filter(Boolean)));
}

function hasReviewLink(text) {
  return /https:\/\/github\.com\/[^/\s;|]+\/[^/\s;|]+\/(?:issues|pull|actions\/runs)\/\d+/i.test(text)
    || /(?:issue|run)\s*[:=]\s*(?:#\d+|https:\/\/github\.com\/[^\s;|]+)/i.test(text);
}

function ownerProblem(text) {
  const owner = labeledField(text, "owner");
  if (!owner) return "evidence owner";

  if (/^(?:native\s+release\s+owner|release\s+owner|gsav\s+host\s+owner|owner|tbd|todo|placeholder|unassigned)$/i.test(owner)) {
    return "concrete evidence owner";
  }

  if (/^(?:native|release|gsav|host|qa|ci|workflow)\s+owner$/i.test(owner)) {
    return "concrete evidence owner";
  }

  if (owner.length < 3 && !/^@[\w-]+$/.test(owner) && !hasReviewLink(`owner=${owner}`)) {
    return "concrete evidence owner";
  }

  return null;
}

function exceptionProblems(text, options = {}) {
  if (!/exception/i.test(text)) return [];

  const errors = [];

  const gate = labeledField(text, "gate");
  if (!gate) {
    errors.push("scoped gate name");
  } else {
    const allowedGates = options.allowedExceptionGates ?? exceptionGateNames(options.requirement);
    if (allowedGates.length > 0 && !allowedGates.some((allowedGate) => allowedGate.toLowerCase() === gate.toLowerCase())) {
      errors.push(`scoped gate name ${gate} must match ${allowedGates.join(" or ")}`);
    }
  }

  const ownerIssue = ownerProblem(text);
  if (ownerIssue) {
    errors.push(ownerIssue);
  }

  const reason = labeledField(text, "reason");
  if (!reason || reason.length < 12) {
    errors.push("exact reason");
  }

  const affected = labeledField(text, "affected");
  if (!affected || affected.length < 5) {
    errors.push("affected platform/artifact");
  }

  const approver = labeledField(text, "approver");
  if ((!approver || approver.length < 3) && !hasReviewLink(text)) {
    errors.push("approver or issue/run link");
  }

  const revisitText = labeledField(text, "revisit") ?? "";
  const revisitMatch = /(\d{4}-\d{2}-\d{2})/.exec(revisitText);
  if (!revisitMatch) {
    errors.push("ISO revisit date");
  } else if (revisitMatch[1] < currentDateString(options)) {
    errors.push(`expired revisit date ${revisitMatch[1]}`);
  }

  return errors;
}

function hasNamedException(text, options = {}) {
  return /exception/i.test(text) && exceptionProblems(text, options).length === 0;
}

function scopedExceptionPublishBlockerProblems(text, options = {}) {
  if (!hasNamedException(text, options) || options.allowScopedExceptionPublishReadiness === true) {
    return [];
  }
  return ["scoped exception is a no-publish blocker"];
}

function hasAll(text, requirements) {
  return requirements.every((pattern) => pattern.test(text));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readCandidateIdentity(root = process.cwd(), options = {}) {
  const env = options.env ?? process.env;
  const packageJson = readJson(path.join(root, "package.json"));
  const appJson = readJson(path.join(root, "app.json"));
  let signoffCommit = null;
  let dirtyIdentityFiles = [];
  try {
    signoffCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    signoffCommit = null;
  }
  const candidateRef = env.RELEASE_PAYLOAD_CANDIDATE_SHA || env.RELEASE_CANDIDATE_SHA || null;
  const commit = candidateRef
    ? resolveGitCommit(root, candidateRef) || candidateRef
    : signoffCommit;
  try {
    const status = execFileSync("git", [
      "status",
      "--porcelain",
      "--untracked-files=normal",
      "--",
      ...RELEASE_IDENTITY_FILES,
    ], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    dirtyIdentityFiles = status
      ? status.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      : [];
  } catch {
    dirtyIdentityFiles = [];
  }

  return {
    commit,
    signoffCommit,
    appVersion: appJson.expo?.version ?? packageJson.version,
    packageVersion: packageJson.version,
    versionCode: appJson.expo?.android?.versionCode,
    dirtyIdentityFiles,
    signoffIntegrityProblems: candidateRef
      ? releaseSignoffIntegrityProblems({ root, candidateCommit: commit, signoffCommit })
      : [],
  };
}

function gitOutput(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function normalizeGitPath(value) {
  return normalizeCell(String(value)).replace(/\\/g, "/");
}

function isAllowedEvidenceSignoffPath(relativePath) {
  const normalized = normalizeGitPath(relativePath);
  return ALLOWED_SIGNOFF_FILES.has(normalized)
    || ALLOWED_SIGNOFF_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function resolveGitCommit(root, ref) {
  try {
    return gitOutput(root, ["rev-parse", `${ref}^{commit}`]);
  } catch {
    return null;
  }
}

function releaseSignoffIntegrityProblems({
  root = process.cwd(),
  candidateCommit,
  signoffCommit,
} = {}) {
  if (!candidateCommit || !signoffCommit || commitMatches(candidateCommit, signoffCommit)) {
    return [];
  }

  const resolvedCandidate = resolveGitCommit(root, candidateCommit);
  const resolvedSignoff = resolveGitCommit(root, signoffCommit);
  const errors = [];

  if (!resolvedCandidate) {
    errors.push(`release payload candidate commit could not be resolved: ${candidateCommit}`);
  }
  if (!resolvedSignoff) {
    errors.push(`release evidence signoff commit could not be resolved: ${signoffCommit}`);
  }
  if (errors.length > 0) return errors;

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", resolvedCandidate, resolvedSignoff], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    return ["release evidence signoff commit must descend from the payload candidate commit."];
  }

  let changedFiles = [];
  try {
    const diffText = gitOutput(root, ["diff", "--name-only", `${resolvedCandidate}..${resolvedSignoff}`, "--"]);
    changedFiles = diffText
      ? diffText.split(/\r?\n/).map(normalizeGitPath).filter(Boolean)
      : [];
  } catch {
    return ["release evidence signoff diff could not be inspected."];
  }

  const disallowed = changedFiles.filter((filePath) => !isAllowedEvidenceSignoffPath(filePath));
  if (disallowed.length > 0) {
    errors.push(
      `release evidence signoff commit may only change docs/GSAV_NATIVE_QA.md, docs/IMPLEMENTATION_VALIDATION_AUDIT.md, or docs/qa-evidence/** after payload capture: ${disallowed.join(", ")}`,
    );
  }

  return errors;
}

function gitTracked(root, relativePath) {
  try {
    gitOutput(root, ["ls-files", "--error-unmatch", "--", relativePath]);
    return true;
  } catch {
    return false;
  }
}

function evidenceIntegrityProblems({
  root = process.cwd(),
  rows = [],
  qaPath = QA_EVIDENCE_PATH,
  auditPath = null,
  externalEvidenceInventoryPath = null,
  devicePacketPath = null,
  stackReceiptPath = null,
  finalCommandReceiptsPath = null,
  lastMileEvidencePaths = [],
} = {}) {
  const relativeQaPath = normalizeCell(path.relative(root, path.isAbsolute(qaPath) ? qaPath : path.join(root, qaPath))).replace(/\\/g, "/");
  const relativeAuditPath = auditPath
    ? normalizeCell(path.relative(root, path.isAbsolute(auditPath) ? auditPath : path.join(root, auditPath))).replace(/\\/g, "/")
    : null;
  const relativeInventoryPath = externalEvidenceInventoryPath
    ? normalizeCell(path.relative(root, path.isAbsolute(externalEvidenceInventoryPath) ? externalEvidenceInventoryPath : path.join(root, externalEvidenceInventoryPath))).replace(/\\/g, "/")
    : null;
  const relativeDevicePacketPath = devicePacketPath
    ? normalizeCell(path.relative(root, path.isAbsolute(devicePacketPath) ? devicePacketPath : path.join(root, devicePacketPath))).replace(/\\/g, "/")
    : null;
  const relativeStackReceiptPath = stackReceiptPath
    ? normalizeCell(path.relative(root, path.isAbsolute(stackReceiptPath) ? stackReceiptPath : path.join(root, stackReceiptPath))).replace(/\\/g, "/")
    : null;
  const relativeFinalCommandReceiptsPath = finalCommandReceiptsPath
    ? normalizeCell(path.relative(root, path.isAbsolute(finalCommandReceiptsPath) ? finalCommandReceiptsPath : path.join(root, finalCommandReceiptsPath))).replace(/\\/g, "/")
    : null;
  const localPaths = Array.from(new Set([
    relativeQaPath,
    relativeAuditPath,
    relativeInventoryPath,
    relativeDevicePacketPath,
    relativeStackReceiptPath,
    relativeFinalCommandReceiptsPath,
    ...lastMileEvidencePaths,
    ...rows.flatMap((row) => localEvidenceCandidates(row.evidencePath)),
  ])).filter(Boolean);

  const errors = [];
  for (const localPath of localPaths) {
    if (!gitTracked(root, localPath)) {
      errors.push(`release evidence file must be tracked in git before readiness: ${localPath}`);
    }
  }

  try {
    const status = gitOutput(root, ["status", "--porcelain", "--untracked-files=normal", "--", ...localPaths]);
    if (status) {
      errors.push(`release evidence files must be committed before readiness: ${status.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(", ")}`);
    }
  } catch {
    errors.push("release evidence files must be checked in a git workspace before readiness.");
  }

  return errors;
}

function extractCandidateFields(text) {
  return {
    commit: /diveo commit\s*[:= ]\s*([0-9a-f]{7,40})/i.exec(text)?.[1] ?? null,
    appVersion: /app version\s*[:= ]\s*(\d+\.\d+\.\d+)/i.exec(text)?.[1] ?? null,
    packageVersion: /package(?:\.json)? version\s*[:= ]\s*(\d+\.\d+\.\d+)/i.exec(text)?.[1] ?? null,
    versionCode: /(?:android\s+)?versionCode\s*[:= ]\s*(\d+)/i.exec(text)?.[1] ?? null,
  };
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

function fullCommitSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value ?? ""));
}

function sameFullCommitSha(observed, expected) {
  return fullCommitSha(observed)
    && fullCommitSha(expected)
    && String(observed).toLowerCase() === String(expected).toLowerCase();
}

function requiresVersionCode(requirement) {
  return requirement.platform === "Android"
    || requirement.platform === "Android/iOS"
    || requirement.platform === "Android release"
    || requirement.platform === "GitHub Actions release dry run";
}

function candidateIdentityProblems(text, requirement, candidate) {
  const observed = extractCandidateFields(text);
  const errors = [];

  if (!observed.commit) {
    errors.push("diveo commit");
  } else if (candidate?.commit && !commitMatches(observed.commit, candidate.commit)) {
    errors.push(`diveo commit ${observed.commit} does not match current ${candidate.commit.slice(0, 12)}`);
  }

  if (!observed.appVersion) {
    errors.push("app version");
  } else if (candidate?.appVersion && observed.appVersion !== candidate.appVersion) {
    errors.push(`app version ${observed.appVersion} does not match current ${candidate.appVersion}`);
  }

  if (!observed.packageVersion) {
    errors.push("package.json version");
  } else if (candidate?.packageVersion && observed.packageVersion !== candidate.packageVersion) {
    errors.push(`package.json version ${observed.packageVersion} does not match current ${candidate.packageVersion}`);
  }

  if (requiresVersionCode(requirement)) {
    if (!observed.versionCode) {
      errors.push("Android versionCode");
    } else if (candidate?.versionCode && Number(observed.versionCode) !== Number(candidate.versionCode)) {
      errors.push(`Android versionCode ${observed.versionCode} does not match current ${candidate.versionCode}`);
    }
  }

  return errors;
}

function shaValuesForPatterns(text, patterns) {
  return patterns.flatMap((pattern) => {
    const values = [];
    const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(regex)) {
      if (match[1]) values.push(match[1]);
    }
    return values;
  });
}

function releaseCandidateShaDetailProblems(text, candidate, { checkCandidateRef = false } = {}) {
  const errors = [];

  const releaseCandidateValues = shaValuesForPatterns(text, [
    /\breleaseCandidateSha\s*[:=]\s*([0-9a-f]{1,40})/i,
    /\brelease-candidate SHA\s*[:=]?\s*([0-9a-f]{1,40})/i,
  ]);
  const candidateRefValues = checkCandidateRef
    ? shaValuesForPatterns(text, [/\bcandidate_ref\s*[:=]\s*([0-9a-f]{1,40})/i])
    : [];
  for (const [label, values] of [
    ["releaseCandidateSha", releaseCandidateValues],
    ["candidate_ref", candidateRefValues],
  ]) {
    for (const value of values) {
      if (!fullCommitSha(value)) {
        errors.push(`${label} ${value} must be a full 40-hex SHA`);
      } else if (candidate?.commit && !sameFullCommitSha(value, candidate.commit)) {
        errors.push(`${label} ${value} does not match current ${candidate.commit.slice(0, 12)}`);
      }
    }
  }

  const evidenceSignoffValues = shaValuesForPatterns(text, [
    /\bevidenceSignoffSha\s*[:=]\s*([0-9a-f]{1,40})/i,
    /\bevidence signoff SHA\s*[:=]?\s*([0-9a-f]{1,40})/i,
  ]);
  for (const value of evidenceSignoffValues) {
    if (!fullCommitSha(value)) {
      errors.push(`evidenceSignoffSha ${value} must be a full 40-hex SHA`);
    } else if (candidate?.signoffCommit && !sameFullCommitSha(value, candidate.signoffCommit)) {
      errors.push(`evidenceSignoffSha ${value} does not match current signoff ${candidate.signoffCommit.slice(0, 12)}`);
    }
  }

  return errors;
}

function candidateIdentityIntegrityProblems(candidate) {
  const dirtyIdentityFiles = candidate?.dirtyIdentityFiles ?? [];
  const problems = [];
  if (Array.isArray(dirtyIdentityFiles) && dirtyIdentityFiles.length > 0) {
    problems.push(`release identity files must be committed before readiness: ${dirtyIdentityFiles.join(", ")}`);
  }
  problems.push(...(candidate?.signoffIntegrityProblems ?? []));
  return problems;
}

function routeSignalRequirements(route) {
  if (route === "/") return [/native/i, /no web chrome|without web chrome/i];
  if (route === "/search") return [/native/i, /\/watch\/:id|watch route|\/watch\//i, /no web chrome|without web chrome/i];
  if (route === "/library") return [
    /native/i,
    /saved/i,
    /follow/i,
    /no web chrome|without web chrome/i,
    /release-owned test account|test account/i,
    /seeded/i,
    /account-safe|redacted/i,
  ];
  if (route === "/creator/:handle") return [/native/i, /creator/i, /\/watch\/:id|watch route|\/watch\//i];
  if (route === "/explore") return [/embed=native/i, /dataSaver=1/i, /web chrome.*hidden|hidden web chrome|no web chrome/i];
  if (route === "/gsav-diagnostics") return [/embed=native/i, /capabilities|diagnostics|bridge/i];
  if (route === "/watch/test") return [/embed=native/i, /ready|unsupported/i, /resume|progress/i];
  if (route === "/gsav/test?t=2.5") return [/embed=native/i, /\/watch\/test/i, /2\.5|start time/i];
  return [];
}

function isEmbeddedRoute(route) {
  return route === "/explore"
    || route === "/gsav-diagnostics"
    || route === "/watch/test"
    || route === "/gsav/test?t=2.5";
}

function productionHttpsUrlProblem(value, label) {
  try {
    const parsed = new URL(String(value ?? ""));
    if (parsed.protocol !== "https:" || isLocalOrPrivateHostname(parsed.hostname)) {
      return label;
    }
    return null;
  } catch {
    return label;
  }
}

function concreteDeviceIdentityProblem(device, platform) {
  const value = String(device ?? "").trim();
  if (!value || /^(?:tbd|todo|pending|unknown|n\/a|na|device|test device|emulator|simulator|ci|android|ios|android\/ios)$/i.test(value)) {
    return "concrete device identity";
  }

  const hasAndroidDevice = /\b(?:pixel|galaxy|nexus|samsung|oneplus|moto|android emulator|android device|sm-[a-z0-9]+|api\s*\d+)\b/i.test(value);
  const hasIosDevice = /\b(?:iphone|ipad|ios simulator|ios device|simulator)\b/i.test(value);
  if (platform === "Android" && !hasAndroidDevice) return "concrete Android device identity";
  if (platform === "iOS" && !hasIosDevice) return "concrete iOS device identity";
  if (platform === "Android/iOS" && (!hasAndroidDevice || !hasIosDevice)) return "concrete Android and iOS device identities";
  return null;
}

function buildProfileProblem(text) {
  const value = String(text ?? "");
  if (/build profile\s*[:=]\s*development\b|profile\s*[:= ]\s*development\b|development build/i.test(value)) {
    return "release or production validation build profile";
  }
  if (/build profile\s*[:=]\s*(?:release|production(?: validation build)?|production validation)\b|profile\s*[:= ]\s*(?:release|production)\b|release build|production validation build/i.test(value)) {
    return null;
  }
  return "build profile";
}

function dryRunArtifactIdentityProblems(text, candidate) {
  const errors = [];
  const hasReleaseCandidateSha = /\breleaseCandidateSha\s*[:=]\s*[0-9a-f]{1,40}\b/i.test(text);
  const hasDryRunArtifact = /\bdry[- ]run artifact\s*[:=]?\s*diveo-release-evidence-v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/i.test(text);
  const dryRunRunUrl = detailFieldValue(text, ["dry-run run URL", "dry-run workflow URL"]);
  const hasDryRunRunUrl = trustedGithubReleaseRunUrl(dryRunRunUrl);
  const hasReleaseEquivalentException = /\brelease-equivalent\b/i.test(text) && /\bexception\b/i.test(text);

  if (!hasReleaseCandidateSha) {
    errors.push("releaseCandidateSha");
  }
  if (hasReleaseCandidateSha) {
    errors.push(...releaseCandidateShaDetailProblems(text, candidate));
  }
  if (hasReleaseEquivalentException) {
    const releaseEquivalentRequirements = [
      ["release-equivalent no-publish decision", /\b(?:releaseEquivalentNoPublish\s*=\s*true|no-publish|no publish)\b/i],
      ["release-equivalent reviewer", /\b(?:releaseEquivalentReviewer|reviewer)\s*[:=]\s*[^;|]{3,}/i],
    ];
    errors.push(...releaseEquivalentRequirements
      .filter(([, pattern]) => !pattern.test(text))
      .map(([label]) => label));
    return errors;
  }

  if (!hasDryRunArtifact) {
    errors.push("fixed dry-run artifact identity");
  }
  if (!hasDryRunRunUrl) {
    errors.push("fixed exact trusted Diveo release Actions run URL");
  }
  return errors;
}

function deviceDetailProblems(row, requirement, options = {}) {
  const text = detailText(row);
  const errors = [];

  const deviceProblem = concreteDeviceIdentityProblem(row.device, requirement.platform);
  if (deviceProblem) errors.push(deviceProblem);

  const gsavUrlProblem = productionHttpsUrlProblem(row.gsavWebUrl, "production/staging HTTPS GSAV URL");
  if (gsavUrlProblem) errors.push(gsavUrlProblem);

  const profileProblem = buildProfileProblem(text);
  if (profileProblem) errors.push(profileProblem);

  const commonRequirements = [
    ["command/manual action", /manual action|command\s*[:=]|action\s*[:=]|tested by/i],
    ["GSAV host identity", /gsav-hosting commit|GSAV host identity|deployed host|host build/i],
  ];

  const platformRequirements = requirement.platform === "Android"
    ? [
        ["Android OS version", /Android\s+(?:OS\s*)?\d+|API\s*\d+|OS version\s*[:=]\s*Android/i],
        ["WebView version", /WebView\s*(?:version)?\s*[:= ]?\s*\d|Chromium\s+\d/i],
      ]
    : [
        ["iOS OS version", /iOS\s+\d|OS version\s*[:=]\s*iOS/i],
        ["WKWebView version", /WKWebView\s*(?:version)?\s*[:= ]?\s*[\d.]+|WebKit\s+\d|Safari\s+\d/i],
      ];

  for (const [label, pattern] of [...commonRequirements, ...platformRequirements]) {
    if (!pattern.test(text)) errors.push(label);
  }

  const ergonomicRequirements = [
    ["rotation check", /rotat|portrait|landscape/i],
    ["safe-area check", /safe area|safe-area|notch|home indicator/i],
    ["44dp touch target check", /44\s*dp|touch target/i],
    ["clipped text check", /clipped text|text clipping|no clipping|not clipped|not truncated/i],
    ["nested-touch check", /nested touch|nested-touch|touch ambiguity|tap target conflict/i],
    ["back gesture check", /hardware back|back gesture|system back|Android back|iOS back/i],
  ];
  for (const [label, pattern] of ergonomicRequirements) {
    if (!pattern.test(text)) errors.push(label);
  }

  if (isEmbeddedRoute(requirement.route) && !/final embedded WebView URL|embedded WebView URL|WebView URL|WKWebView URL|embedded URL/i.test(text)) {
    errors.push("final embedded WebView URL");
  }

  errors.push(...dryRunArtifactIdentityProblems(text, options.candidate));

  return errors;
}

function negativeParityProblems(row) {
  const text = detailText(row);
  const route = row.route;
  const errors = [];

  if (route === "Missing host config" || route === "Host offline/retry") {
    if (!/(?:intended|target|production\/staging|EXPO_PUBLIC_GSAV_WEB_URL)[^;|]*https:\/\//i.test(text)) {
      errors.push("intended production/staging GSAV host");
    }
  }

  const qaFlagByRoute = {
    "Cross-origin navigation": /EXPO_PUBLIC_GSAV_QA_CONTROLS\s*=\s*1|QA flag used\s*[:=]\s*EXPO_PUBLIC_GSAV_QA_CONTROLS=1/i,
    "Unsupported renderer": /EXPO_PUBLIC_GSAV_QA_CONTROLS\s*=\s*1|QA flag used\s*[:=]\s*EXPO_PUBLIC_GSAV_QA_CONTROLS=1/i,
    "Ended playback": /EXPO_PUBLIC_GSAV_QA_CONTROLS\s*=\s*1|QA flag used\s*[:=]\s*EXPO_PUBLIC_GSAV_QA_CONTROLS=1/i,
    "Auth initialization gate": /EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS\s*=\s*5000|QA flag used\s*[:=]\s*EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000/i,
  };
  const qaFlagPattern = qaFlagByRoute[route];
  if (qaFlagPattern) {
    if (!/(QA validation build parity|release-equivalent validation build|production-config proof)/i.test(text)) {
      errors.push("QA validation build parity");
    }
    if (!qaFlagPattern.test(text)) {
      errors.push("QA flag used");
    }
    if (!/production prerequisite evidence no QA flags\s*=\s*true|no production QA flags|production[^;|]*QA flags[^;|]*(?:disabled|absent|false)/i.test(text)) {
      errors.push("production no-QA-flag proof");
    }
  }

  return errors;
}

function negativeSignalRequirements(route) {
  if (route === "Missing host config") return [/config|configuration/i, /not blank|no blank/i];
  if (route === "Host offline/retry") return [/retry|error/i, /recover/i];
  if (route === "Cross-origin navigation") return [/block/i];
  if (route === "Unsupported renderer") return [/unsupported|error/i];
  if (route === "Auth initialization gate") return [/no clear-session|no clear session/i];
  if (route === "Ended playback") return [/GSAV_ENDED/i, /clear/i, /resume|progress/i];
  return [];
}

function negativeDetailProblems(row, options = {}) {
  const text = detailText(row);
  const errors = [];
  const deviceProblem = concreteDeviceIdentityProblem(row.device, "Android/iOS");
  if (deviceProblem) errors.push(deviceProblem);

  const gsavUrlProblem = productionHttpsUrlProblem(row.gsavWebUrl, "production/staging HTTPS GSAV URL");
  if (gsavUrlProblem) errors.push(gsavUrlProblem);

  const profileProblem = buildProfileProblem(text);
  if (profileProblem) errors.push(profileProblem);

  const requirements = [
    ["Android OS version", /Android\s+(?:OS\s*)?\d+|API\s*\d+|OS version\s*[:=]\s*Android/i],
    ["Android WebView version", /Android[^;|]*(WebView|Chromium)\s*(?:version)?\s*[:= ]?\s*\d|WebView\s*(?:version)?\s*[:= ]?\s*\d|Chromium\s+\d/i],
    ["iOS OS version", /iOS\s+\d|OS version\s*[:=]\s*iOS/i],
    ["iOS WKWebView version", /WKWebView\s*(?:version)?\s*[:= ]?\s*[\d.]+|WebKit\s+\d|Safari\s+\d/i],
    ["trigger/action", /trigger\s*[:=]|manual action|command\s*[:=]|action\s*[:=]|tested by/i],
    ["GSAV host identity", /gsav-hosting commit|GSAV host identity|deployed host|host build/i],
  ];

  errors.push(...requirements
    .filter(([, pattern]) => !pattern.test(text))
    .map(([label]) => label));
  errors.push(...negativeParityProblems(row));
  errors.push(...dryRunArtifactIdentityProblems(text, options.candidate));
  return errors;
}

function versionCodeDetailProblems(text, candidate, options = {}) {
  const errors = [];
  const required = [
    ["android:version-metadata command", /npm run android:version-metadata|android:version-metadata/i],
    ["--expected-version-code argument", /--expected-version-code/i],
    ["release-evidence/apk-version-metadata.txt", /release-evidence[\\/]apk-version-metadata\.txt|apk-version-metadata\.txt/i],
    ["Gradle versionCode", /Gradle[^|;,.]*versionCode\s*[:= ]?\s*\d+/i],
    ["app.json versionCode", /app\.json[^|;,.]*versionCode\s*[:= ]?\s*\d+/i],
  ];
  const hasApkBadgingMetadata = /(?:APK\s+badging|aapt(?:\.exe)?\s+dump\s+badging|badging)[^|;,.]*versionCode\s*[:= ]?\s*\d+/i.test(text);
  const hasAcceptedGeneratedMetadataSource = /(?:aapt(?:\.exe)?\s+dump\s+badging|apkanalyzer(?:\s+manifest\s+print)?|bundletool(?:\s+dump\s+manifest)?|apk-version-metadata)[^|;,.]*versionCode\s*[:= ]?\s*\d+/i.test(text);
  const hasGeneratedApkMetadata = hasApkBadgingMetadata || hasAcceptedGeneratedMetadataSource;

  for (const [label, pattern] of required) {
    if (!pattern.test(text)) errors.push(label);
  }

  if (!hasGeneratedApkMetadata && !hasNamedException(text, options)) {
    errors.push("generated APK metadata/versionCode or owner/revisit exception");
  } else if (!hasGeneratedApkMetadata && !hasAcceptedGeneratedMetadataSource) {
    errors.push("accepted generated APK metadata source");
  }

  const observedCodes = [...text.matchAll(/versionCode\s*[:= ]?\s*(\d+)/gi)].map((match) => Number(match[1]));
  if (candidate?.versionCode) {
    const mismatched = observedCodes.filter((value) => value !== Number(candidate.versionCode));
    if (mismatched.length > 0) {
      errors.push(`versionCode value must match app.json ${candidate.versionCode}`);
    }
  }

  return errors;
}

function isLocalOrPrivateHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipv4Mapped = /(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(normalized);
  if (ipv4Mapped) {
    return isLocalOrPrivateHostname(ipv4Mapped[1]);
  }

  if (normalized.includes(":")) {
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
    const firstHextet = normalized.split(":")[0];
    if (/^[0-9a-f]{1,4}$/i.test(firstHextet)) {
      const first = Number.parseInt(firstHextet, 16);
      if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local.
      if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local.
    }
  }

  return normalized === "localhost"
    || normalized === "0.0.0.0"
    || normalized === "::1"
    || normalized === "10.0.2.2"
    || normalized.endsWith(".local")
    || /^127\./.test(normalized)
    || /^10\./.test(normalized)
    || /^192\.168\./.test(normalized)
    || /^169\.254\./.test(normalized)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

function extractRangeProbeUrl(text) {
  const envMatch = /GSAV_RANGE_PROBE_URL\s*[:=]\s*(https?:\/\/[^\s;|,]+)/i.exec(text);
  if (envMatch) return envMatch[1];

  const gsavUrlMatch = /(https?:\/\/[^\s;|,]+\.gsav(?:\?[^\s;|,]+)?)/i.exec(text);
  return gsavUrlMatch?.[1] ?? null;
}

function headerValue(text, headerName) {
  const escaped = headerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*(?::|=)\\s*([^;|\\r\\n]+)`, "i").exec(text);
  return match?.[1]?.trim().replace(/\.$/, "") ?? null;
}

function hasExposedHeader(exposeHeaders, headerName) {
  if (!exposeHeaders) return false;
  const normalized = headerName.toLowerCase();
  return String(exposeHeaders)
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .includes(normalized);
}

function productionGsavOrigin(text, rangeUrl) {
  const urls = text.match(/https?:\/\/[^\s;|,)]+/gi) ?? [];
  for (const candidate of urls) {
    try {
      const parsed = new URL(candidate);
      if (/github\.com$/i.test(parsed.hostname)) continue;
      if (/\.gsav$/i.test(parsed.pathname)) continue;
      return parsed.origin;
    } catch {
      // Keep scanning for another URL.
    }
  }

  try {
    return new URL(rangeUrl).origin;
  } catch {
    return null;
  }
}

function corsAllowOriginMatches(allowOrigin, expectedOrigin) {
  const value = String(allowOrigin ?? "").trim();
  if (value === "*") return true;
  if (!value || !expectedOrigin) return false;

  try {
    return new URL(value).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function rangeProbeDetailProblems(text) {
  const errors = [];
  const url = extractRangeProbeUrl(text);
  if (!url) {
    errors.push("production .gsav URL");
    return errors;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      errors.push("production .gsav URL must use https");
    }
    if (isLocalOrPrivateHostname(parsed.hostname)) {
      errors.push("production .gsav URL must not use local/private host");
    }
  } catch {
    errors.push("valid production .gsav URL");
  }

  if (!/Content-Range\s*[:=]?\s*bytes\s+0\s*-\s*0\/\d+\b/i.test(text)) {
    errors.push("Content-Range bytes 0-0/<size> value");
  }

  const allowOrigin = headerValue(text, "Access-Control-Allow-Origin");
  if (!allowOrigin) {
    errors.push("Access-Control-Allow-Origin");
  } else if (!corsAllowOriginMatches(allowOrigin, productionGsavOrigin(text, url))) {
    errors.push("Access-Control-Allow-Origin must be * or production GSAV origin");
  }

  const exposeHeaders = headerValue(text, "Access-Control-Expose-Headers");
  for (const header of ["Accept-Ranges", "Content-Length", "Content-Range", "ETag"]) {
    if (!hasExposedHeader(exposeHeaders, header)) {
      errors.push(`Access-Control-Expose-Headers includes ${header}`);
    }
  }

  return errors;
}

function extractLabeledUrl(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*(?::|=)\\s*(https?:\\/\\/[^\\s;|,)]+)`, "i").exec(text);
    if (match) return match[1];
  }
  return null;
}

function validationPrereqDetailProblems(text) {
  const errors = [];
  const required = [
    ["validation command", /npm run verify:validation-prereqs/i],
    ["--apk-path", /--apk-path/i],
    ["--manifest-path", /--manifest-path/i],
    ["--output-path", /--output-path|output path|docs[\\/]qa-evidence|release-evidence[\\/]validation-prereqs\.json/i],
    ["production env/secrets", /production env|production secrets|env\/secrets|secrets configured/i],
    ["adb devices", /adb devices/i],
    ["connected Android device in device state", /connected.*device|device state|state.*device|in device state/i],
    ["Android device model", /Android device model\s*[:=]|device model\s*[:=]|model\s*[:=]\s*(?:Pixel|Galaxy|Nexus|Samsung|OnePlus|Moto|Android)/i],
    ["Android OS/API", /Android\s+(?:OS\s*)?\d+|Android OS version\s*[:=]|API\s*\d+/i],
    ["Android build identity", /Android build fingerprint\s*[:=]|build fingerprint\s*[:=]|build incremental\s*[:=]|ro\.build\.fingerprint|ro\.build\.version\.incremental/i],
    ["Android WebView package/version", /Android WebView package\s*[:=]|webViewPackageName\s*[:=]|Android WebView version\s*[:=]|WebView\s*(?:package\/)?version\s*[:=]?\s*\d|Chromium\s+\d/i],
    ["java", /\bjava\b/i],
    ["npx", /\bnpx\b/i],
    ["GitHub CLI", /\bgh\b|GitHub CLI/i],
    ["generated APK metadata tool", /\baapt\b|\bapkanalyzer\b|\bbundletool\b/i],
    ["APK path", /APK path|--apk-path\s+\S+/i],
    ["merged manifest path", /merged manifest path|manifest path|--manifest-path\s+\S+/i],
    ["iOS validation environment", /\bmacOS\b|\bXcode\b|\bxcrun\b|physical iOS device|iOS simulator/i],
    ["checked.ios metadata", /checked\.ios/i],
    ["IOS_VALIDATION_OWNER", /IOS_VALIDATION_OWNER/i],
    ["IOS_VALIDATION_EXECUTOR_PROOF", /IOS_VALIDATION_EXECUTOR_PROOF/i],
    ["IOS_VALIDATION_DEVICE", /IOS_VALIDATION_DEVICE/i],
    ["IOS_VALIDATION_VERSION", /IOS_VALIDATION_VERSION/i],
    ["IOS_WKWEBVIEW_VERSION", /IOS_WKWEBVIEW_VERSION|IOS_WEBKIT_VERSION/i],
    ["IOS_VALIDATION_ARTIFACT_URL", /IOS_VALIDATION_ARTIFACT_URL/i],
    ["IOS_VALIDATION_ARTIFACT_SHA256", /IOS_VALIDATION_ARTIFACT_SHA256/i],
    ["IOS_VALIDATION_ARTIFACT_PATH", /IOS_VALIDATION_ARTIFACT_PATH|--ios-artifact-path/i],
    ["iOS validation artifact URL", /iOS (?:validation )?artifact URL\s*[:=]|trusted.*iOS.*artifact|iOS.*trusted GitHub/i],
    ["iOS validation artifact SHA256", /iOS (?:validation )?artifact SHA256\s*[:=]\s*[a-f0-9]{64}\b|IOS_VALIDATION_ARTIFACT_SHA256[^;|]*[a-f0-9]{64}\b/i],
    ["computed iOS validation artifact SHA256", /computed(?:Ios|iOS)?(?:Validation)?ArtifactSha256\s*[:=]\s*[a-f0-9]{64}\b|computed iOS (?:validation )?artifact SHA256\s*[:=]\s*[a-f0-9]{64}\b/i],
    ["iOS artifact SHA256 match", /iOS(?: validation)? artifact SHA256 matches declared checksum|artifactSha256Matches\s*=\s*true|iosArtifactSha256Matches\s*=\s*true/i],
    ["iOS device identity", /iOS (?:simulator|device)|iPhone|iPad/i],
    ["iOS version", /iOS(?: OS)? version\s*[:=]|iOS\s+\d/i],
    ["iOS WKWebView/WebKit version", /WKWebView\s*(?:version)?\s*[:= ]?\s*[\d.]+|WebKit\s+\d|Safari\s+\d/i],
    ["iOS validation owner", /iOS (?:device |validation )?owner\s*[:=]|owner\s*[:=][^;|]*(?:iOS|WKWebView|Xcode)/i],
    ["Supabase anon key", /Supabase anon key|EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY/i],
    ["production QA flags disabled", /no production QA flags|QA flags.*(?:disabled|absent|false|0)|QA-only.*(?:disabled|absent)|EXPO_PUBLIC_GSAV_QA_CONTROLS.*(?:disabled|absent|0|false)|EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS.*(?:disabled|absent|0|false)/i],
    ["release-evidence:attach-validation-prereqs", /release-evidence:attach-validation-prereqs|release-evidence:attach validation prereqs|attach-validation-prereqs/i],
    ["strict release-evidence bundle verifier", /verify:release-evidence-bundle[\s\S]*--require-validation-prereqs|--require-validation-prereqs\s+true/i],
    ["device-validation-bundle-verifier.json", /device-validation-evidence[\\/]device-validation-bundle-verifier\.json/i],
    ["downloaded-release/release-evidence upload", /downloaded-release[\\/]release-evidence[\\/]\*\*|uploaded attached.*downloaded-release[\\/]release-evidence/i],
    ["diveo-device-validation artifact", /diveo-device-validation-(?:\d{4}-\d{2}-\d{2}|\$\{\{\s*inputs\.evidence_date\s*\}\})-(?:\d+|\$\{\{\s*inputs\.release_run_id\s*\}\})/i],
  ];

  errors.push(...required
    .filter(([, pattern]) => !pattern.test(text))
    .map(([label]) => label));

  for (const { label, aliases } of [
    { label: "EXPO_PUBLIC_GSAV_WEB_URL", aliases: ["EXPO_PUBLIC_GSAV_WEB_URL", "GSAV_WEB_URL", "production GSAV web URL"] },
    { label: "EXPO_PUBLIC_GSAV_CATALOG_URL", aliases: ["EXPO_PUBLIC_GSAV_CATALOG_URL", "production GSAV catalog URL", "GSAV catalog URL"] },
    { label: "EXPO_PUBLIC_GSAV_SUPABASE_URL", aliases: ["EXPO_PUBLIC_GSAV_SUPABASE_URL", "production Supabase URL", "Supabase URL"] },
    { label: "GSAV_RANGE_PROBE_URL", aliases: ["GSAV_RANGE_PROBE_URL", "production range probe URL"] },
    { label: "GSAV_HOST_IDENTITY_URL", aliases: ["GSAV_HOST_IDENTITY_URL", "host identity URL"] },
  ]) {
    const url = extractLabeledUrl(text, aliases);
    if (!url) {
      errors.push(`${label} non-local HTTPS URL`);
      continue;
    }
    errors.push(...releaseDryRunUrlProblems(label, url));
    if (label === "GSAV_RANGE_PROBE_URL" && !/\.gsav(?:[?#]|$)/i.test(url)) {
      errors.push("GSAV_RANGE_PROBE_URL .gsav URL");
    }
  }

  const hostingCommit = releaseDryRunIdentityField(text, "GSAV_HOSTING_COMMIT");
  if (weakHostIdentityValue(hostingCommit)) {
    errors.push("explicit GSAV_HOSTING_COMMIT value");
  }

  return errors;
}

function extractAuditField(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*=\\s*([^;|,\\s]+)`, "i").exec(text);
    if (match) return match[1].trim();
  }
  return null;
}

function extractShaField(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*[:=]\\s*([0-9a-f]{1,40})\\b`, "i").exec(text);
    if (match) return match[1].trim();
  }
  return null;
}

function isIsoTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(value ?? ""))) {
    return false;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const normalized = String(value).includes(".") ? String(value) : String(value).replace(/Z$/, ".000Z");
  return parsed.toISOString() === normalized;
}

function finalPublishSignoffSection(auditText) {
  const text = String(auditText ?? "");
  const match = /^##\s+Final Publish Signoff\s*$/im.exec(text);
  if (!match) return null;
  const sectionText = text.slice(match.index + match[0].length);
  const nextSection = /\n##\s+/m.exec(sectionText);
  return (nextSection ? sectionText.slice(0, nextSection.index) : sectionText).trim();
}

function normalizedAuditPath(value) {
  return normalizeGitPath(String(value ?? "").trim().replace(/^["'`]|["'`]$/g, ""));
}

function sha256Text(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function qaEvidenceDateFromPath(value, pattern) {
  const match = pattern.exec(normalizedAuditPath(value));
  return match?.[1] ?? null;
}

function auditEvidencePathProblems(fieldText, {
  externalEvidenceInventoryPath = null,
  devicePacketPath = null,
} = {}) {
  const errors = [];
  let inventoryDate = null;
  let deviceDate = null;
  const inventoryPath = extractAuditField(fieldText, [
    "externalEvidenceInventoryPath",
    "EXTERNAL_EVIDENCE_INVENTORY_PATH",
  ]);
  const devicePath = extractAuditField(fieldText, [
    "deviceEvidencePacketPath",
    "DEVICE_EVIDENCE_PACKET_PATH",
  ]);

  const inventoryPattern = /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/external-evidence-inventory\.json$/i;
  const devicePattern = /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/[^/]+\.json$/i;

  if (!inventoryPath || /_pending_|pending|tbd|todo|placeholder|<[^>]+>/i.test(inventoryPath)) {
    errors.push("audit signoff must include externalEvidenceInventoryPath=docs/qa-evidence/<date>/external-evidence-inventory.json");
  } else {
    const normalizedInventoryPath = normalizedAuditPath(inventoryPath);
    inventoryDate = qaEvidenceDateFromPath(normalizedInventoryPath, inventoryPattern);
    if (!inventoryDate) {
      errors.push("audit signoff externalEvidenceInventoryPath must be docs/qa-evidence/<date>/external-evidence-inventory.json");
    }
    if (
      externalEvidenceInventoryPath
      && normalizedAuditPath(externalEvidenceInventoryPath) !== normalizedInventoryPath
    ) {
      errors.push("audit signoff externalEvidenceInventoryPath must match EXTERNAL_EVIDENCE_INVENTORY_PATH");
    }
  }

  if (!devicePath || /^(?:_?pending_?|tbd|todo|placeholder)$/i.test(devicePath.trim()) || /<[^>]+>/i.test(devicePath)) {
    errors.push("audit signoff must include deviceEvidencePacketPath=<reviewed packet json under docs/qa-evidence>");
  } else {
    const normalizedDevicePath = normalizedAuditPath(devicePath);
    deviceDate = qaEvidenceDateFromPath(normalizedDevicePath, devicePattern);
    if (!deviceDate) {
      errors.push("audit signoff deviceEvidencePacketPath must be a reviewed packet JSON under docs/qa-evidence/<date>");
    }
    if (/(?:scaffold|candidate|pending|example)/i.test(path.basename(normalizedDevicePath))) {
      errors.push("audit signoff deviceEvidencePacketPath must not reference a scaffold, candidate, pending, or example packet");
    }
    if (devicePacketPath && normalizedAuditPath(devicePacketPath) !== normalizedDevicePath) {
      errors.push("audit signoff deviceEvidencePacketPath must match DEVICE_EVIDENCE_PACKET_PATH");
    }
  }

  if (inventoryDate && deviceDate && inventoryDate !== deviceDate) {
    errors.push("audit signoff externalEvidenceInventoryPath and deviceEvidencePacketPath must use the same docs/qa-evidence/<date> folder");
  }

  return errors;
}

function finalCommandReceiptsPathFromAudit(auditText) {
  const signoffText = finalPublishSignoffSection(auditText);
  if (!signoffText) return null;
  const receiptPath = extractAuditField(signoffText, [
    "finalCommandReceiptsPath",
    "FINAL_COMMAND_RECEIPTS_PATH",
  ]);
  if (!receiptPath) return null;
  const normalized = normalizedAuditPath(receiptPath);
  return /^docs\/qa-evidence\/\d{4}-\d{2}-\d{2}\/final-command-receipts\/verification-summary\.json$/i.test(normalized)
    ? normalized
    : null;
}

function stackReceiptPathFromAudit(auditText) {
  const signoffText = finalPublishSignoffSection(auditText);
  if (!signoffText) return null;
  const stackReceiptPath = extractAuditField(signoffText, [
    "stackReceiptPath",
    "STACK_ARCHITECTURE_RECEIPT_PATH",
  ]);
  if (!stackReceiptPath) return null;
  const normalized = normalizedAuditPath(stackReceiptPath);
  return /^docs\/qa-evidence\/\d{4}-\d{2}-\d{2}\/stack-architecture-receipt\.json$/i.test(normalized)
    ? normalized
    : null;
}

function lastMileEvidencePathsFromAudit(auditText) {
  const signoffText = finalPublishSignoffSection(auditText);
  if (!signoffText) return [];
  return [
    ["lastMileReleaseStateEvidence", /^docs\/qa-evidence\/\d{4}-\d{2}-\d{2}\/github-release-state-prepublish\.json$/i],
    ["lastMilePublishHashGuardEvidence", /^docs\/qa-evidence\/\d{4}-\d{2}-\d{2}\/publish-hash-variable-guard-prepublish\.json$/i],
  ].flatMap(([fieldName, pattern]) => {
    const value = extractAuditField(signoffText, [fieldName]);
    if (!value) return [];
    const normalizedPath = normalizedAuditPath(value);
    return pattern.test(normalizedPath) ? [normalizedPath] : [];
  });
}

function auditJsonEvidencePath(fieldText, {
  fieldNames,
  pathPattern,
  label,
  expectedDate = null,
  errors,
}) {
  const rawPath = extractAuditField(fieldText, fieldNames);
  if (!rawPath || /_pending_|pending|tbd|todo|placeholder|<[^>]+>/i.test(rawPath)) {
    errors.push(`audit signoff must include ${fieldNames[0]}=${label}`);
    return null;
  }
  const normalizedPath = normalizedAuditPath(rawPath);
  const date = qaEvidenceDateFromPath(normalizedPath, pathPattern);
  if (!date) {
    errors.push(`audit signoff ${fieldNames[0]} must be ${label}`);
    return null;
  }
  if (expectedDate && date !== expectedDate) {
    errors.push(`audit signoff ${fieldNames[0]} must use the same docs/qa-evidence/<date> folder as final receipt paths`);
  }
  return { path: normalizedPath, date };
}

function auditStackArchitectureReceiptProblems(root, stackReceiptPath) {
  if (!stackReceiptPath) return [];
  const errors = [];
  const absolutePath = path.join(root, stackReceiptPath);
  if (!fs.existsSync(absolutePath)) {
    return [`audit signoff stackReceiptPath missing at ${relativeOrOriginal(root, stackReceiptPath)}`];
  }

  let receipt;
  try {
    receipt = readJson(absolutePath);
  } catch {
    return ["audit signoff stackReceiptPath must contain valid stack architecture receipt JSON"];
  }

  for (const problem of validateStackArchitectureReceipt(receipt)) {
    errors.push(`audit stack architecture receipt ${problem}`);
  }
  if (receipt.doctor?.ok !== true) {
    errors.push("audit stack architecture receipt doctor.ok must be true");
  }
  if (receipt.doctor?.requireAssets !== true) {
    errors.push("audit stack architecture receipt doctor.requireAssets must be true");
  }
  if (receipt.doctor?.skipNetwork !== false) {
    errors.push("audit stack architecture receipt doctor.skipNetwork must be false");
  }
  if (receipt.catalog?.schemaVersion !== 1) {
    errors.push("audit stack architecture receipt catalog.schemaVersion must be 1");
  }

  return errors;
}

function finalReceiptStepLogProblems({
  root,
  receiptDir,
  step,
  stepIndex,
}) {
  const errors = [];
  const stepLabel = String(step?.label ?? `step ${stepIndex + 1}`);
  const logSpecs = [
    ["stdoutPath", "stdoutSha256", ".stdout.log"],
    ["stderrPath", "stderrSha256", ".stderr.log"],
  ];
  const contents = {};

  for (const [pathField, hashField, suffix] of logSpecs) {
    const rawPath = String(step?.[pathField] ?? "").trim();
    const hash = String(step?.[hashField] ?? "").trim();
    const normalizedPath = normalizedAuditPath(rawPath);
    const logLabel = pathField.replace("Path", "");
    let content = null;

    if (!normalizedPath || normalizedPath !== path.posix.basename(normalizedPath) || !normalizedPath.endsWith(suffix)) {
      errors.push(`audit final command receipts step ${stepLabel} ${pathField} must be a ${suffix} file under final-command-receipts`);
    } else {
      const absolutePath = path.join(root, receiptDir, normalizedPath);
      if (!fs.existsSync(absolutePath)) {
        errors.push(`audit final command receipts step ${stepLabel} ${pathField} missing at ${receiptDir}/${normalizedPath}`);
      } else {
        content = fs.readFileSync(absolutePath, "utf8");
      }
    }

    if (!/^[a-f0-9]{64}$/i.test(hash)) {
      errors.push(`audit final command receipts step ${stepLabel} must include ${hashField}=<64-hex sha>`);
    } else if (content !== null) {
      const actualHash = sha256Text(content);
      if (actualHash !== hash.toLowerCase()) {
        errors.push(`audit final command receipts step ${stepLabel} ${logLabel} hash must match ${pathField} bytes`);
      }
    }
    contents[logLabel] = content;
  }

  const combinedSha256 = String(step?.combinedSha256 ?? "").trim();
  if (!/^[a-f0-9]{64}$/i.test(combinedSha256)) {
    errors.push(`audit final command receipts step ${stepLabel} must include combinedSha256=<64-hex sha>`);
  } else if (contents.stdout !== null && contents.stderr !== null) {
    const actualCombinedHash = sha256Text(`${contents.stdout}${contents.stderr}`);
    if (actualCombinedHash !== combinedSha256.toLowerCase()) {
      errors.push(`audit final command receipts step ${stepLabel} combinedSha256 must match stdout plus stderr bytes`);
    }
  }

  return errors;
}

function finalReceiptStepSetProblems(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return ["audit final command receipts summary must include step receipt entries"];
  }

  const actualLabels = steps.map((step) => String(step?.label ?? ""));
  const matchesExpected = actualLabels.length === FINAL_RECEIPT_EXPECTED_STEP_LABELS.length
    && FINAL_RECEIPT_EXPECTED_STEP_LABELS.every((label, index) => actualLabels[index] === label);

  if (matchesExpected) return [];

  return [
    `audit final command receipts summary must include exactly the ${FINAL_RECEIPT_EXPECTED_STEP_LABELS.length} final receipt wrapper steps in order: ${FINAL_RECEIPT_EXPECTED_STEP_LABELS.join("; ")}`,
  ];
}

function finalReceiptStepStatusProblems(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return [];

  return steps.flatMap((step, stepIndex) => {
    const stepLabel = String(step?.label ?? `step ${stepIndex + 1}`);
    const errors = [];
    if (step?.expectedStatus !== 0) {
      errors.push(`audit final command receipts step ${stepLabel} must have expectedStatus=0 for publish signoff`);
    }
    if (step?.status !== 0) {
      errors.push(`audit final command receipts step ${stepLabel} must have status=0 for publish signoff`);
    }
    return errors;
  });
}

function receiptCommandText(step) {
  return normalizeGitPath(String(step?.command ?? "")).replace(/\s+/g, " ");
}

function commandIncludes(command, expected) {
  return command.includes(normalizeGitPath(expected).replace(/\s+/g, " "));
}

function commandIncludesOptionValue(command, option, value) {
  const normalizedValue = normalizeGitPath(String(value ?? "")).replace(/\s+/g, " ");
  return commandIncludes(command, option) && normalizedValue && command.includes(normalizedValue);
}

function requireCommandParts({
  step,
  label,
  parts,
  description,
}) {
  const command = receiptCommandText(step);
  const missing = parts.filter((part) => !commandIncludes(command, part));
  if (missing.length === 0) return [];
  return [`audit final command receipts ${label} step must run ${description}`];
}

function finalReceiptInternalStepCommandProblems({
  steps,
  receiptDate,
  normalizedInventoryPath,
  normalizedDevicePath,
  normalizedStackReceiptPath,
  expectedCandidateSha,
  qaPath,
}) {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const byLabel = new Map(steps.map((step) => [step?.label, step]));
  const normalizedQaPath = normalizedAuditPath(qaPath || QA_EVIDENCE_PATH);
  const errors = [];

  errors.push(...requireCommandParts({
    step: byLabel.get("Documentation drift audit"),
    label: "Documentation drift audit",
    parts: ["scripts/verify-doc-drift.js"],
    description: "verify-doc-drift.js",
  }));

  errors.push(...requireCommandParts({
    step: byLabel.get("Final readiness focused tests"),
    label: "Final readiness focused tests",
    parts: [
      "node_modules/vitest/vitest.mjs",
      "run",
      ...FINAL_RECEIPT_FOCUSED_TESTS,
    ],
    description: `node_modules/vitest/vitest.mjs run ${FINAL_RECEIPT_FOCUSED_TESTS.join(" ")}`,
  }));

  errors.push(...requireCommandParts({
    step: byLabel.get("External evidence inventory replay"),
    label: "External evidence inventory replay",
    parts: [
      "scripts/verify-external-evidence-inventory.js",
      `--inventory-path ${normalizedInventoryPath}`,
      `--qa-path ${normalizedQaPath}`,
      `--packet-path ${normalizedDevicePath}`,
      "--require-git-integrity",
    ],
    description: "verify-external-evidence-inventory.js with reviewed inventory, QA path, packet path, and --require-git-integrity",
  }));

  errors.push(...requireCommandParts({
    step: byLabel.get("Device packet reconciliation"),
    label: "Device packet reconciliation",
    parts: [
      "scripts/device-evidence-packet.js",
      "--check",
      `--input-path ${normalizedDevicePath}`,
      `--qa-path ${normalizedQaPath}`,
      `--candidate-sha ${expectedCandidateSha}`,
      "--require-git-integrity",
    ],
    description: "device-evidence-packet.js --check with reviewed packet, QA path, candidate SHA, and --require-git-integrity",
  }));

  errors.push(...requireCommandParts({
    step: byLabel.get("Strict handoff receipt replay"),
    label: "Strict handoff receipt replay",
    parts: [
      "scripts/verify-handoff-receipts.js",
      `--date ${receiptDate}`,
      "--require-git-integrity",
    ],
    description: "verify-handoff-receipts.js with final evidence date and --require-git-integrity",
  }));

  errors.push(...requireCommandParts({
    step: byLabel.get("Stack architecture receipt replay"),
    label: "Stack architecture receipt replay",
    parts: [
      "scripts/stack-architecture-receipt.js",
      "--require-assets",
      `--verify ${normalizedStackReceiptPath}`,
    ],
    description: "stack-architecture-receipt.js --require-assets --verify with the reviewed stack receipt",
  }));

  errors.push(...requireCommandParts({
    step: byLabel.get("Protected master ref refresh"),
    label: "Protected master ref refresh",
    parts: ["git fetch", "--no-tags", "origin", "master"],
    description: "git fetch --no-tags origin master",
  }));

  errors.push(...requireCommandParts({
    step: byLabel.get("Protected candidate ancestry proof"),
    label: "Protected candidate ancestry proof",
    parts: ["git merge-base --is-ancestor", expectedCandidateSha, "origin/master"],
    description: "git merge-base --is-ancestor <candidate-sha> origin/master",
  }));

  return errors;
}

function finalReceiptReadinessStepProblems({
  step,
  normalizedReceiptPath,
  normalizedInventoryPath,
  normalizedDevicePath,
  expectedCandidateSha,
}) {
  const errors = [];
  if (!step) {
    errors.push("audit final command receipts summary must include a passing Final release readiness step");
    return errors;
  }

  const command = normalizeGitPath(String(step.command ?? ""));
  if (!/verify-release-readiness\.js\s+--strict-final-inputs\b/.test(command)) {
    errors.push("audit final command receipts Final release readiness step must run verify-release-readiness.js --strict-final-inputs");
  }

  const env = step.env ?? {};
  const extraEnvKeys = Object.keys(env)
    .filter((key) => !FINAL_RECEIPT_ALLOWED_READINESS_ENV_KEYS.has(key));
  if (extraEnvKeys.length > 0) {
    errors.push(`audit final command receipts Final release readiness step env must only include safe final input keys: ${Array.from(FINAL_RECEIPT_ALLOWED_READINESS_ENV_KEYS).join(", ")}`);
  }
  if (normalizedInventoryPath && normalizedAuditPath(env[EXTERNAL_EVIDENCE_INVENTORY_ENV]) !== normalizedInventoryPath) {
    errors.push(`audit final command receipts Final release readiness step env ${EXTERNAL_EVIDENCE_INVENTORY_ENV} must match externalEvidenceInventoryPath`);
  }
  if (normalizedDevicePath && normalizedAuditPath(env[DEVICE_PACKET_ENV]) !== normalizedDevicePath) {
    errors.push(`audit final command receipts Final release readiness step env ${DEVICE_PACKET_ENV} must match deviceEvidencePacketPath`);
  }
  if (normalizedAuditPath(env[FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV]) !== normalizedReceiptPath) {
    errors.push(`audit final command receipts Final release readiness step env ${FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV} must match finalCommandReceiptsPath`);
  }
  if (expectedCandidateSha && !sameFullCommitSha(env.RELEASE_CANDIDATE_SHA, expectedCandidateSha)) {
    errors.push("audit final command receipts Final release readiness step env RELEASE_CANDIDATE_SHA must match the release candidate commit");
  }

  return errors;
}

function finalReceiptTimingProblems(summary, receiptDate) {
  const errors = [];
  const startedAt = String(summary.startedAt ?? "").trim();
  const finishedAt = String(summary.finishedAt ?? "").trim();
  const startedAtOk = isIsoTimestamp(startedAt) && startedAt.slice(0, 10) === receiptDate;
  const finishedAtOk = isIsoTimestamp(finishedAt) && finishedAt.slice(0, 10) === receiptDate;

  if (!startedAtOk) {
    errors.push("audit final command receipts summary startedAt must be an ISO timestamp on the final evidence date");
  }
  if (!finishedAtOk) {
    errors.push("audit final command receipts summary finishedAt must be an ISO timestamp on the final evidence date");
  }
  if (startedAtOk && finishedAtOk && Date.parse(finishedAt) < Date.parse(startedAt)) {
    errors.push("audit final command receipts summary finishedAt must not be before startedAt");
  }

  return errors;
}

function finalReceiptPassSummaryContradictionProblems(summary) {
  if (summary.status !== "pass" || summary.ok !== true) return [];

  const errors = [];
  if (Object.prototype.hasOwnProperty.call(summary, "failedStep")
    && summary.failedStep !== null
    && summary.failedStep !== undefined) {
    errors.push("audit final command receipts summary must not include failedStep when status=pass");
  }
  if (summary.outputProblems !== null && summary.outputProblems !== undefined) {
    const hasOutputProblems = Array.isArray(summary.outputProblems)
      ? summary.outputProblems.length > 0
      : String(summary.outputProblems).trim().length > 0;
    if (hasOutputProblems) {
      errors.push("audit final command receipts summary must not include outputProblems when status=pass");
    }
  }
  return errors;
}

function auditFinalReceiptProblems(fieldText, {
  root = process.cwd(),
  candidate = {},
  finalReceiptBootstrapPath = null,
} = {}) {
  const errors = [];
  const protectedCandidateProof = extractAuditField(fieldText, [
    "protectedCandidateProof",
    "PROTECTED_CANDIDATE_PROOF",
  ]);
  if (!protectedCandidateProof || /_pending_|pending|tbd|todo|placeholder|<[^>]+>/i.test(protectedCandidateProof)) {
    errors.push("audit signoff must include protectedCandidateProof=<final receipt protected-candidate ancestry proof>");
  } else if (!/(?:final-command-receipts|protected-candidate-ancestry|origin\/master|merge-base|protectedMasterSha)/i.test(protectedCandidateProof)) {
    errors.push("audit signoff protectedCandidateProof must name the final receipt step or protected origin/master ancestry proof");
  }

  const receiptPath = extractAuditField(fieldText, [
    "finalCommandReceiptsPath",
    "FINAL_COMMAND_RECEIPTS_PATH",
  ]);
  if (!receiptPath || /_pending_|pending|tbd|todo|placeholder|<[^>]+>/i.test(receiptPath)) {
    errors.push("audit signoff must include finalCommandReceiptsPath=docs/qa-evidence/<date>/final-command-receipts/verification-summary.json");
    return errors;
  }

  const normalizedReceiptPath = normalizedAuditPath(receiptPath);
  const receiptPattern = /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/final-command-receipts\/verification-summary\.json$/i;
  const receiptDate = qaEvidenceDateFromPath(normalizedReceiptPath, receiptPattern);
  if (!receiptDate) {
    errors.push("audit signoff finalCommandReceiptsPath must be docs/qa-evidence/<date>/final-command-receipts/verification-summary.json");
    return errors;
  }
  const inventoryPath = extractAuditField(fieldText, [
    "externalEvidenceInventoryPath",
    "EXTERNAL_EVIDENCE_INVENTORY_PATH",
  ]);
  const devicePath = extractAuditField(fieldText, [
    "deviceEvidencePacketPath",
    "DEVICE_EVIDENCE_PACKET_PATH",
  ]);
  const normalizedInventoryPath = inventoryPath ? normalizedAuditPath(inventoryPath) : null;
  const normalizedDevicePath = devicePath ? normalizedAuditPath(devicePath) : null;
  const inventoryDate = normalizedInventoryPath
    ? qaEvidenceDateFromPath(normalizedInventoryPath, /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/external-evidence-inventory\.json$/i)
    : null;
  const deviceDate = normalizedDevicePath
    ? qaEvidenceDateFromPath(normalizedDevicePath, /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/[^/]+\.json$/i)
    : null;
  if ((inventoryDate && inventoryDate !== receiptDate) || (deviceDate && deviceDate !== receiptDate)) {
    errors.push("audit signoff finalCommandReceiptsPath must use the same docs/qa-evidence/<date> folder as inventory and packet paths");
  }
  const stackReceipt = auditJsonEvidencePath(fieldText, {
    fieldNames: ["stackReceiptPath", "STACK_ARCHITECTURE_RECEIPT_PATH"],
    pathPattern: /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/stack-architecture-receipt\.json$/i,
    label: "docs/qa-evidence/<date>/stack-architecture-receipt.json",
    expectedDate: receiptDate,
    errors,
  });
  const expectedStackReceiptPath = `docs/qa-evidence/${receiptDate}/${STACK_ARCHITECTURE_RECEIPT_FILENAME}`;
  const normalizedStackReceiptPath = stackReceipt?.path ?? expectedStackReceiptPath;
  if (stackReceipt && normalizedStackReceiptPath !== expectedStackReceiptPath) {
    errors.push("audit signoff stackReceiptPath must be docs/qa-evidence/<date>/stack-architecture-receipt.json");
  }

  const normalizedBootstrapPath = finalReceiptBootstrapPath
    ? normalizedAuditPath(finalReceiptBootstrapPath)
    : null;
  if (normalizedBootstrapPath && normalizedBootstrapPath === normalizedReceiptPath) {
    return errors;
  }

  const absoluteReceiptPath = path.join(root, normalizedReceiptPath);
  if (!fs.existsSync(absoluteReceiptPath)) {
    errors.push(`audit signoff finalCommandReceiptsPath missing at ${relativeOrOriginal(root, normalizedReceiptPath)}`);
    return errors;
  }

  let summary;
  try {
    summary = readJson(absoluteReceiptPath);
  } catch {
    errors.push("audit signoff finalCommandReceiptsPath must contain valid final-readiness verification-summary.json");
    return errors;
  }

  if (summary.mode !== "final-readiness-receipts") {
    errors.push("audit final command receipts summary must have mode=final-readiness-receipts");
  }
  if (summary.status !== "pass" || summary.ok !== true) {
    errors.push("audit final command receipts summary must have status=pass and ok=true");
  }
  errors.push(...finalReceiptPassSummaryContradictionProblems(summary));
  errors.push(...finalReceiptTimingProblems(summary, receiptDate));
  if (summary.inputs?.expectReadinessStatus !== 0) {
    errors.push("audit final command receipts summary must have inputs.expectReadinessStatus=0");
  }
  if (summary.publishSignoffReady !== true) {
    errors.push("audit final command receipts summary must have publishSignoffReady=true");
  }
  if (summary.noPublishRehearsal !== false) {
    errors.push("audit final command receipts summary must have noPublishRehearsal=false");
  }
  if (candidate.commit && !sameFullCommitSha(summary.inputs?.candidateSha, candidate.commit)) {
    errors.push("audit final command receipts summary candidateSha must match the release candidate commit");
  }
  if (normalizedInventoryPath && normalizedAuditPath(summary.inputs?.inventoryPath) !== normalizedInventoryPath) {
    errors.push("audit final command receipts summary inventoryPath must match externalEvidenceInventoryPath");
  }
  if (normalizedDevicePath && normalizedAuditPath(summary.inputs?.packetPath) !== normalizedDevicePath) {
    errors.push("audit final command receipts summary packetPath must match deviceEvidencePacketPath");
  }
  if (normalizedAuditPath(summary.inputs?.stackReceiptPath) !== normalizedStackReceiptPath) {
    errors.push("audit final command receipts summary stackReceiptPath must match stackReceiptPath");
  }
  if (normalizedAuditPath(summary.inputs?.qaPath) !== QA_EVIDENCE_PATH) {
    errors.push("audit final command receipts summary qaPath must be docs/GSAV_NATIVE_QA.md");
  }
  const receiptDir = path.posix.dirname(normalizedReceiptPath);
  if (normalizedAuditPath(summary.inputs?.evidenceDir) !== receiptDir) {
    errors.push("audit final command receipts summary evidenceDir must match finalCommandReceiptsPath directory");
  }
  if (summary.inputs?.protectedRef !== "origin/master") {
    errors.push("audit final command receipts summary must have inputs.protectedRef=origin/master");
  }
  const finalReceiptRepository = String(summary.inputs?.repository ?? "").trim();
  const finalReceiptReviewer = String(summary.inputs?.reviewer ?? "").trim();
  const finalReceiptReviewedAt = String(summary.inputs?.reviewedAt ?? "").trim();
  if (!/^(?:opsiclear|opsiclear-web)\/diveo$/i.test(finalReceiptRepository)) {
    errors.push("audit final command receipts summary repository must target the trusted Diveo repository");
  }
  const auditRunRepository = githubReleaseRunRepository(extractAuditField(fieldText, ["runUrl", "workflowRunUrl"]));
  if (auditRunRepository && normalizedRepository(finalReceiptRepository) !== auditRunRepository) {
    errors.push("audit final command receipts summary repository must match audit runUrl repository");
  }
  if (weakReviewValue(finalReceiptReviewer)) {
    errors.push("audit final command receipts summary reviewer must be concrete");
  }
  if (!isoTimestamp(finalReceiptReviewedAt) || finalReceiptReviewedAt.slice(0, 10) !== receiptDate) {
    errors.push("audit final command receipts summary reviewedAt must be an ISO timestamp on the final evidence date");
  }
  errors.push(...finalReceiptStepSetProblems(summary.steps));
  errors.push(...finalReceiptInternalStepCommandProblems({
    steps: summary.steps,
    receiptDate,
    normalizedInventoryPath,
    normalizedDevicePath,
    normalizedStackReceiptPath,
    expectedCandidateSha: candidate.commit || summary.inputs?.candidateSha,
    qaPath: QA_EVIDENCE_PATH,
  }));
  if (Array.isArray(summary.steps) && summary.steps.length > 0) {
    errors.push(...finalReceiptStepStatusProblems(summary.steps));
    summary.steps.forEach((step, stepIndex) => {
      errors.push(...finalReceiptStepLogProblems({
        root,
        receiptDir,
        step,
        stepIndex,
      }));
    });
  }
  const expectedLastMileReleaseStateLivePath = `docs/qa-evidence/${receiptDate}/final-command-receipts/github-release-state-prepublish-live.json`;
  const expectedLastMilePublishHashGuardLivePath = `docs/qa-evidence/${receiptDate}/final-command-receipts/publish-hash-variable-guard-prepublish-live.json`;
  if (summary.inputs?.date !== receiptDate) {
    errors.push("audit final command receipts summary date must match finalCommandReceiptsPath evidence date");
  }
  if (normalizedAuditPath(summary.inputs?.lastMileReleaseStateLivePath) !== expectedLastMileReleaseStateLivePath) {
    errors.push("audit final command receipts summary lastMileReleaseStateLivePath must match the final receipt live release-state evidence path");
  }
  if (normalizedAuditPath(summary.inputs?.lastMilePublishHashGuardLivePath) !== expectedLastMilePublishHashGuardLivePath) {
    errors.push("audit final command receipts summary lastMilePublishHashGuardLivePath must match the final receipt live publish-hash guard evidence path");
  }
  errors.push(...auditStackArchitectureReceiptProblems(root, normalizedStackReceiptPath));
  errors.push(...finalReceiptLiveJsonProblems({
    root,
    receiptDate,
    releaseStatePath: expectedLastMileReleaseStateLivePath,
    publishHashGuardPath: expectedLastMilePublishHashGuardLivePath,
    expected: {
      repository: finalReceiptRepository,
      reviewer: finalReceiptReviewer,
      reviewedAt: finalReceiptReviewedAt,
    },
    runUrl: extractAuditField(fieldText, ["runUrl", "workflowRunUrl"]),
  }));
  const protectedProofStep = Array.isArray(summary.steps)
    ? summary.steps.find((step) => step?.label === "Protected candidate ancestry proof")
    : null;
  if (!protectedProofStep || protectedProofStep.status !== 0) {
    errors.push("audit final command receipts summary must include a passing Protected candidate ancestry proof step");
  }
  const liveReleaseStateStep = Array.isArray(summary.steps)
    ? summary.steps.find((step) => step?.label === "Last-mile GitHub release-state evidence")
    : null;
  if (!liveReleaseStateStep || liveReleaseStateStep.status !== 0) {
    errors.push("audit final command receipts summary must include a passing Last-mile GitHub release-state evidence step");
  } else if (!/capture-github-release-state-evidence\.js/.test(liveReleaseStateStep.command ?? "")) {
    errors.push("audit final command receipts Last-mile GitHub release-state evidence step must run capture-github-release-state-evidence.js");
  } else if (!normalizeGitPath(String(liveReleaseStateStep.command ?? "")).includes(`--output-path ${expectedLastMileReleaseStateLivePath}`)) {
    errors.push("audit final command receipts Last-mile GitHub release-state evidence step must write --output-path to inputs.lastMileReleaseStateLivePath");
  } else {
    const command = receiptCommandText(liveReleaseStateStep);
    if (!commandIncludesOptionValue(command, "--repo", finalReceiptRepository)
      || !commandIncludesOptionValue(command, "--reviewer", finalReceiptReviewer)
      || !commandIncludesOptionValue(command, "--reviewed-at", finalReceiptReviewedAt)) {
      errors.push("audit final command receipts Last-mile GitHub release-state evidence step must use summary repository, reviewer, and reviewedAt");
    }
  }
  const livePublishHashGuardStep = Array.isArray(summary.steps)
    ? summary.steps.find((step) => step?.label === "Last-mile publish-hash variable guard")
    : null;
  if (!livePublishHashGuardStep || livePublishHashGuardStep.status !== 0) {
    errors.push("audit final command receipts summary must include a passing Last-mile publish-hash variable guard step");
  } else if (!/capture-publish-hash-variable-guard\.js/.test(livePublishHashGuardStep.command ?? "")) {
    errors.push("audit final command receipts Last-mile publish-hash variable guard step must run capture-publish-hash-variable-guard.js");
  } else if (!normalizeGitPath(String(livePublishHashGuardStep.command ?? "")).includes(`--output-path ${expectedLastMilePublishHashGuardLivePath}`)) {
    errors.push("audit final command receipts Last-mile publish-hash variable guard step must write --output-path to inputs.lastMilePublishHashGuardLivePath");
  } else {
    const command = receiptCommandText(livePublishHashGuardStep);
    if (!commandIncludesOptionValue(command, "--repo", finalReceiptRepository)
      || !commandIncludesOptionValue(command, "--reviewer", finalReceiptReviewer)
      || !commandIncludesOptionValue(command, "--reviewed-at", finalReceiptReviewedAt)) {
      errors.push("audit final command receipts Last-mile publish-hash variable guard step must use summary repository, reviewer, and reviewedAt");
    }
  }
  const finalReadinessStep = Array.isArray(summary.steps)
    ? summary.steps.find((step) => step?.label === "Final release readiness")
    : null;
  errors.push(...finalReceiptReadinessStepProblems({
    step: finalReadinessStep,
    normalizedReceiptPath,
    normalizedInventoryPath,
    normalizedDevicePath,
    expectedCandidateSha: candidate.commit || summary.inputs?.candidateSha,
  }));

  return errors;
}

function finalReceiptReviewInputs(fieldText, root) {
  const receiptPath = extractAuditField(fieldText, [
    "finalCommandReceiptsPath",
    "FINAL_COMMAND_RECEIPTS_PATH",
  ]);
  const normalizedReceiptPath = normalizedAuditPath(receiptPath);
  if (!/^docs\/qa-evidence\/\d{4}-\d{2}-\d{2}\/final-command-receipts\/verification-summary\.json$/i.test(normalizedReceiptPath)) {
    return null;
  }
  const absoluteReceiptPath = path.join(root, normalizedReceiptPath);
  if (!fs.existsSync(absoluteReceiptPath)) return null;
  try {
    const summary = readJson(absoluteReceiptPath);
    return {
      repository: String(summary.inputs?.repository ?? "").trim(),
      reviewer: String(summary.inputs?.reviewer ?? "").trim(),
      reviewedAt: String(summary.inputs?.reviewedAt ?? "").trim(),
    };
  } catch {
    return null;
  }
}

function normalizedRepository(value) {
  return String(value ?? "")
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

function lastMileReviewBindingProblems({
  evidence,
  expected,
  label,
}) {
  if (!evidence || !expected) return [];
  const errors = [];
  if (expected.repository && normalizedRepository(evidence.repository) !== normalizedRepository(expected.repository)) {
    errors.push(`audit last-mile ${label} evidence repository must match final command receipt summary repository`);
  }
  if (expected.reviewer && String(evidence.review?.reviewer ?? "").trim() !== expected.reviewer) {
    errors.push(`audit last-mile ${label} evidence review.reviewer must match final command receipt summary reviewer`);
  }
  if (expected.reviewedAt && String(evidence.review?.reviewedAt ?? "").trim() !== expected.reviewedAt) {
    errors.push(`audit last-mile ${label} evidence review.reviewedAt must match final command receipt summary reviewedAt`);
  }
  return errors;
}

function releaseStateQueryCommandProblems(evidence, expectedRepository) {
  const repository = String(expectedRepository ?? "").trim();
  if (!repository) return [];

  const querySpecs = [
    {
      name: "workflows",
      commandPattern: /gh api\b/,
      matchesRepository: (command) => commandIncludes(command, `repos/${repository}/actions/workflows`),
    },
    {
      name: "releaseRuns",
      commandPattern: /gh run list\b/,
      matchesRepository: (command) => commandIncludesOptionValue(command, "-R", repository)
        || commandIncludesOptionValue(command, "--repo", repository),
    },
    {
      name: "workflowDispatchRuns",
      commandPattern: /gh run list\b/,
      matchesRepository: (command) => commandIncludesOptionValue(command, "-R", repository)
        || commandIncludesOptionValue(command, "--repo", repository),
    },
    {
      name: "releases",
      commandPattern: /gh release list\b/,
      matchesRepository: (command) => commandIncludesOptionValue(command, "-R", repository)
        || commandIncludesOptionValue(command, "--repo", repository),
    },
  ];

  const errors = [];
  for (const spec of querySpecs) {
    const command = receiptCommandText({
      command: evidence.commands?.[spec.name] ?? evidence.querySummaries?.[spec.name]?.command ?? "",
    });
    if (!command || !spec.commandPattern.test(command)) {
      errors.push(`audit last-mile release-state evidence ${spec.name} query must include GitHub CLI command provenance`);
    } else if (!spec.matchesRepository(command)) {
      errors.push(`audit last-mile release-state evidence ${spec.name} query must use final command receipt summary repository`);
    }
  }
  return errors;
}

function finalReceiptLiveReleaseStateProblems({
  evidence,
  receiptDate,
  expected,
  runUrl,
}) {
  const errors = [];
  if (evidence.status !== "pass" || evidence.ok !== true) {
    errors.push("audit final command receipts live release-state evidence must have status=pass and ok=true");
  }
  if (!isoTimestamp(evidence.checkedAt) || evidence.checkedAt.slice(0, 10) !== receiptDate) {
    errors.push("audit final command receipts live release-state evidence checkedAt must be an ISO timestamp on the final evidence date");
  }
  errors.push(...lastMileReviewBindingProblems({
    evidence,
    expected,
    label: "live release-state",
  }));
  errors.push(...releaseStateQueryCommandProblems(evidence, expected.repository));
  if (evidence.releaseReadinessImpact?.status !== "ready") {
    errors.push("audit final command receipts live release-state evidence releaseReadinessImpact.status must be ready");
  }
  if (evidence.releaseState?.noGitHubReleasesObserved !== true || evidence.releaseState?.releaseCount !== 0) {
    errors.push("audit final command receipts live release-state evidence must prove no GitHub releases are present before publish");
  }
  if (!Array.isArray(evidence.releases) || evidence.releases.length !== 0) {
    errors.push("audit final command receipts live release-state evidence must list zero GitHub releases before publish");
  }
  const successfulRuns = Array.isArray(evidence.successfulReleaseWorkflowDispatchRuns)
    ? evidence.successfulReleaseWorkflowDispatchRuns
    : [];
  if (successfulRuns.length === 0) {
    errors.push("audit final command receipts live release-state evidence must include a successful workflow_dispatch dry run");
  } else if (runUrl && !successfulRuns.some((run) => String(run?.url ?? "").trim() === runUrl)) {
    errors.push("audit final command receipts live release-state evidence successful workflow_dispatch dry run must match audit runUrl");
  }
  return errors;
}

function finalReceiptLivePublishHashProblems({
  evidence,
  receiptDate,
  expected,
}) {
  const errors = [];
  if (evidence.status !== "pass" || evidence.ok !== true) {
    errors.push("audit final command receipts live publish-hash guard evidence must have status=pass and ok=true");
  }
  if (!isoTimestamp(evidence.checkedAt) || evidence.checkedAt.slice(0, 10) !== receiptDate) {
    errors.push("audit final command receipts live publish-hash guard evidence checkedAt must be an ISO timestamp on the final evidence date");
  }
  errors.push(...lastMileReviewBindingProblems({
    evidence,
    expected,
    label: "live publish-hash guard",
  }));
  if (evidence.releaseReadinessImpact?.status !== "ready") {
    errors.push("audit final command receipts live publish-hash guard evidence releaseReadinessImpact.status must be ready");
  }
  const requiredVariables = new Set(["EXPECTED_RELEASE_APK_SHA256", "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256"]);
  const queries = Array.isArray(evidence.variableQueries) ? evidence.variableQueries : [];
  for (const variable of requiredVariables) {
    const query = queries.find((entry) => entry?.name === variable);
    if (!query || query.absent !== true || query.status !== "absent") {
      errors.push(`audit final command receipts live publish-hash guard evidence must prove ${variable} is absent`);
    } else if (!/gh variable get\b/.test(String(query.command ?? ""))) {
      errors.push(`audit final command receipts live publish-hash guard evidence must include GitHub CLI query provenance for ${variable}`);
    } else if (!commandIncludesOptionValue(receiptCommandText(query), "--repo", expected.repository)) {
      errors.push(`audit final command receipts live publish-hash guard evidence query for ${variable} must use final command receipt summary repository`);
    }
  }
  return errors;
}

function finalReceiptLiveJsonProblems({
  root,
  receiptDate,
  releaseStatePath,
  publishHashGuardPath,
  expected,
  runUrl,
}) {
  const errors = [];
  for (const [label, evidencePath, problemFactory] of [
    [
      "release-state",
      releaseStatePath,
      (evidence) => finalReceiptLiveReleaseStateProblems({
        evidence,
        receiptDate,
        expected,
        runUrl,
      }),
    ],
    [
      "publish-hash guard",
      publishHashGuardPath,
      (evidence) => finalReceiptLivePublishHashProblems({
        evidence,
        receiptDate,
        expected,
      }),
    ],
  ]) {
    const absolutePath = path.join(root, evidencePath);
    if (!fs.existsSync(absolutePath)) {
      errors.push(`audit final command receipts live ${label} evidence missing at ${relativeOrOriginal(root, evidencePath)}`);
      continue;
    }
    try {
      errors.push(...problemFactory(readJson(absolutePath)));
    } catch {
      errors.push(`audit final command receipts live ${label} evidence must contain valid JSON`);
    }
  }
  return errors;
}

function auditLastMileEvidenceProblems(fieldText, {
  root = process.cwd(),
} = {}) {
  const errors = [];
  const finalReceiptReview = finalReceiptReviewInputs(fieldText, root);
  const runUrl = extractAuditField(fieldText, ["runUrl"]);
  const inventoryPath = extractAuditField(fieldText, [
    "externalEvidenceInventoryPath",
    "EXTERNAL_EVIDENCE_INVENTORY_PATH",
  ]);
  const inventoryDate = inventoryPath
    ? qaEvidenceDateFromPath(normalizedAuditPath(inventoryPath), /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/external-evidence-inventory\.json$/i)
    : null;
  const releaseState = auditJsonEvidencePath(fieldText, {
    fieldNames: ["lastMileReleaseStateEvidence"],
    pathPattern: /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/github-release-state-prepublish\.json$/i,
    label: "docs/qa-evidence/<date>/github-release-state-prepublish.json",
    expectedDate: inventoryDate,
    errors,
  });
  const publishHashGuard = auditJsonEvidencePath(fieldText, {
    fieldNames: ["lastMilePublishHashGuardEvidence"],
    pathPattern: /^docs\/qa-evidence\/(\d{4}-\d{2}-\d{2})\/publish-hash-variable-guard-prepublish\.json$/i,
    label: "docs/qa-evidence/<date>/publish-hash-variable-guard-prepublish.json",
    expectedDate: inventoryDate,
    errors,
  });

  if (releaseState) {
    const absolutePath = path.join(root, releaseState.path);
    if (!fs.existsSync(absolutePath)) {
      errors.push(`audit signoff lastMileReleaseStateEvidence missing at ${relativeOrOriginal(root, releaseState.path)}`);
    } else {
      let evidence;
      try {
        evidence = readJson(absolutePath);
      } catch {
        errors.push("audit signoff lastMileReleaseStateEvidence must contain valid GitHub release-state evidence JSON");
        evidence = null;
      }
      if (evidence) {
        if (evidence.status !== "pass" || evidence.ok !== true) {
          errors.push("audit last-mile release-state evidence must have status=pass and ok=true");
        }
        if (!isoTimestamp(evidence.checkedAt) || evidence.checkedAt.slice(0, 10) !== releaseState.date) {
          errors.push("audit last-mile release-state evidence checkedAt must be an ISO timestamp on the final evidence date");
        }
        if (weakReviewValue(evidence.review?.reviewer)) {
          errors.push("audit last-mile release-state evidence review.reviewer must be concrete");
        }
        if (!isoTimestamp(evidence.review?.reviewedAt) || evidence.review.reviewedAt.slice(0, 10) !== releaseState.date) {
          errors.push("audit last-mile release-state evidence review.reviewedAt must be an ISO timestamp on the final evidence date");
        }
        if (!/^(?:opsiclear|opsiclear-web)\/diveo$/i.test(String(evidence.repository ?? ""))) {
          errors.push("audit last-mile release-state evidence must target the trusted Diveo repository");
        }
        errors.push(...lastMileReviewBindingProblems({
          evidence,
          expected: finalReceiptReview,
          label: "release-state",
        }));
        for (const queryName of ["workflows", "releaseRuns", "workflowDispatchRuns", "releases"]) {
          if (evidence.querySummaries?.[queryName]?.exitCode !== 0) {
            errors.push(`audit last-mile release-state evidence ${queryName} query must exit 0`);
          }
        }
        errors.push(...releaseStateQueryCommandProblems(
          evidence,
          finalReceiptReview?.repository ?? evidence.repository,
        ));
        if (evidence.releaseReadinessImpact?.status !== "ready") {
          errors.push("audit last-mile release-state evidence releaseReadinessImpact.status must be ready");
        }
        if (evidence.releaseState?.noGitHubReleasesObserved !== true || evidence.releaseState?.releaseCount !== 0) {
          errors.push("audit last-mile release-state evidence must prove no GitHub releases are present before publish");
        }
        if (!Array.isArray(evidence.releases) || evidence.releases.length !== 0) {
          errors.push("audit last-mile release-state evidence must list zero GitHub releases before publish");
        }
        const successfulRuns = Array.isArray(evidence.successfulReleaseWorkflowDispatchRuns)
          ? evidence.successfulReleaseWorkflowDispatchRuns
          : [];
        if (successfulRuns.length === 0) {
          errors.push("audit last-mile release-state evidence must include a successful workflow_dispatch dry run");
        } else if (runUrl && !successfulRuns.some((run) => String(run?.url ?? "").trim() === runUrl)) {
          errors.push("audit last-mile release-state evidence successful workflow_dispatch dry run must match audit runUrl");
        }
      }
    }
  }

  if (publishHashGuard) {
    const absolutePath = path.join(root, publishHashGuard.path);
    if (!fs.existsSync(absolutePath)) {
      errors.push(`audit signoff lastMilePublishHashGuardEvidence missing at ${relativeOrOriginal(root, publishHashGuard.path)}`);
    } else {
      let evidence;
      try {
        evidence = readJson(absolutePath);
      } catch {
        errors.push("audit signoff lastMilePublishHashGuardEvidence must contain valid publish hash guard JSON");
        evidence = null;
      }
      if (evidence) {
        if (evidence.status !== "pass" || evidence.ok !== true) {
          errors.push("audit last-mile publish-hash guard evidence must have status=pass and ok=true");
        }
        if (!isoTimestamp(evidence.checkedAt) || evidence.checkedAt.slice(0, 10) !== publishHashGuard.date) {
          errors.push("audit last-mile publish-hash guard evidence checkedAt must be an ISO timestamp on the final evidence date");
        }
        if (weakReviewValue(evidence.review?.reviewer)) {
          errors.push("audit last-mile publish-hash guard evidence review.reviewer must be concrete");
        }
        if (!isoTimestamp(evidence.review?.reviewedAt) || evidence.review.reviewedAt.slice(0, 10) !== publishHashGuard.date) {
          errors.push("audit last-mile publish-hash guard evidence review.reviewedAt must be an ISO timestamp on the final evidence date");
        }
        if (!/^(?:opsiclear|opsiclear-web)\/diveo$/i.test(String(evidence.repository ?? ""))) {
          errors.push("audit last-mile publish-hash guard evidence must target the trusted Diveo repository");
        }
        errors.push(...lastMileReviewBindingProblems({
          evidence,
          expected: finalReceiptReview,
          label: "publish-hash guard",
        }));
        if (evidence.releaseReadinessImpact?.status !== "ready") {
          errors.push("audit last-mile publish-hash guard evidence releaseReadinessImpact.status must be ready");
        }
        const requiredVariables = new Set(["EXPECTED_RELEASE_APK_SHA256", "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256"]);
        const queries = Array.isArray(evidence.variableQueries) ? evidence.variableQueries : [];
        for (const variable of requiredVariables) {
          const query = queries.find((entry) => entry?.name === variable);
          if (!query || query.absent !== true || query.status !== "absent") {
            errors.push(`audit last-mile publish-hash guard evidence must prove ${variable} is absent`);
          } else if (!/gh variable get\b/.test(String(query.command ?? ""))) {
            errors.push(`audit last-mile publish-hash guard evidence must include GitHub CLI query provenance for ${variable}`);
          } else if (finalReceiptReview?.repository
            && !commandIncludesOptionValue(receiptCommandText(query), "--repo", finalReceiptReview.repository)) {
            errors.push(`audit last-mile publish-hash guard evidence query for ${variable} must use final command receipt summary repository`);
          }
        }
      }
    }
  }

  return errors;
}

function auditSignoffProblems(auditText, {
  root = process.cwd(),
  candidate = {},
  rows = [],
  externalEvidenceInventoryPath = null,
  devicePacketPath = null,
  finalReceiptBootstrapPath = null,
} = {}) {
  const text = String(auditText ?? "");
  const errors = [];
  if (!text.trim()) {
    return ["audit signoff document is missing"];
  }
  const signoffText = finalPublishSignoffSection(text);
  if (!signoffText) {
    errors.push("audit signoff must include ## Final Publish Signoff section");
  }
  const dryRunRow = rows.find((row) => row.platform === "GitHub Actions release dry run" && row.route === "Release workflow dry run");
  const dryRunText = dryRunRow ? detailText(dryRunRow) : "";
  const fieldText = signoffText ?? "";

  const decision = extractAuditField(fieldText, ["decision"]);
  if (!decision) {
    errors.push("audit signoff must include decision=publish or decision=no-publish");
  } else if (!/^(publish|no-publish)$/i.test(decision)) {
    errors.push("audit signoff decision must be publish or no-publish");
  } else if (decision.toLowerCase() !== "publish") {
    errors.push("audit signoff decision must be decision=publish for release readiness");
  }

  const publishScope = extractAuditField(fieldText, ["publishScope"]);
  if (publishScope !== "android-apk-only") {
    errors.push("audit signoff must include publishScope=android-apk-only for the current release scope");
  }

  const iosDistributionDecision = extractAuditField(fieldText, ["iosDistributionDecision"]);
  if (iosDistributionDecision !== "no-publish") {
    errors.push("audit signoff must include iosDistributionDecision=no-publish unless iOS distribution rows are added");
  }

  const reviewer = extractAuditField(fieldText, ["reviewer"]);
  if (!reviewer || /^(owner|release owner|native release owner|tbd|todo|pending|unassigned)$/i.test(reviewer)) {
    errors.push("audit signoff must include a concrete reviewer=<person|team|issue|run>");
  }

  const reviewedAt = extractAuditField(fieldText, ["reviewedAt"]);
  if (!isIsoTimestamp(reviewedAt)) {
    errors.push("audit signoff must include reviewedAt=<ISO timestamp>");
  }

  const payloadSha = extractAuditField(fieldText, ["payloadSha", "payloadCandidateSha", "releaseCandidateSha"]);
  if (!/^[0-9a-f]{1,40}$/i.test(payloadSha ?? "")) {
    errors.push("audit signoff must include payloadSha=<sha>");
  } else if (!fullCommitSha(payloadSha)) {
    errors.push(`audit signoff payloadSha ${payloadSha} must be a full 40-hex SHA`);
  } else if (candidate.commit && !sameFullCommitSha(payloadSha, candidate.commit)) {
    errors.push("audit signoff payloadSha must match the release candidate commit");
  } else if (dryRunText) {
    const rowPayloadSha = extractShaField(dryRunText, ["releaseCandidateSha"]);
    if (rowPayloadSha && !fullCommitSha(rowPayloadSha)) {
      errors.push("release dry-run QA row releaseCandidateSha must be a full 40-hex SHA");
    } else if (rowPayloadSha && !sameFullCommitSha(payloadSha, rowPayloadSha)) {
      errors.push("audit signoff payloadSha must match the release dry-run QA row releaseCandidateSha");
    }
  }

  const signoffSha = extractAuditField(fieldText, ["signoffSha", "evidenceSignoffSha"]);
  if (!/^[0-9a-f]{1,40}$/i.test(signoffSha ?? "")) {
    errors.push("audit signoff must include signoffSha=<sha>");
  } else if (!fullCommitSha(signoffSha)) {
    errors.push(`audit signoff signoffSha ${signoffSha} must be a full 40-hex SHA`);
  } else if (candidate.signoffCommit && !sameFullCommitSha(signoffSha, candidate.signoffCommit)) {
    errors.push("audit signoff signoffSha must match the evidence signoff commit");
  } else if (dryRunText) {
    const rowSignoffSha = extractShaField(dryRunText, ["evidenceSignoffSha"]);
    if (rowSignoffSha && !fullCommitSha(rowSignoffSha)) {
      errors.push("release dry-run QA row evidenceSignoffSha must be a full 40-hex SHA");
    } else if (rowSignoffSha && !sameFullCommitSha(signoffSha, rowSignoffSha)) {
      errors.push("audit signoff signoffSha must match the release dry-run QA row evidenceSignoffSha");
    }
  }

  const artifactName = extractAuditField(fieldText, ["artifactName", "artifactReviewArtifact"]);
  if (!/^diveo-release-evidence-v\d+\.\d+\.\d+$/i.test(artifactName ?? "")) {
    errors.push("audit signoff must include artifactName=diveo-release-evidence-v<semver>");
  } else if (dryRunText) {
    const rowArtifactName = releaseDryRunArtifactName(dryRunText);
    if (rowArtifactName && rowArtifactName !== artifactName) {
      errors.push("audit signoff artifactName must match the release dry-run QA row artifact name");
    }
  }

  const runUrl = extractAuditField(fieldText, ["runUrl", "workflowRunUrl"]);
  if (!runUrl || !trustedGithubReleaseRunUrl(runUrl)) {
    errors.push("audit signoff must include runUrl=<exact trusted Diveo release Actions run URL>");
  } else if (dryRunText) {
    const auditRunId = githubReleaseRunId(runUrl);
    const rowRunIds = githubReleaseRunIdsFromText(dryRunText);
    if (auditRunId && rowRunIds.length > 0 && !rowRunIds.includes(auditRunId)) {
      errors.push("audit signoff runUrl must match the release dry-run QA row workflow run");
    }
  }

  const checksumManifestSha = extractAuditField(fieldText, ["checksumManifestSha256", "downloadedChecksumManifestSha256"]);
  if (!/^[0-9a-f]{64}$/i.test(checksumManifestSha ?? "")) {
    errors.push("audit signoff must include checksumManifestSha256=<64-hex sha>");
  } else if (dryRunText) {
    const rowChecksumHashes = new Set([
      checksumManifestHash(dryRunText),
      checksumManifestHash(dryRunText, { downloaded: true }),
    ].filter(Boolean));
    if (rowChecksumHashes.size > 0 && !rowChecksumHashes.has(checksumManifestSha.toLowerCase())) {
      errors.push("audit signoff checksumManifestSha256 must match the release dry-run QA row checksum-manifest SHA256");
    }
  }

  const publishArtifactIdentitySha = extractAuditField(fieldText, ["publishArtifactIdentitySha256"]);
  if (!/^[0-9a-f]{64}$/i.test(publishArtifactIdentitySha ?? "")) {
    errors.push("audit signoff must include publishArtifactIdentitySha256=<64-hex sha>");
  } else if (dryRunText) {
    const rowPublishArtifactIdentitySha = labeledHashField(dryRunText, "publishArtifactIdentitySha256");
    if (
      rowPublishArtifactIdentitySha
      && rowPublishArtifactIdentitySha.toLowerCase() !== publishArtifactIdentitySha.toLowerCase()
    ) {
      errors.push("audit signoff publishArtifactIdentitySha256 must match the release dry-run QA row");
    }
  }

  const expectedApkSha = extractAuditField(fieldText, ["expected_apk_sha256", "EXPECTED_RELEASE_APK_SHA256"]);
  if (!/^[0-9a-f]{64}$/i.test(expectedApkSha ?? "")) {
    errors.push("audit signoff must include expected_apk_sha256=<64-hex sha> or EXPECTED_RELEASE_APK_SHA256=<64-hex sha>");
  } else {
    const artifactRow = rows.find((row) => row.platform === "Android release" && row.route === "Release APK artifact");
    const artifactApkSha = artifactRow ? labeledHashField(detailText(artifactRow), "apkSha256") : null;
    const dryRunExpectedApkSha = dryRunText
      ? labeledHashField(dryRunText, "expected_apk_sha256") ?? labeledHashField(dryRunText, "EXPECTED_RELEASE_APK_SHA256")
      : null;
    if (artifactApkSha && artifactApkSha.toLowerCase() !== expectedApkSha.toLowerCase()) {
      errors.push("audit signoff expected_apk_sha256 must match the reviewed release APK apkSha256");
    }
    if (dryRunExpectedApkSha && dryRunExpectedApkSha.toLowerCase() !== expectedApkSha.toLowerCase()) {
      errors.push("audit signoff expected_apk_sha256 must match the release dry-run QA row expected_apk_sha256");
    }
  }

  const expectedPublishIdentitySha = extractAuditField(fieldText, [
    "expected_publish_identity_sha256",
    "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256",
  ]);
  if (!/^[0-9a-f]{64}$/i.test(expectedPublishIdentitySha ?? "")) {
    errors.push("audit signoff must include expected_publish_identity_sha256=<64-hex sha> or EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256=<64-hex sha>");
  } else {
    const dryRunExpectedPublishIdentitySha = dryRunText
      ? labeledHashField(dryRunText, "expected_publish_identity_sha256") ?? labeledHashField(dryRunText, "EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256")
      : null;
    if (
      publishArtifactIdentitySha
      && /^[0-9a-f]{64}$/i.test(publishArtifactIdentitySha)
      && publishArtifactIdentitySha.toLowerCase() !== expectedPublishIdentitySha.toLowerCase()
    ) {
      errors.push("audit signoff expected_publish_identity_sha256 must match publishArtifactIdentitySha256");
    }
    if (
      dryRunExpectedPublishIdentitySha
      && dryRunExpectedPublishIdentitySha.toLowerCase() !== expectedPublishIdentitySha.toLowerCase()
    ) {
      errors.push("audit signoff expected_publish_identity_sha256 must match the release dry-run QA row expected_publish_identity_sha256");
    }
  }

  if (!/branchProtection(?:Ready)?\s*=\s*(?:ready|true)\b/i.test(fieldText)
    || !/protected branch\s*=?\s*master|branch\s*=\s*master/i.test(fieldText)
    || !/quality\s*\/\s*quality/i.test(fieldText)) {
    errors.push("audit signoff must include branchProtectionReady=true with protected master and quality / quality evidence");
  }
  errors.push(...auditEvidencePathProblems(fieldText, {
    externalEvidenceInventoryPath,
    devicePacketPath,
  }));
  errors.push(...auditFinalReceiptProblems(fieldText, {
    root,
    candidate,
    finalReceiptBootstrapPath,
  }));
  errors.push(...auditLastMileEvidenceProblems(fieldText, { root }));

  const ledgerRows = parseExternalReviewLedgerRows(text);
  if (ledgerRows.length === 0) {
    errors.push("audit external evidence review ledger must include reviewed rows");
  }
  const unresolvedRows = ledgerRows.filter(externalReviewLedgerRowIsUnresolved);
  if (unresolvedRows.length > 0) {
    errors.push(`audit external evidence review ledger has unresolved rows: ${unresolvedRows.map((row) => row.qaRowOrArtifact).join(", ")}`);
  }
  errors.push(...externalReviewLedgerCoverageProblems(ledgerRows));

  return errors;
}

function checksumManifestDetailProblems(text) {
  const checksumSegment = text
    .split(/[;|]/)
    .find((segment) => /checksum-manifest\s+SHA(?:256)?|checksum manifest\s+SHA(?:256)?|evidence-checksums\.txt.*(?:sha256|checksum)/i.test(segment));

  if (!checksumSegment) {
    return ["checksum-manifest SHA256"];
  }

  if (!/\b[a-f0-9]{64}\b/i.test(checksumSegment)) {
    return ["explicit 64-hex checksum-manifest SHA256 value"];
  }

  return [];
}

function checksumManifestHash(text, { downloaded = false } = {}) {
  const segment = text
    .split(/[;|]/)
    .find((part) => (
      /checksum-manifest\s+SHA(?:256)?|checksum manifest\s+SHA(?:256)?|evidence-checksums\.txt.*(?:sha256|checksum)/i.test(part)
      && (downloaded ? /downloaded/i.test(part) : !/downloaded/i.test(part))
    ));
  return /\b([a-f0-9]{64})\b/i.exec(segment ?? "")?.[1]?.toLowerCase() ?? null;
}

function labeledHashField(text, fieldName) {
  const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedField}\\s*[:=]\\s*([a-f0-9]{64})\\b`, "i").exec(text);
  return match?.[1] ?? null;
}

function apkArtifactChecksumProblems(text, { requireManifest = true } = {}) {
  const errors = [];
  if (!labeledHashField(text, "apkSha256")) {
    errors.push("explicit 64-hex apkSha256 value");
  }
  if (requireManifest && !labeledHashField(text, "manifestSha256")) {
    errors.push("explicit 64-hex manifestSha256 value");
  }
  return errors;
}

function publishArtifactIdentityDetailProblems(text) {
  const errors = [];
  if (!labeledHashField(text, "publishArtifactIdentitySha256")) {
    errors.push("publishArtifactIdentitySha256=<64-hex>");
  }
  if (!labeledHashField(text, "gsavPackageProvenanceSha256")) {
    errors.push("gsavPackageProvenanceSha256=<64-hex>");
  }
  return errors;
}

function installedSmokeProductionHostUrl(text) {
  const patterns = [
    /--production-host-url\s+("[^"]+"|'[^']+'|`[^`]+`|[^\s;|]+)/i,
    /productionHostUrl\s*[:=]\s*([^;|\s]+)/i,
    /production\s+(?:GSAV\s+)?host\s+URL\s*[:=]?\s*(https?:\/\/[^\s;|]+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return match[1].trim().replace(/^["'`]|["'`]$/g, "");
    }
  }
  return null;
}

function installedSmokeProductionHostProblems(text) {
  const errors = [];
  if (!/--production-host-url\b/i.test(text)) {
    errors.push("--production-host-url");
  }
  if (!/productionHostReleaseReady\s*=\s*true/i.test(text)) {
    errors.push("productionHostReleaseReady=true");
  }

  const productionHostUrl = installedSmokeProductionHostUrl(text);
  if (!productionHostUrl) {
    errors.push("productionHostUrl");
  } else {
    errors.push(...releaseDryRunUrlProblems("productionHostUrl", productionHostUrl));
  }
  return errors;
}

const INSTALLED_SMOKE_RELAXATION_FLAGS = [
  ["--allow-partial-routes", "allowPartialRoutes"],
  ["--allow-missing-log-markers", "allowMissingLogMarkers"],
  ["--allow-missing-device-metadata", "allowMissingDeviceMetadata"],
  ["--allow-rehearsal-host", "allowRehearsalHost"],
];

function installedSmokeRelaxationFlagProblems(text) {
  const errors = [];
  for (const [cliFlag, evidenceKey] of INSTALLED_SMOKE_RELAXATION_FLAGS) {
    const escapedCliFlag = cliFlag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const enabledPattern = new RegExp(`(?:${escapedCliFlag}\\s+(?:1|true|yes)|${evidenceKey}\\s*=\\s*true)`, "i");
    if (enabledPattern.test(text)) {
      errors.push(`release installed-smoke must not use ${cliFlag}`);
    }
    const falsePattern = new RegExp(`${evidenceKey}\\s*=\\s*false`, "i");
    if (!falsePattern.test(text)) {
      errors.push(`${evidenceKey}=false`);
    }
  }
  return errors;
}

function installedApkSmokeDetailProblems(text, candidate) {
  const errors = apkArtifactChecksumProblems(text, { requireManifest: false });

  if (!/apkSha256MatchesDryRunSummary\s*=\s*true/i.test(text)) {
    errors.push("apkSha256MatchesDryRunSummary=true");
  }
  if (!/installedVersionCodeMatchesDryRunSummary\s*=\s*true/i.test(text)) {
    errors.push("installedVersionCodeMatchesDryRunSummary=true");
  }
  if (!/observedSignalsOk\s*=\s*true/i.test(text)) {
    errors.push("observedSignalsOk=true");
  }
  if (!/observedSignalChecks/i.test(text)) {
    errors.push("observedSignalChecks");
  }
  if (!/(route-change|GSAV_ROUTE_CHANGE)/i.test(text)) {
    errors.push("route-change observed signal");
  }
  if (!/(bridge-ready-or-error|GSAV_BRIDGE_READY|GSAV_ERROR|unsupported)/i.test(text)) {
    errors.push("bridge-ready/error observed signal");
  }
  errors.push(...installedSmokeProductionHostProblems(text));
  errors.push(...installedSmokeRelaxationFlagProblems(text));

  const installedMatch = /installedVersionCode\s*[:=]\s*(\d+)/i.exec(text);
  if (!installedMatch) {
    errors.push("explicit installedVersionCode value");
  } else if (candidate?.versionCode && Number(installedMatch[1]) !== Number(candidate.versionCode)) {
    errors.push(`installedVersionCode must match app.json ${candidate.versionCode}`);
  }

  return errors;
}

function releaseDryRunIdentityField(text, fieldName) {
  const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedField}\\s*[:=]\\s*([^;|]+)`, "i").exec(text);
  return match?.[1]?.trim().replace(/^["'`]|["'`]$/g, "") ?? null;
}

function releaseDryRunArtifactName(text) {
  return releaseDryRunIdentityField(text, "artifactName")
    || releaseDryRunIdentityField(text, "artifact name")
    || /\bartifact name\s+([^;|]+)/i.exec(text)?.[1]?.trim().replace(/^["'`]|["'`]$/g, "")
    || null;
}

function releaseDryRunUrlProblems(label, value) {
  if (!value) return [`${label} URL`];
  try {
    const parsed = new URL(value);
    const errors = [];
    if (parsed.protocol !== "https:") {
      errors.push(`${label} must use https`);
    }
    if (isLocalOrPrivateHostname(parsed.hostname)) {
      errors.push(`${label} must not use local/private host`);
    }
    return errors;
  } catch {
    return [`valid ${label} URL`];
  }
}

function weakHostIdentityValue(value) {
  return !value
    || value.length < 7
    || /^(?:GSAV_HOSTING_COMMIT|unknown|unavailable|n\/a|null|none|present|provided|recorded|captured|available|configured)\b/i.test(value)
    || /<[^>]+>/.test(value)
    || /\bmatch(?:ed|es|ing)?\b/i.test(value);
}

function weakReviewValue(value) {
  return !value
    || /<[^>]+>/.test(value)
    || /^(?:unknown|unavailable|n\/a|null|none|present|provided|recorded|captured|available|configured|reviewer|owner|release owner|native release owner)\b/i.test(value);
}

function isoTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function weakArtifactReviewValue(value) {
  return weakReviewValue(value)
    || /^(?:artifact|artifact id|artifact name|reviewed artifact|evidence artifact|release evidence artifact)\b/i.test(value);
}

function artifactIdentityMatches(reviewedArtifact, artifactName) {
  if (!reviewedArtifact || !artifactName) return true;
  const normalizedReviewed = reviewedArtifact.trim().toLowerCase().replace(/\.zip$/i, "");
  const normalizedName = artifactName.trim().toLowerCase().replace(/\.zip$/i, "");
  if (/^(?:\d+|[a-f0-9]{12,})$/i.test(normalizedReviewed)) return true;
  return normalizedReviewed === normalizedName;
}

function artifactReviewDetailProblems(text) {
  const errors = [];
  const reviewer = releaseDryRunIdentityField(text, "reviewer");
  if (weakReviewValue(reviewer)) {
    errors.push("artifact review reviewer must be concrete");
  }

  const reviewedArtifact = releaseDryRunIdentityField(text, "artifactReviewArtifact")
    || releaseDryRunIdentityField(text, "artifactReviewArtifactId")
    || releaseDryRunIdentityField(text, "artifact review artifact")
    || releaseDryRunIdentityField(text, "reviewedArtifact");
  if (weakArtifactReviewValue(reviewedArtifact)) {
    errors.push("artifact review artifact name or ID must be concrete");
  }
  const artifactName = releaseDryRunArtifactName(text);
  if (weakArtifactReviewValue(artifactName)) {
    errors.push("artifact name must be concrete");
  } else if (!weakArtifactReviewValue(reviewedArtifact) && !artifactIdentityMatches(reviewedArtifact, artifactName)) {
    errors.push("artifactReviewArtifact must match artifact name or use artifact ID");
  }

  const reviewedAt = releaseDryRunIdentityField(text, "reviewedAt");
  if (!reviewedAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(reviewedAt) || Number.isNaN(Date.parse(reviewedAt))) {
    errors.push("reviewedAt must be an ISO timestamp");
  }

  const conclusion = releaseDryRunIdentityField(text, "GitHub run conclusion");
  if (conclusion?.toLowerCase() !== "success") {
    errors.push("GitHub run conclusion must be success");
  }

  const checksum = checksumManifestHash(text);
  const downloadedChecksum = checksumManifestHash(text, { downloaded: true });
  if (!downloadedChecksum) {
    errors.push("downloaded checksum-manifest SHA256 must be 64 hex");
  } else if (checksum && downloadedChecksum !== checksum) {
    errors.push("downloaded checksum-manifest SHA256 must match checksum-manifest SHA256");
  }

  return errors;
}

function branchProtectionRequiredCheckNames(evidence) {
  const checks = new Set((evidence?.observedRequiredChecks ?? []).map(String));
  const statusSources = [
    evidence?.branchQuery?.output?.protection?.requiredStatusChecks,
    evidence?.protectionQuery?.output?.requiredStatusChecks,
  ];
  for (const statusChecks of statusSources) {
    for (const context of statusChecks?.contexts ?? []) {
      checks.add(String(context));
    }
    for (const check of statusChecks?.checks ?? []) {
      if (check?.context) checks.add(String(check.context));
      if (check?.name) checks.add(String(check.name));
    }
  }
  return [...checks];
}

function branchProtectionEvidenceFileProblems(localPath, root, row) {
  const errors = [];
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(path.join(root, localPath), "utf8"));
  } catch {
    return [`${localPath} must be readable JSON branch-protection evidence`];
  }

  if (evidence.ok !== true || evidence.status !== "pass") {
    errors.push(`${localPath} must report ok=true and status=pass`);
  }
  if (evidence.repository?.toLowerCase() !== "opsiclear-web/diveo" && evidence.repository?.toLowerCase() !== "opsiclear/diveo") {
    errors.push(`${localPath} repository must be OpsiClear-Web/diveo or opsiclear/diveo`);
  }
  if (evidence.branch !== "master") {
    errors.push(`${localPath} branch must be master`);
  }
  if (evidence.branchQuery?.output?.protected !== true) {
    errors.push(`${localPath} branchQuery.output.protected must be true`);
  }
  if (evidence.protectionQuery?.exitCode !== 0) {
    errors.push(`${localPath} protectionQuery.exitCode must be 0`);
  }
  if (!branchProtectionRequiredCheckNames(evidence).includes("quality / quality")) {
    errors.push(`${localPath} observedRequiredChecks must include quality / quality`);
  }
  if (!/branches\/master\b/.test(evidence.branchQuery?.command ?? "")) {
    errors.push(`${localPath} branchQuery.command must query branches/master`);
  }
  if (!/branches\/master\/protection\b/.test(evidence.protectionQuery?.command ?? "")) {
    errors.push(`${localPath} protectionQuery.command must query branches/master/protection`);
  }
  if (evidence.releaseReadinessImpact?.status !== "ready") {
    errors.push(`${localPath} releaseReadinessImpact.status must be ready`);
  }

  const evidenceReviewer = evidence.review?.reviewer;
  const rowReviewer = releaseDryRunIdentityField(detailText(row), "reviewer");
  if (weakReviewValue(evidenceReviewer)) {
    errors.push(`${localPath} review.reviewer must be concrete`);
  } else if (!weakReviewValue(rowReviewer) && rowReviewer !== evidenceReviewer) {
    errors.push(`${localPath} review.reviewer must match row reviewer`);
  }

  const evidenceReviewedAt = evidence.review?.reviewedAt;
  const rowReviewedAt = releaseDryRunIdentityField(detailText(row), "reviewedAt");
  if (!isoTimestamp(evidenceReviewedAt)) {
    errors.push(`${localPath} review.reviewedAt must be an ISO timestamp`);
  } else if (isoTimestamp(rowReviewedAt) && rowReviewedAt !== evidenceReviewedAt) {
    errors.push(`${localPath} review.reviewedAt must match row reviewedAt`);
  }

  return errors;
}

function branchProtectionEvidencePathProblems(row, root) {
  const localPaths = localEvidenceCandidates(row.evidencePath);
  if (localPaths.length === 0) return [];
  const nonJsonPaths = localPaths.filter((localPath) => !/\.json$/i.test(localPath));
  if (nonJsonPaths.length > 0) {
    return [`local branch-protection evidence must be JSON: ${nonJsonPaths.join(", ")}`];
  }
  return localPaths.flatMap((localPath) => branchProtectionEvidenceFileProblems(localPath, root, row));
}

function branchProtectionDetailProblems(row, options = {}) {
  const text = detailText(row);
  const root = options.root ?? process.cwd();
  const errors = [];

  const required = [
    ["branch protection query", /gh api\s+repos\/(?:opsiclear|opsiclear-web)\/diveo\/branches\/master\/protection|branches\/master\/protection|branch protection query/i],
    ["protected branch master", /protected branch\s*[:=]?\s*master|branch\s*[:=]?\s*master|master branch/i],
    ["required status checks", /required status checks|required checks|contexts|checks/i],
    ["quality / quality required check", /quality\s*\/\s*quality/i],
    ["raw evidence path or trusted GitHub evidence URL", /raw evidence path|docs\/qa-evidence|trusted GitHub|actions\/runs\/\d+|artifact/i],
  ];
  errors.push(...required
    .filter(([, pattern]) => !pattern.test(text))
    .map(([label]) => label));

  const reviewer = releaseDryRunIdentityField(text, "reviewer");
  if (weakReviewValue(reviewer)) {
    errors.push("branch protection reviewer must be concrete");
  }

  const reviewedAt = releaseDryRunIdentityField(text, "reviewedAt");
  if (!isoTimestamp(reviewedAt)) {
    errors.push("branch protection reviewedAt must be an ISO timestamp");
  }

  errors.push(...branchProtectionEvidencePathProblems(row, root));

  return errors;
}

function runtimeSmokeHostIdentityValue(text) {
  const patterns = [
    /\bGSAV_HOSTING_COMMIT\s*[:=]\s*([^;|]+)/i,
    /\bgsavHostingCommit\s*[:= ]\s*([^;|]+)/i,
    /\bgsav-hosting commit\s*[:= ]\s*([^;|]+)/i,
    /\bGSAV host identity\s*[:= ]\s*([^;|]+)/i,
    /\bdeployed host(?:\/build)? identity\s*[:= ]\s*([^;|]+)/i,
    /\bhost build\s*[:= ]\s*([^;|]+)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return match[1].trim().replace(/^["'`]|["'`]$/g, "");
    }
  }

  return null;
}

function releaseDryRunHostIdentityProblems(text) {
  const errors = [];
  const configuredUrl = releaseDryRunIdentityField(text, "GSAV_HOST_IDENTITY_URL");
  const observedUrl = releaseDryRunIdentityField(text, "hostIdentity.url");
  const hostingCommit = releaseDryRunIdentityField(text, "GSAV_HOSTING_COMMIT");
  const expectedIdentity = releaseDryRunIdentityField(text, "hostIdentity.expectedIdentity");
  const observedIdentity = releaseDryRunIdentityField(text, "hostIdentity.observedIdentity");

  errors.push(...releaseDryRunUrlProblems("GSAV_HOST_IDENTITY_URL", configuredUrl));
  errors.push(...releaseDryRunUrlProblems("hostIdentity.url", observedUrl));
  if (configuredUrl && observedUrl) {
    try {
      if (new URL(configuredUrl).href !== new URL(observedUrl).href) {
        errors.push("hostIdentity.url must match GSAV_HOST_IDENTITY_URL");
      }
    } catch {
      // URL shape errors are reported above.
    }
  }

  if (weakHostIdentityValue(hostingCommit)) {
    errors.push("explicit GSAV_HOSTING_COMMIT value");
  }
  if (weakHostIdentityValue(expectedIdentity)) {
    errors.push("explicit hostIdentity.expectedIdentity value");
  }
  if (weakHostIdentityValue(observedIdentity)) {
    errors.push("explicit hostIdentity.observedIdentity value");
  }

  if (errors.length > 0) return errors;

  if (!commitMatches(expectedIdentity, hostingCommit)) {
    errors.push("hostIdentity.expectedIdentity must match GSAV_HOSTING_COMMIT");
  }
  if (!commitMatches(observedIdentity, hostingCommit)) {
    errors.push("hostIdentity.observedIdentity must match GSAV_HOSTING_COMMIT");
  }

  return errors;
}

function negativeEvidenceProblems(row, options = {}) {
  const text = detailText(row);
  if (hasNamedException(text, options)) return [];

  const candidates = evidenceCandidates(row.evidencePath);
  const hasAndroid = candidates.some((candidate) => /android/i.test(candidate));
  const hasIos = candidates.some((candidate) => /\bios\b|iphone|ipad|wkwebview/i.test(candidate));
  if (candidates.length < 2 || !hasAndroid || !hasIos) {
    return ["distinct Android and iOS evidence paths or owner/revisit exception"];
  }
  return [];
}

function runtimeSmokeDetailProblems(row, options = {}) {
  const text = detailText(row);

  const errors = [];
  if (hasNamedException(text, options)) {
    errors.push("runtime-smoke scoped exception is a no-publish blocker");
  }
  try {
    const parsed = new URL(row.gsavWebUrl);
    if (parsed.protocol !== "https:") {
      errors.push("runtime-smoke GSAV URL must use https");
    }
    if (isLocalOrPrivateHostname(parsed.hostname)) {
      errors.push("runtime-smoke GSAV URL must not use local/private host");
    }
  } catch {
    errors.push("valid runtime-smoke GSAV URL");
  }

  const hostIdentity = runtimeSmokeHostIdentityValue(text);
  if (weakHostIdentityValue(hostIdentity)) {
    errors.push("explicit GSAV host/build identity value");
  }

  const bridgeText = text
    .split(/[;|]/)
    .filter((segment) => /GSAV_BRIDGE_READY|bridge/i.test(segment))
    .join("; ");
  if (!/GSAV_BRIDGE_READY/i.test(bridgeText) || !/(?:bridge\s*)?v(?:ersion)?\s*[:=]?\s*v?\d+|\bbridge\s+v\d+\b|version\s*[:=]\s*v?\d+/i.test(bridgeText)) {
    errors.push("GSAV_BRIDGE_READY version");
  }
  if (!/minVersion\s*[:=]?\s*v?\d+|minimum\s+version\s*v?\d+/i.test(bridgeText)) {
    errors.push("GSAV_BRIDGE_READY minVersion");
  }

  return errors;
}

function detailProblem(row, requirement, options = {}) {
  const text = detailText(row);
  const errors = [];
  const scopedOptions = { ...options, requirement };

  errors.push(...exceptionProblems(text, scopedOptions).map((error) => `exception detail ${error}`));
  errors.push(...scopedExceptionPublishBlockerProblems(text, scopedOptions));
  const ownerIssue = ownerProblem(text);
  if (ownerIssue) errors.push(ownerIssue);
  errors.push(...candidateIdentityProblems(text, requirement, options.candidate));
  errors.push(...trustedEvidenceDetailUrlProblems(row, requirement).map((error) => `trusted URL detail ${error}`));
  errors.push(...routeOrNegativeEvidencePathProblems(row, requirement));

  if (requirement.platform === "Android" || requirement.platform === "iOS") {
    errors.push(...deviceDetailProblems(row, requirement, scopedOptions).map((error) => `device detail ${error}`));
    const missingSignals = routeSignalRequirements(requirement.route)
      .filter((pattern) => !pattern.test(text));
    errors.push(...missingSignals.map((pattern) => `route signal ${pattern}`));
  }

  if (requirement.platform === "Android/iOS") {
    errors.push(...negativeDetailProblems(row, scopedOptions).map((error) => `negative detail ${error}`));
    if (!hasNamedException(text, scopedOptions) && !hasAll(text, [/Android/i, /iOS/i])) {
      errors.push("both Android and iOS evidence or owner/revisit exception");
    }
    errors.push(...negativeEvidenceProblems(row, scopedOptions));
    const missingSignals = negativeSignalRequirements(requirement.route)
      .filter((pattern) => !pattern.test(text));
    errors.push(...missingSignals.map((pattern) => `negative signal ${pattern}`));
  }

  if (requirement.route === "JS runtime smoke") {
    const required = [
      /gsav:runtime-smoke/i,
      /embed=native/i,
      /\/explore\?embed=native&dataSaver=1/i,
      /(?:exactly\s+one|one)\s+`?embed=native`?|embedParamValues/i,
      /(?:exactly\s+one|one)\s+`?dataSaver=1`?|dataSaverParamValues/i,
      /\.shortsFeed|shortsFeed/i,
      /\.shortsItem|shortsItem/i,
      /vertical\s+scroll\s+snap|scroll-snap.*y|scrollSnapType.*y/i,
      /visible\s+scene\s+change\s+after\s+scroll|visible.*scene.*change|afterScroll/i,
      /topNav.*absent|no public topNav|topNav.*not/i,
      /miniPlayer.*absent|no miniPlayer|miniPlayer.*not/i,
      /GSAV_AUTH_READY/i,
      /GSAV_BRIDGE_READY/i,
      /GSAV_ROUTE_CHANGE/i,
      /compatible.*bridge|bridge.*compatible|nativeBridgeVersion|bridgeReady/i,
      /nodeVersion|Node\s*:/i,
      /npmVersion|npm\s*:/i,
      /gsavHostingCommit|gsav-hosting commit|GSAV host identity|deployed host|host build/i,
    ];
    errors.push(...required.filter((pattern) => !pattern.test(text)).map((pattern) => `runtime-smoke detail ${pattern}`));
    errors.push(...runtimeSmokeDetailProblems(row, scopedOptions).map((error) => `runtime-smoke detail ${error}`));
  }

  if (requirement.route === "Validation prerequisites") {
    errors.push(...validationPrereqDetailProblems(text).map((error) => `validation-prereq detail ${error}`));
  }

  if (requirement.route === "Release APK artifact" || requirement.route === "Generated versionCode metadata") {
    const required = [
      /release-candidate SHA|releaseCandidateSha|release candidate/i,
      /evidenceSignoffSha|evidence signoff SHA/i,
      /artifact name|diveo-release/i,
      /checksum-manifest SHA|evidence-checksums|checksum manifest/i,
      /actions\/runs\/\d+|workflow run URL/i,
    ];
    errors.push(...required.filter((pattern) => !pattern.test(text)).map((pattern) => `release identity detail ${pattern}`));
    errors.push(...checksumManifestDetailProblems(text).map((error) => `release identity detail ${error}`));
    errors.push(...releaseCandidateShaDetailProblems(text, options.candidate).map((error) => `release identity detail ${error}`));
    errors.push(...releaseEvidenceRunConsistencyProblems(row, requirement).map((error) => `release identity detail ${error}`));
  }

  if (requirement.route === "Release APK artifact") {
    const required = [
      /verify:release-artifact|release artifact verifier|APK verifier|verifier output/i,
      /EXPO_PUBLIC_GSAV_WEB_URL|production GSAV web URL|GSAV web URL/i,
      /EXPO_PUBLIC_GSAV_CATALOG_URL|production GSAV catalog URL|GSAV catalog URL|catalog URL/i,
      /EXPO_PUBLIC_GSAV_SUPABASE_URL|production Supabase URL|Supabase URL/i,
      /EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY|Supabase anon key|anon key/i,
      /merged manifest|manifest path|AndroidManifest\.xml/i,
      /bundle|APK path|APK/i,
      /cleartext.*disabled|cleartext disabled/i,
      /debuggable.*(?:false|disabled)|not debuggable|non-debuggable/i,
      /(local|localhost|private|10\.0\.2\.2).*absent|absent.*(local|localhost|private|10\.0\.2\.2)/i,
      /(legacy|Bilibili|proxy|DASH).*absent|absent.*(legacy|Bilibili|proxy|DASH)/i,
      /apkSha256|APK[^|;,.]*(sha256|checksum)|(sha256|checksum)[^|;,.]*APK/i,
      /manifestSha256|manifest[^|;,.]*(sha256|checksum)|(sha256|checksum)[^|;,.]*manifest/i,
    ];
    errors.push(...required.filter((pattern) => !pattern.test(text)).map((pattern) => `artifact detail ${pattern}`));
    errors.push(...apkArtifactChecksumProblems(text).map((error) => `artifact detail ${error}`));
  }

  if (requirement.route === "Release-installed APK smoke") {
    const required = [
      /install(?:ed)?(?:\s+exact)?\s+release APK|adb install|installed.*APK/i,
      /launch(?:ed)?|monkey|opened app/i,
      /production GSAV host|production host URL|GSAV web URL|EXPO_PUBLIC_GSAV_WEB_URL/i,
      /\/explore/i,
      /\/gsav-diagnostics/i,
      /\/watch\/test/i,
      /embed=native/i,
      /web chrome.*hidden|hidden web chrome|no web chrome/i,
      /GSAV_BRIDGE_READY|bridge readiness|explicit unsupported|unsupported\/error|unsupported state|error state/i,
      /retry/i,
      /resume|progress/i,
      /android:installed-smoke|capture-android-installed-smoke/i,
      /--apk-path|APK path/i,
      /--output-path|output path|docs[\\/]qa-evidence/i,
      /Android OS version|Android\s+\d|API\s+\d/i,
      /Android WebView version|WebView\s*(?:version)?\s*[:= ]?\s*\d|Chromium\s+\d/i,
      /packageName|package name|com\.opsiclear\.diveo/i,
      /apkSha256|APK[^|;,.]*(sha256|checksum)|(sha256|checksum)[^|;,.]*APK/i,
      /dry-run-summary\.json|dry run summary|dry-run summary/i,
      /apkSha256MatchesDryRunSummary|APK sha256.*match(?:es|ed).*dry-run-summary|dry-run-summary.*APK sha256.*match/i,
      /dumpsys package|installedVersionCode|installed versionCode|package versionCode/i,
      /installedVersionCodeMatchesDryRunSummary|installed versionCode.*match(?:es|ed).*dry-run-summary|dry-run-summary.*versionCode.*match/i,
      /observedSignalsOk\s*=\s*true/i,
      /observedSignalChecks/i,
      /route-change|GSAV_ROUTE_CHANGE/i,
      /bridge-ready-or-error|GSAV_BRIDGE_READY|GSAV_ERROR|unsupported/i,
      /releaseCandidateSha|release-candidate SHA|release candidate/i,
      /--ci-artifact-url|ciArtifactUrl|CI artifact URL/i,
      /gsav:\/\/explore/i,
      /gsav:\/\/gsav-diagnostics/i,
      /gsav:\/\/watch\/test/i,
      /filtered logcat|filtered logs|ReactNativeJS|chromium|WebView/i,
    ];
    errors.push(...required.filter((pattern) => !pattern.test(text)).map((pattern) => `installed-apk detail ${pattern}`));
    errors.push(...releaseCandidateShaDetailProblems(text, options.candidate).map((error) => `installed-apk detail ${error}`));
    errors.push(...installedApkSmokeDetailProblems(text, options.candidate).map((error) => `installed-apk detail ${error}`));
  }

  if (requirement.route === "Generated versionCode metadata") {
    errors.push(...versionCodeDetailProblems(text, options.candidate, scopedOptions).map((error) => `version detail ${error}`));
  }

  if (requirement.route === "Production .gsav range probe") {
    const required = [
      /GSAV_RANGE_PROBE_URL|\.gsav/i,
      /Range\s*:\s*bytes=0-0|bytes=0-0/i,
      /\b206\b/,
      /Content-Range/i,
      /Access-Control-Allow-Origin/i,
      /Access-Control-Expose-Headers/i,
      /release workflow|release preflight|GitHub Actions|workflow_dispatch/i,
    ];
    errors.push(...required.filter((pattern) => !pattern.test(text)).map((pattern) => `range-probe detail ${pattern}`));
    errors.push(...rangeProbeDetailProblems(text).map((error) => `range-probe detail ${error}`));
  }

  if (requirement.route === "Release workflow dry run") {
    const required = [
      /publish_release=false/i,
      /workflow_dispatch|manual/i,
      /production secrets|real secrets|secrets configured/i,
      /workflow|actions|run/i,
      /actions\/runs\/\d+|run URL/i,
      /release-candidate SHA|releaseCandidateSha|diveo commit/i,
      /candidate_ref|candidate ref/i,
      /evidenceSignoffSha|evidence signoff SHA/i,
      /production preflight|gsav:preflight/i,
      /\/explore\?embed=native&dataSaver=1/i,
      /\/native-diagnostics\?embed=native/i,
      /\/watch\/test\?embed=native/i,
      /\/watch\/test\?t=2\.5&embed=native/i,
      /\/watch\/elly\?embed=native/i,
      /Android build|Build Release APK|assembleRelease|Gradle/i,
      /APK verifier|verify:release-artifact|artifact verification/i,
      /bundle verifier|verify:release-evidence-bundle|release evidence bundle/i,
      /evidence upload|uploaded release evidence|upload status/i,
      /release-evidence\/\*\*|release-evidence[\\/]/i,
      /release-evidence[\\/]release-candidate\.txt/i,
      /release-evidence[\\/]signoff-diff-files\.txt/i,
      /release-evidence[\\/]no-publish-side-effect\.txt/i,
      /signoff diff/i,
      /QA\/audit\/evidence-only|QA.*audit.*evidence/i,
      /release-evidence[\\/]gsav-preflight\.json/i,
      /gsav:runtime-smoke|gsav-runtime-smoke\.json/i,
      /release-evidence[\\/]gsav-runtime-smoke\.json/i,
      /release-evidence[\\/]dry-run-summary\.json/i,
      /release-evidence[\\/]evidence-checksums\.txt/i,
      /dry-run-summary\.rangeProbeUrl[^;|]*(?:match|matched)[^;|]*gsav-preflight\.json[^;|]*rangeAsset\.url|gsav-preflight\.json[^;|]*rangeAsset\.url[^;|]*(?:match|matched)[^;|]*dry-run-summary\.rangeProbeUrl/i,
      /dry-run-summary\.rangeRequest[^;|]*(?:match|matched)[^;|]*rangeAsset\.requestRange|rangeAsset\.requestRange[^;|]*(?:match|matched)[^;|]*dry-run-summary\.rangeRequest/i,
      /diveoCommit.*releaseCandidateSha|releaseCandidateSha.*diveoCommit|commit.*match/i,
      /gsav-preflight\.json[^;|]*(?:diveoCommit.*releaseCandidateSha|releaseCandidateSha.*diveoCommit|commit.*match)/i,
      /gsav-runtime-smoke\.json[^;|]*(?:diveoCommit.*releaseCandidateSha|releaseCandidateSha.*diveoCommit|commit.*match)/i,
      /GSAV_HOSTING_COMMIT|GSAV host identity|deployed host|host build/i,
      /GSAV_HOST_IDENTITY_URL|host identity metadata URL|host-served build metadata/i,
      /hostIdentityVerified\s*=?\s*true|host identity verified/i,
      /hostIdentity\.url|host identity metadata URL|metadata URL/i,
      /hostIdentity\.expectedIdentity|expectedIdentity.*GSAV_HOSTING_COMMIT|GSAV_HOSTING_COMMIT.*expectedIdentity/i,
      /hostIdentity\.observedIdentity|observedIdentity.*GSAV_HOSTING_COMMIT|GSAV_HOSTING_COMMIT.*observedIdentity|observed identity.*match/i,
      /artifact name|diveo-release-evidence/i,
      /checksum-manifest SHA|checksum manifest|evidence-checksums\.txt.*(?:sha256|checksum)/i,
      /publishArtifactIdentitySha256\s*[:=]\s*[a-f0-9]{64}\b/i,
      /gsavPackageProvenanceSha256\s*[:=]\s*[a-f0-9]{64}\b/i,
      /gsavPackageProvenance[\s\S]{0,240}@opsiclear\/gsav-bridge/i,
      /gsavPackageProvenance[\s\S]{0,320}@opsiclear\/gsav-client/i,
      /@opsiclear\/gsav-bridge[^;|]{0,180}specifier\s*=\s*file:vendor\/[^;|\s]+\.tgz[^;|]{0,180}tarballSha256\s*=\s*[a-f0-9]{64}\b/i,
      /@opsiclear\/gsav-client[^;|]{0,180}specifier\s*=\s*file:vendor\/[^;|\s]+\.tgz[^;|]{0,180}tarballSha256\s*=\s*[a-f0-9]{64}\b/i,
      /artifact review signoff|evidence artifact review/i,
      /reviewer\s*[:=]|reviewer=/i,
      /reviewedAt\s*[:=]|reviewed at|review timestamp/i,
      /GitHub run conclusion|run conclusion\s*[:=]|conclusion\s*=\s*success/i,
      /downloaded checksum-manifest SHA(?:256)?|downloaded.*checksum-manifest/i,
      /downloaded.*verify:release-evidence-bundle|verify:release-evidence-bundle.*downloaded|bundle verifier.*downloaded/i,
      /githubReleasePresent\s*=\s*false/i,
      /expected_apk_sha256\s*[:=]\s*[a-f0-9]{64}\b/i,
      /expected_publish_identity_sha256\s*[:=]\s*[a-f0-9]{64}\b/i,
      /EXPECTED_RELEASE_APK_SHA256\s*[:=]\s*[a-f0-9]{64}\b/i,
      /EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256\s*[:=]\s*[a-f0-9]{64}\b/i,
      /git status[^;|]*(?:release-evidence|generated)|release-evidence[^;|]*git status/i,
      /git rev-parse HEAD/i,
      /remote ref HEAD|remote ref/i,
      /gh release view/i,
      /githubReleaseLookup\s*=\s*not_found|authenticated[^;|]*not.?found|not.?found[^;|]*authenticated/i,
      /workflowSha/i,
      /no GitHub release|no release created|release not created|no publish(?:ing)? side effect/i,
      /no (?:GitHub release, )?commit|no git commit|no commit|commit (?:not created|not run|not performed)/i,
      /no (?:GitHub release, commit, )?push|no git push|no push|push (?:not created|not run|not performed)/i,
      /no (?:GitHub release, commit, push, )?version bump|no release-time version|no version bump|version bump (?:not created|not run|not performed)/i,
    ];
    errors.push(...required.filter((pattern) => !pattern.test(text)).map((pattern) => `dry-run detail ${pattern}`));
    errors.push(...releaseDryRunHostIdentityProblems(text).map((error) => `dry-run host identity detail ${error}`));
    errors.push(...checksumManifestDetailProblems(text).map((error) => `dry-run detail ${error}`));
    errors.push(...publishArtifactIdentityDetailProblems(text).map((error) => `dry-run detail ${error}`));
    errors.push(...artifactReviewDetailProblems(text).map((error) => `dry-run artifact review detail ${error}`));
    errors.push(...releaseCandidateShaDetailProblems(text, options.candidate, { checkCandidateRef: true }).map((error) => `dry-run identity detail ${error}`));
    errors.push(...releaseEvidenceRunConsistencyProblems(row, requirement).map((error) => `dry-run identity detail ${error}`));
  }

  if (requirement.route === "Master branch protection") {
    errors.push(...branchProtectionDetailProblems(row, { root: options.root ?? process.cwd() }).map((error) => `branch-protection detail ${error}`));
  }

  return errors.length > 0 ? `missing evidence detail: ${errors.join(", ")}` : null;
}

function resultStatusProblem(result) {
  const normalized = normalizeCell(result);
  if (!/^Passed(?::|\s+with\s+scoped\s+exception:)/i.test(normalized)) {
    return "result must start with Passed: or Passed with scoped exception:";
  }
  if (/^(?:Failed|Skipped|Blocked|Pending)\b/i.test(normalized)
    || /\bnot\s+passed\b/i.test(normalized)
    || /\b(?:failed|skipped|pending)\b/i.test(normalized)
    || /\bblocked\s+(?:by|pending|until|because|due)\b/i.test(normalized)) {
    return "result must not contain failed, skipped, pending, or blocker status language";
  }
  return null;
}

function incompleteReason(row, requirement, options = {}) {
  const root = options.root ?? process.cwd();
  if (!row) return "missing evidence row";
  const pendingField = [row.date, row.platform, row.device, row.gsavWebUrl, row.route, row.result].find(isPending);
  if (pendingField) return "row has pending required fields";
  const dateIssue = evidenceDateProblem(row.date, options);
  if (dateIssue) return dateIssue;
  const evidenceIssue = evidenceProblem(row.evidencePath, root);
  if (evidenceIssue) return evidenceIssue;
  const resultIssue = resultStatusProblem(row.result);
  if (resultIssue) return resultIssue;
  if (requirement.resultIncludes && !row.result.includes(requirement.resultIncludes)) {
    return `result must include ${requirement.resultIncludes}`;
  }
  const detailIssue = detailProblem(row, requirement, options);
  if (detailIssue) return detailIssue;
  return null;
}

function isCompleteEvidence(row, requirement, options = {}) {
  return incompleteReason(row, requirement, options) === null;
}

function findEvidence(rows, requirement) {
  const matches = rows.filter((row) => row.platform === requirement.platform && row.route === requirement.route);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

function deviceValidationRows(rows) {
  return requiredEvidence
    .filter((requirement) => ["Android", "iOS", "Android/iOS"].includes(requirement.platform))
    .map((requirement) => findEvidence(rows, requirement))
    .filter(Boolean);
}

function defaultDevicePacketPathForRows(rows) {
  const dates = Array.from(new Set(
    deviceValidationRows(rows)
      .map((row) => normalizeCell(row.date))
      .filter(Boolean),
  ));

  if (dates.length === 0) {
    return { problem: `device evidence packet path is missing; set ${DEVICE_PACKET_ENV}` };
  }
  if (dates.length > 1) {
    return {
      problem: `device evidence rows use multiple dates (${dates.join(", ")}); set ${DEVICE_PACKET_ENV} to the reviewed packet manifest`,
    };
  }

  return {
    problem: `device evidence packet path is missing; set ${DEVICE_PACKET_ENV} to the reviewed non-scaffold packet manifest for ${dates[0]}`,
  };
}

function relativeOrOriginal(root, filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
  return relativePath && !relativePath.startsWith("..") ? relativePath : filePath.replace(/\\/g, "/");
}

function reviewedDevicePacketPathProblems(packetPath, { root = process.cwd(), label = "device evidence packet" } = {}) {
  if (!packetPath) return [];

  const displayPath = relativeOrOriginal(root, packetPath);
  const problems = [];
  if (!/^docs\/qa-evidence\/\d{4}-\d{2}-\d{2}\/[^/]+\.json$/i.test(displayPath)) {
    problems.push(`${label} path must be a reviewed packet JSON under docs/qa-evidence/<date>`);
  }
  if (/(?:scaffold|candidate|pending|example)/i.test(path.basename(displayPath))) {
    problems.push(`${label} path must not reference a scaffold, candidate, pending, or example packet`);
  }
  return problems;
}

function deviceEvidencePacketProblems({
  root = process.cwd(),
  rows = [],
  qaPath = QA_EVIDENCE_PATH,
  devicePacketPath = null,
  devicePacketScriptPath = DEFAULT_DEVICE_PACKET_SCRIPT_PATH,
  candidate = null,
} = {}) {
  const defaultPath = devicePacketPath ? { packetPath: devicePacketPath } : defaultDevicePacketPathForRows(rows);
  if (defaultPath.problem) return [defaultPath.problem];

  const packetPath = defaultPath.packetPath;
  const pathProblems = reviewedDevicePacketPathProblems(packetPath, { root });
  if (pathProblems.length > 0) return pathProblems;

  const packetAbsolutePath = path.isAbsolute(packetPath) ? packetPath : path.join(root, packetPath);
  const packetDisplayPath = relativeOrOriginal(root, packetPath);
  if (!fs.existsSync(packetAbsolutePath)) {
    return [`device evidence packet missing at ${packetDisplayPath}`];
  }

  const qaAbsolutePath = path.isAbsolute(qaPath) ? qaPath : path.join(root, qaPath);
  const args = [
    devicePacketScriptPath,
    "--check",
    "--input-path",
    packetAbsolutePath,
    "--qa-path",
    qaAbsolutePath,
  ];
  if (candidate?.commit) {
    args.push("--candidate-sha", candidate.commit);
  }

  try {
    execFileSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return [];
  } catch (error) {
    const stdout = String(error.stdout ?? "");
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed.problems) && parsed.problems.length > 0) {
        return parsed.problems.map((problem) => `device evidence packet ${problem}`);
      }
    } catch {
      // Fall through to a compact process-output error.
    }
    const stderr = String(error.stderr ?? "").trim();
    const output = [stdout.trim(), stderr].filter(Boolean).join(" ").slice(0, 500);
    return [`device evidence packet check failed for ${packetDisplayPath}${output ? `: ${output}` : ""}`];
  }
}

function externalEvidenceInventoryProblems({
  root = process.cwd(),
  rows = [],
  qaPath = QA_EVIDENCE_PATH,
  externalEvidenceInventoryPath = null,
  externalEvidenceInventoryScriptPath = DEFAULT_EXTERNAL_EVIDENCE_INVENTORY_SCRIPT_PATH,
  devicePacketPath = null,
} = {}) {
  if (!externalEvidenceInventoryPath) {
    return [`external evidence inventory path is missing; set ${EXTERNAL_EVIDENCE_INVENTORY_ENV}`];
  }

  const inventoryAbsolutePath = path.isAbsolute(externalEvidenceInventoryPath)
    ? externalEvidenceInventoryPath
    : path.join(root, externalEvidenceInventoryPath);
  const inventoryDisplayPath = relativeOrOriginal(root, externalEvidenceInventoryPath);
  if (!fs.existsSync(inventoryAbsolutePath)) {
    return [`external evidence inventory missing at ${inventoryDisplayPath}`];
  }

  const qaAbsolutePath = path.isAbsolute(qaPath) ? qaPath : path.join(root, qaPath);
  const args = [
    externalEvidenceInventoryScriptPath,
    "--inventory-path",
    inventoryAbsolutePath,
    "--qa-path",
    qaAbsolutePath,
  ];

  const defaultPath = devicePacketPath ? { packetPath: devicePacketPath } : defaultDevicePacketPathForRows(rows);
  if (defaultPath.problem) return [defaultPath.problem];
  const packetPath = defaultPath.packetPath;
  if (packetPath) {
    const pathProblems = reviewedDevicePacketPathProblems(packetPath, { root, label: "external evidence inventory packet" });
    if (pathProblems.length > 0) return pathProblems;
    args.push("--packet-path", path.isAbsolute(packetPath) ? packetPath : path.join(root, packetPath));
  }
  args.push("--require-git-integrity");

  try {
    execFileSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return [];
  } catch (error) {
    const stdout = String(error.stdout ?? "");
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed.problems) && parsed.problems.length > 0) {
        return parsed.problems.map((problem) => `external evidence inventory ${problem}`);
      }
    } catch {
      // Fall through to a compact process-output error.
    }
    const stderr = String(error.stderr ?? "").trim();
    const output = [stdout.trim(), stderr].filter(Boolean).join(" ").slice(0, 500);
    return [`external evidence inventory check failed for ${inventoryDisplayPath}${output ? `: ${output}` : ""}`];
  }
}

function deferredFinalInputProblems({
  root = process.cwd(),
  devicePacketPath = null,
  externalEvidenceInventoryPath = null,
  auditText = "",
} = {}) {
  const problems = [];

  if (!devicePacketPath) {
    problems.push({
      id: "deferred device evidence packet input",
      platform: "Device evidence",
      route: "Strict final inputs",
      reason: `device evidence packet path is missing; set ${DEVICE_PACKET_ENV} to the reviewed non-scaffold packet manifest`,
    });
  } else {
    const pathProblems = reviewedDevicePacketPathProblems(devicePacketPath, { root });
    const packetAbsolutePath = path.isAbsolute(devicePacketPath) ? devicePacketPath : path.join(root, devicePacketPath);
    problems.push(...pathProblems.map((reason) => ({
      id: "deferred device evidence packet input",
      platform: "Device evidence",
      route: "Strict final inputs",
      reason,
    })));
    if (pathProblems.length === 0 && !fs.existsSync(packetAbsolutePath)) {
      problems.push({
        id: "deferred device evidence packet input",
        platform: "Device evidence",
        route: "Strict final inputs",
        reason: `device evidence packet missing at ${relativeOrOriginal(root, devicePacketPath)}`,
      });
    }
  }

  if (!externalEvidenceInventoryPath) {
    problems.push({
      id: "deferred external evidence inventory input",
      platform: "External evidence",
      route: "Strict final inputs",
      reason: `external evidence inventory path is missing; set ${EXTERNAL_EVIDENCE_INVENTORY_ENV}`,
    });
  } else {
    const inventoryAbsolutePath = path.isAbsolute(externalEvidenceInventoryPath)
      ? externalEvidenceInventoryPath
      : path.join(root, externalEvidenceInventoryPath);
    if (!fs.existsSync(inventoryAbsolutePath)) {
      problems.push({
        id: "deferred external evidence inventory input",
        platform: "External evidence",
        route: "Strict final inputs",
        reason: `external evidence inventory missing at ${relativeOrOriginal(root, externalEvidenceInventoryPath)}`,
      });
    }
  }

  const text = String(auditText ?? "");
  if (!text.trim()) {
    problems.push({
      id: "deferred audit signoff input",
      platform: "Audit",
      route: "Strict final inputs",
      reason: "audit signoff document is missing",
    });
  } else {
    const signoffText = finalPublishSignoffSection(text);
    if (!signoffText) {
      problems.push({
        id: "deferred audit signoff input",
        platform: "Audit",
        route: "Strict final inputs",
        reason: "audit signoff must include ## Final Publish Signoff section",
      });
    } else {
      problems.push(...auditEvidencePathProblems(signoffText, {
        externalEvidenceInventoryPath,
        devicePacketPath,
      }).map((reason) => ({
        id: "deferred audit signoff input",
        platform: "Audit",
        route: "Strict final inputs",
        reason,
      })));
    }
  }

  return problems;
}

function analyzeReleaseReadiness(qaText, options = {}) {
  const root = options.root ?? process.cwd();
  const candidate = Object.prototype.hasOwnProperty.call(options, "candidate")
    ? options.candidate
    : readCandidateIdentity(root);
  const rows = parseEvidenceRows(qaText);
  const auditText = options.auditText ?? "";
  const finalCommandReceiptsPath = finalCommandReceiptsPathFromAudit(auditText);
  const stackReceiptPath = stackReceiptPathFromAudit(auditText);
  const lastMileEvidencePaths = lastMileEvidencePathsFromAudit(auditText);
  const schemaMissing = evidenceLogSchemaProblems(qaText).map((reason) => ({
    id: "evidence log schema",
    platform: "QA",
    route: "Evidence Log",
    reason,
  }));
  const rowSetMissing = evidenceLogRowSetProblems(qaText).map((reason) => ({
    id: "evidence log row set",
    platform: "QA",
    route: "Evidence Log",
    reason,
  }));
  const duplicateRowMissing = evidenceLogDuplicateRowProblems(qaText).map((reason) => ({
    id: "evidence log duplicate rows",
    platform: "QA",
    route: "Evidence Log",
    reason,
  }));
  const evidenceMissing = requiredEvidence
    .map((requirement) => {
      const row = findEvidence(rows, requirement);
      return {
        ...requirement,
        reason: incompleteReason(row, requirement, { ...options, root, candidate }),
      };
    })
    .filter((result) => result.reason !== null);
  const negativeInventoryMissing = negativeCaseCoverageProblems(qaText).map((reason) => ({
    id: "negative fixture inventory alignment",
    platform: "QA",
    route: "Negative Fixture Inventory",
    reason,
  }));
  const routeMatrixMissing = routeMatrixCoverageProblems(qaText).map((reason) => ({
    id: "required route matrix alignment",
    platform: "QA",
    route: "Required Route Matrix",
    reason,
  }));
  const releaseRequirementMissing = releaseEvidenceRequirementsProblems(qaText).map((reason) => ({
    id: "release evidence requirements alignment",
    platform: "QA",
    route: "Release Evidence Requirements",
    reason,
  }));
  const missing = [
    ...schemaMissing,
    ...rowSetMissing,
    ...duplicateRowMissing,
    ...evidenceMissing,
    ...negativeInventoryMissing,
    ...routeMatrixMissing,
    ...releaseRequirementMissing,
  ];
  const deferredFinalInputMissing = missing.length > 0 && options.reportDeferredFinalInputs === true
    ? deferredFinalInputProblems({
        root,
        devicePacketPath: options.devicePacketPath ?? null,
        externalEvidenceInventoryPath: options.externalEvidenceInventoryPath ?? null,
        auditText: options.auditText ?? "",
      })
    : [];
  const candidateIntegrityMissing = missing.length === 0
    ? candidateIdentityIntegrityProblems(candidate).map((reason) => ({
        id: "release candidate identity integrity",
        platform: "Git",
        route: "Release candidate identity",
        reason,
      }))
    : [];
  const evidenceIntegrityMissing = missing.length === 0 && candidateIntegrityMissing.length === 0 && options.enforceEvidenceGitIntegrity === true
    ? evidenceIntegrityProblems({
        root,
        rows,
        qaPath: options.qaPath ?? QA_EVIDENCE_PATH,
        auditPath: options.auditPath ?? null,
        externalEvidenceInventoryPath: options.externalEvidenceInventoryPath ?? null,
        devicePacketPath: options.devicePacketPath ?? null,
        stackReceiptPath,
        finalCommandReceiptsPath,
        lastMileEvidencePaths,
      }).map((reason) => ({
        id: "release evidence git integrity",
        platform: "Git",
        route: "Release evidence files",
        reason,
      }))
    : [];
  const devicePacketMissing = missing.length === 0
    && candidateIntegrityMissing.length === 0
    && evidenceIntegrityMissing.length === 0
    && options.enforceDevicePacket === true
    ? deviceEvidencePacketProblems({
        root,
        rows,
        qaPath: options.qaPath ?? QA_EVIDENCE_PATH,
        devicePacketPath: options.devicePacketPath ?? null,
        devicePacketScriptPath: options.devicePacketScriptPath ?? DEFAULT_DEVICE_PACKET_SCRIPT_PATH,
        candidate,
      }).map((reason) => ({
        id: "device evidence packet reconciliation",
        platform: "Device evidence",
        route: "Device packet",
        reason,
      }))
    : [];
  const externalEvidenceInventoryMissing = missing.length === 0
    && candidateIntegrityMissing.length === 0
    && evidenceIntegrityMissing.length === 0
    && devicePacketMissing.length === 0
    && options.enforceExternalEvidenceInventory === true
    ? externalEvidenceInventoryProblems({
        root,
        rows,
        qaPath: options.qaPath ?? QA_EVIDENCE_PATH,
        externalEvidenceInventoryPath: options.externalEvidenceInventoryPath ?? null,
        externalEvidenceInventoryScriptPath: options.externalEvidenceInventoryScriptPath ?? DEFAULT_EXTERNAL_EVIDENCE_INVENTORY_SCRIPT_PATH,
        devicePacketPath: options.devicePacketPath ?? null,
      }).map((reason) => ({
        id: "external evidence inventory replay",
        platform: "External evidence",
        route: "External evidence inventory",
        reason,
      }))
    : [];
  const auditSignoffMissing = missing.length === 0
    && candidateIntegrityMissing.length === 0
    && evidenceIntegrityMissing.length === 0
    && devicePacketMissing.length === 0
    && externalEvidenceInventoryMissing.length === 0
    && (options.enforceAuditSignoff === true || typeof options.auditText === "string")
    ? auditSignoffProblems(auditText, {
        root,
        candidate,
        rows,
        externalEvidenceInventoryPath: options.externalEvidenceInventoryPath ?? null,
        devicePacketPath: options.devicePacketPath ?? null,
        finalReceiptBootstrapPath: options.finalReceiptBootstrapPath ?? null,
      }).map((reason) => ({
        id: "audit publish signoff",
        platform: "Audit",
        route: "Final publish signoff",
        reason,
      }))
    : [];

  return {
    ok: missing.length === 0
      && deferredFinalInputMissing.length === 0
      && candidateIntegrityMissing.length === 0
      && evidenceIntegrityMissing.length === 0
      && devicePacketMissing.length === 0
      && externalEvidenceInventoryMissing.length === 0
      && auditSignoffMissing.length === 0,
    checked: requiredEvidence.length,
    missing: [
      ...missing,
      ...deferredFinalInputMissing,
      ...candidateIntegrityMissing,
      ...evidenceIntegrityMissing,
      ...devicePacketMissing,
      ...externalEvidenceInventoryMissing,
      ...auditSignoffMissing,
    ],
  };
}

function usage() {
  return "Usage: node scripts/verify-release-readiness.js [--strict-final-inputs]";
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    strictFinalInputs: false,
  };
  for (const arg of argv) {
    if (arg === "--strict-final-inputs") {
      options.strictFinalInputs = true;
    } else {
      throw new Error(usage());
    }
  }
  return options;
}

function main() {
  let cliOptions;
  try {
    cliOptions = parseArgs();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const qaPath = path.join(process.cwd(), "docs", "GSAV_NATIVE_QA.md");
  const auditPath = path.join(process.cwd(), AUDIT_EVIDENCE_PATH);
  const result = analyzeReleaseReadiness(fs.readFileSync(qaPath, "utf8"), {
    root: process.cwd(),
    candidate: readCandidateIdentity(process.cwd()),
    qaPath,
    auditPath,
    enforceEvidenceGitIntegrity: true,
    enforceDevicePacket: true,
    devicePacketPath: process.env[DEVICE_PACKET_ENV] || null,
    enforceExternalEvidenceInventory: true,
    externalEvidenceInventoryPath: process.env[EXTERNAL_EVIDENCE_INVENTORY_ENV] || null,
    auditText: fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf8") : "",
    enforceAuditSignoff: true,
    finalReceiptBootstrapPath: process.env[FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV] || null,
    reportDeferredFinalInputs: cliOptions.strictFinalInputs,
  });
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    status: result.ok ? "pass" : "fail",
    qaPath: normalizeCell(path.relative(process.cwd(), qaPath)).replace(/\\/g, "/"),
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
  analyzeReleaseReadiness,
  apkArtifactChecksumProblems,
  auditSignoffProblems,
  branchProtectionDetailProblems,
  candidateIdentityIntegrityProblems,
  checksumManifestDetailProblems,
  commitMatches,
  detailProblem,
  deferredFinalInputProblems,
  deviceEvidencePacketProblems,
  deviceValidationHelperEvidenceCandidates,
  evidenceLogDuplicateRowProblems,
  evidenceLogRowSetProblems,
  evidenceLogSchemaProblems,
  evidenceIntegrityProblems,
  evidenceDateProblem,
  evidenceProblem,
  externalEvidenceInventoryProblems,
  externalReviewLedgerCoverageProblems,
  exceptionProblems,
  findEvidence,
  isCompleteEvidence,
  isAllowedEvidenceSignoffPath,
  negativeCaseCoverageProblems,
  parseArgs,
  parseNegativeFixtureInventoryCases,
  parseNegativeFixtureInventoryRows,
  parseExternalReviewLedgerRows,
  parseReleaseEvidenceRequirementRows,
  parseRequiredRouteMatrixRoutes,
  parseEvidenceRows,
  publishArtifactIdentityDetailProblems,
  rangeProbeDetailProblems,
  validationPrereqDetailProblems,
  releaseDryRunHostIdentityProblems,
  readCandidateIdentity,
  releaseSignoffIntegrityProblems,
  releaseEvidenceRequirementsProblems,
  resultStatusProblem,
  routeOrNegativeEvidencePathProblems,
  routeMatrixCoverageProblems,
  runtimeSmokeHostIdentityValue,
  runtimeSmokeDetailProblems,
  requiredEvidence,
  DEFAULT_MAX_EVIDENCE_AGE_DAYS,
  FINAL_RECEIPT_EXPECTED_STEP_LABELS,
  REQUIRED_RELEASE_EVIDENCE_REQUIREMENT_ROWS,
  REQUIRED_EXTERNAL_REVIEW_LEDGER_CATEGORIES,
  DEVICE_PACKET_ENV,
  EXTERNAL_EVIDENCE_INVENTORY_ENV,
  FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV,
};
