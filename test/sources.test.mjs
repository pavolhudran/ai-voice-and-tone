import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { loadConfig, saveConfig, DEFAULT_CONFIG } from '../scripts/lib/config.mjs'
import { loadIndex } from '../scripts/lib/sourceindex.mjs'
import {
  runCheck, runIngest, runAdd, runForget, filterVanished, runRefresh, main, reattributeLocales
} from '../scripts/sources.mjs'

const NOW = '2026-08-27T00:00:00.000Z'
const SOURCES_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'sources.mjs')

function project (files = {}) {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  mkdirSync(path.join(kb, 'sources'), { recursive: true })
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(kb, 'sources', rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
  saveConfig(kb, {
    ...DEFAULT_CONFIG,
    sources: [{ id: 's02', kind: 'inbox', path: 'sources/', label: 'Inbox' }]
  })
  return { dir, kb, ctx: { projectRoot: dir, kbRoot: kb, config: loadConfig(kb), profileName: 'default', now: NOW } }
}

test('check reports new sources before anything is analysed', () => {
  const { dir, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    const report = runCheck(ctx)
    assert.equal(report.fresh.length, 1)
    assert.equal(report.known.length, 0)
    assert.deepEqual(report.fresh[0].origin, 'sources/a.txt')
  } finally {
    cleanup(dir)
  }
})

test('an inbox exclude on the shipped README keeps --check from reporting the plugin\'s own placeholder', () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  mkdirSync(path.join(kb, 'sources'), { recursive: true })
  writeFileSync(path.join(kb, 'sources', 'README.md'), 'Drop brand material here.')
  writeFileSync(path.join(kb, 'sources', 'newsletter.txt'), 'We write plainly. We keep it short.\n')
  saveConfig(kb, {
    ...DEFAULT_CONFIG,
    // The same shape templates/kb/config.yml ships: an inbox entry that
    // excludes its own README so a fresh KB does not fold the plugin's
    // instructions into the corpus.
    sources: [{ id: 's02', kind: 'inbox', path: 'sources/', label: 'Inbox', exclude: ['README.md'] }]
  })
  try {
    const ctx = { projectRoot: dir, kbRoot: kb, config: loadConfig(kb), profileName: 'default', now: NOW }
    const report = runCheck(ctx)
    assert.deepEqual(report.fresh.map((f) => f.origin), ['sources/newsletter.txt'])
  } finally {
    cleanup(dir)
  }
})

test('ingest writes index entries and check then reports them as known', async () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    const ingested = await runIngest(ctx, {})
    assert.equal(ingested.ingested.length, 1)
    assert.equal(ingested.ingested[0].status, 'used')

    const index = loadIndex(kb)
    assert.equal(index.sources.length, 1)
    assert.equal(index.sources[0].id, 'f001')
    assert.equal(index.sources[0].from, 's02')

    const after = runCheck({ ...ctx, config: loadConfig(kb) })
    assert.equal(after.fresh.length, 0)
    assert.equal(after.known.length, 1)
  } finally {
    cleanup(dir)
  }
})

test('re-ingesting the same bytes at a new path is a no-op that keeps the original id', async () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    await runIngest(ctx, {})
    writeFileSync(path.join(kb, 'sources', 'copy-of-a.txt'), 'We write plainly. We keep it short.\n')

    await runIngest({ ...ctx, config: loadConfig(kb) }, {})
    const index = loadIndex(kb)

    assert.equal(index.sources.length, 1, 'identity is the hash, so the copy is the same source')
    assert.equal(index.sources[0].id, 'f001')
  } finally {
    cleanup(dir)
  }
})

test('an edited source becomes stale and is re-ingested, superseding rather than duplicating', async () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    await runIngest(ctx, {})
    const before = loadIndex(kb)
    before.sources[0].produced = ['V3']
    const { saveIndex } = await import('../scripts/lib/sourceindex.mjs')
    saveIndex(kb, before, NOW)

    writeFileSync(path.join(kb, 'sources', 'a.txt'), 'We write plainly. We changed our minds entirely.\n')

    const check = runCheck({ ...ctx, config: loadConfig(kb) })
    assert.equal(check.stale.length, 1)
    assert.equal(check.fresh.length, 0, 'an edited file is stale, never also fresh')

    const result = await runIngest({ ...ctx, config: loadConfig(kb) }, {})
    const index = loadIndex(kb)
    assert.equal(index.sources.length, 1, 'the stale entry is replaced, not duplicated')
    assert.match(index.sources[0].sha256, /^[0-9a-f]{64}$/)
    assert.notEqual(index.sources[0].id, 'f001', 'the replacement gets a new id, never the old one')
    assert.deepEqual(index.sources[0].produced, [], 'rule attribution is never inherited across a rewrite')

    // The displaced entry's produced rules must be surfaced so a human learns
    // what needs re-deriving - the same courtesy --forget provides.
    assert.equal(result.reopened.length, 1)
    assert.deepEqual(result.reopened[0].produced, ['V3'])
  } finally {
    cleanup(dir)
  }
})

test('a consumer that only iterated fresh would never re-ingest a stale file - stale is a separate, mandatory bucket', async () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    await runIngest(ctx, {})
    writeFileSync(path.join(kb, 'sources', 'a.txt'), 'We write plainly. Something else entirely now.\n')

    const check = runCheck({ ...ctx, config: loadConfig(kb) })
    // Strict partition: never counted in both.
    assert.equal(check.fresh.length, 0)
    assert.equal(check.stale.length, 1)

    await runIngest({ ...ctx, config: loadConfig(kb) }, {})
    const index = loadIndex(kb)
    assert.equal(index.sources.length, 1)
    assert.equal(index.sources[0].bytes, Buffer.byteLength('We write plainly. Something else entirely now.\n'))
  } finally {
    cleanup(dir)
  }
})

