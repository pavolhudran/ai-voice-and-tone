# Source Ingestion — Design Spec

**Date:** 2026-08-27
**Status:** Approved for planning
**Repo:** `ai-voice-and-tone`
**Extends:** `2026-08-26-voice-and-tone-plugin-design.md` (§5.2 Scan, §5.4 Runtime, §7.2 `--add`)

---

## 1. Purpose

Give the plugin a real answer to two questions it currently cannot answer:

1. **Where does a user put brand material** they want the voice derived from?
2. **How does the plugin read** the formats that material actually arrives in — DOCX,
   PDF, PPTX, and live web pages — rather than only the ten text extensions it
   allowlists today?

Scope is **sourcing only**: how material is registered, identified, extracted,
indexed, and handed to the existing corpus pipeline. Everything downstream — the
fingerprint, rule drafting, the interview, review — is unchanged by design.

### 1.1 The core idea

> Sources are inputs, not artifacts. Keep the knowledge, discard the material.

Nothing a user drops in is committed. What survives is an **index** carrying each
source's identity, provenance, and *sufficient statistics* — enough to recompute
the entire fingerprint and to subtract any single source, with no source text
retained anywhere.

That one decision is what makes confidential client corpora safe to analyse and
makes the knowledge base portable across machines.

### 1.2 Non-goals

- Not a document viewer, converter, or archive. Extraction is a means to metrics.
- Not OCR. A scanned page with no text layer escalates to the model tier or is skipped.
- Not a crawler. A URL source is one page, fetched on request, never followed.
- No new runtime dependency. §9 of the parent spec holds without exception.

---

## 2. Current state

Verified against the code on 2026-08-27, not inferred from the docs.

### 2.1 The single ingestion path

`gatherCorpus()` (`scripts/lib/corpus.mjs:26`) is the only function in the plugin
that reads project files for corpus purposes. Both `scan.mjs` and `fingerprint.mjs`
call it and nothing else. It returns a uniform record per file:

```js
{ rel, abs, format, locale, strings, headings }
```

**This is the extension point.** Anything that can produce that shape participates
in the manifest, the per-locale bucketing, the fingerprint, and the drift baseline
with no downstream change whatsoever.

### 2.2 Gap A — material outside the project is unreachable

`gatherCorpus` calls `walk(projectRoot, config.scan)` (`fsx.mjs:47`), which recurses
from `projectRoot` and matches POSIX globs against paths relative to it. There is no
mechanism by which a glob can escape the project root. Material on the user's disk
but outside the repo cannot be reached at all.

`commands/init.md:19` advertises `/voice-and-tone:init --add <path-or-url>`. Nothing
implements it. `test/surface.test.mjs:64` asserts only that the string `--add`
appears in the command file, so the suite is green over an unimplemented feature.

### 2.3 Gap B — unsupported formats are dropped silently

`formatFor()` (`extract.mjs:20`) looks up the extension in `COPY_EXTENSIONS`
(`extract.mjs:5`), a ten-entry allowlist. Anything else yields `format: null`, and
`corpus.mjs:37` does `if (!format) continue` — **before** the `unreadable`
bookkeeping on line 40 that exists for malformed JSON.

Reproduced: a directory holding a valid `.docx` alongside `notes.md` and `notes.txt`,
with `include: ["content/**/*"]`, reports

```
scan: 2 files, 2 strings, 8 words, 2 sentences
scan: 0 unreadable json file(s)
```

The `.docx` appears in neither `files` nor `unreadable`. There is no signal of any
kind that a file was seen and discarded.

### 2.4 Gap C — URLs are prose only

`commands/init.md:19` and `skills/voice-discovery/SKILL.md:55` both promise URL
ingestion. No code in the plugin performs a network request; the only `node:url`
imports are `pathToFileURL` for main-module guards.

### 2.5 Two ingestion paths that do not know about each other

Beyond the script path above, `voice-discovery/SKILL.md` step 2 instructs the model
to read any style guide it finds and enter its rules at `confirmed` with `source`
evidence. That is the **model** using its Read tool. Nothing records which file it
was, nothing re-reads it on `:sync`, and `validate.mjs` cannot check it.

