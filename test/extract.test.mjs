import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractStrings, extractHeadings, formatFor, isBinaryFormat, BINARY_EXTENSIONS } from '../scripts/lib/extract.mjs'
import { OFFICE_FORMATS } from '../scripts/lib/office.mjs'

test('markdown drops code and frontmatter, keeps prose, alt text, and link text', () => {
  const md = [
    '---',
    'title: Ignored',
    '---',
    '# Schedule a campaign',
    '',
    'Your campaign is scheduled. Read the [setup guide](/docs/setup).',
    '',
    '```js',
    'const secret = 1',
    '```',
    '',
    '- First item',
    '- Second item',
    '',
    '![A calendar icon](/img/cal.png)',
    '',
    'Use `npm install` first.'
  ].join('\n')

  const { format, strings } = extractStrings('/x/a.md', md)
  assert.equal(format, 'markdown')
  assert.ok(strings.includes('Schedule a campaign'))
  assert.ok(strings.some((s) => s.includes('Read the setup guide.')))
  assert.ok(strings.includes('First item'))
  assert.ok(strings.includes('Second item'))
  assert.ok(strings.includes('A calendar icon'))
  assert.ok(!strings.some((s) => s.includes('const secret')))
  assert.ok(!strings.some((s) => s.includes('title: Ignored')))
  assert.ok(strings.some((s) => s === 'Use first.'))
})

test('markdown keeps table cell text but not the separator row', () => {
  const md = '| Avoid | Prefer |\n|---|---|\n| leverage | use |'
  const { strings } = extractStrings('/x/a.md', md)
  assert.ok(strings.includes('leverage'))
  assert.ok(strings.includes('Prefer'))
  assert.ok(!strings.some((s) => s.includes('---')))
})

test('json takes values not keys, and drops non-copy values', () => {
  const json = JSON.stringify({
    save: 'Save',
    nested: { greeting: 'Hi there', url: 'https://example.com', color: '#4A90D9' },
    count: 3,
    empty: '',
    list: ['Delete', 'Cancel']
  })
  const { format, strings } = extractStrings('/x/en.json', json)
  assert.equal(format, 'json')
  assert.deepEqual(strings.sort(), ['Cancel', 'Delete', 'Hi there', 'Save'])
})

test('yaml takes values, and falls back to a line scan on unsupported syntax', () => {
  assert.deepEqual(extractStrings('/x/en.yml', 'save: Save\nnested:\n  hi: Hi there').strings.sort(),
    ['Hi there', 'Save'])
  // Anchors are outside the YAML subset; the line-scan fallback still finds copy.
  const messy = 'save: Save\nalias: &a Reuse me\n'
  assert.ok(extractStrings('/x/en.yml', messy).strings.includes('Save'))
})

test('po prefers a non-empty msgstr, falls back to msgid, skips the header', () => {
  const po = [
    'msgid ""',
    'msgstr "Content-Type: text/plain"',
    '',
    'msgid "Save"',
    'msgstr "Uložit"',
    '',
    'msgid "Your campaign is scheduled."',
    'msgstr ""'
  ].join('\n')
  const { format, strings } = extractStrings('/x/cs.po', po)
  assert.equal(format, 'po')
  assert.deepEqual(strings, ['Uložit', 'Your campaign is scheduled.'])
})

test('html keeps text nodes and alt attributes, drops script and style', () => {
  const html = [
    '<style>.a{color:red}</style>',
    '<script>var x = 1</script>',
    '<h1>Schedule a campaign</h1>',
    '<p>All set &amp; ready.</p>',
    '<img alt="A calendar icon" src="/c.png">'
  ].join('\n')
  const { format, strings } = extractStrings('/x/a.html', html)
  assert.equal(format, 'html')
  assert.ok(strings.includes('Schedule a campaign'))
  assert.ok(strings.includes('All set & ready.'))
  assert.ok(strings.includes('A calendar icon'))
  assert.ok(!strings.some((s) => s.includes('color:red')))
  assert.ok(!strings.some((s) => s.includes('var x')))
})

test('headings come from markdown hashes and html heading tags', () => {
  assert.deepEqual(
    extractHeadings('/x/a.md', '# Schedule a campaign\n\ntext\n\n## Set Up Billing\n'),
    ['Schedule a campaign', 'Set Up Billing']
  )
  assert.deepEqual(
    extractHeadings('/x/a.html', '<h1>Reports</h1><h2>Set Up Billing</h2>'),
    ['Reports', 'Set Up Billing']
  )
  assert.deepEqual(extractHeadings('/x/en.json', '{"a":"b"}'), [])
})

test('unsupported extensions are recognised as such, not guessed at', () => {
  assert.equal(formatFor('/x/app.tsx'), null)
  assert.deepEqual(extractStrings('/x/app.tsx', 'const a = "Save"'), { format: null, strings: [] })
})

// --- Fix round 1: filter-layer defects found in review ---

test('hex-colour filter drops bare/hash colours but keeps real words and digit-bearing abbreviations spelled from a-f', () => {
  const kept = { word: 'decade', word2: 'facade', abbrev: 'B2B', abbrev2: 'E2E', abbrev3: '2FA' }
  const dropped = { hash: '#4A90D9', bare: '4A90D9', short: 'ff0000', shortHash: '#fff' }
  const { strings: keptStrings } = extractStrings('/x/en.json', JSON.stringify(kept))
  const { strings: droppedStrings } = extractStrings('/x/en.json', JSON.stringify(dropped))
  for (const word of Object.values(kept)) assert.ok(keptStrings.includes(word), `expected "${word}" to survive`)
  for (const word of Object.values(dropped)) assert.ok(!droppedStrings.includes(word), `expected "${word}" to be filtered`)
})

