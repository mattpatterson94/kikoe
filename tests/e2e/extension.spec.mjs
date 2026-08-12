// End-to-end specs against the built extension in a real browser.
//
// These cover the integration surfaces the jsdom suites can't see: the real
// bundle, the real content script, chrome.storage, script injection, and the
// page/content-script event bridge. Speech comes from the fake-speech shim;
// pages come from frozen fixtures; the WaniKani API is routed.
//
// Run with `npm run test:e2e` (needs `npm run build` first).
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import {
  launch, writeSettings, serveFixture, waitForExtension, indicatorText,
  fixture, vocabSubject, TOKEN,
} from './harness.mjs';

let browser;

beforeAll(async () => { browser = await launch(); }, 120_000);
afterAll(async () => { await browser?.close(); });

const WK_REVIEW = 'https://www.wanikani.com/subjects/review';
const BP_REVIEW = 'https://bunpro.jp/study';

async function openWaniKani({ html = fixture('wanikani-review.html'), subjects = [vocabSubject()], settings = {} } = {}) {
  await writeSettings(browser, { apiToken: TOKEN, transcript: true, turbo: false, ...settings });
  const page = await serveFixture(browser.context, { url: WK_REVIEW, html, subjects });
  await waitForExtension(page);
  return page;
}

describe('WaniKani review page', () => {
  test('the bundle loads and reports it is listening', async () => {
    const page = await openWaniKani();
    // Kikoe consumes and removes its own config stamp; waitForExtension
    // asserts that, so reaching here means the bundle ran without crashing.
    await expect.poll(() => indicatorText(page), { timeout: 15_000 }).toMatch(/listening/i);
    await page.close();
  });

  // The whole pipeline in one assertion: shim → recognizer → candidate
  // matching against API-supplied answers → DOM submission.
  test('a spoken meaning is matched and submitted into the answer field', async () => {
    const page = await openWaniKani({ subjects: [vocabSubject({ meanings: ['below'] })] });

    await expect.poll(() => indicatorText(page), { timeout: 15_000 }).toMatch(/listening/i);
    await page.evaluate(() => window.__kikoeSpeech.say('below'));

    await expect
      .poll(() => page.inputValue('#user-response'), { timeout: 10_000 })
      .toBe('below');
    await page.close();
  });

  test('an unrelated utterance is not submitted', async () => {
    const page = await openWaniKani({ subjects: [vocabSubject({ meanings: ['below'] })] });

    await expect.poll(() => indicatorText(page), { timeout: 15_000 }).toMatch(/listening/i);
    await page.evaluate(() => window.__kikoeSpeech.say('elephant'));
    await page.waitForTimeout(1500);

    expect(await page.inputValue('#user-response')).toBe('');
    await page.close();
  });

  test('the pause command mutes the microphone', async () => {
    const page = await openWaniKani();

    await expect.poll(() => indicatorText(page), { timeout: 15_000 }).toMatch(/listening/i);
    await page.evaluate(() => window.__kikoeSpeech.say('pause'));

    await expect.poll(() => indicatorText(page), { timeout: 10_000 }).toMatch(/muted/i);
    await page.close();
  });

  // The regression the health check exists for: markup Kikoe depends on
  // disappears, and without this the indicator keeps claiming to listen.
  test('a card missing its answer field is reported as unreadable', async () => {
    const html = fixture('wanikani-review.html').replace(/<input id="user-response"[^>]*>/, '');
    const page = await openWaniKani({ html });

    await expect.poll(() => indicatorText(page), { timeout: 20_000 }).toMatch(/can't read this page/i);
    await page.close();
  });

  test('no API token surfaces as a distinct state, not as listening', async () => {
    await writeSettings(browser, { apiToken: '', transcript: true });
    const page = await serveFixture(browser.context, {
      url: WK_REVIEW, html: fixture('wanikani-review.html'), subjects: [],
    });
    await waitForExtension(page);

    await expect.poll(() => indicatorText(page), { timeout: 15_000 }).toMatch(/no api token/i);
    await page.close();
  });
});

describe('WaniKani page detection', () => {
  // PathPatterns is anchored specifically so lookalikes don't false-positive;
  // nothing else asserts that against real URL shapes.
  test.each([
    'https://www.wanikani.com/dashboard',
    'https://www.wanikani.com/subjects/review-summary',
  ])('does not start on %s', async (url) => {
    await writeSettings(browser, { apiToken: TOKEN, transcript: true });
    const page = await serveFixture(browser.context, {
      url, html: fixture('wanikani-review.html'), subjects: [vocabSubject()],
    });
    await page.waitForTimeout(2000);

    expect(await page.evaluate(() => !!document.getElementById('kikoe-idle-label'))).toBe(false);
    await page.close();
  });
});

describe('BunPro review page', () => {
  // BunPro needs no token: accepted answers are in the DOM, which is a
  // materially different path through the app worth covering separately.
  test('a spoken cloze answer is matched from page metadata and submitted', async () => {
    await writeSettings(browser, { apiToken: '', transcript: true, turbo: false });
    const page = await serveFixture(browser.context, {
      url: BP_REVIEW, html: fixture('bunpro-review.html'), subjects: [],
    });
    await waitForExtension(page);

    await expect.poll(() => indicatorText(page), { timeout: 15_000 }).toMatch(/listening/i);
    await page.evaluate(() => window.__kikoeSpeech.say('おとこ'));

    await expect
      .poll(() => page.inputValue('#js-manual-input'), { timeout: 10_000 })
      .toBe('おとこ');
    await page.close();
  });
});