This spec unifies both under one register. A model-read document becomes a
registered source like any other.

### 2.6 Incidental defect

`corpus.mjs:34` calls `readTextFile(abs)` before the `formatFor()` check on line 37. Every file matched
by an include glob is fully read into memory as UTF-8 before its format is checked.
Point `scan.include` at a directory holding a large binary and the scan reads all of
it to throw it away. The format gate must run on the path, before the read.

---

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | An inbox directory `<KB>/sources/`, gitignored | One obvious place to drop files; not an artifact |
| D2 | Sources are **never committed** | They are inputs. Confidentiality, repo weight, and binaries in git |
| D3 | Extracts are cached, gitignored, regenerable | Determinism and offline scans without storing material |
| D4 | The index `evidence/sources.json` **is** committed | The only thing that must survive; the record of what was analysed |
| D5 | Identity is **sha256**, never path | Portable across machines; re-adding a known file is a detectable no-op |
| D6 | The index stores **sufficient statistics** | Makes the fingerprint recomputable and any source subtractable with no text |
| D7 | Script tier first, always; model tier only on gate failure | Scripts are cheap and deterministic; the model is neither |
| D8 | A deterministic **quality gate** decides the tier boundary, not the file format | A bad extraction manufactures data, which is worse than losing it |
| D9 | Model-tier extraction is capped at `estimated` fidelity | Reuses §5.4 rather than inventing a mode |
| D10 | URL fetching is an explicit step, never part of `scan` | Network in `gatherCorpus` destroys reproducibility |
| D11 | `missing` is a normal status, not an error | With nothing committed, a fresh clone has zero sources present |

### 3.1 Why sources are not committed (D2), and what it costs

A brand corpus is client material. Committing it into a plugin-managed directory
inside the client's repository is a confidentiality exposure nobody requested, and
git is a poor store for decks and PDFs.

The cost is real and must be paid explicitly. `fingerprint.mjs:55-61` compares the
current corpus against a stored `baseline`, and §7.3 of the parent spec reports the
delta as *drift in the brand's writing*. If sources are absent on a colleague's
clone, a naive re-run would report large, confident, entirely fictitious drift.

D6 is the payment. See §6.

---

## 4. The source register

### 4.1 Shape

`config.yml` gains a `sources:` list. Today's `scan.include`/`scan.exclude` becomes
one entry of kind `project`, so nothing about existing behaviour changes.

```yaml
sources:
  - id: s01
    kind: project              # today's globs, migrated verbatim
    include: ["content/**/*.md", "docs/**/*.md", "README.md"]
    exclude: ["node_modules/**", "dist/**", ".git/**", ".voice-and-tone/**"]

  - id: s02
    kind: inbox                # <KB>/sources/, created and gitignored at init
    path: "sources/"

  - id: s03
    kind: local                # anywhere on disk. Never copied, never committed
    path: "~/Brand/deck-2026.pptx"
    label: "Brand deck 2026"

  - id: s04
    kind: url                  # fetched on request, never during scan
    url: "https://acme.com/about"
    label: "About page"
    retain: none               # none (default) | snapshot
```

### 4.2 Kinds

| Kind | Resolves to | Walked? |
|---|---|---|
| `project` | Globs relative to `projectRoot` — today's `walk()` | yes |
| `inbox` | `<KB>/sources/`, recursively | yes |
| `local` | An absolute or `~`-relative path; a file or a directory | yes, if a directory |
| `url` | One page. Fetched by `/connect`, never by `scan` | no |

`local` and `inbox` entries reuse `walk()` with the entry's own root, so pruning,
symlink skipping (§9), and sorted traversal behave identically everywhere.

### 4.3 The inbox

`<KB>/sources/` is created at init with a `README.md` explaining what it is, and is
added to `<KB>/.gitignore` alongside the existing `.drafts/` line:

```gitignore
# Plugin-produced drafts, kept for :learn. Pruned at 90 days.
.drafts/
# Dropped-in source material. Inputs, not artifacts - never committed.
# The analysis survives in evidence/sources.json; these files do not need to.
sources/
# Extraction cache. Regenerable from the originals at any time.
.cache/
```

