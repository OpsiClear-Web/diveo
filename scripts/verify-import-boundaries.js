#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const SOURCE_ROOTS = ["app", "features", "shared", "services", "utils"];
const QUARANTINED_LEGACY_ROOTS = ["components", "hooks", "store"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const PACKAGE_JSON_PATH = "package.json";
const EXPECTED_PACKAGE_MAIN = "expo-router/entry";
const CLASSIC_ROOT_ENTRY_FILES = new Set([
  "App.js",
  "App.jsx",
  "App.ts",
  "App.tsx",
  "index.js",
  "index.jsx",
  "index.ts",
  "index.tsx",
]);
const forbiddenSourceFiles = [
  {
    path: "features/player/index.ts",
    reason: "player helper exports must stay on leaf modules so the player boundary cannot become a broad public barrel",
  },
  {
    path: "features/player/url.ts",
    reason: "shared GSAV web URL helpers must be imported from shared/gsavWeb, not re-exported through a player facade",
  },
  {
    path: "features/preferences/useTheme.ts",
    reason: "theme reads must use shared/themeContext; preferences owns state bootstrap and editing only",
  },
];
const EXTERNAL_PACKAGE_POLICY_ROOTS = ["scripts"];
const EXTERNAL_PACKAGE_POLICY_FILES = [
  "scripts/gsav-runtime-smoke-bridge.js",
];
const PLAYER_NATIVE_HOST_PATH = "features/player/GsavWebView";
const PLAYER_WEB_HOST_PATH = "features/player/GsavWebView.web";
const PLAYER_MODULE_PREFIX = "features/player/";
const BRIDGE_BACKEND_RESPONSIBILITY_MESSAGE =
  "bridge modules must not perform catalog CRUD, social writes, upload finalization, moderation, or Supabase table operations";
const BRIDGE_BACKEND_RESPONSIBILITY_PATTERN =
  /\b(?:createGsavCatalog|gsavCatalog|setVideoSaved|setVideoLiked|setChannelFollowed|addVideoComment|getSavedVideoIds|isChannelFollowed|getChannelFollowerCount|supabase\s*\.from|\.from\s*\(\s*["'](?:videos|channels|comments|follows|saved_videos|video_reactions|uploads|notifications|moderation)|create-upload|finalize-upload|process-upload|moderate-content)\b/;
const NATIVE_BROWSER_STORAGE_MESSAGE =
  "native app source must use platform storage/access contracts, not browser localStorage or sessionStorage";
const NATIVE_SUPABASE_AUTH_OWNER_MESSAGE =
  "services/supabase.ts must be the native Supabase auth owner with AsyncStorage persistence and detectSessionInUrl disabled";
const CANONICAL_WATCH_ROUTE_MESSAGE =
  "watch route construction must use shared buildGsavWatchPath so scene IDs are encoded consistently";
const RAW_WATCH_ROUTE_PATTERN = /`\/watch\/\$\{|["']\/watch\/["']\s*\+/;
const NATIVE_EMBED_URL_PATTERNS = [
  {
    label: "buildNativeEmbedUrl helper",
    pattern: /\bbuildNativeEmbedUrl\b/,
  },
  {
    label: "literal embed=native URL",
    pattern: /["'`][^"'`]*(?:[?&]embed=native|embed=native)[^"'`]*["'`]/,
  },
  {
    label: "literal dataSaver=1 URL",
    pattern: /["'`][^"'`]*dataSaver=1[^"'`]*["'`]/,
  },
  {
    label: "searchParams embed mutation",
    pattern: /\.searchParams\.(?:set|append)\(\s*["']embed["']\s*,\s*["']native["']\s*\)/,
  },
  {
    label: "URLSearchParams embed tuple",
    pattern: /\bURLSearchParams\s*\(\s*\[\s*\[\s*["']embed["']\s*,\s*["']native["']\s*\]\s*\]/,
  },
  {
    label: "split embed=native string assembly",
    pattern: /["']embed(?:=)?["']\s*\+\s*["'](?:=)?native["']|["']embed["']\s*\+\s*["']=["']\s*\+\s*["']native["']/,
  },
];
const CATALOG_COMPOSITION_BOUNDARY_MESSAGE =
  "catalog must compose social affordances through FollowButton and SaveSceneButton and keep ContinueWatchingPill presentation catalog-owned through player resumeAccess; it must not read social stores, resume stores, bridge state, Supabase clients, or follow reconciliation rules directly";
const catalogCompositionForbiddenTargets = [
  /^features\/social\/(?:authSession|gsavAuthStore|savedSceneAccess|savedScenesStore|socialAdapter|useGsavFollow)$/,
  /^features\/player\/(?:bridgeState|gsavProgressStore|nativeBridgeMessage|nativeBridgeOverlay|progressBridge|sessionBridge|useGsavEmbedHost)$/,
  /^services\/supabase$/,
];
const catalogCompositionForbiddenPackages = [
  /^@supabase(?:\/|$)/,
];

const appAllowedFeatureTargets = [
  /^features\/app-shell\/(CreatorLayout|RootLayout)$/,
  /^features\/catalog\/(HomeScreen|SearchScreen|CreatorScreen)$/,
  /^features\/player\/(ExploreScreen|GsavDiagnosticsScreen|GsavScreen)$/,
  /^features\/settings\/SettingsScreen$/,
  /^features\/social\/(LibraryScreen|LoginScreen)$/,
];

const appRouteOwnerMap = {
  "app/_layout": /^features\/app-shell\/RootLayout$/,
  "app/index": /^features\/catalog\/HomeScreen$/,
  "app/search": /^features\/catalog\/SearchScreen$/,
  "app/creator/_layout": /^features\/app-shell\/CreatorLayout$/,
  "app/creator/[handle]": /^features\/catalog\/CreatorScreen$/,
  "app/explore": /^features\/player\/ExploreScreen$/,
  "app/gsav-diagnostics": /^features\/player\/GsavDiagnosticsScreen$/,
  "app/gsav/[id]": /^features\/player\/GsavScreen$/,
  "app/watch/[id]": /^features\/player\/GsavScreen$/,
  "app/library": /^features\/social\/LibraryScreen$/,
  "app/login": /^features\/social\/LoginScreen$/,
  "app/settings": /^features\/settings\/SettingsScreen$/,
};

const featureServiceImportAllowList = {
  catalog: [/^services\/gsav$/],
  social: [/^services\/(?:gsav|supabase)$/],
};

const ALLOWED_SIBLING_RULE_KINDS = new Set([
  "access-contract",
  "route-composition",
  "scene-contract",
  "theme-contract",
  "ui-composition",
]);
const SIBLING_ALLOWLIST_BUDGET = 12;

const siblingAllowList = [
  {
    from: "app-shell",
    to: "app-update",
    target: /^features\/app-update\/updateAccess$/,
    kind: "access-contract",
    reason: "startup shell needs the app-update public check contract",
    owner: "@opsiclear/app-shell",
    exitCriteria: "Remove when app update checks move into app-shell-owned startup code",
    expires: "2026-07-31",
  },
  {
    from: "app-shell",
    to: "preferences",
    target: /^features\/preferences\/preferenceAccess$/,
    kind: "access-contract",
    reason: "startup shell needs preference bootstrap through the public contract",
    owner: "@opsiclear/preferences",
    exitCriteria: "Remove when startup preference hydration no longer runs in the app shell",
    expires: "2026-07-31",
  },
  {
    from: "app-shell",
    to: "social",
    target: /^features\/social\/(authSession|savedSceneAccess)$/,
    kind: "access-contract",
    reason: "startup shell needs auth bootstrap and saved-scene loading contracts",
    owner: "@opsiclear/social",
    exitCriteria: "Remove when auth restore and saved-scene preload move behind app-shell-owned bootstrap code",
    expires: "2026-07-31",
  },
  {
    from: "catalog",
    to: "player",
    target: /^features\/player\/resumeAccess$/,
    kind: "access-contract",
    reason: "catalog continue-watching UI may read player-owned resume state and actions only through the narrow resume access contract",
    owner: "@opsiclear/player",
    exitCriteria: "Remove when resume state moves behind a shared non-feature contract or catalog no longer surfaces resume",
    expires: "2026-07-31",
  },
  {
    from: "catalog",
    to: "scene",
    target: /^features\/scene\/(SceneCard|sceneShare)$/,
    kind: "scene-contract",
    reason: "catalog screens render and share scene presentation contracts",
    owner: "@opsiclear/scene",
    exitCriteria: "Remove when scene presentation and sharing move behind a shared non-feature package",
    expires: "2026-07-31",
  },
  {
    from: "catalog",
    to: "social",
    target: /^features\/social\/(FollowButton|SaveSceneButton)$/,
    kind: "ui-composition",
    reason: "catalog screens may compose social save/follow affordances",
    owner: "@opsiclear/social",
    exitCriteria: "Remove when save and follow affordances move behind narrower action props",
    expires: "2026-07-31",
  },
  {
    from: "player",
    to: "preferences",
    target: /^features\/preferences\/preferenceAccess$/,
    kind: "access-contract",
    reason: "embedded player needs data-saver preference access",
    owner: "@opsiclear/player",
    exitCriteria: "Remove when embed options are passed to player route roots as props",
    expires: "2026-07-31",
  },
  {
    from: "player",
    to: "social",
    target: /^features\/social\/authSession$/,
    kind: "access-contract",
    reason: "embedded player needs auth session data through the public bridge contract",
    owner: "@opsiclear/social",
    exitCriteria: "Remove when bridge session source moves into the bridge package or player-owned access contract",
    expires: "2026-07-31",
  },
  {
    from: "settings",
    to: "app-update",
    target: /^features\/app-update\/updateAccess$/,
    kind: "access-contract",
    reason: "settings shows update status through the app-update public contract",
    owner: "@opsiclear/settings",
    exitCriteria: "Remove when update status becomes settings-owned or moves behind a shared app contract",
    expires: "2026-07-31",
  },
  {
    from: "settings",
    to: "preferences",
    target: /^features\/preferences\/preferenceAccess$/,
    kind: "access-contract",
    reason: "settings edits preferences through the public preference contract",
    owner: "@opsiclear/preferences",
    exitCriteria: "Remove when settings owns preference editing or receives preference actions as props",
    expires: "2026-07-31",
  },
  {
    from: "settings",
    to: "social",
    target: /^features\/social\/authSession$/,
    kind: "access-contract",
    reason: "settings shows account state through the auth public contract",
    owner: "@opsiclear/social",
    exitCriteria: "Remove when account status and sign-out move behind a shared account contract",
    expires: "2026-07-31",
  },
  {
    from: "social",
    to: "scene",
    target: /^features\/scene\/(SceneCard|sceneShare|sceneTypes)$/,
    kind: "scene-contract",
    reason: "library renders and shares saved scenes through scene presentation contracts",
    owner: "@opsiclear/scene",
    exitCriteria: "Remove when saved-scene rendering moves behind a social-owned scene facade",
    expires: "2026-07-31",
  },
];

const forbiddenTargetPatterns = [
  { pattern: /^features\/settings\/settingsStore$/, reason: "preferences state must live in features/preferences" },
  { pattern: /^features\/settings\/useTheme$/, reason: "theme reads must use shared/themeContext" },
  {
    pattern: /^features\/preferences\/preferencesStore$/,
    reason: "cross-feature preference access must use features/preferences/preferenceAccess",
    crossFeatureOnly: true,
  },
  {
    pattern: /^features\/preferences\/useTheme$/,
    reason: "theme reads must use shared/themeContext instead of the preferences feature",
  },
  {
    pattern: /^features\/social\/savedScenesStore$/,
    reason: "cross-feature saved scene access must use features/social/savedSceneAccess",
    crossFeatureOnly: true,
  },
  {
    pattern: /^features\/app-update\/useCheckUpdate$/,
    reason: "cross-feature update access must use features/app-update/updateAccess",
    crossFeatureOnly: true,
  },
  { pattern: /^features\/player\/theme$/, reason: "design tokens must live in shared/theme" },
  { pattern: /^components\//, reason: "deleted compatibility components must not be reintroduced" },
  { pattern: /^hooks\//, reason: "deleted compatibility hooks must not be reintroduced" },
  { pattern: /^store\//, reason: "deleted compatibility stores must not be reintroduced" },
  { pattern: /^utils\/(gsavBridge|cache|theme)$/, reason: "deleted compatibility utils must not be reintroduced" },
];

const externalPackageImportAllowList = [
  {
    packageName: "@opsiclear/gsav-bridge",
    importers: [
      /^features\/player\/bridgeTypes$/,
      /^features\/player\/sessionBridge$/,
      /^scripts\/gsav-runtime-smoke-bridge$/,
      /^scripts\/stack-architecture-receipt$/,
    ],
    reason: "bridge wire contracts must stay behind the player bridge facade, runtime smoke helper, and stack receipt metadata capture",
    owner: "@opsiclear/player",
    exitCriteria: "Remove importers only when bridge wire contracts move behind a narrower player-owned facade",
  },
  {
    packageName: "@opsiclear/gsav-client",
    importers: [
      /^services\/gsav$/,
      /^features\/social\/socialAdapter$/,
    ],
    reason: "catalog access goes through services/feature adapters; social operations go through the social adapter",
    owner: "@opsiclear/services",
    exitCriteria: "Remove importers only when catalog and social access move behind narrower app-owned APIs",
  },
];

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function stripKnownExtension(filePath) {
  const ext = path.posix.extname(filePath);
  return SOURCE_EXTENSIONS.has(ext) ? filePath.slice(0, -ext.length) : filePath;
}

function classifyModule(filePath) {
  const normalized = stripKnownExtension(normalizePath(filePath));
  const parts = normalized.split("/");
  if (parts[0] === "app") return { layer: "app", module: "app", path: normalized };
  if (parts[0] === "features" && parts[1]) return { layer: "feature", module: parts[1], path: normalized };
  if (parts[0] === "shared") return { layer: "shared", module: "shared", path: normalized };
  if (parts[0] === "services") return { layer: "services", module: "services", path: normalized };
  if (parts[0] === "utils") return { layer: "utils", module: "utils", path: normalized };
  return { layer: "other", module: parts[0] ?? "", path: normalized };
}

function isTestSourcePath(filePath) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(normalizePath(filePath));
}

function extractImportSpecifiers(sourceText) {
  const specifiers = [];
  const pattern = [
    /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/,
    /\bexport\s+(?:type\s+)?[^'"]*?\s+from\s+["']([^"']+)["']/,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/,
  ].map((part) => part.source).join("|");
  const importPattern = new RegExp(pattern, "g");
  let match;
  while ((match = importPattern.exec(sourceText))) {
    specifiers.push(match[1] || match[2] || match[3] || match[4]);
  }
  return specifiers;
}

function uncommentedSource(sourceText) {
  return sourceText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .trim();
}

function validateAppRouteAdapter(sourcePath, sourceText) {
  const source = classifyModule(sourcePath);
  const extension = path.posix.extname(normalizePath(sourcePath));
  if (source.layer !== "app" || !SOURCE_EXTENSIONS.has(extension)) {
    return [];
  }

  const errors = [];
  const expectedRouteOwner = appRouteOwnerMap[source.path];
  if (!expectedRouteOwner) {
    errors.push(`app route ${source.path} must be added to appRouteOwnerMap`);
  }

  const body = uncommentedSource(sourceText);
  const adapterMatch = /^export\s*\{\s*default\s*\}\s*from\s*["']([^"']+)["']\s*;?$/.exec(body);
  if (!adapterMatch) {
    errors.push("app route files must stay export-only adapters with a single default re-export");
    return errors;
  }

  const targetPath = resolveImportTarget(source.path, adapterMatch[1]);
  const target = targetPath ? classifyModule(targetPath) : null;
  if (!target || target.layer !== "feature") {
    errors.push(`app route ${source.path} must re-export a feature route owner, not ${targetPath ?? adapterMatch[1]}`);
  }
  if (expectedRouteOwner && (!targetPath || !expectedRouteOwner.test(targetPath))) {
    errors.push(`app route ${source.path} must re-export its documented route owner ${expectedRouteOwner.source}, not ${targetPath ?? adapterMatch[1]}`);
  }
  return errors;
}

function validateAppRouteOwnerMapCoverage(files) {
  const hasPackageJson = files.some((file) => normalizePath(file.path) === PACKAGE_JSON_PATH);
  if (!hasPackageJson) return [];

  const appRouteAdapters = new Set();
  for (const file of files) {
    const sourcePath = normalizePath(file.path);
    const extension = path.posix.extname(sourcePath);
    const source = classifyModule(sourcePath);
    if (source.layer === "app" && SOURCE_EXTENSIONS.has(extension) && !isTestSourcePath(sourcePath)) {
      appRouteAdapters.add(source.path);
    }
  }

  return Object.keys(appRouteOwnerMap)
    .filter((routePath) => !appRouteAdapters.has(routePath))
    .map((routePath) => `appRouteOwnerMap entry ${routePath} must point to an existing app route adapter`);
}

function validateFeatureBarrelExports(sourcePath, sourceText) {
  const source = classifyModule(sourcePath);
  if (source.layer !== "feature" || path.posix.basename(source.path) !== "index") {
    return [];
  }

  const errors = [];
  const routeRootNamePattern = /(?:Screen|Layout|RootLayout|AppStack)$/;
  for (const specifier of extractImportSpecifiers(sourceText)) {
    const targetPath = resolveImportTarget(source.path, specifier);
    if (!targetPath) continue;
    const targetBaseName = path.posix.basename(targetPath);
    if (routeRootNamePattern.test(targetBaseName)) {
      errors.push(`feature barrel ${source.path} must not export route screens or layouts: ${targetPath}`);
    }
  }

  const inlineRouteRootExportPattern = /\bexport\b(?![^"']*from\s*["'])[^;\n]*(?:Screen|Layout|RootLayout|AppStack)\b/;
  if (inlineRouteRootExportPattern.test(uncommentedSource(sourceText))) {
    errors.push(`feature barrel ${source.path} must not export route screen or layout symbols directly`);
  }
  return errors;
}

function validatePackageMain(sourceText) {
  try {
    const packageJson = JSON.parse(sourceText);
    return packageJson.main === EXPECTED_PACKAGE_MAIN
      ? []
      : [`package.json main must remain ${EXPECTED_PACKAGE_MAIN}`];
  } catch (error) {
    return [`package.json must parse as JSON: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function validateQuarantinedLegacySource(sourcePath) {
  const normalized = normalizePath(sourcePath);
  const [root] = normalized.split("/");
  if (!QUARANTINED_LEGACY_ROOTS.includes(root)) return [];
  if (!SOURCE_EXTENSIONS.has(path.posix.extname(normalized))) return [];
  return [
    `${root}/ is a quarantined legacy root; move active source into app/, features/, shared/, services/, or utils/ instead of reintroducing ${normalized}`,
  ];
}

function resolveImportTarget(sourcePath, specifier) {
  if (specifier.startsWith(".")) {
    return stripKnownExtension(normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier))));
  }
  const normalized = stripKnownExtension(normalizePath(specifier));
  const [root] = normalized.split("/");
  return SOURCE_ROOTS.includes(root) ? normalized : null;
}

function validateExternalPackageImport(sourcePath, specifier, rules = externalPackageImportAllowList) {
  const rule = rules.find((candidate) => specifier === candidate.packageName || specifier.startsWith(`${candidate.packageName}/`));
  if (!rule) {
    if (specifier === "@opsiclear/gsav" || specifier.startsWith("@opsiclear/gsav-")) {
      return [
        `${specifier} import is not covered by the external GSAV package policy; add an explicit allowlist rule with focused tests before importing it`,
      ];
    }
    return [];
  }

  const source = stripKnownExtension(normalizePath(sourcePath));
  const importers = Array.isArray(rule.importers) ? rule.importers : [];
  if (importers.some((pattern) => pattern instanceof RegExp && pattern.test(source))) return [];

  const allowed = importers
    .filter((pattern) => pattern instanceof RegExp)
    .map((pattern) => pattern.source)
    .join(", ");
  return [
    `${specifier} import is not in the documented external package policy; allowed importers: ${allowed}; ${rule.reason}`,
  ];
}

function isConcretePolicyOwner(owner) {
  const text = String(owner ?? "").trim();
  return /^@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)
    && !/\b(?:owner|todo|tbd|pending|placeholder)\b/i.test(text);
}

