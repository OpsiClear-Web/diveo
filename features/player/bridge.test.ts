import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { firstParam } from "../../shared/routeParams";
import {
  buildNativeCommandScript,
  getBridgeMismatchMessage,
  getBridgeStatusLabel,
  getCapabilityLabel,
  getUnsupportedReason,
  isBridgeCompatible,
  parseBridgeMessage,
  reduceBridgeEvent,
  updatePlaybackSnapshot,
} from "./bridgeState";
import { buildNativeCommandMessage, GSAV_NATIVE_BRIDGE_VERSION } from "./bridgeTypes";
import { handleNativeWebViewBridgeMessage } from "./nativeBridgeMessage";
import { initialNativeBridgeOverlayState, reduceNativeBridgeOverlayState } from "./nativeBridgeOverlay";
import {
  getNativeWebViewLoadError,
  initialNativeWebViewLoadState,
  reduceNativeWebViewLoadState,
} from "./nativeLoadState";
import {
  getNativeWebViewBlockedNavigationMessage,
  getNativeWebViewNavigationDecision,
} from "./nativeNavigation";
import {
  NATIVE_QA_CONTROLS,
  QA_CROSS_ORIGIN_TARGET,
  QA_SAME_ORIGIN_PRODUCT_PATH,
  nativeQaControlsEnabled,
} from "./nativeQaControls";
import { isAllowedGsavNavigation, isTrustedBridgeOrigin } from "./navGate";
import { handleProgressBridgeMessage, type ProgressBridgeTracker } from "./progressBridge";
import {
  buildNativeEmbedUrl,
  buildGsavScreenWatchPath,
  GSAV_EXPLORE_EMBED_ROUTE,
  GSAV_NATIVE_DIAGNOSTICS_EMBED_ROUTE,
  makeGsavEmbedRoute,
  type GsavEmbedRoute,
  isGsavShellRoute,
  resolveGsavScreenRouteParams,
} from "./routes";
import {
  buildSessionBridgeMessageForAuthState,
  buildSessionBridgeScriptForAuthState,
  injectSessionBridgeScriptForAuthState,
  postSessionBridgeMessageForAuthState,
} from "./sessionBridge";

const playerDir = dirname(fileURLToPath(import.meta.url));

describe("GSAV WebView URL helpers", () => {
  it("builds a native embed URL from an absolute path", () => {
    expect(buildNativeEmbedUrl(makeGsavEmbedRoute("/watch/test"), "http://127.0.0.1:5191/")).toBe(
      "http://127.0.0.1:5191/watch/test?embed=native",
    );
  });

  it("preserves existing query params when adding native embed mode", () => {
    expect(buildNativeEmbedUrl(makeGsavEmbedRoute("watch/test?t=2.5"), "https://gsav.example")).toBe(
      "https://gsav.example/watch/test?t=2.5&embed=native",
    );
  });

  it("replaces an existing embed value without duplicating it", () => {
    expect(buildNativeEmbedUrl(makeGsavEmbedRoute("/watch/test?embed=web&t=2.5"), "https://gsav.example")).toBe(
      "https://gsav.example/watch/test?embed=native&t=2.5",
    );
  });

  it("composes native embed mode with data saver", () => {
    expect(buildNativeEmbedUrl(GSAV_EXPLORE_EMBED_ROUTE, "https://gsav.example", { dataSaver: true })).toBe(
      "https://gsav.example/explore?embed=native&dataSaver=1",
    );
  });

  it("allows the hosted native diagnostics shell path", () => {
    expect(buildNativeEmbedUrl(GSAV_NATIVE_DIAGNOSTICS_EMBED_ROUTE, "https://gsav.example")).toBe(
      "https://gsav.example/native-diagnostics?embed=native",
    );
  });

  it("brands only hosted shell routes as initial embed paths", () => {
    expect(makeGsavEmbedRoute("watch/test?t=2.5")).toBe("/watch/test?t=2.5");
    expect(GSAV_EXPLORE_EMBED_ROUTE).toBe("/explore");
    expect(GSAV_NATIVE_DIAGNOSTICS_EMBED_ROUTE).toBe("/native-diagnostics");
  });

  it("rejects protocol-relative paths before URL construction", () => {
    expect(() => makeGsavEmbedRoute("//evil.example/watch/test")).toThrow(
      "Native embed paths must be relative",
    );
  });

  it("rejects non-allowlisted hosted paths before initial WebView load", () => {
    for (const path of [
      "/",
      "/creator/elly",
      "/watch",
      "/watch/test/extra",
      "/gsav/test",
      "/gsav-diagnostics",
      "/explore/extra",
      "/native-diagnostics/extra",
    ]) {
      expect(() => makeGsavEmbedRoute(path)).toThrow(
        "Native embed paths must target a hosted GSAV shell route.",
      );
    }
  });

  it("revalidates the branded embed path at URL construction", () => {
    const forgedPath = "/" as GsavEmbedRoute;
    expect(() => buildNativeEmbedUrl(forgedPath, "https://gsav.example")).toThrow(
      "Native embed paths must target a hosted GSAV shell route.",
    );
  });

  it("resolves the native /gsav alias path into an embedded watch URL with start time", () => {
    const watchPath = buildGsavScreenWatchPath("test", { explicitStartTime: "2.5" });

    expect(watchPath).toBe("/watch/test?t=2.5");
    expect(buildNativeEmbedUrl(watchPath, "https://gsav.example")).toBe(
      "https://gsav.example/watch/test?t=2.5&embed=native",
    );
  });

  it("uses explicit start time before stored resume time", () => {
    expect(buildGsavScreenWatchPath("test", { explicitStartTime: "2.5", storedStart: 19.8 })).toBe(
      "/watch/test?t=2.5",
    );
    expect(buildGsavScreenWatchPath("test", { storedStart: 19.8 })).toBe("/watch/test?t=19");
  });

  it("keeps missing scene ids out of the fixture fallback path", () => {
    expect(resolveGsavScreenRouteParams({})).toEqual({ ok: false, reason: "missing-scene-id" });
    expect(resolveGsavScreenRouteParams({ id: "" })).toEqual({ ok: false, reason: "missing-scene-id" });
    expect(resolveGsavScreenRouteParams({ id: "   " })).toEqual({ ok: false, reason: "missing-scene-id" });
    expect(resolveGsavScreenRouteParams({ id: [] })).toEqual({ ok: false, reason: "missing-scene-id" });
  });

  it("preserves valid scene ids and optional playback params", () => {
    expect(resolveGsavScreenRouteParams({
      id: ["test", "ignored"],
      t: ["2.5"],
      share: "share-token",
    })).toEqual({
      ok: true,
      sceneId: "test",
      startTime: "2.5",
      share: "share-token",
    });
  });
});

