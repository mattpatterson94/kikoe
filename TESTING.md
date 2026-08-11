# Browser Testing Kikoe

How to test the extension in a real browser without a microphone, using the
Playwright harness in `tests/e2e/`. First proven during the 0.7.0 pre-release
pass (July 2026), which caught two release blockers unit tests could not see.

## What runs automatically

Three lanes, answering different questions:

| Lane | Command | Runs | Catches |
| --- | --- | --- | --- |
| Unit | `npm test` | every PR | logic regressions, in jsdom |
| End-to-end | `npm run test:e2e` | every PR | our regressions in the *built* extension, against frozen fixtures |
| Canary | `.github/workflows/canary.yml` | nightly | a WaniKani or BunPro redesign |

`npm run test:e2e` needs `npm run build` first, and a display — CI runs it
under `xvfb-run`. It boots the real `chrome/` build in Chromium, serves
`tests/fixtures/` at the real site URLs via request interception, routes
`api.wanikani.com` so a spec can put any accepted answer on a card, and drives
speech through the shim. No account, no network, no microphone.

The **canary** is the only lane that looks at the live sites, because frozen
fixtures keep passing long after the real markup has moved on. It is strictly
read-only — it asserts the adapter selectors are present and stops, submitting
nothing — and it opens an issue only after failing twice. It skips cleanly
until `KIKOE_STORAGE_STATE` is configured; see the header of
`tests/e2e/canary.mjs`.

Fixtures are hand-built approximations, not captures. Replace them with real
ones via `node tests/e2e/record-fixtures.mjs` — see `tests/fixtures/README.md`.

## The harness

```bash
npm run build        # assemble chrome/ (dictionary download cached after first run)
npm run e2e:launch   # headed Chromium + unpacked extension + fake-speech shim
```

Three pieces:

- **[tests/e2e/launch.js](tests/e2e/launch.js)** — launches Playwright's
  Chromium (branded Chrome removed `--load-extension`) with a persistent
  profile in `.playwright-profile/` (gitignored — logins live there and
  survive restarts) and injects the shim into every page. Keeps running;
  Ctrl-C to close. Rebuilt the extension? Restart the launcher.
- **[tests/e2e/fake-speech.js](tests/e2e/fake-speech.js)** — replaces
  `window.webkitSpeechRecognition` before any page script runs. The extension
  picks it up transparently because `createRecognition` reads the constructor
  from the page's `window` ([src/recognition.ts](src/recognition.ts)).
- **[tests/e2e/cdp.js](tests/e2e/cdp.js)** — connect a driving script to the
  running browser over CDP. Use `http://127.0.0.1:9223`, **not**
  `localhost` — Chromium binds IPv4 only and `localhost` may resolve to an
  unrelated IPv6 listener first.

Drive it from one-off scripts:

```js
import { withContext, getPage } from './tests/e2e/cdp.js';
await withContext(async (context) => {
  const page = await getPage(context, 'wanikani.com');
  await page.evaluate(() => window.__kikoeSpeech.say('lid'));          // final utterance
  await page.evaluate(() => window.__kikoeSpeech.say(['a', 'b']));     // ranked alternatives
  await page.evaluate(() => window.__kikoeSpeech.say('x', { interim: true }));
  await page.evaluate(() => window.__kikoeSpeech.error('network'));    // or 'not-allowed', …
  await page.evaluate(() => window.__kikoeSpeech.state());             // { running, lang, … }
});
```

The shim mirrors the consumption contract in `src/recognition.ts`: results
are array-likes of `{ transcript, confidence }` with `isFinal`; `stop()` and
errors fire `onend` asynchronously (auto-restart and mute logic key off it);
`start()` while running throws `InvalidStateError`.

## Reading extension state

- **Options page** (`chrome-extension://<id>/options.html`) is the door to
  `chrome.storage`. Find the id on `chrome://extensions` (stable per checkout
  path for unpacked extensions).
- **Ground truth for answers**: WaniKani accepted answers live in the
  extension's own cache, `chrome.storage.local` keys `kikoe_subj_<category>_<prompt>`.
  BunPro prints them in the DOM: `[data-meta-loc]` carries
  `data-meta-answers-array` (JSON), `data-meta-question-mode`
  (`cloze` = reading/ja-JP, `translate` = meaning/en-US), and
  `data-meta-info` (`.id` identifies the card — compare to detect advance).
