import {
  GSAV_NATIVE_BRIDGE_MIN_VERSION,
  GSAV_NATIVE_BRIDGE_VERSION,
  type BridgeEffect,
  type GsavBridgeMessage,
  type GsavPlaybackSnapshot,
  type NativeGsavCommand,
  buildNativeCommandMessage,
} from "./bridgeTypes";

export function parseBridgeMessage(data: string): GsavBridgeMessage | null {
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function getCapabilityLabel(payload: { supported?: unknown; renderer?: unknown }) {
  if (payload.supported !== true) return "Unsupported";
  if (typeof payload.renderer !== "string") return "Unknown";

  const normalized = payload.renderer.toLowerCase();
  if (normalized === "webgpu") return "WebGPU";
  if (normalized === "webgl2") return "WebGL2";
  if (normalized === "wasm") return "WASM";

  return payload.renderer;
}

export function getUnsupportedReason(payload: { reasons?: unknown }) {
  const reasons = Array.isArray(payload.reasons) ? payload.reasons : [];
  return reasons.find((reason): reason is string => typeof reason === "string");
}

export function getBridgeStatusLabel(message: GsavBridgeMessage) {
  switch (message.type) {
    case "GSAV_BRIDGE_READY":
      {
        const payload = message.payload as { version?: unknown };
        return typeof payload.version === "number" ? `Bridge v${payload.version}` : "Bridge ready";
      }
    case "GSAV_READY":
      return "Ready";
    case "GSAV_CAPABILITIES":
      return getCapabilityLabel(message.payload as { supported?: unknown; renderer?: unknown });
    case "GSAV_FIRST_FRAME":
      return "First frame";
    case "GSAV_PLAY":
      return "Playing";
    case "GSAV_PAUSE":
      return "Paused";
    case "GSAV_ENDED":
      return "Ended";
    case "GSAV_PLAYBACK_STATE":
      {
        const payload = message.payload as { state?: unknown };
        if (payload.state === "playing") return "Playing";
        if (payload.state === "paused") return "Paused";
        if (payload.state === "ended") return "Ended";
      }
      return null;
    default:
      return null;
  }
}

export function buildNativeCommandScript(command: NativeGsavCommand) {
  const message = JSON.stringify(buildNativeCommandMessage(command));
  return `window.__GSAV_NATIVE_BRIDGE__?.handleCommand(${JSON.stringify(message)}); true;`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getMessagePayload(message: GsavBridgeMessage) {
  return "payload" in message && isRecord(message.payload) ? message.payload : {};
}

export function isBridgeCompatible(
  web: { version?: unknown; minVersion?: unknown },
  nativeVersion: number = GSAV_NATIVE_BRIDGE_VERSION,
  nativeMin: number = GSAV_NATIVE_BRIDGE_MIN_VERSION,
): boolean {
  const webVersion = readFiniteNumber(web.version);
  if (webVersion === undefined) return false;
  const webMin = readFiniteNumber(web.minVersion) ?? webVersion;
  return webVersion >= nativeMin && nativeVersion >= webMin;
}

export function getBridgeMismatchMessage(
  web: { version?: unknown; minVersion?: unknown },
  nativeVersion: number = GSAV_NATIVE_BRIDGE_VERSION,
): string {
  const webVersion = readFiniteNumber(web.version);
  return `diveo player version mismatch - update the app or the diveo web app (app bridge v${nativeVersion}, web v${webVersion ?? "?"}).`;
}

export function updatePlaybackSnapshot(
  previous: GsavPlaybackSnapshot,
  message: GsavBridgeMessage,
): GsavPlaybackSnapshot {
  const payload = getMessagePayload(message);
  const next: GsavPlaybackSnapshot = { ...previous, lastEvent: message.type };
  const videoId = readString(payload.videoId);

  if (videoId) next.videoId = videoId;

  switch (message.type) {
    case "GSAV_BRIDGE_READY":
      next.bridgeVersion = readFiniteNumber(payload.version) ?? next.bridgeVersion;
      return next;
    case "GSAV_READY":
      next.title = readString(payload.title) ?? next.title;
      next.renderer = readString(payload.renderer) ?? next.renderer;
      next.state = "paused";
      next.lastError = undefined;
      return next;
    case "GSAV_CAPABILITIES":
      next.renderer = readString(payload.renderer) ?? next.renderer;
      return next;
    case "GSAV_PROGRESS":
      next.progressPercent = readFiniteNumber(payload.percent) ?? next.progressPercent;
      return next;
    case "GSAV_FRAME":
    case "GSAV_FIRST_FRAME":
      next.currentTime = readFiniteNumber(payload.currentTime) ?? next.currentTime;
      next.duration = readFiniteNumber(payload.duration) ?? next.duration;
      next.frameIndex = readFiniteNumber(payload.frameIndex) ?? next.frameIndex;
      next.totalFrames = readFiniteNumber(payload.totalFrames) ?? next.totalFrames;
      if (message.type === "GSAV_FIRST_FRAME") {
        next.firstFrameMs = readFiniteNumber(payload.firstFrameMs) ?? next.firstFrameMs;
      }
      return next;
    case "GSAV_PLAYBACK_STATE":
      if (payload.state === "playing" || payload.state === "paused" || payload.state === "ended") {
        next.state = payload.state;
      }
      next.currentTime = readFiniteNumber(payload.currentTime) ?? next.currentTime;
      next.duration = readFiniteNumber(payload.duration) ?? next.duration;
      return next;
    case "GSAV_PLAY":
      next.state = "playing";
      return next;
    case "GSAV_PAUSE":
      next.state = "paused";
      return next;
    case "GSAV_ENDED":
      next.state = "ended";
      return next;
    case "GSAV_ERROR":
      next.lastError = readString(payload.message) ?? "GSAV playback error.";
      return next;
    default:
      return next;
  }
}

export function reduceBridgeEvent(
  previous: GsavPlaybackSnapshot,
  message: GsavBridgeMessage,
): BridgeEffect {
  const snapshot = updatePlaybackSnapshot(previous, message);
  const capabilityLabel =
    snapshot.state === "playing" && typeof snapshot.progressPercent === "number"
      ? `Playing - ${Math.round(snapshot.progressPercent)}%`
      : getBridgeStatusLabel(message);

  let bridgeError: string | null | undefined;
  let syncTheme = false;

  switch (message.type) {
    case "GSAV_ERROR": {
      const payload = message.payload as { message?: unknown };
      bridgeError =
        typeof payload.message === "string" ? payload.message : "diveo playback error.";
      break;
    }
    case "GSAV_READY":
      bridgeError = null;
      syncTheme = true;
      break;
    case "GSAV_CAPABILITIES": {
      const payload = message.payload as { supported?: unknown; reasons?: unknown };
      if (payload.supported !== true) {
        bridgeError =
          getUnsupportedReason(payload) ?? "diveo playback is not supported on this device.";
      } else {
        bridgeError = null;
        syncTheme = true;
      }
      break;
    }
    case "GSAV_BRIDGE_READY": {
      const payload = message.payload as { version?: unknown; minVersion?: unknown };
      if (!isBridgeCompatible(payload)) bridgeError = getBridgeMismatchMessage(payload);
      break;
    }
  }

  return { snapshot, capabilityLabel, bridgeError, syncTheme };
}
