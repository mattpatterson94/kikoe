// Scores recognition-probe transcripts with Kikoe's real matcher (the same
// transformer chain app.ts uses, dictionary from chrome/data — run
// `npm run build` first). Usage, from the repo root:
//   npx esbuild ios-spike/score-probe.ts --bundle --platform=node --format=esm \
//     --outfile=/tmp/score-probe.mjs && node /tmp/score-probe.mjs \
//     sim=ios-spike/probe-results/sim-sfspeech.json macOS=ios-spike/probe-results/macos-analyzer.json

import { readFileSync } from 'node:fs';
import { checkAnswer } from '../src/flashcards';
import type { Dictionary } from '../src/dict';
import { ToHiragana } from '../src/candidates/to_hiragana';
import { ConvertWo } from '../src/candidates/convert_wo';
import { BasicDictionary } from '../src/candidates/basic_dictionary';
import { SplitDictionary } from '../src/candidates/split_dictionary';
import { CompoundDictionary } from '../src/candidates/compound_dictionary';
import { SuruVerbs } from '../src/candidates/suru_verbs';
import { RepeatingSubstring } from '../src/candidates/repeating';
import { MultipleWords } from '../src/candidates/multiple';
import { Numerals } from '../src/candidates/numerals';

const dictionary: Dictionary = {};
for (const f of ['jmdict', 'kanjidic2']) {
  const d = JSON.parse(readFileSync('chrome/data/' + f + '.json', 'utf8')) as Dictionary;
  for (const [k, v] of Object.entries(d)) (dictionary[k] ??= []).push(...v);
}
const transformers = [
  new ToHiragana(), new ConvertWo(), new BasicDictionary(dictionary), new SplitDictionary(dictionary),
  new CompoundDictionary(dictionary), new SuruVerbs(dictionary), new RepeatingSubstring(),
  new MultipleWords(dictionary), new Numerals(dictionary),
];
interface Row { engine: string; hints: boolean; prompt: string; reading: string; transcripts: string[]; label?: string }
const rows: Row[] = [];
for (const arg of process.argv.slice(2)) {
  const [label, path] = arg.split('=');
  for (const r of JSON.parse(readFileSync(path, 'utf8')) as Row[]) rows.push({ ...r, label });
}
const groups = new Map<string, { top1: number; any: number; n: number; strictAny: number; fails: string[] }>();
for (const r of rows) {
  const ctx = { type: 'reading', category: 'kanji', readings: [r.reading], prompt: r.prompt, meanings: [] };
  const ok = (t: string, strict: boolean) => checkAnswer(ctx, transformers, t.replace(/[。、.]/g, ''), { strictKanjiReadings: strict }).success;
  const key = r.label + ' ' + r.engine + ' hints=' + r.hints;
  const g = groups.get(key) ?? { top1: 0, any: 0, n: 0, strictAny: 0, fails: [] };
  g.n++;
  if (r.transcripts[0] && ok(r.transcripts[0], false)) g.top1++;
  if (r.transcripts.some(t => ok(t, false))) g.any++; else g.fails.push(r.reading + '→' + (r.transcripts[0] ?? '∅'));
  if (r.transcripts.some(t => ok(t, true))) g.strictAny++;
  groups.set(key, g);
}
for (const [k, g] of groups) console.log(k.padEnd(52), 'top1', g.top1 + '/' + g.n, ' any', g.any + '/' + g.n, ' strict-any', g.strictAny + '/' + g.n, ' fails:', g.fails.join(' '));
