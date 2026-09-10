import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { loadKb, resolveKb, STATES, CONTEXTS } from '../scripts/lib/kb.mjs'
import { statsFor } from '../scripts/lib/metrics.mjs'
import { readTextFile } from '../scripts/lib/fsx.mjs'
import { validateKb, validateAll } from '../scripts/validate.mjs'
import { cpSync, writeFileSync } from 'node:fs'

const codesOf = (report) => report.findings.map((f) => f.code)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function kbFrom (files) {
  const dir = makeTmpProject(files)
  return { dir, kb: loadKb(path.join(dir, 'kb')) }
}

// --- fixtures for the source-index checks (Task 14) -----------------------
//
// Mirrors the `entry()` helper test/sourceindex.test.mjs already uses to
// build sources.json entries, adapted to write through kbFrom's plain-text
// files map rather than through saveIndex - these tests exercise validateKb
// reading evidence/sources.json off disk, not the writer.
const sourceEntry = (over = {}) => ({
  id: 'f001',
  sha256: 'a'.repeat(64),
  kind: 'file',
  from: 's01',
  origin: 'sources/a.txt',
  label: 'A',
  format: 'text',
  bytes: 10,
  locale: 'en',
  tier: 'script',
  extractor: null,
  fidelity: 'measured',
  quality: { passed: true },
  stats: statsFor({ strings: ['We write plainly.'], headings: [], locale: 'en' }),
  added: '2026-08-27',
  analysed: '2026-08-27',
  status: 'used',
  produced: [],
  ...over
})

function sourcesJson (entries) {
  return `${JSON.stringify({ generated: '2026-08-27T00:00:00.000Z', sources: entries }, null, 2)}\n`
}

// The real, pinned version of a real vendored library - read once so the
// "matches" and "is stale" fixtures below stay true regardless of which
// library vendor.mjs happens to pin, or at what version.
const REAL_MANIFEST = JSON.parse(readTextFile(path.join(ROOT, 'vendor', 'manifest.json')))
const [REAL_LIBRARY, REAL_LIBRARY_INFO] = Object.entries(REAL_MANIFEST.libraries)[0]

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

test('a directory that is not a knowledge base is an error, not a clean bill of health', () => {
  // loadKb reads every absent file as '', so before E_NO_KB a typo'd --kb
  // printed "0 rules, 0 errors, 0 warnings" and exited 0, and :sync went on to
  // compile a card from nothing.
  const dir = makeTmpProject({ 'unrelated.txt': 'not a knowledge base\n' })
  try {
    const report = validateKb(loadKb(path.join(dir, 'nowhere')))
    assert.ok(codesOf(report).includes('E_NO_KB'), JSON.stringify(report.findings))
    assert.ok(report.errors > 0, 'E_NO_KB must be an error so the CLI exits 2')
    const finding = report.findings.find((f) => f.code === 'E_NO_KB')
    assert.equal(finding.severity, 'error')
    assert.equal(finding.file, 'config.yml', 'the finding anchors to a real filename, not config.yml.md')
  } finally {
    cleanup(dir)
  }
})

test('a knowledge base holding only one of the three core files is not E_NO_KB', () => {
  // The gate is "all three absent". A KB mid-init, with config.yml written and
  // nothing else yet, is empty but real - reporting E_NO_KB there would be the
  // mirror of the bug.
  for (const file of ['config.yml', 'voice.md', 'tone.md']) {
    const dir = makeTmpProject({ [path.posix.join('kb', file)]: '\n' })
    try {
      const report = validateKb(loadKb(path.join(dir, 'kb')))
      assert.ok(!codesOf(report).includes('E_NO_KB'), `${file} alone still makes a knowledge base`)
    } finally {
      cleanup(dir)
    }
  }
})

