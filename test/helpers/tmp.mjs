import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Create a throwaway project directory seeded with files.
 * @param {Record<string, string>} files - relative POSIX-ish path -> contents
 * @returns {string} absolute path to the new directory
 */
export function makeTmpProject (files = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vat-'))
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'))
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, contents, 'utf8')
  }
  return dir
}

export function cleanup (dir) {
  rmSync(dir, { recursive: true, force: true })
}
