import { test } from 'node:test'
import assert from 'node:assert/strict'
import { globToRegExp, matchesAny } from '../scripts/lib/glob.mjs'

test('* stops at a path separator, ** crosses it', () => {
  assert.ok(globToRegExp('content/*.md').test('content/a.md'))
  assert.ok(!globToRegExp('content/*.md').test('content/nested/a.md'))
  assert.ok(globToRegExp('content/**/*.md').test('content/a.md'))
  assert.ok(globToRegExp('content/**/*.md').test('content/deep/nested/a.md'))
  assert.ok(globToRegExp('node_modules/**').test('node_modules/pkg/index.js'))
  assert.ok(globToRegExp('**/*.json').test('locales/en/common.json'))
})

test('braces expand and ? matches one non-separator character', () => {
  const re = globToRegExp('src/*.{md,mdx}')
  assert.ok(re.test('src/a.md'))
  assert.ok(re.test('src/a.mdx'))
  assert.ok(!re.test('src/a.txt'))
  assert.ok(globToRegExp('v?.md').test('v1.md'))
  assert.ok(!globToRegExp('v?.md').test('v12.md'))
})

test('regex metacharacters in the pattern are literal', () => {
  assert.ok(globToRegExp('docs/a.b.md').test('docs/a.b.md'))
  assert.ok(!globToRegExp('docs/a.b.md').test('docs/axbxmd'))
  assert.ok(globToRegExp('a+b/c.md').test('a+b/c.md'))
})

test('matchesAny short-circuits over a list', () => {
  assert.ok(matchesAny('dist/app.js', ['node_modules/**', 'dist/**']))
  assert.ok(!matchesAny('src/app.js', ['node_modules/**', 'dist/**']))
  assert.ok(!matchesAny('src/app.js', []))
})
