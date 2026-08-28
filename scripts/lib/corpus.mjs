import path from 'node:path'
import { walk, readTextFile, toPosix } from './fsx.mjs'
import { extractStrings, extractHeadings, formatFor, isBinaryFormat } from './extract.mjs'
import { activeProfile, localeOf } from './config.mjs'
import { loadRegister, resolveRegister } from './register.mjs'
import { loadIndex, statsByLocale, STATS_REQUIRED } from './sourceindex.mjs'

/**
 * Read every copy-bearing file the config points at, in a stable order.
 * Files that yield no copy are dropped: an empty locale stub is not a data point.
 *
 * @param {string} projectRoot
 * @param {object} config
 * @param {string} [profileName]
 * @param {string[]} [unreadable] - out-parameter. A JSON file that yields zero
 *   strings is ambiguous between "really empty" and "malformed" -
 *   extractStrings has no error channel and swallows a JSON.parse failure
 *   into an empty array. Rather than let a broken locale file disappear
 *   indistinguishably from an empty valid one, its rel path is pushed here.
 *   It still contributes no strings to the returned corpus. An out-parameter
 *   is used instead of a property on the returned array because a property
 *   does not survive .map/.filter/.flatMap/spread/Array.from/destructuring -
 *   any of which a caller is free to apply to the array this function
 *   returns - so a plain property would work only for a caller holding the
 *   exact original reference. This one is visible in the signature and
 *   passes through untouched by construction.
 * @param {Array<{rel:string,ext:string,reason:string}>} [skipped] -
 *   out-parameter, same rationale as `unreadable`. A file matched by an
 *   include glob whose extension has no extractor used to vanish without
 *   trace: absent from the manifest's `files` AND from `unreadable`, which
 *   only ever covered malformed JSON. A user pointing scan.include at a
 *   folder of PDFs saw "0 files" with nothing to act on. Recording the
 *   extension - not merely a count - is what makes the resulting message
 *   actionable.
 *
 *   `reason` distinguishes the two ways a file lands here, because they call
 *   for different action from the reader:
 *     - 'no-extractor': the extension has no extractor at all (.fig, .sketch).
 *     - 'container': the extension is a supported container format (.pdf,
 *       .docx, ...) that gatherCorpus deliberately does not read. This is the
 *       TEXT path - it hands extractStrings only decoded text - and a
 *       container's bytes belong to the ingest ladder (`/connect`), not
 *       here. Collapsing both into one count would tell a reader their PDFs
 *       "were skipped" without saying they are supported and simply need
 *       ingesting.
 */
export function gatherCorpus (projectRoot, config, profileName = 'default', unreadable = [], skipped = []) {
  const profile = activeProfile(config, profileName)
  const primary = profile.primary_locale ?? 'en'
  const locales = profile.locales ?? [primary]
  const out = []

  for (const abs of walk(projectRoot, config.scan)) {
    const rel = toPosix(path.relative(projectRoot, abs))
    const ext = path.extname(abs).toLowerCase()

    // Both gates below are decided by the path alone, so they must run
    // BEFORE the read. Otherwise a glob pointing at a directory of large
    // binaries slurps every one of them into memory only to discard it at
    // the extension check.
    const format = formatFor(abs)
    if (!format) {
      skipped.push({ rel, ext, reason: 'no-extractor' })
      continue
    }
    // A container format's bytes are not text: extractStrings refuses them
    // (see extract.mjs), and rightly so - but that refusal must never be
    // reached from here. Route it to `skipped` instead, exactly like an
    // unknown extension, so a PDF or an Office file next to a glob of
    // markdown does not crash the whole scan.
    if (isBinaryFormat(format)) {
      skipped.push({ rel, ext, reason: 'container' })
      continue
    }

    let raw
    try { raw = readTextFile(abs) } catch { continue } // unreadable file is skipped, not fatal
    const { strings } = extractStrings(abs, raw)
    if (strings.length === 0) {
      if (format === 'json') unreadable.push(rel)
      continue
    }
    out.push({
      rel,
      abs,
      format,
      locale: localeOf(rel, locales, primary),
      strings,
      headings: extractHeadings(abs, raw)
    })
  }
  return out
}

/** Group a gathered corpus by locale. Spec 5.3: locales are never averaged together. */
export function byLocale (corpus) {
  const buckets = new Map()
  for (const file of corpus) {
    const bucket = buckets.get(file.locale) ?? { strings: [], headings: [], files: 0 }
    bucket.strings.push(...file.strings)
    bucket.headings.push(...file.headings)
    bucket.files += 1
    buckets.set(file.locale, bucket)
  }
  return buckets
}

