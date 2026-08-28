import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  loadKb, STATES, CONTEXTS, DIALS, CONFIDENCE_LEVELS, EVIDENCE_TYPES, ID_PREFIXES,
  HUMOR_ZERO_STATES, cellId
} from './lib/kb.mjs'
import { loadIndex, indexPathFor, staleByExtractor, STATS_REQUIRED } from './lib/sourceindex.mjs'
import { activeProfile } from './lib/config.mjs'
import { readTextFile } from './lib/fsx.mjs'
import { parseCliArgs, resolveRoots, die, printHelp, writeOut } from './lib/cli.mjs'

// The vendored library manifest, resolved the same way lib/office.mjs and
// lib/pdf.mjs resolve the vendored bundles themselves: relative to this
// script's own location, not to whatever --root/--kb a caller passed. It
// ships with the plugin, one level up from scripts/, and is never per-project.
//
// Derived via fileURLToPath rather than the newer built-in dirname shorthand
// on import.meta: that shorthand needs Node >= 20.11, and this plugin's
// declared floor (package.json's "engines") is 18.13. test/conformance.test.mjs
// sweeps for the newer form so it cannot creep back in.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const VENDOR_MANIFEST = path.resolve(HERE, '..', 'vendor', 'manifest.json')

// Absent or corrupt degrades to an empty manifest rather than throwing - the
// same posture loadIndex already takes toward a missing or corrupt
// sources.json. staleByExtractor treats "current lists no such library" as
// nothing to flag, so an empty manifest here just means check 6 finds
// nothing stale, not that validation crashes.
function loadVendorManifest () {
  if (!existsSync(VENDOR_MANIFEST)) return { libraries: {} }
  try {
    return JSON.parse(readTextFile(VENDOR_MANIFEST))
  } catch {
    return { libraries: {} }
  }
}

