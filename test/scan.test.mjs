import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs'
import { buildManifest } from '../scripts/scan.mjs'

const config = {
  ...DEFAULT_CONFIG,
  profiles: { default: { name: 'Acme', primary_locale: 'en', locales: ['en', 'cs'] } },
  scan: { include: ['content/**/*.md', 'locales/**/*.json'], exclude: ['node_modules/**'] }
}

test('manifest counts copy per file and groups by locale', () => {
  const dir = makeTmpProject({
    'content/a.md': '# Hi\n\nYour campaign is scheduled. Nice work.\n',
    'locales/cs/common.json': JSON.stringify({ save: 'Uložit', cancel: 'Zrušit' }),
    'content/ignored.txt': 'not in the include list',
    'node_modules/pkg/readme.md': 'never'
  })
  try {
    const manifest = buildManifest(dir, config, '2026-08-26T00:00:00.000Z')

    assert.equal(manifest.generated, '2026-08-26T00:00:00.000Z')
    assert.equal(manifest.totals.files, 2)
    assert.deepEqual(manifest.files.map((f) => f.path), ['content/a.md', 'locales/cs/common.json'])

    const md = manifest.files[0]
    assert.equal(md.format, 'markdown')
    assert.equal(md.locale, 'en')
    assert.equal(md.sentences, 3, 'heading plus two sentences')

    assert.equal(manifest.files[1].locale, 'cs')
    assert.equal(manifest.byLocale.cs.strings, 2)
    assert.equal(manifest.byLocale.en.files, 1)
  } finally {
    cleanup(dir)
  }
})

test('an empty project produces a valid, empty manifest rather than throwing', () => {
  const dir = makeTmpProject({})
  try {
    const manifest = buildManifest(dir, config, '2026-08-26T00:00:00.000Z')
    assert.deepEqual(manifest.files, [])
    assert.equal(manifest.totals.words, 0)
    assert.deepEqual(manifest.byLocale, {})
  } finally {
    cleanup(dir)
  }
})

test('paths in the manifest are POSIX on every platform', () => {
  const dir = makeTmpProject({ 'content/deep/nested/a.md': 'Copy here.' })
  try {
    const manifest = buildManifest(dir, config, '2026-08-26T00:00:00.000Z')
    assert.equal(manifest.files[0].path, 'content/deep/nested/a.md')
    assert.ok(!manifest.files[0].path.includes(path.sep === '/' ? '\\' : '\\'))
  } finally {
    cleanup(dir)
  }
})

test('a malformed JSON file is surfaced as unreadable, not silently dropped', () => {
  const jsonConfig = {
    ...config,
    scan: { include: ['locales/**/*.json'], exclude: ['node_modules/**'] }
  }
  const dir = makeTmpProject({
    'locales/en/common.json': '{ "save": "Save", broken',
    'locales/cs/common.json': JSON.stringify({ save: 'Uložit' })
  })
  try {
    const manifest = buildManifest(dir, jsonConfig, '2026-08-26T00:00:00.000Z')
    assert.equal(manifest.unreadable.count, 1)
    assert.deepEqual(manifest.unreadable.paths, ['locales/en/common.json'])
    // The malformed file contributes no data point: it is absent from files/totals.
    assert.equal(manifest.totals.files, 1)
    assert.deepEqual(manifest.files.map((f) => f.path), ['locales/cs/common.json'])
  } finally {
    cleanup(dir)
  }
})
