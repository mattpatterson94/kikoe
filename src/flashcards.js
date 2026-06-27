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
  '性感': 'せいかん'
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
export function checkAnswer(context, transformers, raw) {
  const { type } = context;
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
        const answer = toHiragana(c.data);
        if (matchesReading(answer)) {
          return {
            success: true,
            answer,
            transcript: { raw, matched: answer !== raw ? answer : undefined },
          };
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
    const fallback = toHiragana(raw);
    if (isKana(fallback) && matchesReading(fallback)) {
      return { success: true, answer: fallback, transcript: { raw } };
    }
    return { success: false, error: false, transcript: { raw: '!! speak the reading !!' } };
  }

  if (type === 'meaning' || type === 'name') {
    const normalizedMeanings = (context.meanings || []).map(normalize);

    function matchesMeaning(norm) {
      if (normalizedMeanings.length === 0) return false;
      if (normalizedMeanings.includes(norm)) return true;
      // Compound words: "rib cage" → "ribcage"
      const compact = norm.replaceAll(' ', '');
      if (normalizedMeanings.includes(compact)) return true;
      return false;
    }

    for (const c of candidates) {
      // Apply English SR corrections before normalizing.
      const corrected = meaningCorrections[c.data.toLowerCase()] ?? c.data;
      const norm = normalize(corrected);
      if (matchesMeaning(norm)) {
        return {
          success: true,
          answer: norm,
          transcript: { raw, matched: norm !== raw ? norm : undefined },
        };
      }
    }
    // No candidate matched — don't submit.
    return { success: false, error: false, transcript: { raw } };
  }

  return {
    success: false,
    error: true,
    message: 'unknown question type',
    transcript: { raw: '!! unknown type !!' },
  };
}
