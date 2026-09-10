import path from 'node:path'
import { existsSync, cpSync, rmSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig, speakerProfiles, isSpeaker, overlayRoot } from './lib/config.mjs'
import { loadRegister, nextRegisterId } from './lib/register.mjs'
import { loadIndex, saveIndex } from './lib/sourceindex.mjs'
import { loadKb } from './lib/kb.mjs'
import { collect } from './lib/state.mjs'
import { readTextFile, writeTextFile, toPosix, displayPath } from './lib/fsx.mjs'
import { registerSource, endOfYamlBlock } from './sources.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp, writeOut } from './lib/cli.mjs'

/**
 * The CLI behind /voice-and-tone:speaker (spec 2026-09-10 §6.1).
 *
 * The scaffold is deterministic, so it is a script and not a skill step: copy
 * the overlay template, declare the profile in config.yml by editing its
 * TEXT (comments survive, exactly as registerSource does for sources:), and
 * register the speaker's inbox. Discovery - drafting the overlay from the
 * speaker's material, the interview, canonize - stays with the
 * voice-discovery skill, which calls this first.
 *
 * --remove is the retraction path. It names every ledger entry and index
 * entry attributed to the speaker and the rules they produced, so the
 * skill can reopen exactly those; --dry-run prints the plan and writes
 * nothing, which is how the skill shows the diff before asking.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.resolve(HERE, '..', 'templates', 'kb', 'profiles', '_template')

// Lowercase, digits, hyphens; a directory name and a YAML key at once.
const SLUG = /^[a-z][a-z0-9-]{0,39}$/

export function validateSlug (slug) {
  if (!SLUG.test(String(slug ?? ''))) {
    throw new Error(`"${slug}" is not a valid speaker slug: lowercase letters, digits and hyphens, starting with a letter`)
  }
  if (slug === 'default') throw new Error('"default" is the house, not a speaker')
}

/** Insert one profile at the end of config.yml's `profiles:` block, by text. */
export function declareProfile (kbRoot, { slug, name, primaryLocale = null, locales = null }) {
  const file = path.join(kbRoot, 'config.yml')
  const raw = existsSync(file) ? readTextFile(file) : ''
  const lines = raw.split('\n')
  const item = [`  ${slug}:`, `    name: "${String(name).replace(/"/g, '\\"')}"`]
  if (primaryLocale) item.push(`    primary_locale: ${primaryLocale}`)
  if (locales?.length) item.push(`    locales: [${locales.join(', ')}]`)

  const keyIdx = lines.findIndex((l) => /^profiles:/.test(l))
  let merged
  if (keyIdx === -1) {
    const block = ['profiles:', '  default:', '    name: "Unnamed"', '    primary_locale: en', '    locales: [en]', ...item]
    merged = raw === '' ? block : [...lines, ...block]
  } else {
    const end = endOfYamlBlock(lines, keyIdx)
    merged = [...lines.slice(0, end), ...item, ...lines.slice(end)]
  }
  const out = merged.join('\n')
  writeTextFile(file, out.endsWith('\n') ? out : `${out}\n`)
}

/** Drop one profile's lines from the `profiles:` block, by text. */
export function undeclareProfile (kbRoot, slug) {
  const file = path.join(kbRoot, 'config.yml')
  if (!existsSync(file)) return false
  const lines = readTextFile(file).split('\n')
  const keyIdx = lines.findIndex((l) => /^profiles:/.test(l))
  if (keyIdx === -1) return false
  const end = endOfYamlBlock(lines, keyIdx)
  const start = lines.findIndex((l, i) => i > keyIdx && i < end && new RegExp(`^  ${slug}:\\s*$`).test(l))
  if (start === -1) return false
  let stop = start + 1
  while (stop < end && !/^  \S/.test(lines[stop])) stop += 1
  const out = [...lines.slice(0, start), ...lines.slice(stop)].join('\n')
  writeTextFile(file, out.endsWith('\n') ? out : `${out}\n`)
  return true
}

