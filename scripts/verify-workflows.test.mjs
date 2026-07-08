import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import verifier from "./verify-workflows.js";

const { analyzeWorkflows } = verifier;

const qualityWorkflow = `
name: Quality
on:
  workflow_call:
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run verify:local
      - env:
          EXPO_PUBLIC_GSAV_WEB_URL: https://gsav.example.com
          EXPO_PUBLIC_GSAV_CATALOG_URL: https://gsav.example.com/functions/v1/catalog
          EXPO_PUBLIC_GSAV_SUPABASE_URL: https://supabase.example.com
          EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: public-anon-key
        run: npm run verify:native-production-config
`;

const ciWorkflow = `
name: CI
on:
  pull_request:
  push:
    branches:
      - master
jobs:
  quality:
    uses: ./.github/workflows/quality.yml
`;

const releaseWorkflow = `
name: Release APK
on:
  push:
    branches:
      - master
  workflow_dispatch:
    inputs:
      candidate_ref:
        required: true
        type: string
      publish_release:
        required: true
        default: false
        type: boolean
      expected_apk_sha256:
        required: false
        type: string
      expected_publish_identity_sha256:
        required: false
        type: string
      external_evidence_inventory_path:
        required: false
        type: string
      device_evidence_packet_path:
        required: false
        type: string
jobs:
  quality:
    uses: ./.github/workflows/quality.yml
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      version: \${{ steps.version.outputs.version }}
      artifact_name: \${{ steps.version.outputs.artifact_name }}
      candidate_sha: \${{ steps.candidate.outputs.sha }}
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - id: candidate
        env:
          PUBLISH_INTENT: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        run: |
          PAYLOAD_CANDIDATE_REF=\${{ github.event_name == 'workflow_dispatch' && inputs.candidate_ref || github.sha }}
          mkdir -p release-evidence
          if ! printf '%s' "$PAYLOAD_CANDIDATE_REF" | grep -Eiq '^[0-9a-f]{40}$'; then
            echo "::error::candidate_ref must be a full 40-hex payload commit SHA"
            exit 1
          fi
          CANDIDATE_SHA=\$(git rev-parse "$PAYLOAD_CANDIDATE_REF^{commit}")
          SIGNOFF_SHA=\$(git rev-parse HEAD)
          echo "sha=$CANDIDATE_SHA" >> "$GITHUB_OUTPUT"
          echo "signoff_sha=$SIGNOFF_SHA" >> "$GITHUB_OUTPUT"
          echo "payloadCandidateRef=$PAYLOAD_CANDIDATE_REF" | tee release-evidence/signoff-diff-files.txt
          echo "payloadCandidateSha=$CANDIDATE_SHA" | tee -a release-evidence/signoff-diff-files.txt
          echo "evidenceSignoffSha=$SIGNOFF_SHA" | tee -a release-evidence/signoff-diff-files.txt
          git merge-base --is-ancestor "$PAYLOAD_CANDIDATE_REF" HEAD
          if [ "$PUBLISH_INTENT" = "true" ]; then
            git fetch --no-tags origin master
            PROTECTED_MASTER_SHA=\$(git rev-parse origin/master^{commit})
            echo "protectedMasterSha=$PROTECTED_MASTER_SHA" | tee -a release-evidence/signoff-diff-files.txt
            echo "protectedCandidateProof=git merge-base --is-ancestor $CANDIDATE_SHA origin/master" | tee -a release-evidence/signoff-diff-files.txt
            if ! git merge-base --is-ancestor "$CANDIDATE_SHA" origin/master; then
              echo "::error::candidate_ref must be reachable from protected origin/master before publish_release=true."
              exit 1
            fi
          fi
          DISALLOWED=\$(git diff --name-only "$PAYLOAD_CANDIDATE_REF..HEAD" | grep -Ev '^(docs/GSAV_NATIVE_QA\\.md|docs/IMPLEMENTATION_VALIDATION_AUDIT\\.md|docs/qa-evidence/)' || true)
          if [ -n "$DISALLOWED" ]; then
            echo "::error::Only QA/audit/evidence files may change after candidate_ref"
            exit 1
          fi
      - id: version
        run: |
          echo "1.0.19" | tee release-evidence/version.txt
          echo "version=1.0.19" >> "$GITHUB_OUTPUT"
          echo "artifact_name=diveo-release-evidence-v1.0.19" >> "$GITHUB_OUTPUT"
      - run: npm run verify:native-production-config
      - run: |
          echo "releaseCandidateSha=\${{ steps.candidate.outputs.sha }}" | tee release-evidence/release-candidate.txt
          echo "evidenceSignoffSha=\${{ steps.candidate.outputs.signoff_sha }}" | tee -a release-evidence/release-candidate.txt
          echo "appVersion=1.0.19" | tee -a release-evidence/release-candidate.txt
          echo "packageVersion=1.0.19" | tee -a release-evidence/release-candidate.txt
          echo "androidVersionCode=19" | tee -a release-evidence/release-candidate.txt
      - env:
          GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE: "1"
          GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS: "1"
          GSAV_NATIVE_PREFLIGHT_REQUIRE_HOST_IDENTITY: "1"
          RELEASE_CANDIDATE_SHA: \${{ steps.candidate.outputs.sha }}
        run: |
          npm run gsav:preflight -- --output-path release-evidence/gsav-preflight.json
          test -s release-evidence/gsav-preflight.json
      - env:
          GSAV_HOSTING_COMMIT: \${{ secrets.GSAV_HOSTING_COMMIT }}
          RELEASE_CANDIDATE_SHA: \${{ steps.candidate.outputs.sha }}
        run: |
          npm run gsav:runtime-smoke -- --output-path release-evidence/gsav-runtime-smoke.json
          test -s release-evidence/gsav-runtime-smoke.json
      - run: npm run verify:release-artifact -- android/app/build/outputs/apk/release/app-release.apk | tee release-evidence/release-artifact.json
      - run: npm run android:version-metadata -- --apk-path android/app/build/outputs/apk/release/app-release.apk --expected-version-code 10019 --output-path release-evidence/apk-version-metadata.txt
      - if: \${{ github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && !inputs.publish_release) }}
        run: |
          echo "mode=dry-run" | tee release-evidence/no-publish-side-effect.txt
          echo "git status --short:" | tee -a release-evidence/no-publish-side-effect.txt
          git status --short | tee -a release-evidence/no-publish-side-effect.txt
          echo "git rev-parse HEAD: \$(git rev-parse HEAD)" | tee -a release-evidence/no-publish-side-effect.txt
          echo "remote ref HEAD: \$(git ls-remote origin "\${GITHUB_REF_NAME}" | awk '{print $1}')" | tee -a release-evidence/no-publish-side-effect.txt
          echo "gh release view v1.0.19:" | tee -a release-evidence/no-publish-side-effect.txt
          gh release view v1.0.19 || true
          echo "githubReleaseLookup=not_found" | tee -a release-evidence/no-publish-side-effect.txt
          echo "githubReleasePresent=false" | tee -a release-evidence/no-publish-side-effect.txt
      - env:
          PUBLISH_RELEASE: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
          GSAV_RANGE_PROBE_URL: \${{ secrets.GSAV_RANGE_PROBE_URL }}
          RELEASE_CANDIDATE_SHA: \${{ steps.candidate.outputs.sha }}
        run: |
          node scripts/write-release-evidence-summary.js --evidence-dir release-evidence --apk-path android/app/build/outputs/apk/release/app-release.apk --manifest-path android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml --artifact-name "diveo-release-evidence-v\${{ steps.version.outputs.version }}" --release-version "\${{ steps.version.outputs.version }}"
          test -s release-evidence/dry-run-summary.json
          test -s release-evidence/evidence-checksums.txt
      - env:
          RELEASE_EVIDENCE_MODE: \${{ (github.event_name == 'workflow_dispatch' && inputs.publish_release) && 'publish' || 'dry-run' }}
        run: npm run verify:release-evidence-bundle -- --evidence-dir release-evidence --apk-path android/app/build/outputs/apk/release/app-release.apk --manifest-path android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml --mode "$RELEASE_EVIDENCE_MODE"
      - if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        env:
          GITHUB_EVENT_NAME: \${{ github.event_name }}
          EXPECTED_APK_SHA256_INPUT: \${{ inputs.expected_apk_sha256 }}
          EXPECTED_PUBLISH_IDENTITY_SHA256_INPUT: \${{ inputs.expected_publish_identity_sha256 }}
          EXPECTED_RELEASE_APK_SHA256: \${{ vars.EXPECTED_RELEASE_APK_SHA256 }}
          EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256: \${{ vars.EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256 }}
        run: |
          node <<'NODE'
          const crypto = require('node:crypto');
          const fs = require('node:fs');
          function sha256File(filePath) {
            return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
          }
          function sha256Text(text) {
            return crypto.createHash('sha256').update(text).digest('hex');
          }
          function publishArtifactIdentityText(summary) {
            return [
              'publishArtifactIdentity:v2',
              'releaseCandidateSha=' + (summary.releaseCandidateSha || ''),
              'releaseVersion=' + (summary.releaseVersion || ''),
              'appVersion=' + (summary.appVersion || ''),
              'packageVersion=' + (summary.packageVersion || ''),
              'androidVersionCode=' + (summary.androidVersionCode || ''),
              'artifactName=' + (summary.artifactName || ''),
              'apkSha256=' + (summary.apkSha256 || ''),
              'manifestSha256=' + (summary.manifestSha256 || ''),
              'gsavPackageProvenanceSha256=' + (summary.gsavPackageProvenanceSha256 || ''),
            ].join('\\n') + '\\n';
          }
          const source = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? 'input' : 'repository variable';
          const expectedApk = ((process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? process.env.EXPECTED_APK_SHA256_INPUT : process.env.EXPECTED_RELEASE_APK_SHA256) || '').trim().toLowerCase();
          const expectedIdentity = ((process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? process.env.EXPECTED_PUBLISH_IDENTITY_SHA256_INPUT : process.env.EXPECTED_RELEASE_PUBLISH_IDENTITY_SHA256) || '').trim().toLowerCase();
          if (!expectedApk || !/^[0-9a-f]{64}$/.test(expectedApk)) throw new Error('publish_release=true requires expected_apk_sha256 as a 64-hex SHA256 from the validated dry-run artifact (' + source + ').');
          if (!expectedIdentity || !/^[0-9a-f]{64}$/.test(expectedIdentity)) throw new Error('publish_release=true requires expected_publish_identity_sha256 as a 64-hex SHA256 from the validated dry-run artifact (' + source + ').');
          const summary = JSON.parse(fs.readFileSync('release-evidence/dry-run-summary.json', 'utf8'));
          const actualApk = sha256File('android/app/build/outputs/apk/release/app-release.apk');
          const actualManifest = sha256File('android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml');
          const actualIdentity = sha256Text(publishArtifactIdentityText(summary));
          if (String(summary.apkSha256 || '').toLowerCase() !== actualApk) throw new Error('Generated publish APK SHA256 does not match dry-run-summary.json apkSha256.');
          if (String(summary.manifestSha256 || '').toLowerCase() !== actualManifest) throw new Error('Generated publish manifest SHA256 does not match dry-run-summary.json manifestSha256.');
          if (actualApk !== expectedApk) throw new Error('Generated publish APK SHA256 does not match expected_apk_sha256 from the validated dry-run artifact.');
          if (String(summary.publishArtifactIdentitySha256 || '').toLowerCase() !== actualIdentity) throw new Error('Generated publish artifact identity does not match dry-run-summary.json publishArtifactIdentitySha256.');
          if (actualIdentity !== expectedIdentity) throw new Error('Generated publish artifact identity does not match expected_publish_identity_sha256 from the validated dry-run artifact.');
          NODE
      - id: publish_evidence_paths
        if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        env:
          EXTERNAL_EVIDENCE_INVENTORY_PATH: \${{ inputs.external_evidence_inventory_path }}
          DEVICE_EVIDENCE_PACKET_PATH: \${{ inputs.device_evidence_packet_path }}
        run: |
          node <<'NODE'
          const fs = require('node:fs');
          const path = require('node:path');
          const datedEvidencePrefixPattern = /^docs\\/qa-evidence\\/(\\d{4}-\\d{2}-\\d{2})\\//;
          const planningNamePattern = /(?:scaffold|candidate|pending|example)/i;
          function normalizePublishPath(envName) {
            const value = (process.env[envName] || '').trim().replace(/\\\\/g, '/');
            if (!value) throw new Error('publish_release=true requires ' + envName + '.');
            if (path.isAbsolute(value) || /^[A-Za-z]:\\//.test(value) || value.split('/').includes('..')) throw new Error(envName + ' must be a repository-relative reviewed evidence path under docs/qa-evidence/<date>/.');
            const match = value.match(datedEvidencePrefixPattern);
            if (!match) throw new Error(envName + ' must be a reviewed evidence path under docs/qa-evidence/<date>/.');
            return { value, date: match[1], basename: path.posix.basename(value) };
          }
          const inventory = normalizePublishPath('EXTERNAL_EVIDENCE_INVENTORY_PATH');
          const packet = normalizePublishPath('DEVICE_EVIDENCE_PACKET_PATH');
          if (inventory.basename !== 'external-evidence-inventory.json') throw new Error('EXTERNAL_EVIDENCE_INVENTORY_PATH must end with external-evidence-inventory.json.');
          if (!packet.basename.endsWith('.json')) throw new Error('DEVICE_EVIDENCE_PACKET_PATH must be a JSON packet file.');
          if (planningNamePattern.test(packet.basename)) throw new Error('DEVICE_EVIDENCE_PACKET_PATH must not reference a scaffold, candidate, pending, or example packet.');
          if (inventory.date !== packet.date) throw new Error('EXTERNAL_EVIDENCE_INVENTORY_PATH and DEVICE_EVIDENCE_PACKET_PATH must use the same docs/qa-evidence/<date> folder.');
          fs.appendFileSync(process.env.GITHUB_OUTPUT, \`evidence_date=\${inventory.date}\\n\`);
          NODE
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
          name: diveo-release-evidence-v\${{ steps.version.outputs.version }}
          if-no-files-found: error
          path: |
            release-evidence/**
            android/app/build/outputs/apk/release/app-release.apk
            android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml
      - env:
          RELEASE_CANDIDATE_SHA: \${{ steps.candidate.outputs.sha }}
          EXTERNAL_EVIDENCE_INVENTORY_PATH: \${{ inputs.external_evidence_inventory_path }}
          DEVICE_EVIDENCE_PACKET_PATH: \${{ inputs.device_evidence_packet_path }}
        if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        run: npm run verify:release-readiness
  publish:
    needs: [release]
    if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: \${{ needs.release.outputs.artifact_name }}
          path: publish-release
      - env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          test -s publish-release/android/app/build/outputs/apk/release/app-release.apk
          gh release create "v\${{ needs.release.outputs.version }}" --target "\${{ needs.release.outputs.candidate_sha }}" publish-release/android/app/build/outputs/apk/release/app-release.apk
`;

