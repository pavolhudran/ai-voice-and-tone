import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseYaml, stringifyYaml } from './yaml.mjs'
import { readTextFile, writeTextFile } from './fsx.mjs'

export const KB_DIRNAME = '.voice-and-tone'

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  kb_version: '0.1.0',
  profiles: {
    default: { name: 'Unnamed', primary_locale: 'en', locales: ['en'] }
  },
  scan: {
    include: [
      'content/**/*.md',
      'content/**/*.mdx',
      'docs/**/*.md',
      'locales/**/*.json',
      'locales/**/*.yml',
      'locales/**/*.po',
      'README.md'
    ],
    exclude: ['node_modules/**', 'dist/**', 'build/**', '.git/**', '.voice-and-tone/**']
  },
  runtime: { node: 'detected', probed: null },
  thresholds: { corroboration: 2, derived_min_samples: 5, stale_months: 9 }
})

export function kbRootFor (projectRoot, override) {
  return override ? path.resolve(override) : path.join(projectRoot, KB_DIRNAME)
}

function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone (value) {
  if (Array.isArray(value)) return value.map(clone)
  if (isPlainObject(value)) {
    const out = {}
    for (const [key, v] of Object.entries(value)) out[key] = clone(v)
    return out
  }
  return value
}

/**
 * Merge patch onto base without mutating or aliasing either side. Every
 * nested object and array is cloned, not merely spread, so an untouched
 * branch of DEFAULT_CONFIG returned by one loadConfig() call can never be
 * the same object a later call returns. Object.freeze on DEFAULT_CONFIG is
 * shallow, so aliasing a nested object (say, .thresholds) would let one
 * caller's in-place edit corrupt the defaults for every later call in the
 * same process. A user-supplied array (e.g. scan.exclude) replaces the
 * default array wholesale rather than concatenating with it - arrays are
 * never recursed into, only cloned.
 */
function deepMerge (base, patch) {
  if (!isPlainObject(patch)) return patch === undefined ? clone(base) : clone(patch)
  const out = {}
  for (const [key, value] of Object.entries(base)) out[key] = clone(value)
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key]
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : clone(value)
  }
  return out
}

export function loadConfig (kbRoot) {
  const file = path.join(kbRoot, 'config.yml')
  if (!existsSync(file)) return deepMerge(DEFAULT_CONFIG, {})
  return deepMerge(DEFAULT_CONFIG, parseYaml(readTextFile(file)))
}

export function saveConfig (kbRoot, config) {
  writeTextFile(path.join(kbRoot, 'config.yml'), stringifyYaml(config))
}

/**
 * Attribute a file to a locale by path segment or by basename.
 * Matches whole segments only, so "content/csv/x.md" is not Czech.
 */
export function localeOf (relPosixPath, locales, primaryLocale) {
  const segments = relPosixPath.split('/')
  const basename = segments[segments.length - 1]
  const stem = basename.replace(/\.[^.]+$/, '')
  for (const locale of locales) {
    if (segments.slice(0, -1).includes(locale)) return locale
    if (stem === locale) return locale
    if (stem.endsWith(`.${locale}`) || stem.endsWith(`-${locale}`) || stem.endsWith(`_${locale}`)) return locale
  }
  return primaryLocale
}

export function activeProfile (config, profileName = 'default') {
  return config.profiles?.[profileName] ?? DEFAULT_CONFIG.profiles.default
}
