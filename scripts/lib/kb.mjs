import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { readTextFile } from './fsx.mjs'
import { loadConfig, isSpeaker, overlayRoot as overlayRootFor, activeProfile } from './config.mjs'

export const STATES = [
  'delighted', 'curious', 'focused', 'uncertain',
  'confused', 'frustrated', 'anxious-at-risk', 'disappointed-leaving'
]

export const CONTEXTS = [
  'marketing-page', 'product-ui', 'system-error', 'help-doc', 'email',
  'social', 'legal-policy', 'notification', 'support-reply', 'release-notes'
]

export const DIALS = ['warmth', 'humor', 'directness', 'detail', 'urgency', 'formality']

/** Spec section 6.6, gate 2. Not configurable. */
export const HUMOR_ZERO_STATES = ['frustrated', 'anxious-at-risk', 'disappointed-leaving']

export const CONFIDENCE_LEVELS = ['confirmed', 'derived', 'assumed', 'disputed']
export const EVIDENCE_TYPES = ['source', 'corpus', 'interview', 'correction', 'decision']
export const ID_PREFIXES = {
  V: 'voice', T: 'tone', L: 'lexicon', M: 'mechanics', C: 'channel', A: 'audience', X: 'locale'
}

/**
 * Templates and real knowledge bases keep their example rules inside HTML
 * comments. Those are documentation, not rules - parsing them would enter
 * phantom rules citing evidence that does not exist, and would let a user's
 * commented-out rule silently enforce in review. Blank the comment body but
 * keep the newlines, so reported line numbers still anchor to the file.
 *
 * A comment missing its closing `-->` (a realistic hand-edit slip) must not
 * leave its body live - that is exactly the phantom-rule failure this
 * function exists to prevent. The second alternative below only fires when
 * the first (which requires a closing tag) cannot match, and masks from the
 * unterminated `<!--` straight through to end of file.
 */
function maskComments (md) {
  return String(md).replace(/<!--[\s\S]*?-->|<!--[\s\S]*$/g, (block) => block.replace(/[^\n]/g, ' '))
}

const HEADING = /^#{2,4}\s+([A-Z][\w./-]*)\s*(?:·\s*([^`]*?))?\s*`([a-z]+)`(?:\s*ev:\s*([^`]+?))?\s*$/
const FIELD = /^\*\*([^:*]+):\*\*\s*(.*)$/
const EVIDENCE_HEADING = /^#{2,4}\s+(e\d+)\s*[—-]\s*(\d{4}-\d{2}-\d{2})\s*[—-]\s*([a-z-]+)\s*$/
const LIST_SEPARATOR = /\s*·\s*/

export function cellId (context, state) {
  return `T-${context}/${state}`
}

function parseRefs (raw) {
  if (!raw) return []
  return raw.split(/[,\s]+/).map((r) => r.trim()).filter(Boolean)
}

export function parseRuleHeading (line) {
  const match = HEADING.exec(String(line))
  if (!match) return null
  return {
    id: match[1],
    name: match[2] ? match[2].trim() : null,
    confidence: match[3],
    evidence: parseRefs(match[4])
  }
}

function collectFields (lines, from, to) {
  const fields = {}
  for (let i = from; i < to; i++) {
    const match = FIELD.exec(lines[i].trim())
    if (match) fields[match[1].trim()] = match[2].trim()
  }
  return fields
}

