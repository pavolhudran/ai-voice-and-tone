import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readTextFile } from './fsx.mjs'

/**
 * PDF text through the vendored pdfjs bundle.
 *
 * An adapter, not a parser. Getting characters out of a PDF is
 * straightforward; getting the SPACES right is the hard part, and it is why
 * this is vendored. A hand-written extractor reached 96-98 percent word recall
 * on real files and still failed the quality gate on every one, because a
 * Td-delta heuristic tuned for a document that positions each glyph
 * individually merges whole phrases in a document that positions runs. pdfjs
 * derives spacing from font advance widths and lands inside the gate's sound
 * band on the same files.
 *
 * Spacing here is reconstructed from each item's x position against where the
 * previous item ended - pdfjs gives both, so no heuristic constant is needed
 * beyond "did the pen actually move further than the glyph was wide".
 *
 * This adapter never supplies `glyphRecall`. The vendored bundle's own text
 * layer has no notion of an unresolved glyph - it never emits U+FFFD or a
 * `notdef` marker, confirmed against the bundle itself - so an
 * emitted-over-expected character ratio computed from its output can only
 * ever be a constant 1.0. A signal pinned at a constant is worse than no
 * signal at all: it would read as "no characters were lost" on every PDF
 * without ever having checked. `null` is the honest answer; see
 * quality.mjs's QUALITY_THRESHOLDS doc comment for how the gate treats it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VENDOR = path.resolve(HERE, '..', '..', 'vendor')

export const PDF_EXTRACTOR = Object.freeze({
  name: 'pdfjs-dist',
  version: JSON.parse(readTextFile(path.join(VENDOR, 'manifest.json'))).libraries['pdfjs-dist'].version
})

/**
 * pdfjs's legacy build runs outside a browser, so on every process's first
 * load it complains once that it cannot load `@napi-rs/canvas` and cannot
 * polyfill `DOMMatrix`, `ImageData`, or `Path2D` - none of which this adapter
 * needs, since it only reads text content and never renders a page. Spec
 * section 9 keeps stdout quiet and ASCII, so that one-time noise is
 * suppressed here.
 *
 * Traced directly against the vendored bundle by capturing every channel
 * separately while it loaded: every one of those four warnings goes out
 * through `console.log`, and only `console.log` - never `console.warn`/
 * `error`, and never `process.stdout.write` or `process.stderr.write`
 * directly. So only `console.log` (kept alongside `warn`/`error` here as a
 * defensive match for whatever a future pdfjs version might use instead)
 * needs patching, and the raw streams are never touched at all - not even
 * for the bounded span of the import.
 *
 * That distinction is the whole fix. An earlier version of this file
 * globally replaced `process.stdout.write` for the ENTIRE parse (an
 * arbitrarily long, multiply-async span that can overlap another caller's
 * own output), and a narrower revision still replaced it for just the
 * one-time import - both swallowed whatever anyone else wrote to that
 * stream while the replacement was in effect, reproduced directly against
 * this repo's own test suite even for the "just the import" version: a
 * dynamic import of a multi-megabyte minified bundle is exactly the kind of
 * synchronous work that can make an unrelated writer's already-queued
 * output actually flush while the override sits in front of it. Never
 * installing a stream override removes the entire hazard, rather than
 * bounding its window.
 *
 * Restored by plain reference, not a bound wrapper: `console.log` etc. are
 * always called as `console.log(...)`, so no `this` needs preserving, and a
 * bound copy reassigned back would stack a wrapper layer on every call
 * rather than genuinely restoring the original function.
 */
async function quietly (fn) {
  const { warn, error, log } = console
  console.warn = console.error = console.log = () => {}
  try {
    return await fn()
  } finally {
    Object.assign(console, { warn, error, log })
  }
}

let cached = null
async function pdfjs () {
  if (cached) return cached
  cached = await quietly(async () => {
    const mod = await import(pathToFileURL(path.join(VENDOR, 'pdfjs', 'pdf.min.mjs')).href)
    mod.GlobalWorkerOptions.workerSrc = fileURLToPath(pathToFileURL(path.join(VENDOR, 'pdfjs', 'pdf.worker.min.mjs')))
    return mod
  })
  return cached
}

const EMPTY = { strings: [], headings: [], glyphRecall: null, note: 'no-text-layer' }

export async function extractPdf (buf) {
  if (!buf || buf.length === 0) return { ...EMPTY }

  const lib = await pdfjs()
  let doc
  try {
    doc = await lib.getDocument({
      data: new Uint8Array(buf),
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false, // no eval in a plugin that reads untrusted files
      stopAtErrors: false, // a damaged page should not lose the whole document
      // Measured: this alone silences pdfjs's own per-parse warnings, so the
      // parse needs no stream patching at all - see the doc comment on
      // `quietly` above for why that matters.
      verbosity: lib.VerbosityLevel.ERRORS
    }).promise
  } catch (error) {
    // The vendored bundle's export surface has no Password* class to
    // instanceof against (checked: no export name on the module matches
    // /password/i), so detection falls back to the thrown instance's own
    // `name`, which pdfjs sets to 'PasswordException' regardless of export
    // visibility. The message regex stays only as a last-resort net for an
    // encryption failure that somehow doesn't carry that name.
    if (error?.name === 'PasswordException' || /password|encrypt/i.test(error?.message ?? '')) {
      return { strings: [], headings: [], glyphRecall: null, note: 'encrypted' }
    }
    return { ...EMPTY }
  }

  const strings = []

  for (let page = 1; page <= doc.numPages; page++) {
    let items
    try {
      items = (await (await doc.getPage(page)).getTextContent()).items
    } catch {
      continue // one unreadable page is not the whole document
    }

    let line = ''
    let penEnd = null
    const flush = () => {
      const trimmed = line.replace(/\s+/g, ' ').trim()
      if (trimmed) strings.push(trimmed)
      line = ''
    }

    for (const item of items) {
      if (typeof item.str !== 'string') continue

      const x = item.transform?.[4] ?? 0
      // A gap beyond where the previous item ended is a word break. pdfjs
      // already reports each item's own width, so this needs no constant.
      if (penEnd !== null && x - penEnd > 1 && line && !line.endsWith(' ')) line += ' '
      line += item.str
      penEnd = x + (item.width ?? 0)
      if (item.hasEOL) { flush(); penEnd = null }
    }
    flush()
  }

  await doc.destroy?.()

  if (strings.length === 0) return { ...EMPTY }
  return { strings, headings: [], glyphRecall: null, note: 'ok' }
}