describe("GSAV bridge parsing", () => {
  it("parses valid bridge messages", () => {
    expect(parseBridgeMessage('{"type":"GSAV_READY","payload":{"videoId":"test","title":"Test"}}')).toEqual({
      type: "GSAV_READY",
      payload: { videoId: "test", title: "Test" },
    });
  });

  it("keeps unknown typed messages for forward compatibility", () => {
    expect(parseBridgeMessage('{"type":"GSAV_ROUTE_CHANGE","payload":{"path":"/watch/test"}}')).toEqual({
      type: "GSAV_ROUTE_CHANGE",
      payload: { path: "/watch/test" },
    });
  });

  it("parses playback state messages", () => {
    expect(parseBridgeMessage('{"type":"GSAV_PLAYBACK_STATE","payload":{"videoId":"test","state":"playing","playing":true}}')).toEqual({
      type: "GSAV_PLAYBACK_STATE",
      payload: { videoId: "test", state: "playing", playing: true },
    });
  });

  it("parses bridge version messages", () => {
    expect(parseBridgeMessage('{"type":"GSAV_BRIDGE_READY","payload":{"version":1,"minVersion":1,"commands":["loadScene"],"events":["GSAV_READY"]}}')).toEqual({
      type: "GSAV_BRIDGE_READY",
      payload: {
        version: 1,
        minVersion: 1,
        commands: ["loadScene"],
        events: ["GSAV_READY"],
      },
    });
  });

  it("rejects malformed or untyped messages", () => {
    expect(parseBridgeMessage("{")).toBeNull();
    expect(parseBridgeMessage("{}")).toBeNull();
    expect(parseBridgeMessage("null")).toBeNull();
  });
});

describe("GSAV bridge status labels", () => {
  it("labels coarse playback states", () => {
    expect(getBridgeStatusLabel({
      type: "GSAV_BRIDGE_READY",
      payload: { version: 1, minVersion: 1, commands: [], events: [] },
    })).toBe("Bridge v1");
    expect(getBridgeStatusLabel({ type: "GSAV_READY", payload: { videoId: "test", title: "Test" } })).toBe("Ready");
    expect(getBridgeStatusLabel({ type: "GSAV_FIRST_FRAME", payload: { videoId: "test", firstFrameMs: 120 } })).toBe("First frame");
    expect(getBridgeStatusLabel({ type: "GSAV_PLAY", payload: { videoId: "test" } })).toBe("Playing");
    expect(getBridgeStatusLabel({ type: "GSAV_PAUSE", payload: { videoId: "test" } })).toBe("Paused");
    expect(getBridgeStatusLabel({ type: "GSAV_ENDED", payload: { videoId: "test" } })).toBe("Ended");
    expect(getBridgeStatusLabel({
      type: "GSAV_PLAYBACK_STATE",
      payload: { videoId: "test", state: "paused", playing: false },
    })).toBe("Paused");
  });

  it("does not surface noisy progress and frame events in the native header", () => {
    expect(getBridgeStatusLabel({ type: "GSAV_PROGRESS", payload: { videoId: "test", fraction: 0.5, percent: 50 } })).toBeNull();
    expect(getBridgeStatusLabel({
      type: "GSAV_FRAME",
      payload: { videoId: "test", currentTime: 1, duration: 2, frameIndex: 1, totalFrames: 2 },
    })).toBeNull();
  });
});

describe("GSAV native command script", () => {
  it("uses the package-owned native command envelope", () => {
    expect(GSAV_NATIVE_BRIDGE_VERSION).toBe(1);
    expect(buildNativeCommandMessage({ command: "play", videoId: "test" })).toEqual({
      type: "GSAV_COMMAND",
      bridgeVersion: 1,
      payload: { command: "play", videoId: "test" },
    });
  });

  it("builds the web bridge command envelope expected by gsavjs", () => {
    const script = buildNativeCommandScript({
      command: "loadScene",
      videoId: "unlisted-scene",
      startTime: 4,
      share: "share-token_123",
    });

    expect(script).toContain("window.__GSAV_NATIVE_BRIDGE__?.handleCommand");
    expect(script).toContain('\\"bridgeVersion\\":1');
    expect(script).toContain('\\"command\\":\\"loadScene\\"');
    expect(script).toContain('\\"videoId\\":\\"unlisted-scene\\"');
    expect(script).toContain('\\"startTime\\":4');
    expect(script).toContain('\\"share\\":\\"share-token_123\\"');
    expect(script).toContain("true;");
  });
});

