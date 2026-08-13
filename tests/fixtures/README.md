# Page fixtures

Frozen copies of the markup Kikoe reads, served to a real browser by
`tests/e2e/harness.mjs` so the end-to-end specs need no account, no network,
and no microphone.

## What these can and can't catch

They catch **our** regressions: a selector we stopped matching, a bundle that
crashes on load, a submit path that stops filling the answer field.

They cannot catch a **WaniKani or BunPro redesign**, by construction — a
frozen fixture keeps passing long after the live site has moved on. That's
the nightly canary's job (`.github/workflows/canary.yml`), which runs the
adapter health check against the real sites.

## Provenance

The checked-in fixtures are **hand-built approximations**, not captures. They
contain exactly the elements the adapters read (see `Selectors` in
`src/wanikani.ts` and `src/bunpro.ts`) and nothing else — no styling, no
scripts, no surrounding chrome.

That makes them honest for their purpose (regression detection against the
selectors we depend on) but it does mean they encode our *assumptions* about
the markup rather than the markup itself. Replacing them with real captures
is strictly better, and `tests/e2e/record-fixtures.mjs` exists to do that:

```bash
npm run build
node tests/e2e/launch.js          # log into WaniKani / BunPro in this window
node tests/e2e/record-fixtures.mjs
```

It captures whatever review page is currently open and writes it here with
the same filenames. Re-run it whenever a site redesign is confirmed, so the
specs test against what the sites actually serve now.

Recorded fixtures are page markup from a logged-in session. The recorder
strips `<script>` elements and anything that looks like a session token, but
**read the diff before committing a recapture** — it's a page from your
account.
