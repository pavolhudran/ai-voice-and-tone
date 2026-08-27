/**
 * Does this extraction deserve to be trusted?
 *
 * The tier boundary in the ingest ladder is NOT the file format - it is this
 * gate. A script parser attempts every source; whatever it returns is scored
 * here, and only a genuine failure escalates to the model. Whatever the model
 * returns is scored here too.
 *
 * Thresholds are calibrated, not chosen: they come from eight real extractions
 * of four PDFs, a prototype parser measured against pdftotext as ground truth.
 * Spec section 7.3 records the numbers. Do not adjust them without new
 * measurements.
 *
 *   signal          sound            broken           threshold
 *   long20Share     0.0034 - 0.0051  0.0284 - 0.0357  > 0.015 fails
 *   singleShare     0.000  - 0.006   0.191            > 0.10  fails
 *   meanTokenLen    5.46   - 6.12    3.47 / 7.19-7.62 advisory only
 *
 * What it catches: gross failure, in both directions. long20Share catches
 * merged words ("Onlineexerciseandtherapylessons"), singleShare catches split
 * words ("I V A S TIH LA"). What it does NOT catch: subtle degradation, such
 * as an extraction losing five percent of its spaces. The remedy for that is a
 * better extractor - see the width-based spacing work in pdf.mjs - not a
 * tighter threshold here.
 */

export const QUALITY_THRESHOLDS = Object.freeze({
  long20Share: 0.015,
  singleShare: 0.10,
  replShare: 0.005,
  glyphRecall: 0.5
})

/**
 * One-character words that are ordinary in a given language. Without this,
 * every sound Czech extraction fails: v, k, s, z, o, u are prepositions and
 * a, i are conjunctions, so real Czech prose is full of single-letter tokens.
 * A locale absent from this table is scored with no allowances, which is
 * conservative - it can produce a false escalation, never a false pass.
 */
export const SINGLE_LETTER_WORDS = Object.freeze({
  en: new Set(['a', 'i', 'o']),
  cs: new Set(['a', 'i', 'k', 'o', 's', 'u', 'v', 'z']),
  sk: new Set(['a', 'i', 'k', 'o', 's', 'u', 'v', 'z']),
  de: new Set([]),
  fr: new Set(['a', 'y']),
  es: new Set(['a', 'e', 'o', 'u', 'y']),
  it: new Set(['a', 'e', 'i', 'o'])
})

/**
 * The share of tokens longer than 20 characters that still counts as sound.
 *
 * The default is CALIBRATED: 0.015 comes from eight real extractions of four
 * real PDFs in English and Czech, where sound output scored 0.0034-0.0051 and
 * merged output scored 0.0284-0.0357.
 *
 * The compounding-language value is NOT calibrated. No German, Dutch, Finnish
 * or Hungarian corpus has been measured for this project. It is set
 * deliberately loose so it still catches gross merging while never firing on
 * ordinary compounds, and it should be replaced with a measured value the
 * first time such a corpus is available. Treat it as provisional.
 */
export const LONG_WORD_THRESHOLDS = Object.freeze({
  en: 0.015,
  cs: 0.015,
  sk: 0.015,
  de: 0.20,
  nl: 0.20,
  fi: 0.20,
  hu: 0.20,
  sv: 0.20,
  da: 0.20,
  no: 0.20,
  is: 0.20,
  fr: 0.015,
  es: 0.015,
  it: 0.015
})

const VOWELS = /[aeiouyáéíóúůýěäöüåøæàèìòùâêîôû]/i

const round = (value, places) => Number(value.toFixed(places))

function tokenize (text) {
  return String(text)
    .split(/\s+/)
    .map((token) => token.replace(/^\p{P}+|\p{P}+$/gu, ''))
    .filter((token) => token.length > 0 && /\p{L}/u.test(token))
}

export function scoreExtraction (text, { locale = 'en', glyphRecall = null } = {}) {
  const source = String(text ?? '')
  const tokens = tokenize(source)
  const n = tokens.length

  const base = {
    tokens: n,
    meanTokenLen: 0,
    singleShare: 0,
    long20Share: 0,
    replShare: 0,
    novowelShare: 0,
    glyphRecall: glyphRecall === null ? null : round(glyphRecall, 3)
  }

  if (n === 0) return { ...base, passed: false, reasons: ['empty: no tokens recovered'] }

  const localeKey = String(locale).slice(0, 2).toLowerCase()
  const allowed = SINGLE_LETTER_WORDS[localeKey] ?? new Set()
  const long20Threshold = LONG_WORD_THRESHOLDS[localeKey] ?? QUALITY_THRESHOLDS.long20Share
  const singles = tokens.filter((t) => t.length === 1 && !allowed.has(t.toLowerCase())).length
  const long20 = tokens.filter((t) => t.length > 20).length
  const novowel = tokens.filter((t) => t.length > 3 && !VOWELS.test(t)).length
  const replacements = (source.match(/�/g) || []).length

  const scored = {
    tokens: n,
    meanTokenLen: round(tokens.reduce((sum, t) => sum + t.length, 0) / n, 2),
    singleShare: round(singles / n, 3),
    long20Share: round(long20 / n, 4),
    replShare: round(replacements / n, 4),
    novowelShare: round(novowel / n, 3),
    glyphRecall: base.glyphRecall
  }

  const reasons = []
  if (scored.long20Share > long20Threshold) {
    reasons.push(`long20Share ${scored.long20Share} exceeds ${long20Threshold} (words look merged)`)
  }
  if (scored.singleShare > QUALITY_THRESHOLDS.singleShare) {
    reasons.push(`singleShare ${scored.singleShare} exceeds ${QUALITY_THRESHOLDS.singleShare} (words look split)`)
  }
  if (scored.replShare > QUALITY_THRESHOLDS.replShare) {
    reasons.push(`replShare ${scored.replShare} exceeds ${QUALITY_THRESHOLDS.replShare} (decoding failed)`)
  }
  if (scored.glyphRecall !== null && scored.glyphRecall < QUALITY_THRESHOLDS.glyphRecall) {
    reasons.push(`glyphRecall ${scored.glyphRecall} below ${QUALITY_THRESHOLDS.glyphRecall} (text was lost)`)
  }

  return { ...scored, passed: reasons.length === 0, reasons }
}
