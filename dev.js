#!/usr/bin/env node
// Development watcher: rebuilds on source changes and live-reloads the
// extension via web-ext.
//
// Usage:
//   npm run dev           → Chrome  (chrome/ directory)
//   npm run dev:firefox   → Firefox (firefox/ directory)

import * as esbuild from 'esbuild';
import { spawn } from 'child_process';
import { copyFileSync, watch } from 'fs';

const isFirefox = process.argv.includes('--firefox');
const target = isFirefox ? 'firefox' : 'chrome';

console.log(`[dev] target: ${target}/`);

// Non-bundled files that are copied verbatim into the extension directory.
const staticFiles = [
  ['extension/background.js', `${target}/background.js`],
  ['extension/injected.js',  `${target}/injected.js`],
  ['extension/options.html', `${target}/options.html`],
  ['extension/options.js',   `${target}/options.js`],
];

function copyStatic() {
  for (const [src, dst] of staticFiles) {
    try { copyFileSync(src, dst); } catch { /* ignore */ }
  }
}

copyStatic();

// Re-copy any static file that changes.
watch('extension', (_, filename) => {
  if (!filename) return;
  const entry = staticFiles.find(([src]) => src.endsWith(filename));
  if (entry) {
    copyFileSync(entry[0], entry[1]);
    console.log(`[dev] copied ${filename}`);
  }
});

// esbuild plugin that logs each rebuild.
const logger = (label) => ({
  name: 'log',
  setup(build) {
    build.onEnd(({ errors }) => {
      if (errors.length) console.error(`[dev] ${label}: build error`);
      else console.log(`[dev] ${label}: rebuilt`);
    });
  },
});

// Build both bundles in watch mode.
const [appCtx, contentCtx] = await Promise.all([
  esbuild.context({
    entryPoints: ['src/app.ts'],
    bundle: true, format: 'iife', platform: 'browser',
    outfile: `${target}/bundle.js`,
    plugins: [logger('app')],
  }),
  esbuild.context({
    entryPoints: ['extension/content.ts'],
    bundle: true, format: 'iife', platform: 'browser',
    outfile: `${target}/content.js`,
    plugins: [logger('content')],
  }),
]);

await appCtx.watch();
await contentCtx.watch();
console.log('[dev] watching for changes...\n');

// Spawn web-ext — it watches the output directory and reloads on any change.
const webExtArgs = [
  'web-ext', 'run',
  `--source-dir=./${target}`,
  ...(isFirefox ? [] : ['--target=chromium']),
];

const proc = spawn('npx', webExtArgs, { stdio: 'inherit', shell: true });

proc.on('exit', (code) => {
  appCtx.dispose();
  contentCtx.dispose();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  proc.kill('SIGINT');
  appCtx.dispose();
  contentCtx.dispose();
  process.exit(0);
});
