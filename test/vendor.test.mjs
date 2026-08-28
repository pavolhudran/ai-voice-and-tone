import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readTextFile } from '../scripts/lib/fsx.mjs'
import { sha256File } from '../scripts/lib/hash.mjs'
import { makeMinimalDocx, makeMinimalOdt } from './helpers/officeFixtures.mjs'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
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

// officeparser's own PDF-conversion path (which our adapter never calls - see
// the reachability test below) launches puppeteer, which on darwin+x64 probes
// for Apple Silicon via a dynamic `import("child_process")`, and its OCR path
// dynamically imports tesseract.js. Neither puppeteer nor tesseract.js is
// vendored or installed, so those imports throw if that path is ever
// reached - but they are real bytes in the bundle, not something a "must not
// exist" assertion could ever truthfully claim. This pins the known,
// audited exposure by an exact count instead, over the WHOLE file (no
// slicing), so a version bump that adds a new one fails the build rather
// than passing silently.
const KNOWN_DYNAMIC_REFERENCES = {
  child_process: 1, // the Apple Silicon probe's `import("child_process")` + destructured execSync
  puppeteer: 3, // 1 dynamic import, plus 2 mentions inside its own "please install it" warning
  'tesseract.js': 1 // the OCR worker's dynamic `import("tesseract.js")`
}

test('vendored bundles carry exactly the known, audited child-process/puppeteer/OCR references', () => {
  const counts = Object.fromEntries(Object.keys(KNOWN_DYNAMIC_REFERENCES).map((k) => [k, 0]))
  for (const [, lib] of Object.entries(manifest().libraries)) {
    for (const rel of Object.keys(lib.files)) {
      if (!rel.endsWith('.cjs') && !rel.endsWith('.mjs')) continue
      const body = readFileSync(path.join(ROOT, 'vendor', rel), 'utf8') // whole file, never sliced
      for (const needle of Object.keys(KNOWN_DYNAMIC_REFERENCES)) {
        counts[needle] += body.split(needle).length - 1
      }
    }
  }
  assert.deepEqual(
    counts, KNOWN_DYNAMIC_REFERENCES,
    'a vendored bundle\'s child_process/puppeteer/tesseract.js references changed from the ' +
    'audited baseline - a version bump introduced (or removed) one; audit the new reference ' +
    'before updating KNOWN_DYNAMIC_REFERENCES'
  )
})

test('the vendored libraries load and extract from this repo, with no node_modules', () => {
  // A smoke test that the bundles are self-contained. If this fails, the
  // externals in scripts/vendor.mjs excluded something that was needed.
  assert.doesNotThrow(() => require(path.join(ROOT, 'vendor', 'officeparser', 'officeparser.cjs')))
})

test('the real extraction path never spawns a process', async () => {
  // Proof, not assertion: the known references above establish that a child
  // process *could* be reached from inside this bundle. This runs the actual
  // extraction path our adapter uses - officeparser.parseOffice(buf).toText()
  // - over real .docx and .odt fixtures with every child_process spawn
  // function replaced by one that throws, and requires that none of them are
  // ever called. It patches the object `require('child_process')` returns,
  // which is the same underlying module-registry object the bundle's own
  // `await import("child_process")` resolves to (verified: reassigning a
  // property on one is visible through the other) - so this is not a
  // separate, unrelated copy that the patch could miss.
  const spawned = []
  const cp = require('child_process')
  const original = {}
  for (const fn of ['execSync', 'spawnSync', 'execFileSync', 'exec', 'spawn', 'execFile']) {
    original[fn] = cp[fn]
    cp[fn] = (...args) => {
      spawned.push([fn, args[0]])
      throw new Error(`refused: ${fn}`)
    }
  }
  try {
    const op = require(path.join(ROOT, 'vendor', 'officeparser', 'officeparser.cjs'))
    for (const fixture of [makeMinimalDocx(), makeMinimalOdt()]) {
      const result = await op.parseOffice(fixture)
      assert.ok(result.toText().length > 0, 'fixture extracted no text')
    }
  } finally {
    for (const [fn, impl] of Object.entries(original)) cp[fn] = impl
  }
  assert.deepEqual(spawned, [], 'extraction reached for a child process')
})

test('vendor/README.md documents both vendored libraries and is not something the vendoring script removes', () => {
  const body = readTextFile(path.join(ROOT, 'vendor', 'README.md'))
  assert.ok(body.includes('pdfjs-dist'), 'vendor/README.md omits pdfjs-dist')
  assert.ok(body.includes('officeparser'), 'vendor/README.md omits officeparser')
})
