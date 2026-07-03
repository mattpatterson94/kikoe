// Helper for driving the browser started by launch.js from a separate
// process. Connects over CDP, hands you the persistent context, and cleans
// up the connection (not the browser) when done.
//
//   import { withContext } from './tests/e2e/cdp.js';
//   await withContext(async (context) => { ... });
import { chromium } from 'playwright';

export const CDP_URL = 'http://127.0.0.1:9223';

export async function withContext(fn) {
  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    return await fn(browser.contexts()[0]);
  } finally {
    await browser.close(); // detaches; launch.js keeps the browser alive
  }
}

// Find an open page whose URL contains `match`, or open `fallbackUrl`.
export async function getPage(context, match, fallbackUrl) {
  const page = context.pages().find(p => p.url().includes(match));
  if (page) return page;
  const fresh = await context.newPage();
  if (fallbackUrl) await fresh.goto(fallbackUrl, { waitUntil: 'domcontentloaded' });
  return fresh;
}