function validateExternalPackageAllowList(rules = externalPackageImportAllowList) {
  return rules.flatMap((rule, index) => {
    const errors = [];
    const label = `${rule.packageName ?? "_missing_"} #${index}`;

    if (typeof rule.packageName !== "string" || !rule.packageName.startsWith("@opsiclear/gsav-")) {
      errors.push(`external package policy rule ${label} must declare an @opsiclear/gsav-* package name`);
    }
    if (!Array.isArray(rule.importers) || rule.importers.length === 0 || !rule.importers.every((pattern) => pattern instanceof RegExp)) {
      errors.push(`external package policy rule ${label} must declare importer RegExp entries`);
    }
    if (typeof rule.reason !== "string" || rule.reason.trim().length < 20) {
      errors.push(`external package policy rule ${label} must include a documented rationale`);
    }
    if (!isConcretePolicyOwner(rule.owner)) {
      errors.push(`external package policy rule ${label} must include a concrete owner handle`);
    }
    if (typeof rule.exitCriteria !== "string" || rule.exitCriteria.trim().length < 20) {
      errors.push(`external package policy rule ${label} must include documented exit criteria`);
    }

    return errors;
  });
}

function currentDateText(currentDate = new Date()) {
  if (typeof currentDate === "string") return currentDate.slice(0, 10);
  return currentDate.toISOString().slice(0, 10);
}