const downloadedArtifactIdentityStep = `
      - env:
          RELEASE_RUN_ID: \${{ inputs.release_run_id }}
          RELEASE_ARTIFACT_NAME: \${{ inputs.artifact_name }}
          TRUSTED_RELEASE_REPOSITORY: \${{ github.repository }}
        run: |
          node <<'NODE'
          const fs = require("node:fs");
          const p = process.env.DOWNLOADED_RELEASE_DIR + "/release-evidence/dry-run-summary.json";
          const summary = JSON.parse(fs.readFileSync(p, "utf8"));
          if (summary.artifactName !== process.env.RELEASE_ARTIFACT_NAME) throw new Error("artifact mismatch");
          const runUrl = String(summary.runUrl || "");
          const trustedRepository = String(process.env.TRUSTED_RELEASE_REPOSITORY || "");
          if (!/^(?:opsiclear|opsiclear-web)\\/diveo$/i.test(trustedRepository)) throw new Error("Untrusted release repository " + trustedRepository + ".");
          const expectedRunPath = "/" + trustedRepository + "/actions/runs/" + process.env.RELEASE_RUN_ID;
          const parsedRunUrl = new URL(runUrl);
          if (parsedRunUrl.protocol !== "https:" || parsedRunUrl.hostname.toLowerCase() !== "github.com" || parsedRunUrl.username || parsedRunUrl.password || parsedRunUrl.pathname.toLowerCase() !== expectedRunPath.toLowerCase() || parsedRunUrl.search || parsedRunUrl.hash) throw new Error("run mismatch");
          if (summary.publishRelease !== false) throw new Error("not a dry run");
          NODE
`;

