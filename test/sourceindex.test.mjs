import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { statsFor, mergeStats, fingerprintFromStats } from '../scripts/lib/metrics.mjs'
import { readTextFile } from '../scripts/lib/fsx.mjs'
import {
  loadIndex, saveIndex, nextEntryId, upsertEntry, bySha, diffIndex, statsByLocale, indexPathFor,
  staleByExtractor
} from '../scripts/lib/sourceindex.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const entry = (over = {}) => ({
  id: 'f001',
  sha256: 'a'.repeat(64),
  kind: 'file',
  from: 's02',
  origin: 'sources/a.txt',
  label: 'A',
  format: 'text',
  bytes: 10,
  locale: 'en',
  tier: 'script',
  extractor: { name: 'officeparser', version: '7.8.0' },
  fidelity: 'measured',
  quality: { passed: true },
  stats: statsFor({ strings: ['We write plainly.'], headings: [], locale: 'en' }),
  added: '2026-08-27',
  analysed: '2026-08-27',
  status: 'used',
  produced: [],
  ...over
})

test('an absent index loads as empty rather than throwing', () => {
  const dir = makeTmpProject({})
  try {
    const index = loadIndex(path.join(dir, '.voice-and-tone'))
    assert.deepEqual(index.sources, [])
    assert.equal(typeof index.generated, 'string')
  } finally {
    cleanup(dir)
  }
})

test('the index round-trips and is written sorted for a clean diff', () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    saveIndex(kb, { sources: [entry({ id: 'f003' }), entry({ id: 'f001', sha256: 'b'.repeat(64) })] }, '2026-08-27T00:00:00.000Z')

    assert.ok(existsSync(indexPathFor(kb)))
    const reloaded = loadIndex(kb)
    assert.deepEqual(reloaded.sources.map((s) => s.id), ['f001', 'f003'])
    assert.equal(reloaded.generated, '2026-08-27T00:00:00.000Z')
  } finally {
    cleanup(dir)
  }
})

test('entry ids are monotonic and zero-padded', () => {
  assert.equal(nextEntryId({ sources: [] }), 'f001')
  assert.equal(nextEntryId({ sources: [{ id: 'f001' }, { id: 'f017' }] }), 'f018')
  assert.equal(nextEntryId({ sources: [{ id: 'f999' }] }), 'f1000')
})

test('identity is the hash, so the same bytes at a new path update rather than duplicate', () => {
  const index = { sources: [entry({ origin: 'sources/a.txt' })] }
  const updated = upsertEntry(index, entry({ id: 'f002', origin: '/Users/other/Downloads/a.txt' }))

  assert.equal(index.sources.length, 1, 'no duplicate created')
  assert.equal(updated.id, 'f001', 'the original id is kept')
  assert.equal(index.sources[0].origin, '/Users/other/Downloads/a.txt', 'origin is refreshed as a hint')
})

test('different bytes create a separate entry', () => {
  const index = { sources: [entry()] }
  upsertEntry(index, entry({ id: 'f002', sha256: 'c'.repeat(64) }))
  assert.equal(index.sources.length, 2)
})

test('bySha indexes every entry by its hash', () => {
  const index = { sources: [entry(), entry({ id: 'f002', sha256: 'd'.repeat(64) })] }
  assert.deepEqual([...bySha(index).keys()].sort(), ['a'.repeat(64), 'd'.repeat(64)])
})

// --- the status diff: the question "what have we already analysed?" -------

test('diffIndex separates fresh, known, stale and missing', () => {
  const known = entry({ sha256: 'a'.repeat(64), origin: 'sources/known.txt' })
  const gone = entry({ id: 'f002', sha256: 'b'.repeat(64), origin: 'sources/gone.txt' })
  const index = { sources: [known, gone] }

  const resolved = [{
    id: 's02',
    kind: 'inbox',
    missing: false,
    skipped: [{ origin: 'sources/logo.sketch', ext: '.sketch' }],
    files: [
      { abs: '/tmp/known.txt', origin: 'sources/known.txt', format: 'text', locale: 'en' },
      { abs: '/tmp/changed.txt', origin: 'sources/changed.txt', format: 'text', locale: 'en' },
      { abs: '/tmp/new.txt', origin: 'sources/new.txt', format: 'text', locale: 'en' }
    ]
  }]

  // 'changed' hashes to an existing entry's origin but different bytes -> stale
  const hashOf = (abs) => ({
    '/tmp/known.txt': 'a'.repeat(64),
    '/tmp/changed.txt': 'e'.repeat(64),
    '/tmp/new.txt': 'f'.repeat(64)
  })[abs]

  const diff = diffIndex(index, resolved, hashOf)

  assert.deepEqual(diff.known.map((f) => f.origin), ['sources/known.txt'])
  assert.deepEqual(diff.fresh.map((f) => f.origin).sort(), ['sources/changed.txt', 'sources/new.txt'])
  assert.deepEqual(diff.missing.map((e) => e.origin), ['sources/gone.txt'])
  assert.deepEqual(diff.skipped.map((s) => s.origin), ['sources/logo.sketch'])
})

