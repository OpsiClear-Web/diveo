import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  createLaunchOptions,
  installNativeCapture,
  assertCompatibleBridgeReady,
  getBridgeReadySummaries,
  isBridgeCompatible,
  messageTypes,
  parseArgs,
  readNativeMessages,
  resetNativeMessages,
  runDiagnosticsSmoke,
  runExploreSmoke,
  runWatchSmoke,
  waitForAnyMessageType,
  waitForMessageTypes,
  writeJsonOutput,
} = {
  ...require("./gsav-native-runtime-smoke.js"),
  ...require("./gsav-runtime-smoke-bridge.js"),
};

function bridgeReadyPayload(overrides = {}) {
  return {
    type: "GSAV_BRIDGE_READY",
    payload: {
      version: 1,
      minVersion: 1,
      commands: ["play"],
      events: ["GSAV_READY"],
      ...overrides,
    },
  };
}

function createFakePage({ evaluations = [], waitForFunctionReject = false } = {}) {
  const calls = [];
  const evaluationQueue = [...evaluations];
  return {
    calls,
    async goto(url, options) {
      calls.push(["goto", url, options]);
    },
    async waitForSelector(selector, options) {
      calls.push(["waitForSelector", selector, options]);
    },
    async waitForFunction(callback, args, options) {
      calls.push(["waitForFunction", args, options]);
      if (waitForFunctionReject) {
        throw new Error("timed out");
      }
    },
    async evaluate(callback) {
      calls.push(["evaluate", typeof callback]);
      if (evaluationQueue.length === 0) {
        throw new Error("No fake evaluation result queued");
      }
      const next = evaluationQueue.shift();
      return typeof next === "function" ? next() : next;
    },
  };
}

function exploreShortsState(overrides = {}) {
  return {
    nativeEmbed: "true",
    shellNativeEmbed: "true",
    embedParamValues: ["native"],
    dataSaverParamValues: ["1"],
    topNavCount: 0,
    miniPlayerCount: 0,
    shortsFeedCount: 1,
    shortsItemCount: 3,
    shortsActionCount: 3,
    shortsFeedScrollSnapType: "y mandatory",
    shortsFeedOverflowY: "auto",
    firstItemScrollSnapAlign: "center",
    firstItemScrollSnapStop: "always",
    feedClientHeight: 800,
    firstItemClientHeight: 800,
    scrollTop: 0,
    visibleVideoId: "studio",
    posterPreviewCount: 3,
    animatedPosterCount: 0,
    gsavHostCount: 0,
    loadingSceneCount: 0,
    routeMessage: null,
    ...overrides,
  };
}

function exploreScrollAction(overrides = {}) {
  return {
    feedPresent: true,
    beforeScrollTop: 0,
    requestedScrollTop: 800,
    afterScrollTop: 800,
    ...overrides,
  };
}

