import { MultipleWords } from '../../src/candidates/multiple';
import type { Dictionary } from '../../src/dict';

const dictionary: Dictionary = {
  '南極': [{ type: 'word', kana: ['なんきょく'] }],
  '県':   [{ type: 'word', kana: ['けん'] }],
};

const multiple = new MultipleWords(dictionary);
const get = (raw: string | null) => multiple.getCandidates(raw).map(c => c.data).sort();

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
