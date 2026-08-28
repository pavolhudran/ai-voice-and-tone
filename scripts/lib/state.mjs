import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { readTextFile } from './fsx.mjs'
import { activeProfile } from './config.mjs'
import { loadKb } from './kb.mjs'
import { loadRegister } from './register.mjs'
import { loadIndex } from './sourceindex.mjs'
import { validateKb } from '../validate.mjs'

/**
 * The collector: every knowledge-base artifact in, one plain, JSON-serialisable
 * state object out. All filesystem access for the status dashboard lives here,
 * and no string formatting does - lib/render.mjs owns that and cannot read a
 * file (test/render.test.mjs asserts the absence of a node:fs import).
 *
 * collect() never throws. Every artifact is optional and its absence is a
 * value, not an error - the same posture loadIndex already takes toward a
 * missing sources.json and loadKb toward an absent markdown file. This matters
 * more here than anywhere else in the plugin: :status is the first thing a new
 * user runs, and at that moment nothing exists at all.
 */

/**
 * Six stages, not the pipeline's seven. `gaps` computes the questionnaire in
 * memory and leaves no artifact behind, so it cannot be observed; rendering a
 * box the plugin can never fill would be the hand-maintained-summary defect
 * in miniature.
 */
export const STAGES = ['scan', 'ingest', 'measure', 'draft', 'interview', 'canonize']

export function readJson (abs) {
  if (!existsSync(abs)) return null
  try {
    return JSON.parse(readTextFile(abs))
  } catch {
    // A corrupt artifact is reported as absent rather than crashing the run.
    // The gap catalogue surfaces the consequence (no manifest, no fingerprint);
    // a stack trace over a half-written JSON file would surface nothing.
    return null
  }
}

/** null when the path does not exist, so callers can tell absent from ancient. */
export function mtimeMs (abs) {
  return existsSync(abs) ? statSync(abs).mtimeMs : null
}

export function inferStages ({ manifest, index, register, fingerprint, kb, validation, cardExists }) {
  const rules = kb.rules ?? []
  const evidence = kb.evidence ?? []
  const indexed = (index.sources ?? []).length
  const pendingKinds = (register ?? []).filter((entry) => entry.kind !== 'project')

  const scan = Boolean(manifest?.totals?.files > 0)

  const reached = {
    scan,
    // "Nothing to ingest" only counts once a corpus exists. Without that
    // guard a bare directory - whose synthesised project-only register has no
    // non-project entry - would report ingest as reached.
    ingest: indexed > 0 || (scan && pendingKinds.length === 0),
    measure: Object.keys(fingerprint?.byLocale ?? {}).length > 0,
    draft: rules.length > 0,
    interview: rules.some((r) => r.confidence && r.confidence !== 'assumed') ||
      evidence.some((e) => e.type === 'interview'),
    canonize: Boolean(cardExists) && (validation?.errors ?? 0) === 0 && Boolean(fingerprint?.baseline)
  }

  let at = null
  for (const stage of STAGES) if (reached[stage]) at = stage
  return { at, reached }
}

const MS_PER_DAY = 86400000

function ageDays (fromMs, now) {
  if (fromMs === null || fromMs === undefined || Number.isNaN(fromMs)) return null
  const nowMs = Date.parse(now)
  if (Number.isNaN(nowMs)) return null
  return Math.max(0, Math.floor((nowMs - fromMs) / MS_PER_DAY))
}

/**
 * The five files compileContext() actually reads. Comparing the card's mtime
 * against exactly these is five statSync calls and is EXACT: any one of them
 * newer than the card means the card is behind, and we can name which.
 */
export const CARD_SOURCES = ['voice.md', 'tone.md', 'lexicon.md', 'mechanics.md', 'config.yml']

export function cardFreshness (kbRoot, now) {
  const cardMs = mtimeMs(path.join(kbRoot, 'CONTEXT.md'))
  if (cardMs === null) return null
  const staleAgainst = []
  for (const name of CARD_SOURCES) {
    const sourceMs = mtimeMs(path.join(kbRoot, name))
    if (sourceMs !== null && sourceMs > cardMs) staleAgainst.push(name)
  }
  return { generated: new Date(cardMs).toISOString(), staleAgainst, ageDays: ageDays(cardMs, now) }
}

/**
 * Approximate by design, and the renderer says so. Detecting files created
 * since the manifest was written would mean re-globbing the register, which
 * IS the scan - that is what --refresh is for. What is cheap and exact is the
 * other half: how many of the manifest's OWN listed files have changed.
 *
 * A number with its limit attached is worth more than a number that quietly
 * lies, so `checked` travels with `changedSince` rather than being folded in.
 */
export function manifestFreshness (projectRoot, manifest, now) {
  if (!manifest) return null
  const cutoff = Date.parse(manifest.generated)
  let changedSince = 0
  let checked = 0
  for (const file of manifest.files ?? []) {
    const abs = path.join(projectRoot, ...String(file.path).split('/'))
    const fileMs = mtimeMs(abs)
    if (fileMs === null) continue // vanished since the scan; not checkable
    checked += 1
    if (!Number.isNaN(cutoff) && fileMs > cutoff) changedSince += 1
  }
  return { generated: manifest.generated, ageDays: ageDays(cutoff, now), changedSince, checked }
}

function countBy (items, keyOf) {
  const out = {}
  for (const item of items) {
    const key = keyOf(item)
    if (key === null || key === undefined) continue
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

export function collect ({ projectRoot, kbRoot, config, profileName = 'default', now }) {
  const profile = activeProfile(config, profileName)
  const kb = loadKb(kbRoot)
  const present = kb.present ?? {}
  const exists = Boolean(present.config || present.voice || present.tone)

  const manifest = readJson(path.join(kbRoot, 'evidence', 'manifest.json'))
  const fingerprint = readJson(path.join(kbRoot, 'evidence', 'fingerprint.json'))
  const index = loadIndex(kbRoot)
  const register = loadRegister(config)
  const validation = exists ? validateKb(kb) : { errors: 0, warnings: 0, findings: [], counts: {} }
  const cardExists = existsSync(path.join(kbRoot, 'CONTEXT.md'))

  const stage = exists
    ? inferStages({ manifest, index, register, fingerprint, kb, validation, cardExists })
    : { at: null, reached: Object.fromEntries(STAGES.map((s) => [s, false])) }

  return {
    generated: now,
    kb: {
      root: kbRoot,
      exists,
      version: config.kb_version ?? null,
      brand: profile.name ?? null,
      profile: profileName,
      locales: profile.locales ?? [profile.primary_locale ?? 'en'],
      primaryLocale: profile.primary_locale ?? 'en'
    },
    stage,
    integrity: {
      errors: validation.errors ?? 0,
      warnings: validation.warnings ?? 0,
      byCode: countBy(validation.findings ?? [], (f) => f.code),
      findings: validation.findings ?? []
    },
    freshness: {
      card: cardFreshness(kbRoot, now),
      manifest: manifestFreshness(projectRoot, manifest, now),
      fingerprint: fingerprint
        ? { generated: fingerprint.generated ?? null, ageDays: ageDays(Date.parse(fingerprint.generated), now) }
        : null
    }
  }
}
