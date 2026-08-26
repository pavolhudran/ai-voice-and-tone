import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { loadKb, STATES, CONTEXTS } from '../scripts/lib/kb.mjs'
import { validateKb } from '../scripts/validate.mjs'

const codesOf = (report) => report.findings.map((f) => f.code)

function kbFrom (files) {
  const dir = makeTmpProject(files)
  return { dir, kb: loadKb(path.join(dir, 'kb')) }
}

test('a clean knowledge base reports nothing', () => {
  const { dir, kb } = kbFrom({
    'kb/voice.md': '### V1 · Plainspoken `confirmed` ev: e1\n\n**Means:** Clear.\n',
    'kb/tone.md': [
      '### T-system-error/frustrated `confirmed` ev: e1',
      '',
      '**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2',
      '',
      '## State vectors',
      '',
      '| State | warmth | humor | directness | detail | urgency | formality |',
      '|---|---|---|---|---|---|---|',
      '| frustrated | 2 | 0 | 4 | 3 | 1 | 2 |',
      '',
      '## Context offsets',
      '',
      '| Context | warmth | humor | directness | detail | urgency | formality |',
      '|---|---|---|---|---|---|---|',
      '| system-error | -1 | -2 | 1 | 0 | 0 | 0 |'
    ].join('\n'),
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V1, T-system-error/frustrated\n'
  })
  try {
    const report = validateKb(kb)
    assert.equal(report.errors, 0, JSON.stringify(report.findings))
    assert.ok(!codesOf(report).includes('W_ONE_WAY_EVIDENCE'))

    // The fixture authors exactly one state vector (frustrated) and one
    // context offset (system-error). Every other state and context has no
    // vector, and W_MISSING_VECTOR is the only code a KB this clean can
    // still produce. Pin the code set (not just "no errors") and derive the
    // expected count from the vocab sizes so a regression that silences
    // W_MISSING_VECTOR, or fires it for slots that do have a vector, fails
    // loudly instead of slipping through report.errors alone.
    const missingStates = STATES.length - 1 // all but 'frustrated'
    const missingContexts = CONTEXTS.length - 1 // all but 'system-error'
    const expectedWarnings = missingStates + missingContexts
    assert.deepEqual(new Set(codesOf(report)), new Set(['W_MISSING_VECTOR']))
    assert.equal(
      report.warnings,
      expectedWarnings,
      `expected ${missingStates} missing-state + ${missingContexts} missing-context ` +
      `W_MISSING_VECTOR warnings (${STATES.length} states - 1 declared, ` +
      `${CONTEXTS.length} contexts - 1 declared) = ${expectedWarnings}, got ${report.warnings}`
    )
  } finally {
    cleanup(dir)
  }
})

test('duplicate ids, bad confidence, and broken refs are errors', () => {
  const { dir, kb } = kbFrom({
    'kb/voice.md': [
      '### V1 · Plainspoken `confirmed` ev: e1',
      '',
      '**Means:** Clear.',
      '',
      '### V1 · Repeated `confirmed` ev: e1',
      '',
      '**Means:** Duplicate id.',
      '',
      '### V2 · Odd `probably` ev: e99',
      '',
      '**Means:** Bad confidence and a missing evidence id.',
      '',
      '### Q1 · Wrong prefix `assumed`',
      '',
      '**Means:** No such prefix.'
    ].join('\n'),
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V1\n'
  })
  try {
    const codes = codesOf(validateKb(kb))
    assert.ok(codes.includes('E_DUPLICATE_ID'))
    assert.ok(codes.includes('E_UNKNOWN_CONFIDENCE'))
    assert.ok(codes.includes('E_BROKEN_EVIDENCE_REF'))
    assert.ok(codes.includes('E_UNKNOWN_PREFIX'))
  } finally {
    cleanup(dir)
  }
})

test('tone cells are checked against the fixed vocabularies and dial range', () => {
  const { dir, kb } = kbFrom({
    'kb/tone.md': [
      '### T-carrier-pigeon/confused `confirmed` ev: e1',
      '',
      '**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2',
      '',
      '### T-email/hangry `confirmed` ev: e1',
      '',
      '**Dials:** warmth 9 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2'
    ].join('\n'),
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — decision\n\n**Produced:** T-carrier-pigeon/confused, T-email/hangry\n'
  })
  try {
    const codes = codesOf(validateKb(kb))
    assert.ok(codes.includes('E_UNKNOWN_CONTEXT'))
    assert.ok(codes.includes('E_UNKNOWN_STATE'))
    assert.ok(codes.includes('E_DIAL_RANGE'))
  } finally {
    cleanup(dir)
  }
})

test('an authored cell cannot smuggle humor past gate 2', () => {
  const { dir, kb } = kbFrom({
    'kb/tone.md': [
      '### T-system-error/frustrated `confirmed` ev: e1',
      '',
      '**Dials:** warmth 2 · humor 3 · directness 4 · detail 3 · urgency 1 · formality 2'
    ].join('\n'),
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — decision\n\n**Produced:** T-system-error/frustrated\n'
  })
  try {
    const finding = validateKb(kb).findings.find((f) => f.code === 'E_HUMOR_GATE')
    assert.ok(finding, 'humor on a frustrated cell must be an error')
    assert.match(finding.message, /frustrated/)
  } finally {
    cleanup(dir)
  }
})

