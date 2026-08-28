import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WIDTH, MIN_WIDTH, MAX_WIDTH, clampWidth, rule, truncate, bar, pad, row } from '../scripts/lib/render.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\x00-\x7F]/

test('the shipped default width is 72 and clamps to 60..120', () => {
  assert.equal(WIDTH, 72)
  assert.equal(clampWidth(72), 72)
  assert.equal(clampWidth(10), MIN_WIDTH)
  assert.equal(clampWidth(9999), MAX_WIDTH)
  assert.equal(clampWidth(undefined), WIDTH, 'an absent width falls back to the default')
  assert.equal(clampWidth('80'), WIDTH, 'a non-integer falls back rather than producing NaN padding')
})

test('rule spans the full width and is bounded by plus signs', () => {
  assert.equal(rule('=', 10), '+========+')
  assert.equal(rule('-', 10), '+--------+')
  assert.equal(rule('=', 10).length, 10)
})

test('truncate marks elision with three dots and never exceeds the width', () => {
  assert.equal(truncate('short', 10), 'short')
  assert.equal(truncate('a-very-long-brand-name', 10), 'a-very-...')
  assert.equal(truncate('a-very-long-brand-name', 10).length, 10)
  assert.equal(truncate('abcdef', 3), 'abc', 'below four columns there is no room for an ellipsis')
})

test('bar fills proportionally and never overruns its width', () => {
  assert.equal(bar(5, 10, 10), '#####     ')
  assert.equal(bar(10, 10, 10), '##########')
  assert.equal(bar(0, 10, 10), '          ')
  assert.equal(bar(20, 10, 10), '##########', 'a value over max saturates instead of overflowing')
  assert.equal(bar(5, 10, 10).length, 10)
})

test('bar with a zero or negative max renders empty rather than dividing by zero', () => {
  assert.equal(bar(5, 0, 6), '      ')
  assert.equal(bar(5, -1, 6), '      ')
  assert.ok(!bar(5, 0, 6).includes('NaN'))
})

test('row places a right-hand value flush against the width', () => {
  assert.equal(row('left', 'right', 20), 'left           right')
  assert.equal(row('left', 'right', 20).length, 20)
})

test('row degrades without throwing when the two halves cannot both fit', () => {
  const out = row('a-long-left-label', 'a-long-right-value', 20)
  assert.equal(out.length, 20)
  assert.ok(!NON_ASCII.test(out))
})

test('every primitive emits ASCII only', () => {
  const samples = [rule('=', 72), bar(3, 7, 20), truncate('x'.repeat(99), 30), pad('hi', 20), row('a', 'b', 40)]
  for (const sample of samples) assert.ok(!NON_ASCII.test(sample), `non-ASCII in ${JSON.stringify(sample)}`)
})

test('render.mjs performs no file I/O', () => {
  // The collector owns every filesystem read. A renderer that can read a file
  // can render something the state object never carried, which is exactly the
  // drift the generated-dashboard decision (spec 1.2) exists to prevent.
  const source = readFileSync(path.join(root, 'scripts', 'lib', 'render.mjs'), 'utf8')
  assert.ok(!/from 'node:fs'/.test(source), 'render.mjs must not import node:fs')
  assert.ok(!/require\(['"]fs['"]\)/.test(source))
})