/**
 * Everything the corpus is made of, from the two places it can come from.
 *
 * Project files are read LIVE: they are committed, always present, and cheap.
 * Everything else comes from the INDEX, never from re-extracting the source.
 *
 * That split is deliberate. Spec 8.1 keeps URL fetching out of scan so the
 * fingerprint cannot depend on someone else's web server; the same argument
 * applies to extraction. Re-parsing a folder of PDFs on every scan would make
 * the fingerprint depend on whether anyone had run --ingest first, and would
 * make an ordinary scan slow. Ingest is /connect's job alone.
 *
 * @param {string[]} [unreadable] - the same out-parameter gatherCorpus takes,
 *   threaded through so the malformed-JSON signal is not lost when a caller
 *   moves from gatherCorpus to gatherAll. Only a live project file can land
 *   here: an indexed source's text is gone by design, so there is nothing
 *   left to fail to parse.
 *
 * A file is read live if the text path can read it; it is ingested only if
 * it cannot. That is `isBinaryFormat(format)`, and sources.mjs applies it to
 * a `project` entry's files before anything is ever ingested, so an ordinary
 * project text file should never make it into the index in the first place.
 * But the index is a persisted file a stale binary or a hand edit can still
 * disagree with, and double-counting a source once live and once from the
 * index is a worse failure than a corrupt index entry sitting there unused
 * - so this function heals rather than trusts: the live project loop runs
 * FIRST and wins, and any index entry sharing its origin is dropped rather
 * than merged, unconditionally, regardless of how it got there.
 *
 * The return value's `unindexed` array is a third channel, beside `skipped`
 * and `missing`: files a non-project register entry (inbox, local) can see on
 * disk right now but that carry no index entry yet - registered, but never
 * ingested. Before this existed, such a file simply disappeared from every
 * count `scan`/`fingerprint` print, and the empty-corpus message told a
 * reader to check `scan.include`, a key this path never even reads.
 */
export function gatherAll ({ projectRoot, kbRoot, config, profileName = 'default', unreadable = [] }) {
  const register = loadRegister(config)
  const resolved = resolveRegister(register, { projectRoot, kbRoot, config, profileName })
  const index = loadIndex(kbRoot)
  const indexedOrigins = new Set((index.sources ?? []).map((s) => s.origin))

  const files = []
  const skipped = []
  const unindexed = []
  const liveOrigins = new Set()

  for (const entry of resolved) {
    // The register's own vocabulary is a strict subset of gatherCorpus's -
    // see resolveEntry's comment - so `reason` here is always 'no-extractor',
    // but it is still carried through rather than assumed, exactly as the
    // container branch below carries its own reason explicitly.
    for (const item of entry.skipped) skipped.push({ rel: item.origin, ext: item.ext, reason: item.reason })
    if (entry.kind !== 'project') {
      // A non-project entry (inbox, local, url) is never read live - only the
      // index contributes its statistics. Before this loop, a file the
      // register could see but nobody had ever ingested simply vanished:
      // absent from `files`, from `skipped`, and from `unreadable` alike.
      // `scan` then printed "0 files" and `fingerprint` printed "no copy
      // found; check scan.include" - actively wrong advice, since the fix is
      // to ingest, not to touch a key resolveRegister never even reads for
      // this entry. Recording the file here (rather than silently dropping
      // it) is what lets a caller say "N registered file(s) need
      // /voice-and-tone:connect --ingest" instead.
      for (const file of entry.files) {
        if (!indexedOrigins.has(file.origin)) unindexed.push({ rel: file.origin, ext: path.extname(file.abs).toLowerCase() })
      }
      continue
    }

    for (const file of entry.files) {
      // A container format (.pdf, .docx, ...) is a resolvable file to the
      // register - it may be ingested - but it is not text. extractStrings
      // refuses it (extract.mjs), and that refusal must never be reached
      // from a live read: route it to `skipped` exactly like gatherCorpus
      // does, so a PDF sitting inside a project scan glob does not crash
      // the scan (the R23 regression test/scan.test.mjs and
      // test/corpus.test.mjs guard against).
      if (isBinaryFormat(file.format)) {
        skipped.push({ rel: file.origin, ext: path.extname(file.abs).toLowerCase(), reason: 'container' })
        continue
      }

      let raw
      try { raw = readTextFile(file.abs) } catch { continue } // unreadable file is skipped, not fatal
      const { strings } = extractStrings(file.abs, raw)
      if (strings.length === 0) {
        if (file.format === 'json') unreadable.push(file.origin)
        continue
      }
      liveOrigins.add(file.origin)
      files.push({
        rel: file.origin,
        abs: file.abs,
        format: file.format,
        locale: file.locale,
        strings,
        headings: extractHeadings(file.abs, raw),
        sourceId: entry.id,
        tier: 'script',
        fidelity: 'measured'
      })
    }
  }

  // The text is gone by design once a source is indexed; the counts remain.
  // Admitted by the same whitelist statsByLocale enforces (`used`, `missing`,
  // `stale` genuinely imply a measured stats block) rather than a separately
  // maintained blacklist that can silently drift from it. `liveOrigins`
  // excludes any entry the live project loop above already emitted: sources.mjs
  // keeps a project's text files out of the index going forward, but a
  // sources.json written before that fix - or hand-edited - can still hold
  // one, and it must not double the fingerprint forever just because it is
  // sitting there.
  const indexed = (index.sources ?? []).filter((s) =>
    s.stats && STATS_REQUIRED.has(s.status) && !liveOrigins.has(s.origin))
  for (const source of indexed) {
    files.push({
      rel: source.origin,
      abs: null,
      format: source.format,
      locale: source.locale ?? 'en',
      strings: [],                 // the text is gone by design; the counts remain
      headings: [],
      stats: source.stats,
      sourceId: source.from ?? null,
      entryId: source.id,
      tier: source.tier,
      fidelity: source.fidelity,
      status: source.status
    })
  }

  return {
    files,
    skipped,
    unindexed,
    indexStats: statsByLocale({
      generated: index.generated,
      sources: (index.sources ?? []).filter((s) => !liveOrigins.has(s.origin))
    }),
    missing: indexed.filter((s) => s.status === 'missing').length,
    estimatedLocales: new Set(indexed.filter((s) => s.fidelity === 'estimated').map((s) => s.locale ?? 'en'))
  }
}
