import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mechanicalDiff } from '../scripts/diff.mjs'

test('an unchanged text reports no changes', () => {
  const result = mechanicalDiff('Your campaign is scheduled.', 'Your campaign is scheduled.')
  assert.equal(result.summary.added, 0)
  assert.equal(result.summary.removed, 0)
  assert.equal(result.summary.wordDelta, 0)
  assert.deepEqual(result.wordSwaps, [])
})

test('a single word substitution is reported as a swap', () => {
  const result = mechanicalDiff('We leverage the tool.', 'We use the tool.')
  assert.deepEqual(result.wordSwaps, [{ from: 'leverage', to: 'use' }])
  assert.equal(result.summary.added, 1)
  assert.equal(result.summary.removed, 1)
})

test('length shift is measured in words and percent', () => {
  const result = mechanicalDiff(
    'Your campaign is scheduled and will go out on Thursday at nine.',
    'Campaign scheduled.'
  )
  assert.equal(result.before.words, 12)
  assert.equal(result.after.words, 2)
  assert.equal(result.summary.wordDelta, -10)
  assert.equal(result.summary.wordDeltaPct, -83.33)
})

test('sentence counts and mean sentence length come along', () => {
  const result = mechanicalDiff('One. Two. Three.', 'One sentence only now.')
  assert.equal(result.before.sentences, 3)
  assert.equal(result.after.sentences, 1)
  assert.equal(result.after.meanSentenceLength, 4)
})

test('multi-word rewrites are changes but not swaps', () => {
  const result = mechanicalDiff('Please try again later.', 'Try again in a minute.')
  assert.ok(result.summary.added > 0)
  assert.ok(result.summary.removed > 0)
  assert.deepEqual(result.wordSwaps, [], 'a multi-token rewrite is for the model to classify')
})

test('empty input on either side does not throw', () => {
  assert.equal(mechanicalDiff('', 'Something new.').summary.removed, 0)
  assert.equal(mechanicalDiff('Something old.', '').summary.added, 0)
})
