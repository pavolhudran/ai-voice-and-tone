import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractOffice, OFFICE_FORMATS, OFFICE_EXTRACTOR } from '../scripts/lib/office.mjs'
import {
  makeDocxFromBody, makeMinimalOdt, ODT_FIXTURE_TEXT,
  makeMinimalXlsx, XLSX_FIXTURE_TEXT,
  makeMinimalPptx, PPTX_FIXTURE_TEXT,
  makeMinimalOds, ODS_FIXTURE_TEXT,
  makeMinimalOdp, ODP_FIXTURE_TEXT
} from './helpers/officeFixtures.mjs'

const docx = (bodyXml) => makeDocxFromBody(bodyXml)

test('the extractor stamps its own identity for the index', () => {
  assert.equal(OFFICE_EXTRACTOR.name, 'officeparser')
  assert.match(OFFICE_EXTRACTOR.version, /^\d+\.\d+\.\d+$/)
})

test('every container format this plugin claims is routed', () => {
  assert.deepEqual([...OFFICE_FORMATS].sort(), ['docx', 'odp', 'ods', 'odt', 'pptx', 'xlsx'])
})

test('docx paragraphs stay separate, because paragraph count is a real metric', async () => {
  const buf = docx(`
    <w:p><w:r><w:t>Your campaign is scheduled.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Nice work.</w:t></w:r></w:p>`)
  const out = await extractOffice(buf, 'docx')

  assert.deepEqual(out.strings, ['Your campaign is scheduled.', 'Nice work.'])
  assert.equal(out.note, 'ok')
  assert.deepEqual(out.headings, [])
})

test('runs split mid-word are rejoined without a space', async () => {
  // Word splits single words across runs routinely. A joining space would
  // invent word boundaries and inflate wordCount - the corruption the quality
  // gate exists to catch.
  const out = await extractOffice(docx('<w:p><w:r><w:t>cam</w:t></w:r><w:r><w:t>paign</w:t></w:r></w:p>'), 'docx')
  assert.deepEqual(out.strings, ['campaign'])
})

test('diacritics and entities survive', async () => {
  const out = await extractOffice(
    docx('<w:p><w:r><w:t>Va&#353;e kampa&#328; &amp; podm&#237;nky</w:t></w:r></w:p>'), 'docx')
  assert.deepEqual(out.strings, ['Vaše kampaň & podmínky'])
})

test('an unreadable container rejects, so the caller can record a reason', async () => {
  await assert.rejects(() => extractOffice(Buffer.from('not a zip at all'), 'docx'))
})

test('a container with no text resolves to empty rather than rejecting', async () => {
  const out = await extractOffice(docx(''), 'docx')
  assert.deepEqual(out.strings, [])
  assert.equal(out.note, 'no-text-layer')
})

test('an unsupported format is refused by name', async () => {
  await assert.rejects(() => extractOffice(Buffer.alloc(4), 'keynote'), /unsupported office format/)
})

test('odt text extracts through the same adapter path as docx', async () => {
  const out = await extractOffice(makeMinimalOdt(), 'odt')
  assert.deepEqual(out.strings, [ODT_FIXTURE_TEXT])
  assert.equal(out.note, 'ok')
})

test('xlsx cell text extracts', async () => {
  const out = await extractOffice(makeMinimalXlsx(), 'xlsx')
  assert.deepEqual(out.strings, [XLSX_FIXTURE_TEXT])
  assert.equal(out.note, 'ok')
})

test('pptx slide text extracts', async () => {
  const out = await extractOffice(makeMinimalPptx(), 'pptx')
  assert.deepEqual(out.strings, [PPTX_FIXTURE_TEXT])
  assert.equal(out.note, 'ok')
})

test('ods cell text extracts', async () => {
  const out = await extractOffice(makeMinimalOds(), 'ods')
  assert.deepEqual(out.strings, [ODS_FIXTURE_TEXT])
  assert.equal(out.note, 'ok')
})

test('odp slide text extracts', async () => {
  const out = await extractOffice(makeMinimalOdp(), 'odp')
  assert.deepEqual(out.strings, [ODP_FIXTURE_TEXT])
  assert.equal(out.note, 'ok')
})
