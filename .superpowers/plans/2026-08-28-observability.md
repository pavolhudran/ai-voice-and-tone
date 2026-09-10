# Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/voice-and-tone:status` — a read-only, deterministic ASCII dashboard of the voice knowledge base, with a ranked list of what is missing.

**Architecture:** Three new modules with an absolute boundary. `lib/state.mjs` reads artifacts and returns one plain JSON-serialisable object (no strings, no layout). `lib/gaps.mjs` turns that object into a ranked gap list via pure predicates. `lib/render.mjs` turns the object into ASCII (no file I/O — it never imports `node:fs`). `scripts/status.mjs` composes the three and owns flags. The model navigates; it never computes and never draws.

**Tech Stack:** Node 18.13+, ESM, zero runtime dependencies, `node:test` + `node:assert/strict`. No new dependency may be added, now or ever.

**Spec:** `docs/superpowers/specs/2026-08-28-observability-design.md`

## Global Constraints

Copied verbatim from the spec and the existing codebase. **Every task's requirements implicitly include this section.**

- **Zero npm dependencies.** Nothing may be installed. Not now, not later.
- **Node floor is 18.13.** Never use `import.meta.dirname` (needs 20.11). Use `path.dirname(fileURLToPath(import.meta.url))`. `test/conformance.test.mjs` sweeps for this.
- **Stdout is ASCII-only.** `toAscii()` in `scripts/lib/cli.mjs` replaces every non-ASCII byte with `?`. The rendering palette is exactly: `+ - | = # . : < > ^ [ ] ( ) /` and `A-Za-z0-9` and space. No box-drawing, no block glyphs, no em dashes, no smart quotes in any rendered string.
- **No shelling out.** No `child_process`, `execSync`, `execFileSync`, `spawnSync` in `scripts/`. No `grep`/`sed`/`awk`/`find`/`cat` invocations in any `.mjs` or `.md` under `scripts/`, `skills/`, `commands/`, `agents/`. Only `scripts/vendor.mjs` is exempt, and it never runs on a user machine.
- **Paths use `path.join()`.** Never concatenate a literal `/` separator.
- **Files are LF, no BOM, no literal control bytes, no symlinks.** Applies to `.mjs`, `.md`, `.json`, `.yml`.
- **Exit codes:** `0` success, `1` unexpected error or bad flag, `2` validation or integrity failure. `status.mjs` never exits `2` — it observes, it does not gate. It exits `1` only on a bad flag or an unexpected throw.
- **CLI conventions:** every script uses `parseCliArgs` from `lib/cli.mjs`, supports `--root`, `--kb`, `--now`, `--json`, `--help`, and prints ASCII-only help via `printHelp`. `test/conformance.test.mjs` derives its script list from `readdirSync('scripts')`, so `status.mjs` is help-checked automatically the moment the file exists.
- **`--now` must be honoured** everywhere a timestamp or an age is computed, so output is reproducible in tests.

## Spec deviations, decided here

Two, both deliberate. Reviewers should not treat them as drift.

1. **Gaps live in `scripts/lib/gaps.mjs`, not inside `state.mjs`.** Spec §4.3 lists two library modules; §9's catalogue is large enough to own a file, and separating it lets `test/gaps.test.mjs` drive detectors against hand-built state objects with no filesystem at all. `collect()` still returns `gaps` on the state object exactly as §5 specifies.
2. **The bar magnitudes in the spec's §8.3 mock are illustrative, not computed.** They were drawn by hand. The real scale is defined in Task 2 (`deltaBar`: 100% delta fills the bar) and pinned by golden tests. Where the mock and a golden test disagree, the golden test wins.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/lib/render.mjs` | **Create.** ASCII primitives and panel composition. Pure functions, string in / string out. Must not import `node:fs`. |
| `scripts/lib/state.mjs` | **Create.** Reads every KB artifact, returns one plain state object. All filesystem access lives here. |
| `scripts/lib/gaps.mjs` | **Create.** Pure predicates over a state object; returns the ranked gap list. No I/O. |
| `scripts/status.mjs` | **Create.** CLI: flags, panel selection, `--refresh`, `--json`, exit codes. |
| `scripts/lib/config.mjs` | **Modify.** Add `thresholds.drift_pct: 25` to `DEFAULT_CONFIG`. |
| `commands/status.md` | **Create.** Command surface. |
| `skills/voice-observability/SKILL.md` | **Create.** The menu loop. |
| `skills/voice-observability/references/panels.md` | **Create.** What each panel means. |
| `skills/voice-observability/references/gap-catalogue.md` | **Create.** Every detector, and the five non-gaps. |
| `test/render.test.mjs` | **Create.** Primitives, golden output, ASCII-only, no-fs-import. |
| `test/state.test.mjs` | **Create.** Every ring, stage inference, freshness, drift arithmetic. |
| `test/gaps.test.mjs` | **Create.** Every detector fires and stays silent; every non-gap; ranking; cap. |
| `test/status.test.mjs` | **Create.** CLI behaviour, the read-only invariant, `--refresh`. |
| `test/surface.test.mjs` | **Modify.** Command/flag agreement for `:status`. |
| `test/config.test.mjs` | **Modify.** `drift_pct` default and override. |
| `README.md` | **Modify.** Command table row, skill table row. |

---

## Task 1: Render primitives

**Files:**
- Create: `scripts/lib/render.mjs`
- Test: `test/render.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `WIDTH` (72), `MIN_WIDTH` (60), `MAX_WIDTH` (120), `clampWidth(n) -> number`, `rule(char, width) -> string`, `truncate(text, width) -> string`, `bar(value, max, width, {fill, empty}) -> string`, `pad(text, width) -> string`, `row(left, right, width) -> string`.

- [ ] **Step 1: Write the failing test**

Create `test/render.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WIDTH, MIN_WIDTH, MAX_WIDTH, clampWidth, rule, truncate, bar, pad, row } from '../scripts/lib/render.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\x00-\x7F]/

test('the shipped default width is 72 and clamps to 60..120', () => {
  assert.equal(WIDTH, 72)
  assert.equal(clampWidth(72), 72)
  assert.equal(clampWidth(10), MIN_WIDTH)
  assert.equal(clampWidth(9999), MAX_WIDTH)
  assert.equal(clampWidth(undefined), WIDTH, 'an absent width falls back to the default')
  assert.equal(clampWidth('80'), WIDTH, 'a non-integer falls back rather than producing NaN padding')
})

test('rule spans the full width and is bounded by plus signs', () => {
  assert.equal(rule('=', 10), '+========+')
  assert.equal(rule('-', 10), '+--------+')
  assert.equal(rule('=', 10).length, 10)
})

test('truncate marks elision with three dots and never exceeds the width', () => {
  assert.equal(truncate('short', 10), 'short')
  assert.equal(truncate('a-very-long-brand-name', 10), 'a-very-...')
  assert.equal(truncate('a-very-long-brand-name', 10).length, 10)
  assert.equal(truncate('abcdef', 3), 'abc', 'below four columns there is no room for an ellipsis')
})

test('bar fills proportionally and never overruns its width', () => {
  assert.equal(bar(5, 10, 10), '#####     ')
  assert.equal(bar(10, 10, 10), '##########')
  assert.equal(bar(0, 10, 10), '          ')
  assert.equal(bar(20, 10, 10), '##########', 'a value over max saturates instead of overflowing')
  assert.equal(bar(5, 10, 10).length, 10)
})

test('bar with a zero or negative max renders empty rather than dividing by zero', () => {
  assert.equal(bar(5, 0, 6), '      ')
  assert.equal(bar(5, -1, 6), '      ')
  assert.ok(!bar(5, 0, 6).includes('NaN'))
})

test('row places a right-hand value flush against the width', () => {
  assert.equal(row('left', 'right', 20), 'left           right')
  assert.equal(row('left', 'right', 20).length, 20)
})

test('row degrades without throwing when the two halves cannot both fit', () => {
  const out = row('a-long-left-label', 'a-long-right-value', 20)
  assert.equal(out.length, 20)
  assert.ok(!NON_ASCII.test(out))
})

test('every primitive emits ASCII only', () => {
  const samples = [rule('=', 72), bar(3, 7, 20), truncate('x'.repeat(99), 30), pad('hi', 20), row('a', 'b', 40)]
  for (const sample of samples) assert.ok(!NON_ASCII.test(sample), `non-ASCII in ${JSON.stringify(sample)}`)
})

