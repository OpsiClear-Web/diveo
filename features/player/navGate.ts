import { isGsavShellRoute } from "./routes";

/**
 * Allowlist-positive navigation gate for the embedded GSAV WebView.
 * Only same-origin embedded GSAV shell routes are allowed inside the shell.
 */
export function isAllowedGsavNavigation(url: string, allowedOrigin: string): boolean {
  if (!allowedOrigin) return false;
  try {
    const next = new URL(url);
    return next.origin === allowedOrigin
      && next.searchParams.getAll("embed").length === 1
      && next.searchParams.get("embed") === "native"
      && isGsavShellRoute(`${next.pathname}${next.search}`);
  } catch {
    return false;
  }
}

/**
 * Trust gate for incoming bridge messages. A missing platform-reported origin is
 * accepted only because the WebView navigation gate restricts loaded origins.
 */
export function isTrustedBridgeOrigin(
  origin: string | undefined | null,
  allowedOrigin: string,
): boolean {
  if (!allowedOrigin) return false;
  if (origin == null || origin === "") return true;
  return origin === allowedOrigin;
}
