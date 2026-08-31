import path from 'node:path'
import { extractStrings, extractHeadings } from './extract.mjs'
import { sha256Text } from './hash.mjs'
import { ingestText } from './ingest.mjs'

/**
 * The only network code in the plugin, and deliberately not on any path that
 * scan or fingerprint can reach.
 *
 * Spec 8.1: fetching during a scan would make the fingerprint depend on
 * someone else's web server, would require connectivity for every run, and
 * would defeat the --now determinism the other scripts are built around. So a
 * page is fetched once, on request (via /voice-and-tone:connect --refresh),
 * and read from the cache thereafter.
 *
 * The parsing is free: extractStrings/extractHeadings in extract.mjs already
 * dispatch a ".html" path through extractHtml, which strips <script> and
 * <style>, harvests alt/title/aria-label/placeholder, and decodes entities. A
 * fetched page is just HTML entering a path that is already tested - it only
 * needs a fake .html-suffixed path so formatFor() routes it there.
 *
 * ingestUrl deliberately never writes a snapshot itself. It does not know,
 * and must not need to know, whether the candidate it just built will
 * actually be kept - only the caller (runRefresh, sources.mjs) knows that,
 * after comparing hashes against the index. A function that commits a file
 * to git as a side effect of a decision it does not make is the shape of a
 * real bug this plugin shipped: every refresh of an unchanged page used to
 * write another byte-identical snapshot, forever. So ingestUrl returns the
 * raw body alongside the entry, and the caller writes it - once, only for a
 * candidate it has decided to persist. See sources.mjs's runRefresh.
 */

const USER_AGENT = 'voice-and-tone-plugin (+https://example.invalid/voice-and-tone)'

// A sane deadline for a source nobody controls. Without one, a server that
// accepts the connection and never answers hangs /connect --refresh forever
// - there is no other timeout anywhere on this path to save it.
const DEFAULT_TIMEOUT_MS = 15000

export function snapshotPathFor (kbRoot, id, date) {
  return path.join(kbRoot, 'evidence', 'snapshots', `${id}-${date}.html`)
}

/**
 * The only schemes a registered `kind: 'url'` source may name.
 *
 * runAdd already refuses anything else at REGISTRATION time (its `isUrl` test
 * is the same http/https pair), but that check protects only the one path a
 * user types on. config.yml is a committed file: a `sources:` list arrives
 * with a clone, or from a hand edit, having never passed through runAdd - and
 * runRefresh hands whatever it finds there straight to fetch(). Node's fetch
 * accepts `data:` URLs, so an unchecked entry can inject bytes that never
 * touched the network at all, and a `blob:`/other scheme reaches whatever a
 * future runtime decides to support.
 *
 * Validated where the URL is USED rather than only where it is entered - that
 * is the difference between a check and a guarantee.
 */
const FETCHABLE_PROTOCOLS = new Set(['http:', 'https:'])

export function assertFetchable (url) {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    throw new Error(`not a usable url: ${String(url)}`)
  }
  if (!FETCHABLE_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `refusing to fetch a '${parsed.protocol}' url - only http and https sources are fetched ` +
      '(to read something on disk, register it as a local/file source instead)'
    )
  }
  return parsed
}

