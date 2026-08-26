import path from 'node:path'
import { walk, readTextFile, toPosix } from './fsx.mjs'
import { extractStrings, extractHeadings } from './extract.mjs'
import { activeProfile, localeOf } from './config.mjs'

/**
 * Read every copy-bearing file the config points at, in a stable order.
 * Files that yield no copy are dropped: an empty locale stub is not a data point.
 *
 * @param {string} projectRoot
 * @param {object} config
 * @param {string} [profileName]
 * @param {string[]} [unreadable] - out-parameter. A JSON file that yields zero
 *   strings is ambiguous between "really empty" and "malformed" -
 *   extractStrings has no error channel and swallows a JSON.parse failure
 *   into an empty array. Rather than let a broken locale file disappear
 *   indistinguishably from an empty valid one, its rel path is pushed here.
 *   It still contributes no strings to the returned corpus. An out-parameter
 *   is used instead of a property on the returned array because a property
 *   does not survive .map/.filter/.flatMap/spread/Array.from/destructuring -
 *   any of which a caller is free to apply to the array this function
 *   returns - so a plain property would work only for a caller holding the
 *   exact original reference. This one is visible in the signature and
 *   passes through untouched by construction.
 */
export function gatherCorpus (projectRoot, config, profileName = 'default', unreadable = []) {
  const profile = activeProfile(config, profileName)
  const primary = profile.primary_locale ?? 'en'
  const locales = profile.locales ?? [primary]
  const out = []

  for (const abs of walk(projectRoot, config.scan)) {
    let raw
    try { raw = readTextFile(abs) } catch { continue } // unreadable file is skipped, not fatal
    const rel = toPosix(path.relative(projectRoot, abs))
    const { format, strings } = extractStrings(abs, raw)
    if (!format) continue
    if (strings.length === 0) {
      if (format === 'json') unreadable.push(rel)
      continue
    }
    out.push({
      rel,
      abs,
      format,
      locale: localeOf(rel, locales, primary),
      strings,
      headings: extractHeadings(abs, raw)
    })
  }
  return out
}

/** Group a gathered corpus by locale. Spec 5.3: locales are never averaged together. */
export function byLocale (corpus) {
  const buckets = new Map()
  for (const file of corpus) {
    const bucket = buckets.get(file.locale) ?? { strings: [], headings: [], files: 0 }
    bucket.strings.push(...file.strings)
    bucket.headings.push(...file.headings)
    bucket.files += 1
    buckets.set(file.locale, bucket)
  }
  return buckets
}
