/**
 * Small text-shaped formats that need a parser but not a container reader.
 *
 * Subtitles are here because a webinar or product-video transcript is
 * unusually good voice corpus - it is the brand talking, unedited - and the
 * format costs almost nothing to read.
 */

import { stripControlChars } from './text.mjs'

// Windows-1252 (cp1252) codepoints for the 0x80-0x9F byte range that RTF's
// \'hh escape addresses, as numeric Unicode codepoints rather than literal
// glyphs (or a \u escape) pasted into source - typing either directly into
// this file is exactly the authoring trap that has bitten this project
// before: an editor, shell, or heredoc re-collapses the escape into the raw
// byte, invisibly.
//
// Five bytes in this range - 0x81, 0x8D, 0x8F, 0x90, 0x9D - are genuinely
// undefined in cp1252 and are deliberately absent from this map rather than
// pointed at a replacement character: real software never emits them here,
// so a file that contains one is already malformed, and the lookup below
// drops the byte rather than ever emitting the raw C1 control character
// cp1252 has no glyph for in the first place.
const RTF_CP1252_HIGH = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d,
  0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161,
  0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178
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
 *
 * Known tradeoff: the control-word and hex-escape checks below re-slice the
 * remaining text from the current position on every character (`text.slice(i)`),
 * which is O(n) per probe and so O(n^2) in the worst case over a very large,
 * escape-dense file. Inherited from this function's first version; left as
 * is because real-world RTF used as voice corpus is small enough that this
 * has no measured cost, but a multi-megabyte RTF would feel it.
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
        if (current.trim()) lines.push(stripControlChars(current).replace(/\s+/g, ' ').trim())
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
      if (code >= 0x80 && code <= 0x9f) {
        const mapped = RTF_CP1252_HIGH[code]
        if (mapped !== undefined) current += String.fromCodePoint(mapped)
        // else: one of the five cp1252-undefined bytes - dropped, never the
        // raw C1 control character.
      } else {
        current += String.fromCharCode(code)
      }
      i += 3
      continue
    }

    // An escaped literal: \\ \{ \}
    current += text[i + 1] ?? ''
    i += 1
  }

  if (current.trim()) lines.push(stripControlChars(current).replace(/\s+/g, ' ').trim())
  return lines
}

const TIMING = /-->/

/**
 * WebVTT and SubRip. One cue becomes one string, however many lines it spans.
 *
 * A NOTE, STYLE, or REGION block runs until the next blank line (or end of
 * file), full stop, per the WebVTT spec - including lines inside it that
 * happen to look like a cue timing or cue text. There is deliberately no
 * "looks like a new cue, so end the block early" escape hatch: a comment
 * block immediately followed by a real cue with no blank line separating
 * them is, per spec, still one comment block, and the cue lines are part of
 * its (dropped) body, not a separate cue. See the "no blank line" test.
 *
 * A cue's optional identifier line - before the timing line - can be any
 * non-blank text that does not contain "-->", not only a bare number
 * (SubRip's convention); a state machine tracks "have we seen this cue's
 * timing line yet" rather than pattern-matching the identifier's content.
 */
export function extractSubtitles (raw) {
  const out = []
  let cue = []
  let skipping = false // inside a NOTE/STYLE/REGION block
  let sawTiming = false // has this cue's timing line appeared yet

  const flush = () => {
    const joined = stripControlChars(cue.join(' ')).replace(/\s+/g, ' ').trim()
    if (joined) out.push(joined)
    cue = []
  }

  for (const line of String(raw).replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()

    if (trimmed === '') {
      skipping = false
      flush()
      sawTiming = false
      continue
    }

    if (skipping) continue // still inside the comment/style/region block

    if (trimmed === 'WEBVTT') continue

    const isNote = trimmed === 'NOTE' || trimmed.startsWith('NOTE ') || trimmed.startsWith('NOTE\t')
    if (isNote || trimmed.startsWith('STYLE') || trimmed.startsWith('REGION')) {
      skipping = true
      continue
    }

    if (TIMING.test(trimmed)) { sawTiming = true; continue } // the timing line itself

    if (!sawTiming) continue // a cue identifier line - any text, dropped

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
    const value = stripControlChars(cell).replace(/\s+/g, ' ').trim()
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
