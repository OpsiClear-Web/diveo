import { getOrigin } from "../../shared/gsavWeb";
import { isAllowedGsavNavigation } from "./navGate";

export type NativeWebViewNavigationDecision = {
  allowWebViewNavigation: boolean;
  externalUrl: string | null;
  reason:
    | "allowed-gsav-route"
    | "blocked-same-origin-product-route"
    | "blocked-external-http"
    | "blocked-invalid-or-non-http";
};

export function getNativeWebViewNavigationDecision(
  url: string,
  allowedOrigin: string,
): NativeWebViewNavigationDecision {
  if (isAllowedGsavNavigation(url, allowedOrigin)) {
    return {
      allowWebViewNavigation: true,
      externalUrl: null,
      reason: "allowed-gsav-route",
    };
  }

  const origin = getOrigin(url);
  if (allowedOrigin && origin === allowedOrigin) {
    return {
      allowWebViewNavigation: false,
      externalUrl: null,
      reason: "blocked-same-origin-product-route",
    };
  }

  if (/^https?:/i.test(url) && origin !== "") {
    return {
      allowWebViewNavigation: false,
      externalUrl: url,
      reason: "blocked-external-http",
    };
  }

  return {
    allowWebViewNavigation: false,
    externalUrl: null,
    reason: "blocked-invalid-or-non-http",
  };
}

export function getNativeWebViewBlockedNavigationMessage(
  decision: NativeWebViewNavigationDecision,
  url: string,
): string | null {
  if (decision.allowWebViewNavigation) return null;
  if (decision.reason === "blocked-same-origin-product-route") {
    return "This GSAV page is handled by the native app shell and cannot run inside the embedded player.";
  }
  if (decision.reason === "blocked-external-http") {
    return `External navigation blocked: ${url}`;
  }
  return "This link cannot be opened inside the embedded player.";
}
