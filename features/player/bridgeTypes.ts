export {
  buildNativeCommandMessage,
  GSAV_NATIVE_BRIDGE_MIN_VERSION,
  GSAV_NATIVE_BRIDGE_VERSION,
} from "@opsiclear/gsav-bridge";
export type {
  GsavBridgeInfo,
  GsavBridgeMessage,
  NativeGsavCommand,
} from "@opsiclear/gsav-bridge";

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

export type BridgeEffect = {
  snapshot: GsavPlaybackSnapshot;
  capabilityLabel: string | null;
  bridgeError: string | null | undefined;
  syncTheme: boolean;
};
