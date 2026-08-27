# Source Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user point the plugin at brand material of any common format — dropped into an inbox, sitting anywhere on disk, or living on a web page — and have it analysed, indexed, and folded into the corpus without any of that material ever being committed.

**Architecture:** A `sources:` register in `config.yml` names where to look. An ingest ladder extracts each source with a deterministic Node parser first, scores the result with a calibrated quality gate, and escalates to the model only on genuine failure. What survives in git is `evidence/sources.json` — a hash-keyed index carrying *sufficient statistics* rich enough to recompute the whole fingerprint and to subtract any single source with no source text present. `gatherCorpus()` stays the one chokepoint, so the manifest, the per-locale bucketing, and the fingerprint keep working unchanged.

**Tech Stack:** Node >= 18.13 (ESM `.mjs`, `node:test`), two vendored and pinned third-party bundles — `pdfjs-dist` for PDF and `officeparser` for the Office and OpenDocument formats — plus `node:crypto` for content hashing and the global `fetch` for URL sources. No runtime installs; `esbuild` is a build-time devDependency used only to regenerate `vendor/`.

**Spec:** `docs/superpowers/specs/2026-08-27-source-ingestion-design.md`
**Parent spec:** `docs/superpowers/specs/2026-08-26-voice-and-tone-plugin-design.md`

## Global Constraints

These apply to every task. Values are copied verbatim from the specs.

**Cross-platform (parent section 9) — hard rules, no exceptions:**
- Invoke scripts as `node "<absolute path>"`. Never `./script.mjs`.
- **Zero** use of `grep`, `find`, `sed`, `awk`, `cat` in plugin logic. All file walking and text processing happens in JS.
- **No shelling out to any external converter.** `pdftotext`, `pandoc`, `textutil`, and LibreOffice are deliberately rejected: present on one machine and absent on another means the same corpus fingerprints differently on two laptops.
- `path.join()` everywhere. No literal `/` in constructed filesystem paths.
- Scripts write UTF-8 **files** and print **only ASCII** to stdout. `writeOut`/`die` in `scripts/lib/cli.mjs` already enforce this — use them, never `console.log`.
- Normalize line endings (CRLF to LF, lone CR to LF) on read before computing any metric. For binary formats this applies to the *extracted text*, not the container bytes.
- No symlinks in the plugin tree; `walk()` already skips them.

**Runtime:**
- Node >= 18.13.0 (`package.json` `engines`). `node:test` + `node:assert/strict` are the only test tooling.
- **No runtime dependencies, no runtime installs, no shelling out.** Third-party parsing is *vendored*: committed to `vendor/` as pinned bytes with its license and a hash manifest. This is an amendment to the parent spec's section 9, and a narrow one — that rule exists so the same document fingerprints identically on every machine, and a pinned committed bundle satisfies it better than a system tool (absent on Windows) or an npm dependency (drifts between installs).
- `scripts/vendor.mjs` is the **only** file permitted to use `child_process` or `npm`, and it never runs on a user's machine. `test/conformance.test.mjs` enforces that mechanically.
- Every script accepts `--root`, `--kb`, `--out`, `--now`, `--json`, `--help` via `parseCliArgs` in `scripts/lib/cli.mjs`.
- Exit codes: `0` success, `1` unexpected error, `2` validation/integrity failures.
- Binary reads use `readFileSync(abs)` with **no encoding argument**. `readTextFile()` is for text only.

**Fixed vocabularies — used identically in every task:**
- Register entry kinds: `project`, `inbox`, `local`, `url`.
- Index entry kinds: `file`, `url`.
- Index entry status: `new`, `used`, `missing`, `stale`, `skipped`.
- Extraction tier: `script`, `model`.
- Fidelity: `measured`, `estimated`. (Parent section 5.4: an `estimated` fingerprint may only ever produce `assumed` rules, never `derived`.)
- Register entry IDs: `s` + zero-padded integer (`s01`). Index entry IDs: `f` + zero-padded integer (`f001`). Never reused. Neither collides with rule prefixes `V T L M C A X` or with evidence's `e`.
- Hashes are lowercase hex sha256 of the raw bytes.

**Never committed (spec D2/D3):** `<KB>/sources/`, `<KB>/.cache/`. **Always committed (D4):** `<KB>/evidence/sources.json`, and `<KB>/evidence/snapshots/` when a URL entry opts into `retain: snapshot`.

**Quality-gate thresholds (spec section 7.3) — calibrated against real extractions. Do not invent new ones:**

| Signal | Fails when | Catches |
|---|---|---|
| `long20Share` — share of tokens longer than 20 chars | `> 0.015` | merged words |
| `singleShare` — share of 1-char tokens, minus the locale's real single-letter words | `> 0.10` | split words |
| `replShare` — share of U+FFFD | `> 0.005` | encoding failure |
| `glyphRecall` (PDF only) — recovered glyphs / show-text payload bytes | `< 0.5` | wholesale loss |
| `meanTokenLen`, `novowelShare` | advisory only — recorded, never fail | locale-sensitive |

---

## File Structure

New and modified files. Every one is created or touched by a task below.

```
scripts/
  lib/
    hash.mjs          NEW  sha256 of bytes / text / file
    office.mjs        NEW  adapter over vendored officeparser (docx/pptx/xlsx/odt/odp/ods)
    pdf.mjs           NEW  adapter over vendored pdfjs-dist
    textish.mjs       NEW  RTF, VTT/SRT, CSV/TSV extractors
    quality.mjs       NEW  the calibrated extraction quality gate
    register.mjs      NEW  the config sources register: parse, migrate, resolve
    sourceindex.mjs   NEW  evidence/sources.json: read, write, diff, status
    ingest.mjs        NEW  the ladder: resolve, extract, gate, cache, stats
    fetchurl.mjs      NEW  URL fetch + snapshot retention (the only network code)
    metrics.mjs       MOD  + statsFor / mergeStats / fingerprintFromStats
    extract.mjs       MOD  + binary format registry; formatFor stays path-only
    corpus.mjs        MOD  format gate before read; consume the register
    config.mjs        MOD  + DEFAULT_CONFIG.sources
  sources.mjs         NEW  the register/index CLI
  vendor.mjs          NEW  MAINTAINER ONLY: regenerate vendor/ from pinned versions
  scan.mjs            MOD  manifest gains tier / fidelity / skipped
  fingerprint.mjs     MOD  measure-then-merge instead of join-then-measure
  validate.mjs        MOD  + index integrity checks

vendor/               NEW  pinned third-party bundles, ~2.3 MB committed
  pdfjs/              pdf.min.mjs + pdf.worker.min.mjs + LICENSE
  officeparser/       officeparser.cjs (bundled, no OCR) + LICENSE
  manifest.json       versions, licenses, sources, per-file sha256
  README.md           why vendored, and how to bump a version

templates/kb/
  config.yml          MOD  + sources register
  gitignore           MOD  + sources/ and .cache/
  sources/README.md   NEW  what the inbox is, and why it is not committed

commands/
  connect.md          NEW  /voice-and-tone:connect
  init.md             MOD  --add is now real

skills/voice-discovery/
  SKILL.md                MOD  sourcing step, model-tier escalation
  references/sourcing.md  NEW  the ladder, the gate, what to do on escalation

test/
  hash.test.mjs  vendor.test.mjs  office.test.mjs  pdf.test.mjs
  textish.test.mjs  quality.test.mjs  register.test.mjs
  sourceindex.test.mjs  ingest.test.mjs  fetchurl.test.mjs
  sources.test.mjs                                        NEW
  stats.test.mjs                                          NEW  the section 6.2 invariant
  corpus/scan/fingerprint/validate/extract .test.mjs      MOD
```

**Dependency order.** `vendor/` comes first — `office` and `pdf` are adapters over it and cannot be written until the bundles exist. `hash` and the extractors have no dependants until `ingest`. The `metrics` statistics come before the index, which needs them. `register` and `sourceindex` come before `ingest`, which comes before `sources.mjs` and the corpus integration. URL sourcing, `validate`, and the model-side surface land last.

**Fixtures are generated, never committed.** Test `.docx` and `.pdf` files are built byte-by-byte inside the test file. This keeps binaries out of the repo, makes each fixture's structure explicit, and lets one test target one format feature at a time.

---

### Task 1: Close the silent drop

An unsupported file matched by an include glob is currently read into memory in full and then discarded with no trace: it appears in neither `manifest.files` nor `manifest.unreadable`. Reproduced against a real `.docx` sitting alongside `notes.md` and `notes.txt` — `scan` reported `2 files` and `0 unreadable`.

Two defects, one fix. `corpus.mjs:34` reads the bytes before `corpus.mjs:37` checks the format, so a large binary is slurped only to be thrown away. And the drop is silent, so a user who points `scan.include` at a folder of PDFs sees `scan: 0 files` with nothing to act on.

This lands first because it is independently valuable and independently reviewable: it improves today's behaviour with none of the rest of this plan in place.

**Files:**
- Modify: `scripts/lib/corpus.mjs:26-51`
- Modify: `scripts/scan.mjs:9-47`, `scripts/scan.mjs:76-92`
- Test: `test/corpus.test.mjs`, `test/scan.test.mjs`

**Interfaces:**
- Consumes: `formatFor` from `extract.mjs` (already exported), `walk` from `fsx.mjs`.
- Produces: `gatherCorpus(projectRoot, config, profileName, unreadable, skipped)` — a fifth out-parameter, an array of `{ rel, ext }` for files matched by a glob whose extension has no extractor. `buildManifest` gains `manifest.skipped = { count, files: [{ path, ext }] }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/corpus.test.mjs`:

```js
test('an unsupported extension is recorded as skipped, not dropped silently', () => {
  const dir = makeTmpProject({
    'content/notes.md': 'We write like humans.\n',
    'content/brand.docx': 'the extension is what matters here',
    'content/logo.sketch': 'binary-ish'
  })
  try {
    const config = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*'], exclude: [] } }
    const unreadable = []
    const skipped = []
    const corpus = gatherCorpus(dir, config, 'default', unreadable, skipped)

    assert.deepEqual(corpus.map((f) => f.rel), ['content/notes.md'])
    assert.deepEqual(skipped.map((s) => s.ext).sort(), ['.docx', '.sketch'])
    assert.deepEqual(
      skipped.map((s) => s.rel).sort(),
      ['content/brand.docx', 'content/logo.sketch']
    )
    assert.deepEqual(unreadable, [], 'skipped is a separate channel from unreadable')
  } finally {
    cleanup(dir)
  }
})

test('the format gate runs before the file is read', () => {
  const dir = makeTmpProject({ 'content/big.bin': 'placeholder' })
  try {
    // 8 MB of zeroes. If the gate ran after the read, this lands in memory.
    writeFileSync(path.join(dir, 'content', 'big.bin'), Buffer.alloc(8 * 1024 * 1024, 0))

    const config = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*'], exclude: [] } }
    const skipped = []
    global.gc?.()
    const before = process.memoryUsage().arrayBuffers
    gatherCorpus(dir, config, 'default', [], skipped)
    const after = process.memoryUsage().arrayBuffers

    assert.equal(skipped.length, 1)
    assert.ok(
      after - before < 4 * 1024 * 1024,
      `unsupported file must not be read into memory (arrayBuffers grew ${after - before} bytes)`
    )
  } finally {
    cleanup(dir)
  }
})
```

Ensure these imports exist at the top of `test/corpus.test.mjs`:

```js
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs'
```

Append to `test/scan.test.mjs`:

```js
test('the manifest reports skipped files with their extension', () => {
  const dir = makeTmpProject({
    'content/a.md': 'Copy here.\n',
    'content/deck.pptx': 'placeholder',
    'content/guide.pdf': 'placeholder'
  })
  try {
    const config = { ...DEFAULT_CONFIG, scan: { include: ['content/**/*'], exclude: [] } }
    const manifest = buildManifest(dir, config, '2026-08-27T00:00:00.000Z')

    assert.equal(manifest.totals.files, 1)
    assert.equal(manifest.skipped.count, 2)
    assert.deepEqual(manifest.skipped.files.map((f) => f.ext).sort(), ['.pdf', '.pptx'])
    assert.deepEqual(
      manifest.skipped.files.map((f) => f.path),
      ['content/deck.pptx', 'content/guide.pdf'],
      'sorted, so the artifact diffs cleanly'
    )
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/corpus.test.mjs test/scan.test.mjs`
Expected: FAIL — `gatherCorpus` ignores a fifth argument so `skipped` stays empty, and `manifest.skipped` is `undefined`.

- [ ] **Step 3: Move the format gate ahead of the read**

Replace the body of `gatherCorpus` in `scripts/lib/corpus.mjs`:

```js
export function gatherCorpus (projectRoot, config, profileName = 'default', unreadable = [], skipped = []) {
  const profile = activeProfile(config, profileName)
  const primary = profile.primary_locale ?? 'en'
  const locales = profile.locales ?? [primary]
  const out = []

  for (const abs of walk(projectRoot, config.scan)) {
    const rel = toPosix(path.relative(projectRoot, abs))

    // The format gate is decided by the path alone, so it must run BEFORE the
    // read. Otherwise a glob pointing at a directory of large binaries slurps
    // every one of them into memory only to discard it at the extension check.
    const format = formatFor(abs)
    if (!format) {
      skipped.push({ rel, ext: path.extname(abs).toLowerCase() })
      continue
    }

    let raw
    try { raw = readTextFile(abs) } catch { continue } // unreadable file is skipped, not fatal
    const { strings } = extractStrings(abs, raw)
    if (strings.length === 0) {
      if (format === 'json') unreadable.push(rel)
      continue
    }
    out.push({
      rel,
      abs,
      format,
      locale: localeOf(rel, locales, primary),
      strings,
      headings: extractHeadings(abs, raw)
    })
  }
  return out
}
```

Update the import at the top of `scripts/lib/corpus.mjs`:

```js
import { extractStrings, extractHeadings, formatFor } from './extract.mjs'
```

Extend the existing JSDoc block above `gatherCorpus` with a paragraph documenting the new out-parameter, matching the tone of the `unreadable` paragraph already there:

```js
 * @param {Array<{rel:string,ext:string}>} [skipped] - out-parameter, same
 *   rationale as `unreadable`. A file matched by an include glob whose
 *   extension has no extractor used to vanish without trace: absent from the
 *   manifest's `files` AND from `unreadable`, which only ever covered
 *   malformed JSON. A user pointing scan.include at a folder of PDFs saw
 *   "0 files" with nothing to act on. Recording the extension - not merely a
 *   count - is what makes the resulting message actionable.
```

- [ ] **Step 4: Surface skipped files in the manifest**

In `scripts/scan.mjs`, inside `buildManifest`, replace the two lines that gather the corpus:

```js
  const unreadablePaths = []
  const skippedFiles = []
  const corpus = gatherCorpus(projectRoot, config, profileName, unreadablePaths, skippedFiles)
```

Add to the returned object, immediately after the `unreadable` key:

```js
    skipped: {
      count: skippedFiles.length,
      files: [...skippedFiles]
        .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
        .map((f) => ({ path: f.rel, ext: f.ext }))
    }
```

In `main`, extend the `--json` summary:

```js
    writeOut(`${JSON.stringify({
      totals: manifest.totals,
      byLocale: manifest.byLocale,
      unreadable: { count: manifest.unreadable.count },
      skipped: { count: manifest.skipped.count }
    })}\n`)
```

and the human summary, inserting one line between the unreadable line and the wrote line:

```js
  writeOut(
    `scan: ${manifest.totals.files} files, ${manifest.totals.strings} strings, ` +
    `${manifest.totals.words} words, ${manifest.totals.sentences} sentences\n` +
    `scan: locales ${Object.keys(manifest.byLocale).join(', ') || 'none'}\n` +
    `scan: ${manifest.unreadable.count} unreadable json file(s)\n` +
    (manifest.skipped.count
      ? `scan: ${manifest.skipped.count} file(s) skipped (unsupported: ` +
        `${[...new Set(manifest.skipped.files.map((f) => f.ext))].sort().join(', ')})\n`
      : '') +
    `scan: wrote ${toPosix(path.relative(projectRoot, out))}\n`
  )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/corpus.test.mjs test/scan.test.mjs`
Expected: PASS

- [ ] **Step 6: Run the whole suite for regressions**

Run: `node --test test/`
Expected: PASS. `manifest.json` gains one key; nothing that already existed changed shape.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/corpus.mjs scripts/scan.mjs test/corpus.test.mjs test/scan.test.mjs
git commit -m "fix: report unsupported files instead of dropping them silently

The format gate now runs on the path before the file is read, so an
unsupported file matched by an include glob is no longer slurped into
memory to be discarded. Files with no extractor are recorded in a new
manifest.skipped list with their extension rather than vanishing from
both files and unreadable."
```

---

### Task 2: Sufficient statistics and the disposability invariant

This is the load-bearing task of the whole plan. Spec section 6 claims that every metric the fingerprint produces is a count, a ratio of counts, or recoverable from sums and a bounded histogram — and therefore that per-source statistics are enough to recompute the aggregate and to subtract any single source with no source text present. Nothing else in this plan is safe until that claim is proven by test.

Without it, a colleague cloning a knowledge base with an empty `sources/` would have `:audit` report large, confident, entirely fictitious drift in the brand's writing.

**Two deliberate behaviour changes land here.** Both are consequences of making the invariant true, and both must be called out in the commit message:

1. `buildFingerprint` moves from **join-then-measure** to **measure-then-merge**. Today it concatenates every file's strings per locale and measures the blob. That makes text-level regexes (`SERIAL_LIST`, em-dash, emoji) able to match across a boundary between two unrelated documents — a spurious match, and one that breaks the invariant. Measuring per file and merging counts is both correct and additive.
2. `medianSentenceLength` becomes **bucket-accurate rather than exact**, because a median cannot be merged from sums. Spec section 6.3 accepts this: the median is compared against the brand's own baseline, never an absolute threshold. Any baseline captured before this change must be re-set with `fingerprint.mjs --set-baseline`.

> **Deviation available, not taken.** Width-1 histogram buckets up to 40 would make the median exact for essentially all real sentences, at a cost of about 40 small integers per source in the index. The spec fixed the buckets at `1-5 / 6-10 / 11-20 / 21-40 / 41+`, so this plan implements those. Raise it with the spec author if median precision turns out to matter.

**Files:**
- Create: `scripts/lib/hash.mjs`
- Modify: `scripts/lib/metrics.mjs` (add statistics layer; `computeFingerprint` keeps its signature)
- Modify: `scripts/fingerprint.mjs:10-18`
- Test: `test/stats.test.mjs`, `test/hash.test.mjs`

**Interfaces:**
- Consumes: `splitSentences`, `splitWords`, `splitParagraphs`, `countSyllablesEn` from `text.mjs`.
- Produces:
  - `sha256Buffer(buf) -> string`, `sha256Text(text) -> string`, `sha256File(abs) -> string` — lowercase hex.
  - `SENT_LEN_BUCKETS -> string[]`
  - `emptyStats() -> Stats`
  - `statsFor({ strings, headings, locale }) -> Stats` — counts for **one unit** (one file, one page, one URL).
  - `mergeStats(statsList) -> Stats` — associative and commutative.
  - `fingerprintFromStats(stats, locale) -> Fingerprint` — the exact shape `computeFingerprint` returns today, plus `approximations: string[]`.
  - `computeFingerprint({ strings, headings, locale })` — unchanged signature, now implemented as `fingerprintFromStats(statsFor(...), locale)`.

`Stats` shape, which is exactly what the index persists as its `stats` block:

```js
{
  strings, words, sentences, paragraphs,
  sumWordLen, sumSentLen, sumSentLenSq, sumParaSent,
  sentLenHist: { '1-5': n, '6-10': n, '11-20': n, '21-40': n, '41+': n },
  exclamations, questions, emoji, emDash, semicolon,
  personMarkers: boolean,     // false when the locale has no marker set
  firstPerson, secondPerson,
  headingsTotal, headingsTitleCase,
  english: null | {
    syllables, contractions, passiveSentences, imperativeOpeners,
    hedges, intensifiers, oxfordLists, oxfordHits, longWords
  }
}
```

- [ ] **Step 1: Write the failing hash test**

`test/hash.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/hash.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/hash.mjs'`

- [ ] **Step 3: Implement hash.mjs**

`scripts/lib/hash.mjs`:

```js
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/**
 * Content hashing. A source's identity is its bytes, never its path.
 *
 * Because sources are deliberately not committed (spec D2), the same document
 * sits at a different path on every machine. Keying the index by hash is what
 * lets one person's `~/Downloads/guide.pdf` be recognised as the file another
 * person already analysed from `<KB>/sources/guide.pdf`.
 */
export function sha256Buffer (buf) {
  return createHash('sha256').update(buf).digest('hex')
}

export function sha256Text (text) {
  return sha256Buffer(Buffer.from(String(text), 'utf8'))
}

/** Reads raw bytes. No encoding argument: a PDF is not text. */
export function sha256File (abs) {
  return sha256Buffer(readFileSync(abs))
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/hash.test.mjs`
Expected: PASS

- [ ] **Step 5: Write the failing statistics tests**

`test/stats.test.mjs`. The first test is the invariant the whole design rests on; the rest pin down the pieces that make it hold.

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  statsFor, mergeStats, emptyStats, fingerprintFromStats, computeFingerprint,
  SENT_LEN_BUCKETS
} from '../scripts/lib/metrics.mjs'

const A = {
  strings: [
    'Your campaign is scheduled. Nice work!',
    'We keep it plain, we keep it short, and we mean it.'
  ],
  headings: ['Schedule A Campaign'],
  locale: 'en'
}
const B = {
  strings: [
    'That file did not upload. It is over the 25 MB limit.',
    'Could you try a smaller one? You might also compress it.'
  ],
  headings: ['Upload limits'],
  locale: 'en'
}

// --- THE INVARIANT (spec section 6.2) ------------------------------------
// If this fails, sources cannot be discarded and the whole design is unsound.

test('merged per-unit statistics reproduce the aggregate fingerprint exactly', () => {
  const merged = fingerprintFromStats(
    mergeStats([statsFor(A), statsFor(B)]),
    'en'
  )
  const direct = fingerprintFromStats(
    mergeStats([statsFor({
      strings: [...A.strings, ...B.strings],
      headings: [...A.headings, ...B.headings],
      locale: 'en'
    })]),
    'en'
  )
  // Measure-then-merge is the contract. Both sides use it; the point is that
  // splitting the same corpus across two units changes nothing.
  const split = fingerprintFromStats(
    mergeStats([
      statsFor({ strings: A.strings, headings: A.headings, locale: 'en' }),
      statsFor({ strings: B.strings, headings: B.headings, locale: 'en' })
    ]),
    'en'
  )
  assert.deepEqual(split, merged)
  assert.equal(split.universal.wordCount, direct.universal.wordCount)
  assert.equal(split.universal.sentenceCount, direct.universal.sentenceCount)
})

test('mergeStats is commutative and associative', () => {
  const a = statsFor(A)
  const b = statsFor(B)
  const c = statsFor({ strings: ['One more line to fold in.'], headings: [], locale: 'en' })

  assert.deepEqual(mergeStats([a, b]), mergeStats([b, a]))
  assert.deepEqual(
    mergeStats([mergeStats([a, b]), c]),
    mergeStats([a, mergeStats([b, c])])
  )
})

