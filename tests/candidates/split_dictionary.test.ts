import { SplitDictionary } from '../../src/candidates/split_dictionary';
import type { Dictionary } from '../../src/dict';

const dictionary: Dictionary = {
  '僕': [{ type: 'word', kana: ['ぼく'] }],
  '私': [{ type: 'word', kana: ['わたし'] }],
  '客': [
    { type: 'character', readings: [
      { value: 'キャク' }, { value: 'カク' },
    ] },
  ],
  '気': [
    { type: 'character', readings: [{ value: 'キ' }] },
  ],
  '付': [
    { type: 'character', readings: [
      { value: 'フ' }, { value: 'つ.ける' },
    ] },
  ],
  '耳': [
    { type: 'character', readings: [
      { value: 'ジ' }, { value: 'みみ' },
    ] },
  ],
  '打': [
    { type: 'character', readings: [
      { value: 'ダ' }, { value: 'う.つ' },
    ] },
  ],
  '弱': [
    { type: 'character', readings: [
      { value: 'ジャク' }, { value: 'よわ.い' },
    ] },
  ],
};

const sd = new SplitDictionary(dictionary);
const get = (raw: string) => sd.getCandidates(raw).map(c => c.data);

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

    test('iteration mark in a kanji run (弱々しい → よわよわしい)', () => {
      expect(get('弱々しい')).toContain('よわよわしい');
    });

    test('caps the number of generated combinations', () => {
      expect(get('客客客客や').length).toBeLessThanOrEqual(50);
    });
  });
});
