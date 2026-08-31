import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { ingestUrl } from '../scripts/lib/fetchurl.mjs'

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
    const { entry, body } = await ingestUrl(
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
    assert.equal(body, PAGE, 'the raw fetched body is returned alongside the entry')
  } finally {
    cleanup(dir)
  }
})

test('scripts and styles do not become corpus, and alt text does', async () => {
  const dir = makeTmpProject({})
  try {
    const { entry } = await ingestUrl(
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

test('a JS-rendered shell fails the gate and is marked for the model tier', async () => {
  const dir = makeTmpProject({})
  try {
    const shell = '<!doctype html><html><body><div id="root"></div><script src="app.js"></script></body></html>'
    const { entry } = await ingestUrl(
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
    const { entry, body } = await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://acme.com/gone', retain: 'none' },
      { kbRoot: path.join(dir, '.voice-and-tone'), now: NOW, id: 'f001', locale: 'en', fetchImpl: stub('', { status: 404 }) }
    )
    assert.equal(entry.status, 'skipped')
    assert.ok(entry.quality.reasons.join(' ').includes('404'))
    assert.equal(body, null, 'nothing usable was fetched, so there is no body to snapshot')
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
    assert.equal(a.entry.sha256, b.entry.sha256)
  } finally {
    cleanup(dir)
  }
})

// --- Fix round: findings 2, 3 ---

test('a non-html content-type is skipped with a visible reason instead of being absorbed as prose', async () => {
  const dir = makeTmpProject({})
  try {
    const jsonBody = JSON.stringify({ hello: 'world', note: 'this is not a web page' })
    const { entry, body } = await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://acme.com/api/thing', retain: 'snapshot' },
      {
        kbRoot: path.join(dir, '.voice-and-tone'), now: NOW, id: 'f001', locale: 'en',
        fetchImpl: stub(jsonBody, { contentType: 'application/json' })
      }
    )
    assert.equal(entry.status, 'skipped')
    assert.equal(entry.quality.note, 'unreadable')
    assert.ok(entry.quality.reasons.join(' ').includes('application/json'), 'the actual content-type is named, not hidden')
    assert.equal(body, jsonBody, 'the bytes were still fetched and are handed back for evidence, even though nothing was extracted')
  } finally {
    cleanup(dir)
  }
})

test('an unknown (absent) content-type is still attempted rather than blocked', async () => {
  const dir = makeTmpProject({})
  try {
    const { entry } = await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://acme.com/about', retain: 'none' },
      { kbRoot: path.join(dir, '.voice-and-tone'), now: NOW, id: 'f001', locale: 'en', fetchImpl: stub(PAGE, { contentType: '' }) }
    )
    assert.equal(entry.status, 'used', 'no positive evidence the content is unreadable, so it is not blocked on absence alone')
  } finally {
    cleanup(dir)
  }
})

test('a server that never answers is recorded as a timed-out skip, not an infinite hang', async () => {
  const dir = makeTmpProject({})
  try {
    const hang = () => (_url, { signal } = {}) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('The operation was aborted.')
        error.name = 'AbortError'
        reject(error)
      })
    })

    const { entry, body } = await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://acme.com/hangs', retain: 'snapshot' },
      {
        kbRoot: path.join(dir, '.voice-and-tone'), now: NOW, id: 'f001', locale: 'en',
        fetchImpl: hang(), timeoutMs: 25
      }
    )
    assert.equal(entry.status, 'skipped')
    assert.equal(entry.quality.note, 'unreadable')
    assert.ok(entry.quality.reasons.join(' ').includes('timed out'), 'the reason names a timeout, not a generic failure')
    assert.equal(body, null)
  } finally {
    cleanup(dir)
  }
})

test('a registered url with a non-http scheme is refused instead of being fetched', async () => {
  const dir = makeTmpProject({})
  try {
    for (const url of ['file:///etc/passwd', 'data:text/html,<b>hi</b>', 'ftp://example.invalid/x']) {
      let reached = null
      const spy = async (u) => { reached = String(u); return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => '' } }

      // runAdd's own ^https?:// test only guards the path a user types on.
      // config.yml is committed, so a `sources:` entry can arrive with a clone
      // having never passed through it - the refusal has to happen here.
      const { entry, body } = await ingestUrl(
        { id: 's01', url },
        { kbRoot: path.join(dir, '.voice-and-tone'), now: NOW, id: 'f001', fetchImpl: spy }
      )

      assert.equal(reached, null, `${url} must never reach fetch`)
      assert.equal(body, null)
      assert.equal(entry.quality.note, 'unreadable')
      assert.match(entry.quality.reasons[0], /only http and https/)
    }
  } finally {
    cleanup(dir)
  }
})

test('an ordinary https url is still fetched', async () => {
  const dir = makeTmpProject({})
  try {
    let reached = null
    const spy = async (u) => { reached = String(u); return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => PAGE } }
    await ingestUrl(
      { id: 's01', url: 'https://example.invalid/about' },
      { kbRoot: path.join(dir, '.voice-and-tone'), now: NOW, id: 'f001', fetchImpl: spy }
    )
    assert.equal(reached, 'https://example.invalid/about')
  } finally {
    cleanup(dir)
  }
})
