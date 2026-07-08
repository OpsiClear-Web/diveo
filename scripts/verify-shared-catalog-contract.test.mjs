import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import verifier from "./verify-shared-catalog-contract.js";

const { analyzeSharedCatalogContract } = verifier;

function writeFile(root, relativePath, text) {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, text);
}

function createFixture(overrides = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "shared-catalog-contract-"));
  const root = path.join(workspace, "diveo");
  fs.mkdirSync(root, { recursive: true });
  writeFile(root, "services/gsav.ts", `
    import { normalizeCatalogPage } from "@opsiclear/gsav-client";
    export const CATALOG_SCHEMA_VERSION = 1;
    export function assertVersionedCatalogPayload(payload) {
      if (payload.schemaVersion !== CATALOG_SCHEMA_VERSION) throw new Error("bad version");
    }
    export function createVersionedGsavCatalog(config) {
      return {
        async feed() {
          const payload = { schemaVersion: CATALOG_SCHEMA_VERSION, videos: [] };
          assertVersionedCatalogPayload(payload);
          return normalizeCatalogPage(payload);
        },
      };
    }
    export const gsavCatalog = createVersionedGsavCatalog({ catalogUrl: "https://api.example.com/catalog" });
    export { normalizeCatalogPage };
  `);
  writeFile(root, "features/catalog/catalogAdapter.ts", `
    import { gsavCatalog } from "../../services/gsav";
    export const loadCatalogFeed = () => gsavCatalog.feed();
  `);
  writeFile(root, "../gsav-hosting/apps/web/src/catalog/api-catalog.ts", `
    import { normalizeCatalogPage as normalizeSharedCatalogPage } from "@opsiclear/gsav-client";
    export function normalizeCatalogPayload(payload) {
      return normalizeSharedCatalogPage(payload);
    }
    export class ApiCatalogProvider {}
  `);
  writeFile(root, "../gsav-hosting/apps/web/src/catalog/index.ts", `
    import { ApiCatalogProvider } from "./api-catalog";
    export function createCatalogProvider(endpoint = import.meta.env.VITE_GSAV_CATALOG_URL) {
      return new ApiCatalogProvider(endpoint);
    }
  `);
  writeFile(root, "../gsav-hosting/apps/web/src/routes/watch.tsx", `
    export function WatchRoute() { return null; }
  `);

  for (const [relativePath, text] of Object.entries(overrides)) {
    writeFile(root, relativePath, text);
  }

  return root;
}

describe("shared catalog contract verifier", () => {
  it("accepts native and web catalog access through the shared client contract", () => {
    const root = createFixture();

    expect(analyzeSharedCatalogContract(root)).toEqual(expect.objectContaining({
      ok: true,
      errors: [],
    }));
  });

  it("rejects a web catalog provider that reimplements core normalization", () => {
    const root = createFixture({
      "../gsav-hosting/apps/web/src/catalog/api-catalog.ts": `
        function isDanmakuItem(value) { return Boolean(value); }
        function normalizeCatalogPayload(payload) { return payload; }
        export class ApiCatalogProvider {}
      `,
    });

    const result = analyzeSharedCatalogContract(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "../gsav-hosting/apps/web/src/catalog/api-catalog.ts must import @opsiclear/gsav-client.",
      "../gsav-hosting/apps/web/src/catalog/api-catalog.ts must consume the shared normalizeCatalogPage contract.",
      "../gsav-hosting/apps/web/src/catalog/api-catalog.ts must call the shared catalog normalizer.",
      "../gsav-hosting/apps/web/src/catalog/api-catalog.ts must not reimplement core danmaku normalization.",
    ]));
  });

  it("rejects catalog env reads outside the provider factory", () => {
    const root = createFixture({
      "../gsav-hosting/apps/web/src/routes/home.tsx": `
        export const url = import.meta.env.VITE_GSAV_CATALOG_URL;
      `,
    });

    const result = analyzeSharedCatalogContract(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("../gsav-hosting/apps/web/src/routes/home.tsx must not read VITE_GSAV_CATALOG_URL outside the catalog provider factory.");
  });

  it("rejects direct shared-package imports from native catalog features", () => {
    const root = createFixture({
      "features/catalog/catalogAdapter.ts": `
        import { normalizeCatalogPage } from "@opsiclear/gsav-client";
        export const catalog = normalizeCatalogPage({ videos: [] });
      `,
    });

    const result = analyzeSharedCatalogContract(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("features/catalog/catalogAdapter.ts must use services/gsav.ts, not @opsiclear/gsav-client directly.");
  });

  it("rejects an unversioned native catalog service", () => {
    const root = createFixture({
      "services/gsav.ts": `
        import { normalizeCatalogPage } from "@opsiclear/gsav-client";
        export const gsavCatalog = {
          feed: async () => normalizeCatalogPage({ videos: [] }),
        };
        export { normalizeCatalogPage };
      `,
    });

    const result = analyzeSharedCatalogContract(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "services/gsav.ts must declare catalog schemaVersion 1.",
      "services/gsav.ts must assert the versioned catalog API payload before normalization.",
      "services/gsav.ts must create the native catalog client with createVersionedGsavCatalog.",
    ]));
  });
});
