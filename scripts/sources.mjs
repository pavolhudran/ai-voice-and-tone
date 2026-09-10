import path from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { loadConfig, saveConfig, activeProfile, isSpeaker } from './lib/config.mjs'
import { isBinaryFormat } from './lib/extract.mjs'
import { loadRegister, resolveRegister, nextRegisterId, expandHome, entriesForProfile } from './lib/register.mjs'
import {
  loadIndex, saveIndex, nextEntryId, upsertEntry, supersedeEntry, diffIndex, statsByLocale,
  recordAlias, originsOf
} from './lib/sourceindex.mjs'
import { ingestFile, needsModelTier } from './lib/ingest.mjs'
import { ingestUrl, snapshotPathFor } from './lib/fetchurl.mjs'
import { readTextFile, writeTextFile } from './lib/fsx.mjs'
import { stringifyYaml } from './lib/yaml.mjs'
import { sha256File } from './lib/hash.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp, writeOut } from './lib/cli.mjs'

/**
 * The CLI behind /voice-and-tone:connect: register brand material and record
 * what has been analysed. It is the only place that ingests, and the first
 * real consumer of the register (register.mjs), the index (sourceindex.mjs)
 * and the ingest ladder (ingest.mjs) - so it is on this script to honour the
 * invariants those modules established, not merely to call into them.
 */

const isUrl = (target) => /^https?:\/\//i.test(String(target))

// `fetchImpl` is never supplied via argv (a function cannot travel through a
// CLI flag) - it is a second, optional parameter to `main` itself, threaded
// through here purely so a test can drive the real `--refresh` CLI path
// (both output formats, all three branches) without ever reaching the
// network. Real invocations never pass it, so `ctx.fetchImpl` is `undefined`
// in production and `ingestUrl`/`fetchPage` fall back to `globalThis.fetch`,
// exactly as before.
function contextFor (values, { fetchImpl } = {}) {
  const { projectRoot, kbRoot } = resolveRoots(values)
  return {
    projectRoot,
    kbRoot,
    config: loadConfig(kbRoot),
    profileName: values.profile ?? 'default',
    now: nowIso(values),
    fetchImpl
  }
}

/** Hash lazily and once per path: a 200 MB deck should be read a single time. */
function hasher () {
  const cache = new Map()
  return (abs) => {
    if (!cache.has(abs)) cache.set(abs, sha256File(abs))
    return cache.get(abs)
  }
}

/**
 * `sha256File` has no error handling of its own: a missing path throws a raw
 * ENOENT. This CLI calls it over directories a user pointed the register at,
 * and register.mjs's walk() lists what exists at the moment it runs - a file
 * can still vanish (deleted, a network share unmounts, an editor's atomic
 * save briefly removes it) in the instant between that listing and the
 * moment `diffIndex` gets around to hashing it.
 *
 * Letting that throw would abort `diffIndex` for every other file behind it
 * in the same call, which is worse than the race itself - one bad file must
 * not take down the check for the other seventy, the same posture
 * `ingestFile` already takes toward an unreadable container. `diffIndex`'s
 * `hashOf` contract is fixed (Task 9), so the fix lives here: an `existsSync`
 * check immediately before diffIndex ever gets a chance to hash, pulling any
 * vanished file out of its entry's `files` list and recording it in a plain
 * `errors` list instead. `diffIndex` then only ever sees files that are
 * actually still there.
 */
export function filterVanished (resolved) {
  const errors = []
  for (const entry of resolved) {
    const survivors = []
    for (const file of entry.files ?? []) {
      if (existsSync(file.abs)) {
        survivors.push(file)
      } else {
        errors.push({ origin: file.origin, from: entry.id, reason: 'vanished' })
      }
    }
    entry.files = survivors
  }
  return errors
}

/**
 * A `project` entry's text files (.md, .json, ...) are already read LIVE by
 * gatherAll (scripts/lib/corpus.mjs) - that is the whole model scan and
 * fingerprint rely on: project text is live, everything else is indexed.
 * Only a project file the live text path cannot read - a container format
 * such as .pdf or .docx - is actually a candidate for ingestion; that is
 * exactly what the scan summary's "N file(s) need ingest, not scan" line
 * tells a user to run --ingest for.
 *
 * Without this filter, an ordinary `--ingest` on an ordinary project would
 * add every project text file to the index too, and gatherAll would then
 * count it twice - once live, once from the index - forever, since the
 * index is committed. Other entry kinds (`inbox`, `local`, `url`) are never
 * read live regardless of format, so every one of their files stays a
 * candidate here; this filter is deliberately scoped to `project` alone.
 */
function restrictProjectFilesToIngestible (resolved) {
  for (const entry of resolved) {
    if (entry.kind !== 'project') continue
    entry.files = entry.files.filter((file) => isBinaryFormat(file.format))
  }
}

