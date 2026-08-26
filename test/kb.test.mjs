import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import {
  STATES, CONTEXTS, DIALS, HUMOR_ZERO_STATES,
  cellId, parseRuleHeading, parseProseRules, parseTables, parseTableRules,
  parseToneCells, parseVectors, parseEvidence,
  interpolate, applyHumorGates, resolveCell, loadKb
} from '../scripts/lib/kb.mjs'

test('vocabularies match the spec exactly', () => {
  assert.equal(STATES.length, 8)
  assert.equal(CONTEXTS.length, 10)
  assert.deepEqual(DIALS, ['warmth', 'humor', 'directness', 'detail', 'urgency', 'formality'])
  assert.deepEqual(HUMOR_ZERO_STATES, ['frustrated', 'anxious-at-risk', 'disappointed-leaving'])
  assert.ok(STATES.includes('anxious-at-risk'))
  assert.ok(CONTEXTS.includes('system-error'))
  assert.equal(cellId('product-ui', 'confused'), 'T-product-ui/confused')
})

test('rule headings yield id, name, confidence, and evidence refs', () => {
  assert.deepEqual(
    parseRuleHeading('### V1 · Plainspoken   `confirmed`  ev: e12, e18'),
    { id: 'V1', name: 'Plainspoken', confidence: 'confirmed', evidence: ['e12', 'e18'] }
  )
  assert.deepEqual(
    parseRuleHeading('### T-system-error/frustrated   `derived`  ev: e40'),
    { id: 'T-system-error/frustrated', name: null, confidence: 'derived', evidence: ['e40'] }
  )
  assert.deepEqual(
    parseRuleHeading('### V2 · Genuine `assumed`'),
    { id: 'V2', name: 'Genuine', confidence: 'assumed', evidence: [] }
  )
  assert.equal(parseRuleHeading('## Voice characteristics'), null)
})

test('prose rules capture their labelled fields', () => {
  const md = [
    '## Characteristics',
    '',
    '### V1 · Plainspoken   `confirmed`  ev: e12',
    '',
    '**Means:** Clarity above all.',
    '**Rules out:** fluffy metaphor, upsell language',
    '**Do:** name the thing · state the outcome',
    "**Don't:** reach for a simile",
    '**Example:** *"Your campaign is scheduled."*',
    '',
    '### V2 · Genuine   `assumed`',
    '',
    '**Means:** We sound like a person.'
  ].join('\n')

  const rules = parseProseRules(md)
  assert.equal(rules.length, 2)
  assert.equal(rules[0].fields.Means, 'Clarity above all.')
  assert.deepEqual(rules[0].fields['Rules out'], 'fluffy metaphor, upsell language')
  assert.equal(rules[0].evidence[0], 'e12')
  assert.equal(rules[1].confidence, 'assumed')
  assert.ok(rules[0].line > 0, 'line numbers anchor review findings')
})

test('rules and tables inside HTML comments are documentation, not rules', () => {
  const md = [
    '## Characteristics',
    '',
    '<!--',
    '### V1 · Plainspoken   `confirmed`  ev: e99',
    '',
    '**Means:** An example nobody has adopted yet.',
    '-->',
    '',
    '### V2 · Genuine   `confirmed`  ev: e1',
    '',
    '**Means:** A real rule.'
  ].join('\n')

  const rules = parseProseRules(md)
  assert.deepEqual(rules.map((r) => r.id), ['V2'], 'the commented example must not become a rule')
  assert.equal(rules[0].line, 9, 'masking preserves line numbers')

  const commentedTable = [
    '<!--',
    '| ID | Avoid | Prefer | Why | Conf | Ev |',
    '|---|---|---|---|---|---|',
    '| L99 | example | sample | illustration | confirmed | e99 |',
    '-->'
  ].join('\n')
  assert.deepEqual(parseTableRules(commentedTable), [])

  assert.deepEqual(parseEvidence('<!--\n### e99 — 2026-08-26 — interview\n-->'), [])
})

test('tabular rules read ID, Conf, and Ev columns', () => {
  const md = [
    '## Avoid',
    '',
    '| ID  | Avoid    | Prefer | Why         | Conf      | Ev  |',
    '|-----|----------|--------|-------------|-----------|-----|',
    '| L07 | leverage | use    | jargon      | confirmed | e22 |',
    '| L08 | simply   | —      | condescends | derived   | e31, e33 |'
  ].join('\n')

  const rules = parseTableRules(md)
  assert.equal(rules.length, 2)
  assert.equal(rules[0].id, 'L07')
  assert.equal(rules[0].cells.Avoid, 'leverage')
  assert.equal(rules[0].confidence, 'confirmed')
  assert.deepEqual(rules[1].evidence, ['e31', 'e33'])
  assert.equal(rules[0].section, 'Avoid')

  const tables = parseTables(md)
  assert.equal(tables.length, 1)
  assert.deepEqual(tables[0].headers, ['ID', 'Avoid', 'Prefer', 'Why', 'Conf', 'Ev'])
})

test('tone cells parse dials, do/dont lists, and the example', () => {
  const md = [
    '### T-system-error/frustrated   `confirmed`  ev: e12, e40',
    '',
    "**Reader is feeling:** blocked, and suspecting it's our fault",
    '**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2',
    '**Do:** say what happened · say what to do next · own it if it is ours',
    "**Don't:** joke · apologize twice",
    '**Example:** *"That file did not upload."*'
  ].join('\n')

  const [cell] = parseToneCells(md)
  assert.equal(cell.id, 'T-system-error/frustrated')
  assert.equal(cell.context, 'system-error')
  assert.equal(cell.state, 'frustrated')
  assert.deepEqual(cell.dials, { warmth: 2, humor: 0, directness: 4, detail: 3, urgency: 1, formality: 2 })
  assert.equal(cell.do.length, 3)
  assert.deepEqual(cell.dont, ['joke', 'apologize twice'])
  assert.equal(cell.example, 'That file did not upload.')
})

