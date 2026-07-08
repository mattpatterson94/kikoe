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
- In-page help: say "help" (or ヘルプ) or click the ? button next to the listening indicator for a cheat sheet of the commands that work on the current card
- Automatic language switching between Japanese recognition for reading questions and English for meaning questions

## Chrome Web Store Description Excerpt

New in 0.8.0: one-click corrections make Kikoe easier to tune while you review. If speech recognition repeatedly hears the wrong phrase, the live transcript can show a no-match correction bubble for the current accepted answer. Click it, confirm the mapping, and Kikoe saves that correction and submits the intended answer immediately, without leaving your WaniKani or BunPro session.

## Requirements

- A [WaniKani](https://www.wanikani.com) account and/or a [BunPro](https://bunpro.jp) account
- For WaniKani: an API token (read-only is sufficient). BunPro needs no token, since the accepted answers are already on the review page.
- Chrome/Chromium (Manifest V3), Firefox 109+ (Manifest V2), or Safari Web Extension tooling for the mobile Safari spike
- Node.js and npm (to build from source)
- Microphone access granted to the browser

## Building from Source

```bash
git clone https://github.com/mattpatterson94/kikoe.git
cd kikoe
npm run build
```

`npm run build` downloads dictionary data (~12 MB, cached after the first run) and assembles the unpacked extension in the `chrome/`, `firefox/`, and `safari/` directories.

To also produce distributable zip files:

```bash
npm run pack        # builds all browser zips
npm run pack:chrome # chrome only → dist/kikoe-chrome.zip
npm run pack:firefox # firefox only → dist/kikoe-firefox.zip
npm run pack:safari # safari only → dist/kikoe-safari-web-extension.zip
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

### Safari Web Extension

1. Run `npm run build`.
2. Convert the generated `safari/` extension with Apple's Safari Web Extension converter:

   ```bash
   xcrun safari-web-extension-converter safari/
   ```

3. Open the generated Xcode project, choose the iOS/iPadOS or macOS containing app target, and run it on a device or simulator.
4. Enable the extension in Safari and grant site access for WaniKani and BunPro.
5. Proceed to [First-time setup](#first-time-setup).

See [docs/safari.md](docs/safari.md) for the current spike notes and real-device validation checklist.

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

<!-- BEGIN GENERATED voice-commands (from src/commands.ts — regenerate with `npm run readme:commands`) -->
| Say (English) | Say (Japanese) | Action |
| ------------- | -------------- | ------ |
| `next` | `次` / `つぎ` / `ねくすと` / `ネクスト` | Advance to the next card |
| `wrong` / `incorrect` / `mistake` | `間違い` / `まちがい` / `不正解` / `ふせいかい` / `だめ` / `ダメ` / `駄目` | Mark the current answer wrong |
| `pause` / `stop listening` | `ストップ` | Mute the mic (click the Muted chip to resume) |
| `help` / `commands` | `ヘルプ` / `へるぷ` / `コマンド` | Show or hide the command cheat sheet |
<!-- END GENERATED voice-commands -->

Muting is one-way by voice: since recognition stops while muted, there's no voice command to unmute. Click the listening indicator (bottom-right) to toggle the mic on/off at any time; it also shows a distinct "Muted" state.

**In-page help:**

Saying `help` (or clicking the **?** button next to the listening indicator) opens a panel listing the voice commands that work on the current card, the language currently being listened for, and a few tips. The mic is paused while the panel is open, so reading the command list aloud won't trigger anything, and it resumes when the panel closes (✕, `Esc`, or click away). `help` is checked after answer matching, so on a card whose accepted answer is "help" (助け, 手伝う), saying it submits your answer as normal.

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

  <!-- BEGIN GENERATED bunpro-reveal-grade (from src/commands.ts — regenerate with `npm run readme:commands`) -->
  | Say (English) | Say (Japanese) | When | Action |
  | ------------- | -------------- | ---- | ------ |
  | `reveal` / `show` / `show answer` / `answer` | `見せて` / `みせて` / `答え` / `こたえ` | Answer hidden | Show the answer |
  | `good` / `known` / `correct` | `わかった` / `分かった` | Answer shown | Grade as known |
  | `bad` / `again` | `わからない` / `分からない` | Answer shown | Grade as not known |
  <!-- END GENERATED bunpro-reveal-grade -->
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
| Show help button | On | The ? button next to the listening indicator; saying "help" works even when it's hidden |

### Custom Corrections

When speech recognition keeps mishearing an answer (everyone's mic and accent
produce different recurring misrecognitions), add your own corrections mapping
what was heard to what you meant, e.g. `ec2` → `いしつ` or `web cage` →
`ribcage`. Corrections apply to both reading and meaning questions, take
precedence over the built-in correction tables, and take effect on your next
answer without reloading the review page. The intended value for a reading can
be entered in kana or romaji.

When the live transcript shows a `no match` bubble during a review, click the
bubble to confirm and save a correction from what Kikoe heard to the current
accepted answer.

### Advanced

| Setting | Default | Description |
|---------|---------|-------------|
| Debug mode | Off | Logs diagnostic details (speech matching, subject loading) to the browser console, prefixed with `[kikoe]` |

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
  app.ts              # main entry point, orchestrates recognition and submission
  recognition.ts      # Web Speech API wrapper
  site.ts             # hostname → site detection (wanikani / bunpro)
  wanikani.ts         # WaniKani page interaction (DOM selectors, answer submission)
  bunpro.ts           # BunPro page interaction (quiz metadata element, answer submission)
  bunpro_speed.ts     # BunPro turbo mode / speed enhancements
  flashcards.ts       # answer checking logic
  dict.ts             # dictionary loading (JMdict / KANJIDIC2)
  settings.ts         # settings management
  speed.ts            # turbo mode / speed enhancements
  live_transcript.ts  # transcript overlay UI
  commands.ts         # voice command registry (matcher + help panel source of truth)
  help.ts             # in-page help chip, cheat-sheet panel, first-run hint
  candidates/         # speech-to-answer transformation pipeline
    to_hiragana.ts
    convert_wo.ts
    basic_dictionary.ts
    split_dictionary.ts
    compound_dictionary.ts
    suru_verbs.ts
    repeating.ts
    fuzzy_vowels.ts
    multiple.ts
    numerals.ts
extension/
  content.ts          # content script (loads bundle, manages API token / caching)
  injected.js         # page-context injected script
  background.js       # background service worker (opens the options page)
  options.html        # settings UI
  options.js          # settings UI logic
chrome/               # assembled Chrome extension (output of build)
firefox/              # assembled Firefox extension (output of build)
safari/               # assembled Safari Web Extension (output of build)
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
