import { checkAnswer, normalize } from '../src/flashcards';
import { ToHiragana } from '../src/candidates/to_hiragana';
import { BasicDictionary } from '../src/candidates/basic_dictionary';
import { FuzzyVowels } from '../src/candidates/fuzzy_vowels';
import { ConvertWo } from '../src/candidates/convert_wo';
import { CompoundDictionary } from '../src/candidates/compound_dictionary';
import { SplitDictionary } from '../src/candidates/split_dictionary';
import { Numerals } from '../src/candidates/numerals';

const dictionary = {
  'せんだい': [
    { id: '1388080', type: 'word', kanji: ['先代'], kana: ['せんだい'] },
    { id: '2164680', type: 'word', kanji: ['仙台', '仙臺'], kana: ['せんだい'] },
  ],
};

function makeTransformers(dict = {}) {
  return [new ToHiragana(), new BasicDictionary(dict)];
}

// ── normalize ─────────────────────────────────────────────────────────────────

describe('normalize', () => {
  test('strips leading article "the"', () => {
    expect(normalize('the village')).toBe('village');
  });

  test('strips leading article "a"', () => {
    expect(normalize('a dog')).toBe('dog');
  });

  test('strips trailing punctuation', () => {
    expect(normalize('village.')).toBe('village');
  });

  test('lowercases English', () => {
    expect(normalize('Cold Hearted')).toBe('cold hearted');
  });

  test('preserves spaces in multi-word English meanings', () => {
    expect(normalize('put on clothes')).toBe('put on clothes');
  });

  test('converts Japanese to hiragana and removes spaces', () => {
    expect(normalize('センダイ')).toBe('せんだい');
  });
});

// ── Meaning questions ─────────────────────────────────────────────────────────

describe('meaning questions', () => {
  test('returns normalised English text when it matches a meaning', () => {
    const ctx = { type: 'meaning', prompt: '薄情', category: 'vocabulary', meanings: ['Cold Hearted', 'Coldhearted'] };
    const r = checkAnswer(ctx, makeTransformers(), 'Cold Hearted');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('cold hearted');
  });

  test('strips leading article before matching', () => {
    const ctx = { type: 'meaning', prompt: '村', category: 'vocabulary', meanings: ['village'] };
    const r = checkAnswer(ctx, makeTransformers(), 'the village');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('village');
  });

  test('preserves spaces in multi-word answers', () => {
    const ctx = { type: 'meaning', meanings: ['put on clothes'] };
    const r = checkAnswer(ctx, makeTransformers(), 'put on clothes');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('put on clothes');
  });

  test('does not submit when answer does not match any meaning', () => {
    const ctx = { type: 'meaning', meanings: ['wheat'] };
    const r = checkAnswer(ctx, makeTransformers(), 'wait');
    expect(r.success).toBe(false);
  });

  test('does not submit when meanings list is empty (subjects not yet loaded)', () => {
    const ctx = { type: 'meaning', meanings: [] };
    const r = checkAnswer(ctx, makeTransformers(), 'anything');
    expect(r.success).toBe(false);
  });

  test('matches compound word with space ("rib cage" → "ribcage")', () => {
    const ctx = { type: 'meaning', meanings: ['ribcage'] };
    const r = checkAnswer(ctx, makeTransformers(), 'rib cage');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('ribcage');
  });

  // Bug reproduction: spelling out a short word ("e a r") makes speech
  // recognition return it as separate space-separated letters. The compact
  // form matched, but the spaced candidate was submitted, which WaniKani
  // rejects.
  test('REGRESSION: submits the compact form for spelled-out letters ("e a r" → "ear")', () => {
    const ctx = { type: 'meaning', prompt: '耳', meanings: ['ear'] };
    const r = checkAnswer(ctx, makeTransformers(), 'e a r');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('ear');
  });
});

// ── Fuzzy meaning matching (WaniKani parity) ─────────────────────────────────

