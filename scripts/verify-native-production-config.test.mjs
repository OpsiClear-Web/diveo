import { describe, expect, it } from "vitest";

import expoConfig from "../app.config.js";
import verifier from "./verify-native-production-config.js";

const { isLocalHostname, validateNativeProductionConfig } = verifier;
const { isProductionEnv, resolveExpoConfig } = expoConfig;

const productionEnv = {
  EXPO_PUBLIC_APP_ENV: "production",
  EXPO_PUBLIC_GSAV_WEB_URL: "https://gsav.example.com",
  EXPO_PUBLIC_GSAV_CATALOG_URL: "https://gsav.example.com/functions/v1/catalog",
  EXPO_PUBLIC_GSAV_SUPABASE_URL: "https://supabase.example.com",
  EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: "public-anon-key"
};

const releaseWorkflowText = `
on:
  workflow_dispatch:
    inputs:
      candidate_ref:
        type: string
      publish_release:
        type: boolean
jobs:
  gate:
    steps:
      - env:
          PUBLISH_INTENT: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        run: |
          if [ "$PUBLISH_INTENT" = "true" ]; then
            echo "::error::Production GSAV secrets are required when publish_release=true"
            exit 1
          fi
  release:
    steps:
      - id: candidate
        env:
          PAYLOAD_CANDIDATE_REF: \${{ github.event_name == 'workflow_dispatch' && inputs.candidate_ref || github.sha }}
        run: |
          CANDIDATE_SHA=$(git rev-parse "$PAYLOAD_CANDIDATE_REF^{commit}")
          SIGNOFF_SHA=$(git rev-parse HEAD)
          echo "sha=$CANDIDATE_SHA" >> "$GITHUB_OUTPUT"
          git merge-base --is-ancestor "$CANDIDATE_SHA" "$SIGNOFF_SHA"
          git diff --name-only "$CANDIDATE_SHA..$SIGNOFF_SHA" | tee release-evidence/signoff-diff-files.txt
          git diff --name-only "$CANDIDATE_SHA..$SIGNOFF_SHA" | grep -Ev '^(docs/GSAV_NATIVE_QA\\.md|docs/IMPLEMENTATION_VALIDATION_AUDIT\\.md|docs/qa-evidence/)' && exit 1 || true
      - run: |
          npm run android:version-metadata -- --apk-path app-release.apk --expected-version-code 10019 --output-path release-evidence/apk-version-metadata.txt
          test -s release-evidence/apk-version-metadata.txt
      - run: |
          echo "1.0.19" | tee release-evidence/version.txt
      - run: |
          npm run verify:native-production-config | tee release-evidence/native-production-config-before-bump.json
      - run: |
          npm run verify:native-production-config | tee release-evidence/native-production-config-after-bump.json
      - run: |
          echo "releaseCandidateSha=\${{ steps.candidate.outputs.sha }}" | tee release-evidence/release-candidate.txt
          echo "appVersion=1.0.19" | tee -a release-evidence/release-candidate.txt
          echo "packageVersion=1.0.19" | tee -a release-evidence/release-candidate.txt
          echo "androidVersionCode=10019" | tee -a release-evidence/release-candidate.txt
      - env:
          RELEASE_CANDIDATE_SHA: \${{ steps.candidate.outputs.sha }}
          GSAV_HOSTING_COMMIT: deployed-gsav-commit
          GSAV_HOST_IDENTITY_URL: https://gsav.example.com/build.json
          GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE: "1"
          GSAV_NATIVE_PREFLIGHT_RANGE_URL: https://cdn.example.com/demo.gsav
          GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS: "1"
          GSAV_NATIVE_PREFLIGHT_REQUIRE_HOST_IDENTITY: "1"
        run: |
          npm run gsav:preflight -- --output-path release-evidence/gsav-preflight.json
          test -s release-evidence/gsav-preflight.json
      - env:
          GSAV_RUNTIME_SMOKE_CHROMIUM_EXECUTABLE: /usr/bin/google-chrome
          GSAV_HOSTING_COMMIT: deployed-gsav-commit
          RELEASE_CANDIDATE_SHA: \${{ steps.candidate.outputs.sha }}
        run: |
          npm run gsav:runtime-smoke -- --output-path release-evidence/gsav-runtime-smoke.json
          test -s release-evidence/gsav-runtime-smoke.json
      - env:
          PUBLISH_RELEASE: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
          RELEASE_CANDIDATE_SHA: \${{ steps.candidate.outputs.sha }}
        run: |
          node scripts/write-release-evidence-summary.js
          test -s release-evidence/dry-run-summary.json
          test -s release-evidence/evidence-checksums.txt
      - run: |
          gh_release_status=0
          gh release view "v1.0.19" --json tagName,targetCommitish,url > release-evidence/gh-release-view.json 2> release-evidence/gh-release-view.err || gh_release_status=$?
          if [ "$gh_release_status" -eq 0 ]; then
            echo "githubReleasePresent=true"
          elif grep -Eiq "not found|could not resolve to a release|404" release-evidence/gh-release-view.err; then
            echo "githubReleaseLookup=not_found" | tee release-evidence/no-publish-side-effect.txt
            echo "githubReleasePresent=false" | tee -a release-evidence/no-publish-side-effect.txt
          else
            echo "githubReleaseLookup=inconclusive"
            echo "githubReleasePresent=inconclusive"
            exit "$gh_release_status"
          fi
      - env:
          RELEASE_EVIDENCE_MODE: \${{ (github.event_name == 'workflow_dispatch' && inputs.publish_release) && 'publish' || 'dry-run' }}
        run: npm run verify:release-evidence-bundle -- --evidence-dir release-evidence --mode "$RELEASE_EVIDENCE_MODE"
      - id: publish_evidence_paths
        if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        run: echo "evidence_date=2026-07-01" >> "$GITHUB_OUTPUT"
      - if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        run: npm run verify:handoff-receipts -- --date "\${{ steps.publish_evidence_paths.outputs.evidence_date }}" --require-git-integrity
      - if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          REVIEWED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
          npm run release-evidence:github-release-state -- --repo "\${{ github.repository }}" --output-path release-evidence/github-release-state-prepublish.json --reviewer "\${{ github.actor }}" --reviewed-at "$REVIEWED_AT"
      - if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          REVIEWED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
          npm run release-evidence:publish-hash-guard -- --repo "\${{ github.repository }}" --output-path release-evidence/publish-hash-variable-guard-prepublish.json --reviewer "\${{ github.actor }}" --reviewed-at "$REVIEWED_AT"
      - uses: actions/upload-artifact@v4
        with:
          path: release-evidence/**
      - env:
          RELEASE_CANDIDATE_SHA: \${{ steps.candidate.outputs.sha }}
        if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        run: npm run verify:release-readiness
      - if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        run: gh release create "v1.0.20" --target "\${{ steps.candidate.outputs.sha }}" app-release.apk
`;

