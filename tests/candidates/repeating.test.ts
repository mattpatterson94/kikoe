import { findRepeatingSubstring, RepeatingSubstring } from '../../src/candidates/repeating';

describe('findRepeatingSubstring', () => {
  test('length-2 string with single repeated char', () => {
    expect(findRepeatingSubstring('aa')).toBe('a');
  });

  test('length-6 string with 2-char repeat', () => {
    expect(findRepeatingSubstring('ababab')).toBe('ab');
  });

  test('odd-length partial repeat returns null', () => {
    expect(findRepeatingSubstring('ababa')).toBe(null);
  });

  test('no repeat returns null', () => {
    expect(findRepeatingSubstring('abc')).toBe(null);
  });

  test('single character returns null', () => {
    expect(findRepeatingSubstring('a')).toBe(null);
  });

  test('hiragana repeat', () => {
    expect(findRepeatingSubstring('あいあい')).toBe('あい');
  });
});

describe('RepeatingSubstring.getCandidates', () => {
  const rs = new RepeatingSubstring();

  test('returns substring candidate for repeating input', () => {
    expect(rs.getCandidates('ababab').map(c => c.data)).toStrictEqual(['ab']);
  });

  test('returns empty for non-repeating input', () => {
    expect(rs.getCandidates('abc')).toStrictEqual([]);
  });
});
