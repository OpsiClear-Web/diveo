import { describe, expect, it } from "vitest";

import verifier from "./verify-bridge-origin-contract.js";

const {
  REQUIRED_SOURCE_FILES,
  analyzeBridgeOriginContract,
  stripComments,
  validateNativeHostOriginContract,
  validateNativeMessageOriginContract,
  validateNavGateOriginContract,
  validateSessionBridgeOriginContract,
  validateWebHostOriginContract,
} = verifier;

function source(path, text) {
  return { path, text };
}

function validSources(overrides = {}) {
  return {
    nativeHost: source(REQUIRED_SOURCE_FILES.nativeHost, `
      const allowedOrigin = useMemo(() => (gsavWebUrl ? getOrigin(gsavWebUrl) : ""), [gsavWebUrl]);
      handleNativeWebViewBridgeMessage({
        allowedOrigin,
        applySession,
        captureProgress,
        data: event.nativeEvent.data,
        pageUrl: event.nativeEvent.url,
      });
      return handleGsavEmbedNavigationRequest(request.url, allowedOrigin, qaControls.length > 0, effects);
    `),
    nativeMessage: source(REQUIRED_SOURCE_FILES.nativeMessage, `
      const messageOrigin = pageUrl ? getOrigin(pageUrl) : "";
      if (!isTrustedBridgeOrigin(messageOrigin, allowedOrigin)) {
        return "ignored-untrusted-origin";
      }
      if (isAuthReadyMessage(data)) applySession();
      return captureProgress(data);
    `),
    navGate: source(REQUIRED_SOURCE_FILES.navGate, `
      export function isAllowedGsavNavigation(url, allowedOrigin) {
        if (!allowedOrigin) return false;
        const next = new URL(url);
        return next.origin === allowedOrigin
          && next.searchParams.getAll("embed").length === 1
          && next.searchParams.get("embed") === "native";
      }
      export function isTrustedBridgeOrigin(origin, allowedOrigin) {
        if (!allowedOrigin) return false;
        if (origin == null || origin === "") return true;
        return origin === allowedOrigin;
      }
    `),
    webHost: source(REQUIRED_SOURCE_FILES.webHost, `
      const origin = useMemo(() => (baseUrl ? getOrigin(baseUrl) : ""), [baseUrl]);
      const postSession = () => {
        postSessionBridgeMessageForAuthState(
          iframeRef.current?.contentWindow,
          origin,
          authInitialized,
          sessionTokens,
        );
      };
      if (event.origin === origin && isAuthReadyMessage(event.data)) postSession();
    `),
    sessionBridge: source(REQUIRED_SOURCE_FILES.sessionBridge, `
      export function postSessionBridgeMessageForAuthState(target, targetOrigin, authInitialized, payload) {
        if (!target || !targetOrigin) return false;
        const message = buildSessionBridgeMessageForAuthState(authInitialized, payload);
        if (!message) return false;
        target.postMessage(message, targetOrigin);
        return true;
      }
    `),
    ...overrides,
  };
}

describe("bridge origin contract verifier", () => {
  it("accepts the current origin-gated contract shape", () => {
    const result = analyzeBridgeOriginContract(validSources());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("pass");
    expect(result.problems).toEqual([]);
    expect(result.checked).toMatchObject(REQUIRED_SOURCE_FILES);
  });

  it("reports missing required source files", () => {
    const result = analyzeBridgeOriginContract({
      ...validSources(),
      nativeHost: source(REQUIRED_SOURCE_FILES.nativeHost, null),
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      "features/player/useGsavEmbedHost.ts: required bridge origin source file is missing",
    );
  });

  it("requires the native host to derive and pass allowedOrigin", () => {
    expect(validateNativeHostOriginContract(source(REQUIRED_SOURCE_FILES.nativeHost, `
      const allowedOrigin = gsavWebUrl;
      handleNativeWebViewBridgeMessage({ data });
      return handleGsavEmbedNavigationRequest(request.url, "", false, effects);
    `))).toEqual([
      "features/player/useGsavEmbedHost.ts: must derive allowedOrigin from getOrigin(gsavWebUrl)",
      "features/player/useGsavEmbedHost.ts: must pass allowedOrigin into native bridge message handling",
      "features/player/useGsavEmbedHost.ts: must pass allowedOrigin into WebView navigation handling",
    ]);
  });

  it("requires inbound bridge messages to reject untrusted page origins first", () => {
    expect(validateNativeMessageOriginContract(source(REQUIRED_SOURCE_FILES.nativeMessage, `
      const messageOrigin = pageUrl || "";
      if (isAuthReadyMessage(data)) applySession();
      return captureProgress(data);
    `))).toEqual([
      "features/player/nativeBridgeMessage.ts: must derive message origin from the platform-reported page URL",
      "features/player/nativeBridgeMessage.ts: must reject untrusted message origins before session or progress handling",
    ]);
  });

  it("requires the navigation gate to fail closed and compare exact origins", () => {
    expect(validateNavGateOriginContract(source(REQUIRED_SOURCE_FILES.navGate, `
      export function isAllowedGsavNavigation(url, allowedOrigin) {
        const next = new URL(url);
        return next.searchParams.get("embed") === "native";
      }
      export function isTrustedBridgeOrigin(origin, allowedOrigin) {
        return true;
      }
    `))).toEqual([
      "features/player/navGate.ts: must fail closed when no allowed origin is configured",
      "features/player/navGate.ts: must allow WebView navigation only for same-origin routes with exactly one embed=native marker",
      "features/player/navGate.ts: must trust missing platform origins only after allowedOrigin exists, and otherwise require exact origin equality",
    ]);
  });

  it("requires Expo web iframe messages to use strict target origin and event origin checks", () => {
    expect(validateWebHostOriginContract(source(REQUIRED_SOURCE_FILES.webHost, `
      const origin = baseUrl;
      iframeRef.current?.contentWindow.postMessage(message, "*");
      if (isAuthReadyMessage(event.data)) postSession();
    `))).toEqual([
      "features/player/GsavWebView.web.tsx: must derive iframe target origin from getOrigin(baseUrl)",
      "features/player/GsavWebView.web.tsx: must send iframe session messages through the strict target-origin helper",
      "features/player/GsavWebView.web.tsx: must answer GSAV_AUTH_READY only from the configured iframe origin",
      "features/player/GsavWebView.web.tsx: must not call contentWindow.postMessage directly; use postSessionBridgeMessageForAuthState",
    ]);
  });

  it("rejects wildcard iframe target origins while allowing commented examples to be ignored", () => {
    expect(stripComments("// target.postMessage(message, \"*\")\ntarget.postMessage(message, targetOrigin);\n").trim())
      .toBe("target.postMessage(message, targetOrigin);");
    expect(validateSessionBridgeOriginContract(source(REQUIRED_SOURCE_FILES.sessionBridge, `
      export function postSessionBridgeMessageForAuthState(target, targetOrigin) {
        target.postMessage(message, "*");
      }
    `))).toEqual([
      "features/player/sessionBridge.ts: must refuse iframe postMessage when targetOrigin is missing",
      "features/player/sessionBridge.ts: must use the supplied targetOrigin when posting iframe session messages",
      "features/player/sessionBridge.ts: must not use wildcard targetOrigin for iframe session messages",
    ]);
  });
});