function blockBoundaries (lines) {
  // Every heading line index, plus a sentinel so the last block has an end.
  const starts = []
  lines.forEach((line, index) => {
    if (/^#{1,6}\s/.test(line)) starts.push(index)
  })
  starts.push(lines.length)
  return starts
}

/**
 * A heading whose first token is shaped like a rule ID - a letter plus a number
 * (`V1`, `L03`), or a tone cell (`T-system-error/frustrated`).
 *
 * HEADING above *requires* the backtick confidence, so a heading that omits it
 * is not parsed as a rule at all: the rule is invisible to validate.mjs, to
 * compile-context.mjs, and to review. Silence is the worst possible answer
 * there, so findUnparsedRuleHeadings() spots the near-miss and validate.mjs
 * warns on it.
 *
 * The prefix letter is deliberately any capital, not one of ID_PREFIXES: a
 * heading like `### Q1 · Something` is *both* an unknown prefix and unparsable,
 * and would otherwise produce no finding at all from either check.
 *
 * Equally deliberately, the shape is "letter then digit" rather than "a
 * capitalized first word". Ordinary section headings - "## Humor gates",
 * "## State vectors", "## Never say" - would otherwise all match, and a
 * validator that cries wolf on every template heading is one users learn to
 * ignore.
 */
const RULE_ID_HEADING = /^#{2,4}\s+([A-Z]\d[\w.-]*|T-[a-z][a-z-]*\/[a-z][a-z-]*)(?:\s|$)/

export function findUnparsedRuleHeadings (md) {
  const out = []
  maskComments(md).split('\n').forEach((line, index) => {
    const match = RULE_ID_HEADING.exec(line)
    if (!match || parseRuleHeading(line)) return
    out.push({ id: match[1], text: line.trim(), line: index + 1 })
  })
  return out
}

export function parseProseRules (md) {
  const lines = maskComments(md).split('\n')
  const bounds = blockBoundaries(lines)
  const rules = []
  for (let b = 0; b < bounds.length - 1; b++) {
    const start = bounds[b]
    const heading = parseRuleHeading(lines[start])
    if (!heading) continue
    rules.push({ ...heading, fields: collectFields(lines, start + 1, bounds[b + 1]), line: start + 1 })
  }
  return rules
}

function currentSection (lines, upto) {
  for (let i = upto; i >= 0; i--) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(lines[i])
    if (match) return match[1].replace(/`[a-z]+`.*$/, '').trim()
  }
  return null
}

/**
 * Split a markdown table row, honouring the `\|` escape.
 *
 * mechanics.md documents a `Pattern` column holding a regular expression, and
 * alternation - the single most common regex construct - is written with the
 * same character markdown uses to end a cell. Splitting on a bare `|` made
 * that column unable to express alternation at all: an unescaped pipe broke
 * the row, and the escaped `\|` every markdown writer reaches for broke it
 * too, shifting every column to its right by one and dropping the evidence
 * reference off the end. The two consumers then disagreed about the wreckage -
 * validate.mjs reported a confidence of `v?s\` while compile-context.mjs
 * raised no error at all and wrote the corruption into the always-loaded
 * card.
 *
 * A negative lookbehind splits on unescaped pipes only; the escape is then
 * unwritten, so the rule sees the pattern its author meant.
 */
function splitRow (line) {
  return line.trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))
}

export function parseTables (md) {
  const lines = maskComments(md).split('\n')
  const tables = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|')) continue
    if (!/^\s*\|?[\s:-]*-{2,}[\s:|-]*$/.test(lines[i + 1])) continue

    const headers = splitRow(lines[i])
    const rows = []
    let r = i + 2
    for (; r < lines.length && lines[r].trim().startsWith('|'); r++) {
      const cells = splitRow(lines[r])
      const row = {}
      headers.forEach((header, index) => { row[header] = cells[index] ?? '' })
      rows.push({ row, line: r + 1 })
    }
    tables.push({ section: currentSection(lines, i), headers, rows })
    i = r - 1
  }
  return tables
}

export function parseTableRules (md) {
  const out = []
  for (const table of parseTables(md)) {
    if (!table.headers.includes('ID')) continue
    for (const { row, line } of table.rows) {
      const id = (row.ID || '').trim()
      if (!id || /^-+$/.test(id)) continue
      const cells = { ...row }
      delete cells.ID
      delete cells.Conf
      delete cells.Ev
      out.push({
        id,
        confidence: (row.Conf || '').trim() || null,
        evidence: parseRefs(row.Ev),
        cells,
        section: table.section,
        line
      })
    }
  }
  return out
}

export function parseDials (raw) {
  const dials = {}
  for (const match of String(raw).matchAll(/([a-z]+)\s*([+-]?\d+)/gi)) {
    const name = match[1].toLowerCase()
    if (DIALS.includes(name)) dials[name] = Number(match[2])
  }
  return dials
}

/**
 * The `**Default dials:**` line of a tone.md, or null when there is none.
 * Moved here from compile-context.mjs so the speaker offset (below) and the
 * card compiler read the same line the same way.
 */
export function defaultDialsOf (toneMd) {
  const line = /^\*\*Default dials:\*\*\s*(.+)$/m.exec(toneMd || '')
  return line ? parseDials(line[1]) : null
}

/**
 * Spec 2026-09-10 §4.3: speaker_offset = overlay default dials - house
 * default dials, per dial. Derived, never authored: one line in the overlay
 * shifts the whole matrix. A house with no dials line counts as the neutral
 * 2 on every dial, matching compile-context's NEUTRAL_DIALS. An overlay
 * with no dials line yields null - the speaker has not stated a voice yet,
 * and validate reports W_SPEAKER_NO_VOICE rather than silently using zero.
 */
