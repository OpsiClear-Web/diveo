import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import verifier from "./verify-import-boundaries.js";

const {
  analyzeImportBoundaries,
  appRouteOwnerMap,
  BRIDGE_BACKEND_RESPONSIBILITY_MESSAGE,
  CANONICAL_WATCH_ROUTE_MESSAGE,
  CATALOG_COMPOSITION_BOUNDARY_MESSAGE,
  externalPackageImportAllowList,
  extractImportSpecifiers,
  forbiddenSourceFiles,
  isConcretePolicyOwner,
  listSourceFiles,
  NATIVE_BROWSER_STORAGE_MESSAGE,
  NATIVE_SUPABASE_AUTH_OWNER_MESSAGE,
  QUARANTINED_LEGACY_ROOTS,
  resolveImportTarget,
  siblingAllowList,
  SIBLING_ALLOWLIST_BUDGET,
  validateImport,
  validateExternalPackageAllowList,
  validateAppRouteAdapter,
  validateAppRouteOwnerMapCoverage,
  validateFeatureBarrelExports,
  validateBridgeBackendIsolation,
  validateNativeStorageAssumptions,
  validateNativeSupabaseAuthOwner,
  validateCanonicalWatchRouteConstruction,
  validatePackageMain,
  validatePlayerHostOwnership,
  validateQuarantinedLegacySource,
  validateSiblingAllowList,
} = verifier;

function analyze(files, options) {
  return analyzeImportBoundaries(files.map(([path, text]) => ({ path, text })), options);
}