function validateSiblingAllowList(rules = siblingAllowList, { currentDate = new Date() } = {}) {
  const errors = [];
  const today = currentDateText(currentDate);
  if (rules.length > SIBLING_ALLOWLIST_BUDGET) {
    errors.push(`sibling allowlist has ${rules.length} entries, exceeding budget ${SIBLING_ALLOWLIST_BUDGET}`);
  }

  return [
    ...errors,
    ...rules.flatMap((rule, index) => {
    const errors = [];
    const label = `${rule.from ?? "_missing_"} -> ${rule.to ?? "_missing_"} #${index}`;
    if (!rule.from || !rule.to) {
      errors.push(`sibling allowlist rule ${label} must declare from and to feature modules`);
    }
    if (!(rule.target instanceof RegExp)) {
      errors.push(`sibling allowlist rule ${label} must declare a target RegExp`);
    }
    if (!ALLOWED_SIBLING_RULE_KINDS.has(rule.kind)) {
      errors.push(`sibling allowlist rule ${label} must declare a valid kind`);
    }
    if (typeof rule.reason !== "string" || rule.reason.trim().length < 20) {
      errors.push(`sibling allowlist rule ${label} must include a documented rationale`);
    }
    if (!isConcretePolicyOwner(rule.owner)) {
      errors.push(`sibling allowlist rule ${label} must include a concrete owner handle`);
    }
    if (typeof rule.exitCriteria !== "string" || rule.exitCriteria.trim().length < 20) {
      errors.push(`sibling allowlist rule ${label} must include documented exit criteria`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rule.expires ?? ""))) {
      errors.push(`sibling allowlist rule ${label} must include an ISO expires date`);
    } else if (rule.expires < today) {
      errors.push(`sibling allowlist rule ${label} expired on ${rule.expires}`);
    }
    return errors;
    }),
  ];
}