test('a table rule with an empty Conf column is an error, not silence', () => {
  const { dir, kb } = kbFrom({
    'kb/lexicon.md': [
      '| ID | Avoid | Prefer | Why | Conf | Ev |',
      '|---|---|---|---|---|---|',
      '| L1 | utilize | use | plain | | |',
      '| L2 | leverage | use | plain | confirmed | |'
    ].join('\n')
  })
  try {
    const report = validateKb(kb)
    const codes = codesOf(report)
    assert.ok(codes.includes('E_NO_CONFIDENCE'), JSON.stringify(report.findings))

    // The row with no confidence used to produce zero findings while the row
    // that declared one produced two. Pin that L1 is now reported at all, and
    // that it is reported once - E_NO_CONFIDENCE replaces E_UNKNOWN_CONFIDENCE
    // rather than stacking with it.
    const forL1 = report.findings.filter((f) => /\bL1\b/.test(f.message))
    assert.deepEqual(forL1.map((f) => f.code), ['E_NO_CONFIDENCE'])
    assert.equal(forL1[0].severity, 'error')
    assert.equal(forL1[0].file, 'lexicon.md')
    assert.equal(forL1[0].line, 3)
  } finally {
    cleanup(dir)
  }
})

test('a rule-shaped heading with no confidence is warned about instead of vanishing', () => {
  const { dir, kb } = kbFrom({
    'kb/voice.md': [
      '## Characteristics',
      '',
      '### V1 · Plainspoken',
      '',
      '**Means:** Clarity above all.',
      '',
      '### V2 · Genuine `confirmed`',
      '',
      '**Means:** We sound like a person.'
    ].join('\n'),
    'kb/lexicon.md': '### Q1 · Unknown prefix and no confidence\n\n**Means:** Doubly invisible.\n',
    'kb/tone.md': [
      '### T-system-error/frustrated',
      '',
      '**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2'
    ].join('\n')
  })
  try {
    const report = validateKb(kb)
    const unparsed = report.findings.filter((f) => f.code === 'W_UNPARSED_RULE_HEADING')

    // Exactly the three headings HEADING could not parse, and neither of the
    // ordinary section headings ("## Characteristics") nor the one that parsed.
    // Q1 is there because an unknown prefix that also omits the confidence is
    // caught by neither E_UNKNOWN_PREFIX (no rule is parsed) nor anything else.
    assert.deepEqual(
      unparsed.map((f) => `${f.file}:${f.line}`).sort(),
      ['lexicon.md:1', 'tone.md:1', 'voice.md:3']
    )
    assert.equal(unparsed[0].severity, 'warning')
    assert.ok(unparsed.every((f) => !/V2/.test(f.message)), 'a heading that parsed is not warned about')
    assert.equal(kb.rules.filter((r) => r.id === 'V1').length, 0,
      'the premise: V1 really is invisible to the parser')
  } finally {
    cleanup(dir)
  }
})

test('ordinary section headings never trip the unparsed-rule warning', () => {
  // The check is keyed on the rule-ID shape, not on "a capitalized word", so
  // that the shipped templates - "## Humor gates", "## State vectors",
  // "## Never say", "## Avoid" - stay warning-free.
  const { dir, kb } = kbFrom({
    'kb/voice.md': [
      '# Voice - constant', '', '## Characteristics', '', '## Voice - constant', '',
      '## We Are / We Are Not', '', '## Tone', '', '## Avoid', '', '## Never say', ''
    ].join('\n')
  })
  try {
    assert.deepEqual(codesOf(validateKb(kb)).filter((c) => c === 'W_UNPARSED_RULE_HEADING'), [])
  } finally {
    cleanup(dir)
  }
})