test('sources absent from this machine are reported as missing, never as an error', async () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    await runIngest(ctx, {})
    // Simulate a fresh clone: the index is committed, sources/ is not.
    cleanup(path.join(kb, 'sources'))
    mkdirSync(path.join(kb, 'sources'), { recursive: true })

    const report = runCheck({ ...ctx, config: loadConfig(kb) })
    assert.equal(report.missing.length, 1)
    assert.equal(report.errors.length, 0, 'missing is ordinary, not an error')
    assert.ok(report.statsIntact, 'statistics survive without the file')
  } finally {
    cleanup(dir)
  }
})

test('add registers a local path outside the project and returns the new entry id', () => {
  const outside = makeTmpProject({ 'guide.md': 'Our voice is plain.\n' })
  const { dir, kb, ctx } = project({})
  try {
    const { register, entry } = runAdd(ctx, { target: path.join(outside, 'guide.md'), label: 'Brand guide' })

    assert.equal(entry.kind, 'local')
    assert.equal(entry.label, 'Brand guide')
    assert.equal(entry.id, 's03', 'ids continue from the existing register')
    assert.ok(register.some((e) => e.id === 's03'))
    assert.ok(loadConfig(kb).sources.some((e) => e.id === 's03'), 'persisted to config.yml')
  } finally {
    cleanup(outside)
    cleanup(dir)
  }
})

// --- F7: --add must not destroy the user's config.yml comments -----------
//
// saveConfig() round-trips values faithfully but was never designed to
// preserve comments (yaml.mjs is a minimal subset with no comment-carrying
// AST). runAdd used to call it directly, so the first-ever registration
// silently deleted the Mailchimp attribution header, the `sources:`
// explanation, and the comment R39 deliberately placed on the inbox's
// `exclude: ["README.md"]` line so that escape hatch stays visible.

test('add preserves every comment in a hand-authored config.yml, appending only the new entry', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': [
      '# Attribution header - must survive.',
      'kb_version: 0.1.0',
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: en',
      '    locales: [en]',
      '# Where brand material comes from - explanation, must survive.',
      'sources:',
      '  - id: s01',
      '    kind: inbox',
      '    path: "sources/"',
      '    # Keeps this folder\'s own README out of the corpus - must survive.',
      '    exclude:',
      '      - "README.md"'
    ].join('\n')
  })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const ctx = { projectRoot: dir, kbRoot: kb, config: loadConfig(kb), profileName: 'default', now: NOW }
    const { entry } = runAdd(ctx, { target: 'https://acme.com/style-guide', label: 'Style guide' })

    const raw = readFileSync(path.join(kb, 'config.yml'), 'utf8')
    assert.match(raw, /# Attribution header - must survive\./)
    assert.match(raw, /# Where brand material comes from - explanation, must survive\./)
    assert.match(raw, /# Keeps this folder's own README out of the corpus - must survive\./)

    // Data intact too: the original entry and the new one both parse back.
    const config = loadConfig(kb)
    assert.equal(config.sources.length, 2)
    assert.ok(config.sources.some((s) => s.id === 's01' && s.kind === 'inbox'))
    assert.ok(config.sources.some((s) => s.id === entry.id && s.kind === 'url' && s.label === 'Style guide'))
  } finally {
    cleanup(dir)
  }
})

test('add on a config with no sources: key at all writes the whole migrated register explicitly', () => {
  // Before this fix, appending only the new entry here would have been a
  // silent regression of its own: loadRegister only synthesises the
  // implicit `project` entry from `scan:` while `sources` is EMPTY, so
  // persisting just the new entry (leaving `sources` non-empty but missing
  // the synthesised one) would make the project files vanish from the
  // register on the very next read.
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': [
      '# A config from before the register existed - must survive.',
      'kb_version: 0.1.0',
      'scan:',
      '  include:',
      '    - "content/**/*.md"',
      '  exclude: []'
    ].join('\n')
  })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const ctx = { projectRoot: dir, kbRoot: kb, config: loadConfig(kb), profileName: 'default', now: NOW }
    runAdd(ctx, { target: 'https://acme.com/style-guide', label: 'Style guide' })

    const raw = readFileSync(path.join(kb, 'config.yml'), 'utf8')
    assert.match(raw, /# A config from before the register existed - must survive\./)

    const config = loadConfig(kb)
    assert.equal(config.sources.length, 2, 'the implicit project entry became explicit, alongside the new one')
    const project = config.sources.find((s) => s.kind === 'project')
    assert.deepEqual(project.include, ['content/**/*.md'], 'the migrated entry carries the old scan.include verbatim')
    assert.ok(config.sources.some((s) => s.kind === 'url'))
  } finally {
    cleanup(dir)
  }
})

test('add recognises a url and stores it as a url entry with retention off', () => {
  const { dir, ctx } = project({})
  try {
    const { entry } = runAdd(ctx, { target: 'https://acme.com/about', label: 'About' })
    assert.equal(entry.kind, 'url')
    assert.equal(entry.url, 'https://acme.com/about')
    assert.equal(entry.retain, 'none', 'retention is opt-in per spec 8.3')
  } finally {
    cleanup(dir)
  }
})

async function runCli (args) {
  let out = ''
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => { out += chunk; return true }
  try {
    await main(args)
    return out
  } finally {
    process.stdout.write = originalWrite
  }
}

