# Agent instructions for kikoe

Kikoe is a browser extension (Chrome MV3 + Firefox MV2) that lets users answer
WaniKani and BunPro reviews by voice. Source lives in `src/` (bundled by
esbuild via `build.sh`), extension scaffolding in `extension/`, tests in
`tests/` (vitest + jsdom).

## Required checks before opening a PR

Before creating or updating any pull request, run **all** of the following
from the repo root and make sure every one of them passes:

```bash
npm test               # full vitest suite — all tests must pass
npm run lint           # ESLint — zero errors
npm run typecheck      # TypeScript type check (tsc --noEmit) — zero errors
```

Do not open a PR if any check fails. Do not skip, disable, or delete failing
tests or lint/type rules to get to green — fix the underlying problem, and if
it can't be fixed in scope, stop and flag it instead.

## Build & dev

- `npm run build` — full build: bundles `src/app.js` and
  `extension/content.js`, downloads dictionary data (cached), assembles
  `chrome/` and `firefox/` (both are build output, never edit them directly).
- `npm run dev` / `npm run dev:firefox` — watch mode with live reload.

## Conventions

- Plain ES modules; the codebase is migrating incrementally from JavaScript
  to TypeScript. New modules should be written in TypeScript. Do not use
  `any` casts or `@ts-ignore`/`@ts-expect-error` to silence type errors.
- `extension/injected.js` and `extension/options.js` are copied verbatim into
  the extension (no bundling/transpiling), so they must stay plain JS.
- Every module in `src/` has a matching test file in `tests/`; keep it that
  way when adding or renaming modules.
