import { existsSync, statSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readTextFile } from './fsx.mjs'
import { activeProfile, speakerProfiles, isSpeaker, artifactRoot, overlayRoot } from './config.mjs'
import {
  resolveKb, defaultDialsOf, CONTEXTS, STATES, CONFIDENCE_LEVELS, EVIDENCE_TYPES, HUMOR_ZERO_STATES, cellId
} from './kb.mjs'
import { loadRegister, resolveRegister, entriesForProfile } from './register.mjs'
import { loadIndex } from './sourceindex.mjs'
import { sha256File } from './hash.mjs'
import { detectGaps } from './gaps.mjs'
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
    // `confirmed` or interview evidence - never merely `derived`. A derived
    // rule is what the corpus said, inferred without anyone being asked; a
    // knowledge base built entirely from a scan would otherwise report the
    // interview stage complete having never put a single question to anyone.
    // `confirmed` stays a qualifying signal because it takes user-supplied
    // ground truth to reach - a preference pair, or a rule an existing style
    // guide states outright.
    interview: rules.some((r) => r.confidence === 'confirmed') ||
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

export function cardFreshness (kbRoot, now, { cardRoot = kbRoot, sourceRoots = null } = {}) {
  const cardMs = mtimeMs(path.join(cardRoot, 'CONTEXT.md'))
  if (cardMs === null) return null
  // A speaker card compiles from its overlay AND the house, so both roots
  // are checked; the overlay's files are named with their profiles/ prefix
  // so the reader knows which voice.md is behind.
  const roots = sourceRoots ?? [{ root: kbRoot, prefix: '' }]
  const staleAgainst = []
  for (const { root, prefix } of roots) {
    for (const name of CARD_SOURCES) {
      const sourceMs = mtimeMs(path.join(root, name))
      if (sourceMs !== null && sourceMs > cardMs) staleAgainst.push(`${prefix}${name}`)
    }
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
  // Keys come from the knowledge base and the index, both committed. A plain
  // object literal would route "__proto__" through Object.prototype's setter
  // rather than counting it.
  const out = Object.create(null)
  for (const item of items) {
    const key = keyOf(item)
    if (key === null || key === undefined) continue
    out[key] = (out[key] ?? 0) + 1
  }
  // Spread back to an ordinary object on the way out - see scan.mjs's byLocale.
  return { ...out }
}

/**
 * Attribute a file's words to a context by path segment. Deliberately crude:
 * this feeds one gap detector ("traffic but no authored cells"), never a
 * statistic anyone reports. A wrong attribution costs at worst a suggestion
 * to author a cell the project may not need - cheap, and easy to ignore.
 */
function contextOfPath (relPath) {
  const segments = String(relPath).toLowerCase().split('/')
  for (const context of CONTEXTS) {
    const bare = context.replace('-', '')
    if (segments.some((s) => s === context || s === bare || s.startsWith(`${context}.`))) return context
  }
  if (segments.includes('marketing') || segments.includes('content')) return 'marketing-page'
  if (segments.includes('docs') || segments.includes('help')) return 'help-doc'
  if (segments.includes('locales') || segments.includes('ui')) return 'product-ui'
  return null
}

export function coverageOf (kb, manifest) {
  const authoredIds = new Set((kb.cells ?? []).map((cell) => cellId(cell.context, cell.state)))

  const traffic = Object.fromEntries(CONTEXTS.map((c) => [c, 0]))
  for (const file of manifest?.files ?? []) {
    const context = contextOfPath(file.path)
    if (context) traffic[context] += Number(file.words) || 0
  }

  const byContext = CONTEXTS.map((context) => {
    const cells = STATES.map((state) => (authoredIds.has(cellId(context, state)) ? 'authored' : 'computed'))
    return {
      context,
      authored: cells.filter((c) => c === 'authored').length,
      of: STATES.length,
      cells,
      traffic: traffic[context]
    }
  })

  return {
    authored: byContext.reduce((sum, c) => sum + c.authored, 0),
    possible: CONTEXTS.length * STATES.length,
    // Carried on the state object so lib/render.mjs can label the matrix
    // columns without importing kb.mjs - which reaches node:fs, and would
    // make the renderer's "no file I/O" guarantee a matter of trust rather
    // than of its import list. Order matches every `cells` array below.
    states: [...STATES],
    humorGated: [...HUMOR_ZERO_STATES],
    byContext
  }
}

/**
 * Drafts belong to the profile their frontmatter names. A draft with no
 * frontmatter, or no `profile:` line, is the house's - every draft written
 * before speakers existed looks like that, so the house count is unchanged.
 */
function countDrafts (kbRoot, profileName = 'default') {
  const dir = path.join(kbRoot, '.drafts')
  if (!existsSync(dir)) return 0
  try {
    let n = 0
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const head = readTextFile(path.join(dir, entry.name)).slice(0, 2000)
      const match = /^---\n[\s\S]*?^profile:\s*(\S+)\s*$[\s\S]*?^---/m.exec(head)
      const owner = match ? match[1] : 'default'
      if (owner === profileName) n += 1
    }
    return n
  } catch {
    return 0
  }
}