const releaseEvidenceBundleVerifierText = `
const { isAllowedEvidenceSignoffPath } = require("./verify-release-readiness.js");

function parseSignoffDiffText(text) {
  return {
    fields: {
      payloadCandidateRef: "",
      payloadCandidateSha: "",
      evidenceSignoffSha: ""
    },
    files: []
  };
}

function validateSignoffDiff({ summary, evidenceDir }, errors) {
  const { fields, files } = parseSignoffDiffText("");
  if (!fields.payloadCandidateRef) errors.push("signoff-diff-files.txt must include payloadCandidateRef.");
  if (!fields.payloadCandidateSha) {
    errors.push("signoff-diff-files.txt must include payloadCandidateSha.");
  } else if (!commitMatches(fields.payloadCandidateSha, summary.releaseCandidateSha)) {
    errors.push("signoff-diff-files.txt payloadCandidateSha must match releaseCandidateSha.");
  }
  if (!fields.evidenceSignoffSha) {
    errors.push("signoff-diff-files.txt must include evidenceSignoffSha.");
  } else if (summary.workflowSha && !commitMatches(fields.evidenceSignoffSha, summary.workflowSha)) {
    errors.push("signoff-diff-files.txt evidenceSignoffSha must match dry-run-summary.json workflowSha.");
  }
  const disallowed = files.filter((filePath) => !isAllowedEvidenceSignoffPath(filePath));
  return disallowed;
}

validateSignoffDiff({ summary, evidenceDir }, errors);

function exactRangeContentRange(value) {
  return /^bytes\\s+0-0\\/\\d+$/i.test(String(value ?? "").trim());
}

if (!exactRangeContentRange(range.contentRange)) {
  errors.push("gsav-preflight.json rangeAsset.contentRange must be bytes 0-0/<size>.");
}

function missingExposedRangeHeaders(value) {
  return ["Accept-Ranges", "Content-Length", "Content-Range", "ETag"].filter((header) => !String(value).includes(header));
}

if (!range.accessControlAllowOrigin) {
  errors.push("gsav-preflight.json rangeAsset.accessControlAllowOrigin must be present.");
}
if (!corsAllowOriginMatches(range.accessControlAllowOrigin, preflight.baseUrl)) {
  errors.push("gsav-preflight.json rangeAsset.accessControlAllowOrigin must be * or match gsav-preflight.json baseUrl origin.");
}
if (missingExposedRangeHeaders(range.accessControlExposeHeaders).length > 0) {
  errors.push("gsav-preflight.json rangeAsset.accessControlExposeHeaders must expose missing headers.");
}

if (releaseLookup !== "not_found") {
  errors.push("no-publish-side-effect.txt gh release view must prove an authenticated not-found result.");
}
// githubReleaseLookup=not_found
`;

const nativePreflightText = `
function exactRangeContentRange(value) {
  return /^bytes\\s+0-0\\/\\d+$/i.test(String(value ?? "").trim());
}

function missingExposedRangeHeaders(value) {
  return ["Accept-Ranges", "Content-Length", "Content-Range", "ETag"].filter((header) => !String(value).includes(header));
}

function corsAllowOriginMatches(value, baseUrl) {
  return value === "*" || new URL(value).origin === new URL(baseUrl).origin;
}

async function checkRangeAsset(config) {
  const result = {
    contentRangeExact: exactRangeContentRange("bytes 0-0/100"),
    accessControlAllowOrigin: "*",
    missingExposedHeaders: missingExposedRangeHeaders("Accept-Ranges, Content-Length, Content-Range, ETag"),
  };
  if (config.requireRangeProbe) {
    assert(result.contentRangeExact, "configured range probe did not return exact Content-Range: bytes 0-0/<size>");
  }
  if (config.requireCors) {
    assert(corsAllowOriginMatches(result.accessControlAllowOrigin, config.baseUrl), "configured range probe Access-Control-Allow-Origin must be * or match the GSAV web origin");
    assert(result.missingExposedHeaders.length === 0, "configured range probe did not expose browser-readable range headers");
  }
}
`;

