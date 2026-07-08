#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { versionCodeForVersion } = require("./bump-version.js");

const forbiddenSchemes = new Set(["bilibili"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadResolvedAppConfig(root, env = process.env) {
  const appJson = readJson(path.join(root, "app.json"));
  const appConfigPath = path.join(root, "app.config.js");
  if (!fs.existsSync(appConfigPath)) {
    return {
      appConfig: appJson,
      source: "app.json"
    };
  }

  delete require.cache[require.resolve(appConfigPath)];
  const dynamicConfig = require(appConfigPath);
  if (typeof dynamicConfig.resolveExpoConfig === "function") {
    return {
      appConfig: { expo: dynamicConfig.resolveExpoConfig(env, appJson.expo ?? {}) },
      source: "app.config.js#resolveExpoConfig"
    };
  }
  if (typeof dynamicConfig === "function") {
    return {
      appConfig: { expo: dynamicConfig({ config: appJson.expo ?? {} }) },
      source: "app.config.js"
    };
  }
  return {
    appConfig: dynamicConfig?.expo ? dynamicConfig : { expo: dynamicConfig },
    source: "app.config.js"
  };
}

// Security gate: reject any production GSAV origin that resolves to a local/private host.
// This is what stops a release accidentally shipping with a dev URL baked into the APK
// (127.0.0.1:5191, ::1, the Android emulator's 10.0.2.2, link-local, or a LAN box).
function isLocalHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:0" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized === "10.0.2.2" ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [first, second] = parts;
    if (first === 10) return true;
    if (first === 127) return true;
    if (first === 100 && second >= 64 && second <= 127) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;
  }

  const ipv4Mapped = /(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(normalized);
  if (ipv4Mapped) {
    return isLocalHostname(ipv4Mapped[1]);
  }

  if (normalized.includes(":")) {
    const firstHextet = normalized.split(":")[0];
    if (/^[0-9a-f]{1,4}$/i.test(firstHextet)) {
      const first = Number.parseInt(firstHextet, 16);
      if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local.
      if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local.
    }
  }

  return false;
}

function productionEnvValue(name, env, easConfig) {
  const easProductionEnv = easConfig?.build?.production?.env ?? {};
  return env[name] || easProductionEnv[name] || "";
}

function productionGsavUrl(env, easConfig) {
  return productionEnvValue("EXPO_PUBLIC_GSAV_WEB_URL", env, easConfig);
}

function qaFlagDisabled(value) {
  const normalized = String(value ?? "").trim();
  return normalized === "" || normalized === "0";
}

function productionQaFlagState(name, env, easConfig) {
  const easProductionEnv = easConfig?.build?.production?.env ?? {};
  const envValue = env[name] ?? "";
  const easValue = easProductionEnv[name] ?? "";
  return {
    disabled: qaFlagDisabled(envValue) && qaFlagDisabled(easValue),
    envValue,
    easValue,
  };
}

function validateProductionUrl(name, value, errors) {
  if (!value) {
    errors.push(`Production must provide ${name} in the environment or EAS production profile.`);
    return;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      errors.push(`Production ${name} must use https.`);
    }
    if (isLocalHostname(parsed.hostname)) {
      errors.push(`Production ${name} must not point at localhost, emulator, link-local, or private LAN hosts.`);
    }
    if (parsed.username || parsed.password) {
      errors.push(`Production ${name} must not contain credentials.`);
    }
  } catch {
    errors.push(`Production ${name} must be a valid absolute URL.`);
  }
}

function workflowIndex(text, needle) {
  return text.indexOf(needle);
}

