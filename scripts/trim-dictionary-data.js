#!/usr/bin/env node
// Strips the downloaded JMdict/KANJIDIC2 JSON down to only the fields the
// candidate transformers actually read (src/candidates/*.js): entry.type,
// entry.kana for words, entry.readings[].value for characters. Everything
// else — ids, kanji spellings, on/kun markers, etc. — is dead weight once
// bundled into the extension.

import { readFileSync, writeFileSync, statSync } from 'fs';

function trimEntry(entry) {
  if (entry.type === 'word') return { type: 'word', kana: entry.kana };
  if (entry.type === 'character') {
    return { type: 'character', readings: entry.readings.map(r => ({ value: r.value })) };
  }
  return entry;
}

function trimFile(path) {
  const before = statSync(path).size;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const trimmed = {};
  for (const [key, entries] of Object.entries(data)) {
    trimmed[key] = entries.map(trimEntry);
  }
  writeFileSync(path, JSON.stringify(trimmed));
  const after = statSync(path).size;
  console.log(`  ${path}: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB`);
}

for (const path of process.argv.slice(2)) {
  trimFile(path);
}
