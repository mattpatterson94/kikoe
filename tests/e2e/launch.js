// Launches a headed Chromium with the built chrome/ extension loaded, a
// persistent profile (logins survive restarts), and the fake-speech shim
// injected into every page. Keeps running until Ctrl-C.
//
//   node tests/e2e/launch.js
//
// Drive it from another process over CDP:
//   const browser = await chromium.connectOverCDP('http://localhost:9223');
//   const context = browser.contexts()[0];   // pages share the shim + profile
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extDir = path.join(root, 'chrome');
const profileDir = path.join(root, '.playwright-profile');
const CDP_PORT = 9223;

if (!fs.existsSync(path.join(extDir, 'manifest.json'))) {
  console.error('chrome/ build missing — run `npm run build` first');
  process.exit(1);
}

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: null,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
  ],
});

await context.addInitScript({ path: path.join(root, 'tests', 'e2e', 'fake-speech.js') });

console.log(`extension: ${extDir}`);
console.log(`profile:   ${profileDir}`);
// 127.0.0.1, not localhost: Chromium binds the CDP port on IPv4 only, and
// localhost can resolve to ::1 first (or hit an unrelated IPv6 listener).
console.log(`CDP:       http://127.0.0.1:${CDP_PORT}`);
console.log('Browser is up. Ctrl-C to close.');

context.on('close', () => {
  console.log('Browser closed.');
  process.exit(0);
});
