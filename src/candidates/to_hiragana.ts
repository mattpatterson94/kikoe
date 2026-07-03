import { toHiragana, isJapanese } from 'wanakana';
import type { Candidate, CandidateGenerator } from './types';
import type { Dictionary } from '../dict';

export class ToHiragana implements CandidateGenerator {
  order = 0;

  constructor(_dictionary?: Dictionary) {}

  getCandidates(raw: string): Candidate[] {
    const candidates: Candidate[] = [];
    if (isJapanese(raw)) {
      const hiragana = toHiragana(raw, { convertLongVowelMark: true });
      candidates.push({ type: 'hiragana', data: hiragana });
    }
    return candidates;
  }
}
