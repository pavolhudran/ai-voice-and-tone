import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractStrings, extractHeadings, formatFor } from '../scripts/lib/extract.mjs'

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

test('hex-colour filter drops colours but keeps real words spelled from a-f', () => {
  const json = JSON.stringify({ word: 'decade', color: '#4A90D9' })
  const { strings } = extractStrings('/x/en.json', json)
  assert.ok(strings.includes('decade'))
  assert.ok(!strings.includes('#4A90D9'))
})

test('ALL-CAPS filter keeps microcopy labels but drops identifier-like tokens', () => {
  const json = JSON.stringify({ button: 'SAVE', constant: 'MAX_RETRIES' })
  const { strings } = extractStrings('/x/en.json', json)
  assert.ok(strings.includes('SAVE'))
  assert.ok(!strings.includes('MAX_RETRIES'))
})

test('path filter catches single-leading-slash route strings', () => {
  const json = JSON.stringify({ route: '/docs/setup' })
  const { strings } = extractStrings('/x/en.json', json)
  assert.ok(!strings.includes('/docs/setup'))
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
