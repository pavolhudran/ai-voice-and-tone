import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeTextFile, toPosix, displayPath} from './lib/fsx.mjs'
import { splitSentences, splitWords } from './lib/text.mjs'
import { loadConfig, kbRootFor, artifactRoot } from './lib/config.mjs'
import { gatherAll } from './lib/corpus.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp, writeOut } from './lib/cli.mjs'

export function buildManifest (projectRoot, config, generated, profileName = 'default', kbRoot = null) {
  const root = kbRoot ?? kbRootFor(projectRoot)
  const unreadablePaths = []
  const { files: gathered, skipped, unindexed, missing } = gatherAll({
    projectRoot, kbRoot: root, config, profileName, unreadable: unreadablePaths
  })

  const files = []
  // Null-prototype, deliberately. `locale` reaches this loop from config.yml
  // and from evidence/sources.json - both committed files - and on a plain
  // object literal the key "__proto__" hits Object.prototype's own setter
  // instead of creating an entry: `byLocale[locale] ?? (byLocale[locale] = ...)`
  // then hands back Object.prototype itself, and the counters below write
  // `files`/`strings`/`words` onto every object in the process. With no
  // prototype there is no accessor to hit, so "__proto__" is just a key.
  //
  // It is spread back onto an ordinary object on the way out (below): a
  // null-prototype object handed to a caller is its own hazard
  // (`hasOwnProperty` on it throws), and spread copies with
  // CreateDataProperty, which does NOT invoke the setter this avoids - so
  // the key survives as an ordinary own property and the shape is unchanged.
  const byLocale = Object.create(null)
  const totals = { files: 0, strings: 0, words: 0, sentences: 0 }

  for (const file of gathered) {
    // A live project file is counted here. An indexed source arrives with its
    // counts already recorded, and its text deliberately absent - so read the
    // numbers from the stats block rather than recomputing from nothing.
    const stats = file.stats
    const joined = file.strings.join('\n')
    const entry = {
      path: file.rel,
      format: file.format,
      locale: file.locale,
      source: file.sourceId ?? null,
      tier: file.tier,
      fidelity: file.fidelity,
      // null for a live project file; the recorded index status
      // ('used'/'missing'/'stale') for an indexed source. This is the one
      // field that lets a consumer of manifest.files tell a live
      // measurement apart from a recorded one, rather than guessing from
      // tier/fidelity alone (a script-tier, measured-fidelity indexed
      // source would otherwise look identical to a live file).
      status: file.status ?? null,
      strings: stats ? stats.strings : file.strings.length,
      words: stats ? stats.words : splitWords(joined).length,
      sentences: stats
        ? stats.sentences
        : file.strings.reduce((sum, s) => sum + splitSentences(s).length, 0)
    }
    if (entry.strings === 0) continue
    files.push(entry)

    totals.files += 1
    totals.strings += entry.strings
    totals.words += entry.words
    totals.sentences += entry.sentences

    const bucket = byLocale[entry.locale] ?? (byLocale[entry.locale] = { files: 0, strings: 0, words: 0 })
    bucket.files += 1
    bucket.strings += entry.strings
    bucket.words += entry.words
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return {
    generated,
    projectRoot: toPosix(projectRoot),
    profile: profileName,
    totals,
    byLocale: { ...byLocale },
    files,
    unreadable: { count: unreadablePaths.length, paths: unreadablePaths },
    skipped: {
      count: skipped.length,
      files: [...skipped]
        .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
        .map((f) => ({ path: f.rel, ext: f.ext, reason: f.reason }))
    },
    // Registered material (an inbox or a local entry) that is on disk right
    // now but has never been ingested - distinct from `skipped` (nothing can
    // ever read it) and from `missing` (it WAS indexed and is now absent).
    // This is what makes "0 files" over a non-empty sources/ actionable
    // instead of misleading: the remedy is /voice-and-tone:connect --ingest,
    // not editing scan.include, which this path never reads at all.
    unindexed: {
      count: unindexed.length,
      files: [...unindexed]
        .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
        .map((f) => ({ path: f.rel, ext: f.ext }))
    },
    missing
  }
}

function main (argv) {
  const { values } = parseCliArgs(argv, { profile: { type: 'string' } })
  if (values.help) {
    printHelp('scripts/scan.mjs', [
      'Writes a manifest of copy-bearing files to <kb>/evidence/manifest.json.',
      '',
      '  --root <dir>      project root (default: cwd)',
      '  --kb <dir>        knowledge base dir (default: <root>/.voice-and-tone)',
      '  --out <file>      output path override',
      '  --profile <name>  config profile (default: default)',
      '  --now <iso>       fixed timestamp for reproducible output',
      '  --json            print the manifest summary as JSON'
    ])
    return
  }

  const { projectRoot, kbRoot } = resolveRoots(values)
  const config = loadConfig(kbRoot)
  const manifest = buildManifest(projectRoot, config, nowIso(values), values.profile ?? 'default', kbRoot)

  // A declared speaker's manifest lives under its overlay (spec 2026-09-10
  // §4.5); the house and any undeclared name keep writing where they always did.
  const out = values.out
    ? path.resolve(values.out)
    : path.join(artifactRoot(kbRoot, values.profile ?? 'default', config), 'evidence', 'manifest.json')
  writeTextFile(out, `${JSON.stringify(manifest, null, 2)}\n`)

  if (values.json) {
    // Paths in manifest.unreadable.paths are real on-disk paths and may carry
    // non-ASCII bytes; only the manifest file (UTF-8) is the right home for
    // them. stdout stays ASCII-safe with a count alone.
    writeOut(`${JSON.stringify({
      totals: manifest.totals,
      byLocale: manifest.byLocale,
      unreadable: { count: manifest.unreadable.count },
      skipped: { count: manifest.skipped.count },
      unindexed: { count: manifest.unindexed.count }
    })}\n`)
    return
  }
  const noExtractor = manifest.skipped.files.filter((f) => f.reason === 'no-extractor')
  const containers = manifest.skipped.files.filter((f) => f.reason === 'container')
  // A file with no extension has no `ext`, so the list rendered as
  // "(no extractor: )" - an empty parenthesis that named nothing and left the
  // reader with no idea which files had been skipped.
  const extsOf = (files) =>
    [...new Set(files.map((f) => f.ext || '(no extension)'))].sort().join(', ')

  writeOut(
    `scan: ${manifest.totals.files} files, ${manifest.totals.strings} strings, ` +
    `${manifest.totals.words} words, ${manifest.totals.sentences} sentences\n` +
    `scan: locales ${Object.keys(manifest.byLocale).join(', ') || 'none'}\n` +
    `scan: ${manifest.unreadable.count} unreadable json file(s)\n` +
    (noExtractor.length
      ? `scan: ${noExtractor.length} file(s) skipped (no extractor: ${extsOf(noExtractor)})\n`
      : '') +
    (containers.length
      ? `scan: ${containers.length} file(s) need ingest, not scan (run /voice-and-tone:connect: ${extsOf(containers)})\n`
      : '') +
    (manifest.unindexed.count
      ? `scan: ${manifest.unindexed.count} registered file(s) not yet ingested ` +
        `(run /voice-and-tone:connect --ingest: ${extsOf(manifest.unindexed.files)})\n`
      : '') +
    (manifest.missing
      ? `scan: ${manifest.missing} source(s) not present locally; statistics intact\n`
      : '') +
    `scan: wrote ${displayPath(projectRoot, out)}\n`
  )
}

// Run main only when invoked as a script, so tests can import buildManifest freely.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