function preflightStepVerifiesHostIdentityMetadata(releaseWorkflowText) {
  const stepBlocks = releaseWorkflowText.split(/\n(?=\s{6}-\s)/);
  return stepBlocks.some((block) => (
    block.includes("npm run gsav:preflight")
    && /\bGSAV_HOST_IDENTITY_URL\s*:/.test(block)
    && /\bGSAV_HOSTING_COMMIT\s*:/.test(block)
    && /\bGSAV_NATIVE_PREFLIGHT_REQUIRE_HOST_IDENTITY\s*:\s*["']?1["']?/.test(block)
  ));
}

function preflightStepRequiresRangeProbe(releaseWorkflowText) {
  const stepBlocks = releaseWorkflowText.split(/\n(?=\s{6}-\s)/);
  return stepBlocks.some((block) => (
    block.includes("npm run gsav:preflight")
    && /\bGSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE\s*:\s*["']?1["']?/.test(block)
    && /\bGSAV_NATIVE_PREFLIGHT_RANGE_URL\s*:/.test(block)
  ));
}

function preflightStepRequiresCors(releaseWorkflowText) {
  const stepBlocks = releaseWorkflowText.split(/\n(?=\s{6}-\s)/);
  return stepBlocks.some((block) => (
    block.includes("npm run gsav:preflight")
    && /\bGSAV_NATIVE_PREFLIGHT_REQUIRE_CORS\s*:\s*["']?1["']?/.test(block)
  ));
}

function releaseWorkflowForbidsQaFlags(releaseWorkflowText) {
  return !/\bEXPO_PUBLIC_GSAV_QA_(?:CONTROLS|AUTH_DELAY_MS)\b/.test(releaseWorkflowText);
}

function workflowOrderingState(releaseWorkflowText) {
  const readinessIndex = workflowIndex(releaseWorkflowText, "npm run verify:release-readiness");
  const firstCommitIndex = workflowIndex(releaseWorkflowText, "git commit");
  const lastCommitIndex = releaseWorkflowText.lastIndexOf("git commit");
  const candidateIdentityIndex = workflowIndex(releaseWorkflowText, "release-candidate.txt");
  const frozenCandidateIndex = workflowIndex(releaseWorkflowText, "PAYLOAD_CANDIDATE_REF");
  const preflightIndex = workflowIndex(releaseWorkflowText, "npm run gsav:preflight");
  const runtimeSmokeIndex = workflowIndex(releaseWorkflowText, "npm run gsav:runtime-smoke");
  const handoffReceiptsIndex = workflowIndex(releaseWorkflowText, "npm run verify:handoff-receipts");
  const lastMileReleaseStateIndex = workflowIndex(releaseWorkflowText, "npm run release-evidence:github-release-state");
  const lastMilePublishHashGuardIndex = workflowIndex(releaseWorkflowText, "npm run release-evidence:publish-hash-guard");
  const pushIndex = workflowIndex(releaseWorkflowText, "git push");
  const releaseCreateIndex = workflowIndex(releaseWorkflowText, "gh release create");
  const versionBumpIndex = workflowIndex(releaseWorkflowText, "scripts/bump-version.js");
  const signoffDiffIndex = workflowIndex(releaseWorkflowText, "signoff-diff-files.txt");
  const mentionsQaPath = releaseWorkflowText.includes("docs/GSAV_NATIVE_QA.md")
    || releaseWorkflowText.includes("docs/GSAV_NATIVE_QA\\.md");
  const mentionsAuditPath = releaseWorkflowText.includes("docs/IMPLEMENTATION_VALIDATION_AUDIT.md")
    || releaseWorkflowText.includes("docs/IMPLEMENTATION_VALIDATION_AUDIT\\.md");

  return {
    hasReadiness: readinessIndex !== -1,
    hasCandidateRefInput: releaseWorkflowText.includes("candidate_ref:")
      && releaseWorkflowText.includes("inputs.candidate_ref"),
    resolvesFrozenPayloadCandidate: frozenCandidateIndex !== -1
      && releaseWorkflowText.includes('git rev-parse "$PAYLOAD_CANDIDATE_REF^{commit}"')
      && releaseWorkflowText.includes("steps.candidate.outputs.sha"),
    verifiesEvidenceSignoffDiff: signoffDiffIndex !== -1
      && releaseWorkflowText.includes("git merge-base --is-ancestor")
      && mentionsQaPath
      && mentionsAuditPath
      && releaseWorkflowText.includes("docs/qa-evidence/"),
    hasReleaseVersionBumpInWorkflow: versionBumpIndex !== -1,
    hasReleaseCandidateIdentity: releaseWorkflowText.includes("release-candidate.txt")
      && releaseWorkflowText.includes("RELEASE_CANDIDATE_SHA")
      && releaseWorkflowText.includes("steps.candidate.outputs.sha"),
    runsPreflightAfterReleaseCandidateIdentity: preflightIndex !== -1
      && candidateIdentityIndex !== -1
      && preflightIndex > candidateIdentityIndex,
    runsRuntimeSmokeAfterReleaseCandidateIdentity: runtimeSmokeIndex !== -1
      && candidateIdentityIndex !== -1
      && runtimeSmokeIndex > candidateIdentityIndex,
    runsStrictHandoffReceiptsBeforeReadiness: handoffReceiptsIndex !== -1
      && readinessIndex !== -1
      && handoffReceiptsIndex < readinessIndex
      && releaseWorkflowText.includes("steps.publish_evidence_paths.outputs.evidence_date")
      && releaseWorkflowText.includes("--require-git-integrity"),
    runsLastMilePrepublishGuardsBeforeReadiness: lastMileReleaseStateIndex !== -1
      && lastMilePublishHashGuardIndex !== -1
      && readinessIndex !== -1
      && handoffReceiptsIndex !== -1
      && handoffReceiptsIndex < lastMileReleaseStateIndex
      && lastMileReleaseStateIndex < lastMilePublishHashGuardIndex
      && lastMilePublishHashGuardIndex < readinessIndex
      && releaseWorkflowText.includes("release-evidence/github-release-state-prepublish.json")
      && releaseWorkflowText.includes("release-evidence/publish-hash-variable-guard-prepublish.json")
      && releaseWorkflowText.includes("${{ github.actor }}")
      && releaseWorkflowText.includes("${{ github.repository }}")
      && releaseWorkflowText.includes("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}"),
    commitsReleaseCandidateBeforeReadiness: false,
    hasCommitAfterReadiness: readinessIndex !== -1
      && lastCommitIndex !== -1
      && lastCommitIndex > readinessIndex,
    pushesOnlyAfterReadiness: pushIndex === -1
      || (readinessIndex !== -1 && pushIndex > readinessIndex),
    releasesOnlyAfterReadiness: releaseCreateIndex === -1
      || (readinessIndex !== -1 && releaseCreateIndex > readinessIndex),
    targetsReleaseCandidateSha: releaseCreateIndex === -1
      || (releaseWorkflowText.includes("--target") && releaseWorkflowText.includes("steps.candidate.outputs.sha")),
    hasGitCommitInReleaseWorkflow: firstCommitIndex !== -1,
    hasGitPushInReleaseWorkflow: pushIndex !== -1,
  };
}

function releaseEvidenceBundleVerifierState(releaseEvidenceBundleVerifierText) {
  const parsesSignoffDiff = releaseEvidenceBundleVerifierText.includes("function parseSignoffDiffText")
    && releaseEvidenceBundleVerifierText.includes("function validateSignoffDiff")
    && releaseEvidenceBundleVerifierText.includes("validateSignoffDiff({ summary, evidenceDir")
    && releaseEvidenceBundleVerifierText.includes("payloadCandidateRef")
    && releaseEvidenceBundleVerifierText.includes("payloadCandidateSha")
    && releaseEvidenceBundleVerifierText.includes("evidenceSignoffSha");
  const comparesPayloadAndSignoffIdentity = releaseEvidenceBundleVerifierText.includes(
    "payloadCandidateSha must match releaseCandidateSha",
  )
    && releaseEvidenceBundleVerifierText.includes(
      "evidenceSignoffSha must match dry-run-summary.json workflowSha",
    );
  const restrictsChangedFiles = releaseEvidenceBundleVerifierText.includes("isAllowedEvidenceSignoffPath")
    && releaseEvidenceBundleVerifierText.includes("files.filter((filePath) => !isAllowedEvidenceSignoffPath(filePath))");
  const verifiesExactRangeContentRange = releaseEvidenceBundleVerifierText.includes("function exactRangeContentRange")
    && releaseEvidenceBundleVerifierText.includes("bytes 0-0/<size>")
    && releaseEvidenceBundleVerifierText.includes("rangeAsset.contentRange must be bytes 0-0/<size>");
  const verifiesRangeCorsHeaders = releaseEvidenceBundleVerifierText.includes("function missingExposedRangeHeaders")
    && releaseEvidenceBundleVerifierText.includes("rangeAsset.accessControlAllowOrigin must be present")
    && releaseEvidenceBundleVerifierText.includes("rangeAsset.accessControlAllowOrigin must be * or match")
    && releaseEvidenceBundleVerifierText.includes("rangeAsset.accessControlExposeHeaders must expose");
  const verifiesAuthenticatedNoPublishLookup = releaseEvidenceBundleVerifierText.includes("githubReleaseLookup=not_found")
    && releaseEvidenceBundleVerifierText.includes("gh release view must prove an authenticated not-found result");

  return {
    verifiesSignoffDiffBundleContents: parsesSignoffDiff
      && comparesPayloadAndSignoffIdentity
      && restrictsChangedFiles,
    verifiesExactRangeContentRange,
    verifiesRangeCorsHeaders,
    verifiesAuthenticatedNoPublishLookup,
  };
}

function nativePreflightVerifierState(nativePreflightText) {
  const preflightRequiresExactRangeContentRange = nativePreflightText.includes("function exactRangeContentRange")
    && nativePreflightText.includes("config.requireRangeProbe")
    && nativePreflightText.includes("did not return exact Content-Range: bytes 0-0/<size>");
  const preflightRequiresRangeCorsHeaders = nativePreflightText.includes("function missingExposedRangeHeaders")
    && nativePreflightText.includes("config.requireCors")
    && nativePreflightText.includes("Access-Control-Allow-Origin must be * or match")
    && nativePreflightText.includes("did not expose browser-readable range headers");

  return {
    preflightRequiresExactRangeContentRange,
    preflightRequiresRangeCorsHeaders,
  };
}

function validateNativeProductionConfig({
  appConfig,
  easConfig,
  packageJson,
  packageLockJson,
  releaseWorkflowText = "",
  releaseEvidenceBundleVerifierText = "",
  nativePreflightText = "",
  qualityWorkflowText = "",
  env = {},
}) {
  const errors = [];
  const warnings = [];
  const expo = appConfig?.expo ?? {};
  const android = expo.android ?? {};
  const expoVersion = expo.version ?? null;
  const schemes = Array.isArray(expo.scheme) ? expo.scheme : [expo.scheme].filter(Boolean);
  const productionEnv = easConfig?.build?.production?.env ?? {};
  const gsavUrl = productionGsavUrl(env, easConfig);
  const catalogUrl = productionEnvValue("EXPO_PUBLIC_GSAV_CATALOG_URL", env, easConfig);
  const supabaseUrl = productionEnvValue("EXPO_PUBLIC_GSAV_SUPABASE_URL", env, easConfig);
  const supabaseAnonKey = productionEnvValue("EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY", env, easConfig);
  const qaControlsState = productionQaFlagState("EXPO_PUBLIC_GSAV_QA_CONTROLS", env, easConfig);
  const qaAuthDelayState = productionQaFlagState("EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS", env, easConfig);

  if (!packageJson?.scripts?.["gsav:preflight"]) {
    errors.push("package.json must expose gsav:preflight.");
  }

  if (!packageJson?.scripts?.["verify:native-production-config"]) {
    errors.push("package.json must expose verify:native-production-config.");
  }

  if (!packageJson?.scripts?.["verify:local"]) {
    errors.push("package.json must expose verify:local.");
  }

  if (!packageJson?.scripts?.["verify:release-candidate"]) {
    errors.push("package.json must expose verify:release-candidate.");
  }

  if (!packageJson?.scripts?.["verify:release-artifact"]) {
    errors.push("package.json must expose verify:release-artifact.");
  }

  if (!packageJson?.scripts?.["android:version-metadata"]) {
    errors.push("package.json must expose android:version-metadata.");
  }

  if (!packageJson?.scripts?.["release-evidence:branch-protection"]) {
    errors.push("package.json must expose release-evidence:branch-protection.");
  }

  if (!packageJson?.scripts?.["verify:release-evidence-bundle"]) {
    errors.push("package.json must expose verify:release-evidence-bundle.");
  }

  if (!packageJson?.scripts?.["verify:release-readiness"]) {
    errors.push("package.json must expose verify:release-readiness.");
  }

  if (!releaseWorkflowText.includes("workflow_dispatch:")) {
    errors.push("release workflow must expose workflow_dispatch for manual release dry runs.");
  }

  if (!releaseWorkflowText.includes("publish_release:") || !releaseWorkflowText.includes("inputs.publish_release")) {
    errors.push("release workflow must gate manual publishing behind the publish_release input.");
  }

  const manualPublishExpression = "github.event_name == 'workflow_dispatch' && inputs.publish_release";
  const publishCanRunOnPush = releaseWorkflowText.includes("github.event_name == 'push' || inputs.publish_release");
  const publishModeManualOnly = releaseWorkflowText.includes(`PUBLISH_RELEASE: \${{ ${manualPublishExpression} }}`)
    && releaseWorkflowText.includes(`RELEASE_EVIDENCE_MODE: \${{ (${manualPublishExpression}) && 'publish' || 'dry-run' }}`)
    && releaseWorkflowText.includes(`if: \${{ ${manualPublishExpression} }}`)
    && !publishCanRunOnPush;
  if (!publishModeManualOnly) {
    errors.push("release workflow must keep push runs in dry-run mode and allow publishing only from workflow_dispatch publish_release=true.");
  }

  if (!releaseWorkflowText.includes("candidate_ref:") || !releaseWorkflowText.includes("inputs.candidate_ref")) {
    errors.push("release workflow must require a candidate_ref input for frozen payload release runs.");
  }

  const failsPublishIntentWithoutSecrets = releaseWorkflowText.includes("PUBLISH_INTENT")
    && releaseWorkflowText.includes("publish_release=true")
    && releaseWorkflowText.includes("Production GSAV secrets are required")
    && releaseWorkflowText.includes("exit 1");
  if (!failsPublishIntentWithoutSecrets) {
    errors.push("release workflow must fail when publish_release=true and required production secrets are missing.");
  }

  if (!releaseWorkflowText.includes("actions/upload-artifact@v4")) {
    errors.push("release workflow must upload verified release evidence artifacts.");
  }

  if (!releaseWorkflowText.includes("release-evidence")) {
    errors.push("release workflow must upload release-evidence command outputs.");
  }

  if (!releaseWorkflowText.includes("scripts/write-release-evidence-summary.js")) {
    errors.push("release workflow must generate a release dry-run evidence summary.");
  }

  if (!releaseWorkflowText.includes("dry-run-summary.json")) {
    errors.push("release workflow must include release-evidence/dry-run-summary.json.");
  }

  if (!releaseWorkflowText.includes("evidence-checksums.txt")) {
    errors.push("release workflow must include release-evidence/evidence-checksums.txt.");
  }

  if (!releaseWorkflowText.includes("npm run verify:release-evidence-bundle")) {
    errors.push("release workflow must verify the release evidence bundle before upload.");
  }
  const verifiesReleaseEvidenceMode = releaseWorkflowText.includes("RELEASE_EVIDENCE_MODE")
    && releaseWorkflowText.includes('--mode "$RELEASE_EVIDENCE_MODE"');
  if (!verifiesReleaseEvidenceMode) {
    errors.push("release workflow must pass dry-run/publish mode to the release evidence bundle verifier.");
  }

  const capturesAuthenticatedNoPublishProof = releaseWorkflowText.includes("no-publish-side-effect.txt")
    && releaseWorkflowText.includes("gh release view")
    && releaseWorkflowText.includes("githubReleaseLookup=not_found")
    && releaseWorkflowText.includes("githubReleaseLookup=inconclusive")
    && releaseWorkflowText.includes("githubReleasePresent=false")
    && releaseWorkflowText.includes('exit "$gh_release_status"');
  if (!capturesAuthenticatedNoPublishProof) {
    errors.push("release workflow must capture authenticated gh release view not-found proof and fail inconclusive no-publish lookups.");
  }

  if (!releaseWorkflowText.includes("npm run android:version-metadata")) {
    errors.push("release workflow must capture generated APK version metadata through npm run android:version-metadata.");
  }

  if (!releaseWorkflowText.includes("apk-version-metadata.txt")) {
    errors.push("release workflow must include release-evidence/apk-version-metadata.txt.");
  }

  if (!releaseWorkflowText.includes("--expected-version-code")) {
    errors.push("release workflow must compare APK version metadata against the expected app versionCode.");
  }

  if (!releaseWorkflowText.includes("npm run verify:release-readiness")) {
    errors.push("release workflow must verify release readiness evidence before publishing.");
  }

  const releaseWorkflowQaFlagsDisabled = releaseWorkflowForbidsQaFlags(releaseWorkflowText);
  if (!releaseWorkflowQaFlagsDisabled) {
    errors.push("release workflow must not set EXPO_PUBLIC_GSAV_QA_CONTROLS or EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS in any build, prebuild, or verification step.");
  }

  if (!qualityWorkflowText.includes("npm run verify:local")) {
    errors.push("quality workflow must run npm run verify:local.");
  }

  const workflowOrdering = workflowOrderingState(releaseWorkflowText);
  const bundleVerifier = releaseEvidenceBundleVerifierState(releaseEvidenceBundleVerifierText);
  const nativePreflightVerifier = nativePreflightVerifierState(nativePreflightText);
  if (!workflowOrdering.runsStrictHandoffReceiptsBeforeReadiness) {
    errors.push("release workflow must run strict handoff receipt verification before release readiness.");
  }
  if (!workflowOrdering.runsLastMilePrepublishGuardsBeforeReadiness) {
    errors.push("release workflow must run live last-mile release-state and publish-hash guards before release readiness.");
  }
  if (!workflowOrdering.hasReleaseCandidateIdentity) {
    errors.push("release workflow must capture release-candidate.txt with RELEASE_CANDIDATE_SHA from the frozen payload candidate.");
  }
  if (!workflowOrdering.resolvesFrozenPayloadCandidate) {
    errors.push("release workflow must resolve and reuse a frozen payload candidate ref instead of creating one during release.");
  }
  if (!workflowOrdering.verifiesEvidenceSignoffDiff) {
    errors.push("release workflow must verify evidence signoff commits only change QA/audit/evidence files.");
  }
  if (workflowOrdering.hasReleaseVersionBumpInWorkflow) {
    errors.push("release workflow must not run scripts/bump-version.js during release evidence or publish jobs.");
  }
  if (!workflowOrdering.runsPreflightAfterReleaseCandidateIdentity) {
    errors.push("release workflow must run production GSAV preflight after capturing the release-candidate identity.");
  }
  if (!workflowOrdering.runsRuntimeSmokeAfterReleaseCandidateIdentity) {
    errors.push("release workflow must run production GSAV runtime smoke after capturing the release-candidate identity.");
  }
  if (workflowOrdering.hasGitCommitInReleaseWorkflow) {
    errors.push("release workflow must not create git commits during release evidence or publish jobs.");
  }
  if (workflowOrdering.hasCommitAfterReadiness) {
    errors.push("release workflow must not create git commits after verify:release-readiness.");
  }
  if (workflowOrdering.hasGitPushInReleaseWorkflow) {
    errors.push("release workflow must not push from the release workflow; publish must consume an existing candidate/signoff commit.");
  }
  if (!workflowOrdering.pushesOnlyAfterReadiness) {
    errors.push("release workflow must not push the release candidate before verify:release-readiness passes.");
  }
  if (!workflowOrdering.releasesOnlyAfterReadiness) {
    errors.push("release workflow must not create the GitHub release before verify:release-readiness passes.");
  }
  if (!workflowOrdering.targetsReleaseCandidateSha) {
    errors.push("release workflow must create the GitHub release with --target set to the verified release-candidate SHA.");
  }
  if (!bundleVerifier.verifiesSignoffDiffBundleContents) {
    errors.push("release evidence bundle verifier must parse signoff-diff-files.txt and verify candidate/signoff identity and allowed changed files.");
  }
  if (!bundleVerifier.verifiesExactRangeContentRange) {
    errors.push("release evidence bundle verifier must require exact rangeAsset.contentRange bytes 0-0/<size> evidence.");
  }
  if (!bundleVerifier.verifiesRangeCorsHeaders) {
    errors.push("release evidence bundle verifier must require browser-readable range CORS headers.");
  }
  if (!bundleVerifier.verifiesAuthenticatedNoPublishLookup) {
    errors.push("release evidence bundle verifier must require authenticated gh release view not-found proof for dry-run no-publish evidence.");
  }
  if (!nativePreflightVerifier.preflightRequiresExactRangeContentRange) {
    errors.push("native preflight must require exact Content-Range bytes 0-0/<size> when GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE=1.");
  }
  if (!nativePreflightVerifier.preflightRequiresRangeCorsHeaders) {
    errors.push("native preflight must require browser-readable range CORS headers when GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS=1.");
  }

  const runsReleaseRuntimeSmoke = releaseWorkflowText.includes("npm run gsav:runtime-smoke")
    && releaseWorkflowText.includes("GSAV_RUNTIME_SMOKE_CHROMIUM_EXECUTABLE")
    && releaseWorkflowText.includes("release-evidence/gsav-runtime-smoke.json");
  if (!runsReleaseRuntimeSmoke) {
    errors.push("release workflow must run production GSAV runtime smoke and capture release-evidence/gsav-runtime-smoke.json.");
  }

  const gsavHostIdentityReferences = releaseWorkflowText.match(/\bGSAV_HOSTING_COMMIT\b/g)?.length ?? 0;
  const capturesGsavHostIdentity = gsavHostIdentityReferences >= 2;
  if (!capturesGsavHostIdentity) {
    errors.push("release workflow must provide GSAV_HOSTING_COMMIT to preflight and runtime smoke evidence.");
  }

  const verifiesGsavHostIdentityMetadata = preflightStepVerifiesHostIdentityMetadata(releaseWorkflowText);
  if (!verifiesGsavHostIdentityMetadata) {
    errors.push("release workflow must verify host-served GSAV identity metadata during preflight.");
  }
  const verifiesRangeProbePreflight = preflightStepRequiresRangeProbe(releaseWorkflowText);
  if (!verifiesRangeProbePreflight) {
    errors.push("release workflow must require the GSAV range probe during production preflight.");
  }
  const verifiesRangeCorsPreflight = preflightStepRequiresCors(releaseWorkflowText);
  if (!verifiesRangeCorsPreflight) {
    errors.push("release workflow must require browser-readable range CORS headers during production preflight.");
  }

  if (!qualityWorkflowText.includes("npm run verify:native-production-config")) {
    errors.push("quality workflow must run verify:native-production-config with safe HTTPS placeholders.");
  }

  for (const requiredQualityEnv of [
    "EXPO_PUBLIC_GSAV_WEB_URL",
    "EXPO_PUBLIC_GSAV_CATALOG_URL",
    "EXPO_PUBLIC_GSAV_SUPABASE_URL",
    "EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY",
  ]) {
    if (!qualityWorkflowText.includes(requiredQualityEnv)) {
      errors.push(`quality workflow must provide ${requiredQualityEnv} for the production config placeholder audit.`);
    }
  }

  if (!packageJson?.version) {
    errors.push("package.json version must be set for production builds.");
  } else if (expoVersion && packageJson.version !== expoVersion) {
    errors.push(`package.json version must match expo.version (${expoVersion}).`);
  }

  if (!packageLockJson) {
    errors.push("package-lock.json must exist for production builds.");
  } else {
    if (!packageLockJson.version) {
      errors.push("package-lock.json version must be set for production builds.");
    } else if (expoVersion && packageLockJson.version !== expoVersion) {
      errors.push(`package-lock.json version must match expo.version (${expoVersion}).`);
    }
    const rootPackageVersion = packageLockJson.packages?.[""]?.version;
    if (!rootPackageVersion) {
      errors.push("package-lock.json root package version must be set for production builds.");
    } else if (expoVersion && rootPackageVersion !== expoVersion) {
      errors.push(`package-lock.json root package version must match expo.version (${expoVersion}).`);
    }
  }

  if (!schemes.includes("gsav")) {
    errors.push("app config must include the gsav URL scheme.");
  }

  const legacySchemes = schemes.filter((scheme) => forbiddenSchemes.has(String(scheme).toLowerCase()));
  if (legacySchemes.length > 0) {
    errors.push(`app config must not include legacy URL schemes: ${legacySchemes.join(", ")}.`);
  }

  if (android.usesCleartextTraffic === true) {
    errors.push("android.usesCleartextTraffic must be false or omitted for production builds.");
  }

  let expectedAndroidVersionCode = null;
  if (!Number.isInteger(android.versionCode) || android.versionCode <= 0) {
    errors.push("android.versionCode must be a positive integer for production builds.");
  }
  try {
    if (expoVersion) {
      expectedAndroidVersionCode = versionCodeForVersion(expoVersion);
      if (android.versionCode !== expectedAndroidVersionCode) {
        errors.push(`android.versionCode must match expo.version (${expectedAndroidVersionCode} for ${expoVersion}).`);
      }
    } else {
      errors.push("expo.version must be set for production builds.");
    }
  } catch {
    errors.push("expo.version must be a valid major.minor.patch version.");
  }

  validateProductionUrl("EXPO_PUBLIC_GSAV_WEB_URL", gsavUrl, errors);
  validateProductionUrl("EXPO_PUBLIC_GSAV_CATALOG_URL", catalogUrl, errors);
  validateProductionUrl("EXPO_PUBLIC_GSAV_SUPABASE_URL", supabaseUrl, errors);

  if (!supabaseAnonKey.trim()) {
    errors.push("Production must provide EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY in the environment or EAS production profile.");
  }

  if (!qaControlsState.disabled) {
    errors.push("Production EXPO_PUBLIC_GSAV_QA_CONTROLS must be unset or 0 in both the environment and EAS production profile.");
  }

  if (!qaAuthDelayState.disabled) {
    errors.push("Production EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS must be unset or 0 in both the environment and EAS production profile.");
  }

  if (productionEnv.EXPO_PUBLIC_APP_ENV !== "production" && env.EXPO_PUBLIC_APP_ENV !== "production") {
    warnings.push("EAS production profile should set EXPO_PUBLIC_APP_ENV=production.");
  }

  // (The missing-URL case is already covered by the `!gsavUrl` check above,
  // which merges the env and EAS-profile sources via productionGsavUrl.)

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checked: {
      gsavUrl: gsavUrl || null,
      catalogUrl: catalogUrl || null,
      supabaseUrl: supabaseUrl || null,
      hasSupabaseAnonKey: supabaseAnonKey.trim().length > 0,
      qaControlsDisabled: qaControlsState.disabled,
      qaAuthDelayDisabled: qaAuthDelayState.disabled,
      expoVersion,
      packageVersion: packageJson?.version ?? null,
      packageLockVersion: packageLockJson?.version ?? null,
      packageLockRootVersion: packageLockJson?.packages?.[""]?.version ?? null,
      androidVersionCode: android.versionCode ?? null,
      expectedAndroidVersionCode,
      androidUsesCleartextTraffic: android.usesCleartextTraffic ?? null,
      schemes,
      hasProductionProfile: Boolean(easConfig?.build?.production),
      hasReleaseWorkflowDispatch: releaseWorkflowText.includes("workflow_dispatch:"),
      hasReleaseWorkflowPublishInput: releaseWorkflowText.includes("publish_release:") && releaseWorkflowText.includes("inputs.publish_release"),
      publishModeManualOnly,
      failsPublishIntentWithoutSecrets,
      uploadsReleaseEvidence: releaseWorkflowText.includes("actions/upload-artifact@v4"),
      uploadsReleaseEvidenceOutputs: releaseWorkflowText.includes("release-evidence"),
      writesReleaseDryRunSummary: releaseWorkflowText.includes("scripts/write-release-evidence-summary.js") && releaseWorkflowText.includes("dry-run-summary.json"),
      writesReleaseEvidenceChecksums: releaseWorkflowText.includes("evidence-checksums.txt"),
      verifiesReleaseEvidenceBundle: releaseWorkflowText.includes("npm run verify:release-evidence-bundle"),
      verifiesReleaseEvidenceMode,
      capturesAuthenticatedNoPublishProof,
      capturesGeneratedApkMetadata: releaseWorkflowText.includes("npm run android:version-metadata")
        && releaseWorkflowText.includes("apk-version-metadata.txt")
        && releaseWorkflowText.includes("--expected-version-code"),
      releaseWorkflowForbidsQaFlags: releaseWorkflowQaFlagsDisabled,
      capturesGsavHostIdentity,
      verifiesGsavHostIdentityMetadata,
      verifiesRangeProbePreflight,
      verifiesRangeCorsPreflight,
      verifiesReleaseReadiness: releaseWorkflowText.includes("npm run verify:release-readiness"),
      verifiesStrictHandoffReceiptsBeforeReadiness: workflowOrdering.runsStrictHandoffReceiptsBeforeReadiness,
      ...workflowOrdering,
      ...bundleVerifier,
      ...nativePreflightVerifier,
      runsReleaseRuntimeSmoke,
      qualityVerifiesLocalBundle: qualityWorkflowText.includes("npm run verify:local"),
      qualityVerifiesProductionConfig: qualityWorkflowText.includes("npm run verify:native-production-config")
    }
  };
}

function main() {
  const root = process.cwd();
  const productionEnv = { ...process.env, EXPO_PUBLIC_APP_ENV: "production", EAS_BUILD_PROFILE: "production" };
  const { appConfig, source: appConfigSource } = loadResolvedAppConfig(root, productionEnv);
  const easConfig = fs.existsSync(path.join(root, "eas.json"))
    ? readJson(path.join(root, "eas.json"))
    : {};
  const packageJson = readJson(path.join(root, "package.json"));
  const packageLockJson = fs.existsSync(path.join(root, "package-lock.json"))
    ? readJson(path.join(root, "package-lock.json"))
    : null;
  const releaseWorkflowPath = path.join(root, ".github", "workflows", "release.yml");
  const releaseWorkflowText = fs.existsSync(releaseWorkflowPath)
    ? fs.readFileSync(releaseWorkflowPath, "utf8")
    : "";
  const qualityWorkflowPath = path.join(root, ".github", "workflows", "quality.yml");
  const qualityWorkflowText = fs.existsSync(qualityWorkflowPath)
    ? fs.readFileSync(qualityWorkflowPath, "utf8")
    : "";
  const releaseEvidenceBundleVerifierPath = path.join(root, "scripts", "verify-release-evidence-bundle.js");
  const releaseEvidenceBundleVerifierText = fs.existsSync(releaseEvidenceBundleVerifierPath)
    ? fs.readFileSync(releaseEvidenceBundleVerifierPath, "utf8")
    : "";
  const nativePreflightPath = path.join(root, "scripts", "gsav-native-preflight.js");
  const nativePreflightText = fs.existsSync(nativePreflightPath)
    ? fs.readFileSync(nativePreflightPath, "utf8")
    : "";
  const result = validateNativeProductionConfig({
    appConfig,
    easConfig,
    packageJson,
    packageLockJson,
    releaseWorkflowText,
    releaseEvidenceBundleVerifierText,
    nativePreflightText,
    qualityWorkflowText,
    env: productionEnv
  });

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    appConfigSource,
    status: result.ok ? "pass" : "fail",
    ...result
  }, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  forbiddenSchemes,
  isLocalHostname,
  loadResolvedAppConfig,
  productionEnvValue,
  productionGsavUrl,
  productionQaFlagState,
  qaFlagDisabled,
  nativePreflightVerifierState,
  preflightStepRequiresCors,
  preflightStepRequiresRangeProbe,
  releaseWorkflowForbidsQaFlags,
  releaseEvidenceBundleVerifierState,
  validateNativeProductionConfig,
  workflowOrderingState
};
