function addEntry(dictionary, key, entries) {
  if (!dictionary[key]) {
    dictionary[key] = [];
  }
  dictionary[key].push(...entries);
}

export async function loadDictionary(base) {
  const [words, kanji] = await Promise.all([
    fetch(base + 'data/jmdict.json').then(r => r.json()),
    fetch(base + 'data/kanjidic2.json').then(r => r.json()),
  ]);
  const dictionary = {};
  for (const [k, v] of Object.entries(words)) addEntry(dictionary, k, v);
  for (const [k, v] of Object.entries(kanji)) addEntry(dictionary, k, v);
  return dictionary;
}
