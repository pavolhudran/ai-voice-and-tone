import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '../scripts/lib/config.mjs'
import { buildFingerprint, main } from '../scripts/fingerprint.mjs'
import { runIngest } from '../scripts/sources.mjs'

const config = {
  ...DEFAULT_CONFIG,
  profiles: { default: { name: 'Acme', primary_locale: 'en', locales: ['en', 'cs'] } },
  scan: { include: ['content/**/*.md', 'locales/**/*.json'], exclude: ['node_modules/**'] }
}

const opts = { generated: '2026-08-26T00:00:00.000Z', source: 'measured', profileName: 'default' }

test('fingerprints are computed per locale and never merged', () => {
  const dir = makeTmpProject({
    'content/a.md': '# Schedule a campaign\n\nYour campaign is scheduled. Nice work!\n',
    'locales/cs/common.json': JSON.stringify({ save: 'Ulozit', hint: 'Vase kampan je naplanovana.' })
  })
  try {
    const fp = buildFingerprint(dir, config, opts)
    assert.deepEqual(Object.keys(fp.byLocale).sort(), ['cs', 'en'])
    assert.equal(fp.source, 'measured')
    assert.ok(fp.byLocale.en.english !== null, 'english metrics present for en')
    assert.equal(fp.byLocale.cs.english, null, 'english metrics are N/A for cs')
    assert.equal(fp.byLocale.en.universal.headingTitleCaseRatio !== undefined, true)
    assert.equal(fp.baseline, null)
  } finally {
    cleanup(dir)
  }
})

test('an estimated fingerprint records the degraded source', () => {
  const dir = makeTmpProject({ 'content/a.md': 'Copy here.' })
  try {
    assert.equal(buildFingerprint(dir, config, { ...opts, source: 'estimated' }).source, 'estimated')
  } finally {
    cleanup(dir)
  }
})

test('a project with no copy produces an empty but valid fingerprint', () => {
  const dir = makeTmpProject({})
  try {
    const fp = buildFingerprint(dir, config, opts)
    assert.deepEqual(fp.byLocale, {})
    assert.equal(fp.generated, '2026-08-26T00:00:00.000Z')
  } finally {
    cleanup(dir)
  }
})

// --- CLI baseline-preservation paths (not covered by the brief's own tests) ---

function runCli (dir, kbDir, args) {
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = () => true
  try {
    main(['--root', dir, '--kb', kbDir, ...args])
  } finally {
    process.stdout.write = originalWrite
  }
}

function readFingerprint (kbDir) {
  return JSON.parse(readFileSync(path.join(kbDir, 'evidence', 'fingerprint.json'), 'utf8'))
}

test('baseline is null on first run and stays null across an ordinary re-run', () => {
  const dir = makeTmpProject({ 'content/a.md': 'Copy here. More copy.' })
  const kbDir = path.join(dir, '.voice-and-tone')
  try {
    runCli(dir, kbDir, ['--now', '2026-08-26T00:00:00.000Z'])
    let fp = readFingerprint(kbDir)
    assert.equal(fp.baseline, null, 'no baseline on first run')

    runCli(dir, kbDir, ['--now', '2026-08-26T01:00:00.000Z'])
    fp = readFingerprint(kbDir)
    assert.equal(fp.baseline, null, 'an ordinary re-run does not invent a baseline')
  } finally {
    cleanup(dir)
  }
})

test('--set-baseline freezes numbers, and an ordinary re-run afterwards preserves them', () => {
  const dir = makeTmpProject({ 'content/a.md': 'Copy here. More copy.' })
  const kbDir = path.join(dir, '.voice-and-tone')
  try {
    runCli(dir, kbDir, ['--now', '2026-08-26T00:00:00.000Z', '--set-baseline'])
    let fp = readFingerprint(kbDir)
    assert.equal(fp.baseline.generated, '2026-08-26T00:00:00.000Z')
    assert.deepEqual(fp.baseline.byLocale, fp.byLocale, 'baseline snapshot matches the numbers at freeze time')
    const frozen = fp.baseline

    // Change the corpus so a later run computes different numbers, then
    // re-run without --set-baseline: the frozen baseline must not move.
    writeFileSync(
      path.join(dir, 'content', 'a.md'),
      'Totally different, much longer copy goes here. And more copy still.',
      'utf8'
    )
    runCli(dir, kbDir, ['--now', '2026-08-26T02:00:00.000Z'])
    fp = readFingerprint(kbDir)
    assert.deepEqual(fp.baseline, frozen, 'baseline survives an ordinary re-run untouched')
    assert.notDeepEqual(fp.byLocale, frozen.byLocale, 'sanity check: the live numbers actually changed')
  } finally {
    cleanup(dir)
  }
})

