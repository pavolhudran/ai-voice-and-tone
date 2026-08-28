import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractOffice, OFFICE_FORMATS, OFFICE_EXTRACTOR } from '../scripts/lib/office.mjs'
import {
  makeDocxFromBody, makeMinimalOdt, makeOdtFromBody, ODT_FIXTURE_TEXT,
  makeMinimalXlsx, XLSX_FIXTURE_TEXT,
  makeMinimalPptx, makePptxFromSpTree, PPTX_FIXTURE_TEXT,
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

test('a docx Heading1 paragraph is surfaced as a heading, and stays in strings too', async () => {
  const buf = docx(
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Section One</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Body text.</w:t></w:r></w:p>')
  const out = await extractOffice(buf, 'docx')

  assert.deepEqual(out.headings, ['Section One'])
  assert.deepEqual(out.strings, ['Section One', 'Body text.'])
})

test('an odt text:h is a structural heading, not a style-name guess', async () => {
  const buf = makeOdtFromBody('<text:h text:outline-level="1">Section One</text:h><text:p>Body text.</text:p>')
  const out = await extractOffice(buf, 'odt')

  assert.deepEqual(out.headings, ['Section One'])
  assert.deepEqual(out.strings, ['Section One', 'Body text.'])
})

test('a pptx title placeholder is surfaced as a heading', async () => {
  const buf = makePptxFromSpTree(
    '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
    '<p:txBody><a:p><a:r><a:t>Section One</a:t></a:r></a:p></p:txBody></p:sp>' +
    '<p:sp><p:txBody><a:p><a:r><a:t>Body text.</a:t></a:r></a:p></p:txBody></p:sp>')
  const out = await extractOffice(buf, 'pptx')

  assert.deepEqual(out.headings, ['Section One'])
  assert.deepEqual(out.strings, ['Section One', 'Body text.'])
})
