import { parseBridgeMessage } from "./bridgeState";

export type ProgressBridgeTracker = {
  lastFrameSaveAt: number;
};

type ProgressBridgeActions = {
  clearProgress: (videoId: string) => void;
  saveProgress: (videoId: string, time: number, duration: number) => void;
  now?: () => number;
};

export type ProgressBridgeResult = "cleared" | "ignored" | "saved" | "throttled";

const FRAME_SAVE_INTERVAL_MS = 4000;

function getPayload(message: unknown) {
  if (!message || typeof message !== "object" || !("payload" in message)) return {};
  return message.payload !== null && typeof message.payload === "object"
    ? message.payload as { videoId?: unknown; currentTime?: unknown; duration?: unknown }
    : {};
}

export function handleProgressBridgeMessage(
  data: string,
  tracker: ProgressBridgeTracker,
  { clearProgress, saveProgress, now = Date.now }: ProgressBridgeActions,
): ProgressBridgeResult {
  const message = parseBridgeMessage(data);
  if (!message) return "ignored";

  const payload = getPayload(message);
  const videoId = typeof payload.videoId === "string" ? payload.videoId : undefined;
  if (!videoId) return "ignored";

  if (message.type === "GSAV_ENDED") {
    clearProgress(videoId);
    return "cleared";
  }

  if (message.type !== "GSAV_FRAME" && message.type !== "GSAV_PLAYBACK_STATE") {
    return "ignored";
  }

  const time = typeof payload.currentTime === "number" ? payload.currentTime : undefined;
  const duration = typeof payload.duration === "number" ? payload.duration : undefined;
  if (time === undefined || duration === undefined) return "ignored";

  const currentTimeMs = now();
  if (message.type === "GSAV_FRAME" && currentTimeMs - tracker.lastFrameSaveAt < FRAME_SAVE_INTERVAL_MS) {
    return "throttled";
  }

  tracker.lastFrameSaveAt = currentTimeMs;
  saveProgress(videoId, time, duration);
  return "saved";
}
