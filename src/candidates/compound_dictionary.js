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

// JMdict omits compositional compounds (何月, 何人, …), so a whole-word
// lookup can't convert them to kana. Build candidate readings for an
// all-kanji word by combining each character's individual readings; wrong
// combinations are harmless because candidates only submit when they match
// the card's accepted readings.
export class CompoundDictionary {
  constructor(dictionary) {
    this.order = 0;
    this.dictionary = dictionary;
  }

  getCandidates(raw) {
    if (raw.length < 2 || raw.length > 4 || !isKanji(raw)) return [];
    // The whole word is known — BasicDictionary already covers it.
    if (lookup(this.dictionary, raw).length > 0) return [];

    let combos = [''];
    for (const char of raw.split('')) {
      const readings = characterReadings(lookup(this.dictionary, char));
      if (readings.length === 0) return [];
      combos = combos
        .flatMap(prefix => readings.map(r => prefix + r))
        .slice(0, MAX_CANDIDATES);
    }
    return combos.map(data => ({ type: 'compound dictionary', data }));
  }
}
