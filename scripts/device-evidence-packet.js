#!/usr/bin/env node
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const {
  deviceValidationHelperEvidenceCandidates,
  findEvidence,
  parseEvidenceRows,
  requiredEvidence,
  resultStatusProblem,
} = require("./verify-release-readiness.js");
const { trackedCleanPathProblems } = require("./git-integrity.js");

const SCHEMA_VERSION = "device-evidence-packet/v1";
const DEVICE_PLATFORMS = new Set(["Android", "iOS", "Android/iOS"]);
const TRUSTED_RELEASE_REPOSITORIES = [
  "opsiclear/diveo",
  "opsiclear-web/diveo",
];
const TRUSTED_EVIDENCE_REPOSITORIES = [
  ...TRUSTED_RELEASE_REPOSITORIES,
  "opsiclear/gsav-hosting",
];
const LOCAL_MEDIA_EVIDENCE_EXTENSIONS = new Set([
  ".gif",
  ".gz",
  ".jpeg",
  ".jpg",
  ".m4v",
  ".mov",
  ".mp4",
  ".pdf",
  ".png",
  ".tar",
  ".tgz",
  ".webm",
  ".webp",
  ".zip",
]);

const ROUTE_SIGNALS = {
  "/": ["native home/feed", "no hosted web chrome"],
  "/search": ["native search", "watch route opens from result"],
  "/library": ["release-owned signed-in fixture", "saved scene opens watch route", "account-safe evidence"],
  "/creator/:handle": ["native creator profile", "scene navigation reaches watch route"],
  "/explore": ["embed=native", "dataSaver=1 when enabled", "hidden hosted chrome"],
  "/gsav-diagnostics": ["native diagnostics route", "bridge capability or route-change signal"],
  "/watch/test": ["GSAV_BRIDGE_READY or explicit unsupported/error state", "retry or resume signal"],
  "/gsav/test?t=2.5": ["native alias preserves id", "start time preserved", "embed=native"],
};

const ROUTE_UX_FIELDS = [
  "rotation",
  "safeArea",
  "backNavigation",
  "noClippedText",
  "noNestedTouch",
  "touchTarget44dp",
];

const PRODUCT_JOURNEY_ARTIFACT_PURPOSE = "product-journey-manifest";
const PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS = [
  "first-launch-home",
  "search",
  "creator",
  "library",
  "login-auth-return",
  "watch-alias",
  "explore",
  "diagnostics-hierarchy",
  "settings",
  "accessibility-ergonomics",
  "degraded-blocked-states",
];

const PRODUCT_JOURNEY_ENTRY_REQUIREMENTS = {
  "first-launch-home": [
    { label: "native Home feed state", pattern: /(?:native home|home)[\s\S]*(?:feed|loading|empty|error|populated)/i },
    { label: "no hosted web chrome", pattern: /no hosted (?:web )?chrome/i },
    {
      label: "Search, Library, and Settings visible",
      pattern: /(?=[\s\S]*search)(?=[\s\S]*library)(?=[\s\S]*settings)/i,
    },
    { label: "Explore placement is not a competing catalog shell", pattern: /explore[\s\S]*(?:placement|not[\s\S]*competing catalog shell)/i },
    { label: "Explore is secondary or runtime-scoped", pattern: /explore[\s\S]*(?:secondary|runtime[-/]scoped)/i },
  ],
  search: [
    { label: "search empty/results/no-results state", pattern: /(?:empty first[- ]run|result list|results|no[- ]results? state?)/i },
    { label: "keyboard visible without overlap", pattern: /keyboard[\s\S]*(?:without overlap|no overlap|not clipped)/i },
    { label: "result opens watch route", pattern: /result[\s\S]*opens[\s\S]*(?:\/watch|watch route)/i },
  ],
  creator: [
    { label: "real creator content", pattern: /real creator content/i },
    { label: "follow signed-out to login and return", pattern: /follow[\s\S]*signed[- ]out[\s\S]*(?:login[\s\S]*return|return[\s\S]*login)/i },
    { label: "scene opens watch route", pattern: /scene[\s\S]*opens[\s\S]*(?:\/watch|watch route)/i },
  ],
  library: [
    { label: "logged-out call to action", pattern: /logged[- ]out[\s\S]*(?:cta|call to action)/i },
    { label: "signed-in seeded saved scenes", pattern: /signed[- ]in[\s\S]*seeded[\s\S]*saved scenes/i },
    { label: "account-safe redaction", pattern: /account[- ]safe[\s\S]*redaction/i },
  ],
  "login-auth-return": [
    {
      label: "signed-out Library or save/follow entry",
      pattern: /(?:signed[- ]out[\s\S]*(?:library|save\/follow|save|follow)|(?:library|save\/follow|save|follow)[\s\S]*signed[- ]out)/i,
    },
    { label: "keyboard-visible native Login UI", pattern: /keyboard[\s\S]*native login/i },
    { label: "account-safe redaction", pattern: /account[- ]safe[\s\S]*redaction/i },
    { label: "return to requested native route", pattern: /return[\s\S]*requested native route/i },
    { label: "no hosted account chrome", pattern: /no hosted account chrome/i },
  ],
  "watch-alias": [
    { label: "watch route reaches ready or explicit unsupported/error state", pattern: /\/watch\/test[\s\S]*(?:ready|unsupported|error) state/i },
    { label: "alias embeds hosted watch route with start time", pattern: /\/gsav\/test\?t=2\.5[\s\S]*\/watch\/test\?t=2\.5[\s\S]*embed=native/i },
    { label: "progress saves and resume works", pattern: /progress[\s\S]*saves[\s\S]*resume works/i },
  ],
  explore: [
    { label: "exactly one embed=native marker", pattern: /exactly one[\s\S]*embed=native/i },
    { label: "data saver adds dataSaver=1", pattern: /data saver[\s\S]*dataSaver=1/i },
    { label: "vertical swipe or scroll changes active scene", pattern: /vertical[\s\S]*(?:swipe|scroll)[\s\S]*(?:active[- ]scene|scene changes|changes active scene|active scene changes)/i },
    { label: "visible active-scene change", pattern: /visible[\s\S]*active[- ]scene change|active[- ]scene[\s\S]*(?:visibly changes|visible change|change observed)/i },
    { label: "hidden hosted public/account chrome", pattern: /hidden[\s\S]*hosted[\s\S]*(?:public|account)[\s\S]*chrome|hosted[\s\S]*(?:public|account)[\s\S]*chrome[\s\S]*hidden/i },
    { label: "native-shell back behavior", pattern: /native[- ]shell[\s\S]*back behavior|back[\s\S]*returns[\s\S]*native shell/i },
    { label: "same-origin hosted product routes stay inside the player boundary", pattern: /same[- ]origin[\s\S]*hosted product routes?[\s\S]*(?:do not escape|stay inside|blocked)[\s\S]*(?:player boundary|native catalog)/i },
  ],
  "diagnostics-hierarchy": [
    { label: "Home does not expose diagnostics as primary", pattern: /home[\s\S]*(?:does not expose|not primary)[\s\S]*diagnostics/i },
    { label: "Settings exposes secondary diagnostics action", pattern: /settings[\s\S]*(?:secondary[\s\S]*diagnostics|diagnostics[\s\S]*secondary)/i },
    { label: "diagnostics embeds native-diagnostics route", pattern: /diagnostics[\s\S]*\/native-diagnostics\?embed=native/i },
  ],
  settings: [
    { label: "scrollable operational settings sections", pattern: /scrollable[\s\S]*settings/i },
    { label: "secondary diagnostics or maintenance action", pattern: /secondary[\s\S]*(?:diagnostics|maintenance)/i },
    { label: "settings touch targets", pattern: /touch targets?/i },
  ],
  "accessibility-ergonomics": [
    { label: "safe-area coverage", pattern: /safe[- ]area/i },
    { label: "no clipped text", pattern: /no clipped text/i },
    { label: "44dp touch targets", pattern: /44dp[\s\S]*touch targets?/i },
    { label: "no nested touch conflicts", pattern: /no nested touch/i },
  ],
  "degraded-blocked-states": [
    { label: "nonblank native blocked state", pattern: /nonblank[\s\S]*(?:native )?blocked state/i },
    { label: "unsupported or retry error state", pattern: /(?:unsupported|retry|error)[\s\S]*state/i },
    { label: "no blank WebView", pattern: /no blank webview/i },
  ],
};

