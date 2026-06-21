import { ToHiragana } from '../../src/candidates/to_hiragana.js';

const toh = new ToHiragana();
const get = (raw) => toh.getCandidates(raw).map(c => c.data).sort();

// ToHiragana only processes isJapanese() input (hiragana/katakana/kanji).
// Romaji is handled by the Web Speech API language setting (ja-JP), not here.
describe('ToHiragana', () => {
  test('hiragana with choonpu passes through unchanged', () => {
    expect(get('えー')).toStrictEqual(['えー']);
  });

  test('katakana choonpu expands to hiragana long vowel', () => {
    expect(get('エー')).toStrictEqual(['ええ']);
  });

  test('plain katakana converts to hiragana', () => {
    expect(get('アイウ')).toStrictEqual(['あいう']);
  });

  test('already-hiragana passes through unchanged', () => {
    expect(get('にほん')).toStrictEqual(['にほん']);
  });

  test('mixed katakana and hiragana converts fully to hiragana', () => {
    expect(get('アイう')).toStrictEqual(['あいう']);
  });

  test('romaji is not Japanese — returns no candidates', () => {
    // Voice recognition runs in ja-JP for readings, so raw input will already be kana.
    expect(get('nihon')).toStrictEqual([]);
  });
});
