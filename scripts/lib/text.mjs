/** Segmentation shared by every metric. Language-neutral unless a name says En. */

// Abbreviations that end in a period without ending a sentence. Deliberately
// short: a long list starts suppressing real sentence breaks.
//
// This list is English-biased, even though splitSentences carries no `En`
// marker. On a non-English corpus its only effect is an occasional missed
// sentence split after a local abbreviation the list doesn't know - it
// never merges sentences that should stay split. Per-locale fingerprints
// already keep languages from contaminating each other, so this is left as
// a fixed English list rather than a parameter; if a locale ever needs its
// own list, this is the place it becomes one.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'vs', 'etc', 'fig', 'no', 'inc', 'ltd',
  'co', 'jr', 'sr', 'approx', 'dept', 'est', 'vol', 'al', 'e.g', 'i.e'
])
const CLOSERS = '"\')]»”’'

export function normalizeEol (s) {
  return String(s).replace(/\r\n?/g, '\n')
}

// C0 (0x00-0x1F) and the DEL/C1 range (0x7F-0x9F), with tab (0x09), LF
// (0x0A) and CR (0x0D) carved out - those are legitimate content, already
// normalized to \n or collapsed to a space upstream, and a quoted CSV cell
// is allowed to carry a real embedded newline. Nothing else in either range
// should ever reach a corpus string: it is invisible in every editor and in
// a diff, and has leaked in before - a malformed RTF hex escape decoded
// straight through String.fromCharCode, a stray byte pasted into subtitle
// or CSV source text. Shared here (rather than duplicated in extract.mjs
// and textish.mjs) so the one definition is what both are checked against.
//
// Built from numeric character codes at runtime rather than a literal escape
// typed into this file: that escape has re-collapsed into the raw byte in
// this exact codebase more than once. fromCharCode sidesteps it entirely.
function charRange (from, to) {
  let out = ''
  for (let code = from; code <= to; code++) out += String.fromCharCode(code)
  return out
}
const CONTROL_CHARS = new RegExp(
  '[' + charRange(0, 8) + charRange(11, 12) + charRange(14, 31) + charRange(127, 159) + ']',
  'g'
)

export function stripControlChars (text) {
  return String(text).replace(CONTROL_CHARS, '')
}

export function splitParagraphs (text) {
  return normalizeEol(text)
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export function splitSentences (text) {
  const flat = normalizeEol(text).replace(/\s+/g, ' ').trim()
  if (!flat) return []

  const out = []
  let start = 0

  for (let i = 0; i < flat.length; i++) {
    if (!'.!?'.includes(flat[i])) continue

    let end = i
    while (end + 1 < flat.length && '.!?'.includes(flat[end + 1])) end++
    let after = end + 1
    while (after < flat.length && CLOSERS.includes(flat[after])) after++

    // Mid-word punctuation (URLs, decimals) is not a boundary.
    if (after < flat.length && flat[after] !== ' ') { i = end; continue }

    const candidate = flat.slice(start, after).trim()

    if (flat[i] === '.') {
      const lastToken = (candidate.match(/([\p{L}.]+)\.$/u) || [])[1]
      if (lastToken && ABBREVIATIONS.has(lastToken.toLowerCase())) { i = end; continue }
      // "J. Smith" - a lone capital before the period is an initial.
      if (/(?:^|\s)\p{Lu}\.$/u.test(candidate)) { i = end; continue }
    }

    if (candidate) out.push(candidate)
    start = after + 1
    i = after
  }

  const tail = flat.slice(start).trim()
  if (tail) out.push(tail)
  return out
}

export function splitWords (text) {
  return normalizeEol(text).match(/[\p{L}\p{N}]+(?:[''’-][\p{L}\p{N}]+)*/gu) || []
}

export function countSyllablesEn (word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  const trimmed = w
    .replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
  const groups = trimmed.match(/[aeiouy]{1,2}/g)
  return groups ? groups.length : 1
}
