import kansuji from 'kansuji';
import { ToWords } from 'to-words';
import { isJapanese } from 'wanakana';

function anyJapanese(s) {
  return s.split('').some(c => isJapanese(c));
}

export class Numerals {
  constructor() {
    this.order = 0;
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
    }

    return candidates;
  }
}
