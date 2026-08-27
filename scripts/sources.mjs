import path from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { loadConfig, saveConfig } from './lib/config.mjs'
import { isBinaryFormat } from './lib/extract.mjs'
import { loadRegister, resolveRegister, nextRegisterId, expandHome } from './lib/register.mjs'
import {
  loadIndex, saveIndex, nextEntryId, upsertEntry, supersedeEntry, diffIndex, statsByLocale
} from './lib/sourceindex.mjs'
import { ingestFile, needsModelTier } from './lib/ingest.mjs'
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

function contextFor (values) {
  const { projectRoot, kbRoot } = resolveRoots(values)
  return {
    projectRoot,
    kbRoot,
    config: loadConfig(kbRoot),
    profileName: values.profile ?? 'default',
    now: nowIso(values)
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

export function runCheck (ctx) {
  const register = loadRegister(ctx.config)
  const resolved = resolveRegister(register, ctx)
  restrictProjectFilesToIngestible(resolved)
  const index = loadIndex(ctx.kbRoot)
  const errors = filterVanished(resolved)
  const diff = diffIndex(index, resolved, hasher())

  const total = index.sources.length
  return {
    ...diff,
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
    return await ingestFile(file, {
      kbRoot: ctx.kbRoot,
      now: ctx.now,
      id: nextEntryId(index),
      from: file.from
    })
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
    upsertEntry(index, entry)
    ingested.push(entry)
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

  // Anything the register no longer reaches keeps its statistics and is simply
  // marked. This is what makes a fresh clone reproduce the baseline exactly.
  for (const orphan of report.missing) {
    if (orphan.status !== 'skipped') orphan.status = 'missing'
  }

  saveIndex(ctx.kbRoot, index, ctx.now)
  return { ...report, ingested, escalate, reopened, errors }
}

export function runAdd (ctx, { target, label = null }) {
  const register = loadRegister(ctx.config)
  const id = nextRegisterId(register)

  const entry = isUrl(target)
    ? { id, kind: 'url', url: String(target), label, retain: 'none' }
    : { id, kind: 'local', path: path.resolve(expandHome(target)), label }

  const config = { ...ctx.config, sources: [...register, entry] }
  saveConfig(ctx.kbRoot, config)
  return { register: config.sources, entry }
}

export function runForget (ctx, { id }) {
  const index = loadIndex(ctx.kbRoot)
  const at = (index.sources ?? []).findIndex((s) => s.id === id)
  if (at < 0) throw new Error(`no source with id ${id}`)

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

async function main (argv) {
  const { values } = parseCliArgs(argv, {
    profile: { type: 'string' },
    check: { type: 'boolean' },
    ingest: { type: 'boolean' },
    add: { type: 'string' },
    label: { type: 'string' },
    forget: { type: 'string' }
  })
  if (values.help) {
    printHelp('scripts/sources.mjs', [
      'Register brand material and record what has been analysed.',
      '',
      '  --check              report new, known, stale, and missing sources',
      '  --ingest             analyse everything new or changed',
      '  --add <path|url>     register a source',
      '  --label <text>       a human label for --add',
      '  --forget <id>        retract a source and name the rules to reopen',
      '  --root <dir>         project root (default: cwd)',
      '  --kb <dir>           knowledge base dir',
      '  --profile <name>     config profile (default: default)',
      '  --now <iso>          fixed timestamp for reproducible output',
      '  --json               machine-readable summary'
    ])
    return
  }

  const ctx = contextFor(values)

  if (values.add) {
    const { entry } = runAdd(ctx, { target: values.add, label: values.label ?? null })
    if (values.json) return writeOut(`${JSON.stringify({ added: entry.id, kind: entry.kind })}\n`)
    return report([`sources: added ${entry.id} (${entry.kind})`, 'sources: run --ingest to analyse it'])
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

  const result = values.ingest ? await runIngest(ctx, {}) : runCheck(ctx)

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
      reopened: result.reopened?.map((r) => ({ id: r.id, origin: r.origin, produced: r.produced })) ?? []
    })}\n`)
  }

  const lines = [
    `sources: ${result.index.sources.length} known, ${result.known.length} matched, ` +
    `${result.fresh.length} new, ${result.stale.length} stale, ${result.missing.length} missing`
  ]
  for (const file of result.fresh.slice(0, 20)) lines.push(`sources:   new    ${file.origin} (${file.format})`)
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
