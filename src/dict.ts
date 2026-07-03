// Entry shapes match what scripts/trim-dictionary-data.js keeps from the
// upstream JMdict/KANJIDIC2 data: word entries carry kana spellings,
// character entries carry readings (with okurigana/affix markers intact).
export interface WordEntry {
  type: 'word';
  kana: string[];
}

export interface CharacterEntry {
  type: 'character';
  readings: { value: string }[];
}

export type DictionaryEntry = WordEntry | CharacterEntry;

export type Dictionary = Record<string, DictionaryEntry[]>;

function addEntry(dictionary: Dictionary, key: string, entries: DictionaryEntry[]): void {
  const existing = dictionary[key];
  if (existing) {
    existing.push(...entries);
  } else {
    dictionary[key] = [...entries];
  }
}

// Returns an (initially empty) dictionary object synchronously and populates
// it in place once the ~12 MB data files have been fetched and parsed.
// Candidate transformers hold a reference to this same object, so entries
// simply appear as they arrive — callers don't need to wait for `ready`
// before starting recognition, only before relying on lookups succeeding.
export function loadDictionary(base: string): { dictionary: Dictionary; ready: Promise<void> } {
  const dictionary: Dictionary = {};
  const ready = Promise.all([
    fetch(base + 'data/jmdict.json').then(r => r.json() as Promise<Dictionary>),
    fetch(base + 'data/kanjidic2.json').then(r => r.json() as Promise<Dictionary>),
  ]).then(([words, kanji]) => {
    for (const [k, v] of Object.entries(words)) addEntry(dictionary, k, v);
    for (const [k, v] of Object.entries(kanji)) addEntry(dictionary, k, v);
  });
  return { dictionary, ready };
}
