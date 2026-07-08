import { buildSessionMessage, type GsavSessionMessage, type GsavSessionPayload } from "@opsiclear/gsav-bridge";

// The session-auth wire contract lives in @opsiclear/gsav-bridge so diveo and
// gsav-hosting cannot drift.
export { buildSessionMessage as buildSessionBridgeMessage, isAuthReadyMessage } from "@opsiclear/gsav-bridge";
export type { GsavSessionMessage, GsavSessionPayload } from "@opsiclear/gsav-bridge";

export function buildSessionBridgeMessageForAuthState(
  authInitialized: boolean,
  payload: GsavSessionPayload | null,
): GsavSessionMessage | null {
  return authInitialized ? buildSessionMessage(payload) : null;
}

/** WebView injectJavaScript payload: self-posts a session message to the page. */
export function buildSessionBridgeScript(payload: GsavSessionPayload | null): string {
  const message = JSON.stringify(buildSessionMessage(payload));
  return `(function(){try{window.postMessage(${JSON.stringify(message)}, '*');}catch(e){}})(); true;`;
}

export function buildSessionBridgeScriptForAuthState(
  authInitialized: boolean,
  payload: GsavSessionPayload | null,
): string | null {
  return authInitialized ? buildSessionBridgeScript(payload) : null;
}

type NativeScriptInjector = (script: string) => void;

export function injectSessionBridgeScriptForAuthState(
  injectJavaScript: NativeScriptInjector | null | undefined,
  authInitialized: boolean,
  payload: GsavSessionPayload | null,
): boolean {
  if (!injectJavaScript) return false;
  const script = buildSessionBridgeScriptForAuthState(authInitialized, payload);
  if (!script) return false;
  injectJavaScript(script);
  return true;
}

type SessionPostTarget = {
  postMessage: (message: GsavSessionMessage, targetOrigin: string) => void;
};

export function postSessionBridgeMessageForAuthState(
  target: SessionPostTarget | null | undefined,
  targetOrigin: string,
  authInitialized: boolean,
  payload: GsavSessionPayload | null,
): boolean {
  if (!target || !targetOrigin) return false;
  const message = buildSessionBridgeMessageForAuthState(authInitialized, payload);
  if (!message) return false;
  target.postMessage(message, targetOrigin);
  return true;
}
