# Privacy Policy — Kikoe（聞こえ）

_Last updated: 2 July 2026_

Kikoe is a browser extension that lets you answer [WaniKani](https://www.wanikani.com) and [BunPro](https://bunpro.jp) reviews using your voice. This policy describes what data the extension handles and what happens to it.

## Summary

Kikoe does not collect, sell, or share your data. No data is ever sent to the developer or to any third-party service operated by the developer. There are no analytics, no tracking, and no advertising.

## Data the extension handles

### WaniKani API token

If you use Kikoe with WaniKani, you provide a WaniKani API token (a read-only token is sufficient) on the extension's options page.

- The token is stored locally in your browser using the browser's extension storage (`chrome.storage`).
- It is sent only to WaniKani's official API (`api.wanikani.com`) to fetch the accepted readings and meanings for the items in your reviews, so your spoken answers can be verified.
- It is never sent anywhere else, and the developer never has access to it.

You can remove the token at any time from the options page, or by uninstalling the extension, which deletes all stored data.

### Settings

Your preferences (such as turbo mode and transcript overlay visibility) are stored locally in your browser's extension storage. They never leave your device.

### Microphone audio and speech

Kikoe uses your browser's built-in Web Speech API to convert your speech to text. The extension itself never records, stores, or transmits audio.

Your browser's speech recognition service may process audio on the browser vendor's servers (for example, Chrome's speech recognition is provided by Google). This processing is performed by your browser, not by Kikoe, and is governed by your browser vendor's privacy policy.

### Page content

On WaniKani and BunPro review pages, the extension reads the current question and, for BunPro, the accepted answers shown on the page, in order to check your spoken answer and fill in the answer field. This happens entirely within the page in your browser. Page content is never collected, stored, or transmitted.

## Data sharing

Kikoe shares data with no one. The only network requests the extension makes are to WaniKani's official API on your behalf, using your own token, as described above.

## Changes to this policy

If the extension's data handling ever changes, this document will be updated and the change will be noted in the release notes.

## Contact

Questions or concerns? Open an issue at
https://github.com/mattpatterson94/kikoe/issues
