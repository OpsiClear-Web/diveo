#!/usr/bin/env node
// Rebuild + re-vendor the shared @opsiclear/gsav-* packages from the sibling
// gsavjs monorepo into diveo/vendor/ as tgz (the `file:vendor/*.tgz` deps in
// package.json). Dev tool — requires ../gsavjs checked out alongside this repo.
// Run after changing a package's source so the vendored tarball can't silently
// drift from source. After it runs, `npm install ./vendor/<pkg>-<ver>.tgz` for
// any package whose version changed, then restart metro.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = resolve(ROOT, "../gsavjs/packages");
const PACKAGES = ["gsav-client", "gsav-bridge"];
const VENDOR = resolve(ROOT, "vendor");

// Paths are derived from this file's location (not user input). Run via the shell
// so Windows resolves npx/npm `.cmd` shims; quote paths to tolerate spaces.
function run(command) {
  execSync(command, { cwd: ROOT, stdio: "inherit" });
}

if (!existsSync(PACKAGES_DIR)) {
  console.error(`[vendor] gsavjs packages not found at ${PACKAGES_DIR} — clone the gsavjs repo as a sibling of this one.`);
  process.exit(1);
}

for (const pkg of PACKAGES) {
  const dir = resolve(PACKAGES_DIR, pkg);
  if (!existsSync(dir)) {
    console.error(`[vendor] missing package source: ${dir}`);
    process.exit(1);
  }
  console.log(`[vendor] building ${pkg} …`);
  run(`npx tsc -p "${resolve(dir, "tsconfig.json")}"`);
  console.log(`[vendor] packing ${pkg} → vendor/ …`);
  run(`npm pack "${dir}" --pack-destination "${VENDOR}"`);
}

console.log("[vendor] done. If a package version changed, run `npm install ./vendor/<pkg>-<ver>.tgz` then restart metro.");