describe('fuzzy meaning matching', () => {
  test('is off by default — a near-miss does not submit', () => {
    const ctx = { type: 'meaning', meanings: ['coldhearted'] };
    const r = checkAnswer(ctx, makeTransformers(), 'coldhearte');
    expect(r.success).toBe(false);
  });

  test('accepts a near-miss within tolerance when enabled, and submits the canonical meaning', () => {
    const ctx = { type: 'meaning', meanings: ['coldhearted'] };
    const r = checkAnswer(ctx, makeTransformers(), 'coldhearte', { fuzzyMeaning: true });
    expect(r.success).toBe(true);
    expect(r.answer).toBe('coldhearted');
  });

  test('rejects a candidate beyond tolerance even when enabled', () => {
    const ctx = { type: 'meaning', meanings: ['coldhearted'] };
    const r = checkAnswer(ctx, makeTransformers(), 'warmhearted', { fuzzyMeaning: true });
    expect(r.success).toBe(false);
  });

  // Boundary: 3 chars → 0 tolerance (exact only), 4-5 → 1, 6-8 → 2, 9+ → 3.
  test('boundary: 3-char meaning requires an exact match (0 tolerance)', () => {
    const ctx = { type: 'meaning', meanings: ['dog'] };
    expect(checkAnswer(ctx, makeTransformers(), 'dog', { fuzzyMeaning: true }).success).toBe(true);
    expect(checkAnswer(ctx, makeTransformers(), 'dob', { fuzzyMeaning: true }).success).toBe(false);
  });

  test('boundary: 4-char meaning tolerates 1 edit, not 2', () => {
    const ctx = { type: 'meaning', meanings: ['frog'] };
    expect(checkAnswer(ctx, makeTransformers(), 'frag', { fuzzyMeaning: true }).success).toBe(true);
    expect(checkAnswer(ctx, makeTransformers(), 'frab', { fuzzyMeaning: true }).success).toBe(false);
  });

  test('boundary: 5-char meaning tolerates 1 edit, not 2', () => {
    const ctx = { type: 'meaning', meanings: ['horse'] };
    expect(checkAnswer(ctx, makeTransformers(), 'horve', { fuzzyMeaning: true }).success).toBe(true);
    expect(checkAnswer(ctx, makeTransformers(), 'horvz', { fuzzyMeaning: true }).success).toBe(false);
  });

  test('boundary: 6-char meaning tolerates 2 edits, not 3', () => {
    const ctx = { type: 'meaning', meanings: ['rabbit'] };
    expect(checkAnswer(ctx, makeTransformers(), 'rabbiz', { fuzzyMeaning: true }).success).toBe(true);
    expect(checkAnswer(ctx, makeTransformers(), 'rzzziz', { fuzzyMeaning: true }).success).toBe(false);
  });

  test('boundary: 8-char meaning tolerates 2 edits, not 3', () => {
    const ctx = { type: 'meaning', meanings: ['elephant'] };
    expect(checkAnswer(ctx, makeTransformers(), 'elephont', { fuzzyMeaning: true }).success).toBe(true);
    expect(checkAnswer(ctx, makeTransformers(), 'ezzphont', { fuzzyMeaning: true }).success).toBe(false);
  });

  test('boundary: 9-char meaning tolerates 3 edits, not 4', () => {
    const ctx = { type: 'meaning', meanings: ['blackbird'] };
    expect(checkAnswer(ctx, makeTransformers(), 'blzckbard', { fuzzyMeaning: true }).success).toBe(true);
    expect(checkAnswer(ctx, makeTransformers(), 'blzzkzzrd', { fuzzyMeaning: true }).success).toBe(false);
  });

  test('applies to name questions (radicals) as well as meanings', () => {
    const ctx = { type: 'name', meanings: ['ground'] };
    const r = checkAnswer(ctx, makeTransformers(), 'grond', { fuzzyMeaning: true });
    expect(r.success).toBe(true);
    expect(r.answer).toBe('ground');
  });

  test('never applies to reading questions, even when enabled', () => {
    const ctx = { type: 'reading', prompt: '仙台', readings: ['せんだい'] };
    const r = checkAnswer(ctx, makeTransformers(), 'せんだig', { fuzzyMeaning: true });
    expect(r.success).toBe(false);
  });

  test('picks the closest meaning when multiple are within tolerance', () => {
    const ctx = { type: 'meaning', meanings: ['horse', 'house'] };
    const r = checkAnswer(ctx, makeTransformers(), 'horse', { fuzzyMeaning: true });
    expect(r.success).toBe(true);
    expect(r.answer).toBe('horse');
  });
});

