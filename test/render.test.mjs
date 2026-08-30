import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WIDTH, MIN_WIDTH, MAX_WIDTH, clampWidth, rule, truncate, bar, pad, row,
  matrix, pipeline, deltaBar, panel, PANELS, render
} from '../scripts/lib/render.mjs'

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
  assert.match(out[0], /ingst/, 'stage labels are abbreviated so six fit across 72 columns')
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

function fakeState (overrides = {}) {
  return {
    generated: '2026-08-28T00:00:00.000Z',
    kb: {
      root: '/tmp/kb',
      exists: true,
      version: '0.4.2',
      brand: 'Vivido',
      profile: 'default',
      locales: ['en', 'cs'],
      primaryLocale: 'en'
    },
    stage: {
      at: 'draft',
      reached: { scan: true, ingest: true, measure: true, draft: true, interview: false, canonize: false }
    },
    integrity: { errors: 0, warnings: 3, byCode: {}, findings: [] },
    freshness: {
      card: { generated: '2026-08-21T00:00:00.000Z', staleAgainst: ['tone.md'], ageDays: 7 },
      manifest: { generated: '2026-08-24T00:00:00.000Z', ageDays: 4, changedSince: 12, checked: 142 },
      fingerprint: { generated: '2026-08-24T00:00:00.000Z', ageDays: 4 }
    },
    coverage: {
      authored: 1,
      possible: 80,
      states: ['delighted', 'curious', 'focused', 'uncertain', 'confused', 'frustrated', 'anxious-at-risk', 'disappointed-leaving'],
      humorGated: ['frustrated', 'anxious-at-risk', 'disappointed-leaving'],
      byContext: [{
        context: 'product-ui',
        authored: 1,
        of: 8,
        cells: ['authored', 'computed', 'computed', 'computed', 'computed', 'computed', 'computed', 'computed'],
        traffic: 900
      }]
    },
    rules: { total: 3, byConfidence: { confirmed: 1, derived: 1, assumed: 1, disputed: 0 }, byFile: {} },
    evidence: { total: 2, byType: { source: 2 }, conflicts: 0, drafts: 1 },
    drift: {
      thresholdPct: 25,
      byLocale: {
        en: {
          baseline: '2026-03-02T00:00:00.000Z',
          metrics: [{ key: 'meanSentenceLength', label: 'mean sentence', from: 14.2, to: 19.8, deltaPct: 39.4, flagged: true }]
        },
        cs: { baseline: null, metrics: [] }
      }
    },
    sources: {
      registered: 2,
      analysed: 1,
      missing: 0,
      unindexed: 1,
      freshness: 'unchecked',
      stale: null,
      fresh: null,
      entries: [{
        id: 'e01',
        kind: 'inbox',
        label: null,
        origin: 'sources/guide.md',
        status: 'used',
        fidelity: 'measured',
        analysed: '2026-08-01',
        produced: []
      }]
    },
    corpus: {
      totals: { files: 142, strings: 900, words: 18402, sentences: 1400 },
      byLocale: { en: { files: 100, strings: 700, words: 15000 } },
      skipped: 2,
      unreadable: 0,
      fidelity: { en: 'measured' }
    },
    settings: {
      thresholds: { corroboration: 2, derived_min_samples: 5, stale_months: 9, drift_pct: 25 },
      register: [{ id: 's01', kind: 'project', label: 'Project files' }],
      runtime: { node: 'detected' },
      vendor: [{ name: 'pdfjs', version: '4.6.82' }]
    },
    localePacks: ['en'],
    cardTokens: 600,
    gaps: [{
      id: 'G03',
      severity: 'blocker',
      leverage: 4,
      what: 'locale cs has no drift baseline',
      why: 'drift can never be measured there',
      fix: 'node scripts/fingerprint.mjs --set-baseline'
    }],
    ...overrides
  }
}

test('the ten panel names are stable and include all', () => {
  assert.deepEqual(PANELS, [
    'pipeline', 'integrity', 'coverage', 'rules', 'drift', 'sources', 'evidence', 'settings', 'missing', 'all'
  ])
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
  const states = [
    fakeState(),
    fakeState({ kb: { ...fakeState().kb, exists: false, brand: 'Značka' } })
  ]
  for (const state of states) {
    for (const name of PANELS) {
      assert.ok(!NON_ASCII.test(render(state, { panel: name, width: 72 })), `non-ASCII from panel ${name}`)
    }
  }
})

test('the empty-knowledge-base screen offers init instead of rendering blank panels', () => {
  const out = render(fakeState({
    kb: { root: '/tmp/kb', exists: false, version: null, brand: null, profile: 'default', locales: ['en'], primaryLocale: 'en' },
    gaps: [{
      id: 'G01',
      severity: 'blocker',
      leverage: 5,
      what: 'no knowledge base',
      why: 'there is nothing to observe yet',
      fix: '/voice-and-tone:init'
    }]
  }), { width: 72 })
  assert.match(out, /no knowledge base/)
  assert.match(out, /voice-and-tone:init/)
  assert.ok(!/TONE MATRIX/.test(out), 'an empty matrix teaches nothing and fills the screen')
})

test('the drift panel shows the unbaselined locale explicitly, never a zero delta', () => {
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
  assert.match(out, /locale cs/)
  assert.match(out, /set-baseline/)
})

test('the missing panel caps at ten and says how many more there are', () => {
  const many = Array.from({ length: 14 }, (_unused, i) => ({
    id: `G${String(i + 1).padStart(2, '0')}`,
    severity: 'nit',
    leverage: 1,
    what: `gap ${i}`,
    why: 'because',
    fix: null
  }))
  const out = render(fakeState({ gaps: many }), { panel: 'missing', width: 72 })
  assert.match(out, /\+4 more/)
})

test('an unknown panel name throws so the CLI can report it', () => {
  assert.throws(() => render(fakeState(), { panel: 'nope', width: 72 }), /unknown panel/)
})