test('--add on a url tells the user to run --refresh, not --ingest, which never touches url sources', async () => {
  const { dir } = project({})
  try {
    const out = await runCli(['--root', dir, '--add', 'https://acme.com/about'])
    assert.match(out, /run --refresh to fetch it/)
    assert.ok(!out.includes('--ingest'), '--ingest is the wrong next step for a url entry')
  } finally {
    cleanup(dir)
  }
})

test('--add on a local path still tells the user to run --ingest', async () => {
  const outside = makeTmpProject({ 'guide.md': 'Our voice is plain.\n' })
  const { dir } = project({})
  try {
    const out = await runCli(['--root', dir, '--add', path.join(outside, 'guide.md')])
    assert.match(out, /run --ingest to analyse it/)
  } finally {
    cleanup(outside)
    cleanup(dir)
  }
})

test('forget removes an entry and names the rules that must be reopened', async () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    await runIngest(ctx, {})
    const index = loadIndex(kb)
    index.sources[0].produced = ['V3', 'L07']
    const { saveIndex } = await import('../scripts/lib/sourceindex.mjs')
    saveIndex(kb, index, NOW)

    const result = runForget({ ...ctx, config: loadConfig(kb) }, { id: 'f001' })

    assert.equal(result.removed.id, 'f001')
    assert.deepEqual(result.reopened, ['V3', 'L07'])
    assert.equal(loadIndex(kb).sources.length, 0)
  } finally {
    cleanup(dir)
  }
})

test('ingest is deterministic: the same input twice produces an identical index file', async () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    await runIngest(ctx, {})
    const first = JSON.stringify(loadIndex(kb))
    await runIngest({ ...ctx, config: loadConfig(kb) }, {})
    assert.equal(JSON.stringify(loadIndex(kb)), first)
  } finally {
    cleanup(dir)
  }
})

test('filterVanished excludes a file that no longer exists and reports it as an error, not a crash', () => {
  const dir = makeTmpProject({})
  try {
    const ghost = path.join(dir, 'ghost.txt')
    // Never written: this stands in for a file the register's walk saw a
    // moment ago that vanished before sha256File could read it.
    const resolved = [{
      id: 's01',
      files: [{ abs: ghost, origin: 'ghost.txt', format: 'text', locale: 'en' }],
      skipped: []
    }]
    const errors = filterVanished(resolved)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].origin, 'ghost.txt')
    assert.equal(errors[0].from, 's01')
    assert.equal(resolved[0].files.length, 0, 'the vanished file is pulled out before hashing is ever attempted')
  } finally {
    cleanup(dir)
  }
})

test('every registered source missing at once is reported as an ordinary fresh clone, not a warning', async () => {
  const { dir, kb, ctx } = project({
    'a.txt': 'We write plainly. We keep it short.\n',
    'b.txt': 'We are direct and warm.\n'
  })
  try {
    await runIngest(ctx, {})
    cleanup(path.join(kb, 'sources'))
    mkdirSync(path.join(kb, 'sources'), { recursive: true })

    const report = runCheck({ ...ctx, config: loadConfig(kb) })
    assert.equal(report.missing.length, 2)
    assert.equal(report.missing.length, report.index.sources.length, 'every known source is missing at once')
    assert.equal(report.errors.length, 0)
    assert.ok(report.statsIntact)
  } finally {
    cleanup(dir)
  }
})

test('runIngest supersedes every stale file in a single pass, not just the first', async () => {
  const { dir, kb, ctx } = project({
    'a.txt': 'We write plainly. We keep it short.\n',
    'b.txt': 'We are direct and warm.\n'
  })
  try {
    await runIngest(ctx, {})
    const before = loadIndex(kb)
    assert.equal(before.sources.length, 2)
    const originalIds = before.sources.map((s) => s.id).sort()

    writeFileSync(path.join(kb, 'sources', 'a.txt'), 'We write plainly. Something else now.\n')
    writeFileSync(path.join(kb, 'sources', 'b.txt'), 'We are direct. Something else now too.\n')

    const check = runCheck({ ...ctx, config: loadConfig(kb) })
    assert.equal(check.stale.length, 2, 'both edited files are stale at once')
    assert.equal(check.fresh.length, 0)

    const result = await runIngest({ ...ctx, config: loadConfig(kb) }, {})
    const after = loadIndex(kb)
    assert.equal(after.sources.length, 2, 'still exactly two entries - superseded, not appended alongside')
    for (const id of originalIds) {
      assert.ok(!after.sources.some((s) => s.id === id), `original id ${id} must not survive a supersede`)
    }
    assert.equal(result.reopened.length, 2, 'both displaced entries are surfaced, not just the first')
  } finally {
    cleanup(dir)
  }
})

test('runIngest with { only } analyses just the named file, leaving its sibling fresh', async () => {
  const { dir, kb, ctx } = project({
    'a.txt': 'We write plainly. We keep it short.\n',
    'b.txt': 'We are direct and warm.\n'
  })
  try {
    const result = await runIngest(ctx, { only: 'sources/a.txt' })
    assert.equal(result.ingested.length, 1)
    assert.equal(result.ingested[0].origin, 'sources/a.txt')

    const index = loadIndex(kb)
    assert.equal(index.sources.length, 1)
    assert.equal(index.sources[0].origin, 'sources/a.txt')

    const after = runCheck({ ...ctx, config: loadConfig(kb) })
    assert.equal(after.fresh.length, 1, 'the sibling file was never touched by --only')
    assert.equal(after.fresh[0].origin, 'sources/b.txt')
  } finally {
    cleanup(dir)
  }
})

// --- Task 12 fix round 1: a project entry's own text files must never
// become ingest candidates - gatherAll already reads them live, and
// gatherCorpus's live path and the index are not supposed to overlap.

