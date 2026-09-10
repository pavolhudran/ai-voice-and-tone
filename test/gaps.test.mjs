import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DETECTORS, MAX_GAPS, detectGaps } from '../scripts/lib/gaps.mjs'
import { CONTEXTS, STATES } from '../scripts/lib/kb.mjs'

/** A knowledge base in perfect health: every detector must stay silent on it. */
function healthyState (overrides = {}) {
  return {
    generated: '2026-08-28T00:00:00.000Z',
    kb: {
      root: '/tmp/kb',
      exists: true,
      version: '1.0.0',
      brand: 'Acme',
      profile: 'default',
      locales: ['en'],
      primaryLocale: 'en',
      role: 'house',
      speaker: null
    },
    locks: { declared: [], violated: [] },
    speakers: [],
    stage: {
      at: 'canonize',
      reached: { scan: true, ingest: true, measure: true, draft: true, interview: true, canonize: true }
    },
    integrity: { errors: 0, warnings: 0, byCode: {}, findings: [] },
    freshness: {
      card: { generated: '2026-08-27T00:00:00.000Z', staleAgainst: [], ageDays: 1 },
      manifest: { generated: '2026-08-27T00:00:00.000Z', ageDays: 1, changedSince: 0, checked: 10 },
      fingerprint: { generated: '2026-08-27T00:00:00.000Z', ageDays: 1 }
    },
    coverage: {
      authored: 80,
      possible: 80,
      byContext: CONTEXTS.map((context) => ({
        context, authored: 8, of: 8, cells: STATES.map(() => 'authored'), traffic: 1000
      }))
    },
    rules: {
      total: 4,
      byConfidence: { confirmed: 2, derived: 2, assumed: 0, disputed: 0 },
      byFile: {},
      byOrigin: { house: 4, speaker: 0, overrides: 0, locked: 0 }
    },
    evidence: { total: 4, byType: {}, conflicts: 0, drafts: 0 },
    drift: {
      thresholdPct: 25,
      byLocale: {
        en: {
          baseline: '2026-03-02T00:00:00.000Z',
          metrics: [{ key: 'meanSentenceLength', label: 'mean sentence', from: 10, to: 11, deltaPct: 10, flagged: false }]
        }
      }
    },
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
  const gaps = detectGaps(healthyState({
    integrity: { errors: 3, warnings: 0, byCode: { E_DUPLICATE_ID: 3 }, findings: [] }
  }))
  assert.ok(gaps.some((g) => g.id === 'G02' && g.severity === 'blocker'))
})

