import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeTextFile } from './lib/fsx.mjs'
import { loadConfig } from './lib/config.mjs'
import { collect, readJson } from './lib/state.mjs'
import { render, PANELS, clampWidth } from './lib/render.mjs'
import { buildManifest } from './scan.mjs'
import { buildFingerprint } from './fingerprint.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp, writeOut } from './lib/cli.mjs'

/**
 * The CLI behind /voice-and-tone:status.
 *
 * Read-only by default. --refresh does exactly three things - rebuild the
 * manifest, rebuild the fingerprint preserving its baseline, and hash
 * registered sources to tell stale from current - and never a fourth. It does
 * not ingest (ingestion can escalate a source to the model tier and spend
 * tokens) and it does not fetch (the network belongs to :connect --refresh
 * alone).
 *
 * It never sets the baseline. voice-maintenance already states why: a
 * refreshed baseline shows zero drift by construction and tells you nothing.
 *
 * Exit codes: 0 always, except 1 for a bad flag or an unexpected throw. This
 * script observes; it does not gate. A non-zero exit on a knowledge base with
 * blocking gaps would make it unusable in any script that merely wants to
 * print the state.
 */

function refresh ({ projectRoot, kbRoot, config, profileName, now }) {
  const manifest = buildManifest(projectRoot, config, now, profileName, kbRoot)
  writeTextFile(path.join(kbRoot, 'evidence', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const out = path.join(kbRoot, 'evidence', 'fingerprint.json')
  const fingerprint = buildFingerprint(projectRoot, config, {
    generated: now, source: 'measured', profileName, kbRoot
  })
  // Preserve, never re-set. buildFingerprint always returns baseline: null, so
  // writing its result unchanged would silently destroy the point of
  // comparison every drift figure on the screen depends on.
  fingerprint.baseline = readJson(out)?.baseline ?? null
  // `unindexed` is buildFingerprint's own diagnostic, not a per-locale
  // statistic - fingerprint.mjs strips it before writing and so must this.
  const { unindexed, ...toWrite } = fingerprint
  void unindexed
  writeTextFile(out, `${JSON.stringify(toWrite, null, 2)}\n`)
}

function main (argv) {
  const { values } = parseCliArgs(argv, {
    profile: { type: 'string' },
    panel: { type: 'string' },
    width: { type: 'string' },
    refresh: { type: 'boolean' },
    locale: { type: 'string' }
  })
  if (values.help) {
    printHelp('scripts/status.mjs', [
      'Reports the state of the voice knowledge base. Writes nothing unless --refresh.',
      '',
      '  --root <dir>      project root (default: cwd)',
      '  --kb <dir>        knowledge base dir',
      `  --panel <name>    one of: ${PANELS.join(', ')}`,
      '  --refresh         rebuild the manifest and fingerprint first',
      '                    (never sets the baseline, never ingests, never fetches)',
      '  --locale <code>   scope drift and corpus to one locale',
      '  --width <n>       render width, clamped to 60..120 (default 72)',
      '  --profile <name>  config profile (default: default)',
      '  --now <iso>       fixed timestamp for reproducible output',
      '  --json            print the whole state object as JSON'
    ])
    return
  }

  const panel = values.panel ?? 'all'
  if (!PANELS.includes(panel)) die(`unknown panel "${panel}"; valid: ${PANELS.join(', ')}`)

  const { projectRoot, kbRoot } = resolveRoots(values)
  const config = loadConfig(kbRoot)
  const profileName = values.profile ?? 'default'
  const now = nowIso(values)

  if (values.refresh) refresh({ projectRoot, kbRoot, config, profileName, now })

  const state = collect({
    projectRoot, kbRoot, config, profileName, now, checkFreshness: Boolean(values.refresh)
  })

  if (values.locale) {
    const only = (map) => (map[values.locale] ? { [values.locale]: map[values.locale] } : {})
    state.drift.byLocale = only(state.drift.byLocale)
    state.corpus.byLocale = only(state.corpus.byLocale)
  }

  if (values.json) {
    writeOut(`${JSON.stringify(state, null, 2)}\n`)
    return
  }
  writeOut(render(state, { panel, width: clampWidth(Number.parseInt(values.width ?? '', 10)) }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
