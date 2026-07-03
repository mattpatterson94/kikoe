import { SuruVerbs } from '../../src/candidates/suru_verbs';
import type { Dictionary } from '../../src/dict';

const dictionary: Dictionary = {
  'べんきょう': [{ type: 'word', kana: ['べんきょう'] }],
};

const sv = new SuruVerbs(dictionary);
const get = (raw: string) => sv.getCandidates(raw).map(c => c.data);

describe('SuruVerbs', () => {
  test('stem + する: returns reading + する', () => {
    expect(get('べんきょうする')).toStrictEqual(['べんきょうする']);
  });

  test('katakana する conjugation is converted first', () => {
    expect(get('ベンキョウスル')).toStrictEqual(['べんきょうする']);
  });

  test('input without する returns no candidates', () => {
    expect(get('べんきょう')).toStrictEqual([]);
  });

  test('unknown stem with する returns no candidates', () => {
    expect(get('うんどうする')).toStrictEqual([]);
  });
});
