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

const TYPOGRAPHIC = [
  [/[‘’‚‛]/g, "'"],
  [/[“”„‟]/g, '"'],
  [/[–—]/g, '-'],
  [/…/g, '...'],
  [/·/g, '*'],
  [/\u00A0/g, ' ']
]

/**
 * Spec section 9: scripts write UTF-8 files but print only ASCII. Windows
 * console codepages mangle anything else, and a knowledge base can legitimately
 * contain diacritics that end up interpolated into a status line.
 */
export function toAscii (text) {
  let out = String(text)
  for (const [pattern, replacement] of TYPOGRAPHIC) out = out.replace(pattern, replacement)
  // eslint-disable-next-line no-control-regex
  return out.replace(/[^\x00-\x7F]/g, '?')
}

export function writeOut (text) {
  process.stdout.write(toAscii(text))
}

/** Spec section 9: stdout and stderr stay ASCII. */
export function die (message) {
  process.stderr.write(toAscii(`error: ${message}\n`))
  process.exit(1)
}

export function printHelp (name, lines) {
  writeOut([`usage: node ${name} [options]`, '', ...lines, ''].join('\n'))
}
