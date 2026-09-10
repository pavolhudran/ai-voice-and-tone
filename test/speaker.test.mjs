import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, readFileSync, cpSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { loadIndex } from '../scripts/lib/sourceindex.mjs'
import { runSpeakerAdd, runSpeakerList, runSpeakerRemove, validateSlug, declareProfile, undeclareProfile, unregisterProfileSources } from '../scripts/speaker.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = path.join(root, 'test', 'fixtures', 'house-with-speakers')
const NOW = '2026-09-10T00:00:00.000Z'

const HOUSE_CONFIG = [
  '# a comment that must survive',
  'version: 1',
  'profiles:',
  '  default:',
  '    name: "Acme"',
  '    primary_locale: en',
  '    locales: [en, de]',
  '# sources follow',
  'sources:',
  '  - id: s01',
  '    kind: project',
  '    include: ["content/**/*.md"]',
  '    exclude: []',
  'thresholds:',
  '  corroboration: 2',
  ''
].join('\n')

function project () {
  const dir = makeTmpProject({ '.voice-and-tone/config.yml': HOUSE_CONFIG, '.voice-and-tone/voice.md': '# V\n', '.voice-and-tone/tone.md': '# T\n' })
  const kbRoot = path.join(dir, '.voice-and-tone')
  return { dir, kbRoot, ctx: { projectRoot: dir, kbRoot, config: loadConfig(kbRoot), now: NOW } }
}

