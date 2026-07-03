import { isJapanese } from 'wanakana';
import type { Candidate, CandidateGenerator } from './types';
import type { Dictionary } from '../dict';

export class ConvertWo implements CandidateGenerator {
  order = 1;

  constructor(_dictionary?: Dictionary) {}

  getCandidates(raw: string): Candidate[] {
    const candidates: Candidate[] = [];
    if (isJapanese(raw) && raw.indexOf('を') > 0) {
      const chars = raw.split('');
      const data = chars.map(c => c === 'を' ? 'お' : c).join('');
      candidates.push({ type: 'convert wo', data });
    }
    return candidates;
  }
}