/**
 * A syntactically valid PDF with a real, extractable content stream (no
 * compression, so no zlib dependency), built the same way test/pdf.test.mjs
 * and test/ingest.test.mjs build their fixtures. Passes the quality gate
 * with ordinary English prose, so ingesting it actually produces a `used`
 * entry with real stats - unlike a placeholder buffer of arbitrary bytes.
 */
function textPdf (text) {
  const content = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  body += `startxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

function projectWithGlob (files, scan = { include: ['content/**/*'], exclude: [] }) {
  const dir = makeTmpProject(files)
  const kb = path.join(dir, '.voice-and-tone')
  const config = { ...DEFAULT_CONFIG, scan } // sources: [] (the default) -> loadRegister synthesises `project`
  saveConfig(kb, config)
  return { dir, kb, ctx: { projectRoot: dir, kbRoot: kb, config: loadConfig(kb), profileName: 'default', now: NOW } }
}

test('a project entry never offers its own text files for ingestion, only files the live path cannot read', async () => {
  const { dir, kb, ctx } = projectWithGlob({
    'content/a.md': 'We write plainly. We keep it short.\n'
  })
  writeFileSync(path.join(dir, 'content', 'g.pdf'), textPdf('A missing document still counts.'))
  try {
    const check = runCheck({ ...ctx, config: loadConfig(kb) })
    assert.deepEqual(
      check.fresh.map((f) => f.origin), ['content/g.pdf'],
      'the project text file is never even offered as a candidate - only the container is'
    )

    const result = await runIngest({ ...ctx, config: loadConfig(kb) }, {})
    assert.deepEqual(result.ingested.map((e) => e.origin), ['content/g.pdf'])

    const index = loadIndex(kb)
    assert.deepEqual(index.sources.map((s) => s.origin), ['content/g.pdf'], 'no entry was ever created for the .md file')
    assert.equal(index.sources[0].status, 'used')
  } finally {
    cleanup(dir)
  }
})

test('a project-folder container file is still ingestible and contributes real stats', async () => {
  const { dir, kb, ctx } = projectWithGlob({})
  mkdirSync(path.join(dir, 'content'), { recursive: true })
  writeFileSync(path.join(dir, 'content', 'brand.pdf'), textPdf('The model tier is never needed for this one.'))
  try {
    const result = await runIngest({ ...ctx, config: loadConfig(kb) }, {})
    assert.equal(result.ingested.length, 1)
    assert.equal(result.ingested[0].status, 'used')
    assert.ok(result.ingested[0].stats.words > 0, 'the PDF was actually read, not just registered')
  } finally {
    cleanup(dir)
  }
})

// --- Task 13 fix round: --refresh / runRefresh had zero committed tests ---

const HTML_PAGE = `<!doctype html><html><head><title>About</title></head>
<body><h1>How we write</h1><p>We write plainly. We keep every sentence short.</p></body></html>`

const JS_SHELL = '<!doctype html><html><body><div id="root"></div><script src="app.js"></script></body></html>'

const fetchStub = (body, { status = 200, contentType = 'text/html' } = {}) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
  text: async () => body
})

function urlProject (sources) {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  saveConfig(kb, { ...DEFAULT_CONFIG, sources })
  return { dir, kb, ctx: { projectRoot: dir, kbRoot: kb, config: loadConfig(kb), profileName: 'default', now: NOW } }
}

test('runRefresh inserts a brand-new url source and escalates a JS-rendered shell', async () => {
  const { dir, kb, ctx } = urlProject([{ id: 's04', kind: 'url', url: 'https://acme.com/spa', retain: 'none' }])
  try {
    const result = await runRefresh({ ...ctx, fetchImpl: fetchStub(JS_SHELL) }, {})
    assert.equal(result.refreshed.length, 1)
    assert.equal(result.unchanged.length, 0)
    assert.equal(result.escalate.length, 1, 'a JS-rendered shell needs the model tier on first sight')
    assert.equal(result.escalate[0].quality.note, 'no-text-layer')

    const index = loadIndex(kb)
    assert.equal(index.sources.length, 1)
    assert.equal(index.sources[0].from, 's04')
    assert.equal(index.sources[0].status, 'skipped')
  } finally {
    cleanup(dir)
  }
})

test('runRefresh supersedes a changed url source and surfaces its produced rules for re-derivation', async () => {
  const { dir, kb, ctx } = urlProject([{ id: 's04', kind: 'url', url: 'https://acme.com/about', retain: 'none' }])
  try {
    await runRefresh({ ...ctx, fetchImpl: fetchStub(HTML_PAGE) }, {})
    const before = loadIndex(kb)
    before.sources[0].produced = ['V3']
    const { saveIndex } = await import('../scripts/lib/sourceindex.mjs')
    saveIndex(kb, before, NOW)
    const originalId = before.sources[0].id

    const changedPage = HTML_PAGE.replace('How we write', 'How we write now')
    const result = await runRefresh({ ...ctx, config: loadConfig(kb), fetchImpl: fetchStub(changedPage) }, {})

    assert.equal(result.refreshed.length, 1)
    assert.equal(result.reopened.length, 1)
    assert.equal(result.reopened[0].id, originalId)
    assert.deepEqual(result.reopened[0].produced, ['V3'])

    const index = loadIndex(kb)
    assert.equal(index.sources.length, 1, 'superseded, not appended alongside')
    assert.notEqual(index.sources[0].id, originalId, 'the replacement gets a new id, never the old one')
    assert.deepEqual(index.sources[0].produced, [], 'rule attribution is never inherited across a rewrite')
  } finally {
    cleanup(dir)
  }
})

test('an unchanged url source is left untouched except its analysed date, and keeps re-surfacing escalation', async () => {
  const { dir, kb, ctx } = urlProject([{ id: 's04', kind: 'url', url: 'https://acme.com/spa', retain: 'none' }])
  try {
    await runRefresh({ ...ctx, fetchImpl: fetchStub(JS_SHELL) }, {})
    const before = loadIndex(kb)
    assert.equal(before.sources[0].analysed, '2026-08-27')

    const laterCtx = { ...ctx, config: loadConfig(kb), now: '2026-09-01T00:00:00.000Z', fetchImpl: fetchStub(JS_SHELL) }
    const result = await runRefresh(laterCtx, {})

    assert.equal(result.refreshed.length, 0)
    assert.equal(result.unchanged.length, 1)
    assert.equal(
      result.escalate.length, 1,
      'the escalation signal must not vanish on an unchanged refresh - the persisted entry is still no-text-layer'
    )

    const after = loadIndex(kb)
    assert.equal(after.sources.length, 1)
    assert.equal(after.sources[0].id, before.sources[0].id, 'an unchanged entry keeps its id')
    assert.equal(after.sources[0].analysed, '2026-09-01', 'checked-today is now distinguishable from not-checked-in-weeks')
  } finally {
    cleanup(dir)
  }
})

// --- F4: the model-tier work list must not evaporate for FILE sources.
// runRefresh already re-checks needsModelTier on its `unchanged` bucket
// (immediately above); runIngest and runCheck never did the same for
// `known` - a Canva-style scanned PDF was announced once, on the run that
// first ingested it, and never again. That makes sourcing.md's documented
// "do the first ten now, the rest later" workflow unimplementable past the
// first batch.

/** A syntactically valid, minimal PDF with no /Contents key at all - the
 * "scanned page" shape pdf.mjs reports as no-text-layer, same fixture shape
 * as test/ingest.test.mjs's own `minimalPdfWithNoTextLayer`. */
function scannedPdf () {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'
  ]
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  body += `startxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

test('runIngest re-surfaces an already-known, unchanged source that still needs the model tier', async () => {
  const { dir, kb, ctx } = project({})
  mkdirSync(path.join(kb, 'sources'), { recursive: true })
  writeFileSync(path.join(kb, 'sources', 'scan.pdf'), scannedPdf())
  try {
    const first = await runIngest(ctx, {})
    assert.equal(first.escalate.length, 1, 'announced on the run that first ingests it')
    assert.equal(first.escalate[0].quality.note, 'no-text-layer')

    // Nothing changed on disk: the second run only ever matches this file by
    // hash (diffIndex's `known` bucket), which runIngest used to never
    // re-check for escalation at all.
    const second = await runIngest({ ...ctx, config: loadConfig(kb) }, {})
    assert.equal(second.fresh.length, 0)
    assert.equal(second.known.length, 1)
    assert.equal(
      second.escalate.length, 1,
      'a known, unchanged source that needs the model tier must keep being reported, not vanish after the first run'
    )
    assert.equal(second.escalate[0].origin, 'sources/scan.pdf')
  } finally {
    cleanup(dir)
  }
})

test('runCheck (no --ingest) also surfaces an already-known source that still needs the model tier', async () => {
  const { dir, kb, ctx } = project({})
  mkdirSync(path.join(kb, 'sources'), { recursive: true })
  writeFileSync(path.join(kb, 'sources', 'scan.pdf'), scannedPdf())
  try {
    await runIngest(ctx, {})

    const check = runCheck({ ...ctx, config: loadConfig(kb) })
    assert.equal(check.known.length, 1)
    assert.equal(
      check.escalate.length, 1,
      'a plain --check must surface the same escalation --ingest would, without re-ingesting anything'
    )
    assert.equal(check.escalate[0].origin, 'sources/scan.pdf')
  } finally {
    cleanup(dir)
  }
})

test('N refreshes of an unchanged retain:snapshot page commit exactly one snapshot file, never one per refresh', async () => {
  const { dir, kb, ctx } = urlProject([{ id: 's04', kind: 'url', url: 'https://acme.com/about', retain: 'snapshot' }])
  try {
    for (let i = 0; i < 5; i++) {
      await runRefresh({ ...ctx, config: loadConfig(kb), fetchImpl: fetchStub(HTML_PAGE) }, {})
    }
    const snapshotsDir = path.join(kb, 'evidence', 'snapshots')
    const files = existsSync(snapshotsDir) ? readdirSync(snapshotsDir) : []
    assert.equal(files.length, 1, `expected exactly one committed snapshot, found ${files.length}: ${files.join(', ')}`)
  } finally {
    cleanup(dir)
  }
})

test("a superseded entry's snapshot is left in place as evidence, and the new snapshot is written under the new id", async () => {
  const { dir, kb, ctx } = urlProject([{ id: 's04', kind: 'url', url: 'https://acme.com/about', retain: 'snapshot' }])
  try {
    await runRefresh({ ...ctx, fetchImpl: fetchStub(HTML_PAGE) }, {})
    const originalId = loadIndex(kb).sources[0].id

    const changedPage = HTML_PAGE.replace('How we write', 'How we write differently now')
    await runRefresh({ ...ctx, config: loadConfig(kb), fetchImpl: fetchStub(changedPage) }, {})
    const newId = loadIndex(kb).sources[0].id

    const snapshotsDir = path.join(kb, 'evidence', 'snapshots')
    const files = readdirSync(snapshotsDir)
    assert.equal(files.length, 2, 'the old snapshot is kept, not deleted, and a new one is written for the replacement')
    assert.ok(files.some((f) => f.startsWith(`${originalId}-`)), "the superseded entry's evidence survives")
    assert.ok(files.some((f) => f.startsWith(`${newId}-`)), 'the replacement gets its own snapshot under its own id')
  } finally {
    cleanup(dir)
  }
})

test('a fetch that never answers is skipped with a timeout reason instead of hanging --refresh forever', async () => {
  const { dir, kb, ctx } = urlProject([{ id: 's04', kind: 'url', url: 'https://acme.com/hangs', retain: 'none' }])
  try {
    const hang = () => (_url, { signal } = {}) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('The operation was aborted.')
        error.name = 'AbortError'
        reject(error)
      })
    })
    const result = await runRefresh({ ...ctx, fetchImpl: hang() }, { timeoutMs: 25 })
    assert.equal(result.refreshed.length, 1)
    assert.equal(result.refreshed[0].status, 'skipped')
    assert.ok(result.refreshed[0].quality.reasons.join(' ').includes('timed out'))
  } finally {
    cleanup(dir)
  }
})

