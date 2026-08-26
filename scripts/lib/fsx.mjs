import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { matchesAny } from './glob.mjs'

/** Filesystem paths use path.sep; glob matching uses POSIX. This bridges them. */
export function toPosix (p) {
  return String(p).split(path.sep).join('/').split('\\').join('/')
}

const PROBE = '__vat_probe__'
const HAS_WILDCARD = /[*?{]/

// A directory is pruned in two distinct ways:
//
// 1. A literal, wildcard-free pattern (e.g. bare "dist" or "node_modules")
//    can only ever denote one exact path, so a direct match against this
//    directory's own path is unambiguous grounds to prune the whole subtree.
//
// 2. A pattern containing a wildcard is checked by depth instead: prune only
//    when it matches arbitrarily deep beneath this directory, probed at two
//    depths. A depth-limited pattern like "docs/*" matches the shallow probe
//    but not the deep one, so it does NOT prune -- it falls through to the
//    per-file exclude check in walk() instead.
//
// The two must be kept separate: a wildcard pattern like "docs/*" also
// matches the literal path of any real subdirectory that happens to sit one
// level below it (e.g. "docs/sub"), purely by string coincidence. Treating
// that coincidence as prune-worthy (as a single direct-match check does)
// wrongly deletes docs/sub/keep.md from the corpus. Restricting the direct
// full-path match to wildcard-free patterns avoids that false prune while
// still letting bare directory names work.
function isPrunedDir (relPosix, exclude) {
  const literalHit = exclude.some((pattern) => !HAS_WILDCARD.test(pattern) && matchesAny(relPosix, [pattern]))
  if (literalHit) return true
  return matchesAny(`${relPosix}/${PROBE}`, exclude) &&
         matchesAny(`${relPosix}/${PROBE}/${PROBE}`, exclude)
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
