import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { extractPdf, PDF_EXTRACTOR } from '../scripts/lib/pdf.mjs'

// A minimal Standard-security-handler dictionary with garbage owner/user
// hashes. pdfjs only recognizes a document as encrypted once it can resolve
// a real /Encrypt object - a dangling reference (e.g. to an object number
// that was never written) fails Root resolution first and never reaches the
// password check. This dict is well-formed enough that pdfjs gets as far as
// verifying the (garbage) password, so it raises its own PasswordException
// exactly as it would for a real encrypted file.
const ENCRYPT_DICT = `<< /Filter /Standard /V 1 /R 2 /O <${'FF'.repeat(32)}> /U <${'FF'.repeat(32)}> /P -44 >>`

/** Assemble a syntactically valid PDF with a proper xref table. */
function makePdf (objects, { encrypt = false } = {}) {
  const objs = encrypt ? [...objects, ENCRYPT_DICT] : objects
  let body = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  const encryptRef = encrypt ? ` /Encrypt ${objs.length} 0 R` : ''
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${encryptRef} >>\n`
  body += `startxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

function contentObj (content) {
  const z = deflateSync(Buffer.from(content, 'latin1')).toString('latin1')
  return `<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n${z}\nendstream`
}

const onePage = (content, fontExtras = '/BaseFont /Helvetica') => makePdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
    '/Resources << /Font << /F1 5 0 R >> >> >>',
  contentObj(content),
  `<< /Type /Font /Subtype /Type1 ${fontExtras} >>`
])

test('the extractor stamps its own identity for the index', () => {
  assert.equal(PDF_EXTRACTOR.name, 'pdfjs-dist')
  assert.match(PDF_EXTRACTOR.version, /^\d+\.\d+\.\d+$/)
})

test('text is extracted from a compressed content stream', async () => {
  const out = await extractPdf(onePage('BT /F1 12 Tf 72 700 Td (Your campaign is scheduled.) Tj ET'))
  assert.equal(out.note, 'ok')
  assert.match(out.strings.join(' '), /Your campaign is scheduled\./)
  assert.deepEqual(out.headings, [], 'a PDF carries no heading concept worth trusting')
})

test('a successful extraction reports glyphRecall as null, not a fabricated 1.0', async () => {
  // pdfjs's text layer never emits U+FFFD or a notdef marker, so an
  // emitted-over-expected ratio computed from its output can only ever be a
  // constant 1.0 - a signal pinned at a constant is worse than none, because
  // it would read as "nothing was lost" without ever having checked.
  const out = await extractPdf(onePage('BT /F1 12 Tf 72 700 Td (Your campaign is scheduled.) Tj ET'))
  assert.equal(out.note, 'ok')
  assert.equal(out.glyphRecall, null)
})

test('words separated on the page do not merge, and letters within a word do not split', async () => {
  // The failure mode that decided this task. Both directions must hold.
  const out = await extractPdf(onePage(
    'BT /F1 12 Tf 72 700 Td [(Mental) -400 (wellness)] TJ 0 -20 Td [(Wa) -20 (ll)] TJ ET'
  ))
  const text = out.strings.join(' ')
  assert.match(text, /Mental wellness/, 'a wide kern is a word break')
  assert.match(text, /Wall/, 'a narrow kern is letter kerning, not a break')
})

test('a vertical move starts a new string', async () => {
  const out = await extractPdf(onePage(
    'BT /F1 12 Tf 72 700 Td (First line) Tj 0 -20 Td (Second line) Tj ET'
  ))
  assert.equal(out.strings.length >= 2, true, out.strings.join(' | '))
  assert.match(out.strings[0], /First line/)
})

test('an encrypted pdf is refused with a reason rather than yielding garbage', async () => {
  const out = await extractPdf(makePdf([contentObj('BT (x) Tj ET')], { encrypt: true }))
  assert.equal(out.note, 'encrypted')
  assert.deepEqual(out.strings, [])
})

test('a pdf with no text layer reports no-text-layer, which is the scanned case', async () => {
  const out = await extractPdf(makePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'
  ]))
  assert.equal(out.note, 'no-text-layer')
  assert.deepEqual(out.strings, [])
  assert.equal(out.glyphRecall, null)
})

test('a truncated or malformed pdf resolves rather than throwing', async () => {
  for (const junk of ['', '%PDF-1.4', '%PDF-1.4\n1 0 obj\n<< /Length 99 >>\nstream\ntrunc']) {
    const out = await extractPdf(Buffer.from(junk, 'latin1'))
    assert.ok(Array.isArray(out.strings), `threw for ${JSON.stringify(junk)}`)
    assert.notEqual(out.note, 'ok')
  }
})

test('nothing is written to stdout or stderr while parsing', async () => {
  // pdfjs's legacy build warns about a missing @napi-rs/canvas and unpolyfilled
  // DOMMatrix/ImageData/Path2D on every load. Parent spec section 9 keeps
  // stdout ASCII and quiet, and a scan printing that noise would be unusable.
  const chunks = []
  const realOut = process.stdout.write.bind(process.stdout)
  const realErr = process.stderr.write.bind(process.stderr)
  process.stdout.write = (c) => { chunks.push(c); return true }
  process.stderr.write = (c) => { chunks.push(c); return true }
  try {
    await extractPdf(onePage('BT /F1 12 Tf (Quiet please.) Tj ET'))
  } finally {
    process.stdout.write = realOut
    process.stderr.write = realErr
  }
  assert.deepEqual(chunks, [], `pdfjs printed: ${chunks.join('')}`)
})

test('a concurrent write while a parse is in flight is not swallowed', async () => {
  // Fix round 1: extractPdf used to wrap its whole parse in a helper that
  // globally replaced process.stdout.write/process.stderr.write for the
  // parse's entire (arbitrarily long, multiply-async) duration. Anything
  // else writing to stdout during that window - another test's own output,
  // another caller entirely - was silently discarded. This pins the
  // property that actually matters: a write made by someone else while a
  // parse is in flight must reach the real handler untouched.
  const buf = onePage('BT /F1 12 Tf (Concurrent write check.) Tj ET')

  // Warm pdfjs's module cache first, via a normal call, so this assertion
  // is about the parse path itself - not about the bounded, one-time
  // import-suppression window inside pdfjs(), which is allowed to patch
  // stdout only for as long as the dynamic import takes.
  await extractPdf(buf)

  const chunks = []
  const originalWrite = process.stdout.write
  process.stdout.write = (chunk) => { chunks.push(chunk); return true }
  try {
    const parsing = extractPdf(buf)
    // extractPdf is now running through its own awaits (getDocument, one
    // getTextContent per page). A write issued right now, from outside it,
    // must land in our own handler, not a handler extractPdf installed.
    process.stdout.write('marker-from-outside-the-parse\n')
    await parsing
  } finally {
    process.stdout.write = originalWrite
  }

  assert.ok(
    chunks.some((c) => String(c).includes('marker-from-outside-the-parse')),
    `expected the concurrent write to reach the real handler untouched; got: ${JSON.stringify(chunks)}`
  )
})
