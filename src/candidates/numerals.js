import kansuji from 'kansuji';
import { ToWords } from 'to-words';
import { isJapanese, toHiragana } from 'wanakana';

function anyJapanese(s) {
  return s.split('').some(c => isJapanese(c));
}

// TODO: create dictionary class and move this there (duplicated from
// basic_dictionary.js)
function lookup(dictionary, s) {
  return dictionary[s] || [];
}

// Irregular day-of-month readings (六日 → むいか, 二十日 → はつか, …) are
// whole-word JMdict entries keyed by the kanji spelling, but that spelling
// only exists after kansuji conversion — too late for BasicDictionary's
// lookup, which only ever sees the original raw (digit) input. Do the same
// lookup here once the kanji form is known.
function dictionaryReadings(dictionary, kanjiForm) {
  return lookup(dictionary, kanjiForm)
    .filter(entry => entry.type === 'word')
    .flatMap(entry => entry.kana.map(toHiragana));
}

export class Numerals {
  constructor(dictionary = {}) {
    this.order = 0;
    this.dictionary = dictionary;
  }

  getCandidates(raw) {
    // Include comma grouping (e.g. "10,000") so large numbers aren't cut
    // off at the first comma and misconverted.
    const match = raw.match(/[\d,]*\d/);
    if (!match) {
      return [];
    }
    const candidates = [];
    const type = 'numeral';
    const part = match[0];
    const digits = part.replace(/,/g, '');

    if (!anyJapanese(raw)) {
      const toWords = new ToWords();
      let converted = toWords.convert(digits);
      let data = raw.replace(part, converted);
      candidates.push({data, type});
    }

    if (raw === part || anyJapanese(raw)) {
      let converted = kansuji(digits);
      let data = raw.replace(part, converted);
      candidates.push({data, type});

      for (const reading of dictionaryReadings(this.dictionary, data)) {
        candidates.push({ data: reading, type: 'numeral dictionary' });
      }
    }

    return candidates;
  }
}
