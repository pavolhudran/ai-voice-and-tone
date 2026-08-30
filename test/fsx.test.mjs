import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { walk, readTextFile, writeTextFile, toPosix, displayPath} from '../scripts/lib/fsx.mjs'

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

test('walk does not prune a directory on a depth-limited exclude pattern', () => {
  const dir = makeTmpProject({
    'docs/skip.md': 'skip',
    'docs/sub/keep.md': 'keep'
  })
  try {
    const found = walk(dir, {
      include: ['docs/**/*.md'],
      exclude: ['docs/*']
    }).map((abs) => toPosix(path.relative(dir, abs)))
    // docs/* matches only direct children, so it must exclude docs/skip.md
    // per-file while leaving the docs/ subtree itself unpruned -- docs/sub/keep.md
    // is not a direct child of docs and must still be found.
    assert.deepEqual(found, ['docs/sub/keep.md'])
  } finally {
    cleanup(dir)
  }
})

test('walk prunes a directory named by a literal exclude segment, even under **', () => {
  const dir = makeTmpProject({
    'a/node_modules/pkg/index.js': 'never',
    'a/src/index.js': 'keep'
  })
  try {
    const found = walk(dir, {
      include: ['**/*.js'],
      exclude: ['**/node_modules']
    }).map((abs) => toPosix(path.relative(dir, abs)))
    // "**/node_modules" names a directory (its final segment has no wildcard),
    // so it must prune the whole a/node_modules subtree -- not just fail to
    // match individual files inside it, which would silently leak them in.
    assert.deepEqual(found, ['a/src/index.js'])
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

// --- F13: a path outside the root is shown absolute, not as a ladder of '..'

test('displayPath keeps a path inside the root relative', () => {
  assert.equal(displayPath('/a/b', '/a/b/c/d.json'), 'c/d.json')
  assert.equal(displayPath('/a/b', '/a/b/d.json'), 'd.json')
})

test('displayPath prints an outside path absolutely instead of climbing out', () => {
  // `path.relative` will happily climb out of the root, so an --out pointed
  // elsewhere printed as '../../../../../../../private/tmp/...': correct,
  // unreadable, and not copy-pasteable from where the reader is standing.
  const out = displayPath('/a/b/c/d/e/f/g', '/private/tmp/out.diff.json')
  assert.equal(out, '/private/tmp/out.diff.json')
  assert.ok(!out.startsWith('..'))
})

test('displayPath handles the root itself', () => {
  assert.equal(displayPath('/a/b', '/a/b'), '/a/b', 'empty relative is not a useful answer')
})
