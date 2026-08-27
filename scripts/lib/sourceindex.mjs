import path from 'node:path'
import { existsSync } from 'node:fs'
import { readTextFile, writeTextFile } from './fsx.mjs'
import { mergeStats } from './metrics.mjs'

/**
 * evidence/sources.json - the record of what has been analysed, and the only
 * part of the sourcing pipeline that is committed.
 *
 * Identity is the sha256 of the bytes, never the path. That is forced by the
 * decision not to commit sources: the same document sits at a different path
 * on every machine, so a path-keyed index would report one colleague's copy of
 * a file as a second, unrelated source. Hashing makes re-adding a known file a
 * detectable no-op.
 *
 * Each entry carries a `stats` block that is a sufficient statistic for the
 * fingerprint, AND the `locale` it was measured under (a Stats block carries
 * no locale of its own - fingerprintFromStats re-derives English-ness from
 * whatever locale it is handed, so a block stored without its locale can be
 * silently mis-attributed on replay). That pairing is what lets the source
 * itself be discarded: the aggregate stays recomputable and any single source
 * stays subtractable with no source text present anywhere.
 */

export function indexPathFor (kbRoot) {
  return path.join(kbRoot, 'evidence', 'sources.json')
}

export function loadIndex (kbRoot) {
  const file = indexPathFor(kbRoot)
  if (!existsSync(file)) return { generated: new Date(0).toISOString(), sources: [] }
  try {
    const parsed = JSON.parse(readTextFile(file))
    return { generated: parsed.generated ?? '', sources: Array.isArray(parsed.sources) ? parsed.sources : [] }
  } catch {
    // A corrupt index is replaced, not repaired - the same posture
    // fingerprint.mjs takes toward a corrupt previous fingerprint.
    return { generated: new Date(0).toISOString(), sources: [] }
  }
}

// The numeric part of an `f`-prefixed id, or 0 for anything that does not
// parse. Shared by nextEntryId (find the highest) and saveIndex (sort by
// it) so the two never drift apart on what counts as "the number".
function idNum (id) {
  return Number(/^f(\d+)$/.exec(String(id ?? ''))?.[1] ?? 0)
}

export function saveIndex (kbRoot, index, now) {
  // Sorted numerically, not lexicographically: ids are zero-padded only up
  // to 3 digits ('f001'..'f999') and grow unpadded past that ('f1000'), so
  // a plain string compare would put 'f1000' before 'f999' once the index
  // passes 1000 entries - wrong order, and it defeats the whole reason this
  // is sorted, which is a stable, reviewable git diff.
  const sorted = [...(index.sources ?? [])].sort((a, b) => idNum(a.id) - idNum(b.id))
  const payload = { generated: now, sources: sorted }
  writeTextFile(indexPathFor(kbRoot), `${JSON.stringify(payload, null, 2)}\n`)
}

export function nextEntryId (index) {
  let highest = 0
  for (const source of index.sources ?? []) {
    const n = idNum(source?.id)
    if (n > highest) highest = n
  }
  return `f${String(highest + 1).padStart(3, '0')}`
}

/**
 * Entries produced by a version of a vendored library other than the one
 * `current` (the parsed contents of vendor/manifest.json) now records.
 *
 * An entry with no `extractor` stamp (a copy format such as markdown or
 * plain text never went through a vendored parser) never goes stale here -
 * there is nothing whose version could have moved out from under it. An
 * entry naming a library `current` no longer lists is left alone rather than
 * flagged: that is a manifest problem, not a reason to invalidate every
 * source it ever produced.
 */
export function staleByExtractor (index, current) {
  const libraries = current?.libraries ?? {}
  return (index.sources ?? []).filter((source) => {
    const extractor = source.extractor
    if (!extractor) return false
    const lib = libraries[extractor.name]
    if (!lib) return false
    return lib.version !== extractor.version
  })
}

