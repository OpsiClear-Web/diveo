import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import verifier from "./verify-env-examples.js";

const {
  REQUIRED_NATIVE_ENV_KEYS,
  REQUIRED_PROFILE_GUIDANCE,
  analyzeEnvExampleText,
  hasSecretShape,
  isAllowedPlaceholderUrl,
  isPlaceholderValue,
  parseEnvExampleText,
  validateRepoRelativePath,
  verifyEnvExamples,
} = verifier;

function profileOrientedExample(overrides = {}) {
  const values = {
    EXPO_PUBLIC_GSAV_WEB_URL: "",
    EXPO_PUBLIC_GSAV_CATALOG_URL: "",
    EXPO_PUBLIC_GSAV_SUPABASE_URL: "",
    EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: "",
    EXPO_PUBLIC_APP_ENV: "",
    ...overrides,
  };

  return `# Copy to .env. EXPO_PUBLIC_* values are NOT secrets.
# For local development, prefer npm run stack:env or npm run dev:stack.
# Those commands use config/stack.local.json.

${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}
`;
}

describe("env example verifier", () => {
  it("parses comments and export assignments without treating quoted hashes as comments", () => {
    const parsed = parseEnvExampleText(`
# comment
export EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_GSAV_WEB_URL="http://localhost:5173/path # keep"
not an assignment
`);

    expect(parsed.invalidLines).toEqual([{ line: 5, text: "not an assignment" }]);
    expect(parsed.entries).toEqual([
      {
        key: "EXPO_PUBLIC_APP_ENV",
        line: 3,
        rawValue: "development",
        value: "development",
      },
      {
        key: "EXPO_PUBLIC_GSAV_WEB_URL",
        line: 4,
        rawValue: "\"http://localhost:5173/path # keep\"",
        value: "http://localhost:5173/path # keep",
      },
    ]);
  });

  it("rejects unsafe env example paths", () => {
    expect(validateRepoRelativePath(".env.example")).toBe(".env.example");
    expect(validateRepoRelativePath("config/example.env")).toBe("config/example.env");
    expect(() => validateRepoRelativePath("")).toThrow(/must not be empty/);
    expect(() => validateRepoRelativePath("../.env.example")).toThrow(/inside the repository/);
    expect(() => validateRepoRelativePath(path.resolve(".env.example"))).toThrow(/repo-relative/);
  });

  it("allows only obvious placeholders for example values", () => {
    expect(isAllowedPlaceholderUrl("https://gsav.example.com/functions/v1/catalog")).toBe(true);
    expect(isAllowedPlaceholderUrl("http://127.0.0.1:54321/functions/v1/catalog")).toBe(true);
    expect(isAllowedPlaceholderUrl("https://prod.opsiclear.invalid/functions/v1/catalog")).toBe(false);
    expect(isPlaceholderValue("public-anon-key")).toBe(true);
    expect(isPlaceholderValue("development")).toBe(true);
    expect(isPlaceholderValue("1234")).toBe(true);
    expect(isPlaceholderValue("real-production-value")).toBe(false);
  });

  it("detects common committed-secret shapes", () => {
    expect(hasSecretShape(["sk", "1234567890ABCDEFGHIJKLMNOP"].join("-"))).toBe(true);
    expect(hasSecretShape(["ghp", "1234567890abcdefghijklmnopqrst"].join("_"))).toBe(true);
    expect(hasSecretShape(["github", "pat", "1234567890abcdefghijklmnopqrst"].join("_"))).toBe(true);
    expect(hasSecretShape(["sbp", "1234567890abcdefghijklmnop"].join("_"))).toBe(true);
    expect(hasSecretShape(["xoxb", "1234567890", "abcdefghijklmnop"].join("-"))).toBe(true);
    expect(hasSecretShape(["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjMifQ", "signature"].join("."))).toBe(true);
    expect(hasSecretShape("A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6")).toBe(true);
    expect(hasSecretShape("public-anon-placeholder")).toBe(false);
  });

  it("accepts a profile-oriented env example with required keys", () => {
    const result = analyzeEnvExampleText(profileOrientedExample({
      EXPO_PUBLIC_GSAV_WEB_URL: "https://gsav.example.com",
      EXPO_PUBLIC_GSAV_CATALOG_URL: "https://gsav.example.com/functions/v1/catalog",
      EXPO_PUBLIC_GSAV_SUPABASE_URL: "https://supabase.example.com",
      EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: "public-anon-key",
      EXPO_PUBLIC_APP_ENV: "development",
    }), { filePath: ".env.example" });

    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.checked).toMatchObject({
      requiredKeys: REQUIRED_NATIVE_ENV_KEYS.length,
      presentRequiredKeys: REQUIRED_NATIVE_ENV_KEYS.length,
      profileGuidanceMarkers: REQUIRED_PROFILE_GUIDANCE.length,
      assignments: REQUIRED_NATIVE_ENV_KEYS.length,
    });
  });

  it("rejects missing profile guidance and required keys", () => {
    const result = analyzeEnvExampleText(`
# Copy to .env.
EXPO_PUBLIC_GSAV_WEB_URL=
`, { filePath: ".env.example" });

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([
      ".env.example is missing required native public env key EXPO_PUBLIC_GSAV_CATALOG_URL.",
      ".env.example is missing required native public env key EXPO_PUBLIC_APP_ENV.",
      ".env.example must mention profile guidance marker \"npm run stack:env\".",
      ".env.example must mention profile guidance marker \"config/stack.local.json\".",
      ".env.example must mention profile guidance marker \"NOT secrets\".",
    ]));
  });

  it("rejects real-looking values in examples", () => {
    const result = analyzeEnvExampleText(profileOrientedExample({
      EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
      EXPO_PUBLIC_GSAV_CATALOG_URL: "https://prod.opsiclear.invalid/functions/v1/catalog",
    }), { filePath: ".env.example" });

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([
      ".env.example:6 EXPO_PUBLIC_GSAV_CATALOG_URL must use an empty value or obvious placeholder.",
      ".env.example:8 EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY has a real-secret-looking value.",
    ]));
  });

  it("verifies a temporary repo env example", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diveo-env-examples-"));
    fs.writeFileSync(path.join(tmp, ".env.example"), profileOrientedExample());

    const result = verifyEnvExamples({ root: tmp });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("pass");
    expect(result.checked).toHaveLength(1);
    expect(result.problems).toEqual([]);
  });
});