test('a recorded conflict never trips the unparsed-rule warning', () => {
  // F63: conflicts.md's spec'd entry heading is `### D1 - <date>`, which matches
  // the rule-ID shape but is a conflict record, not a rule. The shipped template
  // keeps its example inside an HTML comment, so only a KB with a REAL conflict
  // exposed this - which is exactly the user who least deserves a bogus warning.
  const { dir, kb } = kbFrom({
    'kb/evidence/conflicts.md': [
      '# Unresolved conflicts', '',
      '### D1 - 2026-08-26', '',
      '**About:** contraction use',
      '**Side A:** marketing site, 0 contractions in 240 sentences (`source`, e04)',
      '**Side B:** app UI strings, 61% contraction rate (`corpus`, e05)',
      '**Asked?** not yet', ''
    ].join('\n')
  })
  try {
    assert.deepEqual(codesOf(validateKb(kb)).filter((c) => c === 'W_UNPARSED_RULE_HEADING'), [])
    // The premise: D1 is genuinely heading-shaped, so this passes because
    // conflicts.md is excluded - not because the heading failed to match.
    assert.match(kb.conflicts || '', /### D1 - 2026-08-26/)
    // And the exclusion is scoped: a real unparsable rule elsewhere still warns.
    const { dir: dir2, kb: kb2 } = kbFrom({ 'kb/voice.md': '### V1 - Plainspoken\n' })
    try {
      assert.deepEqual(codesOf(validateKb(kb2)).filter((c) => c === 'W_UNPARSED_RULE_HEADING'),
        ['W_UNPARSED_RULE_HEADING'])
    } finally {
      cleanup(dir2)
    }
  } finally {
    cleanup(dir)
  }
})

test('validateKb returns a report rather than throwing on a half-built vectors object', () => {
  // D3: reading vectors.contexts off {states:{}} used to throw a TypeError,
  // turning a validation call into an unexpected-error exit 1.
  assert.equal(validateKb({ vectors: { states: {} } }).errors, 0)
  assert.equal(validateKb({ vectors: { contexts: {} } }).errors, 0)
  assert.equal(validateKb({ vectors: {} }).errors, 0)

  const statesOnly = validateKb({
    vectors: { states: { frustrated: { warmth: 9 } } }
  })
  assert.ok(codesOf(statesOnly).includes('E_VECTOR_RANGE'), 'the surviving half is still checked')
  assert.ok(codesOf(statesOnly).includes('W_MISSING_VECTOR'), 'every context still reports as missing')
})

test('validateKb never throws, even on a hand-built kb missing every top-level field', () => {
  const report = validateKb({})
  assert.deepEqual(report, {
    findings: [],
    errors: 0,
    warnings: 0,
    counts: {
      rules: 0,
      cells: 0,
      evidence: 0,
      authoredCells: 0,
      possibleCells: CONTEXTS.length * STATES.length
    }
  })
})

test('validateKb tolerates a completely empty argument', () => {
  const report = validateKb()
  assert.deepEqual(report.findings, [])
  assert.equal(report.errors, 0)
  assert.equal(report.warnings, 0)
  assert.deepEqual(report.counts, {
    rules: 0,
    cells: 0,
    evidence: 0,
    authoredCells: 0,
    possibleCells: CONTEXTS.length * STATES.length
  })
})

test('validateKb tolerates a partial kb object with only some top-level fields present', () => {
  // Shaped the way a hand-built probe or a future caller is most likely to
  // construct one: just the field under test, everything else absent.
  const report = validateKb({
    rules: [{ id: 'V1', file: 'voice', line: 1, confidence: 'confirmed', evidence: [] }]
  })
  assert.equal(report.errors, 0)
  assert.equal(report.counts.rules, 1)
  assert.equal(report.counts.cells, 0)
  assert.equal(report.counts.evidence, 0)

  const evidenceOnly = validateKb({
    evidence: [{ id: 'e1', type: 'interview', produced: [], line: 1 }]
  })
  assert.equal(evidenceOnly.errors, 0)
  assert.equal(evidenceOnly.counts.evidence, 1)

  const cellsOnly = validateKb({
    cells: [{
      id: 'T-email/curious',
      context: 'email',
      state: 'curious',
      dials: { warmth: 2, humor: 1, directness: 2, detail: 2, urgency: 1, formality: 2 },
      line: 1
    }]
  })
  assert.equal(cellsOnly.errors, 0)
  assert.equal(cellsOnly.counts.cells, 1)
})

// --- Task 14: evidence/sources.json integrity ------------------------------
//
// These checks read straight off disk (loadIndex, the vendor manifest, the
// extract cache), so - unlike every check above - they only run when kb
// carries a real kbRoot. Every fixture below goes through kbFrom, exactly
// like the rest of this file, so kb.kbRoot is always the tmp project's `kb`
// directory.

test('a produced rule id that does not exist in the knowledge base is reported', () => {
  const { dir, kb } = kbFrom({
    'kb/voice.md': '### V1 · Plainspoken `confirmed` ev: e1\n\n**Means:** Clear.\n',
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V1\n',
    'kb/evidence/sources.json': sourcesJson([sourceEntry({ produced: ['V1', 'V9'] })])
  })
  try {
    const report = validateKb(kb)
    const finding = report.findings.find((f) => f.code === 'E_DANGLING_PRODUCED_ID')
    assert.ok(finding, JSON.stringify(report.findings))
    assert.equal(finding.severity, 'error')
    assert.match(finding.message, /V9/)
    assert.equal(finding.file, 'evidence/sources.json')
    assert.ok(report.errors > 0, 'a dangling produced id must fail the build')
  } finally {
    cleanup(dir)
  }
})

test('a rule citing source-type evidence with nothing in the index behind it is reported', () => {
  // No sources.json at all: the ledger claims a source was read, but the
  // sourcing pipeline that would have recorded it never ran - exactly the
  // "model-read style guide left no trace" gap this check closes.
  const { dir, kb } = kbFrom({
    'kb/voice.md': '### V1 · Plainspoken `confirmed` ev: e1\n\n**Means:** Clear.\n',
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — source\n\n**Produced:** V1\n'
  })
  try {
    const report = validateKb(kb)
    const finding = report.findings.find((f) => f.code === 'E_SOURCE_NOT_INDEXED')
    assert.ok(finding, JSON.stringify(report.findings))
    assert.equal(finding.severity, 'error')
    assert.match(finding.message, /V1/)
    assert.equal(finding.file, 'voice.md')
    assert.ok(report.errors > 0)
  } finally {
    cleanup(dir)
  }
})

test('two index entries with the same sha256 are reported', () => {
  const { dir, kb } = kbFrom({
    'kb/evidence/sources.json': sourcesJson([
      sourceEntry({ id: 'f001', sha256: 'a'.repeat(64) }),
      sourceEntry({ id: 'f002', sha256: 'a'.repeat(64), origin: 'sources/b.txt' })
    ])
  })
  try {
    const report = validateKb(kb)
    const finding = report.findings.find((f) => f.code === 'E_DUPLICATE_SHA')
    assert.ok(finding, JSON.stringify(report.findings))
    assert.equal(finding.severity, 'error')
    assert.match(finding.message, /f001/)
    assert.match(finding.message, /f002/)
    assert.equal(finding.file, 'evidence/sources.json')
    assert.ok(report.errors > 0, 'duplicate identity must fail the build, not just warn')
  } finally {
    cleanup(dir)
  }
})

test('a used entry with no stats block is reported', () => {
  const { dir, kb } = kbFrom({
    'kb/evidence/sources.json': sourcesJson([sourceEntry({ status: 'used', stats: null })])
  })
  try {
    const report = validateKb(kb)
    const finding = report.findings.find((f) => f.code === 'E_NO_STATS')
    assert.ok(finding, JSON.stringify(report.findings))
    assert.equal(finding.severity, 'error')
    assert.match(finding.message, /f001/)
    assert.equal(finding.file, 'evidence/sources.json')
    assert.ok(report.errors > 0, 'a used source with no stats silently drops out of the fingerprint')
  } finally {
    cleanup(dir)
  }
})

// F6: W_ORPHAN_CACHE and its check were removed along with the extract
// cache itself - a check on a store nothing ever wrote to any more.

test('a source whose locale is not in the active profile is reported as a warning', () => {
  const { dir, kb } = kbFrom({
    'kb/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: cs',
      '    locales: [cs]'
    ].join('\n'),
    'kb/evidence/sources.json': sourcesJson([sourceEntry({ locale: 'en' })])
  })
  try {
    const report = validateKb(kb)
    const finding = report.findings.find((f) => f.code === 'W_LOCALE_NOT_ACTIVE')
    assert.ok(finding, JSON.stringify(report.findings))
    assert.equal(finding.severity, 'warning')
    assert.match(finding.message, /f001/)
    assert.match(finding.message, /"en"/)
    assert.equal(report.errors, 0, 'a locale mismatch is a fossil to investigate, not a build-blocking error')
  } finally {
    cleanup(dir)
  }
})

