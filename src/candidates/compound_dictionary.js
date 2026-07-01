import { toHiragana, isKanji } from 'wanakana';

// TODO: create dictionary class and move this there
function lookup(dictionary, s) {
  const result = dictionary[s];
  if (result) {
    return result;
  }
  return [];
}

function characterReadings(entries) {
  const readings = [];
  for (const entry of entries) {
    if (entry.type === 'word') {
      readings.push(...entry.kana.map(toHiragana));
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
const RENDAKU = {
  'か': 'が', 'き': 'ぎ', 'く': 'ぐ', 'け': 'げ', 'こ': 'ご',
  'さ': 'ざ', 'し': 'じ', 'す': 'ず', 'せ': 'ぜ', 'そ': 'ぞ',
  'た': 'だ', 'ち': 'ぢ', 'つ': 'づ', 'て': 'で', 'と': 'ど',
  'は': 'ば', 'ひ': 'び', 'ふ': 'ぶ', 'へ': 'べ', 'ほ': 'ぼ',
};
const HANDAKU = { 'は': 'ぱ', 'ひ': 'ぴ', 'ふ': 'ぷ', 'へ': 'ぺ', 'ほ': 'ぽ' };

// Sokuon geminates the final mora of a non-final component (一+斤 → いっきん).
const SOKUON_FINALS = new Set(['つ', 'ち', 'く', 'き']);

// Base readings come first so slicing to MAX_CANDIDATES prefers plain
// combinations over sound-changed ones.
function withSoundChanges(reading, isFirst, isLast) {
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

// JMdict omits compositional compounds (何月, 何人, …), so a whole-word
// lookup can't convert them to kana. Build candidate readings for an
// all-kanji word by combining each character's individual readings —
// including rendaku/sokuon variants — wrong combinations are harmless
// because candidates only submit when they match the card's accepted
// readings.
export class CompoundDictionary {
  constructor(dictionary) {
    this.order = 0;
    this.dictionary = dictionary;
  }

  getCandidates(raw) {
    if (raw.length < 2 || raw.length > 4 || !isKanji(raw)) return [];
    // The whole word is known — BasicDictionary already covers it.
    if (lookup(this.dictionary, raw).length > 0) return [];

    const chars = raw.split('');
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
