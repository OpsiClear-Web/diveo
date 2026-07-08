#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_SOURCE_FILES = {
  webHost: "features/player/GsavWebView.web.tsx",
  nativeHost: "features/player/useGsavEmbedHost.ts",
  nativeMessage: "features/player/nativeBridgeMessage.ts",
  navGate: "features/player/navGate.ts",
  sessionBridge: "features/player/sessionBridge.ts",
};

function readRequiredSources(root = process.cwd(), sourceFiles = REQUIRED_SOURCE_FILES) {
  return Object.fromEntries(Object.entries(sourceFiles).map(([key, repoPath]) => {
    const fullPath = path.join(root, repoPath);
    return [key, {
      path: repoPath,
      text: fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : null,
    }];
  }));
}

function sourceIncludes(text, pattern) {
  if (typeof text !== "string") return false;
  return pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
}

function stripComments(text) {
  return String(text ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function problemIfMissing(source, label, pattern, message) {
  return sourceIncludes(source?.text, pattern) ? [] : [`${source?.path ?? label}: ${message}`];
}

function validateNativeHostOriginContract(source) {
  const problems = [];
  problems.push(...problemIfMissing(
    source,
    "native host",
    /allowedOrigin\s*=\s*useMemo\(\s*\(\)\s*=>\s*\(gsavWebUrl\s*\?\s*getOrigin\(gsavWebUrl\)\s*:\s*["']{2}\)/,
    "must derive allowedOrigin from getOrigin(gsavWebUrl)",
  ));
  problems.push(...problemIfMissing(
    source,
    "native host",
    /handleNativeWebViewBridgeMessage\(\s*\{[\s\S]*?allowedOrigin,/,
    "must pass allowedOrigin into native bridge message handling",
  ));
  problems.push(...problemIfMissing(
    source,
    "native host",
    /handleGsavEmbedNavigationRequest\(\s*request\.url,\s*allowedOrigin,/,
    "must pass allowedOrigin into WebView navigation handling",
  ));
  return problems;
}

function validateNativeMessageOriginContract(source) {
  const problems = [];
  problems.push(...problemIfMissing(
    source,
    "native bridge message",
    /messageOrigin\s*=\s*pageUrl\s*\?\s*getOrigin\(pageUrl\)\s*:\s*["']{2}/,
    "must derive message origin from the platform-reported page URL",
  ));
  problems.push(...problemIfMissing(
    source,
    "native bridge message",
    /if\s*\(\s*!isTrustedBridgeOrigin\(messageOrigin,\s*allowedOrigin\)\s*\)\s*\{[\s\S]*?return\s+["']ignored-untrusted-origin["']/,
    "must reject untrusted message origins before session or progress handling",
  ));
  return problems;
}

function validateNavGateOriginContract(source) {
  const problems = [];
  problems.push(...problemIfMissing(
    source,
    "navigation gate",
    /if\s*\(\s*!allowedOrigin\s*\)\s*return\s+false/,
    "must fail closed when no allowed origin is configured",
  ));
  problems.push(...problemIfMissing(
    source,
    "navigation gate",
    /next\.origin\s*===\s*allowedOrigin[\s\S]*?next\.searchParams\.getAll\(["']embed["']\)\.length\s*===\s*1[\s\S]*?next\.searchParams\.get\(["']embed["']\)\s*===\s*["']native["']/,
    "must allow WebView navigation only for same-origin routes with exactly one embed=native marker",
  ));
  problems.push(...problemIfMissing(
    source,
    "navigation gate",
    /if\s*\(\s*origin\s*==\s*null\s*\|\|\s*origin\s*===\s*["']{2}\s*\)\s*return\s+true[\s\S]*?return\s+origin\s*===\s*allowedOrigin/,
    "must trust missing platform origins only after allowedOrigin exists, and otherwise require exact origin equality",
  ));
  return problems;
}

function validateWebHostOriginContract(source) {
  const problems = [];
  problems.push(...problemIfMissing(
    source,
    "web iframe host",
    /origin\s*=\s*useMemo\(\s*\(\)\s*=>\s*\(baseUrl\s*\?\s*getOrigin\(baseUrl\)\s*:\s*["']{2}\)/,
    "must derive iframe target origin from getOrigin(baseUrl)",
  ));
  problems.push(...problemIfMissing(
    source,
    "web iframe host",
    /postSessionBridgeMessageForAuthState\(\s*[\s\S]*?iframeRef\.current\?\.contentWindow,\s*origin,/,
    "must send iframe session messages through the strict target-origin helper",
  ));
  problems.push(...problemIfMissing(
    source,
    "web iframe host",
    /event\.origin\s*===\s*origin\s*&&\s*isAuthReadyMessage\(event\.data\)/,
    "must answer GSAV_AUTH_READY only from the configured iframe origin",
  ));
  const uncommented = stripComments(source?.text);
  if (/\bcontentWindow\?*\.postMessage\s*\(/.test(uncommented)) {
    problems.push(`${source?.path}: must not call contentWindow.postMessage directly; use postSessionBridgeMessageForAuthState`);
  }
  return problems;
}

function validateSessionBridgeOriginContract(source) {
  const problems = [];
  problems.push(...problemIfMissing(
    source,
    "session bridge",
    /if\s*\(\s*!target\s*\|\|\s*!targetOrigin\s*\)\s*return\s+false/,
    "must refuse iframe postMessage when targetOrigin is missing",
  ));
  problems.push(...problemIfMissing(
    source,
    "session bridge",
    /target\.postMessage\(message,\s*targetOrigin\)/,
    "must use the supplied targetOrigin when posting iframe session messages",
  ));
  const uncommented = stripComments(source?.text);
  if (/target\.postMessage\(message,\s*["']\*["']\)/.test(uncommented)) {
    problems.push(`${source?.path}: must not use wildcard targetOrigin for iframe session messages`);
  }
  return problems;
}

function analyzeBridgeOriginContract(sources = readRequiredSources()) {
  const problems = [];
  const checked = {};

  for (const [key, source] of Object.entries(sources)) {
    checked[key] = source?.path ?? null;
    if (source?.text == null) {
      problems.push(`${source?.path ?? key}: required bridge origin source file is missing`);
    }
  }
  if (problems.length === 0) {
    problems.push(...validateNativeHostOriginContract(sources.nativeHost));
    problems.push(...validateNativeMessageOriginContract(sources.nativeMessage));
    problems.push(...validateNavGateOriginContract(sources.navGate));
    problems.push(...validateWebHostOriginContract(sources.webHost));
    problems.push(...validateSessionBridgeOriginContract(sources.sessionBridge));
  }

  return {
    ok: problems.length === 0,
    status: problems.length === 0 ? "pass" : "fail",
    checked,
    problems,
  };
}

function main() {
  const result = analyzeBridgeOriginContract(readRequiredSources(process.cwd()));
  console.log(`${JSON.stringify({
    checkedAt: new Date().toISOString(),
    ...result,
  }, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  REQUIRED_SOURCE_FILES,
  analyzeBridgeOriginContract,
  readRequiredSources,
  stripComments,
  validateNativeHostOriginContract,
  validateNativeMessageOriginContract,
  validateNavGateOriginContract,
  validateSessionBridgeOriginContract,
  validateWebHostOriginContract,
};
