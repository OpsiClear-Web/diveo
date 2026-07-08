import { getOrigin } from "../../shared/gsavWeb";
import { isTrustedBridgeOrigin } from "./navGate";
import { type ProgressBridgeResult } from "./progressBridge";
import { isAuthReadyMessage } from "./sessionBridge";

export type NativeWebViewBridgeMessageResult =
  | "ignored-untrusted-origin"
  | "session-applied"
  | ProgressBridgeResult;

type NativeWebViewBridgeMessageInput = {
  allowedOrigin: string;
  applySession: () => void;
  captureProgress: (data: string) => ProgressBridgeResult;
  data: string;
  pageUrl?: string | null;
};

export function handleNativeWebViewBridgeMessage({
  allowedOrigin,
  applySession,
  captureProgress,
  data,
  pageUrl,
}: NativeWebViewBridgeMessageInput): NativeWebViewBridgeMessageResult {
  const messageOrigin = pageUrl ? getOrigin(pageUrl) : "";
  if (!isTrustedBridgeOrigin(messageOrigin, allowedOrigin)) {
    return "ignored-untrusted-origin";
  }

  if (isAuthReadyMessage(data)) {
    applySession();
    return "session-applied";
  }

  return captureProgress(data);
}
