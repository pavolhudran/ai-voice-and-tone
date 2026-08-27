import path from 'node:path'
import { createRequire } from 'node:module'
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
const VENDOR = path.resolve(import.meta.dirname, '..', '..', 'vendor')

export const OFFICE_FORMATS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'])

export const OFFICE_EXTRACTOR = Object.freeze({
  name: 'officeparser',
  version: JSON.parse(readTextFile(path.join(VENDOR, 'manifest.json'))).libraries.officeparser.version
})

// A delimiter officeparser will not emit on its own, so splitting on it
// recovers exactly the paragraph boundaries it was asked to mark. Written as
// an escape, never a literal control character - a literal byte here makes
// grep treat this file as binary and is invisible in every editor.
const PARAGRAPH = ''

let cached = null
function officeparser () {
  if (!cached) cached = require(path.join(VENDOR, 'officeparser', 'officeparser.cjs'))
  return cached
}

export async function extractOffice (buf, format) {
  if (!OFFICE_FORMATS.has(format)) throw new Error(`unsupported office format: ${format}`)

  const parsed = await officeparser().parseOffice(buf, {
    newlineDelimiter: PARAGRAPH,
    ignoreNotes: false,
    outputErrorToConsole: false
  })
  const raw = await parsed.toText()

  const strings = String(raw)
    .split(PARAGRAPH)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  return {
    strings,
    // No container format carries a heading concept this plugin can trust:
    // a docx style name is editable and a pptx title placeholder is
    // positional. Guessing would feed headingTitleCaseRatio a guess.
    //
    // Verified against the vendored bundle itself, not just argued from
    // principle: officeparser's own docx heading detection derives from the
    // paragraph's w:pStyle value via `W.startsWith("Heading")||W==="Title"` -
    // exactly the editable style-name heuristic this adapter is refusing to
    // trust. And that "heading" node distinction never survives into
    // toText() anyway - its flattener concatenates every node's text by
    // type-agnostic recursion, so a heading paragraph and a body paragraph
    // are already indistinguishable in the string this adapter consumes.
    // pptx parsing has no title-placeholder detection at all. There is
    // nothing reliable to surface, through this API, for any format.
    headings: [],
    note: strings.length ? 'ok' : 'no-text-layer'
  }
}
