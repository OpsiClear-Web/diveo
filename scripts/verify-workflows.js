#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const WORKFLOW_DIR = path.join(".github", "workflows");
const REQUIRED_WORKFLOWS = ["ci.yml", "quality.yml", "release.yml", "device-validation.yml"];
const QA_ONLY_ENV_PATTERN = /\bEXPO_PUBLIC_GSAV_QA_(?:CONTROLS|AUTH_DELAY_MS)\b/;
const REQUIRED_QUALITY_ENV = [
  "EXPO_PUBLIC_GSAV_WEB_URL",
  "EXPO_PUBLIC_GSAV_CATALOG_URL",
  "EXPO_PUBLIC_GSAV_SUPABASE_URL",
  "EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY",
];
const REQUIRED_RELEASE_COMMANDS = [
  "npm run verify:native-production-config",
  "npm run gsav:preflight",
  "npm run gsav:runtime-smoke",
  "npm run verify:release-artifact",
  "npm run android:version-metadata",
  "scripts/write-release-evidence-summary.js",
  "npm run verify:release-evidence-bundle",
  "npm run verify:handoff-receipts",
  "npm run release-evidence:github-release-state",
  "npm run release-evidence:publish-hash-guard",
  "npm run verify:release-readiness",
];
const REQUIRED_RELEASE_UPLOAD_PATHS = [
  "release-evidence/**",
  "android/app/build/outputs/apk/release/app-release.apk",
  "android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml",
];
const PUBLISH_RELEASE_EXPRESSION = "${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}";
const DRY_RUN_NO_PUBLISH_EXPRESSION = "${{ github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && !inputs.publish_release) }}";
const RELEASE_EVIDENCE_MODE_EXPRESSION = "${{ (github.event_name == 'workflow_dispatch' && inputs.publish_release) && 'publish' || 'dry-run' }}";
const RELEASE_EVIDENCE_ARTIFACT_NAME = "diveo-release-evidence-v${{ steps.version.outputs.version }}";
const RELEASE_ORDERED_STEPS = [
  {
    name: "candidate",
    missingMessage: "release.yml: workflow must resolve and record the frozen payload candidate before evidence commands.",
    snippets: [
      "PAYLOAD_CANDIDATE_REF",
      "PUBLISH_INTENT",
      "release-evidence/signoff-diff-files.txt",
      "payloadCandidateSha",
      "evidenceSignoffSha",
      "protectedMasterSha",
      "protectedCandidateProof",
      "candidate_ref must be a full 40-hex payload commit SHA",
      "^[0-9a-f]{40}$",
      'echo "sha=$CANDIDATE_SHA" >> "$GITHUB_OUTPUT"',
      'echo "signoff_sha=$SIGNOFF_SHA" >> "$GITHUB_OUTPUT"',
      "git merge-base --is-ancestor",
      "git fetch --no-tags origin master",
      "origin/master",
      "candidate_ref must be reachable from protected origin/master before publish_release=true",
      "Only QA/audit/evidence files may change after candidate_ref",
    ],
  },
  {
    name: "version",
    missingMessage: "release.yml: workflow must capture version.txt before production evidence.",
    snippets: ["release-evidence/version.txt"],
  },
  {
    name: "candidate-identity",
    missingMessage: "release.yml: workflow must write release-evidence/release-candidate.txt before production preflight/runtime smoke.",
    snippets: [
      "release-evidence/release-candidate.txt",
      "releaseCandidateSha=${{ steps.candidate.outputs.sha }}",
      "evidenceSignoffSha=${{ steps.candidate.outputs.signoff_sha }}",
      "appVersion=",
      "packageVersion=",
      "androidVersionCode=",
    ],
  },
  {
    name: "preflight",
    missingMessage: "release.yml: workflow must run production preflight after release-candidate identity capture.",
    matches: (step) => (
      stepIncludesAll(step, [
        "npm run gsav:preflight",
        "--output-path release-evidence/gsav-preflight.json",
        "test -s release-evidence/gsav-preflight.json",
      ])
      && step?.env?.GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE === "1"
      && step?.env?.GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS === "1"
      && step?.env?.GSAV_NATIVE_PREFLIGHT_REQUIRE_HOST_IDENTITY === "1"
      && step?.env?.RELEASE_CANDIDATE_SHA === "${{ steps.candidate.outputs.sha }}"
    ),
  },
  {
    name: "runtime-smoke",
    missingMessage: "release.yml: workflow must run production runtime smoke after release-candidate identity capture.",
    matches: (step) => (
      stepIncludesAll(step, [
        "npm run gsav:runtime-smoke",
        "--output-path release-evidence/gsav-runtime-smoke.json",
        "test -s release-evidence/gsav-runtime-smoke.json",
      ])
      && step?.env?.GSAV_HOSTING_COMMIT === "${{ secrets.GSAV_HOSTING_COMMIT }}"
      && step?.env?.RELEASE_CANDIDATE_SHA === "${{ steps.candidate.outputs.sha }}"
    ),
  },
  {
    name: "artifact",
    missingMessage: "release.yml: workflow must verify the built release APK and merged manifest before evidence summary.",
    snippets: [
      "npm run verify:release-artifact",
      "android/app/build/outputs/apk/release/app-release.apk",
      "tee release-evidence/release-artifact.json",
    ],
  },
  {
    name: "apk-version-metadata",
    missingMessage: "release.yml: workflow must capture APK version metadata before evidence summary.",
    snippets: [
      "npm run android:version-metadata",
      "--apk-path android/app/build/outputs/apk/release/app-release.apk",
      "--expected-version-code",
      "--output-path release-evidence/apk-version-metadata.txt",
    ],
  },
  {
    name: "no-publish-proof",
    missingMessage: "release.yml: workflow must write dry-run no-publish side-effect proof before dry-run summary.",
    matches: (step) => (
      step?.if === DRY_RUN_NO_PUBLISH_EXPRESSION
      && stepIncludesAll(step, [
        "release-evidence/no-publish-side-effect.txt",
        "gh release view",
        "githubReleaseLookup=not_found",
        "githubReleasePresent=false",
        "git status --short",
        "git rev-parse HEAD",
        "git ls-remote origin",
      ])
    ),
  },
  {
    name: "summary",
    missingMessage: "release.yml: workflow must write dry-run-summary.json and evidence-checksums.txt after artifact evidence with candidate/range/publish env wired.",
    matches: (step) => (
      stepIncludesAll(step, [
        "scripts/write-release-evidence-summary.js",
        "--evidence-dir release-evidence",
        "--apk-path android/app/build/outputs/apk/release/app-release.apk",
        "--manifest-path android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml",
        `--artifact-name "${RELEASE_EVIDENCE_ARTIFACT_NAME}"`,
        '--release-version "${{ steps.version.outputs.version }}"',
        "test -s release-evidence/dry-run-summary.json",
        "test -s release-evidence/evidence-checksums.txt",
      ])
      && step?.env?.PUBLISH_RELEASE === PUBLISH_RELEASE_EXPRESSION
      && step?.env?.GSAV_RANGE_PROBE_URL === "${{ secrets.GSAV_RANGE_PROBE_URL }}"
      && step?.env?.RELEASE_CANDIDATE_SHA === "${{ steps.candidate.outputs.sha }}"
    ),
  },
  {
    name: "bundle",
    missingMessage: "release.yml: workflow must verify release evidence bundle with explicit dry-run/publish mode before upload.",
    matches: (step) => (
      stepIncludesAll(step, [
        "npm run verify:release-evidence-bundle",
        "--evidence-dir release-evidence",
        "--apk-path android/app/build/outputs/apk/release/app-release.apk",
        "--manifest-path android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml",
        '--mode "$RELEASE_EVIDENCE_MODE"',
      ])
      && step?.env?.RELEASE_EVIDENCE_MODE === RELEASE_EVIDENCE_MODE_EXPRESSION
    ),
  },
  {
    name: "publish-artifact-identity",
    missingMessage: "release.yml: workflow must verify publish artifact identity against expected dry-run APK and stable publish identity hashes before upload/readiness/release.",
    matches: (step) => (
      step?.if === PUBLISH_RELEASE_EXPRESSION
      && stepIncludesAll(step, [
        "crypto.createHash",
        "release-evidence/dry-run-summary.json",
        "android/app/build/outputs/apk/release/app-release.apk",
        "android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml",
        "publishArtifactIdentity:v2",
        "gsavPackageProvenanceSha256",
        "actualApk",
        "actualManifest",
        "actualIdentity",
        "summary.apkSha256",
        "summary.manifestSha256",
        "publishArtifactIdentitySha256",
        "^[0-9a-f]{64}$",
        "expected_apk_sha256",
        "expected_publish_identity_sha256",
        "validated dry-run artifact",
        "Generated publish APK SHA256 does not match dry-run-summary.json apkSha256",
        "Generated publish manifest SHA256 does not match dry-run-summary.json manifestSha256",
        "Generated publish APK SHA256 does not match expected_apk_sha256",
        "Generated publish artifact identity does not match dry-run-summary.json publishArtifactIdentitySha256",
        "Generated publish artifact identity does not match expected_publish_identity_sha256",
      ])
      && step?.env?.GITHUB_EVENT_NAME === "${{ github.event_name }}"
      && step?.env?.EXPECTED_APK_SHA256_INPUT === "${{ inputs.expected_apk_sha256 }}"
      && step?.env?.EXPECTED_PUBLISH_IDENTITY_SHA256_INPUT === "${{ inputs.expected_publish_identity_sha256 }}"
      && step?.env?.EXPECTED_RELEASE_APK_SHA256 === "${{ vars.EXPECTED_RELEASE_APK_SHA256 }}"
      && step?.env?.EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256 === "${{ vars.EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256 }}"
    ),
  },
  {
    name: "publish-evidence-paths",
    missingMessage: "release.yml: workflow must validate reviewed evidence inventory and device packet path inputs before upload/readiness/release.",
    matches: (step) => (
      step?.if === PUBLISH_RELEASE_EXPRESSION
      && stepIncludesAll(step, [
        "publish_release=true requires",
        "EXTERNAL_EVIDENCE_INVENTORY_PATH",
        "DEVICE_EVIDENCE_PACKET_PATH",
        "replace(/\\\\/g",
        "path.isAbsolute",
        "value.split",
        ".includes",
        "..",
        "must be a repository-relative reviewed evidence path under docs/qa-evidence/<date>/",
        "docs/qa-evidence/<date>",
        "external-evidence-inventory.json",
        "DEVICE_EVIDENCE_PACKET_PATH must be a JSON packet file",
        "scaffold, candidate, pending, or example packet",
        "inventory.date !== packet.date",
        "same docs/qa-evidence/<date> folder",
        "GITHUB_OUTPUT",
        "evidence_date=",
      ])
      && step?.id === "publish_evidence_paths"
      && step?.env?.EXTERNAL_EVIDENCE_INVENTORY_PATH === "${{ inputs.external_evidence_inventory_path }}"
      && step?.env?.DEVICE_EVIDENCE_PACKET_PATH === "${{ inputs.device_evidence_packet_path }}"
    ),
  },
  {
    name: "handoff-receipts",
    missingMessage: "release.yml: workflow must run strict handoff receipt verification before upload/readiness/release.",
    matches: (step) => (
      step?.if === PUBLISH_RELEASE_EXPRESSION
      && stepIncludesAll(step, [
        "npm run verify:handoff-receipts",
        "--date",
        "steps.publish_evidence_paths.outputs.evidence_date",
        "--require-git-integrity",
      ])
    ),
  },
  {
    name: "last-mile-release-state",
    missingMessage: "release.yml: workflow must capture last-mile GitHub release-state evidence before upload/readiness/release.",
    matches: (step) => (
      step?.if === PUBLISH_RELEASE_EXPRESSION
      && stepIncludesAll(step, [
        "npm run release-evidence:github-release-state",
        "--repo",
        "github.repository",
        "--output-path release-evidence/github-release-state-prepublish.json",
        "--reviewer",
        "github.actor",
        "--reviewed-at",
        "REVIEWED_AT",
      ])
      && step?.env?.GH_TOKEN === "${{ secrets.GITHUB_TOKEN }}"
    ),
  },
  {
    name: "last-mile-publish-hash-guard",
    missingMessage: "release.yml: workflow must capture last-mile publish-hash guard evidence before upload/readiness/release.",
    matches: (step) => (
      step?.if === PUBLISH_RELEASE_EXPRESSION
      && stepIncludesAll(step, [
        "npm run release-evidence:publish-hash-guard",
        "--repo",
        "github.repository",
        "--output-path release-evidence/publish-hash-variable-guard-prepublish.json",
        "--reviewer",
        "github.actor",
        "--reviewed-at",
        "REVIEWED_AT",
      ])
      && step?.env?.GH_TOKEN === "${{ secrets.GITHUB_TOKEN }}"
    ),
  },
  {
    name: "upload",
    missingMessage: "release.yml: workflow must upload verified release evidence after bundle verification.",
    matches: (step) => (
      typeof step?.uses === "string"
      && step.uses.includes("actions/upload-artifact@v4")
      && step?.with?.name === RELEASE_EVIDENCE_ARTIFACT_NAME
    ),
  },
  {
    name: "readiness",
    missingMessage: "release.yml: workflow must run release readiness with RELEASE_CANDIDATE_SHA, EXTERNAL_EVIDENCE_INVENTORY_PATH, and DEVICE_EVIDENCE_PACKET_PATH before creating a release.",
    matches: (step) => (
      stepIncludesAll(step, ["npm run verify:release-readiness"])
      && step?.if === PUBLISH_RELEASE_EXPRESSION
      && step?.env?.RELEASE_CANDIDATE_SHA === "${{ steps.candidate.outputs.sha }}"
      && step?.env?.EXTERNAL_EVIDENCE_INVENTORY_PATH === "${{ inputs.external_evidence_inventory_path }}"
      && step?.env?.DEVICE_EVIDENCE_PACKET_PATH === "${{ inputs.device_evidence_packet_path }}"
    ),
  },
];
const REQUIRED_DEVICE_VALIDATION_COMMANDS = [
  "node scripts/materialize-ios-validation-artifact.js",
  "npm run verify:validation-prereqs",
  "--root \"$DOWNLOADED_RELEASE_DIR\"",
  "npm run release-evidence:attach-validation-prereqs",
  "npm run verify:release-evidence-bundle",
  "--require-validation-prereqs true",
  "device-validation-evidence/device-validation-bundle-verifier.json",
  "npm run android:installed-smoke",
];
const REQUIRED_DEVICE_VALIDATION_UPLOAD_PATHS = [
  "downloaded-release/release-evidence/**",
  "device-validation-evidence/device-validation-bundle-verifier.json",
  "docs/qa-evidence/${{ inputs.evidence_date }}/android-installed-release-smoke.txt",
];
const DEVICE_VALIDATION_ARTIFACT_NAME = "diveo-device-validation-${{ inputs.evidence_date }}-${{ inputs.release_run_id }}";
const REQUIRED_DEVICE_VALIDATION_ENV = {
  DOWNLOADED_RELEASE_DIR: "downloaded-release",
  APK_PATH: "android/app/build/outputs/apk/release/app-release.apk",
  MANIFEST_PATH: "android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml",
  VALIDATION_PREREQS_PATH: "release-evidence/validation-prereqs.json",
  IOS_VALIDATION_OWNER: "${{ inputs.ios_validation_owner }}",
  IOS_VALIDATION_EXECUTOR_PROOF: "${{ inputs.ios_validation_executor_proof }}",
  IOS_VALIDATION_DEVICE: "${{ inputs.ios_validation_device }}",
  IOS_VALIDATION_VERSION: "${{ inputs.ios_validation_version }}",
  IOS_WKWEBVIEW_VERSION: "${{ inputs.ios_wkwebview_version }}",
  IOS_VALIDATION_ARTIFACT_URL: "${{ inputs.ios_validation_artifact_url }}",
  IOS_VALIDATION_ARTIFACT_SHA256: "${{ inputs.ios_validation_artifact_sha256 }}",
  IOS_VALIDATION_ARTIFACT_PATH: "${{ inputs.ios_validation_artifact_path }}",
};
const DEVICE_VALIDATION_ORDERED_STEPS = [
  {
    name: "validate-inputs",
    missingMessage: "device-validation.yml: workflow must validate workflow_dispatch release_run_id, artifact_name, evidence_date, and release_artifact_url before download.",
    matches: (step) => (
      stepIncludesAll(step, [
        "^\\d+$",
        "^diveo-release-evidence-v\\d+\\.\\d+\\.\\d+$",
        "parsedDate.toISOString().slice(0, 10) !== evidenceDate",
        "(?:opsiclear|opsiclear-web)\\/diveo",
        "actions\\/runs\\/\\d+",
        "actions\\/runs\\/\\d+\\/artifacts\\/\\d+",
        "releases\\/download\\/",
        "release_run_id must contain only digits",
        "artifact_name must match diveo-release-evidence-v<semver>",
        "evidence_date must be a valid YYYY-MM-DD date",
        "trusted Diveo GitHub Actions run, Actions artifact, or release asset download URL",
        "IOS_VALIDATION_ARTIFACT_URL",
        "IOS_VALIDATION_ARTIFACT_SHA256",
        "IOS_VALIDATION_ARTIFACT_PATH",
        "(?:(?:opsiclear|opsiclear-web)\\/diveo|opsiclear\\/gsav-hosting)",
        "actions\\/runs\\/\\d+\\/artifacts\\/[^",
        "releases\\/download\\/[^",
        "blob\\/[^",
        "ios_validation_artifact_url must be a trusted direct Diveo or opsiclear/gsav-hosting GitHub artifact, release asset download, or docs/qa-evidence blob",
        "ios_validation_artifact_sha256 must be a 64-hex SHA256",
        "ios_validation_artifact_path must be an artifact-root-relative path under release-evidence/",
        "^[a-f0-9]{64}$",
      ])
      && step?.env?.RELEASE_RUN_ID === "${{ inputs.release_run_id }}"
      && step?.env?.RELEASE_ARTIFACT_NAME === "${{ inputs.artifact_name }}"
      && step?.env?.EVIDENCE_DATE === "${{ inputs.evidence_date }}"
      && step?.env?.RELEASE_ARTIFACT_URL === "${{ inputs.release_artifact_url }}"
      && step?.env?.IOS_VALIDATION_ARTIFACT_URL === "${{ inputs.ios_validation_artifact_url }}"
      && step?.env?.IOS_VALIDATION_ARTIFACT_SHA256 === "${{ inputs.ios_validation_artifact_sha256 }}"
      && step?.env?.IOS_VALIDATION_ARTIFACT_PATH === "${{ inputs.ios_validation_artifact_path }}"
    ),
  },
  {
    name: "download",
    missingMessage: "device-validation.yml: workflow must download release evidence before device validation.",
    matches: (step) => typeof step?.uses === "string" && step.uses.includes("actions/download-artifact@v4"),
  },
  {
    name: "ios-artifact",
    missingMessage: "device-validation.yml: workflow must materialize byte-verified iOS validation artifact bytes before downloaded path verification.",
    matches: (step) => (
      stepIncludesAll(step, [
        "node scripts/materialize-ios-validation-artifact.js",
        '--url "$IOS_VALIDATION_ARTIFACT_URL"',
        '--output-path "$DOWNLOADED_RELEASE_DIR/$IOS_VALIDATION_ARTIFACT_PATH"',
        '--expected-sha256 "$IOS_VALIDATION_ARTIFACT_SHA256"',
        'test -s "$DOWNLOADED_RELEASE_DIR/$IOS_VALIDATION_ARTIFACT_PATH"',
      ])
      && step?.env?.GH_TOKEN === "${{ secrets.GITHUB_TOKEN }}"
      && step?.env?.GITHUB_TOKEN === "${{ secrets.GITHUB_TOKEN }}"
    ),
  },
  {
    name: "verify-paths",
    missingMessage: "device-validation.yml: workflow must verify downloaded APK, manifest, and release-evidence paths before validation.",
    snippets: [
      'test -s "$DOWNLOADED_RELEASE_DIR/$APK_PATH"',
      'test -s "$DOWNLOADED_RELEASE_DIR/$MANIFEST_PATH"',
      'test -s "$DOWNLOADED_RELEASE_DIR/$IOS_VALIDATION_ARTIFACT_PATH"',
      'test -d "$DOWNLOADED_RELEASE_DIR/release-evidence"',
    ],
  },
  {
    name: "verify-artifact-identity",
    missingMessage: "device-validation.yml: workflow must verify downloaded dry-run-summary.json artifactName, exact repository runUrl, and publishRelease=false before validation.",
    matches: (step) => (
      stepIncludesAll(step, [
        "release-evidence",
        "dry-run-summary.json",
        "summary.artifactName",
        "process.env.RELEASE_ARTIFACT_NAME",
        "summary.runUrl",
        "process.env.RELEASE_RUN_ID",
        "process.env.TRUSTED_RELEASE_REPOSITORY",
        "Untrusted release repository",
        "new URL(runUrl)",
        "expectedRunPath",
        "parsedRunUrl.protocol !== \"https:\"",
        "parsedRunUrl.hostname.toLowerCase() !== \"github.com\"",
        "parsedRunUrl.username",
        "parsedRunUrl.password",
        "parsedRunUrl.pathname.toLowerCase() !== expectedRunPath.toLowerCase()",
        "parsedRunUrl.search",
        "parsedRunUrl.hash",
        "summary.publishRelease !== false",
      ])
      && step?.env?.RELEASE_RUN_ID === "${{ inputs.release_run_id }}"
      && step?.env?.RELEASE_ARTIFACT_NAME === "${{ inputs.artifact_name }}"
      && step?.env?.TRUSTED_RELEASE_REPOSITORY === "${{ github.repository }}"
    ),
  },
  {
    name: "validation-prereqs",
    missingMessage: "device-validation.yml: workflow must run validation prerequisites with --root \"$DOWNLOADED_RELEASE_DIR\" and env-backed artifact paths.",
    snippets: [
      "npm run verify:validation-prereqs",
      '--root "$DOWNLOADED_RELEASE_DIR"',
      '--apk-path "$APK_PATH"',
      '--manifest-path "$MANIFEST_PATH"',
      '--ios-artifact-path "$IOS_VALIDATION_ARTIFACT_PATH"',
      '--output-path "$VALIDATION_PREREQS_PATH"',
      'test -s "$DOWNLOADED_RELEASE_DIR/$VALIDATION_PREREQS_PATH"',
    ],
  },
  {
    name: "attach-prereqs",
    missingMessage: "device-validation.yml: workflow must attach validation prerequisites with env-backed artifact paths.",
    snippets: [
      "npm run release-evidence:attach-validation-prereqs",
      '--root "$DOWNLOADED_RELEASE_DIR"',
      "--evidence-dir release-evidence",
      '--validation-prereqs-path "$VALIDATION_PREREQS_PATH"',
      '--apk-path "$APK_PATH"',
      '--manifest-path "$MANIFEST_PATH"',
    ],
  },
  {
    name: "strict-bundle",
    missingMessage: "device-validation.yml: workflow must re-verify the downloaded release evidence bundle with root, mode input, and strict validation prerequisites.",
    snippets: [
      "npm run verify:release-evidence-bundle",
      '--root "$DOWNLOADED_RELEASE_DIR"',
      "--evidence-dir release-evidence",
      '--apk-path "$APK_PATH"',
      '--manifest-path "$MANIFEST_PATH"',
      '--mode "${{ inputs.release_evidence_mode }}"',
      "--require-validation-prereqs true",
      "tee device-validation-evidence/device-validation-bundle-verifier.json",
    ],
  },
  {
    name: "installed-smoke",
    missingMessage: "device-validation.yml: workflow must install-smoke the downloaded APK with dry-run-summary identity and CI artifact URL.",
    snippets: [
      "npm run android:installed-smoke",
      '--apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH"',
      '--output-path "$QA_EVIDENCE_DIR/android-installed-release-smoke.txt"',
      '--dry-run-summary-path "$DOWNLOADED_RELEASE_DIR/release-evidence/dry-run-summary.json"',
      '--production-host-url "$PRODUCTION_HOST_URL"',
      '--ci-artifact-url "$CI_ARTIFACT_URL"',
    ],
  },
  {
    name: "upload",
    missingMessage: "device-validation.yml: workflow must upload device validation evidence after installed-smoke.",
    matches: (step) => typeof step?.uses === "string" && step.uses.includes("actions/upload-artifact@v4"),
  },
];

