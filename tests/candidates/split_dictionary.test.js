import { SplitDictionary } from '../../src/candidates/split_dictionary.js';

const dictionary = {
  '僕': [{ id: '1', type: 'word', kanji: ['僕'], kana: ['ぼく'] }],
  '私': [{ id: '2', type: 'word', kanji: ['私'], kana: ['わたし'] }],
  '客': [
    { literal: '客', type: 'character', readings: [
      { type: 'on', value: 'キャク' }, { type: 'on', value: 'カク' },
    ] },
  ],
  '気': [
    { literal: '気', type: 'character', readings: [{ type: 'on', value: 'キ' }] },
  ],
  '付': [
    { literal: '付', type: 'character', readings: [
      { type: 'on', value: 'フ' }, { type: 'kun', value: 'つ.ける' },
    ] },
  ],
  '耳': [
    { literal: '耳', type: 'character', readings: [
      { type: 'on', value: 'ジ' }, { type: 'kun', value: 'みみ' },
    ] },
  ],
  '打': [
    { literal: '打', type: 'character', readings: [
      { type: 'on', value: 'ダ' }, { type: 'kun', value: 'う.つ' },
    ] },
  ],
};

const sd = new SplitDictionary(dictionary);
const get = (raw) => sd.getCandidates(raw).map(c => c.data);

// SplitDictionary splits into alternating kana/kanji runs, keeps kana runs
// literal, and replaces each kanji run with its dictionary readings.
describe('SplitDictionary', () => {
  test('kanji followed by kana: replaces kanji with its reading', () => {
    expect(get('僕や')).toStrictEqual(['ぼくや']);
  });

  test('kana prefix before kanji: replaces kanji suffix with its reading', () => {
    expect(get('は私')).toStrictEqual(['はわたし']);
  });

  test('pure kana input returns no candidates', () => {
    expect(get('ぼくや')).toStrictEqual([]);
  });

  test('unknown kanji returns no candidates', () => {
    expect(get('龍や')).toStrictEqual([]);
  });

  test('pure kanji input returns no candidates (Basic/CompoundDictionary handle it)', () => {
    expect(get('僕私')).toStrictEqual([]);
  });

  // Regression: only a single leading or trailing kana block used to be
  // handled; kana-kanji-kana and longer alternating chains were not.
  describe('multi-segment strings', () => {
    test('kana-kanji-kana (お客さん → おきゃくさん)', () => {
      expect(get('お客さん')).toContain('おきゃくさん');
    });

    test('alternating kanji-kana chains (気を付けて → きをつけて)', () => {
      expect(get('気を付けて')).toContain('きをつけて');
    });

    test('kanji run missing from JMdict falls back to per-character readings (耳打ち → みみうち)', () => {
      expect(get('耳打ち')).toContain('みみうち');
    });

    test('caps the number of generated combinations', () => {
      expect(get('客客客客や').length).toBeLessThanOrEqual(50);
    });
  });
});