A user who deliberately wants public copy committed deletes one line. That must be
documented, because the default is otherwise indistinguishable from an accident.

---

## 5. Identity and the index

### 5.1 ID scheme

Register entries take `s` + monotonic integer (`s01`, `s02`). Index entries take
`f` + monotonic integer (`f001`, `f017`), never reused, in the spirit of parent §4.5.
Neither collides with the rule prefixes `V T L M C A X` or with evidence's `e`.

### 5.2 Identity is the content hash

Every source is keyed by `sha256` of its bytes (`node:crypto`, built in). Not its
path.

This falls directly out of D2: because nothing is committed, the same
`Persona_B2C.pdf` sits at a different path on every machine. Hashing makes the index
portable, and makes re-adding a known file a no-op with a useful message:

```
connect: Persona_B2C.pdf already analysed 2026-08-27 as f017 (produced V3, L07, M02)
```

For `kind: url`, the hash is of the fetched body; the URL itself is recorded
separately so a refetch can be diffed against the previous hash.

### 5.3 `evidence/sources.json` — committed

Follows the established `evidence/*.json` conventions: generated, sorted for stable
diffs, `--now`-stampable.

**Register entries and index entries are not one-to-one.** A register entry (§4.1)
says *where to look* and has kind `project`, `inbox`, `local`, or `url`. An index
entry records *one analysed thing* and has kind `file` or `url` only — a single
`inbox` or `local` directory entry resolves to many index entries. Each index entry
carries `from` naming the register entry it came from.

```jsonc
{
  "generated": "2026-08-27T09:00:00.000Z",
  "sources": [
    {
      "id": "f017",
      "sha256": "9f2a1c…",
      "kind": "file",
      "from": "s02",
      "origin": "sources/Persona_B2C_zakaznice.pdf",
      "label": "B2C persona, 2022",
      "format": "pdf",
      "bytes": 168105,
      "locale": "cs",

      "tier": "script",
      "fidelity": "measured",
      "quality": {
        "passed": true,
        "meanTokenLen": 5.76,
        "singleShare": 0.0,
        "long20Share": 0.0,
        "replShare": 0.0
      },

      "stats": {
        "strings": 41, "words": 101, "sentences": 11, "paragraphs": 9,
        "sumWordLen": 582, "sumSentLen": 101, "sumSentLenSq": 1291,
        "syllablesEn": null,
        "sentLenHist": { "1-5": 3, "6-10": 5, "11-20": 3, "21-40": 0, "41+": 0 },
        "exclamations": 0, "questions": 2,
        "firstPerson": 4, "secondPerson": 9,
        "emoji": 0, "emDash": 1, "semicolon": 0,
        "headingsTitleCase": null, "headingsTotal": 3
      },

      "added": "2026-08-27",
      "analysed": "2026-08-27",
      "status": "used",
      "produced": ["V3", "L07", "M02"]
    }
  ]
}
```

### 5.4 Status vocabulary

| Status | Meaning | Reported as |
|---|---|---|
| `new` | Registered, not yet analysed | actionable |
| `used` | Analysed; its statistics are in the aggregate | normal |
| `missing` | Not present on this machine; statistics intact | **informational, never a warning** |
| `stale` | The register still points here, but the hash no longer matches | actionable |
| `skipped` | Refused (unsupported legacy format, encrypted, empty) with a reason | informational |

`missing` is the ordinary state on a fresh clone (D11). If the plugin nags about it,
users will commit sources purely to silence it, which quietly undoes D2. `scan`
prints one calm line:

```
scan: 72 sources known, 0 present locally, statistics intact
```

### 5.5 Bidirectionality

`produced` mirrors the ledger's `Produced:` line (parent §4.6). A source knows which
rules it made; each rule's evidence points back. This is what makes *"ignore the 2024
newsletters"* tractable — and, combined with §6, actually executable rather than
merely traceable.

---

## 6. Sufficient statistics — why the text is disposable

### 6.1 The claim

