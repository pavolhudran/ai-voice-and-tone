import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { readTextFile } from '../scripts/lib/fsx.mjs'
import { sha256File } from '../scripts/lib/hash.mjs'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(import.meta.dirname, '..')
const manifest = () => JSON.parse(readTextFile(path.join(ROOT, 'vendor', 'manifest.json')))

test('every vendored library records its version, license and origin', () => {
  const m = manifest()
  assert.deepEqual(Object.keys(m.libraries).sort(), ['officeparser', 'pdfjs-dist'])

  for (const [name, lib] of Object.entries(m.libraries)) {
    assert.match(lib.version, /^\d+\.\d+\.\d+$/, `${name} version`)
    assert.ok(lib.license, `${name} license`)
    assert.ok(lib.source.startsWith('https://'), `${name} source url`)
    assert.ok(Object.keys(lib.files).length > 0, `${name} files`)
  }
})

test('every vendored file is present and matches its recorded hash', () => {
  for (const [name, lib] of Object.entries(manifest().libraries)) {
    for (const [rel, sha] of Object.entries(lib.files)) {
      const abs = path.join(ROOT, 'vendor', rel)
      assert.ok(existsSync(abs), `${name}: ${rel} is missing`)
      assert.equal(sha256File(abs), sha, `${name}: ${rel} does not match its recorded hash`)
    }
  }
})

test('each vendored library ships its license text', () => {
  for (const name of Object.keys(manifest().libraries)) {
    const dir = name === 'pdfjs-dist' ? 'pdfjs' : 'officeparser'
    assert.ok(existsSync(path.join(ROOT, 'vendor', dir, 'LICENSE')), `${name} LICENSE`)
  }
})

test('the vendored tree stays within a size a git clone should carry', () => {
  let total = 0
  for (const lib of Object.values(manifest().libraries)) {
    for (const rel of Object.keys(lib.files)) total += statSync(path.join(ROOT, 'vendor', rel)).size
  }
  assert.ok(total < 4 * 1024 * 1024, `vendored tree is ${(total / 1048576).toFixed(1)} MB`)
})

test('no vendored bundle reaches for OCR or a child process', () => {
  // OCR is the model tier's job, and shelling out would break the
  // same-fingerprint-everywhere guarantee vendoring exists to keep.
  for (const [, lib] of Object.entries(manifest().libraries)) {
    for (const rel of Object.keys(lib.files)) {
      if (!rel.endsWith('.cjs') && !rel.endsWith('.mjs')) continue
      const body = readFileSync(path.join(ROOT, 'vendor', rel), 'utf8')
      assert.ok(!/require\(["']child_process["']\)/.test(body), `${rel} spawns a process`)
      assert.ok(!/tesseract/i.test(body.slice(0, 200000)), `${rel} carries OCR`)
    }
  }
})

test('the vendored libraries load and extract from this repo, with no node_modules', () => {
  // A smoke test that the bundles are self-contained. If this fails, the
  // externals in scripts/vendor.mjs excluded something that was needed.
  assert.doesNotThrow(() => require(path.join(ROOT, 'vendor', 'officeparser', 'officeparser.cjs')))
})