/**
 * Re-attribute every indexed entry's locale from the register as it is
 * configured RIGHT NOW.
 *
 * Locale was decided once, at first ingest, from whatever `locales` happened
 * to be declared at that moment - and the shipped template declares `[en]`.
 * Ingesting a Czech corpus before naming its locales therefore filed all of it
 * as English, and declaring `cs` afterwards fixed nothing: re-running
 * `--ingest` matches every file by hash, never re-processes it, and the wrong
 * attribution stayed for the life of the index. The only escape was deleting
 * evidence/sources.json by hand. The script even warned this could happen
 * while offering no way back from it.
 *
 * Re-attribution is safe to do unconditionally and costs nothing: locale is
 * metadata on the entry, not an input to the statistics. `statsFor` computes
 * the English block for every source regardless, and `fingerprintFromStats`
 * decides whether to EXPOSE it from the locale at read time - so correcting
 * the label is genuinely all that is required, with no re-extraction.
 *
 * Attribution reuses the resolved file's own `locale`, computed by
 * `resolveEntry` from the same relative path it used the first time, so this
 * can never disagree with what a fresh ingest would have decided. An entry
 * whose file is not on disk right now is left alone - there is nothing to
 * re-resolve it from, and its statistics are still intact.
 */
export function reattributeLocales (index, resolved) {
  const byOrigin = new Map()
  for (const entry of resolved ?? []) {
    for (const file of entry.files ?? []) byOrigin.set(file.origin, file.locale)
  }

  const changed = []
  for (const source of index.sources ?? []) {
    if (source.kind === 'url') continue // a URL has no path convention to read
    for (const origin of originsOf(source)) {
      if (!byOrigin.has(origin)) continue
      const next = byOrigin.get(origin)
      if (next && next !== source.locale) {
        changed.push({ id: source.id, origin: source.origin, from: source.locale, to: next })
        source.locale = next
      }
      break
    }
  }
  return changed
}

export function runCheck (ctx) {
  // A speaker context sees only its own entries. The house context sees
  // EVERY entry, speakers' included: ingestion is attribution-preserving
  // (each file carries its entry's profile), so one --ingest from the house
  // covers every speaker, and nobody has to run it once per person.
  const register = isSpeaker(ctx.config, ctx.profileName)
    ? entriesForProfile(loadRegister(ctx.config), ctx.profileName, ctx.config)
    : loadRegister(ctx.config)
  const resolved = resolveRegister(register, ctx)
  restrictProjectFilesToIngestible(resolved)
  const index = loadIndex(ctx.kbRoot)
  const errors = filterVanished(resolved)
  const diff = diffIndex(index, resolved, hasher())

  // `known` entries carry a `needsModelTier` verdict recorded at ingest time
  // that does not expire just because nothing about the source changed - a
  // plain --check must surface it too, not only --ingest, so a source can be
  // found again by someone who only ever runs --check first.
  const knownShas = new Set(diff.known.map((f) => f.sha256))
  const escalate = (index.sources ?? []).filter((entry) => knownShas.has(entry.sha256) && needsModelTier(entry))

  // Reported, not applied: --check never writes. Computed on a throwaway copy
  // so the caller can say "N source(s) are filed under the wrong locale" and
  // point at --ingest, which does apply it.
  const relocale = reattributeLocales(
    JSON.parse(JSON.stringify({ sources: index.sources ?? [] })), resolved
  )

  const total = index.sources.length
  return {
    ...diff,
    relocale,
    escalate,
    register,
    resolved,
    index,
    errors,
    // Every registered source missing at once is ambiguous on the numbers
    // alone: it is the ordinary shape of a fresh clone (sources are never
    // committed, so a clean checkout has none of them present), and it is
    // also what a genuinely broken --kb/--root points at looks like. This
    // report cannot tell the two apart, and per the design that keeps
    // `missing` from being a warning, it must not guess wrong in the
    // alarming direction just because the count is total rather than
    // partial - main() below still names the fresh-clone explanation rather
    // than staying silent, but never escalates the tone with "all" being
    // total. See main()'s human-readable summary for how this is presented.
    allMissing: total > 0 && diff.missing.length === total,
    // With sources never committed, absent files are the ordinary state. The
    // statistics that matter survived in the index, so say so plainly rather
    // than warning - a warning here would push people to commit sources just
    // to silence it, which quietly undoes the decision not to.
    statsIntact: statsByLocale(index).size > 0 || index.sources.length === 0
  }
}

/**
 * Actually read a file's bytes and score them, tolerating the same vanish
 * race `filterVanished` guards against one step earlier: `report.fresh` and
 * `report.stale` were computed a moment before this loop runs, and
 * `ingestFile` reads the file itself via `readFileSync`, uncaught for a
 * missing path. One file disappearing here must not abort ingest for the
 * rest of the batch - see the comment on `filterVanished` above for the
 * same reasoning applied to the check step.
 */
