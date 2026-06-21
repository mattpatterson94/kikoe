import { toHiragana, isJapanese } from 'wanakana';

export class ConvertWo {
  constructor(dictionary) {
    this.order = 1;
  }

  getCandidates(raw) {
    const candidates = [];
    if (isJapanese(raw) && raw.indexOf('を') > 0) {
      const chars = raw.split('');
      const data = chars.map(c => c === 'を' ? 'お' : c).join('');
      candidates.push({ type: 'convert wo', data });
    }
    return candidates;
  }
}
