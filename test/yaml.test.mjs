import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYaml, stringifyYaml } from '../scripts/lib/yaml.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('parses the shape of config.yml', () => {
  const src = [
    'version: 1',
    'kb_version: 0.1.0',
    'profiles:',
    '  default:',
    '    name: "Acme"',
    '    primary_locale: en',
    '    locales: [en, cs]',
    'scan:',
    '  include:',
    '    - "content/**/*.md"',
    '    - "locales/**/*.json"',
    '  exclude: ["node_modules/**"]',
    'runtime:',
    '  node: detected   # probed once',
    'thresholds:',
    '  corroboration: 2',
    '  derived_min_samples: 5'
  ].join('\n')

  const got = parseYaml(src)
  assert.equal(got.version, 1)
  assert.equal(got.kb_version, '0.1.0')
  assert.equal(got.profiles.default.name, 'Acme')
  assert.deepEqual(got.profiles.default.locales, ['en', 'cs'])
  assert.deepEqual(got.scan.include, ['content/**/*.md', 'locales/**/*.json'])
  assert.deepEqual(got.scan.exclude, ['node_modules/**'])
  assert.equal(got.runtime.node, 'detected')
  assert.equal(got.thresholds.corroboration, 2)
})

test('types scalars without swallowing version-like strings', () => {
  const got = parseYaml('a: 1\nb: true\nc: false\nd: ~\ne:\nf: 0.1.0\ng: "2"')
  assert.equal(got.a, 1)
  assert.equal(got.b, true)
  assert.equal(got.c, false)
  assert.equal(got.d, null)
  assert.equal(got.e, null)
  assert.equal(got.f, '0.1.0')
  assert.equal(got.g, '2')
})

test('strips comments but keeps # inside quotes', () => {
  const got = parseYaml('a: plain # trailing\nb: "has # hash"\n# whole line\nc: 3')
  assert.equal(got.a, 'plain')
  assert.equal(got.b, 'has # hash')
  assert.equal(got.c, 3)
})

test('block scalars fold and preserve, and end at the dedent', () => {
  const folded = parseYaml('a: 1\nb: >\n  one\n  two\nc: 3\n')
  assert.equal(folded.b, 'one two', 'a folded scalar joins its lines with spaces')
  assert.equal(folded.c, 3, 'the block ends where the indentation drops')

  const literal = parseYaml('a: |\n  one\n  two\n')
  assert.equal(literal.a, 'one\ntwo', 'a literal scalar keeps its newlines')
})

test('folded scalars carry skill frontmatter, blank line and all', () => {
  const src = [
    'name: voice-discovery',
    'description: >',
    '  WHEN: no knowledge base exists yet.',
    '  WHAT: runs the discovery pipeline.',
    'tools: Read, Glob, Grep'
  ].join('\n')
  const got = parseYaml(src)
  assert.equal(got.name, 'voice-discovery')
  assert.equal(got.description, 'WHEN: no knowledge base exists yet. WHAT: runs the discovery pipeline.')
  assert.equal(got.tools, 'Read, Glob, Grep')
})

test('throws with a line number on unsupported syntax', () => {
  assert.throws(() => parseYaml('a: 1\n\tb: 2'), /line 2/)
  assert.throws(() => parseYaml('a: &anchor 1'), /line 1/)
  assert.throws(() => parseYaml('a: 1\n--- \nb: 2'), /line 2/)
})

test('a quoted plain scalar sequence item is not mistaken for a map', () => {
  const got = parseYaml('items:\n  - "note: important"\n  - plain\n')
  assert.deepEqual(got.items, ['note: important', 'plain'])
})

test('a quoted key fragment followed by trailing unquoted text throws rather than producing a mangled key', () => {
  // hasUnquotedColonSpace correctly reads this as a map-opening line (the
  // "then: value" colon is outside any quote), but the key text itself -
  // `"quoted" then` - is not a single well-formed token: a leading quote
  // with no matching close at the end. Silently stripping just the leading
  // quote (the old behaviour) produced a key with a stray quote character
  // baked into it instead of surfacing the malformed input.
  assert.throws(() => parseYaml('items:\n  - "quoted" then: value\n'), /line 2/)
  // A lone, unmatched quote character anywhere in an otherwise-plain key is
  // the same defect, without a sequence dash involved.
  assert.throws(() => parseYaml('a "b: 1\n'), /line 1/)
})