async function ingestOne (file, ctx, index, errors) {
  try {
    const entry = await ingestFile(file, {
      kbRoot: ctx.kbRoot,
      now: ctx.now,
      id: nextEntryId(index),
      from: file.from
    })
    // The speaker this file belongs to, or null for the house - stamped
    // here so gatherAll can scope the index without consulting the register.
    entry.profile = file.profile ?? null
    return entry
  } catch (error) {
    errors.push({
      origin: file.origin,
      from: file.from,
      reason: error.code === 'ENOENT' ? 'vanished' : `read-failed: ${error.message}`
    })
    return null
  }
}

export async function runIngest (ctx, { only = null } = {}) {
  const report = runCheck(ctx)
  const index = report.index
  const ingested = []
  const escalate = []
  const reopened = []
  const folded = []
  const errors = [...report.errors]

  const wants = (origin, from, id) => !only || origin === only || from === only || id === only

  const wantedFresh = report.fresh.filter((file) => wants(file.origin, file.from, null))
  // `stale` is not optional to act on: diffIndex's fresh/stale partition is
  // strict (a file is never counted in both), which means a caller that
  // only walks `fresh` silently stops re-reading any document that is ever
  // edited - it just sits there stale forever. Both buckets get ingested.
  const wantedStale = report.stale.filter((item) => wants(item.file.origin, item.file.from, item.entry.id))

  for (const file of wantedFresh) {
    const entry = await ingestOne(file, ctx, index, errors)
    if (!entry) continue
    // Two byte-identical files in the same batch both arrive as `fresh`; the
    // second folds into the first. Catch that here rather than letting it
    // pass as an ordinary ingest, so the run can say a duplicate was folded
    // instead of reporting a file it did not actually add.
    const prior = (index.sources ?? []).find((s) => s.sha256 === entry.sha256)
    const priorOrigin = prior?.origin
    upsertEntry(index, entry)
    if (prior) folded.push({ origin: entry.origin, sameAs: priorOrigin, id: prior.id })
    else ingested.push(entry)
    if (needsModelTier(entry)) escalate.push(entry)
  }

  for (const item of wantedStale) {
    const newEntry = await ingestOne(item.file, ctx, index, errors)
    if (!newEntry) continue
    // The stale entry must be superseded, never upserted alongside: upsert
    // matches on hash, and edited bytes always hash differently, so upserting
    // would leave the old entry sitting in the index next to the new one -
    // its statistics would keep contributing to the fingerprint forever,
    // once under each version of the same document. supersedeEntry retires
    // the old entry in place instead.
    const displaced = supersedeEntry(index, item.entry.id, newEntry)
    // supersedeEntry returns the DISPLACED entry, not the replacement, and it
    // assigns the replacement its own fresh id - so the entry actually saved
    // to the index is looked up by hash rather than assumed to be `newEntry`
    // as ingestOne built it.
    const saved = index.sources.find((s) => s.sha256 === newEntry.sha256) ?? newEntry
    ingested.push(saved)
    if (needsModelTier(saved)) escalate.push(saved)
    if (displaced) {
      // The displaced entry carries its original `produced` list - the rules
      // that source evidenced. Surfacing it is the same courtesy --forget
      // gives: a user learns which rules need re-deriving, because the
      // replacement deliberately starts with an empty `produced` of its own.
      reopened.push({ id: displaced.id, origin: displaced.origin, produced: displaced.produced ?? [] })
    }
  }

  // A second file holding bytes already in the index is one document at two
  // paths, not a new source: it must not be ingested again (that would double
  // it in the fingerprint), but it must be recorded, or `gatherAll` keeps
  // reporting the extra path as a registered file nobody ever ingested and
  // the gap catalogue ranks that above every real gap. Recording the alias is
  // what makes `--ingest` - the command the gap tells you to run - actually
  // close it.
  for (const item of report.duplicate ?? []) {
    if (!wants(item.file.origin, item.file.from, item.entry.id)) continue
    if (recordAlias(index, item.file.sha256, item.file.origin)) {
      folded.push({ origin: item.file.origin, sameAs: item.entry.origin, id: item.entry.id })
    }
  }

  // `known` entries are matched by hash and never re-processed - but a
  // source recorded with needsModelTier true (a Canva PDF, a JS-rendered
  // page) does not stop needing it just because nothing about it changed.
  // Without this, an entry that needed the model tier was announced exactly
  // once, on the run that first ingested it, and never again: neither
  // --check nor --ingest ever mentions it a second time, which makes
  // sourcing.md's documented "do the first ten now, the rest later" workflow
  // unimplementable for anything past the first batch. Mirrors runRefresh's
  // identical re-check of its own `unchanged` bucket.
  const knownShas = new Set(report.known.map((f) => f.sha256))
  for (const entry of index.sources ?? []) {
    if (!knownShas.has(entry.sha256)) continue
    if (!wants(entry.origin, entry.from, entry.id)) continue
    if (needsModelTier(entry)) escalate.push(entry)
  }

  // Anything the register no longer reaches keeps its statistics and is simply
  // marked. This is what makes a fresh clone reproduce the baseline exactly.
  for (const orphan of report.missing) {
    if (orphan.status !== 'skipped') orphan.status = 'missing'
  }

  // Applied here, where the index is persisted. Declaring a locale after the
  // fact used to be unrecoverable; now the next --ingest heals it.
  const relocale = reattributeLocales(index, report.resolved)

  saveIndex(ctx.kbRoot, index, ctx.now)
  return { ...report, ingested, escalate, reopened, folded, relocale, errors }
}

