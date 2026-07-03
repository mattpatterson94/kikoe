import { toHiragana, isKanji } from 'wanakana';
import type { Candidate, CandidateGenerator } from './types';
import type { Dictionary, DictionaryEntry } from '../dict';

// TODO: create dictionary class and move this there
function lookup(dictionary: Dictionary, s: string): DictionaryEntry[] {
  const result = dictionary[s];
  if (result) {
    return result;
  }
  return [];
}

function characterReadings(entries: DictionaryEntry[]): string[] {
  const readings: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'word') {
      readings.push(...entry.kana.map(k => toHiragana(k)));
    }
    if (entry.type === 'character') {
      for (const r of entry.readings) {
        // "むす.ぶ" marks okurigana; "なん-" marks affix position.
        const value = r.value.split('.')[0].replaceAll('-', '');
        readings.push(toHiragana(value));
      }
    }
  }
  return [...new Set(readings)];
}

// Keep the combination count in check so later transformers (fuzzy vowels,
// etc.) don't multiply an already large candidate set.
const MAX_CANDIDATES = 50;

// Sound changes that occur when kanji readings combine into a compound.
// Rendaku voices the first mora of a non-initial component (南+国 →
// なんごく); after gemination the h-row can also take the p-sound
// (一+本 → いっぽん).
const RENDAKU: Record<string, string> = {
  'か': 'が', 'き': 'ぎ', 'く': 'ぐ', 'け': 'げ', 'こ': 'ご',
  'さ': 'ざ', 'し': 'じ', 'す': 'ず', 'せ': 'ぜ', 'そ': 'ぞ',
  'た': 'だ', 'ち': 'ぢ', 'つ': 'づ', 'て': 'で', 'と': 'ど',
  'は': 'ば', 'ひ': 'び', 'ふ': 'ぶ', 'へ': 'べ', 'ほ': 'ぼ',
};
const HANDAKU: Record<string, string> = {
  'は': 'ぱ', 'ひ': 'ぴ', 'ふ': 'ぷ', 'へ': 'ぺ', 'ほ': 'ぽ',
};

// Sokuon geminates the final mora of a non-final component (一+斤 → いっきん).
const SOKUON_FINALS = new Set(['つ', 'ち', 'く', 'き']);

// Base readings come first so slicing to MAX_CANDIDATES prefers plain
// combinations over sound-changed ones.
function withSoundChanges(reading: string, isFirst: boolean, isLast: boolean): string[] {
  const variants = [reading];
  if (!isFirst) {
    const head = reading[0];
    const tail = reading.slice(1);
    if (RENDAKU[head]) variants.push(RENDAKU[head] + tail);
    if (HANDAKU[head]) variants.push(HANDAKU[head] + tail);
  }
  if (!isLast) {
    for (const v of [...variants]) {
      if (v.length >= 2 && SOKUON_FINALS.has(v[v.length - 1])) {
        variants.push(v.slice(0, -1) + 'っ');
      }
    }
  }
  return variants;
}

// 々 repeats the previous kanji (人々 → 人人) but is neither kana nor kanji
// to wanakana; expand it so per-character lookup sees a real character.
function expandIterationMarks(s: string): string {
  let result = '';
  for (const char of s) {
    result += char === '々' ? (result[result.length - 1] ?? char) : char;
  }
  return result;
}

// JMdict omits compositional compounds (何月, 何人, …), so a whole-word
// lookup can't convert them to kana. Build candidate readings for an
// all-kanji word by combining each character's individual readings —
// including rendaku/sokuon variants — wrong combinations are harmless
// because candidates only submit when they match the card's accepted
// readings.
export class CompoundDictionary implements CandidateGenerator {
  order = 0;
  dictionary: Dictionary;

  constructor(dictionary: Dictionary) {
    this.dictionary = dictionary;
  }

  getCandidates(raw: string): Candidate[] {
    const expanded = expandIterationMarks(raw);
    if (expanded.length < 2 || expanded.length > 4 || !isKanji(expanded)) return [];
    // The whole word is known — BasicDictionary already covers it.
    if (lookup(this.dictionary, raw).length > 0) return [];

    const chars = expanded.split('');
    let combos = [''];
    for (const [i, char] of chars.entries()) {
      const readings = characterReadings(lookup(this.dictionary, char))
        .flatMap(r => withSoundChanges(r, i === 0, i === chars.length - 1));
      if (readings.length === 0) return [];
      combos = combos
        .flatMap(prefix => readings.map(r => prefix + r))
        .slice(0, MAX_CANDIDATES);
    }
    return [...new Set(combos)].map(data => ({ type: 'compound dictionary', data }));
  }
}