const weakDownloadedArtifactIdentityStep = `
      - env:
          RELEASE_RUN_ID: \${{ inputs.release_run_id }}
          RELEASE_ARTIFACT_NAME: \${{ inputs.artifact_name }}
        run: |
          node -e "const fs=require('node:fs'); const p=process.env.DOWNLOADED_RELEASE_DIR + '/release-evidence/dry-run-summary.json'; const summary=JSON.parse(fs.readFileSync(p, 'utf8')); if (summary.artifactName !== process.env.RELEASE_ARTIFACT_NAME) throw new Error('artifact mismatch'); if (!String(summary.runUrl || '').includes('/actions/runs/' + process.env.RELEASE_RUN_ID)) throw new Error('run mismatch'); if (summary.publishRelease !== false) throw new Error('not a dry run');"
`;

const deviceValidationWorkflow = `
name: Device Validation
on:
  workflow_dispatch:
    inputs:
      release_run_id:
        required: true
        type: string
      artifact_name:
        required: true
        type: string
      evidence_date:
        required: true
        type: string
      release_evidence_mode:
        required: true
        default: dry-run
        type: choice
        options:
          - dry-run
      release_artifact_url:
        required: false
        type: string
      ios_validation_owner:
        required: true
        type: string
      ios_validation_executor_proof:
        required: true
        type: string
      ios_validation_device:
        required: true
        type: string
      ios_validation_version:
        required: true
        type: string
      ios_wkwebview_version:
        required: true
        type: string
      ios_validation_artifact_url:
        required: true
        type: string
      ios_validation_artifact_sha256:
        required: true
        type: string
      ios_validation_artifact_path:
        required: true
        type: string
jobs:
  android-device-validation:
    runs-on: [self-hosted, linux, android]
    env:
      DOWNLOADED_RELEASE_DIR: downloaded-release
      APK_PATH: android/app/build/outputs/apk/release/app-release.apk
      MANIFEST_PATH: android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml
      VALIDATION_PREREQS_PATH: release-evidence/validation-prereqs.json
      IOS_VALIDATION_OWNER: \${{ inputs.ios_validation_owner }}
      IOS_VALIDATION_EXECUTOR_PROOF: \${{ inputs.ios_validation_executor_proof }}
      IOS_VALIDATION_DEVICE: \${{ inputs.ios_validation_device }}
      IOS_VALIDATION_VERSION: \${{ inputs.ios_validation_version }}
      IOS_WKWEBVIEW_VERSION: \${{ inputs.ios_wkwebview_version }}
      IOS_VALIDATION_ARTIFACT_URL: \${{ inputs.ios_validation_artifact_url }}
      IOS_VALIDATION_ARTIFACT_SHA256: \${{ inputs.ios_validation_artifact_sha256 }}
      IOS_VALIDATION_ARTIFACT_PATH: \${{ inputs.ios_validation_artifact_path }}
    steps:
      - uses: actions/checkout@v4
      - env:
          RELEASE_RUN_ID: \${{ inputs.release_run_id }}
          RELEASE_ARTIFACT_NAME: \${{ inputs.artifact_name }}
          EVIDENCE_DATE: \${{ inputs.evidence_date }}
          RELEASE_ARTIFACT_URL: \${{ inputs.release_artifact_url }}
          IOS_VALIDATION_ARTIFACT_URL: \${{ inputs.ios_validation_artifact_url }}
          IOS_VALIDATION_ARTIFACT_SHA256: \${{ inputs.ios_validation_artifact_sha256 }}
          IOS_VALIDATION_ARTIFACT_PATH: \${{ inputs.ios_validation_artifact_path }}
        run: |
          node <<'NODE'
          const path = require("node:path");
          const runId = process.env.RELEASE_RUN_ID || "";
          const artifactName = process.env.RELEASE_ARTIFACT_NAME || "";
          const evidenceDate = process.env.EVIDENCE_DATE || "";
          const artifactUrl = process.env.RELEASE_ARTIFACT_URL || "";
          const iosArtifactUrl = process.env.IOS_VALIDATION_ARTIFACT_URL || "";
          const iosArtifactSha256 = process.env.IOS_VALIDATION_ARTIFACT_SHA256 || "";
          const iosArtifactPath = process.env.IOS_VALIDATION_ARTIFACT_PATH || "";
          const trustedEvidenceUrlPattern = /^https:\\/\\/github\\.com\\/(?:(?:opsiclear|opsiclear-web)\\/diveo|opsiclear\\/gsav-hosting)\\/(?:actions\\/runs\\/\\d+\\/artifacts\\/[^/\\s]+|releases\\/download\\/[^/\\s]+\\/[^/\\s]+|blob\\/[^/\\s]+\\/docs\\/qa-evidence\\/.+)$/i;

          if (!/^\\d+$/.test(runId)) {
            throw new Error("release_run_id must contain only digits.");
          }
          if (!/^diveo-release-evidence-v\\d+\\.\\d+\\.\\d+$/.test(artifactName)) {
            throw new Error("artifact_name must match diveo-release-evidence-v<semver>.");
          }
          const parsedDate = new Date(\`\${evidenceDate}T00:00:00.000Z\`);
          if (
            !/^\\d{4}-\\d{2}-\\d{2}$/.test(evidenceDate)
            || Number.isNaN(parsedDate.getTime())
            || parsedDate.toISOString().slice(0, 10) !== evidenceDate
          ) {
            throw new Error("evidence_date must be a valid YYYY-MM-DD date.");
          }
          if (
            artifactUrl
            && !/^https:\\/\\/github\\.com\\/(?:opsiclear|opsiclear-web)\\/diveo\\/(?:actions\\/runs\\/\\d+|actions\\/runs\\/\\d+\\/artifacts\\/\\d+|releases\\/download\\/[^/\\s]+\\/[^/\\s]+)$/i.test(artifactUrl)
          ) {
            throw new Error("release_artifact_url must be a trusted Diveo GitHub Actions run, Actions artifact, or release asset download URL.");
          }
          if (!trustedEvidenceUrlPattern.test(iosArtifactUrl)) {
            throw new Error("ios_validation_artifact_url must be a trusted direct Diveo or opsiclear/gsav-hosting GitHub artifact, release asset download, or docs/qa-evidence blob.");
          }
          if (!/^[a-f0-9]{64}$/i.test(iosArtifactSha256)) {
            throw new Error("ios_validation_artifact_sha256 must be a 64-hex SHA256.");
          }
          if (!iosArtifactPath || path.isAbsolute(iosArtifactPath) || iosArtifactPath.split(/[\\\\/]+/).includes("..") || !iosArtifactPath.replace(/\\\\/g, "/").startsWith("release-evidence/")) {
            throw new Error("ios_validation_artifact_path must be an artifact-root-relative path under release-evidence/.");
          }
          NODE
      - uses: actions/download-artifact@v4
        with:
          name: \${{ inputs.artifact_name }}
          run-id: \${{ inputs.release_run_id }}
          github-token: \${{ secrets.GITHUB_TOKEN }}
          path: downloaded-release
      - env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: node scripts/materialize-ios-validation-artifact.js --url "$IOS_VALIDATION_ARTIFACT_URL" --output-path "$DOWNLOADED_RELEASE_DIR/$IOS_VALIDATION_ARTIFACT_PATH" --expected-sha256 "$IOS_VALIDATION_ARTIFACT_SHA256" && test -s "$DOWNLOADED_RELEASE_DIR/$IOS_VALIDATION_ARTIFACT_PATH"
      - run: test -s "$DOWNLOADED_RELEASE_DIR/$APK_PATH" && test -s "$DOWNLOADED_RELEASE_DIR/$MANIFEST_PATH" && test -s "$DOWNLOADED_RELEASE_DIR/$IOS_VALIDATION_ARTIFACT_PATH" && test -d "$DOWNLOADED_RELEASE_DIR/release-evidence"
${downloadedArtifactIdentityStep}
      - run: npm run verify:validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --ios-artifact-path "$IOS_VALIDATION_ARTIFACT_PATH" --output-path "$VALIDATION_PREREQS_PATH" && test -s "$DOWNLOADED_RELEASE_DIR/$VALIDATION_PREREQS_PATH"
      - run: npm run release-evidence:attach-validation-prereqs -- --root "$DOWNLOADED_RELEASE_DIR" --evidence-dir release-evidence --validation-prereqs-path "$VALIDATION_PREREQS_PATH" --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH"
      - run: npm run verify:release-evidence-bundle -- --root "$DOWNLOADED_RELEASE_DIR" --evidence-dir release-evidence --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --mode "\${{ inputs.release_evidence_mode }}" --require-validation-prereqs true | tee device-validation-evidence/device-validation-bundle-verifier.json
      - run: npm run android:installed-smoke -- --apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH" --output-path "$QA_EVIDENCE_DIR/android-installed-release-smoke.txt" --dry-run-summary-path "$DOWNLOADED_RELEASE_DIR/release-evidence/dry-run-summary.json" --production-host-url "$PRODUCTION_HOST_URL" --ci-artifact-url "$CI_ARTIFACT_URL"
      - uses: actions/upload-artifact@v4
        with:
          name: diveo-device-validation-\${{ inputs.evidence_date }}-\${{ inputs.release_run_id }}
          if-no-files-found: error
          path: |
            downloaded-release/release-evidence/**
            device-validation-evidence/device-validation-bundle-verifier.json
            docs/qa-evidence/\${{ inputs.evidence_date }}/android-installed-release-smoke.txt
`;

