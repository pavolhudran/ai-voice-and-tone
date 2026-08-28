import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreExtraction, QUALITY_THRESHOLDS, appliesShapeGate, AUTHORED_FORMATS, MIN_SHAPE_TOKENS } from '../scripts/lib/quality.mjs'

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

// Ruling R43 - the real 72-file brand corpus rejected 9 files, 8 of them
// wrongly. The shapes below are taken from that run: a line of bare URLs,
// a bracket-wrapped URL, and an @handle sitting inside ordinary prose.

test('a line of bare URLs does not trip longTokenShare in a format the gate applies to', () => {
  // Without exclusion this is 4 of 19 tokens over 20 chars (0.21, far past
  // 0.015) - exactly the landing-pages.txt/newsletter shape from the real
  // run. 'pdf' is used so the shape gate itself is active; only the URL
  // exclusion is under test here.
  const prose = 'Our team helps people feel calm and focused every single day at work and home'
  const urls = 'https://vivido.fit/cs/instructors https://vivido.fit/cs/pribehy ' +
    'https://app.anandita.cz/cs/serie/festival-joga-pro-dobrou-vec @yoga.anna.augustinova'
  const q = scoreExtraction(`${prose} ${urls}`, { locale: 'en', format: 'pdf' })
  assert.equal(q.passed, true, q.reasons.join('; '))
  assert.equal(q.tokens, 15, 'the 4 URL/handle tokens are excluded from the token set, not merely under threshold')
  assert.equal(q.longTokenShare, 0)
})

test('a bracket-wrapped URL is excluded the same way a bare one is', () => {
  const prose = 'Sign up for the festival of yoga and enjoy workshops all weekend long with friends'
  const bracketed = '[https://app.anandita.cz/cs/serie/festival-joga-pro-dobrou-vec]'
  const q = scoreExtraction(`${prose} ${bracketed}`, { locale: 'en', format: 'pdf' })
  assert.equal(q.passed, true, q.reasons.join('; '))
  assert.equal(q.tokens, 15, 'the brackets do not shield the URL from exclusion')
  assert.equal(q.longTokenShare, 0)
})

test('an @handle mixed into ordinary prose does not count as a word at all', () => {
  const text = 'Follow updates at https://vivido.fit/cs/instructors or find us on Instagram ' +
    '@yoga.anna.augustinova for daily tips and new class times'
  const q = scoreExtraction(text, { locale: 'en', format: 'pdf' })
  assert.equal(q.passed, true, q.reasons.join('; '))
  assert.ok(!q.reasons.some((r) => r.startsWith('longTokenShare')))
})

test('too few prose tokens survive URL removal to compute a meaningful share, so the shape signals are not judged', () => {
  // 7 raw tokens, 3 of them URLs; "z" is a genuine single-letter token no
  // locale allows, so singleShare over the 4 remaining prose tokens would
  // be 0.25 (over the 0.10 threshold) if judged. It must not be: 4 tokens
  // is exactly the "share computed over almost nothing" case the ruling
  // calls out, and MIN_SHAPE_TOKENS keeps a real result from being decided
  // by a handful of words.
  const text = 'Buy z today now https://a.example.com/x https://b.example.com/y https://c.example.com/z'
  const q = scoreExtraction(text, { locale: 'en', format: 'pdf' })
  assert.equal(q.tokens, 4)
  assert.ok(q.tokens < MIN_SHAPE_TOKENS)
  assert.equal(q.singleShare, 0.25, 'the value is still measured and reported')
  assert.equal(q.passed, true, q.reasons.join('; '))
})

test('genuinely merged words still fail the gate for a format the gate applies to (pdf)', () => {
  const q = scoreExtraction(MERGED, { locale: 'en', format: 'pdf' })
  assert.equal(q.passed, false)
  assert.ok(q.reasons.some((r) => r.startsWith('longTokenShare')))
})

test('the same merged text does not fail for an authored format - nothing extracted it, so nothing can have mangled it', () => {
  const q = scoreExtraction(MERGED, { locale: 'en', format: 'text' })
  assert.equal(q.passed, true, q.reasons.join('; '))
  assert.ok(q.longTokenShare > 0, 'the signal is still measured and reported, just not gated on')
})

test('genuinely split words still fail the gate for a format the gate applies to (pdf)', () => {
  const q = scoreExtraction(SPLIT, { locale: 'cs', format: 'pdf' })
  assert.equal(q.passed, false)
  assert.ok(q.reasons.some((r) => r.startsWith('singleShare')))
})

test('the same split text does not fail for an authored format', () => {
  const q = scoreExtraction(SPLIT, { locale: 'cs', format: 'text' })
  assert.equal(q.passed, true, q.reasons.join('; '))
  assert.ok(q.singleShare > 0, 'the signal is still measured and reported, just not gated on')
})

test('a model-tier transcription is gated even when its declared format looks authored', () => {
  // A model transcription is a recovery of what someone wrote, whatever the
  // original container was - it can lose or merge word boundaries exactly
  // as a vendored parser can.
  const q = scoreExtraction(MERGED, { locale: 'en', format: 'text', tier: 'model' })
  assert.equal(q.passed, false)
  assert.ok(q.reasons.some((r) => r.startsWith('longTokenShare')))
})

test('appliesShapeGate: authored formats are exempt, markup/containers are not, model tier always applies', () => {
  for (const format of AUTHORED_FORMATS) {
    assert.equal(appliesShapeGate(format, 'script'), false, format)
  }
  for (const format of ['html', 'rtf', 'pdf', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods']) {
    assert.equal(appliesShapeGate(format, 'script'), true, format)
  }
  assert.equal(appliesShapeGate('text', 'model'), true)
  assert.equal(appliesShapeGate(null, 'script'), true, 'an unspecified format is conservative: gate applies')
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