describe("GSAV session bridge auth-init gate", () => {
  it("does not emit a transient clear-session before auth initialization", () => {
    expect(buildSessionBridgeMessageForAuthState(false, null)).toBeNull();
    expect(buildSessionBridgeScriptForAuthState(false, null)).toBeNull();
  });

  it("emits clear-session only after auth initialization has completed", () => {
    expect(buildSessionBridgeMessageForAuthState(true, null)).toEqual({
      type: "GSAV_CLEAR_SESSION",
      bridgeVersion: 1,
    });
    expect(buildSessionBridgeScriptForAuthState(true, null)).toContain('\\"type\\":\\"GSAV_CLEAR_SESSION\\"');
  });

  it("emits set-session after auth initialization with tokens", () => {
    const tokens = { accessToken: "access", refreshToken: "refresh" };

    expect(buildSessionBridgeMessageForAuthState(true, tokens)).toEqual({
      type: "GSAV_SET_SESSION",
      bridgeVersion: 1,
      payload: tokens,
    });
  });
});

describe("GSAV session bridge host side effects", () => {
  it("does not inject a native session script before auth initialization", () => {
    const injectJavaScript = vi.fn();

    expect(injectSessionBridgeScriptForAuthState(injectJavaScript, false, null)).toBe(false);
    expect(injectJavaScript).not.toHaveBeenCalled();
  });

  it("injects a clear-session script only after auth initialization", () => {
    const injectJavaScript = vi.fn();

    expect(injectSessionBridgeScriptForAuthState(injectJavaScript, true, null)).toBe(true);
    expect(injectJavaScript).toHaveBeenCalledTimes(1);
    expect(injectJavaScript.mock.calls[0][0]).toContain('\\"type\\":\\"GSAV_CLEAR_SESSION\\"');
  });

  it("does not post an iframe session message before auth initialization", () => {
    const target = { postMessage: vi.fn() };

    expect(postSessionBridgeMessageForAuthState(target, "https://gsav.example", false, null)).toBe(false);
    expect(target.postMessage).not.toHaveBeenCalled();
  });

  it("posts an iframe session message only when target, origin, and auth state are ready", () => {
    const target = { postMessage: vi.fn() };
    const tokens = { accessToken: "access", refreshToken: "refresh" };

    expect(postSessionBridgeMessageForAuthState(null, "https://gsav.example", true, tokens)).toBe(false);
    expect(postSessionBridgeMessageForAuthState(target, "", true, tokens)).toBe(false);
    expect(postSessionBridgeMessageForAuthState(target, "https://gsav.example", true, tokens)).toBe(true);

    expect(target.postMessage).toHaveBeenCalledTimes(1);
    expect(target.postMessage).toHaveBeenCalledWith(
      {
        type: "GSAV_SET_SESSION",
        bridgeVersion: 1,
        payload: tokens,
      },
      "https://gsav.example",
    );
  });
});

describe("GSAV WebView session bridge callers", () => {
  it("keeps native WebView injection on the auth-state-aware host helper", () => {
    const source = readFileSync(join(playerDir, "useGsavEmbedHost.ts"), "utf8");

    expect(source).toContain("injectSessionBridgeScriptForAuthState");
    expect(source).not.toContain("buildSessionBridgeScriptForAuthState");
    expect(source).not.toContain("buildSessionBridgeScript(");
  });

  it("keeps Expo web iframe posting on the auth-state-aware host helper", () => {
    const source = readFileSync(join(playerDir, "GsavWebView.web.tsx"), "utf8");

    expect(source).toContain("postSessionBridgeMessageForAuthState");
    expect(source).not.toContain("buildSessionBridgeMessageForAuthState");
    expect(source).not.toContain("buildSessionBridgeMessage(");
  });
});

describe("GSAV WebView navigation gate caller", () => {
  it("keeps native WebView navigation on the centralized decision helper", () => {
    const controllerSource = readFileSync(join(playerDir, "useGsavEmbedHost.ts"), "utf8");
    const navigationRequestSource = readFileSync(join(playerDir, "gsavEmbedNavigationRequest.ts"), "utf8");
    const viewSource = readFileSync(join(playerDir, "GsavWebView.tsx"), "utf8");

    expect(controllerSource).toContain("handleGsavEmbedNavigationRequest");
    expect(navigationRequestSource).toContain("getNativeWebViewNavigationDecision");
    expect(navigationRequestSource).toContain("getNativeWebViewBlockedNavigationMessage");
    expect(navigationRequestSource).toContain("setBlockedNavigationMessage");
    expect(viewSource).toContain("Navigation blocked");
    expect(navigationRequestSource).not.toContain("isAllowedGsavNavigation(request.url");
    expect(viewSource).not.toContain("getNativeWebViewNavigationDecision");
  });
});

describe("GSAV diagnostics QA controls", () => {
  it("keeps diagnostics QA controls behind an explicit env flag", () => {
    expect(nativeQaControlsEnabled({ EXPO_PUBLIC_GSAV_QA_CONTROLS: "1" })).toBe(true);
    expect(nativeQaControlsEnabled({ EXPO_PUBLIC_GSAV_QA_CONTROLS: "0" })).toBe(false);
    expect(nativeQaControlsEnabled({})).toBe(false);
  });

  it("defines named diagnostics controls for negative validation triggers", () => {
    expect(NATIVE_QA_CONTROLS.map((control) => control.id)).toEqual([
      "same-origin-product-path",
      "cross-origin-navigation",
      "unsupported-renderer",
      "ended-playback",
    ]);
    expect(NATIVE_QA_CONTROLS[0].script).toContain(QA_SAME_ORIGIN_PRODUCT_PATH);
    expect(NATIVE_QA_CONTROLS[0].expectedSignal).toContain("Navigation blocked");
    expect(NATIVE_QA_CONTROLS[1].script).toContain(QA_CROSS_ORIGIN_TARGET);
    expect(NATIVE_QA_CONTROLS[2].script).toContain("GSAV_CAPABILITIES");
    expect(NATIVE_QA_CONTROLS[2].script).toContain("QA unsupported renderer");
    expect(NATIVE_QA_CONTROLS[3].script).toContain("GSAV_ENDED");
  });

  it("wires diagnostics controls only through the diagnostics screen", () => {
    const source = readFileSync(join(playerDir, "GsavDiagnosticsScreen.tsx"), "utf8");

    expect(source).toContain("nativeQaControlsEnabled");
    expect(source).toContain("NATIVE_QA_CONTROLS");
    expect(source).toContain("qaControls=");
  });
});

