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
});