function workflowFiles(root) {
  const workflowDir = path.join(root, WORKFLOW_DIR);
  if (!fs.existsSync(workflowDir)) return [];
  return fs.readdirSync(workflowDir)
    .filter((fileName) => /\.ya?ml$/i.test(fileName))
    .sort()
    .map((fileName) => path.join(WORKFLOW_DIR, fileName).replace(/\\/g, "/"));
}

function parseWorkflow(relativePath, text) {
  const doc = YAML.parseDocument(text, { prettyErrors: false });
  const errors = doc.errors.map((error) => `${relativePath}: ${error.message}`);
  const warnings = doc.warnings.map((warning) => `${relativePath}: ${warning.message}`);
  let workflow = null;
  if (errors.length === 0) {
    try {
      workflow = doc.toJSON();
    } catch (error) {
      errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { workflow, errors, warnings };
}

function triggerConfig(workflow) {
  return workflow?.on ?? workflow?.["on"];
}

function jobsConfig(workflow) {
  return workflow?.jobs && typeof workflow.jobs === "object" ? workflow.jobs : null;
}

function hasOwn(object, key) {
  return Boolean(object && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key));
}

function jobEntries(workflow) {
  return Object.entries(jobsConfig(workflow) ?? {});
}

function stepEntries(job) {
  return Array.isArray(job?.steps) ? job.steps : [];
}

function stepsForWorkflow(workflow) {
  return jobEntries(workflow).flatMap(([, job]) => stepEntries(job));
}

function runCommands(workflow) {
  return jobEntries(workflow).flatMap(([, job]) => (
    stepEntries(job)
      .map((step) => (typeof step?.run === "string" ? step.run : ""))
      .filter(Boolean)
  ));
}

function runCommandIncludes(workflow, needle) {
  return runCommands(workflow).some((command) => command.includes(needle));
}

function commandIncludesAll(command, snippets) {
  return snippets.every((snippet) => command.includes(snippet));
}

function stepIncludesAll(step, snippets) {
  return typeof step?.run === "string" && commandIncludesAll(step.run, snippets);
}

function usesAction(workflow, needle) {
  return jobEntries(workflow).some(([, job]) => (
    stepEntries(job).some((step) => typeof step?.uses === "string" && step.uses.includes(needle))
  ));
}

function uploadArtifactPaths(workflow) {
  return jobEntries(workflow).flatMap(([, job]) => (
    stepEntries(job)
      .filter((step) => typeof step?.uses === "string" && step.uses.includes("actions/upload-artifact@v4"))
      .flatMap((step) => pathEntries(step?.with?.path))
  ));
}

function pathEntries(value) {
  if (Array.isArray(value)) {
    return value.flatMap(pathEntries);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\\/g, "/"));
}