test('merging with an empty unit changes nothing', () => {
  const a = statsFor(A)
  assert.deepEqual(mergeStats([a, emptyStats()]), a)
  assert.deepEqual(mergeStats([]), emptyStats())
})

test('a source can be subtracted by re-merging the survivors', () => {
  const all = mergeStats([statsFor(A), statsFor(B)])
  const withoutB = mergeStats([statsFor(A)])

  assert.equal(all.words - statsFor(B).words, withoutB.words)
  assert.deepEqual(fingerprintFromStats(withoutB, 'en'), fingerprintFromStats(statsFor(A), 'en'))
})

// --- shape and parity with the existing metrics ---------------------------

test('fingerprintFromStats returns the established fingerprint shape', () => {
  const fp = fingerprintFromStats(statsFor(A), 'en')

  assert.deepEqual(Object.keys(fp).sort(), ['approximations', 'english', 'locale', 'sample', 'universal'])
  assert.deepEqual(Object.keys(fp.sample).sort(), ['sentences', 'strings', 'words'])
  assert.equal(fp.locale, 'en')
  assert.ok(fp.english !== null, 'english metrics present for en')
  assert.deepEqual(fp.approximations, ['medianSentenceLength'])
})

test('computeFingerprint keeps its signature and delegates to the statistics layer', () => {
  assert.deepEqual(computeFingerprint(A), fingerprintFromStats(statsFor(A), 'en'))
})

test('a non-English locale reports null for English-only metrics and person rates it cannot measure', () => {
  const cs = statsFor({
    strings: ['Vase kampan je naplanovana. Hotovo!'],
    headings: [],
    locale: 'cs'
  })
  const fp = fingerprintFromStats(cs, 'cs')

  assert.equal(fp.english, null)
  assert.equal(cs.english, null)
  assert.equal(fp.universal.headingTitleCaseRatio, null)
  assert.ok(cs.personMarkers, 'cs has a marker set, so person rates are real numbers')
  assert.ok(typeof fp.universal.firstPersonPer1000Words === 'number')
})

test('a locale with no marker set reports null person rates rather than a misleading zero', () => {
  const fr = statsFor({ strings: ['Nous ecrivons simplement.'], headings: [], locale: 'fr' })
  const fp = fingerprintFromStats(fr, 'fr')

  assert.equal(fr.personMarkers, false)
  assert.equal(fp.universal.firstPersonPer1000Words, null)
  assert.equal(fp.universal.secondPersonPer1000Words, null)
})

// --- the pieces that make merging possible --------------------------------

test('sentence-length standard deviation is recovered from sums, not the list', () => {
  // Sentences of 2, 4, and 6 words: mean 4, population SD sqrt(8/3) = 1.63.
  const s = statsFor({
    strings: ['One two.', 'One two three four.', 'One two three four five six.'],
    headings: [],
    locale: 'en'
  })
  assert.equal(s.sentences, 3)
  assert.equal(s.sumSentLen, 12)
  assert.equal(s.sumSentLenSq, 4 + 16 + 36)
  assert.equal(fingerprintFromStats(s, 'en').universal.sentenceLengthSd, 1.63)
})

test('the sentence-length histogram covers every bucket and sums to the sentence count', () => {
  const s = statsFor({
    strings: [
      'Short.',
      'This sentence has exactly eight separate words here.',
      `Filler ${'word '.repeat(24)}end.`
    ],
    headings: [],
    locale: 'en'
  })
  assert.deepEqual(Object.keys(s.sentLenHist), SENT_LEN_BUCKETS)
  assert.equal(
    Object.values(s.sentLenHist).reduce((a, b) => a + b, 0),
    s.sentences
  )
})

test('the median is bucket-accurate and says so', () => {
  const s = statsFor({
    strings: ['One two.', 'One two three.', 'One two three four.'],
    headings: [],
    locale: 'en'
  })
  const fp = fingerprintFromStats(s, 'en')
  assert.equal(fp.universal.medianSentenceLength, 3, 'midpoint of the 1-5 bucket')
  assert.ok(fp.approximations.includes('medianSentenceLength'))
})

