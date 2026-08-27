import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs'
import { gatherCorpus } from '../scripts/lib/corpus.mjs'
import {
  loadRegister, resolveEntry, resolveRegister, expandHome, nextRegisterId
} from '../scripts/lib/register.mjs'

const ctxFor = (dir, config = DEFAULT_CONFIG) => ({
  projectRoot: dir,
  kbRoot: path.join(dir, '.voice-and-tone'),
  config,
  profileName: 'default'
})

test('a config with no sources key synthesises a project entry from scan', () => {
  const config = { ...DEFAULT_CONFIG, scan: { include: ['docs/**/*.md'], exclude: ['dist/**'] } }
  const register = loadRegister(config)

  assert.equal(register.length, 1)
  assert.equal(register[0].kind, 'project')
  assert.equal(register[0].id, 's01')
  assert.deepEqual(register[0].include, ['docs/**/*.md'])
  assert.deepEqual(register[0].exclude, ['dist/**'])
})

test('an explicit register is returned as written, in order', () => {
  const config = {
    ...DEFAULT_CONFIG,
    sources: [
      { id: 's01', kind: 'project', include: ['README.md'] },
      { id: 's02', kind: 'inbox', path: 'sources/' },
      { id: 's03', kind: 'url', url: 'https://acme.com/about' }
    ]
  }
  assert.deepEqual(
    loadRegister(config).map((e) => e.kind),
    ['project', 'inbox', 'url']
  )
})

test('a project entry resolves against the project root, as today', () => {
  const dir = makeTmpProject({ 'docs/a.md': 'Copy.', 'dist/b.md': 'Built.' })
  try {
    const entry = { id: 's01', kind: 'project', include: ['docs/**/*.md'], exclude: ['dist/**'] }
    const resolved = resolveEntry(entry, ctxFor(dir))

    assert.deepEqual(resolved.files.map((f) => f.rel), ['docs/a.md'])
    assert.equal(resolved.files[0].format, 'markdown')
    assert.equal(resolved.missing, false)
  } finally {
    cleanup(dir)
  }
})

test('an inbox entry resolves under the KB and reports paths relative to it', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/sources/newsletters/jan.txt': 'A newsletter.',
    '.voice-and-tone/sources/brand.docx': 'container'
  })
  try {
    const resolved = resolveEntry({ id: 's02', kind: 'inbox', path: 'sources/' }, ctxFor(dir))

    assert.deepEqual(
      resolved.files.map((f) => f.origin).sort(),
      ['sources/brand.docx', 'sources/newsletters/jan.txt']
    )
    assert.deepEqual(resolved.files.map((f) => f.format).sort(), ['docx', 'text'])
  } finally {
    cleanup(dir)
  }
})

test('a local entry reaches outside the project root, which globs cannot', () => {
  const outside = makeTmpProject({ 'brand/guide.md': 'Our voice.' })
  const dir = makeTmpProject({})
  try {
    const entry = { id: 's03', kind: 'local', path: path.join(outside, 'brand') }
    const resolved = resolveEntry(entry, ctxFor(dir))

    assert.equal(resolved.files.length, 1)
    assert.equal(resolved.files[0].origin, path.join(outside, 'brand', 'guide.md'))
    assert.equal(resolved.missing, false)
  } finally {
    cleanup(outside)
    cleanup(dir)
  }
})

test('a local entry naming a single file resolves to that file', () => {
  const outside = makeTmpProject({ 'deck.md': 'Slides.' })
  const dir = makeTmpProject({})
  try {
    const resolved = resolveEntry(
      { id: 's03', kind: 'local', path: path.join(outside, 'deck.md') },
      ctxFor(dir)
    )
    assert.equal(resolved.files.length, 1)
    assert.equal(resolved.missing, false)
  } finally {
    cleanup(outside)
    cleanup(dir)
  }
})

test('an absent local path is missing, not an error - the ordinary state on a fresh clone', () => {
  const dir = makeTmpProject({})
  try {
    const resolved = resolveEntry(
      { id: 's03', kind: 'local', path: path.join(dir, 'nope', 'gone.pdf') },
      ctxFor(dir)
    )
    assert.equal(resolved.missing, true)
    assert.deepEqual(resolved.files, [])
  } finally {
    cleanup(dir)
  }
})

test('unsupported extensions under a source are skipped with their extension', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/sources/a.md': 'Copy.',
    '.voice-and-tone/sources/logo.sketch': 'nope'
  })
  try {
    const resolved = resolveEntry({ id: 's02', kind: 'inbox', path: 'sources/' }, ctxFor(dir))
    assert.deepEqual(resolved.files.map((f) => f.origin), ['sources/a.md'])
    assert.deepEqual(resolved.skipped, [{ origin: 'sources/logo.sketch', ext: '.sketch', reason: 'no-extractor' }])
  } finally {
    cleanup(dir)
  }
})

