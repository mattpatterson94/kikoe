import kansuji from 'kansuji';
import { ToWords } from 'to-words';
import { isJapanese, toHiragana } from 'wanakana';
import type { Candidate, CandidateGenerator } from './types';
import type { Dictionary, DictionaryEntry, WordEntry } from '../dict';

function anyJapanese(s: string): boolean {
  return s.split('').some(c => isJapanese(c));
}

// TODO: create dictionary class and move this there (duplicated from
// basic_dictionary.ts)
function lookup(dictionary: Dictionary, s: string): DictionaryEntry[] {
  return dictionary[s] || [];
}

// Irregular day-of-month readings (六日 → むいか, 二十日 → はつか, …) are
// whole-word JMdict entries keyed by the kanji spelling, but that spelling
// only exists after kansuji conversion — too late for BasicDictionary's
// lookup, which only ever sees the original raw (digit) input. Do the same
// lookup here once the kanji form is known.
function dictionaryReadings(dictionary: Dictionary, kanjiForm: string): string[] {
  return lookup(dictionary, kanjiForm)
    .filter((entry): entry is WordEntry => entry.type === 'word')
    .flatMap(entry => entry.kana.map(k => toHiragana(k)));
}

export class Numerals implements CandidateGenerator {
  order = 0;
  dictionary: Dictionary;

  constructor(dictionary: Dictionary = {}) {
    this.dictionary = dictionary;
  }

  getCandidates(raw: string): Candidate[] {
    // Include comma grouping (e.g. "10,000") so large numbers aren't cut
    // off at the first comma and misconverted.
    const match = raw.match(/[\d,]*\d/);
    if (!match) {
      return [];
    }
    const candidates: Candidate[] = [];
    const type = 'numeral';
    const part = match[0];
    const digits = part.replace(/,/g, '');

    if (!anyJapanese(raw)) {
      const toWords = new ToWords();
      const converted = toWords.convert(Number(digits));
      const data = raw.replace(part, converted);
      candidates.push({ data, type });
    }

    if (raw === part || anyJapanese(raw)) {
      const converted = kansuji(digits);
      const data = raw.replace(part, converted);
      candidates.push({ data, type });

      for (const reading of dictionaryReadings(this.dictionary, data)) {
        candidates.push({ data: reading, type: 'numeral dictionary' });
      }
    }

    return candidates;
  }
}