test('a non-html content-type is skipped visibly through --refresh, never silently absorbed', async () => {
  const { dir, kb, ctx } = urlProject([{ id: 's04', kind: 'url', url: 'https://acme.com/api/data', retain: 'none' }])
  try {
    const json = JSON.stringify({ a: 1 })
    const result = await runRefresh({ ...ctx, fetchImpl: fetchStub(json, { contentType: 'application/json' }) }, {})
    assert.equal(result.refreshed.length, 1)
    assert.equal(result.refreshed[0].status, 'skipped')
    assert.ok(result.refreshed[0].quality.reasons.join(' ').includes('application/json'))
  } finally {
    cleanup(dir)
  }
})

// --- --refresh CLI wiring: both output formats, all three branches ---

async function runRefreshCli (dir, kb, args, fetchImpl) {
  let out = ''
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => { out += chunk; return true }
  try {
    await main(['--root', dir, '--kb', kb, '--refresh', ...args], { fetchImpl })
    return out
  } finally {
    process.stdout.write = originalWrite
  }
}

test('--refresh --json reports refreshed/unchanged/escalate/reopened counts', async () => {
  const { dir, kb } = urlProject([{ id: 's04', kind: 'url', url: 'https://acme.com/spa', retain: 'none' }])
  try {
    const out = await runRefreshCli(dir, kb, ['--now', NOW, '--json'], fetchStub(JS_SHELL))
    const summary = JSON.parse(out)
    assert.equal(summary.refreshed, 1)
    assert.equal(summary.unchanged, 0)
    assert.deepEqual(summary.escalate, ['https://acme.com/spa'])
    assert.deepEqual(summary.reopened, [])
  } finally {
    cleanup(dir)
  }
})