test('a sequence of block maps parses each dash into its own object, fields aligned under it', () => {
  const src = [
    'sources:',
    '  - id: s02',
    '    kind: inbox',
    '    path: sources/',
    '    label: Inbox',
    '  - id: s03',
    '    kind: url',
    '    url: https://acme.com/about',
    '    label: ~'
  ].join('\n')
  const got = parseYaml(src)
  assert.deepEqual(got.sources, [
    { id: 's02', kind: 'inbox', path: 'sources/', label: 'Inbox' },
    { id: 's03', kind: 'url', url: 'https://acme.com/about', label: null }
  ])
})

test('a sequence-of-maps item may itself carry a nested sequence field', () => {
  const src = [
    'sources:',
    '  - id: s01',
    '    kind: project',
    '    include:',
    '      - "README.md"',
    '    exclude: []'
  ].join('\n')
  const got = parseYaml(src)
  assert.deepEqual(got.sources, [
    { id: 's01', kind: 'project', include: ['README.md'], exclude: [] }
  ])
})

test('stringifyYaml round-trips a sequence of maps through parseYaml', () => {
  const value = {
    sources: [
      { id: 's02', kind: 'inbox', path: 'sources/', label: 'Inbox' },
      { id: 's03', kind: 'url', url: 'https://acme.com/about', label: null, retain: 'none' }
    ]
  }
  assert.deepEqual(parseYaml(stringifyYaml(value)), value)
})

test('block scalars support chomping indicators', () => {
  const clip = parseYaml('a: |\n  one\n  two\n')
  assert.equal(clip.a, 'one\ntwo', '| clips: single trailing newline is absent')

  const keep = parseYaml('a: |+\n  one\n  two\n')
  assert.equal(keep.a, 'one\ntwo\n', '|+ keeps the trailing newline')

  const strip = parseYaml('a: >-\n  one\n  two\n')
  assert.equal(strip.a, 'one two', '>- strips the trailing newline')
})

test('round-trips through stringify', () => {
  const value = {
    version: 1,
    profiles: { default: { name: 'Acme', locales: ['en', 'cs'] } },
    thresholds: { corroboration: 2 }
  }
  assert.deepEqual(parseYaml(stringifyYaml(value)), value)
})

test('stringify ends with exactly one newline and uses two-space indent', () => {
  const out = stringifyYaml({ a: { b: 1 } })
  assert.equal(out, 'a:\n  b: 1\n')
})

test('an empty object as a bare value round-trips as {}, not as a lost key', () => {
  const value = { empty_map: {}, sibling: 1 }
  const out = stringifyYaml(value)
  assert.match(out, /empty_map: \{\}/)
  assert.deepEqual(parseYaml(out), value)
})

test('an empty object as a sequence item round-trips without collapsing the array', () => {
  const value = { xs: [{}] }
  const out = stringifyYaml(value)
  assert.match(out, /- \{\}/)
  assert.deepEqual(parseYaml(out), value, 'the array must survive, not disappear into a null scalar')
})

test('an empty object sits alongside a real one in the same sequence', () => {
  const value = { xs: [{}, { id: 's01' }] }
  assert.deepEqual(parseYaml(stringifyYaml(value)), value)
})

test('property: parseYaml(stringifyYaml(x)) deep-equals x for representative shapes', () => {
  const shapes = [
    { version: 1, kb_version: '0.1.0' },
    { profiles: { default: { name: 'Acme', primary_locale: 'en', locales: ['en', 'cs'] } } },
    { scan: { include: ['content/**/*.md'], exclude: [] } },
    {
      sources: [
        { id: 's01', kind: 'project', include: ['README.md'], exclude: [] },
        { id: 's02', kind: 'inbox', path: 'sources/', label: 'Inbox' },
        { id: 's03', kind: 'url', url: 'https://acme.com/about', label: null, retain: 'none' }
      ]
    },
    { plain_strings: ['a', 'b', 'c'] },
    { empty_string: '', nested: { a: '', b: [''] } },
    { xs: [{}] },
    { empty_map: {} }
  ]
  for (const shape of shapes) {
    assert.deepEqual(parseYaml(stringifyYaml(shape)), shape, `round-trip failed for ${JSON.stringify(shape)}`)
  }
})

test('property: templates/kb/config.yml, as it actually ships, round-trips through parse/stringify/parse', () => {
  const raw = readFileSync(path.join(ROOT, 'templates', 'kb', 'config.yml'), 'utf8')
  const parsed = parseYaml(raw)
  const roundTripped = parseYaml(stringifyYaml(parsed))
  assert.deepEqual(roundTripped, parsed)
})
