import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readSource(relativePath: string) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("native screen shared UI source contracts", () => {
  it("keeps header and center-state primitives exported from shared UI", () => {
    const source = readSource("shared/ui/NativeScreen.tsx");
    const barrel = readSource("shared/ui/index.ts");

    expect(source).toContain("export function NativeScreenHeader");
    expect(source).toContain("export function NativeCenterState");
    expect(source).toContain("export function NativeStatePanel");
    expect(source).toContain("accessibilityRole=\"button\"");
    expect(source).toContain("minHeight: 44");
    expect(barrel).toContain('export * from "./NativeScreen"');
  });

  it("migrates auth journey screens to the shared primitives", () => {
    const loginSource = readSource("features/social/LoginScreen.tsx");
    const librarySource = readSource("features/social/LibraryScreen.tsx");

    expect(loginSource).toContain("NativeScreenHeader");
    expect(librarySource).toContain("NativeScreenHeader");
    expect(librarySource).toContain("NativeCenterState");
    expect(librarySource).not.toContain("ActivityIndicator");
  });
});
