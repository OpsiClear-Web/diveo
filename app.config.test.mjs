import { describe, expect, it } from "vitest";

import { resolveExpoConfig, isProductionEnv } from "./app.config.js";

// app.config.js flips android.usesCleartextTraffic=false for production builds at
// config-eval time (the in-repo half of the cleartext-off guarantee). It was only
// covered indirectly via the verifier; these assert the resolver itself.
describe("app.config isProductionEnv", () => {
  it("detects production from any of the recognized flags", () => {
    expect(isProductionEnv({ EXPO_PUBLIC_APP_ENV: "production" })).toBe(true);
    expect(isProductionEnv({ EAS_BUILD_PROFILE: "production" })).toBe(true);
    expect(isProductionEnv({ NODE_ENV: "production" })).toBe(true);
  });

  it("is false when no production flag is set", () => {
    expect(isProductionEnv({})).toBe(false);
    expect(isProductionEnv({ EXPO_PUBLIC_APP_ENV: "development" })).toBe(false);
  });
});

describe("app.config resolveExpoConfig", () => {
  it("forces usesCleartextTraffic=false in production", () => {
    const cfg = resolveExpoConfig({ EXPO_PUBLIC_APP_ENV: "production" }, {});
    expect(cfg.android.usesCleartextTraffic).toBe(false);
  });

  it("keeps cleartext enabled outside production (base app.json default)", () => {
    const cfg = resolveExpoConfig({}, {});
    expect(cfg.android.usesCleartextTraffic).toBe(true);
  });

  it("merges incoming android config over the base, cleartext still forced off in prod", () => {
    const cfg = resolveExpoConfig({ EXPO_PUBLIC_APP_ENV: "production" }, { android: { package: "com.example.x" } });
    expect(cfg.android.package).toBe("com.example.x");
    expect(cfg.android.usesCleartextTraffic).toBe(false);
  });
});