const EMBEDDED_ROUTE_HANDOFF_ROUTES = new Set([
  "/explore",
  "/gsav-diagnostics",
  "/watch/test",
  "/gsav/test?t=2.5",
]);
const SAME_ORIGIN_PRODUCT_PATH_PATTERN =
  /\/(?:creator\/qa-native-blocked|creator\/[^\s;|,]+|creators\b|account\/[^\s;|,]+|studio\b|upload\b|watchlist\b|explore-preview\b)|(?:same-origin|native-owned)[\s\S]{0,80}\broot\b/i;
const SAME_ORIGIN_TRIGGER_PATTERN =
  /(?:tap(?:ped)?\s+`?Same-origin`?|EXPO_PUBLIC_GSAV_QA_CONTROLS=1|\/gsav-diagnostics|reviewed route fixture|reviewed hosted control)/i;
const SAME_ORIGIN_VISIBLE_STATE_PATTERN =
  /(?:Navigation blocked|blocked-navigation|nonblank(?:\s+native)?\s+(?:blocked\s+)?state|no blank WebView)/i;

const NEGATIVE_DETAILS = {
  "Missing host config": {
    trigger: "Launch an embedded route without EXPO_PUBLIC_GSAV_WEB_URL.",
    signals: ["native config/error UI", "no blank WebView"],
  },
  "Host offline/retry": {
    trigger: "Open /watch/test, stop or block the GSAV host, then recover and tap retry.",
    signals: ["retry UI appears", "retry recovers after host returns"],
  },
  "Cross-origin navigation": {
    trigger: "Build with EXPO_PUBLIC_GSAV_QA_CONTROLS=1, open /gsav-diagnostics, then tap Cross-origin.",
    signals: ["untrusted navigation blocked", "app stays on trusted route"],
    qaFlag: "EXPO_PUBLIC_GSAV_QA_CONTROLS=1",
  },
  "Unsupported renderer": {
    trigger: "Build with EXPO_PUBLIC_GSAV_QA_CONTROLS=1, open /gsav-diagnostics, then tap Unsupported.",
    signals: ["native unsupported overlay", "no blank WebView"],
    qaFlag: "EXPO_PUBLIC_GSAV_QA_CONTROLS=1",
  },
  "Auth initialization gate": {
    trigger: "Build with EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000, then mount /gsav-diagnostics or /watch/test.",
    signals: ["no clear-session bridge message before auth initialization"],
    qaFlag: "EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS=5000",
  },
  "Ended playback": {
    trigger: "Build with EXPO_PUBLIC_GSAV_QA_CONTROLS=1, open /gsav-diagnostics, tap Ended, then reopen /watch/test.",
    signals: ["GSAV_ENDED observed", "saved progress cleared"],
    qaFlag: "EXPO_PUBLIC_GSAV_QA_CONTROLS=1",
  },
};

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    root: process.cwd(),
    check: false,
    example: false,
    allowPending: false,
    date: env.EVIDENCE_DATE || null,
    owner: env.EVIDENCE_OWNER || env.GITHUB_ACTOR || null,
    candidateSha: env.RELEASE_CANDIDATE_SHA || null,
    evidenceSignoffSha: env.EVIDENCE_SIGNOFF_SHA || null,
    appVersion: null,
    packageVersion: null,
    androidVersionCode: null,
    dryRunArtifact: env.RELEASE_DRY_RUN_ARTIFACT || env.DRY_RUN_ARTIFACT || null,
    dryRunRunUrl: env.RELEASE_DRY_RUN_RUN_URL || env.DRY_RUN_RUN_URL || null,
    gsavHostUrl: env.EXPO_PUBLIC_GSAV_WEB_URL || env.GSAV_WEB_URL || null,
    gsavHostingCommit: env.GSAV_HOSTING_COMMIT || env.GSAV_HOST_BUILD_ID || null,
    productJourneyManifestPath: env.PRODUCT_JOURNEY_MANIFEST_PATH || null,
    outputPath: null,
    inputPath: null,
    qaPath: "docs/GSAV_NATIVE_QA.md",
    requireGitIntegrity: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--example") {
      options.example = true;
    } else if (arg === "--allow-pending") {
      options.allowPending = true;
    } else if (arg === "--require-git-integrity") {
      options.requireGitIntegrity = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a non-empty value.`);
      if (!(key in options)) throw new Error(`Unknown option: ${arg}`);
      options[key] = value;
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (options.check && options.example) {
    throw new Error("--check and --example cannot be used together.");
  }
  if (options.check && !options.inputPath) {
    throw new Error("--check requires --input-path.");
  }
  if (!options.check && !options.example && !options.outputPath) {
    throw new Error("--output-path is required when writing a packet scaffold.");
  }
  return options;
}

function readPackageIdentity(root) {
  const appJson = readJsonIfExists(path.join(root, "app.json"))?.expo ?? {};
  const packageJson = readJsonIfExists(path.join(root, "package.json")) ?? {};
  return {
    appVersion: appJson.version ?? null,
    packageVersion: packageJson.version ?? null,
    androidVersionCode: appJson.android?.versionCode ?? null,
  };
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeSlash(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function validateIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateIsoTimestamp(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)
    && !Number.isNaN(Date.parse(text));
}

function fullSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value ?? "").trim());
}

function semver(value) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(value ?? "").trim());
}

function concreteHostUrl(value) {
  try {
    const parsed = new URL(String(value ?? "").trim());
    return parsed.protocol === "https:"
      && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase())
      && !/(?:^|\.)example\.(?:com|net|org)$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function dryRunArtifactName(value) {
  return /^diveo-release-evidence-v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(value ?? "").trim());
}

function trustedGithubActionsRunUrl(value) {
  try {
    const parsed = new URL(String(value ?? "").trim());
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return false;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    const match = /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)$/.exec(parsed.pathname);
    if (!match) return false;
    const repository = `${match[1]}/${match[2]}`.toLowerCase();
    return TRUSTED_RELEASE_REPOSITORIES.includes(repository);
  } catch {
    return false;
  }
}

function weakValue(value) {
  return !String(value ?? "").trim()
    || /^(?:<.+>|owner|release owner|native release owner|reviewer|todo|tbd|pending|unknown|placeholder)$/i.test(String(value).trim());
}

function weakIdentityValue(value) {
  return weakValue(value) || /\b(?:pending|placeholder|example|unknown|unavailable|todo|tbd)\b/i.test(String(value ?? ""));
}

function slugify(value) {
  const normalized = String(value)
    .replace(/^\/$/, "home")
    .replace(/:handle/g, "handle")
    .replace(/[/?=:]+/g, "-")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
  return normalized || "root";
}

function deviceRequirements() {
  return requiredEvidence.filter((requirement) => DEVICE_PLATFORMS.has(requirement.platform));
}

function packetSlug(requirement) {
  if (requirement.platform === "Android/iOS") return `negative-${slugify(requirement.route)}`;
  return `${requirement.platform.toLowerCase()}-route-${slugify(requirement.route)}`;
}

function expectedPaths(date, requirement) {
  const slug = packetSlug(requirement);
  return [
    `docs/qa-evidence/${date}/${slug}.txt`,
    `docs/qa-evidence/${date}/${slug}.png`,
    `docs/qa-evidence/${date}/${slug}.mp4`,
  ];
}

function requiredActualFields(requirement) {
  const common = [
    "owner",
    "device",
    "osVersion",
    "gsavHostUrl",
    "gsavHostingCommit",
    "observedSignals",
    "evidencePaths",
    "redaction",
  ];
  const routeFields = requirement.platform === "Android/iOS"
    ? []
    : ROUTE_UX_FIELDS.map((field) => `ux.${field}`);
  const embeddedHandoffFields = EMBEDDED_ROUTE_HANDOFF_ROUTES.has(requirement.route)
    ? ["sameOriginProductPathOutcome"]
    : [];
  if (requirement.platform === "Android") {
    return [...common, "androidWebViewVersion", "buildProfile", ...routeFields, ...embeddedHandoffFields];
  }
  if (requirement.platform === "iOS") {
    return [...common, "wkWebViewVersion", "executorProof", "artifactUrl", "artifactSha256", ...routeFields, ...embeddedHandoffFields];
  }
  return [
    "owner",
    "trigger",
    "gsavHostUrl",
    "gsavHostingCommit",
    "observedSignals",
    "evidencePaths",
    "android.device",
    "android.osVersion",
    "android.webViewVersion",
    "ios.device",
    "ios.osVersion",
    "ios.wkWebViewVersion",
    "redaction",
  ];
}

function createPacket(requirement, target) {
  const negativeDetail = NEGATIVE_DETAILS[requirement.route] ?? null;
  const routeSignals = ROUTE_SIGNALS[requirement.route] ?? [`Observed route signal for ${requirement.route}`];
  return {
    id: packetSlug(requirement),
    type: requirement.platform === "Android/iOS" ? "negative" : "route",
    status: "pending",
    qaRow: {
      id: requirement.id,
      platform: requirement.platform,
      route: requirement.route,
    },
    owner: target.defaultOwner,
    expectedEvidencePaths: expectedPaths(target.evidenceDate, requirement),
    requiredActualFields: requiredActualFields(requirement),
    requiredSignals: negativeDetail?.signals ?? routeSignals,
    trigger: negativeDetail?.trigger ?? null,
    qaFlag: negativeDetail?.qaFlag ?? null,
    actual: {
      owner: target.defaultOwner,
      device: "",
      osVersion: "",
      androidWebViewVersion: "",
      wkWebViewVersion: "",
      executorProof: "",
      buildProfile: "",
      gsavHostUrl: target.gsavHostUrl,
      gsavHostingCommit: target.gsavHostingCommit,
      finalEmbeddedUrl: "",
      trigger: negativeDetail?.trigger ?? "",
      observedSignals: [],
      evidencePaths: [],
      mediaSha256: [],
      fileSha256: [],
      artifactPurpose: "",
      evidenceManifestPath: "",
      evidenceManifestSha256: "",
      sourceRunId: "",
      sourceArtifactId: "",
      artifactUrl: "",
      artifactSha256: "",
      sameOriginProductPathOutcome: "",
      ux: {
        rotation: "",
        safeArea: "",
        backNavigation: "",
        noClippedText: "",
        noNestedTouch: "",
        touchTarget44dp: "",
      },
      redaction: "",
      android: {
        device: "",
        osVersion: "",
        webViewVersion: "",
      },
      ios: {
        device: "",
        osVersion: "",
        wkWebViewVersion: "",
      },
    },
  };
}

function createDeviceEvidencePacket({
  root = process.cwd(),
  date,
  owner,
  candidateSha,
    evidenceSignoffSha = null,
    appVersion,
    packageVersion,
    androidVersionCode,
    dryRunArtifact,
    dryRunRunUrl,
    gsavHostUrl,
    gsavHostingCommit,
    productJourneyManifestPath,
    now = new Date(),
} = {}) {
  const identity = readPackageIdentity(root);
  const evidenceDate = date || now.toISOString().slice(0, 10);
  const target = {
    evidenceDate,
    defaultOwner: owner || null,
    releaseCandidateSha: candidateSha || null,
    evidenceSignoffSha: evidenceSignoffSha || null,
    appVersion: appVersion || identity.appVersion,
    packageVersion: packageVersion || identity.packageVersion,
    androidVersionCode: androidVersionCode ? Number(androidVersionCode) : identity.androidVersionCode,
    dryRunArtifact: dryRunArtifact || null,
    dryRunRunUrl: dryRunRunUrl || null,
    gsavHostUrl: gsavHostUrl || null,
    gsavHostingCommit: gsavHostingCommit || null,
    productJourneyManifestPath: productJourneyManifestPath || `docs/qa-evidence/${evidenceDate}/product-journey-manifest.json`,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    note: "This packet scaffolds device validation evidence. It does not mark QA rows passed.",
    target,
    summary: {
      totalPackets: deviceRequirements().length,
      routePackets: deviceRequirements().filter((requirement) => requirement.platform !== "Android/iOS").length,
      negativePackets: deviceRequirements().filter((requirement) => requirement.platform === "Android/iOS").length,
    },
    packets: deviceRequirements().map((requirement) => createPacket(requirement, target)),
  };
}

function exampleTargetOptions({ root = process.cwd(), now = new Date(), ...overrides } = {}) {
  const identity = readPackageIdentity(root);
  const appVersion = overrides.appVersion || identity.appVersion || "1.0.19";
  return {
    root,
    date: overrides.date || now.toISOString().slice(0, 10),
    owner: overrides.owner || "@native-validation-owner",
    candidateSha: overrides.candidateSha || "0123456789abcdef0123456789abcdef01234567",
    evidenceSignoffSha: overrides.evidenceSignoffSha || null,
    appVersion,
    packageVersion: overrides.packageVersion || identity.packageVersion || appVersion,
    androidVersionCode: overrides.androidVersionCode || identity.androidVersionCode || 10019,
    dryRunArtifact: overrides.dryRunArtifact || `diveo-release-evidence-v${appVersion}`,
    dryRunRunUrl: overrides.dryRunRunUrl || "https://github.com/OpsiClear-Web/diveo/actions/runs/1234567890",
    gsavHostUrl: overrides.gsavHostUrl || "https://gsav.opsiclear.dev",
    gsavHostingCommit: overrides.gsavHostingCommit || "gsav-host-0123456789abcdef",
    productJourneyManifestPath: overrides.productJourneyManifestPath,
    now,
  };
}

function createDeviceEvidencePacketExample(options = {}) {
  const targetOptions = exampleTargetOptions(options);
  const manifest = createDeviceEvidencePacket(targetOptions);
  const routePacket = manifest.packets.find((packet) => packet.id === "android-route-watch-test");
  const negativePacket = manifest.packets.find((packet) => packet.id === "negative-cross-origin-navigation");

  routePacket.status = "passed";
  routePacket.actual = {
    ...routePacket.actual,
    owner: targetOptions.owner,
    device: "Pixel 8 emulator",
    osVersion: "Android 15 API 35",
    androidWebViewVersion: "126.0.0.1",
    buildProfile: "release",
    gsavHostUrl: targetOptions.gsavHostUrl,
    gsavHostingCommit: targetOptions.gsavHostingCommit,
    finalEmbeddedUrl: `${targetOptions.gsavHostUrl}/watch/test?embed=native`,
    observedSignals: [
      "GSAV_BRIDGE_READY or explicit unsupported/error state",
      "retry or resume signal",
    ],
    evidencePaths: [
      `docs/qa-evidence/${targetOptions.date}/android-route-watch-test.txt`,
      `docs/qa-evidence/${targetOptions.date}/android-route-watch-test.mp4`,
    ],
    mediaSha256: ["a".repeat(64)],
    sameOriginProductPathOutcome: "Tapped Same-origin in /gsav-diagnostics with EXPO_PUBLIC_GSAV_QA_CONTROLS=1; /creator/qa-native-blocked failed closed with visible Navigation blocked nonblank native state",
    ux: {
      rotation: "portrait and landscape checked",
      safeArea: "notch and gesture areas clear",
      backNavigation: "Android hardware back traversed WebView history first",
      noClippedText: "no clipped text observed",
      noNestedTouch: "no nested-touch ambiguity observed",
      touchTarget44dp: "all primary controls at least 44dp",
    },
    redaction: "account-safe",
  };

  negativePacket.status = "passed";
  negativePacket.actual = {
    ...negativePacket.actual,
    owner: targetOptions.owner,
    trigger: "Built with EXPO_PUBLIC_GSAV_QA_CONTROLS=1, opened /gsav-diagnostics, then tapped Cross-origin.",
    gsavHostUrl: targetOptions.gsavHostUrl,
    gsavHostingCommit: targetOptions.gsavHostingCommit,
    observedSignals: [
      "untrusted navigation blocked",
      "app stays on trusted route",
    ],
    evidencePaths: [
      `docs/qa-evidence/${targetOptions.date}/android-negative-cross-origin-navigation.txt`,
      `docs/qa-evidence/${targetOptions.date}/ios-negative-cross-origin-navigation.txt`,
    ],
    android: {
      device: "Pixel 8 emulator",
      osVersion: "Android 15 API 35",
      webViewVersion: "126.0.0.1",
    },
    ios: {
      device: "iPhone 15 simulator",
      osVersion: "iOS 18.5",
      wkWebViewVersion: "WebKit 619.1",
    },
    redaction: "account-safe",
  };

  return {
    schemaVersion: `${SCHEMA_VERSION}/example`,
    generatedAt: targetOptions.now.toISOString(),
    note: "Reviewed packet excerpt only. Generate the pending pre-G3 scaffold with --output-path, use a post-G3 candidate packet while entries are still pending, and save the final reviewed packet at a non-scaffold path before strict final readiness.",
    target: manifest.target,
    routePacket,
    negativePacket,
    commands: {
      scaffold: "npm run device-evidence:packet -- --date <YYYY-MM-DD> --owner <reviewer> --candidate-sha <payload-sha> --gsav-host-url <https production GSAV host> --gsav-hosting-commit <GSAV_HOSTING_COMMIT> --output-path docs/qa-evidence/<date>/device-evidence-packet-scaffold.json",
      candidate: "npm run device-evidence:packet -- --date <YYYY-MM-DD> --owner <reviewer> --candidate-sha <payload-sha> --dry-run-artifact diveo-release-evidence-v<version> --dry-run-run-url <https://github.com/.../actions/runs/...> --gsav-host-url <https production GSAV host> --gsav-hosting-commit <GSAV_HOSTING_COMMIT> --output-path docs/qa-evidence/<date>/device-evidence-packet-candidate.json",
      checkCandidate: "npm run device-evidence:packet -- --check --allow-pending --input-path docs/qa-evidence/<date>/device-evidence-packet-candidate.json --qa-path docs/GSAV_NATIVE_QA.md --candidate-sha <payload-sha>",
      checkReviewed: "npm run device-evidence:packet -- --check --input-path docs/qa-evidence/<date>/device-evidence-packet-reviewed.json --qa-path docs/GSAV_NATIVE_QA.md --candidate-sha <payload-sha>",
      example: "npm run device-evidence:packet -- --example",
    },
  };
}

function trustedGithubEvidenceUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return false;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const repository = parts.slice(0, 2).join("/").toLowerCase();
    if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) return false;
    const rest = parts.slice(2).join("/");
    return /^actions\/runs\/\d+(?:\/artifacts\/[^/]+)?$/i.test(rest)
      || /^releases(?:\/tag\/[^/]+|\/download\/[^/]+\/[^/]+)?$/i.test(rest)
      || /^blob\/[^/]+\/docs\/qa-evidence\/.+/i.test(rest);
  } catch {
    return false;
  }
}

function githubEvidencePathKind(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return "other";
    const parts = parsed.pathname.split("/").filter(Boolean);
    const repository = parts.slice(0, 2).join("/").toLowerCase();
    if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) return "other";
    const rest = parts.slice(2).join("/");
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

function githubEvidenceIdentity(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const repository = parts.slice(0, 2).join("/").toLowerCase();
    if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) return null;
    const rest = parts.slice(2);
    if (
      rest.length === 5
      && rest[0]?.toLowerCase() === "actions"
      && rest[1]?.toLowerCase() === "runs"
      && /^\d+$/.test(rest[2])
      && rest[3]?.toLowerCase() === "artifacts"
    ) {
      return {
        kind: "actions-artifact",
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
        kind: "release-download",
        sourceRunId: null,
        sourceArtifactId: decodeURIComponent(rest[3] ?? ""),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function directGithubEvidenceUrlProblem(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "actual.artifactUrl is empty";
  if (!trustedGithubEvidenceUrl(raw)) {
    return "actual.artifactUrl must be trusted GitHub evidence";
  }
  const kind = githubEvidencePathKind(raw);
  if (kind === "actions-run") {
    return "actual.artifactUrl must use a direct artifact/blob, not a bare Actions run URL";
  }
  if (kind === "release-tag") {
    return "actual.artifactUrl must use a direct artifact/blob, not a release tag URL";
  }
  if (!["actions-artifact", "release-download", "qa-blob"].includes(kind)) {
    return "actual.artifactUrl must use a direct Actions artifact, release download, or docs/qa-evidence blob";
  }
  return null;
}

function evidencePathProblem(value, root) {
  const raw = String(value ?? "").trim();
  if (!raw) return "evidence path is empty";
  if (/^https?:\/\//i.test(raw)) {
    return trustedGithubEvidenceUrl(raw) ? null : "external evidence URL is not trusted GitHub evidence";
  }
  if (/^file:\/\//i.test(raw) || path.isAbsolute(raw)) return "evidence path must be repository-relative";
  const normalized = normalizeSlash(raw);
  if (!normalized.startsWith("docs/qa-evidence/")) return "local evidence path must be under docs/qa-evidence";
  if (!fs.existsSync(path.join(root, normalized))) return "local evidence path does not exist";
  return null;
}

function localEvidencePathDateProblem(value, expectedEvidenceDate, fieldName) {
  if (!validateIsoDate(expectedEvidenceDate)) return null;
  if (!isRepositoryLocalEvidencePath(value)) return null;
  const normalized = normalizeSlash(value);
  const match = /^docs\/qa-evidence\/([^/]+)\//.exec(normalized);
  if (!match) {
    return `${fieldName} must be under docs/qa-evidence/<date>/`;
  }
  if (match[1] !== expectedEvidenceDate) {
    return `${fieldName} date must match packet target evidence date ${expectedEvidenceDate}: ${normalized}`;
  }
  return null;
}

function externalPacketEvidenceProblems(packet, evidencePath) {
  if (!/^https?:\/\//i.test(String(evidencePath ?? ""))) return [];
  const kind = githubEvidencePathKind(evidencePath);
  if (kind === "actions-run") {
    return [`${packet.id} route or negative packet evidence must use a direct artifact/blob with a manifest, not a bare Actions run URL: ${evidencePath}`];
  }
  if (kind === "release-tag") {
    return [`${packet.id} route or negative packet evidence must use a direct artifact/blob with a manifest, not a release tag URL: ${evidencePath}`];
  }
  if (kind === "qa-blob") return [];
  if (!["actions-artifact", "release-download"].includes(kind)) return [];

  const expectedPurpose = packet.type === "negative" ? "negative-evidence" : "route-evidence";
  const problems = [];
  if (String(packet.actual?.artifactPurpose ?? "").trim() !== expectedPurpose) {
    problems.push(`${packet.id} external artifact evidence must set actual.artifactPurpose to ${expectedPurpose}`);
  }
  if (weakValue(packet.actual?.evidenceManifestPath)) {
    problems.push(`${packet.id} external artifact evidence must set actual.evidenceManifestPath`);
  }
  if (!/^[a-f0-9]{64}$/i.test(String(packet.actual?.evidenceManifestSha256 ?? ""))) {
    problems.push(`${packet.id} external artifact evidence must set actual.evidenceManifestSha256 to 64-hex`);
  }
  if (!/^\d+$/.test(String(packet.actual?.sourceRunId ?? ""))) {
    problems.push(`${packet.id} external artifact evidence must set actual.sourceRunId to digits`);
  }
  if (weakValue(packet.actual?.sourceArtifactId)) {
    problems.push(`${packet.id} external artifact evidence must set actual.sourceArtifactId`);
  }
  const identity = githubEvidenceIdentity(evidencePath);
  const actualSourceRunId = String(packet.actual?.sourceRunId ?? "").trim();
  const actualSourceArtifactId = String(packet.actual?.sourceArtifactId ?? "").trim();
  if (identity?.sourceRunId && actualSourceRunId && actualSourceRunId !== identity.sourceRunId) {
    problems.push(`${packet.id} actual.sourceRunId must match evidence artifact URL run ${identity.sourceRunId}`);
  }
  if (identity?.sourceArtifactId && actualSourceArtifactId && actualSourceArtifactId !== identity.sourceArtifactId) {
    problems.push(`${packet.id} actual.sourceArtifactId must match evidence artifact URL segment ${identity.sourceArtifactId}`);
  }
  return problems;
}

function isLocalMediaEvidencePath(value) {
  const raw = String(value ?? "").trim();
  if (!raw || /^https?:\/\//i.test(raw) || /^file:\/\//i.test(raw) || path.isAbsolute(raw)) return false;
  const normalized = normalizeSlash(raw);
  if (!normalized.startsWith("docs/qa-evidence/")) return false;
  return LOCAL_MEDIA_EVIDENCE_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}

function isExternalArtifactEvidencePath(value) {
  return ["actions-artifact", "release-download"].includes(githubEvidencePathKind(value));
}

function localEvidenceManifestProblems(packet, root, expectedEvidenceDate = null) {
  const rawPath = String(packet.actual?.evidenceManifestPath ?? "").trim();
  if (!rawPath) return [];
  if (/^https?:\/\//i.test(rawPath) || /^file:\/\//i.test(rawPath) || path.isAbsolute(rawPath)) {
    return [];
  }
  const normalizedPath = normalizeSlash(rawPath);
  if (!normalizedPath.startsWith("docs/qa-evidence/")) return [];
  const problems = [];
  const dateProblem = localEvidencePathDateProblem(rawPath, expectedEvidenceDate, `${packet.id} actual.evidenceManifestPath`);
  if (dateProblem) problems.push(dateProblem);
  const expectedSha = String(packet.actual?.evidenceManifestSha256 ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/i.test(expectedSha)) {
    problems.push(`${packet.id} local evidenceManifestPath requires actual.evidenceManifestSha256 to be 64-hex`);
    return problems;
  }
  const fullPath = path.join(root, normalizedPath);
  if (!fs.existsSync(fullPath)) {
    problems.push(`${packet.id} local evidenceManifestPath does not exist: ${normalizedPath}`);
    return problems;
  }
  const actualSha = sha256File(fullPath);
  if (actualSha !== expectedSha) {
    problems.push(`${packet.id} local evidenceManifestPath SHA256 mismatch: expected ${expectedSha}, got ${actualSha}`);
  }
  return problems;
}

function isRepositoryLocalEvidencePath(value) {
  const raw = String(value ?? "").trim();
  if (!raw || /^https?:\/\//i.test(raw) || /^file:\/\//i.test(raw) || path.isAbsolute(raw)) return false;
  return normalizeSlash(raw).startsWith("docs/qa-evidence/");
}

function productJourneyManifestPath(target) {
  const evidenceDate = target?.evidenceDate;
  return validateIsoDate(evidenceDate)
    ? `docs/qa-evidence/${evidenceDate}/product-journey-manifest.json`
    : null;
}

function productJourneyFixtureManifestPath(target) {
  const evidenceDate = target?.evidenceDate;
  return validateIsoDate(evidenceDate)
    ? `docs/qa-evidence/${evidenceDate}/fixture-manifest.json`
    : null;
}

function productJourneyLocalEvidencePathsFromTarget(target, root = process.cwd()) {
  const manifestPath = String(target?.productJourneyManifestPath ?? "").trim();
  if (!isRepositoryLocalEvidencePath(manifestPath)) return [];
  const fullPath = path.join(root, normalizeSlash(manifestPath));
  if (!fs.existsSync(fullPath)) return [];
  try {
    const manifest = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const paths = [];
    if (isRepositoryLocalEvidencePath(manifest.fixtureManifestPath)) {
      paths.push(manifest.fixtureManifestPath);
    }
    for (const entry of manifest.entries ?? []) {
      for (const evidencePath of entry.evidencePaths ?? []) {
        if (isRepositoryLocalEvidencePath(evidencePath)) paths.push(evidencePath);
      }
    }
    return paths;
  } catch {
    return [];
  }
}

function productJourneyEntryEvidenceProblems(entry, root = process.cwd()) {
  const entryId = entry?.id ?? "unknown";
  const problems = [];
  const evidencePaths = Array.isArray(entry?.evidencePaths) ? entry.evidencePaths : [];
  const localEvidencePaths = [];
  const externalEvidencePaths = [];

  for (const evidencePath of evidencePaths) {
    const problem = evidencePathProblem(evidencePath, root);
    if (problem) {
      problems.push(`product journey entry ${entryId} ${problem}: ${evidencePath}`);
      continue;
    }
    if (isRepositoryLocalEvidencePath(evidencePath)) localEvidencePaths.push(evidencePath);
    if (/^https?:\/\//i.test(String(evidencePath ?? ""))) externalEvidencePaths.push(evidencePath);
  }

  const mediaSha256 = shaArray(entry?.mediaSha256);
  for (const sha of mediaSha256) {
    if (!/^[a-f0-9]{64}$/i.test(String(sha))) {
      problems.push(`product journey entry ${entryId} mediaSha256 must be 64-hex: ${sha}`);
    }
  }
  if (localEvidencePaths.length !== mediaSha256.length) {
    problems.push(`product journey entry ${entryId} mediaSha256 must include one 64-hex hash per local evidence path (${localEvidencePaths.length} required)`);
  }
  if (localEvidencePaths.length === mediaSha256.length) {
    localEvidencePaths.forEach((evidencePath, index) => {
      const expectedSha = String(mediaSha256[index] ?? "").trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/i.test(expectedSha)) return;
      const normalizedPath = normalizeSlash(evidencePath);
      const fullPath = path.join(root, normalizedPath);
      if (!fs.existsSync(fullPath)) return;
      const actualSha = sha256File(fullPath);
      if (actualSha !== expectedSha) {
        problems.push(`product journey entry ${entryId} mediaSha256 mismatch for ${normalizedPath}: expected ${expectedSha}, got ${actualSha}`);
      }
    });
  }

  const fileSha256 = shaArray(entry?.fileSha256);
  for (const sha of fileSha256) {
    if (!/^[a-f0-9]{64}$/i.test(String(sha))) {
      problems.push(`product journey entry ${entryId} fileSha256 must be 64-hex: ${sha}`);
    }
  }
  if (externalEvidencePaths.length !== fileSha256.length) {
    problems.push(`product journey entry ${entryId} fileSha256 must include one 64-hex hash per external evidence URL (${externalEvidencePaths.length} required)`);
  }

  for (const evidencePath of externalEvidencePaths) {
    const identity = githubEvidenceIdentity(evidencePath);
    if (identity?.sourceRunId && String(entry?.sourceRunId ?? "") !== identity.sourceRunId) {
      problems.push(`product journey entry ${entryId} sourceRunId must match evidence URL run ${identity.sourceRunId}`);
    }
    if (identity?.sourceArtifactId && String(entry?.sourceArtifactId ?? "") !== identity.sourceArtifactId) {
      problems.push(`product journey entry ${entryId} sourceArtifactId must match evidence URL artifact ${identity.sourceArtifactId}`);
    }
  }

  return problems;
}

function productJourneyEntryRequirementProblems(entryId, entry) {
  const requirements = PRODUCT_JOURNEY_ENTRY_REQUIREMENTS[entryId] ?? [];
  if (requirements.length === 0) return [];
  const observations = entry?.observedSignals ?? entry?.observations;
  const observationText = Array.isArray(observations)
    ? observations.map((value) => String(value ?? "")).join("\n")
    : "";
  return requirements
    .filter((requirement) => !requirement.pattern.test(observationText))
    .map((requirement) => (
      `product journey entry ${entryId} observedSignals must include ${requirement.label}`
    ));
}

function productJourneyManifestRequiredFieldProblems(manifest) {
  const problems = [];
  for (const fieldPath of [
    "android.device",
    "android.osVersion",
    "android.webViewVersion",
    "ios.device",
    "ios.osVersion",
    "ios.wkWebViewVersion",
  ]) {
    if (!fieldPresent(getNested(manifest, fieldPath))) {
      problems.push(`product journey manifest ${fieldPath} must be concrete`);
    }
  }
  for (const fieldPath of ["android.apkSha256", "ios.artifactSha256"]) {
    const value = String(getNested(manifest, fieldPath) ?? "").trim();
    if (!/^[a-f0-9]{64}$/i.test(value)) {
      problems.push(`product journey manifest ${fieldPath} must be 64-hex`);
    }
  }
  return problems;
}

function productJourneyManifestProblems(target, root = process.cwd()) {
  const problems = [];
  const expectedPath = productJourneyManifestPath(target);
  const expectedFixturePath = productJourneyFixtureManifestPath(target);
  const rawPath = String(target?.productJourneyManifestPath ?? "").trim();
  const normalizedPath = normalizeSlash(rawPath);

  if (!expectedPath || normalizedPath !== expectedPath) {
    problems.push("target.productJourneyManifestPath must be docs/qa-evidence/<date>/product-journey-manifest.json");
  }
  if (!normalizedPath) return problems;
  if (/^https?:\/\//i.test(normalizedPath) || /^file:\/\//i.test(normalizedPath) || path.isAbsolute(normalizedPath)) {
    problems.push("target.productJourneyManifestPath must be repository-relative");
    return problems;
  }

  const fullPath = path.join(root, normalizedPath);
  if (!fs.existsSync(fullPath)) {
    problems.push(`target.productJourneyManifestPath does not exist: ${normalizedPath}`);
    return problems;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    problems.push(`target.productJourneyManifestPath JSON is invalid: ${error.message}`);
    return problems;
  }

  if (manifest.artifactPurpose !== PRODUCT_JOURNEY_ARTIFACT_PURPOSE) {
    problems.push(`product journey manifest artifactPurpose must be ${PRODUCT_JOURNEY_ARTIFACT_PURPOSE}`);
  }
  if (manifest.helperOnly !== false) {
    problems.push("product journey manifest helperOnly must be false");
  }
  for (const field of [
    "releaseCandidateSha",
    "dryRunArtifact",
    "dryRunRunUrl",
    "gsavHostUrl",
    "gsavHostingCommit",
  ]) {
    if (String(manifest[field] ?? "") !== String(target?.[field] ?? "")) {
      problems.push(`product journey manifest ${field} must match packet target`);
    }
  }
  if (weakValue(manifest.reviewer)) {
    problems.push("product journey manifest reviewer must be concrete");
  }
  if (!validateIsoTimestamp(manifest.reviewedAt)) {
    problems.push("product journey manifest reviewedAt must be ISO timestamp");
  }
  const fixtureManifestPath = normalizeSlash(manifest.fixtureManifestPath ?? "");
  if (!expectedFixturePath || fixtureManifestPath !== expectedFixturePath) {
    problems.push("product journey manifest fixtureManifestPath must be docs/qa-evidence/<date>/fixture-manifest.json");
  }
  if (fixtureManifestPath) {
    if (/^https?:\/\//i.test(fixtureManifestPath) || /^file:\/\//i.test(fixtureManifestPath) || path.isAbsolute(fixtureManifestPath)) {
      problems.push("product journey manifest fixtureManifestPath must be repository-relative");
    } else {
      const fixturePath = path.join(root, fixtureManifestPath);
      if (!fs.existsSync(fixturePath)) {
        problems.push(`product journey manifest fixtureManifestPath does not exist: ${fixtureManifestPath}`);
      }
      const expectedFixtureSha = String(manifest.fixtureManifestSha256 ?? "").trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/i.test(expectedFixtureSha)) {
        problems.push("product journey manifest fixtureManifestSha256 must be 64-hex");
      } else if (fs.existsSync(fixturePath)) {
        const actualFixtureSha = sha256File(fixturePath);
        if (actualFixtureSha !== expectedFixtureSha) {
          problems.push(`product journey manifest fixtureManifestSha256 mismatch for ${fixtureManifestPath}: expected ${expectedFixtureSha}, got ${actualFixtureSha}`);
        }
      }
    }
  }
  problems.push(...productJourneyManifestRequiredFieldProblems(manifest));
  if (!Array.isArray(manifest.entries)) {
    problems.push("product journey manifest entries must be an array");
    return problems;
  }

  const entriesById = new Map();
  for (const entry of manifest.entries) {
    const entryId = String(entry?.id ?? "").trim();
    if (!entryId) continue;
    if (entriesById.has(entryId)) {
      problems.push(`product journey manifest has duplicate entry ${entryId}`);
      continue;
    }
    entriesById.set(entryId, entry);
  }
  for (const entryId of PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS) {
    const entry = entriesById.get(entryId);
    if (!entry) {
      problems.push(`product journey manifest is missing entry ${entryId}`);
      continue;
    }
    const platforms = Array.isArray(entry.platforms) ? entry.platforms.map((value) => String(value)) : [];
    if (!platforms.includes("Android") || !platforms.includes("iOS")) {
      problems.push(`product journey entry ${entryId} must cover Android and iOS`);
    }
    if (!Array.isArray(entry.evidencePaths) || entry.evidencePaths.length === 0) {
      problems.push(`product journey entry ${entryId} must include evidencePaths`);
    } else if (!hasDistinctPlatformEvidencePaths(entry.evidencePaths)) {
      problems.push(`product journey entry ${entryId} evidencePaths must include distinct Android and iOS evidence paths`);
    }
    const observations = entry.observedSignals ?? entry.observations;
    if (!Array.isArray(observations) || observations.length === 0) {
      problems.push(`product journey entry ${entryId} must include observedSignals or observations`);
    }
    problems.push(...productJourneyEntryRequirementProblems(entryId, entry));
    problems.push(...productJourneyEntryEvidenceProblems(entry, root));
  }

  return problems;
}

function localPacketEvidencePaths(manifest, {
  root = process.cwd(),
  includeProductJourneyManifest = true,
} = {}) {
  const paths = [];
  if (includeProductJourneyManifest && isRepositoryLocalEvidencePath(manifest?.target?.productJourneyManifestPath)) {
    paths.push(manifest.target.productJourneyManifestPath);
    paths.push(...productJourneyLocalEvidencePathsFromTarget(manifest.target, root));
  }
  for (const packet of manifest?.packets ?? []) {
    for (const evidencePath of packet.actual?.evidencePaths ?? []) {
      if (isRepositoryLocalEvidencePath(evidencePath)) paths.push(evidencePath);
    }
    const evidenceManifestPath = packet.actual?.evidenceManifestPath;
    if (isRepositoryLocalEvidencePath(evidenceManifestPath)) paths.push(evidenceManifestPath);
  }
  return paths;
}

function devicePacketGitIntegrityProblems(manifest, {
  root = process.cwd(),
  inputPath = null,
  qaPath = null,
  includeProductJourneyManifest = true,
} = {}) {
  return trackedCleanPathProblems(root, [
    inputPath,
    qaPath,
    ...localPacketEvidencePaths(manifest, { root, includeProductJourneyManifest }),
  ], {
    insideRepositoryMessage: (filePath) => `device evidence file must be inside the repository before final readiness: ${filePath}`,
    untrackedMessage: (relativePath) => `device evidence file must be tracked in git before final readiness: ${relativePath}`,
    dirtyMessage: (status) => `device evidence files must be committed before final readiness: ${status}`,
    noGitMessage: () => "device evidence files must be checked in a git workspace before final readiness.",
  });
}

function localMediaEvidenceHashProblems(packet, root, localMediaEvidencePaths, mediaSha256) {
  const problems = [];
  if (localMediaEvidencePaths.length !== mediaSha256.length) return problems;

  localMediaEvidencePaths.forEach((evidencePath, index) => {
    const normalizedPath = normalizeSlash(evidencePath);
    const expectedSha = String(mediaSha256[index] ?? "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/i.test(expectedSha)) return;

    const fullPath = path.join(root, normalizedPath);
    if (!fs.existsSync(fullPath)) return;

    const actualSha = sha256File(fullPath);
    if (actualSha !== expectedSha) {
      problems.push(
        `${packet.id} mediaSha256 mismatch for ${normalizedPath}: expected ${expectedSha}, got ${actualSha}`,
      );
    }
  });

  return problems;
}

function shaArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

function platformEvidenceMatches(value, platform) {
  const normalized = normalizeSlash(value).toLowerCase();
  const pattern = platform === "android"
    ? /(?:^|[/?#&=._-])android(?:[/?#&=._-]|$)/
    : /(?:^|[/?#&=._-])ios(?:[/?#&=._-]|$)/;
  return pattern.test(normalized);
}

function hasDistinctPlatformEvidencePaths(evidencePaths) {
  const androidEvidencePaths = evidencePaths.filter((evidencePath) => platformEvidenceMatches(evidencePath, "android"));
  const iosEvidencePaths = evidencePaths.filter((evidencePath) => platformEvidenceMatches(evidencePath, "ios"));
  return androidEvidencePaths.some((androidPath) => (
    iosEvidencePaths.some((iosPath) => normalizeSlash(androidPath) !== normalizeSlash(iosPath))
  ));
}

function getNested(object, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current?.[key], object);
}

function fieldPresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  return !weakValue(value);
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

function strictPacketInputPathProblems(inputPath, { root = process.cwd(), allowPending = false } = {}) {
  if (allowPending || !inputPath) return [];

  const displayPath = relativeOrOriginal(root, inputPath);
  const problems = [];
  if (!/^docs\/qa-evidence\/\d{4}-\d{2}-\d{2}\/[^/]+\.json$/i.test(displayPath)) {
    problems.push(`${displayPath} input path must be a reviewed packet JSON under docs/qa-evidence/<date>`);
  }

  const basename = path.basename(displayPath);
  if (/(?:scaffold|candidate|pending|example)/i.test(basename)) {
    problems.push(`${displayPath} input path must not reference a scaffold, candidate, pending, or example packet`);
  }

  return problems;
}

function sameOriginProductPathOutcomeProblems(packet) {
  const outcome = String(packet.actual?.sameOriginProductPathOutcome ?? "");
  if (!outcome.trim()) return [];
  const problems = [];

  if (!/\b(blocked|fail(?:ed)? closed|native route|native-owned|interstitial)\b/i.test(outcome)) {
    problems.push(`${packet.id} sameOriginProductPathOutcome must describe blocked, native-route, interstitial, or fail-closed behavior`);
  }
  if (!SAME_ORIGIN_PRODUCT_PATH_PATTERN.test(outcome)) {
    problems.push(`${packet.id} sameOriginProductPathOutcome must name the same-origin product path that was attempted`);
  }
  if (!SAME_ORIGIN_TRIGGER_PATTERN.test(outcome)) {
    problems.push(`${packet.id} sameOriginProductPathOutcome must name the Same-origin diagnostics control or reviewed route fixture trigger`);
  }
  if (!SAME_ORIGIN_VISIBLE_STATE_PATTERN.test(outcome)) {
    problems.push(`${packet.id} sameOriginProductPathOutcome must name the visible Navigation blocked or nonblank native state`);
  }

  return problems;
}

function packetValidationProblems(packet, { root, allowPending, evidenceDate }) {
  const problems = [];
  if (!packet?.id) problems.push("packet id is missing");
  if (!["pending", "passed", "blocked"].includes(packet?.status)) {
    problems.push(`${packet?.id ?? "packet"} status must be pending, passed, or blocked`);
  }
  if (packet?.status === "pending" && !allowPending) {
    problems.push(`${packet.id} is still pending`);
  }
  if (packet?.status === "blocked") {
    if (weakValue(packet.blocker?.owner)) problems.push(`${packet.id} blocker owner is required`);
    if (weakValue(packet.blocker?.reason)) problems.push(`${packet.id} blocker reason is required`);
    if (!validateIsoDate(packet.blocker?.revisit)) problems.push(`${packet.id} blocker revisit must be YYYY-MM-DD`);
  }
  if (packet?.status !== "passed") return problems;

  if (weakValue(packet.owner) && weakValue(packet.actual?.owner)) {
    problems.push(`${packet.id} passed packet needs a concrete owner`);
  }
  for (const field of packet.requiredActualFields ?? []) {
    if (!fieldPresent(getNested(packet.actual ?? {}, field))) {
      problems.push(`${packet.id} passed packet missing actual.${field}`);
    }
  }
  for (const requiredSignal of packet.requiredSignals ?? []) {
    const observed = (packet.actual?.observedSignals ?? []).map((value) => String(value).toLowerCase());
    const expected = String(requiredSignal).toLowerCase();
    if (!observed.some((signal) => signal.includes(expected) || expected.includes(signal))) {
      problems.push(`${packet.id} missing observed signal: ${requiredSignal}`);
    }
  }
  problems.push(...sameOriginProductPathOutcomeProblems(packet));
  const evidencePaths = packet.actual?.evidencePaths ?? [];
  const helperEvidencePaths = evidencePaths.flatMap(deviceValidationHelperEvidenceCandidates);
  if (helperEvidencePaths.length > 0) {
    problems.push(
      `${packet.id} device-validation helper evidence cannot satisfy route or negative packets: ${helperEvidencePaths.join(", ")}`,
    );
  }
  const localMediaEvidencePaths = [];
  const externalArtifactEvidencePaths = [];
  for (const evidencePath of evidencePaths) {
    const problem = evidencePathProblem(evidencePath, root);
    if (problem) problems.push(`${packet.id} ${problem}: ${evidencePath}`);
    if (!problem) {
      const dateProblem = localEvidencePathDateProblem(evidencePath, evidenceDate, `${packet.id} actual.evidencePaths`);
      if (dateProblem) problems.push(dateProblem);
    }
    if (!problem) problems.push(...externalPacketEvidenceProblems(packet, evidencePath));
    if (!problem && isLocalMediaEvidencePath(evidencePath)) localMediaEvidencePaths.push(evidencePath);
    if (!problem && isExternalArtifactEvidencePath(evidencePath)) externalArtifactEvidencePaths.push(evidencePath);
  }
  if (packet.type === "negative") {
    if (!hasDistinctPlatformEvidencePaths(evidencePaths)) {
      problems.push(`${packet.id} negative packet evidencePaths must include distinct Android and iOS evidence paths`);
    }
  }
  const mediaSha256 = shaArray(packet.actual?.mediaSha256);
  for (const sha of mediaSha256) {
    if (!/^[a-f0-9]{64}$/i.test(String(sha))) problems.push(`${packet.id} mediaSha256 must be 64-hex: ${sha}`);
  }
  if (localMediaEvidencePaths.length !== mediaSha256.length) {
    problems.push(`${packet.id} mediaSha256 must include one 64-hex hash per local media evidence path (${localMediaEvidencePaths.length} required)`);
  }
  problems.push(...localMediaEvidenceHashProblems(packet, root, localMediaEvidencePaths, mediaSha256));
  const fileSha256 = shaArray(packet.actual?.fileSha256);
  for (const sha of fileSha256) {
    if (!/^[a-f0-9]{64}$/i.test(String(sha))) problems.push(`${packet.id} fileSha256 must be 64-hex: ${sha}`);
  }
  if (externalArtifactEvidencePaths.length !== fileSha256.length) {
    problems.push(`${packet.id} fileSha256 must include one 64-hex hash per direct external artifact evidence path (${externalArtifactEvidencePaths.length} required)`);
  }
  problems.push(...localEvidenceManifestProblems(packet, root, evidenceDate));
  if (packet.actual?.artifactSha256 && !/^[a-f0-9]{64}$/i.test(String(packet.actual.artifactSha256))) {
    problems.push(`${packet.id} artifactSha256 must be 64-hex`);
  }
  if (packet.actual?.artifactUrl) {
    const artifactUrl = String(packet.actual.artifactUrl).trim();
    const artifactUrlProblem = directGithubEvidenceUrlProblem(artifactUrl);
    if (artifactUrlProblem) {
      problems.push(`${packet.id} ${artifactUrlProblem}: ${artifactUrl}`);
    } else {
      const artifactUrlInEvidencePaths = evidencePaths.some((evidencePath) => (
        normalizeSlash(evidencePath).toLowerCase() === normalizeSlash(artifactUrl).toLowerCase()
      ));
      if (!artifactUrlInEvidencePaths) {
        problems.push(`${packet.id} actual.artifactUrl must also appear in actual.evidencePaths`);
      }
      const artifactSha256 = String(packet.actual?.artifactSha256 ?? "").trim().toLowerCase();
      const evidenceSha256 = [
        ...shaArray(packet.actual?.mediaSha256),
        ...shaArray(packet.actual?.fileSha256),
      ].map((sha) => String(sha).trim().toLowerCase());
      if (/^[a-f0-9]{64}$/i.test(artifactSha256) && !evidenceSha256.includes(artifactSha256)) {
        problems.push(`${packet.id} actual.artifactSha256 must match one mediaSha256 or fileSha256 evidence hash`);
      }
    }
  }
  return problems;
}

function rowHasPendingFields(row) {
  return [
    row?.date,
    row?.platform,
    row?.device,
    row?.gsavWebUrl,
    row?.route,
    row?.result,
    row?.evidencePath,
  ].some((value) => weakValue(value) || /_pending_|pending/i.test(String(value ?? "")));
}

function qaRowLooksPassed(row) {
  return Boolean(row) && !rowHasPendingFields(row) && resultStatusProblem(row.result) === null;
}

function normalizedHaystack(row) {
  return normalizeSlash([
    row?.date,
    row?.platform,
    row?.device,
    row?.gsavWebUrl,
    row?.route,
    row?.result,
    row?.evidencePath,
    row?.notes,
  ].join(" ")).toLowerCase();
}

function rowContains(row, value) {
  return normalizedHaystack(row).includes(normalizeSlash(value).toLowerCase());
}

function devicePacketQaReconciliationProblems(manifest, qaText) {
  if (!qaText) return [];
  const rows = parseEvidenceRows(qaText);
  const problems = [];
  const requirementsByPacketId = new Map(deviceRequirements().map((requirement) => [packetSlug(requirement), requirement]));

  for (const packet of manifest?.packets ?? []) {
    const requirement = requirementsByPacketId.get(packet.id);
    if (!requirement) continue;
    if (packet.qaRow?.platform && packet.qaRow.platform !== requirement.platform) {
      problems.push(`${packet.id} qaRow.platform must be ${requirement.platform}`);
    }
    if (packet.qaRow?.route && packet.qaRow.route !== requirement.route) {
      problems.push(`${packet.id} qaRow.route must be ${requirement.route}`);
    }

    const row = findEvidence(rows, requirement);
    const rowPassed = qaRowLooksPassed(row);
    if (packet.status === "passed") {
      if (!row) {
        problems.push(`${packet.id} passed packet has no matching QA Evidence Log row`);
        continue;
      }
      if (!rowPassed) {
        problems.push(`${packet.id} passed packet requires matching QA Evidence Log row to be Passed`);
      }
      for (const evidencePath of packet.actual?.evidencePaths ?? []) {
        if (!rowContains(row, evidencePath)) {
          problems.push(`${packet.id} QA Evidence Log row must reference packet evidence path: ${evidencePath}`);
        }
      }
      const observedSignals = packet.actual?.observedSignals ?? [];
      if (observedSignals.length > 0 && !observedSignals.some((signal) => rowContains(row, signal))) {
        problems.push(`${packet.id} QA Evidence Log row must summarize at least one packet observed signal`);
      }
      if (manifest.target?.releaseCandidateSha && !rowContains(row, manifest.target.releaseCandidateSha)) {
        problems.push(`${packet.id} QA Evidence Log row must include packet target releaseCandidateSha`);
      }
      if (manifest.target?.dryRunArtifact && !rowContains(row, manifest.target.dryRunArtifact)) {
        problems.push(`${packet.id} QA Evidence Log row must include packet target dryRunArtifact`);
      }
      if (manifest.target?.dryRunRunUrl && !rowContains(row, manifest.target.dryRunRunUrl)) {
        problems.push(`${packet.id} QA Evidence Log row must include packet target dryRunRunUrl`);
      }
    } else if (rowPassed) {
      problems.push(`${packet.id} QA Evidence Log row is Passed but packet status is ${packet.status}`);
    }
  }

  return problems;
}

function targetValidationProblems(target, { allowPending, expectedCandidateSha, requirePublishIdentity = false } = {}) {
  const problems = [];
  if (!target || typeof target !== "object") {
    return ["target is required"];
  }

  if (expectedCandidateSha) {
    if (!fullSha(expectedCandidateSha)) problems.push("expected candidate SHA must be full 40-hex");
    if (target.releaseCandidateSha !== expectedCandidateSha) {
      problems.push(`target.releaseCandidateSha must match expected candidate ${String(expectedCandidateSha).slice(0, 12)}`);
    }
  }

  if (allowPending && !requirePublishIdentity) return problems;

  if (!fullSha(target.releaseCandidateSha)) problems.push("target.releaseCandidateSha must be full 40-hex");
  if (target.evidenceSignoffSha && !fullSha(target.evidenceSignoffSha)) {
    problems.push("target.evidenceSignoffSha must be full 40-hex when present");
  }
  if (!semver(target.appVersion)) problems.push("target.appVersion must be semver");
  if (!semver(target.packageVersion)) problems.push("target.packageVersion must be semver");
  if (!Number.isInteger(Number(target.androidVersionCode)) || Number(target.androidVersionCode) <= 0) {
    problems.push("target.androidVersionCode must be a positive integer");
  }
  if (!dryRunArtifactName(target.dryRunArtifact)) {
    problems.push("target.dryRunArtifact must be diveo-release-evidence-v<semver>");
  }
  if (!trustedGithubActionsRunUrl(target.dryRunRunUrl)) {
    problems.push("target.dryRunRunUrl must be an exact trusted Diveo GitHub Actions run URL");
  }
  if (!concreteHostUrl(target.gsavHostUrl)) {
    problems.push("target.gsavHostUrl must be a non-local non-example HTTPS URL");
  }
  if (weakIdentityValue(target.gsavHostingCommit)) {
    problems.push("target.gsavHostingCommit must be a concrete deployed host/build identity");
  }
  if (weakIdentityValue(target.defaultOwner)) {
    problems.push("target.defaultOwner must be a concrete owner");
  }

  return problems;
}

function validateDeviceEvidencePacket(manifest, {
  root = process.cwd(),
  allowPending = false,
  qaText = null,
  expectedCandidateSha = null,
  inputPath = null,
  qaPath = null,
  requireGitIntegrity = false,
} = {}) {
  const problems = [];
  problems.push(...strictPacketInputPathProblems(inputPath, { root, allowPending }));
  if (requireGitIntegrity === true) {
    problems.push(...devicePacketGitIntegrityProblems(manifest, {
      root,
      inputPath,
      qaPath,
      includeProductJourneyManifest: !allowPending,
    }));
  }
  if (manifest?.schemaVersion !== SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!validateIsoDate(manifest?.target?.evidenceDate)) {
    problems.push("target.evidenceDate must be YYYY-MM-DD");
  }
  const hasPassedPackets = Array.isArray(manifest?.packets)
    && manifest.packets.some((packet) => packet?.status === "passed");
  problems.push(...targetValidationProblems(manifest?.target, {
    allowPending,
    expectedCandidateSha,
    requirePublishIdentity: hasPassedPackets,
  }));
  if (!allowPending) {
    problems.push(...productJourneyManifestProblems(manifest?.target, root));
  }
  if (!Array.isArray(manifest?.packets)) {
    problems.push("packets must be an array");
  } else {
    const expectedIds = deviceRequirements().map(packetSlug).sort();
    const observedIds = manifest.packets.map((packet) => packet.id).sort();
    for (const id of expectedIds) {
      if (!observedIds.includes(id)) problems.push(`missing packet ${id}`);
    }
    for (const id of observedIds) {
      if (!expectedIds.includes(id)) problems.push(`unexpected packet ${id}`);
    }
    for (const packet of manifest.packets) {
      problems.push(...packetValidationProblems(packet, {
        root,
        allowPending,
        evidenceDate: manifest?.target?.evidenceDate,
      }));
    }
    problems.push(...devicePacketQaReconciliationProblems(manifest, qaText));
  }

  return {
    ok: problems.length === 0,
    status: problems.length === 0 ? "pass" : "fail",
    gitIntegrityRequired: requireGitIntegrity === true,
    checkedPackets: Array.isArray(manifest?.packets) ? manifest.packets.length : 0,
    problems,
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  try {
    const options = parseArgs();
    if (options.check) {
      const manifest = JSON.parse(fs.readFileSync(path.resolve(options.root, options.inputPath), "utf8"));
      const qaPath = options.qaPath ? path.resolve(options.root, options.qaPath) : null;
      const qaText = qaPath && fs.existsSync(qaPath) ? fs.readFileSync(qaPath, "utf8") : null;
      const result = validateDeviceEvidencePacket(manifest, {
        root: options.root,
        allowPending: options.allowPending,
        qaText,
        expectedCandidateSha: options.candidateSha,
        inputPath: options.inputPath,
        qaPath: options.qaPath,
        requireGitIntegrity: options.requireGitIntegrity,
      });
      console.log(JSON.stringify({
        checkedAt: new Date().toISOString(),
        inputPath: normalizeSlash(options.inputPath),
        qaPath: qaPath ? normalizeSlash(path.relative(options.root, qaPath)) : null,
        ...result,
      }, null, 2));
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (options.example) {
      const example = createDeviceEvidencePacketExample(options);
      if (options.outputPath) {
        const outputPath = path.resolve(options.root, options.outputPath);
        writeJson(outputPath, example);
        console.log(JSON.stringify({
          checkedAt: new Date().toISOString(),
          outputPath: normalizeSlash(path.relative(options.root, outputPath)),
          status: "example",
          ok: true,
        }, null, 2));
      } else {
        console.log(JSON.stringify(example, null, 2));
      }
      return;
    }

    const manifest = createDeviceEvidencePacket(options);
    const outputPath = path.resolve(options.root, options.outputPath);
    writeJson(outputPath, manifest);
    const result = validateDeviceEvidencePacket(manifest, {
      root: options.root,
      allowPending: true,
    });
    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(),
      outputPath: normalizeSlash(path.relative(options.root, outputPath)),
      ...result,
      status: result.ok ? "scaffolded" : "fail",
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
  createDeviceEvidencePacket,
  createDeviceEvidencePacketExample,
  devicePacketGitIntegrityProblems,
  deviceRequirements,
  devicePacketQaReconciliationProblems,
  evidencePathProblem,
  parseArgs,
  packetSlug,
  productJourneyManifestProblems,
  PRODUCT_JOURNEY_ARTIFACT_PURPOSE,
  PRODUCT_JOURNEY_ENTRY_REQUIREMENTS,
  PRODUCT_JOURNEY_REQUIRED_ENTRY_IDS,
  strictPacketInputPathProblems,
  validateDeviceEvidencePacket,
};
