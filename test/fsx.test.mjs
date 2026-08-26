import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { walk, readTextFile, writeTextFile, toPosix } from '../scripts/lib/fsx.mjs'

test('walk includes matches, prunes excluded directories, and sorts', () => {
  const dir = makeTmpProject({
    'content/b.md': 'b',
    'content/a.md': 'a',
    'content/deep/c.md': 'c',
    'content/notes.txt': 'skip me',
    'node_modules/pkg/readme.md': 'never'
  })
  try {
    const found = walk(dir, {
      include: ['content/**/*.md'],
      exclude: ['node_modules/**']
    }).map((abs) => toPosix(path.relative(dir, abs)))
    assert.deepEqual(found, ['content/a.md', 'content/b.md', 'content/deep/c.md'])
  } finally {
    cleanup(dir)
  }
})

test('walk with no include patterns returns nothing', () => {
  const dir = makeTmpProject({ 'a.md': 'a' })
  try {
    assert.deepEqual(walk(dir, { include: [], exclude: [] }), [])
  } finally {
    cleanup(dir)
  }
})

test('readTextFile strips the BOM and normalizes CRLF and lone CR', () => {
  const dir = makeTmpProject({ 'a.md': '\uFEFFone\r\ntwo\rthree\n' })
  try {
    assert.equal(readTextFile(path.join(dir, 'a.md')), 'one\ntwo\nthree\n')
  } finally {
    cleanup(dir)
  }
})

test('writeTextFile creates parent directories and writes LF endings', () => {
  const dir = makeTmpProject({})
  try {
    const target = path.join(dir, 'evidence', 'nested', 'out.md')
    writeTextFile(target, 'a\r\nb\n')
    assert.equal(readFileSync(target, 'utf8'), 'a\nb\n')
  } finally {
    cleanup(dir)
  }
})

test('toPosix converts Windows separators', () => {
  assert.equal(toPosix('a\\b\\c.md'), 'a/b/c.md')
  assert.equal(toPosix('a/b/c.md'), 'a/b/c.md')
})
