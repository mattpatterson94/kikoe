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
  '南': [
    { literal: '南', type: 'character', readings: [
      { type: 'on', value: 'ナン' }, { type: 'kun', value: 'みなみ' },
    ] },
  ],
  '国': [
    { literal: '国', type: 'character', readings: [
      { type: 'on', value: 'コク' }, { type: 'kun', value: 'くに' },
    ] },
  ],
  '穴': [
    { literal: '穴', type: 'character', readings: [
      { type: 'on', value: 'ケツ' }, { type: 'kun', value: 'あな' },
    ] },
  ],
  '子': [
    { literal: '子', type: 'character', readings: [
      { type: 'on', value: 'シ' }, { type: 'kun', value: 'こ' },
    ] },
  ],
  '一': [
    { literal: '一', type: 'character', readings: [
      { type: 'on', value: 'イチ' }, { type: 'kun', value: 'ひと' },
    ] },
  ],
  '斤': [
    { literal: '斤', type: 'character', readings: [{ type: 'on', value: 'キン' }] },
  ],
  '本': [
    { literal: '本', type: 'character', readings: [
      { type: 'on', value: 'ホン' }, { type: 'kun', value: 'もと' },
    ] },
  ],
  '気': [
    { literal: '気', type: 'character', readings: [
      { type: 'on', value: 'キ' }, { type: 'on', value: 'ケ' },
    ] },
  ],
  '人': [
    { literal: '人', type: 'character', readings: [
      { type: 'on', value: 'ジン' }, { type: 'on', value: 'ニン' },
      { type: 'kun', value: 'ひと' },
    ] },
  ],
  '時': [
    { literal: '時', type: 'character', readings: [
      { type: 'on', value: 'ジ' }, { type: 'kun', value: 'とき' },
    ] },
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

  // Sound-euphony variants: JMdict omits these compounds and the accepted
  // reading differs from the plain concatenation of per-character readings.
  describe('sound changes', () => {
    test('rendaku: voices the first mora of a non-initial component (南国 → なんごく)', () => {
      expect(get('南国')).toContain('なんごく');
    });

    test('rendaku: applies to single-kana components (穴子 → あなご)', () => {
      expect(get('穴子')).toContain('あなご');
    });

    test('sokuon: geminates the final mora of a non-final component (一斤 → いっきん)', () => {
      expect(get('一斤')).toContain('いっきん');
    });

    test('handaku + sokuon + rendaku combine (一本気 → いっぽんぎ)', () => {
      expect(get('一本気')).toContain('いっぽんぎ');
    });

    test('does not voice the first component', () => {
      for (const c of get('国国')) {
        expect(c.startsWith('ご') || c.startsWith('ぐ')).toBe(false);
      }
    });

    test('does not geminate the final component', () => {
      for (const c of get('国国')) {
        expect(c.endsWith('っ')).toBe(false);
      }
    });
  });

  // 々 is neither kana nor kanji to wanakana, so it must be expanded to the
  // preceding kanji before per-character lookup.
  describe('iteration mark (々)', () => {
    test('expands 々 and applies rendaku (人々 → ひとびと)', () => {
      expect(get('人々')).toContain('ひとびと');
    });

    test('expands 々 and applies rendaku (時々 → ときどき)', () => {
      expect(get('時々')).toContain('ときどき');
    });
  });
});
