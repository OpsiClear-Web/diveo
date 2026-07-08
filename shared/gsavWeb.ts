const DEV_LOOPBACK_HOST = ["127", "0", "0", "1"].join(".");
const DEV_ANDROID_EMULATOR_HOST = ["10", "0", "2", "2"].join(".");

export const DEFAULT_GSAV_WEB_URL = `http://${DEV_LOOPBACK_HOST}:5191`;
export const DEFAULT_ANDROID_EMULATOR_GSAV_WEB_URL = `http://${DEV_ANDROID_EMULATOR_HOST}:5191`;

type GsavWebUrlOptions = {
  isDev?: boolean;
  platform?: string;
};

export function getDefaultGsavWebUrl(platform = "web"): string {
  return platform === "android"
    ? DEFAULT_ANDROID_EMULATOR_GSAV_WEB_URL
    : DEFAULT_GSAV_WEB_URL;
}

export function getConfiguredGsavWebUrl(options: GsavWebUrlOptions = {}): string | null {
  const configured = process.env.EXPO_PUBLIC_GSAV_WEB_URL;
  if (configured && configured.trim() !== "") {
    const configuredUrl = configured.trim();
    if (isHttpUrl(configuredUrl)) return configuredUrl;
    console.warn(
      "[gsav] EXPO_PUBLIC_GSAV_WEB_URL is invalid; GSAV player is unavailable until it is set " +
        "to an http(s) GSAV web origin.",
    );
    return null;
  }
  const isDev = options.isDev ?? (typeof __DEV__ !== "undefined" && __DEV__);
  if (isDev) return getDefaultGsavWebUrl(options.platform);
  console.warn(
    "[gsav] EXPO_PUBLIC_GSAV_WEB_URL is not set; GSAV player is unavailable in this build. " +
      "Production builds must set it to the real GSAV web origin.",
  );
  return null;
}

function isHttpUrl(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function getOrigin(uri: string) {
  try {
    return new URL(uri).origin;
  } catch {
    return "";
  }
}