function jobRunsOnIncludes(job, needle) {
  const runsOn = job?.["runs-on"];
  if (Array.isArray(runsOn)) {
    return runsOn.map(String).includes(needle);
  }
  return typeof runsOn === "string" && runsOn.includes(needle);
}

function hasReusableJob(workflow, jobName, reusablePath) {
  const job = jobsConfig(workflow)?.[jobName];
  return typeof job?.uses === "string" && job.uses === reusablePath;
}

function arrayEquals(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && expected.every((value, index) => actual[index] === value);
}

function validateWorkflowDispatchInput(relativePath, inputs, name, expected, errors) {
  const input = inputs?.[name];
  if (!input) {
    errors.push(`${relativePath}: workflow_dispatch must define ${name} input.`);
    return;
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actualValue = input[field];
    if (Array.isArray(expectedValue)) {
      if (!arrayEquals(actualValue, expectedValue)) {
        errors.push(`${relativePath}: workflow_dispatch input ${name}.${field} must be ${expectedValue.join(", ")}.`);
      }
    } else if (actualValue !== expectedValue) {
      errors.push(`${relativePath}: workflow_dispatch input ${name}.${field} must be ${expectedValue}.`);
    }
  }
}

function validateBasicWorkflow(relativePath, workflow, errors) {
  if (!workflow || typeof workflow !== "object") {
    errors.push(`${relativePath}: workflow must parse to an object.`);
    return;
  }
  if (typeof workflow.name !== "string" || workflow.name.trim() === "") {
    errors.push(`${relativePath}: workflow must have a non-empty name.`);
  }
  if (triggerConfig(workflow) === undefined) {
    errors.push(`${relativePath}: workflow must define on triggers.`);
  }
  const jobs = jobsConfig(workflow);
  if (!jobs || Object.keys(jobs).length === 0) {
    errors.push(`${relativePath}: workflow must define at least one job.`);
    return;
  }
  for (const [jobName, job] of Object.entries(jobs)) {
    if (!job || typeof job !== "object") {
      errors.push(`${relativePath}: job ${jobName} must be an object.`);
      continue;
    }
    if (typeof job.uses === "string") continue;
    if (!job["runs-on"]) {
      errors.push(`${relativePath}: job ${jobName} must define runs-on or uses.`);
    }
    const steps = stepEntries(job);
    if (steps.length === 0) {
      errors.push(`${relativePath}: job ${jobName} must define steps when it is not a reusable workflow job.`);
      continue;
    }
    steps.forEach((step, index) => {
      if (!step || typeof step !== "object") {
        errors.push(`${relativePath}: job ${jobName} step ${index + 1} must be an object.`);
        return;
      }
      if (typeof step.run !== "string" && typeof step.uses !== "string") {
        errors.push(`${relativePath}: job ${jobName} step ${index + 1} must define run or uses.`);
      }
    });
  }
}

