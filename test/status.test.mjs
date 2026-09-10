import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync, readFileSync, existsSync, cpSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATUS = path.join(root, 'scripts', 'status.mjs')
const NOW = '2026-08-28T00:00:00.000Z'

const CONFIG = [
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

function project () {
  return makeTmpProject({
    'content/a.md': '# Hello\n\nWe ship things. You will like it.\n',
    '.voice-and-tone/config.yml': CONFIG,
    '.voice-and-tone/voice.md': '# Voice\n',
    '.voice-and-tone/tone.md': '# Tone\n'
  })
}

function run (dir, args = []) {
  return execFileSync(process.execPath, [STATUS, '--root', dir, '--now', NOW, ...args], { encoding: 'utf8' })
}

/** Every file under a directory, as path -> {mtimeMs, size}. */
function snapshot (dir, out = {}, base = dir) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) snapshot(abs, out, base)
    else out[path.relative(base, abs)] = { mtimeMs: statSync(abs).mtimeMs, size: statSync(abs).size }
  }
  return out
}

test('a default run does not write a single byte under the knowledge base', () => {
  // This is what makes "observability observes, it never changes what it
  // observes" a property rather than a promise. A rule written in prose is one
  // a model can reason its way around; a test over mtimes cannot be argued with.
  const dir = project()
  try {
    const before = snapshot(path.join(dir, '.voice-and-tone'))
    run(dir)
    const after = snapshot(path.join(dir, '.voice-and-tone'))
    assert.deepEqual(after, before, 'a read-only run must leave every file byte- and mtime-identical')
  } finally {
    cleanup(dir)
  }
})

test('--json emits a single parseable object carrying every ring', () => {
  const dir = project()
  try {
    const state = JSON.parse(run(dir, ['--json']))
    const rings = [
      'generated', 'kb', 'stage', 'integrity', 'freshness', 'coverage',
      'rules', 'evidence', 'drift', 'sources', 'corpus', 'settings', 'gaps'
    ]
    for (const key of rings) assert.ok(key in state, `--json omits ${key}`)
    assert.equal(state.generated, NOW, '--now is honoured so output is reproducible')
  } finally {
    cleanup(dir)
  }
})

test('every panel name renders, and stdout stays ASCII on a non-ASCII corpus', () => {
  const dir = makeTmpProject({
    'content/a.md': '# Naplánováno\n\nVaše kampaň je naplánovaná.\n',
    '.voice-and-tone/config.yml': CONFIG.replace('"Acme"', '"Značka"'),
    '.voice-and-tone/voice.md': '# Voice\n'
  })
  try {
    const names = [
      'pipeline', 'integrity', 'coverage', 'rules', 'drift',
      'sources', 'evidence', 'settings', 'missing', 'all'
    ]
    for (const name of names) {
      const out = run(dir, ['--panel', name])
      // eslint-disable-next-line no-control-regex
      assert.ok(!/[^\x00-\x7F]/.test(out), `panel ${name} leaked a non-ASCII character`)
      assert.ok(out.length > 0)
    }
  } finally {
    cleanup(dir)
  }
})

test('an unknown panel exits 1 and lists the valid names', () => {
  const dir = project()
  try {
    assert.throws(
      () => run(dir, ['--panel', 'nope']),
      (error) => {
        assert.equal(error.status, 1)
        assert.match(String(error.stderr), /unknown panel/)
        assert.match(String(error.stderr), /coverage/)
        return true
      }
    )
  } finally {
    cleanup(dir)
  }
})

test('status exits 0 even when the knowledge base has blocking gaps', () => {
  // It observes; it does not gate. A non-zero exit would make it unusable in
  // any script that merely wants to print the state.
  const dir = makeTmpProject({ 'content/a.md': '# Hi\n' })
  try {
    const out = run(dir)
    assert.match(out, /no knowledge base/)
  } finally {
    cleanup(dir)
  }
})

