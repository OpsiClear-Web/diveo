# ADR 0001 — Pivot from Bilibili client to GSAV native shell

- **Status:** Proposed _(awaiting owner decision — see "Decision gate" below)_
- **Date:** 2026-06-20
- **Deciders:** _(project owner)_

## Context

JKVideo began as a third-party Bilibili client (DASH playback, danmaku, WBI
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

**Recommendation: Option A**, with a literal deletion date (e.g. _delete legacy by
v1.1.0 / TBD_). Rule once accepted: any legacy-only refactor whose payoff horizon
exceeds the deletion date is dropped.

> To accept: change Status to `Accepted`, pick the option, and fill in the date.
> Phase 4/5 task scope in `IMPROVEMENT_PLAN.md` is a function of this choice.

## Ownership boundary (catalog contract) — P2-7

GSAV catalog, scene data model, CDN/R2 URLs, and playback are owned by
`../gsav-hosting`. JKVideo MUST NOT own a native GSAV catalog. The native shell
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