// Passed to ingestUrl as a placeholder `id` for every fetch: the real id is
// only ever assigned once the changed/unchanged decision below is made (a
// fresh insert gets one right before it is persisted; a supersede gets one
// from supersedeEntry itself, which always assigns its own regardless of
// what it is handed). An unchanged fetch never persists this candidate at
// all, so its placeholder id is simply discarded. This is what keeps
// nextEntryId from being called on every single fetch, changed or not.
const PENDING_ID = 'pending'

/**
 * Fetch every registered `kind: 'url'` source and record what came back.
 * Never runs on the scan/fingerprint path (spec 8.1) - this is the one
 * place in the plugin that touches the network, invoked explicitly via
 * /voice-and-tone:connect --refresh, never implicitly by a scan.
 *
 * A URL's identity is the hash of the bytes it returned (ingestUrl, and the
 * comment there), so "did this source change" can only be answered by
 * fetching it - there is no cheap local stat to check first, unlike a file.
 * That means every call here re-fetches every matching entry regardless of
 * whether the last fetch is recent; a caller wanting to fetch only one
 * passes `only` (a register id or the URL itself), the same shape
 * `runIngest`'s `only` already uses.
 *
 * The comparison against what is already indexed mirrors runIngest's
 * fresh/stale handling for files: no prior entry for this register id is a
 * plain insert (upsertEntry); a prior entry whose hash now differs is
 * superseded (supersedeEntry), which hands back the displaced entry so its
 * `produced` rules can be surfaced for re-derivation - the same courtesy a
 * changed file already gets. A prior entry whose hash is UNCHANGED is left
 * untouched rather than run through upsertEntry: upsertEntry's own
 * existing-entry branch overwrites every field but `id`/`added`, including
 * `produced`, and a fetch that came back byte-identical has nothing to
 * report - touching the entry at all would erase rule attribution for no
 * reason. Its `analysed` date is still bumped to today, so the index can
 * tell "checked today, unchanged" from "not checked in weeks", and its
 * escalation signal is re-checked every time (see the comment at that
 * branch below) rather than only being surfaced on the one refresh that
 * happened to change the bytes.
 *
 * Snapshot retention (fetchurl.mjs's file header explains why ingestUrl
 * itself never writes one): a snapshot is written here, once, only for a
 * candidate this function has just decided to actually persist - never for
 * one left in the `unchanged` bucket. That is the fix for the defect this
 * fix round was opened for: every routine refresh of an unchanged page used
 * to write another byte-identical committed file, forever. A snapshot
 * belonging to an entry that gets superseded later is left exactly where it
 * is - it remains the evidence for whatever rules were derived from it, and
 * pruning orphaned snapshots (once an entry superseding a source keeps
 * happening for years) is a separate, not-yet-built piece of housekeeping.
 */
