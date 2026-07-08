import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const playerDir = dirname(fileURLToPath(import.meta.url));

function readPlayerSource(fileName: string) {
  return readFileSync(join(playerDir, fileName), "utf8");
}

describe("player degraded-state UI source contracts", () => {
  it("uses shared native center states for invalid and preparing watch routes", () => {
    const source = readPlayerSource("GsavScreen.tsx");

    expect(source).toContain("NativeCenterState");
    expect(source).toContain("Scene unavailable");
    expect(source).toContain("Preparing playback...");
    expect(source).not.toContain("ActivityIndicator");
  });

  it("uses shared native state panels for WebView configuration, retry, and blocked navigation states", () => {
    const source = readPlayerSource("GsavWebView.tsx");

    expect(source).toContain("NativeCenterState");
    expect(source).toContain("NativeStatePanel");
    expect(source).toContain("diveo not configured");
    expect(source).toContain("diveo unavailable");
    expect(source).toContain("Navigation blocked");
    expect(source).toContain("actionLabel=\"Retry\"");
    expect(source).toContain("actionLabel=\"Stay here\"");
    expect(source).not.toContain("minHeight: 34");
    expect(source).not.toContain("retryButton");
  });
});