test('ALL-CAPS filter keeps microcopy labels and digit-bearing abbreviations, but drops SCREAMING_SNAKE identifiers', () => {
  const kept = { button: 'SAVE', quarter: 'Q4', model: 'P2P', locale: 'I18N', proto: 'HTTP2', hash: 'SHA256', seo: 'SEO', api: 'API' }
  const dropped = { constant: 'MAX_RETRIES', err: 'ERROR_404', secret: 'API_KEY', header: 'X_TOTAL_COUNT' }
  const { strings: keptStrings } = extractStrings('/x/en.json', JSON.stringify(kept))
  const { strings: droppedStrings } = extractStrings('/x/en.json', JSON.stringify(dropped))
  for (const word of Object.values(kept)) assert.ok(keptStrings.includes(word), `expected "${word}" to survive`)
  for (const word of Object.values(dropped)) assert.ok(!droppedStrings.includes(word), `expected "${word}" to be filtered`)
})

test('path filter catches leading-slash and dot-slash paths, but keeps prose with an embedded slash', () => {
  const json = JSON.stringify({
    route: '/docs/setup',
    rel: './x',
    parent: '../x',
    cdn: '//cdn/x',
    prose: 'Use A/B testing to compare campaigns.'
  })
  const { strings } = extractStrings('/x/en.json', json)
  assert.ok(!strings.includes('/docs/setup'))
  assert.ok(!strings.includes('./x'))
  assert.ok(!strings.includes('../x'))
  assert.ok(!strings.includes('//cdn/x'))
  assert.ok(strings.includes('Use A/B testing to compare campaigns.'))
})

test('html captures single-quoted alt attributes as well as double-quoted', () => {
  const html = "<img alt='A calendar icon' src='/c.png'>"
  const { strings } = extractStrings('/x/a.html', html)
  assert.ok(strings.includes('A calendar icon'))
})

test('extractHeadings strips a BOM before matching the first heading', () => {
  const md = '\uFEFF# Schedule a campaign\n'
  assert.deepEqual(extractHeadings('/x/a.md', md), ['Schedule a campaign'])
})

// --- Task 7: RTF, subtitles, CSV/TSV, and the format registry ---

test('BINARY_EXTENSIONS agrees exactly with office.mjs OFFICE_FORMATS, plus pdf', () => {
  // office.mjs and extract.mjs are maintained separately; nothing else forces
  // their two format lists to stay in sync. If they drift, a real file
  // resolves to a format neither table's caller can act on.
  const entries = Object.entries(BINARY_EXTENSIONS)
  const officeEntries = entries.filter(([ext]) => ext !== '.pdf')
  assert.deepEqual(new Set(officeEntries.map(([, format]) => format)), OFFICE_FORMATS)
  assert.equal(officeEntries.length, OFFICE_FORMATS.size)
  for (const [ext, format] of officeEntries) assert.equal(ext, `.${format}`)
  assert.equal(BINARY_EXTENSIONS['.pdf'], 'pdf')
})

test('the format registry resolves container formats and marks them binary', () => {
  for (const [file, format] of [
    ['/a/b/guide.docx', 'docx'], ['/a/b/deck.PPTX', 'pptx'], ['/a/b/data.xlsx', 'xlsx'],
    ['/a/b/notes.odt', 'odt'], ['/a/b/slides.odp', 'odp'], ['/a/b/sheet.ods', 'ods'],
    ['/a/b/brand.pdf', 'pdf']
  ]) {
    assert.equal(formatFor(file), format, file)
    assert.equal(isBinaryFormat(formatFor(file)), true, file)
  }
})

test('the new text formats resolve and are not binary', () => {
  for (const [file, format] of [
    ['/a/b/notes.rtf', 'rtf'], ['/a/b/talk.vtt', 'subtitles'], ['/a/b/talk.srt', 'subtitles'],
    ['/a/b/strings.csv', 'csv'], ['/a/b/strings.tsv', 'tsv']
  ]) {
    assert.equal(formatFor(file), format, file)
    assert.equal(isBinaryFormat(formatFor(file)), false, file)
  }
})

test('a container extension never reaches the text extractor', () => {
  // extractStrings takes decoded text. A container format reaching it means
  // the caller already read a PDF or an Office file as UTF-8 - a caller bug,
  // not a normal outcome - so it throws rather than returning the mojibake
  // that would silently poison every metric downstream while looking like
  // real, if sparse, copy. This also keeps such a bug loud: a corpus walker
  // that let one through would otherwise see an empty strings array and drop
  // the file with no trace, the exact silent-vanish failure the `skipped`
  // out-parameter exists to prevent.
  assert.throws(() => extractStrings('/a/b/guide.pdf', 'whatever'), /container format/)
})

test('rtf, subtitles and csv route through extractStrings', () => {
  assert.deepEqual(
    extractStrings('/a/b/x.csv', 'label,value\nSave changes,1\n').strings,
    ['label', 'value', 'Save changes']
  )
  assert.deepEqual(
    extractStrings('/a/b/x.srt', '1\n00:00:01,000 --> 00:00:02,000\nHello.\n').strings,
    ['Hello.']
  )
})
