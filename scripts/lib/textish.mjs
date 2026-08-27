/**
 * Small text-shaped formats that need a parser but not a container reader.
 *
 * Subtitles are here because a webinar or product-video transcript is
 * unusually good voice corpus - it is the brand talking, unedited - and the
 * format costs almost nothing to read.
 */

const RTF_ANSI_HIGH = {
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”',
  0x95: '•', 0x96: '–', 0x97: '—'
}

// Destinations RTF writers mark as non-content by their control word alone,
// with no {\* prefix: font and color tables, style definitions, list and
// theme metadata. A reader that does not special-case these sees their raw
// contents (font names, hex colors) leak into the body as if it were prose.
const NONTEXT_DESTINATION = /^\{\\(fonttbl|colortbl|stylesheet|info|generator|listtable|listoverridetable|rsidtbl|themedata|colorschememapping|latentstyles|panose|datastore|xmlnstbl)\b/

/**
 * RTF is a brace-nested control language. Three things matter: a group opened
 * with {\* - or one of the well-known non-content destinations above - is
 * ignorable and must be skipped whole; \'hh is a codepage byte; and \uN? is a
 * Unicode codepoint followed by an ASCII fallback character that must be
 * discarded rather than kept alongside it.
 */
export function extractRtf (raw) {
  const text = String(raw).replace(/\r\n?/g, '\n')
  const lines = []
  let current = ''
  let depth = 0
  let skipDepth = -1

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (ch === '{') {
      depth += 1
      const ignorable = text.startsWith('{\\*', i) || NONTEXT_DESTINATION.test(text.slice(i))
      if (ignorable && skipDepth < 0) skipDepth = depth
      continue
    }
    if (ch === '}') {
      if (skipDepth === depth) skipDepth = -1
      depth -= 1
      continue
    }
    if (skipDepth >= 0) continue

    if (ch !== '\\') {
      if (ch === '\n') continue
      current += ch
      continue
    }

    // A control word: backslash, letters, optional signed number, optional space.
    const control = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(text.slice(i))
    if (control) {
      const [whole, word, arg] = control
      i += whole.length - 1
      if (word === 'par' || word === 'line' || word === 'sect') {
        if (current.trim()) lines.push(current.replace(/\s+/g, ' ').trim())
        current = ''
      } else if (word === 'tab') {
        current += ' '
      } else if (word === 'u' && arg !== undefined) {
        current += String.fromCodePoint(Number(arg) < 0 ? Number(arg) + 65536 : Number(arg))
        // Skip the ASCII fallback that follows a \u escape.
        if (text[i + 1] === '?') i += 1
      }
      continue
    }

    const hex = /^\\'([0-9a-fA-F]{2})/.exec(text.slice(i))
    if (hex) {
      const code = parseInt(hex[1], 16)
      current += RTF_ANSI_HIGH[code] ?? String.fromCharCode(code)
      i += 3
      continue
    }

    // An escaped literal: \\ \{ \}
    current += text[i + 1] ?? ''
    i += 1
  }

  if (current.trim()) lines.push(current.replace(/\s+/g, ' ').trim())
  return lines
}

const TIMING = /-->/
const CUE_INDEX = /^\d+$/

/** WebVTT and SubRip. One cue becomes one string, however many lines it spans. */
export function extractSubtitles (raw) {
  const out = []
  let cue = []

  const flush = () => {
    const joined = cue.join(' ').replace(/\s+/g, ' ').trim()
    if (joined) out.push(joined)
    cue = []
  }

  for (const line of String(raw).replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') { flush(); continue }
    if (trimmed === 'WEBVTT' || trimmed.startsWith('NOTE ') || trimmed.startsWith('STYLE')) continue
    if (TIMING.test(trimmed)) continue // timings, with or without cue settings
    if (CUE_INDEX.test(trimmed)) continue // a bare cue number
    cue.push(trimmed.replace(/<[^>]*>/g, '')) // speaker and styling tags
  }
  flush()
  return out
}

/**
 * CSV/TSV cell values. Quoted cells may contain the delimiter and newlines.
 * A cell with no letter - a bare count, an id, a hex code - carries no brand
 * voice, the same standard extract.mjs's isCopy already holds JSON and YAML
 * values to, so it is dropped here rather than counted as a data point.
 */
export function extractDelimited (raw, delimiter = ',') {
  const text = String(raw).replace(/\r\n?/g, '\n')
  const out = []
  let cell = ''
  let quoted = false

  const push = () => {
    const value = cell.trim()
    if (value && /\p{L}/u.test(value)) out.push(value)
    cell = ''
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') { cell += ch; continue }
      if (text[i + 1] === '"') { cell += '"'; i += 1; continue }
      quoted = false
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === delimiter || ch === '\n') { push(); continue }
    cell += ch
  }
  push()
  return out
}
