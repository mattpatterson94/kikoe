import { Numerals } from '../../src/candidates/numerals.js';

const numerals = new Numerals();
const get = (raw) => numerals.getCandidates(raw).map(c => c.data).sort();

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
