import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { rmSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { loadConfig, saveConfig, DEFAULT_CONFIG } from '../scripts/lib/config.mjs'
import { buildManifest } from '../scripts/scan.mjs'
import { buildFingerprint } from '../scripts/fingerprint.mjs'
import { runIngest } from '../scripts/sources.mjs'
import { loadIndex } from '../scripts/lib/sourceindex.mjs'

const NOW = '2026-08-27T00:00:00.000Z'

test('a config predating the register produces an identical manifest and fingerprint', () => {
  const files = {
    'content/a.md': '# Schedule a campaign\n\nYour campaign is scheduled. Nice work!\n',
    'docs/b.md': 'We write plainly, and we keep it short.\n',
    'locales/cs/common.json': JSON.stringify({ hint: 'Vase kampan je naplanovana.' }),
    // Exercises the manifest's other two channels so comparing them below
    // proves something: an extension nothing handles populates `skipped`,
    // and a JSON file that fails to parse populates `unreadable`. Without
    // these, both channels would sit at {count: 0} on every run and any
    // assertion about them - however honestly worded - would be trivially
    // true, exactly the vacuous-comparison trap this file already fell into
    // once (see the disposability test below).
    'content/brand.fig': 'the bytes do not matter here - only the extension does',
    'locales/en/broken.json': '{ this is not valid json'
  }
  const legacy = makeTmpProject(files)
  const modern = makeTmpProject(files)
  try {
    const config = {
      ...DEFAULT_CONFIG,
      profiles: { default: { name: 'Acme', primary_locale: 'en', locales: ['en', 'cs'] } },
      scan: {
        include: ['content/**/*.md', 'content/**/*.fig', 'docs/**/*.md', 'locales/**/*.json'],
        exclude: []
      }
    }
    // No sources key at all - the shape every existing KB has on disk today.
    const { sources, ...withoutRegister } = config

    const before = buildManifest(legacy, withoutRegister, NOW)
    const after = buildManifest(modern, {
      ...withoutRegister,
      sources: [{ id: 's01', kind: 'project', include: config.scan.include, exclude: [] }]
    }, NOW)

    // Non-vacuity FIRST: every channel this test is about to claim is
    // "bit-identical" must actually carry something on this run, or the
    // comparison below would pass no matter what buildManifest did.
    assert.ok(before.files.length > 0, 'fixture produced no files - the comparison below would be vacuous')
    assert.ok(before.skipped.count > 0, 'fixture exercised no `skipped` entry - comparing it below would be vacuous')
    assert.ok(before.unreadable.count > 0, 'fixture exercised no `unreadable` entry - comparing it below would be vacuous')
    // The mask this assertion used to apply here (`source: null` on every
    // file before comparing) hid a real question: does the synthesised
    // fallback register stamp the same source id as an explicit one? Answer
    // it directly instead of hiding it, so a future divergence is caught,
    // not laundered away.
    assert.ok(
      before.files.length > 0 && before.files.every((f) => f.source === 's01'),
      'the synthesised fallback register must stamp s01, same as the migration path assumes'
    )
    assert.ok(
      after.files.length > 0 && after.files.every((f) => f.source === 's01'),
      'the explicit register must stamp the same source id as the synthesised one'
    )

    // Compare the WHOLE manifest, not a hand-picked subset of it - `unreadable`
    // and `skipped` are as much a part of "bit-identical" as `files`/`totals`
    // are, and `totals` itself is a pure sum over `files` so asserting it
    // separately added nothing once the two `files` arrays are compared.
    // `projectRoot` is the one field normalised out below: it is each
    // fixture's own absolute mkdtemp path, which legitimately differs
    // between `legacy` and `modern` and carries no migration-parity
    // information of its own.
    assert.deepEqual(
      { ...before, projectRoot: null },
      { ...after, projectRoot: null },
      'migrating the globs into a register changes nothing'
    )

    const beforeFp = buildFingerprint(legacy, withoutRegister, { generated: NOW }).byLocale
    const afterFp = buildFingerprint(modern, { ...withoutRegister }, { generated: NOW }).byLocale
    assert.ok(beforeFp.en && beforeFp.en.sample.words > 0, 'fingerprint fixture produced no en words - comparison would be vacuous')
    assert.ok(beforeFp.cs && beforeFp.cs.sample.words > 0, 'fingerprint fixture produced no cs words - comparison would be vacuous')
    assert.deepEqual(beforeFp, afterFp)
  } finally {
    cleanup(legacy)
    cleanup(modern)
  }
})

// --- the end-to-end proof of the design's central claim -------------------

test('a knowledge base reproduces its baseline after every source is deleted', async () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(path.join(kb, 'sources'), { recursive: true })
    writeFileSync(path.join(kb, 'sources', 'newsletter.txt'),
      'We keep it plain. We keep it short. And we mean every word of it.\n')
    writeFileSync(path.join(kb, 'sources', 'blog.txt'),
      'That file did not upload. It is over the limit. Try a smaller one.\n')

    saveConfig(kb, {
      ...DEFAULT_CONFIG,
      sources: [{ id: 's02', kind: 'inbox', path: 'sources/' }]
    })

    const ctx = { projectRoot: dir, kbRoot: kb, config: loadConfig(kb), profileName: 'default', now: NOW }
    await runIngest(ctx, {})

    const withSources = buildFingerprint(dir, loadConfig(kb), { generated: NOW, kbRoot: kb })
    assert.equal(loadIndex(kb).sources.length, 2)

    // Non-vacuity FIRST: the baseline this test is about to declare
    // reproducible must actually contain a measured locale and a positive
    // word count. Without this, a regression that silently empties the
    // fingerprint for every `used` source (e.g. dropping 'used' from
    // STATS_REQUIRED) collapses both sides of the comparison below to `{}`,
    // and `assert.deepEqual({}, {})` would pass - proving nothing about the
    // one claim this test exists to make.
    assert.ok(withSources.byLocale.en, 'baseline must contain the en locale - an empty baseline is not a baseline')
    assert.ok(
      withSources.byLocale.en.sample.words > 0,
      'baseline must have a positive word count, or "reproduces the baseline" and "reproduces an empty result" are indistinguishable'
    )

    // Simulate a colleague's fresh clone: the index is committed, sources are not.
    rmSync(path.join(kb, 'sources'), { recursive: true, force: true })
    rmSync(path.join(kb, '.cache'), { recursive: true, force: true })

    const withoutSources = buildFingerprint(dir, loadConfig(kb), { generated: NOW, kbRoot: kb })

    assert.deepEqual(
      withoutSources.byLocale, withSources.byLocale,
      'THE CLAIM: with no source text on disk, the fingerprint is unchanged. ' +
      'If this fails, :audit will report fictitious brand drift on every clone.'
    )
  } finally {
    cleanup(dir)
  }
})
