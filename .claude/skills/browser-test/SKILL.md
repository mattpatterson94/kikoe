---
name: browser-test
description: Drive Kikoe in a real browser without a microphone — launch the Playwright harness, fake speech via the shim, and run the tiered release checklist. Use when asked to browser-test the extension, verify a release, test voice flows, or reproduce a bug on live WaniKani/BunPro pages.
---

# Browser-test Kikoe

Read [TESTING.md](../../../TESTING.md) first — it is the playbook this skill
executes and holds the account constraints, gotchas, and tiered checklist.

## Steps

1. `npm run build`, then `npm run e2e:launch` (background). The persistent
   profile in `.playwright-profile/` keeps WaniKani/BunPro logins across
   restarts; if logins are missing, open the login pages and ask the user to
   type credentials — never ask for passwords in chat.
2. Verify the harness: on a wanikani.com page, `window.__kikoeSpeech` exists
   and `data-kikoe-config` is absent (consumed = bundle alive). Enable the
   `debug` setting for `[kikoe] checkAnswer` console logs.
3. Drive with one-off node scripts through
   [tests/e2e/cdp.js](../../../tests/e2e/cdp.js):
   `__kikoeSpeech.say(...)` / `.error(...)` / `.state()` in page context.
4. Work through the tiered checklist in TESTING.md. Get accepted answers
   from `chrome.storage.local` (`kikoe_subj_*`) on WaniKani and
   `[data-meta-loc]` data attributes on BunPro. Detect card advance by card
   identity, not input value.
5. Respect SRS safety: WaniKani only on the test account; BunPro bulk
   testing in Cram (SRS-free), real reviews in small correct-only samples.
6. After any source fix: rebuild, restart the launcher, re-run the checks
   the fix invalidates.

Triage findings per the release policy: blockers → fix, rebuild, re-verify;
minors → file GitHub issues; cosmetic → note in the report.