/** Drop every `sources:` item carrying `profile: <slug>`, by text. Returns the dropped ids. */
export function unregisterProfileSources (kbRoot, slug) {
  const file = path.join(kbRoot, 'config.yml')
  if (!existsSync(file)) return []
  const lines = readTextFile(file).split('\n')
  const keyIdx = lines.findIndex((l) => /^sources:/.test(l))
  if (keyIdx === -1) return []
  const end = endOfYamlBlock(lines, keyIdx)
  const items = []
  for (let i = keyIdx + 1; i < end; i++) {
    if (/^  - /.test(lines[i])) items.push({ start: i, stop: i + 1 })
    else if (items.length) items[items.length - 1].stop = i + 1
  }
  const owned = (item) => lines.slice(item.start, item.stop).some((l) => new RegExp(`^    profile:\\s*"?${slug}"?\\s*$`).test(l))
  const dropped = []
  const keep = []
  let cursor = 0
  for (const item of items) {
    keep.push(...lines.slice(cursor, item.start))
    if (owned(item)) {
      const id = /^  - id:\s*(\S+)/.exec(lines[item.start])?.[1] ?? null
      dropped.push(id)
    } else {
      keep.push(...lines.slice(item.start, item.stop))
    }
    cursor = item.stop
  }
  keep.push(...lines.slice(cursor))
  if (!dropped.length) return []
  const out = keep.join('\n')
  writeTextFile(file, out.endsWith('\n') ? out : `${out}\n`)
  return dropped
}

export function runSpeakerAdd (ctx, { slug, name, primaryLocale = null, locales = null }) {
  validateSlug(slug)
  if (!name) throw new Error('--name is required: the speaker\'s display name')
  if (isSpeaker(ctx.config, slug)) throw new Error(`profile ${slug} is already declared in config.yml`)
  const overlay = overlayRoot(ctx.kbRoot, slug)
  if (existsSync(overlay)) throw new Error(`${displayPath(ctx.projectRoot, overlay)} already exists`)
  if (!existsSync(TEMPLATE)) throw new Error(`overlay template missing at ${TEMPLATE}`)

  cpSync(TEMPLATE, overlay, { recursive: true })
  declareProfile(ctx.kbRoot, { slug, name, primaryLocale, locales })
  const config = loadConfig(ctx.kbRoot)
  const register = loadRegister(config)
  const entry = {
    id: nextRegisterId(register),
    kind: 'inbox',
    label: `${name} - sources`,
    path: `profiles/${slug}/sources/`,
    profile: slug,
    exclude: ['README.md']
  }
  registerSource(ctx.kbRoot, config, entry)
  const files = readdirSync(overlay, { recursive: true }).map((f) => toPosix(String(f))).sort()
  return { slug, name, overlay, registerId: entry.id, files }
}

export function runSpeakerList (ctx) {
  const state = collect({ projectRoot: ctx.projectRoot, kbRoot: ctx.kbRoot, config: ctx.config, profileName: 'default', now: ctx.now })
  return { speakers: state.speakers ?? [], locks: state.locks?.declared ?? [] }
}

/** Every ledger entry whose `**Profile:**` field names the speaker, with the rules it produced. */
function ledgerEntriesFor (kb, slug) {
  return (kb.evidence ?? [])
    .filter((e) => (e.fields?.Profile ?? '').trim() === slug)
    .map((e) => ({ id: e.id, produced: e.produced ?? [] }))
}

export function runSpeakerRemove (ctx, { slug, dryRun = false }) {
  validateSlug(slug)
  if (!isSpeaker(ctx.config, slug)) throw new Error(`no speaker ${slug} is declared in config.yml`)
  const overlay = overlayRoot(ctx.kbRoot, slug)
  const kb = loadKb(ctx.kbRoot)
  const index = loadIndex(ctx.kbRoot)
  const plan = {
    slug,
    overlay: existsSync(overlay) ? overlay : null,
    ledgerEntries: ledgerEntriesFor(kb, slug),
    indexEntries: (index.sources ?? []).filter((s) => s.profile === slug).map((s) => ({ id: s.id, origin: s.origin, produced: Array.isArray(s.produced) ? s.produced : [] })),
    registerEntries: loadRegister(ctx.config).filter((e) => e.profile === slug).map((e) => e.id),
    removed: false
  }
  plan.reopen = [...new Set([...plan.ledgerEntries, ...plan.indexEntries].flatMap((e) => e.produced))]
  if (dryRun) return plan

  // Save the index only when something left it: a rewrite with a fresh
  // `generated` stamp and no other change is noise in the next diff.
  if (plan.indexEntries.length) {
    index.sources = (index.sources ?? []).filter((s) => s.profile !== slug)
    saveIndex(ctx.kbRoot, index, ctx.now)
  }
  unregisterProfileSources(ctx.kbRoot, slug)
  undeclareProfile(ctx.kbRoot, slug)
  if (plan.overlay) rmSync(plan.overlay, { recursive: true, force: true })
  plan.removed = true
  return plan
}