Every metric `computeFingerprint()` produces is a count, a ratio of counts, or a
value recoverable from sums and a bounded histogram. Therefore the per-source
`stats` block in §5.3 is a **sufficient statistic** for the fingerprint: the
aggregate can be recomputed exactly, and any source can be subtracted exactly,
with no source text present.

| Metric (`metrics.mjs`) | Recovered from |
|---|---|
| `wordCount`, `sentenceCount`, `paragraphCount` | counts, additive |
| `meanSentenceLength` | `sumSentLen / sentences` |
| `meanWordLength` | `sumWordLen / words` |
| `sentenceLengthSd` | `sumSentLen`, `sumSentLenSq`, `sentences` |
| `medianSentenceLength` | `sentLenHist` (bucketed; see §6.3) |
| `exclamationRate`, `questionRate` | count ÷ `sentences` |
| all `*Per1000Words` | count ÷ `words` |
| `readingGrade` | `0.39·(W/S) + 11.8·(Syl/W) − 15.59` from `words`, `sentences`, `syllablesEn` |
| `passiveRate`, `imperativeOpenerRate`, `longWordRate`, `oxfordCommaRate` | count ÷ count |
| `headingTitleCaseRatio` | `headingsTitleCase / headingsTotal` |

### 6.2 The invariant, as a test

The plan must assert this rather than assume it:

```
computeFingerprint(corpus A ∪ B)  ==  mergeStats(stats(A), stats(B))
```

for every metric, on a fixture corpus, per locale. If that test passes, "sources are
disposable" is proven. If it cannot be made to pass for a given metric, that metric
must either gain the statistic it needs or be documented as
baseline-only-when-sources-present.

### 6.3 The one approximation

`medianSentenceLength` is the sole metric that is not exactly additive. It is
recovered from a bucketed histogram, so a merged median is accurate to the bucket,
not to the unit. Buckets `1-5 · 6-10 · 11-20 · 21-40 · 41+` are adequate because the
median is used for shape comparison against the brand's own baseline, never against
an absolute threshold. This approximation must be stated in the fingerprint output
rather than hidden.

### 6.4 What this buys

- A colleague with an empty `sources/` gets the **correct** baseline, not fictitious drift
- Retraction becomes subtraction, not deletion — the fingerprint without the retracted
  source is computed, not guessed
- Confidential material can be analysed on one machine and never leave it

---

## 7. Extraction

### 7.1 The ladder

The tier boundary is **not the file format**. It is whether a deterministic gate
trusts the output.

```
extract(source)
  |
  +-- TIER 1  script, deterministic, cheap
  |     text formats (today) | OOXML + ODF (one ZIP+XML reader)
  |     PDF | RTF | VTT/SRT | CSV/TSV | fetched HTML
  |
  +-- QUALITY GATE  deterministic, ~40 lines
  |     |
  |     +-- pass -> tier: script,  fidelity: measured   -> may support `derived`
  |     +-- fail -> escalate
  |
  +-- TIER 2  model, on genuine failure only
        scanned PDF (no text layer) | images | JS-rendered pages | legacy .doc
        -> tier: model, fidelity: estimated -> capped at `assumed`, never `derived`
```

Tier 2 output re-enters through the same gate. A model transcription that also fails
is recorded `skipped` with its reason rather than admitted.

### 7.2 Format coverage

| Format | Tier | Mechanism |
|---|---|---|
| `.md .mdx .markdown .txt .json .yml .yaml .po .pot .html .htm` | 1 | Existing extractors, unchanged |
| `.docx .pptx .xlsx` | 1 | ZIP central directory + `inflateRawSync`, then XML text nodes |
| `.odt .odp .ods` | 1 | Same ZIP reader; `content.xml`, `text:p` / `text:span` |
| `.pdf` | 1 | See §7.4 |
| `.rtf` | 1 | Control-word/group parser; `\'hh` hex escapes, `\uN` |
| `.vtt .srt` | 1 | Cue-text lines, timestamps dropped — transcripts are strong voice corpora |
| `.csv .tsv` | 1 | Row/cell split, existing `isCopy()` filter |
| Fetched web page | 1 | `extractHtml()` (`extract.mjs:156`), already written and tested |
| Scanned PDF, `.png .jpg .jpeg .webp .heic` | 2 | Model Read (vision) |
| JS-rendered page | 2 | Model WebFetch, after tier 1 returns near-empty |
| `.doc .ppt .xls` (OLE2) | — | **Refused** with guidance: "re-save as .docx/.pptx/.xlsx". Neither tier reads these; the model's Read tool cannot open Office formats at all |

