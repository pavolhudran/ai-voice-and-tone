import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/**
 * Content hashing. A source's identity is its bytes, never its path.
 *
 * Because sources are deliberately not committed (spec D2), the same document
 * sits at a different path on every machine. Keying the index by hash is what
 * lets one person's `~/Downloads/guide.pdf` be recognised as the file another
 * person already analysed from `<KB>/sources/guide.pdf`.
 */
export function sha256Buffer (buf) {
  return createHash('sha256').update(buf).digest('hex')
}

export function sha256Text (text) {
  return sha256Buffer(Buffer.from(String(text), 'utf8'))
}

/** Reads raw bytes. No encoding argument: a PDF is not text. */
export function sha256File (abs) {
  return sha256Buffer(readFileSync(abs))
}
