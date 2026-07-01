import { CompoundDictionary } from '../../src/candidates/compound_dictionary.js';

const dictionary = {
  '何': [
    { id: '1', type: 'word', kanji: ['何'], kana: ['なに', 'ナニ'] },
    { id: '2', type: 'word', kanji: ['何'], kana: ['なん'] },
    { literal: '何', type: 'character', readings: [
      { type: 'on', value: 'カ' }, { type: 'kun', value: 'なに' },
      { type: 'kun', value: 'なん' }, { type: 'kun', value: 'なに-' },
      { type: 'kun', value: 'なん-' },
    ] },
  ],
  '月': [
    { literal: '月', type: 'character', readings: [
      { type: 'on', value: 'ゲツ' }, { type: 'on', value: 'ガツ' },
      { type: 'kun', value: 'つき' },
    ] },
  ],
  '結': [
    { literal: '結', type: 'character', readings: [{ type: 'kun', value: 'むす.ぶ' }] },
  ],
  '仙台': [
    { id: '3', type: 'word', kanji: ['仙台'], kana: ['せんだい'] },
  ],
};

const cd = new CompoundDictionary(dictionary);
const get = (raw) => cd.getCandidates(raw).map(c => c.data);

describe('CompoundDictionary', () => {
  test('combines per-character readings for a compound missing from JMdict', () => {
    expect(get('何月')).toContain('なんがつ');
  });

  test('strips okurigana dots and affix hyphens from kanjidic readings', () => {
    const candidates = get('何結');
    expect(candidates).toContain('なんむす');
    for (const c of candidates) {
      expect(c).not.toMatch(/[-.ー]/);
    }
  });

  test('skips words the dictionary already knows whole', () => {
    expect(get('仙台')).toStrictEqual([]);
  });

  test('returns nothing when a character has no readings', () => {
    expect(get('何鑫')).toStrictEqual([]);
  });

  test('ignores kana, mixed, single-character and long input', () => {
    expect(get('なんがつ')).toStrictEqual([]);
    expect(get('何た')).toStrictEqual([]);
    expect(get('何')).toStrictEqual([]);
    expect(get('何何何何何')).toStrictEqual([]);
  });

  test('caps the number of generated combinations', () => {
    expect(get('何何何何').length).toBeLessThanOrEqual(50);
  });
});
