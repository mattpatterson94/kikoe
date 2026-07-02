# Changelog

All notable changes to Kikoe are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- User-editable custom corrections: a new options-page card maps recurring
  speech-recognition mishearings ("heard") to the intended answer, for both
  reading and meaning questions. User entries take precedence over the
  built-in homonym/meaning tables and apply on the next utterance without
  reloading the review page.
  ([#21](https://github.com/mattpatterson94/kikoe/issues/21))
- BunPro support via per-site adapters — voice-driven answering on BunPro
  reviews alongside WaniKani, selected at runtime by hostname. Cloze cards map
  to reading/ja-JP, Translate cards to meaning/en-US; no API token is needed
  since BunPro exposes accepted answers in the DOM.
  ([#12](https://github.com/mattpatterson94/kikoe/pull/12))
- Opt-in fuzzy meaning matching that mirrors WaniKani's own server-side typo
  tolerance (edit distance scaled by answer length), so a spoken answer
  WaniKani would accept is no longer rejected locally. The canonical accepted
  meaning is submitted, not the misheard candidate.
  ([#31](https://github.com/mattpatterson94/kikoe/pull/31))
- Mic mute/pause control: a "pause" / "stop listening" / 「ストップ」 voice
  command plus a click-to-toggle affordance on the idle indicator with a new
  "Muted" visual state. An explicit mute is tracked separately from page
  activity, so blurring/focusing the tab no longer silently un-mutes.
  ([#33](https://github.com/mattpatterson94/kikoe/pull/33))
- The live transcript now shows why an utterance didn't match — subjects still
  loading, wrong answer type (e.g. spoke the meaning on a reading question),
  or no match. ([#34](https://github.com/mattpatterson94/kikoe/pull/34))
- Subject prefetching for upcoming cards in the review/lesson queue, closing
  the race where a fast reviewer speaks before accepted answers have loaded.
  ([#26](https://github.com/mattpatterson94/kikoe/pull/26))
- All speech recognition alternatives (up to 5 per result) are now checked
  against the answer, not just the top guess — the correct reading of short
  utterances and common on'yomi is often present in the recognizer's
  lower-ranked guesses. ([#10](https://github.com/mattpatterson94/kikoe/pull/10))
- Privacy policy for the Chrome Web Store listing
  ([PRIVACY.md](PRIVACY.md)).

### Changed

- Rebranded to Kikoe（聞こえ）with a new logo and a redesigned options page
  (card layout, toggle switches, sticky save bar, dark mode). Existing user
  settings are untouched. ([#13](https://github.com/mattpatterson94/kikoe/pull/13))
- Startup no longer blocks on the dictionary download — recognition starts
  listening immediately and dictionary entries populate in place once the
  fetch resolves. A build-time trim step also cuts the dictionary payload
  from ~12.3 MB to ~7.7 MB.
  ([#32](https://github.com/mattpatterson94/kikoe/pull/32))

### Fixed

- Reading recognition gaps across the candidate pipeline: rendaku/sokuon
  variants for kanji compounds (南国 → なんごく, 一本気 → いっぽんぎ),
  katakana chōonpu preserved when matching readings (ビール → びーる),
  splitting on all kana/kanji run boundaries (お客さん, 気を付けて), 々
  iteration marks (人々 → ひとびと), and ateji like 烏龍茶.
  ([#11](https://github.com/mattpatterson94/kikoe/pull/11))
- Comma-grouped numbers convert fully ("10,000" → "Ten Thousand" instead of
  stopping at the comma), and digit-form day counters resolve their irregular
  readings (6日 → むいか, 20日 → はつか).
  ([#7](https://github.com/mattpatterson94/kikoe/pull/7))
- Spelling out a short word letter-by-letter ("e a r") now submits the
  compact form WaniKani accepts, not the space-separated transcript.
  ([#8](https://github.com/mattpatterson94/kikoe/pull/8))
- Homonym correction for 自立 misheard as 事実.
  ([#9](https://github.com/mattpatterson94/kikoe/pull/9))
- Recognition failures are surfaced instead of crashing or going silent:
  unsupported browsers, denied mic permission, and missing audio devices get
  distinct indicator states, and repeated network errors back off
  geometrically instead of hot-looping.
  ([#27](https://github.com/mattpatterson94/kikoe/pull/27))
- An utterance spoken while the initial subjects fetch is still in flight is
  retried once subjects arrive, instead of being dropped.
  ([#28](https://github.com/mattpatterson94/kikoe/pull/28))
- Voice commands are normalized (lowercased, trailing punctuation stripped)
  and checked across all recognizer alternatives, so finals like "Next." are
  recognized. ([#29](https://github.com/mattpatterson94/kikoe/pull/29))
- WaniKani page detection is anchored to the URL pathname instead of bare
  substring matches against the full URL, so lookalike paths and query
  params no longer false-positive.
  ([#30](https://github.com/mattpatterson94/kikoe/pull/30))
- Image-only radicals (e.g. "Rib Cage") no longer strand the card on
  "loading answers…": the card watcher now reads the prompt from the
  aria-label like `getPrompt` does (so card changes are detected and
  subjects are fetched), and the subject matcher bridges the on-screen
  space-separated name to the API's hyphenated slug (so the fetched
  radical is no longer filtered out of the context).
  ([#46](https://github.com/mattpatterson94/kikoe/pull/46))

## [0.6.0] - 2026-07-02

### Added

- `CompoundDictionary` builds readings for kanji compounds JMdict omits
  (何月 → なんがつ) from per-character readings.
  ([#4](https://github.com/mattpatterson94/kikoe/pull/4))
- Development watch/reload harness (`dev.js`) and expanded test coverage,
  including recognition tests.

### Fixed

- Subject fetch failures are surfaced on the idle indicator instead of
  silently returning nothing; transient errors retry with backoff and honor
  `RateLimit-Reset` on 429s. ([#4](https://github.com/mattpatterson94/kikoe/pull/4))
- Radical lookups never matched because the API's slugs are English names,
  not characters — the pruned radical set is now fetched once and matched
  locally, and cached empty results self-heal.
  ([#4](https://github.com/mattpatterson94/kikoe/pull/4))
- Answers were never submitted: `clickNext()` used a button selector that no
  longer exists in WaniKani's Stimulus-based quiz UI.
  ([#3](https://github.com/mattpatterson94/kikoe/pull/3))
- Silent live-transcript failures when the container was removed from the DOM
  or the page context was null after SPA navigation.
  ([#2](https://github.com/mattpatterson94/kikoe/pull/2))

## [0.5.0] - 2026-06-21

### Added

- Initial release: the WaniKani voice-input Tampermonkey userscript converted
  to a browser extension (Manifest V3 for Chrome, MV2 for Firefox).
  ([#1](https://github.com/mattpatterson94/kikoe/pull/1))
- Options page for API token, lightning mode, and live transcript settings,
  backed by `chrome.storage.sync` instead of wkof.
- Subject data fetched from the WaniKani API v2.
- Integrated WaniKani Speed userscript behaviour: auto-advance on correct
  answers (lightning mode) and auto-open item info on wrong answers.
- esbuild pipeline (`build.sh`) bundling the MAIN-world page script and
  ISOLATED content script.
- Vitest test suite: 118 tests covering candidates, flashcards, settings,
  the content script, WaniKani helpers, and the speed enhancer.

[Unreleased]: https://github.com/mattpatterson94/kikoe/compare/6553948...HEAD
[0.6.0]: https://github.com/mattpatterson94/kikoe/compare/9e4218f...6553948
[0.5.0]: https://github.com/mattpatterson94/kikoe/commit/9e4218f
