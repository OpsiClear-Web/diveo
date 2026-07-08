import { buildGsavWatchPath } from "../../shared/gsavRoutes";
import { firstParam } from "../../shared/routeParams";

declare const gsavEmbedRouteBrand: unique symbol;

export type GsavEmbedRoute = string & { readonly [gsavEmbedRouteBrand]: true };

type GsavScreenRouteParams = {
  id?: string | string[];
  t?: string | string[];
  share?: string | string[];
};

export type GsavScreenRouteResolution =
  | {
    ok: true;
    sceneId: string;
    startTime?: string;
    share?: string;
  }
  | {
    ok: false;
    reason: "missing-scene-id";
  };

/**
 * Hosted GSAV paths that are allowed to remain inside the native shell.
 * `/gsav/:id` and `/gsav-diagnostics` are native routes; hosted embeds use
 * `/watch/:id` and `/native-diagnostics`.
 */
export function isGsavShellRoute(pathname: string): boolean {
  const segments = pathname
    .split(/[?#]/, 1)[0]
    .split("/")
    .filter(Boolean);
  const [firstSegment = "", secondSegment = ""] = segments;
  if (firstSegment === "watch") return segments.length === 2 && secondSegment.length > 0;
  return (
    segments.length === 1
    && (
      firstSegment === "explore"
      || firstSegment === "native-diagnostics"
    )
  );
}

export function makeGsavEmbedRoute(path: string): GsavEmbedRoute {
  const rawPath = path.trim();
  if (rawPath.startsWith("//")) {
    throw new Error("Native embed paths must be relative to the configured GSAV origin.");
  }
  const route = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const url = new URL(route, "https://gsav.invalid");
  if (!isGsavShellRoute(url.pathname)) {
    throw new Error("Native embed paths must target a hosted GSAV shell route.");
  }
  return `${url.pathname}${url.search}${url.hash}` as GsavEmbedRoute;
}

export const GSAV_EXPLORE_EMBED_ROUTE = makeGsavEmbedRoute("/explore");
export const GSAV_NATIVE_DIAGNOSTICS_EMBED_ROUTE = makeGsavEmbedRoute("/native-diagnostics");

export function resolveGsavScreenRouteParams(params: GsavScreenRouteParams): GsavScreenRouteResolution {
  const sceneId = firstParam(params.id);
  if (!sceneId || sceneId.trim().length === 0) {
    return { ok: false, reason: "missing-scene-id" };
  }

  return {
    ok: true,
    sceneId,
    startTime: firstParam(params.t),
    share: firstParam(params.share),
  };
}

export function buildGsavScreenWatchPath(
  sceneId: string,
  options: { explicitStartTime?: string; storedStart?: number; share?: string } = {},
): GsavEmbedRoute {
  const effectiveStart = options.explicitStartTime
    ?? ((options.storedStart ?? 0) > 0 ? String(Math.floor(options.storedStart ?? 0)) : undefined);
  return makeGsavEmbedRoute(buildGsavWatchPath(sceneId, { startTime: effectiveStart, share: options.share }));
}

export function buildNativeEmbedUrl(
  path: GsavEmbedRoute,
  baseUrl: string,
  options: { dataSaver?: boolean } = {},
) {
  const base = baseUrl.replace(/\/+$/, "");
  const route = makeGsavEmbedRoute(path);
  const url = new URL(route, `${base}/`);
  url.searchParams.set("embed", "native");
  if (options.dataSaver === true) url.searchParams.set("dataSaver", "1");
  if (options.dataSaver === false) url.searchParams.delete("dataSaver");
  return url.toString();
}
