import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { DEFAULT_CONFIG, loadConfig } from '../scripts/lib/config.mjs'
import { gatherCorpus, gatherAll } from '../scripts/lib/corpus.mjs'
import { formatFor } from '../scripts/lib/extract.mjs'
import { saveIndex } from '../scripts/lib/sourceindex.mjs'
import { statsFor } from '../scripts/lib/metrics.mjs'

const config = {
  ...DEFAULT_CONFIG,
  profiles: { default: { name: 'Acme', primary_locale: 'en', locales: ['en'] } },
  scan: { include: ['locales/**/*.json'], exclude: ['node_modules/**'] }
}

test('the unreadable out-parameter survives every transformation of the returned corpus', () => {
  const dir = makeTmpProject({
    'locales/broken.json': '{ not json',
    'locales/ok.json': JSON.stringify({ hello: 'world' })
  })
  try {
    const unreadable = []
    const corpus = gatherCorpus(dir, config, 'default', unreadable)

    // The defect this guards against: a property attached to the returned
    // array (e.g. corpus.unreadable) does not survive .map, .filter,
    // .flatMap, spread, Array.from, or destructuring - only the exact
    // original reference carries it. An out-parameter is never derived from
    // the returned array, so it must still hold the path after every one of
    // these transformations discards whatever the array itself carried.
    corpus.map((f) => f.rel)
    corpus.filter(() => true)
    corpus.flatMap((f) => f.strings)
    ;[...corpus]
    Array.from(corpus)
    const [, ...rest] = corpus // eslint-disable-line no-unused-vars

    assert.deepEqual(unreadable, ['locales/broken.json'])
    assert.deepEqual(corpus.map((f) => f.rel), ['locales/ok.json'])
  } finally {
    cleanup(dir)
  }
})

test('the unreadable parameter is optional, defaulting to a private array', () => {
  const dir = makeTmpProject({ 'locales/broken.json': '{ not json' })
  try {
    assert.doesNotThrow(() => gatherCorpus(dir, config))
  } finally {
    cleanup(dir)
  }
})

test('an unsupported extension is recorded as skipped, not dropped silently', () => {
  const dir = makeTmpProject({
    'content/notes.md': 'We write like humans.\n',
    'content/logo.fig': 'the extension is what matters here',
    'content/logo.sketch': 'binary-ish'
  })
  try {
    const config = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*'], exclude: [] } }
    const unreadable = []
    const skipped = []
    const corpus = gatherCorpus(dir, config, 'default', unreadable, skipped)

    assert.deepEqual(corpus.map((f) => f.rel), ['content/notes.md'])
    assert.deepEqual(skipped.map((s) => s.ext).sort(), ['.fig', '.sketch'])
    assert.deepEqual(
      skipped.map((s) => s.rel).sort(),
      ['content/logo.fig', 'content/logo.sketch']
    )
    // R23 regression net: an extension with no extractor at all must keep
    // carrying the 'no-extractor' reason, not collapse into the reason a
    // supported-but-unread container format gets below.
    assert.deepEqual(skipped.map((s) => s.reason), ['no-extractor', 'no-extractor'])
    assert.deepEqual(unreadable, [], 'skipped is a separate channel from unreadable')
  } finally {
    cleanup(dir)
  }
})

// --- R23 (Task 7 fix round 1): a container format must never reach the text
// path. Before this fix, formatFor resolving .pdf/.docx to a truthy format
// made gatherCorpus's `if (!format)` gate a no-op for them, so the file was
// read as text and extractStrings threw, uncaught, killing the whole scan.

test('a container format beside ordinary text files is skipped, not read, and does not crash the scan', () => {
  const dir = makeTmpProject({
    'content/notes.md': 'We write like humans.\n',
    'content/brand.pdf': 'not real pdf bytes, but the extension is what gates this',
    'content/guide.docx': 'not a real docx either'
  })
  try {
    const config = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*'], exclude: [] } }
    const skipped = []

    // If gatherCorpus ever again hands a container format to extractStrings,
    // this call throws and the test fails right here - the exact repro the
    // coordinator reproduced deterministically before dispatching review.
    const corpus = gatherCorpus(dir, config, 'default', [], skipped)

    assert.deepEqual(corpus.map((f) => f.rel), ['content/notes.md'])
    assert.deepEqual(skipped.map((s) => s.rel).sort(), ['content/brand.pdf', 'content/guide.docx'])
    assert.deepEqual(skipped.map((s) => s.ext).sort(), ['.docx', '.pdf'])
    assert.deepEqual(skipped.map((s) => s.reason), ['container', 'container'])
  } finally {
    cleanup(dir)
  }
})

