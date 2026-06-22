# GSAV Native WebView QA

diveo hosts the GSAV site through `components/GsavWebView.tsx`. The native app
must not duplicate GSAV catalog, CDN URL, decoder, renderer, or playback-control
logic.

Use this file as the manual evidence log for native WebView runs. A valid result
is either playback-ready or an explicit unsupported/browser/network state. A
blank WebView, silent failure, or indefinite spinner is a bug.

## Prerequisites

- `../gsav-hosting/apps/web` builds and runs locally.
- `EXPO_PUBLIC_GSAV_WEB_URL` points at a reachable GSAV web app.
- The GSAV web app supports:
  - `/watch/test?embed=native`
  - `/watch/elly?embed=native`
  - `/native-diagnostics?embed=native`
- Android SDK tooling is available for Android QA.
- macOS + Xcode simulator or a physical iOS device is available for iOS QA.

## Local Web Target

Start the local GSAV web preview first:

```powershell
cd ..\gsav-hosting
npm run smoke:web:local
```

Expected local browser target:

```text
http://127.0.0.1:5191
```

Android emulator target:

```text
http://10.0.2.2:5191
```

Physical device target:

```text
http://<host-lan-ip>:5191
```

Run the diveo-side preflight before launching Expo:

```powershell
cd ..\diveo
npm run gsav:preflight
```

The preflight checks the GSAV app shell routes and local `/test.gsav` range
serving from the machine running the command. It is not a replacement for real
WebView QA. Use `http://10.0.2.2:5191` only when launching the Android app,
because that address is resolved inside the emulator.

## Required Route Matrix

| Route | Expected result |
| --- | --- |
| `/gsav-diagnostics` | Native WebView loads `/native-diagnostics?embed=native`; capability state is visible. |
| `/watch/test` | Native WebView loads `/watch/test?embed=native`; local scene reaches ready state or explicit unsupported state. |
| `/gsav/test?t=2.5` | Native alias preserves scene id and start time, then appends `embed=native`. |
| `/watch/elly` | Remote R2 scene reaches ready state or explicit unsupported/network state. |

## Android Runbook

```powershell
cd ..\diveo
$env:EXPO_PUBLIC_GSAV_WEB_URL='http://10.0.2.2:5191'
npx expo run:android
```

Checklist:

- Open `/gsav-diagnostics`.
- Confirm the page reports capabilities and does not show desktop web chrome.
- Open `/watch/test`.
- Confirm either playback reaches ready state or the unsupported capability
  message is explicit.
- Open `/gsav/test?t=2.5`.
- Confirm the native reload button reloads the WebView.
- Confirm native back returns to the prior diveo screen.
- Confirm the diveo mini-players do not overlay the GSAV WebView route.
- Rotate the device and confirm safe-area/header spacing remains usable.

## iOS Runbook

```bash
cd ../diveo
export EXPO_PUBLIC_GSAV_WEB_URL='http://127.0.0.1:5191'
npx expo run:ios
```

Checklist:

- Open `/gsav-diagnostics`.
- Confirm WKWebView capability reporting.
- Open `/watch/test`.
- Confirm playback reaches ready state, or the unsupported capability message is
  explicit.
- Confirm native back and reload behavior.
- Confirm safe-area spacing around notches and the home indicator.

## Bridge Smoke

Use the web diagnostics page or injected command path to confirm these stable
events and commands:

- Web to native: `GSAV_CAPABILITIES`, `GSAV_ROUTE_CHANGE`, `GSAV_READY`,
  `GSAV_ERROR`, `GSAV_PLAYBACK_STATE`, `GSAV_FIRST_FRAME`.
- Native to web: `setTheme`, `loadScene`, `play`, `pause`, `seek`, `setMuted`,
  `setFullscreenIntent`.

## Evidence Log

Add one row per tested route/device.

| Date | Platform | Device/Emulator | OS/WebView version | GSAV web URL | diveo route | Capability result | Playback result | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-06-18 | Host preflight | Windows host | n/a | `http://127.0.0.1:5191` | GSAV target routes | App shell returned `200` for `/`, `/native-diagnostics?embed=native`, `/watch/test?embed=native`, `/watch/test?t=2.5&embed=native`, `/watch/elly?embed=native` | `/test.gsav` range returned `206` | Terminal: `npm run gsav:preflight` | Pre-device gate only; not WebView QA. |
| 2026-06-18 | iOS | Deferred | macOS/Xcode unavailable in current Windows environment | n/a | n/a | Not run | Deferred | n/a | Requires macOS/Xcode simulator or physical iOS device. |
| _pending_ | Android | _pending_ | _pending_ | `http://10.0.2.2:5191` | `/gsav-diagnostics` | _pending_ | _pending_ | _pending_ | _pending_ |
| _pending_ | Android | _pending_ | _pending_ | `http://10.0.2.2:5191` | `/watch/test` | _pending_ | _pending_ | _pending_ | _pending_ |

## Environment Gaps

| Date | Platform | Gap | Impact | Next action |
| --- | --- | --- | --- | --- |
| 2026-06-18 | Android | `adb` and `emulator` commands are not installed in this Windows environment. | Cannot complete Android WebView route QA here. | Run Android QA on a machine with Android SDK/platform-tools and an emulator or device. |
| 2026-06-18 | iOS | macOS/Xcode simulator or physical iOS device is unavailable in this Windows environment. | iOS WKWebView behavior is explicitly deferred. | Run iOS QA on macOS with Xcode or a physical iOS device. |

## Manual Issue Log

Record failures here when a QA run does not meet the expected route result.

| Date | Route | Platform | Expected | Actual | Console/native logs | Screenshot/video | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
