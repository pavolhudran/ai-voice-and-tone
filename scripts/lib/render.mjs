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
 *
 * toAscii is imported from cli.mjs rather than reimplemented here: its
 * substitution table is the plugin's one definition of what ASCII output
 * means, and a second copy would be free to drift from the first. cli.mjs
 * performs no I/O at import time, so this does not weaken the guarantee
 * above.
 */
import { toAscii } from './cli.mjs'

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

/**
 * Measure the string that will actually be printed, not the one handed in.
 *
 * Widths are decided here; the ASCII fold happens later, in cli.mjs, on the
 * finished line. Any fold that changes length therefore silently breaks the
 * column it was measured for - and two of them do. Transliteration drops
 * combining marks, so a decomposed `masáže` arrives eight code units long and
 * leaves six, which matters because macOS hands out decomposed filenames.
 * An ellipsis expands to three periods and gains two.
 *
 * Folding first makes the measurement exact by construction rather than by
 * a list of exceptions kept in step by hand, and it retires the whole class
 * of bug: a future substitution that changes width cannot misalign anything,
 * because nothing is measured before it runs. The later fold in writeOut is
 * then a no-op - toAscii of ASCII is ASCII.
 */
const measurable = (text) => toAscii(text)

/** Right-pad to `width`. Longer input is returned untouched, never silently cut. */
export function pad (text, width) {
  const s = measurable(text)
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

/**
 * Elide with '...' rather than a single-character ellipsis: U+2026 would
 * become '?' under toAscii. Below four columns there is no room for the
 * marker, so the text is simply cut - a four-column budget is already a
 * layout bug, and printing '...' alone would carry no information at all.
 */
export function truncate (text, width) {
  const s = measurable(text)
  if (s.length <= width) return s
  if (width <= 3) return s.slice(0, Math.max(0, width))
  return `${s.slice(0, width - 3)}...`
}

/**
 * Truncate a path from the FRONT, keeping its tail.
 *
 * Head-truncation is right for prose and wrong for paths: everything that
 * distinguishes one source from another lives at the end. A registered folder
 * elsewhere on disk gives every row the same long prefix, so the sources panel
 * rendered twenty rows that all read
 * `/private/tmp/claude-501/-Users-pavolhudran-Sites-ai...` - twenty lines
 * saying nothing, having spent the whole column on the one part they shared.
 */
export function truncatePath (text, width) {
  const s = measurable(text)
  if (s.length <= width) return s
  if (width <= 3) return s.slice(s.length - Math.max(0, width))
  return `...${s.slice(s.length - (width - 3))}`
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

const MATRIX_CELL_WIDTH = 4

/**
 * The tone grid. `cellAt(row, col)` returns a single marker character and
 * `tallyAt(row)` the trailing 'N/8'. Both are supplied by the caller so this
 * function never learns what a tone cell is - it lays out a grid, nothing more.
 *
 * `labelWidth` and `indent` are the caller's, because the grid has to share a
 * left margin with every other panel on the screen and only the caller knows
 * what that margin is.
 */
export function matrix ({ rows, cols, cellAt, tallyAt, labelWidth = 20, indent = '' }) {
  const header = indent + ' '.repeat(labelWidth) +
    cols.map((c) => pad(c, MATRIX_CELL_WIDTH)).join('').trimEnd()
  const body = rows.map((r) => {
    const cells = cols.map((c) => pad(cellAt(r, c), MATRIX_CELL_WIDTH)).join('')
    return `${indent}${pad(truncate(r, labelWidth - 1), labelWidth)}${cells}  ${tallyAt(r)}`
  })
  return [header, ...body]
}

/** A titled block. Lines longer than the width are truncated, never wrapped. */
export function panel (title, lines, width = WIDTH) {
  return [` ${truncate(title, width - 1)}`, ...lines.map((l) => truncate(l, width))]
}

export const PANELS = [
  'pipeline', 'integrity', 'coverage', 'rules', 'drift', 'sources', 'evidence', 'settings', 'missing', 'all'
]

const STAGE_ORDER = ['scan', 'ingest', 'measure', 'draft', 'interview', 'canonize']
const SEVERITY_MARK = { blocker: '[!!]', warning: '[! ]', nit: '[. ]' }
const MAX_GAPS_SHOWN = 10

/** Words in a context's corpus at or above which it counts as trafficked. */
const TRAFFIC_FLOOR = 500

const INDENT = '   '
const SUB = '         '

// The matrix shares the screen's left margin, so its label column is narrowed
// to keep the widest row (indent + labels + 8 cells + tally) inside 60 columns.
const MATRIX_LABEL_WIDTH = 17

function borderRow (left, right, width) {
  const inner = Math.max(0, width - 2)
  const l = truncate(String(left), inner)
  const r = truncate(String(right), Math.max(0, inner - l.length - 1))
  const gap = Math.max(0, inner - l.length - r.length)
  return `|${l}${' '.repeat(gap)}${r}|`
}

function header (state, width) {
  const right = state.kb.exists
    ? `${state.kb.brand ?? '?'} | ${state.kb.profile} | kb ${state.kb.version ?? '?'} | ${(state.kb.locales ?? []).join(',')}`
    : 'no knowledge base'
  return [rule('=', width), borderRow(' VOICE & TONE : STATE', `${right} `, width), rule('=', width)]
}

function pipelinePanel (state, width) {
  const [labels, boxes] = pipeline(STAGE_ORDER, state.stage.reached)
  return panel('PIPELINE', [
    `${INDENT}${labels}`,
    `${INDENT}${boxes}`,
    `${INDENT}at: ${state.stage.at ?? 'not started'}`
  ], width)
}

function integrityPanel (state, width) {
  const lines = [`${INDENT}validate  ${state.integrity.errors} errors  ${state.integrity.warnings} warnings`]

  const card = state.freshness.card
  if (!card) lines.push(`${INDENT}card  never compiled`)
  else if (card.staleAgainst.length) {
    lines.push(`${INDENT}card  STALE - ${card.ageDays}d, behind ${card.staleAgainst.join(', ')}`)
  } else lines.push(`${INDENT}card  current (${card.ageDays}d)`)

  const manifest = state.freshness.manifest
  if (!manifest) lines.push(`${INDENT}scan  never run`)
  else {
    lines.push(`${INDENT}scan  ${manifest.ageDays}d old, ${manifest.changedSince} of ${manifest.checked} files changed`)
    lines.push(`${SUB}new files not detected - use --refresh`)
  }
  return panel('INTEGRITY', lines, width)
}

function coveragePanel (state, width) {
  const { authored, possible, byContext } = state.coverage
  const states = state.coverage.states ?? []
  // Three letters is enough to keep all eight distinct, so no abbreviation
  // table has to be maintained alongside kb.mjs's STATES.
  const cols = states.map((s) => s.slice(0, 3))
  const gatedIndexes = (state.coverage.humorGated ?? []).map((s) => states.indexOf(s)).filter((i) => i >= 0)

  const rows = byContext.map((c) => c.context)
  const byName = new Map(byContext.map((c) => [c.context, c]))
  const pct = possible ? Math.round((authored / possible) * 100) : 0

  const grid = matrix({
    rows,
    cols,
    labelWidth: MATRIX_LABEL_WIDTH,
    indent: INDENT,
    cellAt: (r, c) => {
      const entry = byName.get(r)
      return entry.cells[cols.indexOf(c)] === 'authored' ? '#' : '.'
    },
    tallyAt: (r) => {
      const entry = byName.get(r)
      const hot = entry.authored === 0 && entry.traffic >= TRAFFIC_FLOOR
      return `${entry.authored}/${entry.of}${hot ? ' !' : ''}`
    }
  })

  const lines = [...grid]
  if (gatedIndexes.length) {
    const start = INDENT.length + MATRIX_LABEL_WIDTH + Math.min(...gatedIndexes) * 4
    const span = Math.max(1, gatedIndexes.length * 4 - 1)
    lines.push(`${' '.repeat(start)}${'^'.repeat(span)}`)
    lines.push(`${' '.repeat(start)}humor forced to 0`)
  }
  lines.push('')
  lines.push(`${INDENT}# authored   . computed`)
  lines.push(`${INDENT}a computed cell is never humorous, whatever the dials say`)
  lines.push(`${INDENT}! corpus traffic, no authored cells`)

  return panel(`TONE MATRIX          ${authored} of ${possible} authored (${pct}%)`, lines, width)
}

const CONFIDENCE_NOTE = {
  confirmed: 'blocks in review',
  derived: 'warns',
  assumed: 'nit',
  disputed: 'never enforced'
}

function rulesPanel (state, width) {
  const counts = state.rules.byConfidence
  const max = Math.max(1, ...Object.values(counts))
  const barWidth = Math.max(8, Math.min(20, width - 40))
  const lines = Object.entries(counts).map(([level, count]) =>
    `${INDENT}${pad(level, 11)}${bar(count, max, barWidth)}  ${pad(String(count), 4)}${CONFIDENCE_NOTE[level] ?? ''}`)
  return panel(`RULES  ${state.rules.total} total`, lines, width)
}

function driftPanel (state, width) {
  const barWidth = Math.max(5, Math.min(16, width - 55))
  const lines = []
  const locales = Object.entries(state.drift.byLocale)
  if (locales.length === 0) lines.push(`${INDENT}no fingerprint yet - nothing to compare`)

  const moveOf = (metric) =>
    metric.from === null || metric.to === null ? '-' : `${metric.from} -> ${metric.to}`

  // The move column is measured, not fixed. 'mean sentence 10.94 -> 10.94' is
  // exactly 14 characters, so a hard 14 leaves no separating space and the
  // value fuses into the delta - '10.94' and '0%' render as '10.940%', which
  // reads as a single number. This is the same failure the label column above
  // already guards against, one column over. Widening on demand keeps the
  // familiar 14 for ordinary data and never lets the two fields touch.
  const moveWidth = Math.max(
    14,
    ...locales.flatMap(([, value]) => (value.metrics ?? []).map((metric) => moveOf(metric).length + 1))
  )

  for (const [locale, value] of locales) {
    if (value.baseline === null) {
      lines.push(`${INDENT}${pad(locale, 5)}no baseline - drift cannot be measured here`)
      continue
    }
    lines.push(`${INDENT}${pad(locale, 5)}baseline ${String(value.baseline).slice(0, 10)}`)
    for (const metric of value.metrics) {
      const move = moveOf(metric)
      const shown = metric.deltaPct === null ? 'n/a' : `${metric.deltaPct > 0 ? '+' : ''}${metric.deltaPct}%`
      // The label column is 18 wide, not 16: 'contractions /1k' is exactly 16
      // and would butt straight against the numbers with no separating space.
      //
      // FLAG sits BEFORE the bar. At the narrowest supported width the line
      // has to give something up, and the bar is decoration while the flag is
      // the finding - trailing it would truncate away the one word a reader
      // scans this panel for.
      lines.push(
        `${SUB}${pad(metric.label, 18)}${pad(move, moveWidth)}${pad(shown, 7)}` +
        `${pad(metric.flagged ? 'FLAG' : '', 5)}${deltaBar(metric.deltaPct, barWidth)}`
      )
    }
  }
  return panel(`DRIFT  threshold ${state.drift.thresholdPct}%`, lines, width)
}

function sourcesPanel (state, width) {
  const s = state.sources
  const lines = []
  const SHOWN = 20
  const originWidth = Math.max(8, width - 44)
  for (const entry of s.entries.slice(0, SHOWN)) {
    lines.push(
      `${INDENT}${pad(entry.id ?? '?', 5)}${pad(entry.kind ?? '?', 9)}` +
      `${pad(truncatePath(entry.origin ?? '', originWidth), originWidth + 1)}` +
      `${pad(entry.status ?? '', 9)}${entry.fidelity ?? ''}`
    )
  }
  // Say that the list was cut. Twenty rows and then nothing reads as the whole
  // index, which is wrong the moment a real corpus is registered.
  if (s.entries.length > SHOWN) {
    lines.push(`${INDENT}... and ${s.entries.length - SHOWN} more (${s.entries.length} entries in total)`)
  }
  if (s.unindexed > 0) lines.push(`${INDENT}${s.unindexed} registered file(s) NOT INGESTED`)
  lines.push(s.freshness === 'checked'
    ? `${INDENT}freshness checked: ${s.stale} stale, ${s.fresh} new`
    : `${INDENT}freshness not checked (read-only) - run --refresh`)

  return panel(
    `SOURCES  ${s.registered} reg | ${s.analysed} analysed | ${s.missing} missing | ${s.unindexed} not ingested`,
    lines,
    width
  )
}

function evidencePanel (state, width) {
  const e = state.evidence
  const types = Object.entries(e.byType).map(([type, count]) => `${type} ${count}`).join('  ')
  return panel(`EVIDENCE  ${e.total} entries`, [
    `${INDENT}${types || 'none yet'}`,
    `${INDENT}conflicts open   ${e.conflicts}`,
    `${INDENT}drafts pending   ${e.drafts}`
  ], width)
}

function settingsPanel (state, width) {
  const t = state.settings.thresholds ?? {}
  const kinds = {}
  for (const entry of state.settings.register ?? []) kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1
  const register = Object.entries(kinds).map(([kind, n]) => `${n} ${kind}`).join(', ')

  return panel('SETTINGS', [
    `${INDENT}${pad('profile', 15)}${state.kb.profile}  "${state.kb.brand ?? ''}"`,
    `${INDENT}${pad('locales', 15)}${(state.kb.locales ?? []).join(', ')} (primary ${state.kb.primaryLocale})`,
    `${INDENT}${pad('thresholds', 15)}corroboration ${t.corroboration}  samples ${t.derived_min_samples}`,
    `${INDENT}${pad('', 15)}stale_months ${t.stale_months}  drift_pct ${t.drift_pct}`,
    `${INDENT}${pad('runtime', 15)}node ${state.settings.runtime?.node ?? '?'}`,
    `${INDENT}${pad('vendor', 15)}${(state.settings.vendor ?? []).map((v) => `${v.name} ${v.version}`).join('  ')}`,
    `${INDENT}${pad('register', 15)}${state.settings.register?.length ?? 0} entries: ${register || 'none'}`,
    `${INDENT}${pad('kb path', 15)}${state.kb.root}`
  ], width)
}

function missingPanel (state, width) {
  const gaps = state.gaps ?? []
  if (gaps.length === 0) return panel('MISSING  nothing - the knowledge base is complete and current', [], width)

  const lines = []
  for (const [index, gap] of gaps.slice(0, MAX_GAPS_SHOWN).entries()) {
    lines.push(`${INDENT}${index + 1} ${SEVERITY_MARK[gap.severity] ?? '[  ]'} ${gap.what}`)
    lines.push(`          ${gap.why}`)
    if (gap.fix) lines.push(`          -> ${gap.fix}`)
  }
  if (gaps.length > MAX_GAPS_SHOWN) lines.push(`${INDENT}+${gaps.length - MAX_GAPS_SHOWN} more`)

  return panel(`MISSING  ${gaps.length} gap(s), highest leverage first`, lines, width)
}

function menu (width, { initOnly = false } = {}) {
  if (initOnly) {
    return [
      rule('-', width),
      borderRow(' /voice-and-tone:init', 'discover, measure, interview ', width),
      rule('-', width)
    ]
  }
  return [
    rule('-', width),
    borderRow(' 1 coverage  2 drift  3 rules  4 sources  5 evidence', '', width),
    borderRow(' 6 settings  7 missing  8 all', 'q done ', width),
    rule('-', width)
  ]
}

const PANEL_FN = {
  pipeline: pipelinePanel,
  integrity: integrityPanel,
  coverage: coveragePanel,
  rules: rulesPanel,
  drift: driftPanel,
  sources: sourcesPanel,
  evidence: evidencePanel,
  settings: settingsPanel,
  missing: missingPanel
}

/**
 * The single exit point. toAscii runs BEFORE the width trim, never after:
 * it can lengthen a string (an ellipsis becomes three dots), so sanitising
 * afterwards could push a line past the width the caller asked for.
 *
 * Imported from cli.mjs rather than reimplemented - the substitution table is
 * the plugin's one definition of what ASCII output means, and a second copy
 * of it would be free to drift from the first.
 */
function finish (lines, width) {
  return `${lines.map((line) => truncate(toAscii(line), width)).join('\n')}\n`
}

export function render (state, { panel: name = 'all', width = WIDTH } = {}) {
  if (!PANELS.includes(name)) throw new Error(`unknown panel "${name}"; valid: ${PANELS.join(', ')}`)
  const w = clampWidth(width)

  // A knowledge base that does not exist gets the one screen that helps: the
  // pipeline (all unreached), the single gap, and the command that fixes it.
  // Rendering an empty 80-cell matrix teaches nothing and fills the terminal.
  if (!state.kb.exists) {
    return finish([
      ...header(state, w),
      '',
      ...pipelinePanel(state, w),
      '',
      ' There is no .voice-and-tone/ in this project.',
      '',
      ...missingPanel(state, w),
      '',
      ...menu(w, { initOnly: true })
    ], w)
  }

  const blocks = name === 'all'
    ? PANELS.filter((p) => p !== 'all').map((p) => PANEL_FN[p](state, w))
    : [PANEL_FN[name](state, w)]

  return finish([...header(state, w), '', ...blocks.flatMap((lines) => [...lines, '']), ...menu(w, {})], w)
}
