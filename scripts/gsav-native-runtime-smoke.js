#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  assertCompatibleBridgeReady,
  GSAV_NATIVE_BRIDGE_MIN_VERSION,
  GSAV_NATIVE_BRIDGE_VERSION
} = require('./gsav-runtime-smoke-bridge');
const { createEvidenceMetadata } = require('./evidence-metadata');

const baseUrl = (process.env.EXPO_PUBLIC_GSAV_WEB_URL || process.env.GSAV_WEB_URL || 'http://127.0.0.1:5191').replace(/\/+$/, '');
const timeoutMs = Number.parseInt(process.env.GSAV_NATIVE_RUNTIME_SMOKE_TIMEOUT_MS || '15000', 10);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    outputPath: (env.GSAV_NATIVE_RUNTIME_SMOKE_OUTPUT_PATH || '').trim()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-path') {
      const next = argv[index + 1];
      if (!next) throw new Error('--output-path requires a non-empty value.');
      options.outputPath = next;
      index += 1;
    } else {
      throw new Error('Usage: node scripts/gsav-native-runtime-smoke.js [--output-path <path>]');
    }
  }

  return options;
}

function writeJsonOutput(outputPath, payload) {
  if (!outputPath) return null;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return outputPath;
}

function toUrl(routePath) {
  return new URL(routePath, `${baseUrl}/`).toString();
}

function loadPlaywright() {
  const candidates = [
    process.env.GSAV_RUNTIME_SMOKE_PLAYWRIGHT_DIR,
    'playwright',
    'playwright-core',
    path.resolve(__dirname, '..', 'node_modules', 'playwright'),
    path.resolve(__dirname, '..', 'node_modules', 'playwright-core'),
    path.resolve(__dirname, '..', '..', 'gsav-hosting', 'node_modules', 'playwright')
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    'Unable to load Playwright. Run npm install in ../gsav-hosting, install playwright in this repo, or set GSAV_RUNTIME_SMOKE_PLAYWRIGHT_DIR.'
  );
}

function createLaunchOptions(env = process.env) {
  const launchOptions = {
    headless: env.GSAV_NATIVE_RUNTIME_SMOKE_HEADED !== '1'
  };
  if (env.GSAV_RUNTIME_SMOKE_CHROMIUM_EXECUTABLE) {
    launchOptions.executablePath = env.GSAV_RUNTIME_SMOKE_CHROMIUM_EXECUTABLE;
  }
  return launchOptions;
}

async function installNativeCapture(context) {
  await context.addInitScript(() => {
    window.__GSAV_NATIVE_MESSAGES__ = [];
    window.ReactNativeWebView = {
      postMessage(message) {
        window.__GSAV_NATIVE_MESSAGES__.push(message);
      }
    };
  });
}

async function readNativeMessages(page) {
  const rawMessages = await page.evaluate(() => window.__GSAV_NATIVE_MESSAGES__ || []);
  return rawMessages.map((raw) => {
    if (typeof raw !== 'string') return { raw };
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  });
}

function messageTypes(messages) {
  return messages.map((message) => message.type).filter(Boolean);
}

