import { describe, expect, it } from "vitest";

import stackConfig from "./stack-config.js";
import doctor from "./dev-doctor.js";
import devStack from "./dev-stack.js";
import assetSeeder from "./seed-stack-assets.js";

const {
  compareEnv,
  expectedFunctionsEnv,
  expectedNativeEnv,
  expectedWebEnv,
  parseEnvText,
  renderManagedEnvText,
  resolveSupabaseAnonKey,
  validateStackProfile,
} = stackConfig;

const { validateCatalogPayload } = doctor;
const { expoArgsForNativePreview } = devStack;
const {
  collectCatalogAssets,
  contentTypeForPath,
  fixtureSourceForObjectPath,
  objectPathFromPublicUrl,
  parseEnvOutput,
} = assetSeeder;

const localProfile = {
  profile: "local",
  backendUrl: "http://127.0.0.1:54321",
  catalogUrl: "http://127.0.0.1:54321/functions/v1/catalog",
  webUrl: "http://localhost:5173",
  nativePreviewUrl: "http://127.0.0.1:8082",
  allowedShellOrigins: ["http://127.0.0.1:8082", "http://localhost:8082"],
  supabaseAnonKey: "",
};

describe("stack config helpers", () => {
  it("validates the local profile shape", () => {
    expect(validateStackProfile(localProfile)).toEqual([]);
  });

  it("rejects catalog endpoints on a different backend origin", () => {
    expect(validateStackProfile({
      ...localProfile,
      catalogUrl: "http://localhost:54321/functions/v1/catalog",
    })).toContain("catalogUrl origin (http://localhost:54321) must match backendUrl origin (http://127.0.0.1:54321).");
  });

  it("maps one profile to Expo and Vite env names", () => {
    expect(expectedNativeEnv(localProfile, "public-key")).toMatchObject({
      EXPO_PUBLIC_GSAV_WEB_URL: "http://localhost:5173",
      EXPO_PUBLIC_GSAV_CATALOG_URL: "http://127.0.0.1:54321/functions/v1/catalog",
      EXPO_PUBLIC_GSAV_SUPABASE_URL: "http://127.0.0.1:54321",
      EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: "public-key",
    });
    expect(expectedWebEnv(localProfile, "public-key")).toMatchObject({
      VITE_GSAV_CATALOG_URL: "http://127.0.0.1:54321/functions/v1/catalog",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_ANON_KEY: "public-key",
      VITE_GSAV_ALLOWED_SHELL_ORIGINS: "http://127.0.0.1:8082,http://localhost:8082",
    });
    expect(expectedFunctionsEnv(localProfile)).toEqual({
      GSAV_PUBLIC_STORAGE_URL: "http://127.0.0.1:54321",
    });
  });

  it("preserves an existing anon key when the profile does not hard-code one", () => {
    expect(resolveSupabaseAnonKey(localProfile, {
      EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: "native-key",
    }, {
      VITE_SUPABASE_ANON_KEY: "web-key",
    }, {})).toBe("native-key");
  });

  it("renders managed env blocks without duplicate managed keys", () => {
    const text = renderManagedEnvText(
      "# keep me\nEXPO_PUBLIC_GSAV_WEB_URL=http://old.example\nOTHER=value\n",
      { EXPO_PUBLIC_GSAV_WEB_URL: "http://new.example" },
    );

    expect(text).toContain("# keep me");
    expect(text).toContain("OTHER=value");
    expect(text).not.toContain("http://old.example");
    expect(parseEnvText(text).EXPO_PUBLIC_GSAV_WEB_URL).toBe("http://new.example");
  });

  it("reports env drift", () => {
    expect(compareEnv({ A: "one" }, { A: "two", B: "" })).toEqual([
      { key: "A", expected: "two", actual: "one" },
    ]);
  });
});

describe("dev stack launcher helpers", () => {
  it("derives Expo web launch args from the native preview URL", () => {
    expect(expoArgsForNativePreview("http://127.0.0.1:8082")).toEqual([
      "run",
      "web",
      "--",
      "--host",
      "lan",
      "--port",
      "8082",
    ]);
  });
});

