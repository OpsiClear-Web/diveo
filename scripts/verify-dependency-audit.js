#!/usr/bin/env node
const { spawnSync } = require("node:child_process");

const allowedVulnerabilityNames = new Set([
  "@expo/cli",
  "@expo/config",
  "@expo/config-plugins",
  "@expo/local-build-cache-provider",
  "@expo/metro-config",
  "@expo/prebuild-config",
  "@sentry/react-native",
  "expo",
  "uuid",
  "xcode",
]);

const allowedDirectVulnerabilityNames = new Set([
  "@sentry/react-native",
  "expo",
]);

const acceptedRisk = {
  owner: "@opsiclear/native-release",
  reason: "Remaining advisories are Expo/Sentry tooling-chain findings after patch-level updates inside the current Expo SDK 55 range.",
  revisitBy: "2026-07-31",
};

function severityCount(metadata, severity) {
  return metadata?.vulnerabilities?.[severity] ?? 0;
}

function acceptedRiskExpiryDate(revisitBy) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(revisitBy);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1));
}

function isAcceptedRiskExpired(revisitBy, now = new Date()) {
  const expiry = acceptedRiskExpiryDate(revisitBy);
  return expiry ? now >= expiry : true;
}

function isConcreteOwner(owner) {
  if (typeof owner !== "string" || !owner.trim()) return false;
  return !/^(?:<.*>|owner|reviewer|release owner|native release owner|todo|tbd|pending|unassigned)$/i.test(owner.trim());
}

function analyzeAuditReport(report, options = {}) {
  const vulnerabilities = report?.vulnerabilities ?? {};
  const entries = Object.values(vulnerabilities);
  const errors = [];
  const now = options.now ?? new Date();
  const disposition = options.acceptedRisk ?? acceptedRisk;

  if (!isConcreteOwner(disposition.owner)) {
    errors.push("accepted dependency-audit risk must include a concrete owner.");
  }

  if (isAcceptedRiskExpired(disposition.revisitBy, now)) {
    errors.push(`accepted dependency-audit risk expired on ${disposition.revisitBy}; renew the disposition or fix the advisories.`);
  }

  for (const severity of ["critical", "high"]) {
    const count = severityCount(report.metadata, severity);
    if (count > 0) {
      errors.push(`dependency audit must not contain ${severity} advisories; found ${count}.`);
    }
  }

  for (const entry of entries) {
    if (!allowedVulnerabilityNames.has(entry.name)) {
      errors.push(`unexpected dependency advisory: ${entry.name}`);
    }
    if (entry.isDirect && !allowedDirectVulnerabilityNames.has(entry.name)) {
      errors.push(`unexpected direct dependency advisory: ${entry.name}`);
    }
    if (entry.severity === "critical" || entry.severity === "high") {
      errors.push(`dependency advisory ${entry.name} has unacceptable severity ${entry.severity}.`);
    }
  }

  const unexpectedMissing = [...allowedVulnerabilityNames].filter((name) => !vulnerabilities[name]);
  const accepted = entries
    .filter((entry) => allowedVulnerabilityNames.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      severity: entry.severity,
      direct: Boolean(entry.isDirect),
      via: Array.isArray(entry.via)
        ? entry.via.map((via) => (typeof via === "string" ? via : via.name ?? String(via.source ?? "unknown")))
        : [],
    }));

  return {
    ok: errors.length === 0,
    errors,
    acceptedRisk: disposition,
    accepted,
    missingAcceptedNames: unexpectedMissing,
    counts: report?.metadata?.vulnerabilities ?? {},
  };
}

function runNpmAudit() {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm audit --json"]
    : ["audit", "--json"];
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  const text = result.stdout || result.stderr || "";
  if (!text.trim()) {
    throw new Error("npm audit did not return output.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`npm audit did not return JSON: ${text.trim()}`);
  }
}

function main() {
  let report;
  try {
    report = runNpmAudit();
  } catch (error) {
    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(),
      status: "fail",
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const result = analyzeAuditReport(report);
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
  acceptedRisk,
  acceptedRiskExpiryDate,
  allowedDirectVulnerabilityNames,
  allowedVulnerabilityNames,
  analyzeAuditReport,
  isConcreteOwner,
  isAcceptedRiskExpired,
};