function validateCiWorkflow(workflow, errors) {
  if (!hasReusableJob(workflow, "quality", "./.github/workflows/quality.yml")) {
    errors.push("ci.yml: quality job must call ./.github/workflows/quality.yml.");
  }
  const triggers = triggerConfig(workflow);
  if (!hasOwn(triggers, "pull_request")) {
    errors.push("ci.yml: workflow must run on pull_request.");
  }
  const pushBranches = triggers?.push?.branches;
  if (!Array.isArray(pushBranches) || !pushBranches.includes("master")) {
    errors.push("ci.yml: push trigger must include master.");
  }
}

function validateQualityWorkflow(workflow, errors) {
  const triggers = triggerConfig(workflow);
  if (!hasOwn(triggers, "workflow_call")) {
    errors.push("quality.yml: workflow must expose workflow_call.");
  }
  if (!runCommandIncludes(workflow, "npm run verify:local")) {
    errors.push("quality.yml: workflow must run npm run verify:local.");
  }
  const productionConfigStep = jobEntries(workflow).flatMap(([, job]) => stepEntries(job))
    .find((step) => typeof step?.run === "string" && step.run.includes("npm run verify:native-production-config"));
  if (!productionConfigStep) {
    errors.push("quality.yml: workflow must run npm run verify:native-production-config.");
    return;
  }
  const env = productionConfigStep.env && typeof productionConfigStep.env === "object"
    ? productionConfigStep.env
    : {};
  for (const name of REQUIRED_QUALITY_ENV) {
    if (!env[name]) {
      errors.push(`quality.yml: native production config placeholder audit must provide ${name}.`);
    }
  }
}

