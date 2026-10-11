# Kikoe iOS app — notes

This started as a throwaway spike (the findings below) and is now the Kikoe
iOS app target. Architecture first, then the original spike notes.

## App architecture

| Piece | Where |
|---|---|
| App shell | `KikoeApp/KikoeApp.swift` (root view, nav bar, web container, developer debug bar), `AppModel.swift` (current site, enabled apps, onboarding state, live sessions, settings sheet; `SyncSettings` mirrors the sync storage area and runs the `settings_version` migration natively). |
| Apps | `Site.swift` is the registry: one case per site adapter in `src/site.ts`, with name, blurb, icon (the site's own touch icon/favicon, in the asset catalog), tint, home, review path and whether it needs a token. Users turn apps on/off in Settings → Apps (at least one stays on; turning one off unloads its page). The nav bar title is the current app; with two or more on it's a menu of them plus Manage Apps. |
| Onboarding | `OnboardingView.swift`, first launch only: welcome, pick apps, mic + speech permission with an explanation, WaniKani token (find it after setup, or paste and check), then a short how-to. |
| Per-site page | `PageSession.swift`: one `WKWebView` per enabled site, created on first visit and kept alive when switching. If iOS kills a background page's web process it reloads when shown again. The last-used site is remembered. |
| Content script | `ContentWorldShim.js` + `chrome/content.js` run as one user script in the isolated `WKContentWorld` "Kikoe", like a real content script. The `kikoeExt` handler (storage, runtime messages, script injection) is registered **only** in that world, so page JS (WaniKani's, BunPro's) can't read the API token or settings. `injected.js` / `bundle.js` are evaluated in the page world when content.ts appends their `<script>` tags. |
| Page world | `PageShim.js` (document start): serves bundled files for `fetch('kikoe-ext://ext/…')` via `kikoeResource` (read-only, bundle files only), reports mic permission as granted, forwards logs. Page-world handlers: `kikoeSpeech`, `kikoeUI`, `kikoeLog`, `kikoeResource`. |
| Storage | `ExtensionStorage.swift`: chrome.storage areas as JSON files in Application Support (`ExtensionStorage/{sync,local}.json`). The spike's UserDefaults blobs migrate on first read. The API token is the exception: it's kept in the Keychain (this device only, after first unlock), merged into reads and split out of writes under the same `apiToken` key, so the JS can't tell; a token found in the file moves over. Every write posts a notification; sessions relay sync-area changes to `chrome.storage.onChanged`, so the native settings screen and open pages stay in step. |
| Speech | `SpeechService.swift`: one recognizer shared by both sites. The page that last sent `start` owns it; stop/reset/hints from any other page are ignored and only the owner gets results. If the chosen analyzer engine fails for a language it falls back to SFSpeechRecognizer and says so in settings. Idle timer honours `keep_screen_awake`. |
| Overlays | `Overlays.swift`: the JS side posts overlay state to `kikoeUI` (see `src/native_ui.ts`) and draws no DOM chips. Native: mic pill in the nav bar, a green or red icon for on/off (tap = mute/unmute); a floating transcript bubble (bottom by default, top per the transcript position setting, theme from settings) that stays up for the whole review: between answers it shows the mic state, a live input-level meter fed from the capture tap (`MicLevel`) and "Listening", or the problem that needs attention (tap = same as the pill, e.g. opens the token page). Results ("M no match ＋") show as a separate chip next to that pill rather than replacing it, and fade after 3 s (8 s with a correction offer) or as soon as new speech arrives, so it's always visible that Kikoe went back to listening. With the bubble off, a warning banner shows problem states instead. The nav bar's More menu (an `.equatable()` view of plain values, since a Menu rebuilt mid-tap by the screen's constant re-renders dropped the tap) has Reload Page, Listen In (a small sheet: Automatic / Japanese / English; overrides the recognizer locale for the current card only; cleared on the next card. The matcher still grades by card type), Voice Commands (the help sheet, when the help button setting is on) and Settings. Also a small correction sheet, "Count “M” as まい?" with Not Now / Save (dispatches `kikoe:addCorrection` in the page world, the same path the DOM `confirm()` uses), help sheet, first-run hint toast. |
| Settings | `SettingsView.swift`: native Form mirroring `extension/options.html`, writing the same sync keys. Token: paste/reveal, live check against `api.wanikani.com/v2/user`, and "Find my token" (arms content.ts's discovery flags and opens the token page; on capture settings reopen). Corrections list with add/edit/delete. Advanced: recognizer (default SpeechTranscriber on iOS 26, best top-1 in the probe) and contextual hints. Developer (off by default): debug bar, TTS "Say" button, recognition probe. |

Native-only preferences (engine, hints, last site, enabled apps, onboarded, developer toggles) are in
UserDefaults under `kikoe.*`. The user-agent override from the spike is gone.

Debug-build-only environment hooks (`#if DEBUG`):

- `KIKOE_SITE=wanikani|bunpro` picks the starting site.
- `KIKOE_FIXTURE=<path to tests/fixtures/*.html>` loads a frozen review card
  in that site's session, under its review URL, and skips onboarding.
- `KIKOE_SKIP_ONBOARDING=1` skips onboarding without a fixture.
- `KIKOE_EVAL_PAGE=<js>` runs in the page world 3s after each load.
- `KIKOE_SAY=<text>` presets the developer "Say" field.
- Launch argument `-probe` opens the recognition probe directly.

# Original spike notes

Throwaway spike, October 2026 (Xcode 27.0, iOS 26.5 Simulator, macOS 27). It
asks whether a WKWebView wrapper with native speech recognition should replace
Safari + the Kikoe web extension on iPhone/iPad, and specifically whether
seeding the recognizer with each card's accepted answers fixes the short
on'yomi misrecognitions described at the top of `src/recognition.ts`.

**Verdict:**

- The wrapper works mechanically. The unmodified Kikoe bundle runs inside
  WKWebView, and a voice answer went through the native bridge into the real
  BunPro adapter.
- Contextual strings help, but not the way we hoped:
  - They roughly **double** accuracy when *Strict kanji readings* is on.
  - They barely move it in the default (lenient) mode.
- The bigger accuracy win is Apple's newer `SpeechTranscriber` model, which
  *ignores* contextual strings. It needs a real device to evaluate on iOS. See
  "Next steps".

## What was built

| Piece | Where |
|---|---|
| Native bridge recognizer (JS) | `src/native_recognition.ts` (+ tests). `createRecognition` picks it when `window.webkit.messageHandlers.kikoeSpeech` exists; the Web Speech path is untouched. |
| Per-card hints | `app.ts` calls `recognition.setHints?.(answerHints(context))` on every card change. Reading cards send readings plus the prompt (Japanese only), meaning cards send meanings. |
| Locale switching | Unchanged `setLanguage` → native `start` with the new `lang` (ja-JP / en-US). |
| SwiftUI app + WKWebView | `KikoeSpike/KikoeSpikeApp.swift`: WaniKani/BunPro switcher, debug bar, settings sheet. |
| Content-script host | `KikoeSpike/KikoeBridge.swift` + `ExtensionShim.js`. The built `chrome/content.js`, `injected.js` and `bundle.js` are injected as one page-world `WKUserScript` with a `chrome.*` shim (`storage.sync/local` → UserDefaults, `runtime.getURL` / `sendMessage`, `fetch` of `data/*.json` served from the app bundle). |
| Engines | `LegacySpeechEngine.swift` (SFSpeechRecognizer, `contextualStrings`, on-device when available). `AnalyzerSpeechEngine.swift` (iOS 26 `SpeechAnalyzer` with `DictationTranscriber` or `SpeechTranscriber`, `AnalysisContext.contextualStrings`, `.alternativeTranscriptions`). Switchable at runtime in settings. |
| Idle timer | `isIdleTimerDisabled = true` while listening, reset on stop. |
| Accuracy probe | `ProbeView.swift` (launch with `-probe`) and `macos-probe.swift` (same cases on macOS). Results in `probe-results/`, scored by `score-probe.ts` with Kikoe's real matcher. |

Build: `npm run build`, then open `ios/Kikoe.xcodeproj`.

- The app is named "Kikoe", with bundle id `com.mattdoesdev.kikoe.wrapper` (now `com.mattdoesdev.kikoe`, see Releasing) and
  team 5UNQUGVP8A on automatic signing. It installs next to the Safari
  extension app rather than replacing it.
- The icon is the Safari app's own: a copy of the opaque
  `universal-icon-1024@1x.png` that `safari-web-extension-converter` makes
  from `extension/safari-icons/icon1024.png` (the source has a transparent
  background, which iOS would fill with black). The launch/accent colours come
  from `scripts/customize-safari-app.js`. A run-script phase
copies `chrome/{content,bundle,injected}.js` and `chrome/data/*.json` into the
app bundle. Debug environment variables: see "App architecture" above.

## Accuracy on short on'yomi

**Method:**

- 20 single-kanji reading cards (会かい, 計けい, 道どう, 口こう, 四し, 木き,
  中ちゅう, 上じょう, 生せい, 日にち, 業ぎょう, 用よう, 早そう, 後ご, 火か,
  気け, 下げ, 数すう, 工く, 手しゅ).
- Each reading is spoken by the system ja-JP TTS voice and run through each
  engine, without and with `[reading, prompt]` as contextual strings.
- Every alternative is scored with Kikoe's actual `checkAnswer` +
  app.ts's transformer chain + the JMdict/KANJIDIC dictionary.
- Columns:
  - **top-1**: the best transcript is accepted.
  - **any**: any alternative is accepted. This is what Kikoe uses, since it
    tries all alternatives.
  - **strict**: any alternative is accepted with *Strict kanji readings* on,
    so a bare kanji like 生 no longer counts as "probably said the right
    reading".

| Engine (where) | Hints | top-1 | any | strict |
|---|---|---|---|---|
| SFSpeechRecognizer (Simulator → Apple server) | off | 12/20 | 14/20 | **6/20** |
| SFSpeechRecognizer (Simulator → Apple server) | on | 12/20 | 15/20 | **12/20** |
| DictationTranscriber (macOS 27, on-device) | off | 9/20 | 14/20 | **6/20** |
| DictationTranscriber (macOS 27, on-device) | on | 10/20 | 14/20 | **11/20** |
| SpeechTranscriber (macOS 27, on-device) | off | 14/20 | 18/20 | 13/20 |
| SpeechTranscriber (macOS 27, on-device) | on | 14/20 | 18/20 | 13/20 |

Two Simulator runs gave identical results. Three of the Simulator's misses
(ご, か, げ) are server throttling (`203 Retry`) after 4 retries, not
misrecognitions.

What this says:

- **Hints do work, by adding the exact kana.** With hints on, SFSpeech and
  DictationTranscriber add the hinted kana as an extra alternative, e.g.
  けい → `["けい","兄","計",…]`; ちゅう gains 中; く gains く. In default
  mode Kikoe already rescues most of these through the dictionary (兄 → けい),
  so the lenient score barely moves. In **strict** mode, which is the only
  mode where a wrong reading can't pass on a homophone kanji, hints take
  SFSpeech from 6 to 12 and Dictation from 6 to 11.
- **SpeechTranscriber is the better model and ignores hints.** Its outputs
  were byte-identical with and without `contextualStrings`. Its alternatives
  look more like n-best fragments (かい → `["はい。","は","か","会"]`). It
  appends `。`, which Kikoe would need to strip; `score-probe.ts` does.
- **Persistent failures across every engine:**
  - かい → はい: Dictation/SFSpeech only; SpeechTranscriber gets it.
  - すう → する
  - ちゅう → チル/汁
  These are candidates for the built-in corrections table regardless of the
  wrapper decision.
- **Caveats:**
  - TTS is not a learner's voice. Absolute numbers will differ, but the
    with/without-hints delta comes from identical audio.
  - The Simulator has no on-device ja-JP model, so its SFSpeech numbers are
    Apple's *server* recognizer: close to what Safari's Web Speech uses, but
    not what a device would do with `requiresOnDeviceRecognition`.
  - SpeechAnalyzer can't run in the Simulator: DictationTranscriber has no
    audio format there, and SpeechTranscriber reports ja-JP unsupported. So
    its numbers come from macOS 27, which shares the models with iOS 26.

## Mic and session stability vs Safari + extension

Measured: the design, a Simulator run, and the failure modes we hit. Not
measured: hours of real reviews on a device. That still needs doing.

- **One audio engine for the whole session.** `MicCapture` owns a single
  `AVAudioEngine` tap, and recognizers subscribe to its buffers. Changing card,
  locale or engine swaps the recognition request, never the audio route.
  Safari's Web Speech, by contrast, tears down and re-prompts on `onend`,
  which `src/recognition.ts` works hard to paper over.
  - Audio session: `.playAndRecord` with `.mixWithOthers` and
    `.defaultToSpeaker`, so WaniKani's reading audio still plays. If the page's
    own audio gets recognised as an answer, `.voiceChat` mode (echo
    cancellation) is the next thing to try.
- **Utterance segmentation is our problem now.**
  - SFSpeech has no "utterance ended" event. The spike ends a request after
    0.8s with no change in partials, then immediately opens the next one.
  - On the Simulator (whose mic is the Mac's real microphone), continuous room
    audio such as TV and conversation kept partials changing, so the
    injected answer was absorbed into a long junk utterance.
  - On a device this calls for a VAD/energy gate, or SpeechTranscriber's own
    finalisation (`.fastResults`; `DictationTranscriber` has
    `.frequentFinalization`).
  - The app uses those, but they finalize in short segments, so one word
    can arrive as two finals (まちが, い) and miss a command. The Analyzer
    engine joins back-to-back segments and posts the utterance as final
    only after 600 ms with no new segment. Alternatives only vary the
    latest segment; earlier ones contribute their top guess.
- **Background noise:** `MicCapture` turns on Apple's voice processing
  (`setVoiceProcessingEnabled`, the FaceTime path: noise suppression plus
  echo cancellation, so the page's reading audio isn't heard as an answer)
  with minimum ducking. Settings → Advanced → Reduce background noise, on
  by default; toggling restarts the mic. Not yet compared on a device.
- **Error noise:**
  - Server SFSpeech emits `203 Empty recognition` / `203 Retry` constantly in
    silence. These are now restarted quietly instead of being surfaced as
    `network` errors.
  - `kLSRErrorDomain 300` means the on-device model failed to load. It
    triggers a server fallback.
  - Hit along the way: a half-downloaded asset from an
    `AssetInventory.assetInstallationRequest` attempt left the Simulator's
    local recognizer permanently failing with 300 until the asset directory
    was removed. A real app must handle asset download failure and retry, and
    not leave reservations dangling.
- **Permissions:**
  - The OS asks once for mic + speech recognition, at the first `start`, and
    the answer persists. No per-page-load prompts as in Safari.
  - The shim reports `navigator.permissions.query({name:'microphone'})` as
    granted, so Kikoe's own mic-permission UX stays quiet.
- **Screen lock:** `isIdleTimerDisabled` replaces the Wake Lock path and is
  reliable. It is tied to "listening", not to "app open".
- **Not yet tested:**
  - backgrounding and foregrounding mid-review;
  - interruptions (phone call, Siri);
  - route changes (AirPods connect/disconnect);
  - memory with the 12 MB dictionary in a long-lived webview.

## Google sign-in inside WKWebView

**Not an issue for the web login flows as they stand today.**

- **BunPro:**
  - `bunpro.jp/login` and `/signup` are email + password only. There's no
    "Sign in with Google" button, whether in WKWebView or in a desktop
    browser, so Google's `disallowed_useragent` block never comes into play.
  - Users who created an account through BunPro's own mobile app with a social
    login (if it offers one; not checked) would need to set a password first.
- **WaniKani:** email + password only.
- **If a site adds Google OAuth later:**
  - The correct fix is `ASWebAuthenticationSession` for the OAuth hop, then
    handing the session cookie to the webview.
  - The settings sheet's "Safari-like" user-agent toggle exists only to test
    that path and should not ship. Spoofing the UA violates Google's policy.

## App Store risk (4.2 / 5.2.2)

- **4.2, minimum functionality:**
  - A bare webview of two websites would be at risk.
  - Native speech recognition, per-card contextual hints, offline dictionary
    matching, voice commands and the settings UI are real native
    functionality, which is the usual argument that gets wrappers through.
  - Lean on the native parts in the review notes, and ship native settings
    rather than the extension's HTML options page.
- **5.2.2, third-party services:**
  - The app displays and automates WaniKani's and BunPro's sites. Permission,
    or at least non-objection, from Tofugu and BunPro is the safe route.
  - BunPro exposes `#quiz-metadata-element` specifically for third-party
    tools, which helps. Using a user-supplied WaniKani API token is within
    WaniKani's API terms.
- **Security:**
  - Everything, including the WaniKani API token read through the
    `chrome.storage` shim, runs in the **page** world, so the site's own JS can
    read it.
  - Fixed in the app: the content script now runs in an isolated
    `WKContentWorld` (see "App architecture"). Verified in the Simulator: page
    JS sees no `kikoeChrome` and no `kikoeExt` handler, while `CustomEvent`
    details still cross worlds in both directions (`kikoe:addCorrection`
    page → content, `kikoe:subjectData`/`settingsChanged` content → page).

## Releasing

- The app ships as the iOS/iPadOS version of the existing Kikoe listing:
  bundle id `com.mattdoesdev.kikoe`, the same as the Safari-extension app.
  The macOS version stays the Safari extension (`scripts/build-safari-app.sh`).
  iOS and macOS builds of that bundle id share build numbers, so pick one
  above both (0.12.0 went up as build 100).
- `ios/scripts/build.sh <build> --upload` builds the web bundles, syncs the
  version, archives and uploads to App Store Connect with the account signed
  in to Xcode. Without `--upload` it exports an .ipa to `ios/build/export`.
- `KikoeApp/PrivacyInfo.xcprivacy` declares UserDefaults (CA92.1) and no data
  collection or tracking. Update it if the app starts using another
  required-reason API.
- Review notes should stress the native functionality (on-device speech
  recognition, native settings and overlays; guideline 4.2) and that the user
  signs in to their own WaniKani/BunPro accounts (5.2.2).

## Release pipeline change

Today, `scripts/build-safari-app.sh`:

- runs `safari-web-extension-converter` on every build;
- regenerates a throwaway `Kikoe/` Xcode project (gitignored);
- patches version, build number and team with `sed`;
- injects Info.plist keys with `plutil`;
- customises the containing-app HTML with `customize-safari-app.js`.

`export-safari-app.sh` then archives and exports.

With a wrapper app:

1. **Check in the Xcode project.** Done: `ios/Kikoe.xcodeproj`, using Xcode 16+'s folder-synchronised groups so adding a Swift file
   doesn't churn `project.pbxproj`.
   - Version and team move into an `.xcconfig`:
     - `MARKETING_VERSION` comes from `package.json`, via a tiny script that
       writes the xcconfig;
     - `CURRENT_PROJECT_VERSION` is passed on the `xcodebuild` command line;
     - `DEVELOPMENT_TEAM = 5UNQUGVP8A`.
   - Info.plist keys (`ITSAppUsesNonExemptEncryption`,
     `LSApplicationCategoryType`, mic and speech usage strings) live in the
     project, not in post-hoc `plutil` calls.
2. **The web build becomes an input, not the source of the project.**
   `npm run build` produces `chrome/*.js` + `chrome/data/*.json`, and a build
   phase copies them in (`copy-web-assets.sh`). In a real version, output an
   `ios/` target from `build.js` instead of borrowing `chrome/`'s files.
3. **The build script shrinks to:**

   ```
   npm run build
   xcodebuild archive -project Kikoe.xcodeproj -scheme Kikoe \
     CURRENT_PROJECT_VERSION=$BUILD
   xcodebuild -exportArchive ...
   ```

   `customize-safari-app.js` and the `sed` patching go away for iOS.
4. **Safari on macOS:**
   - If the Mac Safari extension is kept, either keep the converter path for
     macOS only, or convert once more and check that project in too.
   - The cleanest end state is one checked-in project with two targets: the
     iOS/iPadOS wrapper app, and the macOS Safari-extension app.
   - Shipping both under the same bundle id would need a Mac Catalyst or
     "Designed for iPad" decision. Simplest is a new bundle id for the iOS
     app, with the existing iOS Safari extension deprecated in its favour.
5. **CI:** Linux CI (`ci.yml`) stays as is. Archiving needs a macOS runner,
   or keep doing it locally as today.

## Next steps

1. **Device run.** This is the important one. Set a signing team on the
   target and run it on the iPhone 16 Pro / iPad:
   - `-probe` gives on-device numbers for all three engines, including
     SpeechTranscriber on iOS.
   - Then do a real WaniKani and BunPro session with a human voice.
2. If SpeechTranscriber holds up on device:
   - default to it;
   - keep SFSpeech + hints as the fallback for older OSes;
   - consider running both and merging alternatives on reading cards: hints
     give the exact kana, SpeechTranscriber gives the better top-1.
3. Add a VAD gate or engine finalisation in place of the 0.8s settle timer.
4. Move the content-script host into an isolated content world before anything
   ships.
5. Add ちゅう/すう/かい misrecognitions to the built-in corrections table.
   That's independent of the wrapper.
