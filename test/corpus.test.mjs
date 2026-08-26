import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs'
import { gatherCorpus } from '../scripts/lib/corpus.mjs'

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
