import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readTextFile } from './fsx.mjs'

/**
 * Office and OpenDocument text, through the vendored officeparser bundle.
 *
 * This file is an ADAPTER, not a parser. officeparser returns one flat blob;
 * the fingerprint needs paragraph boundaries, because paragraphCount and
 * meanParagraphLength are real metrics and a single 4,000-word paragraph would
 * distort both. Splitting the delimited output back into paragraphs is the
 * whole job.
 *
 * Chosen on measurement, not reputation: on real .docx and .odt files its text
 * was identical to a hand-written extractor. It is here so that six container
 * formats stop being ours to maintain, not because it reads them better.
 */

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const VENDOR = path.resolve(HERE, '..', '..', 'vendor')

export const OFFICE_FORMATS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'])

export const OFFICE_EXTRACTOR = Object.freeze({
  name: 'officeparser',
  version: JSON.parse(readTextFile(path.join(VENDOR, 'manifest.json'))).libraries.officeparser.version
})

// A delimiter officeparser will not emit on its own, so splitting on it
// recovers exactly the paragraph boundaries it was asked to mark. Written as
// an escape, never a literal control character - a literal byte here makes
// grep treat this file as binary and is invisible in every editor.
const PARAGRAPH = '\u0001'

const clean = (text) => String(text).replace(/\s+/g, ' ').trim()

let cached = null
function officeparser () {
  if (!cached) cached = require(path.join(VENDOR, 'officeparser', 'officeparser.cjs'))
  return cached
}

// officeparser's `content` is a single cross-format AST - the same object
// this function already holds before it ever calls toText() - whose nodes
// are tagged `type: "heading"` uniformly across docx, pptx and odt, each
// with the node's own flattened text already sitting on `.text`. Recovering
// headings is a document-order filter over that tree, not a second parser:
//  - odt tags a real structural element, `text:h` - a genuine heading, not a
//    heuristic.
//  - pptx tags a slide's title placeholder (`p:ph type="title"` or
//    "ctrTitle") - positional, but a real placeholder role, not a guess.
//  - docx tags whichever paragraph's `w:pStyle` starts with "Heading" or
//    equals "Title" - a user-editable style id, so this signal is real but
//    weaker than the other two.
// toText() itself never exposes any of this: its flattener recurses every
// node's text by type-agnostic recursion, so a heading and a body paragraph
// are already indistinguishable in the string it returns - which is exactly
// why this walks `content` directly instead of toText()'s output.
function collectHeadings (nodes, out = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node && node.type === 'heading' && typeof node.text === 'string') {
      const text = clean(node.text)
      if (text) out.push(text)
    }
    if (node && Array.isArray(node.children)) collectHeadings(node.children, out)
  }
  return out
}

export async function extractOffice (buf, format) {
  if (!OFFICE_FORMATS.has(format)) throw new Error(`unsupported office format: ${format}`)

  const parsed = await officeparser().parseOffice(buf, {
    newlineDelimiter: PARAGRAPH,
    ignoreNotes: false,
    outputErrorToConsole: false
  })
  const raw = await parsed.toText()

  // A heading is body copy too - the fingerprint's paragraph/word metrics
  // still need to see it - so it stays in `strings` exactly as toText()
  // already produced it. `headings` below is additive, not a filtered
  // subset of it.
  const strings = String(raw)
    .split(PARAGRAPH)
    .map(clean)
    .filter(Boolean)

  return {
    strings,
    headings: collectHeadings(parsed.content),
    note: strings.length ? 'ok' : 'no-text-layer'
  }
}
