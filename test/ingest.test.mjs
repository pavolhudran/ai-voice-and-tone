import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { ingestFile, ingestText, needsModelTier, extractSource } from '../scripts/lib/ingest.mjs'
import { sha256File } from '../scripts/lib/hash.mjs'

const NOW = '2026-08-27T00:00:00.000Z'

function fileIn (dir, rel, contents) {
  const abs = path.join(dir, rel)
  writeFileSync(abs, contents)
  return { abs, rel, origin: rel, format: rel.endsWith('.md') ? 'markdown' : 'text', locale: 'en' }
}

/**
 * A syntactically valid, minimal PDF with a Catalog/Pages/Page and no
 * /Contents key at all - the "scanned page" shape pdf.mjs reports as
 * no-text-layer. Purpose-built for this one case (no encryption, no
 * content streams), not a general PDF builder - see test/pdf.test.mjs's
 * own `makePdf` for that.
 */
function minimalPdfWithNoTextLayer () {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'
  ]
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  body += `startxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

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

// F6: the extract cache was write-only - ingest.mjs wrote every analysed
// source's plaintext to <kb>/.cache/extracts/<sha>.txt, and nothing ever read
// it back (ingestFile always re-extracts from the original bytes). That sat
// badly against the central claim that brand material is analysed and
// discarded: it silently retained a full plaintext copy of every document,
// indefinitely, for no benefit. Removed rather than wired up - this is the
// regression guard proving ingest never recreates it.
test('ingest does not write an extract cache; the source text is not retained on disk', async () => {
  const dir = makeTmpProject({ 'a.txt': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = fileIn(dir, 'a.txt', 'We write plainly.\n')
    await ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

    assert.equal(existsSync(path.join(kb, '.cache')), false, 'ingest must not create a .cache directory at all')
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
    // Fix round 2: a blank source decoded fine and genuinely held nothing -
    // the extractor's own note is 'ok', not a missing text layer. There is
    // nothing left for the model to find, so it must not escalate.
    assert.equal(needsModelTier(entry), false)
  } finally {
    cleanup(dir)
  }
})

test('a scanned PDF with no text layer is skipped, but still needs the model tier', async () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const abs = path.join(dir, 'scan.pdf')
    writeFileSync(abs, minimalPdfWithNoTextLayer())
    const file = { abs, origin: 'scan.pdf', format: 'pdf', locale: 'en' }
    const entry = await ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

    assert.equal(entry.status, 'skipped')
    assert.equal(entry.quality.note, 'no-text-layer')
    // Unlike a blank text file, this source has content - just not a text
    // layer the script tier can read. A model with vision still can, which
    // is the headline case the whole model tier exists for.
    assert.equal(needsModelTier(entry), true)
  } finally {
    cleanup(dir)
  }
})

// ingestFile is async (extractOffice/extractPdf are promise-based, so the
// whole extraction path is), unlike the brief's sketch of this test.
//
// Ruling R43: the shape gate (longTokenShare/singleShare) no longer applies
// to authored plain text - a .txt file with split-looking words is exactly
// what someone typed, not a corrupted extraction, so a .txt fixture can no
// longer demonstrate a gate failure here. .html is still gated (markup
// recovers running text, same as a PDF or office container), so it stands
// in for "an extraction step that can genuinely lose word boundaries".
test('a gate failure marks the entry for the model tier', async () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const abs = path.join(dir, 'split.html')
    writeFileSync(abs, '<p>I V A Š TÍH LÁ ADMIN IS TRATIV NÍ PRACOVNIC E L ET</p>\n')
    const file = { abs, origin: 'split.html', format: 'html', locale: 'cs' }
    const entry = await ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

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
    // A corrupt container cannot be repaired by the model any better than
    // by the script tier - escalating would spend tokens on nothing.
    assert.equal(needsModelTier(entry), false)
  } finally {
    cleanup(dir)
  }
})

// extractSource is async too, for the same reason as ingestFile.
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
