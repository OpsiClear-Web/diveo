import { describe, expect, it } from "vitest";

import verifier from "./verify-dependency-audit.js";

const { analyzeAuditReport, isAcceptedRiskExpired, isConcreteOwner } = verifier;

function report(vulnerabilities, counts = {}) {
  return {
    vulnerabilities,
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 0,
        ...counts,
      },
    },
  };
}

describe("dependency audit verifier", () => {
  it("accepts the known Expo/Sentry moderate advisory set", () => {
    const result = analyzeAuditReport(report({
      expo: { name: "expo", severity: "moderate", isDirect: true, via: ["@expo/cli"] },
      "@sentry/react-native": { name: "@sentry/react-native", severity: "moderate", isDirect: true, via: ["expo"] },
      "@expo/cli": { name: "@expo/cli", severity: "moderate", isDirect: false, via: ["@expo/config"] },
      uuid: { name: "uuid", severity: "moderate", isDirect: false, via: [{ name: "uuid", source: 1 }] },
      xcode: { name: "xcode", severity: "moderate", isDirect: false, via: ["uuid"] },
    }, { moderate: 5, total: 5 }));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.acceptedRisk.owner).toBe("@opsiclear/native-release");
    expect(result.acceptedRisk.revisitBy).toBe("2026-07-31");
  });

  it("keeps the accepted risk valid through the revisit date", () => {
    expect(isAcceptedRiskExpired("2026-07-31", new Date("2026-07-31T23:59:59Z"))).toBe(false);
  });

  it("rejects placeholder accepted-risk owners", () => {
    expect(isConcreteOwner("@opsiclear/native-release")).toBe(true);
    expect(isConcreteOwner("native release owner")).toBe(false);

    const result = analyzeAuditReport(report({}, { total: 0 }), {
      acceptedRisk: {
        owner: "native release owner",
        reason: "temporary risk disposition",
        revisitBy: "2026-07-31",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("accepted dependency-audit risk must include a concrete owner.");
  });

  it("rejects the known advisory set after the accepted-risk revisit date", () => {
    const result = analyzeAuditReport(report({
      expo: { name: "expo", severity: "moderate", isDirect: true, via: ["@expo/cli"] },
    }, { moderate: 1, total: 1 }), {
      now: new Date("2026-08-01T00:00:00Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "accepted dependency-audit risk expired on 2026-07-31; renew the disposition or fix the advisories.",
    );
  });

  it("rejects high or critical advisories even for known package names", () => {
    const result = analyzeAuditReport(report({
      expo: { name: "expo", severity: "high", isDirect: true, via: ["@expo/cli"] },
    }, { high: 1, total: 1 }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "dependency audit must not contain high advisories; found 1.",
      "dependency advisory expo has unacceptable severity high.",
    ]));
  });

  it("rejects unexpected and unexpected direct advisories", () => {
    const result = analyzeAuditReport(report({
      "left-pad": { name: "left-pad", severity: "moderate", isDirect: true, via: ["left-pad"] },
      "expo-constants": { name: "expo-constants", severity: "moderate", isDirect: true, via: ["@expo/config"] },
    }, { moderate: 2, total: 2 }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "unexpected dependency advisory: left-pad",
      "unexpected direct dependency advisory: left-pad",
      "unexpected dependency advisory: expo-constants",
      "unexpected direct dependency advisory: expo-constants",
    ]));
  });
});
