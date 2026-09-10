import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { escapeHtml, renderHtml } from '../scripts/lib/html.mjs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { main as statusMain } from '../scripts/status.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The smallest state object that exercises every section. */
const STATE = {
  generated: '2026-08-31T00:00:00.000Z',
  kb: { root: '/tmp/kb', exists: true, version: '0.2.0', brand: 'Northwind', profile: 'default', locales: ['en', 'cs'], primaryLocale: 'en', role: 'house', speaker: null },
  locks: { declared: [], violated: [] },
  speakers: [],
  stage: { at: 'interview', reached: { scan: true, ingest: false, measure: true, draft: true, interview: true, canonize: false } },
  integrity: {
    errors: 1,
    warnings: 1,
    byCode: { E_SOURCE_NOT_INDEXED: 1 },
    findings: [{ severity: 'error', code: 'E_SOURCE_NOT_INDEXED', message: 'rule V2 cites source-type evidence', file: 'voice.md', line: 36 }]
  },
  freshness: {
    card: { generated: '2026-08-30T00:00:00.000Z', staleAgainst: ['tone.md'], ageDays: 1 },
    manifest: { generated: '2026-08-31T00:00:00.000Z', ageDays: 0, changedSince: 2, checked: 4 },
    fingerprint: { generated: '2026-08-31T00:00:00.000Z', ageDays: 0 }
  },
  coverage: {
    authored: 1,
    possible: 16,
    states: ['delighted', 'curious', 'focused', 'uncertain', 'confused', 'frustrated', 'anxious-at-risk', 'disappointed-leaving'],
    humorGated: ['frustrated', 'anxious-at-risk', 'disappointed-leaving'],
    byContext: [
      { context: 'marketing-page', authored: 1, of: 8, cells: ['computed', 'authored', 'computed', 'computed', 'computed', 'computed', 'computed', 'computed'], traffic: 53 },
      { context: 'system-error', authored: 0, of: 8, cells: Array(8).fill('computed'), traffic: 12 }
    ]
  },
  rules: { total: 4, byConfidence: { confirmed: 2, derived: 1, assumed: 1, disputed: 0 }, byFile: { voice: 4 }, byOrigin: { house: 4, speaker: 0, overrides: 0, locked: 0 } },
  evidence: { total: 3, byType: { source: 1, corpus: 1, interview: 1, correction: 0, decision: 0 }, conflicts: 0, drafts: 0 },
  drift: {
    thresholdPct: 25,
    byLocale: {
      en: { baseline: '2026-08-01T00:00:00.000Z', metrics: [{ key: 'meanSentenceLength', label: 'mean sentence', from: 10, to: 14, deltaPct: 40, flagged: true }] },
      cs: { baseline: null, metrics: [] }
    }
  },
  sources: { registered: 2, analysed: 1, missing: 0, unindexed: 1, freshness: 'unchecked', stale: null, fresh: null, entries: [] },
  corpus: {
    totals: { files: 4, strings: 14, words: 119, sentences: 21 },
    byLocale: { en: { files: 3, strings: 11, words: 109 }, cs: { files: 1, strings: 3, words: 10 } },
    skipped: 0, unreadable: 0, fidelity: { en: 'measured', cs: 'estimated' }
  },
  settings: {
    thresholds: { corroboration: 2, derived_min_samples: 5, stale_months: 9, drift_pct: 25 },
    register: [{ id: 's01', kind: 'project', label: 'Project files' }],
    runtime: { node: 'detected', probed: null },
    vendor: [{ name: 'pdfjs-dist', version: '4.10.38' }]
  },
  localePacks: [],
  cardTokens: 70,
  gaps: [{ id: 'G02', severity: 'blocker', leverage: 5, what: '1 validation error(s)', why: 'a broken card is worse than a stale one', fix: '/voice-and-tone:sync' }]
}

