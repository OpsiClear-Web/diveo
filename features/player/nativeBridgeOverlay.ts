import { type GsavPlaybackSnapshot } from "./bridgeTypes";
import { parseBridgeMessage, reduceBridgeEvent } from "./bridgeState";

export type NativeBridgeOverlayState = {
  bridgeError: string | null;
  snapshot: GsavPlaybackSnapshot;
};

export type NativeBridgeOverlayAction =
  | { type: "message"; data: string }
  | { type: "reset" };

export const initialNativeBridgeOverlayState: NativeBridgeOverlayState = {
  bridgeError: null,
  snapshot: {},
};

export function reduceNativeBridgeOverlayState(
  state: NativeBridgeOverlayState,
  action: NativeBridgeOverlayAction,
): NativeBridgeOverlayState {
  if (action.type === "reset") return initialNativeBridgeOverlayState;

  const message = parseBridgeMessage(action.data);
  if (!message) return state;

  const effect = reduceBridgeEvent(state.snapshot, message);
  return {
    snapshot: effect.snapshot,
    bridgeError: effect.bridgeError === undefined ? state.bridgeError : effect.bridgeError,
  };
}
