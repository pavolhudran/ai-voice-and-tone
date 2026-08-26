import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseYaml, stringifyYaml } from '../scripts/lib/yaml.mjs'

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
