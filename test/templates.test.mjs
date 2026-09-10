import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, cpSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { parseYaml } from '../scripts/lib/yaml.mjs'
import { loadKb, resolveKb, parseVectors, STATES, CONTEXTS, DIALS } from '../scripts/lib/kb.mjs'
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
    path.join('channels', '_template.md'), path.join('locales', '_template.md'),
    path.join('profiles', '_template', 'voice.md'), path.join('profiles', '_template', 'tone.md'),
    path.join('profiles', '_template', 'lexicon.md'), path.join('profiles', '_template', 'mechanics.md'),
    path.join('profiles', '_template', 'audience.md'), path.join('profiles', '_template', 'channels', '_template.md'),
    path.join('profiles', '_template', 'examples', 'approved.md'), path.join('profiles', '_template', 'examples', 'rejected.md'),
    path.join('profiles', '_template', 'examples', 'pairs.md'), path.join('profiles', '_template', 'sources', 'README.md')
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
  // F3: the template no longer ships a `scan:` key at all - the `project`
  // register entry IS the scan now, and shipping both (with identical globs)
  // made scan.include an inert decoy that CONTEXT.md's compiler used to read
  // while the fingerprint read the register instead. `scan:` survives only
  // as loadRegister's migration fallback for a config that predates
  // `sources:` entirely (config.mjs's DEFAULT_CONFIG, exercised in
  // config.test.mjs and migration.test.mjs).
  assert.equal(config.scan, undefined, 'the template must not ship an inert scan: block')
  const project = config.sources.find((s) => s.kind === 'project')
  assert.ok(project.exclude.includes('node_modules/**'))
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

test('the KB gitignore excludes sources but not the index', () => {
  const body = readFileSync(path.join(templates, 'gitignore'), 'utf8')
  assert.match(body, /^sources\/$/m)
  // F6: the extract cache was removed (write-only, nothing ever read it) -
  // there is no .cache/ directory left for a KB to gitignore.
  assert.ok(!/\.cache/.test(body), 'no extract cache is written any more, so nothing should ignore it')
  assert.ok(!/sources\.json/.test(body), 'the index must stay committed')
})

test('the template config declares a register that reproduces current behaviour', () => {
  const config = parseYaml(readFileSync(path.join(templates, 'config.yml'), 'utf8'))
  assert.ok(Array.isArray(config.sources))
  assert.equal(config.sources[0].kind, 'project')
  assert.ok(config.sources.some((s) => s.kind === 'inbox'))
})

test('the template inbox entry excludes its own shipped README from the corpus', () => {
  const config = parseYaml(readFileSync(path.join(templates, 'config.yml'), 'utf8'))
  const inbox = config.sources.find((s) => s.kind === 'inbox')
  assert.ok(inbox.exclude?.includes('README.md'), 'the inbox must exclude its own placeholder by default')
})

test('the overlay template ships no vector tables and no rule, and a copied overlay validates clean as a speaker', () => {
  const tone = readFileSync(path.join(templates, 'profiles', '_template', 'tone.md'), 'utf8')
  assert.ok(!tone.includes('| State |'), 'vectors are inherited; a copied table would drift')
  assert.ok(!tone.includes('| Context |'))
  const dir = makeTmpProject({})
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    cpSync(templates, kbRoot, { recursive: true })
    cpSync(path.join(templates, 'profiles', '_template'), path.join(kbRoot, 'profiles', 'maya'), { recursive: true })
    writeFileSync(path.join(kbRoot, 'config.yml'),
      readFileSync(path.join(kbRoot, 'config.yml'), 'utf8').replace('profiles:\n', 'profiles:\n  maya:\n    name: "Maya Lind"\n'))
    const report = validateKb(resolveKb(kbRoot, 'maya'))
    assert.equal(report.errors, 0, JSON.stringify(report.findings, null, 2))
    assert.deepEqual(report.findings.map((f) => f.code), ['W_SPEAKER_NO_VOICE'], 'the one expected warning on a fresh overlay')
  } finally {
    cleanup(dir)
  }
})

test('the gitignore template ignores every speaker inbox and keeps speaker cards', () => {
  const ignore = readFileSync(path.join(templates, 'gitignore'), 'utf8')
  assert.ok(ignore.includes('profiles/*/sources/'))
  assert.ok(!/^[^#\n]*CONTEXT\.md/m.test(ignore), 'no uncommented line may ignore a card')
})

test('the config template documents locks', () => {
  assert.match(readFileSync(path.join(templates, 'config.yml'), 'utf8'), /^# ?locks:/m)
})
