import path from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { readTextFile, writeTextFile, toPosix, displayPath} from './lib/fsx.mjs'
import { loadConfig, kbRootFor } from './lib/config.mjs'
import { gatherAll } from './lib/corpus.mjs'
import { statsFor, mergeStats, fingerprintFromStats } from './lib/metrics.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp, writeOut } from './lib/cli.mjs'

export function buildFingerprint (projectRoot, config, { generated, source = 'measured', profileName = 'default', kbRoot = null }) {
  const root = kbRoot ?? kbRootFor(projectRoot)
  const { files, estimatedLocales, unindexed } = gatherAll({ projectRoot, kbRoot: root, config, profileName })

  const perLocale = new Map()
  for (const file of files) {
    // A live project file is measured here; an indexed source already carries
    // its counts, recorded when it was analysed. Both are Stats blocks, so
    // they merge without either caring which it was.
    //
    // Statistics are computed per FILE and merged, never over a joined blob.
    // Joining lets a text-level pattern match across the seam between two
    // unrelated documents, and it breaks the merge invariant in metrics.mjs.
    const stats = file.stats ?? statsFor({ strings: file.strings, headings: file.headings, locale: file.locale })
    const bucket = perLocale.get(file.locale) ?? []
    bucket.push(stats)
    perLocale.set(file.locale, bucket)
  }

  // Null-prototype for the same reason scan.mjs's byLocale is: a locale named
  // "__proto__" would otherwise be assigned through Object.prototype's setter
  // and vanish from the persisted fingerprint instead of being recorded.
  const out = Object.create(null)
  // Sorted so the artifact is stable across runs and diffs cleanly in git.
  for (const locale of [...perLocale.keys()].sort()) {
    out[locale] = {
      ...fingerprintFromStats(mergeStats(perLocale.get(locale)), locale),
      // Parent spec 5.4: one estimated contributor caps the whole locale.
      fidelity: estimatedLocales.has(locale) ? 'estimated' : 'measured'
    }
  }
  // `unindexed` is not part of the persisted fingerprint - it is not a
  // per-locale statistic, it is a diagnostic for main()'s human-readable
  // summary below (and its --json counterpart), naming registered material
  // that has never been ingested rather than letting an empty byLocale point
  // a reader at scan.include, a key this function never reads.
  // Spread back to an ordinary object on the way out - see scan.mjs's byLocale.
  return { generated, source, byLocale: { ...out }, baseline: null, unindexed: unindexed.length }
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
    generated, source, profileName: values.profile ?? 'default', kbRoot
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

  // `unindexed` is a diagnostic for this function's own messages, never a
  // per-locale statistic - it must not become part of the persisted artifact.
  const { unindexed, ...toWrite } = fingerprint
  writeTextFile(out, `${JSON.stringify(toWrite, null, 2)}\n`)

  if (values.json) {
    writeOut(`${JSON.stringify({ source, locales: Object.keys(fingerprint.byLocale), unindexed })}\n`)
    return
  }
  const lines = [`fingerprint: source=${source}`]
  for (const [locale, fp] of Object.entries(fingerprint.byLocale)) {
    lines.push(
      `fingerprint: ${locale} words=${fp.sample.words} sentences=${fp.sample.sentences} ` +
      `meanSentence=${fp.universal.meanSentenceLength} english=${fp.english ? 'yes' : 'n/a'}`
    )
  }
  if (Object.keys(fingerprint.byLocale).length === 0) {
    // Before this fix, this line always named scan.include - a key gatherAll
    // never reads. When the register resolves files the index has not seen
    // yet, the empty corpus is not a misconfigured glob, it is unanalysed
    // material sitting in sources/ (or a local/inbox entry) - name the real
    // remedy instead of the wrong one.
    lines.push(
      unindexed > 0
        ? `fingerprint: no copy found; ${unindexed} registered file(s) are not yet ingested - ` +
          'run /voice-and-tone:connect --ingest'
        : 'fingerprint: no copy found; check scan.include'
    )
  }
  if (fingerprint.baseline) lines.push(`fingerprint: baseline ${fingerprint.baseline.generated}`)
  lines.push(`fingerprint: wrote ${displayPath(projectRoot, out)}`)
  writeOut(`${lines.join('\n')}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