export function bySha (index) {
  const map = new Map()
  for (const source of index.sources ?? []) map.set(source.sha256, source)
  return map
}

/** Matched on hash. An existing entry keeps its id and gains a fresh origin. */
export function upsertEntry (index, entry) {
  index.sources = index.sources ?? []
  const existing = index.sources.find((s) => s.sha256 === entry.sha256)
  if (!existing) {
    index.sources.push(entry)
    return entry
  }
  Object.assign(existing, entry, { id: existing.id, added: existing.added ?? entry.added })
  return existing
}

/**
 * Replace the entry whose bytes have changed on disk (a `diffIndex` `stale`
 * result) with the newly ingested version of the same document, so the
 * superseded version's statistics stop contributing to the fingerprint.
 * Without this, upserting the new bytes by their (necessarily different)
 * hash would create a second entry while the old one kept sitting in the
 * index, and an edited source would count twice - once under each of its
 * versions - forever.
 *
 * The replacement is written under `oldId`, not whatever id `newEntry`
 * happened to carry: this is the same document, edited, not an unrelated
 * new one, and anything that cites this source by index id (a rule's
 * `source`-type evidence) should keep resolving to "this document, now
 * current" rather than dangling the moment someone fixes a typo in it.
 * This is continuity of an id still in service, not the reuse of a
 * retired one, so it does not conflict with ids otherwise never being
 * reused.
 *
 * If `oldId` is not present (already removed, or called out of order),
 * this degrades to a plain insert rather than throwing - the end state
 * (`newEntry` present under `oldId`, nothing superseded left behind) is
 * the same either way.
 */
export function supersedeEntry (index, oldId, newEntry) {
  index.sources = index.sources ?? []
  const at = index.sources.findIndex((s) => s.id === oldId)
  const replacement = { ...newEntry, id: oldId }
  if (at === -1) {
    index.sources.push(replacement)
  } else {
    index.sources[at] = replacement
  }
  return replacement
}

/**
 * What is new, what is already analysed, what changed, what is not here.
 *
 * The five buckets are a strict partition: every resolved file lands in
 * exactly one of `known`, `fresh`, or `stale` (a file also contributing to
 * `stale` is never also counted in `fresh` - the two used to overlap on an
 * edited file, which is the defect this comment now guards against). A
 * consumer must process both `fresh` and `stale`, not just `fresh`:
 *   - `fresh`  - no entry exists for this file yet. Ingest it and add a new
 *                entry (e.g. via `upsertEntry`).
 *   - `stale`  - an entry already exists for this origin, but the bytes
 *                changed. Ingest it and supersede the old entry (via
 *                `supersedeEntry`), never just add alongside it - the old
 *                entry's statistics must stop contributing, or the source
 *                is double-counted, once under each version of itself.
 * Treating `stale` as informational and only acting on `fresh` silently
 * stops re-reading any document that ever gets edited.
 *
 * `hashOf(abs)` is injected so the caller controls when bytes are read - the
 * CLI hashes lazily, and a test can supply a stub.
 */
export function diffIndex (index, resolved, hashOf) {
  const known = []
  const fresh = []
  const stale = []
  const skipped = []
  const seen = new Set()
  const byHash = bySha(index)
  const byOrigin = new Map((index.sources ?? []).map((s) => [s.origin, s]))

  for (const entry of resolved ?? []) {
    for (const item of entry.skipped ?? []) skipped.push({ ...item, from: entry.id })

    for (const file of entry.files ?? []) {
      const sha = hashOf(file.abs)
      const candidate = { ...file, from: entry.id, sha256: sha }

      if (byHash.has(sha)) {
        seen.add(sha)
        known.push(candidate)
        continue
      }
      // Same place, different bytes: the document was edited or replaced.
      // This is stale, not fresh - it must land in exactly one bucket, or a
      // consumer that only acts on `fresh` silently double-counts it once
      // superseding runs, and a consumer that only acts on `stale` never
      // notices a genuinely new file.
      const previous = byOrigin.get(file.origin)
      if (previous) {
        seen.add(previous.sha256)
        stale.push({ entry: previous, file: candidate })
        continue
      }
      fresh.push(candidate)
    }
  }

  const missing = (index.sources ?? []).filter(
    (s) => s.kind !== 'url' && !seen.has(s.sha256)
  )
  return { fresh, known, stale, missing, skipped }
}

