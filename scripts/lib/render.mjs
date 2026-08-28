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

/**
 * A centre-less magnitude bar: length is the size of the change, and the
 * glyph carries its direction ('>' grew, '<' shrank). 100 percent fills the
 * bar and anything beyond saturates, because a 4000 percent delta and a 400
 * percent delta are both simply "enormous" and neither deserves more pixels.
 *
 * A null pct is NOT an empty bar. Null means the arithmetic was undefined - a
 * zero baseline, or a metric present on one side only - and an empty bar reads
 * as "no drift", a materially different and far more comforting claim.
 */
export function deltaBar (pct, width) {
  const w = Math.max(0, width)
  if (pct === null || pct === undefined) {
    const label = 'n/a'
    const left = Math.max(0, Math.floor((w - label.length) / 2))
    return `[${' '.repeat(left)}${label}${' '.repeat(Math.max(0, w - left - label.length))}]`
  }
  const glyph = pct < 0 ? '<' : '>'
  const filled = Math.min(w, Math.round((Math.abs(pct) / 100) * w))
  return `[${glyph.repeat(filled)}${' '.repeat(w - filled)}]`
}

/**
 * Abbreviated so all six stages fit across 72 columns. The pipeline strip is
 * the first thing read on the screen and has to survive the narrowest
 * supported width without wrapping.
 */
const STAGE_LABEL = {
  scan: 'scan', ingest: 'ingst', measure: 'meas', draft: 'draft', interview: 'intvw', canonize: 'canon'
}

/** Two lines: the stage names, and the filled/dotted boxes beneath them. */
export function pipeline (stages, reached) {
  const labels = []
  const boxes = []
  for (const stage of stages) {
    const label = STAGE_LABEL[stage] ?? stage
    const cell = reached[stage] ? '[##]' : '[..]'
    const cellWidth = Math.max(label.length, cell.length) + 2
    labels.push(pad(label, cellWidth))
    boxes.push(pad(cell, cellWidth))
  }
  return [labels.join('').trimEnd(), boxes.join('').trimEnd()]
}

const MATRIX_LABEL_WIDTH = 20
const MATRIX_CELL_WIDTH = 4

/**
 * The tone grid. `cellAt(row, col)` returns a single marker character and
 * `tallyAt(row)` the trailing 'N/8'. Both are supplied by the caller so this
 * function never learns what a tone cell is - it lays out a grid, nothing more.
 */
export function matrix ({ rows, cols, cellAt, tallyAt }) {
  const header = ' '.repeat(MATRIX_LABEL_WIDTH) +
    cols.map((c) => pad(c, MATRIX_CELL_WIDTH)).join('').trimEnd()
  const body = rows.map((r) => {
    const cells = cols.map((c) => pad(cellAt(r, c), MATRIX_CELL_WIDTH)).join('')
    return `${pad(truncate(r, MATRIX_LABEL_WIDTH - 1), MATRIX_LABEL_WIDTH)}${cells}  ${tallyAt(r)}`
  })
  return [header, ...body]
}

/** A titled block. Lines longer than the width are truncated, never wrapped. */
export function panel (title, lines, width = WIDTH) {
  return [` ${truncate(title, width - 1)}`, ...lines.map((l) => truncate(l, width))]
}
