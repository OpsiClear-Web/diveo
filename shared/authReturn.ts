const DIRECT_AUTH_RETURN_ROUTES = new Set(["/", "/library", "/search", "/settings"]);

export type AuthReturnRoute = "/" | "/library" | "/search" | "/settings" | `/creator/${string}`;

function hasUnsafeRouteSyntax(route: string): boolean {
  return route.includes("\\") || route.includes("://") || route.startsWith("//") || /[#?]/.test(route);
}

export function safeAuthReturnTo(value: string | undefined): AuthReturnRoute | undefined {
  const route = value?.trim();
  if (!route || hasUnsafeRouteSyntax(route)) return undefined;

  if (DIRECT_AUTH_RETURN_ROUTES.has(route)) return route as AuthReturnRoute;

  const creatorMatch = /^\/creator\/([^/]+)$/.exec(route);
  const creatorHandle = creatorMatch?.[1];
  if (!creatorHandle || creatorHandle === "." || creatorHandle === "..") return undefined;

  return `/creator/${creatorHandle}`;
}

export function creatorAuthReturnTo(handle: string | undefined): AuthReturnRoute | undefined {
  const trimmed = handle?.trim();
  if (!trimmed || /[\\/#?]/.test(trimmed)) return undefined;
  return safeAuthReturnTo(`/creator/${encodeURIComponent(trimmed)}`);
}

export function createLoginHref(returnTo?: string): string {
  const safeReturnTo = safeAuthReturnTo(returnTo);
  return safeReturnTo ? `/login?returnTo=${encodeURIComponent(safeReturnTo)}` : "/login";
}
