# diveo

diveo is an Expo/React Native mobile app for browsing GSAV scenes and opening
the GSAV browser runtime in an embedded native WebView. It was formerly a
third-party Bilibili client; that surface is frozen legacy code and is not an
active contribution target.

## Current Architecture

React Native owns the mobile product shell: home/feed, search, creator pages,
library, login, settings, saved/follow state, update checks, and native route
transitions.

`../gsav-hosting/apps/web` owns the browser-only GSAV runtime: `.gsav`
decode/render/playback, diagnostics, public web routes, and native embed bridge
events. Native embeds hosted routes with `embed=native` so gsav-hosting hides
desktop chrome and enables the bridge.

## Quick Start

```powershell
npm ci
npm run dev:stack
```

`dev:stack` generates local env files from `config/stack.local.json`, reuses or
starts the shared Supabase backend, seeds local catalog public assets, starts
the GSAV web app and diveo preview, then runs strict `npm run dev:doctor -- --require-assets`.

Open:

```text
diveo native preview: http://127.0.0.1:8082
GSAV web app: http://localhost:5173
shared backend: http://127.0.0.1:54321
```

### Which app do I open?

Open diveo when you want the React Native shell preview: Home, Search,
Creator, Library, Login, Settings, and native WebView player routes.

Open gsav-hosting when you want the standalone web app or browser GSAV runtime.
Both clients point at the same Supabase backend in the active stack profile.

Stop launcher-owned processes with:

```powershell
npm run dev:stop
```

To only refresh local catalog storage fixtures, run:

```powershell
npm run stack:seed-assets
```

To capture and verify a local stack architecture receipt, run:

```powershell
npm run stack:receipt
npm run stack:receipt:check
```

Manual startup remains available:

```powershell
cd ..\gsav-hosting
npm run smoke:web:local
cd ..\diveo
$env:EXPO_PUBLIC_GSAV_WEB_URL='http://127.0.0.1:5191'
npm start
```

If `smoke:web:local` is blocked by GSAV host asset CORS, run
`npm run deploy:web:local` from `..\gsav-hosting` as a local preview fallback.
That fallback is not publish evidence.

For Android emulator testing:

```powershell
$env:EXPO_PUBLIC_GSAV_WEB_URL='http://10.0.2.2:5191'
npm run android
```

## Verification

Baseline for app, feature, service, script, or dependency changes:

```bash
npm run verify:local
```

`npm run verify:local` runs typecheck, lint, dependency audit, env-example
audit, import-boundary audit, bridge-origin audit, docs drift, unit tests,
coverage, and `npm run verify:whitespace` (`git diff --check` plus an
untracked source/docs/config scan).

Run `npm run gsav:preflight` and `npm run gsav:runtime-smoke` when a change
touches WebView behavior, GSAV routes, runtime URLs, or the native/web bridge.
Manual device validation is tracked in
[`docs/GSAV_NATIVE_QA.md`](docs/GSAV_NATIVE_QA.md).
The migration plan and release gates are tracked in
[`docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md`](docs/GSAV_NATIVE_IMPLEMENTATION_PLAN.md).
Current blockers, latest command results, evidence review signoff, and the
publish/no-publish decision are tracked in
[`docs/IMPLEMENTATION_VALIDATION_AUDIT.md`](docs/IMPLEMENTATION_VALIDATION_AUDIT.md).

## Project Structure

```text
app/          Expo Router route stubs and layout adapters
features/     app-shell, preferences, player, catalog, social, settings, and app-update modules
shared/       shared UI primitives, theme tokens, and GSAV accent tokens
services/     thin GSAV client and Supabase adapters
utils/        pure generic helpers, currently version utilities
scripts/      preflight, verification, release, and vendor scripts
docs/         architecture, ADRs, QA, and implementation notes
vendor/       vendored shared GSAV packages
```

## Legacy Bilibili Surface

Bilibili DASH playback, WBI signing, proxying, downloads, and related assets are
legacy-only. Do not add features to that surface. Cleanup should move or delete
Bilibili-only code after the GSAV-native path is validated.

## License

MIT. See [`LICENSE`](LICENSE).
