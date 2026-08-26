import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countHits, rankRules } from '../scripts/lib/hits.mjs'

const lexicon = [
  { id: 'L01', confidence: 'derived', cells: { Avoid: 'leverage', Prefer: 'use' } },
  { id: 'L02', confidence: 'confirmed', cells: { Avoid: 'simply', Prefer: '—' } },
  { id: 'L03', confidence: 'confirmed', cells: { Avoid: 'utilize', Prefer: 'use' } }
]

test('hits are whole-word and case-insensitive', () => {
  const hits = countHits(
    ['Leverage the tool.', 'We simply leverage it.', 'Leveraged is a different word.'],
    lexicon
  )
  assert.equal(hits.get('L01'), 2, 'Leveraged must not count')
  assert.equal(hits.get('L02'), 1)
  assert.equal(hits.get('L03'), 0)
})

test('a mechanics rule counts only when it carries a Pattern', () => {
  const mechanics = [
    { id: 'M01', confidence: 'confirmed', cells: { Rule: 'no double spaces', Pattern: '\\s{2,}' } },
    { id: 'M02', confidence: 'confirmed', cells: { Rule: 'sentence case headings' } }
  ]
  const hits = countHits(['one  two', 'three  four'], mechanics)
  assert.equal(hits.get('M01'), 2)
  assert.equal(hits.get('M02'), 0)
})

test('an invalid pattern scores zero instead of throwing', () => {
  const hits = countHits(['anything'], [{ id: 'M09', confidence: 'assumed', cells: { Pattern: '([' } }])
  assert.equal(hits.get('M09'), 0)
})

test('ranking is hits desc, then confirmed first, then id', () => {
  const hits = new Map([['L01', 5], ['L02', 5], ['L03', 0]])
  assert.deepEqual(rankRules(lexicon, hits).map((r) => r.id), ['L02', 'L01', 'L03'])
})
