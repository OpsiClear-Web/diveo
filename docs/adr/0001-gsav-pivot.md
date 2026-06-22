# ADR 0001 — Pivot from Bilibili client to GSAV native shell

- **Status:** Accepted - **Option A (Freeze & quarantine)**
- **Date:** 2026-06-20
- **Deciders:** project owner

## Context

diveo began as a third-party Bilibili client (DASH playback, danmaku, WBI
signing, live, downloads, LAN share). It received a Bilibili cease-and-desist,
so that surface can no longer be developed. In parallel the app is being turned
into a thin **native shell** that hosts a separate GSAV 4DGS web app
(`../gsav-hosting`) via `react-native-webview`.

Today both surfaces coexist with no boundary: the Bilibili feed is still the
default home screen while the GSAV shell is bolted alongside it. A maintainability
audit (2026-06-20) traced ~80% of findings to this unmanaged dual state.

## Decision gate (DG-1) — to be chosen by the owner

| Option | Meaning |
|---|---|
| **A — Freeze & quarantine (recommended)** | Keep legacy reachable behind a flag, stop investing in it, set a concrete deletion date. Lets GSAV become the product without a risky big-bang delete. |
| B — Delete legacy | Remove the Bilibili surface entirely (largest debt reduction; only after GSAV is a usable product). |
| C — Keep both | Rejected — this is the status quo that generated the audit. |

**Decision (accepted 2026-06-20): Option A - Freeze & quarantine.** The Bilibili
surface receives no further investment; any legacy-only refactor whose payoff
horizon exceeds the deletion gate below is dropped. Phase 4/5 task scope in
`IMPROVEMENT_PLAN.md` follows from this.

### Deletion gate (the "literal date" DG-1 asks for)

The Bilibili API client (`services/bilibili.ts` + WBI signing) and the rest of the
legacy surface are deleted when **all** of these hold (target: **v1.1.0 / by
2026-08-31**, revise when the GSAV origin lands):

1. The GSAV production origin (`../gsav-hosting`) is live (HTTPS, byte-range + CORS).
2. A real GSAV launcher (not the hard-coded `/watch/test`) is validated on the
   `preview` channel, and a `legacy-final` tag is cut.

**Distribution note (the repo stays private):** only the compiled APK is distributed,
never the source, so there is no "public source" trigger and the MIT license does not
expose the Bilibili client. The remaining cease-and-desist consideration is the
*shipped binary*, which still contains and uses the Bilibili API during the freeze.
That exposure is already bounded: (a) `release.yml` refuses to publish until
`GSAV_WEB_URL` is set, so no new APKs ship today, and (b) GSAV becomes the shipped
default before releases resume. Deleting the Bilibili client is therefore a product
decision on the timeline above, not a legal hard-gate. Rotating the leaked Sentry
token (`9bffc16`) is low-urgency hygiene (private repo, build-time token never bundled
into the APK) and needs no history rewrite.

### Android permission posture (pre-public)

`RECORD_AUDIO` is dropped (nothing records audio). `MODIFY_AUDIO_SETTINGS` is kept
for legacy native playback during the freeze (remove it with the Bilibili surface).
`REQUEST_INSTALL_PACKAGES` is retained intentionally - it backs the in-app APK
self-updater (`hooks/useCheckUpdate.ts`).

## Ownership boundary (catalog contract) — P2-7

GSAV catalog, scene data model, CDN/R2 URLs, and playback are owned by
`../gsav-hosting`. diveo MUST NOT own a native GSAV catalog. The native shell
only:

- routes `/watch/:id`, `/gsav/:id` (deep-link alias), `/gsav-diagnostics`;
- deep-links into scenes **by id** via `buildGsavWatchPath(sceneId)`
  (`utils/gsavBridge.ts`) — an id passthrough, not a catalog query;
- loads the hosted web app in a `WebView`, enforcing a single allowed origin;
- exchanges typed bridge messages (`utils/gsavBridge.ts`).

See `GSAV_4DGS_HOSTING_IMPLEMENTATION_CHECKLIST.md` (ownership boundary, lines
~16/68-69/175) for the authoritative contract.

## Consequences

- The home screen should become a thin GSAV **launcher** (not a catalog); legacy
  screens move behind a feature flag / `legacy/` group (tracked as P3-3).
- Legacy-only debt (untyped Bilibili service, god player component, duplicated
  players) is frozen, not refactored, and removed on the deletion date.
- New code follows the GSAV code's conventions (English comments/strings, runtime
  validation at boundaries, testable pure modules).