// ── Reading questions ─────────────────────────────────────────────────────────

describe('reading questions', () => {
  const ctx = { type: 'reading', prompt: '仙台', category: 'vocabulary', readings: ['せんだい'] };

  test('returns hiragana when input is already hiragana', () => {
    const r = checkAnswer(ctx, makeTransformers(dictionary), 'せんだい');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('せんだい');
  });

  test('converts katakana input to hiragana', () => {
    const r = checkAnswer(ctx, makeTransformers(dictionary), 'センダイ');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('せんだい');
  });

  // Bug reproduction: SR returns kanji (何月) for a compound JMdict doesn't
  // list, so no whole-word lookup can produce the kana reading.
  test('REGRESSION: converts kanji compounds missing from JMdict (何月 → なんがつ)', () => {
    const dict = {
      '何': [
        { id: '1577100', type: 'word', kanji: ['何'], kana: ['なに', 'ナニ'] },
        { literal: '何', type: 'character', readings: [
          { type: 'on', value: 'カ' }, { type: 'kun', value: 'なに' }, { type: 'kun', value: 'なん-' },
        ] },
      ],
      '月': [
        { literal: '月', type: 'character', readings: [
          { type: 'on', value: 'ゲツ' }, { type: 'on', value: 'ガツ' }, { type: 'kun', value: 'つき' },
        ] },
      ],
    };
    const transformers = [...makeTransformers(dict), new CompoundDictionary(dict)];
    const ctx = { type: 'reading', prompt: '何月', category: 'vocabulary', readings: ['なんがつ'] };
    const r = checkAnswer(ctx, transformers, '何月');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('なんがつ');
  });

  // Bug reproduction: speech recognition returns the digit form of
  // day-of-month counters (6日), which have irregular readings (むいか, not
  // ろくにち) only derivable via a whole-word dictionary lookup on the
  // kansuji-converted kanji form.
  test('REGRESSION: converts a digit-form day counter to its irregular reading (6日 → むいか)', () => {
    const dict = { '六日': [{ id: '1', type: 'word', kanji: ['六日'], kana: ['むいか'] }] };
    const transformers = [...makeTransformers(dict), new Numerals(dict)];
    const ctx = { type: 'reading', prompt: '6日', category: 'vocabulary', readings: ['むいか'] };
    const r = checkAnswer(ctx, transformers, '6日');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('むいか');
  });

  // Bug reproduction: wanakana's toHiragana expands a katakana chōonpu into a
  // doubled vowel (ビール → びいる), but WaniKani's accepted reading keeps
  // the ー (びーる), so the candidate could never match.
  test('REGRESSION: keeps the chōonpu when comparing katakana readings (ビール → びーる)', () => {
    const ctx = { type: 'reading', prompt: 'ビール', category: 'vocabulary', readings: ['びーる'] };
    const r = checkAnswer(ctx, makeTransformers(), 'ビール');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('びーる');
  });

  test('REGRESSION: chōonpu preserved through a kanji+katakana split (生ビール → なまびーる)', () => {
    const dict = {
      '生': [
        { literal: '生', type: 'character', readings: [
          { type: 'on', value: 'セイ' }, { type: 'kun', value: 'なま' },
        ] },
      ],
    };
    const transformers = [...makeTransformers(dict), new SplitDictionary(dict)];
    const ctx = { type: 'reading', prompt: '生ビール', category: 'vocabulary', readings: ['なまびーる'] };
    const r = checkAnswer(ctx, transformers, '生ビール');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('なまびーる');
  });

  // Bug reproduction: ateji/jukujikun readings (台詞 → せりふ) have no
  // relationship to the individual kanji readings, so no dictionary
  // combination can derive them — they live in the hardcoded homonym table.
  test('REGRESSION: resolves ateji from the homonym table (台詞 → せりふ)', () => {
    const r = checkAnswer({ type: 'reading', prompt: '台詞', readings: ['せりふ'] }, makeTransformers(), '台詞');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('せりふ');
  });

  test('REGRESSION: resolves ateji with a chōonpu reading (烏龍茶 → うーろんちゃ)', () => {
    const r = checkAnswer({ type: 'reading', prompt: '烏龍茶', readings: ['うーろんちゃ'] }, makeTransformers(), '烏龍茶');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('うーろんちゃ');
  });

  test('uses homonym table for mishearings ("b" → "び")', () => {
    const r = checkAnswer({ type: 'reading', prompt: '美', readings: ['び'] }, makeTransformers(), 'b');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('び');
  });

  // Bug reproduction: SR misheard 自立 (じりつ) as the real word 事実 (じじつ)
  // — a one-mora phonetic slip that resolves to a different valid word, so
  // no dictionary lookup or transformer could recover it on its own.
  test('REGRESSION: uses homonym table for "事実" misheard for 自立 (じりつ)', () => {
    const r = checkAnswer({ type: 'reading', prompt: '自立', readings: ['じりつ'] }, makeTransformers(), '事実');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('じりつ');
  });

  test('uses homonym table for short "ta" reading', () => {
    const r = checkAnswer({ type: 'reading', prompt: '田', readings: ['た'] }, makeTransformers(), 'ta');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('た');
  });

  test('uses homonym table for "ta" heard as English-ish variants', () => {
    const ctx = { type: 'reading', prompt: '田', readings: ['た'] };
    expect(checkAnswer(ctx, makeTransformers(), 'tar').answer).toBe('た');
    expect(checkAnswer(ctx, makeTransformers(), 'tah').answer).toBe('た');
  });

  test('uses numeric speech correction for "go" heard as 5', () => {
    const r = checkAnswer({ type: 'reading', prompt: '五', readings: ['ご'] }, makeTransformers(), '5');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('ご');
  });

  test('uses numeric speech correction for "kuu" heard as 9', () => {
    const r = checkAnswer({ type: 'reading', prompt: '空', readings: ['くう'] }, makeTransformers(), '9');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('くう');
  });

  test('keeps numeric speech correction for "kyuu" heard as 9', () => {
    const r = checkAnswer({ type: 'reading', prompt: '九', readings: ['きゅう'] }, makeTransformers(), '9');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('きゅう');
  });

  test('does not submit when kana does not match any accepted reading', () => {
    const r = checkAnswer(ctx, makeTransformers(), 'とうきょう');
    expect(r.success).toBe(false);
  });

  test('does not submit when readings list is empty (subjects not yet loaded)', () => {
    const r = checkAnswer({ type: 'reading', readings: [] }, makeTransformers(), 'せんだい');
    expect(r.success).toBe(false);
  });

  test('falls back to best-effort conversion for unrecognised input', () => {
    const r = checkAnswer(ctx, makeTransformers(), 'tokyo');
    expect(r.success).toBe(false);
  });
});

