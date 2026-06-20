export const DEFAULT_GSAV_WEB_URL = "http://127.0.0.1:5191";
export const GSAV_NATIVE_BRIDGE_VERSION = 1;
export const GSAV_NATIVE_BRIDGE_MIN_VERSION = 1;

export type GsavBridgeInfo = {
  version: number;
  minVersion: number;
  commands: string[];
  events: string[];
};

export type GsavBridgeMessage =
  | { type: "GSAV_BRIDGE_READY"; payload: GsavBridgeInfo }
  | { type: "GSAV_READY"; payload: { videoId: string; title: string } }
  | { type: "GSAV_ERROR"; payload: { message: string } }
  | { type: "GSAV_CAPABILITIES"; payload: { supported: boolean; renderer: string; reasons: string[] } }
  | { type: "GSAV_ROUTE_CHANGE"; payload: { path: string; search: string; embed: boolean } }
  | { type: "GSAV_PROGRESS"; payload: { videoId: string; fraction: number; percent: number } }
  | { type: "GSAV_FRAME"; payload: { videoId: string; currentTime: number; duration: number; frameIndex: number; totalFrames: number } }
  | { type: "GSAV_FIRST_FRAME"; payload: { videoId: string; firstFrameMs: number } }
  | { type: "GSAV_PLAYBACK_STATE"; payload: { videoId: string; state: "playing" | "paused" | "ended"; playing: boolean } }
  | { type: "GSAV_PLAY" | "GSAV_PAUSE" | "GSAV_ENDED" | "GSAV_DESTROY"; payload: { videoId: string } }
  | { type: string; payload?: unknown };

export type NativeGsavCommand =
  | { command: "play" | "pause" | "closeMiniPlayer"; videoId?: string }
  | { command: "seek"; seconds: number; videoId?: string }
  | { command: "loadScene"; videoId: string; startTime?: number; share?: string }
  | { command: "setTheme"; mode: "light" | "dark" }
  | { command: "setMuted"; muted: boolean; videoId?: string }
  | { command: "setFullscreenIntent"; fullscreen: boolean; videoId?: string };

export type GsavPlaybackSnapshot = {
  videoId?: string;
  title?: string;
  renderer?: string;
  state?: "playing" | "paused" | "ended";
  progressPercent?: number;
  currentTime?: number;
  duration?: number;
  frameIndex?: number;
  totalFrames?: number;
  firstFrameMs?: number;
  bridgeVersion?: number;
  lastError?: string;
  lastEvent?: string;
};

export function getConfiguredGsavWebUrl() {
  const configured = process.env.EXPO_PUBLIC_GSAV_WEB_URL;
  if (configured) return configured;
  // No origin configured: fall back to the localhost dev default. In a production
  // build this means the WebView would point at an unreachable 127.0.0.1, so warn
  // loudly instead of silently shipping a dead player. (Empty string is treated as
  // unset here, covering a misconfigured/empty build env var.)
  const isDev = typeof __DEV__ !== "undefined" && __DEV__;
  if (!isDev) {
    console.warn(
      `[gsav] EXPO_PUBLIC_GSAV_WEB_URL is not set; falling back to ${DEFAULT_GSAV_WEB_URL}. ` +
        "Production builds must set it to the real GSAV web origin.",
    );
  }
  return DEFAULT_GSAV_WEB_URL;
}

/** expo-router params may be string | string[]; take the first value. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function getOrigin(uri: string) {
  try {
    return new URL(uri).origin;
  } catch {
    return "";
  }
}

export function buildGsavWatchPath(
  sceneId: string,
  options: { startTime?: string; share?: string } = {},
) {
  const route = `/watch/${encodeURIComponent(sceneId)}`;
  const search = new URLSearchParams();
  if (options.startTime) search.set("t", options.startTime);
  if (options.share) search.set("share", options.share);
  const query = search.toString();
  return query ? `${route}?${query}` : route;
}

export function buildNativeEmbedUrl(path: string, baseUrl = getConfiguredGsavWebUrl()) {
  const base = baseUrl.replace(/\/+$/, "");
  const route = path.startsWith("/") ? path : `/${path}`;
  const separator = route.includes("?") ? "&" : "?";
  return `${base}${route}${separator}embed=native`;
}

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
  const message = JSON.stringify({
    type: "GSAV_COMMAND",
    bridgeVersion: GSAV_NATIVE_BRIDGE_VERSION,
    payload: command,
  });
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

export function updatePlaybackSnapshot(
  previous: GsavPlaybackSnapshot,
  message: GsavBridgeMessage,
): GsavPlaybackSnapshot {
  const payload = isRecord(message.payload) ? message.payload : {};
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