function readExploreShortsStateFromDom() {
  const feed = document.querySelector('.shortsFeed');
  const items = Array.from(document.querySelectorAll('.shortsItem'));
  const searchParams = new URLSearchParams(window.location.search);
  let visibleVideoId = null;
  let bestVisiblePixels = 0;

  if (feed) {
    const feedRect = feed.getBoundingClientRect();
    for (const item of items) {
      const itemRect = item.getBoundingClientRect();
      const visiblePixels = Math.max(
        0,
        Math.min(itemRect.bottom, feedRect.bottom) - Math.max(itemRect.top, feedRect.top)
      );
      if (visiblePixels > bestVisiblePixels) {
        bestVisiblePixels = visiblePixels;
        visibleVideoId = item.getAttribute('data-video-id');
      }
    }
  }

  return {
    nativeEmbed: document.documentElement.dataset.nativeEmbed,
    shellNativeEmbed: document.querySelector('.appShell')?.getAttribute('data-native-embed') ?? null,
    embedParamValues: searchParams.getAll('embed'),
    dataSaverParamValues: searchParams.getAll('dataSaver'),
    topNavCount: document.querySelectorAll('.topNav').length,
    miniPlayerCount: document.querySelectorAll('.miniPlayer').length,
    shortsFeedCount: document.querySelectorAll('.shortsFeed').length,
    shortsItemCount: items.length,
    shortsActionCount: document.querySelectorAll('.shortsAction[href*="/watch/"]').length,
    shortsFeedScrollSnapType: feed ? getComputedStyle(feed).scrollSnapType : null,
    shortsFeedOverflowY: feed ? getComputedStyle(feed).overflowY : null,
    firstItemScrollSnapAlign: items[0] ? getComputedStyle(items[0]).scrollSnapAlign : null,
    firstItemScrollSnapStop: items[0] ? getComputedStyle(items[0]).scrollSnapStop : null,
    feedClientHeight: feed?.clientHeight ?? 0,
    firstItemClientHeight: items[0]?.clientHeight ?? 0,
    scrollTop: feed?.scrollTop ?? 0,
    visibleVideoId,
    posterPreviewCount: document.querySelectorAll('.shortsItem .posterPreview').length,
    animatedPosterCount: document.querySelectorAll('.shortsItem .posterPreview[data-has-animated="true"]').length,
    gsavHostCount: document.querySelectorAll('.shortsItem .gsavHost, .shortsItem .viewerFrame').length,
    loadingSceneCount: document.querySelectorAll('.shortsLoading').length,
    routeMessage: document.querySelector('.routeMessage')?.textContent ?? null
  };
}

function scrollExploreFeedFromDom() {
  const feed = document.querySelector('.shortsFeed');
  if (!feed) return { feedPresent: false };
  const beforeScrollTop = feed.scrollTop;
  const requestedScrollTop = Math.max(feed.clientHeight, 1);
  feed.scrollTo({ top: requestedScrollTop, behavior: 'auto' });
  if (feed.scrollTop === beforeScrollTop) {
    feed.scrollTop = requestedScrollTop;
  }
  return {
    feedPresent: true,
    beforeScrollTop,
    requestedScrollTop,
    afterScrollTop: feed.scrollTop
  };
}

async function waitForMessageTypes(page, types) {
  await page.waitForFunction((expectedTypes) => {
    const rawMessages = window.__GSAV_NATIVE_MESSAGES__ || [];
    const seen = new Set();
    for (const raw of rawMessages) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed?.type) seen.add(parsed.type);
      } catch {
        // Ignore malformed debug payloads.
      }
    }
    return expectedTypes.every((type) => seen.has(type));
  }, types, { timeout: timeoutMs });
}

async function waitForAnyMessageType(page, types, waitMs = timeoutMs) {
  try {
    await page.waitForFunction((expectedTypes) => {
      const rawMessages = window.__GSAV_NATIVE_MESSAGES__ || [];
      for (const raw of rawMessages) {
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (expectedTypes.includes(parsed?.type)) return true;
        } catch {
          // Ignore malformed debug payloads.
        }
      }
      return false;
    }, types, { timeout: waitMs });
    return true;
  } catch {
    return false;
  }
}

async function resetNativeMessages(page) {
  await page.evaluate(() => {
    window.__GSAV_NATIVE_MESSAGES__ = [];
  });
}

