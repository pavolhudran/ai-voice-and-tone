import path from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { writeTextFile } from './fsx.mjs'
import { extractStrings, extractHeadings, isBinaryFormat } from './extract.mjs'
import { extractOffice, OFFICE_FORMATS, OFFICE_EXTRACTOR } from './office.mjs'
import { extractPdf, PDF_EXTRACTOR } from './pdf.mjs'
import { scoreExtraction } from './quality.mjs'
import { statsFor } from './metrics.mjs'
import { sha256Buffer } from './hash.mjs'

/**
 * The ingest ladder: extract, score, cache, count.
 *
 * The tier boundary is the quality gate, not the file format. A script parser
 * attempts every source; only a genuine failure is marked for the model.
 *
 * Escalation itself is NOT performed here. This layer reports that a source
 * needs the model, and the voice-discovery skill acts on it. Keeping the
 * decision in code and the model call outside it is what makes the ladder
 * testable, and it keeps a token-spending step from hiding inside it.
 */

export function cachePathFor (kbRoot, sha) {
  return path.join(kbRoot, '.cache', 'extracts', `${sha}.txt`)
}

/**
 * Both extractOffice and extractPdf are promise-based (their vendored
 * bundles are), so this router is async - and ingestFile with it.
 *
 * Deferred decision from office.mjs (Task 4, ruling R15): officeparser's
 * `warnings` channel is discarded inside extractOffice and never reaches
 * here. That stays as-is. The only warning ever observed in practice is
 * FILE_TYPE_DETECTION_FAILED - a MODULE_NOT_FOUND inside the bundle's own
 * (unused) file-type auto-detection, firing identically on every document
 * regardless of whether that document's text came out clean. Surfacing it
 * in the per-source quality verdict would not distinguish a good extraction
 * from a bad one; it would just print the same line under every entry and
 * teach people to stop reading it - the opposite of what a quality signal
 * is for. The quality gate already scores the extracted TEXT independently
 * of the parser's own opinion of itself, which is the actual defense against
 * a partially-parsed document contributing silently. Carrying the warning
 * forward would mean widening office.mjs's return shape for a signal that,
 * today, carries no information; revisit only once a warning is observed
 * that varies by document.
 */
export async function extractSource ({ abs, format, buf }) {
  if (format === 'pdf') return { ...(await extractPdf(buf)), extractor: PDF_EXTRACTOR }

  if (OFFICE_FORMATS.has(format)) {
    const { strings, headings, note } = await extractOffice(buf, format)
    return { strings, headings, glyphRecall: null, note, extractor: OFFICE_EXTRACTOR }
  }

  if (isBinaryFormat(format)) {
    throw new Error(`no extractor for container format ${format}`)
  }

  // Text formats: decoded and read here, with no third-party library
  // involved - so no extractor stamp, and nothing to go stale on a bump.
  const text = buf.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  return {
    strings: extractStrings(abs, text).strings,
    headings: extractHeadings(abs, text),
    glyphRecall: null,
    note: 'ok'
  }
}

function entryFrom ({
  sha256, origin, kind, from, id, format, bytes, locale, label, now, tier,
  extractor = null, strings, headings, glyphRecall, note, kbRoot, reasons = []
}) {
  const text = strings.join('\n')
  // Shape-complete either way: scoreExtraction('') already returns every
  // field it ever returns (tokens, meanTokenLen, singleShare,
  // longTokenShare, replShare, novowelShare, glyphRecall - zeroed or null,
  // never absent), so a downstream reader can access e.g.
  // quality.longTokenShare with no guard regardless of which branch
  // produced this entry. Only `reasons` is replaced, with the extractor's
  // own note (no-text-layer, encrypted, unreadable, ...) rather than
  // scoreExtraction's generic "no tokens recovered" - strictly more
  // informative about WHY nothing came out.
  const quality = strings.length === 0
    ? { ...scoreExtraction('', { locale, glyphRecall }), reasons: [...reasons, `empty: ${note}`] }
    : scoreExtraction(text, { locale, glyphRecall })

  if (quality.passed) writeTextFile(cachePathFor(kbRoot, sha256), `${text}\n`)

  return {
    id,
    sha256,
    kind,
    from,
    origin,
    label: label ?? null,
    format,
    bytes,
    locale,
    tier,
    // Which vendored library produced this text, and at what version. A
    // version bump changes extracted text subtly; recording it is what lets
    // validate.mjs mark affected sources stale rather than let their numbers
    // shift underneath a baseline with no explanation available. `null` for
    // a copy format (text, markdown, ...) or a model-tier transcription:
    // neither goes through a vendored library, so neither has a version
    // that could move out from under it.
    extractor,
    // Parent spec 5.4: a model transcription is never precise enough to
    // support a `derived` rule, whatever the gate says about its shape.
    fidelity: tier === 'model' ? 'estimated' : 'measured',
    quality,
    stats: quality.passed ? statsFor({ strings, headings, locale }) : null,
    added: now.slice(0, 10),
    analysed: now.slice(0, 10),
    status: quality.passed ? 'used' : 'skipped',
    produced: []
  }
}

export async function ingestFile (file, { kbRoot, now, id, from }) {
  const buf = readFileSync(file.abs)
  const sha256 = sha256Buffer(buf)
  const common = {
    sha256,
    origin: file.origin,
    kind: 'file',
    from,
    id,
    format: file.format,
    bytes: statSync(file.abs).size,
    locale: file.locale ?? 'en',
    label: file.label,
    now,
    tier: 'script',
    kbRoot
  }

  let extracted
  try {
    extracted = await extractSource({ abs: file.abs, format: file.format, buf })
  } catch (error) {
    // An unreadable container is a fact to record, not a crash: one bad file
    // must not abort the ingest of the other seventy.
    return entryFrom({
      ...common, strings: [], headings: [], glyphRecall: null,
      note: 'unreadable', reasons: [`unreadable: ${error.message}`]
    })
  }
  return entryFrom({ ...common, ...extracted })
}

/** The write-back path for the model tier, and for fetched URLs. */
export function ingestText (source, { kbRoot, now, id, from, tier = 'model' }) {
  return entryFrom({
    sha256: source.sha256,
    origin: source.origin,
    kind: source.kind ?? 'file',
    from,
    id,
    format: source.format,
    bytes: source.bytes ?? 0,
    locale: source.locale ?? 'en',
    label: source.label,
    now,
    tier,
    strings: source.strings ?? [],
    headings: source.headings ?? [],
    glyphRecall: null,
    note: 'ok',
    kbRoot
  })
}

/**
 * True when the script tier failed on something the model might still read:
 * a scanned page, an image, a JS-rendered shell. An entry that failed because
 * it is genuinely empty, or because the container itself was unreadable
 * (corrupt bytes, not merely absent of text), is not worth spending tokens
 * on - the model cannot repair bytes any better than the script tier could.
 */
export function needsModelTier (entry) {
  if (entry.tier === 'model') return false
  if (entry.status !== 'skipped') return false
  return !entry.quality.reasons.some((reason) => reason.startsWith('unreadable:'))
}