test('an empty unit yields a valid, all-null fingerprint rather than NaN', () => {
  const fp = fingerprintFromStats(emptyStats(), 'en')
  assert.equal(fp.universal.wordCount, 0)
  assert.equal(fp.universal.meanWordLength, null)
  assert.equal(fp.universal.meanSentenceLength, null)
  assert.equal(fp.universal.sentenceLengthSd, null)
  assert.equal(fp.universal.medianSentenceLength, null)
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test test/stats.test.mjs`
Expected: FAIL with `SyntaxError: The requested module ... does not provide an export named 'statsFor'`

- [ ] **Step 7: Add the statistics layer to metrics.mjs**

Keep everything already in `scripts/lib/metrics.mjs` — `PERSON_MARKERS`, `EN_HEDGES`, `EN_INTENSIFIERS`, `EN_IMPERATIVE_OPENERS`, `PASSIVE`, `CONTRACTION`, `SERIAL_LIST`, `OXFORD`, `round`, `share`, `per1000`, `countMatches`, `isTitleCase`. The vocabularies stay in one home; only the counting and the arithmetic split apart.

**Delete** `universalMetrics`, `englishMetrics`, `median`, and `stdDev`, and **replace** `computeFingerprint`. Append the following to the file:

```js
/**
 * Sentence-length buckets. Coarse on purpose: the median they reconstruct is
 * only ever compared against the brand's own baseline, never an absolute
 * threshold, so bucket accuracy is enough. Spec section 6.3.
 */
export const SENT_LEN_BUCKETS = ['1-5', '6-10', '11-20', '21-40', '41+']
const BUCKET_MIDPOINT = { '1-5': 3, '6-10': 8, '11-20': 15.5, '21-40': 30.5, '41+': 41 }

function bucketFor (n) {
  if (n <= 5) return '1-5'
  if (n <= 10) return '6-10'
  if (n <= 20) return '11-20'
  if (n <= 40) return '21-40'
  return '41+'
}

const NUMERIC_KEYS = [
  'strings', 'words', 'sentences', 'paragraphs',
  'sumWordLen', 'sumSentLen', 'sumSentLenSq', 'sumParaSent',
  'exclamations', 'questions', 'emoji', 'emDash', 'semicolon',
  'firstPerson', 'secondPerson', 'headingsTotal', 'headingsTitleCase'
]
const ENGLISH_KEYS = [
  'syllables', 'contractions', 'passiveSentences', 'imperativeOpeners',
  'hedges', 'intensifiers', 'oxfordLists', 'oxfordHits', 'longWords'
]

export function emptyStats () {
  const out = { sentLenHist: {}, personMarkers: true, english: null }
  for (const key of NUMERIC_KEYS) out[key] = 0
  for (const bucket of SENT_LEN_BUCKETS) out.sentLenHist[bucket] = 0
  return out
}

function emptyEnglish () {
  const out = {}
  for (const key of ENGLISH_KEYS) out[key] = 0
  return out
}

/**
 * Counts for ONE unit - one file, one PDF, one fetched page. Never for a
 * concatenation of several.
 *
 * Measuring per unit and merging counts is what makes the index a sufficient
 * statistic (spec section 6). It is also more correct than the join-then-
 * measure approach it replaces: joining two unrelated documents let text-level
 * patterns such as SERIAL_LIST match across the seam between them, inventing a
 * hit that exists in neither document.
 */
export function statsFor ({ strings = [], headings = [], locale = 'en' } = {}) {
  const out = emptyStats()
  const text = strings.join('\n\n')
  const sentences = strings.flatMap((s) => splitSentences(s))
  const words = splitWords(text)
  const paragraphs = splitParagraphs(text)
  const lowerWords = words.map((w) => w.toLowerCase())

  out.strings = strings.length
  out.words = words.length
  out.sentences = sentences.length
  out.paragraphs = paragraphs.length
  out.sumWordLen = words.reduce((sum, w) => sum + w.length, 0)
  out.sumParaSent = paragraphs.reduce((sum, p) => sum + splitSentences(p).length, 0)

  for (const sentence of sentences) {
    const n = splitWords(sentence).length
    out.sumSentLen += n
    out.sumSentLenSq += n * n
    out.sentLenHist[bucketFor(n)] += 1
  }

  out.exclamations = sentences.filter((s) => /!\p{P}*$/u.test(s)).length
  out.questions = sentences.filter((s) => /\?\p{P}*$/u.test(s)).length
  out.emoji = countMatches(text, /\p{Extended_Pictographic}/gu)
  out.emDash = countMatches(text, /—|\s-\s/g)
  out.semicolon = countMatches(text, /;/g)

  const markers = PERSON_MARKERS[String(locale).slice(0, 2).toLowerCase()] ?? null
  out.personMarkers = markers !== null
  if (markers) {
    out.firstPerson = lowerWords.filter((w) => markers.first.includes(w)).length
    out.secondPerson = lowerWords.filter((w) => markers.second.includes(w)).length
  }

  // Title case is only an editorial decision in languages that do not
  // capitalize by grammar. Outside English no verdicts are recorded, which
  // leaves headingsTotal at 0 and makes the ratio null by construction.
  if (String(locale).toLowerCase().startsWith('en')) {
    for (const verdict of headings.map(isTitleCase)) {
      if (verdict === null) continue
      out.headingsTotal += 1
      if (verdict) out.headingsTitleCase += 1
    }

    const en = emptyEnglish()
    en.syllables = words.reduce((sum, w) => sum + countSyllablesEn(w), 0)
    en.contractions = countMatches(text, CONTRACTION)
    en.passiveSentences = sentences.filter((s) => PASSIVE.test(s)).length
    en.imperativeOpeners = sentences.filter((sentence) => {
      const first = (splitWords(sentence)[0] || '').toLowerCase()
      return EN_IMPERATIVE_OPENERS.has(first)
    }).length
    en.hedges = lowerWords.filter((w) => EN_HEDGES.has(w)).length
    en.intensifiers = lowerWords.filter((w) => EN_INTENSIFIERS.has(w)).length

    const listCandidates = text.match(SERIAL_LIST) || []
    en.oxfordLists = listCandidates.length
    en.oxfordHits = listCandidates.filter((candidate) => OXFORD.test(candidate)).length
    en.longWords = words.filter((w) => countSyllablesEn(w) > 3).length
    out.english = en
  }

  return out
}

/** Associative and commutative. Merge only within one locale (spec 5.3). */
export function mergeStats (statsList) {
  const items = (statsList || []).filter(Boolean)
  const out = emptyStats()
  if (items.length === 0) return out

  out.personMarkers = items.every((s) => s.personMarkers !== false)
  if (items.some((s) => s.english)) out.english = emptyEnglish()

  for (const item of items) {
    for (const key of NUMERIC_KEYS) out[key] += item[key] ?? 0
    for (const bucket of SENT_LEN_BUCKETS) {
      out.sentLenHist[bucket] += item.sentLenHist?.[bucket] ?? 0
    }
    if (item.english && out.english) {
      for (const key of ENGLISH_KEYS) out.english[key] += item.english[key] ?? 0
    }
  }
  return out
}

function sdFromSums (sum, sumSq, n) {
  if (!n) return null
  const variance = sumSq / n - (sum / n) ** 2
  return round(Math.sqrt(Math.max(variance, 0)), 2)
}

function medianFromHist (hist, n) {
  if (!n) return null
  const target = n / 2
  let seen = 0
  for (const bucket of SENT_LEN_BUCKETS) {
    seen += hist[bucket] ?? 0
    if (seen >= target) return BUCKET_MIDPOINT[bucket]
  }
  return BUCKET_MIDPOINT['41+']
}

/** Arithmetic only. Every input comes from a Stats block; no text is needed. */
export function fingerprintFromStats (stats, locale = 'en') {
  const s = stats ?? emptyStats()
  const isEnglish = String(locale).toLowerCase().startsWith('en')
  const en = isEnglish && s.english ? s.english : null

  return {
    locale,
    // Stated rather than hidden: the median is reconstructed from a bucketed
    // histogram because a median cannot be merged from sums. Spec 6.3.
    approximations: ['medianSentenceLength'],
    sample: { strings: s.strings, words: s.words, sentences: s.sentences },
    universal: {
      sentenceCount: s.sentences,
      wordCount: s.words,
      paragraphCount: s.paragraphs,
      meanSentenceLength: s.sentences ? round(s.sumSentLen / s.sentences, 2) : null,
      medianSentenceLength: medianFromHist(s.sentLenHist, s.sentences),
      sentenceLengthSd: sdFromSums(s.sumSentLen, s.sumSentLenSq, s.sentences),
      meanParagraphLength: s.paragraphs ? round(s.sumParaSent / s.paragraphs, 2) : null,
      meanWordLength: s.words ? round(s.sumWordLen / s.words, 2) : null,
      exclamationRate: share(s.exclamations, s.sentences),
      questionRate: share(s.questions, s.sentences),
      emojiPer1000Words: per1000(s.emoji, s.words),
      emDashPer1000Words: per1000(s.emDash, s.words),
      semicolonPer1000Words: per1000(s.semicolon, s.words),
      headingTitleCaseRatio: isEnglish ? share(s.headingsTitleCase, s.headingsTotal) : null,
      firstPersonPer1000Words: s.personMarkers ? per1000(s.firstPerson, s.words) : null,
      secondPersonPer1000Words: s.personMarkers ? per1000(s.secondPerson, s.words) : null
    },
    english: en
      ? {
          contractionPer1000Words: per1000(en.contractions, s.words),
          readingGrade: s.sentences && s.words
            ? round(0.39 * (s.words / s.sentences) + 11.8 * (en.syllables / s.words) - 15.59, 2)
            : null,
          passiveRate: share(en.passiveSentences, s.sentences),
          imperativeOpenerRate: share(en.imperativeOpeners, s.sentences),
          hedgePer1000Words: per1000(en.hedges, s.words),
          intensifierPer1000Words: per1000(en.intensifiers, s.words),
          oxfordCommaRate: share(en.oxfordHits, en.oxfordLists),
          longWordRate: share(en.longWords, s.words)
        }
      : null
  }
}

/** Kept for callers that hold the text and want a fingerprint in one step. */
export function computeFingerprint ({ strings = [], headings = [], locale = 'en' } = {}) {
  return fingerprintFromStats(statsFor({ strings, headings, locale }), locale)
}
```

- [ ] **Step 8: Run the statistics tests to verify they pass**

Run: `node --test test/stats.test.mjs`
Expected: PASS, including the invariant test.

- [ ] **Step 9: Switch fingerprint.mjs to measure-then-merge**

In `scripts/fingerprint.mjs`, replace `buildFingerprint`:

```js
export function buildFingerprint (projectRoot, config, { generated, source = 'measured', profileName = 'default' }) {
  const corpus = gatherCorpus(projectRoot, config, profileName)
  const perLocale = new Map()

  // Statistics are computed per FILE and merged, never over a joined blob.
  // Joining lets a text-level pattern match across the seam between two
  // unrelated documents, and it breaks the merge invariant in metrics.mjs.
  for (const file of corpus) {
    const bucket = perLocale.get(file.locale) ?? []
    bucket.push(statsFor({ strings: file.strings, headings: file.headings, locale: file.locale }))
    perLocale.set(file.locale, bucket)
  }

  const out = {}
  // Sorted so the artifact is stable across runs and diffs cleanly in git.
  for (const locale of [...perLocale.keys()].sort()) {
    out[locale] = fingerprintFromStats(mergeStats(perLocale.get(locale)), locale)
  }
  return { generated, source, byLocale: out, baseline: null }
}
```

Update its imports:

```js
import { gatherCorpus } from './lib/corpus.mjs'
import { statsFor, mergeStats, fingerprintFromStats } from './lib/metrics.mjs'
```

`byLocale` from `corpus.mjs` is now unused by `fingerprint.mjs`. Leave the export in place — `corpus.mjs` is a library and the function is still tested — but drop it from this import list.

- [ ] **Step 10: Run the whole suite**

Run: `node --test test/`
Expected: PASS. The existing `test/fingerprint.test.mjs` asserts structure and locale separation rather than exact metric values, so it passes unchanged. `test/metrics.test.mjs` may assert `universalMetrics`/`englishMetrics` directly; if so, rewrite those cases against `statsFor` + `fingerprintFromStats`, keeping the same expected numbers — every value must be unchanged except `medianSentenceLength`.

- [ ] **Step 11: Commit**

```bash
git add scripts/lib/hash.mjs scripts/lib/metrics.mjs scripts/fingerprint.mjs \
        test/hash.test.mjs test/stats.test.mjs test/metrics.test.mjs
git commit -m "feat: per-source sufficient statistics, merged into the fingerprint

Adds statsFor/mergeStats/fingerprintFromStats so every fingerprint metric
is recoverable from counts, sums, and a bounded sentence-length histogram.
This is what lets a source be analysed and then discarded: the aggregate
stays recomputable and any single source stays subtractable with no source
text present.

Two deliberate behaviour changes:
- buildFingerprint now measures per file and merges, rather than joining
  each locale's strings and measuring the blob. Joining allowed text-level
  patterns to match across the seam between two unrelated documents.
- medianSentenceLength is now bucket-accurate rather than exact, because a
  median cannot be merged from sums. Re-run with --set-baseline to refresh
  any baseline captured before this commit.

Adds sha256 helpers; a source's identity is its bytes, never its path."
```

---

### Task 3: Vendoring infrastructure

Third-party extraction, committed as pinned bytes rather than installed at runtime.

**Why vendor rather than depend.** The parent spec's zero-dependency rule exists to protect one thing: the same document must fingerprint identically on every machine, or two people derive different rules from the same corpus. Measured against that criterion, the three ways to get third-party parsing rank clearly:

| | reproducible? |
|---|---|
| a system tool (`pdftotext`, `soffice`) | **no** — present here, absent on Windows |
| an npm dependency resolved at install time | **no** — versions drift between installs |
| **a pinned bundle committed to the repo** | **yes** — byte-identical for everyone |

Vendoring is the most reproducible of the three, and more reproducible than hand-written code that keeps being tuned. Section 9 is amended accordingly, narrowly: no runtime installs, no shelling out, no version drift — vendored, pinned, license-compatible third-party code is allowed when it is committed and recorded.

**What gets vendored, and what it measured.** Both choices are evidence-based, against four real PDFs and a real `.docx`/`.odt` pair, scored by the Task 5 gate:

| Library | Size | License | Deps after bundling | Why |
|---|---|---|---|---|
| `pdfjs-dist` 4.10.38 | 1.8 MB | Apache-2.0 | none | 100% word recall vs `pdftotext` on 3 of 4 real PDFs, and passes the gate on all three. A hand-written extractor reached 96–98% and failed the gate on all four. `markitdown` reached 62–75% and mangled slide decks into markdown tables. |
| `officeparser` 7.8.0 | 0.5 MB bundled | MIT | none | Covers docx, pptx, xlsx, odt, odp, ods in one library. Text output was **identical** to a hand-written extractor on real files, so this buys maintenance rather than accuracy — the reason to take it is that six container formats stop being ours to own. |

`officeparser` installs to a 135 MB tree because it pulls `tesseract.js` (OCR) and its own copy of `pdfjs-dist`. Both are excluded at bundle time: OCR is the model tier's job in this design, and PDF is handled by the vendored pdfjs directly. What remains bundles to 499 KB.

**Files:**
- Create: `vendor/pdfjs/`, `vendor/officeparser/`, `vendor/README.md`, `scripts/vendor.mjs`
- Modify: `package.json` — a `vendor` script and the build-time devDependencies
- Modify: `test/conformance.test.mjs` — exclude `vendor/` from the plugin-source sweeps
- Test: `test/vendor.test.mjs`

**Interfaces:**
- Produces: `vendor/manifest.json` recording each library's name, version, license, source URL, and the sha256 of every vendored file. `scripts/vendor.mjs` regenerates the tree and rewrites the manifest.

- [ ] **Step 1: Write the failing test**

`test/vendor.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { readTextFile } from '../scripts/lib/fsx.mjs'
import { sha256File } from '../scripts/lib/hash.mjs'

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
```

Note: the last test needs `createRequire` in an ESM test file — add `import { createRequire } from 'node:module'` and `const require = createRequire(import.meta.url)`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/vendor.test.mjs`
Expected: FAIL — `vendor/manifest.json` does not exist.

- [ ] **Step 3: Write `scripts/vendor.mjs`**

This runs on a maintainer's machine, never on a user's. It is the only place `npm` is invoked, and its output is what ships.

```js
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdirSync, cpSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { writeTextFile } from './lib/fsx.mjs'
import { sha256File } from './lib/hash.mjs'
import { writeOut, die } from './lib/cli.mjs'

/**
 * Regenerate vendor/ from pinned upstream versions.
 *
 * MAINTAINER TOOL ONLY. This is the single file in the repository allowed to
 * use child_process or npm, because it never runs on a user's machine - its
 * committed output does. The conformance sweep excludes it for that reason and
 * that reason alone.
 *
 * Bump a version here, run `npm run vendor`, review the diff, commit. The
 * manifest's hashes are what let test/vendor.test.mjs prove the committed
 * bytes are the bytes this script produced.
 */

const ROOT = path.resolve(import.meta.dirname, '..')
const VENDOR = path.join(ROOT, 'vendor')
const WORK = path.join(VENDOR, '.work')

const PINNED = {
  'pdfjs-dist': {
    version: '4.10.38',
    license: 'Apache-2.0',
    source: 'https://github.com/mozilla/pdf.js',
    // The legacy build is the one that runs under plain Node without a DOM.
    copy: [
      ['legacy/build/pdf.min.mjs', 'pdfjs/pdf.min.mjs'],
      ['legacy/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs'],
      ['LICENSE', 'pdfjs/LICENSE']
    ]
  },
  officeparser: {
    version: '7.8.0',
    license: 'MIT',
    source: 'https://github.com/harshankur/officeParser',
    bundle: {
      entry: "module.exports = require('officeparser')",
      out: 'officeparser/officeparser.cjs',
      // tesseract.js is OCR - the model tier's job here, and 100+ MB.
      // pdfjs-dist is vendored separately and used directly.
      external: ['tesseract.js', 'pdfjs-dist', 'canvas', 'sharp']
    },
    copy: [['LICENSE', 'officeparser/LICENSE']]
  }
}

function npmInstall (name, version) {
  mkdirSync(WORK, { recursive: true })
  writeTextFile(path.join(WORK, 'package.json'), JSON.stringify({ private: true }, null, 2))
  execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', `${name}@${version}`], {
    cwd: WORK, stdio: 'inherit'
  })
  return path.join(WORK, 'node_modules', name)
}

function main () {
  rmSync(VENDOR, { recursive: true, force: true })
  mkdirSync(VENDOR, { recursive: true })
  const libraries = {}

  for (const [name, spec] of Object.entries(PINNED)) {
    writeOut(`vendor: installing ${name}@${spec.version}\n`)
    const installed = npmInstall(name, spec.version)

    const actual = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8')).version
    if (actual !== spec.version) die(`${name} resolved to ${actual}, expected ${spec.version}`)

    for (const [from, to] of spec.copy ?? []) {
      const src = path.join(installed, from)
      if (!existsSync(src)) die(`${name}: ${from} not found upstream`)
      mkdirSync(path.dirname(path.join(VENDOR, to)), { recursive: true })
      cpSync(src, path.join(VENDOR, to))
    }

    if (spec.bundle) {
      const entry = path.join(WORK, `entry-${name}.cjs`)
      writeTextFile(entry, spec.bundle.entry)
      const out = path.join(VENDOR, spec.bundle.out)
      mkdirSync(path.dirname(out), { recursive: true })
      execFileSync('npx', [
        'esbuild', entry, '--bundle', '--platform=node', '--format=cjs', '--minify',
        ...spec.bundle.external.map((e) => `--external:${e}`),
        `--outfile=${out}`, '--log-level=error'
      ], { cwd: WORK, stdio: 'inherit' })
    }

    const files = {}
    for (const [, to] of spec.copy ?? []) files[to] = sha256File(path.join(VENDOR, to))
    if (spec.bundle) files[spec.bundle.out] = sha256File(path.join(VENDOR, spec.bundle.out))

    libraries[name] = { version: spec.version, license: spec.license, source: spec.source, files }
  }

  rmSync(WORK, { recursive: true, force: true })
  writeTextFile(path.join(VENDOR, 'manifest.json'), `${JSON.stringify({ libraries }, null, 2)}\n`)
  writeOut('vendor: wrote vendor/manifest.json\n')
}

main()
```

- [ ] **Step 4: Add the build-time scripts to package.json**

Only `esbuild` is added, and only as a `devDependency`. Nothing is installed on a user's machine; the committed bundle is what runs.

```json
{
  "scripts": {
    "test": "node --test test/",
    "vendor": "node scripts/vendor.mjs"
  },
  "devDependencies": {
    "esbuild": "^0.24.0"
  }
}
```

- [ ] **Step 5: Write `vendor/README.md`**

```markdown
# Vendored libraries

Third-party extraction code, committed as pinned bytes.

**Why committed and not depended on.** The plugin's guarantee is that the same
document fingerprints identically on every machine — otherwise two people
derive different voice rules from the same corpus. A system tool is absent on
half of them; an npm dependency drifts between installs. A pinned bundle in the
repository is byte-identical for everyone.

| Library | Version | License | Used for |
|---|---|---|---|
| pdfjs-dist | 4.10.38 | Apache-2.0 | PDF text |
| officeparser | 7.8.0 | MIT | docx, pptx, xlsx, odt, odp, ods |

OCR (`tesseract.js`) is deliberately excluded: scanned documents go to the model
tier, which reads them with vision and marks the result `estimated`.

**To update:** bump the version in `scripts/vendor.mjs`, run `npm run vendor`,
review the diff, commit. `test/vendor.test.mjs` verifies the committed bytes
match the manifest's hashes.

**After any bump, every source extracted by the changed library must be marked
stale** so its numbers are recomputed rather than silently shifting. Each index
entry records which extractor and version produced it for exactly this reason.
```

- [ ] **Step 6: Exclude vendor/ from the conformance sweeps**

`test/conformance.test.mjs` enforces the parent spec's section 9 rules over every file in the plugin tree. Vendored code is not ours to reformat, so exclude `vendor/` from the BOM, ASCII, and line-ending sweeps — and add one rule of its own:

```js
const VENDOR = 'vendor'

test('only the vendoring tool may use npm or a child process', () => {
  for (const file of allPluginScripts()) {
    if (file.includes(VENDOR)) continue
    if (file.endsWith(path.join('scripts', 'vendor.mjs'))) continue  // the one exception, by design
    const body = readTextFile(file)
    assert.ok(
      !/child_process|execSync|execFileSync|spawnSync/.test(body),
      `${file} spawns a process; only scripts/vendor.mjs may, and it never runs on a user machine`
    )
  }
})
```

- [ ] **Step 7: Run the vendoring and the tests**

```bash
npm install          # esbuild, build-time only
npm run vendor
node --test test/vendor.test.mjs test/conformance.test.mjs
```

Expected: `vendor/` holds roughly 2.3 MB across four files plus two LICENSE files and a manifest, and both test files pass.

- [ ] **Step 8: Commit**

```bash
git add vendor package.json package-lock.json scripts/vendor.mjs test/vendor.test.mjs test/conformance.test.mjs
git commit -m "feat: vendor pdfjs-dist and officeparser as pinned committed bundles

Amends the zero-dependency rule to what it actually protects: the same
document must fingerprint identically on every machine. A system tool is
absent on half of them and an npm dependency drifts between installs, so a
pinned bundle in the repository is the most reproducible of the three - more
so than hand-written code that keeps being tuned.

Chosen on measurement. pdfjs reached 100 percent word recall against
pdftotext on three of four real PDFs and passed the quality gate on all
three; a hand-written extractor managed 96-98 percent and passed none.
officeparser matched hand-written output exactly on real docx and odt, so
it is taken for maintenance rather than accuracy - six container formats
stop being ours to own.

tesseract.js and a duplicate pdfjs are excluded at bundle time, taking
officeparser from a 135 MB install tree to a 499 KB file. OCR belongs to
the model tier. scripts/vendor.mjs is the only file permitted to use npm or
a child process, and it never runs on a user's machine."
```

---

### Task 4: Wire the Office formats

Six container formats through one vendored library. What used to be a ZIP reader plus an XML tag-stripper is now an adapter: normalise `officeparser`'s output into the `{ strings, headings }` shape the rest of the pipeline already consumes.

The adapter earns its place. `officeparser` returns one flat blob by default, and the fingerprint needs paragraph boundaries — `paragraphCount` and `meanParagraphLength` are real metrics, and a single 4,000-word paragraph would distort both.

**Files:**
- Create: `scripts/lib/office.mjs`
- Test: `test/office.test.mjs`

**Interfaces:**
- Consumes: `vendor/officeparser/officeparser.cjs` via `createRequire`.
- Produces: `extractOffice(buf, format) -> Promise<{ strings, headings, note }>`; `OFFICE_FORMATS` (the `Set` of formats it handles); `OFFICE_EXTRACTOR` (`{ name: 'officeparser', version }` read from `vendor/manifest.json`, stamped onto every index entry it produces).

> **Note the signature change.** `extractOffice` is **async** — `officeparser` is promise-based. That makes `extractSource` and `ingestFile` in Task 10 async too, and `runIngest` in Task 11 with them. Task 13 already made `main` async for URL fetching, so the CLI shape is unchanged; just `await` throughout.

- [ ] **Step 1: Write the failing test**

`test/office.test.mjs`. Fixtures are generated rather than committed, so no binaries enter the repo. `textutil` exists only on macOS, so the generator falls back to a hand-built minimal OOXML archive elsewhere — and the hand-built path is the one CI exercises.

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { extractOffice, OFFICE_FORMATS, OFFICE_EXTRACTOR } from '../scripts/lib/office.mjs'

/** Minimal but real ZIP writer, so fixtures are explicit and cross-platform. */
function makeZip (entries) { /* identical to the builder in the ZIP notes below */ }

const docx = (bodyXml) => makeZip([
  { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
  { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
  { name: 'word/document.xml', data: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>` }
])

test('the extractor stamps its own identity for the index', () => {
  assert.equal(OFFICE_EXTRACTOR.name, 'officeparser')
  assert.match(OFFICE_EXTRACTOR.version, /^\d+\.\d+\.\d+$/)
})

test('every container format this plugin claims is routed', () => {
  assert.deepEqual([...OFFICE_FORMATS].sort(), ['docx', 'odp', 'ods', 'odt', 'pptx', 'xlsx'])
})

test('docx paragraphs stay separate, because paragraph count is a real metric', async () => {
  const buf = docx(`
    <w:p><w:r><w:t>Your campaign is scheduled.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Nice work.</w:t></w:r></w:p>`)
  const out = await extractOffice(buf, 'docx')

  assert.deepEqual(out.strings, ['Your campaign is scheduled.', 'Nice work.'])
  assert.equal(out.note, 'ok')
})

test('runs split mid-word are rejoined without a space', async () => {
  // Word splits single words across runs routinely. A joining space would
  // invent word boundaries and inflate wordCount - the corruption the quality
  // gate exists to catch.
  const out = await extractOffice(docx('<w:p><w:r><w:t>cam</w:t></w:r><w:r><w:t>paign</w:t></w:r></w:p>'), 'docx')
  assert.deepEqual(out.strings, ['campaign'])
})

test('diacritics and entities survive', async () => {
  const out = await extractOffice(
    docx('<w:p><w:r><w:t>Va&#353;e kampa&#328; &amp; podm&#237;nky</w:t></w:r></w:p>'), 'docx')
  assert.deepEqual(out.strings, ['Vaše kampaň & podmínky'])
})

test('an unreadable container rejects, so the caller can record a reason', async () => {
  await assert.rejects(() => extractOffice(Buffer.from('not a zip at all'), 'docx'))
})

test('a container with no text resolves to empty rather than rejecting', async () => {
  const out = await extractOffice(docx(''), 'docx')
  assert.deepEqual(out.strings, [])
  assert.equal(out.note, 'no-text-layer')
})

test('an unsupported format is refused by name', async () => {
  await assert.rejects(() => extractOffice(Buffer.alloc(4), 'keynote'), /unsupported office format/)
})
```

Reuse the `makeZip` helper verbatim from the ZIP fixture notes at the end of this task — it is the same 40 lines the earlier draft of this plan tested directly, now used only to build fixtures.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/office.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/office.mjs'`

- [ ] **Step 3: Implement office.mjs**

```js
import path from 'node:path'
import { createRequire } from 'node:module'
import { readTextFile } from './fsx.mjs'

/**
 * Office and OpenDocument text, through the vendored officeparser bundle.
 *
 * This file is an ADAPTER, not a parser. officeparser returns one flat blob;
 * the fingerprint needs paragraph boundaries, because paragraphCount and
 * meanParagraphLength are real metrics and a single 4,000-word paragraph would
 * distort both. Splitting the delimited output back into paragraphs is the
 * whole job.
 *
 * Chosen on measurement, not reputation: on real .docx and .odt files its text
 * was identical to a hand-written extractor. It is here so that six container
 * formats stop being ours to maintain, not because it reads them better.
 */

const require = createRequire(import.meta.url)
const VENDOR = path.resolve(import.meta.dirname, '..', '..', 'vendor')

export export const OFFICE_EXTRACTOR = Object.freeze({
  name: 'officeparser',
  version: JSON.parse(readTextFile(path.join(VENDOR, 'manifest.json'))).libraries.officeparser.version
})

// A delimiter officeparser will not emit on its own, so splitting on it
// recovers exactly the paragraph boundaries it was asked to mark.
const PARAGRAPH = '\u0001'

let cached = null
function officeparser () {
  if (!cached) cached = require(path.join(VENDOR, 'officeparser', 'officeparser.cjs'))
  return cached
}

export async function extractOffice (buf, format) {
  if (!OFFICE_FORMATS.has(format)) throw new Error(`unsupported office format: ${format}`)

  const parsed = await officeparser().parseOffice(buf, {
    newlineDelimiter: PARAGRAPH,
    ignoreNotes: false,
    outputErrorToConsole: false
  })
  const raw = await parsed.toText()

  const strings = String(raw)
    .split(PARAGRAPH)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  return {
    strings,
    // No container format carries a heading concept this plugin can trust:
    // a docx style name is editable and a pptx title placeholder is
    // positional. Guessing would feed headingTitleCaseRatio a guess.
    headings: [],
    note: strings.length ? 'ok' : 'no-text-layer'
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/office.test.mjs`
Expected: PASS.

If `parseOffice(...).toText()` is not the API surface of the pinned version, check it against the vendored bundle rather than the upstream README — that call shape was verified against 7.8.0 specifically:

```bash
node -e "const op=require('./vendor/officeparser/officeparser.cjs'); console.log(Object.keys(op))"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/office.mjs test/office.test.mjs
git commit -m "feat: docx, pptx, xlsx, odt, odp and ods via vendored officeparser

An adapter, not a parser. officeparser returns one flat blob and the
fingerprint needs paragraph boundaries, because paragraphCount and
meanParagraphLength are real metrics that a single enormous paragraph would
distort - so the output is delimited and split back apart.

Headings are deliberately empty: no container format carries a heading
concept worth trusting, and guessing from a docx style name would feed
headingTitleCaseRatio a guess.

extractOffice is async, which makes extractSource, ingestFile and runIngest
async with it."
```

**ZIP fixture builder**, for `test/office.test.mjs`. Not shipped — it exists only so tests can construct real archives without committing binaries:

```js
import { deflateRawSync } from 'node:zlib'

const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

export function makeZip (entries) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const { name, data, store = false } of entries) {
    const raw = Buffer.from(data, 'utf8')
    const body = store ? raw : deflateRawSync(raw)
    const nameBuf = Buffer.from(name, 'utf8')

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(store ? 0 : 8, 8)
    local.writeUInt32LE(crc32(raw), 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    nameBuf.copy(local, 30)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(store ? 0 : 8, 10)
    central.writeUInt32LE(crc32(raw), 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)

    locals.push(local, body)
    centrals.push(central)
    offset += local.length + body.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralBuf, eocd])
}
```

---

### Task 5: The extraction quality gate

A bad extraction does not lose data, it manufactures it. `I V A Š TÍH LÁ` yields six tokens of mean length 1.8; `Onlineexerciseandtherapylessons` yields one of length 31. Both feed `meanWordLength`, `longWordRate`, `wordCount`, and `meanSentenceLength` — exactly the metrics the parent spec uses to justify `derived` rules. A confident, precise, wrong fingerprint is worse than the silent drop Task 1 removed.

The gate is what makes the ladder safe in both directions: it decides whether to trust the script tier, and it re-checks whatever the model tier returns.

Thresholds come from eight real extractions of four PDFs — a prototype extractor against `pdftotext` as ground truth — recorded in spec section 7.3. **Do not adjust them without new measurements.**

**Files:**
- Create: `scripts/lib/quality.mjs`
- Test: `test/quality.test.mjs`

**Interfaces:**
- Consumes: nothing outside `node:`.
- Produces:
  - `SINGLE_LETTER_WORDS` — per-locale sets of legitimate one-character words.
  - `scoreExtraction(text, { locale, glyphRecall }) -> Quality` where `Quality` is `{ passed, reasons: string[], meanTokenLen, singleShare, long20Share, replShare, novowelShare, glyphRecall, tokens }`.
  - `QUALITY_THRESHOLDS` — the frozen table, exported so a test can assert the numbers rather than duplicating them.

- [ ] **Step 1: Write the failing test**

`test/quality.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreExtraction, QUALITY_THRESHOLDS } from '../scripts/lib/quality.mjs'

// The two real failure shapes, taken verbatim from the spec's measurements.
const SPLIT = 'I V A Š TÍH LÁ ADMIN IS TRATIV NÍ PRACOVNIC E 2 6-4 5 L ET DEMOGRAFIC KÉ ÚDAJE'
const MERGED = [
  'Mental wellness and stress relief for your employees ANYTIME AND ANYWHERE',
  'Onlineexerciseandtherapylessons and courses for employee health and mental well-being',
  'availableintheofficeandhome-office aplatformprovidingonlineyogaexercise'
].join('\n')
const SOUND = [
  'Mental wellness and stress relief for your employees.',
  'Online exercise and therapy lessons and courses for employee health.',
  'Available in the office and on home-office days.'
].join('\n')

test('the thresholds are exactly the calibrated values from the spec', () => {
  assert.deepEqual(QUALITY_THRESHOLDS, {
    long20Share: 0.015,
    singleShare: 0.10,
    replShare: 0.005,
    glyphRecall: 0.5
  })
})

test('a sound extraction passes', () => {
  const q = scoreExtraction(SOUND, { locale: 'en' })
  assert.equal(q.passed, true)
  assert.deepEqual(q.reasons, [])
  assert.ok(q.long20Share <= QUALITY_THRESHOLDS.long20Share)
})

test('merged words fail on long20Share', () => {
  const q = scoreExtraction(MERGED, { locale: 'en' })
  assert.equal(q.passed, false)
  assert.ok(q.reasons.some((r) => r.startsWith('long20Share')), q.reasons.join('; '))
})

test('split words fail on singleShare', () => {
  const q = scoreExtraction(SPLIT, { locale: 'cs' })
  assert.equal(q.passed, false)
  assert.ok(q.reasons.some((r) => r.startsWith('singleShare')), q.reasons.join('; '))
})

test("a locale's real single-letter words do not count against it", () => {
  // Czech prepositions v/k/s/z/o/u are legitimate one-character words. Scoring
  // them as split-word evidence would fail every sound Czech extraction.
  const czech = 'Jdeme k lekci v sale u nas a potom o tom napiseme neco delsiho nez to'
  const q = scoreExtraction(czech, { locale: 'cs' })
  assert.equal(q.passed, true, q.reasons.join('; '))
  assert.ok(q.singleShare < 0.10)
  assert.ok(q.tokens > 10)
})

test('a locale with no single-letter list still scores, treating none as legitimate', () => {
  const q = scoreExtraction('a b c d e f g h i j', { locale: 'xx' })
  assert.equal(q.passed, false)
  assert.ok(q.reasons.some((r) => r.startsWith('singleShare')))
})

test('replacement characters fail the gate', () => {
  const text = `${SOUND} ${'� '.repeat(20)}`
  const q = scoreExtraction(text, { locale: 'en' })
  assert.equal(q.passed, false)
  assert.ok(q.reasons.some((r) => r.startsWith('replShare')))
})

test('low glyph recall fails, and an absent recall figure is not held against a caller', () => {
  assert.equal(scoreExtraction(SOUND, { locale: 'en', glyphRecall: 0.2 }).passed, false)
  assert.equal(scoreExtraction(SOUND, { locale: 'en', glyphRecall: 0.9 }).passed, true)
  assert.equal(scoreExtraction(SOUND, { locale: 'en' }).passed, true)
  assert.equal(scoreExtraction(SOUND, { locale: 'en' }).glyphRecall, null)
})

test('advisory signals are reported but never fail the gate on their own', () => {
  // German compounding legitimately raises mean token length well past English.
  const german = 'Mitarbeiterzufriedenheit und Krankenversicherungsbeitraege bestimmen unsere Arbeitsplatzkultur nachhaltig'
  const q = scoreExtraction(german, { locale: 'de' })
  assert.equal(q.passed, true, q.reasons.join('; '))
  assert.ok(q.meanTokenLen > 12, 'the advisory signal is still recorded')
})

test('empty text fails rather than passing vacuously', () => {
  const q = scoreExtraction('', { locale: 'en' })
  assert.equal(q.passed, false)
  assert.deepEqual(q.reasons, ['empty: no tokens recovered'])
  assert.equal(q.tokens, 0)
})

test('every returned figure is a finite number or null, never NaN', () => {
  for (const sample of ['', SOUND, SPLIT, MERGED]) {
    const q = scoreExtraction(sample, { locale: 'en' })
    for (const [key, value] of Object.entries(q)) {
      if (typeof value !== 'number') continue
      assert.ok(Number.isFinite(value), `${key} is NaN for sample of length ${sample.length}`)
    }
  }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/quality.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/quality.mjs'`

- [ ] **Step 3: Implement quality.mjs**

`scripts/lib/quality.mjs`:

```js
/**
 * Does this extraction deserve to be trusted?
 *
 * The tier boundary in the ingest ladder is NOT the file format - it is this
 * gate. A script parser attempts every source; whatever it returns is scored
 * here, and only a genuine failure escalates to the model. Whatever the model
 * returns is scored here too.
 *
 * Thresholds are calibrated, not chosen: they come from eight real extractions
 * of four PDFs, a prototype parser measured against pdftotext as ground truth.
 * Spec section 7.3 records the numbers. Do not adjust them without new
 * measurements.
 *
 *   signal          sound            broken           threshold
 *   long20Share     0.0034 - 0.0051  0.0284 - 0.0357  > 0.015 fails
 *   singleShare     0.000  - 0.006   0.191            > 0.10  fails
 *   meanTokenLen    5.46   - 6.12    3.47 / 7.19-7.62 advisory only
 *
 * What it catches: gross failure, in both directions. long20Share catches
 * merged words ("Onlineexerciseandtherapylessons"), singleShare catches split
 * words ("I V A S TIH LA"). What it does NOT catch: subtle degradation, such
 * as an extraction losing five percent of its spaces. The remedy for that is a
 * better extractor - see the width-based spacing work in pdf.mjs - not a
 * tighter threshold here.
 */

export const QUALITY_THRESHOLDS = Object.freeze({
  long20Share: 0.015,
  singleShare: 0.10,
  replShare: 0.005,
  glyphRecall: 0.5
})

/**
 * One-character words that are ordinary in a given language. Without this,
 * every sound Czech extraction fails: v, k, s, z, o, u are prepositions and
 * a, i are conjunctions, so real Czech prose is full of single-letter tokens.
 * A locale absent from this table is scored with no allowances, which is
 * conservative - it can produce a false escalation, never a false pass.
 */
export const SINGLE_LETTER_WORDS = Object.freeze({
  en: new Set(['a', 'i', 'o']),
  cs: new Set(['a', 'i', 'k', 'o', 's', 'u', 'v', 'z']),
  sk: new Set(['a', 'i', 'k', 'o', 's', 'u', 'v', 'z']),
  de: new Set([]),
  fr: new Set(['a', 'y']),
  es: new Set(['a', 'e', 'o', 'u', 'y']),
  it: new Set(['a', 'e', 'i', 'o'])
})

const VOWELS = /[aeiouyáéíóúůýěäöüåøæàèìòùâêîôû]/i

const round = (value, places) => Number(value.toFixed(places))

function tokenize (text) {
  return String(text)
    .split(/\s+/)
    .map((token) => token.replace(/^\p{P}+|\p{P}+$/gu, ''))
    .filter((token) => token.length > 0 && /\p{L}/u.test(token))
}

export function scoreExtraction (text, { locale = 'en', glyphRecall = null } = {}) {
  const source = String(text ?? '')
  const tokens = tokenize(source)
  const n = tokens.length

  const base = {
    tokens: n,
    meanTokenLen: 0,
    singleShare: 0,
    long20Share: 0,
    replShare: 0,
    novowelShare: 0,
    glyphRecall: glyphRecall === null ? null : round(glyphRecall, 3)
  }

  if (n === 0) return { ...base, passed: false, reasons: ['empty: no tokens recovered'] }

  const allowed = SINGLE_LETTER_WORDS[String(locale).slice(0, 2).toLowerCase()] ?? new Set()
  const singles = tokens.filter((t) => t.length === 1 && !allowed.has(t.toLowerCase())).length
  const long20 = tokens.filter((t) => t.length > 20).length
  const novowel = tokens.filter((t) => t.length > 3 && !VOWELS.test(t)).length
  const replacements = (source.match(/�/g) || []).length

  const scored = {
    tokens: n,
    meanTokenLen: round(tokens.reduce((sum, t) => sum + t.length, 0) / n, 2),
    singleShare: round(singles / n, 3),
    long20Share: round(long20 / n, 4),
    replShare: round(replacements / n, 4),
    novowelShare: round(novowel / n, 3),
    glyphRecall: base.glyphRecall
  }

  const reasons = []
  if (scored.long20Share > QUALITY_THRESHOLDS.long20Share) {
    reasons.push(`long20Share ${scored.long20Share} exceeds ${QUALITY_THRESHOLDS.long20Share} (words look merged)`)
  }
  if (scored.singleShare > QUALITY_THRESHOLDS.singleShare) {
    reasons.push(`singleShare ${scored.singleShare} exceeds ${QUALITY_THRESHOLDS.singleShare} (words look split)`)
  }
  if (scored.replShare > QUALITY_THRESHOLDS.replShare) {
    reasons.push(`replShare ${scored.replShare} exceeds ${QUALITY_THRESHOLDS.replShare} (decoding failed)`)
  }
  if (scored.glyphRecall !== null && scored.glyphRecall < QUALITY_THRESHOLDS.glyphRecall) {
    reasons.push(`glyphRecall ${scored.glyphRecall} below ${QUALITY_THRESHOLDS.glyphRecall} (text was lost)`)
  }

  return { ...scored, passed: reasons.length === 0, reasons }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/quality.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/quality.mjs test/quality.test.mjs
git commit -m "feat: calibrated extraction quality gate

Decides whether an extraction is trustworthy, which is the real tier
boundary in the ingest ladder - not the file format. Thresholds come from
eight measured extractions of four real PDFs against pdftotext, not from
intuition: long20Share catches merged words, singleShare catches split
words, and both separate sound from broken output by 7x or more.

Locale-sensitive signals stay advisory, and each locale's legitimate
single-letter words are excluded so sound Czech prose does not fail."
```

---

### Task 6: Wire PDF through vendored pdfjs

The riskiest part of this plan, reduced to an adapter by Task 3's vendoring.

**What the measurements settled.** Four real PDFs, scored by the Task 5 gate against `pdftotext` as ground truth:

| | hand-written | markitdown | **pdfjs-dist** |
|---|---|---|---|
| B2B_presentation_CZ | 98% ⚠️ | 70% ❌ | **100% ✅** |
| B2B_presentation_EN | 96% ⚠️ | 75% ❌ | **100% ✅** |
| vivido_onepager | 98% ⚠️ | 62% ❌ | **100% ✅** |
| Persona (Canva) | 0%, then 197% ❌ | 188% ❌ | 188% ❌ |
| passes the gate | never | never | **3 of 4** |

The hand-written parser recovered characters well — including Czech diacritics through `/ToUnicode` CMaps — but could not solve word spacing. A `Td`-delta heuristic tuned for a file that positions every glyph individually cost the presentations 15 points of recall. pdfjs does it properly, from font advance widths, and lands squarely in the gate's "sound extraction" band: `long20Share` 0.0034–0.0051, `singleShare` 0.000–0.006.

`markitdown` was rejected on evidence: it renders slide decks as markdown **tables**, so the corpus would be fingerprinting `| ---- | ---- |` instead of brand voice.

**The fourth file fails for everything, including `pdftotext`.** That Canva PDF genuinely encodes `A D M I N I S T R A T I V N Í` letter by letter. It is supposed to escalate to the model tier — the gate catching it is the system working, not a bug to chase.

**Files:**
- Create: `scripts/lib/pdf.mjs`
- Test: `test/pdf.test.mjs`

**Interfaces:**
- Consumes: `vendor/pdfjs/pdf.min.mjs` and `vendor/pdfjs/pdf.worker.min.mjs`.
- Produces: `extractPdf(buf) -> Promise<{ strings, headings, glyphRecall, note }>` — the same contract the ingest ladder already expects; `PDF_EXTRACTOR` (`{ name: 'pdfjs-dist', version }`). `note` is `ok`, `encrypted`, or `no-text-layer`.

- [ ] **Step 1: Write the failing test**

`test/pdf.test.mjs`. Fixtures are assembled from PDF syntax in the test — no binaries committed, and each case isolates one behaviour.

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { extractPdf, PDF_EXTRACTOR } from '../scripts/lib/pdf.mjs'

/** Assemble a syntactically valid PDF with a proper xref table. */
function makePdf (objects, { encrypt = false } = {}) {
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypt ? ' /Encrypt 99 0 R' : ''} >>\n`
  body += `startxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

function contentObj (content) {
  const z = deflateSync(Buffer.from(content, 'latin1')).toString('latin1')
  return `<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n${z}\nendstream`
}

const onePage = (content, fontExtras = '/BaseFont /Helvetica') => makePdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
    '/Resources << /Font << /F1 5 0 R >> >> >>',
  contentObj(content),
  `<< /Type /Font /Subtype /Type1 ${fontExtras} >>`
])

test('the extractor stamps its own identity for the index', () => {
  assert.equal(PDF_EXTRACTOR.name, 'pdfjs-dist')
  assert.match(PDF_EXTRACTOR.version, /^\d+\.\d+\.\d+$/)
})

test('text is extracted from a compressed content stream', async () => {
  const out = await extractPdf(onePage('BT /F1 12 Tf 72 700 Td (Your campaign is scheduled.) Tj ET'))
  assert.equal(out.note, 'ok')
  assert.match(out.strings.join(' '), /Your campaign is scheduled\./)
  assert.deepEqual(out.headings, [], 'a PDF carries no heading concept worth trusting')
})

test('words separated on the page do not merge, and letters within a word do not split', async () => {
  // The failure mode that decided this task. Both directions must hold.
  const out = await extractPdf(onePage(
    'BT /F1 12 Tf 72 700 Td [(Mental) -400 (wellness)] TJ 0 -20 Td [(Wa) -20 (ll)] TJ ET'
  ))
  const text = out.strings.join(' ')
  assert.match(text, /Mental wellness/, 'a wide kern is a word break')
  assert.match(text, /Wall/, 'a narrow kern is letter kerning, not a break')
})

test('a vertical move starts a new string', async () => {
  const out = await extractPdf(onePage(
    'BT /F1 12 Tf 72 700 Td (First line) Tj 0 -20 Td (Second line) Tj ET'
  ))
  assert.equal(out.strings.length >= 2, true, out.strings.join(' | '))
  assert.match(out.strings[0], /First line/)
})

test('an encrypted pdf is refused with a reason rather than yielding garbage', async () => {
  const out = await extractPdf(makePdf([contentObj('BT (x) Tj ET')], { encrypt: true }))
  assert.equal(out.note, 'encrypted')
  assert.deepEqual(out.strings, [])
})

test('a pdf with no text layer reports no-text-layer, which is the scanned case', async () => {
  const out = await extractPdf(makePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'
  ]))
  assert.equal(out.note, 'no-text-layer')
  assert.deepEqual(out.strings, [])
  assert.equal(out.glyphRecall, 0)
})

test('a truncated or malformed pdf resolves rather than throwing', async () => {
  for (const junk of ['', '%PDF-1.4', '%PDF-1.4\n1 0 obj\n<< /Length 99 >>\nstream\ntrunc']) {
    const out = await extractPdf(Buffer.from(junk, 'latin1'))
    assert.ok(Array.isArray(out.strings), `threw for ${JSON.stringify(junk)}`)
    assert.notEqual(out.note, 'ok')
  }
})

test('nothing is written to stdout or stderr while parsing', async () => {
  // pdfjs warns liberally about fonts. Parent spec section 9 keeps stdout
  // ASCII and quiet, and a scan printing font warnings would be unusable.
  const chunks = []
  const realOut = process.stdout.write.bind(process.stdout)
  const realErr = process.stderr.write.bind(process.stderr)
  process.stdout.write = (c) => { chunks.push(c); return true }
  process.stderr.write = (c) => { chunks.push(c); return true }
  try {
    await extractPdf(onePage('BT /F1 12 Tf (Quiet please.) Tj ET'))
  } finally {
    process.stdout.write = realOut
    process.stderr.write = realErr
  }
  assert.deepEqual(chunks, [], `pdfjs printed: ${chunks.join('')}`)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/pdf.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/pdf.mjs'`

- [ ] **Step 3: Implement pdf.mjs**

```js
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readTextFile } from './fsx.mjs'

/**
 * PDF text through the vendored pdfjs bundle.
 *
 * An adapter, not a parser. Getting characters out of a PDF is
 * straightforward; getting the SPACES right is the hard part, and it is why
 * this is vendored. A hand-written extractor reached 96-98 percent word recall
 * on real files and still failed the quality gate on every one, because a
 * Td-delta heuristic tuned for a document that positions each glyph
 * individually merges whole phrases in a document that positions runs. pdfjs
 * derives spacing from font advance widths and lands inside the gate's sound
 * band on the same files.
 *
 * Spacing here is reconstructed from each item's x position against where the
 * previous item ended - pdfjs gives both, so no heuristic constant is needed
 * beyond "did the pen actually move further than the glyph was wide".
 */

const VENDOR = path.resolve(import.meta.dirname, '..', '..', 'vendor', 'pdfjs')

export const PDF_EXTRACTOR = Object.freeze({
  name: 'pdfjs-dist',
  version: JSON.parse(
    readTextFile(path.join(import.meta.dirname, '..', '..', 'vendor', 'manifest.json'))
  ).libraries['pdfjs-dist'].version
})

let cached = null
async function pdfjs () {
  if (cached) return cached
  const mod = await import(pathToFileURL(path.join(VENDOR, 'pdf.min.mjs')).href)
  mod.GlobalWorkerOptions.workerSrc = fileURLToPath(pathToFileURL(path.join(VENDOR, 'pdf.worker.min.mjs')))
  cached = mod
  return mod
}

/** pdfjs warns about fonts constantly; spec section 9 keeps stdout quiet. */
async function quietly (fn) {
  const outWrite = process.stdout.write.bind(process.stdout)
  const errWrite = process.stderr.write.bind(process.stderr)
  const { warn, error, log } = console
  process.stdout.write = () => true
  process.stderr.write = () => true
  console.warn = console.error = console.log = () => {}
  try {
    return await fn()
  } finally {
    process.stdout.write = outWrite
    process.stderr.write = errWrite
    Object.assign(console, { warn, error, log })
  }
}

const EMPTY = { strings: [], headings: [], glyphRecall: 0, note: 'no-text-layer' }

export async function extractPdf (buf) {
  if (!buf || buf.length === 0) return { ...EMPTY }

  return quietly(async () => {
    const lib = await pdfjs()
    let doc
    try {
      doc = await lib.getDocument({
        data: new Uint8Array(buf),
        useSystemFonts: true,
        disableFontFace: true,
        isEvalSupported: false,   // no eval in a plugin that reads untrusted files
        stopAtErrors: false       // a damaged page should not lose the whole document
      }).promise
    } catch (error) {
      if (/password|encrypt/i.test(error?.message ?? '')) {
        return { strings: [], headings: [], glyphRecall: 0, note: 'encrypted' }
      }
      return { ...EMPTY }
    }

    const strings = []
    let expected = 0
    let emitted = 0

    for (let page = 1; page <= doc.numPages; page++) {
      let items
      try {
        items = (await (await doc.getPage(page)).getTextContent()).items
      } catch {
        continue   // one unreadable page is not the whole document
      }

      let line = ''
      let penEnd = null
      const flush = () => {
        const trimmed = line.replace(/\s+/g, ' ').trim()
        if (trimmed) strings.push(trimmed)
        line = ''
      }

      for (const item of items) {
        if (typeof item.str !== 'string') continue
        expected += item.str.length
        emitted += item.str.replace(/�/g, '').length

        const x = item.transform?.[4] ?? 0
        // A gap beyond where the previous item ended is a word break. pdfjs
        // already reports each item's own width, so this needs no constant.
        if (penEnd !== null && x - penEnd > 1 && line && !line.endsWith(' ')) line += ' '
        line += item.str
        penEnd = x + (item.width ?? 0)
        if (item.hasEOL) { flush(); penEnd = null }
      }
      flush()
    }

    await doc.destroy?.()

    if (strings.length === 0) return { ...EMPTY }
    return {
      strings,
      headings: [],
      glyphRecall: expected ? Number((emitted / expected).toFixed(3)) : 0,
      note: 'ok'
    }
  })
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/pdf.test.mjs`
Expected: PASS

- [ ] **Step 5: Verify against real PDFs**

Synthetic fixtures prove the wiring; real files prove the choice. Point it at genuine PDFs and check the gate agrees:

```bash
node --input-type=module -e "
  import { extractPdf } from './scripts/lib/pdf.mjs'
  import { scoreExtraction } from './scripts/lib/quality.mjs'
  import { readFileSync } from 'node:fs'
  for (const f of process.argv.slice(1)) {
    const out = await extractPdf(readFileSync(f))
    const q = scoreExtraction(out.strings.join('\n'), { locale: 'cs' })
    console.log(f, '|', out.note, '| tokens', q.tokens, '| passed', q.passed, '|', q.reasons.join('; '))
  }
" -- <path-to-a-real.pdf> ...
```

Expected: a text-layer PDF reports `ok` and `passed true`, with `long20Share` near 0.004. A letter-spaced or scanned PDF reports `passed false` and escalates — that is correct behaviour, not a defect to fix.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pdf.mjs test/pdf.test.mjs
git commit -m "feat: PDF text through the vendored pdfjs bundle

Getting characters out of a PDF is easy; getting the spaces right is the
whole problem, and it is why this is vendored rather than written here. A
hand-written extractor reached 96-98 percent word recall on four real PDFs
and still failed the quality gate on every one: a Td-delta heuristic tuned
for a file that positions each glyph individually merges whole phrases in a
file that positions runs. pdfjs derives spacing from font advance widths
and scores inside the gate's sound band on the same files.

markitdown was measured and rejected - it renders slide decks as markdown
tables, so the corpus would fingerprint table syntax rather than voice.

pdfjs is silenced while parsing: it warns liberally about fonts, and spec
section 9 requires stdout stay quiet and ASCII."
```

---

### Task 7: RTF, subtitles, CSV, and the format registry

Three small parsers, then the wiring that lets everything built so far reach `formatFor()`. Subtitle files earn their place: a webinar or product-video transcript is unusually strong voice corpus, and `.vtt`/`.srt` are trivial to parse.

**Files:**
- Create: `scripts/lib/textish.mjs`
- Modify: `scripts/lib/extract.mjs` — add `BINARY_EXTENSIONS`, extend `COPY_EXTENSIONS`, add `isBinaryFormat`, route the new text formats through `extractStrings`
- Test: `test/textish.test.mjs`, `test/extract.test.mjs`

**Interfaces:**
- Consumes: `splitParagraphs` from `text.mjs`.
- Produces:
  - `extractRtf(raw) -> string[]`
  - `extractSubtitles(raw) -> string[]`
  - `extractDelimited(raw, delimiter) -> string[]`
  - From `extract.mjs`: `BINARY_EXTENSIONS` (extension to format for container formats), `isBinaryFormat(format) -> boolean`. `formatFor(path)` now resolves both tables.

- [ ] **Step 1: Write the failing test**

`test/textish.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractRtf, extractSubtitles, extractDelimited } from '../scripts/lib/textish.mjs'

test('rtf control words are dropped and text survives', () => {
  const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}
\f0\fs24 Your campaign is scheduled.\par
Nice work.\par}`
  assert.deepEqual(extractRtf(rtf), ['Your campaign is scheduled.', 'Nice work.'])
})

test('rtf hex escapes and unicode escapes decode', () => {
  // \'e9 is e-acute in the ANSI codepage; \u283? is a unicode escape with an
  // ASCII fallback character that must be discarded, not kept.
  assert.deepEqual(extractRtf(String.raw`{\rtf1 caf\'e9\par}`), ['café'])
  assert.deepEqual(extractRtf(String.raw`{\rtf1 \u283?ivot\par}`), ['ěivot'])
})

test('rtf groups marked ignorable are skipped entirely', () => {
  const rtf = String.raw`{\rtf1{\*\generator Word}Real copy.\par}`
  assert.deepEqual(extractRtf(rtf), ['Real copy.'])
})

test('vtt cues are extracted and timing lines dropped', () => {
  const vtt = [
    'WEBVTT', '', '1', '00:00:01.000 --> 00:00:04.000',
    'Welcome to the session.', '', '2', '00:00:04.500 --> 00:00:07.000',
    'We keep things short.', ''
  ].join('\n')
  assert.deepEqual(extractSubtitles(vtt), ['Welcome to the session.', 'We keep things short.'])
})

test('srt cues are extracted and a multi-line cue becomes one string', () => {
  const srt = [
    '1', '00:00:01,000 --> 00:00:04,000',
    'Welcome to the session,', 'and thanks for joining.', ''
  ].join('\n')
  assert.deepEqual(extractSubtitles(srt), ['Welcome to the session, and thanks for joining.'])
})

test('vtt cue settings and speaker tags do not leak into the text', () => {
  const vtt = [
    'WEBVTT', '', '00:00:01.000 --> 00:00:04.000 align:start position:10%',
    '<v Speaker>Hello there</v>', ''
  ].join('\n')
  assert.deepEqual(extractSubtitles(vtt), ['Hello there'])
})

test('delimited files yield cell values, not the numbers between them', () => {
  const csv = 'name,label,count\nsave,Save changes,12\ncancel,Discard and close,3\n'
  assert.deepEqual(
    extractDelimited(csv, ','),
    ['name', 'label', 'count', 'save', 'Save changes', 'cancel', 'Discard and close']
  )
})

test('quoted csv cells containing the delimiter stay whole', () => {
  const csv = 'a,b\n"Save, then close",Discard\n'
  assert.deepEqual(extractDelimited(csv, ','), ['a', 'b', 'Save, then close', 'Discard'])
})

test('tab-separated files work through the same path', () => {
  assert.deepEqual(extractDelimited('one\ttwo\n', '\t'), ['one', 'two'])
})
```

Append to `test/extract.test.mjs`:

```js
test('the format registry resolves container formats and marks them binary', () => {
  for (const [file, format] of [
    ['/a/b/guide.docx', 'docx'], ['/a/b/deck.PPTX', 'pptx'], ['/a/b/data.xlsx', 'xlsx'],
    ['/a/b/notes.odt', 'odt'], ['/a/b/slides.odp', 'odp'], ['/a/b/sheet.ods', 'ods'],
    ['/a/b/brand.pdf', 'pdf']
  ]) {
    assert.equal(formatFor(file), format, file)
    assert.equal(isBinaryFormat(formatFor(file)), true, file)
  }
})

test('the new text formats resolve and are not binary', () => {
  for (const [file, format] of [
    ['/a/b/notes.rtf', 'rtf'], ['/a/b/talk.vtt', 'subtitles'], ['/a/b/talk.srt', 'subtitles'],
    ['/a/b/strings.csv', 'csv'], ['/a/b/strings.tsv', 'tsv']
  ]) {
    assert.equal(formatFor(file), format, file)
    assert.equal(isBinaryFormat(formatFor(file)), false, file)
  }
})

test('a container extension never reaches the text extractor', () => {
  // extractStrings takes decoded text. Handing it a binary format would mean
  // the caller read a PDF as UTF-8, so it must refuse rather than return junk.
  assert.deepEqual(extractStrings('/a/b/guide.pdf', 'whatever'), { format: 'pdf', strings: [] })
})

test('rtf, subtitles and csv route through extractStrings', () => {
  assert.deepEqual(
    extractStrings('/a/b/x.csv', 'label,value\nSave changes,1\n').strings,
    ['label', 'value', 'Save changes']
  )
  assert.deepEqual(
    extractStrings('/a/b/x.srt', '1\n00:00:01,000 --> 00:00:02,000\nHello.\n').strings,
    ['Hello.']
  )
})
```

Ensure `test/extract.test.mjs` imports `formatFor` and `isBinaryFormat`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/textish.test.mjs test/extract.test.mjs`
Expected: FAIL — `textish.mjs` does not exist and `isBinaryFormat` is not exported.

- [ ] **Step 3: Implement textish.mjs**

`scripts/lib/textish.mjs`:

```js
/**
 * Small text-shaped formats that need a parser but not a container reader.
 *
 * Subtitles are here because a webinar or product-video transcript is
 * unusually good voice corpus - it is the brand talking, unedited - and the
 * format costs almost nothing to read.
 */

const RTF_ANSI_HIGH = {
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—'
}

/**
 * RTF is a brace-nested control language. Three things matter: a group opened
 * with {\* is ignorable and must be skipped whole, \'hh is a codepage byte,
 * and \uN? is a Unicode codepoint followed by an ASCII fallback character that
 * must be discarded rather than kept alongside it.
 */
export function extractRtf (raw) {
  const text = String(raw).replace(/\r\n?/g, '\n')
  const lines = []
  let current = ''
  let depth = 0
  let skipDepth = -1

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (ch === '{') {
      depth += 1
      if (text.startsWith('{\\*', i) && skipDepth < 0) skipDepth = depth
      continue
    }
    if (ch === '}') {
      if (skipDepth === depth) skipDepth = -1
      depth -= 1
      continue
    }
    if (skipDepth >= 0) continue

    if (ch !== '\\') {
      if (ch === '\n') continue
      current += ch
      continue
    }

    // A control word: backslash, letters, optional signed number, optional space.
    const control = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(text.slice(i))
    if (control) {
      const [whole, word, arg] = control
      i += whole.length - 1
      if (word === 'par' || word === 'line' || word === 'sect') {
        if (current.trim()) lines.push(current.replace(/\s+/g, ' ').trim())
        current = ''
      } else if (word === 'tab') {
        current += ' '
      } else if (word === 'u' && arg !== undefined) {
        current += String.fromCodePoint(Number(arg) < 0 ? Number(arg) + 65536 : Number(arg))
        // Skip the ASCII fallback that follows a \u escape.
        if (text[i + 1] === '?') i += 1
      }
      continue
    }

    const hex = /^\\'([0-9a-fA-F]{2})/.exec(text.slice(i))
    if (hex) {
      const code = parseInt(hex[1], 16)
      current += RTF_ANSI_HIGH[code] ?? String.fromCharCode(code)
      i += 3
      continue
    }

    // An escaped literal: \\ \{ \}
    current += text[i + 1] ?? ''
    i += 1
  }

  if (current.trim()) lines.push(current.replace(/\s+/g, ' ').trim())
  return lines
}

const TIMING = /-->/
const CUE_INDEX = /^\d+$/

/** WebVTT and SubRip. One cue becomes one string, however many lines it spans. */
export function extractSubtitles (raw) {
  const out = []
  let cue = []

  const flush = () => {
    const joined = cue.join(' ').replace(/\s+/g, ' ').trim()
    if (joined) out.push(joined)
    cue = []
  }

  for (const line of String(raw).replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') { flush(); continue }
    if (trimmed === 'WEBVTT' || trimmed.startsWith('NOTE ') || trimmed.startsWith('STYLE')) continue
    if (TIMING.test(trimmed)) continue          // timings, with or without cue settings
    if (CUE_INDEX.test(trimmed)) continue       // a bare cue number
    cue.push(trimmed.replace(/<[^>]*>/g, ''))   // speaker and styling tags
  }
  flush()
  return out
}

/** CSV/TSV cell values. Quoted cells may contain the delimiter and newlines. */
export function extractDelimited (raw, delimiter = ',') {
  const text = String(raw).replace(/\r\n?/g, '\n')
  const out = []
  let cell = ''
  let quoted = false

  const push = () => {
    const value = cell.trim()
    if (value) out.push(value)
    cell = ''
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') { cell += ch; continue }
      if (text[i + 1] === '"') { cell += '"'; i += 1; continue }
      quoted = false
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === delimiter || ch === '\n') { push(); continue }
    cell += ch
  }
  push()
  return out
}
```

- [ ] **Step 4: Extend the format registry in extract.mjs**

In `scripts/lib/extract.mjs`, add the new text extensions to `COPY_EXTENSIONS`:

```js
export const COPY_EXTENSIONS = {
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.markdown': 'markdown',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.po': 'po',
  '.pot': 'po',
  '.html': 'html',
  '.htm': 'html',
  '.txt': 'text',
  '.rtf': 'rtf',
  '.vtt': 'subtitles',
  '.srt': 'subtitles',
  '.csv': 'csv',
  '.tsv': 'tsv'
}

/**
 * Container formats. These hold bytes, not text, so a caller must read them
 * with readFileSync and no encoding and hand the Buffer to office.mjs or
 * pdf.mjs - never to extractStrings, which takes decoded text.
 */
export const BINARY_EXTENSIONS = {
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.xlsx': 'xlsx',
  '.odt': 'odt',
  '.odp': 'odp',
  '.ods': 'ods',
  '.pdf': 'pdf'
}

const BINARY_FORMATS = new Set(Object.values(BINARY_EXTENSIONS))

export function isBinaryFormat (format) {
  return BINARY_FORMATS.has(format)
}

export function formatFor (absPath) {
  const ext = path.extname(String(absPath)).toLowerCase()
  return COPY_EXTENSIONS[ext] || BINARY_EXTENSIONS[ext] || null
}
```

Add the import at the top of `extract.mjs`:

```js
import { extractRtf, extractSubtitles, extractDelimited } from './textish.mjs'
```

Extend the `switch` in `extractStrings`, before its `default`:

```js
    case 'rtf': return { format, strings: extractRtf(text) }
    case 'subtitles': return { format, strings: extractSubtitles(text) }
    case 'csv': return { format, strings: extractDelimited(text, ',') }
    case 'tsv': return { format, strings: extractDelimited(text, '\t') }
```

and make the binary refusal explicit at the top of the same function, right after the format lookup:

```js
export function extractStrings (absPath, raw) {
  const format = formatFor(absPath)
  if (!format) return { format: null, strings: [] }
  // A container format never reaches here with usable input: its bytes are not
  // text, so a caller that got this far read a PDF as UTF-8. Refuse rather than
  // return the mojibake that would poison every metric downstream.
  if (isBinaryFormat(format)) return { format, strings: [] }
  const text = String(raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  ...
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/textish.test.mjs test/extract.test.mjs`
Expected: PASS

- [ ] **Step 6: Run the whole suite**

Run: `node --test test/`
Expected: PASS. Note that `formatFor` now returns a format for `.pdf` and `.docx`, so Task 1's `skipped` test may need its fixture extensions changed to genuinely unsupported ones such as `.sketch` and `.fig`. Update it if so — the behaviour under test is unchanged.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/textish.mjs scripts/lib/extract.mjs \
        test/textish.test.mjs test/extract.test.mjs test/corpus.test.mjs test/scan.test.mjs
git commit -m "feat: rtf, subtitle and delimited extractors, plus the format registry

Adds RTF (control words, hex and unicode escapes, ignorable groups),
WebVTT/SubRip cues, and CSV/TSV cells. Subtitles are included because a
webinar transcript is the brand talking unedited, which is strong corpus.

formatFor now resolves container formats too, and isBinaryFormat tells a
caller to read bytes rather than text. extractStrings refuses a container
format outright instead of returning mojibake from a PDF read as UTF-8."
```

---

### Task 8: The source register

Today `walk()` is rooted at `projectRoot` and config globs are relative to it, so material outside the repository is unreachable by construction. The register is what lifts that limit, and it does so without breaking a single existing knowledge base: a config with no `sources:` key behaves exactly as it does now.

**Files:**
- Create: `scripts/lib/register.mjs`
- Modify: `scripts/lib/config.mjs` — add `sources` to `DEFAULT_CONFIG`
- Test: `test/register.test.mjs`

**Interfaces:**
- Consumes: `walk`, `toPosix` from `fsx.mjs`; `formatFor` from `extract.mjs`; `activeProfile`, `localeOf` from `config.mjs`.
- Produces:
  - `loadRegister(config, projectRoot, kbRoot) -> Entry[]` — synthesises a `project` entry from `scan` when `sources` is absent.
  - `expandHome(p) -> string` — `~` via `os.homedir()`, never a shell.
  - `resolveEntry(entry, { projectRoot, kbRoot, config, profileName }) -> Resolved` where `Resolved` is `{ id, kind, files: [{ abs, rel, origin, format, locale }], url, missing, skipped }`.
  - `resolveRegister(register, ctx) -> Resolved[]`
  - `nextRegisterId(register) -> string`

- [ ] **Step 1: Write the failing test**

`test/register.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs'
import {
  loadRegister, resolveEntry, resolveRegister, expandHome, nextRegisterId
} from '../scripts/lib/register.mjs'

const ctxFor = (dir, config = DEFAULT_CONFIG) => ({
  projectRoot: dir,
  kbRoot: path.join(dir, '.voice-and-tone'),
  config,
  profileName: 'default'
})

test('a config with no sources key synthesises a project entry from scan', () => {
  const config = { ...DEFAULT_CONFIG, scan: { include: ['docs/**/*.md'], exclude: ['dist/**'] } }
  const register = loadRegister(config, '/proj', '/proj/.voice-and-tone')

  assert.equal(register.length, 1)
  assert.equal(register[0].kind, 'project')
  assert.equal(register[0].id, 's01')
  assert.deepEqual(register[0].include, ['docs/**/*.md'])
  assert.deepEqual(register[0].exclude, ['dist/**'])
})

test('an explicit register is returned as written, in order', () => {
  const config = {
    ...DEFAULT_CONFIG,
    sources: [
      { id: 's01', kind: 'project', include: ['README.md'] },
      { id: 's02', kind: 'inbox', path: 'sources/' },
      { id: 's03', kind: 'url', url: 'https://acme.com/about' }
    ]
  }
  assert.deepEqual(
    loadRegister(config, '/proj', '/proj/.voice-and-tone').map((e) => e.kind),
    ['project', 'inbox', 'url']
  )
})

test('a project entry resolves against the project root, as today', () => {
  const dir = makeTmpProject({ 'docs/a.md': 'Copy.', 'dist/b.md': 'Built.' })
  try {
    const entry = { id: 's01', kind: 'project', include: ['docs/**/*.md'], exclude: ['dist/**'] }
    const resolved = resolveEntry(entry, ctxFor(dir))

    assert.deepEqual(resolved.files.map((f) => f.rel), ['docs/a.md'])
    assert.equal(resolved.files[0].format, 'markdown')
    assert.equal(resolved.missing, false)
  } finally {
    cleanup(dir)
  }
})

test('an inbox entry resolves under the KB and reports paths relative to it', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/sources/newsletters/jan.txt': 'A newsletter.',
    '.voice-and-tone/sources/brand.docx': 'container'
  })
  try {
    const resolved = resolveEntry({ id: 's02', kind: 'inbox', path: 'sources/' }, ctxFor(dir))

    assert.deepEqual(
      resolved.files.map((f) => f.origin).sort(),
      ['sources/brand.docx', 'sources/newsletters/jan.txt']
    )
    assert.deepEqual(resolved.files.map((f) => f.format).sort(), ['docx', 'text'])
  } finally {
    cleanup(dir)
  }
})