// `timeoutMs` is never exposed as a CLI flag (there is no ordinary reason a
// user would want to shorten or lengthen it on the command line) - it stays
// a programmatic parameter purely so a test can drive a real timeout without
// waiting out fetchPage's real 15-second default, the same reasoning that
// already applies to `only`.
export async function runRefresh (ctx, { only = null, timeoutMs } = {}) {
  const register = loadRegister(ctx.config)
  const index = loadIndex(ctx.kbRoot)
  const profile = activeProfile(ctx.config, ctx.profileName)
  const primaryLocale = profile.primary_locale ?? 'en'
  const date = String(ctx.now).slice(0, 10)

  const wants = (entry) => !only || entry.id === only || entry.url === only
  const urlEntries = register.filter((entry) => entry.kind === 'url' && wants(entry))

  const refreshed = []
  const unchanged = []
  const escalate = []
  const reopened = []
  const errors = []

  for (const entry of urlEntries) {
    let fetched
    try {
      fetched = await ingestUrl(entry, {
        kbRoot: ctx.kbRoot,
        now: ctx.now,
        id: PENDING_ID,
        locale: entry.locale ?? primaryLocale,
        fetchImpl: ctx.fetchImpl,
        timeoutMs
      })
    } catch (error) {
      errors.push({ origin: entry.url, from: entry.id, reason: `refresh-failed: ${error.message}` })
      continue
    }

    const { entry: candidate, body } = fetched
    candidate.profile = entry.profile ?? null
    const existing = index.sources.find((s) => s.kind === 'url' && s.from === entry.id)

    if (existing && existing.sha256 === candidate.sha256) {
      existing.analysed = date
      unchanged.push(existing)
      // Without this, a JS-rendered shell (or any other escalation-worthy
      // verdict) is reported once, on the refresh that first produced it,
      // and never again: the persisted entry still says `no-text-layer`,
      // but every later unchanged refresh used to push-and-continue before
      // ever consulting needsModelTier. Re-checking the already-persisted
      // entry here costs nothing and keeps the signal alive for as long as
      // it stays true.
      if (needsModelTier(existing)) escalate.push(existing)
      continue
    }

    let saved
    let displaced = null
    if (existing) {
      displaced = supersedeEntry(index, existing.id, candidate)
      saved = index.sources.find((s) => s.sha256 === candidate.sha256) ?? candidate
    } else {
      candidate.id = nextEntryId(index)
      upsertEntry(index, candidate)
      saved = candidate
    }

    refreshed.push(saved)
    if (needsModelTier(saved)) escalate.push(saved)
    if (displaced) {
      reopened.push({ id: displaced.id, origin: displaced.origin, produced: displaced.produced ?? [] })
    }

    if (entry.retain === 'snapshot' && body !== null) {
      writeTextFile(snapshotPathFor(ctx.kbRoot, saved.id, date), body)
    }
  }

  saveIndex(ctx.kbRoot, index, ctx.now)
  return { refreshed, unchanged, escalate, reopened, errors }
}

/** One item of a YAML block sequence, at the depth a top-level `key:` list's
 * items sit at (2-space indent for the dash, 4 for the item's own fields) -
 * exactly what config.yml's `sources:` list already uses. Built by asking
 * stringifyYaml to render `{ __item__: [item] }` and discarding the
 * synthetic header line, rather than duplicating its (private)
 * per-item renderer.
 */
function yamlListItemLines (item) {
  return stringifyYaml({ __item__: [item] }).split('\n').slice(1, -1)
}

/** The line index one past the last line belonging to the block sequence
 * that opens at `lines[keyIdx]` (a `key:` line at column 0) - either the
 * next line at column 0, or the position right after the last real content
 * line if the block runs to the end of the file. Blank lines inside or
 * trailing the block never end it by themselves. */
function endOfYamlBlock (lines, keyIdx) {
  let lastContent = keyIdx
  for (let i = keyIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    if (/^\s/.test(line)) { lastContent = i; continue }
    return i
  }
  return lastContent + 1
}

/**
 * Register a new source by editing config.yml's TEXT, not by round-tripping
 * the whole file through parseYaml/stringifyYaml.
 *
 * saveConfig() had no callers before this branch. Its round trip is faithful
 * for VALUES, but it silently drops every comment - the Mailchimp
 * attribution header, the `sources:` explanation, and the comment placed on
 * the inbox's `exclude: ["README.md"]` line specifically so that escape
 * hatch would stay visible in the user's own config. A user's first
 * /connect <path> deleted all three while leaving the data intact - worse
 * than losing data, because nothing LOOKS wrong.
 *
 * Editing the raw text is simpler than teaching the hand-rolled parser to
 * round-trip comments (yaml.mjs is deliberately a minimal subset - see its
 * own header - and comment-preservation would mean attaching each one to a
 * specific line and re-emitting it in the right place for every shape the
 * subset supports) and it is exactly as correct for the one operation --add
 * performs: appending one list item. Every existing entry's text, and every
 * comment anywhere in the file, is left untouched byte-for-byte.
 */