test('an entry whose origin still resolves but whose bytes changed is stale, not fresh', () => {
  const index = { sources: [entry({ origin: 'sources/a.txt', sha256: 'a'.repeat(64) })] }
  const resolved = [{
    id: 's02', kind: 'inbox', missing: false, skipped: [],
    files: [{ abs: '/tmp/a.txt', origin: 'sources/a.txt', format: 'text', locale: 'en' }]
  }]
  const diff = diffIndex(index, resolved, () => 'z'.repeat(64))

  assert.deepEqual(diff.stale.map((s) => s.entry.origin), ['sources/a.txt'])
  assert.deepEqual(diff.missing, [], 'a stale entry is not also reported missing')
})

// --- the payoff: the fingerprint survives with no source text -------------

test('the aggregate fingerprint is recomputable from the index alone', () => {
  const a = statsFor({ strings: ['We write plainly. We keep it short.'], headings: [], locale: 'en' })
  const b = statsFor({ strings: ['That file did not upload. Try a smaller one.'], headings: [], locale: 'en' })
  const index = {
    sources: [
      entry({ id: 'f001', sha256: '1'.repeat(64), stats: a, status: 'missing' }),
      entry({ id: 'f002', sha256: '2'.repeat(64), stats: b, status: 'missing' })
    ]
  }

  const buckets = statsByLocale(index)
  assert.deepEqual(
    fingerprintFromStats(buckets.get('en'), 'en'),
    fingerprintFromStats(mergeStats([a, b]), 'en'),
    'a clone with an empty sources/ reproduces the baseline exactly'
  )
})

test('locales are bucketed separately and never merged', () => {
  const index = {
    sources: [
      entry({ id: 'f001', sha256: '1'.repeat(64), locale: 'en' }),
      entry({ id: 'f002', sha256: '2'.repeat(64), locale: 'cs', stats: statsFor({ strings: ['Ahoj.'], headings: [], locale: 'cs' }) })
    ]
  }
  assert.deepEqual([...statsByLocale(index).keys()].sort(), ['cs', 'en'])
})

test('a skipped entry contributes no statistics', () => {
  const index = {
    sources: [
      entry({ id: 'f001', sha256: '1'.repeat(64) }),
      entry({ id: 'f002', sha256: '2'.repeat(64), status: 'skipped', stats: null })
    ]
  }
  const buckets = statsByLocale(index)
  assert.equal(buckets.get('en').words, index.sources[0].stats.words)
})

// --- judgement calls: what counts as corruption, not an empty source ------

test('a skipped entry that somehow carries a stats block is still excluded', () => {
  // status is authoritative over content: a skipped entry failed the
  // quality gate, so its numbers were never trustworthy, regardless of
  // whether a stats block happens to be present (a hand-edit, a bug
  // upstream). Excluding it on status alone - never on "does stats look
  // usable" - is the point of this test.
  const good = entry({ id: 'f001', sha256: '1'.repeat(64) })
  const contaminated = entry({
    id: 'f002', sha256: '2'.repeat(64), status: 'skipped',
    stats: statsFor({ strings: ['This should never count.'], headings: [], locale: 'en' })
  })
  const index = { sources: [good, contaminated] }
  const buckets = statsByLocale(index)
  assert.equal(buckets.get('en').words, good.stats.words, 'the skipped entry\'s stats leaked into the aggregate')
})

test('a used entry with no stats block is corruption, and statsByLocale throws rather than silently shrinking the aggregate', () => {
  const index = {
    sources: [
      entry({ id: 'f001', sha256: '1'.repeat(64) }),
      entry({ id: 'f002', sha256: '2'.repeat(64), status: 'used', stats: null })
    ]
  }
  assert.throws(() => statsByLocale(index), /f002/)
})

test('a missing or stale entry with no stats block is corruption too - the fix for "new" must not weaken this guard', () => {
  for (const status of ['missing', 'stale']) {
    const index = { sources: [entry({ id: 'f001', sha256: '1'.repeat(64), status, stats: null })] }
    assert.throws(() => statsByLocale(index), /f001/, `status '${status}' should still throw on a null stats block`)
  }
})