- **Success signal**: the app bundle consumes and *removes*
  `data-kikoe-config`, so its absence plus `[kikoe]` console logs means the
  extension loaded. Its presence means the bundle crashed after stamping.
- Turn on the **debug** setting (options page or
  `chrome.storage.sync.set({ debug: true })`) for `[kikoe] checkAnswer` logs.

## Account and content constraints

- **WaniKani answers move real SRS.** Use the dedicated test account.
  Fresh-account timeline: lessons are available immediately; the first
  reviews appear ~4h after completing lessons; kanji (reading questions,
  ja-JP on WaniKani) unlock only after radicals guru — days. Japanese-side
  voice flow is testable immediately on BunPro cloze instead.
- **BunPro Cram is SRS-free** ("Anything you do inside Cram stays inside
  Cram") — use it for the bulk of BunPro testing at `bunpro.jp/cram`, cram
  type "Input", against a real account. Keep real-review samples small and
  answer correctly only; wrong answers create ghost reviews.
- **WaniKani lesson-quiz gotchas**: finishing a batch pops a
  `.lesson-modal` ("Good job! …") over the quiz — the card behind it stops
  advancing and the extension logs `skipped — already submitted`; click
  "Another Batch, Please!" to continue. Reloading a lesson quiz restarts the
  whole batch (progress isn't persisted). BunPro auto-advances on correct in
  well under a second — sample card identity, not just the input value, or a
  success reads as a failure.
- WaniKani serves lessons at `/subject-lessons/<session>[/quiz]` (the old
  `/subjects/lesson` scheme is gone from the live site); reviews confirmed
  live at `/subjects/review` (July 2026, full session driven by voice).
- More answer ground truth: the full pruned radical set lives under the
  `kikoe_radicals` storage key (~500 entries) — use it for radicals that
  never went through this session's lessons.
- Scripted-driving gotchas: the help panel is `position: fixed`, so
  `offsetParent` is null even when visible — check `getComputedStyle`.
  And backgrounding the tab (opening another tab counts) pauses the app and
  overwrites the indicator state — chip-click tests must `bringToFront()`
  first or the click routes to the mute toggle instead of, e.g., the
  no-token WaniKani token-page action.

## What to verify per release (tiered)

Tier 1 — integration surfaces unit tests can't see:
options page render (light + dark) / settings + corrections CRUD round-trip /
corrections live-apply without reload / page detection positives *on live
URLs* and lookalike negatives / indicator states (Listening, Muted,
Reconnecting…, ⚠ Microphone access denied) / mute voice command + click
toggle / transcript no-match diagnostics / WaniKani lesson-quiz voice loop /
BunPro cram + review sample / subject cache population.

Tier 2 — matching behaviors, shim-driven on live pages:
multi-alternative rank-2+ match / fuzzy meaning (needs answer >~5 chars for
tolerance 1) / voice-command normalization ("Pause.") / network-error backoff
restart / fatal error no-restart.

Tier 3 — accept unit coverage, verify mechanics only: specific-vocab reading
fixes (can't summon vocab into a fresh queue), image-only radicals (needs one
in the queue), deep-queue (50+) prefetch — inspect `api.wanikani.com`
requests for the sliding `ids=` batches instead.

## Known gaps / next steps for automation

Now automated (see the table at the top): page-detection positives and
lookalike negatives, indicator states, the mute command, the adapter health
check, the full voice loop on both sites, and `api.wanikani.com` interception
for fabricating specific subjects.

Still needing a human:

- **Real-microphone recognition is never exercised.** Everything above drives
  the fake-speech shim. Keep one human smoke pass per release for actual mic
  capture and real Web Speech results — this is the single biggest thing the
  automation cannot replace.
- **Recorded fixtures.** The checked-in ones are hand-built approximations, so
  they test our assumptions about the markup rather than the markup itself.
  One logged-in `record-fixtures.mjs` run replaces them.
- **Deep-queue (50+) prefetch** — the sliding `ids=` batching is now
  interceptable, but no spec fabricates a long enough queue yet.
- **Options page rendering** (light + dark) and the corrections CRUD
  round-trip are still eyeball checks.
- **Firefox** is untested by this harness and unsupported besides — see the
  README.
- **BunPro `translate`** (meaning/en-US) cards never surfaced during
  cram/review sampling; the fixture covers `cloze` only.
