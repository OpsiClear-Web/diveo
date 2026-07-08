import {
  getNativeWebViewBlockedNavigationMessage,
  getNativeWebViewNavigationDecision,
} from "./nativeNavigation";
import { QA_CROSS_ORIGIN_TARGET } from "./nativeQaControls";

type NativeNavigationRequestEffects = {
  openExternalUrl?: (url: string) => void;
  setBlockedNavigationMessage: (message: string | null) => void;
  setQaStatus: (message: string | null) => void;
};

export function handleGsavEmbedNavigationRequest(
  requestUrl: string,
  allowedOrigin: string,
  hasQaControls: boolean,
  effects: NativeNavigationRequestEffects,
) {
  const decision = getNativeWebViewNavigationDecision(requestUrl, allowedOrigin);
  if (decision.allowWebViewNavigation) {
    effects.setBlockedNavigationMessage(null);
    return true;
  }
  const blockedMessage = getNativeWebViewBlockedNavigationMessage(decision, requestUrl);
  effects.setBlockedNavigationMessage(blockedMessage);
  effects.setQaStatus(
    decision.reason === "blocked-external-http"
      ? `Blocked external navigation: ${requestUrl}`
      : `Blocked embedded navigation: ${requestUrl}`,
  );

  const isQaCrossOriginProbe = hasQaControls && requestUrl === QA_CROSS_ORIGIN_TARGET;
  if (decision.externalUrl && !isQaCrossOriginProbe) {
    effects.openExternalUrl?.(decision.externalUrl);
  }
  return false;
}