test('one-way evidence and orphaned evidence are warnings, not errors', () => {
  const { dir, kb } = kbFrom({
    'kb/voice.md': '### V1 · Plainspoken `confirmed` ev: e1\n\n**Means:** Clear.\n\n### V2 · Genuine `derived`\n\n**Means:** No evidence at all.\n',
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V7\n'
  })
  try {
    const report = validateKb(kb)
    const codes = codesOf(report)
    assert.ok(codes.includes('W_ONE_WAY_EVIDENCE'), 'V1 cites e1 but e1 does not list V1')
    assert.ok(codes.includes('W_ORPHAN_EVIDENCE'), 'e1 claims V7, which does not exist')
    assert.ok(codes.includes('W_NO_EVIDENCE'), 'a derived rule with no evidence')
    assert.equal(report.errors, 0)
    assert.ok(report.warnings >= 3)
  } finally {
    cleanup(dir)
  }
})

test('findings carry a file and a line so they can be jumped to', () => {
  const { dir, kb } = kbFrom({
    'kb/voice.md': '# Voice\n\n### V1 · Odd `probably`\n\n**Means:** Bad.\n',
    'kb/evidence/ledger.md': ''
  })
  try {
    const finding = validateKb(kb).findings.find((f) => f.code === 'E_UNKNOWN_CONFIDENCE')
    assert.equal(finding.file, 'voice.md')
    assert.equal(finding.line, 3)
  } finally {
    cleanup(dir)
  }
})

test('an authored cell that omits a dial is an error, not a silent undefined', () => {
  const { dir, kb } = kbFrom({
    'kb/tone.md': [
      '### T-product-ui/curious `confirmed` ev: e1',
      '',
      '**Dials:** warmth 2 · humor 1 · directness 3 · detail 2 · urgency 1',
      ''
    ].join('\n'),
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — decision\n\n**Produced:** T-product-ui/curious\n'
  })
  try {
    const report = validateKb(kb)
    const finding = report.findings.find((f) => f.code === 'E_DIAL_MISSING')
    assert.ok(finding, 'a cell missing a dial must be flagged, not silently rendered as undefined')
    assert.match(finding.message, /formality/)
    assert.equal(finding.severity, 'error')
    assert.ok(report.errors > 0)
  } finally {
    cleanup(dir)
  }
})

test('an evidence entry with an out-of-vocabulary type is an error', () => {
  const { dir, kb } = kbFrom({
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — survey\n\n**Produced:**\n'
  })
  try {
    const report = validateKb(kb)
    const finding = report.findings.find((f) => f.code === 'E_UNKNOWN_EVIDENCE_TYPE')
    assert.ok(finding, 'ledger type "survey" is not one of the five known evidence types')
    assert.equal(finding.severity, 'error')
    assert.match(finding.message, /survey/)
    assert.equal(finding.file, 'evidence/ledger.md')
  } finally {
    cleanup(dir)
  }
})

test('a state vector or context offset outside its allowed range is an error', () => {
  const { dir, kb } = kbFrom({
    'kb/tone.md': [
      '## State vectors',
      '',
      '| State | warmth | humor | directness | detail | urgency | formality |',
      '|---|---|---|---|---|---|---|',
      '| frustrated | 9 | 0 | 4 | 3 | 1 | 2 |',
      '',
      '## Context offsets',
      '',
      '| Context | warmth | humor | directness | detail | urgency | formality |',
      '|---|---|---|---|---|---|---|',
      '| system-error | -9 | -2 | 1 | 0 | 0 | 0 |'
    ].join('\n'),
    'kb/evidence/ledger.md': ''
  })
  try {
    const report = validateKb(kb)
    const rangeFindings = report.findings.filter((f) => f.code === 'E_VECTOR_RANGE')
    assert.equal(rangeFindings.length, 2, 'expected one out-of-range state dial and one out-of-range context dial')
    assert.ok(rangeFindings.every((f) => f.severity === 'error'))
    assert.ok(rangeFindings.some((f) => /frustrated\.warmth/.test(f.message)))
    assert.ok(rangeFindings.some((f) => /system-error\.warmth/.test(f.message)))
  } finally {
    cleanup(dir)
  }
})

test('a state or context with no vector produces W_MISSING_VECTOR, and only that code', () => {
  const { dir, kb } = kbFrom({
    'kb/tone.md': [
      '## State vectors',
      '',
      '| State | warmth | humor | directness | detail | urgency | formality |',
      '|---|---|---|---|---|---|---|',
      '| curious | 3 | 2 | 2 | 2 | 1 | 1 |'
    ].join('\n')
  })
  try {
    const report = validateKb(kb)
    // One state declared (curious): every other state is missing one.
    // No context table at all: every context is missing one.
    const expected = (STATES.length - 1) + CONTEXTS.length
    assert.equal(report.errors, 0)
    assert.deepEqual(new Set(codesOf(report)), new Set(['W_MISSING_VECTOR']))
    assert.equal(
      report.warnings,
      expected,
      `expected ${STATES.length - 1} missing-state + ${CONTEXTS.length} missing-context ` +
      `warnings (1 state declared, 0 contexts declared) = ${expected}, got ${report.warnings}`
    )
  } finally {
    cleanup(dir)
  }
})