const qualityWorkflowText = `
jobs:
  quality:
    steps:
      - run: npm run verify:local
      - env:
          EXPO_PUBLIC_GSAV_WEB_URL: https://gsav.example.com
          EXPO_PUBLIC_GSAV_CATALOG_URL: https://gsav.example.com/functions/v1/catalog
          EXPO_PUBLIC_GSAV_SUPABASE_URL: https://supabase.example.com
          EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: public-anon-key
        run: npm run verify:native-production-config
`;

function baseConfig(overrides = {}) {
  return {
    appConfig: {
      expo: {
        version: "1.0.19",
        scheme: ["gsav"],
        android: {
          versionCode: 10019,
          usesCleartextTraffic: false
        },
        ...(overrides.expo ?? {})
      }
    },
    easConfig: {
      build: {
        production: {
          env: productionEnv
        }
      }
    },
    packageJson: {
      version: "1.0.19",
      scripts: {
        "gsav:preflight": "node scripts/gsav-native-preflight.js",
        "android:version-metadata": "node scripts/capture-android-version-metadata.js",
        "release-evidence:branch-protection": "node scripts/capture-branch-protection-evidence.js",
        "verify:native-production-config": "node scripts/verify-native-production-config.js",
        "verify:local": "node scripts/run-verification-bundle.js local",
        "verify:release-candidate": "node scripts/run-verification-bundle.js release-candidate",
        "verify:release-artifact": "node scripts/verify-release-artifact.js",
        "verify:release-evidence-bundle": "node scripts/verify-release-evidence-bundle.js",
        "verify:release-readiness": "node scripts/verify-release-readiness.js"
      }
    },
    packageLockJson: {
      version: "1.0.19",
      packages: {
        "": {
          version: "1.0.19"
        }
      }
    },
    releaseWorkflowText,
    releaseEvidenceBundleVerifierText,
    nativePreflightText,
    qualityWorkflowText,
    env: {},
    ...overrides
  };
}

