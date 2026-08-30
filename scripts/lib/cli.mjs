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
 * Latin letters that carry no combining mark to strip, so NFD leaves them
 * intact. Every mapping here is deliberately ONE character wide.
 *
 * The linguistically better expansions - 'ss' for ss-sharp, 'ae', 'th' - are
 * wrong for this function: renderers pad to a column width BEFORE output
 * reaches toAscii, so any substitution that changes length shifts the box
 * border on that row and nothing below it lines up again. Width fidelity is
 * the whole reason this ASCII rule exists; legibility is bought inside it,
 * never at its expense.
 */
const NON_DECOMPOSING = [
  [/ß/g, 's'], [/æ/g, 'a'], [/Æ/g, 'A'], [/œ/g, 'o'], [/Œ/g, 'O'],
  [/ł/g, 'l'], [/Ł/g, 'L'], [/ø/g, 'o'], [/Ø/g, 'O'],
  [/[đð]/g, 'd'], [/[ĐÐ]/g, 'D'], [/þ/g, 't'], [/Þ/g, 'T'], [/ı/g, 'i']
]

/**
 * Spec section 9: scripts write UTF-8 files but print only ASCII. Windows
 * console codepages mangle anything else, and a knowledge base can legitimately
 * contain diacritics that end up interpolated into a status line.
 *
 * Diacritics are transliterated, not blanked. A plugin whose subject is brand
 * voice in any language cannot print a Czech brand's own characteristics as
 * 'Klidn? * Vyk?n? s bl?zkost?' - the reader loses the word, not just the
 * accent. Decomposing to NFD and dropping the combining marks recovers the
 * base letters at identical width, so the box frame is unaffected and every
 * Latin-script locale stays readable. Anything with no ASCII base at all -
 * CJK, emoji - still falls through to '?', which is honest: there is no
 * width-preserving Latin answer for those.
 */
export function toAscii (text) {
  let out = String(text)
  for (const [pattern, replacement] of TYPOGRAPHIC) out = out.replace(pattern, replacement)
  for (const [pattern, replacement] of NON_DECOMPOSING) out = out.replace(pattern, replacement)
  out = out.normalize('NFD').replace(/\p{M}+/gu, '')
  // eslint-disable-next-line no-control-regex
  return out.replace(/[^\x00-\x7F]/g, '?')
}

/**
 * A reader that goes away before we finish writing - `| head`, `| less` quit
 * with q, a pager killed - closes the pipe under us. Node reports that as an
 * asynchronous 'error' event on the stream, not as a throw from write(), so a
 * try/catch around the write does not catch it: with no listener attached it
 * became an unhandled exception, and a user who piped a status screen into
 * `head` got a Node stack trace where they expected truncated output.
 *
 * Installed lazily on first write rather than at import, so merely importing
 * this module still mutates nothing - render.mjs depends on that.
 */
let pipeGuarded = false
function guardBrokenPipe () {
  if (pipeGuarded) return
  pipeGuarded = true
  for (const stream of [process.stdout, process.stderr]) {
    // Exit quietly and successfully: the reader got what it asked for and
    // stopped. Any other stream error is left alone, exactly as before.
    stream.on('error', (err) => { if (err?.code === 'EPIPE') process.exit(0) })
  }
}

export function writeOut (text) {
  guardBrokenPipe()
  try {
    process.stdout.write(toAscii(text))
  } catch (err) {
    // The synchronous form of the same event, on some platforms and stream types.
    if (err?.code !== 'EPIPE') throw err
  }
}

/** Spec section 9: stdout and stderr stay ASCII. */
export function die (message) {
  guardBrokenPipe()
  process.stderr.write(toAscii(`error: ${message}\n`))
  process.exit(1)
}

export function printHelp (name, lines) {
  writeOut([`usage: node ${name} [options]`, '', ...lines, ''].join('\n'))
}
