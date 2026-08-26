import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { loadKb } from '../scripts/lib/kb.mjs'
import { compileContext, estimateTokens } from '../scripts/compile-context.mjs'

const files = {
  'kb/config.yml': [
    'kb_version: 0.3.1',
    'profiles:',
    '  default:',
    '    name: "Acme"',
    '    primary_locale: en',
    '    locales: [en, cs]'
  ].join('\n'),
  'kb/voice.md': [
    '### V1 · Plainspoken `confirmed` ev: e1',
    '',
    '**Means:** Clarity above all.',
    '**Rules out:** fluffy metaphor, upsell language',
    '',
    '### V2 · Genuine `derived` ev: e1',
    '',
    '**Means:** We sound like a person.',
    '**Rules out:** corporate throat-clearing'
  ].join('\n'),
  'kb/tone.md': [
    '**Default dials:** warmth 3 · humor 1 · directness 3 · detail 2 · urgency 2 · formality 2',
    '',
    '### T-system-error/frustrated `confirmed` ev: e1',
    '',
    '**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2'
  ].join('\n'),
  'kb/lexicon.md': [
    '| ID | Avoid | Prefer | Why | Conf | Ev |',
    '|---|---|---|---|---|---|',
    '| L01 | leverage | use | jargon | derived | e1 |',
    '| L02 | utilize | use | jargon | confirmed | e1 |'
  ].join('\n'),
  'kb/mechanics.md': [
    '| ID | Rule | Pattern | Conf | Ev |',
    '|---|---|---|---|---|',
    '| M01 | no double spaces | \\s{2,} | confirmed | e1 |'
  ].join('\n'),
  'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V1, V2, L01, L02, M01, T-system-error/frustrated\n',
  'kb/channels/email.md': '### C01 · Subject lines `assumed`\n\n**Means:** Short.\n',
  'kb/locales/cs.md': '### X01 · Vykani `confirmed` ev: e1\n\n**Means:** Formal address.\n'
}

test('CONTEXT.md carries every section 4.8 element', () => {
  const dir = makeTmpProject(files)
  try {
    const kb = loadKb(path.join(dir, 'kb'))
    const md = compileContext(kb, {
      corpusStrings: ['We leverage it.', 'We leverage it again.', 'one  two'],
      generated: '2026-08-26T00:00:00.000Z'
    })

    assert.match(md, /GENERATED FILE/)
    assert.match(md, /not affiliated with or endorsed by Mailchimp/i)
    assert.match(md, /Acme/)
    assert.match(md, /0\.3\.1/)
    assert.match(md, /en, cs/)
    assert.match(md, /Plainspoken/)
    assert.match(md, /fluffy metaphor/)
    assert.match(md, /Default dials/)
    assert.match(md, /warmth 3/)
    assert.match(md, /leverage/)
    assert.match(md, /no double spaces/)
    assert.match(md, /humor/i)
    assert.match(md, /frustrated/)
    assert.match(md, /channels\/email\.md/)
    assert.match(md, /locales\/cs\.md/)
    assert.match(md, /tone\.md/)
  } finally {
    cleanup(dir)
  }
})

test('lexicon entries are ranked by corpus violations, not by id', () => {
  const dir = makeTmpProject(files)
  try {
    const kb = loadKb(path.join(dir, 'kb'))
    const md = compileContext(kb, {
      corpusStrings: ['leverage leverage leverage', 'utilize'],
      generated: '2026-08-26T00:00:00.000Z'
    })
    // Scope to the Lexicon table itself, not the whole document - either
    // term could legitimately appear elsewhere (a voice rule's "Rules out"
    // line, say) without that saying anything about rank.
    const start = md.indexOf('## Lexicon')
    const end = md.indexOf('##', start + 1)
    const lexiconSection = md.slice(start, end === -1 ? md.length : end)
    assert.ok(lexiconSection.indexOf('leverage') < lexiconSection.indexOf('utilize'),
      'the more-violated term comes first even though L02 is confirmed')
  } finally {
    cleanup(dir)
  }
})

test('the compiled card stays inside its token budget', () => {
  const dir = makeTmpProject(files)
  try {
    const md = compileContext(loadKb(path.join(dir, 'kb')), {
      corpusStrings: [],
      generated: '2026-08-26T00:00:00.000Z'
    })
    assert.ok(estimateTokens(md) < 900, `estimated ${estimateTokens(md)} tokens`)
  } finally {
    cleanup(dir)
  }
})

test('an empty knowledge base still compiles a valid card', () => {
  const dir = makeTmpProject({ 'kb/config.yml': 'kb_version: 0.1.0\n' })
  try {
    const md = compileContext(loadKb(path.join(dir, 'kb')), {
      corpusStrings: [], generated: '2026-08-26T00:00:00.000Z'
    })
    assert.match(md, /GENERATED FILE/)
    assert.match(md, /none yet/i)
  } finally {
    cleanup(dir)
  }
})

test('an empty knowledge base never prints a nonzero humor default dial', () => {
  // Gate 1 (kb.mjs interpolate()) forces humor 0 on every computed cell, so
  // a KB with no authored **Default dials:** line must never show the card
  // contradicting its own Humor gate section.
  const dir = makeTmpProject({ 'kb/config.yml': 'kb_version: 0.1.0\n' })
  try {
    const md = compileContext(loadKb(path.join(dir, 'kb')), {
      corpusStrings: [], generated: '2026-08-26T00:00:00.000Z'
    })
    const start = md.indexOf('## Default dials')
    const end = md.indexOf('##', start + 1)
    const dialsSection = md.slice(start, end === -1 ? md.length : end)
    assert.match(dialsSection, /humor 0\b/)
  } finally {
    cleanup(dir)
  }
})
