import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_ANDROID_EMULATOR_GSAV_WEB_URL,
  DEFAULT_GSAV_WEB_URL,
  getConfiguredGsavWebUrl,
  getDefaultGsavWebUrl,
  getOrigin,
} from "./gsavWeb";

describe("getOrigin", () => {
  it("returns the configured origin for valid URLs", () => {
    expect(getOrigin("https://gsav.example/watch/test")).toBe("https://gsav.example");
  });

  it("returns an empty origin for invalid URLs", () => {
    expect(getOrigin("not a url")).toBe("");
  });
});

describe("getConfiguredGsavWebUrl", () => {
  const original = process.env.EXPO_PUBLIC_GSAV_WEB_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_GSAV_WEB_URL;
    else process.env.EXPO_PUBLIC_GSAV_WEB_URL = original;
    vi.restoreAllMocks();
  });

  it("returns the configured origin when set", () => {
    process.env.EXPO_PUBLIC_GSAV_WEB_URL = "https://gsav.example";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getConfiguredGsavWebUrl()).toBe("https://gsav.example");
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null and warns for malformed configured origins", () => {
    process.env.EXPO_PUBLIC_GSAV_WEB_URL = "not a url";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getConfiguredGsavWebUrl({ isDev: true, platform: "android" })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns null and warns for non-http configured origins", () => {
    process.env.EXPO_PUBLIC_GSAV_WEB_URL = "ftp://gsav.example";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getConfiguredGsavWebUrl({ isDev: true })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("uses platform-aware development fallbacks when no host is configured", () => {
    delete process.env.EXPO_PUBLIC_GSAV_WEB_URL;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(getConfiguredGsavWebUrl({ isDev: true, platform: "android" })).toBe(DEFAULT_ANDROID_EMULATOR_GSAV_WEB_URL);
    expect(getConfiguredGsavWebUrl({ isDev: true, platform: "ios" })).toBe(DEFAULT_GSAV_WEB_URL);
    expect(getDefaultGsavWebUrl("android")).toBe("http://10.0.2.2:5191");
    expect(getDefaultGsavWebUrl("web")).toBe("http://127.0.0.1:5191");
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null and warns when unset in a non-dev build", () => {
    delete process.env.EXPO_PUBLIC_GSAV_WEB_URL;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getConfiguredGsavWebUrl()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("treats an empty string as unset and returns null in non-dev mode", () => {
    process.env.EXPO_PUBLIC_GSAV_WEB_URL = "";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getConfiguredGsavWebUrl()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
