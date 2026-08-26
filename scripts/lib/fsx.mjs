import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { matchesAny } from './glob.mjs'

/** Filesystem paths use path.sep; glob matching uses POSIX. This bridges them. */
export function toPosix (p) {
  return String(p).split(path.sep).join('/').split('\\').join('/')
}

const PROBE = '__vat_probe__'

// A directory is pruned in two distinct ways, judged by what a pattern's
// FINAL segment looks like:
//
// 1. A literal final segment names the directory itself, contents included
//    (bare "dist", or "**/node_modules" naming any directory called
//    node_modules at any depth). A direct match of such a pattern against
//    this directory's own path is grounds to prune the whole subtree.
//
// 2. A wildcard final segment (e.g. the "*" in "docs/*", or the "**" in
//    "node_modules/**") selects *among* a directory's children rather than
//    naming the directory itself, so it excludes those children -- not the
//    subtrees beneath them. Whether such a pattern still blankets this
//    subtree is judged by depth instead: it must match not just one level
//    below this directory but two, probed with a sentinel child at each
//    depth. A depth-limited pattern like "docs/*" matches the shallow probe
//    but not the deep one, so it does NOT prune -- it falls through to the
//    per-file exclude check in walk() instead. A blanket pattern like
//    "node_modules/**" matches both probes and does prune.
//
// The two rules must be kept separate in both directions: treating a
// wildcard-final-segment pattern's direct string match as prune-worthy would
// wrongly prune a real subdirectory that happens to look like one of the
// selected children (e.g. "docs/*" against the literal path "docs/sub").
// Conversely, treating a literal-final-segment pattern ("**/node_modules")
// as needing the two-probe depth match would wrongly leave it unpruned --
// neither probe ends in the literal "node_modules" tail, so the files
// beneath it would silently leak into the scanned corpus instead.
const namesADirectory = (pattern) => !/[*?]/.test(pattern.split('/').pop())

function isPrunedDir (relPosix, exclude) {
  if (matchesAny(relPosix, exclude.filter(namesADirectory))) return true
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