function writeWorkflowSet(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-verify-"));
  const workflowDir = path.join(root, ".github", "workflows");
  fs.mkdirSync(workflowDir, { recursive: true });
  const files = {
    "ci.yml": ciWorkflow,
    "device-validation.yml": deviceValidationWorkflow,
    "quality.yml": qualityWorkflow,
    "release.yml": releaseWorkflow,
    ...overrides,
  };
  for (const [fileName, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(workflowDir, fileName), text);
  }
  return root;
}

function removePublishArtifactIdentityStep(text) {
  const start = text.indexOf("      - if: ${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}\n        env:\n          GITHUB_EVENT_NAME:");
  const end = text.indexOf("      - uses: actions/upload-artifact@v4", start);
  if (start === -1 || end === -1) throw new Error("publish artifact identity step fixture not found");
  return text.slice(0, start) + text.slice(end);
}

function removePublishEvidencePathStep(text) {
  const start = text.indexOf("      - id: publish_evidence_paths\n        if: ${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}\n        env:\n          EXTERNAL_EVIDENCE_INVENTORY_PATH:");
  const end = text.indexOf("      - uses: actions/upload-artifact@v4", start);
  if (start === -1 || end === -1) throw new Error("publish evidence path step fixture not found");
  return text.slice(0, start) + text.slice(end);
}

