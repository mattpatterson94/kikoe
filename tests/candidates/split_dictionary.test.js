import { SplitDictionary } from '../../src/candidates/split_dictionary.js';

const dictionary = {
  '僕': [{ id: '1', type: 'word', kanji: ['僕'], kana: ['ぼく'] }],
  '私': [{ id: '2', type: 'word', kanji: ['私'], kana: ['わたし'] }],
};

const sd = new SplitDictionary(dictionary);
const get = (raw) => sd.getCandidates(raw).map(c => c.data);

// SplitDictionary splits on the kanji/kana boundary and looks up each part.
// It handles: [kanji prefix + kana suffix] and [kana prefix + kanji suffix].
describe('SplitDictionary', () => {
  test('kanji followed by kana: replaces kanji with its reading', () => {
    expect(get('僕や')).toStrictEqual(['ぼくや']);
  });

  test('kana prefix before kanji: replaces kanji suffix with its reading', () => {
    // chars = ['は', '私'] → kanaPre='は', kanjiPost='私' → 'は' + 'わたし'
    expect(get('は私')).toStrictEqual(['はわたし']);
  });

  test('pure kana input returns no candidates', () => {
    expect(get('ぼくや')).toStrictEqual([]);
  });

  test('unknown kanji returns no candidates', () => {
    expect(get('龍や')).toStrictEqual([]);
  });

  test('two adjacent kanji: only looks up the full kanji string, not individual chars', () => {
    // '僕私' is all kanji → kanjiPre='僕私', basicDictionary.getCandidates('僕私') → []
    // because '僕私' is not in the dictionary as a compound
    expect(get('僕私')).toStrictEqual([]);
  });
});
