import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { utimesSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { CONTEXTS, STATES } from '../scripts/lib/kb.mjs'
import {
  STAGES, inferStages, collect, CARD_SOURCES, cardFreshness, manifestFreshness, coverageOf,
  DRIFT_METRICS, deltaPct, driftOf
} from '../scripts/lib/state.mjs'

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
    manifest: { totals: { files: 3 } },
    index: { sources: [] },
    register: [{ id: 's01', kind: 'project' }],
    fingerprint: null,
    kb: { rules: [], evidence: [] },
    validation: { errors: 0 },
    cardExists: false
  })
  assert.equal(reached.reached.scan, true)
  assert.equal(reached.reached.measure, false)
})

test('an empty manifest does not reach scan', () => {
  const { reached } = inferStages({
    manifest: { totals: { files: 0 } },
    index: { sources: [] },
    register: [{ id: 's01', kind: 'project' }],
    fingerprint: null,
    kb: { rules: [], evidence: [] },
    validation: { errors: 0 },
    cardExists: false
  })
  assert.equal(reached.scan, false)
})

test('ingest counts as reached when there is a corpus and nothing registered to ingest', () => {
  // A project-only knowledge base has nothing to ingest, so ingest is not a
  // pending step. But that only holds once a corpus exists - otherwise a bare
  // directory would report "ingest reached", which is nonsense.
  const withCorpus = inferStages({
    manifest: { totals: { files: 3 } },
    index: { sources: [] },
    register: [{ id: 's01', kind: 'project' }],
    fingerprint: null,
    kb: { rules: [], evidence: [] },
    validation: { errors: 0 },
    cardExists: false
  })
  assert.equal(withCorpus.reached.ingest, true)

  const withoutCorpus = inferStages({
    manifest: { totals: { files: 0 } },
    index: { sources: [] },
    register: [{ id: 's01', kind: 'project' }],
    fingerprint: null,
    kb: { rules: [], evidence: [] },
    validation: { errors: 0 },
    cardExists: false
  })
  assert.equal(withoutCorpus.reached.ingest, false)
})

test('a registered non-project source with no index entry leaves ingest unreached', () => {
  const { reached } = inferStages({
    manifest: { totals: { files: 3 } },
    index: { sources: [] },
    register: [{ id: 's01', kind: 'project' }, { id: 's02', kind: 'inbox' }],
    fingerprint: null,
    kb: { rules: [], evidence: [] },
    validation: { errors: 0 },
    cardExists: false
  })
  assert.equal(reached.ingest, false)
})

test('interview is reached by a non-assumed rule or by interview evidence, and by nothing else', () => {
  const base = {
    manifest: { totals: { files: 1 } },
    index: { sources: [] },
    register: [{ id: 's01', kind: 'project' }],
    fingerprint: null,
    validation: { errors: 0 },
    cardExists: false
  }
  const allAssumed = inferStages({ ...base, kb: { rules: [{ confidence: 'assumed' }], evidence: [] } })
  assert.equal(allAssumed.reached.draft, true)
  assert.equal(allAssumed.reached.interview, false)

  const confirmed = inferStages({ ...base, kb: { rules: [{ confidence: 'confirmed' }], evidence: [] } })
  assert.equal(confirmed.reached.interview, true)

  const byEvidence = inferStages({
    ...base,
    kb: { rules: [{ confidence: 'assumed' }], evidence: [{ type: 'interview' }] }
  })
  assert.equal(byEvidence.reached.interview, true)
})

