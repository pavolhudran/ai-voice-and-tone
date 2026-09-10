import path from 'node:path'
import os from 'node:os'
import { existsSync, statSync } from 'node:fs'
import { walk, toPosix, isInside } from './fsx.mjs'
import { formatFor } from './extract.mjs'
import { activeProfile, localeOf, isSpeaker } from './config.mjs'

/**
 * Where to look for brand material.
 *
 * The register exists because walk() is rooted at projectRoot and config globs
 * are relative to it, so a glob can never escape the repository. A `local`
 * entry can, which is the whole point: a user's brand deck lives in
 * ~/Brand, not in the client's git tree.
 *
 * Backwards compatibility is not optional. A config with no `sources` key
 * synthesises exactly one `project` entry from its existing scan globs, so an
 * existing knowledge base behaves bit-identically.
 */

const ALL_FILES = ['**/*']

export function expandHome (p) {
  const raw = String(p)
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2))
  return raw
}

export function loadRegister (config) {
  const declared = Array.isArray(config?.sources) ? config.sources : null
  if (declared && declared.length > 0) {
    return declared.map((entry, i) => ({ id: entry.id ?? `s${String(i + 1).padStart(2, '0')}`, ...entry }))
  }
  // Migration path: today's behaviour, expressed as one entry.
  return [{
    id: 's01',
    kind: 'project',
    label: 'Project files',
    include: config?.scan?.include ?? [],
    exclude: config?.scan?.exclude ?? []
  }]
}

export function nextRegisterId (register) {
  let highest = 0
  for (const entry of register ?? []) {
    const n = Number(/^s(\d+)$/.exec(String(entry?.id ?? ''))?.[1] ?? 0)
    if (n > highest) highest = n
  }
  return `s${String(highest + 1).padStart(2, '0')}`
}

/**
 * Spec 2026-09-10 §3: `sources[].profile` is optional, absent means house.
 * The house corpus is every unattributed entry; a speaker's corpus is
 * exactly the entries attributed to it. An undeclared profile name is the
 * house, the same fallback activeProfile takes.
 */
export function entriesForProfile (register, profileName, config) {
  const speaking = isSpeaker(config, profileName)
  return (register ?? []).filter((entry) => {
    const owner = entry.profile ?? null
    return speaking ? owner === profileName : owner === null
  })
}

function rootAndGlobs (entry, { projectRoot, kbRoot }) {
  if (entry.kind === 'project') {
    return {
      root: projectRoot,
      include: entry.include ?? [],
      exclude: entry.exclude ?? [],
      relativeTo: projectRoot,
      prefix: ''
    }
  }
  if (entry.kind === 'inbox') {
    const declared = entry.path ?? 'sources'
    const root = path.resolve(kbRoot, declared)
    // An `inbox` names a directory INSIDE the knowledge base - that is the
    // whole difference between it and `local`, which is documented to point
    // anywhere on disk. `path.resolve` does not enforce that: a declared path
    // of "../../../.ssh" resolves cleanly to somewhere else entirely, and the
    // walk below then lists it with ALL_FILES and hands every extractable
    // file to the ingest ladder.
    //
    // config.yml is a COMMITTED file. It arrives with a clone, from whoever
    // wrote that repository - so an inbox path is not something only the
    // local user can have set, and it must be checked rather than trusted.
    // A `local` entry pointing outside is the feature; an `inbox` entry
    // pointing outside is either a mistake or an attempt, and neither is
    // worth resolving quietly.
    if (!isInside(kbRoot, root)) {
      throw new Error(
        `register: inbox source ${entry.id ?? '(unnamed)'} declares path "${declared}", which resolves ` +
        'outside the knowledge base. An inbox must name a directory inside it; use kind: local for ' +
        'material that lives elsewhere on disk.'
      )
    }
    return {
      root,
      include: ALL_FILES,
      exclude: entry.exclude ?? [],
      relativeTo: root,
      prefix: `${toPosix(entry.path ?? 'sources').replace(/\/$/, '')}/`
    }
  }
  const target = path.resolve(expandHome(entry.path ?? ''))
  return { root: target, include: ALL_FILES, exclude: entry.exclude ?? [], relativeTo: target, prefix: null }
}

