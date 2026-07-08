import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readSource(relativePath: string) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("navigation UX source contracts", () => {
  it("keeps diagnostics out of Home primary navigation and behind Settings", () => {
    const homeSource = readSource("features/catalog/HomeScreen.tsx");
    const settingsSource = readSource("features/settings/SettingsScreen.tsx");

    expect(homeSource).not.toContain("/gsav-diagnostics");
    expect(homeSource).not.toContain("Diveo diagnostics");
    expect(settingsSource).toContain("ScrollView");
    expect(settingsSource).toContain("/gsav-diagnostics");
    expect(settingsSource).toContain("Open diagnostics");
  });
});
