import { MultipleWords } from '../../src/candidates/multiple';

const dictionary = {
  '南極': [{ id: '1460180', type: 'word', kanji: ['南極'], kana: ['なんきょく'] }],
  '県':   [{ id: '1258810', type: 'word', kanji: ['県', '縣'], kana: ['けん'] }],
};

const multiple = new MultipleWords(dictionary);
const get = (raw) => multiple.getCandidates(raw).map(c => c.data).sort();

describe('MultipleWords', () => {
  test('null returns no candidates', () => {
    expect(get(null)).toStrictEqual([]);
  });

  test('empty string returns no candidates', () => {
    expect(get('')).toStrictEqual([]);
  });

  test('merges two space-separated kanji words into one reading', () => {
    expect(get('南極 県')).toStrictEqual(['なんきょくけん']);
  });

  test('single word with no space returns no candidates', () => {
    expect(get('南極')).toStrictEqual([]);
  });
});
