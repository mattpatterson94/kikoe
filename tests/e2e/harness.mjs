// Boots the *built* extension in a real Chromium against frozen page
// fixtures, with no account, no network and no microphone.
//
// This is the layer the jsdom suites can't reach: the actual bundle, the
// actual content script, real chrome.storage, real script injection, and the
// real page/content-script event bridge.
//
// Used by tests/e2e/*.spec.mjs (run with `npm run test:e2e`), never by
// `npm test`.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extDir = path.join(root, 'chrome');
const fixtureDir = path.join(root, 'tests', 'fixtures');

export const TOKEN = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

export function requireBuild() {
  if (!fs.existsSync(path.join(extDir, 'manifest.json'))) {
    throw new Error('chrome/ build missing — run `npm run build` first');
  }
}

export function fixture(name) {
  return fs.readFileSync(path.join(fixtureDir, name), 'utf8');
}

// A WaniKani API subject collection, shaped like the fields the adapter
// reads. Routed in place of api.wanikani.com so specs can put any accepted
// answer on a card — the thing a real account can't be made to do on demand.
export function subjectCollection(subjects) {
  return { object: 'collection', data: subjects, pages: { next_url: null } };
}

export function vocabSubject({ id = 8761, characters = '下', meanings = ['below'], readings = ['した'] } = {}) {
  return {
    id,
    object: 'vocabulary',
    data: {
      slug: characters,
      characters,
      meanings: meanings.map(meaning => ({ meaning, accepted_answer: true })),
      auxiliary_meanings: [],
      readings: readings.map(reading => ({ reading, accepted_answer: true })),
    },
  };
}

// Chromium only loads extensions in a headed browser, so CI runs this under
// xvfb (see the e2e job in .github/workflows/ci.yml).
export async function launch() {
  requireBuild();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kikoe-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    executablePath: process.env.KIKOE_CHROMIUM || undefined,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--no-sandbox',
    ],
  });

  // The same shim the manual harness uses, so the extension constructs a
  // controllable recognizer instead of the real one.
  await context.addInitScript({ path: path.join(root, 'tests', 'e2e', 'fake-speech.js') });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  const extensionId = new URL(sw.url()).host;

  return {
    context,
    extensionId,
    async close() {
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
}

// chrome.storage.sync is only reachable from an extension page, so settings
// are written through the options page rather than faked.
export async function writeSettings({ context, extensionId }, settings) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate(s => chrome.storage.sync.set(s), settings);
  await page.close();
}

// Serves a fixture at a real site URL and answers the WaniKani API with
// whatever subjects the spec wants. Everything else on those hosts is
// aborted, so a stray request can't reach the network.
export async function serveFixture(context, { url, html, subjects = [] }) {
  const origin = new URL(url).origin;

  await context.route(`${origin}/**`, route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));

  await context.route('https://api.wanikani.com/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(subjectCollection(subjects)),
    }));

  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}

// The bundle removes data-kikoe-config as it reads it, so its absence means
// the bundle ran. Its presence means the bundle crashed after the content
// script stamped it.
export async function waitForExtension(page) {
  await page.waitForFunction(
    () => !document.documentElement.dataset.kikoeConfig && !!document.getElementById('kikoe-idle-label'),
    undefined,
    { timeout: 15_000 },
  );
}

export const indicatorText = page =>
  page.evaluate(() => document.getElementById('kikoe-idle-label')?.textContent ?? null);
