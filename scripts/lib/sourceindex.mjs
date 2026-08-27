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

export function saveIndex (kbRoot, index, now) {
  const sorted = [...(index.sources ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const payload = { generated: now, sources: sorted }
  writeTextFile(indexPathFor(kbRoot), `${JSON.stringify(payload, null, 2)}\n`)
}

export function nextEntryId (index) {
  let highest = 0
  for (const source of index.sources ?? []) {
    const n = Number(/^f(\d+)$/.exec(String(source?.id ?? ''))?.[1] ?? 0)
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
 * What is new, what is already analysed, what changed, what is not here.
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
      const previous = byOrigin.get(file.origin)
      if (previous) {
        seen.add(previous.sha256)
        stale.push({ entry: previous, file: candidate })
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