export function speakerOffsetOf (houseToneMd, overlayToneMd) {
  const overlay = defaultDialsOf(overlayToneMd)
  if (!overlay) return null
  // The neutral fallback matches compile-context's NEUTRAL_DIALS: 2 on
  // every dial except humor, which is 0 - gate 1 zeroes humor on every
  // computed cell, so a nonzero neutral there would contradict the card.
  const neutral = (dial) => (dial === 'humor' ? 0 : 2)
  const house = defaultDialsOf(houseToneMd) ?? {}
  const out = {}
  for (const dial of DIALS) out[dial] = Number(overlay[dial] ?? neutral(dial)) - Number(house[dial] ?? neutral(dial))
  return out
}

function parseList (raw) {
  if (!raw) return []
  return String(raw).split(LIST_SEPARATOR).map((item) => item.trim()).filter(Boolean)
}

/**
 * Returns dials exactly as authored - ungated. This is deliberate: it is a
 * parser, and validate.mjs (Task 10) needs the literal value a human wrote
 * in order to report E_HUMOR_GATE on a cell that tries to smuggle humor
 * past gate 2. Gating here would hide the very violation validation exists
 * to catch. Gate-safe dials come only from resolveCell().
 */
export function parseToneCells (md) {
  const cells = []
  for (const rule of parseProseRules(md)) {
    const match = /^T-([a-z-]+)\/([a-z-]+)$/.exec(rule.id)
    if (!match) continue
    cells.push({
      id: rule.id,
      context: match[1],
      state: match[2],
      confidence: rule.confidence,
      evidence: rule.evidence,
      dials: parseDials(rule.fields.Dials || ''),
      feeling: rule.fields['Reader is feeling'] || null,
      do: parseList(rule.fields.Do),
      dont: parseList(rule.fields["Don't"]),
      example: (rule.fields.Example || '').replace(/^\*?"?|"?\*?$/g, '').trim() || null,
      line: rule.line
    })
  }
  return cells
}

function vectorsFromTable (table) {
  const out = {}
  const keyColumn = table.headers[0]
  for (const { row } of table.rows) {
    const key = (row[keyColumn] || '').trim()
    if (!key || /^-+$/.test(key)) continue
    const dials = {}
    for (const dial of DIALS) {
      if (row[dial] !== undefined && row[dial] !== '') dials[dial] = Number(row[dial])
    }
    out[key] = dials
  }
  return out
}

export function parseVectors (md) {
  const result = { states: {}, contexts: {} }
  for (const table of parseTables(md)) {
    const first = (table.headers[0] || '').toLowerCase()
    if (first === 'state') Object.assign(result.states, vectorsFromTable(table))
    if (first === 'context') Object.assign(result.contexts, vectorsFromTable(table))
  }
  return result
}

export function parseEvidence (md) {
  const lines = maskComments(md).split('\n')
  const bounds = blockBoundaries(lines)
  const entries = []
  for (let b = 0; b < bounds.length - 1; b++) {
    const start = bounds[b]
    const match = EVIDENCE_HEADING.exec(lines[start])
    if (!match) continue
    const fields = collectFields(lines, start + 1, bounds[b + 1])
    entries.push({
      id: match[1],
      date: match[2],
      type: match[3],
      fields,
      produced: parseRefs(fields.Produced),
      line: start + 1
    })
  }
  return entries
}

const clamp = (n) => Math.max(0, Math.min(4, n))

/** Spec 6.5 arithmetic plus the speaker term (2026-09-10 §4.3), then gate 1: computed cells never carry humor. */
export function interpolate (stateVector = {}, contextOffset = {}, speakerOffset = {}) {
  const dials = {}
  for (const dial of DIALS) {
    dials[dial] = clamp(
      Number(stateVector[dial] ?? 2) + Number(contextOffset[dial] ?? 0) + Number(speakerOffset?.[dial] ?? 0)
    )
  }
  dials.humor = 0
  return dials
}

/** Spec 6.6 gate 2. Applies to authored cells too. */
export function applyHumorGates (dials, state) {
  const out = { ...dials }
  if (HUMOR_ZERO_STATES.includes(state)) out.humor = 0
  return out
}

/**
 * Gate-safe dials everywhere in the return value. Both `dials` and, for an
 * authored cell, `cell.dials` are the same gated object - there is no
 * ungated path out of this function. (`cells` passed in, from
 * parseToneCells, still carries the raw authored value; that is where
 * validate.mjs looks to catch a cell that violates gate 2.)
 */