test('G03 fires once per locale that has no baseline, naming the locale', () => {
  const gaps = detectGaps(healthyState({
    drift: {
      thresholdPct: 25,
      byLocale: { en: { baseline: '2026-03-02', metrics: [] }, cs: { baseline: null, metrics: [] } }
    }
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
  const allAssumed = detectGaps(healthyState({
    rules: { total: 3, byConfidence: { confirmed: 0, derived: 0, assumed: 3, disputed: 0 }, byFile: {} }
  }))
  assert.ok(allAssumed.some((g) => g.id === 'G05'))

  const mixed = detectGaps(healthyState({
    rules: { total: 3, byConfidence: { confirmed: 1, derived: 0, assumed: 2, disputed: 0 }, byFile: {} }
  }))
  assert.ok(!mixed.some((g) => g.id === 'G05'))
})

test('G05 does not fire when there are no rules at all', () => {
  // "Every rule is assumed" over zero rules is vacuously true and would fire
  // on a bare knowledge base, where G01 or the draft stage is the real story.
  const none = detectGaps(healthyState({
    rules: { total: 0, byConfidence: { confirmed: 0, derived: 0, assumed: 0, disputed: 0 }, byFile: {} }
  }))
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
  const quietGaps = detectGaps(healthyState({ coverage: { ...base.coverage, authored: 72, byContext: quiet } }))
  assert.ok(!quietGaps.some((g) => g.id === 'G06'))
})

test('G07 fires when the card is behind a file it compiles from, naming that file', () => {
  const gaps = detectGaps(healthyState({
    freshness: {
      ...healthyState().freshness,
      card: { generated: '2026-08-01T00:00:00.000Z', staleAgainst: ['tone.md'], ageDays: 27 }
    }
  }))
  const gap = gaps.find((g) => g.id === 'G07')
  assert.ok(gap)
  assert.match(gap.what, /tone\.md/)
  assert.match(gap.fix, /voice-and-tone:sync/)
})

test('G09 fires when a drift metric exceeds the threshold', () => {
  const gaps = detectGaps(healthyState({
    drift: {
      thresholdPct: 25,
      byLocale: {
        en: {
          baseline: '2026-03-02',
          metrics: [{ key: 'meanSentenceLength', label: 'mean sentence', from: 10, to: 20, deltaPct: 100, flagged: true }]
        }
      }
    }
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

test('gaps are ranked by leverage, then by severity', () => {
  const gaps = detectGaps(healthyState({
    integrity: { errors: 1, warnings: 0, byCode: {}, findings: [] },
    evidence: { total: 4, byType: {}, conflicts: 0, drafts: 3 }
  }))
  assert.ok(gaps.length >= 2, 'this fixture must produce enough gaps to have an order')
  const rank = { blocker: 0, warning: 1, nit: 2 }
  for (let i = 1; i < gaps.length; i++) {
    const prev = gaps[i - 1]
    const cur = gaps[i]
    assert.ok(prev.leverage >= cur.leverage, `${prev.id} (lev ${prev.leverage}) must not rank above ${cur.id} (lev ${cur.leverage})`)
    if (prev.leverage === cur.leverage) {
      assert.ok(rank[prev.severity] <= rank[cur.severity], `within a leverage tier ${prev.id} must not outrank ${cur.id}`)
    }
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
  const halfComputed = base.coverage.byContext.map((c) => ({
    ...c, authored: 4, cells: STATES.map((_state, i) => (i < 4 ? 'authored' : 'computed'))
  }))
  assert.deepEqual(detectGaps(healthyState({ coverage: { ...base.coverage, authored: 40, byContext: halfComputed } })), [])
})

test('files skipped for having no extractor are never a gap', () => {
  assert.deepEqual(detectGaps(healthyState({ corpus: { ...healthyState().corpus, skipped: 40 } })), [])
})

test('a disputed rule is a gap only because it is unresolved, never because conflict is a fault', () => {
  const gaps = detectGaps(healthyState({
    rules: { total: 4, byConfidence: { confirmed: 2, derived: 1, assumed: 0, disputed: 1 }, byFile: {} }
  }))
  const gap = gaps.find((g) => g.id === 'G10')
  assert.ok(gap)
  assert.match(gap.why, /unresolved|never enforced|not enforced/i)
  assert.ok(!/error|invalid|wrong/i.test(gap.why), 'a conflict is information, not a fault')
})

// --- speakers (spec 2026-09-10 §9.3) ---------------------------------------

function speaker (overrides = {}) {
  return {
    slug: 'maya', name: 'Maya Lind', voiceRules: 3, hasDefaultDials: true, authoredCells: 2, overrides: 0,
    lockViolations: 0, corpusWords: 900, fingerprintAgeDays: 1, driftBaseline: true, driftFlagged: false,
    draftsPending: 0, sourcesNeverIngested: 0, cardStale: [],
    ...overrides
  }
}

const LOCKED = { declared: ['V2'], violated: [] }

test('a healthy house with one healthy speaker and a lock reports nothing', () => {
  assert.deepEqual(detectGaps(healthyState({ speakers: [speaker()], locks: LOCKED })), [])
})

test('G17 fires when a speaker has no voice rule or no dials line, prefixed with the slug in the house view', () => {
  const state = healthyState({ speakers: [speaker({ voiceRules: 0 })], locks: LOCKED })
  const gap = detectGaps(state).find((g) => g.id === 'G17')
  assert.ok(gap)
  assert.equal(gap.severity, 'blocker')
  assert.match(gap.what, /^\[maya\] /)
  assert.match(gap.fix, /speaker add maya/)
  const dials = healthyState({ speakers: [speaker({ hasDefaultDials: false })], locks: LOCKED })
  assert.ok(detectGaps(dials).some((g) => g.id === 'G17'))
})

test('G17 carries no prefix in a speaker view', () => {
  const state = healthyState({
    kb: { ...healthyState().kb, role: 'speaker', speaker: { slug: 'maya', name: 'Maya Lind' } },
    speakers: [speaker({ voiceRules: 0 })],
    locks: LOCKED
  })
  const gap = detectGaps(state).find((g) => g.id === 'G17')
  assert.ok(!gap.what.startsWith('['))
})

test('G18, G19, G20 fire on a speaker without a baseline, with never-ingested sources, with a stale card', () => {
  const state = healthyState({
    speakers: [speaker({ driftBaseline: false, sourcesNeverIngested: 2, cardStale: ['voice.md'] })],
    locks: LOCKED
  })
  const gaps = detectGaps(state)
  const ids = gaps.map((g) => g.id)
  for (const id of ['G18', 'G19', 'G20']) assert.ok(ids.includes(id), id)
  assert.match(gaps.find((g) => g.id === 'G18').fix, /--set-baseline --profile maya/)
  assert.match(gaps.find((g) => g.id === 'G19').fix, /connect --ingest --profile maya/)
  assert.match(gaps.find((g) => g.id === 'G20').fix, /sync --profile maya/)
})

test('a detector that hits several speakers yields one gap per speaker', () => {
  const state = healthyState({
    speakers: [speaker({ driftBaseline: false }), speaker({ slug: 'jonas', name: 'Jonas Berg', driftBaseline: false })],
    locks: LOCKED
  })
  const g18 = detectGaps(state).filter((g) => g.id === 'G18')
  assert.equal(g18.length, 2)
  assert.deepEqual(g18.map((g) => g.what.slice(0, 7)).sort(), ['[jonas]', '[maya] '])
})

test('G21 fires once, at house level, when speakers exist and no lock is declared', () => {
  const state = healthyState({ speakers: [speaker(), speaker({ slug: 'jonas', name: 'Jonas Berg' })] })
  const gaps = detectGaps(state).filter((g) => g.id === 'G21')
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].severity, 'warning')
  assert.ok(!detectGaps(healthyState()).some((g) => g.id === 'G21'), 'no speakers, no G21')
  const speakerView = healthyState({
    kb: { ...healthyState().kb, role: 'speaker', speaker: { slug: 'maya', name: 'Maya Lind' } },
    speakers: [speaker()]
  })
  assert.ok(!detectGaps(speakerView).some((g) => g.id === 'G21'), 'G21 is a house-level judgement')
})

test('deliberately not a gap: a speaker with every cell computed, with zero overrides, with a card never compiled', () => {
  const state = healthyState({ speakers: [speaker({ authoredCells: 0, overrides: 0, cardStale: null })], locks: LOCKED })
  assert.deepEqual(detectGaps(state).map((g) => g.id), [])
})
