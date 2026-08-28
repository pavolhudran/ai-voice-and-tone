import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, cpSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { parseYaml } from '../scripts/lib/yaml.mjs'
import { loadKb, parseVectors, STATES, CONTEXTS, DIALS } from '../scripts/lib/kb.mjs'
import { validateKb } from '../scripts/validate.mjs'
import { compileContext } from '../scripts/compile-context.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templates = path.join(root, 'templates', 'kb')

test('every file the spec section 4.2 layout names is present', () => {
  const expected = [
    'config.yml', 'CONTEXT.md', 'voice.md', 'tone.md', 'audience.md', 'lexicon.md',
    'mechanics.md', 'CHANGELOG.md', 'gitignore',
    path.join('evidence', 'ledger.md'), path.join('evidence', 'conflicts.md'),
    path.join('evidence', 'fingerprint.json'),
    path.join('examples', 'approved.md'), path.join('examples', 'rejected.md'),
    path.join('examples', 'pairs.md'),
    path.join('channels', '_template.md'), path.join('locales', '_template.md')
  ]
  for (const rel of expected) {
    assert.ok(existsSync(path.join(templates, rel)), `templates/kb/${rel} is missing`)
  }
})

test('the config template parses and carries the spec thresholds', () => {
  const config = parseYaml(readFileSync(path.join(templates, 'config.yml'), 'utf8'))
  assert.equal(config.version, 1)
  assert.equal(config.thresholds.corroboration, 2)
  assert.equal(config.thresholds.derived_min_samples, 5)
  assert.equal(config.thresholds.stale_months, 9)
  assert.ok(config.scan.exclude.includes('node_modules/**'))
})

test('the tone template ships a complete vector table for every state and context', () => {
  const vectors = parseVectors(readFileSync(path.join(templates, 'tone.md'), 'utf8'))
  for (const state of STATES) {
    assert.ok(vectors.states[state], `no state vector for ${state}`)
    for (const dial of DIALS) {
      assert.equal(typeof vectors.states[state][dial], 'number', `${state}.${dial}`)
    }
  }
  for (const context of CONTEXTS) {
    assert.ok(vectors.contexts[context], `no context offset for ${context}`)
    for (const dial of DIALS) {
      assert.equal(typeof vectors.contexts[context][dial], 'number', `${context}.${dial}`)
    }
  }
})

test('the three humor-zero states carry humor 0 in the shipped vectors', () => {
  const vectors = parseVectors(readFileSync(path.join(templates, 'tone.md'), 'utf8'))
  for (const state of ['frustrated', 'anxious-at-risk', 'disappointed-leaving']) {
    assert.equal(vectors.states[state].humor, 0, `${state} must ship with humor 0`)
  }
})

test('a knowledge base built from the templates validates clean', () => {
  const dir = makeTmpProject({})
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    cpSync(templates, kbRoot, { recursive: true })
    const report = validateKb(loadKb(kbRoot))
    assert.equal(report.errors, 0, JSON.stringify(report.findings, null, 2))
    assert.equal(report.warnings, 0, JSON.stringify(report.findings, null, 2))
  } finally {
    cleanup(dir)
  }
})

test('CONTEXT.md compiles from the templates and says it is generated', () => {
  const dir = makeTmpProject({})
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    cpSync(templates, kbRoot, { recursive: true })
    const md = compileContext(loadKb(kbRoot), {
      corpusStrings: [], generated: '2026-08-26T00:00:00.000Z'
    })
    assert.match(md, /GENERATED FILE/)
    assert.match(md, /not affiliated with or endorsed by Mailchimp/i)
  } finally {
    cleanup(dir)
  }
})

test('the shipped CONTEXT.md template refuses to be hand-edited', () => {
  const md = readFileSync(path.join(templates, 'CONTEXT.md'), 'utf8')
  assert.match(md, /GENERATED FILE/)
  assert.match(md, /voice-and-tone:sync/)
})

test('the KB gitignore excludes sources and the extract cache but not the index', () => {
  const body = readFileSync(path.join(templates, 'gitignore'), 'utf8')
  assert.match(body, /^sources\/$/m)
  assert.match(body, /^\.cache\/$/m)
  assert.ok(!/sources\.json/.test(body), 'the index must stay committed')
})

test('the template config declares a register that reproduces current behaviour', () => {
  const config = parseYaml(readFileSync(path.join(templates, 'config.yml'), 'utf8'))
  assert.ok(Array.isArray(config.sources))
  assert.equal(config.sources[0].kind, 'project')
  assert.ok(config.sources.some((s) => s.kind === 'inbox'))
})