export function resolveCell (context, state, { cells = [], vectors = { states: {}, contexts: {} }, speakerOffset = {} } = {}) {
  const id = cellId(context, state)
  const authored = cells.find((cell) => cell.id === id)

  if (authored) {
    const gated = applyHumorGates({ ...authored.dials }, state)
    return {
      id,
      context,
      state,
      dials: gated,
      source: 'authored',
      confidence: authored.confidence,
      cell: { ...authored, dials: gated }
    }
  }

  return {
    id,
    context,
    state,
    dials: applyHumorGates(interpolate(vectors.states[state], vectors.contexts[context], speakerOffset), state),
    source: 'interpolated',
    confidence: 'interpolated',
    cell: null
  }
}

function readIfPresent (file) {
  return existsSync(file) ? readTextFile(file) : ''
}

function readDirectory (dir) {
  if (!existsSync(dir)) return {}
  const out = {}
  for (const name of readdirSync(dir).sort()) {
    if (!name.toLowerCase().endsWith('.md')) continue
    if (name.startsWith('_')) continue // _template.md is a skeleton, not content
    out[name.replace(/\.md$/i, '')] = readTextFile(path.join(dir, name))
  }
  return out
}

export function loadKb (kbRoot) {
  const files = {
    voice: readIfPresent(path.join(kbRoot, 'voice.md')),
    tone: readIfPresent(path.join(kbRoot, 'tone.md')),
    audience: readIfPresent(path.join(kbRoot, 'audience.md')),
    lexicon: readIfPresent(path.join(kbRoot, 'lexicon.md')),
    mechanics: readIfPresent(path.join(kbRoot, 'mechanics.md')),
    ledger: readIfPresent(path.join(kbRoot, 'evidence', 'ledger.md')),
    conflicts: readIfPresent(path.join(kbRoot, 'evidence', 'conflicts.md')),
    context: readIfPresent(path.join(kbRoot, 'CONTEXT.md'))
  }
  const channels = readDirectory(path.join(kbRoot, 'channels'))
  const locales = readDirectory(path.join(kbRoot, 'locales'))

  const proseSources = { ...files, ...channels, ...locales }
  const rules = []
  const unparsedHeadings = []
  for (const [name, body] of Object.entries(proseSources)) {
    // conflicts.md joins ledger and context as a non-rule-bearing file. Its
    // entries are `### D<n> - <date>`, which matches RULE_ID_HEADING's letter-
    // then-digit shape but is a conflict record, not a rule - `D` is not one of
    // ID_PREFIXES. Scanning it warned every user with a real recorded conflict
    // that their conflict was a malformed rule: the cry-wolf failure this
    // check's own comment warns against, one file over.
    if (name === 'ledger' || name === 'context' || name === 'conflicts') continue
    for (const rule of parseProseRules(body)) rules.push({ ...rule, file: name, kind: 'prose' })
    for (const rule of parseTableRules(body)) rules.push({ ...rule, file: name, kind: 'table' })
    for (const heading of findUnparsedRuleHeadings(body)) unparsedHeadings.push({ ...heading, file: name })
  }

  return {
    kbRoot,
    config: loadConfig(kbRoot),
    ...files,
    channels,
    locales,
    files,
    // Whether the three files that make a directory a knowledge base are on
    // disk at all. loadKb reads a missing file as '', which is indistinguishable
    // from an empty one - so validate.mjs cannot tell "nothing to say" from
    // "there is nothing here" without being told. Only loadKb sets this; a
    // hand-built kb object carries no claim either way.
    present: {
      config: existsSync(path.join(kbRoot, 'config.yml')),
      voice: existsSync(path.join(kbRoot, 'voice.md')),
      tone: existsSync(path.join(kbRoot, 'tone.md'))
    },
    rules,
    unparsedHeadings,
    cells: parseToneCells(files.tone),
    vectors: parseVectors(files.tone),
    evidence: parseEvidence(files.ledger)
  }
}

// ------------------------------------------------------------------ speakers

const VOICE = (rule) => rule.id.startsWith('V')

/**
 * Spec 2026-09-10 §4.2 and §4.4. Voice replaces as a set: if the overlay has
 * any V rule, the house's unlocked V rules are dropped and its locked ones
 * are appended after the speaker's. Everything else merges by id: same id
 * overrides, new id adds, a locked id is refused and recorded.
 *
 * Order matters for byte identity downstream: with an empty overlay the
 * result is the house list in the house's own order, tagged - nothing moves.
 */