/**
 * One speaker, summarised for the house view's speakers block and for
 * G17-G20 in lib/gaps.mjs. Reads the overlay's own fingerprint and manifest,
 * because drift and corpus are per speaker (spec 2026-09-10 §4.5).
 */
function summariseSpeaker ({ kbRoot, config, slug, now }) {
  const kb = resolveKb(kbRoot, slug)
  const root = overlayRoot(kbRoot, slug)
  const fingerprint = readJson(path.join(root, 'evidence', 'fingerprint.json'))
  const manifest = readJson(path.join(root, 'evidence', 'manifest.json'))
  const drift = driftOf(fingerprint, config.thresholds?.drift_pct ?? 25)
  const flagged = Object.values(drift.byLocale).some((l) => l.metrics.some((m) => m.flagged))
  const card = cardFreshness(kbRoot, now, {
    cardRoot: root,
    sourceRoots: [{ root, prefix: `profiles/${slug}/` }, { root: kbRoot, prefix: '' }]
  })
  return {
    slug,
    name: kb.speaker?.name ?? slug,
    voiceRules: kb.rules.filter((r) => r.origin === 'speaker' && r.id.startsWith('V')).length,
    hasDefaultDials: defaultDialsOf(kb.overlay?.tone ?? '') !== null,
    authoredCells: kb.cells.length,
    overrides: kb.overrides.length,
    lockViolations: kb.lockViolations.length,
    corpusWords: manifest?.totals?.words ?? 0,
    fingerprintAgeDays: fingerprint ? ageDays(Date.parse(fingerprint.generated), now) : null,
    driftBaseline: Boolean(fingerprint?.baseline),
    driftFlagged: flagged,
    draftsPending: countDrafts(kbRoot, slug),
    sourcesNeverIngested: manifest?.unindexed?.count ?? 0,
    cardStale: card ? card.staleAgainst : null
  }
}

