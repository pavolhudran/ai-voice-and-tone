import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { DEFAULT_CONFIG, kbRootFor, loadConfig, saveConfig, localeOf } from '../scripts/lib/config.mjs'

test('defaults match the spec thresholds', () => {
  assert.equal(DEFAULT_CONFIG.version, 1)
  assert.equal(DEFAULT_CONFIG.thresholds.corroboration, 2)
  assert.equal(DEFAULT_CONFIG.thresholds.derived_min_samples, 5)
  assert.equal(DEFAULT_CONFIG.thresholds.stale_months, 9)
  assert.ok(DEFAULT_CONFIG.scan.exclude.includes('node_modules/**'))
})

test('kbRootFor defaults to .voice-and-tone and honours an override', () => {
  assert.equal(kbRootFor('/p'), path.join('/p', '.voice-and-tone'))
  assert.equal(kbRootFor('/p', '/elsewhere/kb'), path.resolve('/elsewhere/kb'))
})

test('loadConfig deep-merges over defaults and survives a missing file', () => {
  const dir = makeTmpProject({
    'kb/config.yml': 'kb_version: 0.4.2\nthresholds:\n  corroboration: 3\n'
  })
  try {
    const config = loadConfig(path.join(dir, 'kb'))
    assert.equal(config.kb_version, '0.4.2')
    assert.equal(config.thresholds.corroboration, 3)
    assert.equal(config.thresholds.stale_months, 9, 'untouched defaults survive the merge')
    assert.deepEqual(loadConfig(path.join(dir, 'absent')).thresholds, DEFAULT_CONFIG.thresholds)
  } finally {
    cleanup(dir)
  }
})

test('saveConfig round-trips through loadConfig', () => {
  const dir = makeTmpProject({})
  try {
    const kb = path.join(dir, 'kb')
    saveConfig(kb, { ...DEFAULT_CONFIG, kb_version: '1.2.3' })
    assert.equal(loadConfig(kb).kb_version, '1.2.3')
  } finally {
    cleanup(dir)
  }
})

test('loadConfig does not alias DEFAULT_CONFIG nested objects across calls', () => {
  const dir = makeTmpProject({ 'kb/config.yml': 'kb_version: 0.4.2\n' })
  try {
    const a = loadConfig(path.join(dir, 'kb'))
    const b = loadConfig(path.join(dir, 'kb'))
    assert.notEqual(a.thresholds, DEFAULT_CONFIG.thresholds, 'a fresh clone, not the frozen default')
    assert.notEqual(a.thresholds, b.thresholds, 'two calls do not share the same nested object')
    a.thresholds.corroboration = 999
    assert.equal(DEFAULT_CONFIG.thresholds.corroboration, 2, 'mutating one result leaves the frozen default intact')
    assert.equal(b.thresholds.corroboration, 2, 'mutating one result leaves a sibling call intact')
  } finally {
    cleanup(dir)
  }
})

test('a user scan.exclude replaces the default array rather than concatenating with it', () => {
  const dir = makeTmpProject({
    'kb/config.yml': 'scan:\n  exclude:\n    - vendor/**\n'
  })
  try {
    const config = loadConfig(path.join(dir, 'kb'))
    assert.deepEqual(config.scan.exclude, ['vendor/**'])
    assert.ok(!config.scan.exclude.includes('node_modules/**'), 'default entries are not merged in')
    assert.deepEqual(config.scan.include, DEFAULT_CONFIG.scan.include, 'untouched sibling key survives the merge')
  } finally {
    cleanup(dir)
  }
})

test('localeOf reads the locale from the path, else falls back to primary', () => {
  const locales = ['en', 'cs']
  assert.equal(localeOf('locales/cs/common.json', locales, 'en'), 'cs')
  assert.equal(localeOf('src/i18n/cs.json', locales, 'en'), 'cs')
  assert.equal(localeOf('content/cs/index.md', locales, 'en'), 'cs')
  assert.equal(localeOf('content/index.md', locales, 'en'), 'en')
  assert.equal(localeOf('content/csv/index.md', locales, 'en'), 'en', 'csv is not the cs locale')
})
