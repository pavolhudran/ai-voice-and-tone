import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { ingestFile, ingestText, needsModelTier, cachePathFor, extractSource } from '../scripts/lib/ingest.mjs'
import { readTextFile } from '../scripts/lib/fsx.mjs'
import { sha256File } from '../scripts/lib/hash.mjs'

const NOW = '2026-08-27T00:00:00.000Z'

function fileIn (dir, rel, contents) {
  const abs = path.join(dir, rel)
  writeFileSync(abs, contents)
  return { abs, rel, origin: rel, format: rel.endsWith('.md') ? 'markdown' : 'text', locale: 'en' }
}

// extractSource is async too, for the same reason as ingestFile. Placed
// first in this file deliberately: pdf.mjs's extractPdf briefly monkeypatches
// process.stdout.write while pdfjs loads (see pdf.mjs's `quietly`), and
// running it after other tests' TAP output has been queued but not yet
// flushed can eat that output from the reporter - reproduced directly while
// building this file. Running it first sidesteps that entirely.
test('extractSource routes each format to the right parser', async () => {
  const dir = makeTmpProject({})
  try {
    const textOut = await extractSource({ abs: path.join(dir, 'x.txt'), format: 'text', buf: Buffer.from('One. Two.') })
    assert.deepEqual(textOut.strings, ['One. Two.'])
    // A binary format must be handed bytes; the router must not decode first.
    const out = await extractSource({ abs: path.join(dir, 'x.pdf'), format: 'pdf', buf: Buffer.from('%PDF-1.4\n') })
    assert.equal(out.note, 'no-text-layer')
  } finally {
    cleanup(dir)
  }
})

test('a text source produces a complete, measured index entry', async () => {
  const dir = makeTmpProject({ 'a.txt': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = fileIn(dir, 'a.txt', 'We write plainly. We keep it short.\n')
    const entry = await ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

    assert.equal(entry.id, 'f001')
    assert.equal(entry.from, 's02')
    assert.equal(entry.kind, 'file')
    assert.equal(entry.sha256, sha256File(file.abs))
    assert.equal(entry.tier, 'script')
    assert.equal(entry.fidelity, 'measured')
    assert.equal(entry.status, 'used')
    assert.equal(entry.quality.passed, true)
    assert.equal(entry.stats.sentences, 2)
    assert.equal(entry.analysed, '2026-08-27')
    assert.deepEqual(entry.produced, [])
    // A text format never goes through a vendored library, so it carries no
    // extractor stamp - nothing to go stale on a version bump.
    assert.equal(entry.extractor, null)
  } finally {
    cleanup(dir)
  }
})

test('extracted text is cached under the content hash, not the filename', async () => {
  const dir = makeTmpProject({ 'a.txt': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = fileIn(dir, 'a.txt', 'We write plainly.\n')
    const entry = await ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

    const cached = cachePathFor(kb, entry.sha256)
    assert.ok(existsSync(cached), 'extract is cached')
    assert.match(readTextFile(cached), /We write plainly\./)
    assert.match(cached, new RegExp(`${entry.sha256}\\.txt$`))
    assert.ok(cached.includes(path.join('.cache', 'extracts')), 'cache lives in the gitignored dir')
  } finally {
    cleanup(dir)
  }
})

test('a source yielding no text is skipped with a reason, not silently dropped', async () => {
  const dir = makeTmpProject({ 'empty.txt': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = fileIn(dir, 'empty.txt', '   \n\n  \n')
    const entry = await ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

    assert.equal(entry.status, 'skipped')
    assert.equal(entry.quality.passed, false)
    assert.ok(entry.quality.reasons.length > 0)
    assert.equal(entry.stats, null, 'a skipped source contributes nothing')
  } finally {
    cleanup(dir)
  }
})

// ingestFile is async (extractOffice/extractPdf are promise-based, so the
// whole extraction path is), unlike the brief's sketch of this test.
test('a gate failure marks the entry for the model tier', async () => {
  const dir = makeTmpProject({ 'split.txt': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = fileIn(dir, 'split.txt', 'I V A Š TÍH LÁ ADMIN IS TRATIV NÍ PRACOVNIC E L ET\n')
    const entry = await ingestFile({ ...file, locale: 'cs' }, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

    assert.equal(entry.quality.passed, false)
    assert.equal(needsModelTier(entry), true)
    assert.equal(entry.status, 'skipped')
  } finally {
    cleanup(dir)
  }
})

// Async for the same reason as above.
test('a passing entry does not need the model tier', async () => {
  const dir = makeTmpProject({ 'a.txt': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = fileIn(dir, 'a.txt', 'We write plainly and we keep every sentence short.\n')
    const entry = await ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })
    assert.equal(needsModelTier(entry), false)
  } finally {
    cleanup(dir)
  }
})

// ingestText takes already-extracted strings, so it stays synchronous - the
// model tier and the URL tier hand it text they already have in hand.
test('a model-tier entry is capped at estimated fidelity', () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const entry = ingestText(
      {
        sha256: 'a'.repeat(64),
        origin: 'sources/scan.pdf',
        kind: 'file',
        format: 'pdf',
        locale: 'en',
        bytes: 1024,
        strings: ['We write plainly.', 'We keep it short.'],
        headings: []
      },
      { kbRoot: kb, now: NOW, id: 'f002', from: 's02', tier: 'model' }
    )

    assert.equal(entry.tier, 'model')
    assert.equal(
      entry.fidelity, 'estimated',
      'parent spec 5.4: an estimated source may only ever produce assumed rules'
    )
    assert.equal(entry.status, 'used')
    // A model transcription never went through a vendored library either -
    // nothing to go stale on a version bump.
    assert.equal(entry.extractor, null)
  } finally {
    cleanup(dir)
  }
})

test('model-tier output is scored by the same gate and can still be refused', () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const entry = ingestText(
      {
        sha256: 'b'.repeat(64), origin: 'sources/x.pdf', kind: 'file', format: 'pdf',
        locale: 'en', bytes: 10, strings: ['a b c d e f g h i j k'], headings: []
      },
      { kbRoot: kb, now: NOW, id: 'f003', from: 's02', tier: 'model' }
    )
    assert.equal(entry.quality.passed, false)
    assert.equal(entry.status, 'skipped')
  } finally {
    cleanup(dir)
  }
})

test('an unreadable container is skipped with the reason recorded', async () => {
  const dir = makeTmpProject({ 'broken.docx': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = { ...fileIn(dir, 'broken.docx', 'not a zip at all'), format: 'docx' }
    const entry = await ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

    assert.equal(entry.status, 'skipped')
    assert.ok(entry.quality.reasons.join(' ').match(/not a zip|unreadable/i), entry.quality.reasons.join('; '))
  } finally {
    cleanup(dir)
  }
})
