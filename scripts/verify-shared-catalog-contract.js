#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_WEB_CATALOG_PATH = path.join("..", "gsav-hosting", "apps", "web", "src", "catalog", "api-catalog.ts");
const DEFAULT_WEB_CATALOG_INDEX_PATH = path.join("..", "gsav-hosting", "apps", "web", "src", "catalog", "index.ts");
const DEFAULT_WEB_SRC_ROOT = path.join("..", "gsav-hosting", "apps", "web", "src");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function readText(root, relativePath, errors) {
  const fullPath = path.resolve(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`${normalizePath(relativePath)} is missing.`);
    return "";
  }
  return fs.readFileSync(fullPath, "utf8");
}

function walkSourceFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }
  walk(root);
  return files;
}

function relativeToRoot(root, fullPath) {
  return normalizePath(path.relative(root, fullPath));
}

function analyzeSharedCatalogContract(root = process.cwd(), options = {}) {
  const errors = [];
  const checked = {
    nativeService: "services/gsav.ts",
    nativeCatalogAdapter: "features/catalog/catalogAdapter.ts",
    webCatalogProvider: options.webCatalogPath ?? DEFAULT_WEB_CATALOG_PATH,
    webCatalogIndex: options.webCatalogIndexPath ?? DEFAULT_WEB_CATALOG_INDEX_PATH,
    webSrcRoot: options.webSrcRoot ?? DEFAULT_WEB_SRC_ROOT,
  };

  const nativeService = readText(root, checked.nativeService, errors);
  const nativeCatalogAdapter = readText(root, checked.nativeCatalogAdapter, errors);
  const webCatalog = readText(root, checked.webCatalogProvider, errors);
  const webCatalogIndex = readText(root, checked.webCatalogIndex, errors);

  if (nativeService && !/from\s+["']@opsiclear\/gsav-client["']/.test(nativeService)) {
    errors.push("services/gsav.ts must import the shared @opsiclear/gsav-client package.");
  }
  if (nativeService && !/\bCATALOG_SCHEMA_VERSION\s*=\s*1\b/.test(nativeService)) {
    errors.push("services/gsav.ts must declare catalog schemaVersion 1.");
  }
  if (nativeService && !/\bassertVersionedCatalogPayload\b/.test(nativeService)) {
    errors.push("services/gsav.ts must assert the versioned catalog API payload before normalization.");
  }
  if (nativeService && !/\bcreateVersionedGsavCatalog\b/.test(nativeService)) {
    errors.push("services/gsav.ts must create the native catalog client with createVersionedGsavCatalog.");
  }
  if (nativeService && !/\bnormalizeCatalogPage\s*\(/.test(nativeService)) {
    errors.push("services/gsav.ts must normalize catalog responses through the shared normalizeCatalogPage contract.");
  }
  if (nativeCatalogAdapter && /@opsiclear\/gsav-client/.test(nativeCatalogAdapter)) {
    errors.push("features/catalog/catalogAdapter.ts must use services/gsav.ts, not @opsiclear/gsav-client directly.");
  }

  if (webCatalog && !/from\s+["']@opsiclear\/gsav-client["']/.test(webCatalog)) {
    errors.push(`${normalizePath(checked.webCatalogProvider)} must import @opsiclear/gsav-client.`);
  }
  if (webCatalog && !/\bnormalizeCatalogPage\s+as\s+normalizeSharedCatalogPage\b|\bnormalizeCatalogPage\b/.test(webCatalog)) {
    errors.push(`${normalizePath(checked.webCatalogProvider)} must consume the shared normalizeCatalogPage contract.`);
  }
  if (webCatalog && !/\bnormalizeSharedCatalogPage\s*\(/.test(webCatalog) && !/\bnormalizeCatalogPage\s*\(/.test(webCatalog)) {
    errors.push(`${normalizePath(checked.webCatalogProvider)} must call the shared catalog normalizer.`);
  }
  if (webCatalog && /\bisDanmakuMode\b|\bfunction\s+isDanmakuItem\b|\bfunction\s+toDanmakus\b/.test(webCatalog)) {
    errors.push(`${normalizePath(checked.webCatalogProvider)} must not reimplement core danmaku normalization.`);
  }
  if (webCatalogIndex && !/\bnew\s+ApiCatalogProvider\b/.test(webCatalogIndex)) {
    errors.push(`${normalizePath(checked.webCatalogIndex)} must route API catalog access through ApiCatalogProvider.`);
  }

  const webSrcRoot = path.resolve(root, checked.webSrcRoot);
  const providerPath = normalizePath(path.resolve(root, checked.webCatalogProvider));
  const indexPath = normalizePath(path.resolve(root, checked.webCatalogIndex));
  for (const fullPath of walkSourceFiles(webSrcRoot)) {
    const normalizedFullPath = normalizePath(fullPath);
    const relativePath = relativeToRoot(root, fullPath);
    const text = fs.readFileSync(fullPath, "utf8");
    const isTest = /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(normalizedFullPath);
    if (isTest) continue;
    if (normalizedFullPath !== providerPath && normalizedFullPath !== indexPath && /\bVITE_GSAV_CATALOG_URL\b/.test(text)) {
      errors.push(`${relativePath} must not read VITE_GSAV_CATALOG_URL outside the catalog provider factory.`);
    }
    if (normalizedFullPath !== providerPath && /\bnormalizeCatalogPayload\b/.test(text)) {
      errors.push(`${relativePath} must not use the web catalog adapter's test normalizer outside the provider.`);
    }
  }

  return {
    ok: errors.length === 0,
    checked,
    errors,
  };
}

function main() {
  const result = analyzeSharedCatalogContract(process.cwd());
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    status: result.ok ? "pass" : "fail",
    ...result,
  }, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  analyzeSharedCatalogContract,
  DEFAULT_WEB_CATALOG_INDEX_PATH,
  DEFAULT_WEB_CATALOG_PATH,
  DEFAULT_WEB_SRC_ROOT,
};
