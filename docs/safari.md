# Safari Web Extension Spike

Tracking issue: [#64](https://github.com/mattpatterson94/kikoe/issues/64)

Kikoe can produce a Safari-targeted WebExtension bundle with:

```bash
npm run build
```

The build assembles the unpacked extension in `safari/`. That folder is intended
as the input to Apple's Safari Web Extension converter, which creates the Xcode
project and containing iOS/iPadOS/macOS app needed for Safari distribution.

```bash
xcrun safari-web-extension-converter safari/
```

## What This Reuses

- The shared page bundle from `src/app.ts`.
- The content-script bridge from `extension/content.ts`.
- The existing options UI, background handler, dictionary data, and icons.
- The same `webkitSpeechRecognition` path used by Chrome.

## Real-Device Checks

The first iOS/iPadOS validation pass should verify:

1. The extension can be enabled for `www.wanikani.com`, `bunpro.jp`, and
   `www.bunpro.jp`.
2. `content.js` injects `injected.js` and `bundle.js` into review pages.
3. `chrome.storage.sync`, `chrome.storage.local`, `chrome.runtime.getURL`, and
   `chrome.runtime.openOptionsPage` work in Safari's extension runtime.
4. The options page or containing app clearly tells users that Safari extension
   access and microphone access are separate setup steps.
5. Microphone permission can be granted from the injected Kikoe UI after opening
   a review page.
6. `webkitSpeechRecognition` emits interim/final results on iPhone or iPad.
7. WaniKani API-token storage and subject prefetching work after reload.

## Known Open Questions

- Whether Safari iOS allows `webkitSpeechRecognition` reliably from an injected
  extension UI rather than first-party page JavaScript.
- Whether the MV3 service worker is sufficient for the options-opening bridge on
  the minimum Safari version we want to support.
- Whether App Store review requires extra disclosure around microphone access,
  speech recognition, WaniKani API token storage, or wrapped site interaction.
