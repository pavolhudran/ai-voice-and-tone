/**
 * Tiny glob matcher. Patterns and paths are always POSIX-separated; callers
 * convert with fsx.toPosix first (spec section 9 forbids literal separators in
 * constructed paths, and forbids shelling out to find).
 *
 * Supported: * (within one segment), ** (across segments), ?, {a,b} alternation.
 */

const REGEX_SPECIALS = /[.+^$()|[\]\\]/g

export function globToRegExp (pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // "**/" may match zero segments, so "content/**/*.md" also matches
        // "content/a.md". A bare "**" matches anything including separators.
        if (pattern[i + 2] === '/') { out += '(?:[^/]*\\/)*'; i += 2 } else { out += '.*'; i += 1 }
      } else {
        out += '[^/]*'
      }
      continue
    }
    if (ch === '?') { out += '[^/]'; continue }
    if (ch === '{') {
      const close = pattern.indexOf('}', i)
      if (close !== -1) {
        const alts = pattern.slice(i + 1, close).split(',')
        out += `(?:${alts.map((a) => a.replace(REGEX_SPECIALS, '\\$&')).join('|')})`
        i = close
        continue
      }
    }
    out += ch.replace(REGEX_SPECIALS, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

export function matchesAny (relPosixPath, patterns) {
  for (const pattern of patterns) {
    if (globToRegExp(pattern).test(relPosixPath)) return true
  }
  return false
}