test('validateSlug accepts a directory-safe slug and refuses the house and junk', () => {
  assert.doesNotThrow(() => validateSlug('maya'))
  assert.doesNotThrow(() => validateSlug('acme-support-2'))
  for (const bad of ['default', 'Maya', '_x', '', 'a b', '1st', null]) assert.throws(() => validateSlug(bad), bad === null ? undefined : new RegExp(String(bad).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('add scaffolds the overlay from the template, declares the profile by text, and registers a relative inbox', () => {
  const { dir, kbRoot, ctx } = project()
  try {
    const result = runSpeakerAdd(ctx, { slug: 'maya', name: 'Maya Lind', primaryLocale: 'de', locales: ['de'] })
    assert.equal(result.registerId, 's02')
    for (const f of ['voice.md', 'tone.md', 'lexicon.md', 'mechanics.md', 'audience.md', 'sources/README.md', 'examples/approved.md']) {
      assert.ok(existsSync(path.join(kbRoot, 'profiles', 'maya', f)), `${f} missing from the scaffold`)
    }
    const raw = readFileSync(path.join(kbRoot, 'config.yml'), 'utf8')
    assert.ok(raw.includes('# a comment that must survive'), 'text editing keeps comments')
    assert.ok(raw.includes('# sources follow'))
    const config = loadConfig(kbRoot)
    assert.deepEqual(config.profiles.maya, { name: 'Maya Lind', primary_locale: 'de', locales: ['de'] })
    assert.deepEqual(config.profiles.default.locales, ['en', 'de'], 'the house is untouched')
    const inbox = config.sources.find((s) => s.id === 's02')
    assert.equal(inbox.kind, 'inbox')
    assert.equal(inbox.path, 'profiles/maya/sources/')
    assert.equal(inbox.profile, 'maya')
    assert.deepEqual(inbox.exclude, ['README.md'])
    assert.throws(() => runSpeakerAdd({ ...ctx, config }, { slug: 'maya', name: 'Again' }), /already declared/)
  } finally {
    cleanup(dir)
  }
})

test('add without a name, or with a bad slug, writes nothing', () => {
  const { dir, kbRoot, ctx } = project()
  try {
    const before = readFileSync(path.join(kbRoot, 'config.yml'), 'utf8')
    assert.throws(() => runSpeakerAdd(ctx, { slug: 'maya', name: '' }), /--name/)
    assert.throws(() => runSpeakerAdd(ctx, { slug: 'Maya', name: 'x' }), /slug/)
    assert.equal(readFileSync(path.join(kbRoot, 'config.yml'), 'utf8'), before)
    assert.ok(!existsSync(path.join(kbRoot, 'profiles')))
  } finally {
    cleanup(dir)
  }
})

test('list reports every declared speaker with the status numbers', () => {
  const dir = makeTmpProject({ 'content/a.md': '# A\n' })
  try {
    cpSync(FIXTURE, path.join(dir, '.voice-and-tone'), { recursive: true })
    const kbRoot = path.join(dir, '.voice-and-tone')
    const { speakers, locks } = runSpeakerList({ projectRoot: dir, kbRoot, config: loadConfig(kbRoot), now: NOW })
    assert.deepEqual(speakers.map((s) => s.slug), ['jonas', 'maya'])
    assert.equal(speakers[1].voiceRules, 1)
    assert.deepEqual(locks, ['V2', 'L20'])
  } finally {
    cleanup(dir)
  }
})

test('remove --dry-run names the overlay, register, index and ledger entries and the rules to reopen, and writes nothing', () => {
  const dir = makeTmpProject({ 'content/a.md': '# A\n' })
  try {
    cpSync(FIXTURE, path.join(dir, '.voice-and-tone'), { recursive: true })
    const kbRoot = path.join(dir, '.voice-and-tone')
    // give maya a ledger entry with a Profile field, an index entry, and a register entry
    writeFileSync(path.join(kbRoot, 'evidence', 'ledger.md'), readFileSync(path.join(kbRoot, 'evidence', 'ledger.md'), 'utf8') +
      '\n### e2 — 2026-09-10 — source\n\n**Type:** tone doc\n**Profile:** maya\n**Produced:** V3, L30\n')
    writeFileSync(path.join(kbRoot, 'evidence', 'sources.json'), JSON.stringify({ generated: NOW, sources: [
      { id: 'f001', sha256: 'a', kind: 'file', from: 's02', origin: 'profiles/maya/sources/x.md', format: 'markdown', locale: 'en', tier: 'script', status: 'used', profile: 'maya', stats: { strings: 1, words: 1, sentences: 1 }, produced: ['T-social/focused'] },
      { id: 'f002', sha256: 'b', kind: 'file', from: 's01', origin: 'content/a.md', format: 'markdown', locale: 'en', tier: 'script', status: 'used', stats: { strings: 1, words: 1, sentences: 1 }, produced: [] }
    ] }))
    // inside the sources: sequence, not after the thresholds: block that follows it
    writeFileSync(path.join(kbRoot, 'config.yml'), readFileSync(path.join(kbRoot, 'config.yml'), 'utf8')
      .replace('thresholds:', '  - id: s02\n    kind: inbox\n    path: "profiles/maya/sources/"\n    profile: maya\nthresholds:'))
    const ctx = { projectRoot: dir, kbRoot, config: loadConfig(kbRoot), now: NOW }
    const before = readFileSync(path.join(kbRoot, 'config.yml'), 'utf8')
    const plan = runSpeakerRemove(ctx, { slug: 'maya', dryRun: true })
    assert.equal(plan.removed, false)
    assert.ok(plan.overlay.endsWith(path.join('profiles', 'maya')))
    assert.deepEqual(plan.registerEntries, ['s02'])
    assert.deepEqual(plan.indexEntries.map((e) => e.id), ['f001'])
    assert.deepEqual(plan.ledgerEntries.map((e) => e.id), ['e2'])
    assert.deepEqual(plan.reopen.sort(), ['L30', 'T-social/focused', 'V3'])
    assert.equal(readFileSync(path.join(kbRoot, 'config.yml'), 'utf8'), before, 'dry run writes nothing')
    assert.ok(existsSync(plan.overlay))

    const done = runSpeakerRemove(ctx, { slug: 'maya', dryRun: false })
    assert.equal(done.removed, true)
    assert.ok(!existsSync(path.join(kbRoot, 'profiles', 'maya')))
    const config = loadConfig(kbRoot)
    assert.equal(config.profiles.maya, undefined)
    assert.ok(config.profiles.jonas, 'the other speaker stays')
    assert.ok(!config.sources.some((s) => s.profile === 'maya'))
    assert.ok(config.sources.some((s) => s.id === 's01'), 'the house entry stays')
    assert.deepEqual(loadIndex(kbRoot).sources.map((s) => s.id), ['f002'])
    assert.ok(readFileSync(path.join(kbRoot, 'evidence', 'ledger.md'), 'utf8').includes('### e2'), 'evidence is never deleted')
    assert.throws(() => runSpeakerRemove({ ...ctx, config }, { slug: 'maya' }), /no speaker maya/)
  } finally {
    cleanup(dir)
  }
})

test('the text editors round-trip a profile and its sources without touching anything else', () => {
  const { dir, kbRoot } = project()
  try {
    declareProfile(kbRoot, { slug: 'x', name: 'X' })
    declareProfile(kbRoot, { slug: 'y', name: 'Y', primaryLocale: 'cs', locales: ['cs', 'en'] })
    let config = loadConfig(kbRoot)
    assert.deepEqual(Object.keys(config.profiles), ['default', 'x', 'y'])
    assert.equal(undeclareProfile(kbRoot, 'x'), true)
    assert.equal(undeclareProfile(kbRoot, 'x'), false)
    config = loadConfig(kbRoot)
    assert.deepEqual(Object.keys(config.profiles), ['default', 'y'])
    assert.deepEqual(config.profiles.y.locales, ['cs', 'en'])
    assert.deepEqual(unregisterProfileSources(kbRoot, 'nobody'), [])
    assert.ok(readFileSync(path.join(kbRoot, 'config.yml'), 'utf8').includes('# a comment that must survive'))
  } finally {
    cleanup(dir)
  }
})

test('the CLI adds, lists, and removes, and prints ASCII only', () => {
  const { dir, kbRoot } = project()
  try {
    const SCRIPT = path.join(root, 'scripts', 'speaker.mjs')
    const run = (args) => execFileSync(process.execPath, [SCRIPT, '--root', dir, '--now', NOW, ...args], { encoding: 'utf8' })
    const added = run(['--add', 'maya', '--name', 'Maya Lind', '--locale', 'de'])
    assert.match(added, /speaker: added maya/)
    assert.match(added, /registered inbox s02/)
    assert.match(run(['--list']), /maya\s+Maya Lind/)
    assert.match(run(['--remove', 'maya', '--dry-run']), /dry run - nothing written/)
    assert.ok(existsSync(path.join(kbRoot, 'profiles', 'maya')))
    assert.match(run(['--remove', 'maya']), /speaker: removed maya/)
    assert.ok(!existsSync(path.join(kbRoot, 'profiles', 'maya')))
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[^\x00-\x7F]/.test(added + run(['--list'])))
  } finally {
    cleanup(dir)
  }
})
