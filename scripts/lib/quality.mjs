import { isUrlOrHandle } from './extract.mjs'

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
 *
 * Ruling R43 (a real 72-file brand corpus, 8 of 9 rejections false positives):
 *
 * 1. A URL or @handle is not prose in any format - a link is not a merged
 *    or split word just because it is long or has no spaces. Both are
 *    stripped from the token set before anything is scored, using the same
 *    isUrlOrHandle() judgement extract.mjs already applies when deciding
 *    what counts as copy, so the plugin does not carry two divergent
 *    opinions of "this isn't a word". If stripping them leaves too few
 *    tokens to compute a share that means anything (see MIN_SHAPE_TOKENS
 *    below), the merge/split signals are not scored rather than scored on
 *    noise.
 *
 * 2. longTokenShare and singleShare answer "did extraction lose fidelity",
 *    which has no meaning for a format nothing extracted. A .txt/.md/.json/
 *    .yaml/.po/.csv/.tsv/subtitle file IS what a person wrote - scoring it
 *    read the words back unchanged - so these two signals do not apply to
 *    it (see AUTHORED_FORMATS / appliesShapeGate below). .pdf, the office
 *    formats, .html and .rtf all recover running text from something else
 *    (a text layer, a container, markup, control words) and stay gated, as
 *    does any model-tier transcription regardless of the original format -
 *    a model reconstructing unreadable text is itself a recovery step.
 *    replShare and glyphRecall are unaffected: a wrong-encoding decode can
 *    corrupt a plain-text file too.
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

/**
 * Formats where the scored text IS the source, not a recovery of it - see
 * Ruling R43's change 2 in the header comment above. `format` here is the
 * same string extract.mjs's formatFor()/COPY_EXTENSIONS produce (`'text'`,
 * `'markdown'`, ...), which is what ingest.mjs already carries alongside
 * every extraction.
 *
 * `.html` and `.rtf` are deliberately absent: both recover running text out
 * of markup (tags, RTF control words), the same kind of lossy step pdf.mjs
 * and office.mjs perform, so a merge/split failure there can still mean the
 * recovery mangled word boundaries.
 */
export const AUTHORED_FORMATS = new Set([
  'text', 'markdown', 'json', 'yaml', 'po', 'csv', 'tsv', 'subtitles'
])

/**
 * Whether longTokenShare/singleShare may judge this text at all. A
 * model-tier transcription is always a recovery regardless of its original
 * format - a model reconstructing text it could not read directly can lose
 * or merge word boundaries exactly as a vendored parser can. An unspecified
 * format defaults to "gate applies", the same conservative bias
 * SINGLE_LETTER_WORDS uses above: an absent judgement produces a false
 * escalation at worst, never a false pass.
 */
export function appliesShapeGate (format, tier) {
  if (tier === 'model') return true
  if (format == null) return true
  return !AUTHORED_FORMATS.has(format)
}

/**
 * Below this many prose tokens, a computed share is noise, not evidence -
 * the R43 corpus example was a longTokenShare of 4/9 whose numerator was
 * entirely URLs. 10 is not a new calibration: it is the smallest sample the
 * existing suite already relies on for a real verdict (the ten-token
 * "a b c d e f g h i j" case below), so nothing sound is newly let through.
 */
export const MIN_SHAPE_TOKENS = 10

const VOWELS = /[aeiouyáéíóúůýěäöüåøæàèìòùâêîôû]/i

const round = (value, places) => Number(value.toFixed(places))

function tokenize (text) {
  return String(text)
    .split(/\s+/)
    .filter((raw) => raw.length > 0 && !isUrlOrHandle(raw))
    .map((token) => token.replace(/^\p{P}+|\p{P}+$/gu, ''))
    .filter((token) => token.length > 0 && /\p{L}/u.test(token))
}

export function scoreExtraction (text, { locale = 'en', glyphRecall = null, format = null, tier = 'script' } = {}) {
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

  // longTokenShare/singleShare judge whether an extraction step lost
  // fidelity. That question has no answer for authored-format text (see
  // AUTHORED_FORMATS above) and no reliable answer over a handful of
  // tokens (see MIN_SHAPE_TOKENS) - either way the two signals are still
  // reported below, just not held against the source.
  const shapeGateApplies = appliesShapeGate(format, tier) && n >= MIN_SHAPE_TOKENS

  const reasons = []
  if (shapeGateApplies && scored.longTokenShare > QUALITY_THRESHOLDS.longTokenShare) {
    reasons.push(`longTokenShare ${scored.longTokenShare} exceeds ${QUALITY_THRESHOLDS.longTokenShare} at length ${longTokenLength} (words look merged)`)
  }
  if (shapeGateApplies && scored.singleShare > QUALITY_THRESHOLDS.singleShare) {
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
