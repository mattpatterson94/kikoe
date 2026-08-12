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

After conversion, customize the generated containing app page:

```bash
npm run safari:customize-app -- Kikoe
```

## App Store Builds

For an actual App Store submission, use the script instead of running those
steps by hand — it does the build, conversion, customization, archiving, and
export in one pass:

```bash
npm run safari:app -- <build-number>
```

The marketing version comes from `package.json`. Output lands in
`dist/safari-app/ios/Kikoe.ipa` and `dist/safari-app/macos/Kikoe.pkg`, ready to
drag into Transporter.

The build number is a floor rather than an exact value: Xcode's export step asks
App Store Connect whether that number is already taken and increments past it if
so. The export prints what each artifact actually got — trust that over what you
passed in.

Build numbers are shared across iOS and macOS, not tracked per platform. Both
apps ship under one bundle identifier, so a macOS package numbered below an
already-uploaded iOS build is rejected as a 409 even though no macOS build ever
used that number. Xcode's own auto-increment doesn't account for this and will
happily export a macOS build that App Store Connect then refuses, so pass a
build number above the highest one uploaded for *either* platform.

The script also writes two Info.plist keys the converter omits.
`LSApplicationCategoryType` (`public.app-category.education`, override with
`MACOS_CATEGORY`) is mandatory for the Mac App Store — without it nothing fails
locally and Transporter rejects the upload with a 409.
`ITSAppUsesNonExemptEncryption` is set to false so App Store Connect stops
asking the export compliance question on every submission; Kikoe only speaks
HTTPS to the WaniKani API through OS frameworks, which is exempt.

The script exists because the converter regenerates the Xcode project from
scratch every run — `Kikoe/` is gitignored and never committed — so it always
returns with `MARKETING_VERSION` 1.0, `CURRENT_PROJECT_VERSION` 1, and no
development team. Reapplying those by hand is easy to forget and produces an
upload that App Store Connect rejects as a duplicate build.

Two certificates are required in the login keychain, both created from Xcode >
Settings > Accounts > Manage Certificates: **Apple Distribution** (signs both
apps) and **Mac Installer Distribution** (produces the macOS `.pkg`).

To retry just the signing and packaging after fixing a certificate, skip
straight to the export — the archives are already built:

```bash
npm run safari:app:export
```

The customized iOS app page includes setup steps telling users to navigate to
**Apps > Safari > Extensions > Kikoe** themselves. There's no button for this —
iOS only exposes a public URL for opening the app's *own* Settings page, not
Safari's, so a button would just drop users on Kikoe's (empty) settings entry
instead of anywhere useful. The macOS page keeps its **Quit and Open Safari
Extensions Preferences...** button, which correctly opens Safari's Extensions
pane via `SFSafariApplication.showPreferencesForExtension`.

## What This Reuses

- The shared page bundle from `src/app.ts`.
- The content-script bridge from `extension/content.ts`.
- The existing options UI, background handler, dictionary data, and dedicated
  high-resolution Safari app icons.
- The same `webkitSpeechRecognition` path used by Chrome.

## Real-Device Checks

The first iOS/iPadOS validation pass should verify:

1. The extension can be enabled for `www.wanikani.com`, `bunpro.jp`, and
   `www.bunpro.jp`.
2. `content.js` injects `injected.js` and `bundle.js` into review pages.
3. `chrome.storage.sync`, `chrome.storage.local`, `chrome.runtime.getURL`, and
   `chrome.runtime.openOptionsPage` work in Safari's extension runtime.
4. The options page or containing app clearly tells users that Safari extension
   access, website access, and microphone access are three separate setup
   steps.
5. Microphone permission can be granted from the injected Kikoe UI after opening
   a review page.
6. `webkitSpeechRecognition` emits interim/final results on iPhone or iPad.
7. WaniKani API-token storage and subject prefetching work after reload.

## Website Access Is a Separate, Easy-to-Miss Step

Turning Kikoe on in Safari's Extensions preferences is not enough to run it.
Unlike Chrome and Firefox — which auto-grant a required `host_permissions`
entry at install — Safari treats every extension's site access as a
per-extension "Ask" gate by default, even for permissions declared as
required (non-optional) in the manifest. Until that gate is opened,
`content_scripts` never run on a matching page at all, so `content.js` never
executes and nothing in the extension gets a chance to explain what's wrong.

The only native ways to open the gate are the toolbar icon's dropdown menu
(click the puzzle-piece/extensions icon if Kikoe's own icon isn't pinned, then
choose "Always Allow on Every Website") or the website-access dropdown next to
Kikoe in Safari Settings/Preferences > Extensions. Neither is something a new
user stumbles onto — the extension just looks broken until they do.

Because the content script can't run before access is granted, it can't show
an in-page prompt either — this has to be solved from a context that runs
regardless of per-site permission. The fix here uses two of those:

- The shared options page (`extension/options.js` /
  `extension/options.html`) checks `chrome.permissions.contains({ origins })`
  for the same origins as `host_permissions` and, when they aren't granted,
  shows a "Site Access" card with a button that calls
  `chrome.permissions.request({ origins })`. Chrome and Firefox already have
  these origins granted at install, so `contains` is `true` and the card never
  appears there — this only matters, and only shows up, on Safari. Options
  opens whenever the toolbar icon is clicked (see `background.js`), which is
  exactly the moment a confused user goes looking for help.
- The customized containing-app page (`scripts/customize-safari-app.js`)
  spells out the website-access step explicitly for macOS, alongside the
  existing "turn the extension on" instructions.

## Known Open Questions

- Whether Safari iOS allows `webkitSpeechRecognition` reliably from an injected
  extension UI rather than first-party page JavaScript.
- Whether the MV3 service worker is sufficient for the options-opening bridge on
  the minimum Safari version we want to support.
- Whether App Store review requires extra disclosure around microphone access,
  speech recognition, WaniKani API token storage, or wrapped site interaction.
