import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { loadConfig, saveConfig, DEFAULT_CONFIG } from '../scripts/lib/config.mjs'
import { loadIndex } from '../scripts/lib/sourceindex.mjs'
import { runCheck, runIngest, runAdd, runForget, filterVanished, runRefresh, main } from '../scripts/sources.mjs'

const NOW = '2026-08-27T00:00:00.000Z'

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