describe("GSAV WebView load-state caller", () => {
  it("keeps native WebView loading, error, and retry state on the reducer", () => {
    const source = readFileSync(join(playerDir, "useGsavEmbedHost.ts"), "utf8");

    expect(source).toContain("reduceNativeWebViewLoadState");
    expect(source).toContain("dispatchLoadState({ type: \"retry\" })");
    expect(source).not.toContain("setLoadError(");
    expect(source).not.toContain("setLoading(");
    expect(source).not.toContain("setLoadKey(");
  });
});

describe("GSAV WebView bridge-overlay caller", () => {
  it("keeps native WebView bridge errors on the bridge-overlay reducer", () => {
    const source = readFileSync(join(playerDir, "useGsavEmbedHost.ts"), "utf8");

    expect(source).toContain("reduceNativeBridgeOverlayState");
    expect(source).toContain("dispatchBridgeOverlay({ type: \"message\"");
    expect(source).toContain("bridgeOverlayState.bridgeError");
  });

  it("keeps the native WebView component as the presenter for the controller", () => {
    const source = readFileSync(join(playerDir, "GsavWebView.tsx"), "utf8");

    expect(source).toContain("useGsavEmbedHost");
    expect(source).toContain("onMessage={host.handleMessage}");
    expect(source).toContain("onShouldStartLoadWithRequest={host.handleShouldStartLoadWithRequest}");
    expect(source).not.toContain("BackHandler");
    expect(source).not.toContain("Linking.openURL");
    expect(source).not.toContain("reduceNativeWebViewLoadState");
    expect(source).not.toContain("reduceNativeBridgeOverlayState");
  });
});

describe("GSAV native WebView bridge message routing", () => {
  it("ignores messages reported from an untrusted page origin", () => {
    const applySession = vi.fn();
    const captureProgress = vi.fn();

    const result = handleNativeWebViewBridgeMessage({
      allowedOrigin: "https://gsav.example",
      applySession,
      captureProgress,
      data: JSON.stringify({ type: "GSAV_ENDED", payload: { videoId: "test" } }),
      pageUrl: "https://evil.example/watch/test",
    });

    expect(result).toBe("ignored-untrusted-origin");
    expect(applySession).not.toHaveBeenCalled();
    expect(captureProgress).not.toHaveBeenCalled();
  });

  it("applies the session on trusted GSAV_AUTH_READY without treating it as progress", () => {
    const applySession = vi.fn();
    const captureProgress = vi.fn();

    const result = handleNativeWebViewBridgeMessage({
      allowedOrigin: "https://gsav.example",
      applySession,
      captureProgress,
      data: JSON.stringify({ type: "GSAV_AUTH_READY" }),
      pageUrl: "https://gsav.example/native-diagnostics?embed=native",
    });

    expect(result).toBe("session-applied");
    expect(applySession).toHaveBeenCalledTimes(1);
    expect(captureProgress).not.toHaveBeenCalled();
  });

  it("routes trusted GSAV_ENDED through the native progress clearer", () => {
    const tracker: ProgressBridgeTracker = { lastFrameSaveAt: 0 };
    const clearProgress = vi.fn();
    const saveProgress = vi.fn();

    const result = handleNativeWebViewBridgeMessage({
      allowedOrigin: "https://gsav.example",
      applySession: vi.fn(),
      captureProgress: (data) => handleProgressBridgeMessage(data, tracker, { clearProgress, saveProgress }),
      data: JSON.stringify({ type: "GSAV_ENDED", payload: { videoId: "test" } }),
      pageUrl: "https://gsav.example/watch/test?embed=native",
    });

    expect(result).toBe("cleared");
    expect(clearProgress).toHaveBeenCalledWith("test");
    expect(saveProgress).not.toHaveBeenCalled();
  });

  it("accepts missing platform page URLs only when an allowed origin is configured", () => {
    const captureProgress = vi.fn(() => "ignored" as const);

    expect(handleNativeWebViewBridgeMessage({
      allowedOrigin: "https://gsav.example",
      applySession: vi.fn(),
      captureProgress,
      data: JSON.stringify({ type: "GSAV_PROGRESS", payload: { videoId: "test" } }),
      pageUrl: "",
    })).toBe("ignored");

    expect(handleNativeWebViewBridgeMessage({
      allowedOrigin: "",
      applySession: vi.fn(),
      captureProgress,
      data: JSON.stringify({ type: "GSAV_PROGRESS", payload: { videoId: "test" } }),
      pageUrl: "",
    })).toBe("ignored-untrusted-origin");
  });
});

