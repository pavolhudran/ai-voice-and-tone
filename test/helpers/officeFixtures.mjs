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

export function makeMinimalDocx (text = DOCX_FIXTURE_TEXT) {
  const contentTypes = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Override PartName="/word/document.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>'
  const document = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>` +
    '</w:document>'

  return makeZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') }
  ])
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