test('a corrupt existing fingerprint file is replaced, not repaired, and does not crash', () => {
  const dir = makeTmpProject({ 'content/a.md': 'Copy here.' })
  const kbDir = path.join(dir, '.voice-and-tone')
  const outPath = path.join(kbDir, 'evidence', 'fingerprint.json')
  try {
    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(outPath, '{ not valid json', 'utf8')
    runCli(dir, kbDir, ['--now', '2026-08-26T00:00:00.000Z'])
    const fp = readFingerprint(kbDir)
    assert.equal(fp.baseline, null, 'a corrupt previous file yields no baseline rather than throwing')
    assert.equal(fp.generated, '2026-08-26T00:00:00.000Z')
  } finally {
    cleanup(dir)
  }
})

test('--source rejects an invalid value instead of writing a bogus fingerprint', () => {
  const dir = makeTmpProject({ 'content/a.md': 'Copy here.' })
  const kbDir = path.join(dir, '.voice-and-tone')
  const outPath = path.join(kbDir, 'evidence', 'fingerprint.json')
  const originalExit = process.exit
  const originalErrorWrite = process.stderr.write.bind(process.stderr)
  let exitCode = null
  let stderrOutput = ''
  process.exit = (code) => { exitCode = code; throw new Error('__exit__') }
  process.stderr.write = (chunk) => { stderrOutput += chunk; return true }
  try {
    assert.throws(() => main(['--root', dir, '--kb', kbDir, '--source', 'guessed']), /__exit__/)
    assert.equal(exitCode, 1)
    assert.ok(stderrOutput.startsWith('error: '), 'ASCII, standard die() prefix')
    assert.ok(/^[\x00-\x7F]*$/.test(stderrOutput), 'stderr stays ASCII')
    assert.equal(existsSync(outPath), false, 'a rejected --source must not leave a fingerprint behind')
  } finally {
    process.exit = originalExit
    process.stderr.write = originalErrorWrite
    cleanup(dir)
  }
})

// --- Task 12: registered sources fold into the fingerprint via the index ---

test('index statistics are folded into the fingerprint alongside live project files', async () => {
  const dir = makeTmpProject({ 'content/a.md': 'We write plainly. We keep it short.\n' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    // A source that is NOT present locally, but whose statistics are recorded.
    const { statsFor } = await import('../scripts/lib/metrics.mjs')
    const { saveIndex } = await import('../scripts/lib/sourceindex.mjs')
    saveIndex(kb, {
      sources: [{
        id: 'f001', sha256: 'a'.repeat(64), kind: 'file', from: 's02',
        origin: 'sources/gone.pdf', format: 'pdf', locale: 'en',
        tier: 'script', fidelity: 'measured', quality: { passed: true },
        stats: statsFor({ strings: ['A missing document still counts.'], headings: [], locale: 'en' }),
        status: 'missing', produced: []
      }]
    }, '2026-08-27T00:00:00.000Z')

    const fp = buildFingerprint(dir, config, { ...opts, kbRoot: kb })
    assert.ok(
      fp.byLocale.en.universal.wordCount > 7,
      'the absent source contributed its words'
    )
  } finally {
    cleanup(dir)
  }
})

test('a locale whose only sources are estimated reports an estimated fingerprint', async () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const { statsFor } = await import('../scripts/lib/metrics.mjs')
    const { saveIndex } = await import('../scripts/lib/sourceindex.mjs')
    saveIndex(kb, {
      sources: [{
        id: 'f001', sha256: 'b'.repeat(64), kind: 'file', from: 's02',
        origin: 'sources/scan.pdf', format: 'pdf', locale: 'en',
        tier: 'model', fidelity: 'estimated', quality: { passed: true },
        stats: statsFor({ strings: ['Transcribed by the model.'], headings: [], locale: 'en' }),
        status: 'used', produced: []
      }]
    }, '2026-08-27T00:00:00.000Z')

    const fp = buildFingerprint(dir, config, { ...opts, kbRoot: kb })
    assert.equal(
      fp.byLocale.en.fidelity, 'estimated',
      'parent spec 5.4: this locale may only ever produce assumed rules'
    )
  } finally {
    cleanup(dir)
  }
})

// --- Task 12 fix round 1: an ingested project stops double-counting its own text ---

