const LOCAL_BACKEND_HINT =
  "In local development, run npm run dev:doctor and confirm the shared Supabase backend and Edge Functions are reachable.";

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

function shouldAppendLocalHint(message: string): boolean {
  return /failed to fetch|fetch failed|network request failed|gsav catalog \d{3}|catalog api/i.test(message);
}

export function formatGsavCatalogError(
  error: unknown,
  fallback: string,
  options: { isDev?: boolean } = {},
): string {
  const message = readErrorMessage(error, fallback);
  const isDev = options.isDev ?? process.env.NODE_ENV !== "production";
  if (!isDev || !shouldAppendLocalHint(message)) return message;
  return `${message} ${LOCAL_BACKEND_HINT}`;
}