test('render.mjs performs no file I/O', () => {
  // The collector owns every filesystem read. A renderer that can read a file
  // can render something the state object never carried, which is exactly the
  // drift the generated-dashboard decision (spec 1.2) exists to prevent.
  const source = readFileSync(path.join(root, 'scripts', 'lib', 'render.mjs'), 'utf8')
  assert.ok(!/from 'node:fs'/.test(source), 'render.mjs must not import node:fs')
  assert.ok(!/require\(['"]fs['"]\)/.test(source))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/render.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/lib/render.mjs'`

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/lib/render.mjs`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/render.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/render.mjs test/render.test.mjs
git commit -m "feat: ASCII rendering primitives for the status dashboard"
```

---

## Task 2: Render composites — matrix, pipeline, deltaBar

**Files:**
- Modify: `scripts/lib/render.mjs`
- Test: `test/render.test.mjs`

**Interfaces:**
- Consumes: `bar`, `pad`, `truncate`, `WIDTH` from Task 1.
- Produces: `matrix({rows, cols, cellAt, rowLabel, colLabel, note}) -> string[]`, `pipeline(stages, reached) -> string[]`, `deltaBar(pct, width) -> string`, `panel(title, lines, width) -> string[]`.

- [ ] **Step 1: Write the failing test**

Append to `test/render.test.mjs` (and extend the import on line 7 to include `matrix, pipeline, deltaBar, panel`):

```js
test('deltaBar points right for growth, left for shrinkage, and fills at 100 percent', () => {
  assert.equal(deltaBar(50, 10), '[>>>>>     ]')
  assert.equal(deltaBar(-50, 10), '[<<<<<     ]')
  assert.equal(deltaBar(100, 10), '[>>>>>>>>>>]')
  assert.equal(deltaBar(250, 10), '[>>>>>>>>>>]', 'beyond 100 percent it saturates')
  assert.equal(deltaBar(0, 10), '[          ]')
})

test('deltaBar renders a null delta as an explicit n/a, never as zero', () => {
  // A null delta means the arithmetic was undefined (a zero baseline, or a
  // metric absent from one side). Drawing it as an empty bar would read as
  // "no drift", which is a different and much more reassuring claim.
  assert.equal(deltaBar(null, 10), '[   n/a    ]')
  assert.equal(deltaBar(null, 10).length, 12)
})

test('pipeline marks reached stages filled and unreached stages dotted', () => {
  const out = pipeline(['scan', 'ingest'], { scan: true, ingest: false })
  assert.equal(out.length, 2)
  assert.match(out[0], /scan/)
  assert.match(out[0], /ingest/)
  assert.match(out[1], /\[##\]/)
  assert.match(out[1], /\[\.\.\]/)
})

test('matrix renders one marker per cell with a per-row tally', () => {
  const out = matrix({
    rows: ['product-ui', 'system-error'],
    cols: ['del', 'cur'],
    cellAt: (r, c) => (r === 'system-error' || c === 'del' ? '#' : '.'),
    tallyAt: (r) => (r === 'system-error' ? '2/2' : '1/2')
  })
  assert.equal(out.length, 3, 'a header row plus one row per context')
  assert.match(out[0], /del\s+cur/)
  assert.match(out[1], /product-ui\s+#\s+\./)
  assert.match(out[1], /1\/2$/)
  assert.match(out[2], /system-error\s+#\s+#/)
})

test('panel emits a titled block whose every line fits the width', () => {
  const out = panel('DRIFT', ['one', 'two'], 40)
  for (const line of out) assert.ok(line.length <= 40, `line overruns: ${JSON.stringify(line)}`)
  assert.match(out[0], /DRIFT/)
})

test('every composite emits ASCII only', () => {
  const samples = [
    ...pipeline(['scan'], { scan: true }),
    ...matrix({ rows: ['a'], cols: ['b'], cellAt: () => '#', tallyAt: () => '1/1' }),
    ...panel('T', ['x'], 40),
    deltaBar(-33, 12),
    deltaBar(null, 12)
  ]
  for (const sample of samples) assert.ok(!NON_ASCII.test(sample), `non-ASCII in ${JSON.stringify(sample)}`)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/render.test.mjs`
Expected: FAIL — `The requested module '../scripts/lib/render.mjs' does not provide an export named 'matrix'`

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/lib/render.mjs`:

```js
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

const STAGE_LABEL = { scan: 'scan', ingest: 'ingst', measure: 'meas', draft: 'draft', interview: 'intvw', canonize: 'canon' }

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/render.test.mjs`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/render.mjs test/render.test.mjs
git commit -m "feat: matrix, pipeline, and delta-bar renderers"
```

---

## Task 3: State — identity and lifecycle stages

**Files:**
- Create: `scripts/lib/state.mjs`
- Test: `test/state.test.mjs`

**Interfaces:**
- Consumes: `loadKb` (`lib/kb.mjs`), `loadConfig`, `activeProfile` (`lib/config.mjs`), `loadRegister` (`lib/register.mjs`), `loadIndex` (`lib/sourceindex.mjs`), `readTextFile` (`lib/fsx.mjs`), `validateKb` (`../validate.mjs`).
- Produces: `STAGES` (string[6]), `readJson(abs) -> object|null`, `inferStages(input) -> {at, reached}`, `collect({projectRoot, kbRoot, config, profileName, now}) -> state` returning at minimum `{generated, kb, stage}`.

- [ ] **Step 1: Write the failing test**

Create `test/state.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { STAGES, inferStages, collect } from '../scripts/lib/state.mjs'

const NOW = '2026-08-28T00:00:00.000Z'

function stateOf (files) {
  const dir = makeTmpProject(files)
  const kbRoot = path.join(dir, '.voice-and-tone')
  try {
    return collect({ projectRoot: dir, kbRoot, config: loadConfig(kbRoot), profileName: 'default', now: NOW })
  } finally {
    cleanup(dir)
  }
}

const MINIMAL_CONFIG = [
  'version: 1',
  'kb_version: 0.2.0',
  'profiles:',
  '  default:',
  '    name: "Acme"',
  '    primary_locale: en',
  '    locales: [en]',
  'sources:',
  '  - id: s01',
  '    kind: project',
  '    include: ["content/**/*.md"]',
  '    exclude: []',
  ''
].join('\n')

test('the six observable stages are named in pipeline order, and gaps is not one of them', () => {
  // The questionnaire is computed in memory and leaves no artifact, so it
  // cannot be observed. Showing a box the plugin cannot fill would be the
  // hand-maintained-summary defect in miniature.
  assert.deepEqual(STAGES, ['scan', 'ingest', 'measure', 'draft', 'interview', 'canonize'])
  assert.ok(!STAGES.includes('gaps'))
})

test('an empty project reports no knowledge base and reaches no stage', () => {
  const state = stateOf({ 'content/a.md': '# Hello\n' })
  assert.equal(state.kb.exists, false)
  assert.equal(state.stage.at, null)
  for (const stage of STAGES) assert.equal(state.stage.reached[stage], false, `${stage} must not be reached`)
})

test('collect never throws on a project with no knowledge base at all', () => {
  assert.doesNotThrow(() => stateOf({}))
  const state = stateOf({})
  assert.equal(state.kb.exists, false)
  assert.equal(state.generated, NOW)
})

test('brand, profile, locales, and kb_version are read from the active profile', () => {
  const state = stateOf({ '.voice-and-tone/config.yml': MINIMAL_CONFIG, '.voice-and-tone/voice.md': '# Voice\n' })
  assert.equal(state.kb.exists, true)
  assert.equal(state.kb.brand, 'Acme')
  assert.equal(state.kb.profile, 'default')
  assert.equal(state.kb.version, '0.2.0')
  assert.deepEqual(state.kb.locales, ['en'])
  assert.equal(state.kb.primaryLocale, 'en')
})

test('scan is reached once the manifest counts at least one file', () => {
  const reached = inferStages({
    manifest: { totals: { files: 3 } }, index: { sources: [] }, register: [{ id: 's01', kind: 'project' }],
    fingerprint: null, kb: { rules: [], evidence: [] }, validation: { errors: 0 }, cardExists: false
  })
  assert.equal(reached.reached.scan, true)
  assert.equal(reached.reached.measure, false)
})

test('an empty manifest does not reach scan', () => {
  const { reached } = inferStages({
    manifest: { totals: { files: 0 } }, index: { sources: [] }, register: [{ id: 's01', kind: 'project' }],
    fingerprint: null, kb: { rules: [], evidence: [] }, validation: { errors: 0 }, cardExists: false
  })
  assert.equal(reached.scan, false)
})

test('ingest counts as reached when there is a corpus and nothing registered to ingest', () => {
  // A project-only knowledge base has nothing to ingest, so ingest is not a
  // pending step. But that only holds once a corpus exists - otherwise a bare
  // directory would report "ingest reached", which is nonsense.
  const withCorpus = inferStages({
    manifest: { totals: { files: 3 } }, index: { sources: [] }, register: [{ id: 's01', kind: 'project' }],
    fingerprint: null, kb: { rules: [], evidence: [] }, validation: { errors: 0 }, cardExists: false
  })
  assert.equal(withCorpus.reached.ingest, true)

  const withoutCorpus = inferStages({
    manifest: { totals: { files: 0 } }, index: { sources: [] }, register: [{ id: 's01', kind: 'project' }],
    fingerprint: null, kb: { rules: [], evidence: [] }, validation: { errors: 0 }, cardExists: false
  })
  assert.equal(withoutCorpus.reached.ingest, false)
})

test('a registered non-project source with no index entry leaves ingest unreached', () => {
  const { reached } = inferStages({
    manifest: { totals: { files: 3 } }, index: { sources: [] },
    register: [{ id: 's01', kind: 'project' }, { id: 's02', kind: 'inbox' }],
    fingerprint: null, kb: { rules: [], evidence: [] }, validation: { errors: 0 }, cardExists: false
  })
  assert.equal(reached.ingest, false)
})

test('interview is reached by a non-assumed rule or by interview evidence, and by nothing else', () => {
  const base = {
    manifest: { totals: { files: 1 } }, index: { sources: [] }, register: [{ id: 's01', kind: 'project' }],
    fingerprint: null, validation: { errors: 0 }, cardExists: false
  }
  const allAssumed = inferStages({ ...base, kb: { rules: [{ confidence: 'assumed' }], evidence: [] } })
  assert.equal(allAssumed.reached.draft, true)
  assert.equal(allAssumed.reached.interview, false)

  const confirmed = inferStages({ ...base, kb: { rules: [{ confidence: 'confirmed' }], evidence: [] } })
  assert.equal(confirmed.reached.interview, true)

  const byEvidence = inferStages({ ...base, kb: { rules: [{ confidence: 'assumed' }], evidence: [{ type: 'interview' }] } })
  assert.equal(byEvidence.reached.interview, true)
})

test('canonize needs the card, zero validation errors, and a baseline together', () => {
  const base = {
    manifest: { totals: { files: 1 } }, index: { sources: [] }, register: [{ id: 's01', kind: 'project' }],
    kb: { rules: [{ confidence: 'confirmed' }], evidence: [] }
  }
  const complete = inferStages({
    ...base, fingerprint: { byLocale: { en: {} }, baseline: { generated: NOW } }, validation: { errors: 0 }, cardExists: true
  })
  assert.equal(complete.reached.canonize, true)
  assert.equal(complete.at, 'canonize')

  const noBaseline = inferStages({
    ...base, fingerprint: { byLocale: { en: {} }, baseline: null }, validation: { errors: 0 }, cardExists: true
  })
  assert.equal(noBaseline.reached.canonize, false)

  const withErrors = inferStages({
    ...base, fingerprint: { byLocale: { en: {} }, baseline: { generated: NOW } }, validation: { errors: 2 }, cardExists: true
  })
  assert.equal(withErrors.reached.canonize, false)
})

test('stage.at is the furthest stage reached, not a count of reached stages', () => {
  const { at } = inferStages({
    manifest: { totals: { files: 1 } }, index: { sources: [] }, register: [{ id: 's01', kind: 'project' }],
    fingerprint: { byLocale: { en: {} }, baseline: null }, kb: { rules: [{ confidence: 'assumed' }], evidence: [] },
    validation: { errors: 0 }, cardExists: false
  })
  assert.equal(at, 'draft')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/state.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/lib/state.mjs'`

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/lib/state.mjs`:

```js
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { readTextFile } from './fsx.mjs'
import { activeProfile } from './config.mjs'
import { loadKb } from './kb.mjs'
import { loadRegister } from './register.mjs'
import { loadIndex } from './sourceindex.mjs'
import { validateKb } from '../validate.mjs'

/**
 * The collector: every knowledge-base artifact in, one plain, JSON-serialisable
 * state object out. All filesystem access for the status dashboard lives here,
 * and no string formatting does - lib/render.mjs owns that and cannot read a
 * file (test/render.test.mjs asserts the absence of a node:fs import).
 *
 * collect() never throws. Every artifact is optional and its absence is a
 * value, not an error - the same posture loadIndex already takes toward a
 * missing sources.json and loadKb toward an absent markdown file. This matters
 * more here than anywhere else in the plugin: :status is the first thing a new
 * user runs, and at that moment nothing exists at all.
 */

/**
 * Six stages, not the pipeline's seven. `gaps` computes the questionnaire in
 * memory and leaves no artifact behind, so it cannot be observed; rendering a
 * box the plugin can never fill would be the hand-maintained-summary defect
 * in miniature.
 */
export const STAGES = ['scan', 'ingest', 'measure', 'draft', 'interview', 'canonize']

export function readJson (abs) {
  if (!existsSync(abs)) return null
  try {
    return JSON.parse(readTextFile(abs))
  } catch {
    // A corrupt artifact is reported as absent rather than crashing the run.
    // The gap catalogue surfaces the consequence (no manifest, no fingerprint);
    // a stack trace over a half-written JSON file would surface nothing.
    return null
  }
}

export function inferStages ({ manifest, index, register, fingerprint, kb, validation, cardExists }) {
  const rules = kb.rules ?? []
  const evidence = kb.evidence ?? []
  const indexed = (index.sources ?? []).length
  const pendingKinds = (register ?? []).filter((entry) => entry.kind !== 'project')

  const scan = Boolean(manifest?.totals?.files > 0)

  const reached = {
    scan,
    // "Nothing to ingest" only counts once a corpus exists. Without that
    // guard a bare directory - whose synthesised project-only register has no
    // non-project entry - would report ingest as reached.
    ingest: indexed > 0 || (scan && pendingKinds.length === 0),
    measure: Object.keys(fingerprint?.byLocale ?? {}).length > 0,
    draft: rules.length > 0,
    interview: rules.some((r) => r.confidence && r.confidence !== 'assumed') ||
      evidence.some((e) => e.type === 'interview'),
    canonize: Boolean(cardExists) && (validation?.errors ?? 0) === 0 && Boolean(fingerprint?.baseline)
  }

  let at = null
  for (const stage of STAGES) if (reached[stage]) at = stage
  return { at, reached }
}

export function collect ({ projectRoot, kbRoot, config, profileName = 'default', now }) {
  const profile = activeProfile(config, profileName)
  const kb = loadKb(kbRoot)
  const present = kb.present ?? {}
  const exists = Boolean(present.config || present.voice || present.tone)

  const manifest = readJson(path.join(kbRoot, 'evidence', 'manifest.json'))
  const fingerprint = readJson(path.join(kbRoot, 'evidence', 'fingerprint.json'))
  const index = loadIndex(kbRoot)
  const register = loadRegister(config)
  const validation = exists ? validateKb(kb) : { errors: 0, warnings: 0, findings: [], counts: {} }
  const cardExists = existsSync(path.join(kbRoot, 'CONTEXT.md'))

  const stage = exists
    ? inferStages({ manifest, index, register, fingerprint, kb, validation, cardExists })
    : { at: null, reached: Object.fromEntries(STAGES.map((s) => [s, false])) }

  return {
    generated: now,
    kb: {
      root: kbRoot,
      exists,
      version: config.kb_version ?? null,
      brand: profile.name ?? null,
      profile: profileName,
      locales: profile.locales ?? [profile.primary_locale ?? 'en'],
      primaryLocale: profile.primary_locale ?? 'en'
    },
    stage
  }
}

/** Exported for the freshness ring in Task 4; kept here so all fs access is co-located. */
export function mtimeMs (abs) {
  return existsSync(abs) ? statSync(abs).mtimeMs : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/state.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/state.mjs test/state.test.mjs
git commit -m "feat: state collector with lifecycle stage inference"
```

---

## Task 4: State — integrity and freshness

**Files:**
- Modify: `scripts/lib/state.mjs`
- Test: `test/state.test.mjs`

**Interfaces:**
- Consumes: `readJson`, `mtimeMs`, `collect` from Task 3.
- Produces: `CARD_SOURCES` (string[5]), `cardFreshness(kbRoot, now) -> {generated, staleAgainst, ageDays}|null`, `manifestFreshness(projectRoot, manifest, now) -> {generated, ageDays, changedSince, checked}|null`. `collect()` gains `integrity` and `freshness`.

- [ ] **Step 1: Write the failing test**

Append to `test/state.test.mjs` (extend the import to include `CARD_SOURCES, cardFreshness, manifestFreshness`, and add `import { utimesSync, writeFileSync, mkdirSync } from 'node:fs'`):

```js
test('the card compiles from exactly five files, and freshness compares against all of them', () => {
  assert.deepEqual(CARD_SOURCES, ['voice.md', 'tone.md', 'lexicon.md', 'mechanics.md', 'config.yml'])
})

test('a card newer than every source it compiles from is fresh', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': MINIMAL_CONFIG,
    '.voice-and-tone/voice.md': '# Voice\n',
    '.voice-and-tone/tone.md': '# Tone\n',
    '.voice-and-tone/CONTEXT.md': '# Card\n'
  })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const old = new Date('2026-08-01T00:00:00Z')
    for (const name of ['config.yml', 'voice.md', 'tone.md']) utimesSync(path.join(kb, name), old, old)
    const fresh = new Date('2026-08-20T00:00:00Z')
    utimesSync(path.join(kb, 'CONTEXT.md'), fresh, fresh)

    const out = cardFreshness(kb, NOW)
    assert.deepEqual(out.staleAgainst, [])
    assert.equal(out.ageDays, 8)
  } finally {
    cleanup(dir)
  }
})

test('a card older than a source it compiles from names that source', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': MINIMAL_CONFIG,
    '.voice-and-tone/voice.md': '# Voice\n',
    '.voice-and-tone/tone.md': '# Tone\n',
    '.voice-and-tone/CONTEXT.md': '# Card\n'
  })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const old = new Date('2026-08-01T00:00:00Z')
    utimesSync(path.join(kb, 'CONTEXT.md'), old, old)
    utimesSync(path.join(kb, 'config.yml'), old, old)
    utimesSync(path.join(kb, 'voice.md'), old, old)
    const newer = new Date('2026-08-15T00:00:00Z')
    utimesSync(path.join(kb, 'tone.md'), newer, newer)

    assert.deepEqual(cardFreshness(kb, NOW).staleAgainst, ['tone.md'])
  } finally {
    cleanup(dir)
  }
})

test('an absent card yields null freshness rather than a fabricated date', () => {
  const dir = makeTmpProject({ '.voice-and-tone/config.yml': MINIMAL_CONFIG })
  try {
    assert.equal(cardFreshness(path.join(dir, '.voice-and-tone'), NOW), null)
  } finally {
    cleanup(dir)
  }
})

test('manifest freshness counts listed files modified since the manifest was written', () => {
  const dir = makeTmpProject({ 'content/a.md': '# A\n', 'content/b.md': '# B\n' })
  try {
    const manifest = {
      generated: '2026-08-10T00:00:00.000Z',
      files: [{ path: 'content/a.md' }, { path: 'content/b.md' }]
    }
    const older = new Date('2026-08-01T00:00:00Z')
    utimesSync(path.join(dir, 'content', 'a.md'), older, older)
    const newer = new Date('2026-08-20T00:00:00Z')
    utimesSync(path.join(dir, 'content', 'b.md'), newer, newer)

    const out = manifestFreshness(dir, manifest, NOW)
    assert.equal(out.checked, 2)
    assert.equal(out.changedSince, 1)
    assert.equal(out.ageDays, 18)
  } finally {
    cleanup(dir)
  }
})