// ── Custom corrections ────────────────────────────────────────────────────────

describe('custom corrections', () => {
  test('reading: maps a heard string to the intended kana', () => {
    const ctx = { type: 'reading', prompt: '肘', readings: ['ひじ'] };
    const corrections = [{ heard: 'PG', intended: 'ひじ' }];
    const r = checkAnswer(ctx, makeTransformers(), 'PG', { corrections });
    expect(r.success).toBe(true);
    expect(r.answer).toBe('ひじ');
  });

  test('reading: a heard string can map to multiple intended readings', () => {
    const corrections = [
      { heard: 'q', intended: 'きゅう' },
      { heard: 'q', intended: 'く' },
    ];
    const kyuu = checkAnswer({ type: 'reading', prompt: '九', readings: ['きゅう'] }, makeTransformers(), 'q', { corrections });
    expect(kyuu.answer).toBe('きゅう');
    const ku = checkAnswer({ type: 'reading', prompt: '九', readings: ['く'] }, makeTransformers(), 'q', { corrections });
    expect(ku.answer).toBe('く');
  });

  test('reading: converts a romaji intended value to kana ("shiri" → しり)', () => {
    const ctx = { type: 'reading', prompt: '尻', readings: ['しり'] };
    const corrections = [{ heard: 'celery', intended: 'shiri' }];
    const r = checkAnswer(ctx, makeTransformers(), 'celery', { corrections });
    expect(r.success).toBe(true);
    expect(r.answer).toBe('しり');
  });

  test('reading: user entry takes precedence over the built-in homonym table', () => {
    // Built-in table maps 'ec2' → いしつ; both readings are accepted here,
    // so the submitted answer shows which table won.
    const ctx = { type: 'reading', prompt: '遺失', readings: ['いしつ', 'いじつ'] };
    const corrections = [{ heard: 'ec2', intended: 'いじつ' }];
    const r = checkAnswer(ctx, makeTransformers(), 'ec2', { corrections });
    expect(r.success).toBe(true);
    expect(r.answer).toBe('いじつ');
  });

  test('reading: falls back to the built-in table when the user entry does not match', () => {
    const ctx = { type: 'reading', prompt: '遺失', readings: ['いしつ'] };
    const corrections = [{ heard: 'ec2', intended: 'まったくちがう' }];
    const r = checkAnswer(ctx, makeTransformers(), 'ec2', { corrections });
    expect(r.success).toBe(true);
    expect(r.answer).toBe('いしつ');
  });

  test('meaning: maps a heard phrase to the intended meaning', () => {
    const ctx = { type: 'meaning', prompt: '胸郭', meanings: ['ribcage'] };
    const corrections = [{ heard: 'web cage', intended: 'ribcage' }];
    const r = checkAnswer(ctx, makeTransformers(), 'web cage', { corrections });
    expect(r.success).toBe(true);
    expect(r.answer).toBe('ribcage');
  });

  test('meaning: user entry takes precedence over the built-in table', () => {
    // Built-in table maps 'rib cage' → ribcage; both meanings are accepted
    // here, so the submitted answer shows which table won.
    const ctx = { type: 'meaning', meanings: ['ribcage', 'cage'] };
    const corrections = [{ heard: 'rib cage', intended: 'cage' }];
    const r = checkAnswer(ctx, makeTransformers(), 'rib cage', { corrections });
    expect(r.success).toBe(true);
    expect(r.answer).toBe('cage');
  });

  test('name: applies to radical name questions', () => {
    const ctx = { type: 'name', prompt: '一', category: 'radical', meanings: ['ground'] };
    const corrections = [{ heard: 'grounded', intended: 'ground' }];
    const r = checkAnswer(ctx, makeTransformers(), 'grounded', { corrections });
    expect(r.success).toBe(true);
    expect(r.answer).toBe('ground');
  });

  test('matching is case-insensitive on the heard side', () => {
    const ctx = { type: 'meaning', meanings: ['ribcage'] };
    const corrections = [{ heard: 'Web Cage', intended: 'ribcage' }];
    const r = checkAnswer(ctx, makeTransformers(), 'WEB CAGE', { corrections });
    expect(r.success).toBe(true);
  });

  test('blank or malformed entries are skipped without breaking matching', () => {
    const ctx = { type: 'meaning', meanings: ['ribcage'] };
    const corrections = [null, {}, { heard: '', intended: 'x' }, { heard: 'y' }, { heard: 'web cage', intended: 'ribcage' }];
    const r = checkAnswer(ctx, makeTransformers(), 'web cage', { corrections });
    expect(r.success).toBe(true);
    expect(r.answer).toBe('ribcage');
  });

  test('reading: reports wrong-type when a custom correction matches the meaning instead', () => {
    const ctx = { type: 'reading', prompt: '胸郭', readings: ['きょうかく'], meanings: ['ribcage'] };
    const corrections = [{ heard: 'web cage', intended: 'ribcage' }];
    const r = checkAnswer(ctx, makeTransformers(), 'web cage', { corrections });
    expect(r.success).toBe(false);
    expect(r.transcript.reason).toBe('wrong-type');
  });

  test('meaning: reports wrong-type when a custom correction matches the reading instead', () => {
    const ctx = { type: 'meaning', prompt: '肘', readings: ['ひじ'], meanings: ['elbow'] };
    const corrections = [{ heard: 'PG', intended: 'ひじ' }];
    const r = checkAnswer(ctx, makeTransformers(), 'PG', { corrections });
    expect(r.success).toBe(false);
    expect(r.transcript.reason).toBe('wrong-type');
  });
});

