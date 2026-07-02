function addEntry(dictionary, key, entries) {
  if (!dictionary[key]) {
    dictionary[key] = [];
  }
  dictionary[key].push(...entries);
}

// Returns an (initially empty) dictionary object synchronously and populates
// it in place once the ~12 MB data files have been fetched and parsed.
// Candidate transformers hold a reference to this same object, so entries
// simply appear as they arrive — callers don't need to wait for `ready`
// before starting recognition, only before relying on lookups succeeding.
export function loadDictionary(base) {
  const dictionary = {};
  const ready = Promise.all([
    fetch(base + 'data/jmdict.json').then(r => r.json()),
    fetch(base + 'data/kanjidic2.json').then(r => r.json()),
  ]).then(([words, kanji]) => {
    for (const [k, v] of Object.entries(words)) addEntry(dictionary, k, v);
    for (const [k, v] of Object.entries(kanji)) addEntry(dictionary, k, v);
  });
  return { dictionary, ready };
}
