import { toHiragana, isKana, isKanji } from 'wanakana';
import { BasicDictionary } from './basic_dictionary.js';

function takeWhile(xs, f) {
  const result = [];
  for (let x of xs) {
    if (f(x)) {
      result.push(x);
    } else {
      return result;
    }
  }
  return result;
}

function dropWhile(xs, f) {
  let i = 0;
  while (f(xs[i])) {
    i++;
  }
  return xs.slice(i, xs.length);
}



export class SplitDictionary {
  constructor(dictionary) {
    this.order = 0;
    this.basicDictionary = new BasicDictionary(dictionary);
  }

  getCandidates(raw) {
    const candidates = [];

    const chars = raw.split('');
    const kanaPre = takeWhile(chars, isKana).join('');
    const kanjiPost = dropWhile(chars, isKana).join('');
    for (let c of this.basicDictionary.getCandidates(kanjiPost)) {
      candidates.push({type: 'split dictionary', data: kanaPre + c.data});
    }
    const kanjiPre = takeWhile(chars, isKanji).join('');
    const kanaPost = dropWhile(chars, isKanji).join('');
    for (let c of this.basicDictionary.getCandidates(kanjiPre)) {
      candidates.push({type: 'split dictionary', data: c.data + kanaPost});
    }

    return candidates;
  }
}
