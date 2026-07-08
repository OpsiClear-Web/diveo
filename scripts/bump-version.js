#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseSemver(version) {
  const parts = String(version).split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || !parts.every((part) => Number.isInteger(part) && part >= 0)) {
    throw new Error(`Invalid semver version: ${version}`);
  }
  return parts;
}

function versionCodeForVersion(version) {
  const [major, minor, patch] = parseSemver(version);
  return major * 10000 + minor * 100 + patch;
}

function bumpPatchVersion(version) {
  const [major, minor, patch] = parseSemver(version);
  return `${major}.${minor}.${patch + 1}`;
}

function updateGradleVersionText(gradle, version, versionCode) {
  return gradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${version}"`);
}

function updatePackageLockVersionText(lockText, version) {
  const lockJson = JSON.parse(lockText);
  lockJson.version = version;
  if (lockJson.packages?.[""]) {
    lockJson.packages[""].version = version;
  }
  return JSON.stringify(lockJson, null, 2) + "\n";
}

function bumpVersion(root = path.resolve(__dirname, '..')) {
  const appJsonPath = path.join(root, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const newVersion = bumpPatchVersion(appJson.expo.version);
  const newVersionCode = versionCodeForVersion(newVersion);

  appJson.expo.version = newVersion;
  appJson.expo.android = {
    ...(appJson.expo.android ?? {}),
    versionCode: newVersionCode,
  };
  fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');

  const pkgJsonPath = path.join(root, 'package.json');
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  pkgJson.version = newVersion;
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');

  const pkgLockPath = path.join(root, 'package-lock.json');
  if (fs.existsSync(pkgLockPath)) {
    fs.writeFileSync(pkgLockPath, updatePackageLockVersionText(fs.readFileSync(pkgLockPath, 'utf8'), newVersion));
  }

  const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
  if (fs.existsSync(gradlePath)) {
    const gradle = fs.readFileSync(gradlePath, 'utf8');
    fs.writeFileSync(gradlePath, updateGradleVersionText(gradle, newVersion, newVersionCode));
  }

  return { newVersion, newVersionCode };
}

if (require.main === module) {
  const { newVersion } = bumpVersion();
  console.log(newVersion);
}

module.exports = {
  bumpPatchVersion,
  bumpVersion,
  parseSemver,
  updateGradleVersionText,
  updatePackageLockVersionText,
  versionCodeForVersion,
};
