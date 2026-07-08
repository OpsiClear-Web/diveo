import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import bumper from "./bump-version.js";

const {
  bumpPatchVersion,
  bumpVersion,
  parseSemver,
  updateGradleVersionText,
  updatePackageLockVersionText,
  versionCodeForVersion,
} = bumper;

describe("version bump helpers", () => {
  it("bumps only the patch version", () => {
    expect(bumpPatchVersion("1.0.19")).toBe("1.0.20");
    expect(bumpPatchVersion("2.3.9")).toBe("2.3.10");
  });

  it("derives Android versionCode from semver", () => {
    expect(versionCodeForVersion("1.0.19")).toBe(10019);
    expect(versionCodeForVersion("2.3.4")).toBe(20304);
  });

  it("rejects invalid semver", () => {
    expect(() => parseSemver("1.2")).toThrow("Invalid semver version: 1.2");
    expect(() => parseSemver("1.two.3")).toThrow("Invalid semver version: 1.two.3");
  });

  it("updates generated Gradle version metadata", () => {
    const result = updateGradleVersionText(
      'defaultConfig {\n  versionCode 10019\n  versionName "1.0.19"\n}',
      "1.0.20",
      10020,
    );

    expect(result).toContain("versionCode 10020");
    expect(result).toContain('versionName "1.0.20"');
  });

  it("updates package-lock root version metadata", () => {
    const result = updatePackageLockVersionText(
      JSON.stringify({
        name: "diveo",
        version: "1.0.19",
        packages: {
          "": {
            name: "diveo",
            version: "1.0.19",
          },
        },
      }),
      "1.0.20",
    );

    const packageLock = JSON.parse(result);
    expect(packageLock.version).toBe("1.0.20");
    expect(packageLock.packages[""].version).toBe("1.0.20");
  });

  it("updates app, package, lockfile, and generated Gradle version metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "diveo-bump-"));
    const androidApp = join(root, "android", "app");
    mkdirSync(androidApp, { recursive: true });
    writeFileSync(
      join(root, "app.json"),
      JSON.stringify({
        expo: {
          version: "1.0.19",
          android: {
            versionCode: 10019,
            package: "com.opsiclear.diveo",
          },
        },
      }),
    );
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.0.19" }));
    writeFileSync(
      join(root, "package-lock.json"),
      JSON.stringify({
        name: "diveo",
        version: "1.0.19",
        packages: {
          "": {
            name: "diveo",
            version: "1.0.19",
          },
        },
      }),
    );
    writeFileSync(join(androidApp, "build.gradle"), 'versionCode 10019\nversionName "1.0.19"\n');

    const result = bumpVersion(root);
    const appJson = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    const gradle = readFileSync(join(androidApp, "build.gradle"), "utf8");

    expect(result).toEqual({ newVersion: "1.0.20", newVersionCode: 10020 });
    expect(appJson.expo.version).toBe("1.0.20");
    expect(appJson.expo.android.versionCode).toBe(10020);
    expect(packageJson.version).toBe("1.0.20");
    expect(packageLock.version).toBe("1.0.20");
    expect(packageLock.packages[""].version).toBe("1.0.20");
    expect(gradle).toContain("versionCode 10020");
    expect(gradle).toContain('versionName "1.0.20"');
  });
});
