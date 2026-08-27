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
    longTokenShare: 0.015,
    singleShare: 0.10,
    replShare: 0.005,
    glyphRecall: 0.5
  })
})

test('a sound extraction passes', () => {
  const q = scoreExtraction(SOUND, { locale: 'en' })
  assert.equal(q.passed, true)
  assert.deepEqual(q.reasons, [])
  assert.ok(q.longTokenShare <= QUALITY_THRESHOLDS.longTokenShare)
})

test('merged words fail on longTokenShare', () => {
  const q = scoreExtraction(MERGED, { locale: 'en' })
  assert.equal(q.passed, false)
  assert.ok(q.reasons.some((r) => r.startsWith('longTokenShare')), q.reasons.join('; '))
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

test('realistic German prose with legitimate compounds passes', () => {
  // A realistic paragraph of German business prose with authentic compound words.
  // At length 30, no token exceeds the boundary, so longTokenShare is 0.0 and
  // passes easily. Advisory signals like meanTokenLen are still reported.
  const german = 'Unser Wohlbefinden und die Mitarbeiterzufriedenheit sind zentral für unsere Unternehmenskultur und den langfristigen Erfolg. Ein modernes Gesundheitsprogramm unterstützt aktiv Prävention, Stressabbau und mentale Stabilität im täglichen Berufsalltag. Die komprehensive Krankenversicherung ist eine wesentliche Leistung für alle Mitarbeiter. Flexible Arbeitsplatzgestaltung und innovative Organisationskonzepte führen zu nachhaltiger Produktivität sowie erfolgreichen Geschäftsergebnissen und zufriedenen Kunden.'
  const q = scoreExtraction(german, { locale: 'de' })
  assert.equal(q.passed, true, q.reasons.join('; '))
  assert.ok(q.meanTokenLen > 8, 'the advisory signal is still recorded')
  assert.ok(q.tokens >= 50, 'realistic paragraph has 50+ tokens')
})

test('light merging (1 in 4 pairs) is not caught in German—a known limit', () => {
  // Light merging where roughly one word pair in four is concatenated. At
  // length 30, this produces no tokens exceeding the boundary, so it passes.
  // This test documents that the gate catches only gross merging in German,
  // not lighter degradation. This is a known limitation of the signal.
  const oneInFour = 'Unser WohlbefindenundDie Mitarbeiterzufriedenheit sind zentral für unsere Unternehmenskultur. Ein modernes Gesundheitsprogramm unterstützt aktiv Prävention, Stressabbau und mentale Stabilitätim täglichen Berufsalltag. Die komprehensive Krankenversicherung ist eine wesentliche Leistung. Flexible ArbeitsplatzgestaltungUnd innovative Organisationskonzepte führen zu Produktivität sowie erfolgreichen Geschäftsergebnissen.'
  const q = scoreExtraction(oneInFour, { locale: 'de' })
  assert.equal(q.passed, true, q.reasons.join('; '))
})

test('heavy merging (1 in 2 pairs) fails the German gate', () => {
  // Heavy merging where roughly one word pair in two is concatenated. This
  // produces 3 tokens over 30 chars, giving longTokenShare 0.12, which far
  // exceeds the 0.015 threshold. The gate catches gross merging.
  const oneInTwo = 'UnserWohlbefindenund Die Mitarbeiterzufriedenheitsind zentral fürUnsere Unternehmenskultur. Ein modernesGesundheitsprogramm unterstützt aktivPrävention, Stressabbauund mentale Stabilitätimdeal Berufsalltag. Die komprehensiveKrankenversicherung ist eine wesentlicheLeistung. FlexibleArbeitsplatzgestaltung und innovativeOrganisationskonzepte führenzu produktivitätsowie erfolgreichenGeschäftsergebnissen.'
  const q = scoreExtraction(oneInTwo, { locale: 'de' })
  assert.equal(q.passed, false, q.reasons.join('; '))
  assert.ok(q.reasons.some((r) => r.startsWith('longTokenShare')), q.reasons.join('; '))
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
