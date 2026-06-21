import { toHiragana } from 'wanakana';
import { BasicDictionary } from './basic_dictionary.js';

export class SuruVerbs {
  constructor(dictionary) {
    this.order = 0;
    this.basicDictionary = new BasicDictionary(dictionary);
  }

  getCandidates(raw) {
    const hiragana = toHiragana(raw);
    const candidates = [];
    if (hiragana.endsWith('する')) {
      const root = hiragana.substring(0, hiragana.length - 2);
      const readings = this.basicDictionary.getCandidates(root);
      for (let r of readings) {
        candidates.push({type: "する", data: r.data + 'する'});
      }
    }
    return candidates;
  }
}