/** Same builder as test/sources.test.mjs's - see its comment for why uncompressed. */
function textPdf (text) {
  const content = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  body += `startxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

test('running --ingest on a default config does not double the fingerprint of a project text file', async () => {
  const dir = makeTmpProject({ 'content/a.md': 'We write plainly. We keep it short.\n' })
  const kb = path.join(dir, '.voice-and-tone')
  const cfg = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*'], exclude: [] } } // sources: [] (the default)
  saveConfig(kb, cfg)
  try {
    const before = buildFingerprint(dir, loadConfig(kb), { ...opts, kbRoot: kb })
    const wordsBefore = before.byLocale.en.universal.wordCount
    assert.ok(wordsBefore > 0)

    const ctx = { projectRoot: dir, kbRoot: kb, config: loadConfig(kb), profileName: 'default', now: '2026-08-27T00:00:00.000Z' }
    await runIngest(ctx, {})

    const after = buildFingerprint(dir, loadConfig(kb), { ...opts, kbRoot: kb })
    assert.equal(
      after.byLocale.en.universal.wordCount, wordsBefore,
      'ingest must not add the project text file to the index; the live count must be unchanged, not doubled'
    )
  } finally {
    cleanup(dir)
  }
})

test('a project-folder container file, once ingested, contributes its words on top of the live text', async () => {
  const dir = makeTmpProject({ 'content/a.md': 'We write plainly. We keep it short.\n' })
  const kb = path.join(dir, '.voice-and-tone')
  const cfg = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*'], exclude: [] } }
  saveConfig(kb, cfg)
  writeFileSync(path.join(dir, 'content', 'brand.pdf'), textPdf('A missing document still counts for something new.'))
  try {
    const before = buildFingerprint(dir, loadConfig(kb), { ...opts, kbRoot: kb })
    const wordsBefore = before.byLocale.en.universal.wordCount

    const ctx = { projectRoot: dir, kbRoot: kb, config: loadConfig(kb), profileName: 'default', now: '2026-08-27T00:00:00.000Z' }
    await runIngest(ctx, {})

    const after = buildFingerprint(dir, loadConfig(kb), { ...opts, kbRoot: kb })
    assert.ok(
      after.byLocale.en.universal.wordCount > wordsBefore,
      'the ingested PDF must still contribute - this fix must not silently lose project-folder containers'
    )
  } finally {
    cleanup(dir)
  }
})

// --- F2: an empty fingerprint whose register resolves unindexed files must
// name /voice-and-tone:connect --ingest, not the dead scan.include key.

test('an empty corpus with no registered material still names scan.include', () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  const cfg = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*.md'], exclude: [] } }
  saveConfig(kb, cfg)
  let captured = ''
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => { captured += chunk; return true }
  try {
    main(['--root', dir, '--kb', kb, '--now', '2026-08-27T00:00:00.000Z'])
  } finally {
    process.stdout.write = originalWrite
  }
  try {
    assert.match(captured, /fingerprint: no copy found; check scan\.include/)
  } finally {
    cleanup(dir)
  }
})

test('an empty corpus with registered-but-unindexed material names /voice-and-tone:connect --ingest', () => {
  const dir = makeTmpProject({ '.voice-and-tone/sources/newsletter.txt': 'We keep it plain.\n' })
  const kb = path.join(dir, '.voice-and-tone')
  const cfg = { ...DEFAULT_CONFIG, sources: [{ id: 's02', kind: 'inbox', path: 'sources/' }] }
  saveConfig(kb, cfg)
  let captured = ''
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => { captured += chunk; return true }
  try {
    main(['--root', dir, '--kb', kb, '--now', '2026-08-27T00:00:00.000Z'])
  } finally {
    process.stdout.write = originalWrite
  }
  try {
    assert.match(captured, /fingerprint: no copy found; 1 registered file\(s\) are not yet ingested - run \/voice-and-tone:connect --ingest/)
    assert.ok(!captured.includes('scan.include'), 'must not blame a key gatherAll never reads')
  } finally {
    cleanup(dir)
  }
})

test('--profile <speaker> writes the fingerprint and its baseline under the overlay, leaving the house untouched', () => {
  const dir = makeTmpProject({
    'content/a.md': '# A\n\nHouse copy.\n',
    '.voice-and-tone/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: en',
      '    locales: [en]',
      '  maya:',
      '    name: "Maya Lind"',
      'sources:',
      '  - id: s01',
      '    kind: project',
      '    include: ["content/**/*.md"]',
      '    exclude: []',
      ''
    ].join('\n'),
    '.voice-and-tone/profiles/maya/voice.md': '# Voice\n'
  })
  try {
    const overlay = path.join(dir, '.voice-and-tone', 'profiles', 'maya', 'evidence', 'fingerprint.json')
    main(['--root', dir, '--profile', 'maya', '--set-baseline', '--now', '2026-09-10T00:00:00.000Z'])
    assert.ok(existsSync(overlay))
    assert.ok(!existsSync(path.join(dir, '.voice-and-tone', 'evidence', 'fingerprint.json')))
    const first = JSON.parse(readFileSync(overlay, 'utf8'))
    assert.ok(first.baseline, 'the speaker has its own baseline')
    main(['--root', dir, '--profile', 'maya', '--now', '2026-09-11T00:00:00.000Z'])
    const second = JSON.parse(readFileSync(overlay, 'utf8'))
    assert.equal(second.baseline.generated, first.baseline.generated, 'a plain run preserves the speaker baseline')
    assert.ok(!existsSync(path.join(dir, '.voice-and-tone', 'evidence', 'fingerprint.json')), 'still nothing written to the house')
  } finally {
    cleanup(dir)
  }
})
