import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildNativeCommandScript,
  buildNativeEmbedUrl,
  buildGsavWatchPath,
  firstParam,
  getBridgeMismatchMessage,
  getBridgeStatusLabel,
  getCapabilityLabel,
  getConfiguredGsavWebUrl,
  getOrigin,
  getUnsupportedReason,
  isAllowedGsavNavigation,
  isBridgeCompatible,
  isGsavShellRoute,
  isTrustedBridgeOrigin,
  parseBridgeMessage,
  reduceBridgeEvent,
  updatePlaybackSnapshot,
} from "./gsavBridge";

describe("GSAV WebView URL helpers", () => {
  it("builds a native embed URL from an absolute path", () => {
    expect(buildNativeEmbedUrl("/watch/test", "http://127.0.0.1:5191/")).toBe(
      "http://127.0.0.1:5191/watch/test?embed=native",
    );
  });

  it("preserves existing query params when adding native embed mode", () => {
    expect(buildNativeEmbedUrl("watch/test?t=2.5", "https://gsav.example")).toBe(
      "https://gsav.example/watch/test?t=2.5&embed=native",
    );
  });

  it("builds watch paths that preserve unlisted share tokens", () => {
    expect(buildGsavWatchPath("unlisted scene", { startTime: "2.5", share: "share-token_123" })).toBe(
      "/watch/unlisted%20scene?t=2.5&share=share-token_123",
    );
  });

  it("returns the configured origin for valid URLs", () => {
    expect(getOrigin("https://gsav.example/watch/test")).toBe("https://gsav.example");
  });

  it("returns an empty origin for invalid URLs", () => {
    expect(getOrigin("not a url")).toBe("");
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

describe("getConfiguredGsavWebUrl", () => {
  const original = process.env.EXPO_PUBLIC_GSAV_WEB_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_GSAV_WEB_URL;
    else process.env.EXPO_PUBLIC_GSAV_WEB_URL = original;
    vi.restoreAllMocks();
  });

  it("returns the configured origin when set", () => {
    process.env.EXPO_PUBLIC_GSAV_WEB_URL = "https://gsav.example";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getConfiguredGsavWebUrl()).toBe("https://gsav.example");
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null and warns when unset in a non-dev build (no localhost fallback)", () => {
    delete process.env.EXPO_PUBLIC_GSAV_WEB_URL;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // __DEV__ is undefined under vitest, so the production path runs: fail loud.
    expect(getConfiguredGsavWebUrl()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("treats an empty string as unset and returns null (non-dev)", () => {
    process.env.EXPO_PUBLIC_GSAV_WEB_URL = "";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getConfiguredGsavWebUrl()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("isAllowedGsavNavigation (WebView nav gate)", () => {
  const allowed = "https://gsav.example";

  it("allows exact same-origin navigation", () => {
    expect(isAllowedGsavNavigation("https://gsav.example/watch/x?embed=native", allowed)).toBe(true);
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
    expect(isAllowedGsavNavigation("https://gsav.example/x", "")).toBe(false);
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
  it("matches the root home, /gsav, and /watch routes", () => {
    expect(isGsavShellRoute("/")).toBe(true);
    expect(isGsavShellRoute("/gsav/elly")).toBe(true);
    expect(isGsavShellRoute("/gsav-diagnostics")).toBe(true);
    expect(isGsavShellRoute("/watch/elly")).toBe(true);
  });

  it("does not match legacy routes", () => {
    expect(isGsavShellRoute("/video/BV1")).toBe(false);
    expect(isGsavShellRoute("/search")).toBe(false);
  });
});

describe("buildGsavWatchPath edge cases", () => {
  it("builds a bare path with no options and encodes the id", () => {
    expect(buildGsavWatchPath("elly")).toBe("/watch/elly");
    expect(buildGsavWatchPath("a/b c")).toBe("/watch/a%2Fb%20c");
  });

  it("throws on an empty scene id", () => {
    expect(() => buildGsavWatchPath("")).toThrow();
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

  it("shows live 'Playing · N%' once playing, and leaves error untouched for noise events", () => {
    const e = reduceBridgeEvent(
      { state: "playing" },
      { type: "GSAV_PROGRESS", payload: { videoId: "x", fraction: 0.4, percent: 40 } },
    );
    expect(e.capabilityLabel).toBe("Playing · 40%");
    expect(e.bridgeError).toBeUndefined();
    expect(e.syncTheme).toBe(false);
  });
});
