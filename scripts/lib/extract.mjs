import path from 'node:path'
import { parseYaml } from './yaml.mjs'
import { splitParagraphs } from './text.mjs'
import { extractRtf, extractSubtitles, extractDelimited } from './textish.mjs'
import { OFFICE_FORMATS } from './office.mjs'

export const COPY_EXTENSIONS = {
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.markdown': 'markdown',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.po': 'po',
  '.pot': 'po',
  '.html': 'html',
  '.htm': 'html',
  '.txt': 'text',
  '.rtf': 'rtf',
  '.vtt': 'subtitles',
  '.srt': 'subtitles',
  '.csv': 'csv',
  '.tsv': 'tsv'
}

/**
 * Container formats. These hold bytes, not text, so a caller must read them
 * with readFileSync and no encoding and hand the Buffer to office.mjs or
 * pdf.mjs - never to extractStrings, which takes decoded text.
 *
 * The office half of this table is derived from office.mjs's own
 * OFFICE_FORMATS rather than repeated by hand: the two lists drifting apart
 * would resolve a real file's extension to a format neither table's caller
 * can act on, and nothing would say why. Every office format string happens
 * to equal its extension without the leading dot, so the derivation is
 * exact, not a heuristic.
 */
export const BINARY_EXTENSIONS = Object.fromEntries([
  ...[...OFFICE_FORMATS].map((format) => [`.${format}`, format]),
  ['.pdf', 'pdf']
])

const BINARY_FORMATS = new Set(Object.values(BINARY_EXTENSIONS))

export function isBinaryFormat (format) {
  return BINARY_FORMATS.has(format)
}

export function formatFor (absPath) {
  const ext = path.extname(String(absPath)).toLowerCase()
  return COPY_EXTENSIONS[ext] || BINARY_EXTENSIONS[ext] || null
}