test('a source whose locale matches the active profile raises no finding', () => {
  const { dir, kb } = kbFrom({
    'kb/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: en',
      '    locales: [en, cs]'
    ].join('\n'),
    'kb/evidence/sources.json': sourcesJson([sourceEntry({ locale: 'cs' })])
  })
  try {
    const report = validateKb(kb)
    assert.ok(!codesOf(report).includes('W_LOCALE_NOT_ACTIVE'), codesOf(report).join(', '))
  } finally {
    cleanup(dir)
  }
})

test('a source whose locale is declared by a non-default profile raises no finding', () => {
  // validate has no --profile flag, but `sources.mjs --profile cs --ingest`
  // is supported. Checking only `default` warned on every entry ingested
  // under a second profile, and told the user to re-ingest - which would
  // rebuild the identical entry and burn the one repair available.
  const { dir, kb } = kbFrom({
    'kb/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: en',
      '    locales: [en]',
      '  cs:',
      '    name: "Acme CZ"',
      '    primary_locale: cs',
      '    locales: [cs]'
    ].join('\n'),
    'kb/evidence/sources.json': sourcesJson([sourceEntry({ locale: 'cs' })])
  })
  try {
    const report = validateKb(kb)
    assert.ok(!codesOf(report).includes('W_LOCALE_NOT_ACTIVE'), codesOf(report).join(', '))
  } finally {
    cleanup(dir)
  }
})