function validateReleaseWorkflow(workflow, rawText, errors) {
  if (!hasReusableJob(workflow, "quality", "./.github/workflows/quality.yml")) {
    errors.push("release.yml: quality job must call ./.github/workflows/quality.yml.");
  }
  const triggers = triggerConfig(workflow);
  const workflowDispatchInputs = triggers?.workflow_dispatch?.inputs ?? {};
  validateWorkflowDispatchInput("release.yml", workflowDispatchInputs, "candidate_ref", {
    required: true,
    type: "string",
  }, errors);
  validateWorkflowDispatchInput("release.yml", workflowDispatchInputs, "publish_release", {
    required: true,
    default: false,
    type: "boolean",
  }, errors);
  validateWorkflowDispatchInput("release.yml", workflowDispatchInputs, "expected_apk_sha256", {
    required: false,
    type: "string",
  }, errors);
  validateWorkflowDispatchInput("release.yml", workflowDispatchInputs, "expected_publish_identity_sha256", {
    required: false,
    type: "string",
  }, errors);
  validateWorkflowDispatchInput("release.yml", workflowDispatchInputs, "external_evidence_inventory_path", {
    required: false,
    type: "string",
  }, errors);
  validateWorkflowDispatchInput("release.yml", workflowDispatchInputs, "device_evidence_packet_path", {
    required: false,
    type: "string",
  }, errors);
  if (/scripts\/bump-version\.js|\bgit commit\b|\bgit push\b/.test(rawText)) {
    errors.push("release.yml: release workflow must not run version-bump, git commit, or git push side effects.");
  }
  if (QA_ONLY_ENV_PATTERN.test(rawText)) {
    errors.push("release.yml: release workflow must not mention EXPO_PUBLIC_GSAV_QA_CONTROLS or EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS.");
  }
  for (const command of REQUIRED_RELEASE_COMMANDS) {
    if (!runCommandIncludes(workflow, command)) {
      errors.push(`release.yml: workflow must run ${command}.`);
    }
  }
  if (!usesAction(workflow, "actions/upload-artifact@v4")) {
    errors.push("release.yml: workflow must upload release evidence with actions/upload-artifact@v4.");
  }
  const releaseUpload = stepsForWorkflow(workflow)
    .find((step) => typeof step?.uses === "string" && step.uses.includes("actions/upload-artifact@v4"));
  if (releaseUpload && releaseUpload?.with?.name !== RELEASE_EVIDENCE_ARTIFACT_NAME) {
    errors.push(`release.yml: release evidence upload artifact name must be ${RELEASE_EVIDENCE_ARTIFACT_NAME}.`);
  }
  if (releaseUpload && releaseUpload?.with?.["if-no-files-found"] !== "error") {
    errors.push("release.yml: release evidence upload must set if-no-files-found=error.");
  }
  const uploadedPaths = new Set(uploadArtifactPaths(workflow));
  for (const requiredPath of REQUIRED_RELEASE_UPLOAD_PATHS) {
    if (!uploadedPaths.has(requiredPath)) {
      errors.push(`release.yml: workflow must upload ${requiredPath}.`);
    }
  }
  if (!runCommandIncludes(workflow, "gh release create")) {
    errors.push("release.yml: workflow must create the GitHub release through gh release create after readiness passes.");
  }
  const jobs = jobsConfig(workflow) ?? {};
  for (const [jobName, job] of Object.entries(jobs)) {
    if (job?.permissions?.contents === "write" && jobName !== "publish") {
      errors.push("release.yml: only the publish job may use permissions.contents=write.");
    }
  }
  validateReleaseJobTokenWiring(jobs.release, errors);
  validateReleaseStepWiring(jobs.release, errors);
  validateReleasePublishJobWiring(jobs.publish, errors);
}

