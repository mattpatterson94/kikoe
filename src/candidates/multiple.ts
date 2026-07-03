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
        let value = r.value;
        if (value.includes('.')) {
          value = value.split('.')[0];
        }
        return toHiragana(value);
      });
    }
    return [];
  });
}

export class MultipleWords implements CandidateGenerator {
  order = 0;
  dictionary: Dictionary;

  constructor(dictionary: Dictionary) {
    this.dictionary = dictionary;
  }

  getCandidates(raw: string): Candidate[] {
    if (!raw || raw.length === 0) {
      return [];
    }
    const nospaces = raw.split('').filter(c => c !== ' ').join('');
    if (!isJapanese(nospaces)) {
      return [];
    }
    const candidates: Candidate[] = [];
    if (raw.includes(' ')) {
      const parts = raw.split(' ').filter(x => x.length > 0);
      const readings = parts.map(part => {
        const hiragana = toHiragana(part);
        const entries = lookup(this.dictionary, hiragana);
        const rs = getReadings(entries);
        // TODO proper combinations
        if (rs.length > 0) {
          return rs[0];
        }
        return '';
      });
      candidates.push({ type: 'multiple', data: readings.join('') });
    }
    return candidates;
  }
}