test('--refresh writes the manifest and fingerprint and leaves the baseline untouched', () => {
  const dir = project()
  const kb = path.join(dir, '.voice-and-tone')
  try {
    execFileSync(
      process.execPath,
      [path.join(root, 'scripts', 'fingerprint.mjs'), '--root', dir, '--now', '2026-01-01T00:00:00.000Z', '--set-baseline'],
      { encoding: 'utf8' }
    )
    const before = JSON.parse(readFileSync(path.join(kb, 'evidence', 'fingerprint.json'), 'utf8')).baseline
    assert.ok(before, 'the baseline must exist for this test to mean anything')

    run(dir, ['--refresh'])

    const after = JSON.parse(readFileSync(path.join(kb, 'evidence', 'fingerprint.json'), 'utf8')).baseline
    assert.deepEqual(after, before, '--refresh must never move the baseline; a refreshed baseline shows zero drift by construction')
    assert.ok(existsSync(path.join(kb, 'evidence', 'manifest.json')))
  } finally {
    cleanup(dir)
  }
})

test('--refresh does not rewrite the source index', () => {
  const dir = project()
  const kb = path.join(dir, '.voice-and-tone')
  try {
    run(dir, ['--refresh'])
    assert.ok(!existsSync(path.join(kb, 'evidence', 'sources.json')), '--refresh must never ingest')
  } finally {
    cleanup(dir)
  }
})

test('--width is clamped rather than rejected', () => {
  const dir = project()
  try {
    for (const line of run(dir, ['--width', '200']).split('\n')) assert.ok(line.length <= 120)
    for (const line of run(dir, ['--width', '10']).split('\n')) assert.ok(line.length <= 60)
  } finally {
    cleanup(dir)
  }
})

test('--locale scopes drift and corpus to one locale', () => {
  const dir = project()
  try {
    const state = JSON.parse(run(dir, ['--json', '--locale', 'zz']))
    assert.deepEqual(state.drift.byLocale, {}, 'a locale with no data yields an empty map, not every locale')
  } finally {
    cleanup(dir)
  }
})

test('status.mjs never spawns a process', () => {
  const source = readFileSync(STATUS, 'utf8')
  assert.ok(!/child_process|execSync|execFileSync|spawnSync/.test(source))
})

// --- speakers (spec 2026-09-10 §9) -----------------------------------------

const FIXTURE = path.join(root, 'test', 'fixtures', 'house-with-speakers')

function fixtureProject () {
  const dir = makeTmpProject({ 'content/a.md': '# A\n\nWe leverage it.\n' })
  cpSync(FIXTURE, path.join(dir, '.voice-and-tone'), { recursive: true })
  return dir
}

test('--profile <speaker> renders that speaker, and --artifact lands on a per-speaker path', () => {
  const dir = fixtureProject()
  try {
    const screen = run(dir, ['--profile', 'maya'])
    assert.match(screen, /maya \(speaker\)/)
    run(dir, ['--profile', 'maya', '--artifact'])
    assert.ok(existsSync(path.join(dir, '.voice-and-tone', '.drafts', 'status-maya.html')))
    assert.ok(!existsSync(path.join(dir, '.voice-and-tone', '.drafts', 'status.html')))
    run(dir, ['--artifact'])
    assert.ok(existsSync(path.join(dir, '.voice-and-tone', '.drafts', 'status.html')))
  } finally {
    cleanup(dir)
  }
})

test('--refresh --profile <speaker> writes only under the overlay', () => {
  const dir = fixtureProject()
  try {
    run(dir, ['--profile', 'maya', '--refresh'])
    assert.ok(existsSync(path.join(dir, '.voice-and-tone', 'profiles', 'maya', 'evidence', 'manifest.json')))
    assert.ok(existsSync(path.join(dir, '.voice-and-tone', 'profiles', 'maya', 'evidence', 'fingerprint.json')))
    assert.ok(!existsSync(path.join(dir, '.voice-and-tone', 'evidence', 'manifest.json')))
  } finally {
    cleanup(dir)
  }
})

test('--json in the house view carries the speakers block and G17 for the speaker with no voice', () => {
  const dir = fixtureProject()
  try {
    const state = JSON.parse(run(dir, ['--json']))
    assert.equal(state.kb.role, 'house')
    assert.deepEqual(state.speakers.map((s) => s.slug), ['jonas', 'maya'])
    assert.ok(state.gaps.some((g) => g.id === 'G17' && g.what.startsWith('[jonas]')))
  } finally {
    cleanup(dir)
  }
})

test('--panel speakers is accepted', () => {
  const dir = fixtureProject()
  try {
    assert.match(run(dir, ['--panel', 'speakers']), /SPEAKERS  2 declared/)
  } finally {
    cleanup(dir)
  }
})
