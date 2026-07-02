import { toHiragana, isJapanese, isKana } from 'wanakana';

// Speech recognition frequently mishears Japanese phonemes as Latin letters or
// English words. Map known mishearings to their hiragana equivalents.
const homonyms = {
  'b': 'び',
  'ezone': 'いぞん',
  'gt': 'じき',
  'g': 'じ',
  'ec2': 'いしつ',
  'ec 2': 'いしつ',
  'ec': 'いし',
  'agar': 'あがる',
  'ol': 'おえる',
  'ob': 'おび',
  'k': 'けい',
  'c': 'し',
  'cd': 'しり',
  'ck': 'しけい',
  'ta': 'た',
  'tar': 'た',
  'tah': 'た',
  'y': 'わい',
  'uber': 'うば',
  'hulu': 'ふる',
  'canyou': 'かんゆう',
  'LINE': 'らい',

  '2': 'つ',
  '3': 'さん',
  '5': 'ご',
  '9': ['きゅう', 'く', 'くう'],
  '10': 'じゅ',
  'x': 'じゅ',
  '1000': 'せん',

  'ワーく': 'わく',
  '西国': 'さいこく',
  '帰って': 'かえって',
  'を呼ぶ': 'およぶ',
  '掌蹠': 'しょうせき',
  '件名': 'けんめい',
  '加藤': 'かとう',
  '貨物線': 'かもつせん',
  '短足': 'たんそく',
  '5回': 'ごかい',
  'けえき': 'けいき',
  '覗いて': 'のぞいて',
  '廃病': 'はいびょう',
  '正観': 'せいかん',
  '借りに': 'かりに',
  '全開': 'ぜんかい',
  '九大': 'きゅうだい',
  '最速': 'さいそく',
  '龍騎': 'りゅうき',
  '流星': 'りゅうせい',
  '京丹': 'きょうたん',
  '広陵': 'こうりょう',
  '招かれる': 'まねかれる',
  '県境': 'けんきょう',
  '胆汁': 'たんじゅう',
  '県名': 'けんめい',
  '長江': 'ちょうこう',
  '性感': 'せいかん',
  '事実': 'じりつ', // 自立 (じりつ) misheard as 事実 (じじつ) — single mora swap

  // Ateji/jukujikun whose reading has no derivable relationship to the
  // individual kanji readings, and which the bundled JMdict can't resolve.
  '台詞': 'せりふ',
  '河豚': 'ふぐ',
  '漢': 'おとこ',
  '銀杏': 'いちょう',
  '烏龍茶': 'うーろんちゃ',
};

// Common English SR mishearings mapped to the correct WaniKani meaning.
// Add entries here as you encounter new ones.
const meaningCorrections = {
  'rib cage': 'ribcage',
};

// Normalise for submission: strip leading articles and trailing punctuation.
// For Japanese: collapse spaces and convert to hiragana.
// For English: keep spaces so multi-word meanings are preserved.
export function normalize(s) {
  const stripped = s.toLowerCase()
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/[.,!?;:]+$/, '');
  if (isJapanese(stripped)) {
    return toHiragana(stripped.replaceAll(' ', ''));
  }
  return stripped.trim();
}

// Standard edit-distance DP. Used to mirror WaniKani's own fuzzy meaning
// matching (see fuzzyThreshold) so a near-miss answer WaniKani would accept
// isn't rejected locally before it ever reaches the server-side check.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const currRow = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow.push(Math.min(
        prevRow[j] + 1,      // deletion
        currRow[j - 1] + 1,  // insertion
        prevRow[j - 1] + cost, // substitution
      ));
    }
    prevRow = currRow;
  }
  return prevRow[n];
}

// WaniKani's documented fuzzy-matching tolerance, scaled by answer length
// (used by userscripts like Double-Check). Verify against current WK
// behavior before changing.
function fuzzyThreshold(length) {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  if (length <= 8) return 2;
  return 3;
}

// Returns the closest accepted meaning within WaniKani's edit-distance
// tolerance for its length, or null if none qualifies.
function closestFuzzyMatch(candidate, meanings) {
  let best = null;
  let bestDistance = Infinity;
  for (const meaning of meanings) {
    const distance = levenshtein(candidate, meaning);
    if (distance <= fuzzyThreshold(meaning.length) && distance < bestDistance) {
      best = meaning;
      bestDistance = distance;
    }
  }
  return best;
}

// toHiragana expands a katakana chōonpu into a doubled vowel by default
// (ビール → びいる), but WaniKani's accepted readings keep the ー
// (びーる) — compare both forms. Shared by the reading matcher and the
// wrong-type check below.
function kanaForms(kana) {
  return new Set([
    toHiragana(kana, { convertLongVowelMark: false }),
    toHiragana(kana),
  ]);
}

// Whether any candidate resolves to one of the accepted readings — used to
// detect a meaning-question answer that was actually the reading (or vice
// versa), so the failure can be reported as "wrong type" instead of a bare
// non-match.
function matchesAnyReading(candidates, acceptedReadings) {
  if (!acceptedReadings.length) return false;
  for (const c of candidates) {
    if (isKana(c.data)) {
      for (const answer of kanaForms(c.data)) {
        if (acceptedReadings.includes(answer)) return true;
      }
    }
    const h = homonyms[c.data.toLowerCase()];
    const hReadings = Array.isArray(h) ? h : (h ? [h] : []);
    if (hReadings.some(r => acceptedReadings.includes(r))) return true;
  }
  return false;
}

