import { isJapanese } from 'wanakana';
import type { Candidate, CandidateGenerator } from './types';

const mapping = (function () {
  const gojuon = ['あ', 'い', 'う', 'え', 'い', 'お', 'う',
                  'か', 'き', 'く', 'け', 'け', 'こ', 'こ',
                  'が', 'ぎ', 'ぐ', 'げ', 'げ', 'ご', 'ご',
                  'さ', 'し', 'す', 'せ', 'せ', 'そ', 'そ',
                  'ざ', 'じ', 'ず', 'ぜ', 'ぜ', 'ぞ', 'ぞ',
                  'た', 'ち', 'つ', 'て', 'て', 'と', 'と',
                  'だ', 'ぢ', 'づ', 'で', 'で', 'ど', 'ど',
                  'な', 'に', 'ぬ', 'ね', 'ね', 'の', 'の',
                  'は', 'ひ', 'ふ', 'へ', 'へ', 'ほ', 'ほ',
                  'ば', 'び', 'ぶ', 'べ', 'べ', 'ぼ', 'ぼ',
                  'ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぺ', 'ぽ', 'ぽ',
                  'ま', 'み', 'む', 'め', 'め', 'も', 'も',
                  'や', 'yi', 'ゆ', 'ye', 'ye', 'よ', 'よ',
                  'ら', 'り', 'る', 'れ', 'れ', 'ろ', 'ろ',
                  'わ', 'ゐ', 'wu', 'ゑ', 'ゑ', 'を', 'を'];
  const chunkSize = 7;
  const chunks: string[][] = [];
  for (let i = 0; i < gojuon.length; i += chunkSize) {
    const chunk = gojuon.slice(i, i + chunkSize);
    chunks.push(chunk);
  }
  const mapping: Record<string, string[]> = {};
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    for (let j = 0; j < chunkSize; j++) {
      (mapping[chunk[j]] = mapping[chunk[j]] || []).push(chunks[0][j]);
    }
  }
  mapping['ゃ'] = ['あ'];
  mapping['ゅ'] = ['う'];
  mapping['ょ'] = ['お', 'う'];
  return mapping;
})();

function removeCharAt(s: string, i: number): string {
  const tmp = s.split('');
  tmp.splice(i, 1);
  return tmp.join('');
}

function insert(s: string, i: number, t: string): string {
  if (i > 0) {
    return s.substring(0, i) + t + s.substring(i, s.length);
  }
  return t + s;
}

function matchingVowel(c: string, v: string): boolean {
  const vowels = mapping[c];
  if (vowels) {
    return vowels.some(x => v === x);
  }
  return false;
}

export class FuzzyVowels implements CandidateGenerator {
  order = 1;

  getCandidates(raw: string): Candidate[] {
    if (!isJapanese(raw)) {
      return [];
    }

    const candidates: Candidate[] = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charAt(i);
      const n = raw.charAt(i + 1);
      if (matchingVowel(c, n)) {
        candidates.push({ type: 'fuzzy', data: removeCharAt(raw, i + 1) });
      } else {
        const vowels = mapping[c] || [];
        for (const v of vowels) {
          if (v !== c) {
            candidates.push({ type: 'fuzzy', data: insert(raw, i + 1, v) });
          }
        }
      }
    }
    return candidates;
  }
}
