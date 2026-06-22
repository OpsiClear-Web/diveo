# diveo GSAV Native Shell Checklist

This checklist tracks only the diveo native-shell responsibilities for the
GSAV hosting product. The public website, catalog, Supabase backend, CDN/R2
URLs, browser playback, viewer controls, and diagnostics are owned by
`../gsav-hosting`.

Canonical product checklist:

```text
../gsav-hosting/docs/GSAV_VIDEO_HOSTING_IMPLEMENTATION_CHECKLIST.md
```

## Ownership Boundary

- [x] Keep GSAV rendering, decoding, catalog, playback controls, and browser
  diagnostics out of diveo.
- [x] Keep diveo as a React Native WebView shell and design reference.
- [x] Do not import `@opsiclear/gsav-viewer` or parse `.gsav` files in diveo.
- [x] Build native routes by loading the hosted web app with `?embed=native`.
- [x] Treat native playback as beta until device QA is recorded.

Validation:

```powershell
cd ..\gsav-hosting
npm run verify:separation
```

## Local Web Target

- [x] Use `../gsav-hosting/apps/web` as the local web app.
- [x] Use `http://127.0.0.1:5191` as the default host-machine target.
- [x] Use `http://10.0.2.2:5191` for Android emulator runs.
- [x] Use a LAN URL such as `http://192.168.x.x:5191` for physical devices.

Start the local hosting preview:

```powershell
cd ..\gsav-hosting
npm run smoke:web:local
```

Start diveo against the local preview:

```powershell
cd ..\diveo
$env:EXPO_PUBLIC_GSAV_WEB_URL='http://127.0.0.1:5191'
npx expo start
```

Android emulator:

```powershell
$env:EXPO_PUBLIC_GSAV_WEB_URL='http://10.0.2.2:5191'
npx expo run:android
```

## Implemented Native Shell Surface

- [x] `components/GsavWebView.tsx` owns WebView loading, retry, back, reload,
  safe-area behavior, and bridge handling.
- [x] `app/watch/[id].tsx` loads `/watch/:id?embed=native`.
- [x] `app/gsav/[id].tsx` aliases GSAV scene routes.
- [x] `app/gsav-diagnostics.tsx` loads `/native-diagnostics?embed=native`.
- [x] The configured GSAV origin is enforced for WebView navigation.
- [x] Existing diveo mini-players are suppressed on GSAV shell routes.
- [x] The diveo home feed exposes a compact GSAV entry without owning a
  native GSAV catalog.

## Bridge Contract

Events parsed by diveo:

- [x] `GSAV_BRIDGE_READY`
- [x] `GSAV_CAPABILITIES`
- [x] `GSAV_ROUTE_CHANGE`
- [x] `GSAV_READY`
- [x] `GSAV_ERROR`
- [x] `GSAV_PROGRESS`
- [x] `GSAV_FRAME`
- [x] `GSAV_FIRST_FRAME`
- [x] `GSAV_PLAYBACK_STATE`
- [x] `GSAV_PLAY`
- [x] `GSAV_PAUSE`
- [x] `GSAV_ENDED`

Commands diveo can send:

- [x] `setTheme`
- [x] `loadScene`
- [x] `play`
- [x] `pause`
- [x] `seek`
- [x] `setMuted`
- [x] `setFullscreenIntent`

Validation:

```powershell
cd ..\diveo
npm test
npx tsc --noEmit
```

## Native QA Gate

Valid outcomes are playback-ready or an explicit unsupported/browser/network
state. Blank WebViews, silent failures, and indefinite spinners are bugs.

- [ ] Run Android emulator QA against `http://10.0.2.2:5191`.
- [ ] Run physical Android QA against a LAN URL.
- [ ] Run iOS simulator/device QA on macOS or a physical iOS device.
- [ ] Record every device run in `docs/GSAV_NATIVE_QA.md`.
- [ ] Keep diveo GSAV release scope labeled native-wrapper beta until public
  HTTPS hosting and target-device evidence are stable.

Required routes:

- `/gsav-diagnostics`
- `/watch/test`
- `/gsav/test?t=2.5`
- `/watch/elly`

Evidence fields:

- Date
- Platform and device
- OS and WebView/WKWebView version
- GSAV web URL
- diveo route
- Capability result
- Playback result
- Screenshot/video or log path
- Notes and owner for failures

## Production Gate

Production native support must wait for the web product gate in
`../gsav-hosting/docs/GSAV_VIDEO_HOSTING_IMPLEMENTATION_CHECKLIST.md`.

- [ ] Public Pages/static host URL is available.
- [ ] Production `.gsav` assets support byte ranges.
- [ ] Production CORS exposes required range headers.
- [ ] diveo production builds use the public HTTPS GSAV origin.
- [ ] Navigation allow-list is checked against the production origin.
- [x] Add production config verifier.
  - Command: `npm run verify:native-production-config`.
  - The verifier fails production config when the GSAV URL is missing,
    non-HTTPS, localhost/emulator/LAN scoped, or when Android cleartext traffic
    is enabled.
- [x] Resolve Android cleartext traffic by environment.
  - Local/dev Expo config keeps HTTP cleartext enabled for host/emulator
    previews.
  - Production Expo config resolves `android.usesCleartextTraffic` to `false`.
  - Current production verifier now fails only because the production GSAV URL
    is not configured.
- [ ] Configure production `EXPO_PUBLIC_GSAV_WEB_URL`.
  - Must be HTTPS.
  - Must not point at localhost, emulator, link-local, or private LAN hosts.
- [ ] Android and iOS QA are re-run against the production origin.

Validation:

```powershell
node --check scripts/verify-native-production-config.js
npm test -- --run scripts/verify-native-production-config.test.mjs
npm run verify:native-production-config
```

## Deferred Work

- [ ] Native `.gsav` renderer without WebView.
- [ ] Offline `.gsav` downloads inside diveo.
- [ ] Native GSAV catalog browsing.
- [ ] Native creator upload flow.
- [ ] Automated Android/iOS device E2E in CI.
