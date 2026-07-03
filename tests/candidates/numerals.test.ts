import { Numerals } from '../../src/candidates/numerals';
import type { Dictionary } from '../../src/dict';

const numerals = new Numerals();
const get = (raw: string) => numerals.getCandidates(raw).map(c => c.data).sort();

describe('Numerals', () => {
  test('converts Arabic numeral suffix to kanji', () => {
    expect(get('30代')).toStrictEqual(['三十代']);
  });

  test('converts multi-digit date suffix', () => {
    expect(get('20日')).toStrictEqual(['二十日']);
  });

  test('converts bare number in English phrase to words', () => {
    expect(get('10 days')).toStrictEqual(['Ten days']);
  });

  test('no numeral returns no candidates', () => {
    expect(get('abc')).toStrictEqual([]);
    expect(get('あいう')).toStrictEqual([]);
  });

  // Bug reproduction: comma-grouped numbers were cut off at the first comma
  // ("10,000" → "10" → "Ten,000") instead of converting the whole number.
  // Bare numeral input is ambiguous (could be an English or Japanese
  // reading), so both word forms are offered as candidates.
  test('REGRESSION: converts comma-grouped number to words', () => {
    expect(get('10,000')).toStrictEqual(['Ten Thousand', '一万']);
  });

  test('REGRESSION: converts comma-grouped number to kansuji in a Japanese phrase', () => {
    expect(get('10,000です')).toStrictEqual(['一万です']);
  });
});

// ── dictionary-aware day-of-month readings ───────────────────────────────────

describe('Numerals with a dictionary', () => {
  // Day-of-month counters have irregular readings (六日 → むいか, not
  // ろくにち) that only exist as whole-word JMdict entries keyed by the
  // kanji spelling — which only exists after kansuji conversion.
  const dictionary: Dictionary = {
    '六日': [{ type: 'word', kana: ['むいか'] }],
    '二十日': [{ type: 'word', kana: ['はつか', 'にじゅうにち'] }],
  };
  const get = (raw: string) => new Numerals(dictionary).getCandidates(raw).map(c => c.data);

  // Bug reproduction: speech recognition returns the digit form (6日), but
  // only Numerals' own kansuji output (六日) is ever looked up.
  test('REGRESSION: surfaces the irregular reading for a digit-form day counter', () => {
    expect(get('6日')).toEqual(expect.arrayContaining(['六日', 'むいか']));
  });

  test('REGRESSION: surfaces all readings for a multi-digit day counter', () => {
    expect(get('20日')).toEqual(expect.arrayContaining(['二十日', 'はつか', 'にじゅうにち']));
  });

  test('does not add dictionary candidates when the kanji form is unknown', () => {
    expect(get('7日')).toStrictEqual(['七日']);
  });
});
