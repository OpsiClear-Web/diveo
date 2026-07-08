import { describe, expect, it } from "vitest";

import {
  AUTH_QA_DELAY_ENV,
  MAX_AUTH_QA_DELAY_MS,
  getAuthInitializationDelayMs,
} from "./authQaDelay";

describe("auth initialization QA delay", () => {
  it("parses, disables, and caps the gated auth delay", () => {
    expect(AUTH_QA_DELAY_ENV).toBe("EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS");
    expect(getAuthInitializationDelayMs({ EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "2500" })).toBe(2500);
    expect(getAuthInitializationDelayMs({ EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "2500.8" })).toBe(2500);
    expect(getAuthInitializationDelayMs({ EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "0" })).toBe(0);
    expect(getAuthInitializationDelayMs({ EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "-1" })).toBe(0);
    expect(getAuthInitializationDelayMs({ EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "not-a-number" })).toBe(0);
    expect(getAuthInitializationDelayMs({ EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "999999" })).toBe(MAX_AUTH_QA_DELAY_MS);
    expect(getAuthInitializationDelayMs({})).toBe(0);
  });
});