export function registerSource (kbRoot, config, entry) {
  const file = path.join(kbRoot, 'config.yml')
  const register = loadRegister(config)
  const declaredNonEmpty = Array.isArray(config?.sources) && config.sources.length > 0

  if (!existsSync(file)) {
    // Nothing on disk to preserve comments in yet.
    saveConfig(kbRoot, { ...config, sources: [...register, entry] })
    return
  }

  const raw = readTextFile(file)
  const lines = raw.split('\n')
  const keyIdx = lines.findIndex((l) => /^sources:/.test(l))

  let merged
  if (keyIdx !== -1 && declaredNonEmpty) {
    // The block already has real content: append just the new item, leaving
    // every existing entry - and every comment around it - untouched.
    const end = endOfYamlBlock(lines, keyIdx)
    merged = [...lines.slice(0, end), ...yamlListItemLines(entry), ...lines.slice(end)]
  } else if (keyIdx !== -1) {
    // `sources:` is present but declares nothing (`sources: []`/`sources: ~`)
    // - today's register is entirely synthesised from `scan` (register.mjs's
    // migration fallback), and that fallback only runs while `sources` IS
    // empty. Writing just the new entry would silently make that synthesis
    // stop the moment `sources` gains one item - the whole register, not
    // only the new entry, must become explicit here so nothing implicit is
    // dropped.
    const end = endOfYamlBlock(lines, keyIdx)
    const block = ['sources:', ...[...register, entry].flatMap(yamlListItemLines)]
    merged = [...lines.slice(0, keyIdx), ...block, ...lines.slice(end)]
  } else {
    // `sources:` does not appear in the file at all - same reasoning as the
    // empty case just above, but appended as a brand-new section rather than
    // replacing an existing (empty) line.
    const block = ['sources:', ...[...register, entry].flatMap(yamlListItemLines)]
    merged = raw === '' ? block : [...lines, ...block]
  }

  const out = merged.join('\n')
  writeTextFile(file, out.endsWith('\n') ? out : `${out}\n`)
}

export function runAdd (ctx, { target, label = null, profile = null }) {
  const register = loadRegister(ctx.config)
  const id = nextRegisterId(register)

  const owner = profile ? { profile } : {}
  const entry = isUrl(target)
    ? { id, kind: 'url', url: String(target), label, retain: 'none', ...owner }
    : { id, kind: 'local', path: path.resolve(expandHome(target)), label, ...owner }

  registerSource(ctx.kbRoot, ctx.config, entry)
  return { register: [...register, entry], entry }
}

export function runForget (ctx, { id }) {
  const index = loadIndex(ctx.kbRoot)
  const at = (index.sources ?? []).findIndex((s) => s.id === id)
  if (at < 0) {
    // Two id spaces meet at this flag, and the docs used the same `<id>`
    // placeholder for both on adjacent lines: `--refresh --only` takes a
    // REGISTER id (s04), while --forget takes an ANALYSED-ENTRY id (f001).
    // Reaching for s03 here is the natural mistake, so the error names the
    // other namespace rather than only denying this one.
    const register = loadRegister(ctx.config)
    if (register.some((entry) => entry.id === id)) {
      throw new Error(
        `${id} is a registered source, not an analysed entry - --forget takes an entry id ` +
        `(e.g. ${index.sources?.[0]?.id ?? 'f001'}), which --check lists. To stop reading a ` +
        `registered source entirely, remove its entry from config.yml's sources: list.`
      )
    }
    throw new Error(`no source with id ${id}`)
  }

  const [removed] = index.sources.splice(at, 1)
  saveIndex(ctx.kbRoot, index, ctx.now)

  // Subtraction, not deletion. The rules this source produced are named so the
  // caller can re-derive them from what remains - which is only possible
  // because every surviving entry still carries its own statistics.
  return { removed, reopened: removed.produced ?? [], index }
}

function report (lines) {
  writeOut(`${lines.join('\n')}\n`)
}

