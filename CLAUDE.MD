# CLAUDE.md

npm-workspaces monorepo. Node 20+.

## Commands
- `npm test` — Vitest for all packages (root `vitest.config.ts` lists the projects)
- `npm run typecheck` — runs `tsc` in every workspace
- `npm run test:e2e` — builds the `--mode e2e` bundles, then runs Playwright headless Chromium (ports 4301–4303)
- `npm run assets` — regenerates `assets/` from the playground build

## Architecture
- `packages/core-engine`: pure TS, no DOM. Every feature lives here and is deterministic. `src/host.ts` defines the `HostAdapter` contract.
- `packages/ui-kit`: React panels written only against `HostAdapter`. Theme tokens are in `src/theme.ts` and must keep WCAG AA contrast; the e2e axe tests enforce this.
- `packages/framer-plugin` and `packages/webflow-extension`: thin adapters. Each has an in-memory fake SDK in `src/testing/`, used by unit tests and by the e2e builds.
- `packages/license-worker`: Hono app built by `createApp()` in `src/app.ts`. Tests use `app.request()` with an in-memory KV.

## Conventions
- Workspace packages export `.ts` sources directly; there is no build step between packages.
- Import with the `.ts` extension (`allowImportingTsExtensions`).
- Type adapters against the real SDK types (`Pick<typeof framer, …>`, `Pick<WebflowApi, …>`).
