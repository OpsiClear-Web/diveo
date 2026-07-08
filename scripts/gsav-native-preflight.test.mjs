import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import preflight from "./gsav-native-preflight.js";

const {
  checkHostIdentity,
  checkRangeAsset,
  corsAllowOriginMatches,
  createConfig,
  exactRangeContentRange,
  extractHostIdentity,
  hasExposedHeader,
  identityMatches,
  missingExposedRangeHeaders,
  parseArgs,
  runPreflight,
  toUrl,
  writeJsonOutput,
} = preflight;

function headers(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    get(name) {
      return normalized.get(name.toLowerCase()) ?? null;
    },
  };
}

function response({ status = 200, text = "", headers: headerValues = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers(headerValues),
    async text() {
      return text;
    },
  };
}

describe("GSAV native preflight", () => {
  it("parses a durable JSON output path from args or env", () => {
    expect(parseArgs(["--output-path", "docs/qa-evidence/preflight.json"], {})).toEqual({
      outputPath: "docs/qa-evidence/preflight.json",
    });
    expect(parseArgs([], {
      GSAV_NATIVE_PREFLIGHT_OUTPUT_PATH: "release-evidence/gsav-preflight.json",
    })).toEqual({
      outputPath: "release-evidence/gsav-preflight.json",
    });
    expect(() => parseArgs(["--output-path"], {})).toThrow("--output-path requires a non-empty value");
  });

  it("writes durable JSON preflight evidence with parent directories", () => {
    const root = mkdtempSync(join(tmpdir(), "gsav-preflight-"));
    try {
      const outputPath = join(root, "nested", "preflight.json");
      const payload = { status: "pass", routeCount: 6 };

      expect(writeJsonOutput(outputPath, payload)).toBe(outputPath);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(payload);
      expect(readFileSync(outputPath, "utf8").endsWith("\n")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds route URLs from the configured base URL", () => {
    const config = createConfig({ EXPO_PUBLIC_GSAV_WEB_URL: "https://gsav.example.com/app/" });

    expect(config.baseUrl).toBe("https://gsav.example.com/app");
    expect(toUrl(config, "/watch/test?embed=native")).toBe("https://gsav.example.com/watch/test?embed=native");
  });

  it("checks routes and the configured production range probe", async () => {
    const calls = [];
    const config = createConfig({
      EXPO_PUBLIC_GSAV_WEB_URL: "https://gsav.example.com",
      GSAV_NATIVE_PREFLIGHT_RANGE_URL: "https://cdn.example.com/demo.gsav",
      GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE: "1",
    });
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith(".gsav")) {
        return response({
          status: 206,
          headers: {
            "accept-ranges": "bytes",
            "content-range": "bytes 0-0/2048",
            "content-length": "1",
          },
        });
      }
      return response({
        status: 200,
        text: '<div id="root"></div>',
        headers: {
          "content-type": "text/html",
        },
      });
    };

    const result = await runPreflight({
      config,
      routes: [{ name: "watch", path: "/watch/test?embed=native" }],
      fetchImpl,
      metadata: {
        nodeVersion: "v-test",
        npmVersion: "npm-test",
        diveoCommit: "abc1234",
        gsavHostingCommit: "def5678",
      },
    });

    expect(result).toMatchObject({
      nodeVersion: "v-test",
      npmVersion: "npm-test",
      diveoCommit: "abc1234",
      gsavHostingCommit: "def5678",
    });
    expect(result.routes).toHaveLength(1);
    expect(result.rangeAsset).toMatchObject({
      url: "https://cdn.example.com/demo.gsav",
      requestRange: "bytes=0-0",
      status: 206,
      acceptRanges: "bytes",
      contentRange: "bytes 0-0/2048",
      contentRangeExact: true,
    });
    expect(calls.at(-1).options.headers.Range).toBe("bytes=0-0");
  });

  it("fails a required production range probe without exact one-byte Content-Range", async () => {
    const config = createConfig({
      GSAV_NATIVE_PREFLIGHT_RANGE_URL: "https://cdn.example.com/demo.gsav",
      GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE: "1",
    });

    await expect(checkRangeAsset(config, async () => response({
      status: 206,
      headers: {
        "accept-ranges": "bytes",
        "content-range": "bytes 0-2047/2048",
      },
    }))).rejects.toThrow("configured range probe did not return exact Content-Range: bytes 0-0/<size>");
  });

  it("records non-exact optional local range behavior without failing local preflight", async () => {
    const config = createConfig({ EXPO_PUBLIC_GSAV_WEB_URL: "http://127.0.0.1:5191" });

    const result = await checkRangeAsset(config, async () => response({
      status: 206,
      headers: {
        "accept-ranges": "bytes",
        "content-range": "bytes 0-2047/2048",
      },
    }));

    expect(result).toMatchObject({
      requestRange: "bytes=0-0",
      status: 206,
      contentRange: "bytes 0-2047/2048",
      contentRangeExact: false,
      missingExposedHeaders: ["Accept-Ranges", "Content-Length", "Content-Range", "ETag"],
    });
  });

  it("checks host-served identity metadata when configured", async () => {
    const calls = [];
    const config = createConfig({
      EXPO_PUBLIC_GSAV_WEB_URL: "https://gsav.example.com",
      GSAV_NATIVE_PREFLIGHT_RANGE_URL: "https://cdn.example.com/demo.gsav",
      GSAV_HOST_IDENTITY_URL: "https://gsav.example.com/build.json",
    });
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith(".gsav")) {
        return response({
          status: 206,
          headers: {
            "accept-ranges": "bytes",
            "content-range": "bytes 0-0/2048",
          },
        });
      }
      if (url.endsWith("/build.json")) {
        return response({
          status: 200,
          text: JSON.stringify({ commit: "def5678" }),
          headers: {
            "content-type": "application/json",
          },
        });
      }
      return response({
        status: 200,
        text: '<div id="root"></div>',
      });
    };

    const result = await runPreflight({
      config,
      routes: [{ name: "watch", path: "/watch/test?embed=native" }],
      fetchImpl,
      metadata: {
        nodeVersion: "v-test",
        npmVersion: "npm-test",
        diveoCommit: "abc1234",
        gsavHostingCommit: "def5678",
      },
    });

    expect(result.hostIdentityVerified).toBe(true);
    expect(result.hostIdentity).toMatchObject({
      url: "https://gsav.example.com/build.json",
      status: 200,
      expectedIdentity: "def5678",
      observedIdentity: "def5678",
      matched: true,
    });
    expect(calls.at(-1).options.headers.Accept).toContain("application/json");
  });

  it("supports host identity extraction and prefix matching", () => {
    expect(exactRangeContentRange("bytes 0-0/2048")).toBe(true);
    expect(exactRangeContentRange("bytes 0-2047/2048")).toBe(false);
    expect(exactRangeContentRange("bytes 1-1/2048")).toBe(false);
    expect(extractHostIdentity({ gsavHostingCommit: "def5678" })).toBe("def5678");
    expect(extractHostIdentity({ buildSha: "abcdef123456" })).toBe("abcdef123456");
    expect(identityMatches("def5678", "def567890abcdef")).toBe(true);
    expect(identityMatches("def567890abcdef", "def5678")).toBe(true);
    expect(identityMatches("abc1234", "def5678")).toBe(false);
    expect(identityMatches("d", "def567890abcdef")).toBe(false);
  });

  it("fails when required host identity metadata is missing", async () => {
    const config = createConfig({
      GSAV_NATIVE_PREFLIGHT_REQUIRE_HOST_IDENTITY: "1",
    });

    await expect(checkHostIdentity(config, "def5678", async () => response())).rejects.toThrow(
      "GSAV_NATIVE_PREFLIGHT_REQUIRE_HOST_IDENTITY=1 but no GSAV_HOST_IDENTITY_URL was provided",
    );
  });

  it("fails when host identity metadata does not match the expected commit", async () => {
    const config = createConfig({
      GSAV_HOST_IDENTITY_URL: "https://gsav.example.com/build.json",
    });

    await expect(checkHostIdentity(config, "def5678", async () => response({
      status: 200,
      text: JSON.stringify({ commit: "abc1234" }),
      headers: {
        "content-type": "application/json",
      },
    }))).rejects.toThrow("host identity metadata did not match GSAV_HOSTING_COMMIT");
  });

  it("fails when a required range probe is missing", async () => {
    const config = createConfig({
      GSAV_NATIVE_PREFLIGHT_SKIP_LOCAL_ASSET: "1",
      GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE: "1",
    });

    await expect(checkRangeAsset(config, async () => response())).rejects.toThrow(
      "GSAV_NATIVE_PREFLIGHT_REQUIRE_RANGE_PROBE=1 but no GSAV_NATIVE_PREFLIGHT_RANGE_URL was provided",
    );
  });

  it("fails when CORS headers are required but missing on the range probe", async () => {
    const config = createConfig({
      EXPO_PUBLIC_GSAV_WEB_URL: "https://gsav.example.com",
      GSAV_NATIVE_PREFLIGHT_RANGE_URL: "https://cdn.example.com/demo.gsav",
      GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS: "1",
    });
    const calls = [];

    await expect(checkRangeAsset(config, async (url, options) => {
      calls.push({ url, options });
      return response({
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-range": "bytes 0-0/2048",
        },
      });
    })).rejects.toThrow("configured range probe did not return Access-Control-Allow-Origin");
    expect(calls[0].options.headers).toMatchObject({
      Origin: "https://gsav.example.com",
      Range: "bytes=0-0",
    });
  });

  it("fails when CORS exposed headers do not make range metadata browser-readable", async () => {
    const config = createConfig({
      GSAV_NATIVE_PREFLIGHT_RANGE_URL: "https://cdn.example.com/demo.gsav",
      GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS: "1",
    });

    await expect(checkRangeAsset(config, async () => response({
      status: 206,
      headers: {
        "accept-ranges": "bytes",
        "content-range": "bytes 0-0/2048",
        "content-length": "1",
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "Content-Range",
      },
    }))).rejects.toThrow(
      "configured range probe did not expose browser-readable range headers: Accept-Ranges, Content-Length, ETag",
    );
  });

  it("fails when CORS allow-origin does not match the GSAV web origin", async () => {
    const config = createConfig({
      EXPO_PUBLIC_GSAV_WEB_URL: "https://gsav.example.com",
      GSAV_NATIVE_PREFLIGHT_RANGE_URL: "https://cdn.example.com/demo.gsav",
      GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS: "1",
    });

    await expect(checkRangeAsset(config, async () => response({
      status: 206,
      headers: {
        "accept-ranges": "bytes",
        "content-range": "bytes 0-0/2048",
        "content-length": "1",
        etag: "\"abc123\"",
        "access-control-allow-origin": "https://wrong.example",
        "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range, ETag",
      },
    }))).rejects.toThrow("configured range probe Access-Control-Allow-Origin must be * or match the GSAV web origin");
  });

  it("passes required CORS when range headers are exposed to browsers", async () => {
    const config = createConfig({
      GSAV_NATIVE_PREFLIGHT_RANGE_URL: "https://cdn.example.com/demo.gsav",
      GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS: "1",
    });

    const result = await checkRangeAsset(config, async () => response({
      status: 206,
      headers: {
        "accept-ranges": "bytes",
        "content-range": "bytes 0-0/2048",
        "content-length": "1",
        etag: "\"abc123\"",
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range, ETag",
      },
    }));

    expect(result).toMatchObject({
      accessControlAllowOrigin: "*",
      accessControlExposeHeaders: "Accept-Ranges, Content-Length, Content-Range, ETag",
      missingExposedHeaders: [],
    });
    expect(hasExposedHeader(result.accessControlExposeHeaders, "content-range")).toBe(true);
    expect(missingExposedRangeHeaders(result.accessControlExposeHeaders)).toEqual([]);
    expect(corsAllowOriginMatches("*", config.baseUrl)).toBe(true);
    expect(corsAllowOriginMatches("https://wrong.example", config.baseUrl)).toBe(false);
  });

  it("passes required CORS when allow-origin matches the GSAV web origin", async () => {
    const config = createConfig({
      EXPO_PUBLIC_GSAV_WEB_URL: "https://gsav.example.com",
      GSAV_NATIVE_PREFLIGHT_RANGE_URL: "https://cdn.example.com/demo.gsav",
      GSAV_NATIVE_PREFLIGHT_REQUIRE_CORS: "1",
    });
    const calls = [];

    const result = await checkRangeAsset(config, async (url, options) => {
      calls.push({ url, options });
      return response({
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-range": "bytes 0-0/2048",
          "content-length": "1",
          etag: "\"abc123\"",
          "access-control-allow-origin": "https://gsav.example.com",
          "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range, ETag",
        },
      });
    });

    expect(result.accessControlAllowOrigin).toBe("https://gsav.example.com");
    expect(corsAllowOriginMatches(result.accessControlAllowOrigin, config.baseUrl)).toBe(true);
    expect(calls[0].options.headers.Origin).toBe("https://gsav.example.com");
  });

  it("fails when a route does not return the GSAV app shell", async () => {
    const config = createConfig({ EXPO_PUBLIC_GSAV_WEB_URL: "https://gsav.example.com" });

    await expect(runPreflight({
      config,
      routes: [{ name: "watch", path: "/watch/test?embed=native" }],
      fetchImpl: async () => response({ status: 200, text: "<main></main>" }),
    })).rejects.toThrow("watch did not return the GSAV app shell");
  });
});
