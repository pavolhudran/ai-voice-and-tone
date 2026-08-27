import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  statsFor, mergeStats, emptyStats, fingerprintFromStats, computeFingerprint,
  SENT_LEN_BUCKETS
} from '../scripts/lib/metrics.mjs'

const A = {
  strings: [
    'Your campaign is scheduled. Nice work!',
    'We keep it plain, we keep it short, and we mean it.'
  ],
  headings: ['Schedule A Campaign'],
  locale: 'en'
}
const B = {
  strings: [
    'That file did not upload. It is over the 25 MB limit.',
    'Could you try a smaller one? You might also compress it.'
  ],
  headings: ['Upload limits'],
  locale: 'en'
}

// --- THE INVARIANT (spec section 6.2) ------------------------------------
// If this fails, sources cannot be discarded and the whole design is unsound.

test('merged per-unit statistics reproduce the aggregate fingerprint exactly', () => {
  const merged = fingerprintFromStats(
    mergeStats([statsFor(A), statsFor(B)]),
    'en'
  )
  const direct = fingerprintFromStats(
    mergeStats([statsFor({
      strings: [...A.strings, ...B.strings],
      headings: [...A.headings, ...B.headings],
      locale: 'en'
    })]),
    'en'
  )
  // Measure-then-merge is the contract. Both sides use it; the point is that
  // splitting the same corpus across two units changes nothing.
  const split = fingerprintFromStats(
    mergeStats([
      statsFor({ strings: A.strings, headings: A.headings, locale: 'en' }),
      statsFor({ strings: B.strings, headings: B.headings, locale: 'en' })
    ]),
    'en'
  )
  assert.deepEqual(split, merged)
  assert.equal(split.universal.wordCount, direct.universal.wordCount)
  assert.equal(split.universal.sentenceCount, direct.universal.sentenceCount)
})

test('mergeStats is commutative and associative', () => {
  const a = statsFor(A)
  const b = statsFor(B)
  const c = statsFor({ strings: ['One more line to fold in.'], headings: [], locale: 'en' })

  assert.deepEqual(mergeStats([a, b]), mergeStats([b, a]))
  assert.deepEqual(
    mergeStats([mergeStats([a, b]), c]),
    mergeStats([a, mergeStats([b, c])])
  )
})

test('merging with an empty unit changes nothing', () => {
  const a = statsFor(A)
  assert.deepEqual(mergeStats([a, emptyStats()]), a)
  assert.deepEqual(mergeStats([]), emptyStats())
})

test('a source can be subtracted by re-merging the survivors', () => {
  const all = mergeStats([statsFor(A), statsFor(B)])
  const withoutB = mergeStats([statsFor(A)])

  assert.equal(all.words - statsFor(B).words, withoutB.words)
  assert.deepEqual(fingerprintFromStats(withoutB, 'en'), fingerprintFromStats(statsFor(A), 'en'))
})

// --- shape and parity with the existing metrics ---------------------------

test('fingerprintFromStats returns the established fingerprint shape', () => {
  const fp = fingerprintFromStats(statsFor(A), 'en')

  assert.deepEqual(Object.keys(fp).sort(), ['approximations', 'english', 'locale', 'sample', 'universal'])
  assert.deepEqual(Object.keys(fp.sample).sort(), ['sentences', 'strings', 'words'])
  assert.equal(fp.locale, 'en')
  assert.ok(fp.english !== null, 'english metrics present for en')
  assert.deepEqual(fp.approximations, ['medianSentenceLength'])
})

test('computeFingerprint keeps its signature and delegates to the statistics layer', () => {
  assert.deepEqual(computeFingerprint(A), fingerprintFromStats(statsFor(A), 'en'))
})

test('a non-English locale reports null for English-only metrics and person rates it cannot measure', () => {
  const cs = statsFor({
    strings: ['Vase kampan je naplanovana. Hotovo!'],
    headings: [],
    locale: 'cs'
  })
  const fp = fingerprintFromStats(cs, 'cs')

  assert.equal(fp.english, null)
  assert.equal(cs.english, null)
  assert.equal(fp.universal.headingTitleCaseRatio, null)
  assert.ok(cs.personMarkers, 'cs has a marker set, so person rates are real numbers')
  assert.ok(typeof fp.universal.firstPersonPer1000Words === 'number')
})

test('a locale with no marker set reports null person rates rather than a misleading zero', () => {
  const fr = statsFor({ strings: ['Nous ecrivons simplement.'], headings: [], locale: 'fr' })
  const fp = fingerprintFromStats(fr, 'fr')

  assert.equal(fr.personMarkers, false)
  assert.equal(fp.universal.firstPersonPer1000Words, null)
  assert.equal(fp.universal.secondPersonPer1000Words, null)
})

// --- the pieces that make merging possible --------------------------------

test('sentence-length standard deviation is recovered from sums, not the list', () => {
  // Sentences of 2, 4, and 6 words: mean 4, population SD sqrt(8/3) = 1.63.
  const s = statsFor({
    strings: ['One two.', 'One two three four.', 'One two three four five six.'],
    headings: [],
    locale: 'en'
  })
  assert.equal(s.sentences, 3)
  assert.equal(s.sumSentLen, 12)
  assert.equal(s.sumSentLenSq, 4 + 16 + 36)
  assert.equal(fingerprintFromStats(s, 'en').universal.sentenceLengthSd, 1.63)
})

test('the sentence-length histogram covers every bucket and sums to the sentence count', () => {
  const s = statsFor({
    strings: [
      'Short.',
      'This sentence has exactly eight separate words here.',
      `Filler ${'word '.repeat(24)}end.`
    ],
    headings: [],
    locale: 'en'
  })
  assert.deepEqual(Object.keys(s.sentLenHist), SENT_LEN_BUCKETS)
  assert.equal(
    Object.values(s.sentLenHist).reduce((a, b) => a + b, 0),
    s.sentences
  )
})

test('the median is bucket-accurate and says so', () => {
  const s = statsFor({
    strings: ['One two.', 'One two three.', 'One two three four.'],
    headings: [],
    locale: 'en'
  })
  const fp = fingerprintFromStats(s, 'en')
  assert.equal(fp.universal.medianSentenceLength, 3, 'midpoint of the 1-5 bucket')
  assert.ok(fp.approximations.includes('medianSentenceLength'))
})

test('an empty unit yields a valid, all-null fingerprint rather than NaN', () => {
  const fp = fingerprintFromStats(emptyStats(), 'en')
  assert.equal(fp.universal.wordCount, 0)
  assert.equal(fp.universal.meanWordLength, null)
  assert.equal(fp.universal.meanSentenceLength, null)
  assert.equal(fp.universal.sentenceLengthSd, null)
  assert.equal(fp.universal.medianSentenceLength, null)
})
