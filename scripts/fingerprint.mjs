import path from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { readTextFile, writeTextFile, toPosix } from './lib/fsx.mjs'
import { loadConfig } from './lib/config.mjs'
import { gatherCorpus } from './lib/corpus.mjs'
import { statsFor, mergeStats, fingerprintFromStats } from './lib/metrics.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp, writeOut } from './lib/cli.mjs'

export function buildFingerprint (projectRoot, config, { generated, source = 'measured', profileName = 'default' }) {
  const corpus = gatherCorpus(projectRoot, config, profileName)
  const perLocale = new Map()

  // Statistics are computed per FILE and merged, never over a joined blob.
  // Joining lets a text-level pattern match across the seam between two
  // unrelated documents, and it breaks the merge invariant in metrics.mjs.
  for (const file of corpus) {
    const bucket = perLocale.get(file.locale) ?? []
    bucket.push(statsFor({ strings: file.strings, headings: file.headings, locale: file.locale }))
    perLocale.set(file.locale, bucket)
  }

  const out = {}
  // Sorted so the artifact is stable across runs and diffs cleanly in git.
  for (const locale of [...perLocale.keys()].sort()) {
    out[locale] = fingerprintFromStats(mergeStats(perLocale.get(locale)), locale)
  }
  return { generated, source, byLocale: out, baseline: null }
}

function main (argv) {
  const { values } = parseCliArgs(argv, {
    profile: { type: 'string' },
    source: { type: 'string' },
    'set-baseline': { type: 'boolean' }
  })
  if (values.help) {
    printHelp('scripts/fingerprint.mjs', [
      'Writes per-locale corpus metrics to <kb>/evidence/fingerprint.json.',
      '',
      '  --root <dir>      project root (default: cwd)',
      '  --kb <dir>        knowledge base dir',
      '  --out <file>      output path override',
      '  --profile <name>  config profile (default: default)',
      '  --source <kind>   measured | estimated (default: measured)',
      '  --set-baseline    freeze these numbers as the drift baseline',
      '  --now <iso>       fixed timestamp',
      '  --json            print the summary as JSON'
    ])
    return
  }

  const source = values.source ?? 'measured'
  if (source !== 'measured' && source !== 'estimated') die('--source must be measured or estimated')

  const { projectRoot, kbRoot } = resolveRoots(values)
  const config = loadConfig(kbRoot)
  const generated = nowIso(values)
  const fingerprint = buildFingerprint(projectRoot, config, {
    generated, source, profileName: values.profile ?? 'default'
  })

  const out = values.out ? path.resolve(values.out) : path.join(kbRoot, 'evidence', 'fingerprint.json')

  // Preserve an existing baseline unless explicitly re-set.
  if (existsSync(out)) {
    try {
      fingerprint.baseline = JSON.parse(readTextFile(out)).baseline ?? null
    } catch { /* a corrupt previous fingerprint is replaced, not repaired */ }
  }
  if (values['set-baseline']) {
    fingerprint.baseline = { generated, byLocale: fingerprint.byLocale }
  }

  writeTextFile(out, `${JSON.stringify(fingerprint, null, 2)}\n`)

  if (values.json) {
    writeOut(`${JSON.stringify({ source, locales: Object.keys(fingerprint.byLocale) })}\n`)
    return
  }
  const lines = [`fingerprint: source=${source}`]
  for (const [locale, fp] of Object.entries(fingerprint.byLocale)) {
    lines.push(
      `fingerprint: ${locale} words=${fp.sample.words} sentences=${fp.sample.sentences} ` +
      `meanSentence=${fp.universal.meanSentenceLength} english=${fp.english ? 'yes' : 'n/a'}`
    )
  }
  if (Object.keys(fingerprint.byLocale).length === 0) lines.push('fingerprint: no copy found; check scan.include')
  if (fingerprint.baseline) lines.push(`fingerprint: baseline ${fingerprint.baseline.generated}`)
  lines.push(`fingerprint: wrote ${toPosix(path.relative(projectRoot, out))}`)
  writeOut(`${lines.join('\n')}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