One ZIP+XML reader unlocks six formats. It is the highest-leverage single component
in this spec and should be built first.

### 7.3 The quality gate

Thresholds are **calibrated against real extractions**, not chosen by intuition.
Measured on the four PDFs in the Vivido corpus, comparing a prototype extractor
against `pdftotext` as ground truth:

| Signal | Sound extraction | Broken extraction | Threshold |
|---|---|---|---|
| `long20Share` — tokens > 20 chars | 0.0034 – 0.0051 | 0.0284 – 0.0357 | **> 0.015 fails** |
| `singleShare` — 1-char tokens, minus locale's real single-letter words | 0.000 – 0.006 | 0.191 | **> 0.10 fails** |
| `meanTokenLen` | 5.46 – 6.12 | 3.47 / 7.19 – 7.62 | advisory only; locale-sensitive |
| `replShare` — U+FFFD share | 0 | — | **> 0.005 fails** |
| `novowelShare` — vowel-free tokens > 3 chars | 0.001 | 0.009 – 0.015 | advisory only |
| PDF only: recovered glyphs ÷ show-text payload bytes | — | — | **< 0.5 fails** |

`long20Share` catches **merged** words (`Onlineexerciseandtherapylessons`).
`singleShare` catches **split** words (`I V A Š TÍH LÁ`). Both are gross-failure
detectors with a 7–30× separation between sound and broken output.

**Stated honestly:** the gate reliably catches gross failure. It does not catch
subtle degradation — an extraction losing 5% of its spaces may pass. The remedy for
that is §7.4's width-based spacing, not a tighter threshold. Locale-sensitive signals
stay advisory because German compounding and Czech single-letter prepositions move
them for legitimate reasons.

Gate results are recorded per source in the index (§5.3) so a human can audit them
without re-running anything.

### 7.4 PDF

Prototyped and measured on 2026-08-27 against four real PDFs. Findings:

**Solved, and cheaper than assumed.** Character recovery reached 96–98% word recall
versus `pdftotext` on three of four files, with Czech diacritics fully intact, in
roughly 170 lines of dependency-free JavaScript.

Required, all confirmed working in the prototype:

- **Object discovery by scanning** `N M obj … endobj` rather than by parsing the xref
  table. Rebuilt and broken xrefs are common in the wild; a scan is immune.
- **`/FlateDecode` via `zlib.inflateSync`**, with a 1–2 byte trailing-garbage retry.
- **`/ToUnicode` CMaps** — `beginbfchar`, and `beginbfrange` in both `<lo> <hi> <dst>`
  and `<lo> <hi> [ … ]` forms. This is what makes diacritics survive subsetted fonts;
  without it the output is mojibake.
- **Both string syntaxes** — literal `(…)` with octal and backslash escapes, and hex
  `<004A>`. The prototype's initial omission of hex strings alone took one file from
  98% to 0%.
- **`/Type0` composite fonts** — two-byte codes.
- **Indirect font resources** — `/Font 8 0 R` as well as inline `/Font << … >>`.
- **`/Encrypt` detection** — refuse, status `skipped`, reason `encrypted`.

Still to build, in priority order:

1. **Width-based word spacing.** The hard part is not the glyphs, it is the spaces.
   Deriving them from `Td` deltas is a heuristic that trades one document against
   another: tuning for a Canva file that positions every glyph individually cost the
   presentation files 15 points of recall. The correct algorithm tracks the text
   matrix against per-glyph advance widths from the font's `/Widths` / `/FirstChar`,
   with `Tm`, `Tf`, `Tz`, `Tc`, `Tw` state, and emits a space when the actual x-gap
   exceeds the expected advance. Estimated +200 lines. This is what moves all four
   files past the gate.
