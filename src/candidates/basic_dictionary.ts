import { toHiragana, isJapanese } from 'wanakana';
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

function getReadings(entries: DictionaryEntry[]): string[] {
  return entries.flatMap(entry => {
    if (entry.type === 'word') {
      return entry.kana.map(k => toHiragana(k));
    }
    if (entry.type === 'character') {
      return entry.readings.map(r => {
        // "むす.ぶ" marks okurigana; "-だま" marks affix position.
        const value = r.value.split('.')[0].replaceAll('-', '');
        return toHiragana(value);
      });
    }
    return [];
  });
}

export class BasicDictionary implements CandidateGenerator {
  order = 0;
  dictionary: Dictionary;

  constructor(dictionary: Dictionary) {
    this.dictionary = dictionary;
  }

  getCandidates(raw: string): Candidate[] {
    if (!isJapanese(raw)) {
      return [];
    }
    const candidates: Candidate[] = [];
    const hiragana = toHiragana(raw);
    const entries = lookup(this.dictionary, hiragana);
    const rs = getReadings(entries);
    for (const r of rs) {
      candidates.push({ type: 'dictionary', data: r });
    }
    return candidates;
  }
}
