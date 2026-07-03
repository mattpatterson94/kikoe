import readme from '../README.md?raw';
import { regenerateReadmeTables, REGEN_COMMAND } from '../scripts/readme_tables';

describe('README voice-command tables', () => {
  // The gate that keeps the README honest: if a command changes in
  // src/commands.ts without regenerating the docs, this fails.
  test('are in sync with src/commands.ts', () => {
    const { changed } = regenerateReadmeTables(readme);
    expect(changed, `README.md is stale (${changed.join(', ')}) — run \`${REGEN_COMMAND}\``)
      .toEqual([]);
  });

  test('regeneration is idempotent', () => {
    const { content } = regenerateReadmeTables(readme);
    expect(regenerateReadmeTables(content).changed).toEqual([]);
  });

  test('a drifted table is reported as changed', () => {
    const drifted = readme.replace('Advance to the next card', 'Do something else');
    expect(regenerateReadmeTables(drifted).changed).toEqual(['voice-commands']);
    // ...and regeneration restores the registry's wording.
    expect(regenerateReadmeTables(drifted).content).toBe(readme);
  });

  test('missing markers fail loudly instead of silently skipping a section', () => {
    const withoutMarkers = readme.replace(/<!-- BEGIN GENERATED voice-commands.*-->/, '');
    expect(() => regenerateReadmeTables(withoutMarkers)).toThrow(/voice-commands/);
  });
});