2. **`/ObjStm` compressed object streams** (PDF 1.5+). The four test files had none,
   but modern producers use them heavily, and objects inside them are invisible to a
   plain scan. Without this, some PDFs will extract nothing and escalate needlessly.
3. **Remaining filters** — `ASCIIHexDecode`, `ASCII85Decode`, `LZWDecode`,
   `RunLengthDecode`, and filter chains. `DCTDecode`/`CCITTFaxDecode` are images: skip.

**Why this matters more than it looks.** A bad extraction does not lose data, it
*manufactures* it. `I V A Š TÍH LÁ` yields six tokens of mean length 1.8;
`Onlineexerciseandtherapylessons` yields one of length 31. Both feed
`meanWordLength`, `longWordRate`, `wordCount`, and `meanSentenceLength` — precisely
the metrics parent §5.3 uses to justify `derived` rules. A confident, precise, wrong
fingerprint is strictly worse than today's silent drop. Hence D8.

### 7.5 The extract cache

`<KB>/.cache/extracts/<sha256>.txt`, gitignored. Pure cache: keyed by content hash,
so invalidation is free — a changed file has a different hash and simply misses.

Cache contents are never read for evidence, only to avoid re-parsing. Deleting
`.cache/` in full must be a safe operation whose only cost is time.

---

## 8. URL sources

### 8.1 Fetching is never part of `scan`

The scripts are built for reproducibility: `--now` for fixed timestamps, sorted keys
"so the artifact is stable across runs and diffs cleanly in git", sorted traversal in
`walk()`. A network call inside `gatherCorpus` would make the fingerprint depend on
somebody else's web server, and would require connectivity for every scan.

Therefore fetching happens **only** in `/connect` and only on explicit `--refresh`.
`scan` reads the cached extract, offline and deterministic.

### 8.2 Mechanism

1. `/connect https://acme.com/about` — the global `fetch`, available from Node 18 and
   so within the repo's `engines.node >= 18.13.0` floor. No dependency
2. Response body hashed; if the hash matches the index, report no-op and stop
3. Body handed to `extractHtml()` (`extract.mjs:156`), which already strips
   `<script>`/`<style>`, harvests `alt`/`title`/`aria-label`/`placeholder`, and
   decodes entities
4. Gate applied. A JS-rendered shell yields near-zero text and fails, escalating to
   tier 2 (model WebFetch)
5. Statistics computed, index entry written, extract cached

The URL feature is mostly plumbing. The parsing already exists and is under test.

### 8.3 Retention

`retain: none` is the default, consistent with D2.

`retain: snapshot` is available per entry and writes
`evidence/snapshots/<id>-<date>.html`, **committed**. It exists because a URL is the
one source whose bytes nobody can recover once the page changes — not the user, not a
colleague, not the page's author. When `confirmed` rules are derived from a public
marketing page, that snapshot is the only thing that can ever substantiate them.

Off by default; a deliberate choice per source.

### 8.4 Not a crawler

One URL is one page. No link following, no sitemap expansion, no depth parameter.
A user wanting ten pages registers ten sources. This keeps the register honest about
what was actually analysed, which is the whole point of the index.

---

## 9. Integration with the corpus pipeline

### 9.1 `gatherCorpus` stays the chokepoint

It gains the register, and yields one record per resolved source in the existing
shape. `format` carries the true source format (`pdf`, `docx`, `url`) rather than the
cache file's, so the manifest stays honest about provenance. `rel` points at the
*origin* — `sources/deck.pptx` — not at the cache path.

```js
{ rel: 'sources/deck.pptx', abs, format: 'pptx', locale, strings, headings,
  sourceId: 's03', tier: 'script', fidelity: 'measured' }
```

`scan.mjs` and `fingerprint.mjs` need no structural change. `buildManifest` gains
`tier` and `fidelity` columns; `buildFingerprint` groups by locale exactly as now.

### 9.2 Fidelity propagates

A locale bucket containing any `estimated` source produces an `estimated` fingerprint
for that locale, matching parent §5.4's existing rule: an `estimated` fingerprint may
only ever produce `assumed` rules, never `derived`. No new axis, no new mode.