export function validateKb (kb = {}) {
  const rules = kb.rules ?? []
  const evidence = kb.evidence ?? []
  const cells = kb.cells ?? []
  const vectors = kb.vectors ?? {}
  // D3: a caller can hand in a half-built vectors object. Reading .contexts off
  // it must not throw - validateKb's contract is to return a report, always.
  const stateVectors = vectors.states ?? {}
  const contextOffsets = vectors.contexts ?? {}

  const findings = []
  const addFile = (severity, code, message, file, line) =>
    findings.push({ severity, code, message, file, line })
  const add = (severity, code, message, file, line) =>
    addFile(severity, code, message, `${file}.md`, line)

  // loadKb reads every absent file as '', so a typo'd --kb, or an :audit run
  // before :init, otherwise validates a directory that does not exist and
  // reports a clean bill of health. commands/sync.md then compiles a card from
  // nothing, because validation "found no errors".
  const present = kb.present
  if (present && !present.config && !present.voice && !present.tone) {
    addFile('error', 'E_NO_KB',
      `no knowledge base at ${kb.kbRoot ?? '<kb>'}: config.yml, voice.md, and tone.md are all ` +
      'absent - check --kb, or run /voice-and-tone:init to create one',
      'config.yml', 0)
  }

  for (const heading of kb.unparsedHeadings ?? []) {
    add('warning', 'W_UNPARSED_RULE_HEADING',
      `heading "${heading.text}" reads as rule ${heading.id} but declares no confidence in ` +
      'backticks, so it is not parsed as a rule anywhere',
      heading.file, heading.line)
  }

  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]))
  const ruleIds = new Set()

  for (const rule of rules) {
    if (ruleIds.has(rule.id)) {
      add('error', 'E_DUPLICATE_ID', `rule id ${rule.id} is used more than once`, rule.file, rule.line)
    }
    ruleIds.add(rule.id)

    if (!ID_PREFIXES[rule.id[0]]) {
      add('error', 'E_UNKNOWN_PREFIX', `rule id ${rule.id} uses an unknown prefix`, rule.file, rule.line)
    }
    // A table row with an empty Conf column parses into confidence null. Every
    // downstream check used to be guarded by `rule.confidence &&`, so such a
    // row produced no finding at all - the one rule shape that was entirely
    // unvalidated. Confidence is what drives review severity; a rule without
    // one is not a weaker rule, it is an unusable one.
    if (!rule.confidence) {
      add('error', 'E_NO_CONFIDENCE',
        `rule ${rule.id} declares no confidence; one of ${CONFIDENCE_LEVELS.join(', ')} is required`,
        rule.file, rule.line)
    } else if (!CONFIDENCE_LEVELS.includes(rule.confidence)) {
      add('error', 'E_UNKNOWN_CONFIDENCE',
        `rule ${rule.id} has confidence "${rule.confidence}"`, rule.file, rule.line)
    }
    const ruleEvidence = rule.evidence ?? []
    for (const ref of ruleEvidence) {
      if (!evidenceById.has(ref)) {
        add('error', 'E_BROKEN_EVIDENCE_REF',
          `rule ${rule.id} cites ${ref}, which is not in the ledger`, rule.file, rule.line)
        continue
      }
      if (!evidenceById.get(ref).produced.includes(rule.id)) {
        add('warning', 'W_ONE_WAY_EVIDENCE',
          `rule ${rule.id} cites ${ref}, but ${ref} does not list ${rule.id} under Produced`,
          rule.file, rule.line)
      }
    }
    if (ruleEvidence.length === 0 && rule.confidence && rule.confidence !== 'assumed') {
      add('warning', 'W_NO_EVIDENCE',
        `rule ${rule.id} is ${rule.confidence} but cites no evidence`, rule.file, rule.line)
    }
  }

  for (const entry of evidence) {
    if (!EVIDENCE_TYPES.includes(entry.type)) {
      add('error', 'E_UNKNOWN_EVIDENCE_TYPE',
        `evidence ${entry.id} has type "${entry.type}"`, 'evidence/ledger', entry.line)
    }
    for (const produced of entry.produced) {
      if (!ruleIds.has(produced)) {
        add('warning', 'W_ORPHAN_EVIDENCE',
          `evidence ${entry.id} claims to have produced ${produced}, which does not exist`,
          'evidence/ledger', entry.line)
      }
    }
  }

  for (const cell of cells) {
    const dials = cell.dials ?? {}
    if (!CONTEXTS.includes(cell.context)) {
      add('error', 'E_UNKNOWN_CONTEXT', `cell ${cell.id} names context "${cell.context}"`, 'tone', cell.line)
    }
    if (!STATES.includes(cell.state)) {
      add('error', 'E_UNKNOWN_STATE', `cell ${cell.id} names state "${cell.state}"`, 'tone', cell.line)
    }
    for (const [dial, value] of Object.entries(dials)) {
      if (!DIALS.includes(dial) || !Number.isInteger(value) || value < 0 || value > 4) {
        add('error', 'E_DIAL_RANGE', `cell ${cell.id} has ${dial} = ${value}; dials are integers 0-4`,
          'tone', cell.line)
      }
    }
    for (const dial of DIALS) {
      if (!(dial in dials)) {
        add('error', 'E_DIAL_MISSING', `cell ${cell.id} does not declare dial "${dial}"; all six dials are required`,
          'tone', cell.line)
      }
    }
    if (HUMOR_ZERO_STATES.includes(cell.state) && Number(dials.humor) > 0) {
      add('error', 'E_HUMOR_GATE',
        `cell ${cell.id} sets humor ${dials.humor}; state "${cell.state}" forces humor 0`,
        'tone', cell.line)
    }
  }

  const hasVectors = Object.keys(stateVectors).length > 0 || Object.keys(contextOffsets).length > 0
  if (hasVectors) {
    for (const [state, dials] of Object.entries(stateVectors)) {
      if (!STATES.includes(state)) add('error', 'E_UNKNOWN_STATE', `state vector "${state}" is not a known state`, 'tone', 0)
      for (const [dial, value] of Object.entries(dials)) {
        if (!Number.isInteger(value) || value < 0 || value > 4) {
          add('error', 'E_VECTOR_RANGE', `state vector ${state}.${dial} = ${value}; must be 0-4`, 'tone', 0)
        }
      }
    }
    for (const [context, dials] of Object.entries(contextOffsets)) {
      if (!CONTEXTS.includes(context)) add('error', 'E_UNKNOWN_CONTEXT', `context offset "${context}" is not a known context`, 'tone', 0)
      for (const [dial, value] of Object.entries(dials)) {
        if (!Number.isInteger(value) || value < -4 || value > 4) {
          add('error', 'E_VECTOR_RANGE', `context offset ${context}.${dial} = ${value}; must be -4 to 4`, 'tone', 0)
        }
      }
    }
    for (const state of STATES) {
      if (!stateVectors[state]) {
        add('warning', 'W_MISSING_VECTOR', `state "${state}" has no vector; interpolation falls back to neutral`, 'tone', 0)
      }
    }
    for (const context of CONTEXTS) {
      if (!contextOffsets[context]) {
        add('warning', 'W_MISSING_VECTOR', `context "${context}" has no offset; interpolation falls back to neutral`, 'tone', 0)
      }
    }
  }

  // --- source index integrity -------------------------------------------
  //
  // evidence/sources.json is not prose loadKb already parsed into rules,
  // evidence, or cells - it is the sourcing pipeline's own hash-keyed ledger,
  // read straight off disk here. That is why this whole section is gated on
  // kb.kbRoot: every hand-built kb object in this file's own test suite (and
  // any other caller that builds one without going through loadKb) has no
  // directory to read sources.json, the vendor manifest, or the extract
  // cache out of, and must not be mistaken for one that does. Skipping is
  // exactly what "validateKb never throws" already means for every other
  // half-built input - this is not a new exemption, just the fs-backed
  // instance of it.
  //
  // A missing evidence/sources.json is deliberately NOT its own finding
  // here (contrast E_NO_KB, which fires unconditionally when config.yml,
  // voice.md, and tone.md are ALL absent). loadIndex already degrades a
  // missing or corrupt file to an empty index, and an empty index is the
  // legitimate, ordinary state of a knowledge base that has never ingested
  // any brand material - nothing below has anything to resolve against, so
  // nothing fires. The moment the KB actually depends on the index (a rule
  // is `produced` by some entry, or a rule cites source-type evidence),
  // checks 1 and 2 below surface that dependency's specific, actionable
  // failure on their own; a blanket "no index found" finding would either
  // duplicate that or, far more often, false-positive on the common case of
  // a small hand-authored KB that was never meant to cite a source at all.
  if (kb.kbRoot) {
    const kbRoot = kb.kbRoot
    const index = loadIndex(kbRoot)
    const sources = index.sources ?? []
    // Relative to kbRoot, matching every other finding's `file`, e.g.
    // 'tone.md' or 'evidence/ledger.md' - never an absolute path.
    const indexFile = path.relative(kbRoot, indexPathFor(kbRoot))

    // A source's `produced` must be an array of rule ids. Absent (undefined)
    // or explicitly `null` is not corruption - a source that has not (yet)
    // produced any rule is completely ordinary, and `producedOf` below
    // already treats either as an empty list with no finding. Anything else - a
    // bare number, string, or object, all valid JSON in this committed,
    // hand-editable file - IS corruption, and gets its own finding rather
    // than being silently folded into "produced nothing": a source that
    // really did produce rules would then look like it produced none,
    // which is precisely the retraction failure check 1 exists to catch.
    // `producedOf` still degrades a malformed shape to `[]` everywhere
    // else below, so the checks that iterate `produced` stay throw-free
    // AND report exactly this one clear finding - never a cascade of wrong
    // ones (a bare string would otherwise iterate character-by-character
    // and report each character as a phantom dangling rule id).
    const producedOf = (source) => (Array.isArray(source.produced) ? source.produced : [])
    for (const source of sources) {
      if (source.produced !== undefined && source.produced !== null && !Array.isArray(source.produced)) {
        addFile('error', 'E_INVALID_PRODUCED',
          `source ${source.id} has a non-array produced (${typeof source.produced}); it is treated as empty ` +
          'here, which could hide rules it really did produce - fix the shape in evidence/sources.json',
          indexFile, 0)
      }
    }

    const producedRuleIds = new Set()
    for (const source of sources) {
      for (const producedId of producedOf(source)) producedRuleIds.add(producedId)
    }

    // Check 1: every id a source claims to have produced must be a rule
    // that actually exists. A dangling id is what leaves --forget unable to
    // name the right rules to reopen. This is an ERROR where the ledger's
    // own W_ORPHAN_EVIDENCE (same defect shape: a claimed-produced id that
    // does not exist) is only a WARNING, because the two files are not
    // equally trustworthy: the ledger is human-authored prose, where a
    // typo is the likely story, but sources.json is machine-written by the
    // ingest pipeline (sources.mjs), so a dangling id there is not a typo -
    // it is the index itself lying about what it produced.
    for (const source of sources) {
      for (const producedId of producedOf(source)) {
        if (!ruleIds.has(producedId)) {
          addFile('error', 'E_DANGLING_PRODUCED_ID',
            `source ${source.id} claims to have produced ${producedId}, which is not a rule in this knowledge base`,
            indexFile, 0)
        }
      }
    }

    // Check 2: every rule that cites evidence of type 'source' must be
    // named under some index entry's `produced`. Without this, a rule can
    // claim "source" evidence - meaning a real document was read - while
    // the pipeline that ingests and indexes real documents has no record of
    // it at all: a model-read style guide that left no trace.
    for (const rule of rules) {
      const citesSourceEvidence = (rule.evidence ?? []).some(
        (ref) => evidenceById.get(ref)?.type === 'source'
      )
      if (citesSourceEvidence && !producedRuleIds.has(rule.id)) {
        add('error', 'E_SOURCE_NOT_INDEXED',
          `rule ${rule.id} cites source-type evidence, but no entry in ${indexFile} lists ${rule.id} under produced`,
          rule.file, rule.line)
      }
    }

    // Check 3: identity is the hash, never the path (sourceindex.mjs) - two
    // entries sharing a sha256 breaks the guarantee that re-adding a known
    // file is a no-op, because it is no longer clear which entry that file
    // would even match against.
    const firstIdBySha = new Map()
    for (const source of sources) {
      if (!source.sha256) continue
      const first = firstIdBySha.get(source.sha256)
      if (first) {
        addFile('error', 'E_DUPLICATE_SHA',
          `sources ${first} and ${source.id} share sha256 ${source.sha256}; identity must be one entry per hash`,
          indexFile, 0)
      } else {
        firstIdBySha.set(source.sha256, source.id)
      }
    }

    // Check 4: STATS_REQUIRED (not simply "not skipped") is the same
    // whitelist statsByLocale enforces when it merges the fingerprint - a
    // status of 'new' should never reach the persisted index at all, so
    // tolerating it here would validate a state that should not exist
    // rather than the real defect. An entry statsByLocale expects to
    // contribute (used, missing, stale) but that carries no stats block is
    // not an empty source - it silently drops out of the fingerprint with
    // nothing saying why, and it is what makes statsByLocale itself throw.
    for (const source of sources) {
      if (STATS_REQUIRED.has(source.status) && !source.stats) {
        addFile('error', 'E_NO_STATS',
          `source ${source.id} has status "${source.status}" but no stats block, so it silently drops out of the fingerprint`,
          indexFile, 0)
      }
    }

    // Check 5: a source's locale must be one the active profile actually
    // speaks. statsFor bakes three locale-dependent decisions into the
    // stored stats block (the english sub-block, person markers, heading
    // title case), and the block carries no marker of its own distinguishing
    // "measured correctly" from "measured under the wrong locale" - once the
    // source is discarded there is no text left to recount. This is not a
    // contrived state: ingesting under the template's default primary_locale
    // (en) and THEN finishing /voice-and-tone:init with the real locale (say
    // cs) produces exactly this - a permanent English-shaped fossil sitting
    // under a Czech profile, with nothing else ever detecting it.
    //
    // Warning, not an error, for the same reason Check 6 (below) is a
    // warning: source text is deliberately never retained, so the only real
    // fix - re-ingest under the right locale - is only available if the
    // original document still exists somewhere. An error here could
    // permanently block `sync` with no way to satisfy it. A warning at least
    // surfaces the fossil instead of leaving it to silently poison a locale's
    // statistics forever.
    // Every declared profile, not just `default`. validate has no --profile
    // flag, but `sources.mjs --profile <name> --ingest` is supported, so an
    // entry may legitimately carry any locale ANY profile declares. Checking
    // `default` alone warned on every source ingested under a second profile
    // and then handed it a remedy - re-ingest - that reproduces the very same
    // entry, burning the one repair available.
    const declared = Object.values(kb.config.profiles ?? {})
    const profiles = declared.length ? declared : [activeProfile(kb.config)]
    const activeLocales = new Set()
    for (const p of profiles) {
      if (p.locales?.length) for (const loc of p.locales) activeLocales.add(loc)
      else activeLocales.add(p.primary_locale ?? 'en')
    }
    for (const source of sources) {
      if (source.locale === null || source.locale === undefined) continue
      if (activeLocales.has(source.locale)) continue
      addFile('warning', 'W_LOCALE_NOT_ACTIVE',
        `source ${source.id} has locale "${source.locale}", which no profile declares ` +
        `(declared: ${[...activeLocales].join(', ') || 'none'}); its statistics may have been measured under ` +
        'the wrong locale and cannot be recomputed since the source text is discarded - add the locale to a ' +
        'profile if it is genuine, or re-ingest under the right locale if the original document remains',
        indexFile, 0)
    }

    // Check 6: a vendored extractor library was bumped since a source was
    // last ingested through it. Nothing about the entry is broken - its
    // statistics are just now measured by a version the manifest no longer
    // pins, so they can drift under the baseline with nothing saying why
    // unless the source is re-ingested. That alone would already argue for
    // a warning, but there is a harder reason it cannot be an error: source
    // text is deliberately never retained (sourceindex.mjs's header comment
    // - identity is the hash, not a kept copy), so the original document
    // for a stale entry may simply be gone. An error here would then
    // permanently block every `sync` for that knowledge base, with no way
    // to satisfy it - re-ingesting is impossible and the entry cannot be
    // un-flagged. Warning is the only severity that does not risk that trap.
    const manifest = loadVendorManifest()
    for (const stale of staleByExtractor(index, manifest)) {
      const pinned = manifest.libraries?.[stale.extractor.name]?.version
      addFile('warning', 'W_STALE_EXTRACTOR',
        `source ${stale.id} was produced by ${stale.extractor.name}@${stale.extractor.version}, but vendor/manifest.json ` +
        `now pins ${pinned}; re-ingest to refresh its statistics`,
        indexFile, 0)
    }
  }

  return {
    findings,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    counts: {
      rules: rules.length,
      cells: cells.length,
      evidence: evidence.length,
      authoredCells: cells.length,
      possibleCells: CONTEXTS.length * STATES.length
    }
  }
}

function main (argv) {
  const { values } = parseCliArgs(argv)
  if (values.help) {
    printHelp('scripts/validate.mjs', [
      'Checks knowledge-base integrity. Exits 2 when any error is found.',
      '',
      '  --root <dir>   project root (default: cwd)',
      '  --kb <dir>     knowledge base dir',
      '  --json         print the report as JSON'
    ])
    return
  }

  const { kbRoot } = resolveRoots(values)
  const report = validateKb(loadKb(kbRoot))

  if (values.json) {
    writeOut(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    const lines = report.findings.map(
      (f) => `validate: ${f.severity.toUpperCase()} ${f.code} ${f.file}:${f.line} ${f.message}`
    )
    lines.push(
      `validate: ${report.counts.rules} rules, ${report.counts.cells} authored cells of ` +
      `${report.counts.possibleCells}, ${report.counts.evidence} evidence entries`
    )
    lines.push(`validate: ${report.errors} errors, ${report.warnings} warnings`)
    writeOut(`${lines.join('\n')}\n`)
  }

  if (report.errors > 0) process.exit(2)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main, cellId }