function isAllowedSiblingImport(source, target, rules = siblingAllowList) {
  if (source.module === target.module) return true;
  return rules.some((rule) => {
    if (rule.from !== source.module || rule.to !== target.module) return false;
    return !rule.target || rule.target.test(target.path);
  });
}

function isFeatureScreenOrLayout(source) {
  if (source.layer !== "feature") return false;
  const basename = path.posix.basename(source.path);
  return /(?:Screen|Layout|AppStack|RootLayout|CreatorLayout)$/.test(basename);
}

function validateImport(sourcePath, specifier, options = {}) {
  const rules = options.siblingAllowList ?? siblingAllowList;
  const externalRules = options.externalPackageImportAllowList ?? externalPackageImportAllowList;
  const source = classifyModule(sourcePath);
  if (source.layer === "other" && isTestSourcePath(sourcePath)) return [];

  const errors = validateExternalPackageImport(sourcePath, specifier, externalRules);
  if (source.layer === "feature" && source.module === "catalog" && catalogCompositionForbiddenPackages.some((pattern) => pattern.test(specifier))) {
    errors.push(CATALOG_COMPOSITION_BOUNDARY_MESSAGE);
  }
  if (source.layer === "other") return errors;

  const targetPath = resolveImportTarget(source.path, specifier);
  if (!targetPath) return errors;

  const target = classifyModule(targetPath);

  if (target.path.startsWith("../")) {
    errors.push(`relative import escapes the repository source roots: ${specifier}`);
    return errors;
  }

  if (specifier.startsWith(".") && target.layer === "other") {
    errors.push(`relative import escapes the repository source roots: ${specifier}`);
    return errors;
  }

  for (const { pattern, reason, crossFeatureOnly } of forbiddenTargetPatterns) {
    const sameFeature = source.layer === "feature" && target.layer === "feature" && source.module === target.module;
    if (pattern.test(target.path) && !(crossFeatureOnly && sameFeature)) {
      errors.push(`${specifier} resolves to ${target.path}: ${reason}`);
    }
  }

  if (source.layer === "app") {
    if (target.layer === "services" || target.layer === "utils") {
      errors.push("app routes must not import service clients or utils directly");
    }
    if (target.layer === "shared") {
      errors.push("app routes must not import shared UI or helpers directly");
    }
    if (target.layer === "feature" && !appAllowedFeatureTargets.some((pattern) => pattern.test(target.path))) {
      errors.push(`app route imports non-screen feature internals: ${target.path}`);
    }
    if (target.layer === "feature") {
      const expectedRouteOwner = appRouteOwnerMap[source.path];
      if (!expectedRouteOwner) {
        errors.push(`app route ${source.path} must be added to appRouteOwnerMap before importing feature route roots`);
      } else if (!expectedRouteOwner.test(target.path)) {
        errors.push(`app route ${source.path} must import its documented route owner ${expectedRouteOwner.source}, not ${target.path}`);
      }
    }
  }

  if (["shared", "services", "utils"].includes(source.layer) && (target.layer === "app" || target.layer === "feature")) {
    errors.push(`${source.layer} must not import app or feature code`);
  }

  if (source.layer === "shared" && target.layer === "services") {
    errors.push("shared must not import service clients");
  }

  if (source.layer === "services" && target.layer === "shared") {
    errors.push("services must stay platform/client oriented and not import UI/shared primitives");
  }

  if (source.layer === "feature" && target.layer === "app") {
    errors.push("features must not import app route code");
  }

  if (isFeatureScreenOrLayout(source) && target.layer === "services") {
    errors.push("feature screens and layouts must use feature adapters or access contracts instead of service clients directly");
  }

  if (source.layer === "feature" && target.layer === "services" && !isFeatureScreenOrLayout(source)) {
    const allowedServiceTargets = featureServiceImportAllowList[source.module] ?? [];
    if (!allowedServiceTargets.some((pattern) => pattern.test(target.path))) {
      errors.push(`feature ${source.module} must not import undocumented service client ${target.path}`);
    }
  }

  if (source.layer === "feature" && target.layer === "feature" && !isAllowedSiblingImport(source, target, rules)) {
    errors.push(`undocumented sibling feature import ${source.module} -> ${target.module}: ${target.path}`);
  }

  if (
    source.layer === "feature"
    && source.module === "catalog"
    && catalogCompositionForbiddenTargets.some((pattern) => pattern.test(target.path))
  ) {
    errors.push(CATALOG_COMPOSITION_BOUNDARY_MESSAGE);
  }

  return errors;
}