test('a local entry reaches outside the project root, which globs cannot', () => {
  const outside = makeTmpProject({ 'brand/guide.md': 'Our voice.' })
  const dir = makeTmpProject({})
  try {
    const entry = { id: 's03', kind: 'local', path: path.join(outside, 'brand') }
    const resolved = resolveEntry(entry, ctxFor(dir))

    assert.equal(resolved.files.length, 1)
    assert.equal(resolved.files[0].origin, path.join(outside, 'brand', 'guide.md'))
    assert.equal(resolved.missing, false)
  } finally {
    cleanup(outside)
    cleanup(dir)
  }
})

test('a local entry naming a single file resolves to that file', () => {
  const outside = makeTmpProject({ 'deck.md': 'Slides.' })
  const dir = makeTmpProject({})
  try {
    const resolved = resolveEntry(
      { id: 's03', kind: 'local', path: path.join(outside, 'deck.md') },
      ctxFor(dir)
    )
    assert.equal(resolved.files.length, 1)
    assert.equal(resolved.missing, false)
  } finally {
    cleanup(outside)
    cleanup(dir)
  }
})

test('an absent local path is missing, not an error - the ordinary state on a fresh clone', () => {
  const dir = makeTmpProject({})
  try {
    const resolved = resolveEntry(
      { id: 's03', kind: 'local', path: path.join(dir, 'nope', 'gone.pdf') },
      ctxFor(dir)
    )
    assert.equal(resolved.missing, true)
    assert.deepEqual(resolved.files, [])
  } finally {
    cleanup(dir)
  }
})

