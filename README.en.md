<div align="center">

<img src="https://img.shields.io/badge/diveo-Bilibili_Client-00AEEC?style=for-the-badge&logo=bilibili&logoColor=white" alt="diveo"/>

# diveo

**A native shell for the GSAV 4DGS web player — formerly a third-party Bilibili client (that surface is now frozen)**

*GSAV WebView shell · (frozen) DASH playback · danmaku · WBI signing · live · Cross-platform*

> ⚠️ **Notice:** The Bilibili-client functionality is frozen following a Bilibili
> cease-and-desist — it is kept for reference only and no longer accepts feature
> Issues/PRs. Active development continues as the **GSAV native shell**
> (see [GSAV Native Shell](#gsav-native-shell)).

---

[![React Native](https://img.shields.io/badge/React_Native-0.83-61DAFB?logo=react)](https://reactnative.dev)
[![Expo](https://img.shields.io/badge/Expo-SDK_55-000020?logo=expo)](https://expo.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20iOS%20%7C%20Web-lightgrey)](README.en.md)

[中文](README.md) · [Quick Start](#quick-start) · [Features](#features) · [Contributing](CONTRIBUTING.md)

</div>

---

## Screenshots

<table>
  <tr>
    <td align="center"><img src="public/p1.jpg" width="180"/><br/><sub>Home · Inline Video · Live Cards</sub></td>
    <td align="center"><img src="public/p2.jpg" width="180"/><br/><sub>Video Detail · Info · Recommendations</sub></td>
    <td align="center"><img src="public/p3.jpg" width="180"/><br/><sub>Player · 4K HDR · Quality Switch</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="public/p4.jpg" width="180"/><br/><sub>Downloads · LAN Share QR Code</sub></td>
    <td align="center"><img src="public/p5.jpg" width="180"/><br/><sub>Live Tab · Followed Streamers · Categories</sub></td>
    <td align="center"><img src="public/p6.jpg" width="180"/><br/><sub>Live Room · Real-time Danmaku · Guard Marks</sub></td>
  </tr>
</table>

---

## Features

🎬 **Full DASH Playback**
Bilibili DASH stream → `buildDashMpdUri()` local MPD → ExoPlayer native decode, supports 1080P+ & 4K HDR

💬 **Complete Danmaku System**
Video danmaku with XML timeline sync + 5-lane floating overlay; Live danmaku via WebSocket with guard marks & gift counting

🔐 **WBI Signing**
Pure TypeScript MD5 implementation, zero external crypto dependencies, 12h auto-cached nav interface

🏠 **Smart Home Layout**
BigVideoCard inline DASH muted autoplay + swipe-to-seek gesture + live card interleaving + dual-column grid

📺 **Global Mini Player**
Persistent bottom overlay player survives navigation, VideoStore cross-component state sync

🔑 **QR Code Login**
QR code generation + 2s polling + automatic SESSDATA extraction from response headers

📥 **Download + LAN Sharing**
Multi-quality background download, built-in HTTP server generates LAN QR code for same-Wi-Fi playback

🌐 **Cross-Platform**
Android · iOS · Web, Expo Go scan-to-run in 5 minutes, Dev Build unlocks full DASH playback

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native 0.83 + Expo SDK 55 |
| Navigation | expo-router v4 (file-based, Stack) |
| State | Zustand |
| HTTP | Axios |
| Storage | @react-native-async-storage/async-storage |
| Video | react-native-video (DASH MPD / HLS / MP4) |
| Fallback | react-native-webview (HTML5 video injection) |
| Pager | react-native-pager-view |
| Icons | @expo/vector-icons (Ionicons) |

---

## Quick Start

### Option 1: Expo Go (5 minutes, no build required)

> Some quality options limited; video falls back to WebView

```bash
git clone https://github.com/OpsiClear-Web/diveo.git
cd diveo
npm install
npx expo start
```

Scan the QR code with [Expo Go](https://expo.dev/go) on Android or iOS.

### Option 2: Dev Build (Full features, recommended)

> Supports DASH 1080P+ native playback, full danmaku system

```bash
npm install
npx expo run:android   # Android
npx expo run:ios       # iOS (requires macOS + Xcode)
```

### Option 3: Web

```bash
npm install
npx expo start --web
```

> Web requires a local proxy server for image anti-hotlinking: `node scripts/proxy.js` (port 3001)

### GSAV WebView Wrapper

diveo can host the GSAV hosting web app as a thin native shell. The product
web app lives in `../gsav-hosting/apps/web`; diveo only owns WebView loading,
retry, back navigation, and bridge message handling. Set the web app origin
before starting Expo.

Start the local GSAV hosting preview first:

```bash
cd ../gsav-hosting
npm run smoke:web:local
```

Then start diveo against that local preview:

```bash
EXPO_PUBLIC_GSAV_WEB_URL=http://127.0.0.1:5191 npx expo start
```

For Android emulator testing, use the Android host alias:

```bash
EXPO_PUBLIC_GSAV_WEB_URL=http://10.0.2.2:5191 npx expo run:android
```

Routes:

- `/watch/:id` opens `GSAV_WEB_URL/watch/:id?embed=native`
- `/gsav/:id` is an alias for GSAV scenes
- `/gsav-diagnostics` opens the native diagnostics page

The native app only owns WebView loading, retry, back navigation, and bridge
message handling. Catalog, CDN URLs, controls, and playback stay in
`gsav-hosting/apps/web`.

Native device QA is documented in [docs/GSAV_NATIVE_QA.md](docs/GSAV_NATIVE_QA.md).

Native GSAV shell checks:

```bash
npm run gsav:preflight
npx tsc --noEmit
npm test
```

### Direct Install (Android)

Download the latest APK from [Releases](https://github.com/OpsiClear-Web/diveo/releases/latest) — no build needed.

> Enable "Install from unknown sources" in Android settings

---

## Project Structure

```
app/
  index.tsx            # Home (PagerView Hot/Live tabs)
  video/[bvid].tsx     # Video detail (player + info/comments/danmaku)
  live/[roomId].tsx    # Live room (HLS player + real-time danmaku)
  search.tsx           # Search page
  downloads.tsx        # Download manager
  settings.tsx         # Settings (quality + logout)

components/            # UI components (player, danmaku, cards, etc.)
hooks/                 # Data hooks (video list, stream URLs, danmaku, etc.)
services/              # Bilibili API wrapper (axios + cookie interceptor)
store/                 # Zustand stores (auth, download, playback, settings)
utils/                 # Utilities (format, image proxy, MPD builder)
```

---

## Known Limitations

| Limitation | Reason |
|---|---|
| 4K / 1080P+ requires premium account | Bilibili API restriction |
| FLV live streams not supported | Neither HTML5 nor ExoPlayer support FLV; HLS auto-selected |
| Web requires local proxy | Bilibili image Referer anti-hotlinking |
| Feed / like / collect features | Requires `bili_jct` CSRF token, not yet implemented |
| QR code expires after 10 minutes | Close and reopen the login modal to refresh |

---

## Contributing

The **Bilibili-client surface is frozen** (see the notice at the top) and no longer
accepts feature Issues/PRs. The **GSAV native shell** is the active direction and
welcomes Issues/PRs. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

---

## Disclaimer

This project is for personal learning and research purposes only. Not for commercial use.
All video content copyright belongs to the original authors and Bilibili.
This project is not affiliated with Bilibili in any way.

---

## License

[MIT](LICENSE) © 2026 diveo Contributors

---

<div align="center">

If this project helps you, please give it a ⭐ Star!

</div>