test('state vectors and context offsets come from their own tables', () => {
  const md = [
    '## State vectors',
    '',
    '| State | warmth | humor | directness | detail | urgency | formality |',
    '|---|---|---|---|---|---|---|',
    '| delighted | 4 | 3 | 2 | 1 | 1 | 1 |',
    '| confused | 3 | 1 | 4 | 4 | 2 | 2 |',
    '',
    '## Context offsets',
    '',
    '| Context | warmth | humor | directness | detail | urgency | formality |',
    '|---|---|---|---|---|---|---|',
    '| system-error | -1 | -2 | +1 | 0 | 0 | 0 |'
  ].join('\n')

  const vectors = parseVectors(md)
  assert.equal(vectors.states.delighted.warmth, 4)
  assert.equal(vectors.states.confused.detail, 4)
  assert.equal(vectors.contexts['system-error'].humor, -2)
  assert.equal(vectors.contexts['system-error'].directness, 1)
})

test('evidence entries are bidirectional: they record what they produced', () => {
  const md = [
    '### e12 — 2026-08-26 — interview',
    '',
    '**Type:** preference-pair',
    '**Asked:** error-message formality',
    '**Answer:** B',
    '**Produced:** V1, T-product-ui/frustrated, M04'
  ].join('\n')

  const [entry] = parseEvidence(md)
  assert.equal(entry.id, 'e12')
  assert.equal(entry.date, '2026-08-26')
  assert.equal(entry.type, 'interview')
  assert.deepEqual(entry.produced, ['V1', 'T-product-ui/frustrated', 'M04'])
  assert.equal(entry.fields.Answer, 'B')
})

test('interpolation clamps to 0-4 and never yields humor (gate 1)', () => {
  const dials = interpolate(
    { warmth: 4, humor: 4, directness: 2, detail: 1, urgency: 1, formality: 1 },
    { warmth: 2, humor: 2, directness: -3, detail: 0, urgency: 0, formality: 0 }
  )
  assert.equal(dials.warmth, 4, 'clamped at the top')
  assert.equal(dials.directness, 0, 'clamped at the bottom')
  assert.equal(dials.humor, 0, 'an interpolated cell may never produce humor')
})

test('gate 2 forces humor to zero for three states even in an authored cell', () => {
  for (const state of HUMOR_ZERO_STATES) {
    const gated = applyHumorGates({ warmth: 3, humor: 4, directness: 2, detail: 2, urgency: 2, formality: 2 }, state)
    assert.equal(gated.humor, 0, `${state} must never be joked at`)
  }
  const ok = applyHumorGates({ warmth: 3, humor: 4, directness: 2, detail: 2, urgency: 2, formality: 2 }, 'delighted')
  assert.equal(ok.humor, 4, 'an authored cell for a safe state keeps its humor')
})

test('resolveCell prefers an authored cell and marks computed ones', () => {
  const cells = parseToneCells([
    '### T-system-error/frustrated   `confirmed`  ev: e1',
    '',
    '**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2'
  ].join('\n'))
  const vectors = {
    states: { delighted: { warmth: 4, humor: 3, directness: 2, detail: 1, urgency: 1, formality: 1 } },
    contexts: { email: { warmth: 0, humor: 0, directness: 0, detail: 1, urgency: 0, formality: 1 } }
  }

  const authored = resolveCell('system-error', 'frustrated', { cells, vectors })
  assert.equal(authored.source, 'authored')
  assert.equal(authored.dials.directness, 4)
  assert.equal(authored.confidence, 'confirmed')

  const computed = resolveCell('email', 'delighted', { cells, vectors })
  assert.equal(computed.source, 'interpolated')
  assert.equal(computed.confidence, 'interpolated')
  assert.equal(computed.dials.humor, 0)
  assert.equal(computed.dials.formality, 2)
  assert.equal(computed.id, 'T-email/delighted')
})

test('loadKb reads every KB file it finds and tolerates missing ones', () => {
  const dir = makeTmpProject({
    'kb/config.yml': 'kb_version: 0.2.0\n',
    'kb/voice.md': '### V1 · Plainspoken `confirmed` ev: e1\n\n**Means:** Clear.\n',
    'kb/lexicon.md': '| ID | Avoid | Prefer | Why | Conf | Ev |\n|---|---|---|---|---|---|\n| L01 | leverage | use | jargon | confirmed | e1 |\n',
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V1, L01\n',
    'kb/channels/email.md': '### C01 · Subject lines `assumed`\n\n**Means:** Short.\n',
    'kb/locales/cs.md': '### X01 · Vykani `confirmed` ev: e1\n\n**Means:** Formal address.\n'
  })
  try {
    const kb = loadKb(path.join(dir, 'kb'))
    assert.equal(kb.config.kb_version, '0.2.0')
    assert.equal(kb.rules.find((r) => r.id === 'V1').confidence, 'confirmed')
    assert.equal(kb.rules.find((r) => r.id === 'L01').cells.Prefer, 'use')
    assert.equal(kb.evidence[0].produced.length, 2)
    assert.deepEqual(Object.keys(kb.channels), ['email'])
    assert.deepEqual(Object.keys(kb.locales), ['cs'])
    assert.deepEqual(kb.cells, [], 'no tone.md means no cells, not a crash')
  } finally {
    cleanup(dir)
  }
})
