import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeTextFile, toPosix } from './lib/fsx.mjs'
import { splitSentences, splitWords } from './lib/text.mjs'
import { loadConfig } from './lib/config.mjs'
import { gatherCorpus } from './lib/corpus.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp, writeOut } from './lib/cli.mjs'

export function buildManifest (projectRoot, config, generated, profileName = 'default') {
  const files = []
  const byLocale = {}
  const totals = { files: 0, strings: 0, words: 0, sentences: 0 }

  const unreadablePaths = []
  const skippedFiles = []
  const corpus = gatherCorpus(projectRoot, config, profileName, unreadablePaths, skippedFiles)

  for (const file of corpus) {
    const joined = file.strings.join('\n')
    const entry = {
      path: file.rel,
      format: file.format,
      locale: file.locale,
      strings: file.strings.length,
      words: splitWords(joined).length,
      sentences: file.strings.reduce((sum, s) => sum + splitSentences(s).length, 0)
    }
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

  return {
    generated,
    projectRoot: toPosix(projectRoot),
    profile: profileName,
    totals,
    byLocale,
    files,
    unreadable: { count: unreadablePaths.length, paths: unreadablePaths },
    skipped: {
      count: skippedFiles.length,
      files: [...skippedFiles]
        .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
        .map((f) => ({ path: f.rel, ext: f.ext, reason: f.reason }))
    }
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
  const manifest = buildManifest(projectRoot, config, nowIso(values), values.profile ?? 'default')

  const out = values.out ? path.resolve(values.out) : path.join(kbRoot, 'evidence', 'manifest.json')
  writeTextFile(out, `${JSON.stringify(manifest, null, 2)}\n`)

  if (values.json) {
    // Paths in manifest.unreadable.paths are real on-disk paths and may carry
    // non-ASCII bytes; only the manifest file (UTF-8) is the right home for
    // them. stdout stays ASCII-safe with a count alone.
    writeOut(`${JSON.stringify({
      totals: manifest.totals,
      byLocale: manifest.byLocale,
      unreadable: { count: manifest.unreadable.count },
      skipped: { count: manifest.skipped.count }
    })}\n`)
    return
  }
  const noExtractor = manifest.skipped.files.filter((f) => f.reason === 'no-extractor')
  const containers = manifest.skipped.files.filter((f) => f.reason === 'container')
  const extsOf = (files) => [...new Set(files.map((f) => f.ext))].sort().join(', ')

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
    `scan: wrote ${toPosix(path.relative(projectRoot, out))}\n`
  )
}

// Run main only when invoked as a script, so tests can import buildManifest freely.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