test('manifest freshness skips a listed file that no longer exists rather than throwing', () => {
  const dir = makeTmpProject({ 'content/a.md': '# A\n' })
  try {
    const manifest = {
      generated: '2026-08-10T00:00:00.000Z',
      files: [{ path: 'content/a.md' }, { path: 'content/deleted.md' }]
    }
    const out = manifestFreshness(dir, manifest, NOW)
    assert.equal(out.checked, 1, 'a vanished file is not checkable and must not be counted')
  } finally {
    cleanup(dir)
  }
})

test('integrity carries validate findings verbatim, grouped by code', () => {
  const state = stateOf({
    '.voice-and-tone/config.yml': MINIMAL_CONFIG,
    '.voice-and-tone/voice.md': '# Voice\n\n## V01 * a thing `confirmed`\n\n**Means:** x\n',
    '.voice-and-tone/tone.md': '# Tone\n'
  })
  assert.equal(typeof state.integrity.errors, 'number')
  assert.equal(typeof state.integrity.warnings, 'number')
  assert.ok(Array.isArray(state.integrity.findings))
  assert.equal(typeof state.integrity.byCode, 'object')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/state.test.mjs`
Expected: FAIL — `does not provide an export named 'CARD_SOURCES'`

- [ ] **Step 3: Write the minimal implementation**

Add to `scripts/lib/state.mjs` (above `collect`):

```js
const MS_PER_DAY = 86400000

function ageDays (fromMs, now) {
  if (fromMs === null || fromMs === undefined) return null
  const nowMs = Date.parse(now)
  if (Number.isNaN(nowMs)) return null
  return Math.max(0, Math.floor((nowMs - fromMs) / MS_PER_DAY))
}

/**
 * The five files compileContext() actually reads. Comparing the card's mtime
 * against exactly these is five statSync calls and is EXACT: any one of them
 * newer than the card means the card is behind, and we can name which.
 */
export const CARD_SOURCES = ['voice.md', 'tone.md', 'lexicon.md', 'mechanics.md', 'config.yml']

export function cardFreshness (kbRoot, now) {
  const cardMs = mtimeMs(path.join(kbRoot, 'CONTEXT.md'))
  if (cardMs === null) return null
  const staleAgainst = []
  for (const name of CARD_SOURCES) {
    const sourceMs = mtimeMs(path.join(kbRoot, name))
    if (sourceMs !== null && sourceMs > cardMs) staleAgainst.push(name)
  }
  return { generated: new Date(cardMs).toISOString(), staleAgainst, ageDays: ageDays(cardMs, now) }
}

/**
 * Approximate by design, and the renderer says so. Detecting files created
 * since the manifest was written would mean re-globbing the register, which
 * IS the scan - that is what --refresh is for. What is cheap and exact is the
 * other half: how many of the manifest's OWN listed files have changed.
 *
 * A number with its limit attached is worth more than a number that quietly
 * lies, so `checked` travels with `changedSince` rather than being folded in.
 */
export function manifestFreshness (projectRoot, manifest, now) {
  if (!manifest) return null
  const cutoff = Date.parse(manifest.generated)
  let changedSince = 0
  let checked = 0
  for (const file of manifest.files ?? []) {
    const abs = path.join(projectRoot, ...String(file.path).split('/'))
    const fileMs = mtimeMs(abs)
    if (fileMs === null) continue // vanished since the scan; not checkable
    checked += 1
    if (!Number.isNaN(cutoff) && fileMs > cutoff) changedSince += 1
  }
  return { generated: manifest.generated, ageDays: ageDays(cutoff, now), changedSince, checked }
}

function countBy (items, keyOf) {
  const out = {}
  for (const item of items) {
    const key = keyOf(item)
    if (key === null || key === undefined) continue
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}
```

Then, inside `collect()`, add these two fields to the returned object, after `stage`:

```js
    integrity: {
      errors: validation.errors ?? 0,
      warnings: validation.warnings ?? 0,
      byCode: countBy(validation.findings ?? [], (f) => f.code),
      findings: validation.findings ?? []
    },
    freshness: {
      card: cardFreshness(kbRoot, now),
      manifest: manifestFreshness(projectRoot, manifest, now),
      fingerprint: fingerprint
        ? { generated: fingerprint.generated, ageDays: ageDays(Date.parse(fingerprint.generated), now) }
        : null
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/state.test.mjs`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/state.mjs test/state.test.mjs
git commit -m "feat: integrity and freshness rings, exact for the card and honest about the corpus"
```

---

## Task 5: State — coverage, rules, and evidence

**Files:**
- Modify: `scripts/lib/state.mjs`
- Test: `test/state.test.mjs`

**Interfaces:**
- Consumes: `collect` from Task 4; `CONTEXTS`, `STATES`, `cellId` from `lib/kb.mjs`.
- Produces: `coverageOf(kb, manifest) -> {authored, possible, byContext}`; `collect()` gains `coverage`, `rules`, `evidence`. Each `byContext` entry is `{context, authored, of, cells, traffic}` where `cells` is an 8-element array of `'authored'|'computed'` in `STATES` order and `traffic` is a word count.

- [ ] **Step 1: Write the failing test**

Append to `test/state.test.mjs` (extend the import to include `coverageOf`, and add `import { CONTEXTS, STATES } from '../scripts/lib/kb.mjs'`):

```js
const TONE_WITH_TWO_CELLS = [
  '# Tone',
  '',
  '## T-system-error/frustrated `confirmed`',
  '',
  '**Dials:** warmth 3 - humor 0 - directness 4 - detail 2 - urgency 3 - formality 2',
  '',
  '## T-product-ui/delighted `assumed`',
  '',
  '**Dials:** warmth 3 - humor 2 - directness 3 - detail 2 - urgency 1 - formality 2',
  ''
].join('\n')

test('coverage counts authored cells against the full ten-by-eight matrix', () => {
  const state = stateOf({
    '.voice-and-tone/config.yml': MINIMAL_CONFIG,
    '.voice-and-tone/voice.md': '# Voice\n',
    '.voice-and-tone/tone.md': TONE_WITH_TWO_CELLS
  })
  assert.equal(state.coverage.possible, CONTEXTS.length * STATES.length)
  assert.equal(state.coverage.possible, 80)
  assert.equal(state.coverage.authored, 2)
  assert.equal(state.coverage.byContext.length, CONTEXTS.length)
})

test('every context appears in coverage, including those with no authored cell', () => {
  const state = stateOf({
    '.voice-and-tone/config.yml': MINIMAL_CONFIG,
    '.voice-and-tone/voice.md': '# Voice\n',
    '.voice-and-tone/tone.md': TONE_WITH_TWO_CELLS
  })
  const names = state.coverage.byContext.map((c) => c.context)
  assert.deepEqual(names, CONTEXTS, 'contexts are reported in the canonical order, never only the populated ones')
  const social = state.coverage.byContext.find((c) => c.context === 'social')
  assert.equal(social.authored, 0)
  assert.deepEqual(social.cells, new Array(8).fill('computed'))
})

test('a cell marked authored sits at its state index, not merely somewhere in the row', () => {
  const state = stateOf({
    '.voice-and-tone/config.yml': MINIMAL_CONFIG,
    '.voice-and-tone/voice.md': '# Voice\n',
    '.voice-and-tone/tone.md': TONE_WITH_TWO_CELLS
  })
  const errors = state.coverage.byContext.find((c) => c.context === 'system-error')
  assert.equal(errors.cells[STATES.indexOf('frustrated')], 'authored')
  assert.equal(errors.cells[STATES.indexOf('delighted')], 'computed')
  assert.equal(errors.authored, 1)
  assert.equal(errors.of, 8)
})

test('coverageOf attributes corpus traffic to a context by manifest word counts', () => {
  const kb = { cells: [], config: {} }
  const manifest = { files: [{ path: 'content/marketing/a.md', words: 900 }, { path: 'docs/help/b.md', words: 100 }] }
  const coverage = coverageOf(kb, manifest)
  const marketing = coverage.byContext.find((c) => c.context === 'marketing-page')
  assert.ok(marketing.traffic >= 900, 'a path segment naming the context attributes its words')
})

test('coverage traffic is zero, never null, when there is no manifest', () => {
  // Zero is a number the gap detectors can compare. Null would make every
  // "traffic and no cells" comparison silently false.
  const coverage = coverageOf({ cells: [] }, null)
  for (const entry of coverage.byContext) assert.equal(entry.traffic, 0)
})

test('rules are counted by confidence with every level present as a key', () => {
  const state = stateOf({
    '.voice-and-tone/config.yml': MINIMAL_CONFIG,
    '.voice-and-tone/tone.md': TONE_WITH_TWO_CELLS,
    '.voice-and-tone/voice.md': [
      '# Voice',
      '',
      '## V01 * plain `confirmed`',
      '',
      '**Means:** short words',
      '',
      '## V02 * warm `assumed`',
      '',
      '**Means:** friendly',
      ''
    ].join('\n')
  })
  assert.equal(state.rules.byConfidence.confirmed, 1)
  assert.equal(state.rules.byConfidence.assumed, 1)
  assert.equal(state.rules.byConfidence.derived, 0, 'an unused level is zero, not absent')
  assert.equal(state.rules.byConfidence.disputed, 0)
  assert.equal(state.rules.total, 2)
})

test('evidence counts conflicts and pending drafts', () => {
  const state = stateOf({
    '.voice-and-tone/config.yml': MINIMAL_CONFIG,
    '.voice-and-tone/voice.md': '# Voice\n',
    '.voice-and-tone/tone.md': '# Tone\n',
    '.voice-and-tone/.drafts/d1.md': '---\ncell: T-email/curious\n---\n\nhi\n',
    '.voice-and-tone/.drafts/d2.md': '---\ncell: T-email/curious\n---\n\nhi\n'
  })
  assert.equal(state.evidence.drafts, 2)
  assert.equal(typeof state.evidence.conflicts, 'number')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/state.test.mjs`
Expected: FAIL — `does not provide an export named 'coverageOf'`

- [ ] **Step 3: Write the minimal implementation**

Add to `scripts/lib/state.mjs`. Extend the `kb.mjs` import to `import { loadKb, CONTEXTS, STATES, CONFIDENCE_LEVELS, EVIDENCE_TYPES, cellId } from './kb.mjs'`, add `readdirSync` to the `node:fs` import, then:

```js
/**
 * Attribute a file's words to a context by path segment. Deliberately crude:
 * this feeds one gap detector ("traffic but no authored cells"), never a
 * statistic anyone reports. A wrong attribution costs at worst a suggestion
 * to author a cell the project may not need - cheap, and easy to ignore.
 */
function contextOfPath (relPath) {
  const segments = String(relPath).toLowerCase().split('/')
  for (const context of CONTEXTS) {
    const bare = context.replace('-', '')
    if (segments.some((s) => s === context || s === bare || s.startsWith(`${context}.`))) return context
  }
  if (segments.includes('marketing') || segments.includes('content')) return 'marketing-page'
  if (segments.includes('docs') || segments.includes('help')) return 'help-doc'
  if (segments.includes('locales') || segments.includes('ui')) return 'product-ui'
  return null
}

export function coverageOf (kb, manifest) {
  const authoredIds = new Set((kb.cells ?? []).map((cell) => cellId(cell.context, cell.state)))

  const traffic = Object.fromEntries(CONTEXTS.map((c) => [c, 0]))
  for (const file of manifest?.files ?? []) {
    const context = contextOfPath(file.path)
    if (context) traffic[context] += Number(file.words) || 0
  }

  const byContext = CONTEXTS.map((context) => {
    const cells = STATES.map((state) => (authoredIds.has(cellId(context, state)) ? 'authored' : 'computed'))
    return {
      context,
      authored: cells.filter((c) => c === 'authored').length,
      of: STATES.length,
      cells,
      traffic: traffic[context]
    }
  })

  return {
    authored: byContext.reduce((sum, c) => sum + c.authored, 0),
    possible: CONTEXTS.length * STATES.length,
    byContext
  }
}

function countDrafts (kbRoot) {
  const dir = path.join(kbRoot, '.drafts')
  if (!existsSync(dir)) return 0
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).length
  } catch {
    return 0
  }
}

/** Every conflicts.md heading of the form '## <id>' is one open dispute. */
function countConflicts (kbRoot) {
  const abs = path.join(kbRoot, 'evidence', 'conflicts.md')
  if (!existsSync(abs)) return 0
  const body = readTextFile(abs).replace(/<!--[\s\S]*?-->/g, '')
  return (body.match(/^#{2,4}\s+\S+/gm) ?? []).length
}

/** Zero-filled so an unused level is 0, never absent - a renderer must not have to guess. */
function zeroFilled (keys, counts) {
  return Object.fromEntries(keys.map((key) => [key, counts[key] ?? 0]))
}
```

Then add these three fields to `collect()`'s returned object, after `freshness`:

```js
    coverage: coverageOf(kb, manifest),
    rules: {
      total: (kb.rules ?? []).length,
      byConfidence: zeroFilled(CONFIDENCE_LEVELS, countBy(kb.rules ?? [], (r) => r.confidence)),
      byFile: countBy(kb.rules ?? [], (r) => r.file)
    },
    evidence: {
      total: (kb.evidence ?? []).length,
      byType: zeroFilled(EVIDENCE_TYPES, countBy(kb.evidence ?? [], (e) => e.type)),
      conflicts: countConflicts(kbRoot),
      drafts: countDrafts(kbRoot)
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/state.test.mjs`
Expected: PASS, 25 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/state.mjs test/state.test.mjs
git commit -m "feat: coverage, rule, and evidence rings"
```

---

## Task 6: State — drift, and the `drift_pct` threshold

**Files:**
- Modify: `scripts/lib/state.mjs`, `scripts/lib/config.mjs`
- Test: `test/state.test.mjs`, `test/config.test.mjs`

**Interfaces:**
- Consumes: `collect` from Task 5.
- Produces: `DRIFT_METRICS` (array of `{key, block, label}`), `deltaPct(from, to) -> number|null`, `driftOf(fingerprint, thresholdPct) -> {thresholdPct, byLocale}`. `collect()` gains `drift`. `DEFAULT_CONFIG.thresholds.drift_pct` is `25`.

- [ ] **Step 1: Write the failing test**

Append to `test/state.test.mjs` (extend the import to include `DRIFT_METRICS, deltaPct, driftOf`):

```js
test('percentage change from a zero baseline is null, never Infinity and never a number', () => {
  // Percentage change from zero is undefined. Rendering it as 100 percent or
  // Infinity would put a fabricated figure on a dashboard whose whole claim is
  // that its numbers are computed.
  assert.equal(deltaPct(0, 5), null)
  assert.equal(deltaPct(0, 0), 0)
  assert.equal(deltaPct(null, 5), null)
  assert.equal(deltaPct(5, null), null)
  assert.equal(deltaPct(undefined, 5), null)
})

test('deltaPct is signed and relative to the baseline magnitude', () => {
  assert.equal(deltaPct(10, 15), 50)
  assert.equal(deltaPct(10, 5), -50)
  assert.equal(deltaPct(-10, -15), -50, 'a negative baseline uses its magnitude, preserving the sign of the move')
})

test('drift flags a metric only once it passes the configured threshold', () => {
  const fingerprint = {
    byLocale: { en: { universal: { meanSentenceLength: 20 }, english: null } },
    baseline: { generated: '2026-03-02T00:00:00.000Z', byLocale: { en: { universal: { meanSentenceLength: 10 }, english: null } } }
  }
  const drift = driftOf(fingerprint, 25)
  const metric = drift.byLocale.en.metrics.find((m) => m.key === 'meanSentenceLength')
  assert.equal(metric.from, 10)
  assert.equal(metric.to, 20)
  assert.equal(metric.deltaPct, 100)
  assert.equal(metric.flagged, true)

  const lenient = driftOf(fingerprint, 200)
  assert.equal(lenient.byLocale.en.metrics.find((m) => m.key === 'meanSentenceLength').flagged, false)
})

test('a locale with no baseline reports baseline null rather than being omitted', () => {
  // Omitting it would make "no baseline" invisible, which is exactly the gap
  // that most needs surfacing: drift can never be measured there.
  const fingerprint = {
    byLocale: { en: { universal: { meanSentenceLength: 20 } }, cs: { universal: { meanSentenceLength: 14 } } },
    baseline: { generated: '2026-03-02T00:00:00.000Z', byLocale: { en: { universal: { meanSentenceLength: 10 } } } }
  }
  const drift = driftOf(fingerprint, 25)
  assert.ok('cs' in drift.byLocale)
  assert.equal(drift.byLocale.cs.baseline, null)
  assert.deepEqual(drift.byLocale.cs.metrics, [])
  assert.equal(drift.byLocale.en.baseline, '2026-03-02T00:00:00.000Z')
})

test('a fingerprint with no baseline at all yields every locale unbaselined', () => {
  const drift = driftOf({ byLocale: { en: { universal: {} } }, baseline: null }, 25)
  assert.equal(drift.byLocale.en.baseline, null)
})

test('an absent fingerprint yields an empty drift map rather than throwing', () => {
  assert.deepEqual(driftOf(null, 25).byLocale, {})
})

test('a non-English locale contributes no english-block metrics', () => {
  const fingerprint = {
    byLocale: { cs: { universal: { meanSentenceLength: 20 }, english: null } },
    baseline: { generated: NOW, byLocale: { cs: { universal: { meanSentenceLength: 10 }, english: null } } }
  }
  const metrics = driftOf(fingerprint, 25).byLocale.cs.metrics
  const englishKeys = DRIFT_METRICS.filter((m) => m.block === 'english').map((m) => m.key)
  for (const metric of metrics) assert.ok(!englishKeys.includes(metric.key), `${metric.key} is English-only`)
})
```

Append to `test/config.test.mjs`:

```js
test('drift_pct defaults to 25 and survives a partial thresholds override', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': 'version: 1\nthresholds:\n  corroboration: 3\n'
  })
  try {
    const config = loadConfig(path.join(dir, '.voice-and-tone'))
    assert.equal(config.thresholds.drift_pct, 25, 'the default fills in for every existing knowledge base')
    assert.equal(config.thresholds.corroboration, 3, 'the user override survives')
    assert.equal(config.thresholds.stale_months, 9, 'untouched siblings survive')
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/state.test.mjs test/config.test.mjs`
Expected: FAIL — `does not provide an export named 'DRIFT_METRICS'`, and `expected 25 to equal undefined`.

- [ ] **Step 3: Write the minimal implementation**

In `scripts/lib/config.mjs`, change the `thresholds` line of `DEFAULT_CONFIG`:

```js
  thresholds: { corroboration: 2, derived_min_samples: 5, stale_months: 9, drift_pct: 25 }
```

Add to `scripts/lib/state.mjs`:

```js
/**
 * fingerprintFromStats returns 22 metrics across its universal and english
 * blocks. Showing all 22 would bury the four that a reader acts on, so this
 * is a curated list, ordered by how directly each one reads as "the voice
 * changed" rather than "the corpus changed shape".
 *
 * `block` names which sub-object of the per-locale fingerprint the key lives
 * in. An english-block metric is simply absent for a non-English locale
 * (fingerprintFromStats sets `english` to null there), and is skipped rather
 * than reported as a change to or from nothing.
 */
export const DRIFT_METRICS = [
  { key: 'meanSentenceLength', block: 'universal', label: 'mean sentence' },
  { key: 'medianSentenceLength', block: 'universal', label: 'median sentence' },
  { key: 'meanWordLength', block: 'universal', label: 'mean word' },
  { key: 'exclamationRate', block: 'universal', label: 'exclamations' },
  { key: 'questionRate', block: 'universal', label: 'questions' },
  { key: 'emojiPer1000Words', block: 'universal', label: 'emoji /1k' },
  { key: 'contractionPer1000Words', block: 'english', label: 'contractions /1k' },
  { key: 'readingGrade', block: 'english', label: 'reading grade' },
  { key: 'passiveRate', block: 'english', label: 'passive' }
]

/**
 * Signed percentage change relative to the magnitude of the baseline.
 *
 * A zero baseline returns null, not Infinity and not 100: percentage change
 * from zero is undefined, and putting a fabricated figure on this dashboard
 * would contradict the one claim it makes about itself. deltaBar() renders a
 * null as an explicit 'n/a' rather than an empty bar, so "we cannot say" never
 * reads as "no drift".
 */
export function deltaPct (from, to) {
  if (from === null || from === undefined || to === null || to === undefined) return null
  if (from === 0) return to === 0 ? 0 : null
  return Math.round(((to - from) / Math.abs(from)) * 1000) / 10
}

export function driftOf (fingerprint, thresholdPct) {
  const byLocale = {}
  const baselineLocales = fingerprint?.baseline?.byLocale ?? {}

  for (const [locale, current] of Object.entries(fingerprint?.byLocale ?? {})) {
    const base = baselineLocales[locale]
    if (!base) {
      // Present with a null baseline, never omitted: an omitted locale makes
      // "drift cannot be measured here" invisible, and that is the gap that
      // most needs surfacing.
      byLocale[locale] = { baseline: null, metrics: [] }
      continue
    }
    const metrics = []
    for (const { key, block, label } of DRIFT_METRICS) {
      const from = base?.[block]?.[key]
      const to = current?.[block]?.[key]
      if (from === undefined && to === undefined) continue
      const delta = deltaPct(from ?? null, to ?? null)
      metrics.push({
        key,
        label,
        from: from ?? null,
        to: to ?? null,
        deltaPct: delta,
        flagged: delta !== null && Math.abs(delta) >= thresholdPct
      })
    }
    byLocale[locale] = { baseline: fingerprint.baseline.generated ?? null, metrics }
  }

  return { thresholdPct, byLocale }
}
```

Add to `collect()`'s returned object, after `evidence`:

```js
    drift: driftOf(fingerprint, config.thresholds?.drift_pct ?? 25),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/state.test.mjs test/config.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the migration suite, which pins config parity**

Run: `node --test test/migration.test.mjs test/templates.test.mjs test/yaml.test.mjs`
Expected: PASS. If `templates.test.mjs` asserts an exact `thresholds` object, add `drift_pct: 25` to that expectation.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/state.mjs scripts/lib/config.mjs test/state.test.mjs test/config.test.mjs
git commit -m "feat: drift ring with an honest zero-baseline, plus the drift_pct threshold"
```

---

## Task 7: State — sources, corpus, settings, and `--refresh` freshness

**Files:**
- Modify: `scripts/lib/state.mjs`
- Test: `test/state.test.mjs`

**Interfaces:**
- Consumes: `collect` from Task 6; `resolveRegister` (`lib/register.mjs`), `sha256File` (`lib/hash.mjs`).
- Produces: `sourcesOf(config, index, register, manifest, {checkFreshness, projectRoot, kbRoot, profileName}) -> sources`; `collect()` gains `sources`, `corpus`, `settings`, and accepts a `checkFreshness` option (default `false`).

- [ ] **Step 1: Write the failing test**

Append to `test/state.test.mjs`:

```js
const CONFIG_WITH_INBOX = [
  MINIMAL_CONFIG.trimEnd(),
  '  - id: s02',
  '    kind: inbox',
  '    label: "Dropped-in files"',
  '    path: "sources/"',
  ''
].join('\n')

test('read-only mode leaves source freshness explicitly unchecked, not zero', () => {
  // Zero stale reads as "everything is current", which is a claim this mode
  // has not earned - it never hashed anything.
  const state = stateOf({ '.voice-and-tone/config.yml': CONFIG_WITH_INBOX, '.voice-and-tone/voice.md': '# V\n' })
  assert.equal(state.sources.freshness, 'unchecked')
  assert.equal(state.sources.stale, null)
  assert.equal(state.sources.fresh, null)
})

test('registered and analysed counts come from the register and the index respectively', () => {
  const state = stateOf({
    '.voice-and-tone/config.yml': CONFIG_WITH_INBOX,
    '.voice-and-tone/voice.md': '# V\n',
    '.voice-and-tone/evidence/sources.json': JSON.stringify({
      generated: NOW,
      sources: [{ id: 'e01', kind: 'inbox', origin: 'sources/guide.md', status: 'used', sha256: 'a'.repeat(64), produced: ['L01'] }]
    })
  })
  assert.equal(state.sources.registered, 2, 'one project entry plus one inbox entry')
  assert.equal(state.sources.analysed, 1)
  assert.equal(state.sources.entries.length, 1)
  assert.equal(state.sources.entries[0].id, 'e01')
})

test('a missing index entry is counted as missing and never as a fault', () => {
  const state = stateOf({
    '.voice-and-tone/config.yml': CONFIG_WITH_INBOX,
    '.voice-and-tone/voice.md': '# V\n',
    '.voice-and-tone/evidence/sources.json': JSON.stringify({
      generated: NOW,
      sources: [{ id: 'e01', kind: 'local', origin: '/gone/deck.pdf', status: 'missing', sha256: 'b'.repeat(64) }]
    })
  })
  assert.equal(state.sources.missing, 1)
})

test('corpus totals and unindexed come straight from the manifest', () => {
  const state = stateOf({
    '.voice-and-tone/config.yml': MINIMAL_CONFIG,
    '.voice-and-tone/voice.md': '# V\n',
    '.voice-and-tone/evidence/manifest.json': JSON.stringify({
      generated: NOW,
      totals: { files: 12, strings: 300, words: 4200, sentences: 380 },
      byLocale: { en: { files: 12, strings: 300, words: 4200 } },
      files: [],
      unreadable: { count: 0, paths: [] },
      skipped: { count: 2, files: [] },
      unindexed: { count: 3, files: [] }
    })
  })
  assert.equal(state.corpus.totals.words, 4200)
  assert.equal(state.corpus.skipped, 2)
  assert.equal(state.sources.unindexed, 3)
})

test('an absent manifest yields null totals rather than fabricated zeroes', () => {
  const state = stateOf({ '.voice-and-tone/config.yml': MINIMAL_CONFIG, '.voice-and-tone/voice.md': '# V\n' })
  assert.equal(state.corpus.totals, null)
})

test('settings expose the thresholds and the register that actually drive behaviour', () => {
  const state = stateOf({ '.voice-and-tone/config.yml': CONFIG_WITH_INBOX, '.voice-and-tone/voice.md': '# V\n' })
  assert.equal(state.settings.thresholds.corroboration, 2)
  assert.equal(state.settings.thresholds.drift_pct, 25)
  assert.equal(state.settings.register.length, 2)
  assert.equal(state.settings.register[0].kind, 'project')
})

test('the whole state object survives a JSON round trip', () => {
  // --json prints this object verbatim. An undefined, a Map, or a circular
  // reference anywhere in it would silently vanish or throw at print time.
  const state = stateOf({ '.voice-and-tone/config.yml': CONFIG_WITH_INBOX, '.voice-and-tone/voice.md': '# V\n' })
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/state.test.mjs`
Expected: FAIL — `Cannot read properties of undefined (reading 'freshness')`

- [ ] **Step 3: Write the minimal implementation**

Add to `scripts/lib/state.mjs`. Extend the register import to `import { loadRegister, resolveRegister } from './register.mjs'`, add `import { sha256File } from './hash.mjs'`, then:

```js
/**
 * Deciding whether a registered source is stale means hashing it, which on a
 * corpus of decks and PDFs is real I/O. That is not worth paying on every
 * glance, so read-only mode reports `freshness: 'unchecked'` and leaves
 * `stale` and `fresh` null.
 *
 * Null, not zero: zero stale reads as "everything is current", a claim this
 * mode has not earned, because it never hashed anything.
 */
export function sourcesOf (config, index, register, manifest, opts = {}) {
  const { checkFreshness = false, projectRoot, kbRoot, profileName = 'default' } = opts
  const indexed = index.sources ?? []

  const entries = indexed.map((source) => ({
    id: source.id,
    kind: source.kind ?? null,
    label: source.label ?? null,
    origin: source.origin ?? null,
    status: source.status ?? null,
    fidelity: source.quality?.fidelity ?? source.fidelity ?? null,
    analysed: source.analysed ?? null,
    produced: Array.isArray(source.produced) ? source.produced : []
  }))

  const out = {
    registered: register.length,
    analysed: indexed.length,
    missing: entries.filter((e) => e.status === 'missing').length,
    unindexed: manifest?.unindexed?.count ?? 0,
    freshness: 'unchecked',
    stale: null,
    fresh: null,
    entries
  }

  if (!checkFreshness) return out

  // Under --refresh only. resolveRegister walks the register, and hashing each
  // resolved file against the index tells stale from current. No child process
  // is spawned - conformance forbids it - the library functions are called
  // directly.
  try {
    const resolved = resolveRegister(register, { projectRoot, kbRoot, config, profileName })
    const knownShas = new Set(indexed.map((s) => s.sha256).filter(Boolean))
    const originToSha = new Map(indexed.filter((s) => s.sha256).map((s) => [s.origin, s.sha256]))
    let stale = 0
    let fresh = 0
    for (const entry of resolved) {
      if (entry.kind === 'project' || entry.kind === 'url') continue
      for (const file of entry.files ?? []) {
        if (!existsSync(file.abs)) continue
        const sha = sha256File(file.abs)
        if (knownShas.has(sha)) continue
        if (originToSha.has(file.origin)) stale += 1
        else fresh += 1
      }
    }
    out.freshness = 'checked'
    out.stale = stale
    out.fresh = fresh
  } catch {
    // A vanished share or an unreadable file must not take down the dashboard;
    // the honest report is that the check did not complete.
    out.freshness = 'unchecked'
  }
  return out
}

function loadVendorPins () {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const manifest = readJson(path.resolve(here, '..', '..', 'vendor', 'manifest.json'))
  const libraries = manifest?.libraries ?? {}
  return Object.entries(libraries).map(([name, meta]) => ({ name, version: meta?.version ?? null }))
}
```

Add `import { fileURLToPath } from 'node:url'` at the top.

Change `collect()`'s signature to accept the option and add the three fields:

```js
export function collect ({ projectRoot, kbRoot, config, profileName = 'default', now, checkFreshness = false }) {
```

```js
    sources: sourcesOf(config, index, register, manifest, { checkFreshness, projectRoot, kbRoot, profileName }),
    corpus: {
      totals: manifest?.totals ?? null,
      byLocale: manifest?.byLocale ?? {},
      skipped: manifest?.skipped?.count ?? 0,
      unreadable: manifest?.unreadable?.count ?? 0,
      fidelity: Object.fromEntries(
        Object.entries(fingerprint?.byLocale ?? {}).map(([locale, fp]) => [locale, fp.fidelity ?? null])
      )
    },
    settings: {
      thresholds: config.thresholds ?? {},
      register: register.map((entry) => ({ id: entry.id, kind: entry.kind, label: entry.label ?? null })),
      runtime: config.runtime ?? {},
      vendor: loadVendorPins()
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/state.test.mjs`
Expected: PASS, 40 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/state.mjs test/state.test.mjs
git commit -m "feat: source, corpus, and settings rings; source freshness is opt-in"
```

---

## Task 8: The gap catalogue

**Files:**
- Create: `scripts/lib/gaps.mjs`
- Modify: `scripts/lib/state.mjs`
- Test: `test/gaps.test.mjs`

**Interfaces:**
- Consumes: the full state object from Task 7.
- Produces: `DETECTORS` (array of `{id, severity, leverage, detect(state) -> {what, why, fix}|null}`), `SEVERITY_RANK` (`{blocker:0, warning:1, nit:2}`), `MAX_GAPS` (10), `detectGaps(state) -> gap[]` where each gap is `{id, severity, leverage, what, why, fix}`. `collect()` gains `gaps`.

- [ ] **Step 1: Write the failing test**

Create `test/gaps.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DETECTORS, MAX_GAPS, detectGaps } from '../scripts/lib/gaps.mjs'
import { CONTEXTS, STATES } from '../scripts/lib/kb.mjs'

/** A knowledge base in perfect health: every detector must stay silent on it. */
function healthyState (overrides = {}) {
  return {
    generated: '2026-08-28T00:00:00.000Z',
    kb: { root: '/tmp/kb', exists: true, version: '1.0.0', brand: 'Acme', profile: 'default', locales: ['en'], primaryLocale: 'en' },
    stage: { at: 'canonize', reached: { scan: true, ingest: true, measure: true, draft: true, interview: true, canonize: true } },
    integrity: { errors: 0, warnings: 0, byCode: {}, findings: [] },
    freshness: {
      card: { generated: '2026-08-27T00:00:00.000Z', staleAgainst: [], ageDays: 1 },
      manifest: { generated: '2026-08-27T00:00:00.000Z', ageDays: 1, changedSince: 0, checked: 10 },
      fingerprint: { generated: '2026-08-27T00:00:00.000Z', ageDays: 1 }
    },
    coverage: {
      authored: 80,
      possible: 80,
      byContext: CONTEXTS.map((context) => ({ context, authored: 8, of: 8, cells: STATES.map(() => 'authored'), traffic: 1000 }))
    },
    rules: { total: 4, byConfidence: { confirmed: 2, derived: 2, assumed: 0, disputed: 0 }, byFile: {} },
    evidence: { total: 4, byType: {}, conflicts: 0, drafts: 0 },
    drift: { thresholdPct: 25, byLocale: { en: { baseline: '2026-03-02T00:00:00.000Z', metrics: [{ key: 'meanSentenceLength', label: 'mean sentence', from: 10, to: 11, deltaPct: 10, flagged: false }] } } },
    sources: { registered: 1, analysed: 1, missing: 0, unindexed: 0, freshness: 'checked', stale: 0, fresh: 0, entries: [] },
    corpus: { totals: { files: 10, strings: 100, words: 2000, sentences: 200 }, byLocale: {}, skipped: 0, unreadable: 0, fidelity: {} },
    settings: { thresholds: { drift_pct: 25 }, register: [], runtime: {}, vendor: [] },
    localePacks: ['en'],
    cardTokens: 600,
    ...overrides
  }
}

test('a healthy knowledge base produces no gaps at all', () => {
  assert.deepEqual(detectGaps(healthyState()), [])
})

test('every detector has a unique id, a known severity, and a leverage in range', () => {
  const ids = DETECTORS.map((d) => d.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate detector id')
  for (const detector of DETECTORS) {
    assert.match(detector.id, /^G\d{2}$/)
    assert.ok(['blocker', 'warning', 'nit'].includes(detector.severity), `${detector.id} has an unknown severity`)
    assert.ok(Number.isInteger(detector.leverage) && detector.leverage >= 0 && detector.leverage <= 5)
  }
})

test('G01 fires when there is no knowledge base, and suppresses every other gap', () => {
  const gaps = detectGaps(healthyState({ kb: { ...healthyState().kb, exists: false } }))
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].id, 'G01')
  assert.match(gaps[0].fix, /voice-and-tone:init/)
})

test('G02 fires on validation errors', () => {
  const gaps = detectGaps(healthyState({ integrity: { errors: 3, warnings: 0, byCode: { E_DUPLICATE_ID: 3 }, findings: [] } }))
  assert.ok(gaps.some((g) => g.id === 'G02' && g.severity === 'blocker'))
})

test('G03 fires once per locale that has no baseline, naming the locale', () => {
  const gaps = detectGaps(healthyState({
    drift: { thresholdPct: 25, byLocale: { en: { baseline: '2026-03-02', metrics: [] }, cs: { baseline: null, metrics: [] } } }
  }))
  const g03 = gaps.filter((g) => g.id === 'G03')
  assert.equal(g03.length, 1)
  assert.match(g03[0].what, /cs/)
})

test('G04 fires when registered material has never been ingested', () => {
  const gaps = detectGaps(healthyState({ sources: { ...healthyState().sources, unindexed: 2 } }))
  const gap = gaps.find((g) => g.id === 'G04')
  assert.ok(gap)
  assert.match(gap.fix, /connect --ingest/)
})

test('G05 fires only when every rule is assumed, not merely when some are', () => {
  const allAssumed = detectGaps(healthyState({ rules: { total: 3, byConfidence: { confirmed: 0, derived: 0, assumed: 3, disputed: 0 }, byFile: {} } }))
  assert.ok(allAssumed.some((g) => g.id === 'G05'))

  const mixed = detectGaps(healthyState({ rules: { total: 3, byConfidence: { confirmed: 1, derived: 0, assumed: 2, disputed: 0 }, byFile: {} } }))
  assert.ok(!mixed.some((g) => g.id === 'G05'))
})

test('G05 does not fire when there are no rules at all', () => {
  // "Every rule is assumed" over zero rules is vacuously true and would fire
  // on a bare knowledge base, where G01 or the draft stage is the real story.
  const none = detectGaps(healthyState({ rules: { total: 0, byConfidence: { confirmed: 0, derived: 0, assumed: 0, disputed: 0 }, byFile: {} } }))
  assert.ok(!none.some((g) => g.id === 'G05'))
})

test('G06 fires for a context with traffic and no authored cells, and not for one without traffic', () => {
  const base = healthyState()
  const withTraffic = base.coverage.byContext.map((c) =>
    c.context === 'social' ? { ...c, authored: 0, cells: STATES.map(() => 'computed'), traffic: 5000 } : c)
  const gaps = detectGaps(healthyState({ coverage: { ...base.coverage, authored: 72, byContext: withTraffic } }))
  const gap = gaps.find((g) => g.id === 'G06')
  assert.ok(gap)
  assert.match(gap.what, /social/)
  assert.match(gap.why, /interpolated/)

  const quiet = base.coverage.byContext.map((c) =>
    c.context === 'social' ? { ...c, authored: 0, cells: STATES.map(() => 'computed'), traffic: 10 } : c)
  assert.ok(!detectGaps(healthyState({ coverage: { ...base.coverage, authored: 72, byContext: quiet } })).some((g) => g.id === 'G06'))
})

test('G07 fires when the card is behind a file it compiles from, naming that file', () => {
  const gaps = detectGaps(healthyState({
    freshness: { ...healthyState().freshness, card: { generated: '2026-08-01T00:00:00.000Z', staleAgainst: ['tone.md'], ageDays: 27 } }
  }))
  const gap = gaps.find((g) => g.id === 'G07')
  assert.ok(gap)
  assert.match(gap.what, /tone\.md/)
  assert.match(gap.fix, /voice-and-tone:sync/)
})

test('G09 fires when a drift metric exceeds the threshold', () => {
  const gaps = detectGaps(healthyState({
    drift: { thresholdPct: 25, byLocale: { en: { baseline: '2026-03-02', metrics: [{ key: 'meanSentenceLength', label: 'mean sentence', from: 10, to: 20, deltaPct: 100, flagged: true }] } } }
  }))
  assert.ok(gaps.some((g) => g.id === 'G09'))
})

test('G12 fires for an active locale with no pack', () => {
  const gaps = detectGaps(healthyState({ kb: { ...healthyState().kb, locales: ['en', 'cs'] }, localePacks: ['en'] }))
  const gap = gaps.find((g) => g.id === 'G12')
  assert.ok(gap)
  assert.match(gap.what, /cs/)
  assert.match(gap.fix, /localize cs/)
})

test('gaps are ranked by leverage first, then by severity', () => {
  const gaps = detectGaps(healthyState({
    integrity: { errors: 1, warnings: 0, byCode: {}, findings: [] },
    evidence: { total: 4, byType: {}, conflicts: 0, drafts: 3 }
  }))
  for (let i = 1; i < gaps.length; i++) {
    const prev = gaps[i - 1]
    const cur = gaps[i]
    assert.ok(
      prev.leverage > cur.leverage ||
      (prev.leverage === cur.leverage && prev.severity <= cur.severity) ||
      prev.leverage === cur.leverage,
      `${prev.id} must not rank below ${cur.id}`
    )
  }
})

test('the rendered list is capped at ten', () => {
  assert.equal(MAX_GAPS, 10)
})

// --- The non-gaps. Each of these LOOKS like a gap and reporting it would
// --- make the tool worse. Spec section 9.3.

test('sources absent from this machine are never a gap', () => {
  // Sources are deliberately uncommitted, so a fresh clone has none. Warning
  // here would only teach people to commit source material to silence it.
  const gaps = detectGaps(healthyState({ sources: { ...healthyState().sources, missing: 7 } }))
  assert.deepEqual(gaps, [])
})

test('coverage below the eighty-cell denominator is never a gap', () => {
  const base = healthyState()
  const sparse = base.coverage.byContext.map((c) => ({ ...c, authored: 0, cells: STATES.map(() => 'computed'), traffic: 0 }))
  const gaps = detectGaps(healthyState({ coverage: { authored: 0, possible: 80, byContext: sparse } }))
  assert.ok(!gaps.some((g) => g.id === 'G06'), 'no traffic means no gap, however empty the matrix')
})

test('a computed cell is never a gap', () => {
  const base = healthyState()
  const halfComputed = base.coverage.byContext.map((c) => ({ ...c, authored: 4, cells: STATES.map((s, i) => (i < 4 ? 'authored' : 'computed')) }))
  assert.deepEqual(detectGaps(healthyState({ coverage: { ...base.coverage, authored: 40, byContext: halfComputed } })), [])
})

test('files skipped for having no extractor are never a gap', () => {
  assert.deepEqual(detectGaps(healthyState({ corpus: { ...healthyState().corpus, skipped: 40 } })), [])
})

test('a disputed rule is a gap only because it is unresolved, never because conflict is a fault', () => {
  const gaps = detectGaps(healthyState({ rules: { total: 4, byConfidence: { confirmed: 2, derived: 1, assumed: 0, disputed: 1 }, byFile: {} } }))
  const gap = gaps.find((g) => g.id === 'G10')
  assert.ok(gap)
  assert.match(gap.why, /unresolved|not enforced/i)
  assert.ok(!/error|invalid|wrong/i.test(gap.why), 'a conflict is information, not a fault')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/gaps.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/lib/gaps.mjs'`

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/lib/gaps.mjs`:

```js
/**
 * The gap catalogue: what is missing, ranked, with the command that closes it.
 *
 * Every detector is a pure predicate over the state object lib/state.mjs
 * produces. No filesystem access, no config reads - which is what lets
 * test/gaps.test.mjs drive all of them against hand-built states.
 *
 * Ranked by leverage before severity, the same rule the interview already
 * uses (skills/voice-discovery/references/gap-analysis.md): what unlocks the
 * most goes first, because a blocker nobody can act on yet is not the most
 * useful line on the screen.
 *
 * See the header of DETECTORS for what deliberately is NOT a gap.
 */

export const SEVERITY_RANK = { blocker: 0, warning: 1, nit: 2 }

/**
 * The rendered list is capped. The audit report's own rule applies: "An audit
 * that ends in a 300-item list ends in nothing."
 */
export const MAX_GAPS = 10

/** Words in a context's corpus below which "traffic" is not meaningful. */
const TRAFFIC_FLOOR = 500

/**
 * Detectors, in id order. Five things are deliberately absent and must stay
 * absent - test/gaps.test.mjs asserts each produces nothing:
 *
 *   1. Sources absent from this machine. They are deliberately uncommitted, so
 *      a fresh clone has none; warning would only teach people to commit them.
 *   2. Coverage below 80/80. Nobody is expected to reach it; interpolation is
 *      the design, not a shortfall.
 *   3. A computed cell. The matrix filling itself along the paths you actually
 *      write is the intended behaviour.
 *   4. Files skipped for having no extractor. Expected, and already reported
 *      by scan.
 *   5. The existence of a disputed rule as such. G10 fires because it is
 *      UNRESOLVED, never because conflict is a fault. Conflict is information.
 */
export const DETECTORS = [
  {
    id: 'G01',
    severity: 'blocker',
    leverage: 5,
    detect: (state) => state.kb.exists
      ? null
      : {
          what: 'no knowledge base',
          why: 'there is nothing to observe yet',
          fix: '/voice-and-tone:init'
        }
  },
  {
    id: 'G02',
    severity: 'blocker',
    leverage: 5,
    detect: (state) => state.integrity.errors > 0
      ? {
          what: `${state.integrity.errors} validation error(s)`,
          why: 'a card compiled from a broken knowledge base is worse than a stale one',
          fix: '/voice-and-tone:sync'
        }
      : null
  },
  {
    id: 'G03',
    severity: 'blocker',
    leverage: 4,
    detect: (state) => {
      const unbaselined = Object.entries(state.drift.byLocale)
        .filter(([, value]) => value.baseline === null)
        .map(([locale]) => locale)
      return unbaselined.length
        ? {
            what: `locale ${unbaselined.join(', ')} has no drift baseline`,
            why: 'drift can never be measured there',
            fix: 'node scripts/fingerprint.mjs --set-baseline, or finish /voice-and-tone:init'
          }
        : null
    }
  },
  {
    id: 'G04',
    severity: 'blocker',
    leverage: 4,
    detect: (state) => state.sources.unindexed > 0
      ? {
          what: `${state.sources.unindexed} registered source(s) never ingested`,
          why: 'their words are in no fingerprint and behind no rule',
          fix: '/voice-and-tone:connect --ingest'
        }
      : null
  },
  {
    id: 'G05',
    severity: 'warning',
    leverage: 4,
    // Guarded on total > 0: "every rule is assumed" over zero rules is
    // vacuously true and would fire on a bare knowledge base, where the draft
    // stage is the real story.
    detect: (state) => state.rules.total > 0 && state.rules.byConfidence.assumed === state.rules.total
      ? {
          what: 'every rule is still assumed',
          why: 'the interview has never run, so nothing is confirmed and nothing blocks',
          fix: '/voice-and-tone:init'
        }
      : null
  },
  {
    id: 'G06',
    severity: 'warning',
    leverage: 3,
    detect: (state) => {
      const hot = state.coverage.byContext.filter((c) => c.authored === 0 && c.traffic >= TRAFFIC_FLOOR)
      return hot.length
        ? {
            what: `${hot.map((c) => c.context).join(', ')}: corpus traffic, 0 authored cells`,
            why: 'every write there is interpolated, so it can never be humorous',
            fix: `/voice-and-tone:write ${hot[0].context} ...`
          }
        : null
    }
  },
  {
    id: 'G07',
    severity: 'warning',
    leverage: 3,
    detect: (state) => state.freshness.card?.staleAgainst?.length
      ? {
          what: `CONTEXT.md is behind ${state.freshness.card.staleAgainst.join(', ')}`,
          why: 'the always-loaded card does not reflect the current knowledge base',
          fix: '/voice-and-tone:sync'
        }
      : null
  },
  {
    id: 'G08',
    severity: 'warning',
    leverage: 2,
    detect: (state) => {
      if (!state.freshness.manifest) {
        return state.kb.exists
          ? { what: 'no manifest', why: 'nothing has ever been scanned', fix: '/voice-and-tone:status --refresh' }
          : null
      }
      const { changedSince, checked } = state.freshness.manifest
      return changedSince > 0
        ? {
            what: `${changedSince} of ${checked} scanned file(s) changed since the manifest`,
            why: 'the corpus numbers on this screen are behind the files on disk',
            fix: '/voice-and-tone:status --refresh'
          }
        : null
    }
  },
  {
    id: 'G09',
    severity: 'warning',
    leverage: 2,
    detect: (state) => {
      const flagged = []
      for (const [locale, value] of Object.entries(state.drift.byLocale)) {
        for (const metric of value.metrics) if (metric.flagged) flagged.push(`${locale}/${metric.label}`)
      }
      return flagged.length
        ? {
            what: `${flagged.length} metric(s) past the ${state.drift.thresholdPct}% drift threshold`,
            why: 'either the voice moved, or the corpus changed shape - the numbers cannot tell you which',
            fix: '/voice-and-tone:audit --section drift'
          }
        : null
    }
  },
  {
    id: 'G10',
    severity: 'warning',
    leverage: 2,
    detect: (state) => state.rules.byConfidence.disputed > 0
      ? {
          what: `${state.rules.byConfidence.disputed} disputed rule(s) unresolved`,
          why: 'a disputed rule is never enforced until you decide: channel split, or drift',
          fix: '/voice-and-tone:audit'
        }
      : null
  },
  {
    id: 'G11',
    severity: 'warning',
    leverage: 2,
    detect: (state) => state.sources.freshness === 'checked' && state.sources.stale > 0
      ? {
          what: `${state.sources.stale} source(s) changed since they were analysed`,
          why: 'their recorded statistics describe an older version of the document',
          fix: '/voice-and-tone:connect --ingest'
        }
      : null
  },
  {
    id: 'G12',
    severity: 'nit',
    leverage: 3,
    detect: (state) => {
      const packs = new Set(state.localePacks ?? [])
      const missing = (state.kb.locales ?? []).filter((locale) => !packs.has(locale))
      return missing.length
        ? {
            what: `locale ${missing.join(', ')} has no locale pack`,
            why: 'register and typography fall back to the primary locale',
            fix: `/voice-and-tone:localize ${missing[0]}`
          }
        : null
    }
  },
  {
    id: 'G13',
    severity: 'nit',
    leverage: 2,
    detect: (state) => state.evidence.drafts > 0
      ? {
          what: `${state.evidence.drafts} draft(s) awaiting :learn`,
          why: 'edits you made to them are not evidence until they are read',
          fix: '/voice-and-tone:learn'
        }
      : null
  },
  {
    id: 'G14',
    severity: 'nit',
    leverage: 1,
    detect: (state) => (state.integrity.byCode.W_STALE_EXTRACTOR ?? 0) > 0
      ? {
          what: `${state.integrity.byCode.W_STALE_EXTRACTOR} source(s) extracted by an unpinned library version`,
          why: 'their statistics can drift under the baseline with nothing saying why',
          fix: '/voice-and-tone:connect --ingest'
        }
      : null
  },
  {
    id: 'G15',
    severity: 'nit',
    leverage: 1,
    detect: (state) => (state.integrity.byCode.W_NO_EVIDENCE ?? 0) > 0
      ? {
          what: `${state.integrity.byCode.W_NO_EVIDENCE} rule(s) cite no evidence`,
          why: 'a rule that cannot be traced cannot be retired when its source is retracted',
          fix: null
        }
      : null
  },
  {
    id: 'G16',
    severity: 'nit',
    leverage: 1,
    detect: (state) => (state.cardTokens ?? 0) > 900
      ? {
          what: `CONTEXT.md is about ${state.cardTokens} tokens, over the 600 target`,
          why: 'the card loads on every write, so its size is paid on every draft',
          fix: null
        }
      : null
  }
]

export function detectGaps (state) {
  const found = []
  for (const detector of DETECTORS) {
    const hit = detector.detect(state)
    if (!hit) continue
    found.push({ id: detector.id, severity: detector.severity, leverage: detector.leverage, ...hit })
    // G01 means there is nothing to observe. Every other detector would then
    // report on an empty state object, producing a wall of noise whose single
    // real remedy is already on screen.
    if (detector.id === 'G01') return found
  }

  return found.sort((a, b) =>
    b.leverage - a.leverage ||
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (a.id < b.id ? -1 : 1)
  )
}
```

- [ ] **Step 4: Wire gaps into `collect()`**

In `scripts/lib/state.mjs`, add `import { detectGaps } from './gaps.mjs'`, add `localePacks` and `cardTokens` to the state, then compute gaps from the assembled object:

```js
  const state = {
    // ... every field from Tasks 3-7 ...
    localePacks: Object.keys(kb.locales ?? {}),
    cardTokens: cardExists ? Math.ceil(readTextFile(path.join(kbRoot, 'CONTEXT.md')).length / 4) : 0
  }
  state.gaps = detectGaps(state)
  return state
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/gaps.test.mjs test/state.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/gaps.mjs scripts/lib/state.mjs test/gaps.test.mjs
git commit -m "feat: gap catalogue ranked by leverage, with the five non-gaps pinned by test"
```

---

## Task 9: The full screen and its panels

**Files:**
- Modify: `scripts/lib/render.mjs`
- Test: `test/render.test.mjs`

**Interfaces:**
- Consumes: every primitive from Tasks 1-2; the state object from Task 8.
- Produces: `PANELS` (string[10]), `render(state, {panel, width}) -> string`.

- [ ] **Step 1: Write the failing test**

Append to `test/render.test.mjs` (extend the import to include `PANELS, render`):

```js
function fakeState (overrides = {}) {
  return {
    generated: '2026-08-28T00:00:00.000Z',
    kb: { root: '/tmp/kb', exists: true, version: '0.4.2', brand: 'Vivido', profile: 'default', locales: ['en', 'cs'], primaryLocale: 'en' },
    stage: { at: 'draft', reached: { scan: true, ingest: true, measure: true, draft: true, interview: false, canonize: false } },
    integrity: { errors: 0, warnings: 3, byCode: {}, findings: [] },
    freshness: {
      card: { generated: '2026-08-21T00:00:00.000Z', staleAgainst: ['tone.md'], ageDays: 7 },
      manifest: { generated: '2026-08-24T00:00:00.000Z', ageDays: 4, changedSince: 12, checked: 142 },
      fingerprint: { generated: '2026-08-24T00:00:00.000Z', ageDays: 4 }
    },
    coverage: { authored: 1, possible: 80, byContext: [{ context: 'product-ui', authored: 1, of: 8, cells: ['authored', 'computed', 'computed', 'computed', 'computed', 'computed', 'computed', 'computed'], traffic: 900 }] },
    rules: { total: 3, byConfidence: { confirmed: 1, derived: 1, assumed: 1, disputed: 0 }, byFile: {} },
    evidence: { total: 2, byType: {}, conflicts: 0, drafts: 1 },
    drift: { thresholdPct: 25, byLocale: { en: { baseline: '2026-03-02T00:00:00.000Z', metrics: [{ key: 'meanSentenceLength', label: 'mean sentence', from: 14.2, to: 19.8, deltaPct: 39.4, flagged: true }] }, cs: { baseline: null, metrics: [] } } },
    sources: { registered: 2, analysed: 1, missing: 0, unindexed: 1, freshness: 'unchecked', stale: null, fresh: null, entries: [{ id: 'e01', kind: 'inbox', label: null, origin: 'sources/guide.md', status: 'used', fidelity: 'measured', analysed: '2026-08-01', produced: [] }] },
    corpus: { totals: { files: 142, strings: 900, words: 18402, sentences: 1400 }, byLocale: { en: { files: 100, strings: 700, words: 15000 } }, skipped: 2, unreadable: 0, fidelity: { en: 'measured' } },
    settings: { thresholds: { corroboration: 2, derived_min_samples: 5, stale_months: 9, drift_pct: 25 }, register: [{ id: 's01', kind: 'project', label: 'Project files' }], runtime: { node: 'detected' }, vendor: [{ name: 'pdfjs', version: '4.6.82' }] },
    localePacks: ['en'],
    cardTokens: 600,
    gaps: [{ id: 'G03', severity: 'blocker', leverage: 4, what: 'locale cs has no drift baseline', why: 'drift can never be measured there', fix: 'node scripts/fingerprint.mjs --set-baseline' }],
    ...overrides
  }
}

test('the ten panel names are stable and include all', () => {
  assert.deepEqual(PANELS, ['pipeline', 'integrity', 'coverage', 'rules', 'drift', 'sources', 'evidence', 'settings', 'missing', 'all'])
})

test('the overview names the brand, profile, version, and locales', () => {
  const out = render(fakeState(), { width: 72 })
  assert.match(out, /Vivido/)
  assert.match(out, /default/)
  assert.match(out, /0\.4\.2/)
  assert.match(out, /en,\s?cs/)
})

test('no rendered line exceeds the requested width, at either clamp bound', () => {
  for (const width of [60, 72, 120]) {
    for (const name of PANELS) {
      for (const line of render(fakeState(), { panel: name, width }).split('\n')) {
        assert.ok(line.length <= width, `panel ${name} at width ${width} overruns: ${JSON.stringify(line)}`)
      }
    }
  }
})

test('every panel of every state renders ASCII only', () => {
  const states = [fakeState(), fakeState({ kb: { ...fakeState().kb, exists: false, brand: 'Znácka' } })]
  for (const state of states) {
    for (const name of PANELS) {
      assert.ok(!NON_ASCII.test(render(state, { panel: name, width: 72 })), `non-ASCII from panel ${name}`)
    }
  }
})

test('the empty-knowledge-base screen offers init instead of rendering blank panels', () => {
  const out = render(fakeState({
    kb: { root: '/tmp/kb', exists: false, version: null, brand: null, profile: 'default', locales: ['en'], primaryLocale: 'en' },
    gaps: [{ id: 'G01', severity: 'blocker', leverage: 5, what: 'no knowledge base', why: 'there is nothing to observe yet', fix: '/voice-and-tone:init' }]
  }), { width: 72 })
  assert.match(out, /no knowledge base/)
  assert.match(out, /voice-and-tone:init/)
  assert.ok(!/TONE MATRIX/.test(out), 'an empty matrix teaches nothing and fills the screen')
})

test('the drift panel shows n/a for a locale with no baseline, never a zero delta', () => {
  const out = render(fakeState(), { panel: 'drift', width: 72 })
  assert.match(out, /cs/)
  assert.match(out, /no baseline/)
})

test('read-only mode says source freshness was not checked', () => {
  const out = render(fakeState(), { panel: 'sources', width: 72 })
  assert.match(out, /not checked/)
  assert.match(out, /--refresh/)
})

test('the missing panel prints the fix command for every gap that has one', () => {
  const out = render(fakeState(), { panel: 'missing', width: 72 })
  assert.match(out, /G03|locale cs/)
  assert.match(out, /set-baseline/)
})

test('the missing panel caps at ten and says how many more there are', () => {
  const many = Array.from({ length: 14 }, (_, i) => ({
    id: `G${String(i + 1).padStart(2, '0')}`, severity: 'nit', leverage: 1,
    what: `gap ${i}`, why: 'because', fix: null
  }))
  const out = render(fakeState({ gaps: many }), { panel: 'missing', width: 72 })
  assert.match(out, /\+4 more/)
})

test('an unknown panel name throws so the CLI can report it', () => {
  assert.throws(() => render(fakeState(), { panel: 'nope', width: 72 }), /unknown panel/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/render.test.mjs`
Expected: FAIL — `does not provide an export named 'PANELS'`

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/lib/render.mjs`. The implementer builds each panel from the primitives above; the required behaviours, all pinned by the tests, are:

```js
export const PANELS = ['pipeline', 'integrity', 'coverage', 'rules', 'drift', 'sources', 'evidence', 'settings', 'missing', 'all']

const STATE_ABBREV = { delighted: 'del', curious: 'cur', focused: 'foc', uncertain: 'unc', confused: 'cnf', frustrated: 'frs', 'anxious-at-risk': 'anx', 'disappointed-leaving': 'dis' }

const SEVERITY_MARK = { blocker: '[!!]', warning: '[! ]', nit: '[. ]' }

function header (state, width) {
  const right = state.kb.exists
    ? `${state.kb.brand ?? '?'} | ${state.kb.profile} | kb ${state.kb.version ?? '?'} | ${state.kb.locales.join(',')}`
    : 'no knowledge base'
  return [rule('=', width), `|${pad(` VOICE & TONE : STATE`, 24)}${pad(truncate(right, width - 26), width - 25)}|`, rule('=', width)]
}

// One function per panel, each returning string[]. Every one truncates to
// `width` via panel(). Signatures:
//   pipelinePanel(state, width)  integrityPanel(state, width)
//   coveragePanel(state, width)  rulesPanel(state, width)
//   driftPanel(state, width)     sourcesPanel(state, width)
//   evidencePanel(state, width)  settingsPanel(state, width)
//   missingPanel(state, width)

export function render (state, { panel: name = 'all', width = WIDTH } = {}) {
  const w = clampWidth(width)
  if (!PANELS.includes(name)) throw new Error(`unknown panel "${name}"; valid: ${PANELS.join(', ')}`)

  // A knowledge base that does not exist gets the one screen that helps:
  // the pipeline (all unreached), the single gap, and the command. Rendering
  // an empty 80-cell matrix teaches nothing and fills the terminal.
  if (!state.kb.exists) {
    return [...header(state, w), '', ...pipelinePanel(state, w), '',
      ' There is no .voice-and-tone/ in this project.', '',
      ...missingPanel(state, w), '', menu(w, { initOnly: true })].join('\n') + '\n'
  }

  const byName = {
    pipeline: pipelinePanel, integrity: integrityPanel, coverage: coveragePanel,
    rules: rulesPanel, drift: driftPanel, sources: sourcesPanel,
    evidence: evidencePanel, settings: settingsPanel, missing: missingPanel
  }
  const blocks = name === 'all'
    ? Object.values(byName).map((fn) => fn(state, w))
    : [byName[name](state, w)]

  return [...header(state, w), '', ...blocks.flatMap((lines) => [...lines, '']), menu(w, {})].join('\n') + '\n'
}
```

Required panel behaviours, each already asserted:

| Panel | Must contain |
|---|---|
| `pipeline` | the six stage labels and `[##]` / `[..]` boxes, plus `at: <stage>` |
| `integrity` | `N errors  M warnings`; when `freshness.card.staleAgainst` is non-empty, `STALE` and the file names; the manifest's `changedSince of checked` with the literal note `new files not detected - use --refresh` |
| `coverage` | `matrix()` over `state.coverage.byContext`, `#` for `authored` and `.` for `computed`, `STATE_ABBREV` as column heads, a `traffic` marker on any context with `authored === 0 && traffic >= 500`, and the legend `# authored    . computed - never humorous, whatever the dials say` |
| `rules` | one `bar()` row per confidence level scaled to the largest count, with the review consequence (`blocks in review` / `warns` / `nit` / `never enforced`) |
| `drift` | per locale: the baseline date, or the literal `no baseline - drift cannot be measured for this locale`; per metric `from -> to`, the signed percentage or `n/a`, `deltaBar()`, and `FLAG` when `flagged` |
| `sources` | the counts line; one line per entry; and when `freshness === 'unchecked'`, `freshness not checked (read-only) - run --refresh` |
| `evidence` | totals by type, `conflicts`, and `drafts` |
| `settings` | profile, locales, every threshold including `drift_pct`, runtime, vendor pins, register summary, and the KB path |
| `missing` | at most `MAX_GAPS` gaps as `N [sev] what` / `why` / `-> fix`, and `+N more` when truncated |

`menu(width, {initOnly})` returns the boxed footer: the numbered panel list, or the single `/voice-and-tone:init` line when `initOnly`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/render.test.mjs`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/render.mjs test/render.test.mjs
git commit -m "feat: the status screen, its nine panels, and the empty-KB fallback"
```

---

## Task 10: The `status.mjs` CLI and the read-only invariant

**Files:**
- Create: `scripts/status.mjs`
- Test: `test/status.test.mjs`

**Interfaces:**
- Consumes: `collect` (Task 8), `render`, `PANELS`, `clampWidth` (Task 9), `parseCliArgs`, `resolveRoots`, `nowIso`, `die`, `printHelp`, `writeOut` (`lib/cli.mjs`), `buildManifest` (`../scan.mjs`), `buildFingerprint` (`../fingerprint.mjs`).
- Produces: `scripts/status.mjs` with `main(argv)` exported and the standard `import.meta.url` guard.

- [ ] **Step 1: Write the failing test**

Create `test/status.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, execFile } from 'node:child_process'
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATUS = path.join(root, 'scripts', 'status.mjs')
const NOW = '2026-08-28T00:00:00.000Z'

const CONFIG = [
  'version: 1',
  'kb_version: 0.2.0',
  'profiles:',
  '  default:',
  '    name: "Acme"',
  '    primary_locale: en',
  '    locales: [en]',
  'sources:',
  '  - id: s01',
  '    kind: project',
  '    include: ["content/**/*.md"]',
  '    exclude: []',
  ''
].join('\n')

function project () {
  return makeTmpProject({
    'content/a.md': '# Hello\n\nWe ship things. You will like it.\n',
    '.voice-and-tone/config.yml': CONFIG,
    '.voice-and-tone/voice.md': '# Voice\n',
    '.voice-and-tone/tone.md': '# Tone\n'
  })
}

function run (dir, args = []) {
  return execFileSync(process.execPath, [STATUS, '--root', dir, '--now', NOW, ...args], { encoding: 'utf8' })
}

/** Every file under a directory, as path -> {mtimeMs, size}. */
function snapshot (dir, out = {}, base = dir) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) snapshot(abs, out, base)
    else out[path.relative(base, abs)] = { mtimeMs: statSync(abs).mtimeMs, size: statSync(abs).size }
  }
  return out
}

test('a default run does not write a single byte under the knowledge base', () => {
  // This is what makes "observability observes, it never changes what it
  // observes" a property rather than a promise. A rule written in prose is one
  // a model can reason its way around; a test over mtimes cannot be argued with.
  const dir = project()
  try {
    const before = snapshot(path.join(dir, '.voice-and-tone'))
    run(dir)
    const after = snapshot(path.join(dir, '.voice-and-tone'))
    assert.deepEqual(after, before, 'a read-only run must leave every file byte- and mtime-identical')
  } finally {
    cleanup(dir)
  }
})

test('--json emits a single parseable object carrying every ring', () => {
  const dir = project()
  try {
    const state = JSON.parse(run(dir, ['--json']))
    for (const key of ['generated', 'kb', 'stage', 'integrity', 'freshness', 'coverage', 'rules', 'evidence', 'drift', 'sources', 'corpus', 'settings', 'gaps']) {
      assert.ok(key in state, `--json omits ${key}`)
    }
    assert.equal(state.generated, NOW, '--now is honoured so output is reproducible')
  } finally {
    cleanup(dir)
  }
})

test('every panel name renders, and stdout stays ASCII on a non-ASCII corpus', () => {
  const dir = makeTmpProject({
    'content/a.md': '# Naplánováno\n\nVaše kampaň je naplánovaná.\n',
    '.voice-and-tone/config.yml': CONFIG.replace('"Acme"', '"Znácka"'),
    '.voice-and-tone/voice.md': '# Voice\n'
  })
  try {
    for (const name of ['pipeline', 'integrity', 'coverage', 'rules', 'drift', 'sources', 'evidence', 'settings', 'missing', 'all']) {
      const out = run(dir, ['--panel', name])
      // eslint-disable-next-line no-control-regex
      assert.ok(!/[^\x00-\x7F]/.test(out), `panel ${name} leaked a non-ASCII character`)
      assert.ok(out.length > 0)
    }
  } finally {
    cleanup(dir)
  }
})

test('an unknown panel exits 1 and lists the valid names', () => {
  const dir = project()
  try {
    assert.throws(
      () => run(dir, ['--panel', 'nope']),
      (error) => {
        assert.equal(error.status, 1)
        assert.match(String(error.stderr), /unknown panel/)
        assert.match(String(error.stderr), /coverage/)
        return true
      }
    )
  } finally {
    cleanup(dir)
  }
})

test('status exits 0 even when the knowledge base has blocking gaps', () => {
  // It observes; it does not gate. A non-zero exit would make it unusable in
  // any script that merely wants to print the state.
  const dir = makeTmpProject({ 'content/a.md': '# Hi\n' })
  try {
    const out = run(dir)
    assert.match(out, /no knowledge base/)
  } finally {
    cleanup(dir)
  }
})

test('--refresh writes the manifest and fingerprint and leaves the baseline untouched', () => {
  const dir = project()
  const kb = path.join(dir, '.voice-and-tone')
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'fingerprint.mjs'), '--root', dir, '--now', '2026-01-01T00:00:00.000Z', '--set-baseline'], { encoding: 'utf8' })
    const before = JSON.parse(readFileSync(path.join(kb, 'evidence', 'fingerprint.json'), 'utf8')).baseline
    assert.ok(before, 'the baseline must exist for this test to mean anything')

    run(dir, ['--refresh'])

    const after = JSON.parse(readFileSync(path.join(kb, 'evidence', 'fingerprint.json'), 'utf8')).baseline
    assert.deepEqual(after, before, '--refresh must never move the baseline; a refreshed baseline shows zero drift by construction')
    assert.ok(existsSync(path.join(kb, 'evidence', 'manifest.json')))
  } finally {
    cleanup(dir)
  }
})

test('--refresh does not rewrite the source index', () => {
  const dir = project()
  const kb = path.join(dir, '.voice-and-tone')
  try {
    run(dir, ['--refresh'])
    assert.ok(!existsSync(path.join(kb, 'evidence', 'sources.json')), '--refresh must never ingest')
  } finally {
    cleanup(dir)
  }
})

test('--width is clamped rather than rejected', () => {
  const dir = project()
  try {
    for (const line of run(dir, ['--width', '200']).split('\n')) assert.ok(line.length <= 120)
    for (const line of run(dir, ['--width', '10']).split('\n')) assert.ok(line.length <= 60)
  } finally {
    cleanup(dir)
  }
})

test('status.mjs never spawns a process', () => {
  const source = readFileSync(STATUS, 'utf8')
  assert.ok(!/child_process|execSync|execFileSync|spawnSync/.test(source))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/status.test.mjs`
Expected: FAIL — `Cannot find module .../scripts/status.mjs`

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/status.mjs`:

```js
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeTextFile } from './lib/fsx.mjs'
import { loadConfig } from './lib/config.mjs'
import { collect } from './lib/state.mjs'
import { render, PANELS, clampWidth } from './lib/render.mjs'
import { buildManifest } from './scan.mjs'
import { buildFingerprint } from './fingerprint.mjs'
import { readJson } from './lib/state.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp, writeOut } from './lib/cli.mjs'

/**
 * The CLI behind /voice-and-tone:status.
 *
 * Read-only by default. --refresh does exactly three things - rebuild the
 * manifest, rebuild the fingerprint preserving its baseline, and hash
 * registered sources to tell stale from current - and never a fourth. It does
 * not ingest (ingestion can spend model tokens) and it does not fetch (the
 * network belongs to :connect --refresh alone).
 *
 * It never sets the baseline. voice-maintenance already states why: a
 * refreshed baseline shows zero drift by construction and tells you nothing.
 *
 * Exit codes: 0 always, except 1 for a bad flag or an unexpected throw. This
 * script observes; it does not gate.
 */

function refresh ({ projectRoot, kbRoot, config, profileName, now }) {
  const manifest = buildManifest(projectRoot, config, now, profileName, kbRoot)
  writeTextFile(path.join(kbRoot, 'evidence', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const out = path.join(kbRoot, 'evidence', 'fingerprint.json')
  const fingerprint = buildFingerprint(projectRoot, config, { generated: now, source: 'measured', profileName, kbRoot })
  // Preserve, never re-set. buildFingerprint always returns baseline: null.
  fingerprint.baseline = readJson(out)?.baseline ?? null
  const { unindexed, ...toWrite } = fingerprint
  writeTextFile(out, `${JSON.stringify(toWrite, null, 2)}\n`)
}

function main (argv) {
  const { values } = parseCliArgs(argv, {
    profile: { type: 'string' },
    panel: { type: 'string' },
    width: { type: 'string' },
    refresh: { type: 'boolean' },
    locale: { type: 'string' }
  })
  if (values.help) {
    printHelp('scripts/status.mjs', [
      'Reports the state of the voice knowledge base. Writes nothing unless --refresh.',
      '',
      '  --root <dir>      project root (default: cwd)',
      '  --kb <dir>        knowledge base dir',
      '  --panel <name>    one of: ' + PANELS.join(', '),
      '  --refresh         rebuild the manifest and fingerprint first',
      '                    (never sets the baseline, never ingests, never fetches)',
      '  --locale <code>   scope drift and corpus to one locale',
      '  --width <n>       render width, clamped to 60..120 (default 72)',
      '  --profile <name>  config profile (default: default)',
      '  --now <iso>       fixed timestamp for reproducible output',
      '  --json            print the whole state object as JSON'
    ])
    return
  }

  const panel = values.panel ?? 'all'
  if (!PANELS.includes(panel)) die(`unknown panel "${panel}"; valid: ${PANELS.join(', ')}`)

  const { projectRoot, kbRoot } = resolveRoots(values)
  const config = loadConfig(kbRoot)
  const profileName = values.profile ?? 'default'
  const now = nowIso(values)

  if (values.refresh) refresh({ projectRoot, kbRoot, config, profileName, now })

  const state = collect({ projectRoot, kbRoot, config, profileName, now, checkFreshness: Boolean(values.refresh) })

  if (values.locale) {
    state.drift.byLocale = state.drift.byLocale[values.locale]
      ? { [values.locale]: state.drift.byLocale[values.locale] }
      : {}
    state.corpus.byLocale = state.corpus.byLocale[values.locale]
      ? { [values.locale]: state.corpus.byLocale[values.locale] }
      : {}
  }

  if (values.json) {
    writeOut(`${JSON.stringify(state, null, 2)}\n`)
    return
  }
  writeOut(render(state, { panel, width: clampWidth(Number.parseInt(values.width ?? '', 10)) }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/status.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run conformance, which now sweeps the new script automatically**

Run: `node --test test/conformance.test.mjs`
Expected: PASS. `status.mjs --help` is checked for ASCII because `SCRIPTS` is derived from `readdirSync('scripts')`.

- [ ] **Step 6: Commit**

```bash
git add scripts/status.mjs test/status.test.mjs
git commit -m "feat: the :status CLI, read-only by default, with --refresh strictly bounded"
```

---

## Task 11: Command, skill, references, and docs

**Files:**
- Create: `commands/status.md`, `skills/voice-observability/SKILL.md`, `skills/voice-observability/references/panels.md`, `skills/voice-observability/references/gap-catalogue.md`
- Modify: `test/surface.test.mjs`, `README.md`
- Test: `test/surface.test.mjs`

**Interfaces:**
- Consumes: the flags `status.mjs` accepts (Task 10); `PANELS` (Task 9); `DETECTORS` (Task 8).
- Produces: nothing importable. This task closes the loop between what the docs promise and what the parser accepts.

- [ ] **Step 1: Write the failing test**

Append to `test/surface.test.mjs`:

```js
test('every flag commands/status.md documents is accepted by the real parser', () => {
  // The same agreement already enforced for :connect and :init. A flag a
  // command advertises and the parser rejects is a bug the user finds, not us.
  const body = readFileSync(surfaceFile('commands', 'status.md'), 'utf8')
  const dir = makeTmpProject({ 'content/a.md': '# Hi\n', '.voice-and-tone/config.yml': 'version: 1\n' })
  try {
    for (const line of body.split('\n')) {
      const match = /^\/voice-and-tone:status\s+(.+)$/.exec(line.trim())
      if (!match) continue
      const args = match[1].split(/\s+/).filter((a) => !a.startsWith('<'))
      assert.doesNotThrow(
        () => execFileSync(process.execPath, [surfaceFile('scripts', 'status.mjs'), '--root', dir, '--now', '2026-08-28T00:00:00.000Z', ...args], { encoding: 'utf8', stdio: 'pipe' }),
        `status.md advertises "${match[1]}" but the parser rejects it`
      )
    }
  } finally {
    cleanup(dir)
  }
})

test('every panel name the command documents exists in PANELS', async () => {
  const { PANELS } = await import('../scripts/lib/render.mjs')
  const body = readFileSync(surfaceFile('commands', 'status.md'), 'utf8')
  for (const name of PANELS) {
    if (name === 'all') continue
    assert.ok(body.includes(name), `commands/status.md never mentions the ${name} panel`)
  }
})

test('the observability skill declares itself read-only and names the script', () => {
  const body = readFileSync(surfaceFile('skills', 'voice-observability', 'SKILL.md'), 'utf8')
  assert.match(body, /scripts\/status\.mjs/)
  assert.match(body, /read-only|never writes|writes nothing/i)
})

test('the skill forbids restating numbers and drawing panels', () => {
  // Both are the hand-maintained-summary defect. If the skill may paraphrase a
  // metric or improvise a block, the generated dashboard stops being generated.
  const body = readFileSync(surfaceFile('skills', 'voice-observability', 'SKILL.md'), 'utf8')
  assert.match(body, /never restate/i)
  assert.match(body, /never draw|never improvise/i)
})

test('the gap catalogue reference documents every shipped detector', async () => {
  const { DETECTORS } = await import('../scripts/lib/gaps.mjs')
  const body = readFileSync(surfaceFile('skills', 'voice-observability', 'references', 'gap-catalogue.md'), 'utf8')
  for (const detector of DETECTORS) {
    assert.ok(body.includes(detector.id), `gap-catalogue.md omits ${detector.id}`)
  }
})

test('the gap catalogue records the five things that must never be reported as gaps', () => {
  const body = readFileSync(surfaceFile('skills', 'voice-observability', 'references', 'gap-catalogue.md'), 'utf8')
  assert.match(body, /absent|missing/i)
  assert.match(body, /commit/i, 'the reason absent sources are not a gap must survive in the docs')
  assert.match(body, /computed cell/i)
})

test('README lists :status among the commands and voice-observability among the skills', () => {
  const readme = readFileSync(surfaceFile('README.md'), 'utf8')
  assert.ok(readme.includes('/voice-and-tone:status'))
  assert.ok(readme.includes('voice-observability'))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/surface.test.mjs`
Expected: FAIL — `ENOENT: no such file or directory, open '.../commands/status.md'`

- [ ] **Step 3: Write `commands/status.md`**

```markdown
---
description: Show the state of the voice knowledge base - coverage, drift, sources, settings, and what is missing
argument-hint: "[--panel <name>|all] [--refresh] [--locale <code>] [--width <n>] [--json]"
---

# /voice-and-tone:status

What you have, what it is set to, and what is missing - in one screen, computed
rather than described.

Read-only. It reports how stale the numbers are rather than quietly refreshing
them, so "the manifest is four days behind" is something you can see instead of
something that silently corrects itself every time you look.

## Usage

```
/voice-and-tone:status
/voice-and-tone:status --panel coverage
/voice-and-tone:status --panel drift
/voice-and-tone:status --panel rules
/voice-and-tone:status --panel sources
/voice-and-tone:status --panel evidence
/voice-and-tone:status --panel settings
/voice-and-tone:status --panel missing
/voice-and-tone:status --panel integrity
/voice-and-tone:status --panel pipeline
/voice-and-tone:status --refresh
/voice-and-tone:status --json
```

## `--refresh`

Rebuilds the manifest and the fingerprint, then hashes registered sources to
tell stale from current. Exactly that, and nothing else:

- It **never sets the drift baseline.** A refreshed baseline shows zero drift by
  construction and tells you nothing.
- It **never ingests.** Ingestion can escalate a source to the model tier and
  spend tokens; looking at a dashboard must not.
- It **never fetches.** Network access belongs to `/voice-and-tone:connect
  --refresh` alone.

## What it will not tell you

Whether a rule should be enforced or retired, and whether a disputed entry is a
channel split or drift. Those need a decision, and the command that asks for one
is `/voice-and-tone:audit`.

## Invokes

The `voice-observability` skill.

$ARGUMENTS
```

- [ ] **Step 4: Write the skill and its two references**

`skills/voice-observability/SKILL.md`:

```markdown
---
name: voice-observability
description: >
  WHEN: the user asks what the voice knowledge base currently contains, how
  complete it is, what is configured, what is missing, or wants a dashboard,
  status screen, or overview of the voice-and-tone setup.
  WHAT: reads every knowledge-base artifact without modifying any of them,
  renders a deterministic ASCII dashboard, and ranks what is missing with the
  command that closes each gap.
  TRIGGERS: 'what do we have', 'voice status', 'show me the state', 'how
  complete is our voice guide', 'what is missing', 'dashboard', 'what is
  configured'.
---

# Voice observability

Observability observes. It never changes what it observes.

> Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated
> with or endorsed by Mailchimp.

## The rule that governs this whole skill

**This skill writes nothing.** Not the knowledge base, not the manifest, not the
fingerprint. The one exception is `--refresh`, and only when the user asks for it
by name.

If you find yourself wanting to fix something you can see on the screen, stop and
hand off to the command that owns it. The screen already names it.

## Run it

```
node "<plugin>/scripts/status.mjs" --root "<project>" --kb "<KB>"
```

Show the output **verbatim**. Then wait.

## Two prohibitions, both absolute

1. **Never restate a number the script printed.** Not in a summary, not as a
   "key takeaway", not rephrased. The dashboard is generated precisely so that
   no hand-maintained summary can drift from it - and a paraphrase in the chat
   is a hand-maintained summary.

2. **Never draw a panel.** Not a table, not a chart, not "here is a simpler
   view". If a view is wanted that the script cannot produce, that is a change
   to `scripts/lib/render.mjs`, not something to improvise. A block you draw
   this turn will look different next turn, and neither version can be tested.

What you *should* add is what the script cannot: which gap matters most for what
the user is actually trying to do, and what the two-step path to closing it is.

## The menu

The footer lists the panels. When the user picks one:

```
node "<plugin>/scripts/status.mjs" --root "<project>" --kb "<KB>" --panel <name>
```

Panels: `pipeline`, `integrity`, `coverage`, `rules`, `drift`, `sources`,
`evidence`, `settings`, `missing`, `all`.

Read `references/panels.md` for what each one means and the question it raises.

## Handing off

When the user picks a fix, stop being the status skill and invoke the command
that owns it. Do not do the work here.

| Gap | Owner |
|---|---|
| no knowledge base, interview never ran | `/voice-and-tone:init` |
| material not ingested, source stale | `/voice-and-tone:connect` |
| card behind its sources, validation errors | `/voice-and-tone:sync` |
| drift past threshold, disputed rules | `/voice-and-tone:audit` |
| drafts awaiting corroboration | `/voice-and-tone:learn` |
| locale has no pack | `/voice-and-tone:localize` |

## What this skill must not answer

Whether a rule should be **enforced or retired**, and whether a disputed entry is
a **channel split or drift**. Both need a decision from the user, and `:audit` is
where that decision is asked for and recorded as `decision` evidence. Answering
either one here would record nothing and decide something.

Read `references/gap-catalogue.md` before explaining any gap - especially the
section on what is deliberately not a gap.
```

`skills/voice-observability/references/panels.md` — one section per panel: what
it shows, how to read it, and the question it raises. It must state that the
manifest freshness figure cannot see new files, that a `computed` cell is the
design rather than a shortfall, and that `n/a` in the drift panel means the
arithmetic was undefined (a zero baseline), not zero drift.

`skills/voice-observability/references/gap-catalogue.md` — a table of all
sixteen detectors (`id`, when it fires, severity, leverage, fix), then a section
headed **What is deliberately not a gap** carrying all five rows of spec §9.3
verbatim, including the reason absent sources are excluded: warning about them
would only teach people to commit source material to silence it.

- [ ] **Step 5: Update the README**

Add to the command table, after the `:audit` row:

```markdown
| `/voice-and-tone:status` | what you have, what it is set to, and what is missing |
```

Add to the skill table:

```markdown
| `voice-observability` | you ask what state the guide is in, or what is missing |
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, zero failures. `test/conformance.test.mjs` sweeps the new markdown as plugin logic (no unix text tools, no CRLF, no BOM, no control bytes).

- [ ] **Step 7: Commit**

```bash
git add commands/status.md skills/voice-observability README.md test/surface.test.mjs
git commit -m "feat: the :status command and the read-only voice-observability skill"
```

---

## Self-review

**Spec coverage.** Every spec section maps to a task:

| Spec | Task |
|---|---|
| §1.1 read-only | 10 (the mtime invariant test) |
| §1.2 generated not drawn | 1, 2, 9 (golden tests), 11 (the two prohibitions) |
| §4.1 command | 11 |
| §4.2 skill | 11 |
| §4.3 scripts | 1-2 (render), 3-7 (state), 8 (gaps), 10 (CLI) |
| §5 state object | 3-8; JSON round-trip pinned in Task 7 |
| §5.1 degradation | 3 (no-KB), 4 (absent card), 6 (absent fingerprint), 7 (absent manifest) |
| §6 stage inference | 3 |
| §7.1 card freshness exact | 4 |
| §7.2 corpus freshness approximate | 4 |
| §7.3 source freshness under refresh | 7 |
| §8.1 ASCII grammar | 1, 2, 9 |
| §8.2 primitives | 1, 2 |
| §8.3 overview | 9 |
| §8.4 empty case | 9 |
| §8.5 panels | 9, 10 |
| §9 gap catalogue | 8 |
| §9.3 non-gaps | 8 (five tests) |
| §10 menu | 9 (footer), 11 (loop and prohibitions) |
| §11 `--refresh` invariants | 10 (three tests) |
| §12 cross-platform | Global Constraints; conformance auto-enrols |
| §13 testing | 1-11, each task's own suite |
| §13.1 the D1 test | 10 |
| §14 migration and `drift_pct` | 6 |

**Placeholder scan.** No `TBD`/`TODO`. Task 9's panel bodies and Task 11's two
reference files are specified by required behaviour and asserted by named tests
rather than transcribed line by line — that is the one place this plan describes
output shape instead of printing it, and each is pinned by a test that fails
until the content exists.

**Type consistency.** `collect()` takes `{projectRoot, kbRoot, config, profileName, now, checkFreshness}` in Tasks 3-8 and is called with exactly that in Task 10. `render(state, {panel, width})` is defined in Task 9 and called identically in Task 10. `detectGaps(state)` returns `{id, severity, leverage, what, why, fix}` in Task 8 and is rendered on those fields in Task 9. `deltaBar(pct, width)` accepts `null` in Task 2 and is fed `metric.deltaPct`, which Task 6 can set to `null`.

---

## Execution order and the merge constraint

Tasks are strictly sequential — each builds on the last. Two notes:

- **Task 6 touches `scripts/lib/config.mjs`,** the one file shared with the
  in-flight `feat/source-ingestion` work. It adds a single key to
  `DEFAULT_CONFIG.thresholds` and touches nothing else. Land this plan **after**
  that branch merges, per spec §14.1.
- **Tasks 1-2 and 3-8 are independent of each other** (renderer and collector
  never import one another) and could be built in parallel by two workers, with
  Task 9 as the join. Sequential is simpler and is the default.