test('a locale no declared profile mentions is still reported', () => {
  const { dir, kb } = kbFrom({
    'kb/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: en',
      '    locales: [en]',
      '  cs:',
      '    name: "Acme CZ"',
      '    primary_locale: cs',
      '    locales: [cs]'
    ].join('\n'),
    // Since speaker profiles, every non-default profile is a speaker and
    // must own an overlay directory (E_OVERLAY_DIR_MISMATCH otherwise).
    'kb/profiles/cs/voice.md': '# Voice\n',
    'kb/evidence/sources.json': sourcesJson([sourceEntry({ locale: 'de' })])
  })
  try {
    const report = validateKb(kb)
    const finding = report.findings.find((f) => f.code === 'W_LOCALE_NOT_ACTIVE')
    assert.ok(finding, JSON.stringify(report.findings))
    assert.match(finding.message, /"de"/)
    assert.match(finding.message, /en, cs/, 'the warning names every declared locale, not just the default profile')
    assert.equal(report.errors, 0)
  } finally {
    cleanup(dir)
  }
})

test('an entry produced by an extractor version vendor/manifest.json no longer pins is a warning', () => {
  const { dir, kb } = kbFrom({
    'kb/config.yml': '\n',
    'kb/evidence/sources.json': sourcesJson([
      sourceEntry({ extractor: { name: REAL_LIBRARY, version: '0.0.0-not-real' } })
    ])
  })
  try {
    const report = validateKb(kb)
    const finding = report.findings.find((f) => f.code === 'W_STALE_EXTRACTOR')
    assert.ok(finding, JSON.stringify(report.findings))
    assert.equal(finding.severity, 'warning')
    assert.match(finding.message, new RegExp(REAL_LIBRARY))
    assert.equal(report.errors, 0, 'a version bump is a prompt to re-ingest, not a broken build')
  } finally {
    cleanup(dir)
  }
})

test('a well-formed source index produces none of the six new findings', () => {
  const { dir, kb } = kbFrom({
    'kb/voice.md': '### V1 · Plainspoken `confirmed` ev: e1\n\n**Means:** Clear.\n',
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — source\n\n**Produced:** V1\n',
    'kb/evidence/sources.json': sourcesJson([
      sourceEntry({ produced: ['V1'], extractor: { name: REAL_LIBRARY, version: REAL_LIBRARY_INFO.version } })
    ])
  })
  try {
    const report = validateKb(kb)
    const codes = codesOf(report)
    for (const bad of [
      'E_DANGLING_PRODUCED_ID', 'E_INVALID_PRODUCED', 'E_SOURCE_NOT_INDEXED', 'E_DUPLICATE_SHA',
      'E_NO_STATS', 'W_LOCALE_NOT_ACTIVE', 'W_STALE_EXTRACTOR'
    ]) {
      assert.ok(!codes.includes(bad), `${bad} fired on a well-formed index: ${codes.join(', ')}`)
    }
    assert.equal(report.errors, 0)
  } finally {
    cleanup(dir)
  }
})

test('a hand-built kb with no kbRoot skips every source-index check rather than throwing', () => {
  // The gate that keeps this file's many hand-built-kb tests (above) from
  // needing a kbRoot of their own: no directory to read sources.json, the
  // vendor manifest, or the cache out of is silence, not a crash. This kb
  // still produces its ordinary W_NO_EVIDENCE finding (a confirmed rule
  // citing no evidence) - the point here is only that none of the six new
  // codes ever appear, since there is nothing on disk for them to check.
  const report = validateKb({
    rules: [{ id: 'V1', file: 'voice', line: 1, confidence: 'confirmed', evidence: [] }]
  })
  const codes = codesOf(report)
  for (const bad of [
    'E_DANGLING_PRODUCED_ID', 'E_INVALID_PRODUCED', 'E_SOURCE_NOT_INDEXED', 'E_DUPLICATE_SHA',
    'E_NO_STATS', 'W_LOCALE_NOT_ACTIVE', 'W_STALE_EXTRACTOR'
  ]) {
    assert.ok(!codes.includes(bad), `${bad} fired despite no kbRoot: ${codes.join(', ')}`)
  }
})