function validateDeviceValidationWorkflow(workflow, rawText, errors) {
  const triggers = triggerConfig(workflow);
  const workflowDispatchInputs = triggers?.workflow_dispatch?.inputs ?? {};
  for (const input of ["release_run_id", "artifact_name", "evidence_date"]) {
    validateWorkflowDispatchInput("device-validation.yml", workflowDispatchInputs, input, {
      required: true,
      type: "string",
    }, errors);
  }
  validateWorkflowDispatchInput("device-validation.yml", workflowDispatchInputs, "release_evidence_mode", {
    required: true,
    default: "dry-run",
    type: "choice",
    options: ["dry-run"],
  }, errors);
  validateWorkflowDispatchInput("device-validation.yml", workflowDispatchInputs, "release_artifact_url", {
    required: false,
    type: "string",
  }, errors);
  for (const input of [
    "ios_validation_owner",
    "ios_validation_executor_proof",
    "ios_validation_device",
    "ios_validation_version",
    "ios_wkwebview_version",
    "ios_validation_artifact_url",
    "ios_validation_artifact_sha256",
    "ios_validation_artifact_path",
  ]) {
    validateWorkflowDispatchInput("device-validation.yml", workflowDispatchInputs, input, {
      required: true,
      type: "string",
    }, errors);
  }

  const jobs = jobEntries(workflow);
  const deviceJob = jobs.find(([, job]) => jobRunsOnIncludes(job, "self-hosted") && jobRunsOnIncludes(job, "android"))?.[1];
  if (!deviceJob) {
    errors.push("device-validation.yml: device validation must run on a self-hosted Android runner.");
  } else {
    const env = deviceJob.env && typeof deviceJob.env === "object" ? deviceJob.env : {};
    for (const [name, expected] of Object.entries(REQUIRED_DEVICE_VALIDATION_ENV)) {
      if (env[name] !== expected) {
        errors.push(`device-validation.yml: workflow must set ${name}=${expected}.`);
      }
    }
  }

  for (const command of REQUIRED_DEVICE_VALIDATION_COMMANDS) {
    if (!runCommandIncludes(workflow, command)) {
      errors.push(`device-validation.yml: workflow must run ${command}.`);
    }
  }
  if (!usesAction(workflow, "actions/download-artifact@v4")) {
    errors.push("device-validation.yml: workflow must download release evidence with actions/download-artifact@v4.");
  }
  if (!usesAction(workflow, "actions/upload-artifact@v4")) {
    errors.push("device-validation.yml: workflow must upload device validation evidence with actions/upload-artifact@v4.");
  }
  validateDeviceValidationDownloadArtifactWiring(deviceJob ? stepEntries(deviceJob) : stepsForWorkflow(workflow), errors);

  const deviceValidationUpload = stepsForWorkflow(workflow)
    .find((step) => typeof step?.uses === "string" && step.uses.includes("actions/upload-artifact@v4"));
  if (deviceValidationUpload && deviceValidationUpload?.with?.name !== DEVICE_VALIDATION_ARTIFACT_NAME) {
    errors.push(`device-validation.yml: device validation upload artifact name must be ${DEVICE_VALIDATION_ARTIFACT_NAME}.`);
  }
  if (deviceValidationUpload && deviceValidationUpload?.with?.["if-no-files-found"] !== "error") {
    errors.push("device-validation.yml: device validation upload must set if-no-files-found=error.");
  }

  const uploadedPaths = new Set(uploadArtifactPaths(workflow));
  for (const requiredPath of REQUIRED_DEVICE_VALIDATION_UPLOAD_PATHS) {
    if (!uploadedPaths.has(requiredPath)) {
      if (requiredPath === "downloaded-release/release-evidence/**") {
        errors.push("device-validation.yml: workflow must upload the attached downloaded-release/release-evidence/** bundle.");
      } else if (requiredPath === "device-validation-evidence/device-validation-bundle-verifier.json") {
        errors.push("device-validation.yml: workflow must upload device-validation-bundle-verifier.json outside the attached release evidence bundle.");
      } else {
        errors.push("device-validation.yml: workflow must upload android-installed-release-smoke.txt evidence.");
      }
    }
  }
  if (rawText.includes("downloaded-release/release-evidence/device-validation-bundle-verifier.json")) {
    errors.push("device-validation.yml: device-validation-bundle-verifier.json must stay outside downloaded-release/release-evidence/**.");
  }
  if (rawText.includes("releases\\/tag") || rawText.includes("releases/tag")) {
    errors.push("device-validation.yml: ios_validation_artifact_url must not allow release tag pages; use direct release download assets.");
  }

  validateDeviceValidationStepWiring(deviceJob ? stepEntries(deviceJob) : stepsForWorkflow(workflow), errors);
}