test('the html renderer reads no files, exactly as the ascii renderer does not', () => {
  // Same guarantee render.test.mjs enforces on render.mjs: lib/state.mjs owns
  // every read, so a renderer that could open a file could put something on
  // the page that the state object never carried.
  const source = readFileSync(path.join(root, 'scripts', 'lib', 'html.mjs'), 'utf8')
  assert.ok(!/from 'node:fs'/.test(source), 'html.mjs must not import node:fs')
  assert.ok(!/require\(['"]fs['"]\)/.test(source))
})

test('escapeHtml escapes ampersand first, so entities are never doubled', () => {
  assert.equal(escapeHtml('a & b'), 'a &amp; b')
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;')
  assert.equal(escapeHtml('say "hi"'), 'say &quot;hi&quot;')
  assert.equal(escapeHtml("it's"), 'it&#39;s')
  assert.equal(escapeHtml('&lt;'), '&amp;lt;', 'an already-escaped entity is escaped again, not left half-decoded')
  assert.equal(escapeHtml(null), '')
})

test('hostile text on the state object cannot become markup', () => {
  // Every one of these fields is authored by a human somewhere - a brand name,
  // a rule id, a validation message that quotes a file's own text - and this
  // page is published to a URL a colleague opens.
  const hostile = JSON.parse(JSON.stringify(STATE))
  hostile.kb.brand = '<img src=x onerror=alert(1)>'
  hostile.gaps[0].what = '</code><script>alert(2)</script>'
  hostile.integrity.findings[0].message = '"><svg onload=alert(3)>'
  hostile.coverage.byContext[0].context = '<b>bold</b>'

  const html = renderHtml(hostile)

  // The precise property: no injected tag ever OPENS. Testing for the absence
  // of the substring "onerror=" would be wrong - it survives as escaped text,
  // which is the correct outcome and is asserted below. What must not exist is
  // a real <img>/<svg>/<script>, none of which this renderer ever emits itself,
  // so any occurrence could only have come from the state object.
  for (const tag of ['<img', '<svg', '<script', '<iframe']) {
    assert.ok(!html.toLowerCase().includes(tag), `an injected ${tag}> survived escaping`)
  }
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'the text is still shown, escaped')
  assert.ok(html.includes('&lt;/code&gt;&lt;script&gt;'), 'the attempted tag break is inert text')
})

test('the page is a fragment: the artifact host supplies the skeleton', () => {
  const html = renderHtml(STATE)
  assert.ok(!/<!doctype/i.test(html))
  assert.ok(!/<html[\s>]/i.test(html))
  assert.ok(!/<head[\s>]/i.test(html))
  assert.ok(!/<body[\s>]/i.test(html))
  assert.match(html, /^<title>Northwind Voice State<\/title>/)
})

test('the page commits to one light theme and paints every colour explicitly', () => {
  // A deliberate single-theme design, matching the presentation deck it shares
  // an identity with. That is only safe if nothing is left to the host: the
  // artifact composites over a ground the viewer paints in ITS theme, so a
  // transparent body would silently borrow a dark one and put dark text on it.
  const css = renderHtml(STATE).match(/<style>([\s\S]*?)<\/style>/)[1]

  assert.doesNotMatch(css, /prefers-color-scheme/, 'no theme switching: one design, stated once')
  assert.doesNotMatch(css, /\[data-theme/, 'no theme stamps either')
  assert.match(css, /body\s*\{[^}]*background:\s*var\(--paper\)/, 'body must paint its own ground')

  const root = css.slice(css.indexOf(':root {'), css.indexOf('* { box-sizing'))
  const defined = new Set([...root.matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1]))
  const used = new Set([...css.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]))
  const missing = [...used].filter((v) => !defined.has(v) && v !== '--w' && v !== '--x')
  assert.deepEqual(missing, [], 'these tokens are used but never defined')
})

test('the brand identity is actually on the page, and the band is spent once', () => {
  const html = renderHtml(STATE)
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1]

  assert.match(css, /--band:\s*#ffe01b/, "the deck's yellow, not an approximation of it")
  assert.match(css, /--display: "Fraunces"/)
  assert.match(css, /--body: "Archivo"/)
  assert.match(html, /<header class="hero">/)

  // The band is the loudest thing the brand owns, so it fills exactly one
  // field: the hero. Small accents elsewhere (a done step's ordinal, an
  // "unwritten" flag) are how the deck uses it too and are not fields.
  assert.match(css, /\.hero \{[^}]*background: var\(--band\)/, 'the hero is the field')
  assert.match(css, /\.plate \{[^}]*background: var\(--cream\)/, 'every other field is cream')
  assert.doesNotMatch(css, /\.tile \{[^}]*var\(--band\)/, 'tiles never take the band')
})

test('the hero reads the state rather than restating a number', () => {
  const clean = renderHtml({ ...STATE, integrity: { errors: 0, warnings: 0, byCode: {}, findings: [] }, gaps: [] })
  assert.match(clean, /1 cell authored of 16/, 'singular is respected')

  const broken = renderHtml(STATE) // STATE carries 1 error and 1 blocker gap
  assert.match(broken, /1 validation error to clear/)

  const empty = renderHtml({ generated: '2026-08-31T00:00:00.000Z' })
  assert.match(empty, /Nothing authored yet/)
  assert.match(empty, /measured 2026-08-31/, 'the age of the page is in the band, not a footer')
})

test('the matrix distinguishes authored from computed, and labels every cell for a screen reader', () => {
  const html = renderHtml(STATE)
  assert.match(html, /cell--authored/)
  assert.match(html, /cell--computed/)
  assert.match(html, /aria-label="marketing-page \/ curious: authored"/)
  assert.match(html, /aria-label="system-error \/ frustrated: computed"/)
  // A context with corpus traffic and nothing authored is called out by name.
  assert.match(html, /row--bare/)
  assert.match(html, /unwritten/)
})

test('a drift metric past the threshold is flagged in form, not only in colour', () => {
  const html = renderHtml(STATE)
  assert.match(html, /is-flagged/)
  assert.match(html, /past threshold/)
  // A locale with no frozen baseline says so rather than rendering a bar of zero.
  assert.match(html, /drift cannot be measured here/)
})

test('an estimated locale is marked, so a measured number is never confused with a transcribed one', () => {
  assert.match(renderHtml(STATE), /estimated/)
})

test('a bare, empty state renders rather than throwing', () => {
  // /voice-and-tone:status runs before anything has been built too.
  const html = renderHtml({ generated: '2026-08-31T00:00:00.000Z' })
  assert.ok(html.length > 0)
  assert.match(html, /<title>Voice Voice State<\/title>|<title>.*<\/title>/)
  assert.match(html, /Nothing outstanding|What to do next/)
  assert.doesNotMatch(html, /undefined/, 'no undefined leaks into the page')
  assert.doesNotMatch(html, /\[object Object\]/)
})

test('status --artifact writes a page and says where, in ascii', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': 'version: 1\nkb_version: 0.1.0\n',
    'content/a.md': '# Heading\n\nWe write plainly here today.\n'
  })
  const chunks = []
  const original = process.stdout.write
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true }
  try {
    statusMain(['--root', dir, '--now', '2026-08-31T00:00:00.000Z', '--artifact'])
  } finally {
    process.stdout.write = original
  }
  const out = chunks.join('')
  const written = path.join(dir, '.voice-and-tone', '.drafts', 'status.html')

  assert.ok(existsSync(written), 'the page lands in .drafts/, which the shipped KB template gitignores')
  assert.match(out, /^status: wrote /m)
  assert.ok(!/[^\x00-\x7F]/.test(out), 'stdout stays ASCII even though the file is UTF-8')
  assert.match(readFileSync(written, 'utf8'), /<title>/)
  cleanup(dir)
})

