#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const {
  loadStackProfile,
  resolveStackPaths,
} = require("./stack-config");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    configPath: "",
    root: process.cwd(),
    dryRun: false,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      const next = argv[index + 1];
      if (!next) throw new Error("--config requires a path.");
      options.configPath = next;
      index += 1;
    } else if (arg === "--root") {
      const next = argv[index + 1];
      if (!next) throw new Error("--root requires a path.");
      options.root = path.resolve(next);
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force") {
      options.force = true;
    } else {
      throw new Error("Usage: node scripts/seed-stack-assets.js [--config <path>] [--root <path>] [--dry-run] [--force]");
    }
  }

  return options;
}

function parseEnvOutput(text) {
  const values = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=["']?(.+?)["']?$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function supabaseBinaryPath(paths) {
  const platformSuffixes = {
    win32: {
      x64: ["windows-x64"],
      arm64: ["windows-arm64"],
    },
    linux: {
      x64: ["linux-x64", "linux-x64-musl"],
      arm64: ["linux-arm64", "linux-arm64-musl"],
    },
    darwin: {
      x64: ["darwin-x64"],
      arm64: ["darwin-arm64"],
    },
  };
  const candidates = platformSuffixes[process.platform]?.[process.arch] ?? [];
  const extension = process.platform === "win32" ? ".exe" : "";
  for (const candidate of candidates) {
    const binaryPath = path.join(paths.gsavHostingRoot, "node_modules", `@supabase/cli-${candidate}`, "bin", `supabase${extension}`);
    if (fs.existsSync(binaryPath)) return binaryPath;
  }
  return "supabase";
}

function localSupabaseEnv(paths, profile, env = process.env) {
  const fromProcess = {
    url: env.SUPABASE_URL ?? env.API_URL ?? profile.backendUrl,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? env.SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY ?? env.SECRET_KEY,
  };
  if (fromProcess.url && fromProcess.serviceRoleKey) return fromProcess;

  const output = execFileSync(supabaseBinaryPath(paths), ["status", "-o", "env"], {
    cwd: paths.gsavHostingRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = parseEnvOutput(output);
  return {
    url: fromProcess.url ?? parsed.SUPABASE_URL ?? parsed.API_URL,
    serviceRoleKey: (
      fromProcess.serviceRoleKey ??
      parsed.SUPABASE_SERVICE_ROLE_KEY ??
      parsed.SERVICE_ROLE_KEY ??
      parsed.SUPABASE_SECRET_KEY ??
      parsed.SECRET_KEY
    ),
  };
}

function contentTypeForPath(objectPath) {
  const lower = objectPath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".gsav")) return "application/octet-stream";
  return "application/octet-stream";
}

function objectPathFromPublicUrl(urlValue) {
  if (!urlValue) return "";
  const url = new URL(urlValue);
  const marker = "/storage/v1/object/public/gsav-public/";
  const markerIndex = url.pathname.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Catalog asset URL is not a gsav-public storage URL: ${urlValue}`);
  }
  return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
}

function fixtureSourceForObjectPath(paths, objectPath) {
  const perObject = path.join(paths.gsavWebRoot, "public", ...objectPath.split("/"));
  if (objectPath.toLowerCase().endsWith(".gsav")) {
    // Per-scene captures are preferred when the fixture exists; otherwise every
    // scene falls back to the single shared demo capture. Posters must match
    // whichever capture actually seeds (see gsav-hosting posters/generated).
    if (fs.existsSync(perObject)) return perObject;
    return path.join(paths.gsavWebRoot, "public", "test.gsav");
  }
  return perObject;
}

function collectCatalogAssets(catalogPayload) {
  if (!catalogPayload || typeof catalogPayload !== "object" || !Array.isArray(catalogPayload.videos)) {
    throw new Error("Catalog payload must include a videos array.");
  }

  const assets = new Map();
  for (const video of catalogPayload.videos) {
    for (const [kind, url] of [
      ["gsav", video.gsavUrl],
      ["poster", video.posterUrl],
      ["animated_poster", video.animatedPosterUrl],
    ]) {
      if (!url) continue;
      const objectPath = objectPathFromPublicUrl(url);
      if (!assets.has(objectPath)) {
        assets.set(objectPath, {
          kind,
          objectPath,
          url,
          videoId: String(video.id ?? video.backendId ?? ""),
        });
      }
    }
  }
  return Array.from(assets.values()).sort((left, right) => left.objectPath.localeCompare(right.objectPath));
}

async function storageObjectExists(client, objectPath) {
  const slash = objectPath.lastIndexOf("/");
  const folder = slash >= 0 ? objectPath.slice(0, slash) : "";
  const name = slash >= 0 ? objectPath.slice(slash + 1) : objectPath;
  const { data, error } = await client.storage.from("gsav-public").list(folder, {
    limit: 100,
    search: name,
  });
  if (error) throw new Error(`Could not inspect gsav-public/${objectPath}: ${error.message}`);
  return data?.some((item) => item.name === name) ?? false;
}

async function fetchCatalog(profile) {
  const response = await fetch(profile.catalogUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Catalog returned HTTP ${response.status}: ${profile.catalogUrl}`);
  return response.json();
}

async function seedAsset(client, sourcePath, objectPath, options) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing local fixture for gsav-public/${objectPath}: ${sourcePath}`);
  }

  if (!options.force && await storageObjectExists(client, objectPath)) {
    return "skipped";
  }

  if (options.dryRun) return "would-upload";

  const bytes = fs.readFileSync(sourcePath);
  const contentType = contentTypeForPath(objectPath);
  const { error } = await client.storage
    .from("gsav-public")
    .upload(objectPath, new Blob([bytes], { type: contentType }), {
      contentType,
      upsert: true,
    });
  if (error) throw new Error(`Could not upload gsav-public/${objectPath}: ${error.message}`);
  return "uploaded";
}

async function run(options = parseArgs()) {
  const paths = resolveStackPaths(options.root, options.configPath);
  const profile = loadStackProfile(paths);
  const credentials = localSupabaseEnv(paths, profile);
  if (!credentials.url || !credentials.serviceRoleKey) {
    throw new Error("Missing local Supabase URL or trusted key. Start Supabase or set SUPABASE_URL and SERVICE_ROLE_KEY.");
  }

  const client = createClient(credentials.url, credentials.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const catalog = await fetchCatalog(profile);
  const assets = collectCatalogAssets(catalog);
  if (!assets.length) throw new Error("Catalog returned no seedable assets.");

  const results = [];
  for (const asset of assets) {
    const sourcePath = fixtureSourceForObjectPath(paths, asset.objectPath);
    const result = await seedAsset(client, sourcePath, asset.objectPath, options);
    results.push({ ...asset, sourcePath, result });
    const relativeSource = path.relative(paths.gsavHostingRoot, sourcePath).replace(/\\/g, "/");
    console.log(`${result} - gsav-public/${asset.objectPath} <- ${relativeSource}`);
  }

  const counts = results.reduce((acc, item) => {
    acc[item.result] = (acc[item.result] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Seeded catalog public assets: ${JSON.stringify(counts)}`);
  return { assets: results };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  collectCatalogAssets,
  contentTypeForPath,
  fixtureSourceForObjectPath,
  objectPathFromPublicUrl,
  parseArgs,
  parseEnvOutput,
  run,
};