describe("import boundary verifier", () => {
  it("extracts static import and re-export specifiers", () => {
    expect(extractImportSpecifiers(`
      import React from "react";
      import type { Thing } from "../shared/thing";
      import "../polyfill";
      export { default } from "../features/catalog/HomeScreen";
      const config = require("../../services/gsav");
      const lazy = import("../player/GsavWebView");
    `)).toEqual([
      "react",
      "../shared/thing",
      "../polyfill",
      "../features/catalog/HomeScreen",
      "../../services/gsav",
      "../player/GsavWebView",
    ]);
  });

  it("resolves relative and absolute internal import targets", () => {
    expect(resolveImportTarget("features/catalog/HomeScreen.tsx", "../scene/SceneCard")).toBe("features/scene/SceneCard");
    expect(resolveImportTarget("features/catalog/HomeScreen.tsx", "features/scene/SceneCard")).toBe("features/scene/SceneCard");
    expect(resolveImportTarget("features/catalog/HomeScreen.tsx", "shared/theme")).toBe("shared/theme");
    expect(resolveImportTarget("features/catalog/HomeScreen.tsx", "react")).toBeNull();
  });

  it("accepts route stubs, shared primitives, and documented feature exceptions", () => {
    const result = analyze([
      ["app/index.tsx", 'export { default } from "../features/catalog/HomeScreen";'],
      ["app/explore.tsx", 'export { default } from "../features/player/ExploreScreen";'],
      ["app/creator/_layout.tsx", 'export { default } from "../../features/app-shell/CreatorLayout";'],
      ["features/catalog/HomeScreen.tsx", `
        import { radius } from "../../shared/theme";
        import { useTheme } from "../../shared/themeContext";
        import { ContinueWatchingPill } from "./ContinueWatchingPill";
        import { SceneCard } from "../scene/SceneCard";
        import { shareScene } from "../scene/sceneShare";
        import { FollowButton } from "../social/FollowButton";
        import { SaveSceneButton } from "../social/SaveSceneButton";
      `],
      ["features/catalog/ContinueWatchingPill.tsx", `
        import { useLatestGsavResume } from "../player/resumeAccess";
      `],
      ["features/player/GsavWebView.tsx", `
        import { GSAV_ACCENT } from "../../shared/theme";
        import { useTheme } from "../../shared/themeContext";
        import { usePlayerEmbedPreferences } from "../preferences/preferenceAccess";
        import { useAuthBridgeSession } from "../social/authSession";
      `],
      ["features/scene/sceneShare.ts", `
        import { buildGsavWatchPath } from "../../shared/gsavRoutes";
        import { getConfiguredGsavWebUrl } from "../../shared/gsavWeb";
      `],
      ["features/settings/SettingsScreen.tsx", `
        import { useSettingsUpdateStatus } from "../app-update/updateAccess";
        import { useEditablePreferences } from "../preferences/preferenceAccess";
        import { useTheme } from "../../shared/themeContext";
        import { useAuthAccount } from "../social/authSession";
      `],
      ["features/app-shell/useAppBootstrap.ts", `
        import { useStartupUpdateCheck } from "../app-update/updateAccess";
        import { usePreferenceBootstrap } from "../preferences/preferenceAccess";
        import { loadSavedScenesForCurrentUser } from "../social/savedSceneAccess";
      `],
      ["features/social/LibraryScreen.tsx", `
        import { loadSavedScenesByBackendIds } from "./loadSavedScenesByBackendIds";
        import { SceneCard } from "../scene/SceneCard";
        import { shareScene } from "../scene/sceneShare";
      `],
    ]);

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("rejects app routes that import the wrong documented route owner", () => {
    expect(Object.keys(appRouteOwnerMap)).toContain("app/search");
    const result = analyze([
      ["app/search.tsx", 'export { default } from "../features/catalog/HomeScreen";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(expect.arrayContaining([
      "app route app/search must re-export its documented route owner ^features\\/catalog\\/SearchScreen$, not features/catalog/HomeScreen",
      "app route app/search must import its documented route owner ^features\\/catalog\\/SearchScreen$, not features/catalog/HomeScreen",
    ]));
  });

  it("rejects app route files with business logic or missing route-owner map coverage across route extensions", () => {
    expect(validateAppRouteAdapter("app/index.tsx", `
      // route adapter comment is fine
      export { default } from "../features/catalog/HomeScreen";
    `)).toEqual([]);

    const result = analyze([
      ["app/index.tsx", `
        import HomeScreen from "../features/catalog/HomeScreen";
        export default function Index() {
          return <HomeScreen />;
        }
      `],
      ["app/new-route.tsx", 'export { default } from "../features/catalog/HomeScreen";'],
      ["app/new-jsx.jsx", `
        export default function NewJsx() {
          return null;
        }
      `],
      ["app/new-ts.ts", `
        export default function newTs() {
          return "inline route logic";
        }
      `],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(expect.arrayContaining([
      "app route files must stay export-only adapters with a single default re-export",
      "app route app/new-route must be added to appRouteOwnerMap",
      "app route app/new-jsx must be added to appRouteOwnerMap",
      "app route app/new-ts must be added to appRouteOwnerMap",
    ]));
  });

  it("rejects appRouteOwnerMap entries whose route adapters no longer exist during full scans", () => {
    const files = [
      { path: "package.json", text: JSON.stringify({ main: "expo-router/entry" }) },
      { path: "app/index.tsx", text: 'export { default } from "../features/catalog/HomeScreen";' },
    ];

    expect(validateAppRouteOwnerMapCoverage(files)).toEqual(expect.arrayContaining([
      "appRouteOwnerMap entry app/search must point to an existing app route adapter",
    ]));

    const result = analyzeImportBoundaries(files);

    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: "scripts/verify-import-boundaries.js",
        specifier: "appRouteOwnerMap",
        message: "appRouteOwnerMap entry app/search must point to an existing app route adapter",
      }),
    ]));
  });

  it("rejects app routes that re-export shared code instead of mapped feature route roots", () => {
    const result = analyze([
      ["app/index.tsx", 'export { default } from "../shared/ui/Brand";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(expect.arrayContaining([
      "app route app/index must re-export a feature route owner, not shared/ui/Brand",
      "app route app/index must re-export its documented route owner ^features\\/catalog\\/HomeScreen$, not shared/ui/Brand",
      "app routes must not import shared UI or helpers directly",
    ]));
  });

  it("requires every sibling-feature allowlist entry to be documented", () => {
    expect(siblingAllowList).toHaveLength(SIBLING_ALLOWLIST_BUDGET);
    expect(validateSiblingAllowList(siblingAllowList)).toEqual([]);
  });

  it("rejects sibling-feature allowlist growth beyond the documented budget", () => {
    const expandedAllowList = [
      ...siblingAllowList,
      {
        from: "catalog",
        to: "settings",
        target: /^features\/settings\/SettingsScreen$/,
        kind: "route-composition",
        reason: "temporary test-only growth should fail the documented budget",
        owner: "@opsiclear/catalog",
        exitCriteria: "Remove this temporary test-only exception before merging",
        expires: "2026-07-31",
      },
    ];

    expect(validateSiblingAllowList(expandedAllowList)).toContain(
      `sibling allowlist has ${SIBLING_ALLOWLIST_BUDGET + 1} entries, exceeding budget ${SIBLING_ALLOWLIST_BUDGET}`,
    );
  });

  it("allows sibling-feature allowlist shrinkage when entries remain documented", () => {
    expect(validateSiblingAllowList(siblingAllowList.slice(0, SIBLING_ALLOWLIST_BUDGET - 1))).toEqual([]);
  });

  it("requires every external GSAV package policy entry to be documented", () => {
    expect(validateExternalPackageAllowList(externalPackageImportAllowList)).toEqual([]);
  });

  it("accepts documented external GSAV package importers", () => {
    const result = analyze([
      ["features/player/bridgeTypes.ts", 'import type { GsavNativeEvent } from "@opsiclear/gsav-bridge";'],
      ["features/player/sessionBridge.ts", 'export { buildSessionMessage } from "@opsiclear/gsav-bridge";'],
      ["scripts/gsav-runtime-smoke-bridge.js", 'const bridge = require("@opsiclear/gsav-bridge");'],
      ["scripts/stack-architecture-receipt.js", 'const bridge = require("@opsiclear/gsav-bridge");'],
      ["services/gsav.ts", 'import { createGsavCatalog } from "@opsiclear/gsav-client";'],
      ["features/social/socialAdapter.ts", 'import { setVideoSaved } from "@opsiclear/gsav-client";'],
    ]);

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("accepts player-owned WebView, iframe, and native embed URL construction", () => {
    const result = analyze([
      ["features/player/GsavWebView.tsx", `
        import { WebView } from "react-native-webview";
        import { buildNativeEmbedUrl } from "./routes";
        export const source = buildNativeEmbedUrl("/watch/test", "https://gsav.example.com");
      `],
      ["features/player/GsavWebView.web.tsx", `
        import { buildNativeEmbedUrl } from "./routes";
        export function Host() { return <iframe src={buildNativeEmbedUrl("/watch/test", "https://gsav.example.com")} />; }
      `],
      ["features/player/routes.ts", `
        export function buildNativeEmbedUrl(path, baseUrl) {
          return new URL(path, baseUrl).toString();
        }
      `],
      ["features/player/bridge.test.ts", `
        import { buildNativeEmbedUrl } from "./routes";
        expect(buildNativeEmbedUrl("/watch/test", "https://gsav.example.com")).toContain("embed=native");
      `],
    ]);

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("keeps bridge modules out of backend and social write responsibilities", () => {
    expect(validateBridgeBackendIsolation("features/player/sessionBridge.ts", `
      export function buildSessionBridgeMessageForAuthState(payload) {
        return { type: "GSAV_SET_SESSION", payload };
      }
    `)).toEqual([]);

    const result = analyze([
      ["features/player/sessionBridge.ts", 'import { setVideoSaved } from "@opsiclear/gsav-client";'],
      ["features/player/nativeBridgeMessage.ts", 'supabase.from("videos").select("*");'],
      ["features/player/progressBridge.ts", 'fetch("/functions/v1/finalize-upload");'],
      ["features/player/bridge.test.ts", 'supabase.from("videos").select("*");'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("@opsiclear/gsav-client import is not in the documented external package policy"),
      BRIDGE_BACKEND_RESPONSIBILITY_MESSAGE,
      BRIDGE_BACKEND_RESPONSIBILITY_MESSAGE,
    ]));
    expect(result.violations.some((violation) => violation.file === "features/player/bridge.test.ts")).toBe(false);
  });

  it("keeps native auth/session storage behind platform storage contracts", () => {
    expect(validateNativeStorageAssumptions("features/catalog/useGsavSearch.ts", `
      import AsyncStorage from "@react-native-async-storage/async-storage";
      export const read = () => AsyncStorage.getItem("recent-searches");
    `)).toEqual([]);
    expect(validateNativeStorageAssumptions("services/supabase.ts", `
      // On react-native-web, AsyncStorage maps to localStorage.
      export const storage = AsyncStorage;
    `)).toEqual([]);

    const result = analyze([
      ["features/social/authSession.ts", "export const token = window.localStorage.getItem('token');"],
      ["features/player/sessionBridge.ts", "export const session = sessionStorage.getItem('gsav');"],
      ["features/social/authSession.test.ts", "expect(window.localStorage.getItem('token')).toBeNull();"],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual([
      NATIVE_BROWSER_STORAGE_MESSAGE,
      NATIVE_BROWSER_STORAGE_MESSAGE,
    ]);
  });

  it("requires services/supabase.ts to own native Supabase auth persistence", () => {
    expect(validateNativeSupabaseAuthOwner("services/supabase.ts", `
      import "react-native-url-polyfill/auto";
      import AsyncStorage from "@react-native-async-storage/async-storage";
      import { createClient } from "@supabase/supabase-js";
      export const supabase = createClient("https://example.supabase.co", "anon", {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      });
    `)).toEqual([]);

    expect(validateNativeSupabaseAuthOwner("services/supabase.ts", `
      import { createClient } from "@supabase/supabase-js";
      export const supabase = createClient("https://example.supabase.co", "anon", {
        auth: { persistSession: true, detectSessionInUrl: true },
      });
    `)).toEqual([NATIVE_SUPABASE_AUTH_OWNER_MESSAGE]);
  });

  it("requires native watch navigation to use the canonical route helper", () => {
    expect(validateCanonicalWatchRouteConstruction("shared/gsavRoutes.ts", `
      export const route = \`/watch/\${encodeURIComponent(id)}\`;
    `)).toEqual([]);
    expect(validateCanonicalWatchRouteConstruction("features/catalog/HomeScreen.tsx", `
      // Documentation may mention /watch/\${id}; comments are ignored.
      router.push(buildGsavWatchPath(id));
    `)).toEqual([]);

    const result = analyze([
      ["features/catalog/HomeScreen.tsx", "router.push(`/watch/${id}` as never);"],
      ["features/social/LibraryScreen.tsx", 'router.push("/watch/" + scene.id);'],
      ["features/catalog/HomeScreen.test.tsx", "router.push(`/watch/${id}` as never);"],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual([
      CANONICAL_WATCH_ROUTE_MESSAGE,
      CANONICAL_WATCH_ROUTE_MESSAGE,
    ]);
  });

  it("rejects player host primitives and native embed URL construction outside the player boundary", () => {
    const result = analyze([
      ["features/catalog/HomeScreen.tsx", 'import { WebView } from "react-native-webview";'],
      ["features/catalog/SearchScreen.tsx", 'export function SearchScreen() { return <iframe src="https://gsav.example.com" />; }'],
      ["shared/gsavWeb.ts", 'export const url = buildNativeEmbedUrl("/watch/test", "https://gsav.example.com");'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual([
      "react-native-webview imports are only allowed in features/player/GsavWebView.tsx",
      "iframe player hosts are only allowed in features/player/GsavWebView.web.tsx",
      "native embed URL construction must stay inside features/player (buildNativeEmbedUrl helper)",
    ]);
  });

  it("rejects ad hoc native embed URL assembly outside the player boundary", () => {
    const result = analyze([
      ["features/catalog/HomeScreen.tsx", 'router.push("/explore" as never);'],
      ["features/catalog/SearchScreen.tsx", `
        const url = new URL("/watch/test", baseUrl);
        url.searchParams.set("embed", "native");
      `],
      ["shared/gsavWeb.ts", 'export const url = "/explore?embed=native&dataSaver=1";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual([
      "native embed URL construction must stay inside features/player (searchParams embed mutation)",
      "native embed URL construction must stay inside features/player (literal embed=native URL, literal dataSaver=1 URL)",
    ]);
  });

  it("rejects native embed URL bypass assembly shapes outside the player boundary", () => {
    const result = analyze([
      ["features/catalog/CreatorScreen.tsx", `
        const url = new URL("/watch/test", baseUrl);
        url.searchParams.append("embed", "native");
      `],
      ["features/social/LibraryScreen.tsx", `
        const params = new URLSearchParams([["embed", "native"]]);
      `],
      ["shared/gsavRoutes.ts", `
        export const nativeEmbedParam = "embed" + "=" + "native";
      `],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual([
      "native embed URL construction must stay inside features/player (searchParams embed mutation)",
      "native embed URL construction must stay inside features/player (URLSearchParams embed tuple)",
      "native embed URL construction must stay inside features/player (split embed=native string assembly)",
    ]);
  });

  it("exposes player host ownership checks as a focused helper", () => {
    expect(validatePlayerHostOwnership("features/player/GsavWebView.tsx", 'import { WebView } from "react-native-webview";')).toEqual([]);
    expect(validatePlayerHostOwnership("features/catalog/HomeScreen.tsx", 'import { WebView } from "react-native-webview";')).toEqual([
      "react-native-webview imports are only allowed in features/player/GsavWebView.tsx",
    ]);
  });

  it("rejects undocumented external GSAV package importers", () => {
    const result = analyze([
      ["features/catalog/catalogAdapter.ts", 'import { createGsavCatalog } from "@opsiclear/gsav-client";'],
      ["features/social/LibraryScreen.tsx", 'import { getSavedVideoIds } from "@opsiclear/gsav-client";'],
      ["features/social/savedScenesStore.ts", 'import { setVideoSaved } from "@opsiclear/gsav-client";'],
      ["features/social/useGsavFollow.ts", 'import { setChannelFollowed } from "@opsiclear/gsav-client";'],
      ["features/catalog/HomeScreen.tsx", 'import { GSAV_NATIVE_BRIDGE_VERSION } from "@opsiclear/gsav-bridge";'],
      ["features/player/UnknownRuntime.ts", 'import { createRuntime } from "@opsiclear/gsav-runtime";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual([
      expect.stringContaining("@opsiclear/gsav-client import is not in the documented external package policy"),
      expect.stringContaining("@opsiclear/gsav-client import is not in the documented external package policy"),
      expect.stringContaining("@opsiclear/gsav-client import is not in the documented external package policy"),
      expect.stringContaining("@opsiclear/gsav-client import is not in the documented external package policy"),
      expect.stringContaining("@opsiclear/gsav-bridge import is not in the documented external package policy"),
      expect.stringContaining("@opsiclear/gsav-runtime import is not covered by the external GSAV package policy"),
    ]);
  });

  it("scans scripts for undocumented external GSAV package importers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "import-boundaries-"));
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "scripts", "rogue-gsav-client.js"),
      'const client = require("@opsiclear/gsav-client");\n',
    );

    const result = analyzeImportBoundaries(listSourceFiles(root));

    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        file: "scripts/rogue-gsav-client.js",
        message: expect.stringContaining("@opsiclear/gsav-client import is not in the documented external package policy"),
      }),
    ]);
  });

  it("scans scripts for unknown external GSAV packages", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "import-boundaries-"));
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "scripts", "rogue-gsav-runtime.js"),
      'const runtime = require("@opsiclear/gsav-runtime");\n',
    );

    const result = analyzeImportBoundaries(listSourceFiles(root));

    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        file: "scripts/rogue-gsav-runtime.js",
        message: expect.stringContaining("@opsiclear/gsav-runtime import is not covered by the external GSAV package policy"),
      }),
    ]);
  });

  it("rejects undocumented external GSAV package policy entries", () => {
    const result = analyze([], {
      externalPackageImportAllowList: [
        {
          packageName: "@opsiclear/gsav-runtime",
          importers: [],
          reason: "short",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        specifier: "externalPackageImportAllowList",
        message: "external package policy rule @opsiclear/gsav-runtime #0 must declare importer RegExp entries",
      }),
      expect.objectContaining({
        specifier: "externalPackageImportAllowList",
        message: "external package policy rule @opsiclear/gsav-runtime #0 must include a documented rationale",
      }),
      expect.objectContaining({
        specifier: "externalPackageImportAllowList",
        message: "external package policy rule @opsiclear/gsav-runtime #0 must include a concrete owner handle",
      }),
      expect.objectContaining({
        specifier: "externalPackageImportAllowList",
        message: "external package policy rule @opsiclear/gsav-runtime #0 must include documented exit criteria",
      }),
    ]);
  });

  it("rejects undocumented sibling-feature allowlist entries", () => {
    const result = analyze([
      ["features/catalog/HomeScreen.tsx", 'import { GsavWebView } from "../player/GsavWebView";'],
    ], {
      siblingAllowList: [
        {
          from: "catalog",
          to: "player",
          target: /^features\/player\/GsavWebView$/,
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual([
      expect.stringContaining("must declare a valid kind"),
      expect.stringContaining("must include a documented rationale"),
      expect.stringContaining("must include a concrete owner handle"),
      expect.stringContaining("must include documented exit criteria"),
      expect.stringContaining("must include an ISO expires date"),
    ]);
  });

  it("rejects partial sibling-feature allowlist documentation", () => {
    expect(validateSiblingAllowList([
      {
        from: "catalog",
        to: "player",
        target: /^features\/player\/resumeAccess$/,
        kind: "access-contract",
        reason: "catalog continue-watching UI may use player resume access",
        owner: "",
        exitCriteria: "short",
      },
    ])).toEqual([
      "sibling allowlist rule catalog -> player #0 must include a concrete owner handle",
      "sibling allowlist rule catalog -> player #0 must include documented exit criteria",
      "sibling allowlist rule catalog -> player #0 must include an ISO expires date",
    ]);
  });

  it("rejects placeholder owner labels in policy allowlists", () => {
    expect(isConcretePolicyOwner("@opsiclear/player")).toBe(true);
    expect(isConcretePolicyOwner("player owner")).toBe(false);
    expect(isConcretePolicyOwner("@opsiclear/pending-owner")).toBe(false);
    expect(validateSiblingAllowList([
      {
        ...siblingAllowList[0],
        owner: "app-shell owner",
      },
    ])).toContain("sibling allowlist rule app-shell -> app-update #0 must include a concrete owner handle");
    expect(validateExternalPackageAllowList([
      {
        ...externalPackageImportAllowList[0],
        owner: "player owner",
      },
    ])).toContain("external package policy rule @opsiclear/gsav-bridge #0 must include a concrete owner handle");
  });

  it("rejects expired sibling-feature allowlist entries", () => {
    expect(validateSiblingAllowList([
      {
        from: "catalog",
        to: "player",
        target: /^features\/player\/resumeAccess$/,
        kind: "access-contract",
        reason: "catalog continue-watching UI may use player resume access",
        owner: "@opsiclear/player",
        exitCriteria: "Remove when resume state moves behind a shared non-feature contract",
        expires: "2026-01-31",
      },
    ], { currentDate: "2026-06-30" })).toEqual([
      "sibling allowlist rule catalog -> player #0 expired on 2026-01-31",
    ]);
  });

  it("rejects lower layers importing feature code", () => {
    const result = analyze([
      ["shared/theme.ts", 'import { useTheme } from "../features/preferences/useTheme";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("theme reads must use shared/themeContext"),
      "shared must not import app or feature code",
    ]));
  });

  it("rejects app routes importing service clients", () => {
    const result = analyze([
      ["app/search.tsx", 'import { gsavCatalog } from "../services/gsav";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(expect.arrayContaining([
      "app route files must stay export-only adapters with a single default re-export",
      "app routes must not import service clients or utils directly",
    ]));
  });

  it("enforces boundaries for absolute internal imports", () => {
    const result = analyze([
      ["app/search.tsx", 'import { gsavCatalog } from "services/gsav";'],
      ["features/catalog/HomeScreen.tsx", 'import { GsavWebView } from "features/player/GsavWebView";'],
      ["shared/theme.ts", 'import { useTheme } from "features/preferences/useTheme";'],
      ["features/catalog/SearchScreen.tsx", 'import { SceneCard } from "features/scene/SceneCard";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(expect.arrayContaining([
      "app route files must stay export-only adapters with a single default re-export",
      "app routes must not import service clients or utils directly",
      expect.stringContaining("undocumented sibling feature import catalog -> player"),
      "shared must not import app or feature code",
    ]));
  });

  it("rejects app routes importing feature barrels instead of route screen roots", () => {
    const result = analyze([
      ["app/index.tsx", 'import { HomeScreen } from "../features/catalog";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(expect.arrayContaining([
      "app route files must stay export-only adapters with a single default re-export",
      "app route imports non-screen feature internals: features/catalog",
    ]));
  });

  it("rejects classic root entry files outside Expo Router", () => {
    const result = analyze([
      ["App.js", "export default function App() { return null; }"],
      ["App.jsx", "export default function App() { return null; }"],
      ["App.ts", "export default function App() { return null; }"],
      ["App.tsx", 'export default function App() { return null; }'],
      ["index.js", 'import { registerRootComponent } from "expo";'],
      ["index.jsx", 'import { registerRootComponent } from "expo";'],
      ["index.ts", 'import { registerRootComponent } from "expo";'],
      ["index.tsx", 'import { registerRootComponent } from "expo";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(
      Array.from({ length: 8 }, () => "classic Expo root entry files must not coexist with package.json main expo-router/entry"),
    );
  });

  it("requires package.json to keep Expo Router as the only root entry", () => {
    expect(validatePackageMain('{"main":"expo-router/entry"}')).toEqual([]);

    const result = analyze([
      ["package.json", '{"main":"index.ts"}'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: "package.json",
        specifier: "main",
        message: "package.json main must remain expo-router/entry",
      }),
    ]));
  });

  it("rejects feature barrels exporting route screens and layouts", () => {
    expect(validateFeatureBarrelExports("features/catalog/index.ts", 'export * from "./catalogAdapter";')).toEqual([]);

    const result = analyze([
      ["features/catalog/index.ts", `
        export * from "./HomeScreen";
        export { SearchScreen } from "./SearchScreen";
      `],
      ["features/app-shell/index.ts", 'export { default as RootLayout } from "./RootLayout";'],
      ["features/player/index.ts", 'export * from "./routes";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(expect.arrayContaining([
      "feature barrel features/catalog/index must not export route screens or layouts: features/catalog/HomeScreen",
      "feature barrel features/catalog/index must not export route screens or layouts: features/catalog/SearchScreen",
      "feature barrel features/app-shell/index must not export route screens or layouts: features/app-shell/RootLayout",
      expect.stringContaining("player helper exports must stay on leaf modules"),
    ]));
  });

  it("rejects a broad player helper barrel", () => {
    const result = analyze([
      ["features/player/index.ts", 'export * from "./routes";'],
    ]);

    expect(forbiddenSourceFiles.map((file) => file.path)).toContain("features/player/index.ts");
    expect(result.ok).toBe(false);
    expect(result.violations[0].message).toContain("player helper exports must stay on leaf modules");
  });

  it("rejects the player URL facade so shared GSAV web helpers stay shared-owned", () => {
    const result = analyze([
      ["features/player/url.ts", 'export { getConfiguredGsavWebUrl } from "../../shared/gsavWeb";'],
    ]);

    expect(forbiddenSourceFiles.map((file) => file.path)).toContain("features/player/url.ts");
    expect(result.ok).toBe(false);
    expect(result.violations[0].message).toContain("shared GSAV web URL helpers must be imported from shared/gsavWeb");
  });

  it("rejects the preferences theme hook so theme reads go through shared context", () => {
    const result = analyze([
      ["features/preferences/useTheme.ts", 'export function useTheme() { return {}; }'],
      ["features/catalog/HomeScreen.tsx", 'import { useTheme } from "../preferences/useTheme";'],
    ]);

    expect(forbiddenSourceFiles.map((file) => file.path)).toContain("features/preferences/useTheme.ts");
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("theme reads must use shared/themeContext"),
      expect.stringContaining("theme reads must use shared/themeContext instead of the preferences feature"),
    ]));
  });

  it("rejects source files reintroduced under quarantined legacy roots", () => {
    expect(QUARANTINED_LEGACY_ROOTS).toEqual(["components", "hooks", "store"]);
    expect(validateQuarantinedLegacySource("components/LegacyCard.tsx")[0]).toContain("components/ is a quarantined legacy root");
    expect(validateQuarantinedLegacySource("features/catalog/HomeScreen.tsx")).toEqual([]);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "import-boundaries-legacy-roots-"));
    fs.mkdirSync(path.join(root, "components"), { recursive: true });
    fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
    fs.mkdirSync(path.join(root, "store"), { recursive: true });
    fs.writeFileSync(path.join(root, "components", "LegacyCard.tsx"), "export function LegacyCard() { return null; }\n");
    fs.writeFileSync(path.join(root, "hooks", "useLegacy.ts"), "export function useLegacy() { return null; }\n");
    fs.writeFileSync(path.join(root, "store", "legacyStore.ts"), "export const legacy = {};\n");

    const result = analyzeImportBoundaries(listSourceFiles(root));

    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: "components/LegacyCard.tsx",
        specifier: "quarantined-legacy-root",
        message: expect.stringContaining("components/ is a quarantined legacy root"),
      }),
      expect.objectContaining({
        file: "hooks/useLegacy.ts",
        specifier: "quarantined-legacy-root",
        message: expect.stringContaining("hooks/ is a quarantined legacy root"),
      }),
      expect.objectContaining({
        file: "store/legacyStore.ts",
        specifier: "quarantined-legacy-root",
        message: expect.stringContaining("store/ is a quarantined legacy root"),
      }),
    ]));
  });

  it("rejects feature screens and layouts importing service clients directly", () => {
    const result = analyze([
      ["features/catalog/HomeScreen.tsx", 'import { gsavCatalog } from "../../services/gsav";'],
      ["features/app-shell/RootLayout.tsx", 'import { supabase } from "../../services/supabase";'],
      ["features/catalog/catalogAdapter.ts", 'import { gsavCatalog } from "../../services/gsav";'],
      ["features/social/gsavAuthStore.ts", 'import { supabase } from "../../services/supabase";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual([
      "feature screens and layouts must use feature adapters or access contracts instead of service clients directly",
      "feature screens and layouts must use feature adapters or access contracts instead of service clients directly",
    ]);
  });

  it("rejects undocumented feature helper imports from service clients", () => {
    const result = analyze([
      ["features/player/routes.ts", 'import { gsavCatalog } from "../../services/gsav";'],
      ["features/preferences/preferencesStore.ts", 'import { supabase } from "../../services/supabase";'],
      ["features/catalog/catalogAdapter.ts", 'import { gsavCatalog } from "../../services/gsav";'],
      ["features/social/gsavAuthStore.ts", 'import { supabase } from "../../services/supabase";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual([
      "feature player must not import undocumented service client services/gsav",
      "feature preferences must not import undocumented service client services/supabase",
    ]);
  });

  it("rejects CommonJS, dynamic, and source-root escaping imports", () => {
    const result = analyze([
      ["features/catalog/HomeScreen.tsx", 'const service = require("../../services/gsav");'],
      ["features/catalog/SearchScreen.tsx", 'const player = import("../player/GsavWebView");'],
      ["features/player/GsavWebView.tsx", 'const packageJson = require("../../package.json");'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual([
      "feature screens and layouts must use feature adapters or access contracts instead of service clients directly",
      expect.stringContaining("undocumented sibling feature import catalog -> player"),
      "relative import escapes the repository source roots: ../../package.json",
    ]);
  });

  it("rejects undocumented sibling feature imports", () => {
    const result = analyze([
      ["features/catalog/HomeScreen.tsx", 'import { GsavWebView } from "../player/GsavWebView";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations[0].message).toContain("undocumented sibling feature import catalog -> player");
  });

  it("rejects social imports from catalog after scene extraction", () => {
    const result = analyze([
      ["features/social/LibraryScreen.tsx", 'import { SceneCard } from "../catalog/SceneCard";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations[0].message).toContain("undocumented sibling feature import social -> catalog");
  });

  it("rejects saved-scene lookup through the scene presentation surface", () => {
    const result = analyze([
      ["features/social/LibraryScreen.tsx", 'import { loadScenesByBackendIds } from "../scene/loadScenesByBackendIds";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations[0].message).toContain("undocumented sibling feature import social -> scene");
  });

  it("rejects scene presentation importing app theme state directly", () => {
    const result = analyze([
      ["features/scene/SceneCard.tsx", 'import { useTheme } from "../preferences/useTheme";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations[0].message).toContain("theme reads must use shared/themeContext");
  });

  it("rejects scene imports from player after share URL decoupling", () => {
    const result = analyze([
      ["features/scene/sceneShare.ts", 'import { buildGsavWatchPath } from "../player/routes";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations[0].message).toContain("undocumented sibling feature import scene -> player");
  });

  it("rejects catalog imports from player route internals", () => {
    const result = analyze([
      ["features/catalog/HomeScreen.tsx", 'import { buildGsavWatchPath } from "../player/routes";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations[0].message).toContain("undocumented sibling feature import catalog -> player");
  });

  it("rejects catalog imports from social follow hook internals", () => {
    const result = analyze([
      ["features/catalog/CreatorScreen.tsx", 'import { useGsavFollow } from "../social/useGsavFollow";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations[0].message).toContain("undocumented sibling feature import catalog -> social");
  });

  it("rejects catalog imports from social/player internals and Supabase clients", () => {
    const result = analyze([
      ["features/catalog/HomeScreen.tsx", 'import { useSavedScenesStore } from "../social/savedScenesStore";'],
      ["features/catalog/SearchScreen.tsx", 'import { useGsavProgressStore } from "../player/gsavProgressStore";'],
      ["features/catalog/CreatorScreen.tsx", 'import { supabase } from "../../services/supabase";'],
      ["features/catalog/useGsavFeed.ts", 'import type { Session } from "@supabase/supabase-js";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(
      expect.arrayContaining([
        CATALOG_COMPOSITION_BOUNDARY_MESSAGE,
        CATALOG_COMPOSITION_BOUNDARY_MESSAGE,
        CATALOG_COMPOSITION_BOUNDARY_MESSAGE,
        CATALOG_COMPOSITION_BOUNDARY_MESSAGE,
      ]),
    );
  });

  it("rejects deleted compatibility modules", () => {
    expect(validateImport("features/catalog/HomeScreen.tsx", "../player/theme")[0]).toContain("design tokens");
    expect(validateImport("features/player/GsavWebView.tsx", "../settings/settingsStore")[0]).toContain("preferences state");
  });

  it("rejects direct cross-feature auth store imports", () => {
    const result = analyze([
      ["features/player/GsavWebView.tsx", 'import { useGsavAuthStore } from "../social/gsavAuthStore";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations[0].message).toContain("undocumented sibling feature import player -> social");
  });

  it("rejects direct cross-feature preference and saved-scene store imports", () => {
    const result = analyze([
      ["features/player/GsavWebView.tsx", 'import { usePreferencesStore } from "../preferences/preferencesStore";'],
      ["features/app-shell/useAppBootstrap.ts", 'import { useSavedScenesStore } from "../social/savedScenesStore";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("cross-feature preference access"),
        expect.stringContaining("cross-feature saved scene access"),
      ]),
    );
  });

  it("rejects direct cross-feature update hook imports", () => {
    const result = analyze([
      ["features/settings/SettingsScreen.tsx", 'import { useCheckUpdate } from "../app-update/useCheckUpdate";'],
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations[0].message).toContain("cross-feature update access");
  });
});
