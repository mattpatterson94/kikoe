import {
  SHARED_COMMANDS,
  REVEAL_COMMANDS,
  GRADE_COMMANDS,
  HELP_COMMANDS,
  buildCommandTable,
  commandsForMode,
} from '../src/commands';
import type { CommandSpec, HelpMode } from '../src/commands';

const ALL_SPECS: CommandSpec[] = [
  ...SHARED_COMMANDS, ...REVEAL_COMMANDS, ...GRADE_COMMANDS, ...HELP_COMMANDS,
];

describe('command registry integrity', () => {
  test('every spec has an id, a description, and at least one phrase', () => {
    for (const spec of ALL_SPECS) {
      expect(spec.id).toBeTruthy();
      expect(spec.description).toBeTruthy();
      expect(spec.en.length + spec.ja.length).toBeGreaterThan(0);
    }
  });

  test('English phrases are lowercase (matching normalizes raws to lowercase)', () => {
    for (const spec of ALL_SPECS) {
      for (const phrase of spec.en) expect(phrase).toBe(phrase.toLowerCase());
    }
  });

  // A phrase mapping to two different commands within one mode would be
  // ambiguous at match time — whichever table is consulted first wins
  // silently. Check each mode's combined set, since tables from different
  // modes (e.g. reveal vs grade) are never active together.
  test.each<HelpMode>(['standard', 'reveal-hidden', 'reveal-shown'])(
    'no duplicate phrases across the commands active in %s mode',
    (mode) => {
      const seen = new Map<string, string>();
      for (const spec of commandsForMode(mode)) {
        for (const phrase of [...spec.en, ...spec.ja]) {
          expect(seen.get(phrase) ?? spec.id).toBe(spec.id);
          seen.set(phrase, spec.id);
        }
      }
    },
  );

  // 助け's accepted meaning is literally "help" — the phrase must live in
  // HELP_COMMANDS (answer-first routing), never in the priority tables.
  test('"help" is not a shared/reveal/grade phrase', () => {
    for (const spec of [...SHARED_COMMANDS, ...REVEAL_COMMANDS, ...GRADE_COMMANDS]) {
      expect(spec.en).not.toContain('help');
    }
    expect(HELP_COMMANDS.some((s) => s.en.includes('help'))).toBe(true);
  });
});

describe('buildCommandTable', () => {
  test('maps every English and Japanese phrase to the bound action', () => {
    const next = vi.fn();
    const wrong = vi.fn();
    const pause = vi.fn();
    const table = buildCommandTable(SHARED_COMMANDS, { next, wrong, pause });

    for (const spec of SHARED_COMMANDS) {
      for (const phrase of [...spec.en, ...spec.ja]) {
        expect(table[phrase]).toBeDefined();
      }
    }
    table['次']();
    expect(next).toHaveBeenCalledTimes(1);
    table['stop listening']();
    expect(pause).toHaveBeenCalledTimes(1);
  });

  test('throws when a spec has no bound action, so a registry/action mismatch fails loudly', () => {
    expect(() => buildCommandTable(SHARED_COMMANDS, { next: vi.fn() }))
      .toThrow(/no action bound/);
  });
});

describe('commandsForMode', () => {
  test('standard mode lists shared commands and help, no reveal/grade', () => {
    const ids = commandsForMode('standard').map((s) => s.id);
    expect(ids).toContain('next');
    expect(ids).toContain('help');
    expect(ids).not.toContain('reveal');
    expect(ids).not.toContain('grade-good');
  });

  test('reveal-hidden mode leads with the reveal command', () => {
    const ids = commandsForMode('reveal-hidden').map((s) => s.id);
    expect(ids[0]).toBe('reveal');
    expect(ids).toContain('next');
    expect(ids).not.toContain('grade-good');
  });

  test('reveal-shown mode leads with the grade commands', () => {
    const ids = commandsForMode('reveal-shown').map((s) => s.id);
    expect(ids[0]).toBe('grade-good');
    expect(ids).toContain('grade-bad');
    expect(ids).not.toContain('reveal');
  });
});
