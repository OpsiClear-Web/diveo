# Repository Guidelines

## Project Structure & Module Organization

diveo is an Expo/React Native TypeScript app with native browse/social screens and an embedded GSAV web player. Active work should focus on GSAV-native behavior; legacy Bilibili-facing code is frozen except for removal or safety fixes. Expo Router pages live in `app/`; product modules live in `features/`; shared UI/theme lives in `shared/`. API/Supabase access is in `services/`, and pure helpers are in `utils/`. Assets are under `assets/` and `public/`; scripts are in `scripts/`; architecture and QA notes are in `docs/`.

## Build, Test, and Development Commands

- `npm ci`: install locked dependencies.
- `npm start`: start the Expo development server.
- `npm run android` / `npm run ios`: launch native dev builds.
- `npm run web`: start the Expo web preview.
- `npm run proxy`: run the legacy local proxy; avoid new dependencies on it.
- `npm run gsav:preflight`: validate GSAV embedded route and host assumptions.
- `npx tsc --noEmit`: type-check strict TypeScript.
- `npm test`: run Vitest once.
- `npm run test:coverage`: run Vitest with coverage output.
- `npm run lint`: lint the scoped GSAV/diveo surface.

## Coding Style & Naming Conventions

Use strict TypeScript with the Expo ESLint flat config. Match local style: two-space indentation, double quotes, PascalCase component files, `use...` hooks, and `...Store.ts` Zustand stores. Keep reusable logic in feature modules, `services/`, or `utils/` so it can be unit-tested. New comments and user-visible strings should be English; do not bulk-rewrite legacy Chinese comments.

## Testing Guidelines

Tests use Vitest and are colocated as `*.test.ts` or `*.test.mjs`, for example `utils/version.test.ts`. Add or update tests when changing normalization, bridge, routing, store, script, or configuration behavior. Before opening a PR, run `npx tsc --noEmit`, `npm test`, `npm run lint`, and relevant preflight checks.

## Commit & Pull Request Guidelines

Commit history and `CONTRIBUTING.md` use Conventional Commits, such as `feat(native): ...`, `fix(player): ...`, `docs: ...`, and `chore(diveo): ...`. PRs should include a concise change summary, linked issue when applicable, tested platforms, screenshots or recordings for UI changes, and confirmation that no account secrets or hard-coded credentials were added.

## Security & Configuration Tips

Use `.env.example` for local configuration and keep real values in untracked env files. Do not commit credentials, session cookies, Supabase secrets, or user account identifiers. For local GSAV hosting, set `EXPO_PUBLIC_GSAV_WEB_URL` before launching Expo.
