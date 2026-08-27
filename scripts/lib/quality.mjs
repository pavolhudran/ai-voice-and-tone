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
 *   signal           sound            broken           threshold
 *   longTokenShare   0.0034 - 0.0051  0.0284 - 0.0357  > 0.015 fails
 *   singleShare      0.000  - 0.006   0.191            > 0.10  fails
 *   meanTokenLen     5.46   - 6.12    3.47 / 7.19-7.62 advisory only
 *   glyphRecall      -                -                > 0.5 passes, not measured
 *
 * What it catches: gross failure, in both directions. longTokenShare catches
 * merged words ("Onlineexerciseandtherapylessons"), singleShare catches split
 * words ("I V A S TIH LA"). What it does NOT catch: subtle degradation, such
 * as an extraction losing five percent of its spaces. The remedy for that is a
 * better extractor - see the width-based spacing work in pdf.mjs - not a
 * tighter threshold here. Light merging (2-3 short words concatenated) may also
 * escape detection in any language, as the original calibration measured
 * real PDF output where long runs merged, not pairwise concatenation.
 *
 * glyphRecall has no calibration data behind it because no current extractor
 * supplies a real value: pdf.mjs's own text layer never emits an unresolved-
 * glyph marker, so an emitted-over-expected ratio computed from it would be a
 * constant 1.0, and pdf.mjs returns `null` rather than fabricate that. office.mjs
 * omits the field for the same reason - it cannot measure it either. `null`
 * skips this check entirely (see below), so the 0.5 threshold is dormant
 * until some extractor can supply a figure that actually varies.
 */

export const QUALITY_THRESHOLDS = Object.freeze({
  longTokenShare: 0.015,
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
 * The character length that counts as "abnormally long" in a token.
 *
 * The default 20 is CALIBRATED: measured on eight real extractions of four
 * real PDFs in English and Czech, where this threshold separates sound output
 * (0.0034-0.0051 of tokens) from merged output (0.0284-0.0357 of tokens).
 *
 * The compounding-language value 30 is NOT calibrated. German, Dutch, Finnish,
 * Hungarian, Swedish, Danish, Norwegian, and Icelandic legitimately carry
 * compound words that would trigger false positives at length 20. At length 30,
 * the signal still catches heavily merged text (2 or more adjacent words
 * concatenated) while allowing realistic prose through. This value is
 * provisional and should be replaced with measured data once such corpora are
 * available.
 */
export const LONG_TOKEN_LENGTHS = Object.freeze({
  en: 20,
  cs: 20,
  sk: 20,
  de: 30,
  nl: 30,
  fi: 30,
  hu: 30,
  sv: 30,
  da: 30,
  no: 30,
  is: 30,
  fr: 20,
  es: 20,
  it: 20
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
    longTokenShare: 0,
    replShare: 0,
    novowelShare: 0,
    glyphRecall: glyphRecall === null ? null : round(glyphRecall, 3)
  }

  if (n === 0) return { ...base, passed: false, reasons: ['empty: no tokens recovered'] }

  const localeKey = String(locale).slice(0, 2).toLowerCase()
  const allowed = SINGLE_LETTER_WORDS[localeKey] ?? new Set()
  const longTokenLength = LONG_TOKEN_LENGTHS[localeKey] ?? 20
  const singles = tokens.filter((t) => t.length === 1 && !allowed.has(t.toLowerCase())).length
  const longTokens = tokens.filter((t) => t.length > longTokenLength).length
  const novowel = tokens.filter((t) => t.length > 3 && !VOWELS.test(t)).length
  const replacements = (source.match(/�/g) || []).length

  const scored = {
    tokens: n,
    meanTokenLen: round(tokens.reduce((sum, t) => sum + t.length, 0) / n, 2),
    singleShare: round(singles / n, 3),
    longTokenShare: round(longTokens / n, 4),
    replShare: round(replacements / n, 4),
    novowelShare: round(novowel / n, 3),
    glyphRecall: base.glyphRecall
  }

  const reasons = []
  if (scored.longTokenShare > QUALITY_THRESHOLDS.longTokenShare) {
    reasons.push(`longTokenShare ${scored.longTokenShare} exceeds ${QUALITY_THRESHOLDS.longTokenShare} at length ${longTokenLength} (words look merged)`)
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
