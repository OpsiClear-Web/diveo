import { describe, expect, it } from "vitest";

import { formatGsavCatalogError } from "./gsavErrors";

describe("formatGsavCatalogError", () => {
  it("adds a local backend reachability hint to fetch failures in development", () => {
    expect(formatGsavCatalogError(new Error("Failed to fetch"), "Fallback", { isDev: true })).toBe(
      "Failed to fetch In local development, run npm run dev:doctor and confirm the shared Supabase backend and Edge Functions are reachable.",
    );
  });

  it("adds the same hint to catalog HTTP and contract failures", () => {
    expect(formatGsavCatalogError(new Error("GSAV catalog 503"), "Fallback", { isDev: true })).toContain(
      "npm run dev:doctor",
    );
    expect(formatGsavCatalogError(new Error("Catalog API response is missing schemaVersion."), "Fallback", {
      isDev: true,
    })).toContain("Supabase backend");
  });

  it("keeps production errors short", () => {
    expect(formatGsavCatalogError(new Error("Failed to fetch"), "Fallback", { isDev: false })).toBe(
      "Failed to fetch",
    );
  });

  it("uses the fallback for unknown errors without adding unrelated hints", () => {
    expect(formatGsavCatalogError(null, "Unable to load saved scenes.", { isDev: true })).toBe(
      "Unable to load saved scenes.",
    );
  });
});