describe("native production config verifier", () => {
  it("resolves Android cleartext differently for local development and production", () => {
    expect(isProductionEnv({ EXPO_PUBLIC_APP_ENV: "production" })).toBe(true);
    expect(isProductionEnv({ EAS_BUILD_PROFILE: "production" })).toBe(true);
    expect(isProductionEnv({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionEnv({ EXPO_PUBLIC_APP_ENV: "development" })).toBe(false);

    expect(resolveExpoConfig({ EXPO_PUBLIC_APP_ENV: "development" }).android.usesCleartextTraffic).toBe(true);
    expect(resolveExpoConfig({ EXPO_PUBLIC_APP_ENV: "production" }).android.usesCleartextTraffic).toBe(false);
  });

  it("accepts a production HTTPS GSAV origin and cleartext-disabled Android config", () => {
    const result = validateNativeProductionConfig(baseConfig());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.checked.publishModeManualOnly).toBe(true);
    expect(result.checked.failsPublishIntentWithoutSecrets).toBe(true);
    expect(result.checked.runsReleaseRuntimeSmoke).toBe(true);
    expect(result.checked.capturesGsavHostIdentity).toBe(true);
    expect(result.checked.verifiesGsavHostIdentityMetadata).toBe(true);
    expect(result.checked.verifiesRangeProbePreflight).toBe(true);
    expect(result.checked.verifiesRangeCorsPreflight).toBe(true);
    expect(result.checked.hasCandidateRefInput).toBe(true);
    expect(result.checked.resolvesFrozenPayloadCandidate).toBe(true);
    expect(result.checked.verifiesEvidenceSignoffDiff).toBe(true);
    expect(result.checked.hasReleaseVersionBumpInWorkflow).toBe(false);
    expect(result.checked.hasGitCommitInReleaseWorkflow).toBe(false);
    expect(result.checked.hasGitPushInReleaseWorkflow).toBe(false);
    expect(result.checked.runsPreflightAfterReleaseCandidateIdentity).toBe(true);
    expect(result.checked.runsRuntimeSmokeAfterReleaseCandidateIdentity).toBe(true);
    expect(result.checked.runsLastMilePrepublishGuardsBeforeReadiness).toBe(true);
    expect(result.checked.hasCommitAfterReadiness).toBe(false);
    expect(result.checked.targetsReleaseCandidateSha).toBe(true);
    expect(result.checked.verifiesReleaseEvidenceMode).toBe(true);
    expect(result.checked.verifiesSignoffDiffBundleContents).toBe(true);
    expect(result.checked.verifiesExactRangeContentRange).toBe(true);
    expect(result.checked.verifiesRangeCorsHeaders).toBe(true);
    expect(result.checked.preflightRequiresExactRangeContentRange).toBe(true);
    expect(result.checked.preflightRequiresRangeCorsHeaders).toBe(true);
    expect(result.checked.verifiesAuthenticatedNoPublishLookup).toBe(true);
    expect(result.checked.capturesAuthenticatedNoPublishProof).toBe(true);
    expect(result.checked.qaControlsDisabled).toBe(true);
    expect(result.checked.qaAuthDelayDisabled).toBe(true);
    expect(result.checked.releaseWorkflowForbidsQaFlags).toBe(true);
  });

  it("rejects local, cleartext, and emulator production origins", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "100.64.0.1",
      "100.127.255.254",
      "10.0.2.2",
      "192.168.1.10",
      "[::]",
      "[::1]",
      "[fd00::1]",
      "[fe80::1]",
      "::ffff:192.168.1.10",
    ]) {
      expect(isLocalHostname(host)).toBe(true);
    }

    const result = validateNativeProductionConfig(baseConfig({
      easConfig: {
        build: {
          production: {
            env: {
              ...productionEnv,
              EXPO_PUBLIC_GSAV_WEB_URL: "http://10.0.2.2:5191"
            }
          }
        }
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Production EXPO_PUBLIC_GSAV_WEB_URL must use https.");
    expect(result.errors).toContain("Production EXPO_PUBLIC_GSAV_WEB_URL must not point at localhost, emulator, link-local, or private LAN hosts.");
  });

  it("rejects IPv6 local and private production origins", () => {
    const result = validateNativeProductionConfig(baseConfig({
      easConfig: {
        build: {
          production: {
            env: {
              ...productionEnv,
              EXPO_PUBLIC_GSAV_WEB_URL: "https://[fd00::1]",
              EXPO_PUBLIC_GSAV_CATALOG_URL: "https://[fe80::1]/functions/v1/catalog",
              EXPO_PUBLIC_GSAV_SUPABASE_URL: "https://[::1]"
            }
          }
        }
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "Production EXPO_PUBLIC_GSAV_WEB_URL must not point at localhost, emulator, link-local, or private LAN hosts.",
      "Production EXPO_PUBLIC_GSAV_CATALOG_URL must not point at localhost, emulator, link-local, or private LAN hosts.",
      "Production EXPO_PUBLIC_GSAV_SUPABASE_URL must not point at localhost, emulator, link-local, or private LAN hosts.",
    ]));
  });

  it("rejects Android cleartext traffic in production config", () => {
    const result = validateNativeProductionConfig(baseConfig({
      appConfig: {
        expo: {
          version: "1.0.19",
          scheme: ["bilibili", "gsav"],
          android: {
            versionCode: 10019,
            usesCleartextTraffic: true
          }
        }
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("android.usesCleartextTraffic must be false or omitted for production builds.");
    expect(result.errors).toContain("app config must not include legacy URL schemes: bilibili.");
  });

  it("rejects QA-only flags in production env and EAS production profile", () => {
    const profileFlag = validateNativeProductionConfig(baseConfig({
      easConfig: {
        build: {
          production: {
            env: {
              ...productionEnv,
              EXPO_PUBLIC_GSAV_QA_CONTROLS: "1",
              EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "5000"
            }
          }
        }
      },
      env: {
        EXPO_PUBLIC_GSAV_QA_CONTROLS: "0",
        EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "0"
      }
    }));
    const directEnvFlag = validateNativeProductionConfig(baseConfig({
      env: {
        EXPO_PUBLIC_GSAV_QA_CONTROLS: "true",
        EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "2500"
      }
    }));

    for (const result of [profileFlag, directEnvFlag]) {
      expect(result.ok).toBe(false);
      expect(result.errors).toContain(
        "Production EXPO_PUBLIC_GSAV_QA_CONTROLS must be unset or 0 in both the environment and EAS production profile.",
      );
      expect(result.errors).toContain(
        "Production EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS must be unset or 0 in both the environment and EAS production profile.",
      );
      expect(result.checked.qaControlsDisabled).toBe(false);
      expect(result.checked.qaAuthDelayDisabled).toBe(false);
    }
  });

  it("rejects release workflows that set QA-only flags in any step", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: `${releaseWorkflowText}
jobs:
  unsafe-extra:
    steps:
      - env:
          EXPO_PUBLIC_GSAV_QA_CONTROLS: "1"
          EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS: "5000"
        run: npx expo prebuild --platform android --no-install
`,
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release workflow must not set EXPO_PUBLIC_GSAV_QA_CONTROLS or EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS in any build, prebuild, or verification step.",
    );
    expect(result.checked.releaseWorkflowForbidsQaFlags).toBe(false);
  });

  it("rejects missing release scripts and missing production GSAV URL", () => {
    const result = validateNativeProductionConfig(baseConfig({
      easConfig: {
        build: {
          production: {
            env: {
              EXPO_PUBLIC_APP_ENV: "production"
            }
          }
        }
      },
      packageJson: {
        scripts: {}
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("package.json must expose gsav:preflight.");
    expect(result.errors).toContain("package.json must expose android:version-metadata.");
    expect(result.errors).toContain("package.json must expose release-evidence:branch-protection.");
    expect(result.errors).toContain("package.json must expose verify:native-production-config.");
    expect(result.errors).toContain("package.json must expose verify:local.");
    expect(result.errors).toContain("package.json must expose verify:release-candidate.");
    expect(result.errors).toContain("package.json must expose verify:release-artifact.");
    expect(result.errors).toContain("package.json must expose verify:release-evidence-bundle.");
    expect(result.errors).toContain("package.json must expose verify:release-readiness.");
    expect(result.errors).toContain("Production must provide EXPO_PUBLIC_GSAV_WEB_URL in the environment or EAS production profile.");
    expect(result.errors).toContain("Production must provide EXPO_PUBLIC_GSAV_CATALOG_URL in the environment or EAS production profile.");
    expect(result.errors).toContain("Production must provide EXPO_PUBLIC_GSAV_SUPABASE_URL in the environment or EAS production profile.");
    expect(result.errors).toContain("Production must provide EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY in the environment or EAS production profile.");
  });

  it("rejects legacy URL schemes if they return to app config", () => {
    const result = validateNativeProductionConfig(baseConfig({
      appConfig: {
        expo: {
          version: "1.0.19",
          scheme: ["bilibili", "gsav"],
          android: {
            versionCode: 10019,
            usesCleartextTraffic: false
          }
        }
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("app config must not include legacy URL schemes: bilibili.");
  });

  it("rejects missing or mismatched Android version metadata", () => {
    const missing = validateNativeProductionConfig(baseConfig({
      expo: {
        version: "1.0.19",
        android: {
          usesCleartextTraffic: false
        }
      }
    }));
    const mismatched = validateNativeProductionConfig(baseConfig({
      expo: {
        version: "1.0.19",
        android: {
          versionCode: 10020,
          usesCleartextTraffic: false
        }
      }
    }));

    expect(missing.ok).toBe(false);
    expect(missing.errors).toContain("android.versionCode must be a positive integer for production builds.");
    expect(mismatched.ok).toBe(false);
    expect(mismatched.errors).toContain("android.versionCode must match expo.version (10019 for 1.0.19).");
  });

  it("rejects package and lockfile version drift from app config", () => {
    const result = validateNativeProductionConfig(baseConfig({
      packageJson: {
        version: "1.0.20",
        scripts: {
          "gsav:preflight": "node scripts/gsav-native-preflight.js",
          "verify:native-production-config": "node scripts/verify-native-production-config.js",
          "verify:release-artifact": "node scripts/verify-release-artifact.js",
          "verify:release-evidence-bundle": "node scripts/verify-release-evidence-bundle.js",
          "verify:release-readiness": "node scripts/verify-release-readiness.js"
        }
      },
      packageLockJson: {
        version: "1.0.18",
        packages: {
          "": {
            version: "1.0.17"
          }
        }
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("package.json version must match expo.version (1.0.19).");
    expect(result.errors).toContain("package-lock.json version must match expo.version (1.0.19).");
    expect(result.errors).toContain("package-lock.json root package version must match expo.version (1.0.19).");
  });

  it("rejects missing package-lock metadata", () => {
    const result = validateNativeProductionConfig(baseConfig({
      packageLockJson: null
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("package-lock.json must exist for production builds.");
  });

  it("rejects missing release dry-run workflow gates", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: `
on:
  push:
    branches:
      - master
`
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must expose workflow_dispatch for manual release dry runs.");
    expect(result.errors).toContain("release workflow must gate manual publishing behind the publish_release input.");
    expect(result.errors).toContain("release workflow must fail when publish_release=true and required production secrets are missing.");
    expect(result.errors).toContain("release workflow must upload verified release evidence artifacts.");
    expect(result.errors).toContain("release workflow must upload release-evidence command outputs.");
    expect(result.errors).toContain("release workflow must generate a release dry-run evidence summary.");
    expect(result.errors).toContain("release workflow must include release-evidence/dry-run-summary.json.");
    expect(result.errors).toContain("release workflow must include release-evidence/evidence-checksums.txt.");
    expect(result.errors).toContain("release workflow must verify the release evidence bundle before upload.");
    expect(result.errors).toContain("release workflow must capture generated APK version metadata through npm run android:version-metadata.");
    expect(result.errors).toContain("release workflow must include release-evidence/apk-version-metadata.txt.");
    expect(result.errors).toContain("release workflow must compare APK version metadata against the expected app versionCode.");
    expect(result.errors).toContain("release workflow must verify release readiness evidence before publishing.");
    expect(result.errors).toContain("release workflow must run strict handoff receipt verification before release readiness.");
    expect(result.errors).toContain("release workflow must run live last-mile release-state and publish-hash guards before release readiness.");
    expect(result.errors).toContain("release workflow must run production GSAV runtime smoke and capture release-evidence/gsav-runtime-smoke.json.");
    expect(result.errors).toContain("release workflow must capture authenticated gh release view not-found proof and fail inconclusive no-publish lookups.");
  });

  it("rejects release workflows without strict handoff receipt verification before readiness", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: releaseWorkflowText.replace(
        `      - if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        run: npm run verify:handoff-receipts -- --date "\${{ steps.publish_evidence_paths.outputs.evidence_date }}" --require-git-integrity
`,
        "",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must run strict handoff receipt verification before release readiness.");
    expect(result.checked.verifiesStrictHandoffReceiptsBeforeReadiness).toBe(false);
  });

  it("rejects release workflows whose handoff receipt verification omits git integrity", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: releaseWorkflowText.replace(" --require-git-integrity", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must run strict handoff receipt verification before release readiness.");
    expect(result.checked.verifiesStrictHandoffReceiptsBeforeReadiness).toBe(false);
  });

  it("rejects release workflows without live last-mile guards before readiness", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: releaseWorkflowText
        .replace("npm run release-evidence:github-release-state", "node scripts/missing-release-state.js")
        .replace("npm run release-evidence:publish-hash-guard", "node scripts/missing-publish-hash-guard.js"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must run live last-mile release-state and publish-hash guards before release readiness.");
    expect(result.checked.runsLastMilePrepublishGuardsBeforeReadiness).toBe(false);
  });

  it("rejects release workflows that treat inconclusive release lookups as no-publish proof", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: releaseWorkflowText
        .replace("            echo \"githubReleaseLookup=not_found\" | tee release-evidence/no-publish-side-effect.txt\n", "")
        .replace("            echo \"githubReleaseLookup=inconclusive\"\n", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must capture authenticated gh release view not-found proof and fail inconclusive no-publish lookups.");
    expect(result.checked.capturesAuthenticatedNoPublishProof).toBe(false);
  });

  it("rejects release workflows that omit concrete GSAV host identity evidence", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: releaseWorkflowText.replaceAll("          GSAV_HOSTING_COMMIT: deployed-gsav-commit\n", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must provide GSAV_HOSTING_COMMIT to preflight and runtime smoke evidence.");
    expect(result.checked.capturesGsavHostIdentity).toBe(false);
  });

  it("rejects release workflows that do not verify host-served GSAV identity metadata", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: releaseWorkflowText
        .replace("          GSAV_HOST_IDENTITY_URL: https://gsav.example.com/build.json\n", "")
        .replace("          GSAV_NATIVE_PREFLIGHT_REQUIRE_HOST_IDENTITY: \"1\"\n", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must verify host-served GSAV identity metadata during preflight.");
    expect(result.checked.verifiesGsavHostIdentityMetadata).toBe(false);
  });

  it("rejects release workflows that do not require the production range probe during preflight", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: releaseWorkflowText
        .replace("          GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE: \"1\"\n", "")
        .replace("          GSAV_NATIVE_PREFLIGHT_RANGE_URL: https://cdn.example.com/demo.gsav\n", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must require the GSAV range probe during production preflight.");
    expect(result.checked.verifiesRangeProbePreflight).toBe(false);
  });

  it("rejects release workflows that do not require browser-readable range CORS during preflight", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: releaseWorkflowText
        .replace("          GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS: \"1\"\n", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must require browser-readable range CORS headers during production preflight.");
    expect(result.checked.verifiesRangeCorsPreflight).toBe(false);
  });

  it("rejects release evidence bundle verifiers without exact range and authenticated no-publish checks", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseEvidenceBundleVerifierText: releaseEvidenceBundleVerifierText
        .replace("function exactRangeContentRange(value) {", "function weakRangeContentRange(value) {")
        .replace("githubReleaseLookup=not_found", "githubReleasePresent=false")
        .replace("gh release view must prove an authenticated not-found result", "must include githubReleasePresent=false"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release evidence bundle verifier must require exact rangeAsset.contentRange bytes 0-0/<size> evidence.");
    expect(result.errors).toContain("release evidence bundle verifier must require authenticated gh release view not-found proof for dry-run no-publish evidence.");
    expect(result.checked.verifiesExactRangeContentRange).toBe(false);
    expect(result.checked.verifiesAuthenticatedNoPublishLookup).toBe(false);
  });

  it("rejects release evidence bundle verifiers without browser-readable range CORS checks", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseEvidenceBundleVerifierText: releaseEvidenceBundleVerifierText
        .replace("function missingExposedRangeHeaders(value) {", "function weakMissingExposedRangeHeaders(value) {")
        .replace("rangeAsset.accessControlAllowOrigin must be present", "rangeAsset.status must be 206")
        .replace("rangeAsset.accessControlAllowOrigin must be * or match", "rangeAsset.status must be 206")
        .replace("rangeAsset.accessControlExposeHeaders must expose", "rangeAsset.acceptRanges must be bytes"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release evidence bundle verifier must require browser-readable range CORS headers.");
    expect(result.checked.verifiesRangeCorsHeaders).toBe(false);
  });

  it("rejects native preflight source without exact required range enforcement", () => {
    const result = validateNativeProductionConfig(baseConfig({
      nativePreflightText: nativePreflightText
        .replace("function exactRangeContentRange(value) {", "function weakRangeContentRange(value) {")
        .replace("configured range probe did not return exact Content-Range: bytes 0-0/<size>", "configured range probe did not return Content-Range"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("native preflight must require exact Content-Range bytes 0-0/<size> when GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE=1.");
    expect(result.checked.preflightRequiresExactRangeContentRange).toBe(false);
  });

  it("rejects native preflight source without required browser-readable range CORS enforcement", () => {
    const result = validateNativeProductionConfig(baseConfig({
      nativePreflightText: nativePreflightText
        .replace("function missingExposedRangeHeaders(value) {", "function weakMissingExposedRangeHeaders(value) {")
        .replace("Access-Control-Allow-Origin must be * or match the GSAV web origin", "Access-Control-Allow-Origin exists")
        .replace("configured range probe did not expose browser-readable range headers", "configured range probe did not return Access-Control-Allow-Origin"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("native preflight must require browser-readable range CORS headers when GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS=1.");
    expect(result.checked.preflightRequiresRangeCorsHeaders).toBe(false);
  });

  it("rejects release workflows that leave host identity metadata optional during preflight", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: releaseWorkflowText
        .replace("          GSAV_NATIVE_PREFLIGHT_REQUIRE_HOST_IDENTITY: \"1\"\n", "          GSAV_NATIVE_PREFLIGHT_REQUIRE_HOST_IDENTITY: \"0\"\n"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must verify host-served GSAV identity metadata during preflight.");
    expect(result.checked.verifiesGsavHostIdentityMetadata).toBe(false);
  });

  it("rejects release workflows that upload evidence without a dry-run summary and checksum manifest", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: `
on:
  workflow_dispatch:
    inputs:
      publish_release:
        type: boolean
jobs:
  release:
    steps:
      - uses: actions/upload-artifact@v4
        with:
          path: release-evidence/**
      - run: npm run verify:release-readiness
      - if: \${{ inputs.publish_release }}
`
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release workflow must generate a release dry-run evidence summary.",
      "release workflow must include release-evidence/dry-run-summary.json.",
      "release workflow must include release-evidence/evidence-checksums.txt.",
    ]));
  });

  it("rejects release workflows that do not pass dry-run or publish mode to the bundle verifier", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: releaseWorkflowText
        .replace("      - env:\n          RELEASE_EVIDENCE_MODE: ${{ (github.event_name == 'workflow_dispatch' && inputs.publish_release) && 'publish' || 'dry-run' }}\n        run: npm run verify:release-evidence-bundle -- --evidence-dir release-evidence --mode \"$RELEASE_EVIDENCE_MODE\"",
          "      - run: npm run verify:release-evidence-bundle -- --evidence-dir release-evidence"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must pass dry-run/publish mode to the release evidence bundle verifier.");
    expect(result.checked.verifiesReleaseEvidenceMode).toBe(false);
  });

  it("rejects release workflows that skip instead of failing publish intent when secrets are missing", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: `
on:
  workflow_dispatch:
    inputs:
      publish_release:
        type: boolean
jobs:
  gate:
    steps:
      - run: |
          echo "Missing production GSAV secrets; release skipped."
          echo "configured=false" >> "$GITHUB_OUTPUT"
  release:
    steps:
      - uses: actions/upload-artifact@v4
        with:
          path: release-evidence/**
      - run: |
          node scripts/write-release-evidence-summary.js
          test -s release-evidence/dry-run-summary.json
          test -s release-evidence/evidence-checksums.txt
      - run: |
          npm run android:version-metadata -- --apk-path app-release.apk --expected-version-code 10019 --output-path release-evidence/apk-version-metadata.txt
          test -s release-evidence/apk-version-metadata.txt
      - env:
          GSAV_RUNTIME_SMOKE_CHROMIUM_EXECUTABLE: /usr/bin/google-chrome
        run: npm run gsav:runtime-smoke -- --output-path release-evidence/gsav-runtime-smoke.json
      - run: npm run verify:release-readiness
      - if: \${{ inputs.publish_release }}
`
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must fail when publish_release=true and required production secrets are missing.");
  });

  it("rejects release workflows that do not capture generated APK version metadata", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: `
on:
  workflow_dispatch:
    inputs:
      publish_release:
        type: boolean
jobs:
  release:
    steps:
      - run: |
          node scripts/write-release-evidence-summary.js
          test -s release-evidence/dry-run-summary.json
          test -s release-evidence/evidence-checksums.txt
      - uses: actions/upload-artifact@v4
        with:
          path: release-evidence/**
      - run: npm run verify:release-readiness
      - if: \${{ inputs.publish_release }}
`
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release workflow must capture generated APK version metadata through npm run android:version-metadata.",
      "release workflow must include release-evidence/apk-version-metadata.txt.",
      "release workflow must compare APK version metadata against the expected app versionCode.",
    ]));
  });

  it("rejects release workflows that omit production runtime-smoke evidence", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: `
on:
  workflow_dispatch:
    inputs:
      publish_release:
        type: boolean
jobs:
  gate:
    steps:
      - env:
          PUBLISH_INTENT: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        run: |
          if [ "$PUBLISH_INTENT" = "true" ]; then
            echo "::error::Production GSAV secrets are required when publish_release=true"
            exit 1
          fi
  release:
    steps:
      - uses: actions/upload-artifact@v4
        with:
          path: release-evidence/**
      - run: |
          node scripts/write-release-evidence-summary.js
          test -s release-evidence/dry-run-summary.json
          test -s release-evidence/evidence-checksums.txt
      - run: |
          npm run android:version-metadata -- --apk-path app-release.apk --expected-version-code 10019 --output-path release-evidence/apk-version-metadata.txt
          test -s release-evidence/apk-version-metadata.txt
      - run: npm run verify:release-readiness
      - if: \${{ inputs.publish_release }}
`
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must run production GSAV runtime smoke and capture release-evidence/gsav-runtime-smoke.json.");
  });

  it("rejects release workflows that run runtime smoke without a CI Chromium executable", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: releaseWorkflowText.replace(
        "GSAV_RUNTIME_SMOKE_CHROMIUM_EXECUTABLE: /usr/bin/google-chrome",
        "GSAV_NATIVE_RUNTIME_SMOKE_TIMEOUT_MS: 30000",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must run production GSAV runtime smoke and capture release-evidence/gsav-runtime-smoke.json.");
  });

  it("rejects release workflows that do not require a frozen candidate ref", () => {
    const badWorkflow = releaseWorkflowText
      .replace("      candidate_ref:\n        type: string\n", "")
      .replaceAll("inputs.candidate_ref", "github.sha");
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: badWorkflow,
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must require a candidate_ref input for frozen payload release runs.");
  });

  it("rejects release workflows that do not verify the evidence signoff diff", () => {
    const badWorkflow = releaseWorkflowText
      .replaceAll("signoff-diff-files.txt", "unchecked-diff-files.txt")
      .replaceAll("git merge-base --is-ancestor", "git merge-base --not-enforced")
      .replaceAll("docs/GSAV_NATIVE_QA\\\\.md", "docs/ANYTHING.md");
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: badWorkflow,
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must verify evidence signoff commits only change QA/audit/evidence files.");
  });

  it("rejects release workflows that capture production host evidence before candidate identity", () => {
    const preflightBlock = "      - env:\n          RELEASE_CANDIDATE_SHA: ${{ steps.candidate.outputs.sha }}\n          GSAV_HOSTING_COMMIT: deployed-gsav-commit\n          GSAV_HOST_IDENTITY_URL: https://gsav.example.com/build.json\n          GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE: \"1\"\n          GSAV_NATIVE_PREFLIGHT_RANGE_URL: https://cdn.example.com/demo.gsav\n          GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS: \"1\"\n          GSAV_NATIVE_PREFLIGHT_REQUIRE_HOST_IDENTITY: \"1\"\n        run: |\n          npm run gsav:preflight -- --output-path release-evidence/gsav-preflight.json\n          test -s release-evidence/gsav-preflight.json\n";
    const runtimeBlock = "      - env:\n          GSAV_RUNTIME_SMOKE_CHROMIUM_EXECUTABLE: /usr/bin/google-chrome\n          GSAV_HOSTING_COMMIT: deployed-gsav-commit\n          RELEASE_CANDIDATE_SHA: ${{ steps.candidate.outputs.sha }}\n        run: |\n          npm run gsav:runtime-smoke -- --output-path release-evidence/gsav-runtime-smoke.json\n          test -s release-evidence/gsav-runtime-smoke.json\n";
    const badWorkflow = releaseWorkflowText
      .replace(preflightBlock, "")
      .replace(runtimeBlock, "")
      .replace(
        "      - run: |\n          echo \"releaseCandidateSha=${{ steps.candidate.outputs.sha }}\" | tee release-evidence/release-candidate.txt",
        `${preflightBlock}${runtimeBlock}      - run: |\n          echo "releaseCandidateSha=\${{ steps.candidate.outputs.sha }}" | tee release-evidence/release-candidate.txt`,
      );
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: badWorkflow,
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release workflow must run production GSAV preflight after capturing the release-candidate identity.",
      "release workflow must run production GSAV runtime smoke after capturing the release-candidate identity.",
    ]));
  });

  it("rejects release workflows that bump, commit, or push during release", () => {
    const badWorkflow = releaseWorkflowText.replace(
      "        run: npm run verify:release-readiness",
      `      - run: node scripts/bump-version.js
      - run: git commit -m "late version mutation"
      - run: git push
        run: npm run verify:release-readiness`,
    );
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: badWorkflow,
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release workflow must not run scripts/bump-version.js during release evidence or publish jobs.",
      "release workflow must not create git commits during release evidence or publish jobs.",
      "release workflow must not push from the release workflow; publish must consume an existing candidate/signoff commit.",
    ]));
  });

  it("rejects release workflows that do not target the verified candidate SHA", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseWorkflowText: releaseWorkflowText.replace(
        ` --target "\${{ steps.candidate.outputs.sha }}"`,
        "",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("release workflow must create the GitHub release with --target set to the verified release-candidate SHA.");
  });

  it("rejects release evidence bundle verifiers that do not validate signoff-diff contents", () => {
    const result = validateNativeProductionConfig(baseConfig({
      releaseEvidenceBundleVerifierText: `
function validateBundle() {
  return readText("release-evidence/signoff-diff-files.txt").length > 0;
}
`,
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release evidence bundle verifier must parse signoff-diff-files.txt and verify candidate/signoff identity and allowed changed files.",
    );
    expect(result.checked.verifiesSignoffDiffBundleContents).toBe(false);
  });

  it("rejects missing quality workflow production config placeholder audit", () => {
    const missingCommand = validateNativeProductionConfig(baseConfig({
      qualityWorkflowText: `
jobs:
  quality:
    steps:
      - run: npm run verify:docs-drift
`
    }));
    const missingEnv = validateNativeProductionConfig(baseConfig({
      qualityWorkflowText: `
jobs:
  quality:
    steps:
      - run: npm run verify:native-production-config
`
    }));

    expect(missingCommand.ok).toBe(false);
    expect(missingCommand.errors).toContain("quality workflow must run npm run verify:local.");
    expect(missingCommand.errors).toContain(
      "quality workflow must run verify:native-production-config with safe HTTPS placeholders.",
    );
    expect(missingEnv.ok).toBe(false);
    expect(missingEnv.errors).toEqual(expect.arrayContaining([
      "quality workflow must provide EXPO_PUBLIC_GSAV_WEB_URL for the production config placeholder audit.",
      "quality workflow must provide EXPO_PUBLIC_GSAV_CATALOG_URL for the production config placeholder audit.",
      "quality workflow must provide EXPO_PUBLIC_GSAV_SUPABASE_URL for the production config placeholder audit.",
      "quality workflow must provide EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY for the production config placeholder audit.",
    ]));
  });

  it("rejects unsafe catalog and Supabase production configuration", () => {
    const result = validateNativeProductionConfig(baseConfig({
      easConfig: {
        build: {
          production: {
            env: {
              ...productionEnv,
              EXPO_PUBLIC_GSAV_CATALOG_URL: "http://127.0.0.1:54321/functions/v1/catalog",
              EXPO_PUBLIC_GSAV_SUPABASE_URL: "http://192.168.1.10:54321",
              EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: ""
            }
          }
        }
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Production EXPO_PUBLIC_GSAV_CATALOG_URL must use https.");
    expect(result.errors).toContain("Production EXPO_PUBLIC_GSAV_CATALOG_URL must not point at localhost, emulator, link-local, or private LAN hosts.");
    expect(result.errors).toContain("Production EXPO_PUBLIC_GSAV_SUPABASE_URL must use https.");
    expect(result.errors).toContain("Production EXPO_PUBLIC_GSAV_SUPABASE_URL must not point at localhost, emulator, link-local, or private LAN hosts.");
    expect(result.errors).toContain("Production must provide EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY in the environment or EAS production profile.");
  });
});