test('--refresh --only scopes to one registered url source, by id, and leaves the other untouched', async () => {
  const { dir, kb } = urlProject([
    { id: 's04', kind: 'url', url: 'https://acme.com/a', retain: 'none' },
    { id: 's05', kind: 'url', url: 'https://acme.com/b', retain: 'none' }
  ])
  try {
    const out = await runRefreshCli(dir, kb, ['--now', NOW, '--only', 's04', '--json'], fetchStub(HTML_PAGE))
    const summary = JSON.parse(out)
    assert.equal(summary.refreshed, 1, '--only must scope, not just filter the report')
    assert.equal(summary.unchanged, 0)

    const index = loadIndex(kb)
    assert.equal(index.sources.length, 1, 'the unscoped url source was never even fetched, let alone indexed')
    assert.equal(index.sources[0].origin, 'https://acme.com/a')
  } finally {
    cleanup(dir)
  }
})

test('--refresh --only also scopes by the url itself, not only by register id', async () => {
  const { dir, kb } = urlProject([
    { id: 's04', kind: 'url', url: 'https://acme.com/a', retain: 'none' },
    { id: 's05', kind: 'url', url: 'https://acme.com/b', retain: 'none' }
  ])
  try {
    const out = await runRefreshCli(
      dir, kb, ['--now', NOW, '--only', 'https://acme.com/b', '--json'], fetchStub(HTML_PAGE)
    )
    const summary = JSON.parse(out)
    assert.equal(summary.refreshed, 1)
    assert.equal(loadIndex(kb).sources[0].origin, 'https://acme.com/b')
  } finally {
    cleanup(dir)
  }
})

test('--refresh human-readable output names changed sources, reopened rules, and model-tier candidates', async () => {
  const { dir, kb } = urlProject([{ id: 's04', kind: 'url', url: 'https://acme.com/about', retain: 'none' }])
  try {
    await runRefreshCli(dir, kb, ['--now', NOW], fetchStub(HTML_PAGE))
    const before = loadIndex(kb)
    before.sources[0].produced = ['V9']
    const { saveIndex } = await import('../scripts/lib/sourceindex.mjs')
    saveIndex(kb, before, NOW)

    const changed = HTML_PAGE.replace('How we write', 'How we write, differently')
    const out = await runRefreshCli(dir, kb, ['--now', '2026-08-28T00:00:00.000Z'], fetchStub(changed))

    assert.match(out, /sources: refreshed 1 url source\(s\), 0 unchanged/)
    assert.match(out, /sources: {3}changed https:\/\/acme\.com\/about/)
    assert.match(out, /sources: 1 url source\(s\) were superseded/)
    assert.match(out, /reopen .* -> V9/)
  } finally {
    cleanup(dir)
  }
})