test('a container format is never read into memory before being skipped', () => {
  // Same technique as the "format gate runs before the file is read" test
  // below: chmod 000 after creation, so if the container gate ran after (or
  // was skipped by) the read, readTextFile's EACCES would be caught by the
  // existing "unreadable file is skipped, not fatal" handler and the file
  // would vanish into no channel at all - a regression indistinguishable
  // from the pre-fix crash except in how loudly it fails.
  const dir = makeTmpProject({ 'content/brand.pdf': 'placeholder' })
  const pdf = path.join(dir, 'content', 'brand.pdf')
  try {
    chmodSync(pdf, 0o000)

    const config = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*'], exclude: [] } }
    const skipped = []
    const corpus = gatherCorpus(dir, config, 'default', [], skipped)

    assert.deepEqual(corpus, [])
    assert.equal(skipped.length, 1)
    assert.equal(skipped[0].rel, 'content/brand.pdf')
    assert.equal(skipped[0].reason, 'container')
  } finally {
    chmodSync(pdf, 0o644) // restore so cleanup's rmSync can remove it
    cleanup(dir)
  }
})

test('the format gate runs before the file is read', () => {
  // Deviates from the brief: rather than measuring process.memoryUsage()
  // (flaky under a test runner), this proves the ordering directly. The file
  // is made unreadable (chmod 000) *after* creation, so if the read ever ran
  // before the format gate, readTextFile's EACCES would be caught by the
  // existing "unreadable file is skipped, not fatal" handler and the file
  // would vanish with no trace - reproducing the exact bug this task fixes.
  // Because the gate runs first, the read is never attempted and the file is
  // recorded in `skipped` on extension alone.
  const dir = makeTmpProject({ 'content/big.bin': 'placeholder' })
  const bigFile = path.join(dir, 'content', 'big.bin')
  try {
    // 8 MB of zeroes: large enough that slurping it would be a real cost,
    // not merely a theoretical one.
    writeFileSync(bigFile, Buffer.alloc(8 * 1024 * 1024, 0))
    chmodSync(bigFile, 0o000)

    assert.equal(formatFor(bigFile), null, 'a .bin extension has no extractor')

    const config = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*'], exclude: [] } }
    const skipped = []
    const corpus = gatherCorpus(dir, config, 'default', [], skipped)

    assert.deepEqual(corpus, [], 'an unreadable, unsupported file must not reach the corpus')
    assert.equal(skipped.length, 1)
    assert.equal(skipped[0].rel, 'content/big.bin')
    assert.equal(skipped[0].ext, '.bin')
  } finally {
    chmodSync(bigFile, 0o644) // restore so cleanup's rmSync can remove it
    cleanup(dir)
  }
})

// --- Task 12 fix round 1: the live project loop and the index must never
// both contribute the same origin. The project loop runs first and wins;
// a pre-corrupted (or hand-edited) index entry sharing its origin is healed
// away, never merged or double-counted.

