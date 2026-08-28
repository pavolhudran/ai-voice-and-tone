import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { sha256Buffer, sha256Text, sha256File } from '../scripts/lib/hash.mjs'

// Known-answer tests. sha256("") and sha256("abc") are published constants;
// hard-coding them catches an encoding mistake that a round-trip test cannot.
test('sha256 matches published known answers', () => {
  assert.equal(
    sha256Text(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  )
  assert.equal(
    sha256Text('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
})

test('hashes are lowercase hex and stable across the three entry points', () => {
  const dir = makeTmpProject({})
  try {
    const abs = path.join(dir, 'a.bin')
    const bytes = Buffer.from('brand voice', 'utf8')
    writeFileSync(abs, bytes)

    const fromFile = sha256File(abs)
    assert.equal(fromFile, sha256Buffer(bytes))
    assert.equal(fromFile, sha256Text('brand voice'))
    assert.match(fromFile, /^[0-9a-f]{64}$/)
  } finally {
    cleanup(dir)
  }
})

test('identical bytes at different paths hash identically', () => {
  const dir = makeTmpProject({ 'one/x.txt': 'same', 'two/y.txt': 'same' })
  try {
    assert.equal(
      sha256File(path.join(dir, 'one', 'x.txt')),
      sha256File(path.join(dir, 'two', 'y.txt')),
      'identity is content, not path - this is what makes the index portable'
    )
  } finally {
    cleanup(dir)
  }
})