function validatePlayerHostOwnership(sourcePath, sourceText) {
  const source = classifyModule(sourcePath);
  const isTest = isTestSourcePath(sourcePath);
  const errors = [];

  if (source.layer === "other") return errors;

  if (!isTest && source.path !== PLAYER_NATIVE_HOST_PATH && extractImportSpecifiers(sourceText).includes("react-native-webview")) {
    errors.push("react-native-webview imports are only allowed in features/player/GsavWebView.tsx");
  }

  if (!isTest && source.path !== PLAYER_WEB_HOST_PATH && /<iframe\b/i.test(sourceText)) {
    errors.push("iframe player hosts are only allowed in features/player/GsavWebView.web.tsx");
  }

  const nativeEmbedMarkers = NATIVE_EMBED_URL_PATTERNS
    .filter(({ pattern }) => pattern.test(sourceText))
    .map(({ label }) => label);
  if (!isTest && !source.path.startsWith(PLAYER_MODULE_PREFIX) && nativeEmbedMarkers.length > 0) {
    errors.push(`native embed URL construction must stay inside features/player (${nativeEmbedMarkers.join(", ")})`);
  }

  return errors;
}

function validateBridgeBackendIsolation(sourcePath, sourceText) {
  const source = classifyModule(sourcePath);
  if (source.layer !== "feature" || source.module !== "player") return [];
  if (isTestSourcePath(sourcePath)) return [];
  if (!/bridge/i.test(path.posix.basename(source.path))) return [];
  return BRIDGE_BACKEND_RESPONSIBILITY_PATTERN.test(sourceText)
    ? [BRIDGE_BACKEND_RESPONSIBILITY_MESSAGE]
    : [];
}