test('gatherAll drops an indexed entry whose origin the live project loop already emitted', () => {
  const dir = makeTmpProject({ 'content/a.md': 'We write plainly. We keep it short.\n' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    // Simulates a sources.json corrupted by the pre-fix bug: an ordinary
    // project text file got ingested and indexed under its own origin.
    saveIndex(kb, {
      sources: [{
        id: 'f001', sha256: 'c'.repeat(64), kind: 'file', from: 's01',
        origin: 'content/a.md', format: 'markdown', locale: 'en',
        tier: 'script', fidelity: 'measured', quality: { passed: true },
        stats: statsFor({ strings: ['We write plainly. We keep it short.'], headings: [], locale: 'en' }),
        status: 'used', produced: []
      }]
    }, '2026-08-27T00:00:00.000Z')

    const cfg = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*.md'], exclude: [] } }
    const { files, missing } = gatherAll({ projectRoot: dir, kbRoot: kb, config: cfg, profileName: 'default' })

    const rows = files.filter((f) => f.rel === 'content/a.md')
    assert.equal(rows.length, 1, 'the live copy wins; the corrupted index entry must not also appear')
    assert.equal(rows[0].status, undefined, 'the surviving row is the live one, not the indexed one')
    assert.equal(missing, 0, 'the healed-away entry must not be counted anywhere else either')
  } finally {
    cleanup(dir)
  }
})

test('an indexed source with a different origin from any live file is not affected by the healing', () => {
  const dir = makeTmpProject({ 'content/a.md': 'We write plainly. We keep it short.\n' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    saveIndex(kb, {
      sources: [{
        id: 'f001', sha256: 'd'.repeat(64), kind: 'file', from: 's02',
        origin: 'sources/gone.pdf', format: 'pdf', locale: 'en',
        tier: 'script', fidelity: 'measured', quality: { passed: true },
        stats: statsFor({ strings: ['A missing document still counts.'], headings: [], locale: 'en' }),
        status: 'missing', produced: []
      }]
    }, '2026-08-27T00:00:00.000Z')

    const cfg = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*.md'], exclude: [] } }
    const { files } = gatherAll({ projectRoot: dir, kbRoot: kb, config: cfg, profileName: 'default' })

    assert.deepEqual(files.map((f) => f.rel).sort(), ['content/a.md', 'sources/gone.pdf'])
  } finally {
    cleanup(dir)
  }
})

// --- F2: registered material that has never been ingested must not vanish
// without a trace. Before this fix, gatherAll's non-project loop recorded
// only `entry.skipped` and then `continue`d past everything in
// `entry.files`, so a file the register could see but nobody had ingested
// yet was absent from `files`, `skipped`, AND `unreadable` alike - "scan: 0
// files" and "no copy found; check scan.include", actively misdirecting a
// first-time user whose sources/ folder was not empty.

test('registered material nobody has ingested yet is surfaced as unindexed, not silently dropped', () => {
  const dir = makeTmpProject({ '.voice-and-tone/sources/newsletter.txt': 'We keep it plain.\n' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const cfg = { ...DEFAULT_CONFIG, sources: [{ id: 's02', kind: 'inbox', path: 'sources/' }] }
    const { files, unindexed } = gatherAll({ projectRoot: dir, kbRoot: kb, config: cfg, profileName: 'default' })

    assert.deepEqual(files, [], 'an inbox file is never read live')
    assert.deepEqual(unindexed.map((f) => f.rel), ['sources/newsletter.txt'])
    assert.equal(unindexed[0].ext, '.txt')
  } finally {
    cleanup(dir)
  }
})

test('once a registered file is ingested, it no longer counts as unindexed', () => {
  const dir = makeTmpProject({ '.voice-and-tone/sources/newsletter.txt': 'We keep it plain.\n' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const cfg = { ...DEFAULT_CONFIG, sources: [{ id: 's02', kind: 'inbox', path: 'sources/' }] }
    saveIndex(kb, {
      sources: [{
        id: 'f001', sha256: 'a'.repeat(64), kind: 'file', from: 's02',
        origin: 'sources/newsletter.txt', format: 'text', locale: 'en',
        tier: 'script', fidelity: 'measured', quality: { passed: true },
        stats: statsFor({ strings: ['We keep it plain.'], headings: [], locale: 'en' }),
        status: 'used', produced: []
      }]
    }, '2026-08-27T00:00:00.000Z')

    const { unindexed } = gatherAll({ projectRoot: dir, kbRoot: kb, config: cfg, profileName: 'default' })
    assert.deepEqual(unindexed, [])
  } finally {
    cleanup(dir)
  }
})

test('a project-entry container file never counts as unindexed - it is reported as skipped/container instead', () => {
  const dir = makeTmpProject({ 'content/brand.pdf': 'not a real pdf, but the extension gates this' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const cfg = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*'], exclude: [] } }
    const { unindexed, skipped } = gatherAll({ projectRoot: dir, kbRoot: kb, config: cfg, profileName: 'default' })

    assert.deepEqual(unindexed, [], 'unindexed is scoped to non-project entries only')
    assert.deepEqual(skipped.map((s) => s.reason), ['container'])
  } finally {
    cleanup(dir)
  }
})

test('gatherAll scopes the register to the profile: house files for default, speaker files for a speaker', () => {
  const dir = makeTmpProject({
    'content/page.md': '# Page\n\nHouse copy here.\n',
    '.voice-and-tone/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: en',
      '    locales: [en]',
      '  maya:',
      '    name: "Maya Lind"',
      'sources:',
      '  - id: s01',
      '    kind: project',
      '    include: ["content/**/*.md"]',
      '    exclude: []',
      '  - id: s02',
      '    kind: inbox',
      '    path: "profiles/maya/sources/"',
      '    profile: maya',
      ''
    ].join('\n'),
    '.voice-and-tone/profiles/maya/sources/post.md': 'Her post.\n',
    '.voice-and-tone/evidence/sources.json': JSON.stringify({
      generated: '2026-09-10T00:00:00.000Z',
      sources: [{
        id: 'f001', sha256: 'abc', kind: 'file', from: 's02', origin: 'profiles/maya/sources/post.md',
        format: 'markdown', locale: 'en', tier: 'script', status: 'used', profile: 'maya',
        stats: { strings: 1, words: 2, sentences: 1 }, produced: []
      }]
    })
  })
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    const cfg = loadConfig(kbRoot)
    const house = gatherAll({ projectRoot: dir, kbRoot, config: cfg, profileName: 'default' })
    assert.deepEqual(house.files.map((f) => f.rel), ['content/page.md'], "the speaker's indexed post is not house corpus")
    const maya = gatherAll({ projectRoot: dir, kbRoot, config: cfg, profileName: 'maya' })
    assert.deepEqual(maya.files.map((f) => f.rel), ['profiles/maya/sources/post.md'])
    assert.equal(maya.unindexed.length, 0)
  } finally {
    cleanup(dir)
  }
})
