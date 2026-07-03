import { toHiragana } from 'wanakana';
import { BasicDictionary } from './basic_dictionary';
import type { Candidate, CandidateGenerator } from './types';
import type { Dictionary } from '../dict';

export class SuruVerbs implements CandidateGenerator {
  order = 0;
  basicDictionary: BasicDictionary;

  constructor(dictionary: Dictionary) {
    this.basicDictionary = new BasicDictionary(dictionary);
  }

  getCandidates(raw: string): Candidate[] {
    const hiragana = toHiragana(raw);
    const candidates: Candidate[] = [];
    if (hiragana.endsWith('する')) {
      const root = hiragana.substring(0, hiragana.length - 2);
      const readings = this.basicDictionary.getCandidates(root);
      for (const r of readings) {
        candidates.push({ type: 'する', data: r.data + 'する' });
      }
    }
    return candidates;
  }
}