// Whether any candidate resolves to one of the accepted meanings — the
// meaning-side counterpart of matchesAnyReading, used for the same wrong-type
// detection on reading questions.
function matchesAnyMeaning(candidates, normalizedMeanings) {
  if (!normalizedMeanings.length) return false;
  for (const c of candidates) {
    const corrected = meaningCorrections[c.data.toLowerCase()] ?? c.data;
    const norm = normalize(corrected);
    if (normalizedMeanings.includes(norm)) return true;
    if (normalizedMeanings.includes(norm.replaceAll(' ', ''))) return true;
  }
  return false;
}

// Classifies why a failed match happened, so the UI can show something more
// useful than a bare rejection:
// - 'not-loaded': subjects haven't arrived yet (both answer sets are empty).
// - 'wrong-type': the candidate matches the *other* answer set (e.g. spoke
//   the meaning on a reading question) — the most actionable case.
// - 'no-match': heard something, but nothing matched either answer set.
function failureReason(candidates, context) {
  const readings = context.readings || [];
  const meanings = context.meanings || [];
  if (readings.length === 0 && meanings.length === 0) return 'not-loaded';
  if (context.type === 'reading' && matchesAnyMeaning(candidates, meanings.map(normalize))) {
    return 'wrong-type';
  }
  if ((context.type === 'meaning' || context.type === 'name') && matchesAnyReading(candidates, readings)) {
    return 'wrong-type';
  }
  return 'no-match';
}

function groupBy(xs, k) {
  return xs.reduce(function(rv, x) {
    (rv[x[k]] = rv[x[k]] || []).push(x);
    return rv;
  }, {});
}

function generateCandidates(transformers, raw) {
  let candidates = [{ type: 'raw', data: raw }];
  const byOrder = groupBy(transformers, 'order');
  const keys = Object.keys(byOrder).map(k => parseInt(k)).sort();
  for (const key of keys) {
    const ts = byOrder[key];
    const newCandidates = [];
    for (const t of ts) {
      for (const c of candidates) {
        newCandidates.push(...t.getCandidates(c.data));
      }
    }
    candidates.push(...newCandidates);
  }
  return candidates;
}

// Prepare the best answer to submit to WaniKani for server-side validation.
// For reading questions: find the first Japanese candidate (converted to
// hiragana). The homonym table handles common speech-recognition mishearings
// (e.g. "b" → "び"). For meaning/name questions: submit normalised English.
export function checkAnswer(context, transformers, raw, opts = {}) {
  const { type } = context;
  const { fuzzyMeaning = false } = opts;
  const candidates = generateCandidates(transformers, raw);

  if (type === 'reading') {
    const acceptedReadings = (context.readings || []);

    function matchesReading(kana) {
      if (acceptedReadings.length === 0) return false;
      return acceptedReadings.includes(kana);
    }

    for (const c of candidates) {
      // isKana is strict: only pure hiragana/katakana passes.
      // isJapanese would also match kanji, but toHiragana can't convert kanji
      // to kana — submitting kanji would always be rejected by WaniKani.
      if (isKana(c.data)) {
        for (const answer of kanaForms(c.data)) {
          if (matchesReading(answer)) {
            return {
              success: true,
              answer,
              transcript: { raw, matched: answer !== raw ? answer : undefined },
            };
          }
        }
      }
      const h = homonyms[c.data.toLowerCase()];
      const readings = Array.isArray(h) ? h : [h];
      const matched = readings.find(matchesReading);
      if (matched) {
        return { success: true, answer: matched, transcript: { raw, matched } };
      }
    }
    // Fallback: try converting raw (works for romaji like "shita" → "した").
    for (const fallback of kanaForms(raw)) {
      if (isKana(fallback) && matchesReading(fallback)) {
        return { success: true, answer: fallback, transcript: { raw } };
      }
    }
    return {
      success: false,
      error: false,
      transcript: { raw, reason: failureReason(candidates, context), type: 'reading' },
    };
  }

  if (type === 'meaning' || type === 'name') {
    const normalizedMeanings = (context.meanings || []).map(normalize);

    // Returns the string that should actually be submitted, or null if
    // nothing matches. Compound words ("rib cage") and spelled-out letters
    // ("e a r") both match only after removing spaces — submit that
    // space-free form, not the spaced candidate, or WaniKani rejects it.
    // Exact match is always tried first; fuzzy matching (when enabled) only
    // kicks in as a fallback, and submits the canonical accepted meaning
    // rather than the misheard candidate — the server-side check is what
    // actually grades, so submitting anything else it might reject is unsafe.
    function matchingAnswer(norm) {
      if (normalizedMeanings.length === 0) return null;
      if (normalizedMeanings.includes(norm)) return norm;
      const compact = norm.replaceAll(' ', '');
      if (normalizedMeanings.includes(compact)) return compact;
      if (fuzzyMeaning) {
        const fuzzy = closestFuzzyMatch(norm, normalizedMeanings) ?? closestFuzzyMatch(compact, normalizedMeanings);
        if (fuzzy) return fuzzy;
      }
      return null;
    }

    for (const c of candidates) {
      // Apply English SR corrections before normalizing.
      const corrected = meaningCorrections[c.data.toLowerCase()] ?? c.data;
      const norm = normalize(corrected);
      const answer = matchingAnswer(norm);
      if (answer !== null) {
        return {
          success: true,
          answer,
          transcript: { raw, matched: answer !== raw ? answer : undefined },
        };
      }
    }
    // No candidate matched — don't submit.
    return {
      success: false,
      error: false,
      transcript: { raw, reason: failureReason(candidates, context), type },
    };
  }

  return {
    success: false,
    error: true,
    message: 'unknown question type',
    transcript: { raw: '!! unknown type !!' },
  };
}
