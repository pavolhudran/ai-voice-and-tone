import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreExtraction, QUALITY_THRESHOLDS } from '../scripts/lib/quality.mjs'

// The two real failure shapes, taken verbatim from the spec's measurements.
const SPLIT = 'I V A Š TÍH LÁ ADMIN IS TRATIV NÍ PRACOVNIC E 2 6-4 5 L ET DEMOGRAFIC KÉ ÚDAJE'
const MERGED = [
  'Mental wellness and stress relief for your employees ANYTIME AND ANYWHERE',
  'Onlineexerciseandtherapylessons and courses for employee health and mental well-being',
  'availableintheofficeandhome-office aplatformprovidingonlineyogaexercise'
].join('\n')
const SOUND = [
  'Mental wellness and stress relief for your employees.',
  'Online exercise and therapy lessons and courses for employee health.',
  'Available in the office and on home-office days.'
].join('\n')

test('the thresholds are exactly the calibrated values from the spec', () => {
  assert.deepEqual(QUALITY_THRESHOLDS, {
    long20Share: 0.015,
    singleShare: 0.10,
    replShare: 0.005,
    glyphRecall: 0.5
  })
})

test('a sound extraction passes', () => {
  const q = scoreExtraction(SOUND, { locale: 'en' })
  assert.equal(q.passed, true)
  assert.deepEqual(q.reasons, [])
  assert.ok(q.long20Share <= QUALITY_THRESHOLDS.long20Share)
})

test('merged words fail on long20Share', () => {
  const q = scoreExtraction(MERGED, { locale: 'en' })
  assert.equal(q.passed, false)
  assert.ok(q.reasons.some((r) => r.startsWith('long20Share')), q.reasons.join('; '))
})

test('split words fail on singleShare', () => {
  const q = scoreExtraction(SPLIT, { locale: 'cs' })
  assert.equal(q.passed, false)
  assert.ok(q.reasons.some((r) => r.startsWith('singleShare')), q.reasons.join('; '))
})

test("a locale's real single-letter words do not count against it", () => {
  // Czech prepositions v/k/s/z/o/u are legitimate one-character words. Scoring
  // them as split-word evidence would fail every sound Czech extraction.
  const czech = 'Jdeme k lekci v sale u nas a potom o tom napiseme neco delsiho nez to'
  const q = scoreExtraction(czech, { locale: 'cs' })
  assert.equal(q.passed, true, q.reasons.join('; '))
  assert.ok(q.singleShare < 0.10)
  assert.ok(q.tokens > 10)
})

test('a locale with no single-letter list still scores, treating none as legitimate', () => {
  const q = scoreExtraction('a b c d e f g h i j', { locale: 'xx' })
  assert.equal(q.passed, false)
  assert.ok(q.reasons.some((r) => r.startsWith('singleShare')))
})

test('replacement characters fail the gate', () => {
  const text = `${SOUND} ${'� '.repeat(20)}`
  const q = scoreExtraction(text, { locale: 'en' })
  assert.equal(q.passed, false)
  assert.ok(q.reasons.some((r) => r.startsWith('replShare')))
})

test('low glyph recall fails, and an absent recall figure is not held against a caller', () => {
  assert.equal(scoreExtraction(SOUND, { locale: 'en', glyphRecall: 0.2 }).passed, false)
  assert.equal(scoreExtraction(SOUND, { locale: 'en', glyphRecall: 0.9 }).passed, true)
  assert.equal(scoreExtraction(SOUND, { locale: 'en' }).passed, true)
  assert.equal(scoreExtraction(SOUND, { locale: 'en' }).glyphRecall, null)
})

test('realistic German prose with compounds passes the gate', () => {
  // Ordinary German business prose, with one compound word that exceeds 20 chars,
  // should pass. The advisory signal (meanTokenLen) is recorded but does not fail.
  const german = 'Unser Wohlbefinden und die Mitarbeiterzufriedenheit bestimmen unsere Unternehmenskultur'
  const q = scoreExtraction(german, { locale: 'de' })
  assert.equal(q.passed, true, q.reasons.join('; '))
  assert.ok(q.meanTokenLen >= 9, 'the advisory signal is still recorded')
})

test('genuinely merged German words still fail the gate', () => {
  // When extraction genuinely loses spaces between words, long20Share rises
  // sharply and should fail even with the higher German threshold.
  const merged = 'UnserWohlbefindenunddieMitarbeiterzufriedenheitbestimmenunsereUnternehmenskultur'
  const q = scoreExtraction(merged, { locale: 'de' })
  assert.equal(q.passed, false, q.reasons.join('; '))
  assert.ok(q.reasons.some((r) => r.startsWith('long20Share')), q.reasons.join('; '))
})

test('empty text fails rather than passing vacuously', () => {
  const q = scoreExtraction('', { locale: 'en' })
  assert.equal(q.passed, false)
  assert.deepEqual(q.reasons, ['empty: no tokens recovered'])
  assert.equal(q.tokens, 0)
})

test('every returned figure is a finite number or null, never NaN', () => {
  for (const sample of ['', SOUND, SPLIT, MERGED]) {
    const q = scoreExtraction(sample, { locale: 'en' })
    for (const [key, value] of Object.entries(q)) {
      if (typeof value !== 'number') continue
      assert.ok(Number.isFinite(value), `${key} is NaN for sample of length ${sample.length}`)
    }
  }
})
