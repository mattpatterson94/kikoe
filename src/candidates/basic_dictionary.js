import { toHiragana, isJapanese } from 'wanakana';

// TODO: create dictionary class and move this there
function lookup(dictionary, s) {
  const result = dictionary[s];
  if (result) {
    return result;
  }
  return [];
}

function getReadings(entries) {
  return entries.flatMap(entry => {
    if (entry.type === 'word') {
      return entry['kana'].map(toHiragana);
    }
    if (entry.type === 'character') {
      return entry.readings.map(r => {
        let value = r.value;
        if (value.includes('.')) {
          value = value.split('.')[0];
        }
        return toHiragana(value);
      });
    }
    return [];
  });
}

export class BasicDictionary {
  constructor(dictionary) {
    this.order = 0;
    this.dictionary = dictionary;
  }

  getCandidates(raw) {
    if (!isJapanese(raw)) {
      return [];
    }
    const candidates = [];
    const hiragana = toHiragana(raw);
    const entries = lookup(this.dictionary, hiragana);
    const rs = getReadings(entries);
    for (let r of rs) {
      candidates.push({type: "dictionary", data: r});
    }
    return candidates;
  }
}