test('an entry with no locale throws rather than being coerced into the wrong bucket', () => {
  const index = { sources: [entry({ id: 'f001', sha256: '1'.repeat(64), locale: undefined })] }
  assert.throws(() => statsByLocale(index), /f001/)
})

// --- 'new' is a diff-level word, never an index status - tolerated, ------
// --- but not fatal, and never mistaken for corruption ---------------------

test('a status of "new" is excluded without contributing and without throwing, even with no stats block', () => {
  // The index is the record of what has been analysed; a registered-but-
  // not-yet-ingested file has no business being an entry at all (diffIndex
  // returns it as `fresh`). If one ever landed here anyway - a future bug -
  // excluding it is the right behaviour, not raising the corruption alarm
  // reserved for used/missing/stale.
  const good = entry({ id: 'f001', sha256: '1'.repeat(64) })
  const notYetAnalysed = entry({ id: 'f002', sha256: '2'.repeat(64), status: 'new', stats: null })
  const index = { sources: [good, notYetAnalysed] }
  const buckets = statsByLocale(index)
  assert.equal(buckets.get('en').words, good.stats.words)
})

test('an unrecognised status string is excluded without contributing and without throwing', () => {
  const good = entry({ id: 'f001', sha256: '1'.repeat(64) })
  const unknown = entry({ id: 'f002', sha256: '2'.repeat(64), status: 'quarantined', stats: null })
  const index = { sources: [good, unknown] }
  const buckets = statsByLocale(index)
  assert.equal(buckets.get('en').words, good.stats.words)
})

// --- includeMissing: pinned so the flag cannot go dead again --------------

test('includeMissing:false excludes absent sources, unlike the true default', () => {
  const present = entry({ id: 'f001', sha256: '1'.repeat(64) })
  const absent = entry({
    id: 'f002', sha256: '2'.repeat(64), status: 'missing',
    stats: statsFor({ strings: ['We were here once, on someone else\'s machine.'], headings: [], locale: 'en' })
  })
  const index = { sources: [present, absent] }

  const withMissing = statsByLocale(index, { includeMissing: true })
  const withoutMissing = statsByLocale(index, { includeMissing: false })

  assert.equal(withMissing.get('en').words, mergeStats([present.stats, absent.stats]).words)
  assert.equal(withoutMissing.get('en').words, present.stats.words)
  assert.notEqual(
    withMissing.get('en').words, withoutMissing.get('en').words,
    'includeMissing:false must change the result, or the flag is dead'
  )
})

// --- staleByExtractor: a version bump must not shift numbers silently -----

test('an entry produced by an older library version is reported stale', () => {
  const index = {
    sources: [
      entry({ id: 'f001', sha256: '1'.repeat(64), extractor: { name: 'officeparser', version: '7.8.0' } }),
      entry({ id: 'f002', sha256: '2'.repeat(64), extractor: { name: 'pdfjs-dist', version: '4.10.38' } })
    ]
  }
  const current = { libraries: { officeparser: { version: '7.9.0' }, 'pdfjs-dist': { version: '4.10.38' } } }
  assert.deepEqual(staleByExtractor(index, current).map((e) => e.id), ['f001'])
})

test('an entry with no extractor stamp never goes stale', () => {
  const index = { sources: [entry({ id: 'f001', sha256: '1'.repeat(64), extractor: null, format: 'markdown' })] }
  const current = { libraries: { officeparser: { version: '9.9.9' } } }
  assert.deepEqual(staleByExtractor(index, current), [])
})

test('staleByExtractor is checked against the real vendor/manifest.json, not just a fixture shape', () => {
  // Pins the assumption (documented in sourceindex.mjs and inferred from
  // office.mjs/pdf.mjs/vendor.test.mjs, since no call site was given for
  // this function) that `current` is the parsed contents of the real
  // manifest file: { libraries: { <name>: { version } } }. A future
  // reshape of vendor/manifest.json fails loudly here rather than only in
  // whichever CLI eventually calls this.
  const manifest = JSON.parse(readTextFile(path.join(ROOT, 'vendor', 'manifest.json')))
  const [name, info] = Object.entries(manifest.libraries)[0]

  const current = entry({ id: 'f001', sha256: '1'.repeat(64), extractor: { name, version: info.version } })
  const stale = entry({ id: 'f002', sha256: '2'.repeat(64), extractor: { name, version: '0.0.0-not-real' } })
  const index = { sources: [current, stale] }

  assert.deepEqual(staleByExtractor(index, manifest).map((e) => e.id), ['f002'])
})