// The optional second parameter exists purely for tests: it is never
// supplied by the real entry point at the bottom of this file, so
// `fetchImpl` is `undefined` in every production run and `--refresh` falls
// back to `globalThis.fetch` exactly as before. See contextFor's comment.
async function main (argv, { fetchImpl } = {}) {
  const { values } = parseCliArgs(argv, {
    profile: { type: 'string' },
    check: { type: 'boolean' },
    ingest: { type: 'boolean' },
    add: { type: 'string' },
    label: { type: 'string' },
    forget: { type: 'string' },
    refresh: { type: 'boolean' },
    only: { type: 'string' }
  })
  if (values.help) {
    printHelp('scripts/sources.mjs', [
      'Register brand material and record what has been analysed.',
      '',
      '  --check              report new, known, stale, and missing sources',
      '  --ingest             analyse everything new or changed',
      '  --add <path|url>     register a source',
      '  --label <text>       a human label for --add',
      '  --forget <entry-id>  retract one analysed source (e.g. f001, as listed by --check)',
      '                       and name the rules it produced, so they can be re-derived',
      '  --refresh            fetch every registered url source and record what changed',
      '  --only <id|url>      scope --refresh to one registered url source',
      '  --root <dir>         project root (default: cwd)',
      '  --kb <dir>           knowledge base dir',
      '  --profile <name>     config profile (default: default); a speaker slug scopes --check',
      '                       and --ingest to that speaker, and attributes --add to it',
      '  --now <iso>          fixed timestamp for reproducible output',
      '  --json               machine-readable summary'
    ])
    return
  }

  // --only is documented (connect.md, --help above) as scoping --refresh
  // alone. runIngest also accepts an `only` option, wired for a caller that
  // holds a ctx directly (test/sources.test.mjs), but main() never threaded
  // it through for --ingest - so `--ingest --only f001` used to parse, exit
  // 0, and silently ingest EVERYTHING, exactly the trap `--refresh <id>`
  // (without --only) sprang before R42. Refusing the combination here keeps
  // the CLI's behaviour matching what it already documents, rather than
  // quietly accepting a flag that does nothing for the mode it was given in.
  if (values.only && !values.refresh) die('--only requires --refresh')

  const ctx = contextFor(values, { fetchImpl })

  if (values.add) {
    const { entry } = runAdd(ctx, {
      target: values.add,
      label: values.label ?? null,
      profile: isSpeaker(ctx.config, ctx.profileName) ? ctx.profileName : null
    })
    if (values.json) return writeOut(`${JSON.stringify({ added: entry.id, kind: entry.kind })}\n`)
    // --ingest never processes kind: 'url' (runRefresh does, and only
    // runRefresh); naming the wrong next step here would send a url straight
    // back to the same doc/CLI mismatch this fix round exists to close.
    return report([
      `sources: added ${entry.id} (${entry.kind})`,
      entry.kind === 'url' ? 'sources: run --refresh to fetch it' : 'sources: run --ingest to analyse it'
    ])
  }

  if (values.forget) {
    const { removed, reopened } = runForget(ctx, { id: values.forget })
    if (values.json) return writeOut(`${JSON.stringify({ removed: removed.id, reopened })}\n`)
    return report([
      `sources: forgot ${removed.id}`,
      reopened.length
        ? `sources: reopen these rules and re-derive from what remains: ${reopened.join(', ')}`
        : 'sources: it had produced no rules'
    ])
  }

  if (values.refresh) {
    const { refreshed, unchanged, escalate, reopened, errors } = await runRefresh(ctx, { only: values.only ?? null })
    if (values.json) {
      return writeOut(`${JSON.stringify({
        refreshed: refreshed.length,
        unchanged: unchanged.length,
        errors: errors.length,
        escalate: escalate.map((e) => e.origin),
        reopened: reopened.map((r) => ({ id: r.id, origin: r.origin, produced: r.produced }))
      })}\n`)
    }
    const lines = [
      `sources: refreshed ${refreshed.length} url source(s), ${unchanged.length} unchanged`
    ]
    for (const entry of refreshed.slice(0, 20)) lines.push(`sources:   changed ${entry.origin}`)
    for (const item of errors.slice(0, 20)) lines.push(`sources:   error  ${item.origin} (${item.reason})`)
    if (reopened.length) {
      lines.push(`sources: ${reopened.length} url source(s) were superseded; rules to re-derive:`)
      for (const item of reopened.slice(0, 20)) {
        lines.push(`sources:   reopen ${item.id} ${item.origin} -> ${item.produced.join(', ') || '(none)'}`)
      }
    }
    if (escalate.length) {
      lines.push(`sources: ${escalate.length} source(s) need the model tier:`)
      for (const entry of escalate.slice(0, 20)) {
        lines.push(`sources:   model  ${entry.origin} (${entry.quality.reasons[0]})`)
      }
    }
    return report(lines)
  }

  const result = values.ingest ? await runIngest(ctx, {}) : runCheck(ctx)

  // Ingesting before /voice-and-tone:init has set a real profile name is
  // what creates the locale fossil validate.mjs's W_LOCALE_NOT_ACTIVE check
  // exists to catch (F5): statsFor bakes locale-dependent decisions into the
  // stored stats block, so ingesting under the template's untouched default
  // and only later setting the real locale leaves a permanent English-shaped
  // (or whatever the placeholder's primary_locale was) block sitting under a
  // profile that never measured it. A warning, not a refusal: --ingest is
  // legitimate to run standalone (checking the pipeline before init), and
  // this codebase already prefers a warning over blocking an otherwise-valid
  // command (see W_STALE_EXTRACTOR's reasoning in validate.mjs).
  const profile = activeProfile(ctx.config, ctx.profileName)
  const unnamedProfile = Boolean(values.ingest) && profile.name === 'Unnamed'

  if (values.json) {
    return writeOut(`${JSON.stringify({
      known: result.known.length,
      fresh: result.fresh.length,
      stale: result.stale.length,
      missing: result.missing.length,
      skipped: result.skipped.length,
      errors: result.errors.length,
      ingested: result.ingested?.length ?? 0,
      escalate: result.escalate?.map((e) => e.origin) ?? [],
      reopened: result.reopened?.map((r) => ({ id: r.id, origin: r.origin, produced: r.produced })) ?? [],
      duplicate: result.duplicate?.map((d) => ({ origin: d.file.origin, sameAs: d.entry.origin, id: d.entry.id })) ?? [],
      folded: result.folded?.map((f) => f.origin) ?? [],
      relocale: result.relocale?.map((r) => ({ id: r.id, from: r.from, to: r.to })) ?? [],
      unnamedProfile
    })}\n`)
  }

  // One line, one moment in time. This used to read
  // "71 known, 0 matched, 72 new" after a successful ingest, because `known`
  // was the index size AFTER ingesting while `new`/`matched` came from the
  // diff taken BEFORE it - two different instants in the same sentence, so
  // the summary of a run that had just analysed 71 files said nothing had
  // been analysed. An ingest now reports what it DID, and says separately
  // where the index ended up; a check still reports the diff it found.
  const lines = [
    result.ingested
      ? `sources: ingested ${result.ingested.length}, folded ${result.folded?.length ?? 0}, ` +
        `unchanged ${result.known.length}, missing ${result.missing.length}; ` +
        `index now holds ${result.index.sources.length}`
      : `sources: ${result.index.sources.length} indexed, ${result.known.length} matched, ` +
        `${result.fresh.length} new, ${result.stale.length} stale, ${result.missing.length} missing`
  ]
  if (unnamedProfile) {
    lines.push(
      `sources: warning - profile "${values.profile ?? 'default'}" still has the template's ` +
      'placeholder name ("Unnamed"); finish /voice-and-tone:init before ingesting, or per-locale ' +
      'statistics may be fossilized under the wrong locale'
    )
  }
  for (const file of result.fresh.slice(0, 20)) lines.push(`sources:   new    ${file.origin} (${file.format})`)
  // A duplicate is never silent. Folding it is correct - one document, one
  // entry, counted once in the fingerprint - but a file that simply stops
  // being mentioned is exactly what made this fold look like data loss.
  for (const item of (result.duplicate ?? []).slice(0, 20)) {
    lines.push(`sources:   dup    ${item.file.origin} = ${item.entry.id} ${item.entry.origin}`)
  }
  for (const item of result.stale.slice(0, 20)) lines.push(`sources:   stale  ${item.entry.id} ${item.entry.origin}`)
  for (const item of result.skipped.slice(0, 20)) lines.push(`sources:   skip   ${item.origin} (${item.ext})`)
  for (const item of result.errors.slice(0, 20)) lines.push(`sources:   error  ${item.origin} (${item.reason})`)

  if (result.missing.length) {
    // Absent sources are reported plainly, never as a warning: sources are
    // deliberately not committed, so a fresh clone has none of them, and
    // warning here would just teach people to commit sources to silence it.
    // When EVERY known source is missing at once, that plain report alone
    // reads ambiguously - it is what an ordinary fresh clone looks like, and
    // it is also what a --kb/--root pointed at the wrong place looks like.
    // Naming the far more common explanation costs one line and does not
    // raise the tone into a warning; it just answers the question a reader
    // would otherwise have to ask themselves.
    if (result.allMissing) {
      lines.push(
        `sources: all ${result.missing.length} known source(s) are absent from this machine; ` +
        'statistics intact. Ordinary right after a fresh clone - if this persists after ' +
        'restoring sources/, check --root/--kb.'
      )
    } else {
      lines.push(`sources: ${result.missing.length} source(s) not present locally; statistics intact`)
    }
  }
  if (result.relocale?.length) {
    lines.push(
      `sources: ${result.relocale.length} source(s) re-attributed to a declared locale` +
      (result.ingested ? '' : ' (run --ingest to apply)') + ':'
    )
    for (const item of result.relocale.slice(0, 20)) {
      lines.push(`sources:   locale ${item.id} ${item.origin}: ${item.from} -> ${item.to}`)
    }
  }
  if (result.folded?.length) {
    lines.push(
      `sources: ${result.folded.length} file(s) identical to an already-analysed source; ` +
      'recorded as additional paths, counted once'
    )
  }
  if (result.reopened?.length) {
    lines.push(`sources: ${result.reopened.length} stale source(s) were superseded; rules to re-derive:`)
    for (const item of result.reopened.slice(0, 20)) {
      lines.push(`sources:   reopen ${item.id} ${item.origin} -> ${item.produced.join(', ') || '(none)'}`)
    }
  }
  if (result.escalate?.length) {
    lines.push(`sources: ${result.escalate.length} source(s) need the model tier:`)
    for (const entry of result.escalate.slice(0, 20)) {
      lines.push(`sources:   model  ${entry.origin} (${entry.quality.reasons[0]})`)
    }
  }
  if (!values.ingest && (result.fresh.length || result.stale.length)) {
    lines.push('sources: run with --ingest to analyse')
  }
  report(lines)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => die(error.message))
}

export { main }