export function mergeRules (houseRules, overlayRules, locks = []) {
  const locked = new Set(locks)
  const tagHouse = (rule) => ({ ...rule, origin: 'house', locked: locked.has(rule.id) })
  const tagSpeaker = (rule) => ({ ...rule, origin: 'speaker', locked: false })

  const overrides = []
  const lockViolations = []
  const overlayById = new Map()
  for (const rule of overlayRules) if (!overlayById.has(rule.id)) overlayById.set(rule.id, rule)
  const speakerHasVoice = overlayRules.some(VOICE)

  const rules = []
  for (const house of houseRules) {
    const hit = overlayById.get(house.id)
    if (locked.has(house.id)) {
      if (hit) lockViolations.push({ id: house.id, file: hit.path ?? `${hit.file}.md`, line: hit.line, houseRule: house })
      if (VOICE(house) && speakerHasVoice) continue // appended after the speaker's voice, below
      rules.push(tagHouse(house))
      continue
    }
    if (VOICE(house) && speakerHasVoice) continue
    if (hit) continue // replaced; the speaker rule is pushed in overlay order below
    rules.push(tagHouse(house))
  }
  for (const rule of overlayRules) {
    if (locked.has(rule.id)) continue
    const houseRule = houseRules.find((h) => h.id === rule.id)
    const tagged = tagSpeaker(rule)
    if (houseRule && !VOICE(rule)) {
      tagged.overrides = houseRule
      overrides.push(tagged)
    }
    rules.push(tagged)
  }
  if (speakerHasVoice) {
    for (const house of houseRules) if (VOICE(house) && locked.has(house.id)) rules.push(tagHouse(house))
  }
  return { rules, overrides, lockViolations }
}

/**
 * The house plus one overlay, merged by the rules in spec 2026-09-10 §4.
 * This is the one function every consumer reads a knowledge base through;
 * loadKb() is the per-directory parser underneath it.
 *
 * With no overlay - `default`, an undeclared name, or a declared speaker
 * whose directory does not exist yet - the result is the house with
 * `origin`, `locked` and `path` on every rule and nothing else changed.
 */
export function resolveKb (kbRoot, profileName = 'default') {
  const house = loadKb(kbRoot)
  const config = house.config
  const locks = Array.isArray(config.locks) ? config.locks : []
  const withPath = (rules, prefix) => rules.map((rule) => ({
    ...rule, path: prefix ? path.posix.join(prefix, `${rule.file}.md`) : `${rule.file}.md`
  }))

  const overlayDir = overlayRootFor(kbRoot, profileName)
  const speaking = isSpeaker(config, profileName) && existsSync(overlayDir)

  if (!speaking) {
    const { rules } = mergeRules(withPath(house.rules, ''), [], locks)
    return {
      ...house,
      rules,
      profileName,
      role: 'house',
      speaker: null,
      locks,
      overrides: [],
      lockViolations: [],
      speakerOffset: null,
      houseRoot: kbRoot,
      overlayRoot: null,
      house,
      overlay: null
    }
  }

  const overlay = loadKb(overlayDir)
  const prefix = path.posix.join('profiles', profileName)
  const { rules, overrides, lockViolations } = mergeRules(
    withPath(house.rules, ''), withPath(overlay.rules, prefix), locks
  )
  const profile = activeProfile(config, profileName)

  return {
    ...house,
    // The overlay owns the tone text: default dials and authored cells are
    // the speaker's. Vectors merge row by row; cells are NOT inherited (§4.3).
    tone: overlay.tone,
    cells: overlay.cells,
    vectors: {
      states: { ...house.vectors.states, ...overlay.vectors.states },
      contexts: { ...house.vectors.contexts, ...overlay.vectors.contexts }
    },
    channels: { ...house.channels, ...overlay.channels },
    locales: { ...house.locales, ...overlay.locales },
    unparsedHeadings: [
      ...house.unparsedHeadings,
      ...overlay.unparsedHeadings.map((h) => ({ ...h, file: path.posix.join(prefix, h.file) }))
    ],
    rules,
    config,
    profileName,
    role: 'speaker',
    speaker: { slug: profileName, name: profile.name },
    locks,
    overrides,
    lockViolations,
    speakerOffset: speakerOffsetOf(house.tone, overlay.tone),
    houseRoot: kbRoot,
    overlayRoot: overlayDir,
    house,
    overlay
  }
}