export function resolveEntry (entry, ctx) {
  const { config, profileName = 'default' } = ctx
  // An entry attributed to a speaker is read with THAT speaker's locales,
  // whatever context the caller is in: a house-wide --ingest must not file
  // a German-speaking speaker's posts as English.
  const owner = entry.profile ?? null
  const profile = activeProfile(config, owner ?? profileName)
  const primary = profile.primary_locale ?? 'en'
  const locales = profile.locales ?? [primary]

  // `missing` and `empty` are deliberately two different signals, not one:
  //   - missing: the configured path does not exist. This is the ORDINARY
  //     state of a fresh clone, because sources are never committed. A
  //     caller must not warn about it, or every fresh clone would nag.
  //   - empty: the path exists but resolving it found nothing at all - no
  //     files, no skipped entries either. That is not the fresh-clone case;
  //     it usually means the entry points at the wrong directory, or an
  //     include glob that matches nothing there. A caller may reasonably
  //     flag this one.
  // Conflating them into a single boolean would erase exactly the
  // distinction a status report needs: "nothing to see yet" vs "this entry
  // looks wrong". Keeping them separate costs one extra field.
  const base = { id: entry.id, kind: entry.kind, files: [], url: entry.url ?? null, missing: false, empty: false, skipped: [] }
  if (entry.kind === 'url') return base

  const { root, include, exclude, relativeTo, prefix } = rootAndGlobs(entry, ctx)

  if (!existsSync(root)) {
    // Absent is ORDINARY, not an error: sources are never committed, so a
    // fresh clone has none of them. Callers report this, they do not warn.
    return { ...base, missing: true }
  }

  // A local entry may name one file rather than a directory.
  let absolutePaths
  if (statSync(root).isFile()) {
    absolutePaths = [root]
  } else {
    absolutePaths = walk(root, { include, exclude })
  }

  for (const abs of absolutePaths) {
    // formatFor resolves container formats (.pdf, .docx, ...) to a real
    // format string too, so a source pointing at an Office deck or a PDF is
    // a resolvable file here, not a skip - unlike gatherCorpus's text-only
    // path (corpus.mjs), which cannot read container bytes as text and
    // routes them to its own `skipped` with reason 'container'. A file can
    // only ever land in THIS `skipped` for the other half of that same
    // vocabulary - an extension nothing handles at all, e.g. .fig or
    // .sketch - so `reason` below is always the constant 'no-extractor',
    // never computed. It is still carried on every entry, not omitted,
    // so this shape stays a strict subset of gatherCorpus's and the two
    // producers can be merged into one list without losing the
    // no-extractor/container distinction Tasks 1 and 7 established.
    const format = formatFor(abs)
    const relToRoot = toPosix(path.relative(relativeTo, abs))
    // A project entry keeps project-relative paths, so nothing about today's
    // manifest changes. Other kinds record where the file actually came from.
    const origin = entry.kind === 'project'
      ? relToRoot
      : prefix === null
        ? abs
        : `${prefix}${relToRoot}`

    if (!format) {
      base.skipped.push({ origin, ext: path.extname(abs).toLowerCase(), reason: 'no-extractor' })
      continue
    }
    base.files.push({
      abs,
      rel: relToRoot,
      origin,
      format,
      locale: localeOf(relToRoot, locales, primary),
      // The register entry's own label (e.g. --add's --label), so ingest.mjs
      // has one to read. Before this, every file source's `label` was
      // undefined regardless of what the entry declared - only a `url`
      // source (which never goes through this loop) kept its label.
      label: entry.label ?? null,
      // Which speaker this file belongs to, or null for the house. Stamped
      // onto the index entry at ingest so the attribution survives the
      // register entry being edited or removed.
      profile: owner
    })
  }

  base.files.sort((a, b) => (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0))
  base.skipped.sort((a, b) => (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0))
  base.empty = base.files.length === 0 && base.skipped.length === 0
  return base
}

export function resolveRegister (register, ctx) {
  return (register ?? []).map((entry) => resolveEntry(entry, ctx))
}
