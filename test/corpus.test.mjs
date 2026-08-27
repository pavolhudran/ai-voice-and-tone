import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs'
import { gatherCorpus } from '../scripts/lib/corpus.mjs'
import { formatFor } from '../scripts/lib/extract.mjs'

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
    assert.deepEqual(unreadable, [], 'skipped is a separate channel from unreadable')
  } finally {
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
