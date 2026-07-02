<p align="center">
  <img src="extension/logo.svg" alt="Kikoe（聞こえ）" width="420">
</p>

# Kikoe（聞こえ）

**Kikoe** (from 聞こえる, "to be heard") is a browser extension that lets you answer [WaniKani](https://www.wanikani.com) and [BunPro](https://bunpro.jp) reviews and lessons using your voice instead of typing. Speak your answer and the extension submits it automatically, no hands required.

## Features

- Voice-driven reviews: speak reading and meaning answers during WaniKani reviews, lessons, and quizzes
- BunPro support, using the same voice-driven flow on BunPro reviews (Fill In and Translate questions with manual input; no API token needed)
- Smart speech matching that handles common speech-to-text quirks: romaji-to-hiragana conversion, fuzzy vowel matching, numeral recognition (kanji/English), suru verb normalization, and more
- Turbo mode, which auto-advances to the next card on a correct answer
- Ippatsu mode (一発), an optional one-shot challenge: a wrong answer auto-submits instead of allowing endless retries, toggled separately for meaning and reading questions
- Live transcript, an optional overlay showing what the extension heard in real time
- Voice commands: say "next" (or 次) to advance, "wrong" / 間違い to mark an answer incorrect
- Automatic language switching between Japanese recognition for reading questions and English for meaning questions

## Requirements

- A [WaniKani](https://www.wanikani.com) account and/or a [BunPro](https://bunpro.jp) account
- For WaniKani: an API token (read-only is sufficient). BunPro needs no token, since the accepted answers are already on the review page.
- Chrome/Chromium (Manifest V3) or Firefox 109+ (Manifest V2)
- Node.js and npm (to build from source)
- Microphone access granted to the browser

## Building from Source

```bash
git clone https://github.com/mattpatterson94/kikoe.git
cd kikoe
npm run build
```

`npm run build` downloads dictionary data (~12 MB, cached after the first run) and assembles the unpacked extension in the `chrome/` and `firefox/` directories.

To also produce distributable zip files:

```bash
npm run pack        # builds both
npm run pack:chrome # chrome only → dist/kikoe-chrome.zip
npm run pack:firefox # firefox only → dist/kikoe-firefox.zip
```

## Installation

### Chrome

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `chrome/` folder inside the repo.
5. The extension appears in your toolbar. Proceed to [First-time setup](#first-time-setup).

### Firefox

1. Open `about:debugging` in Firefox.
2. Click **This Firefox** in the left sidebar.
3. Click **Load Temporary Add-on…**
4. Navigate to the `firefox/` folder and select `manifest.json`.
5. The extension is now active for this session. Proceed to [First-time setup](#first-time-setup).

> **Note:** Firefox only supports temporary add-on loading in development. The extension will be removed when Firefox restarts. For a permanent install, you would need to submit the extension to AMO or sign it manually with `web-ext`.

## First-time Setup

1. Click the extension icon in your browser toolbar (or open the options page from the extensions menu).
2. Paste your WaniKani **API Token** into the API Token field.
   - Get one from [WaniKani → Settings → Personal Access Tokens](https://www.wanikani.com/settings/personal_access_tokens). A read-only token is sufficient.
   - Skip this step if you only use BunPro, since no token is needed there.
3. Click **Save settings**.
4. When prompted, allow the browser to access your microphone.

## Using the Extension

Once installed and configured, the extension activates automatically on any WaniKani review, lesson, or quiz page, and on BunPro review sessions.

**Speaking an answer:**

- For **reading** questions, speak the reading in Japanese (hiragana/katakana/romaji are all understood).
- For **meaning** questions, speak the English meaning.
- The extension submits the answer automatically when it hears a match.

**Voice commands** (available at any time during a session):

| Say | Action |
|-----|--------|
| `next` / `次` / `つぎ` | Advance to the next card |
| `wrong` / `incorrect` / `mistake` | Mark the current answer wrong |
| `間違い` / `まちがい` / `だめ` | Mark the current answer wrong (Japanese) |
| `pause` / `stop listening` / `ストップ` | Mute the mic |

Muting is one-way by voice: since recognition stops while muted, there's no voice command to unmute. Click the listening indicator (bottom-right) to toggle the mic on/off at any time; it also shows a distinct "Muted" state.

**How matching works:**

The extension applies several candidate transformations to improve recognition accuracy:

- Romaji → hiragana conversion
- を → お substitution (common speech error)
- Fuzzy vowel matching (long vowels, double consonants)
- Dictionary lookups with Levenshtein distance fuzzy matching
- Compound word splitting
- Suru verb normalization
- Numeral recognition (kansuji, English words → digits)
- Repeating substring handling

**BunPro notes:**

- Fill In (cloze) questions expect a Japanese answer; Translate questions expect English. The recognition language switches automatically.
- Cards from decks set to **Reveal & Grade** have no text input and are driven entirely by voice commands instead:

  | Say | When | Action |
  |-----|------|--------|
  | `reveal` / `show` / `show answer` / `answer` / `見せて` / `答え` | Answer hidden | Show the answer |
  | `good` / `known` / `correct` / `わかった` | Answer shown | Grade as known |
  | `bad` / `again` / `わからない` | Answer shown | Grade as not known |
- BunPro's own native Lightning Mode setting is detected at runtime, so enabling the extension's turbo mode won't double-advance.

## Settings

Open the extension options page (via the toolbar icon or extensions menu) to configure:

### WaniKani API

| Setting | Description |
|---------|-------------|
| API Token | Your WaniKani read-only API token |

### Turbo Mode

| Setting | Default | Description |
|---------|---------|-------------|
| Turbo mode | On | Auto-advances to the next card after a correct answer |
| Show item info on wrong answer | On | Opens the item info panel automatically when you answer incorrectly |

### Ippatsu Mode（一発）

One shot per question. Normally a non-matching answer is silently ignored so
you can retry until you get it right; with ippatsu mode on, a genuine miss (an
answer of the right type that doesn't match) is submitted as wrong
immediately. Recognizer glitches, like English picked up on a reading
question, don't count as your shot. The two toggles are separate because
meaning answers are usually easier to land first try than readings, where
pronunciation slips are more likely.

| Setting | Default | Description |
|---------|---------|-------------|
| Meaning questions (English) | Off | A wrong meaning answer auto-submits instead of allowing retries |
| Reading questions (Japanese) | Off | A wrong reading answer auto-submits instead of allowing retries |

### Live Transcript

| Setting | Default | Description |
|---------|---------|-------------|
| Show live transcript | On | Displays an overlay of what the extension heard |
| Theme | System | Overlay color theme (system, light, or dark) |
| Position | Top | Where the transcript appears (top or bottom of the page) |

### Custom Corrections

When speech recognition keeps mishearing an answer (everyone's mic and accent
produce different recurring misrecognitions), add your own corrections mapping
what was heard to what you meant, e.g. `ec2` → `いしつ` or `web cage` →
`ribcage`. Corrections apply to both reading and meaning questions, take
precedence over the built-in correction tables, and take effect on your next
answer without reloading the review page. The intended value for a reading can
be entered in kana or romaji.

### Advanced

| Setting | Default | Description |
|---------|---------|-------------|
| Debug mode | Off | Logs diagnostic details (speech matching, subject loading, token discovery) to the browser console, prefixed with `[kikoe]` |

## Development

```bash
npm test          # run tests once
npm run test:watch # re-run tests on file changes
npm run test:coverage # generate coverage report
```

Tests use [Vitest](https://vitest.dev/) with jsdom.

### Project Structure

```
src/
  app.js              # main entry point, orchestrates recognition and submission
  recognition.js      # Web Speech API wrapper
  site.js             # hostname → site detection (wanikani / bunpro)
  wanikani.js         # WaniKani page interaction (DOM selectors, answer submission)
  bunpro.js           # BunPro page interaction (quiz metadata element, answer submission)
  bunpro_speed.js     # BunPro turbo mode / speed enhancements
  flashcards.js       # answer checking logic
  dict.js             # dictionary loading (JMdict / KANJIDIC2)
  settings.js         # settings management
  speed.js            # turbo mode / speed enhancements
  live_transcript.js  # transcript overlay UI
  util.js             # shared utilities
  candidates/         # speech-to-answer transformation pipeline
    to_hiragana.js
    convert_wo.js
    basic_dictionary.js
    split_dictionary.js
    suru_verbs.js
    repeating.js
    fuzzy_vowels.js
    multiple.js
    numerals.js
extension/
  content.js          # content script (loads bundle, manages API token / caching)
  injected.js         # page-context injected script
  options.html        # settings UI
  options.js          # settings UI logic
chrome/               # assembled Chrome extension (output of build)
firefox/              # assembled Firefox extension (output of build)
```

## Troubleshooting

**The extension does nothing on WaniKani pages.**
- Check that the extension is enabled and the API token is saved in settings.
- Open the browser console on a WaniKani review page and look for `[kikoe]` log messages.
- Make sure you granted microphone permission to the browser.

**Speech recognition isn't working.**
- Chrome has the best support for the Web Speech API. Firefox support may be limited.
- Ensure your microphone is not muted and the browser has permission to use it.
- Check the browser console for `[kikoe]` errors.

**Answers aren't being matched.**
- Enable the live transcript to see what the extension is hearing.
- Try speaking more slowly and clearly.
- For reading questions, romaji input is also accepted.

## Acknowledgments

Kikoe builds on ideas from earlier userscripts:

- [WaniKani Speed](https://greasyfork.org/en/scripts/377778-wanikani-speed) by roboro
- [WK Voice Recognition Experiment](https://greasyfork.org/scripts/12431-wk-voice-recognition-experiment) by okonomichiyaki
- [WaniKani Open Framework](https://greasyfork.org/en/scripts/38582-wanikani-open-framework) by Robin Findley

## License

See [LICENSE](LICENSE) for details.
