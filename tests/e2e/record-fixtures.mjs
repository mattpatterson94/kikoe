// Captures the *real* markup of whatever review pages are currently open in
// the manual harness, replacing the hand-built approximations in
// tests/fixtures/.
//
//   npm run build
//   node tests/e2e/launch.js            # log into WaniKani / BunPro, open a review
//   node tests/e2e/record-fixtures.mjs
//
// Run this whenever a site redesign is confirmed, so the end-to-end specs
// test against what the sites actually serve rather than what we assumed
// they serve. See tests/fixtures/README.md.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { withContext } from './cdp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = path.join(root, 'tests', 'fixtures');

const TARGETS = [
  { match: 'wanikani.com', file: 'wanikani-review.html', label: 'WaniKani' },
  { match: 'bunpro.jp', file: 'bunpro-review.html', label: 'BunPro' },
];

// These pages come from a logged-in session. Scripts can carry session state
// and CSRF tokens, and the fixtures are served to a browser in the specs, so
// strip anything executable and anything token-shaped. The embedded review
// queue is the one script the adapter actually reads, so it is kept.
function sanitize(html) {
  return html
    .replace(/<script(?![^>]*type=["']application\/json["'])[\s\S]*?<\/script>/gi, '<!-- script removed by record-fixtures -->')
    .replace(/<meta[^>]+csrf[^>]*>/gi, '<!-- csrf meta removed -->')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'REDACTED-UUID');
}

// Kikoe injects its own UI into the page; capturing it would bake the
// extension's output into the fixture it is meant to be tested against.
async function captureWithoutKikoe(page) {
  return page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true);
    for (const id of ['kikoe-corner', 'kikoe-transcript-container', 'kikoe-transcript-styles']) {
      clone.querySelector(`#${id}`)?.remove();
    }
    clone.removeAttribute('data-kikoe-config');
    return '<!doctype html>\n' + clone.outerHTML;
  });
}

await withContext(async (context) => {
  let captured = 0;

  for (const target of TARGETS) {
    const page = context.pages().find(p => p.url().includes(target.match));
    if (!page) {
      console.log(`— ${target.label}: no open page, skipped`);
      continue;
    }

    const html = sanitize(await captureWithoutKikoe(page));
    const out = path.join(fixtureDir, target.file);
    fs.writeFileSync(out, html);
    console.log(`✓ ${target.label}: ${page.url()}\n  → ${path.relative(root, out)} (${(html.length / 1024).toFixed(1)} KB)`);
    captured++;
  }

  if (!captured) {
    console.log('\nNothing captured. Open a review page in the launch.js window first.');
    return;
  }

  console.log('\nRead the diff before committing — these are pages from your account,');
  console.log('and the sanitizer is best-effort, not a guarantee.');
});