function validateReleaseStepWiring(releaseJob, errors) {
  if (!releaseJob) {
    errors.push("release.yml: workflow must define a release job.");
    return;
  }
  const steps = stepEntries(releaseJob);
  const indexes = [];
  for (const requiredStep of RELEASE_ORDERED_STEPS) {
    const index = steps.findIndex((step) => (
      requiredStep.matches ? requiredStep.matches(step) : stepIncludesAll(step, requiredStep.snippets)
    ));
    if (index === -1) {
      errors.push(requiredStep.missingMessage);
    }
    indexes.push(index);
  }

  const presentIndexes = indexes.filter((index) => index !== -1);
  const inOrder = presentIndexes.every((index, arrayIndex) => arrayIndex === 0 || index > presentIndexes[arrayIndex - 1]);
  if (presentIndexes.length === indexes.length && !inOrder) {
    errors.push("release.yml: workflow steps must run in candidate, version, identity, preflight, runtime, artifact, metadata, no-publish-proof, summary, bundle, publish-artifact-identity, publish-evidence-paths, handoff-receipts, last-mile-release-state, last-mile-publish-hash-guard, upload, readiness order.");
  }
}

function validateReleaseJobTokenWiring(releaseJob, errors) {
  if (!releaseJob) return;
  if (releaseJob.permissions?.contents !== "read") {
    errors.push("release.yml: release build/evidence job must use permissions.contents=read.");
  }
  const checkoutStep = stepEntries(releaseJob)
    .find((step) => typeof step?.uses === "string" && step.uses.includes("actions/checkout@v4"));
  if (!checkoutStep) {
    errors.push("release.yml: release job must check out source before evidence commands.");
    return;
  }
  if (checkoutStep.with?.["persist-credentials"] !== false) {
    errors.push("release.yml: release job checkout must set persist-credentials=false.");
  }
  if (checkoutStep.with && Object.prototype.hasOwnProperty.call(checkoutStep.with, "token")) {
    errors.push("release.yml: release job checkout must not persist or override a write-capable token.");
  }
}

