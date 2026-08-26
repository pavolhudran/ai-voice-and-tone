import { parseArgs } from 'node:util'
import path from 'node:path'
import { kbRootFor } from './config.mjs'

const BASE_OPTIONS = {
  root: { type: 'string' },        // project root; defaults to cwd
  kb: { type: 'string' },          // knowledge base dir; defaults to <root>/.voice-and-tone
  out: { type: 'string' },         // override the output file
  now: { type: 'string' },         // fixed ISO timestamp, for reproducible output
  json: { type: 'boolean' },       // machine-readable summary on stdout
  help: { type: 'boolean', short: 'h' }
}

export function parseCliArgs (argv, extraOptions = {}) {
  return parseArgs({
    args: argv,
    options: { ...BASE_OPTIONS, ...extraOptions },
    allowPositionals: true,
    strict: true
  })
}

export function resolveRoots (values) {
  const projectRoot = path.resolve(values.root ?? process.cwd())
  return { projectRoot, kbRoot: kbRootFor(projectRoot, values.kb) }
}

export function nowIso (values) {
  return values.now ?? new Date().toISOString()
}

/** Spec section 9: stdout and stderr stay ASCII. */
export function die (message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(1)
}

export function printHelp (name, lines) {
  process.stdout.write([`usage: node ${name} [options]`, '', ...lines, ''].join('\n'))
}