test('a locale heading keeps its baseline label separate from the locale name', () => {
  // It rendered as "csbaseline 2026-08-31": the span was emitted but never
  // styled, so nothing separated the two. Caught by looking at the page.
  const css = renderHtml(STATE).match(/<style>([\s\S]*?)<\/style>/)[1]
  assert.match(css, /\.locale__base\s*\{/, 'the label must actually have a rule')
  assert.match(css, /\.locale__name\s*\{/)
})

test('a count of a word ending in consonant-y pluralises to -ies', () => {
  // "4 ledger entrys" shipped to a rendered page before this existed.
  const html = renderHtml({ ...STATE, evidence: { total: 4, byType: { source: 1 }, conflicts: 0, drafts: 2 } })
  assert.match(html, /4 ledger entries/)
  assert.doesNotMatch(html, /entrys/)
  assert.match(html, /2 retained drafts/, 'the ordinary -s case still works')
  const one = renderHtml({ ...STATE, evidence: { total: 1, byType: { source: 1 }, conflicts: 1, drafts: 0 } })
  assert.match(one, /1 ledger entry\b/, 'a single entry keeps the singular')
  assert.match(one, /1 open dispute\b/)
})

test('every top-level block takes the same vertical rhythm, plate rows included', () => {
  // The two .grid rows are blocks like any other, but only .section carried a
  // top margin, so they butted straight against the matrix legend and the
  // drift table above them.
  const css = renderHtml(STATE).match(/<style>([\s\S]*?)<\/style>/)[1]
  assert.match(css, /--rhythm:/, 'the rhythm has one definition')
  assert.match(css, /\.section,\s*\.grid\s*\{\s*margin-top:\s*var\(--rhythm\)/)
  assert.match(css, /\.plate \.section,\s*\.plate \.grid\s*\{\s*margin-top:\s*0/,
    'but a section inside a plate is that plate\'s heading, not a new block')
})

// --- speakers (spec 2026-09-10 §9.4) ---------------------------------------

const SPEAKERS = [
  { slug: 'maya', name: 'Maya Lind', voiceRules: 6, hasDefaultDials: true, authoredCells: 3, overrides: 2, lockViolations: 0, corpusWords: 900, fingerprintAgeDays: 1, driftBaseline: true, driftFlagged: false, draftsPending: 1, sourcesNeverIngested: 0, cardStale: [] },
  { slug: 'jonas', name: 'Jonas Berg', voiceRules: 6, hasDefaultDials: true, authoredCells: 1, overrides: 0, lockViolations: 0, corpusWords: 0, fingerprintAgeDays: null, driftBaseline: false, driftFlagged: false, draftsPending: 0, sourcesNeverIngested: 0, cardStale: null },
  { slug: 'helpdesk', name: 'Acme Support', voiceRules: 5, hasDefaultDials: true, authoredCells: 0, overrides: 1, lockViolations: 1, corpusWords: 1200, fingerprintAgeDays: 3, driftBaseline: true, driftFlagged: true, draftsPending: 0, sourcesNeverIngested: 0, cardStale: [] }
]

test('with no speakers and no locks the page has no Speakers section, no chip, no locks note', () => {
  const html = renderHtml(STATE)
  assert.ok(!html.includes('id="speakers"'))
  assert.ok(!html.includes('speakers <b>'))
  assert.ok(!html.includes('Locks:'))
})

test('the house view with speakers renders the Speakers section, one row each, and the chip', () => {
  const html = renderHtml({ ...STATE, speakers: SPEAKERS, locks: { declared: ['V2'], violated: [] } })
  assert.ok(html.includes('id="speakers"'))
  assert.match(html, /speakers <b>3<\/b>/)
  assert.match(html, /<th scope="row">maya<\/th>/)
  assert.match(html, /Maya Lind/)
  assert.match(html, /class="pill pill--warn"[^>]*>FLAG</)
  assert.match(html, /n\/a/)
  assert.match(html, /Locks: <code>V2<\/code>/)
})

test('a speaker view says who is speaking and splits rules by origin', () => {
  const html = renderHtml({
    ...STATE,
    kb: { ...STATE.kb, role: 'speaker', speaker: { slug: 'maya', name: 'Maya Lind' }, profile: 'maya' },
    speakers: [SPEAKERS[0]],
    locks: { declared: ['V2'], violated: [] },
    rules: { ...STATE.rules, byOrigin: { house: 31, speaker: 12, overrides: 2, locked: 6 } }
  })
  assert.match(html, /speaking as Maya Lind/)
  assert.ok(!html.includes('id="speakers"'), 'house view only')
  assert.match(html, /<th scope="row">house<\/th><td class="n">31<\/td>/)
  assert.match(html, /<th scope="row">overrides<\/th><td class="n">2<\/td>/)
})

test('every speaker name is escaped', () => {
  const html = renderHtml({ ...STATE, speakers: [{ ...SPEAKERS[0], name: 'A <b>bold</b> & co' }] })
  assert.ok(html.includes('A &lt;b&gt;bold&lt;/b&gt; &amp; co'))
  assert.ok(!html.includes('A <b>bold</b>'))
})