function removeReadinessEvidencePathEnv(text) {
  const before = `      - env:
          RELEASE_CANDIDATE_SHA: \${{ steps.candidate.outputs.sha }}
          EXTERNAL_EVIDENCE_INVENTORY_PATH: \${{ inputs.external_evidence_inventory_path }}
          DEVICE_EVIDENCE_PACKET_PATH: \${{ inputs.device_evidence_packet_path }}
        if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        run: npm run verify:release-readiness`;
  const after = `      - env:
          RELEASE_CANDIDATE_SHA: \${{ steps.candidate.outputs.sha }}
        if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        run: npm run verify:release-readiness`;
  if (!text.includes(before)) throw new Error("readiness evidence env fixture not found");
  return text.replace(before, after);
}

function moveUploadBeforePublishArtifactIdentity(text) {
  const publishStart = text.indexOf("      - if: ${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}\n        env:\n          GITHUB_EVENT_NAME:");
  const uploadStart = text.indexOf("      - uses: actions/upload-artifact@v4", publishStart);
  const uploadEnd = text.indexOf("      - env:\n          RELEASE_CANDIDATE_SHA:", uploadStart);
  if (publishStart === -1 || uploadStart === -1 || uploadEnd === -1) {
    throw new Error("release upload or publish artifact identity fixture not found");
  }
  const publishBlock = text.slice(publishStart, uploadStart);
  const uploadBlock = text.slice(uploadStart, uploadEnd);
  return text.slice(0, publishStart) + uploadBlock + publishBlock + text.slice(uploadEnd);
}

function removeDeviceDispatchValidationStep(text) {
  const start = text.indexOf("      - env:\n          RELEASE_RUN_ID: ${{ inputs.release_run_id }}");
  const end = text.indexOf("      - uses: actions/download-artifact@v4", start);
  if (start === -1 || end === -1) throw new Error("device dispatch validation fixture not found");
  return text.slice(0, start) + text.slice(end);
}