async function runExploreSmoke(page) {
  const url = toUrl('/explore?embed=native&dataSaver=1');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForSelector('.appShell[data-native-embed="true"]', { timeout: timeoutMs });
  await page.waitForSelector('.shortsPage', { timeout: timeoutMs });
  await waitForMessageTypes(page, ['GSAV_AUTH_READY', 'GSAV_BRIDGE_READY', 'GSAV_CAPABILITIES', 'GSAV_ROUTE_CHANGE']);

  const state = await page.evaluate(readExploreShortsStateFromDom);

  assert(state.nativeEmbed === 'true', 'explore did not set document native embed marker');
  assert(state.shellNativeEmbed === 'true', 'explore shell did not mark data-native-embed=true');
  assert(
    state.embedParamValues.length === 1 && state.embedParamValues[0] === 'native',
    `explore native embed expected exactly one embed=native parameter, found ${state.embedParamValues.join(',') || 'none'}`
  );
  assert(
    state.dataSaverParamValues.length === 1 && state.dataSaverParamValues[0] === '1',
    `explore native embed expected exactly one dataSaver=1 parameter, found ${state.dataSaverParamValues.join(',') || 'none'}`
  );
  assert(state.topNavCount === 0, 'explore native embed rendered public top navigation');
  assert(state.miniPlayerCount === 0, 'explore native embed rendered public mini player');
  assert(state.shortsFeedCount === 1, `explore did not render one Shorts feed; found ${state.shortsFeedCount}`);
  assert(state.shortsItemCount >= 2, `explore Shorts feed did not render multiple scenes; found ${state.shortsItemCount}`);
  assert(state.shortsActionCount >= 1, 'explore Shorts feed did not render watch actions');
  assert(
    typeof state.shortsFeedScrollSnapType === 'string' && state.shortsFeedScrollSnapType.toLowerCase().includes('y'),
    `explore Shorts feed did not enable vertical scroll snap: ${state.shortsFeedScrollSnapType ?? 'missing'}`
  );
  assert(
    ['auto', 'scroll'].includes(state.shortsFeedOverflowY),
    `explore Shorts feed did not allow vertical scrolling: ${state.shortsFeedOverflowY ?? 'missing'}`
  );
  assert(
    state.firstItemScrollSnapAlign && state.firstItemScrollSnapAlign !== 'none',
    `explore Shorts items did not set scroll-snap-align: ${state.firstItemScrollSnapAlign ?? 'missing'}`
  );
  assert(state.feedClientHeight > 0, 'explore Shorts feed has no measurable height');
  assert(state.firstItemClientHeight > 0, 'explore Shorts item has no measurable height');
  assert(
    Math.abs(state.feedClientHeight - state.firstItemClientHeight) <= 2,
    `explore Shorts item is not full-feed height: feed=${state.feedClientHeight}, item=${state.firstItemClientHeight}`
  );
  assert(state.visibleVideoId, 'explore Shorts feed did not expose a visible active scene before scrolling');
  assert(state.posterPreviewCount > 0, `explore data saver did not render poster previews: ${state.routeMessage ?? 'no route message'}`);
  assert(state.animatedPosterCount === 0, 'explore data saver left animated posters enabled');
  assert(state.gsavHostCount === 0, 'explore data saver mounted a live GSAV viewer');
  assert(state.loadingSceneCount === 0, 'explore data saver attempted to lazy-load a live scene');

  const scrollAction = await page.evaluate(scrollExploreFeedFromDom);
  assert(scrollAction.feedPresent, 'explore Shorts feed disappeared before scroll validation');
  await page.waitForFunction((beforeScrollTop) => {
    const feed = document.querySelector('.shortsFeed');
    return Boolean(feed && feed.scrollTop > beforeScrollTop);
  }, state.scrollTop, { timeout: Math.min(timeoutMs, 5000) });
  const afterScrollState = await page.evaluate(readExploreShortsStateFromDom);
  assert(
    afterScrollState.scrollTop > state.scrollTop,
    `explore Shorts feed did not scroll vertically: before=${state.scrollTop}, after=${afterScrollState.scrollTop}`
  );
  assert(
    afterScrollState.visibleVideoId && afterScrollState.visibleVideoId !== state.visibleVideoId,
    `explore Shorts scroll did not change the visible scene: before=${state.visibleVideoId}, after=${afterScrollState.visibleVideoId ?? 'none'}`
  );

  const messages = await readNativeMessages(page);
  const bridgeReady = assertCompatibleBridgeReady(messages, 'explore');
  return {
    name: 'explore native data saver',
    url,
    state: {
      ...state,
      scrollAction,
      afterScroll: afterScrollState
    },
    bridgeReady,
    bridgeTypes: messageTypes(messages)
  };
}