### 9.3 The format gate moves ahead of the read

Fixing §2.6: `formatFor()` runs on the path before `readTextFile()`. A file whose
format is unknown is pushed to a `skipped` list with its extension and reported:

```
scan: 3 file(s) skipped (unsupported: .sketch, .fig) - see evidence/sources.json
```

This closes Gap B's silence independently of everything else in this spec, and should
land first as a standalone fix.

---

## 10. Surface

### 10.1 `/voice-and-tone:connect` — new command

```
/voice-and-tone:connect                      check the register: what's new, changed, missing
/voice-and-tone:connect <path>               register a file or directory
/voice-and-tone:connect <url>                register and fetch a page
/voice-and-tone:connect --inbox              analyse everything newly dropped in <KB>/sources/
/voice-and-tone:connect --refresh [<id>]     re-fetch URLs / re-extract changed files
/voice-and-tone:connect --forget <id>        retract a source and everything it produced
```

`--forget` is where §6 pays off: subtract the source's statistics from the aggregate,
reopen every rule in its `produced` list, and re-derive them from what remains. Without
sufficient statistics this could only delete rules, not re-derive them.

Bare `/connect` answers the user's operational question — *what have we already
analysed?* — by diffing hashes against the index:

```
connect: 72 known, 68 used, 3 new, 1 stale
connect:   new    sources/brand-guide-2026.docx      (docx, 12 KB)
connect:   new    sources/tone-deck.pptx             (pptx, 2.4 MB)
connect:   stale  f017 Persona_B2C.pdf               (hash changed since 2026-08-27)
connect: run with --inbox to analyse
```

### 10.2 `/voice-and-tone:init` — changed

Init asks about sources up front rather than leaving the user to guess, creates
`<KB>/sources/` with its README and gitignore entries, migrates today's
`scan.include` into a `kind: project` register entry, and offers the inbox path
explicitly.

### 10.3 `--add` — implemented at last

`/init --add <path-or-url>` becomes an alias for `/connect <path-or-url>` followed by
the diff-against-existing-rules flow parent §7.2 already specifies: contradictions
recorded as `disputed`, never overwritten. The command file's existing promise is
kept rather than removed.

### 10.4 Scripts

| Script | Role |
|---|---|
| `sources.mjs` *(new)* | Register CRUD, hashing, status diff, index read/write. `--check`, `--add`, `--forget`, `--json` |
| `extract-doc.mjs` *(new)* | Tier-1 extraction for one file to stdout or cache. Independently testable per format |
| `scan.mjs` | Unchanged interface; manifest gains `tier`/`fidelity`/`skipped` |
| `fingerprint.mjs` | Unchanged interface; merges per-source statistics |
| `validate.mjs` | Gains: every `produced` rule exists; every rule with `source` evidence resolves to an index entry; no duplicate hashes; no orphaned cache entries |

Model-tier extraction has no script. It is driven by the `voice-discovery` skill,
which writes its transcription into the cache and calls `sources.mjs` to index it
with `tier: model`.

---

## 11. Migration

Existing knowledge bases must keep working untouched.

1. No `sources:` key in `config.yml` → synthesise one `kind: project` entry from
   `scan.include`/`scan.exclude` in memory. Behaviour is bit-identical to today.
2. On the next `/connect` or `/sync`, write the register explicitly and create
   `sources/`, `.cache/`, and the `.gitignore` lines.
3. No `evidence/sources.json` → build it from the current scan. Project files get
   `status: used` with statistics; nothing is re-derived and no rule changes.
4. `kb_version` bumps `patch` — no rule and no cell changes, only a recorded
   capability. A `CHANGELOG.md` entry names the migration.

---

## 12. Cross-platform constraints

Parent §9 applies without exception. Specific to this spec:

- ZIP and PDF parsing use `node:zlib` and `node:buffer` only. No shelling out to any
  external converter — deliberately rejected, because `pdftotext` on one machine and
  not another means the same corpus fingerprints differently on two laptops.
- Binary reads use `readFileSync` without an encoding; `readTextFile()`'s BOM and CRLF
  normalisation applies only after extraction to text.
