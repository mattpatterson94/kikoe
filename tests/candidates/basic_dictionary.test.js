import { BasicDictionary } from '../../src/candidates/basic_dictionary.js';

const dictionary = {
  'せんだい': [
    { id: '1', type: 'word', kanji: ['仙台'], kana: ['せんだい'] },
    { id: '2', type: 'word', kanji: ['先代'], kana: ['せんだい'] },
  ],
  'か': [
    { id: '3', type: 'character', readings: [{ value: 'か' }, { value: 'け' }] },
  ],
  'むす': [
    { id: '4', type: 'character', readings: [{ value: 'むす.ぶ' }] },
  ],
};

const bd = new BasicDictionary(dictionary);
const get = (raw) => bd.getCandidates(raw).map(c => c.data);

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
