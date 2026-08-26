/** Segmentation shared by every metric. Language-neutral unless a name says En. */

// Abbreviations that end in a period without ending a sentence. Deliberately
// short: a long list starts suppressing real sentence breaks.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'vs', 'etc', 'fig', 'no', 'inc', 'ltd',
  'co', 'jr', 'sr', 'approx', 'dept', 'est', 'vol', 'al', 'e.g', 'i.e'
])
const CLOSERS = '"\')]»”’'

export function normalizeEol (s) {
  return String(s).replace(/\r\n?/g, '\n')
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