test('canonize needs the card, zero validation errors, and a baseline together', () => {
  const base = {
    manifest: { totals: { files: 1 } },
    index: { sources: [] },
    register: [{ id: 's01', kind: 'project' }],
    kb: { rules: [{ confidence: 'confirmed' }], evidence: [] }
  }
  const complete = inferStages({
    ...base,
    fingerprint: { byLocale: { en: {} }, baseline: { generated: NOW } },
    validation: { errors: 0 },
    cardExists: true
  })
  assert.equal(complete.reached.canonize, true)
  assert.equal(complete.at, 'canonize')

  const noBaseline = inferStages({
    ...base,
    fingerprint: { byLocale: { en: {} }, baseline: null },
    validation: { errors: 0 },
    cardExists: true
  })
  assert.equal(noBaseline.reached.canonize, false)

  const withErrors = inferStages({
    ...base,
    fingerprint: { byLocale: { en: {} }, baseline: { generated: NOW } },
    validation: { errors: 2 },
    cardExists: true
  })
  assert.equal(withErrors.reached.canonize, false)
})

test('stage.at is the furthest stage reached, not a count of reached stages', () => {
  const { at } = inferStages({
    manifest: { totals: { files: 1 } },
    index: { sources: [] },
    register: [{ id: 's01', kind: 'project' }],
    fingerprint: { byLocale: { en: {} }, baseline: null },
    kb: { rules: [{ confidence: 'assumed' }], evidence: [] },
    validation: { errors: 0 },
    cardExists: false
  })
  assert.equal(at, 'draft')
})

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
    for (const name of ['CONTEXT.md', 'config.yml', 'voice.md']) utimesSync(path.join(kb, name), old, old)
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
    '.voice-and-tone/voice.md': '# Voice\n\n## V01 · plain   `confirmed`\n\n**Means:** short words\n',
    '.voice-and-tone/tone.md': '# Tone\n'
  })
  assert.equal(typeof state.integrity.errors, 'number')
  assert.equal(typeof state.integrity.warnings, 'number')
  assert.ok(Array.isArray(state.integrity.findings))
  assert.equal(typeof state.integrity.byCode, 'object')
  // V01 is confirmed and cites no evidence, so validate emits W_NO_EVIDENCE -
  // proof the findings really come from validateKb and are not fabricated here.
  assert.equal(state.integrity.byCode.W_NO_EVIDENCE, 1)
})

const TONE_WITH_TWO_CELLS = [
  '# Tone',
  '',
  '## T-system-error/frustrated   `confirmed`',
  '',
  '**Dials:** warmth 3 - humor 0 - directness 4 - detail 2 - urgency 3 - formality 2',
  '',
  '## T-product-ui/delighted   `assumed`',
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
    '.voice-and-tone/tone.md': '# Tone\n',
    '.voice-and-tone/voice.md': [
      '# Voice',
      '',
      '## V01 · plain   `confirmed`',
      '',
      '**Means:** short words',
      '',
      '## V02 · warm   `assumed`',
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
    baseline: {
      generated: '2026-03-02T00:00:00.000Z',
      byLocale: { en: { universal: { meanSentenceLength: 10 }, english: null } }
    }
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
    baseline: {
      generated: '2026-03-02T00:00:00.000Z',
      byLocale: { en: { universal: { meanSentenceLength: 10 } } }
    }
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
      sources: [{
        id: 'e01',
        kind: 'inbox',
        origin: 'sources/guide.md',
        status: 'used',
        sha256: 'a'.repeat(64),
        produced: ['L01']
      }]
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

test('vendor pins are read from the shipped manifest, not from the project', () => {
  // Resolved relative to this module's own location, the same way office.mjs
  // and pdf.mjs resolve the bundles themselves - never from --root/--kb.
  const state = stateOf({ '.voice-and-tone/config.yml': MINIMAL_CONFIG, '.voice-and-tone/voice.md': '# V\n' })
  assert.ok(Array.isArray(state.settings.vendor))
  assert.ok(state.settings.vendor.length > 0, 'the plugin ships vendored extractors')
  for (const pin of state.settings.vendor) assert.equal(typeof pin.name, 'string')
})

test('the whole state object survives a JSON round trip', () => {
  // --json prints this object verbatim. An undefined, a Map, or a circular
  // reference anywhere in it would silently vanish or throw at print time.
  const state = stateOf({ '.voice-and-tone/config.yml': CONFIG_WITH_INBOX, '.voice-and-tone/voice.md': '# V\n' })
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state)
})
