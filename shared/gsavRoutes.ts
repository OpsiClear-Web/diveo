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