async function runDiagnosticsSmoke(page) {
  const url = toUrl('/native-diagnostics?embed=native');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForSelector('.appShell[data-native-embed="true"]', { timeout: timeoutMs });
  await page.waitForSelector('.diagnosticsPage', { timeout: timeoutMs });
  await waitForMessageTypes(page, ['GSAV_AUTH_READY', 'GSAV_BRIDGE_READY', 'GSAV_CAPABILITIES', 'GSAV_ROUTE_CHANGE']);

  const state = await page.evaluate(() => {
    const routeMessage = document.querySelector('.routeMessage')?.textContent ?? null;
    const routeChange = (window.__GSAV_NATIVE_MESSAGES__ || [])
      .map((raw) => {
        try {
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          return null;
        }
      })
      .find((message) => message?.type === 'GSAV_ROUTE_CHANGE');
    return {
      nativeEmbed: document.documentElement.dataset.nativeEmbed,
      shellNativeEmbed: document.querySelector('.appShell')?.getAttribute('data-native-embed') ?? null,
      topNavCount: document.querySelectorAll('.topNav').length,
      miniPlayerCount: document.querySelectorAll('.miniPlayer').length,
      diagnosticsStatus: document.querySelector('.diagnosticsStatus')?.textContent?.trim() ?? null,
      routeMessage,
      routeChangePayload: routeChange?.payload ?? null
    };
  });

  assert(state.nativeEmbed === 'true', 'diagnostics did not set document native embed marker');
  assert(state.shellNativeEmbed === 'true', 'diagnostics shell did not mark data-native-embed=true');
  assert(state.topNavCount === 0, 'diagnostics native embed rendered public top navigation');
  assert(state.miniPlayerCount === 0, 'diagnostics native embed rendered public mini player');
  assert(state.diagnosticsStatus, `diagnostics did not render capability status: ${state.routeMessage ?? 'no route message'}`);
  assert(state.routeChangePayload?.path === '/native-diagnostics', 'diagnostics did not emit the expected route-change path');
  assert(state.routeChangePayload?.embed === true, 'diagnostics route-change payload did not mark embed=true');

  const messages = await readNativeMessages(page);
  const bridgeReady = assertCompatibleBridgeReady(messages, 'diagnostics');
  return {
    name: 'native diagnostics',
    url,
    state,
    bridgeReady,
    bridgeTypes: messageTypes(messages)
  };
}

