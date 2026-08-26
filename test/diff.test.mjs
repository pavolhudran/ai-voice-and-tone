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

// The frontmatter block below is copied verbatim from the draft shape that
// skills/voice-and-tone/references/write-flow.md mandates for every file in
// <KB>/.drafts/, which is exactly what :learn hands to --draft.
const DRAFT_FRONTMATTER = [
  '---',
  'generated: 2026-08-26T09:41:00.000Z',
  'profile: default',
  'context: system-error',
  'state: frustrated',
  'cell: T-system-error/frustrated',
  'cell_source: authored',
  'locale: en',
  'kb_version: 0.3.1',
  '---',
  ''
].join('\n')

const DRAFT_BODY = "That file didn't upload - it's over the 25 MB limit. Try a smaller one.\n"
const FINAL_BODY = "That file didn't upload - it's over the 25 MB limit. Try a much smaller one.\n"

test('a draft is measured on its body, not on its YAML frontmatter', () => {
  const withMatter = mechanicalDiff(DRAFT_FRONTMATTER + DRAFT_BODY, FINAL_BODY)
  const withoutMatter = mechanicalDiff(DRAFT_BODY, FINAL_BODY)

  // The only real edit is one inserted word. Before the fix the frontmatter's
  // own tokens counted as body words on the draft side and as removals against
  // the final, reporting a large negative wordDelta on a one-word insertion.
  assert.deepEqual(withMatter.before, withoutMatter.before)
  assert.deepEqual(withMatter.summary, withoutMatter.summary)
  assert.equal(withMatter.summary.removed, 0, 'nothing was removed from the body')
  assert.equal(withMatter.summary.added, 1)
  assert.equal(withMatter.summary.wordDelta, 1)
  assert.equal(withMatter.before.words, 14, 'the 8-field frontmatter block contributes no words')
  assert.equal(withMatter.before.sentences, 2)
  assert.deepEqual(withMatter.changes.filter((c) => c.type === 'add'), [{ type: 'add', tokens: ['much'] }])
  assert.ok(
    !JSON.stringify(withMatter.changes).includes('kb_version'),
    'no frontmatter key may appear as a diffed token'
  )
})

test('frontmatter on the final side is stripped too, not reported as an insertion', () => {
  // :learn is routinely handed a final that is the same file edited in place,
  // frontmatter block and all. Stripping only the draft would mirror the bug.
  const result = mechanicalDiff(DRAFT_FRONTMATTER + DRAFT_BODY, DRAFT_FRONTMATTER + FINAL_BODY)
  assert.equal(result.summary.added, 1)
  assert.equal(result.summary.removed, 0)
  assert.equal(result.before.sentences, 2, 'sentence count comes from the body alone')
})

test('a draft with no frontmatter still diffs correctly', () => {
  const result = mechanicalDiff('We leverage the tool.', 'We use the tool.')
  assert.deepEqual(result.wordSwaps, [{ from: 'leverage', to: 'use' }])
  assert.equal(result.before.words, 4)
  assert.equal(result.summary.wordDelta, 0)
})

test('a body that merely opens with a horizontal rule is not mistaken for frontmatter', () => {
  // The frontmatter regex needs a closing --- fence; a lone rule has none, so
  // the whole document must survive as body text.
  const result = mechanicalDiff('---\n\nYour campaign is scheduled.\n', 'Your campaign is scheduled.\n')
  assert.equal(result.before.words, result.after.words)
})