// ── Failure reasons ───────────────────────────────────────────────────────────

describe('failure reasons', () => {
  test('reading: reports not-loaded when both answer sets are empty', () => {
    const ctx = { type: 'reading', readings: [], meanings: [] };
    const r = checkAnswer(ctx, makeTransformers(), 'せんだい');
    expect(r.success).toBe(false);
    expect(r.transcript.reason).toBe('not-loaded');
  });

  test('meaning: reports not-loaded when both answer sets are empty', () => {
    const ctx = { type: 'meaning', readings: [], meanings: [] };
    const r = checkAnswer(ctx, makeTransformers(), 'wheat');
    expect(r.success).toBe(false);
    expect(r.transcript.reason).toBe('not-loaded');
  });

  test('reading: reports no-match when nothing matches and answers are loaded', () => {
    const ctx = { type: 'reading', readings: ['せんだい'], meanings: ['sendai'] };
    const r = checkAnswer(ctx, makeTransformers(), 'とうきょう');
    expect(r.success).toBe(false);
    expect(r.transcript.reason).toBe('no-match');
  });

  test('meaning: reports no-match when nothing matches and answers are loaded', () => {
    const ctx = { type: 'meaning', readings: ['せんだい'], meanings: ['sendai'] };
    const r = checkAnswer(ctx, makeTransformers(), 'osaka');
    expect(r.success).toBe(false);
    expect(r.transcript.reason).toBe('no-match');
  });

  test('reading: reports wrong-type when the candidate matches the meaning instead', () => {
    const ctx = { type: 'reading', prompt: '寒い', readings: ['さむい'], meanings: ['cold hearted'] };
    const r = checkAnswer(ctx, makeTransformers(), 'Cold Hearted');
    expect(r.success).toBe(false);
    expect(r.transcript.reason).toBe('wrong-type');
    expect(r.transcript.type).toBe('reading');
  });

  test('meaning: reports wrong-type when the candidate matches the reading instead', () => {
    const ctx = { type: 'meaning', prompt: '寒い', readings: ['さむい'], meanings: ['cold'] };
    const r = checkAnswer(ctx, makeTransformers(), 'さむい');
    expect(r.success).toBe(false);
    expect(r.transcript.reason).toBe('wrong-type');
    expect(r.transcript.type).toBe('meaning');
  });

  test('name: reports wrong-type when the candidate matches the reading instead', () => {
    const ctx = { type: 'name', prompt: '一', readings: ['いち'], meanings: ['ground'] };
    const r = checkAnswer(ctx, makeTransformers(), 'いち');
    expect(r.success).toBe(false);
    expect(r.transcript.reason).toBe('wrong-type');
  });
});

// ── Name questions ────────────────────────────────────────────────────────────

describe('name questions (radicals)', () => {
  const ctx = { type: 'name', prompt: '一', category: 'radical', meanings: ['Ground'] };

  test('returns normalised English for name type', () => {
    const r = checkAnswer(ctx, makeTransformers(), 'Ground');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('ground');
  });
});

// ── Unknown type ──────────────────────────────────────────────────────────────

describe('unknown question type', () => {
  test('returns error result', () => {
    const r = checkAnswer({ type: 'unknown' }, makeTransformers(), 'test');
    expect(r.success).toBe(false);
    expect(r.error).toBe(true);
  });
});

// ── Full transformer pipeline ─────────────────────────────────────────────────

describe('full transformer pipeline', () => {
  const transformers = [
    new ToHiragana(),
    new ConvertWo(),
    new FuzzyVowels(),
    new BasicDictionary(dictionary),
  ];

  test('katakana speech input converts to hiragana via ToHiragana', () => {
    const ctx = { type: 'reading', prompt: '仙台', category: 'vocabulary', readings: ['せんだい'] };
    const r = checkAnswer(ctx, transformers, 'センダイ');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('せんだい');
  });
});