test('unsupported extensions under a source are skipped with their extension', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/sources/a.md': 'Copy.',
    '.voice-and-tone/sources/logo.sketch': 'nope'
  })
  try {
    const resolved = resolveEntry({ id: 's02', kind: 'inbox', path: 'sources/' }, ctxFor(dir))
    assert.deepEqual(resolved.files.map((f) => f.origin), ['sources/a.md'])
    assert.deepEqual(resolved.skipped, [{ origin: 'sources/logo.sketch', ext: '.sketch' }])
  } finally {
    cleanup(dir)
  }
})

test('a url entry resolves to no files and carries its url', () => {
  const dir = makeTmpProject({})
  try {
    const resolved = resolveEntry(
      { id: 's04', kind: 'url', url: 'https://acme.com/about' },
      ctxFor(dir)
    )
    assert.deepEqual(resolved.files, [])
    assert.equal(resolved.url, 'https://acme.com/about')
  } finally {
    cleanup(dir)
  }
})

test('locale attribution works the same for sources as for project files', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/sources/cs/newsletter.txt': 'Ahoj.',
    '.voice-and-tone/sources/en/newsletter.txt': 'Hello.'
  })
  try {
    const config = {
      ...DEFAULT_CONFIG,
      profiles: { default: { name: 'Acme', primary_locale: 'en', locales: ['en', 'cs'] } }
    }
    const resolved = resolveEntry(
      { id: 's02', kind: 'inbox', path: 'sources/' },
      ctxFor(dir, config)
    )
    const byOrigin = Object.fromEntries(resolved.files.map((f) => [f.origin, f.locale]))
    assert.equal(byOrigin['sources/cs/newsletter.txt'], 'cs')
    assert.equal(byOrigin['sources/en/newsletter.txt'], 'en')
  } finally {
    cleanup(dir)
  }
})

test('a tilde path expands against the home directory without a shell', () => {
  assert.equal(expandHome('~/Brand/deck.pptx'), path.join(os.homedir(), 'Brand/deck.pptx'))
  assert.equal(expandHome('~'), os.homedir())
  assert.equal(expandHome('/absolute/path'), '/absolute/path')
  assert.equal(expandHome('~notauser/x'), '~notauser/x', 'only a bare ~ prefix expands')
})

test('register ids are monotonic and never reuse a freed number', () => {
  assert.equal(nextRegisterId([]), 's01')
  assert.equal(nextRegisterId([{ id: 's01' }, { id: 's02' }]), 's03')
  assert.equal(nextRegisterId([{ id: 's01' }, { id: 's09' }]), 's10')
  assert.equal(nextRegisterId([{ id: 's99' }]), 's100')
})

