# Agent instructions for Kikoe

Kikoe is a browser extension for answering WaniKani and BunPro reviews by
voice. It targets Chrome (Manifest V3), Firefox (Manifest V2), and Safari.

- `src/` contains the TypeScript application code.
- `extension/` contains browser-extension scaffolding and bundled entry points.
- `tests/` contains the Vitest and jsdom test suites.
- `chrome/` and `firefox/` contain tracked manifests and icons alongside
  ignored build output. Edit the tracked source assets when needed, but never
  edit generated files such as bundles, copied scripts, or dictionary data.
- `safari/` and `dist/` are generated output; never edit them directly.

## Required checks before opening a PR

Before creating or updating a pull request, run all of these commands from the
repository root:

```bash
npm test
npm run lint
npm run typecheck
```

All tests must pass, ESLint must report zero errors, and `tsc --noEmit` must
pass. Do not skip, disable, or delete checks to make them green. Fix the
underlying issue; if that is outside the task's scope, stop and report it.

## Build and development

- `npm run build` bundles `src/app.ts` and `extension/content.ts`, downloads
  and caches dictionary data, and assembles each browser target.
- `npm run dev` and `npm run dev:firefox` run watch mode with live reload.
- After `npm run build`, use `npm run pack`, `npm run pack:chrome`,
  `npm run pack:firefox`, or `npm run pack:safari` to create distributable
  archives. The pack commands only zip existing output; they do not build it.

## Conventions

- Use plain ES modules. Application code in `src/` and bundled content-script
  code are TypeScript; write new modules in TypeScript.
- Do not use `any` casts, `@ts-ignore`, or `@ts-expect-error` to silence type
  errors.
- `extension/background.js`, `extension/injected.js`, and
  `extension/options.js` are copied verbatim into the extension (no
  bundling/transpiling), so they must stay plain JS.
- Every module in `src/` has a matching test file in `tests/`; keep it that
  way when adding or renaming modules.
- The voice-command tables in `README.md` are generated from `src/commands.ts`
  (between `BEGIN/END GENERATED` markers) — don't edit them by hand. After
  changing the command registry, run `npm run readme:commands` and commit the
  regenerated README; the test suite fails while the two are out of sync.
- Pure-logic tests are TypeScript. The mock-heavy suites (app, content,
  recognition, speed, bunpro_speed, wanikani, bunpro, live_transcript, dict)
  stay JavaScript deliberately: they stub partial Web Speech / chrome.storage
  / DOM objects and feed malformed inputs to exercise defensive paths, which
  strict typing would only bury under casts. Don't migrate them.
