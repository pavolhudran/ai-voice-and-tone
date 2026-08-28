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
    'locales/cs/common.json': JSON.stringify({ hint: 'Vase kampan je naplanovana.' })
  }
  const legacy = makeTmpProject(files)
  const modern = makeTmpProject(files)
  try {
    const config = {
      ...DEFAULT_CONFIG,
      profiles: { default: { name: 'Acme', primary_locale: 'en', locales: ['en', 'cs'] } },
      scan: { include: ['content/**/*.md', 'docs/**/*.md', 'locales/**/*.json'], exclude: [] }
    }
    // No sources key at all - the shape every existing KB has on disk today.
    const { sources, ...withoutRegister } = config

    const before = buildManifest(legacy, withoutRegister, NOW)
    const after = buildManifest(modern, {
      ...withoutRegister,
      sources: [{ id: 's01', kind: 'project', include: config.scan.include, exclude: [] }]
    }, NOW)

    assert.deepEqual(
      before.files.map((f) => ({ ...f, source: null })),
      after.files.map((f) => ({ ...f, source: null })),
      'migrating the globs into a register changes nothing'
    )
    assert.deepEqual(before.totals, after.totals)
    assert.deepEqual(
      buildFingerprint(legacy, withoutRegister, { generated: NOW }).byLocale,
      buildFingerprint(modern, { ...withoutRegister }, { generated: NOW }).byLocale
    )
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
