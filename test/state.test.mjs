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
