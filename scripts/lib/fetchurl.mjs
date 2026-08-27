import path from 'node:path'
import { writeTextFile } from './fsx.mjs'
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
 */

const USER_AGENT = 'voice-and-tone-plugin (+https://example.invalid/voice-and-tone)'

export function snapshotPathFor (kbRoot, id, date) {
  return path.join(kbRoot, 'evidence', 'snapshots', `${id}-${date}.html`)
}

export async function fetchPage (url, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('no fetch implementation available; Node 18 or newer is required')
  }
  const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' } })
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers?.get?.('content-type') ?? '',
    body: response.ok ? await response.text() : ''
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
 * A fetch that never produced a page: the network failed, or the server
 * answered with something other than 2xx. There is no text to score, and no
 * text a model would recover either - a 404 is a 404 whichever tier asks for
 * it - so this is `unreadable`, the same verdict ingest.mjs already gives a
 * container that would not even open, and (per needsModelTier) it does not
 * escalate.
 *
 * ingestText is still reused for the surrounding shape - id, dates, tier,
 * fidelity, the full zero-valued quality object - only `note` and `reasons`
 * are corrected afterward. ingestText hardcodes note: 'ok' for its other
 * caller (a model-tier transcription, where "nothing came back" really does
 * mean the page was blank); a fetch that never landed is a different fact
 * and needs its own words.
 */
function unreachableEntry (entry, { kbRoot, now, id, locale, sha256, reason }) {
  const result = ingestText(
    { sha256, origin: entry.url, kind: 'url', format: 'html', bytes: 0, locale, label: entry.label ?? null, strings: [], headings: [] },
    { kbRoot, now, id, from: entry.id, tier: 'script' }
  )
  result.quality.note = 'unreadable'
  result.quality.reasons = [reason]
  return result
}

/**
 * Fetch one registered URL source and run it through the ingest ladder.
 *
 * Identity: `sha256` is the hash of the response body actually returned by
 * this fetch (see the `sha256Text(page.body)` line below) - the same rule
 * file sources already use, that a source's identity is its bytes, not
 * anything about where they came from. The cost is real: a page that embeds
 * a timestamp, a CSRF token, or a rotating banner in its own markup will
 * hash differently on every `--refresh` even when nothing a person would
 * call "the content" has changed. That is accepted here rather than hashing
 * only the extracted text, because `--refresh` always supersedes rather than
 * appends (see sources.mjs's runRefresh) - a spurious hash change costs one
 * superseded entry and a "these rules may need re-deriving" notice, never an
 * unbounded index. The alternative (hash the extracted strings instead)
 * would swallow that noise, but it would just as quietly swallow a genuine
 * rewrite that happens to keep the same boilerplate around it - and there is
 * no way to tell the two apart from the bytes alone. Given the choice
 * between an occasional false "this changed" and a possible missed "this
 * changed", the false positive is the one a human can dismiss in a glance;
 * the false negative is invisible.
 */
export async function ingestUrl (entry, { kbRoot, now, id, locale = 'en', fetchImpl = globalThis.fetch }) {
  const date = String(now).slice(0, 10)

  let page
  try {
    page = await fetchPage(entry.url, { fetchImpl })
  } catch (error) {
    return unreachableEntry(entry, {
      kbRoot, now, id, locale,
      sha256: sha256Text(entry.url),
      reason: `fetch failed: ${error.message}`
    })
  }

  if (!page.ok) {
    return unreachableEntry(entry, {
      kbRoot, now, id, locale,
      sha256: sha256Text(`${entry.url}#${page.status}`),
      reason: `fetch returned ${page.status}`
    })
  }

  const sha256 = sha256Text(page.body)
  const bytes = Buffer.byteLength(page.body, 'utf8')
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

  // Retention is opt-in (spec 8.3): a URL's bytes are the one artifact
  // nobody can recover once the page changes, so committing a snapshot only
  // happens when a caller has said the risk is worth it. This is written
  // whenever the fetch itself succeeded, regardless of whether the quality
  // gate passed - a snapshot of a JS-rendered shell is still the evidence of
  // what was actually fetched, and the only way a later model-tier pass
  // could ever see the same bytes again.
  if (entry.retain === 'snapshot') writeTextFile(snapshotPathFor(kbRoot, id, date), page.body)

  return result
}