test('--refresh --json reports unchanged with no reopened rules and no index mutation beyond analysed', async () => {
  const { dir, kb } = urlProject([{ id: 's04', kind: 'url', url: 'https://acme.com/about', retain: 'none' }])
  try {
    await runRefreshCli(dir, kb, ['--now', NOW, '--json'], fetchStub(HTML_PAGE))
    const before = loadIndex(kb)

    const out = await runRefreshCli(dir, kb, ['--now', '2026-08-28T00:00:00.000Z', '--json'], fetchStub(HTML_PAGE))
    const summary = JSON.parse(out)
    assert.equal(summary.refreshed, 0)
    assert.equal(summary.unchanged, 1)
    assert.deepEqual(summary.reopened, [])

    const after = loadIndex(kb)
    assert.equal(after.sources[0].id, before.sources[0].id)
    assert.equal(after.sources[0].sha256, before.sources[0].sha256)
    assert.equal(after.sources[0].analysed, '2026-08-28')
  } finally {
    cleanup(dir)
  }
})

// --- F8: --only is documented (connect.md) and wired (runIngest itself
// accepts it) but main() never threaded it through for --ingest, so
// `--ingest --only f001` used to parse, exit 0, and silently ingest
// EVERYTHING - the same silent-scoping trap R42 closed for `--refresh <id>`,
// reappearing one layer up. connect.md documents --only as scoping --refresh
// alone, so the CLI now refuses the combination rather than accepting a flag
// that does nothing for the mode it was given in.

test('--ingest --only is refused: --only is documented to scope --refresh alone', () => {
  const dir = makeTmpProject({})
  try {
    let status = 0
    let stderr = ''
    try {
      execFileSync(process.execPath, [SOURCES_SCRIPT, '--root', dir, '--ingest', '--only', 'f001'], { encoding: 'utf8' })
    } catch (error) {
      status = error.status
      stderr = error.stderr
    }
    assert.equal(status, 1, 'must not exit 0 while silently ignoring --only')
    assert.match(stderr, /error: --only requires --refresh/)
  } finally {
    cleanup(dir)
  }
})

test('--refresh --only is still accepted (only rejected without --refresh)', () => {
  const dir = makeTmpProject({})
  try {
    const out = execFileSync(
      process.execPath,
      [SOURCES_SCRIPT, '--root', dir, '--refresh', '--only', 's04', '--json'],
      { encoding: 'utf8' }
    )
    assert.doesNotThrow(() => JSON.parse(out))
  } finally {
    cleanup(dir)
  }
})

// --- F9: --label never reached the index for FILE sources. resolveEntry
// (register.mjs) emitted no `label` on a resolved file, so ingest.mjs's
// `label: file.label` was always undefined - a URL source kept its label
// (fetchurl.mjs sets it directly from the register entry), but a local/
// inbox/project file's label was silently dropped between registration and
// the index.

test('a local source registered with --label carries that label onto its index entry', async () => {
  const outside = makeTmpProject({ 'guide.md': 'Our voice is plain and direct.\n' })
  const { dir, kb, ctx } = project({})
  try {
    const { entry } = runAdd(ctx, { target: path.join(outside, 'guide.md'), label: 'Brand guide' })

    const result = await runIngest({ ...ctx, config: loadConfig(kb) }, {})
    const ingested = result.ingested.find((e) => e.from === entry.id)
    assert.ok(ingested, 'the local file was ingested')
    assert.equal(ingested.label, 'Brand guide', 'the register entry\'s label must reach the index entry')
  } finally {
    cleanup(outside)
    cleanup(dir)
  }
})

test('an inbox source with a --label on its register entry carries that label onto its index entry', async () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  mkdirSync(path.join(kb, 'sources'), { recursive: true })
  writeFileSync(path.join(kb, 'sources', 'newsletter.txt'), 'We write plainly. We keep it short.\n')
  saveConfig(kb, {
    ...DEFAULT_CONFIG,
    sources: [{ id: 's02', kind: 'inbox', path: 'sources/', label: 'Dropped-in files' }]
  })
  try {
    const ctx = { projectRoot: dir, kbRoot: kb, config: loadConfig(kb), profileName: 'default', now: NOW }
    const result = await runIngest(ctx, {})
    assert.equal(result.ingested.length, 1)
    assert.equal(result.ingested[0].label, 'Dropped-in files')
  } finally {
    cleanup(dir)
  }
})

// --- F5: a locale declared after the fact used to be unrecoverable

test('re-attribution corrects a locale decided before the locale was declared', () => {
  // The shipped template declares locales: [en]. Ingesting a Czech corpus
  // before naming its locales filed all of it as English, and declaring `cs`
  // afterwards changed nothing: every file matched by hash, none was
  // re-processed, and the wrong label stayed for the life of the index.
  const index = {
    sources: [
      { id: 'f001', kind: 'file', origin: 'sources/claims_cs.txt', locale: 'en' },
      { id: 'f002', kind: 'file', origin: 'sources/note_en.txt', locale: 'en' }
    ]
  }
  const resolved = [{
    id: 's02',
    files: [
      { origin: 'sources/claims_cs.txt', locale: 'cs' },
      { origin: 'sources/note_en.txt', locale: 'en' }
    ]
  }]

  const changed = reattributeLocales(index, resolved)

  assert.equal(changed.length, 1)
  assert.deepEqual(changed[0], { id: 'f001', origin: 'sources/claims_cs.txt', from: 'en', to: 'cs' })
  assert.equal(index.sources[0].locale, 'cs')
  assert.equal(index.sources[1].locale, 'en', 'a correct attribution is left alone')
})

test('re-attribution is idempotent - a second pass reports nothing', () => {
  const index = { sources: [{ id: 'f001', kind: 'file', origin: 'a_cs.txt', locale: 'en' }] }
  const resolved = [{ id: 's02', files: [{ origin: 'a_cs.txt', locale: 'cs' }] }]

  assert.equal(reattributeLocales(index, resolved).length, 1)
  assert.equal(reattributeLocales(index, resolved).length, 0, 'nothing left to correct')
})

