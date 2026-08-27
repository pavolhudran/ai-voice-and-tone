import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('plugin manifest declares the voice-and-tone plugin', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')
  )
  assert.equal(manifest.name, 'voice-and-tone')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.ok(manifest.description.length > 20)
})

test('package.json pins the runtime floor and stays free of runtime dependencies', () => {
  // Section 9 bans a runtime dependency, not a build-time one: esbuild only
  // ever runs on a maintainer's machine, inside scripts/vendor.mjs, to
  // produce the bytes committed under vendor/. Nothing here installs on a
  // user's machine.
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dependencies, undefined)
  assert.deepEqual(pkg.devDependencies, { esbuild: '^0.24.0' })
  assert.match(pkg.engines.node, /18/)
})

test('licensing and attribution ship at the repo root', () => {
  for (const file of ['LICENSE', 'ATTRIBUTION.md']) {
    assert.ok(existsSync(path.join(root, file)), `${file} is missing`)
  }
  const license = readFileSync(path.join(root, 'LICENSE'), 'utf8')
  assert.match(license, /MIT/)
  assert.match(license, /CC BY-NC 4\.0/)
  assert.match(license, /scripts\//)

  const attribution = readFileSync(path.join(root, 'ATTRIBUTION.md'), 'utf8')
  assert.match(attribution, /not affiliated with or endorsed by Mailchimp/i)
})