/** Every conflicts.md heading of the form '## <id>' is one open dispute. */
function countConflicts (kbRoot) {
  const abs = path.join(kbRoot, 'evidence', 'conflicts.md')
  if (!existsSync(abs)) return 0
  const body = readTextFile(abs).replace(/<!--[\s\S]*?-->/g, '')
  return (body.match(/^#{2,4}\s+\S+/gm) ?? []).length
}

/** Zero-filled so an unused level is 0, never absent - a renderer must not have to guess. */
function zeroFilled (keys, counts) {
  return Object.fromEntries(keys.map((key) => [key, counts[key] ?? 0]))
}

/**
 * fingerprintFromStats returns 22 metrics across its universal and english
 * blocks. Showing all 22 would bury the four that a reader acts on, so this
 * is a curated list, ordered by how directly each one reads as "the voice
 * changed" rather than "the corpus changed shape".
 *
 * `block` names which sub-object of the per-locale fingerprint the key lives
 * in. An english-block metric is simply absent for a non-English locale
 * (fingerprintFromStats sets `english` to null there), and is skipped rather
 * than reported as a change to or from nothing.
 */
export const DRIFT_METRICS = [
  { key: 'meanSentenceLength', block: 'universal', label: 'mean sentence' },
  { key: 'medianSentenceLength', block: 'universal', label: 'median sentence' },
  { key: 'meanWordLength', block: 'universal', label: 'mean word' },
  { key: 'exclamationRate', block: 'universal', label: 'exclamations' },
  { key: 'questionRate', block: 'universal', label: 'questions' },
  { key: 'emojiPer1000Words', block: 'universal', label: 'emoji /1k' },
  { key: 'contractionPer1000Words', block: 'english', label: 'contractions /1k' },
  { key: 'readingGrade', block: 'english', label: 'reading grade' },
  { key: 'passiveRate', block: 'english', label: 'passive' }
]

/**
 * Signed percentage change relative to the magnitude of the baseline.
 *
 * A zero baseline returns null, not Infinity and not 100: percentage change
 * from zero is undefined, and putting a fabricated figure on this dashboard
 * would contradict the one claim it makes about itself. deltaBar() renders a
 * null as an explicit 'n/a' rather than an empty bar, so "we cannot say" never
 * reads as "no drift".
 */
export function deltaPct (from, to) {
  if (from === null || from === undefined || to === null || to === undefined) return null
  if (from === 0) return to === 0 ? 0 : null
  return Math.round(((to - from) / Math.abs(from)) * 1000) / 10
}

export function driftOf (fingerprint, thresholdPct) {
  // evidence/fingerprint.json is committed and JSON.parse gives "__proto__"
  // as a real own key, so this map must not have a prototype to shadow it.
  const byLocale = Object.create(null)
  const baselineLocales = fingerprint?.baseline?.byLocale ?? {}

  for (const [locale, current] of Object.entries(fingerprint?.byLocale ?? {})) {
    const base = baselineLocales[locale]
    if (!base) {
      // Present with a null baseline, never omitted: an omitted locale makes
      // "drift cannot be measured here" invisible, and that is the gap that
      // most needs surfacing.
      byLocale[locale] = { baseline: null, metrics: [] }
      continue
    }
    const metrics = []
    for (const { key, block, label } of DRIFT_METRICS) {
      const from = base?.[block]?.[key]
      const to = current?.[block]?.[key]
      if (from === undefined && to === undefined) continue
      const delta = deltaPct(from ?? null, to ?? null)
      metrics.push({
        key,
        label,
        from: from ?? null,
        to: to ?? null,
        deltaPct: delta,
        flagged: delta !== null && Math.abs(delta) >= thresholdPct
      })
    }
    byLocale[locale] = { baseline: fingerprint.baseline.generated ?? null, metrics }
  }

  // Spread back to an ordinary object on the way out - see scan.mjs's byLocale.
  return { thresholdPct, byLocale: { ...byLocale } }
}

/**
 * Deciding whether a registered source is stale means hashing it, which on a
 * corpus of decks and PDFs is real I/O. That is not worth paying on every
 * glance, so read-only mode reports `freshness: 'unchecked'` and leaves
 * `stale` and `fresh` null.
 *
 * Null, not zero: zero stale reads as "everything is current", a claim this
 * mode has not earned, because it never hashed anything.
 */
export function sourcesOf (config, index, register, manifest, opts = {}) {
  const { checkFreshness = false, projectRoot, kbRoot, profileName = 'default' } = opts
  const indexed = index.sources ?? []

  const entries = indexed.map((source) => ({
    id: source.id,
    kind: source.kind ?? null,
    label: source.label ?? null,
    origin: source.origin ?? null,
    status: source.status ?? null,
    fidelity: source.quality?.fidelity ?? source.fidelity ?? null,
    analysed: source.analysed ?? null,
    produced: Array.isArray(source.produced) ? source.produced : []
  }))

  const out = {
    registered: register.length,
    analysed: indexed.length,
    missing: entries.filter((e) => e.status === 'missing').length,
    unindexed: manifest?.unindexed?.count ?? 0,
    freshness: 'unchecked',
    stale: null,
    fresh: null,
    entries
  }

  if (!checkFreshness) return out

  // Under --refresh only. resolveRegister walks the register, and hashing each
  // resolved file against the index tells stale from current. No child process
  // is spawned - conformance forbids it - the library functions are called
  // directly.
  try {
    const resolved = resolveRegister(register, { projectRoot, kbRoot, config, profileName })
    const knownShas = new Set(indexed.map((s) => s.sha256).filter(Boolean))
    const originToSha = new Map(indexed.filter((s) => s.sha256).map((s) => [s.origin, s.sha256]))
    let stale = 0
    let fresh = 0
    for (const entry of resolved) {
      if (entry.kind === 'project' || entry.kind === 'url') continue
      for (const file of entry.files ?? []) {
        if (!existsSync(file.abs)) continue
        const sha = sha256File(file.abs)
        if (knownShas.has(sha)) continue
        if (originToSha.has(file.origin)) stale += 1
        else fresh += 1
      }
    }
    out.freshness = 'checked'
    out.stale = stale
    out.fresh = fresh
  } catch {
    // A vanished share or an unreadable file must not take down the dashboard;
    // the honest report is that the check did not complete.
    out.freshness = 'unchecked'
  }
  return out
}

/**
 * The vendored library manifest, resolved relative to this module's own
 * location the same way lib/office.mjs and lib/pdf.mjs resolve the bundles
 * themselves - never from whatever --root/--kb a caller passed. It ships with
 * the plugin and is never per-project.
 */
function loadVendorPins () {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const manifest = readJson(path.resolve(here, '..', '..', 'vendor', 'manifest.json'))
  const libraries = manifest?.libraries ?? {}
  return Object.entries(libraries).map(([name, meta]) => ({ name, version: meta?.version ?? null }))
}

export function collect ({ projectRoot, kbRoot, config, profileName = 'default', now, checkFreshness = false }) {
  const profile = activeProfile(config, profileName)
  const kb = resolveKb(kbRoot, profileName)
  const present = kb.present ?? {}
  const exists = Boolean(present.config || present.voice || present.tone)
  const speaking = kb.role === 'speaker'

  // A speaker's artifacts - manifest, fingerprint, card - live under its
  // overlay; its register entries and index entries are the ones attributed
  // to it. The house reads exactly what it read before.
  const root = artifactRoot(kbRoot, profileName, config)
  const manifest = readJson(path.join(root, 'evidence', 'manifest.json'))
  const fingerprint = readJson(path.join(root, 'evidence', 'fingerprint.json'))
  const wholeIndex = loadIndex(kbRoot)
  const index = {
    ...wholeIndex,
    sources: (wholeIndex.sources ?? []).filter((s) =>
      (speaking ? s.profile === profileName : (s.profile ?? null) === null))
  }
  const register = entriesForProfile(loadRegister(config), profileName, config)
  const validation = exists ? validateKb(kb) : { errors: 0, warnings: 0, findings: [], counts: {} }
  const cardPath = path.join(root, 'CONTEXT.md')
  const cardExists = existsSync(cardPath)

  const stage = exists
    ? inferStages({ manifest, index, register, fingerprint, kb, validation, cardExists })
    : { at: null, reached: Object.fromEntries(STAGES.map((s) => [s, false])) }

  const state = {
    generated: now,
    kb: {
      root: kbRoot,
      exists,
      version: config.kb_version ?? null,
      // The brand is the house's name whoever is speaking: a speaker view
      // reads "Acme | maya (speaker)", never "Maya Lind | maya (speaker)".
      brand: (kb.role === 'speaker' ? activeProfile(config, 'default') : profile).name ?? null,
      profile: profileName,
      locales: profile.locales ?? [profile.primary_locale ?? 'en'],
      primaryLocale: profile.primary_locale ?? 'en',
      role: kb.role,
      speaker: kb.speaker
    },
    locks: { declared: kb.locks, violated: kb.lockViolations.map((v) => v.id) },
    stage,
    integrity: {
      errors: validation.errors ?? 0,
      warnings: validation.warnings ?? 0,
      byCode: countBy(validation.findings ?? [], (f) => f.code),
      findings: validation.findings ?? []
    },
    freshness: {
      card: speaking
        ? cardFreshness(kbRoot, now, {
          cardRoot: root,
          sourceRoots: [{ root, prefix: `profiles/${profileName}/` }, { root: kbRoot, prefix: '' }]
        })
        : cardFreshness(kbRoot, now),
      manifest: manifestFreshness(projectRoot, manifest, now),
      fingerprint: fingerprint
        ? { generated: fingerprint.generated ?? null, ageDays: ageDays(Date.parse(fingerprint.generated), now) }
        : null
    },
    coverage: coverageOf(kb, manifest),
    rules: {
      total: (kb.rules ?? []).length,
      byConfidence: zeroFilled(CONFIDENCE_LEVELS, countBy(kb.rules ?? [], (r) => r.confidence)),
      byFile: countBy(kb.rules ?? [], (r) => r.file),
      byOrigin: {
        house: (kb.rules ?? []).filter((r) => r.origin === 'house').length,
        speaker: (kb.rules ?? []).filter((r) => r.origin === 'speaker').length,
        overrides: (kb.overrides ?? []).length,
        locked: (kb.rules ?? []).filter((r) => r.locked).length
      }
    },
    evidence: {
      total: (kb.evidence ?? []).length,
      byType: zeroFilled(EVIDENCE_TYPES, countBy(kb.evidence ?? [], (e) => e.type)),
      conflicts: countConflicts(kbRoot),
      drafts: countDrafts(kbRoot, profileName)
    },
    drift: driftOf(fingerprint, config.thresholds?.drift_pct ?? 25),
    sources: sourcesOf(config, index, register, manifest, { checkFreshness, projectRoot, kbRoot, profileName }),
    corpus: {
      totals: manifest?.totals ?? null,
      byLocale: manifest?.byLocale ?? {},
      skipped: manifest?.skipped?.count ?? 0,
      unreadable: manifest?.unreadable?.count ?? 0,
      fidelity: Object.fromEntries(
        Object.entries(fingerprint?.byLocale ?? {}).map(([locale, fp]) => [locale, fp.fidelity ?? null])
      )
    },
    settings: {
      thresholds: config.thresholds ?? {},
      register: register.map((entry) => ({ id: entry.id, kind: entry.kind, label: entry.label ?? null })),
      runtime: config.runtime ?? {},
      vendor: loadVendorPins()
    },
    localePacks: Object.keys(kb.locales ?? {}),
    cardTokens: cardExists ? Math.ceil(readTextFile(cardPath).length / 4) : 0,
    // Every declared speaker in the house view; only this one in a speaker
    // view. G17-G20 iterate it either way; the renderers draw the panel only
    // in the house view.
    speakers: !exists
      ? []
      : speaking
        ? [summariseSpeaker({ kbRoot, config, slug: profileName, now })]
        : speakerProfiles(config).map(({ slug }) => summariseSpeaker({ kbRoot, config, slug, now }))
  }

  // Computed last, from the assembled object: every detector is a pure
  // predicate over the rings above, so gaps cannot disagree with what the
  // panels show.
  state.gaps = detectGaps(state)
  return state
}
