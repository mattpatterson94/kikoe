import { checkAnswer, normalize } from '../src/flashcards.js';
import { ToHiragana } from '../src/candidates/to_hiragana.js';
import { BasicDictionary } from '../src/candidates/basic_dictionary.js';
import { FuzzyVowels } from '../src/candidates/fuzzy_vowels.js';
import { ConvertWo } from '../src/candidates/convert_wo.js';
import { CompoundDictionary } from '../src/candidates/compound_dictionary.js';
import { Numerals } from '../src/candidates/numerals.js';

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

  test('uses homonym table for mishearings ("b" → "び")', () => {
    const r = checkAnswer({ type: 'reading', prompt: '美', readings: ['び'] }, makeTransformers(), 'b');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('び');
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
