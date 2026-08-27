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
 */

const VENDOR = path.resolve(import.meta.dirname, '..', '..', 'vendor', 'pdfjs')

export const PDF_EXTRACTOR = Object.freeze({
  name: 'pdfjs-dist',
  version: JSON.parse(
    readTextFile(path.join(import.meta.dirname, '..', '..', 'vendor', 'manifest.json'))
  ).libraries['pdfjs-dist'].version
})

let cached = null
async function pdfjs () {
  if (cached) return cached
  const mod = await import(pathToFileURL(path.join(VENDOR, 'pdf.min.mjs')).href)
  mod.GlobalWorkerOptions.workerSrc = fileURLToPath(pathToFileURL(path.join(VENDOR, 'pdf.worker.min.mjs')))
  cached = mod
  return mod
}

/** pdfjs warns about fonts constantly; spec section 9 keeps stdout quiet. */
async function quietly (fn) {
  const outWrite = process.stdout.write.bind(process.stdout)
  const errWrite = process.stderr.write.bind(process.stderr)
  const { warn, error, log } = console
  process.stdout.write = () => true
  process.stderr.write = () => true
  console.warn = console.error = console.log = () => {}
  try {
    return await fn()
  } finally {
    process.stdout.write = outWrite
    process.stderr.write = errWrite
    Object.assign(console, { warn, error, log })
  }
}

const EMPTY = { strings: [], headings: [], glyphRecall: 0, note: 'no-text-layer' }

export async function extractPdf (buf) {
  if (!buf || buf.length === 0) return { ...EMPTY }

  return quietly(async () => {
    const lib = await pdfjs()
    let doc
    try {
      doc = await lib.getDocument({
        data: new Uint8Array(buf),
        useSystemFonts: true,
        disableFontFace: true,
        isEvalSupported: false, // no eval in a plugin that reads untrusted files
        stopAtErrors: false // a damaged page should not lose the whole document
      }).promise
    } catch (error) {
      if (/password|encrypt/i.test(error?.message ?? '')) {
        return { strings: [], headings: [], glyphRecall: 0, note: 'encrypted' }
      }
      return { ...EMPTY }
    }

    const strings = []
    let expected = 0
    let emitted = 0

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
        expected += item.str.length
        emitted += item.str.replace(/�/g, '').length

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
    return {
      strings,
      headings: [],
      glyphRecall: expected ? Number((emitted / expected).toFixed(3)) : 0,
      note: 'ok'
    }
  })
}
