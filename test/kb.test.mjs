import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import {
  STATES, CONTEXTS, DIALS, HUMOR_ZERO_STATES,
  cellId, parseRuleHeading, parseProseRules, parseTables, parseTableRules,
  parseToneCells, parseVectors, parseEvidence,
  interpolate, applyHumorGates, resolveCell, loadKb,
  defaultDialsOf, speakerOffsetOf, mergeRules, resolveKb
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

test("resolveCell gates the nested cell's dials too, so cell.dials agrees with the top-level dials", () => {
  const md = [
    '### T-system-error/frustrated   `confirmed`  ev: e1',
    '',
    '**Dials:** warmth 3 · humor 4 · directness 2 · detail 2 · urgency 2 · formality 2'
  ].join('\n')

  const cells = parseToneCells(md)
  assert.equal(cells[0].dials.humor, 4, 'parseToneCells returns the raw authored value, for validate.mjs')

  const resolved = resolveCell('system-error', 'frustrated', { cells, vectors: { states: {}, contexts: {} } })
  assert.equal(resolved.dials.humor, 0, 'top-level dials are gated')
  assert.equal(resolved.cell.dials.humor, 0, 'the nested cell dials must agree with the top-level dials')
})

test('an unterminated HTML comment masks to end of file, not just to the next stray -->', () => {
  const md = [
    '## Characteristics',
    '',
    '<!--',
    '### V9 · Never adopted   `confirmed`  ev: e1',
    '',
    '**Means:** Should never appear.'
  ].join('\n')

  assert.deepEqual(parseProseRules(md), [])
})

// --- F4: the Pattern column holds regexes, and regexes contain pipes

test('an escaped pipe stays inside its cell instead of shifting every column right', () => {
  // mechanics.md documents `Pattern` as a regular expression, and alternation
  // uses the same character that ends a markdown cell. Splitting on a bare
  // pipe made the column unable to express alternation at all: the escaped
  // form every markdown writer reaches for shifted Conf into Pattern and
  // pushed Ev off the end entirely.
  const md = [
    '| ID | Rule | Pattern | Conf | Ev |',
    '|---|---|---|---|---|',
    '| M01 | escaped pipe | a\\|b | derived | e02 |'
  ].join('\n')

  const [row] = parseTables(md)[0].rows
  assert.equal(row.row.Pattern, 'a|b', 'the escape is unwritten, so the rule sees the pattern meant')
  assert.equal(row.row.Conf, 'derived')
  assert.equal(row.row.Ev, 'e02', 'the evidence reference used to fall off the end of the row')
})

test('a real alternation regex round-trips through a mechanics table', () => {
  const md = [
    '| ID | Rule | Pattern | Conf | Ev |',
    '|---|---|---|---|---|',
    '| M01 | vykani | \\b(vy\\|vas\\|vase\\|vam)\\b | derived | e02 |'
  ].join('\n')

  const [rule] = parseTableRules(md)
  assert.equal(rule.id, 'M01')
  assert.equal(rule.confidence, 'derived')
  assert.deepEqual(rule.evidence, ['e02'])
  assert.equal(rule.cells.Pattern, '\\b(vy|vas|vase|vam)\\b')
  assert.doesNotThrow(() => new RegExp(rule.cells.Pattern), 'and it must actually compile')
})

test('a row with no escapes is unaffected', () => {
  const md = [
    '| ID | Rule | Pattern | Conf | Ev |',
    '|---|---|---|---|---|',
    '| M02 | plain | abc | assumed | e01 |'
  ].join('\n')
  const [row] = parseTables(md)[0].rows
  assert.deepEqual(row.row, { ID: 'M02', Rule: 'plain', Pattern: 'abc', Conf: 'assumed', Ev: 'e01' })
})

test('an escaped pipe at the end of a cell does not swallow the row terminator', () => {
  const md = [
    '| ID | Rule | Pattern | Conf | Ev |',
    '|---|---|---|---|---|',
    '| M03 | trailing | ab\\| | derived | e02 |'
  ].join('\n')
  const [row] = parseTables(md)[0].rows
  assert.equal(row.row.Pattern, 'ab|')
  assert.equal(row.row.Ev, 'e02')
})

// ---------------------------------------------------------------- speakers

const HOUSE = {
  'kb/config.yml': [
    'profiles:',
    '  default:',
    '    name: "Acme"',
    '    primary_locale: en',
    '    locales: [en]',
    '  maya:',
    '    name: "Maya Lind"',
    'locks: [V2, L20]',
    ''
  ].join('\n'),
  'kb/voice.md': [
    '### V1 · Plainspoken `confirmed` ev: e1',
    '',
    '**Means:** Clarity above all.',
    '**Rules out:** fluff',
    '',
    '### V2 · No pressure `confirmed` ev: e1',
    '',
    '**Means:** Never manufacture urgency.',
    '**Rules out:** countdowns'
  ].join('\n'),
  'kb/tone.md': [
    '**Default dials:** warmth 3 · humor 0 · directness 3 · detail 2 · urgency 2 · formality 2',
    '',
    '| State | warmth | humor | directness | detail | urgency | formality |',
    '|---|---|---|---|---|---|---|',
    '| curious | 3 | 2 | 3 | 3 | 1 | 2 |',
    '| focused | 2 | 1 | 4 | 2 | 2 | 2 |',
    '',
    '| Context | warmth | humor | directness | detail | urgency | formality |',
    '|---|---|---|---|---|---|---|',
    '| social | 1 | 2 | 0 | -2 | 0 | -2 |',
    '',
    '### T-social/curious `confirmed` ev: e1',
    '',
    '**Dials:** warmth 4 · humor 2 · directness 3 · detail 1 · urgency 1 · formality 0'
  ].join('\n'),
  'kb/lexicon.md': [
    '| ID | Avoid | Prefer | Why | Conf | Ev |',
    '|---|---|---|---|---|---|',
    '| L01 | leverage | use | jargon | confirmed | e1 |',
    '| L20 | game changer | (cut) | hype | confirmed | e1 |'
  ].join('\n'),
  'kb/mechanics.md': [
    '| ID | Rule | Pattern | Conf | Ev |',
    '|---|---|---|---|---|',
    '| M01 | sentence case | | confirmed | e1 |'
  ].join('\n'),
  'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V1, V2, L01, L20, M01, T-social/curious\n'
}

const OVERLAY = {
  'kb/profiles/maya/voice.md': [
    '### V1 · Builder `confirmed` ev: e1',
    '',
    '**Means:** Writes from what she built this week.',
    '**Rules out:** commentary from the sidelines'
  ].join('\n'),
  'kb/profiles/maya/tone.md': [
    '**Default dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 3',
    '',
    '| State | warmth | humor | directness | detail | urgency | formality |',
    '|---|---|---|---|---|---|---|',
    '| focused | 1 | 0 | 4 | 3 | 2 | 3 |',
    '',
    '### T-social/focused `confirmed` ev: e1',
    '',
    '**Dials:** warmth 1 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 3'
  ].join('\n'),
  'kb/profiles/maya/lexicon.md': [
    '| ID | Avoid | Prefer | Why | Conf | Ev |',
    '|---|---|---|---|---|---|',
    '| L01 | leverage | lean on | her word | confirmed | e1 |',
    '| L30 | excited to announce | (cut) | hype | confirmed | e1 |'
  ].join('\n')
}

test('defaultDialsOf reads the dials line and returns null without one', () => {
  assert.deepEqual(defaultDialsOf(HOUSE['kb/tone.md']),
    { warmth: 3, humor: 0, directness: 3, detail: 2, urgency: 2, formality: 2 })
  assert.equal(defaultDialsOf('# Tone\n'), null)
})

test('speakerOffsetOf is overlay defaults minus house defaults, per dial, and null without overlay defaults', () => {
  assert.deepEqual(speakerOffsetOf(HOUSE['kb/tone.md'], OVERLAY['kb/profiles/maya/tone.md']),
    { warmth: -1, humor: 0, directness: 1, detail: 1, urgency: -1, formality: 1 })
  assert.equal(speakerOffsetOf(HOUSE['kb/tone.md'], '# Tone\n'), null)
  assert.deepEqual(speakerOffsetOf('# Tone\n', OVERLAY['kb/profiles/maya/tone.md']),
    { warmth: 0, humor: 0, directness: 2, detail: 1, urgency: -1, formality: 1 },
    'a house with no dials line is treated as the neutral 2 on every dial')
})

test('interpolate applies a speaker offset as a third term, clamps, and still zeroes humor', () => {
  const state = { warmth: 3, humor: 2, directness: 3, detail: 3, urgency: 1, formality: 2 }
  const context = { warmth: 1, humor: 2, directness: 0, detail: -2, urgency: 0, formality: -2 }
  const offset = { warmth: -1, humor: 3, directness: 1, detail: 1, urgency: -1, formality: 1 }
  assert.deepEqual(interpolate(state, context, offset),
    { warmth: 3, humor: 0, directness: 4, detail: 2, urgency: 0, formality: 1 })
  assert.deepEqual(interpolate(state, context), interpolate(state, context, {}),
    'an absent offset is the identity, so every existing caller is unchanged')
})

test('resolveCell passes the speaker offset through to interpolation only', () => {
  const vectors = {
    states: { curious: { warmth: 3, humor: 2, directness: 3, detail: 3, urgency: 1, formality: 2 } },
    contexts: { social: { warmth: 1, humor: 2, directness: 0, detail: -2, urgency: 0, formality: -2 } }
  }
  const offset = { warmth: -1, humor: 0, directness: 1, detail: 1, urgency: -1, formality: 1 }
  const computed = resolveCell('social', 'curious', { cells: [], vectors, speakerOffset: offset })
  assert.equal(computed.source, 'interpolated')
  assert.equal(computed.dials.warmth, 3)
  assert.equal(computed.dials.directness, 4)
  const authored = resolveCell('social', 'curious', {
    cells: [{ id: 'T-social/curious', context: 'social', state: 'curious', confidence: 'confirmed', dials: { warmth: 4, humor: 2, directness: 3, detail: 1, urgency: 1, formality: 0 } }],
    vectors,
    speakerOffset: offset
  })
  assert.equal(authored.dials.warmth, 4, 'an authored cell is never shifted')
})

test('mergeRules: additions add, same-id overrides replace, locked ids are refused', () => {
  const house = [
    { id: 'L01', file: 'lexicon', kind: 'table', line: 3 },
    { id: 'L20', file: 'lexicon', kind: 'table', line: 4 }
  ]
  const overlay = [
    { id: 'L01', file: 'lexicon', kind: 'table', line: 3 },
    { id: 'L20', file: 'lexicon', kind: 'table', line: 4 },
    { id: 'L30', file: 'lexicon', kind: 'table', line: 5 }
  ]
  const { rules, overrides, lockViolations } = mergeRules(house, overlay, ['L20'])
  assert.deepEqual(rules.map((r) => [r.id, r.origin, r.locked]),
    [['L20', 'house', true], ['L01', 'speaker', false], ['L30', 'speaker', false]])
  assert.equal(rules.find((r) => r.id === 'L01').overrides.line, 3)
  assert.deepEqual(overrides.map((r) => r.id), ['L01'])
  assert.deepEqual(lockViolations.map((v) => v.id), ['L20'])
})

test('resolveKb with no overlay is the house, tagged, with role house', () => {
  const dir = makeTmpProject(HOUSE)
  try {
    const kb = resolveKb(path.join(dir, 'kb'))
    assert.equal(kb.role, 'house')
    assert.equal(kb.speaker, null)
    assert.deepEqual(kb.locks, ['V2', 'L20'])
    assert.ok(kb.rules.every((r) => r.origin === 'house'))
    assert.equal(kb.rules.find((r) => r.id === 'V2').locked, true)
    assert.equal(kb.rules.find((r) => r.id === 'V1').locked, false)
    assert.equal(kb.rules.find((r) => r.id === 'V1').path, 'voice.md')
    assert.deepEqual(kb.overrides, [])
    assert.deepEqual(kb.lockViolations, [])
    assert.equal(kb.speakerOffset, null)
    assert.deepEqual(kb.rules.map((r) => r.id), loadKb(path.join(dir, 'kb')).rules.map((r) => r.id), 'same rules, same order as loadKb')
    const unknown = resolveKb(path.join(dir, 'kb'), 'ghost')
    assert.equal(unknown.role, 'house', 'an undeclared profile resolves to the house')
  } finally {
    cleanup(dir)
  }
})

test('resolveKb merges an overlay: voice replaces as a set, locked voice is appended, others merge by id', () => {
  const dir = makeTmpProject({ ...HOUSE, ...OVERLAY })
  try {
    const kb = resolveKb(path.join(dir, 'kb'), 'maya')
    assert.equal(kb.role, 'speaker')
    assert.deepEqual(kb.speaker, { slug: 'maya', name: 'Maya Lind' })
    const voice = kb.rules.filter((r) => r.id.startsWith('V'))
    assert.deepEqual(voice.map((r) => [r.id, r.name, r.origin, r.locked]),
      [['V1', 'Builder', 'speaker', false], ['V2', 'No pressure', 'house', true]],
      "the house's unlocked V1 is gone, its locked V2 follows the speaker's own")
    const l01 = kb.rules.find((r) => r.id === 'L01')
    assert.equal(l01.origin, 'speaker')
    assert.equal(l01.cells.Prefer, 'lean on')
    assert.equal(l01.overrides.cells.Prefer, 'use')
    assert.equal(l01.path, path.posix.join('profiles', 'maya', 'lexicon.md'))
    assert.equal(kb.rules.find((r) => r.id === 'L30').origin, 'speaker')
    assert.equal(kb.rules.find((r) => r.id === 'M01').origin, 'house', 'inherited untouched')
    assert.equal(kb.rules.filter((r) => r.id === 'L20').length, 1)
    assert.equal(kb.rules.find((r) => r.id === 'L20').origin, 'house', 'the locked house row wins')
    assert.deepEqual(kb.overrides.map((r) => r.id), ['L01'])
    assert.deepEqual(kb.lockViolations.map((v) => v.id), [])
  } finally {
    cleanup(dir)
  }
})

test('resolveKb: cells are the overlay only, vectors merge by row, offset is derived, evidence is the house ledger', () => {
  const dir = makeTmpProject({ ...HOUSE, ...OVERLAY })
  try {
    const kb = resolveKb(path.join(dir, 'kb'), 'maya')
    assert.deepEqual(kb.cells.map((c) => c.id), ['T-social/focused'], 'house authored cells are not inherited')
    assert.equal(kb.vectors.states.curious.warmth, 3, 'inherited row')
    assert.equal(kb.vectors.states.focused.warmth, 1, 'overridden row')
    assert.equal(kb.vectors.contexts.social.detail, -2)
    assert.deepEqual(kb.speakerOffset, { warmth: -1, humor: 0, directness: 1, detail: 1, urgency: -1, formality: 1 })
    assert.equal(kb.evidence.length, 1)
    assert.equal(kb.config.profiles.maya.name, 'Maya Lind', 'config is the house config, not a default read from the overlay dir')
    assert.equal(kb.present.voice, true, 'presence is the house presence')
    assert.equal(kb.houseRoot, path.join(dir, 'kb'))
    assert.equal(kb.overlayRoot, path.join(dir, 'kb', 'profiles', 'maya'))
    assert.equal(kb.tone, OVERLAY['kb/profiles/maya/tone.md'], "kb.tone is the overlay text, so default dials are the speaker's")
  } finally {
    cleanup(dir)
  }
})

test('resolveKb records a lock violation and keeps the house rule', () => {
  const dir = makeTmpProject({
    ...HOUSE,
    'kb/profiles/maya/lexicon.md': [
      '| ID | Avoid | Prefer | Why | Conf | Ev |',
      '|---|---|---|---|---|---|',
      '| L20 | game changer | fine actually | she likes it | confirmed | e1 |'
    ].join('\n')
  })
  try {
    const kb = resolveKb(path.join(dir, 'kb'), 'maya')
    assert.deepEqual(kb.lockViolations.map((v) => [v.id, v.file, v.line]),
      [['L20', path.posix.join('profiles', 'maya', 'lexicon.md'), 3]])
    assert.equal(kb.rules.find((r) => r.id === 'L20').cells.Prefer, '(cut)')
    assert.equal(kb.speakerOffset, null, 'no overlay tone.md means no dials line means no offset')
  } finally {
    cleanup(dir)
  }
})

test('resolveKb: an overlay with no V rule inherits the whole house voice', () => {
  const dir = makeTmpProject({ ...HOUSE, 'kb/profiles/maya/lexicon.md': '# Lexicon\n' })
  try {
    const kb = resolveKb(path.join(dir, 'kb'), 'maya')
    assert.deepEqual(kb.rules.filter((r) => r.id.startsWith('V')).map((r) => [r.id, r.origin]), [['V1', 'house'], ['V2', 'house']])
  } finally {
    cleanup(dir)
  }
})