function validateNativeStorageAssumptions(sourcePath, sourceText) {
  const source = classifyModule(sourcePath);
  if (source.layer === "other" || isTestSourcePath(sourcePath)) return [];
  return /\b(?:window\.)?(?:localStorage|sessionStorage)\b/.test(uncommentedSource(sourceText))
    ? [NATIVE_BROWSER_STORAGE_MESSAGE]
    : [];
}

function validateNativeSupabaseAuthOwner(sourcePath, sourceText) {
  if (normalizePath(sourcePath) !== "services/supabase.ts") return [];
  const errors = [];
  if (!/from\s+["']@react-native-async-storage\/async-storage["']/.test(sourceText)) {
    errors.push(NATIVE_SUPABASE_AUTH_OWNER_MESSAGE);
  }
  if (!/\bcreateClient\b/.test(sourceText) || !/from\s+["']@supabase\/supabase-js["']/.test(sourceText)) {
    errors.push(NATIVE_SUPABASE_AUTH_OWNER_MESSAGE);
  }
  if (!/\bstorage\s*:\s*AsyncStorage\b/.test(sourceText)) {
    errors.push(NATIVE_SUPABASE_AUTH_OWNER_MESSAGE);
  }
  if (!/\bdetectSessionInUrl\s*:\s*false\b/.test(sourceText)) {
    errors.push(NATIVE_SUPABASE_AUTH_OWNER_MESSAGE);
  }
  return [...new Set(errors)];
}

function validateCanonicalWatchRouteConstruction(sourcePath, sourceText) {
  const source = classifyModule(sourcePath);
  if (source.layer === "other" || isTestSourcePath(sourcePath)) return [];
  if (source.path === "shared/gsavRoutes") return [];
  return RAW_WATCH_ROUTE_PATTERN.test(uncommentedSource(sourceText))
    ? [CANONICAL_WATCH_ROUTE_MESSAGE]
    : [];
}

function analyzeImportBoundaries(files, options = {}) {
  const rules = options.siblingAllowList ?? siblingAllowList;
  const externalRules = options.externalPackageImportAllowList ?? externalPackageImportAllowList;
  const violations = validateSiblingAllowList(rules).map((message) => ({
    file: "scripts/verify-import-boundaries.js",
    specifier: "siblingAllowList",
    message,
  }));
  violations.push(...validateExternalPackageAllowList(externalRules).map((message) => ({
    file: "scripts/verify-import-boundaries.js",
    specifier: "externalPackageImportAllowList",
    message,
  })));
  violations.push(...validateAppRouteOwnerMapCoverage(files).map((message) => ({
    file: "scripts/verify-import-boundaries.js",
    specifier: "appRouteOwnerMap",
    message,
  })));
  for (const file of files) {
    const sourcePath = normalizePath(file.path);
    if (sourcePath === PACKAGE_JSON_PATH) {
      violations.push(...validatePackageMain(file.text).map((message) => ({
        file: sourcePath,
        specifier: "main",
        message,
      })));
      continue;
    }
    for (const forbiddenFile of forbiddenSourceFiles) {
      if (sourcePath === forbiddenFile.path) {
        violations.push({
          file: sourcePath,
          specifier: "",
          message: forbiddenFile.reason,
        });
      }
    }
    for (const message of validateQuarantinedLegacySource(sourcePath)) {
      violations.push({ file: sourcePath, specifier: "quarantined-legacy-root", message });
    }
    for (const message of validateAppRouteAdapter(sourcePath, file.text)) {
      violations.push({ file: sourcePath, specifier: "app-route-adapter", message });
    }
    for (const message of validateFeatureBarrelExports(sourcePath, file.text)) {
      violations.push({ file: sourcePath, specifier: "feature-barrel", message });
    }
    if (CLASSIC_ROOT_ENTRY_FILES.has(sourcePath)) {
      violations.push({
        file: sourcePath,
        specifier: "",
        message: "classic Expo root entry files must not coexist with package.json main expo-router/entry",
      });
    }
    for (const specifier of extractImportSpecifiers(file.text)) {
      const errors = validateImport(sourcePath, specifier, {
        siblingAllowList: rules,
        externalPackageImportAllowList: externalRules,
      });
      for (const message of errors) {
        violations.push({ file: sourcePath, specifier, message });
      }
    }
    for (const message of validatePlayerHostOwnership(sourcePath, file.text)) {
      violations.push({ file: sourcePath, specifier: "player-host-ownership", message });
    }
    for (const message of validateBridgeBackendIsolation(sourcePath, file.text)) {
      violations.push({ file: sourcePath, specifier: "bridge-backend-isolation", message });
    }
    for (const message of validateNativeStorageAssumptions(sourcePath, file.text)) {
      violations.push({ file: sourcePath, specifier: "native-storage", message });
    }
    for (const message of validateNativeSupabaseAuthOwner(sourcePath, file.text)) {
      violations.push({ file: sourcePath, specifier: "native-supabase-auth-owner", message });
    }
    for (const message of validateCanonicalWatchRouteConstruction(sourcePath, file.text)) {
      violations.push({ file: sourcePath, specifier: "canonical-watch-route", message });
    }
  }
  return {
    ok: violations.length === 0,
    violations,
  };
}

function listSourceFiles(root) {
  const files = [];
  const seen = new Set();
  function addFile(relativePath) {
    const normalizedPath = normalizePath(relativePath);
    if (seen.has(normalizedPath)) return;
    const fullPath = path.join(root, normalizedPath);
    if (!fs.existsSync(fullPath)) return;
    seen.add(normalizedPath);
    files.push({
      path: normalizedPath,
      text: fs.readFileSync(fullPath, "utf8"),
    });
  }

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        addFile(path.relative(root, fullPath));
      }
    }
  }

  for (const sourceRoot of SOURCE_ROOTS) {
    walk(path.join(root, sourceRoot));
  }
  for (const legacyRoot of QUARANTINED_LEGACY_ROOTS) {
    walk(path.join(root, legacyRoot));
  }
  for (const policyRoot of EXTERNAL_PACKAGE_POLICY_ROOTS) {
    walk(path.join(root, policyRoot));
  }
  for (const fileName of CLASSIC_ROOT_ENTRY_FILES) {
    addFile(fileName);
  }
  addFile(PACKAGE_JSON_PATH);
  for (const fileName of EXTERNAL_PACKAGE_POLICY_FILES) {
    addFile(fileName);
  }
  return files;
}

