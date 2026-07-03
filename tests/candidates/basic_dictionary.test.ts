import { BasicDictionary } from '../../src/candidates/basic_dictionary';
import type { Dictionary } from '../../src/dict';

const dictionary: Dictionary = {
  'せんだい': [
    { type: 'word', kana: ['せんだい'] },
    { type: 'word', kana: ['せんだい'] },
  ],
  'か': [
    { type: 'character', readings: [{ value: 'か' }, { value: 'け' }] },
  ],
  'むす': [
    { type: 'character', readings: [{ value: 'むす.ぶ' }] },
  ],
  '玉': [
    { type: 'character', readings: [{ value: 'たま' }, { value: '-だま' }] },
  ],
};

const bd = new BasicDictionary(dictionary);
const get = (raw: string) => bd.getCandidates(raw).map(c => c.data);

describe('BasicDictionary', () => {
  test('returns kana readings for a word entry', () => {
    expect(get('せんだい')).toStrictEqual(['せんだい', 'せんだい']);
  });

  test('returns readings for a character entry', () => {
    expect(get('か')).toStrictEqual(['か', 'け']);
  });

  test('strips okurigana from character reading (dot notation)', () => {
    expect(get('むす')).toStrictEqual(['むす']);
  });

  test('strips affix hyphens from character readings (-だま → だま)', () => {
    expect(get('玉')).toStrictEqual(['たま', 'だま']);
  });

  test('converts katakana input before lookup', () => {
    expect(get('センダイ')).toStrictEqual(['せんだい', 'せんだい']);
  });

  test('non-Japanese input returns no candidates', () => {
    expect(get('sendai')).toStrictEqual([]);
  });

  test('word not in dictionary returns no candidates', () => {
    expect(get('とうきょう')).toStrictEqual([]);
  });
});