test('a url entry resolves to no files and carries its url', () => {
  const dir = makeTmpProject({})
  try {
    const resolved = resolveEntry(
      { id: 's04', kind: 'url', url: 'https://acme.com/about' },
      ctxFor(dir)
    )
    assert.deepEqual(resolved.files, [])
    assert.equal(resolved.url, 'https://acme.com/about')
  } finally {
    cleanup(dir)
  }
})

test('locale attribution works the same for sources as for project files', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/sources/cs/newsletter.txt': 'Ahoj.',
    '.voice-and-tone/sources/en/newsletter.txt': 'Hello.'
  })
  try {
    const config = {
      ...DEFAULT_CONFIG,
      profiles: { default: { name: 'Acme', primary_locale: 'en', locales: ['en', 'cs'] } }
    }
    const resolved = resolveEntry(
      { id: 's02', kind: 'inbox', path: 'sources/' },
      ctxFor(dir, config)
    )
    const byOrigin = Object.fromEntries(resolved.files.map((f) => [f.origin, f.locale]))
    assert.equal(byOrigin['sources/cs/newsletter.txt'], 'cs')
    assert.equal(byOrigin['sources/en/newsletter.txt'], 'en')
  } finally {
    cleanup(dir)
  }
})

test('a tilde path expands against the home directory without a shell', () => {
  assert.equal(expandHome('~/Brand/deck.pptx'), path.join(os.homedir(), 'Brand/deck.pptx'))
  assert.equal(expandHome('~'), os.homedir())
  assert.equal(expandHome('/absolute/path'), '/absolute/path')
  assert.equal(expandHome('~notauser/x'), '~notauser/x', 'only a bare ~ prefix expands')
})

test('register ids are monotonic and never reuse a freed number', () => {
  assert.equal(nextRegisterId([]), 's01')
  assert.equal(nextRegisterId([{ id: 's01' }, { id: 's02' }]), 's03')
  assert.equal(nextRegisterId([{ id: 's01' }, { id: 's09' }]), 's10')
  assert.equal(nextRegisterId([{ id: 's99' }]), 's100')
})

test('resolveRegister returns one resolution per entry, in register order', () => {
  const dir = makeTmpProject({ 'docs/a.md': 'Copy.', '.voice-and-tone/sources/b.md': 'More.' })
  try {
    const config = {
      ...DEFAULT_CONFIG,
      sources: [
        { id: 's01', kind: 'project', include: ['docs/**/*.md'], exclude: [] },
        { id: 's02', kind: 'inbox', path: 'sources/' }
      ]
    }
    const resolved = resolveRegister(loadRegister(config), ctxFor(dir, config))
    assert.deepEqual(resolved.map((r) => r.id), ['s01', 's02'])
    assert.deepEqual(resolved.map((r) => r.files.length), [1, 1])
  } finally {
    cleanup(dir)
  }
})

test('missing distinguishes an absent path from one that exists but is empty', () => {
  const dir = makeTmpProject({ 'empty-dir/.keep': '' })
  try {
    const missing = resolveEntry(
      { id: 's05', kind: 'local', path: path.join(dir, 'nowhere') },
      ctxFor(dir)
    )
    assert.equal(missing.missing, true)
    assert.equal(missing.empty, false)

    // A directory with no matching files at all (project entry, restrictive
    // include) exists but is genuinely empty of anything this entry can see.
    const emptyProject = resolveEntry(
      { id: 's06', kind: 'project', include: ['nomatch/**/*.md'], exclude: [] },
      ctxFor(dir)
    )
    assert.equal(emptyProject.missing, false)
    assert.equal(emptyProject.empty, true)
  } finally {
    cleanup(dir)
  }
})

// A later task folds register skips into the same manifest.skipped array
// gatherCorpus populates. That only works if the two producers agree on the
// vocabulary word for "no extractor at all" - this test pins the agreement
// between the two producers directly, on the very same file, rather than
// each asserting its own shape in isolation (which is exactly what let the
// two shapes drift apart in the first place).
test('a register skip and a gatherCorpus skip agree on the no-extractor reason', () => {
  const dir = makeTmpProject({
    'content/notes.md': 'We write like humans.',
    'content/logo.fig': 'the extension is what matters here'
  })
  try {
    const config = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*'], exclude: [] } }

    const corpusSkipped = []
    gatherCorpus(dir, config, 'default', [], corpusSkipped)
    const corpusSkip = corpusSkipped.find((s) => s.rel === 'content/logo.fig')

    const registerResolved = resolveEntry(
      { id: 's01', kind: 'project', include: config.scan.include, exclude: config.scan.exclude },
      ctxFor(dir, config)
    )
    const registerSkip = registerResolved.skipped.find((s) => s.origin === 'content/logo.fig')

    assert.ok(corpusSkip, 'gatherCorpus must have skipped the .fig file')
    assert.ok(registerSkip, 'the register must have skipped the .fig file')
    assert.equal(registerSkip.reason, corpusSkip.reason)
    assert.equal(registerSkip.reason, 'no-extractor')
    assert.equal(registerSkip.ext, corpusSkip.ext)
  } finally {
    cleanup(dir)
  }
})
