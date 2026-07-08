# Diveo GSAV Local Preflight And Runtime Smoke

Date: 2026-07-01

Scope: local rehearsal evidence only. This does not satisfy publish-counted
production runtime, Android/iOS device, APK, release dry-run, range-probe, or
artifact-review evidence.

## Host

- GSAV web workspace: `../gsav-hosting/apps/web`
- Fixture: `../gsav-hosting/apps/web/public/test.gsav`
- Fixture size: `21368765` bytes
- Local preview: `http://127.0.0.1:5191`
- Preview was stopped after the smoke run; port `5191` was verified closed.

## Commands

```powershell
npm run build
$env:EXPO_PUBLIC_GSAV_WEB_URL='http://127.0.0.1:5191'
npm run gsav:preflight
npm run gsav:runtime-smoke
```

## Preflight Result

`npm run gsav:preflight` passed at `2026-07-01T14:47:37.537Z`.

Observed route checks:

- `/`
- `/explore?embed=native&dataSaver=1`
- `/native-diagnostics?embed=native`
- `/watch/test?embed=native`
- `/watch/test?t=2.5&embed=native`
- `/watch/elly?embed=native`

Every route returned `200`, `contentType=text/html`, and `hasAppRoot=true`.
The local fixture `http://127.0.0.1:5191/test.gsav` returned `206` for
`Range: bytes=0-0`.

Local range caveat: this Vite preview response reported
`Content-Range: bytes 0-21368764/21368765`, `contentRangeExact=false`, and
did not expose `Accept-Ranges`, `Content-Length`, `Content-Range`, or `ETag`.
Production range validation still requires the exact production CORS/range
contract.

Host identity caveat: `GSAV_HOST_IDENTITY_URL` was not configured, so host
identity verification was skipped.

## Runtime Smoke Result

`npm run gsav:runtime-smoke` passed at `2026-07-01T14:47:51.022Z`.

Observed bridge/runtime signals:

- Native bridge version `1`, min version `1`.
- Explore native embed had `nativeEmbed=true`, `shellNativeEmbed=true`,
  `topNavCount=0`, `miniPlayerCount=0`, and `posterPreviewCount=3`.
- Native diagnostics emitted route change payload
  `{ path: "/native-diagnostics", search: "?embed=native", embed: true }`.
- Watch route `/watch/test?embed=native` had `topNavCount=0`,
  `miniPlayerCount=0`, `backLinkCount=0`, `relatedRailCount=0`,
  `viewerFrameCount=1`, and accepted the native bridge command.
- Watch route observed playback or explicit error bridge events and emitted
  `GSAV_AUTH_READY`, `GSAV_BRIDGE_READY`, `GSAV_CAPABILITIES`,
  `GSAV_ROUTE_CHANGE`, `GSAV_PROGRESS`, and `GSAV_ERROR`.

The workspace was dirty during this local smoke, matching the current
implementation branch state. Publish readiness still requires committed,
reviewed external evidence for the fixed release candidate.