async function runWatchSmoke(page) {
  const url = toUrl('/watch/test?embed=native');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForSelector('.appShell[data-native-embed="true"]', { timeout: timeoutMs });
  await page.waitForSelector('.watchPage.watchPageNative', { timeout: timeoutMs });
  await waitForMessageTypes(page, ['GSAV_AUTH_READY', 'GSAV_BRIDGE_READY', 'GSAV_CAPABILITIES', 'GSAV_ROUTE_CHANGE']);
  await page.waitForSelector('.viewerFrame, .viewerUnsupported, .routeMessage', { timeout: timeoutMs });

  const initialState = await page.evaluate(() => {
    const routeChange = (window.__GSAV_NATIVE_MESSAGES__ || [])
      .map((raw) => {
        try {
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          return null;
        }
      })
      .find((message) => message?.type === 'GSAV_ROUTE_CHANGE');
    return {
      nativeEmbed: document.documentElement.dataset.nativeEmbed,
      shellNativeEmbed: document.querySelector('.appShell')?.getAttribute('data-native-embed') ?? null,
      topNavCount: document.querySelectorAll('.topNav').length,
      miniPlayerCount: document.querySelectorAll('.miniPlayer').length,
      backLinkCount: document.querySelectorAll('.backLink').length,
      relatedRailCount: document.querySelectorAll('.relatedRail').length,
      viewerFrameCount: document.querySelectorAll('.viewerFrame').length,
      viewerReady: document.querySelector('.viewerFrame')?.getAttribute('data-viewer-ready') ?? null,
      viewerError: document.querySelector('.viewerFrame')?.getAttribute('data-viewer-error') ?? null,
      unsupportedText: document.querySelector('.viewerUnsupported')?.textContent?.trim() ?? null,
      routeMessage: document.querySelector('.routeMessage')?.textContent?.trim() ?? null,
      routeChangePayload: routeChange?.payload ?? null
    };
  });

  assert(initialState.nativeEmbed === 'true', 'watch did not set document native embed marker');
  assert(initialState.shellNativeEmbed === 'true', 'watch shell did not mark data-native-embed=true');
  assert(initialState.topNavCount === 0, 'watch native embed rendered public top navigation');
  assert(initialState.miniPlayerCount === 0, 'watch native embed rendered public mini player');
  assert(initialState.backLinkCount === 0, 'watch native embed rendered web back link');
  assert(initialState.relatedRailCount === 0, 'watch native embed rendered related rail');
  assert(initialState.routeChangePayload?.path === '/watch/test', 'watch did not emit the expected route-change path');
  assert(initialState.routeChangePayload?.embed === true, 'watch route-change payload did not mark embed=true');

  const initialMessages = await readNativeMessages(page);
  const bridgeReady = assertCompatibleBridgeReady(initialMessages, 'watch');
  const initialTypes = messageTypes(initialMessages);
  const hasExplicitPlaybackOutcome =
    initialTypes.includes('GSAV_READY') ||
    initialTypes.includes('GSAV_ERROR') ||
    Boolean(initialState.unsupportedText) ||
    Boolean(initialState.routeMessage);

  let commandResult = null;
  if (initialState.viewerFrameCount > 0 && !initialState.viewerError) {
    await resetNativeMessages(page);
    commandResult = await page.evaluate(() => {
      const bridge = window.__GSAV_NATIVE_BRIDGE__;
      if (!bridge) return { bridgePresent: false, accepted: false };
      return {
        bridgePresent: true,
        accepted: Boolean(bridge.handleCommand({
          type: 'GSAV_COMMAND',
          bridgeVersion: 1,
          payload: { command: 'play', videoId: 'test' }
        }))
      };
    });
    await waitForAnyMessageType(page, ['GSAV_PLAY', 'GSAV_PLAYBACK_STATE', 'GSAV_FIRST_FRAME', 'GSAV_ERROR'], Math.min(timeoutMs, 8000));
  }

  const finalMessages = await readNativeMessages(page);
  const finalTypes = messageTypes(finalMessages);
  const playbackObserved =
    finalTypes.includes('GSAV_PLAY') ||
    finalTypes.includes('GSAV_PLAYBACK_STATE') ||
    finalTypes.includes('GSAV_FIRST_FRAME') ||
    finalTypes.includes('GSAV_ERROR');

  assert(
    hasExplicitPlaybackOutcome || playbackObserved,
    'watch route did not emit ready/error/playback and did not render an explicit unsupported/not-found state'
  );

  if (commandResult?.bridgePresent) {
    assert(commandResult.accepted, 'watch native command bridge rejected a play command');
    assert(playbackObserved, 'watch native play command did not produce playback, first-frame, or error bridge events');
  }

  return {
    name: 'watch test native embed',
    url,
    state: {
      ...initialState,
      commandResult,
      playbackObserved,
      firstFrameObserved: finalTypes.includes('GSAV_FIRST_FRAME')
    },
    bridgeReady,
    bridgeTypes: [...initialTypes, ...finalTypes]
  };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv, env);
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0, `Invalid timeout: ${process.env.GSAV_NATIVE_RUNTIME_SMOKE_TIMEOUT_MS}`);

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(createLaunchOptions());
  const context = await browser.newContext();
  await installNativeCapture(context);
  const page = await context.newPage();

  try {
    const routes = [
      await runExploreSmoke(page),
      await runDiagnosticsSmoke(page),
      await runWatchSmoke(page)
    ];

    const result = {
      baseUrl,
      checkedAt: new Date().toISOString(),
      ...createEvidenceMetadata(),
      nativeBridgeVersion: GSAV_NATIVE_BRIDGE_VERSION,
      nativeBridgeMinVersion: GSAV_NATIVE_BRIDGE_MIN_VERSION,
      routes
    };

    writeJsonOutput(options.outputPath, result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    let options = { outputPath: (process.env.GSAV_NATIVE_RUNTIME_SMOKE_OUTPUT_PATH || '').trim() };
    try {
      options = parseArgs(process.argv.slice(2), process.env);
    } catch {
      // Keep the original parse error as the reported failure.
    }
    const failure = {
      baseUrl,
      checkedAt: new Date().toISOString(),
      ...createEvidenceMetadata(),
      error: error instanceof Error ? error.message : String(error)
    };
    writeJsonOutput(options.outputPath, failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  createLaunchOptions,
  installNativeCapture,
  messageTypes,
  parseArgs,
  readNativeMessages,
  resetNativeMessages,
  runDiagnosticsSmoke,
  runExploreSmoke,
  runWatchSmoke,
  waitForAnyMessageType,
  waitForMessageTypes,
  writeJsonOutput
};