// --- Task 14 fix round 2: a malformed `produced` must never throw ---------
//
// `for (const x of source.produced ?? [])` only substitutes on null/undefined
// - a real on-disk sources.json with `produced: 5` or `produced: {}` threw
// (not iterable), and `produced: "V1"` iterated character-by-character and
// reported phantom dangling ids for "V" and "1". sources.json is committed
// and hand-editable, so a scalar written where an array belongs must become
// a finding, never a crash of every /voice-and-tone:sync.

function entryWithProduced (shape) {
  const entry = sourceEntry()
  if (shape === 'absent') {
    delete entry.produced
  } else {
    entry.produced = shape
  }
  return entry
}

test('validateKb never throws, for every shape a committed `produced` field might take', () => {
  const shapes = ['absent', null, ['V1'], 5, 'V1', {}]
  for (const shape of shapes) {
    const { dir, kb } = kbFrom({
      'kb/config.yml': '\n',
      'kb/evidence/sources.json': sourcesJson([entryWithProduced(shape)])
    })
    try {
      let report
      assert.doesNotThrow(() => { report = validateKb(kb) }, `produced: ${JSON.stringify(shape)} must not throw`)
      assert.ok(Array.isArray(report.findings), `produced: ${JSON.stringify(shape)} must still return a report`)
    } finally {
      cleanup(dir)
    }
  }
})

test('produced as a number, string, or object is its own finding, not silently emptied', () => {
  for (const shape of [5, 'V1', {}]) {
    const { dir, kb } = kbFrom({
      'kb/config.yml': '\n',
      'kb/evidence/sources.json': sourcesJson([entryWithProduced(shape)])
    })
    try {
      const report = validateKb(kb)
      const codes = codesOf(report)
      assert.ok(codes.includes('E_INVALID_PRODUCED'),
        `produced: ${JSON.stringify(shape)} should report E_INVALID_PRODUCED (${codes.join(', ')})`)
      assert.equal(report.errors, 1,
        `produced: ${JSON.stringify(shape)} should report exactly one error, not a cascade (${codes.join(', ')})`)
    } finally {
      cleanup(dir)
    }
  }
})

test('a string `produced` reports the shape defect, never phantom per-character dangling ids', () => {
  // The failure this fix closes: "V1" is iterable, so the old code walked
  // it character by character and reported "V" and "1" as dangling rule ids
  // - two confident, wrong findings about ids that were never really there.
  const { dir, kb } = kbFrom({
    'kb/config.yml': '\n',
    'kb/evidence/sources.json': sourcesJson([entryWithProduced('V1')])
  })
  try {
    const report = validateKb(kb)
    assert.deepEqual(codesOf(report), ['E_INVALID_PRODUCED'])
    assert.ok(!report.findings.some((f) => /\bV\b/.test(f.message) || /\b1\b/.test(f.message)),
      `must not mention phantom single-character ids: ${JSON.stringify(report.findings)}`)
  } finally {
    cleanup(dir)
  }
})

test('produced as null or absent is treated as empty, with no finding at all', () => {
  for (const shape of [null, 'absent']) {
    const { dir, kb } = kbFrom({
      'kb/config.yml': '\n',
      'kb/evidence/sources.json': sourcesJson([entryWithProduced(shape)])
    })
    try {
      const codes = codesOf(validateKb(kb))
      assert.ok(!codes.includes('E_INVALID_PRODUCED'), `produced: ${shape} must not be flagged as malformed`)
      assert.ok(!codes.includes('E_DANGLING_PRODUCED_ID'), `produced: ${shape} must not be treated as dangling ids`)
    } finally {
      cleanup(dir)
    }
  }
})

// --- F8: two parsers, one format contract

