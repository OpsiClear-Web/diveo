import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { handleGsavEmbedNavigationRequest } from "./gsavEmbedNavigationRequest";
import { QA_CROSS_ORIGIN_TARGET } from "./nativeQaControls";

const playerDir = dirname(fileURLToPath(import.meta.url));

describe("useGsavEmbedHost navigation handling", () => {
  it("allows trusted hosted player routes and clears stale blocked navigation", () => {
    const effects = {
      openExternalUrl: vi.fn(),
      setBlockedNavigationMessage: vi.fn(),
      setQaStatus: vi.fn(),
    };

    const allowed = handleGsavEmbedNavigationRequest(
      "https://gsav.example/watch/test?embed=native",
      "https://gsav.example",
      false,
      effects,
    );

    expect(allowed).toBe(true);
    expect(effects.setBlockedNavigationMessage).toHaveBeenCalledWith(null);
    expect(effects.setQaStatus).not.toHaveBeenCalled();
    expect(effects.openExternalUrl).not.toHaveBeenCalled();
  });

  it("blocks same-origin product routes inside the embedded player", () => {
    const effects = {
      openExternalUrl: vi.fn(),
      setBlockedNavigationMessage: vi.fn(),
      setQaStatus: vi.fn(),
    };

    const allowed = handleGsavEmbedNavigationRequest(
      "https://gsav.example/creator/elly?embed=native",
      "https://gsav.example",
      false,
      effects,
    );

    expect(allowed).toBe(false);
    expect(effects.setBlockedNavigationMessage).toHaveBeenCalledWith(
      "This GSAV page is handled by the native app shell and cannot run inside the embedded player.",
    );
    expect(effects.setQaStatus).toHaveBeenCalledWith(
      "Blocked embedded navigation: https://gsav.example/creator/elly?embed=native",
    );
    expect(effects.openExternalUrl).not.toHaveBeenCalled();
  });

  it("hands real external links to the native external-link path", () => {
    const effects = {
      openExternalUrl: vi.fn(),
      setBlockedNavigationMessage: vi.fn(),
      setQaStatus: vi.fn(),
    };

    const allowed = handleGsavEmbedNavigationRequest(
      "https://docs.example/guide",
      "https://gsav.example",
      false,
      effects,
    );

    expect(allowed).toBe(false);
    expect(effects.setBlockedNavigationMessage).toHaveBeenCalledWith(
      "External navigation blocked: https://docs.example/guide",
    );
    expect(effects.setQaStatus).toHaveBeenCalledWith("Blocked external navigation: https://docs.example/guide");
    expect(effects.openExternalUrl).toHaveBeenCalledWith("https://docs.example/guide");
  });

  it("keeps the QA cross-origin probe inside the native blocked state", () => {
    const effects = {
      openExternalUrl: vi.fn(),
      setBlockedNavigationMessage: vi.fn(),
      setQaStatus: vi.fn(),
    };

    const allowed = handleGsavEmbedNavigationRequest(
      QA_CROSS_ORIGIN_TARGET,
      "https://gsav.example",
      true,
      effects,
    );

    expect(allowed).toBe(false);
    expect(effects.setQaStatus).toHaveBeenCalledWith(
      `Blocked external navigation: ${QA_CROSS_ORIGIN_TARGET}`,
    );
    expect(effects.openExternalUrl).not.toHaveBeenCalled();
  });
});

describe("useGsavEmbedHost controller boundary", () => {
  it("keeps native WebView policy out of the presenter component", () => {
    const controllerSource = readFileSync(join(playerDir, "useGsavEmbedHost.ts"), "utf8");
    const viewSource = readFileSync(join(playerDir, "GsavWebView.tsx"), "utf8");

    expect(controllerSource).toContain("BackHandler.addEventListener");
    expect(controllerSource).toContain("handleNativeWebViewBridgeMessage");
    expect(controllerSource).toContain("handleProgressBridgeMessage");
    expect(controllerSource).toContain("injectSessionBridgeScriptForAuthState");
    expect(controllerSource).toContain("reduceNativeWebViewLoadState");
    expect(controllerSource).toContain("reduceNativeBridgeOverlayState");
    expect(viewSource).toContain("const host = useGsavEmbedHost");
    expect(viewSource).not.toContain("BackHandler.addEventListener");
    expect(viewSource).not.toContain("handleNativeWebViewBridgeMessage");
    expect(viewSource).not.toContain("handleProgressBridgeMessage");
    expect(viewSource).not.toContain("injectSessionBridgeScriptForAuthState");
    expect(viewSource).not.toContain("reduceNativeWebViewLoadState");
    expect(viewSource).not.toContain("reduceNativeBridgeOverlayState");
  });
});
