import { describe, expect, it, vi } from "vitest";

// cache.ts imports react-native and expo-file-system at module top level.
// Those native modules cannot be parsed/loaded in a plain node + vitest run
// (react-native ships Flow-typed source). We stub them so the module imports
// cleanly and we can exercise the pure formatBytes helper. The stubs are never
// invoked by formatBytes itself.
vi.mock("react-native", () => ({ Platform: { OS: "test" } }));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "",
  getInfoAsync: async () => ({ exists: false }),
  readDirectoryAsync: async () => [],
  deleteAsync: async () => {},
}));

import { formatBytes } from "./cache";

// Characterization tests for formatBytes. Expected values were derived by
// executing the real implementation (see utils/cache.ts) against fixed inputs,
// so they lock in the current B/KB/MB/GB threshold and rounding behavior.
//
// The other exports (getImageCacheSize, clearImageCache) are intentionally NOT
// tested here: they depend on react-native's Platform and expo-file-system
// native modules and are not pure/runnable in a plain node + vitest context.

describe("formatBytes", () => {
  it("formats raw byte counts below 1 KiB with a B suffix", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("uses B right up to the 1 KiB boundary", () => {
    // 1023 stays in bytes; 1024 crosses into KB.
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats kibibytes with one decimal place", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2048)).toBe("2.0 KB");
    // Just below 1 MiB still renders as KB (rounded up to 1024.0 KB).
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it("uses KB right up to the 1 MiB boundary", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("formats mebibytes with one decimal place", () => {
    expect(formatBytes(1572864)).toBe("1.5 MB"); // 1.5 MiB
    expect(formatBytes(1234567)).toBe("1.2 MB");
    // Just below 1 GiB still renders as MB (rounded up to 1024.0 MB).
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe("1024.0 MB");
  });

  it("uses MB right up to the 1 GiB boundary", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
  });

  it("formats gibibytes with two decimal places", () => {
    expect(formatBytes(1610612736)).toBe("1.50 GB"); // 1.5 GiB
    expect(formatBytes(5368709120)).toBe("5.00 GB"); // 5 GiB
  });

  it("does not special-case negative values (falls into the B branch)", () => {
    expect(formatBytes(-1)).toBe("-1 B");
  });
});
