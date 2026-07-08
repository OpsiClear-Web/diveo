import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readSource(relativePath: string) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("auth return integration source contract", () => {
  it("uses explicit safe return targets for native login entry points", () => {
    expect(readSource("features/social/LibraryScreen.tsx")).toContain('createLoginHref("/library")');
    expect(readSource("features/settings/SettingsScreen.tsx")).toContain('createLoginHref("/settings")');
    expect(readSource("features/catalog/CreatorScreen.tsx")).toContain("creatorAuthReturnTo(handle)");
  });

  it("replaces only sanitized return targets after successful login", () => {
    const loginSource = readSource("features/social/LoginScreen.tsx");

    expect(loginSource).toContain("useLocalSearchParams");
    expect(loginSource).toContain("safeAuthReturnTo(firstParam(params.returnTo))");
    expect(loginSource).toContain("router.replace(returnTo as never)");
  });
});