- Extracted text is normalised `\r\n` → `\n` before any metric, per parent §9.
- `~` expansion in `local` paths uses `os.homedir()`, never a shell.
- Hashes are lowercase hex; index keys are sorted; all output ASCII-only on stdout.
- Cache filenames are the hash — no user-supplied bytes reach the filesystem, which
  also removes any path-traversal question from `--add`.

---

## 13. Testing

| Area | Test |
|---|---|
| **Disposability** | `computeFingerprint(A ∪ B) == mergeStats(stats(A), stats(B))` for every metric, per locale — the load-bearing invariant of §6 |
| Missing sources | An index with all sources `missing` reproduces the committed baseline exactly |
| Identity | Same bytes at two different paths produce one entry; changed bytes produce `stale` |
| ZIP reader | Fixture `.docx`/`.pptx`/`.xlsx`/`.odt` with known text, including stored (method 0) and deflated (method 8) entries |
| PDF | Fixtures for: literal strings, hex strings, `/Type0` two-byte, `/ToUnicode` bfchar and bfrange, indirect `/Font`, `/Encrypt` refusal, broken xref |
| Quality gate | The §7.3 calibration table as a table-driven test: sound extractions pass, split and merged extractions fail |
| Gate escalation | A gate failure produces `tier: model`, `fidelity: estimated`, and the locale's fingerprint is marked `estimated` |
| Silent drop (Gap B) | An unsupported file in an include glob appears in `skipped` with its extension, never silently absent |
| Read-before-format (§2.6) | A large unsupported file is not read into memory |
| URL | Fetch is never invoked during `scan`; `extractHtml` path reused; near-empty result escalates |
| Migration | A KB with no `sources:` key produces a bit-identical manifest and fingerprint |
| Cross-platform | Fixture paths and CRLF inputs produce identical statistics on POSIX and Windows separators |

---

## 14. Open questions

- **Inbox subdirectory semantics.** The Vivido corpus is organised
  `newsletters/ · emails/ · social/ · blog/`. Those map naturally onto the parent
  spec's channel axis (§6.2). Should a subdirectory name under `sources/` auto-suggest
  a channel, or is that too clever? Current assumption: suggest it at `/connect` time,
  never apply it silently.
- **Per-source weighting.** 33 newsletters and 1 brand statement currently contribute
  in proportion to word count, so the newsletters dominate the fingerprint. Should the
  register carry a `weight`? Deferred, but §6's per-source statistics make it a pure
  arithmetic change if wanted later.
- **Model-tier cost ceiling.** A directory of 200 scanned PDFs escalating to tier 2 is
  expensive and the user should be told before it happens, not after. Assumption:
  `/connect` reports the escalation count and asks for confirmation above a threshold.
- **Spot-checking the script tier.** Whether to sample a page of a gate-passing PDF
  through the model occasionally to catch subtle degradation the gate cannot see.
  Costly; deferred.

---

## 15. Deferred

- OCR of scanned documents beyond what the model's vision can read
- Legacy OLE2 formats (`.doc`, `.ppt`, `.xls`) — refused with guidance instead
- `.epub` (the ZIP reader would make it nearly free; no demand yet)
- Crawling, sitemaps, or authenticated URL sources
- Source-code string literal extraction — remains out of scope per parent §5.2
- Automatic re-fetch of URL sources on a schedule

---

## 16. Evidence for this spec

Findings were measured on 2026-08-27, not assumed:

- Gap B reproduced with a fixture `.docx` — dropped from both `files` and `unreadable`
- Format distribution of a real brand corpus (Vivido, 72 files): 68 `.txt`, 4 `.pdf` —
  the four PDFs are exactly the material silently lost today
- A 170-line dependency-free PDF extractor reached 96–98% word recall versus
  `pdftotext` on three of four real PDFs, with Czech diacritics intact
- The fourth (Canva-produced) file exposed hex-string and indirect-font gaps; fixing
  them recovered its characters and revealed word-spacing as the real problem
- Quality-gate thresholds in §7.3 are calibrated from those eight extractions
  (four prototype, four ground truth)
