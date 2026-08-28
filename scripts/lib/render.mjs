/**
 * ASCII rendering for the status dashboard.
 *
 * Pure string functions, no filesystem access of any kind - test/render.test.mjs
 * asserts the absence of a node:fs import. The collector (lib/state.mjs) owns
 * every read; a renderer that could read a file could render something the
 * state object never carried, which is the exact drift that making the
 * dashboard generated rather than drawn exists to prevent.
 *
 * The palette is constrained by scripts/lib/cli.mjs's toAscii(), which
 * replaces every non-ASCII byte with '?'. Box-drawing characters are not
 * available - '+', '-', '|' and '=' are the whole vocabulary for structure.
 */

export const WIDTH = 72
export const MIN_WIDTH = 60
export const MAX_WIDTH = 120

export function clampWidth (n) {
  if (!Number.isInteger(n)) return WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n))
}

/** '+========+' - a horizontal rule of exactly `width` columns. */
export function rule (char = '-', width = WIDTH) {
  const inner = Math.max(0, width - 2)
  return `+${String(char)[0].repeat(inner)}+`
}

/** Right-pad to `width`. Longer input is returned untouched, never silently cut. */
export function pad (text, width) {
  const s = String(text)
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

/**
 * Elide with '...' rather than a single-character ellipsis: U+2026 would
 * become '?' under toAscii. Below four columns there is no room for the
 * marker, so the text is simply cut - a four-column budget is already a
 * layout bug, and printing '...' alone would carry no information at all.
 */
export function truncate (text, width) {
  const s = String(text)
  if (s.length <= width) return s
  if (width <= 3) return s.slice(0, Math.max(0, width))
  return `${s.slice(0, width - 3)}...`
}

/**
 * A proportional bar. A value above max saturates and a max of zero renders
 * empty: both are ordinary states here (no rules yet, no sources yet), and
 * neither may produce NaN padding or a bar that overruns its column.
 */
export function bar (value, max, width, { fill = '#', empty = ' ' } = {}) {
  const w = Math.max(0, width)
  if (!(max > 0)) return empty.repeat(w)
  const ratio = Math.max(0, Number(value) || 0) / max
  const filled = Math.min(w, Math.round(ratio * w))
  return fill.repeat(filled) + empty.repeat(w - filled)
}

/**
 * 'left            right' - right-hand value flush to `width`. When the two
 * cannot both fit, the left is truncated rather than the line overrunning:
 * the right-hand side is always the number, and a number pushed off the
 * screen is worse than a shortened label.
 */
export function row (left, right, width) {
  const r = String(right)
  const budget = Math.max(0, width - r.length - 1)
  const l = truncate(String(left), budget)
  return pad(l, budget + 1) + r
}