test('a prose rule in a table file is warned about, not silently dropped', () => {
  // lexicon.md and mechanics.md are read by compile-context with
  // parseTableRules ALONE. A rule written there in the prose shape that
  // voice.md, tone.md and every pack use was parsed and counted here, reported
  // clean, and then missing from the always-loaded card - so a knowledge base
  // could pass with 0 errors while its Lexicon and Mechanics sections both
  // compiled to "_None yet._".
  const report = validateKb({
    rules: [
      { id: 'L01', file: 'lexicon', kind: 'prose', line: 3, confidence: 'derived', evidence: ['e1'] },
      { id: 'M01', file: 'mechanics', kind: 'prose', line: 9, confidence: 'derived', evidence: ['e1'] }
    ],
    evidence: [{ id: 'e1', type: 'corpus', produced: ['L01', 'M01'], line: 1 }]
  })

  const flagged = report.findings.filter((f) => f.code === 'W_PROSE_RULE_IN_TABLE_FILE')
  assert.equal(flagged.length, 2)
  assert.deepEqual(flagged.map((f) => f.file).sort(), ['lexicon.md', 'mechanics.md'])
  assert.deepEqual(flagged.map((f) => f.line).sort(), [3, 9])
  assert.equal(report.errors, 0, 'a warning, not an error - the KB still works, it is just incomplete')
})

test('table rules in a table file, and prose rules elsewhere, are both left alone', () => {
  const report = validateKb({
    rules: [
      { id: 'L01', file: 'lexicon', kind: 'table', line: 6, confidence: 'derived', evidence: ['e1'] },
      { id: 'M01', file: 'mechanics', kind: 'table', line: 9, confidence: 'derived', evidence: ['e1'] },
      { id: 'V1', file: 'voice', kind: 'prose', line: 4, confidence: 'derived', evidence: ['e1'] },
      { id: 'X01', file: 'cs', kind: 'prose', line: 7, confidence: 'derived', evidence: ['e1'] }
    ],
    evidence: [{ id: 'e1', type: 'corpus', produced: ['L01', 'M01', 'V1', 'X01'], line: 1 }]
  })

  assert.ok(!codesOf(report).includes('W_PROSE_RULE_IN_TABLE_FILE'))
})

// --- speakers and locks (spec 2026-09-10 §8.2) ----------------------------

const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'house-with-speakers')

function fixtureKb () {
  const dir = makeTmpProject({})
  cpSync(FIXTURE, path.join(dir, '.voice-and-tone'), { recursive: true })
  return { dir, kbRoot: path.join(dir, '.voice-and-tone') }
}

test('the house of the fixture validates clean', () => {
  const { dir, kbRoot } = fixtureKb()
  try {
    const report = validateKb(resolveKb(kbRoot, 'default'))
    assert.equal(report.errors, 0, JSON.stringify(report.findings, null, 2))
  } finally {
    cleanup(dir)
  }
})

test('E_LOCKED_OVERRIDE names the overlay file and line; the house keeps its rule', () => {
  const { dir, kbRoot } = fixtureKb()
  try {
    const report = validateKb(resolveKb(kbRoot, 'jonas'))
    const hit = report.findings.find((f) => f.code === 'E_LOCKED_OVERRIDE')
    assert.ok(hit)
    assert.equal(hit.file, path.posix.join('profiles', 'jonas', 'lexicon.md'))
    assert.equal(hit.line, 3)
    assert.match(hit.message, /L20/)
    assert.ok(!report.findings.some((f) => f.code === 'E_DUPLICATE_ID'), 'an override is not a duplicate')
  } finally {
    cleanup(dir)
  }
})

test('W_SPEAKER_NO_VOICE fires for an overlay with no V rule and no dials line', () => {
  const { dir, kbRoot } = fixtureKb()
  try {
    const jonas = validateKb(resolveKb(kbRoot, 'jonas'))
    assert.ok(jonas.findings.some((f) => f.code === 'W_SPEAKER_NO_VOICE'))
    const maya = validateKb(resolveKb(kbRoot, 'maya'))
    assert.ok(!maya.findings.some((f) => f.code === 'W_SPEAKER_NO_VOICE'))
  } finally {
    cleanup(dir)
  }
})

test('W_ID_RANGE_COLLISION_RISK fires for a speaker addition below the next decade above the house', () => {
  const { dir, kbRoot } = fixtureKb()
  try {
    const jonas = validateKb(resolveKb(kbRoot, 'jonas'))
    const hit = jonas.findings.find((f) => f.code === 'W_ID_RANGE_COLLISION_RISK')
    assert.ok(hit, 'L02 sits below L30, the first safe id when the house tops out at L20')
    assert.match(hit.message, /L02/)
    assert.match(hit.message, /L30/)
    const maya = validateKb(resolveKb(kbRoot, 'maya'))
    assert.ok(!maya.findings.some((f) => f.code === 'W_ID_RANGE_COLLISION_RISK'), 'L30 is safe')
  } finally {
    cleanup(dir)
  }
})