function main (argv) {
  const { values } = parseCliArgs(argv, {
    add: { type: 'string' },
    name: { type: 'string' },
    locale: { type: 'string', multiple: true },
    list: { type: 'boolean' },
    remove: { type: 'string' },
    'dry-run': { type: 'boolean' }
  })
  if (values.help) {
    printHelp('scripts/speaker.mjs', [
      'Add, list, or remove a speaker - a first-person voice that inherits the house.',
      '',
      '  --add <slug> --name "<display name>"  scaffold profiles/<slug>/ from the overlay template,',
      '                                        declare the profile, register its inbox',
      '  --locale <code>                       with --add: a locale the speaker publishes in',
      '                                        (repeatable; the first is primary; default: the house)',
      '  --list                                one line per declared speaker',
      '  --remove <slug>                       retract a speaker: name what to reopen, then remove',
      '                                        the overlay, the profile, its sources and index entries',
      '  --dry-run                             with --remove: print the plan, write nothing',
      '  --root <dir>                          project root (default: cwd)',
      '  --kb <dir>                            knowledge base dir',
      '  --now <iso>                           fixed timestamp for reproducible output',
      '  --json                                machine-readable result'
    ])
    return
  }
  const { projectRoot, kbRoot } = resolveRoots(values)
  const ctx = { projectRoot, kbRoot, config: loadConfig(kbRoot), now: nowIso(values) }

  if (values.add) {
    const locales = values.locale?.length ? values.locale : null
    const result = runSpeakerAdd(ctx, { slug: values.add, name: values.name, primaryLocale: locales?.[0] ?? null, locales })
    if (values.json) return writeOut(`${JSON.stringify(result)}\n`)
    return writeOut([
      `speaker: added ${result.slug} ("${result.name}")`,
      `speaker: scaffolded ${displayPath(projectRoot, result.overlay)} (${result.files.length} files)`,
      `speaker: registered inbox ${result.registerId} at profiles/${result.slug}/sources/`,
      `speaker: next - drop the speaker's material there, then --ingest, scan and fingerprint with --profile ${result.slug}`
    ].join('\n') + '\n')
  }

  if (values.remove) {
    const plan = runSpeakerRemove(ctx, { slug: values.remove, dryRun: Boolean(values['dry-run']) })
    if (values.json) return writeOut(`${JSON.stringify(plan)}\n`)
    const lines = [`speaker: ${plan.removed ? 'removed' : 'would remove'} ${plan.slug}`]
    if (plan.overlay) lines.push(`speaker:   overlay   ${displayPath(projectRoot, plan.overlay)}`)
    lines.push(`speaker:   register  ${plan.registerEntries.join(', ') || '(none)'}`)
    lines.push(`speaker:   index     ${plan.indexEntries.map((e) => e.id).join(', ') || '(none)'}`)
    lines.push(`speaker:   ledger    ${plan.ledgerEntries.map((e) => e.id).join(', ') || '(none)'} (entries stay; their rules reopen)`)
    lines.push(`speaker:   reopen    ${plan.reopen.join(', ') || '(no rules were produced)'}`)
    if (!plan.removed) lines.push('speaker: dry run - nothing written')
    return writeOut(`${lines.join('\n')}\n`)
  }

  if (values.list || true) {
    const { speakers, locks } = runSpeakerList(ctx)
    if (values.json) return writeOut(`${JSON.stringify({ speakers, locks })}\n`)
    if (!speakers.length) return writeOut('speaker: none declared - add one with --add <slug> --name "<name>"\n')
    const lines = speakers.map((s) =>
      `speaker: ${s.slug.padEnd(12)} ${String(s.name).padEnd(22)} voice ${s.voiceRules}  cells ${s.authoredCells}  ` +
      `overrides ${s.overrides}  locks broken ${s.lockViolations}  drafts ${s.draftsPending}`)
    lines.push(`speaker: locks ${locks.join(', ') || 'none'}`)
    writeOut(`${lines.join('\n')}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
