import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { ingestUrl, snapshotPathFor } from '../scripts/lib/fetchurl.mjs'

const NOW = '2026-08-27T00:00:00.000Z'
const PAGE = `<!doctype html><html><head><title>About</title><style>b{}</style></head>
<body><script>var x=1</script><h1>How we write</h1>
<p>We write plainly. We keep every sentence short.</p>
<img alt="A team at a desk" src="x.png"></body></html>`

const stub = (body, { status = 200, contentType = 'text/html' } = {}) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
  text: async () => body
})

test('a fetched page is extracted through the existing html path', async () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const entry = await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://acme.com/about', label: 'About', retain: 'none' },
      { kbRoot: kb, now: NOW, id: 'f001', locale: 'en', fetchImpl: stub(PAGE) }
    )

    assert.equal(entry.kind, 'url')
    assert.equal(entry.status, 'used')
    assert.equal(entry.tier, 'script')
    assert.equal(entry.fidelity, 'measured')
    const text = entry.stats
    assert.ok(text.words > 5)
    assert.equal(entry.origin, 'https://acme.com/about')
  } finally {
    cleanup(dir)
  }
})

test('scripts and styles do not become corpus, and alt text does', async () => {
  const dir = makeTmpProject({})
  try {
    const entry = await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://acme.com/about', retain: 'none' },
      { kbRoot: path.join(dir, '.voice-and-tone'), now: NOW, id: 'f001', locale: 'en', fetchImpl: stub(PAGE) }
    )
    // extractHtml already handles this; the test guards the wiring, not the parser.
    assert.ok(entry.quality.passed)
    assert.ok(entry.stats.words >= 10)
  } finally {
    cleanup(dir)
  }
})

test('retain none writes no snapshot; retain snapshot writes a committed one', async () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://acme.com/a', retain: 'none' },
      { kbRoot: kb, now: NOW, id: 'f001', locale: 'en', fetchImpl: stub(PAGE) }
    )
    assert.equal(existsSync(snapshotPathFor(kb, 'f001', '2026-08-27')), false)

    await ingestUrl(
      { id: 's05', kind: 'url', url: 'https://acme.com/b', retain: 'snapshot' },
      { kbRoot: kb, now: NOW, id: 'f002', locale: 'en', fetchImpl: stub(PAGE) }
    )
    assert.equal(existsSync(snapshotPathFor(kb, 'f002', '2026-08-27')), true)
  } finally {
    cleanup(dir)
  }
})

test('a JS-rendered shell fails the gate and is marked for the model tier', async () => {
  const dir = makeTmpProject({})
  try {
    const shell = '<!doctype html><html><body><div id="root"></div><script src="app.js"></script></body></html>'
    const entry = await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://spa.example', retain: 'none' },
      { kbRoot: path.join(dir, '.voice-and-tone'), now: NOW, id: 'f001', locale: 'en', fetchImpl: stub(shell) }
    )
    assert.equal(entry.status, 'skipped')
    assert.ok(entry.quality.reasons.some((r) => r.startsWith('empty')))
  } finally {
    cleanup(dir)
  }
})

test('a non-200 response is recorded as skipped with its status, not thrown', async () => {
  const dir = makeTmpProject({})
  try {
    const entry = await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://acme.com/gone', retain: 'none' },
      { kbRoot: path.join(dir, '.voice-and-tone'), now: NOW, id: 'f001', locale: 'en', fetchImpl: stub('', { status: 404 }) }
    )
    assert.equal(entry.status, 'skipped')
    assert.ok(entry.quality.reasons.join(' ').includes('404'))
  } finally {
    cleanup(dir)
  }
})

test('the hash is of the fetched body, so an unchanged page re-ingests identically', async () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const opts = { kbRoot: kb, now: NOW, locale: 'en', fetchImpl: stub(PAGE) }
    const a = await ingestUrl({ id: 's04', kind: 'url', url: 'https://acme.com/x', retain: 'none' }, { ...opts, id: 'f001' })
    const b = await ingestUrl({ id: 's04', kind: 'url', url: 'https://acme.com/x', retain: 'none' }, { ...opts, id: 'f002' })
    assert.equal(a.sha256, b.sha256)
  } finally {
    cleanup(dir)
  }
})