test('an entry whose file is not on disk keeps its locale and its statistics', () => {
  // There is nothing to re-resolve a missing file from, and guessing would be
  // worse than leaving a label that at least matches the statistics beside it.
  const index = { sources: [{ id: 'f001', kind: 'file', origin: 'gone_cs.txt', locale: 'en' }] }
  assert.deepEqual(reattributeLocales(index, []), [])
  assert.equal(index.sources[0].locale, 'en')
})

test('a url source is never re-attributed - it has no path convention to read', () => {
  const index = { sources: [{ id: 'u001', kind: 'url', origin: 'https://example.com/cs', locale: 'en' }] }
  const resolved = [{ id: 's04', files: [{ origin: 'https://example.com/cs', locale: 'cs' }] }]
  assert.deepEqual(reattributeLocales(index, resolved), [])
  assert.equal(index.sources[0].locale, 'en')
})

test('a folded duplicate is re-attributed through its alias', () => {
  const index = {
    sources: [{ id: 'f001', kind: 'file', origin: 'b.txt', aliases: ['a_cs.txt'], locale: 'en' }]
  }
  const resolved = [{ id: 's02', files: [{ origin: 'a_cs.txt', locale: 'cs' }] }]

  assert.equal(reattributeLocales(index, resolved).length, 1)
  assert.equal(index.sources[0].locale, 'cs')
})

test('runAdd with a profile persists it on the register entry, and ingest stamps it on the index entry', async () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: en',
      '    locales: [en]',
      '  maya:',
      '    name: "Maya Lind"',
      'sources:',
      '  - id: s01',
      '    kind: project',
      '    include: ["content/**/*.md"]',
      '    exclude: []',
      ''
    ].join('\n'),
    'material/post.md': 'Her post about the thing she built.\n'
  })
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    const ctx = { projectRoot: dir, kbRoot, config: loadConfig(kbRoot), profileName: 'maya', now: '2026-09-10T00:00:00.000Z' }
    const { entry } = runAdd(ctx, { target: path.join(dir, 'material'), label: 'posts', profile: 'maya' })
    assert.equal(entry.profile, 'maya')
    const written = loadConfig(kbRoot)
    assert.equal(written.sources.find((s) => s.id === entry.id).profile, 'maya')

    const after = { ...ctx, config: written }
    await runIngest(after, {})
    const index = loadIndex(kbRoot)
    assert.equal(index.sources.length, 1)
    assert.equal(index.sources[0].profile, 'maya')

    const houseCheck = runCheck({ ...after, profileName: 'default' })
    assert.deepEqual(houseCheck.register.map((r) => r.id).sort(), ['s01', entry.id].sort(),
      'a house check sees every entry, so one ingest covers every speaker')
    const speakerCheck = runCheck(after)
    assert.deepEqual(speakerCheck.register.map((r) => r.id), [entry.id], 'a speaker check sees only its own')
  } finally {
    cleanup(dir)
  }
})

test("a speaker-scoped check never reports another speaker's index entries as missing, and ingest never drops them", async () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: en',
      '    locales: [en]',
      '  maya:',
      '    name: "Maya Lind"',
      '  jonas:',
      '    name: "Jonas Berg"',
      'sources:',
      '  - id: s01',
      '    kind: inbox',
      '    path: "profiles/maya/sources/"',
      '    profile: maya',
      '  - id: s02',
      '    kind: inbox',
      '    path: "profiles/jonas/sources/"',
      '    profile: jonas',
      ''
    ].join('\n'),
    '.voice-and-tone/profiles/maya/sources/a.md': 'Her post.\n',
    '.voice-and-tone/profiles/jonas/sources/b.md': 'His post.\n'
  })
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    const house = { projectRoot: dir, kbRoot, config: loadConfig(kbRoot), profileName: 'default', now: '2026-09-10T00:00:00.000Z' }
    await runIngest(house, {})
    assert.equal(loadIndex(kbRoot).sources.length, 2)
    const maya = runCheck({ ...house, profileName: 'maya' })
    assert.equal(maya.missing.length, 0, "jonas's entry is outside maya's scope, not missing")
    assert.equal(maya.known.length, 1)
    await runIngest({ ...house, profileName: 'maya' }, {})
    assert.equal(loadIndex(kbRoot).sources.length, 2, 'a scoped ingest must not drop the other speaker from the index')
  } finally {
    cleanup(dir)
  }
})

test('runAdd registers a path inside the knowledge base as an inbox with a relative path, never an absolute local one', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': 'profiles:\n  default:\n    name: "Acme"\n  maya:\n    name: "Maya Lind"\n',
    '.voice-and-tone/profiles/maya/sources/README.md': 'inbox\n'
  })
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    const ctx = { projectRoot: dir, kbRoot, config: loadConfig(kbRoot), profileName: 'maya', now: '2026-09-10T00:00:00.000Z' }
    const { entry } = runAdd(ctx, { target: path.join(kbRoot, 'profiles', 'maya', 'sources'), label: null, profile: 'maya' })
    assert.equal(entry.kind, 'inbox')
    assert.equal(entry.path, 'profiles/maya/sources/')
    assert.deepEqual(entry.exclude, ['README.md'])
    assert.equal(entry.profile, 'maya')
    assert.ok(!('path' in entry && path.isAbsolute(entry.path)), 'a committed config must not carry a machine path')
    const outside = runAdd({ ...ctx, config: loadConfig(kbRoot) }, { target: path.join(dir, 'elsewhere'), label: null })
    assert.equal(outside.entry.kind, 'local', 'a path outside the knowledge base is still a local entry')
  } finally {
    cleanup(dir)
  }
})