describe("gsav-native-runtime-smoke bridge-version checks", () => {
  it("parses a durable JSON output path from args or env", () => {
    expect(parseArgs(["--output-path", "docs/qa-evidence/runtime-smoke.json"], {})).toEqual({
      outputPath: "docs/qa-evidence/runtime-smoke.json",
    });
    expect(parseArgs([], {
      GSAV_NATIVE_RUNTIME_SMOKE_OUTPUT_PATH: "release-evidence/gsav-runtime-smoke.json",
    })).toEqual({
      outputPath: "release-evidence/gsav-runtime-smoke.json",
    });
    expect(() => parseArgs(["--output-path"], {})).toThrow("--output-path requires a non-empty value");
  });

  it("writes durable JSON runtime smoke evidence with parent directories", () => {
    const root = mkdtempSync(join(tmpdir(), "gsav-runtime-smoke-"));
    try {
      const outputPath = join(root, "nested", "runtime-smoke.json");
      const payload = { status: "pass", routeCount: 3 };

      expect(writeJsonOutput(outputPath, payload)).toBe(outputPath);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(payload);
      expect(readFileSync(outputPath, "utf8").endsWith("\n")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds launch options with an optional Chromium executable", () => {
    expect(createLaunchOptions({})).toEqual({ headless: true });
    expect(createLaunchOptions({
      GSAV_NATIVE_RUNTIME_SMOKE_HEADED: "1",
      GSAV_RUNTIME_SMOKE_CHROMIUM_EXECUTABLE: "/usr/bin/google-chrome",
    })).toEqual({
      headless: false,
      executablePath: "/usr/bin/google-chrome",
    });
  });

  it("accepts overlapping native and web bridge version ranges", () => {
    expect(isBridgeCompatible({ version: 1, minVersion: 1 })).toBe(true);
    expect(isBridgeCompatible({ version: 2, minVersion: 1 })).toBe(true);
  });

  it("rejects missing or incompatible bridge version ranges", () => {
    expect(isBridgeCompatible({})).toBe(false);
    expect(isBridgeCompatible({ version: "1" })).toBe(false);
    expect(isBridgeCompatible({ version: 2, minVersion: 2 })).toBe(false);
  });

  it("summarizes bridge-ready messages for evidence output", () => {
    expect(
      getBridgeReadySummaries([
        { type: "GSAV_AUTH_READY" },
        {
          type: "GSAV_BRIDGE_READY",
          payload: {
            version: 1,
            minVersion: 1,
            commands: ["play"],
            events: ["GSAV_READY"],
          },
        },
      ]),
    ).toEqual([
      {
        version: 1,
        minVersion: 1,
        commands: ["play"],
        events: ["GSAV_READY"],
      },
    ]);
  });

  it("parses native message payloads and filters message types", async () => {
    const page = createFakePage({
      evaluations: [[
        JSON.stringify({ type: "GSAV_AUTH_READY" }),
        "{malformed",
        { type: "GSAV_READY" },
        42,
      ]],
    });

    await expect(readNativeMessages(page)).resolves.toEqual([
      { type: "GSAV_AUTH_READY" },
      { raw: "{malformed" },
      { raw: { type: "GSAV_READY" } },
      { raw: 42 },
    ]);
    expect(messageTypes([
      { type: "GSAV_AUTH_READY" },
      { raw: "debug" },
      { type: "GSAV_READY" },
    ])).toEqual(["GSAV_AUTH_READY", "GSAV_READY"]);
  });

  it("installs and resets the native capture shim", async () => {
    const context = {
      scripts: [],
      async addInitScript(callback) {
        this.scripts.push(callback);
      },
    };
    const page = createFakePage({ evaluations: [undefined] });

    await installNativeCapture(context);
    await resetNativeMessages(page);

    expect(context.scripts).toHaveLength(1);
    expect(page.calls.map(([name]) => name)).toEqual(["evaluate"]);
  });

  it("waits for required or alternate native message types", async () => {
    const page = createFakePage();
    const timeoutPage = createFakePage({ waitForFunctionReject: true });

    await expect(waitForMessageTypes(page, ["GSAV_AUTH_READY"])).resolves.toBeUndefined();
    await expect(waitForAnyMessageType(page, ["GSAV_READY"], 10)).resolves.toBe(true);
    await expect(waitForAnyMessageType(timeoutPage, ["GSAV_READY"], 10)).resolves.toBe(false);
  });

  it("builds Explore smoke evidence from a successful fake page", async () => {
    const messages = [
      { type: "GSAV_AUTH_READY" },
      bridgeReadyPayload(),
      { type: "GSAV_CAPABILITIES" },
      { type: "GSAV_ROUTE_CHANGE" },
    ];
    const page = createFakePage({
      evaluations: [
        exploreShortsState(),
        exploreScrollAction(),
        exploreShortsState({ scrollTop: 800, visibleVideoId: "elly" }),
        messages.map((message) => JSON.stringify(message)),
      ],
    });

    const result = await runExploreSmoke(page);

    expect(result.name).toBe("explore native data saver");
    expect(result.state.posterPreviewCount).toBe(3);
    expect(result.state.visibleVideoId).toBe("studio");
    expect(result.state.afterScroll.visibleVideoId).toBe("elly");
    expect(result.bridgeReady).toEqual([bridgeReadyPayload().payload]);
    expect(result.bridgeTypes).toEqual([
      "GSAV_AUTH_READY",
      "GSAV_BRIDGE_READY",
      "GSAV_CAPABILITIES",
      "GSAV_ROUTE_CHANGE",
    ]);
    expect(page.calls[0][0]).toBe("goto");
    expect(page.calls[0][1]).toContain("/explore?embed=native&dataSaver=1");
  });

  it("fails Explore smoke when data saver mounts a live viewer", async () => {
    const page = createFakePage({
      evaluations: [exploreShortsState({
        posterPreviewCount: 1,
        gsavHostCount: 1,
      })],
    });

    await expect(runExploreSmoke(page)).rejects.toThrow(/mounted a live GSAV viewer/);
  });

  it("fails Explore smoke when Shorts scroll does not change the visible scene", async () => {
    const page = createFakePage({
      evaluations: [
        exploreShortsState(),
        exploreScrollAction({ afterScrollTop: 0 }),
        exploreShortsState(),
      ],
    });

    await expect(runExploreSmoke(page)).rejects.toThrow(/did not scroll vertically/);
  });

  it("fails Explore smoke when Shorts scroll keeps the same visible scene", async () => {
    const page = createFakePage({
      evaluations: [
        exploreShortsState(),
        exploreScrollAction(),
        exploreShortsState({ scrollTop: 800, visibleVideoId: "studio" }),
      ],
    });

    await expect(runExploreSmoke(page)).rejects.toThrow(/did not change the visible scene/);
  });

  it("builds diagnostics smoke evidence from a successful fake page", async () => {
    const messages = [
      { type: "GSAV_AUTH_READY" },
      bridgeReadyPayload(),
      { type: "GSAV_CAPABILITIES" },
      { type: "GSAV_ROUTE_CHANGE", payload: { path: "/native-diagnostics", embed: true } },
    ];
    const page = createFakePage({
      evaluations: [
        {
          nativeEmbed: "true",
          shellNativeEmbed: "true",
          topNavCount: 0,
          miniPlayerCount: 0,
          diagnosticsStatus: "ready",
          routeMessage: null,
          routeChangePayload: { path: "/native-diagnostics", embed: true },
        },
        messages.map((message) => JSON.stringify(message)),
      ],
    });

    const result = await runDiagnosticsSmoke(page);

    expect(result.name).toBe("native diagnostics");
    expect(result.state.routeChangePayload).toEqual({ path: "/native-diagnostics", embed: true });
    expect(result.bridgeTypes).toContain("GSAV_BRIDGE_READY");
  });

  it("builds watch smoke evidence when native command playback is observed", async () => {
    const initialMessages = [
      { type: "GSAV_AUTH_READY" },
      bridgeReadyPayload(),
      { type: "GSAV_CAPABILITIES" },
      { type: "GSAV_ROUTE_CHANGE", payload: { path: "/watch/test", embed: true } },
    ];
    const finalMessages = [
      { type: "GSAV_PLAY" },
      { type: "GSAV_FIRST_FRAME" },
    ];
    const page = createFakePage({
      evaluations: [
        {
          nativeEmbed: "true",
          shellNativeEmbed: "true",
          topNavCount: 0,
          miniPlayerCount: 0,
          backLinkCount: 0,
          relatedRailCount: 0,
          viewerFrameCount: 1,
          viewerReady: "true",
          viewerError: null,
          unsupportedText: null,
          routeMessage: null,
          routeChangePayload: { path: "/watch/test", embed: true },
        },
        initialMessages.map((message) => JSON.stringify(message)),
        undefined,
        { bridgePresent: true, accepted: true },
        finalMessages.map((message) => JSON.stringify(message)),
      ],
    });

    const result = await runWatchSmoke(page);

    expect(result.name).toBe("watch test native embed");
    expect(result.state.commandResult).toEqual({ bridgePresent: true, accepted: true });
    expect(result.state.playbackObserved).toBe(true);
    expect(result.state.firstFrameObserved).toBe(true);
    expect(result.bridgeTypes).toEqual(expect.arrayContaining([
      "GSAV_AUTH_READY",
      "GSAV_BRIDGE_READY",
      "GSAV_ROUTE_CHANGE",
      "GSAV_PLAY",
      "GSAV_FIRST_FRAME",
    ]));
  });

  it("fails watch smoke when the route has no explicit playback or error outcome", async () => {
    const initialMessages = [
      { type: "GSAV_AUTH_READY" },
      bridgeReadyPayload(),
      { type: "GSAV_CAPABILITIES" },
      { type: "GSAV_ROUTE_CHANGE", payload: { path: "/watch/test", embed: true } },
    ];
    const page = createFakePage({
      evaluations: [
        {
          nativeEmbed: "true",
          shellNativeEmbed: "true",
          topNavCount: 0,
          miniPlayerCount: 0,
          backLinkCount: 0,
          relatedRailCount: 0,
          viewerFrameCount: 1,
          viewerReady: null,
          viewerError: null,
          unsupportedText: null,
          routeMessage: null,
          routeChangePayload: { path: "/watch/test", embed: true },
        },
        initialMessages.map((message) => JSON.stringify(message)),
        undefined,
        { bridgePresent: false, accepted: false },
        [],
      ],
    });

    await expect(runWatchSmoke(page)).rejects.toThrow(/did not emit ready\/error\/playback/);
  });

  it("fails when no bridge-ready message was captured", () => {
    expect(() => assertCompatibleBridgeReady([{ type: "GSAV_AUTH_READY" }], "watch")).toThrow(
      /watch did not emit GSAV_BRIDGE_READY/,
    );
  });

  it("fails when the web bridge requires a newer native bridge", () => {
    expect(() =>
      assertCompatibleBridgeReady([
        {
          type: "GSAV_BRIDGE_READY",
          payload: { version: 2, minVersion: 2 },
        },
      ], "watch"),
    ).toThrow(/incompatible GSAV_BRIDGE_READY/);
  });

  it("passes compatible bridge-ready messages", () => {
    expect(
      assertCompatibleBridgeReady([
        {
          type: "GSAV_BRIDGE_READY",
          payload: { version: 1, minVersion: 1 },
        },
      ], "diagnostics"),
    ).toEqual([
      {
        version: 1,
        minVersion: 1,
        commands: [],
        events: [],
      },
    ]);
  });
});
