/**
 * Minimal, hand-built .docx and .odt fixtures for exercising the vendored
 * officeparser bundle in tests, without depending on a real file on disk or
 * a platform tool (e.g. macOS's `textutil`) to produce one.
 *
 * Both formats are ZIP archives. This writes the smallest ZIP officeparser
 * will actually recognise and parse:
 *  - docx: a `[Content_Types].xml` declaring the WordprocessingML main part,
 *    plus `word/document.xml` holding one paragraph of text.
 *  - odt: a `mimetype` entry declaring the ODF text package, plus
 *    `content.xml` holding one paragraph of text.
 *
 * Entries are stored uncompressed (ZIP method 0), so no deflate
 * implementation is needed - just a correct CRC-32 of the raw bytes.
 */

function crc32 (buf) {
  let crc = ~0
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
    }
  }
  return (~crc) >>> 0
}

function u16 (n) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n, 0)
  return b
}

function u32 (n) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n, 0)
  return b
}

/**
 * Builds a minimal, valid, uncompressed ZIP archive from a list of entries.
 * @param {Array<{name: string, data: Buffer}>} entries - ZIP entry names use
 *   forward slashes always, per the ZIP/OOXML/ODF specs - not a filesystem path.
 */
function makeZip (entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)

    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBuf.length), u16(0)
    ])
    const local = Buffer.concat([localHeader, nameBuf, data])
    localParts.push(local)

    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u32(0),
      u32(offset)
    ])
    centralParts.push(Buffer.concat([centralHeader, nameBuf]))
    offset += local.length
  }

  const centralDir = Buffer.concat(centralParts)
  const centralStart = offset
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralDir.length), u32(centralStart), u16(0)
  ])

  return Buffer.concat([...localParts, centralDir, eocd])
}

export const DOCX_FIXTURE_TEXT = 'Hello from a vendored docx fixture.'
export const ODT_FIXTURE_TEXT = 'Hello from a vendored odt fixture.'
export const XLSX_FIXTURE_TEXT = 'Hello from a vendored xlsx fixture.'
export const PPTX_FIXTURE_TEXT = 'Hello from a vendored pptx fixture.'
export const ODS_FIXTURE_TEXT = 'Hello from a vendored ods fixture.'
export const ODP_FIXTURE_TEXT = 'Hello from a vendored odp fixture.'

/**
 * Builds a minimal docx from raw `<w:body>` inner XML, so a caller can shape
 * paragraph boundaries, split runs, or entities directly rather than through
 * a single plain-text paragraph.
 */
export function makeDocxFromBody (bodyXml) {
  const contentTypes = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Override PartName="/word/document.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>'
  const document = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${bodyXml}</w:body>` +
    '</w:document>'

  return makeZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') }
  ])
}

export function makeMinimalDocx (text = DOCX_FIXTURE_TEXT) {
  return makeDocxFromBody(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
}

export function makeMinimalOdt (text = ODT_FIXTURE_TEXT) {
  const content = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<office:document-content ' +
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">' +
    `<office:body><office:text><text:p>${text}</text:p></office:text></office:body>` +
    '</office:document-content>'

  return makeZip([
    { name: 'mimetype', data: Buffer.from('application/vnd.oasis.opendocument.text', 'utf8') },
    { name: 'content.xml', data: Buffer.from(content, 'utf8') }
  ])
}

export function makeMinimalXlsx (text = XLSX_FIXTURE_TEXT) {
  const contentTypes = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Override PartName="/xl/workbook.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '</Types>'
  const workbook = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheets><sheet name="Sheet1" sheetId="1" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></sheets>' +
    '</workbook>'
  const sheet1 = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row></sheetData>` +
    '</worksheet>'

  return makeZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet1, 'utf8') }
  ])
}

export function makeMinimalPptx (text = PPTX_FIXTURE_TEXT) {
  const contentTypes = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Override PartName="/ppt/presentation.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '</Types>'
  const presentation = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>'
  const slide1 = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    `<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>` +
    '</p:sld>'

  return makeZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: 'ppt/presentation.xml', data: Buffer.from(presentation, 'utf8') },
    { name: 'ppt/slides/slide1.xml', data: Buffer.from(slide1, 'utf8') }
  ])
}

export function makeMinimalOds (text = ODS_FIXTURE_TEXT) {
  const content = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<office:document-content ' +
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">' +
    '<office:body><office:spreadsheet><table:table table:name="Sheet1">' +
    `<table:table-row><table:table-cell office:value-type="string"><text:p>${text}</text:p></table:table-cell></table:table-row>` +
    '</table:table></office:spreadsheet></office:body></office:document-content>'

  return makeZip([
    { name: 'mimetype', data: Buffer.from('application/vnd.oasis.opendocument.spreadsheet', 'utf8') },
    { name: 'content.xml', data: Buffer.from(content, 'utf8') }
  ])
}

export function makeMinimalOdp (text = ODP_FIXTURE_TEXT) {
  const content = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<office:document-content ' +
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">' +
    '<office:body><office:presentation><draw:page draw:name="Slide1">' +
    `<draw:frame><draw:text-box><text:p>${text}</text:p></draw:text-box></draw:frame>` +
    '</draw:page></office:presentation></office:body></office:document-content>'

  return makeZip([
    { name: 'mimetype', data: Buffer.from('application/vnd.oasis.opendocument.presentation', 'utf8') },
    { name: 'content.xml', data: Buffer.from(content, 'utf8') }
  ])
}
