// Read-only check that the adapters can still read the *live* WaniKani and
// BunPro review pages.
//
// This is the only thing that can catch a site redesign: the end-to-end specs
// run against frozen fixtures, which keep passing long after the real markup
// has moved on.
//
//   node tests/e2e/canary.mjs
//
// Requires KIKOE_STORAGE_STATE — a path to a Playwright storage state file
// from a logged-in session on both sites. Create one with:
//
//   npx playwright open --save-storage=canary-state.json https://www.wanikani.com
//
// (log in, visit BunPro too, then close the window). Cookies expire, so this
// needs periodic refreshing; the workflow reports that as a distinct failure
// rather than as a redesign.
//
// STRICTLY READ-ONLY. It asserts that the elements the adapters read are
// present, and stops. It submits nothing and advances nothing, so it cannot
// move SRS state.
import { chromium } from 'playwright';
import fs from 'node:fs';

const STORAGE_STATE = process.env.KIKOE_STORAGE_STATE;
const WANIKANI_REVIEW = 'https://www.wanikani.com/subjects/review';
const BUNPRO_REVIEW = 'https://bunpro.jp/study';

// Mirrors the Selectors tables in src/wanikani.ts and src/bunpro.ts. Kept as
// a literal list rather than importing the adapters, because the point is to
// notice when the site stops matching what those files assume — importing
// them would still work, but a plain list is what a failure needs to report.
const CHECKS = [
  {
    label: 'WaniKani review',
    url: WANIKANI_REVIEW,
    loggedOut: url => url.includes('/login'),
    required: [
      ['question prompt', 'div.character-header__characters'],
      ['question type', 'span.quiz-input__question-type'],
      ['answer input', '#user-response'],
    ],
  },
  {
    label: 'BunPro review',
    url: BUNPRO_REVIEW,
    loggedOut: url => url.includes('/users/sign_in') || url.includes('/login'),
    required: [
      ['quiz metadata element', '#quiz-metadata-element'],
    ],
  },
];

async function runCheck(context, check) {
  const page = await context.newPage();
  const problems = [];
  try {
    await page.goto(check.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // Review pages hydrate client-side; give the markup a chance to appear
    // before concluding it is gone.
    await page.waitForTimeout(8000);

    if (check.loggedOut(page.url())) {
      return { label: check.label, status: 'auth', problems: [`redirected to ${page.url()}`] };
    }

    for (const [name, selector] of check.required) {
      if (await page.locator(selector).count() === 0) {
        problems.push(`${name} — no element matched \`${selector}\``);
      }
    }
  } catch (err) {
    return { label: check.label, status: 'error', problems: [String(err.message || err)] };
  } finally {
    await page.close();
  }

  return { label: check.label, status: problems.length ? 'fail' : 'ok', problems };
}

if (!STORAGE_STATE || !fs.existsSync(STORAGE_STATE)) {
  console.error('KIKOE_STORAGE_STATE is unset or missing — nothing to check.');
  process.exit(78); // distinct from a real failure: not configured
}

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: STORAGE_STATE });

const results = [];
for (const check of CHECKS) results.push(await runCheck(context, check));

await context.close();
await browser.close();

for (const r of results) {
  const icon = { ok: '✓', fail: '✗', auth: '⚠', error: '⚠' }[r.status];
  console.log(`${icon} ${r.label}: ${r.status}`);
  for (const p of r.problems) console.log(`    ${p}`);
}

// Expired cookies are a maintenance chore, not a redesign, and must not be
// reported as one — the workflow keys off this exit code.
if (results.some(r => r.status === 'auth')) process.exit(2);
if (results.some(r => r.status !== 'ok')) process.exit(1);
console.log('\nAll adapter selectors still present on the live sites.');
