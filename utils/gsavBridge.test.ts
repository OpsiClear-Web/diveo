import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildNativeCommandScript,
  buildNativeEmbedUrl,
  buildGsavWatchPath,
  DEFAULT_GSAV_WEB_URL,
  firstParam,
  getBridgeStatusLabel,
  getCapabilityLabel,
  getConfiguredGsavWebUrl,
  getOrigin,
  getUnsupportedReason,
  parseBridgeMessage,
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

  it("falls back to the dev default and warns loudly when unset (non-dev)", () => {
    delete process.env.EXPO_PUBLIC_GSAV_WEB_URL;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // __DEV__ is undefined under vitest, so the non-dev warning path runs.
    expect(getConfiguredGsavWebUrl()).toBe(DEFAULT_GSAV_WEB_URL);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("treats an empty string as unset and warns", () => {
    process.env.EXPO_PUBLIC_GSAV_WEB_URL = "";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getConfiguredGsavWebUrl()).toBe(DEFAULT_GSAV_WEB_URL);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