// Only these statuses genuinely imply a measured stats block. `new` is
// deliberately absent: the index is the record of what has been analysed,
// so a registered-but-not-yet-ingested file has no business being an index
// entry at all - diffIndex() returns it as `fresh`, and it only gains an
// entry (as `used` or `skipped`) once ingestion actually runs. `new` should
// therefore never be persisted to evidence/sources.json. Tolerating it below
// anyway - excluding it rather than throwing - is not an endorsement of it
// appearing; it is a guard against a future producer's typo, or a status
// string this index has not been taught about yet, becoming a hard runtime
// failure two tasks downstream instead of a harmless no-op.
const STATS_REQUIRED = new Set(['used', 'missing', 'stale'])

/**
 * Per-locale merged statistics, computed from the index alone - no source
 * text anywhere.
 *
 * `includeMissing` defaults to true and that default is the whole point: a
 * source absent from this machine still contributes, because its statistics
 * were recorded when it was analysed. Setting it false would make a fresh
 * clone report every metric as changed, which :audit would then present as
 * drift in the brand's writing. It also answers a real diagnostic question -
 * "what does the fingerprint look like from only what is actually on this
 * machine?" - which is why the option exists rather than being removed.
 *
 * A `skipped` entry contributes nothing, full stop - even one that somehow
 * carries a `stats` block (a hand-edited index, a bug upstream) is excluded
 * on `status` alone rather than on whether `stats` looks usable, because
 * `skipped` means the quality gate rejected the extraction and its numbers
 * were never trustworthy to begin with. A status outside `STATS_REQUIRED`
 * (this always includes `new`, and anything this index has not been taught
 * about) is excluded the same way, without contributing and without being
 * fatal - see the comment on `STATS_REQUIRED` above.
 *
 * `used`, `missing`, and `stale` are expected to carry real statistics -
 * that is the entire premise this index exists to serve. A `stats: null` on
 * one of those is not a quiet corpus gap, it is corruption: silently
 * dropping it would silently shrink the aggregate with nothing to say why,
 * which is exactly the confidently-reported-fiction failure mode
 * mergeStats() already refuses to produce for a mismatched locale. This
 * throws for the same reason. Likewise every contributing entry must carry
 * its own `locale` - a Stats block has no locale of its own, so a missing
 * one cannot be coerced to a guessed default (e.g. 'en') without risking
 * silently folding a foreign-locale block into the English bucket it was
 * never measured against.
 */
export function statsByLocale (index, { includeMissing = true } = {}) {
  const buckets = new Map()
  for (const source of index.sources ?? []) {
    if (source.status === 'skipped') continue
    if (!includeMissing && source.status === 'missing') continue
    if (!STATS_REQUIRED.has(source.status)) continue

    if (!source.stats) {
      throw new Error(
        `statsByLocale: entry ${source.id ?? '?'} has status '${source.status}' but no stats block - ` +
        'that is corruption, not an empty source, and must not be silently excluded from the aggregate'
      )
    }
    if (source.locale === null || source.locale === undefined) {
      throw new Error(
        `statsByLocale: entry ${source.id ?? '?'} has no locale - a Stats block cannot be safely ` +
        'bucketed without one, and defaulting it would risk mixing it into a locale it was never measured against'
      )
    }

    const bucket = buckets.get(source.locale) ?? []
    bucket.push(source.stats)
    buckets.set(source.locale, bucket)
  }
  const merged = new Map()
  for (const [locale, list] of buckets) merged.set(locale, mergeStats(list))
  return merged
}
