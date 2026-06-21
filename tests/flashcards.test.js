import { checkAnswer } from '../src/flashcards.js';
import { ToHiragana } from '../src/candidates/to_hiragana.js';
import { BasicDictionary } from '../src/candidates/basic_dictionary.js';
import { FuzzyVowels } from '../src/candidates/fuzzy_vowels.js';
import { ConvertWo } from '../src/candidates/convert_wo.js';

// Minimal dictionary extracted from jmdict.
const dictionary = {
  'せんだい': [
    { id: '1388080', type: 'word', kanji: ['先代'], kana: ['せんだい'] },
    { id: '2164680', type: 'word', kanji: ['仙台', '仙臺'], kana: ['せんだい'] },
  ],
};

function makeTransformers(dict = {}) {
  return [new ToHiragana(), new BasicDictionary(dict)];
}

// ── Meaning matching ──────────────────────────────────────────────────────────

describe('meaning matching', () => {
  const ctx = {
    meanings: ['Cold Hearted'],
    readings: ['はくじょう'],
    prompt: '薄情',
    category: 'vocabulary',
    type: 'meaning',
    items: [],
  };

  test('exact meaning match', () => {
    const r = checkAnswer(ctx, makeTransformers(), 'Cold Hearted');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('Cold Hearted');
  });

  test('case-insensitive meaning match', () => {
    const r = checkAnswer(ctx, makeTransformers(), 'cold hearted');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('Cold Hearted');
  });

  test('levenshtein distance tolerates hyphen from speech recognition', () => {
    // upstream regression: 'cold-hearted' → 1 edit distance from 'cold hearted'
    const r = checkAnswer(ctx, makeTransformers(), 'cold-hearted');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('Cold Hearted');
  });

  test('wrong meaning fails', () => {
    const r = checkAnswer(ctx, makeTransformers(), 'warm hearted');
    expect(r.success).toBe(false);
    expect(r.error).toBe(false);
  });

  // Upstream regression: should return the *meaning* match, not the reading.
  test('romaji that matches a meaning (not reading) returns the meaning', () => {
    const meaningCtx = {
      meanings: ['sendai'],
      readings: ['せんだい'],
      prompt: '仙台',
      category: 'vocabulary',
      type: 'meaning',
      items: [],
    };
    const r = checkAnswer(meaningCtx, makeTransformers(dictionary), 'sendai');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('sendai');
  });
});

// ── Reading matching ──────────────────────────────────────────────────────────

describe('reading matching', () => {
  const ctx = {
    meanings: ['Sendai'],
    readings: ['せんだい'],
    prompt: '仙台',
    category: 'vocabulary',
    type: 'reading',
    items: [],
  };

  test('exact hiragana reading match', () => {
    const r = checkAnswer(ctx, makeTransformers(dictionary), 'せんだい');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('せんだい');
  });

  test('katakana input converts to hiragana and matches reading', () => {
    const r = checkAnswer(ctx, makeTransformers(dictionary), 'センダイ');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('せんだい');
  });

  test('wrong reading fails', () => {
    const r = checkAnswer(ctx, makeTransformers(dictionary), 'とうきょう');
    expect(r.success).toBe(false);
  });

  test('meaning answer does not succeed when type is reading', () => {
    const r = checkAnswer(ctx, makeTransformers(dictionary), 'Sendai');
    expect(r.success).toBe(false);
  });
});

// ── Literal prompt matching (kana vocabulary) ─────────────────────────────────

describe('literal prompt matching', () => {
  test('spoken kana matches prompt directly when readings exist', () => {
    const ctx = {
      meanings: ['Beautiful'],
      readings: ['きれい'],
      prompt: 'きれい',
      category: 'kana_vocabulary',
      type: 'reading',
      items: [],
    };
    const r = checkAnswer(ctx, makeTransformers(), 'きれい');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('きれい');
  });
});

// ── Homonym handling ──────────────────────────────────────────────────────────

describe('homonym handling', () => {
  test('"b" maps to び via the homonym table', () => {
    const ctx = {
      meanings: [],
      readings: ['び'],
      prompt: '美',
      category: 'kanji',
      type: 'reading',
      items: [],
    };
    const r = checkAnswer(ctx, makeTransformers(), 'b');
    expect(r.success).toBe(true);
    expect(r.answer).toBe('び');
  });
});

// ── Full pipeline ─────────────────────────────────────────────────────────────

describe('full transformer pipeline', () => {
  const transformers = [
    new ToHiragana(),
    new ConvertWo(),
    new FuzzyVowels(),
    new BasicDictionary(dictionary),
  ];

  test('katakana speech input matches hiragana reading via ToHiragana', () => {
    const ctx = {
      meanings: [],
      readings: ['せんだい'],
      prompt: '仙台',
      category: 'vocabulary',
      type: 'reading',
      items: [],
    };
    expect(checkAnswer(ctx, transformers, 'センダイ').success).toBe(true);
  });
});

// ── Empty context ─────────────────────────────────────────────────────────────

describe('empty context (no subjects loaded)', () => {
  test('no readings or meanings → always incorrect', () => {
    const ctx = {
      meanings: [],
      readings: [],
      prompt: '下',
      category: 'kanji',
      type: 'reading',
      items: [],
    };
    const r = checkAnswer(ctx, makeTransformers(), 'した');
    expect(r.success).toBe(false);
    expect(r.error).toBe(false);
  });
});