export async function fetchPage (url, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('no fetch implementation available; Node 18 or newer is required')
  }
  assertFetchable(url)
  // Left ref'd, deliberately: this is the one timer whose firing this
  // function is actually waiting on. Unref'ing it would let Node consider
  // the event loop drained and exit before a genuinely hung connection ever
  // times out - the exact failure this timeout exists to prevent. It is
  // always cleared in the `finally` below well before it could delay a
  // normal exit.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
      signal: controller.signal
    })
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers?.get?.('content-type') ?? '',
      body: response.ok ? await response.text() : ''
    }
  } catch (error) {
    // A real fetch rejects an aborted request with a DOMException named
    // AbortError; a hand-written fetchImpl that honours the same signal
    // (as tests here do) rejects the same way. Either way this is a timeout,
    // not a generic transport failure, and is worth saying so plainly.
    if (error?.name === 'AbortError') {
      throw new Error(`timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A fake ".html" path, never read from disk: extractStrings/extractHeadings
 * dispatch purely on formatFor(path)'s extension, and a fetched page has no
 * real path to give them. Sanitised rather than the raw URL so the odd
 * characters a query string can carry never confuse a caller reading a log
 * line that happens to include it.
 */
function pseudoHtmlPath (url) {
  return `${String(url).replace(/[^\w.-]/g, '_')}.html`
}

/**
 * Whether a response's content-type is something this ingester's HTML path
 * can sensibly read. Unknown/absent (`''`) is let through rather than
 * blocked - some servers simply omit the header, and there is no positive
 * evidence there to act on. Anything explicitly `text/*` or XHTML is let
 * through too. Everything else (application/json, application/pdf, image/*,
 * application/octet-stream, ...) is refused: this router only ever knows how
 * to strip <script>/<style> and read text nodes, and running that over a
 * JSON body or PDF bytes would silently fold an API response or a binary
 * document's raw bytes into the corpus as if it were prose - see the
 * decision recorded on the caller in sources.mjs for what happens instead.
 */
function looksExtractable (contentType) {
  const ct = String(contentType ?? '').toLowerCase().split(';')[0].trim()
  if (ct === '') return true
  if (ct.startsWith('text/')) return true
  return ct === 'application/xhtml+xml'
}

/**
 * A fetch that never produced usable content: the network failed, the
 * server answered with something other than 2xx, or it answered 2xx with a
 * content-type this ingester cannot read. There is no text to score, and no
 * text a model would recover either from these bytes today - a 404 is a 404
 * whichever tier asks for it, and a JSON payload is not made readable by a
 * vision model looking at it either - so this is `unreadable`, the same
 * verdict ingest.mjs already gives a container that would not even open, and
 * (per needsModelTier) it does not escalate.
 *
 * ingestText is still reused for the surrounding shape - id, dates, tier,
 * fidelity, the full zero-valued quality object - only `note` and `reasons`
 * are corrected afterward. ingestText hardcodes note: 'ok' for its other
 * caller (a model-tier transcription, where "nothing came back" really does
 * mean the page was blank); a fetch that never landed cleanly is a different
 * fact and needs its own words.
 */
function unreadableEntry (entry, { kbRoot, now, id, locale, sha256, bytes = 0, reason }) {
  const result = ingestText(
    { sha256, origin: entry.url, kind: 'url', format: 'html', bytes, locale, label: entry.label ?? null, strings: [], headings: [] },
    { kbRoot, now, id, from: entry.id, tier: 'script' }
  )
  result.quality.note = 'unreadable'
  result.quality.reasons = [reason]
  return result
}

/**
 * Fetch one registered URL source and run it through the ingest ladder.
 *
 * Returns `{ entry, body }`, never just the entry: `body` is the raw bytes
 * actually fetched (or `null` when nothing usable was fetched at all - a
 * network failure, a non-2xx, or a timeout), so a caller that has decided to
 * persist this candidate can write a snapshot of exactly what it saw,
 * without re-fetching. See the file header for why ingestUrl itself never
 * writes that snapshot.
 *
 * Identity: `sha256` is the hash of the response body actually returned by
 * this fetch - the same rule file sources already use, that a source's
 * identity is its bytes, not anything about where they came from. The cost
 * is real: a page that embeds a timestamp, a CSRF token, or a rotating
 * banner in its own markup will hash differently on every `--refresh` even
 * when nothing a person would call "the content" has changed. That is
 * accepted here rather than hashing only the extracted text, because
 * `--refresh` always supersedes rather than appends (see sources.mjs's
 * runRefresh) - a spurious hash change costs one superseded entry and a
 * "these rules may need re-deriving" notice, never an unbounded index. The
 * alternative (hash the extracted strings instead) would swallow that
 * noise, but it would just as quietly swallow a genuine rewrite that
 * happens to keep the same boilerplate around it - and there is no way to
 * tell the two apart from the bytes alone. Given the choice between an
 * occasional false "this changed" and a possible missed "this changed", the
 * false positive is the one a human can dismiss in a glance; the false
 * negative is invisible.
 */
export async function ingestUrl (entry, { kbRoot, now, id, locale = 'en', fetchImpl = globalThis.fetch, timeoutMs } = {}) {
  let page
  try {
    page = await fetchPage(entry.url, { fetchImpl, timeoutMs })
  } catch (error) {
    return {
      entry: unreadableEntry(entry, {
        kbRoot, now, id, locale,
        sha256: sha256Text(entry.url),
        reason: `fetch failed: ${error.message}`
      }),
      body: null
    }
  }

  if (!page.ok) {
    return {
      entry: unreadableEntry(entry, {
        kbRoot, now, id, locale,
        sha256: sha256Text(`${entry.url}#${page.status}`),
        reason: `fetch returned ${page.status}`
      }),
      body: null
    }
  }

  const sha256 = sha256Text(page.body)
  const bytes = Buffer.byteLength(page.body, 'utf8')

  if (!looksExtractable(page.contentType)) {
    return {
      entry: unreadableEntry(entry, {
        kbRoot, now, id, locale, sha256, bytes,
        reason: `skipped: content-type '${page.contentType || '(none)'}' is not html/text - ` +
          'this ingester only reads markup; download the file and register it as a local/file ' +
          'source instead (pdf and office formats are already supported there)'
      }),
      // The bytes were genuinely fetched - a caller that opted into
      // retention still gets evidence of what was actually returned, even
      // though nothing was extracted from it.
      body: page.body
    }
  }

  const pseudoPath = pseudoHtmlPath(entry.url)
  const { strings } = extractStrings(pseudoPath, page.body)
  const headings = extractHeadings(pseudoPath, page.body)

  const result = ingestText(
    { sha256, origin: entry.url, kind: 'url', format: 'html', bytes, locale, label: entry.label ?? null, strings, headings },
    { kbRoot, now, id, from: entry.id, tier: 'script' }
  )

  if (strings.length === 0) {
    // ingestText's hardcoded note: 'ok' is right for its other caller (the
    // model tier, which has already read the page by the time it reports
    // in) but wrong here: a fetched page that yielded nothing may be
    // genuinely blank, but it may just as well be a JS-rendered shell whose
    // real content only exists after a script runs client-side - the same
    // "something is there, this tier just cannot read it" shape pdf.mjs's
    // no-text-layer note covers for a scanned page. Treating it as
    // escalation-worthy costs one wasted model call on a page that really
    // was blank; treating it as ordinary emptiness would silently drop
    // every JS-rendered brand page instead.
    result.quality.note = 'no-text-layer'
    result.quality.reasons = ['empty: no-text-layer (a JS-rendered page needs the model tier)']
  }

  return { entry: result, body: page.body }
}
