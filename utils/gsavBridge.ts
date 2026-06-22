export const DEFAULT_GSAV_WEB_URL = "http://127.0.0.1:5191";
export const GSAV_NATIVE_BRIDGE_VERSION = 1;
export const GSAV_NATIVE_BRIDGE_MIN_VERSION = 1;

// diveo accent — neutral silver, matching the gsav-hosting web app (content-first,
// no brand hue), with its 12% tint and a near-black contrast for text/icons placed
// ON a solid accent surface.
export const GSAV_ACCENT = "#bdbdbd";
export const GSAV_ACCENT_TINT = "rgba(189, 189, 189, 0.12)";
export const GSAV_ACCENT_CONTRAST = "#050505";

/** Routes that render the full-screen GSAV WebView shell (mini-players hidden). */
export function isGsavShellRoute(pathname: string): boolean {
  // World A: the root home is also a GSAV WebView, so suppress the legacy
  // mini-players there too. Root must match exactly (every path starts with "/").
  return pathname === "/" || pathname.startsWith("/gsav") || pathname.startsWith("/watch");
}

export type GsavBridgeInfo = {
  version: number;
  minVersion: number;
  commands: string[];
  events: string[];
};

export type GsavBridgeMessage =
  | { type: "GSAV_BRIDGE_READY"; payload: GsavBridgeInfo }
  | { type: "GSAV_READY"; payload: { videoId: string; title: string; renderer?: string } }
  | { type: "GSAV_ERROR"; payload: { message: string } }
  | { type: "GSAV_CAPABILITIES"; payload: { supported: boolean; renderer: string; reasons: string[] } }
  | { type: "GSAV_ROUTE_CHANGE"; payload: { path: string; search: string; embed: boolean } }
  | { type: "GSAV_PROGRESS"; payload: { videoId: string; fraction: number; percent: number } }
  | { type: "GSAV_FRAME"; payload: { videoId: string; currentTime: number; duration: number; frameIndex: number; totalFrames: number } }
  | { type: "GSAV_FIRST_FRAME"; payload: { videoId: string; currentTime?: number; duration?: number; frameIndex?: number; totalFrames?: number; firstFrameMs: number } }
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

/**
 * Resolve the GSAV web origin for this build.
 * - Configured (non-empty env)        -> that origin.
 * - Dev with nothing set              -> the localhost default (dev convenience).
 * - Production with nothing set       -> `null`.
 *
 * We deliberately do NOT fall back to localhost in a release build: a 127.0.0.1
 * player is a dead player, so the shell must fail loud (render a "not configured"
 * state) rather than silently ship it. (Empty string is treated as unset, covering
 * a misconfigured/empty build env var.)
 */
export function getConfiguredGsavWebUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_GSAV_WEB_URL;
  if (configured && configured.trim() !== "") return configured;
  const isDev = typeof __DEV__ !== "undefined" && __DEV__;
  if (isDev) return DEFAULT_GSAV_WEB_URL;
  console.warn(
    "[gsav] EXPO_PUBLIC_GSAV_WEB_URL is not set; GSAV player is unavailable in this build. " +
      "Production builds must set it to the real GSAV web origin.",
  );
  return null;
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

/**
 * Allowlist-positive navigation gate for the GSAV WebView. Returns true ONLY when
 * the request URL parses to a non-empty origin that EXACTLY matches the single
 * allowed origin. Non-origin schemes (about:, javascript:, intent:, tel:, data:,
 * malformed) and a missing allowedOrigin all fail CLOSED. Callers should open real
 * external http(s) links outside the WebView (Linking.openURL) rather than allow
 * in-shell navigation.
 *
 *   isAllowedGsavNavigation                 allowedOrigin = "https://gsav.example"
 *   ├─ "https://gsav.example/watch/x"  -> true   (exact origin match)
 *   ├─ "https://evil.example/x"        -> false  (cross-origin)
 *   ├─ "javascript:alert(1)" / "about:blank" -> false (no origin)
 *   └─ allowedOrigin === ""            -> false  (fail closed)
 */
export function isAllowedGsavNavigation(url: string, allowedOrigin: string): boolean {
  if (!allowedOrigin) return false;
  const next = getOrigin(url);
  return next !== "" && next === allowedOrigin;
}

/**
 * Trust gate for incoming bridge messages. Drops messages whose reported origin
 * does not match the allowed origin (e.g. a third-party iframe embedded in the
 * GSAV page). When the platform does not report an origin we rely on the
 * navigation gate above (the WebView can only have loaded the allowed origin).
 * A missing allowlist fails CLOSED.
 */
export function isTrustedBridgeOrigin(
  origin: string | undefined | null,
  allowedOrigin: string,
): boolean {
  if (!allowedOrigin) return false;
  if (origin == null || origin === "") return true;
  return origin === allowedOrigin;
}

export function buildGsavWatchPath(
  sceneId: string,
  options: { startTime?: string; share?: string } = {},
) {
  if (!sceneId) throw new Error("buildGsavWatchPath: sceneId must be a non-empty string");
  const route = `/watch/${encodeURIComponent(sceneId)}`;
  const search = new URLSearchParams();
  if (options.startTime) search.set("t", options.startTime);
  if (options.share) search.set("share", options.share);
  const query = search.toString();
  return query ? `${route}?${query}` : route;
}

export function buildNativeEmbedUrl(path: string, baseUrl: string) {
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

/**
 * Bridge compatibility. The native shell supports bridge versions
 * [GSAV_NATIVE_BRIDGE_MIN_VERSION, GSAV_NATIVE_BRIDGE_VERSION]; the web app reports its
 * own [minVersion, version] in GSAV_BRIDGE_READY. They are compatible only when the two
 * supported ranges overlap: web.version >= native.min AND native.version >= web.min.
 * A missing/garbled web version is treated as incompatible — we will not assume a
 * contract we can't read.
 */
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

/** User-facing message when the native and web bridge version ranges don't overlap. */
export function getBridgeMismatchMessage(
  web: { version?: unknown; minVersion?: unknown },
  nativeVersion: number = GSAV_NATIVE_BRIDGE_VERSION,
): string {
  const webVersion = readFiniteNumber(web.version);
  return `diveo player version mismatch — update the app or the diveo web app (app bridge v${nativeVersion}, web v${webVersion ?? "?"}).`;
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

export type BridgeEffect = {
  /** Accumulated playback snapshot after applying this event. */
  snapshot: GsavPlaybackSnapshot;
  /** Header label to show, or null to leave the current one unchanged. */
  capabilityLabel: string | null;
  /** undefined = leave the error banner as-is; null = clear it; string = show it. */
  bridgeError: string | null | undefined;
  /** Whether the shell should (re)push the current theme to the web app. */
  syncTheme: boolean;
};

/**
 * Pure reduction of one inbound bridge event into the UI effects the WebView shell
 * applies (snapshot update, header label, error banner, theme re-sync). Extracted from
 * the component so the message->state wiring is unit-testable without rendering React
 * Native. The component reads the returned effect and calls the matching setters.
 *
 *   message ─► updatePlaybackSnapshot ─► snapshot
 *           ─► label: live "Playing · N%" while playing, else the status label
 *           ─► per type: set/clear error · sync theme · version-compat check
 */
export function reduceBridgeEvent(
  previous: GsavPlaybackSnapshot,
  message: GsavBridgeMessage,
): BridgeEffect {
  const snapshot = updatePlaybackSnapshot(previous, message);
  const capabilityLabel =
    snapshot.state === "playing" && typeof snapshot.progressPercent === "number"
      ? `Playing · ${Math.round(snapshot.progressPercent)}%`
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
