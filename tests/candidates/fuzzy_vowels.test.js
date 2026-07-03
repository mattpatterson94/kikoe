import { FuzzyVowels } from '../../src/candidates/fuzzy_vowels';

const fuzzy = new FuzzyVowels();
const get = (raw) => fuzzy.getCandidates(raw).map(c => c.data).sort();

describe('FuzzyVowels', () => {
  test('generates long-vowel candidates for short syllable', () => {
    expect(get('しょ')).toStrictEqual(['しいょ', 'しょう', 'しょお'].sort());
  });

  test('generates long-vowel candidates with voiced consonant', () => {
    expect(get('で')).toStrictEqual(['でい', 'でえ'].sort());
  });

  test('generates short-vowel candidate for long syllable', () => {
    expect(get('しょう')).toStrictEqual(['しいょう', 'しょ'].sort());
  });

  test('handles kanji mixed with kana', () => {
    expect(get('しょ軍')).toStrictEqual(['しいょ軍', 'しょう軍', 'しょお軍'].sort());
  });
});