function validateReleasePublishJobWiring(publishJob, errors) {
  if (!publishJob) {
    errors.push("release.yml: workflow must define a separate publish job for gh release create.");
    return;
  }
  if (publishJob.if !== PUBLISH_RELEASE_EXPRESSION) {
    errors.push("release.yml: publish job must run only for manual workflow_dispatch publish_release=true.");
  }
  const needs = Array.isArray(publishJob.needs) ? publishJob.needs : [publishJob.needs].filter(Boolean);
  if (!needs.includes("release")) {
    errors.push("release.yml: publish job must depend on the release evidence job.");
  }
  if (publishJob.permissions?.contents !== "write") {
    errors.push("release.yml: publish job must be the only job with permissions.contents=write.");
  }
  const downloadStep = stepEntries(publishJob)
    .find((step) => typeof step?.uses === "string" && step.uses.includes("actions/download-artifact@v4"));
  if (!downloadStep) {
    errors.push("release.yml: publish job must download the verified release evidence artifact.");
  } else {
    if (downloadStep.with?.name !== "${{ needs.release.outputs.artifact_name }}") {
      errors.push("release.yml: publish job must download needs.release.outputs.artifact_name.");
    }
    if (downloadStep.with?.path !== "publish-release") {
      errors.push("release.yml: publish job must download release evidence to publish-release.");
    }
  }
  const releaseStep = stepEntries(publishJob)
    .find((step) => typeof step?.run === "string" && step.run.includes("gh release create"));
  if (!releaseStep) {
    errors.push("release.yml: publish job must create the GitHub release.");
    return;
  }
  if (releaseStep.env?.GH_TOKEN !== "${{ secrets.GITHUB_TOKEN }}") {
    errors.push("release.yml: publish job release step must set GH_TOKEN from secrets.GITHUB_TOKEN.");
  }
  if (!stepIncludesAll(releaseStep, [
    "test -s publish-release/android/app/build/outputs/apk/release/app-release.apk",
    'gh release create "v${{ needs.release.outputs.version }}"',
    '--target "${{ needs.release.outputs.candidate_sha }}"',
    "publish-release/android/app/build/outputs/apk/release/app-release.apk",
  ])) {
    errors.push("release.yml: publish job must create the release from the downloaded verified APK and frozen candidate SHA.");
  }
}

function validateDeviceValidationDownloadArtifactWiring(steps, errors) {
  const downloadStep = steps.find((step) => typeof step?.uses === "string" && step.uses.includes("actions/download-artifact@v4"));
  if (!downloadStep) return;
  const withConfig = downloadStep.with && typeof downloadStep.with === "object" ? downloadStep.with : {};
  const expected = {
    name: "${{ inputs.artifact_name }}",
    "run-id": "${{ inputs.release_run_id }}",
    "github-token": "${{ secrets.GITHUB_TOKEN }}",
    path: REQUIRED_DEVICE_VALIDATION_ENV.DOWNLOADED_RELEASE_DIR,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (withConfig[key] !== value) {
      errors.push(`device-validation.yml: download-artifact must set with.${key}=${value}.`);
    }
  }
}

function validateDeviceValidationStepWiring(steps, errors) {
  const indexes = [];
  for (const requiredStep of DEVICE_VALIDATION_ORDERED_STEPS) {
    const index = steps.findIndex((step) => (
      requiredStep.matches ? requiredStep.matches(step) : stepIncludesAll(step, requiredStep.snippets)
    ));
    if (index === -1) {
      errors.push(requiredStep.missingMessage);
    }
    indexes.push(index);
  }

  const presentIndexes = indexes.filter((index) => index !== -1);
  const inOrder = presentIndexes.every((index, arrayIndex) => arrayIndex === 0 || index > presentIndexes[arrayIndex - 1]);
  if (presentIndexes.length === indexes.length && !inOrder) {
    errors.push("device-validation.yml: workflow steps must run in input-validation, release-download, iOS-artifact-materialization, path-verify, artifact-identity, validation-prereq, attach, strict-bundle, installed-smoke, upload order.");
  }
}

function analyzeWorkflows(root) {
  const errors = [];
  const warnings = [];
  const files = workflowFiles(root);
  const workflows = new Map();

  for (const required of REQUIRED_WORKFLOWS) {
    const relativePath = path.join(WORKFLOW_DIR, required).replace(/\\/g, "/");
    if (!files.includes(relativePath)) {
      errors.push(`${relativePath}: required workflow is missing.`);
    }
  }

  for (const relativePath of files) {
    const absolutePath = path.join(root, relativePath);
    const text = fs.readFileSync(absolutePath, "utf8");
    const parsed = parseWorkflow(relativePath, text);
    errors.push(...parsed.errors);
    warnings.push(...parsed.warnings);
    if (!parsed.workflow) continue;
    validateBasicWorkflow(relativePath, parsed.workflow, errors);
    workflows.set(path.basename(relativePath), { workflow: parsed.workflow, text });
  }

  if (workflows.has("ci.yml")) validateCiWorkflow(workflows.get("ci.yml").workflow, errors);
  if (workflows.has("quality.yml")) validateQualityWorkflow(workflows.get("quality.yml").workflow, errors);
  if (workflows.has("release.yml")) {
    const release = workflows.get("release.yml");
    validateReleaseWorkflow(release.workflow, release.text, errors);
  }
  if (workflows.has("device-validation.yml")) {
    const deviceValidation = workflows.get("device-validation.yml");
    validateDeviceValidationWorkflow(deviceValidation.workflow, deviceValidation.text, errors);
  }

  return {
    ok: errors.length === 0,
    checkedFiles: files,
    errors,
    warnings,
  };
}

function main() {
  const result = analyzeWorkflows(process.cwd());
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
  REQUIRED_QUALITY_ENV,
  REQUIRED_DEVICE_VALIDATION_COMMANDS,
  REQUIRED_DEVICE_VALIDATION_UPLOAD_PATHS,
  REQUIRED_RELEASE_UPLOAD_PATHS,
  REQUIRED_RELEASE_COMMANDS,
  analyzeWorkflows,
  parseWorkflow,
  validateBasicWorkflow,
  validateCiWorkflow,
  validateQualityWorkflow,
  validateDeviceValidationWorkflow,
  validateReleaseWorkflow,
};