test('resolveRegister returns one resolution per entry, in register order', () => {
  const dir = makeTmpProject({ 'docs/a.md': 'Copy.', '.voice-and-tone/sources/b.md': 'More.' })
  try {
    const config = {
      ...DEFAULT_CONFIG,
      sources: [
        { id: 's01', kind: 'project', include: ['docs/**/*.md'], exclude: [] },
        { id: 's02', kind: 'inbox', path: 'sources/' }
      ]
    }
    const resolved = resolveRegister(loadRegister(config, dir, path.join(dir, '.voice-and-tone')), ctxFor(dir, config))
    assert.deepEqual(resolved.map((r) => r.id), ['s01', 's02'])
    assert.deepEqual(resolved.map((r) => r.files.length), [1, 1])
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/register.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/register.mjs'`

- [ ] **Step 3: Implement register.mjs**

`scripts/lib/register.mjs`:

```js
import path from 'node:path'
import os from 'node:os'
import { existsSync, statSync } from 'node:fs'
import { walk, toPosix } from './fsx.mjs'
import { formatFor } from './extract.mjs'
import { activeProfile, localeOf } from './config.mjs'

/**
 * Where to look for brand material.
 *
 * The register exists because walk() is rooted at projectRoot and config globs
 * are relative to it, so a glob can never escape the repository. A `local`
 * entry can, which is the whole point: a user's brand deck lives in
 * ~/Brand, not in the client's git tree.
 *
 * Backwards compatibility is not optional. A config with no `sources` key
 * synthesises exactly one `project` entry from its existing scan globs, so an
 * existing knowledge base behaves bit-identically.
 */

const ALL_FILES = ['**/*']

export function expandHome (p) {
  const raw = String(p)
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2))
  return raw
}

export function loadRegister (config, projectRoot, kbRoot) {
  const declared = Array.isArray(config?.sources) ? config.sources : null
  if (declared && declared.length > 0) {
    return declared.map((entry, i) => ({ id: entry.id ?? `s${String(i + 1).padStart(2, '0')}`, ...entry }))
  }
  // Migration path: today's behaviour, expressed as one entry.
  return [{
    id: 's01',
    kind: 'project',
    label: 'Project files',
    include: config?.scan?.include ?? [],
    exclude: config?.scan?.exclude ?? []
  }]
}

export function nextRegisterId (register) {
  let highest = 0
  for (const entry of register ?? []) {
    const n = Number(/^s(\d+)$/.exec(String(entry?.id ?? ''))?.[1] ?? 0)
    if (n > highest) highest = n
  }
  return `s${String(highest + 1).padStart(2, '0')}`
}

function rootAndGlobs (entry, { projectRoot, kbRoot }) {
  if (entry.kind === 'project') {
    return {
      root: projectRoot,
      include: entry.include ?? [],
      exclude: entry.exclude ?? [],
      relativeTo: projectRoot,
      prefix: ''
    }
  }
  if (entry.kind === 'inbox') {
    const root = path.resolve(kbRoot, entry.path ?? 'sources')
    return { root, include: ALL_FILES, exclude: [], relativeTo: root, prefix: `${toPosix(entry.path ?? 'sources').replace(/\/$/, '')}/` }
  }
  const target = path.resolve(expandHome(entry.path ?? ''))
  return { root: target, include: ALL_FILES, exclude: entry.exclude ?? [], relativeTo: target, prefix: null }
}

export function resolveEntry (entry, ctx) {
  const { config, profileName = 'default' } = ctx
  const profile = activeProfile(config, profileName)
  const primary = profile.primary_locale ?? 'en'
  const locales = profile.locales ?? [primary]

  const base = { id: entry.id, kind: entry.kind, files: [], url: entry.url ?? null, missing: false, skipped: [] }
  if (entry.kind === 'url') return base

  const { root, include, exclude, relativeTo, prefix } = rootAndGlobs(entry, ctx)

  if (!existsSync(root)) {
    // Absent is ORDINARY, not an error: sources are never committed, so a
    // fresh clone has none of them. Callers report this, they do not warn.
    return { ...base, missing: true }
  }

  // A local entry may name one file rather than a directory.
  let absolutePaths
  if (statSync(root).isFile()) {
    absolutePaths = [root]
  } else {
    absolutePaths = walk(root, { include, exclude })
  }

  for (const abs of absolutePaths) {
    const format = formatFor(abs)
    const relToRoot = toPosix(path.relative(relativeTo, abs))
    // A project entry keeps project-relative paths, so nothing about today's
    // manifest changes. Other kinds record where the file actually came from.
    const origin = entry.kind === 'project'
      ? relToRoot
      : prefix === null
        ? abs
        : `${prefix}${relToRoot}`

    if (!format) {
      base.skipped.push({ origin, ext: path.extname(abs).toLowerCase() })
      continue
    }
    base.files.push({
      abs,
      rel: relToRoot,
      origin,
      format,
      locale: localeOf(relToRoot, locales, primary)
    })
  }

  base.files.sort((a, b) => (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0))
  base.skipped.sort((a, b) => (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0))
  return base
}

export function resolveRegister (register, ctx) {
  return (register ?? []).map((entry) => resolveEntry(entry, ctx))
}
```

- [ ] **Step 4: Add sources to DEFAULT_CONFIG**

In `scripts/lib/config.mjs`, add to `DEFAULT_CONFIG` after `scan`:

```js
  // Empty by design. loadRegister() synthesises a `project` entry from `scan`
  // when this is empty, so an existing knowledge base is unaffected until it
  // opts in by running /voice-and-tone:connect.
  sources: [],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/register.test.mjs test/config.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/register.mjs scripts/lib/config.mjs test/register.test.mjs
git commit -m "feat: the source register - project, inbox, local, and url entries

Lifts the limit that made material outside the repository unreachable:
walk() is rooted at projectRoot and a glob cannot escape it, so a local
entry resolving an absolute path is the only way to read a brand deck that
lives in ~/Brand.

A config with no sources key synthesises one project entry from its scan
globs, so existing knowledge bases behave bit-identically. An absent path
is reported as missing rather than as an error, because with sources never
committed that is the ordinary state on a fresh clone."
```

---

### Task 9: The index

The only thing that survives in git. Keyed by content hash rather than path, because sources are not committed and therefore sit at a different path on every machine — which is exactly what makes re-adding a known file a detectable no-op rather than a duplicate.

**Files:**
- Create: `scripts/lib/sourceindex.mjs`
- Test: `test/sourceindex.test.mjs`

**Interfaces:**
- Consumes: `readTextFile`, `writeTextFile` from `fsx.mjs`; `emptyStats` from `metrics.mjs`.
- Produces:
  - `indexPathFor(kbRoot) -> string`
  - `loadIndex(kbRoot) -> { generated, sources: Entry[] }` — an empty index when the file is absent.
  - `saveIndex(kbRoot, index, now) -> void` — sorted by id, stable JSON.
  - `nextEntryId(index) -> string`
  - `staleByExtractor(index, current) -> Entry[]` — entries produced by a version of a vendored library other than the one now in `vendor/manifest.json`. A version bump must mark those stale rather than let their numbers shift silently underneath the baseline.
  - `bySha(index) -> Map<string, Entry>`
  - `upsertEntry(index, entry) -> Entry` — matched on `sha256`.
  - `diffIndex(index, resolved, hashOf) -> { fresh, known, stale, missing, skipped }`
  - `statsByLocale(index, { includeMissing = true }) -> Map<locale, Stats[]>`

- [ ] **Step 1: Write the failing test**

`test/sourceindex.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { statsFor, mergeStats, fingerprintFromStats } from '../scripts/lib/metrics.mjs'
import {
  loadIndex, saveIndex, nextEntryId, upsertEntry, bySha, diffIndex, statsByLocale, indexPathFor
} from '../scripts/lib/sourceindex.mjs'

const entry = (over = {}) => ({
  id: 'f001',
  sha256: 'a'.repeat(64),
  kind: 'file',
  from: 's02',
  origin: 'sources/a.txt',
  label: 'A',
  format: 'text',
  bytes: 10,
  locale: 'en',
  tier: 'script',
  extractor: { name: 'officeparser', version: '7.8.0' },
  fidelity: 'measured',
  quality: { passed: true },
  stats: statsFor({ strings: ['We write plainly.'], headings: [], locale: 'en' }),
  added: '2026-08-27',
  analysed: '2026-08-27',
  status: 'used',
  produced: [],
  ...over
})

test('an absent index loads as empty rather than throwing', () => {
  const dir = makeTmpProject({})
  try {
    const index = loadIndex(path.join(dir, '.voice-and-tone'))
    assert.deepEqual(index.sources, [])
    assert.equal(typeof index.generated, 'string')
  } finally {
    cleanup(dir)
  }
})

test('the index round-trips and is written sorted for a clean diff', () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    saveIndex(kb, { sources: [entry({ id: 'f003' }), entry({ id: 'f001', sha256: 'b'.repeat(64) })] }, '2026-08-27T00:00:00.000Z')

    assert.ok(existsSync(indexPathFor(kb)))
    const reloaded = loadIndex(kb)
    assert.deepEqual(reloaded.sources.map((s) => s.id), ['f001', 'f003'])
    assert.equal(reloaded.generated, '2026-08-27T00:00:00.000Z')
  } finally {
    cleanup(dir)
  }
})

test('entry ids are monotonic and zero-padded', () => {
  assert.equal(nextEntryId({ sources: [] }), 'f001')
  assert.equal(nextEntryId({ sources: [{ id: 'f001' }, { id: 'f017' }] }), 'f018')
  assert.equal(nextEntryId({ sources: [{ id: 'f999' }] }), 'f1000')
})

test('identity is the hash, so the same bytes at a new path update rather than duplicate', () => {
  const index = { sources: [entry({ origin: 'sources/a.txt' })] }
  const updated = upsertEntry(index, entry({ id: 'f002', origin: '/Users/other/Downloads/a.txt' }))

  assert.equal(index.sources.length, 1, 'no duplicate created')
  assert.equal(updated.id, 'f001', 'the original id is kept')
  assert.equal(index.sources[0].origin, '/Users/other/Downloads/a.txt', 'origin is refreshed as a hint')
})

test('different bytes create a separate entry', () => {
  const index = { sources: [entry()] }
  upsertEntry(index, entry({ id: 'f002', sha256: 'c'.repeat(64) }))
  assert.equal(index.sources.length, 2)
})

test('bySha indexes every entry by its hash', () => {
  const index = { sources: [entry(), entry({ id: 'f002', sha256: 'd'.repeat(64) })] }
  assert.deepEqual([...bySha(index).keys()].sort(), ['a'.repeat(64), 'd'.repeat(64)])
})

// --- the status diff: the question "what have we already analysed?" -------

test('diffIndex separates fresh, known, stale and missing', () => {
  const known = entry({ sha256: 'a'.repeat(64), origin: 'sources/known.txt' })
  const gone = entry({ id: 'f002', sha256: 'b'.repeat(64), origin: 'sources/gone.txt' })
  const index = { sources: [known, gone] }

  const resolved = [{
    id: 's02',
    kind: 'inbox',
    missing: false,
    skipped: [{ origin: 'sources/logo.sketch', ext: '.sketch' }],
    files: [
      { abs: '/tmp/known.txt', origin: 'sources/known.txt', format: 'text', locale: 'en' },
      { abs: '/tmp/changed.txt', origin: 'sources/changed.txt', format: 'text', locale: 'en' },
      { abs: '/tmp/new.txt', origin: 'sources/new.txt', format: 'text', locale: 'en' }
    ]
  }]

  // 'changed' hashes to an existing entry's origin but different bytes -> stale
  const hashOf = (abs) => ({
    '/tmp/known.txt': 'a'.repeat(64),
    '/tmp/changed.txt': 'e'.repeat(64),
    '/tmp/new.txt': 'f'.repeat(64)
  })[abs]

  const diff = diffIndex(index, resolved, hashOf)

  assert.deepEqual(diff.known.map((f) => f.origin), ['sources/known.txt'])
  assert.deepEqual(diff.fresh.map((f) => f.origin).sort(), ['sources/changed.txt', 'sources/new.txt'])
  assert.deepEqual(diff.missing.map((e) => e.origin), ['sources/gone.txt'])
  assert.deepEqual(diff.skipped.map((s) => s.origin), ['sources/logo.sketch'])
})

test('an entry whose origin still resolves but whose bytes changed is stale, not fresh', () => {
  const index = { sources: [entry({ origin: 'sources/a.txt', sha256: 'a'.repeat(64) })] }
  const resolved = [{
    id: 's02', kind: 'inbox', missing: false, skipped: [],
    files: [{ abs: '/tmp/a.txt', origin: 'sources/a.txt', format: 'text', locale: 'en' }]
  }]
  const diff = diffIndex(index, resolved, () => 'z'.repeat(64))

  assert.deepEqual(diff.stale.map((s) => s.entry.origin), ['sources/a.txt'])
  assert.deepEqual(diff.missing, [], 'a stale entry is not also reported missing')
})

// --- the payoff: the fingerprint survives with no source text -------------

test('the aggregate fingerprint is recomputable from the index alone', () => {
  const a = statsFor({ strings: ['We write plainly. We keep it short.'], headings: [], locale: 'en' })
  const b = statsFor({ strings: ['That file did not upload. Try a smaller one.'], headings: [], locale: 'en' })
  const index = {
    sources: [
      entry({ id: 'f001', sha256: '1'.repeat(64), stats: a, status: 'missing' }),
      entry({ id: 'f002', sha256: '2'.repeat(64), stats: b, status: 'missing' })
    ]
  }

  const buckets = statsByLocale(index)
  assert.deepEqual(
    fingerprintFromStats(buckets.get('en'), 'en'),
    fingerprintFromStats(mergeStats([a, b]), 'en'),
    'a clone with an empty sources/ reproduces the baseline exactly'
  )
})

test('locales are bucketed separately and never merged', () => {
  const index = {
    sources: [
      entry({ id: 'f001', sha256: '1'.repeat(64), locale: 'en' }),
      entry({ id: 'f002', sha256: '2'.repeat(64), locale: 'cs', stats: statsFor({ strings: ['Ahoj.'], headings: [], locale: 'cs' }) })
    ]
  }
  assert.deepEqual([...statsByLocale(index).keys()].sort(), ['cs', 'en'])
})

test('a skipped entry contributes no statistics', () => {
  const index = {
    sources: [
      entry({ id: 'f001', sha256: '1'.repeat(64) }),
      entry({ id: 'f002', sha256: '2'.repeat(64), status: 'skipped', stats: null })
    ]
  }
  const buckets = statsByLocale(index)
  assert.equal(buckets.get('en').words, index.sources[0].stats.words)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/sourceindex.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/sourceindex.mjs'`

- [ ] **Step 3: Implement sourceindex.mjs**

`scripts/lib/sourceindex.mjs`:

```js
import path from 'node:path'
import { existsSync } from 'node:fs'
import { readTextFile, writeTextFile } from './fsx.mjs'
import { mergeStats } from './metrics.mjs'

/**
 * evidence/sources.json - the record of what has been analysed, and the only
 * part of the sourcing pipeline that is committed.
 *
 * Identity is the sha256 of the bytes, never the path. That is forced by the
 * decision not to commit sources: the same document sits at a different path
 * on every machine, so a path-keyed index would report one colleague's copy of
 * a file as a second, unrelated source. Hashing makes re-adding a known file a
 * detectable no-op.
 *
 * Each entry carries a `stats` block that is a sufficient statistic for the
 * fingerprint. That is what lets the source itself be discarded: the aggregate
 * stays recomputable and any single source stays subtractable with no source
 * text present anywhere.
 */

export function indexPathFor (kbRoot) {
  return path.join(kbRoot, 'evidence', 'sources.json')
}

export function loadIndex (kbRoot) {
  const file = indexPathFor(kbRoot)
  if (!existsSync(file)) return { generated: new Date(0).toISOString(), sources: [] }
  try {
    const parsed = JSON.parse(readTextFile(file))
    return { generated: parsed.generated ?? '', sources: Array.isArray(parsed.sources) ? parsed.sources : [] }
  } catch {
    // A corrupt index is replaced, not repaired - the same posture
    // fingerprint.mjs takes toward a corrupt previous fingerprint.
    return { generated: new Date(0).toISOString(), sources: [] }
  }
}

export function saveIndex (kbRoot, index, now) {
  const sorted = [...(index.sources ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const payload = { generated: now, sources: sorted }
  writeTextFile(indexPathFor(kbRoot), `${JSON.stringify(payload, null, 2)}\n`)
}

export function nextEntryId (index) {
  let highest = 0
  for (const source of index.sources ?? []) {
    const n = Number(/^f(\d+)$/.exec(String(source?.id ?? ''))?.[1] ?? 0)
    if (n > highest) highest = n
  }
  return `f${String(highest + 1).padStart(3, '0')}`
}

export function bySha (index) {
  const map = new Map()
  for (const source of index.sources ?? []) map.set(source.sha256, source)
  return map
}

/** Matched on hash. An existing entry keeps its id and gains a fresh origin. */
export function upsertEntry (index, entry) {
  index.sources = index.sources ?? []
  const existing = index.sources.find((s) => s.sha256 === entry.sha256)
  if (!existing) {
    index.sources.push(entry)
    return entry
  }
  Object.assign(existing, entry, { id: existing.id, added: existing.added ?? entry.added })
  return existing
}

/**
 * What is new, what is already analysed, what changed, what is not here.
 *
 * `hashOf(abs)` is injected so the caller controls when bytes are read - the
 * CLI hashes lazily, and a test can supply a stub.
 */
export function diffIndex (index, resolved, hashOf) {
  const known = []
  const fresh = []
  const stale = []
  const skipped = []
  const seen = new Set()
  const byHash = bySha(index)
  const byOrigin = new Map((index.sources ?? []).map((s) => [s.origin, s]))

  for (const entry of resolved ?? []) {
    for (const item of entry.skipped ?? []) skipped.push({ ...item, from: entry.id })

    for (const file of entry.files ?? []) {
      const sha = hashOf(file.abs)
      const candidate = { ...file, from: entry.id, sha256: sha }

      if (byHash.has(sha)) {
        seen.add(sha)
        known.push(candidate)
        continue
      }
      // Same place, different bytes: the document was edited or replaced.
      const previous = byOrigin.get(file.origin)
      if (previous) {
        seen.add(previous.sha256)
        stale.push({ entry: previous, file: candidate })
      }
      fresh.push(candidate)
    }
  }

  const missing = (index.sources ?? []).filter(
    (s) => s.kind !== 'url' && !seen.has(s.sha256)
  )
  return { fresh, known, stale, missing, skipped }
}

/**
 * Per-locale merged statistics, computed from the index alone.
 *
 * `includeMissing` defaults to true and that default is the whole point: a
 * source absent from this machine still contributes, because its statistics
 * were recorded when it was analysed. Setting it false would make a fresh
 * clone report every metric as changed, which :audit would then present as
 * drift in the brand's writing.
 */
export function statsByLocale (index, { includeMissing = true } = {}) {
  const buckets = new Map()
  for (const source of index.sources ?? []) {
    if (source.status === 'skipped' || !source.stats) continue
    if (!includeMissing && source.status === 'missing') continue
    const locale = source.locale ?? 'en'
    const bucket = buckets.get(locale) ?? []
    bucket.push(source.stats)
    buckets.set(locale, bucket)
  }
  const merged = new Map()
  for (const [locale, list] of buckets) merged.set(locale, mergeStats(list))
  return merged
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/sourceindex.test.mjs`
Expected: PASS, including the recomputable-fingerprint test.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sourceindex.mjs test/sourceindex.test.mjs
git commit -m "feat: evidence/sources.json, the hash-keyed source index

The only committed part of the sourcing pipeline. Identity is the sha256 of
the bytes rather than the path, which is forced by not committing sources:
the same document sits at a different path on every machine, so a
path-keyed index would count a colleague's copy as a second source.

Each entry carries sufficient statistics, so statsByLocale reproduces the
aggregate fingerprint from the index alone. Sources absent from this
machine still contribute - without that, a fresh clone would report every
metric as changed and :audit would present it as brand-voice drift."
```

---

### Task 10: The ingest ladder

Where the pieces meet. One function takes a resolved file and returns an index entry: extract with a script, score the result, cache what passed, count what it holds. Escalation to the model is not performed here — this layer *reports* that a source needs it, and the `voice-discovery` skill acts on that report in Task 15. Keeping the decision in code and the model call outside it is what makes the ladder testable.

**Files:**
- Create: `scripts/lib/ingest.mjs`
- Test: `test/ingest.test.mjs`

**Interfaces:**
- Consumes: `office.mjs`, `pdf.mjs`, `extract.mjs`, `quality.mjs`, `metrics.mjs`, `hash.mjs`, `fsx.mjs`.
- Produces:
  - `cachePathFor(kbRoot, sha) -> string`
  - `extractSource({ abs, format, buf }) -> { strings, headings, glyphRecall, note }`
  - `ingestFile(file, { kbRoot, now, id, from }) -> Entry` — a complete index entry, `tier: 'script'`, and `status` of `used` or `skipped`.
  - `ingestText({ strings, headings, locale, ... }, { kbRoot, now, id, tier }) -> Entry` — the path the model tier writes back through.
  - `needsModelTier(entry) -> boolean`

- [ ] **Step 1: Write the failing test**

`test/ingest.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { ingestFile, ingestText, needsModelTier, cachePathFor, extractSource } from '../scripts/lib/ingest.mjs'
import { readTextFile } from '../scripts/lib/fsx.mjs'
import { sha256File } from '../scripts/lib/hash.mjs'

const NOW = '2026-08-27T00:00:00.000Z'

function fileIn (dir, rel, contents) {
  const abs = path.join(dir, rel)
  writeFileSync(abs, contents)
  return { abs, rel, origin: rel, format: rel.endsWith('.md') ? 'markdown' : 'text', locale: 'en' }
}

test('a text source produces a complete, measured index entry', async () => {
  const dir = makeTmpProject({ 'a.txt': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = fileIn(dir, 'a.txt', 'We write plainly. We keep it short.\n')
    const entry = await ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

    assert.equal(entry.id, 'f001')
    assert.equal(entry.from, 's02')
    assert.equal(entry.kind, 'file')
    assert.equal(entry.sha256, sha256File(file.abs))
    assert.equal(entry.tier, 'script')
    assert.equal(entry.fidelity, 'measured')
    assert.equal(entry.status, 'used')
    assert.equal(entry.quality.passed, true)
    assert.equal(entry.stats.sentences, 2)
    assert.equal(entry.analysed, '2026-08-27')
    assert.deepEqual(entry.produced, [])
  } finally {
    cleanup(dir)
  }
})

test('extracted text is cached under the content hash, not the filename', async () => {
  const dir = makeTmpProject({ 'a.txt': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = fileIn(dir, 'a.txt', 'We write plainly.\n')
    const entry = await ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

    const cached = cachePathFor(kb, entry.sha256)
    assert.ok(existsSync(cached), 'extract is cached')
    assert.match(readTextFile(cached), /We write plainly\./)
    assert.match(cached, new RegExp(`${entry.sha256}\\.txt$`))
    assert.ok(cached.includes(path.join('.cache', 'extracts')), 'cache lives in the gitignored dir')
  } finally {
    cleanup(dir)
  }
})

test('a source yielding no text is skipped with a reason, not silently dropped', async () => {
  const dir = makeTmpProject({ 'empty.txt': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = fileIn(dir, 'empty.txt', '   \n\n  \n')
    const entry = await ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

    assert.equal(entry.status, 'skipped')
    assert.equal(entry.quality.passed, false)
    assert.ok(entry.quality.reasons.length > 0)
    assert.equal(entry.stats, null, 'a skipped source contributes nothing')
  } finally {
    cleanup(dir)
  }
})

test('a gate failure marks the entry for the model tier', () => {
  const dir = makeTmpProject({ 'split.txt': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = fileIn(dir, 'split.txt', 'I V A Š TÍH LÁ ADMIN IS TRATIV NÍ PRACOVNIC E L ET\n')
    const entry = ingestFile({ ...file, locale: 'cs' }, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

    assert.equal(entry.quality.passed, false)
    assert.equal(needsModelTier(entry), true)
    assert.equal(entry.status, 'skipped')
  } finally {
    cleanup(dir)
  }
})

test('a passing entry does not need the model tier', () => {
  const dir = makeTmpProject({ 'a.txt': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = fileIn(dir, 'a.txt', 'We write plainly and we keep every sentence short.\n')
    assert.equal(needsModelTier(ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })), false)
  } finally {
    cleanup(dir)
  }
})

test('a model-tier entry is capped at estimated fidelity', () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const entry = ingestText(
      {
        sha256: 'a'.repeat(64),
        origin: 'sources/scan.pdf',
        kind: 'file',
        format: 'pdf',
        locale: 'en',
        bytes: 1024,
        strings: ['We write plainly.', 'We keep it short.'],
        headings: []
      },
      { kbRoot: kb, now: NOW, id: 'f002', from: 's02', tier: 'model' }
    )

    assert.equal(entry.tier, 'model')
    assert.equal(
      entry.fidelity, 'estimated',
      'parent spec 5.4: an estimated source may only ever produce assumed rules'
    )
    assert.equal(entry.status, 'used')
  } finally {
    cleanup(dir)
  }
})

test('model-tier output is scored by the same gate and can still be refused', () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const entry = ingestText(
      {
        sha256: 'b'.repeat(64), origin: 'sources/x.pdf', kind: 'file', format: 'pdf',
        locale: 'en', bytes: 10, strings: ['a b c d e f g h i j k'], headings: []
      },
      { kbRoot: kb, now: NOW, id: 'f003', from: 's02', tier: 'model' }
    )
    assert.equal(entry.quality.passed, false)
    assert.equal(entry.status, 'skipped')
  } finally {
    cleanup(dir)
  }
})

test('an unreadable container is skipped with the reason recorded', async () => {
  const dir = makeTmpProject({ 'broken.docx': 'x' })
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const file = { ...fileIn(dir, 'broken.docx', 'not a zip at all'), format: 'docx' }
    const entry = await ingestFile(file, { kbRoot: kb, now: NOW, id: 'f001', from: 's02' })

    assert.equal(entry.status, 'skipped')
    assert.ok(entry.quality.reasons.join(' ').match(/not a zip|unreadable/i), entry.quality.reasons.join('; '))
  } finally {
    cleanup(dir)
  }
})

test('extractSource routes each format to the right parser', () => {
  const dir = makeTmpProject({})
  try {
    assert.deepEqual(
      extractSource({ abs: path.join(dir, 'x.txt'), format: 'text', buf: Buffer.from('One. Two.') }).strings,
      ['One. Two.']
    )
    // A binary format must be handed bytes; the router must not decode first.
    const out = extractSource({ abs: path.join(dir, 'x.pdf'), format: 'pdf', buf: Buffer.from('%PDF-1.4\n') })
    assert.equal(out.note, 'no-text-layer')
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/ingest.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/ingest.mjs'`

- [ ] **Step 3: Implement ingest.mjs**

`scripts/lib/ingest.mjs`:

```js
import path from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { writeTextFile } from './fsx.mjs'
import { extractStrings, extractHeadings, isBinaryFormat } from './extract.mjs'
import { extractOffice, OFFICE_FORMATS, OFFICE_EXTRACTOR } from './office.mjs'
import { extractPdf, PDF_EXTRACTOR } from './pdf.mjs'
import { scoreExtraction } from './quality.mjs'
import { statsFor } from './metrics.mjs'
import { sha256Buffer } from './hash.mjs'

/**
 * The ingest ladder: extract, score, cache, count.
 *
 * The tier boundary is the quality gate, not the file format. A script parser
 * attempts every source; only a genuine failure is marked for the model.
 *
 * Escalation itself is NOT performed here. This layer reports that a source
 * needs the model, and the voice-discovery skill acts on it. Keeping the
 * decision in code and the model call outside it is what makes the ladder
 * testable, and it keeps a token-spending step from hiding inside a library.
 */

export function cachePathFor (kbRoot, sha) {
  return path.join(kbRoot, '.cache', 'extracts', `${sha}.txt`)
}

export async function extractSource ({ abs, format, buf }) {
  // Both vendored adapters are promise-based, so this is async - and
  // ingestFile and runIngest with it.
  if (format === 'pdf') return { ...(await extractPdf(buf)), extractor: PDF_EXTRACTOR }

  if (OFFICE_FORMATS.has(format)) {
    const { strings, headings, note } = await extractOffice(buf, format)
    return { strings, headings, glyphRecall: null, note, extractor: OFFICE_EXTRACTOR }
  }

  if (isBinaryFormat(format)) {
    throw new Error(`no extractor for container format ${format}`)
  }

  // Text formats: decoded and read here, with no third-party library
  // involved - so no extractor stamp, and nothing to go stale on a bump.
  const text = buf.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  return {
    strings: extractStrings(abs, text).strings,
    headings: extractHeadings(abs, text),
    glyphRecall: null,
    note: 'ok'
  }
}

function entryFrom ({ sha256, origin, kind, from, id, format, bytes, locale, label, now, tier, extractor = null, strings, headings, glyphRecall, note, kbRoot, reasons = [] }) {
  const text = strings.join('\n')
  const quality = strings.length === 0
    ? { passed: false, reasons: [...reasons, `empty: ${note}`], tokens: 0 }
    : scoreExtraction(text, { locale, glyphRecall })

  if (quality.passed) writeTextFile(cachePathFor(kbRoot, sha256), `${text}\n`)

  return {
    id,
    sha256,
    kind,
    from,
    origin,
    label: label ?? null,
    format,
    bytes,
    locale,
    tier,
    // Which vendored library produced this text, and at what version. A
    // version bump changes extracted text subtly; recording it is what lets
    // validate.mjs mark affected sources stale rather than let their numbers
    // shift underneath a baseline with no explanation available.
    extractor,
    // Parent spec 5.4: a model transcription is never precise enough to
    // support a `derived` rule, whatever the gate says about its shape.
    fidelity: tier === 'model' ? 'estimated' : 'measured',
    quality,
    stats: quality.passed ? statsFor({ strings, headings, locale }) : null,
    added: now.slice(0, 10),
    analysed: now.slice(0, 10),
    status: quality.passed ? 'used' : 'skipped',
    produced: []
  }
}

export async function ingestFile (file, { kbRoot, now, id, from }) {
  const buf = readFileSync(file.abs)
  const sha256 = sha256Buffer(buf)
  const common = {
    sha256,
    origin: file.origin,
    kind: 'file',
    from,
    id,
    format: file.format,
    bytes: statSync(file.abs).size,
    locale: file.locale ?? 'en',
    label: file.label,
    now,
    tier: 'script',
    kbRoot
  }

  let extracted
  try {
    extracted = await extractSource({ abs: file.abs, format: file.format, buf })
  } catch (error) {
    // An unreadable container is a fact to record, not a crash: one bad file
    // must not abort the ingest of the other seventy.
    return entryFrom({
      ...common, strings: [], headings: [], glyphRecall: null,
      note: 'unreadable', reasons: [`unreadable: ${error.message}`]
    })
  }
  return entryFrom({ ...common, ...extracted })
}

/** The write-back path for the model tier, and for fetched URLs. */
export function ingestText (source, { kbRoot, now, id, from, tier = 'model' }) {
  return entryFrom({
    sha256: source.sha256,
    origin: source.origin,
    kind: source.kind ?? 'file',
    from,
    id,
    format: source.format,
    bytes: source.bytes ?? 0,
    locale: source.locale ?? 'en',
    label: source.label,
    now,
    tier,
    strings: source.strings ?? [],
    headings: source.headings ?? [],
    glyphRecall: null,
    note: 'ok',
    kbRoot
  })
}

/**
 * True when the script tier failed on something the model might still read:
 * a scanned page, an image, a JS-rendered shell. An entry that failed because
 * it is genuinely empty is not worth spending tokens on.
 */
export function needsModelTier (entry) {
  if (entry.tier === 'model') return false
  if (entry.status !== 'skipped') return false
  return !entry.quality.reasons.some((reason) => reason.startsWith('unreadable:'))
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/ingest.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/ingest.mjs test/ingest.test.mjs
git commit -m "feat: the ingest ladder - extract, score, cache, count

One function turns a resolved file into a complete index entry. The tier
boundary is the quality gate rather than the file format, so a script
parser attempts everything and only a genuine failure is marked for the
model. Model-tier entries are capped at estimated fidelity, which under the
parent spec means they can never support a derived rule.

Escalation is reported, not performed: keeping the model call outside the
library is what makes the ladder testable and keeps a token-spending step
from hiding inside it. An unreadable container is recorded as a skipped
entry with its reason, so one bad file cannot abort the other seventy."
```

---

### Task 11: `sources.mjs` — the register and index CLI

The script behind `/voice-and-tone:connect`. It answers the operational question the whole index exists for — *what have we already analysed?* — and it is the only place that ingests.

**Files:**
- Create: `scripts/sources.mjs`
- Test: `test/sources.test.mjs`

**Interfaces:**
- Consumes: `register.mjs`, `sourceindex.mjs`, `ingest.mjs`, `hash.mjs`, `config.mjs`, `cli.mjs`.
- Produces: `runCheck(ctx) -> Report`, `runIngest(ctx, { only }) -> Report`, `runAdd(ctx, { target, label }) -> { register, entry }`, `runForget(ctx, { id }) -> { removed, reopened }`, plus `main(argv)`.

CLI surface:

```
node scripts/sources.mjs --check                    what is new, changed, missing
node scripts/sources.mjs --ingest                   analyse everything new or stale
node scripts/sources.mjs --add <path|url> [--label] register a source
node scripts/sources.mjs --forget <f-id>            retract a source and list its rules
```

- [ ] **Step 1: Write the failing test**

`test/sources.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { loadConfig, saveConfig, DEFAULT_CONFIG } from '../scripts/lib/config.mjs'
import { loadIndex } from '../scripts/lib/sourceindex.mjs'
import { runCheck, runIngest, runAdd, runForget } from '../scripts/sources.mjs'

const NOW = '2026-08-27T00:00:00.000Z'

function project (files = {}) {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  mkdirSync(path.join(kb, 'sources'), { recursive: true })
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(kb, 'sources', rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
  saveConfig(kb, {
    ...DEFAULT_CONFIG,
    sources: [{ id: 's02', kind: 'inbox', path: 'sources/', label: 'Inbox' }]
  })
  return { dir, kb, ctx: { projectRoot: dir, kbRoot: kb, config: loadConfig(kb), profileName: 'default', now: NOW } }
}

test('check reports new sources before anything is analysed', () => {
  const { dir, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    const report = runCheck(ctx)
    assert.equal(report.fresh.length, 1)
    assert.equal(report.known.length, 0)
    assert.deepEqual(report.fresh[0].origin, 'sources/a.txt')
  } finally {
    cleanup(dir)
  }
})

test('ingest writes index entries and check then reports them as known', () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    const ingested = runIngest(ctx, {})
    assert.equal(ingested.ingested.length, 1)
    assert.equal(ingested.ingested[0].status, 'used')

    const index = loadIndex(kb)
    assert.equal(index.sources.length, 1)
    assert.equal(index.sources[0].id, 'f001')
    assert.equal(index.sources[0].from, 's02')

    const after = runCheck({ ...ctx, config: loadConfig(kb) })
    assert.equal(after.fresh.length, 0)
    assert.equal(after.known.length, 1)
  } finally {
    cleanup(dir)
  }
})

test('re-ingesting the same bytes at a new path is a no-op that keeps the original id', () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    runIngest(ctx, {})
    writeFileSync(path.join(kb, 'sources', 'copy-of-a.txt'), 'We write plainly. We keep it short.\n')

    runIngest({ ...ctx, config: loadConfig(kb) }, {})
    const index = loadIndex(kb)

    assert.equal(index.sources.length, 1, 'identity is the hash, so the copy is the same source')
    assert.equal(index.sources[0].id, 'f001')
  } finally {
    cleanup(dir)
  }
})

test('an edited source becomes stale and is re-ingested', () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    runIngest(ctx, {})
    writeFileSync(path.join(kb, 'sources', 'a.txt'), 'We write plainly. We changed our minds entirely.\n')

    const check = runCheck({ ...ctx, config: loadConfig(kb) })
    assert.equal(check.stale.length, 1)

    runIngest({ ...ctx, config: loadConfig(kb) }, {})
    const index = loadIndex(kb)
    assert.equal(index.sources.length, 1, 'the stale entry is replaced, not duplicated')
    assert.match(index.sources[0].sha256, /^[0-9a-f]{64}$/)
  } finally {
    cleanup(dir)
  }
})

test('sources absent from this machine are reported as missing, never as an error', () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    runIngest(ctx, {})
    // Simulate a fresh clone: the index is committed, sources/ is not.
    cleanup(path.join(kb, 'sources'))
    mkdirSync(path.join(kb, 'sources'), { recursive: true })

    const report = runCheck({ ...ctx, config: loadConfig(kb) })
    assert.equal(report.missing.length, 1)
    assert.equal(report.errors.length, 0, 'missing is ordinary, not an error')
    assert.ok(report.statsIntact, 'statistics survive without the file')
  } finally {
    cleanup(dir)
  }
})

test('add registers a local path outside the project and returns the new entry id', () => {
  const outside = makeTmpProject({ 'guide.md': 'Our voice is plain.\n' })
  const { dir, kb, ctx } = project({})
  try {
    const { register, entry } = runAdd(ctx, { target: path.join(outside, 'guide.md'), label: 'Brand guide' })

    assert.equal(entry.kind, 'local')
    assert.equal(entry.label, 'Brand guide')
    assert.equal(entry.id, 's03', 'ids continue from the existing register')
    assert.ok(register.some((e) => e.id === 's03'))
    assert.ok(loadConfig(kb).sources.some((e) => e.id === 's03'), 'persisted to config.yml')
  } finally {
    cleanup(outside)
    cleanup(dir)
  }
})

test('add recognises a url and stores it as a url entry with retention off', () => {
  const { dir, ctx } = project({})
  try {
    const { entry } = runAdd(ctx, { target: 'https://acme.com/about', label: 'About' })
    assert.equal(entry.kind, 'url')
    assert.equal(entry.url, 'https://acme.com/about')
    assert.equal(entry.retain, 'none', 'retention is opt-in per spec 8.3')
  } finally {
    cleanup(dir)
  }
})

test('forget removes an entry and names the rules that must be reopened', async () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    runIngest(ctx, {})
    const index = loadIndex(kb)
    index.sources[0].produced = ['V3', 'L07']
    const { saveIndex } = await import('../scripts/lib/sourceindex.mjs')
    saveIndex(kb, index, NOW)

    const result = runForget({ ...ctx, config: loadConfig(kb) }, { id: 'f001' })

    assert.equal(result.removed.id, 'f001')
    assert.deepEqual(result.reopened, ['V3', 'L07'])
    assert.equal(loadIndex(kb).sources.length, 0)
  } finally {
    cleanup(dir)
  }
})

test('ingest is deterministic: the same input twice produces an identical index file', () => {
  const { dir, kb, ctx } = project({ 'a.txt': 'We write plainly. We keep it short.\n' })
  try {
    runIngest(ctx, {})
    const first = JSON.stringify(loadIndex(kb))
    runIngest({ ...ctx, config: loadConfig(kb) }, {})
    assert.equal(JSON.stringify(loadIndex(kb)), first)
  } finally {
    cleanup(dir)
  }
})
```

Note: the `forget` test uses top-level `await import`, so mark that test callback `async`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/sources.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/sources.mjs'`

- [ ] **Step 3: Implement sources.mjs**

`scripts/sources.mjs`:

```js
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, saveConfig } from './lib/config.mjs'
import { loadRegister, resolveRegister, nextRegisterId, expandHome } from './lib/register.mjs'
import { loadIndex, saveIndex, nextEntryId, upsertEntry, diffIndex, statsByLocale } from './lib/sourceindex.mjs'
import { ingestFile, needsModelTier } from './lib/ingest.mjs'
import { sha256File } from './lib/hash.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp, writeOut } from './lib/cli.mjs'

const isUrl = (target) => /^https?:\/\//i.test(String(target))

function contextFor (values) {
  const { projectRoot, kbRoot } = resolveRoots(values)
  return {
    projectRoot,
    kbRoot,
    config: loadConfig(kbRoot),
    profileName: values.profile ?? 'default',
    now: nowIso(values)
  }
}

/** Hash lazily and once per path: a 200 MB deck should be read a single time. */
function hasher () {
  const cache = new Map()
  return (abs) => {
    if (!cache.has(abs)) cache.set(abs, sha256File(abs))
    return cache.get(abs)
  }
}

export function runCheck (ctx) {
  const register = loadRegister(ctx.config, ctx.projectRoot, ctx.kbRoot)
  const resolved = resolveRegister(register, ctx)
  const index = loadIndex(ctx.kbRoot)
  const diff = diffIndex(index, resolved, hasher())

  return {
    ...diff,
    register,
    resolved,
    index,
    errors: [],
    // With sources never committed, absent files are the ordinary state. The
    // statistics that matter survived in the index, so say so plainly rather
    // than warning - a warning here would push people to commit sources just
    // to silence it, which quietly undoes the decision not to.
    statsIntact: statsByLocale(index).size > 0 || index.sources.length === 0
  }
}

export async function runIngest (ctx, { only = null } = {}) {
  const report = runCheck(ctx)
  const index = report.index
  const ingested = []
  const escalate = []

  const wanted = report.fresh.filter((file) => !only || file.origin === only || file.from === only)

  for (const file of wanted) {
    const entry = await ingestFile(file, {
      kbRoot: ctx.kbRoot,
      now: ctx.now,
      id: nextEntryId(index),
      from: file.from
    })
    upsertEntry(index, entry)
    ingested.push(entry)
    if (needsModelTier(entry)) escalate.push(entry)
  }

  // Anything the register no longer reaches keeps its statistics and is simply
  // marked. This is what makes a fresh clone reproduce the baseline exactly.
  for (const orphan of report.missing) {
    if (orphan.status !== 'skipped') orphan.status = 'missing'
  }

  saveIndex(ctx.kbRoot, index, ctx.now)
  return { ...report, ingested, escalate }
}

export function runAdd (ctx, { target, label = null }) {
  const register = loadRegister(ctx.config, ctx.projectRoot, ctx.kbRoot)
  const id = nextRegisterId(register)

  const entry = isUrl(target)
    ? { id, kind: 'url', url: String(target), label, retain: 'none' }
    : { id, kind: 'local', path: path.resolve(expandHome(target)), label }

  const config = { ...ctx.config, sources: [...register, entry] }
  saveConfig(ctx.kbRoot, config)
  return { register: config.sources, entry }
}

export function runForget (ctx, { id }) {
  const index = loadIndex(ctx.kbRoot)
  const at = (index.sources ?? []).findIndex((s) => s.id === id)
  if (at < 0) throw new Error(`no source with id ${id}`)

  const [removed] = index.sources.splice(at, 1)
  saveIndex(ctx.kbRoot, index, ctx.now)

  // Subtraction, not deletion. The rules this source produced are named so the
  // caller can re-derive them from what remains - which is only possible
  // because every surviving entry still carries its own statistics.
  return { removed, reopened: removed.produced ?? [], index }
}

function report (lines) {
  writeOut(`${lines.join('\n')}\n`)
}

async function main (argv) {
  const { values } = parseCliArgs(argv, {
    profile: { type: 'string' },
    check: { type: 'boolean' },
    ingest: { type: 'boolean' },
    add: { type: 'string' },
    label: { type: 'string' },
    forget: { type: 'string' }
  })
  if (values.help) {
    printHelp('scripts/sources.mjs', [
      'Register brand material and record what has been analysed.',
      '',
      '  --check              report new, known, stale, and missing sources',
      '  --ingest             analyse everything new or changed',
      '  --add <path|url>     register a source',
      '  --label <text>       a human label for --add',
      '  --forget <id>        retract a source and name the rules to reopen',
      '  --root <dir>         project root (default: cwd)',
      '  --kb <dir>           knowledge base dir',
      '  --profile <name>     config profile (default: default)',
      '  --now <iso>          fixed timestamp for reproducible output',
      '  --json               machine-readable summary'
    ])
    return
  }

  const ctx = contextFor(values)

  if (values.add) {
    const { entry } = runAdd(ctx, { target: values.add, label: values.label ?? null })
    if (values.json) return writeOut(`${JSON.stringify({ added: entry.id, kind: entry.kind })}\n`)
    return report([`sources: added ${entry.id} (${entry.kind})`, 'sources: run --ingest to analyse it'])
  }

  if (values.forget) {
    const { removed, reopened } = runForget(ctx, { id: values.forget })
    if (values.json) return writeOut(`${JSON.stringify({ removed: removed.id, reopened })}\n`)
    return report([
      `sources: forgot ${removed.id}`,
      reopened.length
        ? `sources: reopen these rules and re-derive from what remains: ${reopened.join(', ')}`
        : 'sources: it had produced no rules'
    ])
  }

  const result = values.ingest ? await runIngest(ctx, {}) : runCheck(ctx)

  if (values.json) {
    return writeOut(`${JSON.stringify({
      known: result.known.length,
      fresh: result.fresh.length,
      stale: result.stale.length,
      missing: result.missing.length,
      skipped: result.skipped.length,
      ingested: result.ingested?.length ?? 0,
      escalate: result.escalate?.map((e) => e.origin) ?? []
    })}\n`)
  }

  const lines = [
    `sources: ${result.index.sources.length} known, ${result.known.length} used, ` +
    `${result.fresh.length} new, ${result.stale.length} stale, ${result.missing.length} missing`
  ]
  for (const file of result.fresh.slice(0, 20)) lines.push(`sources:   new    ${file.origin} (${file.format})`)
  for (const item of result.stale.slice(0, 20)) lines.push(`sources:   stale  ${item.entry.id} ${item.entry.origin}`)
  for (const item of result.skipped.slice(0, 20)) lines.push(`sources:   skip   ${item.origin} (${item.ext})`)
  if (result.missing.length) {
    lines.push(`sources: ${result.missing.length} source(s) not present locally; statistics intact`)
  }
  if (result.escalate?.length) {
    lines.push(`sources: ${result.escalate.length} source(s) need the model tier:`)
    for (const entry of result.escalate.slice(0, 20)) {
      lines.push(`sources:   model  ${entry.origin} (${entry.quality.reasons[0]})`)
    }
  }
  if (!values.ingest && result.fresh.length) lines.push('sources: run with --ingest to analyse')
  report(lines)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => die(error.message))
}

export { main }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/sources.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/sources.mjs test/sources.test.mjs
git commit -m "feat: sources.mjs - register, check, ingest, forget

Answers the question the index exists for: what have we already analysed?
Re-adding the same bytes at a different path is a detectable no-op that
keeps the original id, and an edited file becomes stale rather than a
duplicate.

Missing sources are reported plainly rather than as a warning. Warning
would push people to commit sources purely to silence it, which undoes the
decision not to commit them at all.

--forget names the rules a retracted source produced, so they can be
re-derived from the survivors rather than merely deleted."
```

---

### Task 12: Corpus integration

Wire the register and index into `gatherCorpus`, `scan.mjs`, and `fingerprint.mjs` — the point at which everything built so far becomes visible to the rest of the plugin.

**One principle decides the shape.** Spec section 8.1 keeps URL fetching out of `scan` for reproducibility. The same reasoning applies to *extraction*: re-parsing a directory of PDFs on every scan would be slow and would make the fingerprint depend on whether someone happened to run `--ingest` first. So **`scan` and `fingerprint` never ingest.** They read project files live, because those are always present and cheap, and they read everything else from the index. Ingest is `/connect`'s job alone.

**Files:**
- Modify: `scripts/lib/corpus.mjs` — add `gatherAll`
- Modify: `scripts/scan.mjs`, `scripts/fingerprint.mjs`
- Test: `test/corpus.test.mjs`, `test/scan.test.mjs`, `test/fingerprint.test.mjs`

**Interfaces:**
- Produces: `gatherAll({ projectRoot, kbRoot, config, profileName }) -> { files, skipped, indexStats, missing }` where `files` carries the existing corpus record shape plus `sourceId`, `tier`, `fidelity`, and `indexStats` is `Map<locale, Stats>` contributed by non-project sources.

- [ ] **Step 1: Write the failing tests**

Append to `test/fingerprint.test.mjs`:

```js
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
```

Mark both test callbacks `async`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/fingerprint.test.mjs`
Expected: FAIL — `buildFingerprint` ignores `kbRoot` and the index entirely.

- [ ] **Step 3: Add gatherAll to corpus.mjs**

Append to `scripts/lib/corpus.mjs`:

```js
import { loadRegister, resolveRegister } from './register.mjs'
import { loadIndex, statsByLocale } from './sourceindex.mjs'

/**
 * Everything the corpus is made of, from the two places it can come from.
 *
 * Project files are read LIVE: they are committed, always present, and cheap.
 * Everything else comes from the INDEX, never from re-extracting the source.
 *
 * That split is deliberate. Spec 8.1 keeps URL fetching out of scan so the
 * fingerprint cannot depend on someone else's web server; the same argument
 * applies to extraction. Re-parsing a folder of PDFs on every scan would make
 * the fingerprint depend on whether anyone had run --ingest first, and would
 * make an ordinary scan slow. Ingest is /connect's job alone.
 */
export function gatherAll ({ projectRoot, kbRoot, config, profileName = 'default' }) {
  const register = loadRegister(config, projectRoot, kbRoot)
  const resolved = resolveRegister(register, { projectRoot, kbRoot, config, profileName })
  const index = loadIndex(kbRoot)

  const files = []
  const skipped = []

  for (const entry of resolved) {
    for (const item of entry.skipped) skipped.push({ rel: item.origin, ext: item.ext })
    if (entry.kind !== 'project') continue

    for (const file of entry.files) {
      let raw
      try { raw = readTextFile(file.abs) } catch { continue }
      const { strings } = extractStrings(file.abs, raw)
      if (strings.length === 0) continue
      files.push({
        rel: file.origin,
        abs: file.abs,
        format: file.format,
        locale: file.locale,
        strings,
        headings: extractHeadings(file.abs, raw),
        sourceId: entry.id,
        tier: 'script',
        fidelity: 'measured'
      })
    }
  }

  const indexed = (index.sources ?? []).filter((s) => s.stats && s.status !== 'skipped')
  for (const source of indexed) {
    files.push({
      rel: source.origin,
      abs: null,
      format: source.format,
      locale: source.locale ?? 'en',
      strings: [],                 // the text is gone by design; the counts remain
      headings: [],
      stats: source.stats,
      sourceId: source.from ?? null,
      entryId: source.id,
      tier: source.tier,
      fidelity: source.fidelity,
      status: source.status
    })
  }

  return {
    files,
    skipped,
    indexStats: statsByLocale(index),
    missing: indexed.filter((s) => s.status === 'missing').length,
    estimatedLocales: new Set(indexed.filter((s) => s.fidelity === 'estimated').map((s) => s.locale ?? 'en'))
  }
}
```

- [ ] **Step 4: Rewrite buildFingerprint to merge both sources of statistics**

In `scripts/fingerprint.mjs`:

```js
export function buildFingerprint (projectRoot, config, { generated, source = 'measured', profileName = 'default', kbRoot = null }) {
  const root = kbRoot ?? kbRootFor(projectRoot)
  const { files, estimatedLocales } = gatherAll({ projectRoot, kbRoot: root, config, profileName })

  const perLocale = new Map()
  for (const file of files) {
    // A live project file is measured here; an indexed source already carries
    // its counts, recorded when it was analysed. Both are Stats blocks, so
    // they merge without either caring which it was.
    const stats = file.stats ?? statsFor({ strings: file.strings, headings: file.headings, locale: file.locale })
    const bucket = perLocale.get(file.locale) ?? []
    bucket.push(stats)
    perLocale.set(file.locale, bucket)
  }

  const out = {}
  for (const locale of [...perLocale.keys()].sort()) {
    out[locale] = {
      ...fingerprintFromStats(mergeStats(perLocale.get(locale)), locale),
      // Parent spec 5.4: one estimated contributor caps the whole locale.
      fidelity: estimatedLocales.has(locale) ? 'estimated' : 'measured'
    }
  }
  return { generated, source, byLocale: out, baseline: null }
}
```

Update its imports to add `gatherAll` and `kbRootFor`, and pass `kbRoot` from `main`:

```js
  const fingerprint = buildFingerprint(projectRoot, config, {
    generated, source, profileName: values.profile ?? 'default', kbRoot
  })
```

- [ ] **Step 5: Rewrite buildManifest on gatherAll**

In `scripts/scan.mjs`, replace the whole body of `buildManifest`:

```js
export function buildManifest (projectRoot, config, generated, profileName = 'default', kbRoot = null) {
  const root = kbRoot ?? kbRootFor(projectRoot)
  const { files: gathered, skipped, missing } = gatherAll({
    projectRoot, kbRoot: root, config, profileName
  })

  const files = []
  const byLocale = {}
  const totals = { files: 0, strings: 0, words: 0, sentences: 0 }
  const unreadablePaths = []

  for (const file of gathered) {
    // A live project file is counted here. An indexed source arrives with its
    // counts already recorded, and its text deliberately absent - so read the
    // numbers from the stats block rather than recomputing from nothing.
    const stats = file.stats
    const joined = file.strings.join('\n')
    const entry = {
      path: file.rel,
      format: file.format,
      locale: file.locale,
      source: file.sourceId ?? null,
      tier: file.tier,
      fidelity: file.fidelity,
      strings: stats ? stats.strings : file.strings.length,
      words: stats ? stats.words : splitWords(joined).length,
      sentences: stats
        ? stats.sentences
        : file.strings.reduce((sum, s) => sum + splitSentences(s).length, 0)
    }
    if (entry.strings === 0) continue
    files.push(entry)

    totals.files += 1
    totals.strings += entry.strings
    totals.words += entry.words
    totals.sentences += entry.sentences

    const bucket = byLocale[entry.locale] ?? (byLocale[entry.locale] = { files: 0, strings: 0, words: 0 })
    bucket.files += 1
    bucket.strings += entry.strings
    bucket.words += entry.words
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return {
    generated,
    projectRoot: toPosix(projectRoot),
    profile: profileName,
    totals,
    byLocale,
    files,
    unreadable: { count: unreadablePaths.length, paths: unreadablePaths },
    skipped: {
      count: skipped.length,
      files: [...skipped]
        .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
        .map((f) => ({ path: f.rel, ext: f.ext }))
    },
    missing
  }
}
```

Update the imports to add `gatherAll` and `kbRootFor`, and pass `kbRoot` from `main`.

> Task 1's `unreadable` channel now travels through `gatherAll`. Thread the array into the `gatherAll` call the same way Task 1 threaded it into `gatherCorpus`, so the malformed-JSON signal is not lost in the move — `test/scan.test.mjs` already covers it.

Add a line to the human summary when sources are absent:

```js
    (manifest.missing
      ? `scan: ${manifest.missing} source(s) not present locally; statistics intact\n`
      : '') +
```

- [ ] **Step 6: Run the suite**

Run: `node --test test/`
Expected: PASS. `gatherCorpus` keeps its signature and its tests; `gatherAll` is additive.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/corpus.mjs scripts/scan.mjs scripts/fingerprint.mjs \
        test/corpus.test.mjs test/scan.test.mjs test/fingerprint.test.mjs
git commit -m "feat: fold registered sources into the manifest and fingerprint

gatherAll reads project files live - they are committed, present, and cheap
- and takes everything else from the index rather than re-extracting it.
Spec 8.1 keeps fetching out of scan for reproducibility; the same argument
applies to extraction, so an ordinary scan stays fast and cannot depend on
whether anyone ran --ingest first.

A locale with any estimated contributor is marked estimated as a whole,
which under parent spec 5.4 caps every rule it supports at assumed."
```

---

### Task 13: URL sources

The one piece of network code in the plugin, kept deliberately separate from everything `scan` touches.

**Files:**
- Create: `scripts/lib/fetchurl.mjs`
- Modify: `scripts/sources.mjs` — `--refresh`
- Test: `test/fetchurl.test.mjs`

**Interfaces:**
- Produces: `fetchPage(url, { fetchImpl }) -> { ok, status, body, contentType }`; `ingestUrl(entry, { kbRoot, now, id, locale, fetchImpl }) -> IndexEntry`; `snapshotPathFor(kbRoot, id, date) -> string`.

- [ ] **Step 1: Write the failing test**

`test/fetchurl.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { ingestUrl, snapshotPathFor } from '../scripts/lib/fetchurl.mjs'

const NOW = '2026-08-27T00:00:00.000Z'
const PAGE = `<!doctype html><html><head><title>About</title><style>b{}</style></head>
<body><script>var x=1</script><h1>How we write</h1>
<p>We write plainly. We keep every sentence short.</p>
<img alt="A team at a desk" src="x.png"></body></html>`

const stub = (body, { status = 200, contentType = 'text/html' } = {}) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
  text: async () => body
})

test('a fetched page is extracted through the existing html path', async () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const entry = await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://acme.com/about', label: 'About', retain: 'none' },
      { kbRoot: kb, now: NOW, id: 'f001', locale: 'en', fetchImpl: stub(PAGE) }
    )

    assert.equal(entry.kind, 'url')
    assert.equal(entry.status, 'used')
    assert.equal(entry.tier, 'script')
    assert.equal(entry.fidelity, 'measured')
    const text = entry.stats
    assert.ok(text.words > 5)
    assert.equal(entry.origin, 'https://acme.com/about')
  } finally {
    cleanup(dir)
  }
})

test('scripts and styles do not become corpus, and alt text does', async () => {
  const dir = makeTmpProject({})
  try {
    const entry = await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://acme.com/about', retain: 'none' },
      { kbRoot: path.join(dir, '.voice-and-tone'), now: NOW, id: 'f001', locale: 'en', fetchImpl: stub(PAGE) }
    )
    // extractHtml already handles this; the test guards the wiring, not the parser.
    assert.ok(entry.quality.passed)
    assert.ok(entry.stats.words >= 10)
  } finally {
    cleanup(dir)
  }
})

test('retain none writes no snapshot; retain snapshot writes a committed one', async () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://acme.com/a', retain: 'none' },
      { kbRoot: kb, now: NOW, id: 'f001', locale: 'en', fetchImpl: stub(PAGE) }
    )
    assert.equal(existsSync(snapshotPathFor(kb, 'f001', '2026-08-27')), false)

    await ingestUrl(
      { id: 's05', kind: 'url', url: 'https://acme.com/b', retain: 'snapshot' },
      { kbRoot: kb, now: NOW, id: 'f002', locale: 'en', fetchImpl: stub(PAGE) }
    )
    assert.equal(existsSync(snapshotPathFor(kb, 'f002', '2026-08-27')), true)
  } finally {
    cleanup(dir)
  }
})

test('a JS-rendered shell fails the gate and is marked for the model tier', async () => {
  const dir = makeTmpProject({})
  try {
    const shell = '<!doctype html><html><body><div id="root"></div><script src="app.js"></script></body></html>'
    const entry = await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://spa.example', retain: 'none' },
      { kbRoot: path.join(dir, '.voice-and-tone'), now: NOW, id: 'f001', locale: 'en', fetchImpl: stub(shell) }
    )
    assert.equal(entry.status, 'skipped')
    assert.ok(entry.quality.reasons.some((r) => r.startsWith('empty')))
  } finally {
    cleanup(dir)
  }
})

test('a non-200 response is recorded as skipped with its status, not thrown', async () => {
  const dir = makeTmpProject({})
  try {
    const entry = await ingestUrl(
      { id: 's04', kind: 'url', url: 'https://acme.com/gone', retain: 'none' },
      { kbRoot: path.join(dir, '.voice-and-tone'), now: NOW, id: 'f001', locale: 'en', fetchImpl: stub('', { status: 404 }) }
    )
    assert.equal(entry.status, 'skipped')
    assert.ok(entry.quality.reasons.join(' ').includes('404'))
  } finally {
    cleanup(dir)
  }
})

test('the hash is of the fetched body, so an unchanged page re-ingests identically', async () => {
  const dir = makeTmpProject({})
  const kb = path.join(dir, '.voice-and-tone')
  try {
    const opts = { kbRoot: kb, now: NOW, locale: 'en', fetchImpl: stub(PAGE) }
    const a = await ingestUrl({ id: 's04', kind: 'url', url: 'https://acme.com/x', retain: 'none' }, { ...opts, id: 'f001' })
    const b = await ingestUrl({ id: 's04', kind: 'url', url: 'https://acme.com/x', retain: 'none' }, { ...opts, id: 'f002' })
    assert.equal(a.sha256, b.sha256)
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/fetchurl.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/fetchurl.mjs'`

- [ ] **Step 3: Implement fetchurl.mjs**

`scripts/lib/fetchurl.mjs`:

```js
import path from 'node:path'
import { writeTextFile } from './fsx.mjs'
import { extractStrings, extractHeadings } from './extract.mjs'
import { scoreExtraction } from './quality.mjs'
import { statsFor } from './metrics.mjs'
import { sha256Text } from './hash.mjs'
import { cachePathFor } from './ingest.mjs'

/**
 * The only network code in the plugin, and deliberately not on any path that
 * scan or fingerprint can reach.
 *
 * Spec 8.1: fetching during a scan would make the fingerprint depend on
 * someone else's web server, would require connectivity for every run, and
 * would defeat the --now determinism the other scripts are built around. So a
 * page is fetched once, on request, and read from the cache thereafter.
 *
 * The parsing is free: extractHtml in extract.mjs already strips scripts and
 * styles, harvests alt/title/aria-label/placeholder, and decodes entities. A
 * fetched page is just an .html file entering a path that is already tested.
 */

const USER_AGENT = 'voice-and-tone-plugin (+https://example.invalid/voice-and-tone)'

export function snapshotPathFor (kbRoot, id, date) {
  return path.join(kbRoot, 'evidence', 'snapshots', `${id}-${date}.html`)
}

export async function fetchPage (url, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('no fetch implementation available; Node 18 or newer is required')
  }
  const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' } })
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers?.get?.('content-type') ?? '',
    body: response.ok ? await response.text() : ''
  }
}

export async function ingestUrl (entry, { kbRoot, now, id, locale = 'en', fetchImpl = globalThis.fetch }) {
  const date = now.slice(0, 10)
  const base = {
    id,
    kind: 'url',
    from: entry.id,
    origin: entry.url,
    label: entry.label ?? null,
    format: 'html',
    locale,
    tier: 'script',
    fidelity: 'measured',
    added: date,
    analysed: date,
    produced: []
  }

  let page
  try {
    page = await fetchPage(entry.url, { fetchImpl })
  } catch (error) {
    return {
      ...base, sha256: sha256Text(entry.url), bytes: 0,
      quality: { passed: false, reasons: [`fetch failed: ${error.message}`], tokens: 0 },
      stats: null, status: 'skipped'
    }
  }

  if (!page.ok) {
    return {
      ...base, sha256: sha256Text(`${entry.url}#${page.status}`), bytes: 0,
      quality: { passed: false, reasons: [`fetch returned ${page.status}`], tokens: 0 },
      stats: null, status: 'skipped'
    }
  }

  const sha256 = sha256Text(page.body)
  // A fake .html path so the existing format router picks the html extractors.
  const pseudoPath = `${entry.url.replace(/[^\w.-]/g, '_')}.html`
  const strings = extractStrings(pseudoPath, page.body).strings
  const headings = extractHeadings(pseudoPath, page.body)

  const quality = strings.length === 0
    ? { passed: false, reasons: ['empty: no text recovered (a JS-rendered page needs the model tier)'], tokens: 0 }
    : scoreExtraction(strings.join('\n'), { locale })

  if (quality.passed) {
    writeTextFile(cachePathFor(kbRoot, sha256), `${strings.join('\n')}\n`)
    // Retention is opt-in (spec 8.3). A URL is the one source whose bytes
    // nobody can recover once the page changes, so when confirmed rules will
    // rest on it, the snapshot is the only thing that can substantiate them.
    if (entry.retain === 'snapshot') writeTextFile(snapshotPathFor(kbRoot, id, date), page.body)
  }

  return {
    ...base,
    sha256,
    bytes: Buffer.byteLength(page.body, 'utf8'),
    quality,
    stats: quality.passed ? statsFor({ strings, headings, locale }) : null,
    status: quality.passed ? 'used' : 'skipped'
  }
}
```

- [ ] **Step 4: Wire --refresh into sources.mjs**

Add `refresh: { type: 'boolean' }` to the option list in `main`, add a line to `printHelp`, and add an async branch that fetches every `kind: 'url'` register entry (or only the one named by `--forget`-style id filtering), upserts each result, and saves the index. Because `ingestUrl` is async, extract that branch into an exported `runRefresh(ctx, { only })` and `await` it in `main` — turn `main` into an `async function` and keep the top-level guard as `main(...).catch((e) => die(e.message))`.

- [ ] **Step 5: Run the suite**

Run: `node --test test/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/fetchurl.mjs scripts/sources.mjs test/fetchurl.test.mjs
git commit -m "feat: url sources, fetched explicitly and never during a scan

Fetching inside gatherCorpus would make the fingerprint depend on someone
else's web server and require connectivity for every run, so a page is
fetched once by /connect and read from the cache thereafter.

The parsing was already written: extractHtml strips scripts and styles and
harvests alt and aria-label text, so a fetched page enters a tested path. A
JS-rendered shell yields nothing, fails the gate, and is marked for the
model tier. Snapshot retention stays opt-in per spec 8.3."
```

---

### Task 14: Index integrity in `validate.mjs`

An index nobody checks drifts from the ledger it is supposed to mirror. These checks are cheap and catch the failures that make retraction impossible later.

**Files:**
- Modify: `scripts/validate.mjs`
- Test: `test/validate.test.mjs`

**Interfaces:**
- Produces: five new checks, reported through the existing finding mechanism and honouring exit code `2`.

Checks to add:

| Check | Why it matters |
|---|---|
| Every `produced` rule id exists in the knowledge base | A dangling id makes `--forget` unable to reopen the right rules |
| Every rule carrying `source`-type evidence resolves to an index entry | Closes the gap where a model-read style guide left no trace at all |
| No two index entries share a `sha256` | Duplicate identity breaks the no-op-on-re-add guarantee |
| Every non-`skipped` entry has a `stats` block | A source with no statistics silently drops out of the fingerprint |
| No cache file under `.cache/extracts/` lacks an index entry | Orphaned cache is harmless but signals an interrupted ingest |
| Every entry's `extractor.version` matches `vendor/manifest.json` | A vendored library was bumped; those sources must be re-ingested, or their numbers shift under the baseline with nothing saying why |

- [ ] **Step 1: Write the failing test**

Append to `test/validate.test.mjs` one case per check, each building a minimal knowledge base with exactly one defect and asserting the finding text and the exit code. Follow the shape the file already uses for its existing checks — the same fixture helper, the same assertion style — so the new cases read as part of the set rather than bolted on.

```js
test('a produced rule id that does not exist is reported', () => {
  const dir = makeTmpProject({ /* KB with a rule V1, index entry producing V9 */ })
  try {
    const report = validate(path.join(dir, '.voice-and-tone'))
    assert.ok(report.errors.some((e) => /V9/.test(e) && /sources\.json/.test(e)), report.errors.join('; '))
  } finally {
    cleanup(dir)
  }
})

test('two index entries with the same hash are reported', () => { /* ... */ })
test('a used entry with no stats block is reported', () => { /* ... */ })
test('an orphaned extract cache file is reported as a warning, not an error', () => { /* ... */ })
```

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `node --test test/validate.test.mjs`

- [ ] **Step 3: Commit**

```bash
git add scripts/validate.mjs test/validate.test.mjs
git commit -m "feat: validate the source index against the knowledge base

Checks that every produced rule id exists, that every rule with source-type
evidence resolves to an index entry, that no two entries share a hash, and
that every used entry carries statistics. A dangling produced id would make
--forget unable to reopen the right rules; a missing stats block would drop
a source out of the fingerprint without anything saying so."
```

---

### Task 15: The surface

Commands, templates, and the skill guidance that makes the model tier act. This is where `--add`, promised in `commands/init.md:19` since the first commit and never implemented, finally becomes real.

**Files:**
- Create: `commands/connect.md`, `skills/voice-discovery/references/sourcing.md`, `templates/kb/sources/README.md`
- Modify: `commands/init.md`, `skills/voice-discovery/SKILL.md`, `templates/kb/config.yml`, `templates/kb/gitignore`, `README.md`
- Test: `test/surface.test.mjs`, `test/templates.test.mjs`

- [ ] **Step 1: Write the failing surface tests**

Append to `test/surface.test.mjs`, following the assertions the file already makes about each command:

```js
test('connect is a real command naming the skill it invokes', () => {
  const body = readTextFile(path.join(PLUGIN_ROOT, 'commands', 'connect.md'))
  assert.match(body, /^---\ndescription:/m)
  assert.match(body, /voice-discovery/)
  for (const flag of ['--inbox', '--refresh', '--forget']) assert.ok(body.includes(flag), flag)
})

test('init documents --add as implemented, pointing at the script that does it', () => {
  const body = readTextFile(path.join(PLUGIN_ROOT, 'commands', 'init.md'))
  assert.match(body, /--add/)
  assert.match(body, /sources\.mjs/, 'the promise is now backed by a script')
})

test('the discovery skill tells the model what to do on an escalation', () => {
  const body = readTextFile(path.join(PLUGIN_ROOT, 'skills', 'voice-discovery', 'references', 'sourcing.md'))
  assert.match(body, /estimated/)
  assert.match(body, /never .*derived/i)
  assert.match(body, /sources\.mjs/)
})
```

Append to `test/templates.test.mjs`:

```js
test('the KB gitignore excludes sources and the extract cache but not the index', () => {
  const body = readTextFile(path.join(PLUGIN_ROOT, 'templates', 'kb', 'gitignore'))
  assert.match(body, /^sources\/$/m)
  assert.match(body, /^\.cache\/$/m)
  assert.ok(!/sources\.json/.test(body), 'the index must stay committed')
})

test('the template config declares a register that reproduces current behaviour', () => {
  const config = parseYaml(readTextFile(path.join(PLUGIN_ROOT, 'templates', 'kb', 'config.yml')))
  assert.ok(Array.isArray(config.sources))
  assert.equal(config.sources[0].kind, 'project')
  assert.ok(config.sources.some((s) => s.kind === 'inbox'))
})
```

- [ ] **Step 2: Write `commands/connect.md`**

```markdown
---
description: Register brand material, see what has already been analysed, and ingest what is new
argument-hint: "[<path|url>] [--inbox] [--refresh] [--forget <id>]"
---

# /voice-and-tone:connect

Brand material is an input, not an artifact. Drop files into
`.voice-and-tone/sources/`, or point at anything on disk or on the web. Nothing
you add is committed; what survives is `evidence/sources.json`, the record of
exactly what has been analysed.

## Usage

```
/voice-and-tone:connect                  what is new, changed, or missing
/voice-and-tone:connect <path>           register a file or folder, anywhere on disk
/voice-and-tone:connect <url>            register and fetch a page
/voice-and-tone:connect --inbox          analyse everything newly dropped in
/voice-and-tone:connect --refresh [<id>] re-fetch URLs, re-extract changed files
/voice-and-tone:connect --forget <id>    retract a source and reopen its rules
```

## What it reads

Deterministically, with no dependencies: Markdown, plain text, JSON, YAML, PO,
HTML, RTF, CSV/TSV, WebVTT/SubRip, `.docx`, `.pptx`, `.xlsx`, `.odt`, `.odp`,
`.ods`, and PDFs with a text layer.

Scanned PDFs, images, and JS-rendered pages are read by the model instead, and
are recorded as `estimated` — they can support `assumed` rules but never
`derived` ones.

`.doc`, `.ppt`, and `.xls` are refused: re-save them as the modern format.

## Invokes

The `voice-discovery` skill.

$ARGUMENTS
```

- [ ] **Step 3: Write `templates/kb/sources/README.md`**

```markdown
# Drop brand material here

Anything you want the voice derived from: past newsletters, the brand deck, a
tone-of-voice PDF, exported blog posts, webinar transcripts.

**These files are not committed, and that is deliberate.** They are inputs, not
artifacts. Client material should not end up in a git history, and decks do not
belong in a repository.

What survives is `../evidence/sources.json`: every source's content hash, what
was extracted from it, how much text it held, and which rules it produced. That
record is rich enough to recompute the whole voice fingerprint and to subtract
any single source — so a colleague who clones this repository with an empty
`sources/` folder still gets the correct baseline, not a false drift report.

Run `/voice-and-tone:connect --inbox` after adding anything.

To commit these files anyway, delete the `sources/` line from `.gitignore`.
```

- [ ] **Step 4: Update the templates**

Add to `templates/kb/gitignore`:

```gitignore
# Dropped-in source material. Inputs, not artifacts - never committed.
# The analysis survives in evidence/sources.json; these files need not.
sources/

# Extraction cache, keyed by content hash. Regenerable at any time.
.cache/
```

Add to `templates/kb/config.yml`, after `scan:`:

```yaml
# Where brand material comes from. The `project` entry reproduces the scan
# globs above; `inbox` is the folder you drop files into. Add `local` entries
# for anything elsewhere on disk and `url` entries for pages, with
# /voice-and-tone:connect.
sources:
  - id: s01
    kind: project
    label: "Project files"
    include:
      - "content/**/*.md"
      - "content/**/*.mdx"
      - "docs/**/*.md"
      - "locales/**/*.json"
      - "locales/**/*.yml"
      - "locales/**/*.po"
      - "README.md"
    exclude:
      - "node_modules/**"
      - "dist/**"
      - "build/**"
      - ".git/**"
      - ".voice-and-tone/**"
  - id: s02
    kind: inbox
    label: "Dropped-in files"
    path: "sources/"
```

- [ ] **Step 5: Write `skills/voice-discovery/references/sourcing.md`**

Cover, in the reference style the other files in that directory use:

- The ladder, and that the tier boundary is the quality gate rather than the file format
- How to run `node "<plugin>/scripts/sources.mjs" --check` and `--ingest`, and how to read the report
- **What to do on an escalation:** for each source `--ingest` lists under `needs the model tier`, read it with the Read tool (PDFs with the `pages` parameter, images directly), transcribe faithfully without summarising, and write it back with `ingestText`, `tier: 'model'`
- That a model-tier source is `estimated` and may only ever produce `assumed` rules, never `derived` — restating parent spec 5.4 rather than assuming it is remembered
- That `missing` sources are normal and must not be presented to the user as a problem
- The cost warning: report the escalation count and ask before transcribing more than ten sources

- [ ] **Step 6: Update `SKILL.md` and `init.md`**

In `skills/voice-discovery/SKILL.md`, replace the current step 1 and step 2 with a sourcing step that asks where material lives before scanning, mentions `.voice-and-tone/sources/` explicitly, runs `sources.mjs --check`, and points at `references/sourcing.md`. Fold today's step 2 (Ingest) into it: an existing style guide is now a registered source, not an ad-hoc read.

In `commands/init.md`, change the `--add` paragraph so it names `sources.mjs` and cross-references `/voice-and-tone:connect`.

- [ ] **Step 7: Update `README.md`**

Add a short "Where your material goes" section covering the inbox, that nothing is committed, the supported formats, and the one-line escape hatch for committing anyway.

- [ ] **Step 8: Run the suite**

Run: `node --test test/`
Expected: PASS, including `conformance.test.mjs` — the new command and reference files must satisfy the same cross-platform sweep as the rest of the plugin.

- [ ] **Step 9: Commit**

```bash
git add commands/connect.md commands/init.md skills/voice-discovery \
        templates/kb README.md test/surface.test.mjs test/templates.test.mjs
git commit -m "feat: /voice-and-tone:connect, the sources inbox, and model-tier guidance

Makes --add real - it has been documented in commands/init.md since the
first commit with nothing behind it, and the surface test only ever
asserted that the string appeared in the file.

The generated KB now creates .voice-and-tone/sources/ with a README
explaining why it is gitignored, and the skill reference tells the model
what to do when the script tier escalates: transcribe faithfully, write
back as tier model, and accept that the result is estimated and can never
support a derived rule."
```

---

### Task 16: Migration and the end-to-end proof

Existing knowledge bases must keep working untouched, and the claim this whole plan rests on deserves one test that exercises it from a real directory rather than from unit fixtures.

**Files:**
- Create: `test/migration.test.mjs`
- Modify: `test/conformance.test.mjs`

- [ ] **Step 1: Write the migration and end-to-end tests**

`test/migration.test.mjs`:

```js
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
    runIngest(ctx, {})

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
```

- [ ] **Step 2: Extend the conformance sweep**

`test/conformance.test.mjs` enforces the parent spec's section 9 rules mechanically. Add the new files to whatever list it walks, and add one rule specific to this work:

```js
test('no library shells out to an external converter', () => {
  // Spec 12: pdftotext on one machine and not another means the same corpus
  // fingerprints differently on two laptops. The ban has to be mechanical.
  for (const file of allPluginScripts()) {
    const body = readTextFile(file)
    assert.ok(
      !/child_process|execSync|spawnSync|pdftotext|pandoc|textutil|libreoffice|soffice/.test(body),
      `${file} reaches for an external tool`
    )
  }
})
```

- [ ] **Step 3: Run the full suite**

Run: `node --test test/`
Expected: PASS, every test.

- [ ] **Step 4: Verify against the real corpus**

Unit fixtures prove the parsers; a real corpus proves the pipeline. Point a scratch knowledge base at a directory of genuine brand material and confirm the counts are plausible and the escalation list is short:

```bash
node scripts/sources.mjs --add "<a real folder of brand material>" --label "Real corpus" --kb /tmp/vat-kb --root /tmp/vat
node scripts/sources.mjs --ingest --kb /tmp/vat-kb --root /tmp/vat
node scripts/fingerprint.mjs --kb /tmp/vat-kb --root /tmp/vat --json
```

Expected: every text file `used`; PDFs with a text layer `used` at `measured`; scanned PDFs and images listed under `needs the model tier`. A text-layer PDF landing in the escalation list means the width-based spacing in Task 6 needs attention — check the recorded `quality.reasons` to see whether words were merged or split.

- [ ] **Step 5: Commit**

```bash
git add test/migration.test.mjs test/conformance.test.mjs
git commit -m "test: migration parity and the end-to-end disposability proof

Asserts that a config predating the register produces a bit-identical
manifest and fingerprint, and - the claim the whole design rests on - that
a knowledge base reproduces its baseline exactly after every source file is
deleted from disk. If that second test ever fails, :audit reports
fictitious brand drift on every fresh clone.

Adds a mechanical ban on shelling out to external converters, because a
tool present on one machine and absent on another would make the same
corpus fingerprint differently on two laptops."
```

---

## Notes for the executor

**The one test that matters most.** `test/migration.test.mjs`'s second case — a fingerprint unchanged after every source is deleted — is the design's central claim. Everything else is machinery in service of it. If it fails, stop and fix the statistics layer rather than working around it.

**Where the risk actually is — and where it moved to.** It used to be PDF word spacing: a hand-written extractor scored 96 to 98 percent word recall on three real files and then *regressed* to 81 to 89 percent when a spacing heuristic was added to fix a fourth. Vendoring pdfjs removed that risk entirely; it scores 100 percent on the same three and passes the gate.

What is left is smaller and different in kind: **the vendored bundles are third-party APIs that can change shape between versions.** `officeparser` in particular took four attempts to call correctly — the working form is `(await parseOffice(buf)).toText()`, not the `parseOfficeAsync` the README suggests. If an adapter fails after a version bump, inspect the vendored bundle's exports directly rather than the upstream docs:

```bash
node -e "console.log(Object.keys(require('./vendor/officeparser/officeparser.cjs')))"
```

**Do not loosen the gate to make things pass.** Its thresholds are measurements. A source failing the gate is the system working: the escalation costs tokens, but a bad extraction feeds a confident, precise, wrong fingerprint into rules the plugin will then enforce.

**Order matters between Tasks 1 and 7.** Task 1's fixture uses `.docx` as an example of an unsupported extension. Task 7 makes `.docx` supported. Change that fixture to something genuinely unsupported (`.sketch`, `.fig`) when you get there — the behaviour under test is unchanged.

**Two deliberate deviations from the spec, both narrowing:**

1. The spec's section 10.4 lists a standalone `scripts/extract-doc.mjs` for extracting one file to stdout. This plan omits it. Extraction is reachable through `sources.mjs --ingest` and is directly unit-tested per format, so a second CLI would be a third caller of the same libraries with no behaviour of its own. Add it if debugging turns out to want it; nothing in the design depends on it.
2. The spec's section 6.3 fixes the sentence-length buckets at `1-5 / 6-10 / 11-20 / 21-40 / 41+`, and Task 2 implements exactly those. Width-1 buckets to 40 would make the reconstructed median effectively exact for about 40 extra small integers per index entry. Raise it with the spec author rather than changing it unilaterally — the bucket choice is recorded as an approved decision, not an implementation detail.