describe("GSAV playback snapshot", () => {
  it("tracks bridge version metadata", () => {
    const snapshot = updatePlaybackSnapshot({}, {
      type: "GSAV_BRIDGE_READY",
      payload: { version: 1, minVersion: 1, commands: ["loadScene"], events: ["GSAV_READY"] },
    });

    expect(snapshot).toMatchObject({
      bridgeVersion: 1,
      lastEvent: "GSAV_BRIDGE_READY",
    });
  });

  it("captures ready, renderer, progress, frame, and first-frame data", () => {
    let snapshot = updatePlaybackSnapshot({}, {
      type: "GSAV_READY",
      payload: { videoId: "test", title: "Test Scene", renderer: "webgpu" },
    });

    snapshot = updatePlaybackSnapshot(snapshot, {
      type: "GSAV_PROGRESS",
      payload: { videoId: "test", fraction: 0.4, percent: 40 },
    });

    snapshot = updatePlaybackSnapshot(snapshot, {
      type: "GSAV_FIRST_FRAME",
      payload: {
        videoId: "test",
        currentTime: 1.25,
        duration: 4,
        frameIndex: 12,
        totalFrames: 40,
        firstFrameMs: 180,
      },
    });

    expect(snapshot).toEqual({
      videoId: "test",
      title: "Test Scene",
      renderer: "webgpu",
      state: "paused",
      progressPercent: 40,
      currentTime: 1.25,
      duration: 4,
      frameIndex: 12,
      totalFrames: 40,
      firstFrameMs: 180,
      lastError: undefined,
      lastEvent: "GSAV_FIRST_FRAME",
    });
  });

  it("tracks coarse playback state and errors", () => {
    let snapshot = updatePlaybackSnapshot({}, {
      type: "GSAV_PLAY",
      payload: { videoId: "elly" },
    });

    snapshot = updatePlaybackSnapshot(snapshot, {
      type: "GSAV_PLAYBACK_STATE",
      payload: { videoId: "elly", state: "paused", playing: false, currentTime: 2, duration: 8 },
    });

    snapshot = updatePlaybackSnapshot(snapshot, {
      type: "GSAV_ERROR",
      payload: { videoId: "elly", message: "Decoder unavailable" },
    });

    expect(snapshot).toMatchObject({
      videoId: "elly",
      state: "paused",
      currentTime: 2,
      duration: 8,
      lastError: "Decoder unavailable",
      lastEvent: "GSAV_ERROR",
    });
  });
});

describe("GSAV capability helpers", () => {
  it("formats supported renderer labels", () => {
    expect(getCapabilityLabel({ supported: true, renderer: "webgpu" })).toBe("WebGPU");
    expect(getCapabilityLabel({ supported: true, renderer: "webgl2" })).toBe("WebGL2");
    expect(getCapabilityLabel({ supported: true })).toBe("Unknown");
  });

  it("formats unsupported capability labels and reasons", () => {
    expect(getCapabilityLabel({ supported: false, renderer: "webgpu" })).toBe("Unsupported");
    expect(getUnsupportedReason({ reasons: [false, "WebGPU unavailable"] })).toBe("WebGPU unavailable");
    expect(getUnsupportedReason({ reasons: [false] })).toBeUndefined();
  });
});

