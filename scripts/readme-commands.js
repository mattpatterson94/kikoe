#!/usr/bin/env node
// Verifies (default) or rewrites (--write) the generated voice-command
// tables in README.md from the registry in src/commands.ts. Check mode
// exits non-zero when the README is stale so it can gate CI; the vitest
// suite (tests/readme_tables.test.ts) runs the same comparison.
//
// Runs the TypeScript rendering module directly via Node's built-in type
// stripping (Node ≥ 22.18).

import { readFileSync, writeFileSync } from 'node:fs';
import { regenerateReadmeTables, REGEN_COMMAND } from './readme_tables.ts';

const readmePath = new URL('../README.md', import.meta.url);
const write = process.argv.includes('--write');

const readme = readFileSync(readmePath, 'utf8');
const { content, changed } = regenerateReadmeTables(readme);

if (changed.length === 0) {
  console.log('README.md voice-command tables are up to date.');
} else if (write) {
  writeFileSync(readmePath, content);
  console.log(`README.md regenerated: ${changed.join(', ')}`);
} else {
  console.error(
    `README.md voice-command tables are stale: ${changed.join(', ')}\n` +
      `src/commands.ts and the README have drifted — run \`${REGEN_COMMAND}\` and commit the result.`,
  );
  process.exit(1);
}