describe("workflow verifier", () => {
  it("accepts the required CI, quality, and release workflow shape", () => {
    const result = analyzeWorkflows(writeWorkflowSet());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.checkedFiles).toEqual([
      ".github/workflows/ci.yml",
      ".github/workflows/device-validation.yml",
      ".github/workflows/quality.yml",
      ".github/workflows/release.yml",
    ]);
  });

  it("rejects invalid workflow YAML", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "bad.yml": "name: Bad\non:\n  push:\njobs:\n  bad: [",
    }));

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.startsWith(".github/workflows/bad.yml:"))).toBe(true);
  });

  it("rejects quality workflow drift from the local bundle and production config audit", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "quality.yml": qualityWorkflow
        .replace("- run: npm run verify:local\n", "- run: npm test\n")
        .replace("          EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: public-anon-key\n", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "quality.yml: workflow must run npm run verify:local.",
      "quality.yml: native production config placeholder audit must provide EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY.",
    ]));
  });

  it("rejects release workflow QA flag injection", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow.replace(
        "- run: npm run verify:native-production-config",
        `- env:
          EXPO_PUBLIC_GSAV_QA_CONTROLS: "1"
        run: npm run verify:native-production-config`,
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: release workflow must not mention EXPO_PUBLIC_GSAV_QA_CONTROLS or EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS.",
    );
  });

  it("rejects release workflows that omit required production evidence commands", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace("  quality:\n    uses: ./.github/workflows/quality.yml\n", "")
        .replace("npm run gsav:runtime-smoke", "npm run gsav:smoke")
        .replace("      - uses: actions/upload-artifact@v4\n", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release.yml: quality job must call ./.github/workflows/quality.yml.",
      "release.yml: workflow must run npm run gsav:runtime-smoke.",
      "release.yml: workflow must upload release evidence with actions/upload-artifact@v4.",
    ]));
  });

  it("rejects release workflows with weak evidence mode or release target wiring", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace(
          "RELEASE_EVIDENCE_MODE: ${{ (github.event_name == 'workflow_dispatch' && inputs.publish_release) && 'publish' || 'dry-run' }}",
          "RELEASE_EVIDENCE_MODE: dry-run",
        )
        .replace(
          '--target "${{ needs.release.outputs.candidate_sha }}"',
          '--target "${{ github.sha }}"',
        ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release.yml: workflow must verify release evidence bundle with explicit dry-run/publish mode before upload.",
      "release.yml: publish job must create the release from the downloaded verified APK and frozen candidate SHA.",
    ]));
  });

  it("rejects release workflows that do not publish frozen-candidate outputs", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace('          echo "sha=$CANDIDATE_SHA" >> "$GITHUB_OUTPUT"\n', "")
        .replace('          echo "signoff_sha=$SIGNOFF_SHA" >> "$GITHUB_OUTPUT"\n', ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must resolve and record the frozen payload candidate before evidence commands.",
    );
  });

  it("rejects release workflows without protected master candidate proof before publish", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace("          PUBLISH_INTENT: ${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}\n", "")
        .replace("            git fetch --no-tags origin master\n", "")
        .replace("            PROTECTED_MASTER_SHA=$(git rev-parse origin/master^{commit})\n", "")
        .replace('            echo "protectedMasterSha=$PROTECTED_MASTER_SHA" | tee -a release-evidence/signoff-diff-files.txt\n', "")
        .replace('            echo "protectedCandidateProof=git merge-base --is-ancestor $CANDIDATE_SHA origin/master" | tee -a release-evidence/signoff-diff-files.txt\n', "")
        .replace("            if ! git merge-base --is-ancestor \"$CANDIDATE_SHA\" origin/master; then\n", "            if false; then\n")
        .replace("              echo \"::error::candidate_ref must be reachable from protected origin/master before publish_release=true.\"\n", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must resolve and record the frozen payload candidate before evidence commands.",
    );
  });

  it("rejects release workflows with weak dispatch input schema", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace("        default: false\n        type: boolean", "        type: string"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release.yml: workflow_dispatch input publish_release.default must be false.",
      "release.yml: workflow_dispatch input publish_release.type must be boolean.",
    ]));
  });

  it("rejects release workflows that omit expected publish artifact hash inputs", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace(`      expected_apk_sha256:
        required: false
        type: string
      expected_publish_identity_sha256:
        required: false
        type: string
`, ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release.yml: workflow_dispatch must define expected_apk_sha256 input.",
      "release.yml: workflow_dispatch must define expected_publish_identity_sha256 input.",
    ]));
  });

  it("rejects release workflows that omit reviewed evidence path inputs", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace(`      external_evidence_inventory_path:
        required: false
        type: string
      device_evidence_packet_path:
        required: false
        type: string
`, ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release.yml: workflow_dispatch must define external_evidence_inventory_path input.",
      "release.yml: workflow_dispatch must define device_evidence_packet_path input.",
    ]));
  });

  it("rejects release workflows that do not pass reviewed evidence paths into readiness", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": removeReadinessEvidencePathEnv(releaseWorkflow),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must run release readiness with RELEASE_CANDIDATE_SHA, EXTERNAL_EVIDENCE_INVENTORY_PATH, and DEVICE_EVIDENCE_PACKET_PATH before creating a release.",
    );
  });

  it("rejects release workflows with incomplete release-candidate identity metadata", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace('          echo "appVersion=1.0.19" | tee -a release-evidence/release-candidate.txt\n', "")
        .replace('          echo "packageVersion=1.0.19" | tee -a release-evidence/release-candidate.txt\n', ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must write release-evidence/release-candidate.txt before production preflight/runtime smoke.",
    );
  });

  it("rejects release workflows with weak summary writer env wiring", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace(
          "          GSAV_RANGE_PROBE_URL: ${{ secrets.GSAV_RANGE_PROBE_URL }}",
          "          GSAV_RANGE_PROBE_URL: https://gsav.example.com/test.gsav",
        )
        .replace(
          "          RELEASE_CANDIDATE_SHA: ${{ steps.candidate.outputs.sha }}\n        run: |\n          node scripts/write-release-evidence-summary.js",
          "          RELEASE_CANDIDATE_SHA: ${{ github.sha }}\n        run: |\n          node scripts/write-release-evidence-summary.js",
        ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must write dry-run-summary.json and evidence-checksums.txt after artifact evidence with candidate/range/publish env wired.",
    );
  });

  it("rejects release workflows that run dry-run no-publish proof outside dry-run contexts", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow.replace(
        "      - if: ${{ github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && !inputs.publish_release) }}\n        run: |",
        "      - run: |",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must write dry-run no-publish side-effect proof before dry-run summary.",
    );
  });

  it("rejects release workflows without publish artifact identity verification", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": removePublishArtifactIdentityStep(releaseWorkflow),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must verify publish artifact identity against expected dry-run APK and stable publish identity hashes before upload/readiness/release.",
    );
  });

  it("rejects release workflows with weak publish artifact identity hash wiring", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace(
          "EXPECTED_APK_SHA256_INPUT: ${{ inputs.expected_apk_sha256 }}",
          "EXPECTED_APK_SHA256_INPUT: ${{ vars.EXPECTED_RELEASE_APK_SHA256 }}",
        )
        .replace(
          "summary.apkSha256",
          "summary.sha256",
        ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must verify publish artifact identity against expected dry-run APK and stable publish identity hashes before upload/readiness/release.",
    );
  });

  it("rejects release workflows without publish evidence path validation", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": removePublishEvidencePathStep(releaseWorkflow),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must validate reviewed evidence inventory and device packet path inputs before upload/readiness/release.",
    );
  });

  it("rejects release workflows with weak publish evidence path validation", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace(
          "EXTERNAL_EVIDENCE_INVENTORY_PATH: ${{ inputs.external_evidence_inventory_path }}",
          "EXTERNAL_EVIDENCE_INVENTORY_PATH: docs/qa-evidence/2026-07-01/external-evidence-inventory.json",
        )
        .replace("external-evidence-inventory.json", "external-evidence-inventory-scaffold.json")
        .replace("scaffold, candidate, pending, or example packet", "temporary packet"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must validate reviewed evidence inventory and device packet path inputs before upload/readiness/release.",
    );
  });

  it("rejects release workflows that allow absolute or traversal evidence paths", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow.replace(
        "            if (path.isAbsolute(value) || /^[A-Za-z]:\\//.test(value) || value.split('/').includes('..')) throw new Error(envName + ' must be a repository-relative reviewed evidence path under docs/qa-evidence/<date>/.');\n",
        "",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must validate reviewed evidence inventory and device packet path inputs before upload/readiness/release.",
    );
  });

  it("rejects release workflows that do not require JSON device packets", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow.replace(
        "          if (!packet.basename.endsWith('.json')) throw new Error('DEVICE_EVIDENCE_PACKET_PATH must be a JSON packet file.');\n",
        "",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must validate reviewed evidence inventory and device packet path inputs before upload/readiness/release.",
    );
  });

  it("rejects release workflows that allow cross-date inventory and packet paths", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow.replace(
        "          if (inventory.date !== packet.date) throw new Error('EXTERNAL_EVIDENCE_INVENTORY_PATH and DEVICE_EVIDENCE_PACKET_PATH must use the same docs/qa-evidence/<date> folder.');\n",
        "",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must validate reviewed evidence inventory and device packet path inputs before upload/readiness/release.",
    );
  });

  it("rejects release workflows without strict handoff receipt verification", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow.replace(
        `      - if: \${{ github.event_name == 'workflow_dispatch' && inputs.publish_release }}
        run: npm run verify:handoff-receipts -- --date "\${{ steps.publish_evidence_paths.outputs.evidence_date }}" --require-git-integrity
`,
        "",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must run strict handoff receipt verification before upload/readiness/release.",
    );
  });

  it("rejects release workflows with weak handoff receipt date wiring", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow.replace(
        'npm run verify:handoff-receipts -- --date "${{ steps.publish_evidence_paths.outputs.evidence_date }}" --require-git-integrity',
        "npm run verify:handoff-receipts -- --date 2026-07-01",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must run strict handoff receipt verification before upload/readiness/release.",
    );
  });

  it("rejects release workflows whose handoff receipt replay omits git integrity", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow.replace(" --require-git-integrity", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must run strict handoff receipt verification before upload/readiness/release.",
    );
  });

  it("rejects release workflows without live last-mile prepublish evidence captures", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace(/      - if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.publish_release \}\}\n        env:\n          GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}\n        run: \|\n          REVIEWED_AT="\$\(date -u \+%Y-%m-%dT%H:%M:%SZ\)"\n          npm run release-evidence:github-release-state -- --repo "\$\{\{ github\.repository \}\}" --output-path release-evidence\/github-release-state-prepublish\.json --reviewer "\$\{\{ github\.actor \}\}" --reviewed-at "\$REVIEWED_AT"\n/, "")
        .replace(/      - if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.publish_release \}\}\n        env:\n          GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}\n        run: \|\n          REVIEWED_AT="\$\(date -u \+%Y-%m-%dT%H:%M:%SZ\)"\n          npm run release-evidence:publish-hash-guard -- --repo "\$\{\{ github\.repository \}\}" --output-path release-evidence\/publish-hash-variable-guard-prepublish\.json --reviewer "\$\{\{ github\.actor \}\}" --reviewed-at "\$REVIEWED_AT"\n/, ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release.yml: workflow must capture last-mile GitHub release-state evidence before upload/readiness/release.",
      "release.yml: workflow must capture last-mile publish-hash guard evidence before upload/readiness/release.",
    ]));
  });

  it("rejects release workflows that upload evidence before publish artifact identity verification", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": moveUploadBeforePublishArtifactIdentity(releaseWorkflow),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow steps must run in candidate, version, identity, preflight, runtime, artifact, metadata, no-publish-proof, summary, bundle, publish-artifact-identity, publish-evidence-paths, handoff-receipts, last-mile-release-state, last-mile-publish-hash-guard, upload, readiness order.",
    );
  });

  it("rejects release workflows that expose write credentials to the build/evidence job", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace("      contents: read", "      contents: write")
        .replace("          persist-credentials: false", "          token: ${{ secrets.GITHUB_TOKEN }}"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release.yml: only the publish job may use permissions.contents=write.",
      "release.yml: release build/evidence job must use permissions.contents=read.",
      "release.yml: release job checkout must set persist-credentials=false.",
      "release.yml: release job checkout must not persist or override a write-capable token.",
    ]));
  });

  it("rejects release workflows without the separate manual publish job", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow.replace(/  publish:[\s\S]*$/, ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: workflow must define a separate publish job for gh release create.",
    );
  });

  it("rejects release workflows with mismatched release evidence artifact names", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow
        .replace(
          '--artifact-name "diveo-release-evidence-v${{ steps.version.outputs.version }}"',
          '--artifact-name "custom-release-evidence-v${{ steps.version.outputs.version }}"',
        )
        .replace(
          "name: diveo-release-evidence-v${{ steps.version.outputs.version }}",
          "name: custom-release-evidence-v${{ steps.version.outputs.version }}",
        ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "release.yml: workflow must write dry-run-summary.json and evidence-checksums.txt after artifact evidence with candidate/range/publish env wired.",
      "release.yml: workflow must upload verified release evidence after bundle verification.",
      "release.yml: release evidence upload artifact name must be diveo-release-evidence-v${{ steps.version.outputs.version }}.",
    ]));
  });

  it("rejects release workflows that do not fail on missing uploaded evidence files", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "release.yml": releaseWorkflow.replace("          if-no-files-found: error\n", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "release.yml: release evidence upload must set if-no-files-found=error.",
    );
  });

  it("rejects device validation workflow drift from device-only evidence commands", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow
        .replace("runs-on: [self-hosted, linux, android]", "runs-on: ubuntu-latest")
        .replace(" --require-validation-prereqs true", "")
        .replace(" | tee device-validation-evidence/device-validation-bundle-verifier.json", "")
        .replace("            downloaded-release/release-evidence/**\n", "            docs/qa-evidence/**\n")
        .replace("            device-validation-evidence/device-validation-bundle-verifier.json\n", "")
        .replace("      - run: npm run release-evidence:attach-validation-prereqs -- --root \"$DOWNLOADED_RELEASE_DIR\" --evidence-dir release-evidence --validation-prereqs-path \"$VALIDATION_PREREQS_PATH\" --apk-path \"$APK_PATH\" --manifest-path \"$MANIFEST_PATH\"\n", "")
        .replace("actions/upload-artifact@v4", "actions/cache@v4"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "device-validation.yml: device validation must run on a self-hosted Android runner.",
      "device-validation.yml: workflow must run npm run release-evidence:attach-validation-prereqs.",
      "device-validation.yml: workflow must run --require-validation-prereqs true.",
      "device-validation.yml: workflow must run device-validation-evidence/device-validation-bundle-verifier.json.",
      "device-validation.yml: workflow must upload device validation evidence with actions/upload-artifact@v4.",
      "device-validation.yml: workflow must upload the attached downloaded-release/release-evidence/** bundle.",
      "device-validation.yml: workflow must upload device-validation-bundle-verifier.json outside the attached release evidence bundle.",
    ]));
  });

  it("rejects device validation workflows that omit installed-smoke upload evidence", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow
        .replace("            docs/qa-evidence/${{ inputs.evidence_date }}/android-installed-release-smoke.txt\n", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow must upload android-installed-release-smoke.txt evidence.",
    );
  });

  it("rejects device validation workflows with weak upload artifact names", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(
        "name: diveo-device-validation-${{ inputs.evidence_date }}-${{ inputs.release_run_id }}",
        "name: diveo-device-validation",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: device validation upload artifact name must be diveo-device-validation-${{ inputs.evidence_date }}-${{ inputs.release_run_id }}.",
    );
  });

  it("rejects device validation workflows that do not fail on missing uploaded evidence files", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace("          if-no-files-found: error\n", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: device validation upload must set if-no-files-found=error.",
    );
  });

  it("rejects device validation verifier output inside the attached release bundle", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replaceAll(
        "device-validation-evidence/device-validation-bundle-verifier.json",
        "downloaded-release/release-evidence/device-validation-bundle-verifier.json",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "device-validation.yml: workflow must run device-validation-evidence/device-validation-bundle-verifier.json.",
      "device-validation.yml: workflow must upload device-validation-bundle-verifier.json outside the attached release evidence bundle.",
      "device-validation.yml: device-validation-bundle-verifier.json must stay outside downloaded-release/release-evidence/**.",
    ]));
  });

  it("rejects device validation workflows with weak download-artifact wiring", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow
        .replace("          name: ${{ inputs.artifact_name }}", "          name: diveo-release-evidence")
        .replace("          run-id: ${{ inputs.release_run_id }}", "          run-id: ${{ github.run_id }}")
        .replace("          github-token: ${{ secrets.GITHUB_TOKEN }}", "          github-token: ${{ github.token }}")
        .replace("          path: downloaded-release", "          path: release-evidence"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "device-validation.yml: download-artifact must set with.name=${{ inputs.artifact_name }}.",
      "device-validation.yml: download-artifact must set with.run-id=${{ inputs.release_run_id }}.",
      "device-validation.yml: download-artifact must set with.github-token=${{ secrets.GITHUB_TOKEN }}.",
      "device-validation.yml: download-artifact must set with.path=downloaded-release.",
    ]));
  });

  it("rejects device validation workflows without dispatch input validation", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": removeDeviceDispatchValidationStep(deviceValidationWorkflow),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow must validate workflow_dispatch release_run_id, artifact_name, evidence_date, and release_artifact_url before download.",
    );
  });

  it("rejects device validation workflows with weak dispatch validation logic", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow
        .replace("!/^\\d+$/.test(runId)", "!runId")
        .replace("!/^diveo-release-evidence-v\\d+\\.\\d+\\.\\d+$/.test(artifactName)", "!artifactName")
        .replace("parsedDate.toISOString().slice(0, 10) !== evidenceDate", "false")
        .replace("actions\\/runs\\/\\d+\\/artifacts\\/\\d+", "artifacts"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow must validate workflow_dispatch release_run_id, artifact_name, evidence_date, and release_artifact_url before download.",
    );
  });

  it("rejects device validation workflows with generic release artifact URL wording", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(
        "trusted Diveo GitHub Actions run, Actions artifact, or release asset download URL",
        "trusted Diveo GitHub run, artifact, or release URL",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow must validate workflow_dispatch release_run_id, artifact_name, evidence_date, and release_artifact_url before download.",
    );
  });

  it("rejects device validation workflows that allow release tag pages for iOS artifact bytes", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(
        "|blob\\/[^/\\s]+\\/docs\\/qa-evidence\\/.+",
        "|releases\\/tag\\/[^/\\s]+|blob\\/[^/\\s]+\\/docs\\/qa-evidence\\/.+",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: ios_validation_artifact_url must not allow release tag pages; use direct release download assets.",
    );
  });

  it("rejects device validation workflows with weak dispatch input validation env", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(
        "RELEASE_RUN_ID: ${{ inputs.release_run_id }}",
        "RELEASE_RUN_ID: ${{ github.run_id }}",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow must validate workflow_dispatch release_run_id, artifact_name, evidence_date, and release_artifact_url before download.",
    );
  });

  it("rejects device validation workflows with weak release evidence mode schema", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow
        .replace("        default: dry-run\n", "")
        .replace("        options:\n          - dry-run\n", ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "device-validation.yml: workflow_dispatch input release_evidence_mode.default must be dry-run.",
      "device-validation.yml: workflow_dispatch input release_evidence_mode.options must be dry-run.",
    ]));
  });

  it("rejects device validation workflows without release artifact URL input declaration", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(`      release_artifact_url:
        required: false
        type: string
`, ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow_dispatch must define release_artifact_url input.",
    );
  });

  it("rejects device validation workflows without downloaded artifact identity verification", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(downloadedArtifactIdentityStep, ""),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow must verify downloaded dry-run-summary.json artifactName, exact repository runUrl, and publishRelease=false before validation.",
    );
  });

  it("rejects device validation workflows with substring-only downloaded runUrl verification", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(
        downloadedArtifactIdentityStep,
        weakDownloadedArtifactIdentityStep,
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow must verify downloaded dry-run-summary.json artifactName, exact repository runUrl, and publishRelease=false before validation.",
    );
  });

  it("rejects device validation workflows without iOS artifact materialization", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(
        `      - env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: node scripts/materialize-ios-validation-artifact.js --url "$IOS_VALIDATION_ARTIFACT_URL" --output-path "$DOWNLOADED_RELEASE_DIR/$IOS_VALIDATION_ARTIFACT_PATH" --expected-sha256 "$IOS_VALIDATION_ARTIFACT_SHA256" && test -s "$DOWNLOADED_RELEASE_DIR/$IOS_VALIDATION_ARTIFACT_PATH"
`,
        "",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "device-validation.yml: workflow must run node scripts/materialize-ios-validation-artifact.js.",
      "device-validation.yml: workflow must materialize byte-verified iOS validation artifact bytes before downloaded path verification.",
    ]));
  });

  it("rejects device validation workflows that do not pass a GitHub token to iOS artifact materialization", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(
        `      - env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: node scripts/materialize-ios-validation-artifact.js`,
        "      - run: node scripts/materialize-ios-validation-artifact.js",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow must materialize byte-verified iOS validation artifact bytes before downloaded path verification.",
    );
  });

  it("rejects device validation workflows with weak downloaded artifact identity env", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(
        "TRUSTED_RELEASE_REPOSITORY: ${{ github.repository }}",
        "TRUSTED_RELEASE_REPOSITORY: other/repo",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow must verify downloaded dry-run-summary.json artifactName, exact repository runUrl, and publishRelease=false before validation.",
    );
  });

  it("rejects device validation workflows that omit runUrl protocol or host checks", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(
        'parsedRunUrl.protocol !== "https:" || parsedRunUrl.hostname.toLowerCase() !== "github.com" || ',
        "",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow must verify downloaded dry-run-summary.json artifactName, exact repository runUrl, and publishRelease=false before validation.",
    );
  });

  it("rejects device validation workflows that allow runUrl query or fragment suffixes", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(
        " || parsedRunUrl.search || parsedRunUrl.hash",
        "",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow must verify downloaded dry-run-summary.json artifactName, exact repository runUrl, and publishRelease=false before validation.",
    );
  });

  it("rejects device validation workflows with weak artifact path wiring", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow
        .replace("APK_PATH: android/app/build/outputs/apk/release/app-release.apk", "APK_PATH: app-release.apk")
        .replace("--apk-path \"$APK_PATH\"", "--apk-path app-release.apk")
        .replace("--output-path \"$VALIDATION_PREREQS_PATH\"", "--output-path release-evidence/validation-prereqs.json")
        .replace("--validation-prereqs-path \"$VALIDATION_PREREQS_PATH\"", "--validation-prereqs-path release-evidence/validation-prereqs.json")
        .replace("--apk-path \"$DOWNLOADED_RELEASE_DIR/$APK_PATH\"", "--apk-path app-release.apk")
        .replace("--dry-run-summary-path \"$DOWNLOADED_RELEASE_DIR/release-evidence/dry-run-summary.json\"", "--dry-run-summary-path release-evidence/dry-run-summary.json"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "device-validation.yml: workflow must set APK_PATH=android/app/build/outputs/apk/release/app-release.apk.",
      "device-validation.yml: workflow must run validation prerequisites with --root \"$DOWNLOADED_RELEASE_DIR\" and env-backed artifact paths.",
      "device-validation.yml: workflow must attach validation prerequisites with env-backed artifact paths.",
      "device-validation.yml: workflow must install-smoke the downloaded APK with dry-run-summary identity and CI artifact URL.",
    ]));
  });

  it("rejects device validation workflows that do not verify prerequisite output placement", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow.replace(
        ' && test -s "$DOWNLOADED_RELEASE_DIR/$VALIDATION_PREREQS_PATH"',
        "",
      ),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow must run validation prerequisites with --root \"$DOWNLOADED_RELEASE_DIR\" and env-backed artifact paths.",
    );
  });

  it("rejects device validation workflows that smoke before strict bundle verification", () => {
    const smokeStep = '      - run: npm run android:installed-smoke -- --apk-path "$DOWNLOADED_RELEASE_DIR/$APK_PATH" --output-path "$QA_EVIDENCE_DIR/android-installed-release-smoke.txt" --dry-run-summary-path "$DOWNLOADED_RELEASE_DIR/release-evidence/dry-run-summary.json" --production-host-url "$PRODUCTION_HOST_URL" --ci-artifact-url "$CI_ARTIFACT_URL"\n';
    const bundleStep = '      - run: npm run verify:release-evidence-bundle -- --root "$DOWNLOADED_RELEASE_DIR" --evidence-dir release-evidence --apk-path "$APK_PATH" --manifest-path "$MANIFEST_PATH" --mode "${{ inputs.release_evidence_mode }}" --require-validation-prereqs true | tee device-validation-evidence/device-validation-bundle-verifier.json\n';
    const result = analyzeWorkflows(writeWorkflowSet({
      "device-validation.yml": deviceValidationWorkflow
        .replace(bundleStep, "")
        .replace(smokeStep, `${smokeStep}${bundleStep}`),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "device-validation.yml: workflow steps must run in input-validation, release-download, iOS-artifact-materialization, path-verify, artifact-identity, validation-prereq, attach, strict-bundle, installed-smoke, upload order.",
    );
  });

  it("rejects non-reusable jobs without runs-on or executable steps", () => {
    const result = analyzeWorkflows(writeWorkflowSet({
      "extra.yml": `
name: Extra
on:
  push:
jobs:
  broken:
    steps:
      - name: Missing action
`,
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      ".github/workflows/extra.yml: job broken must define runs-on or uses.",
      ".github/workflows/extra.yml: job broken step 1 must define run or uses.",
    ]));
  });
});