describe("stack asset seeding helpers", () => {
  it("extracts gsav-public object paths from public storage URLs", () => {
    expect(objectPathFromPublicUrl(
      "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/posters/generated/capture-room.jpg",
    )).toBe("posters/generated/capture-room.jpg");
  });

  it("collects unique catalog assets", () => {
    expect(collectCatalogAssets({
      videos: [
        {
          id: "capture-room",
          posterUrl: "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/posters/generated/capture-room.jpg",
          animatedPosterUrl: "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/posters/generated/capture-room.webp",
          gsavUrl: "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/videos/channel/video/scene.gsav",
        },
        {
          id: "duplicate",
          posterUrl: "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/posters/generated/capture-room.jpg",
        },
      ],
    }).map((asset) => asset.objectPath)).toEqual([
      "posters/generated/capture-room.jpg",
      "posters/generated/capture-room.webp",
      "videos/channel/video/scene.gsav",
    ]);
  });

  it("maps common fixture content types", () => {
    expect(contentTypeForPath("poster.webp")).toBe("image/webp");
    expect(contentTypeForPath("scene.gsav")).toBe("application/octet-stream");
  });

  it("prefers a per-scene gsav fixture and falls back to the shared demo capture", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const webRoot = await mkdtemp(path.join(tmpdir(), "seed-fixture-"));
    try {
      const paths = { gsavWebRoot: webRoot };
      const objectPath = "videos/channel/video/scene.gsav";
      const fallback = path.join(webRoot, "public", "test.gsav");
      expect(fixtureSourceForObjectPath(paths, objectPath)).toBe(fallback);

      const perScene = path.join(webRoot, "public", "videos", "channel", "video", "scene.gsav");
      await mkdir(path.dirname(perScene), { recursive: true });
      await writeFile(perScene, "per-scene");
      expect(fixtureSourceForObjectPath(paths, objectPath)).toBe(perScene);

      expect(fixtureSourceForObjectPath(paths, "posters/generated/elly.jpg"))
        .toBe(path.join(webRoot, "public", "posters", "generated", "elly.jpg"));
    } finally {
      await rm(webRoot, { recursive: true, force: true });
    }
  });

  it("parses quoted Supabase CLI env output", () => {
    expect(parseEnvOutput('API_URL="http://127.0.0.1:54321"\nSERVICE_ROLE_KEY="role"\n')).toEqual({
      API_URL: "http://127.0.0.1:54321",
      SERVICE_ROLE_KEY: "role",
    });
  });
});

describe("dev doctor catalog checks", () => {
  it("rejects container-internal catalog asset URLs", () => {
    expect(() => validateCatalogPayload({
      schemaVersion: 1,
      videos: [{
        id: "capture-room",
        posterUrl: "http://kong:8000/storage/v1/object/public/gsav-public/poster.jpg",
        gsavUrl: "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/scene.gsav",
      }],
    })).toThrow("catalog video[0] capture-room posterUrl is not browser-reachable");
  });

  it("rejects container-internal URLs outside the first catalog item", () => {
    expect(() => validateCatalogPayload({
      schemaVersion: 1,
      videos: [
        {
          id: "capture-room",
          posterUrl: "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/poster.jpg",
          gsavUrl: "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/scene.gsav",
        },
        {
          id: "bad-scene",
          posterUrl: "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/poster-2.jpg",
          gsavUrl: "http://kong:8000/storage/v1/object/public/gsav-public/scene-2.gsav",
        },
      ],
    })).toThrow("catalog video[1] bad-scene gsavUrl is not browser-reachable");
  });

  it("accepts browser-reachable catalog asset URLs", () => {
    expect(validateCatalogPayload({
      schemaVersion: 1,
      videos: [{
        id: "capture-room",
        posterUrl: "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/poster.jpg",
        gsavUrl: "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/scene.gsav",
      }],
    })).toMatchObject({
      schemaVersion: 1,
      firstVideoId: "capture-room",
      assetUrls: [
        {
          label: "catalog video[0] capture-room poster",
          url: "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/poster.jpg",
        },
        {
          label: "catalog video[0] capture-room GSAV",
          url: "http://127.0.0.1:54321/storage/v1/object/public/gsav-public/scene.gsav",
        },
      ],
    });
  });
});