// A value that carries no brand voice: URLs, tokens, colors, bare numbers,
// anything without a letter. Counting these would skew every metric.
function isCopy (value) {
  const text = String(value).trim()
  if (text.length === 0) return false
  if (!/\p{L}/u.test(text)) return false
  if (/^(?:https?:|mailto:|tel:|data:|\/\/)/i.test(text)) return false
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return false
  if (/^[0-9a-f]{6}$|^[0-9a-f]{8}$/i.test(text) && /\d/.test(text)) return false
  if (/^[/.]{0,2}\//.test(text)) return false
  if (/^[A-Z0-9_]+$/.test(text) && /_/.test(text)) return false
  return true
}

function pushCopy (out, value) {
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (isCopy(text)) out.push(text)
}

const FRONTMATTER = /^---\n[\s\S]*?\n---\n/

/**
 * A leading YAML frontmatter block is metadata about a document, never body
 * text. Counting it as prose inflates every length and rhythm metric derived
 * from the document - which is why both the corpus extractor here and
 * scripts/diff.mjs (every `<KB>/.drafts/` file carries an 8-field block) share
 * this one definition rather than each carrying its own regex.
 */
export function stripFrontmatter (raw) {
  return String(raw).replace(FRONTMATTER, '')
}

function extractMarkdown (raw) {
  let body = stripFrontmatter(raw)
    .replace(/^```[\s\S]*?^```$/gm, '')             // fenced code
    .replace(/^~~~[\s\S]*?^~~~$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')                // HTML comments
    .replace(/^(?:import|export)\s.*$/gm, '')       // MDX module syntax
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')       // image -> alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')        // link -> link text
    .replace(/`[^`\n]*`/g, '')                      // inline code
    .replace(/<[^>\n]+>/g, '')                      // inline HTML/JSX tags

  const out = []
  for (const block of splitParagraphs(body)) {
    for (const line of block.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (/^\|?\s*:?-{2,}/.test(trimmed)) continue  // table separator row
      if (trimmed.includes('|')) {
        for (const cell of trimmed.split('|')) pushCopy(out, cell)
        continue
      }
      pushCopy(
        out,
        trimmed
          .replace(/^#{1,6}\s+/, '')                // heading marker
          .replace(/^>\s?/, '')                     // blockquote marker
          .replace(/^(?:[-*+]|\d+\.)\s+/, '')       // list marker
          .replace(/^\s*\[[ xX]\]\s*/, '')          // task checkbox
          .replace(/\*\*|__|\*|_|~~/g, '')          // emphasis
      )
    }
  }
  return out
}

function walkJsonValues (node, out) {
  if (typeof node === 'string') { pushCopy(out, node); return }
  if (Array.isArray(node)) { for (const item of node) walkJsonValues(item, out); return }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) walkJsonValues(value, out)
  }
}

function extractYaml (raw) {
  const out = []
  try {
    walkJsonValues(parseYaml(raw), out)
    return out
  } catch {
    // Real-world locale YAML uses anchors and merge keys the subset rejects.
    // Degrade to a line scan rather than losing the whole file.
    for (const line of raw.split('\n')) {
      const match = /^\s*[\w.$-]+:\s*(\S.*)$/.exec(line)
      if (match) pushCopy(out, match[1].replace(/^["']|["']$/g, ''))
    }
    return out
  }
}

function unquotePo (line) {
  const match = /"((?:[^"\\]|\\.)*)"/.exec(line)
  if (!match) return ''
  return match[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function extractPo (raw) {
  const out = []
  let field = null
  const entry = { msgid: '', msgstr: '' }

  const flush = () => {
    if (entry.msgid !== '' || entry.msgstr !== '') {
      // A blank msgid is the PO header block, never copy.
      if (entry.msgid !== '') pushCopy(out, entry.msgstr || entry.msgid)
    }
    entry.msgid = ''
    entry.msgstr = ''
    field = null
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') { flush(); continue }
    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith('msgid_plural')) { field = 'msgid'; entry.msgid += unquotePo(trimmed); continue }
    if (trimmed.startsWith('msgid')) { field = 'msgid'; entry.msgid = unquotePo(trimmed); continue }
    if (trimmed.startsWith('msgstr')) { field = 'msgstr'; entry.msgstr = unquotePo(trimmed); continue }
    if (trimmed.startsWith('"') && field) { entry[field] += unquotePo(trimmed) }
  }
  flush()
  return out
}

function decodeEntities (text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => named[name.toLowerCase()] ?? whole)
}

function extractHtml (raw) {
  const out = []
  const body = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  for (const match of body.matchAll(/\b(?:alt|title|aria-label|placeholder)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    pushCopy(out, decodeEntities(match[1] ?? match[2]))
  }
  for (const chunk of body.replace(/<[^>]*>/g, '\n').split('\n')) {
    pushCopy(out, decodeEntities(chunk))
  }
  return out
}

export function extractHeadings (absPath, raw) {
  const format = formatFor(absPath)
  const text = String(raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const out = []

  if (format === 'markdown') {
    const withoutCode = text.replace(/^```[\s\S]*?^```$/gm, '')
    for (const match of withoutCode.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      pushCopy(out, match[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, ''))
    }
    return out
  }
  if (format === 'html') {
    for (const match of text.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
      pushCopy(out, decodeEntities(match[1].replace(/<[^>]*>/g, ' ')))
    }
    return out
  }
  return out
}

export function extractStrings (absPath, raw) {
  const format = formatFor(absPath)
  if (!format) return { format: null, strings: [] }
  // A container format never reaches here with usable input: its bytes are
  // not text, so a caller that got this far read a PDF or an Office file as
  // UTF-8 - a caller bug, not a normal outcome. office.mjs's extractOffice
  // throws on the mirror-image mistake (an unsupported format string), and
  // this does the same rather than returning the mojibake that would
  // otherwise poison every metric downstream while looking like real,
  // if sparse, copy.
  if (isBinaryFormat(format)) {
    throw new Error(
      `extractStrings cannot read container format "${format}" as text; ` +
      'read it with readFileSync (no encoding) and hand the buffer to extractOffice or extractPdf instead'
    )
  }
  const text = String(raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

  switch (format) {
    case 'markdown': return { format, strings: extractMarkdown(text) }
    case 'json': {
      const out = []
      try { walkJsonValues(JSON.parse(text), out) } catch { /* malformed JSON yields nothing */ }
      return { format, strings: out }
    }
    case 'yaml': return { format, strings: extractYaml(text) }
    case 'po': return { format, strings: extractPo(text) }
    case 'html': return { format, strings: extractHtml(text) }
    case 'text': {
      const out = []
      for (const block of splitParagraphs(text)) pushCopy(out, block)
      return { format, strings: out }
    }
    case 'rtf': return { format, strings: extractRtf(text) }
    case 'subtitles': return { format, strings: extractSubtitles(text) }
    case 'csv': return { format, strings: extractDelimited(text, ',') }
    case 'tsv': return { format, strings: extractDelimited(text, '\t') }
    default: return { format: null, strings: [] }
  }
}