function main() {
  const root = process.cwd();
  const result = analyzeImportBoundaries(listSourceFiles(root));
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    status: result.ok ? "pass" : "fail",
    checkedRoots: SOURCE_ROOTS,
    checkedQuarantinedLegacyRoots: QUARANTINED_LEGACY_ROOTS,
    checkedRootEntries: Array.from(CLASSIC_ROOT_ENTRY_FILES),
    expectedPackageMain: EXPECTED_PACKAGE_MAIN,
    forbiddenSourceFiles,
    checkedExternalPolicyFiles: EXTERNAL_PACKAGE_POLICY_FILES,
    checkedExternalPolicyRoots: EXTERNAL_PACKAGE_POLICY_ROOTS,
    playerHostOwnershipRules: {
      nativeWebViewHost: `${PLAYER_NATIVE_HOST_PATH}.tsx`,
      webIframeHost: `${PLAYER_WEB_HOST_PATH}.tsx`,
      nativeEmbedUrlOwner: "features/player",
    },
    catalogCompositionBoundary: {
      message: CATALOG_COMPOSITION_BOUNDARY_MESSAGE,
      forbiddenTargets: catalogCompositionForbiddenTargets.map((pattern) => pattern.source),
      forbiddenPackages: catalogCompositionForbiddenPackages.map((pattern) => pattern.source),
    },
    authSessionOwnership: {
      nativeBrowserStorageMessage: NATIVE_BROWSER_STORAGE_MESSAGE,
      nativeSupabaseAuthOwnerMessage: NATIVE_SUPABASE_AUTH_OWNER_MESSAGE,
      nativeSupabaseOwner: "services/supabase.ts",
    },
    routeIdentity: {
      canonicalWatchRouteMessage: CANONICAL_WATCH_ROUTE_MESSAGE,
      canonicalWatchRouteOwner: "shared/gsavRoutes.ts",
    },
    appRouteOwnerMap: Object.fromEntries(Object.entries(appRouteOwnerMap).map(([route, pattern]) => [route, pattern.source])),
    externalPackageImportAllowList: externalPackageImportAllowList.map((rule) => ({
      packageName: rule.packageName,
      importers: rule.importers.map((pattern) => pattern.source),
      reason: rule.reason,
      owner: rule.owner,
      exitCriteria: rule.exitCriteria,
    })),
    siblingAllowListBudget: SIBLING_ALLOWLIST_BUDGET,
    siblingAllowList: siblingAllowList.map((rule) => ({
      from: rule.from,
      to: rule.to,
      target: rule.target.source,
      kind: rule.kind,
      reason: rule.reason,
      owner: rule.owner,
      exitCriteria: rule.exitCriteria,
      expires: rule.expires,
    })),
    violations: result.violations,
  }, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  analyzeImportBoundaries,
  appRouteOwnerMap,
  classifyModule,
  externalPackageImportAllowList,
  extractImportSpecifiers,
  forbiddenSourceFiles,
  CATALOG_COMPOSITION_BOUNDARY_MESSAGE,
  catalogCompositionForbiddenTargets,
  BRIDGE_BACKEND_RESPONSIBILITY_MESSAGE,
  CANONICAL_WATCH_ROUTE_MESSAGE,
  NATIVE_BROWSER_STORAGE_MESSAGE,
  NATIVE_SUPABASE_AUTH_OWNER_MESSAGE,
  isConcretePolicyOwner,
  listSourceFiles,
  QUARANTINED_LEGACY_ROOTS,
  resolveImportTarget,
  siblingAllowList,
  SIBLING_ALLOWLIST_BUDGET,
  validateExternalPackageAllowList,
  validateExternalPackageImport,
  validateAppRouteAdapter,
  validateAppRouteOwnerMapCoverage,
  validateFeatureBarrelExports,
  validateBridgeBackendIsolation,
  validateNativeStorageAssumptions,
  validateNativeSupabaseAuthOwner,
  validateCanonicalWatchRouteConstruction,
  validateImport,
  validatePackageMain,
  validatePlayerHostOwnership,
  validateQuarantinedLegacySource,
  validateSiblingAllowList,
};
