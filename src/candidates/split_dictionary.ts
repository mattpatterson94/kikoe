import { isKana } from 'wanakana';
import { BasicDictionary } from './basic_dictionary';
import { CompoundDictionary } from './compound_dictionary';
import type { Candidate, CandidateGenerator } from './types';
import type { Dictionary } from '../dict';

// Keep the combination count in check so later transformers don't multiply
// an already large candidate set.
const MAX_CANDIDATES = 50;

interface Run {
  kana: boolean;
  text: string;
}

// Split into runs of consecutive kana / non-kana characters, e.g.
// お客さん → ['お', '客', 'さん'].
function splitRuns(raw: string): Run[] {
  const runs: Run[] = [];
  for (const char of raw.split('')) {
    const kana = isKana(char);
    const last = runs[runs.length - 1];
    if (last && last.kana === kana) {
      last.text += char;
    } else {
      runs.push({ kana, text: char });
    }
  }
  return runs;
}

// Mixed kana/kanji words (お客さん, 気を付けて, 切り取る) rarely appear
// whole in JMdict. Keep each kana run literal and replace each kanji run
// with its dictionary readings, combining across runs. Kanji runs missing
// from JMdict (耳打 in 耳打ち) fall back to per-character compound readings.
export class SplitDictionary implements CandidateGenerator {
  order = 0;
  basicDictionary: BasicDictionary;
  compoundDictionary: CompoundDictionary;

  constructor(dictionary: Dictionary) {
    this.basicDictionary = new BasicDictionary(dictionary);
    this.compoundDictionary = new CompoundDictionary(dictionary);
  }

  readingsFor(run: string): string[] {
    const basic = this.basicDictionary.getCandidates(run).map(c => c.data);
    if (basic.length > 0) return [...new Set(basic)];
    return this.compoundDictionary.getCandidates(run).map(c => c.data);
  }

  getCandidates(raw: string): Candidate[] {
    const runs = splitRuns(raw);
    // Pure kana needs no lookup; pure kanji is Basic/CompoundDictionary's job.
    if (runs.every(r => r.kana) || runs.every(r => !r.kana)) return [];

    let combos = [''];
    for (const run of runs) {
      const parts = run.kana ? [run.text] : this.readingsFor(run.text);
      if (parts.length === 0) return [];
      combos = combos
        .flatMap(prefix => parts.map(p => prefix + p))
        .slice(0, MAX_CANDIDATES);
    }
    return combos.map(data => ({ type: 'split dictionary', data }));
  }
}
