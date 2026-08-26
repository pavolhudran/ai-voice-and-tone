import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { matchesAny } from './glob.mjs'

/** Filesystem paths use path.sep; glob matching uses POSIX. This bridges them. */
export function toPosix (p) {
  return String(p).split(path.sep).join('/').split('\\').join('/')
}

// A directory is pruned when an exclude pattern would match anything inside it.
// Probing with a sentinel child generalizes to "dist/**", "**/node_modules/**",
// and anything else, without special-casing pattern shapes.
function isPrunedDir (relPosix, exclude) {
  return matchesAny(`${relPosix}/__vat_probe__`, exclude) || matchesAny(relPosix, exclude)
}

export function walk (rootDir, { include = [], exclude = [] } = {}) {
  if (include.length === 0) return []
  const found = []

  const visit = (absDir, relPosix) => {
    let entries
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return // unreadable directory is not fatal to a scan
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue // spec section 9: no symlinks
      const childRel = relPosix ? `${relPosix}/${entry.name}` : entry.name
      const childAbs = path.join(absDir, entry.name)
      if (entry.isDirectory()) {
        if (isPrunedDir(childRel, exclude)) continue
        visit(childAbs, childRel)
        continue
      }
      if (!entry.isFile()) continue
      if (matchesAny(childRel, exclude)) continue
      if (!matchesAny(childRel, include)) continue
      found.push({ abs: childAbs, rel: childRel })
    }
  }

  visit(rootDir, '')
  found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return found.map((f) => f.abs)
}

export function readTextFile (abs) {
  const raw = readFileSync(abs, 'utf8')
  return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

export function writeTextFile (abs, contents) {
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, String(contents).replace(/\r\n?/g, '\n'), 'utf8')
}
