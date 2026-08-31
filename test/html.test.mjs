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
  kb: { root: '/tmp/kb', exists: true, version: '0.2.0', brand: 'Northwind', profile: 'default', locales: ['en', 'cs'], primaryLocale: 'en' },
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
  rules: { total: 4, byConfidence: { confirmed: 2, derived: 1, assumed: 1, disputed: 0 }, byFile: { voice: 4 } },
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

test('every colour token is defined in the bare :root, not only behind a media query', () => {
  // The classic unreadable-artifact bug: a token defined only inside
  // prefers-color-scheme never applies in the viewer's default unstamped
  // state, and the page renders one theme's text on the other theme's ground.
  const css = renderHtml(STATE).match(/<style>([\s\S]*?)<\/style>/)[1]
  const bare = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'))
  const defined = new Set([...bare.matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1]))
  const used = new Set([...css.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]))
  // --w and --x are per-element layout values set inline, never colours.
  const missing = [...used].filter((v) => !defined.has(v) && v !== '--w' && v !== '--x')
  assert.deepEqual(missing, [], 'these tokens are used but never defined in the bare :root block')
  assert.match(css, /:root\[data-theme="dark"\]/, 'an explicit dark stamp must also win')
  assert.match(css, /:root:not\(\[data-theme="light"\]\)/, 'an explicit light choice must beat a dark OS')
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
