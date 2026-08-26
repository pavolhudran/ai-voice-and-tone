import { pathToFileURL } from 'node:url'
import {
  loadKb, STATES, CONTEXTS, DIALS, CONFIDENCE_LEVELS, EVIDENCE_TYPES, ID_PREFIXES,
  HUMOR_ZERO_STATES, cellId
} from './lib/kb.mjs'
import { parseCliArgs, resolveRoots, die, printHelp, writeOut } from './lib/cli.mjs'

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