test('W_OVERRIDE_UNEVIDENCED fires for an override citing no evidence, not for one that does', () => {
  const { dir, kbRoot } = fixtureKb()
  try {
    const clean = validateKb(resolveKb(kbRoot, 'maya'))
    assert.ok(!clean.findings.some((f) => f.code === 'W_OVERRIDE_UNEVIDENCED'))
    writeFileSync(path.join(kbRoot, 'profiles', 'maya', 'lexicon.md'), [
      '| ID | Avoid | Prefer | Why | Conf | Ev |',
      '|---|---|---|---|---|---|',
      '| L01 | leverage | lean on | her word | confirmed | |'
    ].join('\n'))
    const dirty = validateKb(resolveKb(kbRoot, 'maya'))
    assert.ok(dirty.findings.some((f) => f.code === 'W_OVERRIDE_UNEVIDENCED'))
  } finally {
    cleanup(dir)
  }
})

test('E_UNKNOWN_LOCK and E_OVERLAY_DIR_MISMATCH are house-level findings', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '  maya:',
      '    name: "Maya Lind"',
      'locks: [V9]',
      ''
    ].join('\n'),
    '.voice-and-tone/voice.md': '### V1 · Plain `assumed`\n\n**Means:** x\n',
    '.voice-and-tone/tone.md': '# Tone\n',
    '.voice-and-tone/profiles/stray/voice.md': '# Voice\n'
  })
  try {
    const report = validateKb(resolveKb(path.join(dir, '.voice-and-tone'), 'default'))
    assert.ok(codesOf(report).includes('E_UNKNOWN_LOCK'))
    const mismatches = report.findings.filter((f) => f.code === 'E_OVERLAY_DIR_MISMATCH')
    assert.equal(mismatches.length, 2, 'maya declared without a directory, stray directory without a declaration')
  } finally {
    cleanup(dir)
  }
})

test('validateAll validates the house and every speaker and sums the counts', () => {
  const { dir, kbRoot } = fixtureKb()
  try {
    const report = validateAll(kbRoot)
    assert.deepEqual(report.profiles.map((p) => p.profile), ['default', 'jonas', 'maya'])
    assert.equal(report.errors, 1, 'exactly the lock violation in jonas')
    assert.ok(report.findings.some((f) => f.code === 'E_LOCKED_OVERRIDE'))
    assert.ok(!report.findings.some((f) => f.code === 'E_UNKNOWN_LOCK'))
  } finally {
    cleanup(dir)
  }
})

test('validateAll on a knowledge base with no speakers is validateKb of the house, finding for finding', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': 'profiles:\n  default:\n    name: "Acme"\n',
    '.voice-and-tone/voice.md': '### V1 · Plain `assumed`\n\n**Means:** x\n',
    '.voice-and-tone/tone.md': '# Tone\n'
  })
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    const all = validateAll(kbRoot)
    const one = validateKb(loadKb(kbRoot))
    assert.deepEqual(all.findings, one.findings)
    assert.deepEqual(all.counts, one.counts)
  } finally {
    cleanup(dir)
  }
})

test('a ledger entry that produced a rule living on any overlay is not orphaned, from the house or from another speaker', () => {
  // The ledger is shared (spec 2026-09-10 §4.5): e1 in the fixture produced
  // V3, L30 and T-social/focused, which live on maya's overlay. The house
  // cannot see overlays through its own resolved rules, and jonas cannot
  // see maya's - so "does this rule exist" is asked of every overlay too.
  const { dir, kbRoot } = fixtureKb()
  try {
    for (const profile of ['default', 'jonas', 'maya']) {
      const report = validateKb(resolveKb(kbRoot, profile))
      assert.ok(!report.findings.some((f) => f.code === 'W_ORPHAN_EVIDENCE'),
        `${profile}: ${JSON.stringify(report.findings.filter((f) => f.code === 'W_ORPHAN_EVIDENCE'))}`)
    }
  } finally {
    cleanup(dir)
  }
})
