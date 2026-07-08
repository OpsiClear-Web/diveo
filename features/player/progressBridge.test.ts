import { describe, expect, it, vi } from "vitest";

import { handleProgressBridgeMessage, type ProgressBridgeTracker } from "./progressBridge";

function json(value: unknown) {
  return JSON.stringify(value);
}

function actions() {
  return {
    clearProgress: vi.fn(),
    saveProgress: vi.fn(),
  };
}

describe("progress bridge handler", () => {
  it("ignores malformed messages and messages without a video id", () => {
    const tracker: ProgressBridgeTracker = { lastFrameSaveAt: 0 };
    const fns = actions();

    expect(handleProgressBridgeMessage("{", tracker, fns)).toBe("ignored");
    expect(handleProgressBridgeMessage(json({ type: "GSAV_FRAME", payload: {} }), tracker, fns)).toBe("ignored");

    expect(fns.saveProgress).not.toHaveBeenCalled();
    expect(fns.clearProgress).not.toHaveBeenCalled();
  });

  it("clears resume progress on GSAV_ENDED", () => {
    const tracker: ProgressBridgeTracker = { lastFrameSaveAt: 0 };
    const fns = actions();

    expect(handleProgressBridgeMessage(json({ type: "GSAV_ENDED", payload: { videoId: "test" } }), tracker, fns)).toBe("cleared");

    expect(fns.clearProgress).toHaveBeenCalledWith("test");
    expect(fns.saveProgress).not.toHaveBeenCalled();
  });

  it("saves playback-state timing immediately", () => {
    const tracker: ProgressBridgeTracker = { lastFrameSaveAt: 0 };
    const fns = actions();

    expect(
      handleProgressBridgeMessage(
        json({ type: "GSAV_PLAYBACK_STATE", payload: { videoId: "test", currentTime: 8, duration: 40 } }),
        tracker,
        { ...fns, now: () => 1000 },
      ),
    ).toBe("saved");

    expect(fns.saveProgress).toHaveBeenCalledWith("test", 8, 40);
    expect(tracker.lastFrameSaveAt).toBe(1000);
  });

  it("throttles high-frequency frame progress but saves after the interval", () => {
    const tracker: ProgressBridgeTracker = { lastFrameSaveAt: 1000 };
    const fns = actions();
    const frame = json({ type: "GSAV_FRAME", payload: { videoId: "test", currentTime: 12, duration: 40 } });

    expect(handleProgressBridgeMessage(frame, tracker, { ...fns, now: () => 3000 })).toBe("throttled");
    expect(fns.saveProgress).not.toHaveBeenCalled();
    expect(tracker.lastFrameSaveAt).toBe(1000);

    expect(handleProgressBridgeMessage(frame, tracker, { ...fns, now: () => 5000 })).toBe("saved");
    expect(fns.saveProgress).toHaveBeenCalledWith("test", 12, 40);
    expect(tracker.lastFrameSaveAt).toBe(5000);
  });
});