describe("firstParam", () => {
  it("returns the value for a plain string", () => {
    expect(firstParam("elly")).toBe("elly");
  });

  it("returns the first element of an array", () => {
    expect(firstParam(["a", "b"])).toBe("a");
  });

  it("returns undefined for undefined input", () => {
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe("isAllowedGsavNavigation (WebView nav gate)", () => {
  const allowed = "https://gsav.example";

  it("allows same-origin embedded GSAV shell routes", () => {
    expect(isAllowedGsavNavigation("https://gsav.example/watch/x?embed=native", allowed)).toBe(true);
    expect(isAllowedGsavNavigation("https://gsav.example/watch/x?t=2.5&embed=native", allowed)).toBe(true);
    expect(isAllowedGsavNavigation("https://gsav.example/explore?embed=native&dataSaver=1", allowed)).toBe(true);
    expect(isAllowedGsavNavigation("https://gsav.example/native-diagnostics?embed=native", allowed)).toBe(true);
  });

  it("requires one native embed marker for every allowed hosted route", () => {
    for (const url of [
      "https://gsav.example/watch/x",
      "https://gsav.example/watch/x?embed=web",
      "https://gsav.example/watch/x?embed=native&embed=web",
      "https://gsav.example/watch/x?embed=web&embed=native",
      "https://gsav.example/explore?dataSaver=1",
      "https://gsav.example/native-diagnostics",
    ]) {
      expect(isAllowedGsavNavigation(url, allowed)).toBe(false);
    }
  });

  it("keeps native alias routes out of the hosted allowlist", () => {
    expect(isAllowedGsavNavigation("https://gsav.example/gsav/x?embed=native", allowed)).toBe(false);
    expect(isAllowedGsavNavigation("https://gsav.example/gsav-diagnostics?embed=native", allowed)).toBe(false);
  });

  it("blocks same-origin hosted routes that are not embedded player routes", () => {
    for (const url of [
      "https://gsav.example/",
      "https://gsav.example/?embed=native",
      "https://gsav.example/creator/elly",
      "https://gsav.example/creator/elly?embed=native",
      "https://gsav.example/creators",
      "https://gsav.example/account/settings",
      "https://gsav.example/studio",
      "https://gsav.example/upload",
      "https://gsav.example/watch",
      "https://gsav.example/watch/x/extra?embed=native",
      "https://gsav.example/watchlist",
      "https://gsav.example/explore-preview",
      "https://gsav.example/explore/extra?embed=native",
      "https://gsav.example/native-diagnostics/extra?embed=native",
    ]) {
      expect(isAllowedGsavNavigation(url, allowed)).toBe(false);
    }
  });

  it("blocks cross-origin and scheme-mismatched http(s)", () => {
    expect(isAllowedGsavNavigation("https://evil.example/x", allowed)).toBe(false);
    expect(isAllowedGsavNavigation("http://gsav.example/x", allowed)).toBe(false);
  });

  it("blocks non-origin schemes (about/javascript/tel/mailto)", () => {
    for (const u of ["about:blank", "javascript:alert(1)", "tel:123", "mailto:a@b.c"]) {
      expect(isAllowedGsavNavigation(u, allowed)).toBe(false);
    }
  });

  it("blocks malformed URLs and fails closed with no allowed origin", () => {
    expect(isAllowedGsavNavigation("not a url", allowed)).toBe(false);
    expect(isAllowedGsavNavigation("https://gsav.example/watch/x", "")).toBe(false);
  });
});

describe("native WebView navigation decisions", () => {
  const allowed = "https://gsav.example";

  it("allows same-origin GSAV routes to stay inside the WebView", () => {
    expect(getNativeWebViewNavigationDecision("https://gsav.example/watch/x?embed=native", allowed)).toEqual({
      allowWebViewNavigation: true,
      externalUrl: null,
      reason: "allowed-gsav-route",
    });
  });

  it("blocks same-origin non-player hosted routes from the WebView shell", () => {
    for (const url of [
      "https://gsav.example/",
      "https://gsav.example/creator/elly",
      "https://gsav.example/account/settings",
      "https://gsav.example/studio",
      "https://gsav.example/upload",
      "https://gsav.example/watch",
      "https://gsav.example/watch/x/extra?embed=native",
      "https://gsav.example/watchlist",
      "https://gsav.example/explore-preview",
      "https://gsav.example/explore/extra?embed=native",
      "https://gsav.example/native-diagnostics/extra?embed=native",
    ]) {
      expect(getNativeWebViewNavigationDecision(url, allowed)).toEqual({
        allowWebViewNavigation: false,
        externalUrl: null,
        reason: "blocked-same-origin-product-route",
      });
    }
  });

  it("fails closed when an allowed hosted route is missing native embed mode", () => {
    for (const url of [
      "https://gsav.example/watch/x",
      "https://gsav.example/watch/x?embed=web",
      "https://gsav.example/watch/x?embed=native&embed=web",
      "https://gsav.example/gsav/x?embed=native",
      "https://gsav.example/gsav-diagnostics?embed=native",
      "https://gsav.example/native-diagnostics",
    ]) {
      expect(getNativeWebViewNavigationDecision(url, allowed)).toEqual({
        allowWebViewNavigation: false,
        externalUrl: null,
        reason: "blocked-same-origin-product-route",
      });
    }
  });

  it("blocks external http(s) navigation from the WebView and marks it for the system browser", () => {
    expect(getNativeWebViewNavigationDecision("https://example.com/docs", allowed)).toEqual({
      allowWebViewNavigation: false,
      externalUrl: "https://example.com/docs",
      reason: "blocked-external-http",
    });
    expect(getNativeWebViewNavigationDecision("http://gsav.example/watch/x", allowed)).toEqual({
      allowWebViewNavigation: false,
      externalUrl: "http://gsav.example/watch/x",
      reason: "blocked-external-http",
    });
  });

  it("formats visible native fail-closed messages for blocked navigation", () => {
    const sameOriginDecision = getNativeWebViewNavigationDecision("https://gsav.example/creator/elly", allowed);
    expect(getNativeWebViewBlockedNavigationMessage(
      sameOriginDecision,
      "https://gsav.example/creator/elly",
    )).toBe("This GSAV page is handled by the native app shell and cannot run inside the embedded player.");

    const externalDecision = getNativeWebViewNavigationDecision("https://example.com/docs", allowed);
    expect(getNativeWebViewBlockedNavigationMessage(
      externalDecision,
      "https://example.com/docs",
    )).toBe("External navigation blocked: https://example.com/docs");

    const invalidDecision = getNativeWebViewNavigationDecision("mailto:test@example.com", allowed);
    expect(getNativeWebViewBlockedNavigationMessage(
      invalidDecision,
      "mailto:test@example.com",
    )).toBe("This link cannot be opened inside the embedded player.");

    const allowedDecision = getNativeWebViewNavigationDecision("https://gsav.example/watch/x?embed=native", allowed);
    expect(getNativeWebViewBlockedNavigationMessage(
      allowedDecision,
      "https://gsav.example/watch/x?embed=native",
    )).toBeNull();
  });

  it("fails closed for non-origin schemes, malformed URLs, and missing allowed origins", () => {
    for (const url of ["javascript:alert(1)", "about:blank", "mailto:test@example.com", "not a url"]) {
      expect(getNativeWebViewNavigationDecision(url, allowed)).toEqual({
        allowWebViewNavigation: false,
        externalUrl: null,
        reason: "blocked-invalid-or-non-http",
      });
    }
    expect(getNativeWebViewNavigationDecision("https://gsav.example/watch/x", "")).toEqual({
      allowWebViewNavigation: false,
      externalUrl: "https://gsav.example/watch/x",
      reason: "blocked-external-http",
    });
  });
});

describe("native WebView load state", () => {
  it("records offline/load errors and hides the loading overlay", () => {
    expect(
      reduceNativeWebViewLoadState(initialNativeWebViewLoadState, {
        type: "load-error",
        description: "net::ERR_CONNECTION_REFUSED",
      }),
    ).toEqual({
      loadError: "net::ERR_CONNECTION_REFUSED",
      loadKey: 0,
      loading: false,
    });
  });

  it("uses a stable fallback error message when WebView gives no description", () => {
    expect(getNativeWebViewLoadError("")).toBe("Unable to load diveo.");
    expect(getNativeWebViewLoadError(null)).toBe("Unable to load diveo.");
  });

  it("clears stale errors when loading starts again", () => {
    expect(
      reduceNativeWebViewLoadState({
        loadError: "offline",
        loadKey: 2,
        loading: false,
      }, { type: "load-start" }),
    ).toEqual({
      loadError: null,
      loadKey: 2,
      loading: true,
    });
  });

  it("increments the WebView key and clears the error on retry", () => {
    expect(
      reduceNativeWebViewLoadState({
        loadError: "offline",
        loadKey: 2,
        loading: false,
      }, { type: "retry" }),
    ).toEqual({
      loadError: null,
      loadKey: 3,
      loading: true,
    });
  });
});

describe("native WebView bridge overlay state", () => {
  it("surfaces unsupported renderer capability reasons as native errors", () => {
    expect(
      reduceNativeBridgeOverlayState(initialNativeBridgeOverlayState, {
        type: "message",
        data: JSON.stringify({
          type: "GSAV_CAPABILITIES",
          payload: { supported: false, renderer: "webgpu", reasons: ["WebGPU unavailable"] },
        }),
      }),
    ).toMatchObject({
      bridgeError: "WebGPU unavailable",
      snapshot: {
        lastEvent: "GSAV_CAPABILITIES",
        renderer: "webgpu",
      },
    });
  });

  it("uses stable default bridge error text when payload messages are not strings", () => {
    expect(
      reduceNativeBridgeOverlayState(initialNativeBridgeOverlayState, {
        type: "message",
        data: JSON.stringify({ type: "GSAV_ERROR", payload: { message: 42 } }),
      }).bridgeError,
    ).toBe("diveo playback error.");
  });

  it("clears stale bridge errors on GSAV_READY and reset", () => {
    const errored = {
      bridgeError: "Unsupported",
      snapshot: {},
    };

    expect(
      reduceNativeBridgeOverlayState(errored, {
        type: "message",
        data: JSON.stringify({ type: "GSAV_READY", payload: { videoId: "test" } }),
      }).bridgeError,
    ).toBeNull();

    expect(reduceNativeBridgeOverlayState(errored, { type: "reset" })).toEqual(initialNativeBridgeOverlayState);
  });

  it("preserves current bridge error for malformed and progress-only messages", () => {
    const errored = {
      bridgeError: "Unsupported",
      snapshot: { state: "playing" as const },
    };

    expect(reduceNativeBridgeOverlayState(errored, { type: "message", data: "{" })).toBe(errored);
    expect(
      reduceNativeBridgeOverlayState(errored, {
        type: "message",
        data: JSON.stringify({ type: "GSAV_PROGRESS", payload: { videoId: "test", percent: 40 } }),
      }).bridgeError,
    ).toBe("Unsupported");
  });
});

describe("isTrustedBridgeOrigin (message trust gate)", () => {
  const allowed = "https://gsav.example";

  it("trusts a matching origin and drops a foreign one", () => {
    expect(isTrustedBridgeOrigin("https://gsav.example", allowed)).toBe(true);
    expect(isTrustedBridgeOrigin("https://evil.example", allowed)).toBe(false);
  });

  it("trusts when the platform reports no origin (relies on the nav gate)", () => {
    expect(isTrustedBridgeOrigin("", allowed)).toBe(true);
    expect(isTrustedBridgeOrigin(undefined, allowed)).toBe(true);
    expect(isTrustedBridgeOrigin(null, allowed)).toBe(true);
  });

  it("fails closed when no allowed origin is configured", () => {
    expect(isTrustedBridgeOrigin("https://gsav.example", "")).toBe(false);
    expect(isTrustedBridgeOrigin("", "")).toBe(false);
  });
});

describe("isGsavShellRoute", () => {
  it("matches embedded GSAV player routes", () => {
    expect(isGsavShellRoute("/")).toBe(false);
    expect(isGsavShellRoute("/gsav")).toBe(false);
    expect(isGsavShellRoute("/gsav/elly")).toBe(false);
    expect(isGsavShellRoute("/gsav-diagnostics")).toBe(false);
    expect(isGsavShellRoute("/native-diagnostics")).toBe(true);
    expect(isGsavShellRoute("/native-diagnostics/extra")).toBe(false);
    expect(isGsavShellRoute("/watch")).toBe(false);
    expect(isGsavShellRoute("/watch/elly")).toBe(true);
    expect(isGsavShellRoute("/watch/elly/extra")).toBe(false);
    expect(isGsavShellRoute("/explore")).toBe(true);
    expect(isGsavShellRoute("/explore/extra")).toBe(false);
  });

  it("does not match legacy routes", () => {
    expect(isGsavShellRoute("/video/BV1")).toBe(false);
    expect(isGsavShellRoute("/search")).toBe(false);
  });

  it("does not match routes that only share a prefix", () => {
    expect(isGsavShellRoute("/watchlist")).toBe(false);
    expect(isGsavShellRoute("/explore-preview")).toBe(false);
    expect(isGsavShellRoute("/gsavish")).toBe(false);
    expect(isGsavShellRoute("/gsav-diagnostics-old")).toBe(false);
    expect(isGsavShellRoute("/native-diagnostics-old")).toBe(false);
  });
});

describe("firstParam edge cases", () => {
  it("returns undefined for an empty array", () => {
    expect(firstParam([])).toBeUndefined();
  });
});

describe("getCapabilityLabel renderer branches", () => {
  it("labels wasm and passes through unknown renderers", () => {
    expect(getCapabilityLabel({ supported: true, renderer: "wasm" })).toBe("WASM");
    expect(getCapabilityLabel({ supported: true, renderer: "Vulkan" })).toBe("Vulkan");
  });
});

describe("getBridgeStatusLabel remaining branches", () => {
  it("labels capabilities and coarse playback, ignores noise and unknowns", () => {
    expect(getBridgeStatusLabel({ type: "GSAV_CAPABILITIES", payload: { supported: true, renderer: "webgpu", reasons: [] } })).toBe("WebGPU");
    expect(getBridgeStatusLabel({ type: "GSAV_PLAYBACK_STATE", payload: { videoId: "x", state: "playing", playing: true } })).toBe("Playing");
    expect(getBridgeStatusLabel({ type: "GSAV_PLAYBACK_STATE", payload: { videoId: "x", state: "ended", playing: false } })).toBe("Ended");
    expect(getBridgeStatusLabel({ type: "SOMETHING_ELSE", payload: {} })).toBeNull();
  });
});

describe("updatePlaybackSnapshot remaining branches", () => {
  it("captures capabilities renderer", () => {
    expect(
      updatePlaybackSnapshot({}, { type: "GSAV_CAPABILITIES", payload: { supported: true, renderer: "webgl2", reasons: [] } }),
    ).toMatchObject({ renderer: "webgl2", lastEvent: "GSAV_CAPABILITIES" });
  });

  it("captures GSAV_FRAME timing without marking the first frame", () => {
    const s = updatePlaybackSnapshot({}, {
      type: "GSAV_FRAME",
      payload: { videoId: "x", currentTime: 3, duration: 9, frameIndex: 2, totalFrames: 10 },
    });
    expect(s).toMatchObject({ currentTime: 3, duration: 9, frameIndex: 2, totalFrames: 10 });
    expect(s.firstFrameMs).toBeUndefined();
  });

  it("tracks pause and ended states", () => {
    expect(updatePlaybackSnapshot({ state: "playing" }, { type: "GSAV_PAUSE", payload: { videoId: "x" } }).state).toBe("paused");
    expect(updatePlaybackSnapshot({ state: "playing" }, { type: "GSAV_ENDED", payload: { videoId: "x" } }).state).toBe("ended");
  });

  it("records the event for unknown message types without other changes", () => {
    expect(
      updatePlaybackSnapshot({ state: "playing" }, { type: "GSAV_ROUTE_CHANGE", payload: { path: "/watch/x", search: "", embed: true } }),
    ).toMatchObject({ state: "playing", lastEvent: "GSAV_ROUTE_CHANGE" });
  });
});

describe("isBridgeCompatible (version range overlap)", () => {
  it("accepts overlapping version ranges", () => {
    expect(isBridgeCompatible({ version: 1, minVersion: 1 }, 1, 1)).toBe(true);
    expect(isBridgeCompatible({ version: 2, minVersion: 1 }, 1, 1)).toBe(true); // native v1 within web [1,2]
    expect(isBridgeCompatible({ version: 3, minVersion: 1 }, 2, 1)).toBe(true); // web v3 within native [1,2]
  });

  it("rejects when web requires a newer native than this build offers", () => {
    expect(isBridgeCompatible({ version: 2, minVersion: 2 }, 1, 1)).toBe(false);
  });

  it("rejects when native requires a newer web than reported", () => {
    expect(isBridgeCompatible({ version: 1, minVersion: 1 }, 2, 2)).toBe(false);
  });

  it("treats a missing or garbled web version as incompatible", () => {
    expect(isBridgeCompatible({}, 1, 1)).toBe(false);
    expect(isBridgeCompatible({ version: "x" }, 1, 1)).toBe(false);
  });

  it("defaults web minVersion to its version when absent", () => {
    expect(isBridgeCompatible({ version: 1 }, 1, 1)).toBe(true);
  });
});

describe("getBridgeMismatchMessage", () => {
  it("names diveo and includes both versions for debugging", () => {
    const msg = getBridgeMismatchMessage({ version: 2 }, 1);
    expect(msg).toContain("diveo");
    expect(msg).toContain("v1");
    expect(msg).toContain("v2");
  });

  it("shows '?' when the web version is unreadable", () => {
    expect(getBridgeMismatchMessage({}, 1)).toContain("web v?");
  });
});

describe("reduceBridgeEvent (WebView message -> UI effects)", () => {
  it("GSAV_READY clears the error and syncs theme", () => {
    const e = reduceBridgeEvent({}, { type: "GSAV_READY", payload: { videoId: "x", title: "T" } });
    expect(e.bridgeError).toBeNull();
    expect(e.syncTheme).toBe(true);
    expect(e.capabilityLabel).toBe("Ready");
  });

  it("GSAV_ERROR surfaces the payload message, or a default for a non-string", () => {
    expect(
      reduceBridgeEvent({}, { type: "GSAV_ERROR", payload: { message: "Decoder died" } }).bridgeError,
    ).toBe("Decoder died");
    expect(
      reduceBridgeEvent({}, { type: "GSAV_ERROR", payload: { message: 42 } }).bridgeError,
    ).toBe("diveo playback error.");
  });

  it("GSAV_CAPABILITIES supported: clears error, syncs theme, labels the renderer", () => {
    const e = reduceBridgeEvent({}, {
      type: "GSAV_CAPABILITIES",
      payload: { supported: true, renderer: "webgpu", reasons: [] },
    });
    expect(e.bridgeError).toBeNull();
    expect(e.syncTheme).toBe(true);
    expect(e.capabilityLabel).toBe("WebGPU");
  });

  it("GSAV_CAPABILITIES unsupported: sets the reason, no theme sync", () => {
    const e = reduceBridgeEvent({}, {
      type: "GSAV_CAPABILITIES",
      payload: { supported: false, renderer: "webgpu", reasons: ["WebGPU unavailable"] },
    });
    expect(e.bridgeError).toBe("WebGPU unavailable");
    expect(e.syncTheme).toBe(false);
  });

  it("GSAV_BRIDGE_READY: no error when compatible, mismatch error when not", () => {
    expect(
      reduceBridgeEvent({}, {
        type: "GSAV_BRIDGE_READY",
        payload: { version: 1, minVersion: 1, commands: [], events: [] },
      }).bridgeError,
    ).toBeUndefined(); // undefined = leave the banner as-is
    const bad = reduceBridgeEvent({}, {
      type: "GSAV_BRIDGE_READY",
      payload: { version: 2, minVersion: 2, commands: [], events: [] },
    });
    expect(bad.bridgeError).toContain("version mismatch");
  });

  it("shows live 'Playing - N%' once playing, and leaves error untouched for noise events", () => {
    const e = reduceBridgeEvent(
      { state: "playing" },
      { type: "GSAV_PROGRESS", payload: { videoId: "x", fraction: 0.4, percent: 40 } },
    );
    expect(e.capabilityLabel).toBe("Playing - 40%");
    expect(e.bridgeError).toBeUndefined();
    expect(e.syncTheme).toBe(false);
  });
});
