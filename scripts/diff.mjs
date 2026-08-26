import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { readTextFile, writeTextFile, toPosix } from './lib/fsx.mjs'
import { splitWords, splitSentences } from './lib/text.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp, writeOut } from './lib/cli.mjs'

/** Longest common subsequence over word tokens. O(n*m); drafts are short. */
function lcsTable (a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  return table
}

function diffTokens (a, b) {
  const table = lcsTable(a, b)
  const changes = []
  const push = (type, token) => {
    const last = changes[changes.length - 1]
    if (last && last.type === type) last.tokens.push(token)
    else changes.push({ type, tokens: [token] })
  }

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push('equal', a[i]); i++; j++ } else if (table[i + 1][j] >= table[i][j + 1]) { push('remove', a[i]); i++ } else { push('add', b[j]); j++ }
  }
  while (i < a.length) { push('remove', a[i]); i++ }
  while (j < b.length) { push('add', b[j]); j++ }
  return changes
}

function measure (text) {
  const words = splitWords(text)
  const sentences = splitSentences(text)
  return {
    words: words.length,
    sentences: sentences.length,
    meanSentenceLength: sentences.length
      ? Number((words.length / sentences.length).toFixed(2))
      : null
  }
}

export function mechanicalDiff (draftText, finalText) {
  const before = measure(draftText)
  const after = measure(finalText)
  const changes = diffTokens(splitWords(draftText), splitWords(finalText))

  // A one-token removal immediately followed by a one-token insertion is a
  // mechanical fact. Anything longer is a rewrite for the model to classify.
  const wordSwaps = []
  for (let i = 0; i < changes.length - 1; i++) {
    const current = changes[i]
    const next = changes[i + 1]
    if (current.type === 'remove' && next.type === 'add' &&
        current.tokens.length === 1 && next.tokens.length === 1) {
      wordSwaps.push({ from: current.tokens[0], to: next.tokens[0] })
    }
  }

  const added = changes.filter((c) => c.type === 'add').reduce((n, c) => n + c.tokens.length, 0)
  const removed = changes.filter((c) => c.type === 'remove').reduce((n, c) => n + c.tokens.length, 0)
  const unchanged = changes.filter((c) => c.type === 'equal').reduce((n, c) => n + c.tokens.length, 0)

  return {
    before,
    after,
    changes,
    wordSwaps,
    summary: {
      added,
      removed,
      unchanged,
      wordDelta: after.words - before.words,
      wordDeltaPct: before.words
        ? Number((((after.words - before.words) / before.words) * 100).toFixed(2))
        : null
    }
  }
}

function main (argv) {
  const { values } = parseCliArgs(argv, {
    draft: { type: 'string' },
    final: { type: 'string' }
  })
  if (values.help) {
    printHelp('scripts/diff.mjs', [
      'Mechanical draft-to-final deltas. Semantic classification is the model job.',
      '',
      '  --draft <file>  the plugin-produced draft',
      '  --final <file>  the text after the user edited it',
      '  --out <file>    output path (default: <kb>/.drafts/<draft-name>.diff.json)',
      '  --json          print the full result as JSON instead of writing a file'
    ])
    return
  }
  if (!values.draft || !values.final) die('--draft and --final are both required')

  const draftPath = path.resolve(values.draft)
  const result = mechanicalDiff(readTextFile(draftPath), readTextFile(path.resolve(values.final)))
  result.generated = nowIso(values)

  if (values.json) {
    writeOut(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  const { projectRoot, kbRoot } = resolveRoots(values)
  const base = path.basename(draftPath).replace(/\.[^.]+$/, '')
  const out = values.out ? path.resolve(values.out) : path.join(kbRoot, '.drafts', `${base}.diff.json`)
  writeTextFile(out, `${JSON.stringify(result, null, 2)}\n`)

  writeOut(
    `diff: +${result.summary.added} -${result.summary.removed} words, ` +
    `length ${result.summary.wordDelta >= 0 ? '+' : ''}${result.summary.wordDelta} ` +
    `(${result.summary.wordDeltaPct ?? 'n/a'}%)\n` +
    `diff: ${result.wordSwaps.length} single-word swaps\n` +
    `diff: wrote ${toPosix(path.relative(projectRoot, out))}\n`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
