# Sourcing

## The ladder

Every source is attempted by the script tier first. The tier boundary is the
quality gate (`scripts/lib/quality.mjs`), not the file format - a script parser
attempts every source, including PDFs and Office documents, and only a genuine
failure escalates to the model. A source that reads cleanly stays on the script
tier regardless of its container; a source the script tier could not read at
all, in any format, is the only kind that ever reaches you.

```
node "<plugin>/scripts/sources.mjs" --check   what is new, changed, or missing
node "<plugin>/scripts/sources.mjs" --ingest  analyse everything new or changed
```

Run `--check` first and read the printed totals back to the user before
running `--ingest` - `new`, `stale`, and `missing` are three different things,
and `missing` (below) is not a problem to react to.

## Reading the report

`--ingest` prints a line per source it analysed, and, when the script tier
could not read one, a block like:

```
sources: 2 source(s) need the model tier:
sources:   model  sources/brand-deck.pdf (no-text-layer)
sources:   model  sources/scan.jpg (no-text-layer)
```

Each `origin` listed there is what needs your attention next.

`sources/README.md` is this plugin's own placeholder, copied in with the rest
of the templates so an empty inbox still explains itself. The template
config's inbox entry excludes it by default (`exclude: [README.md]`), which
is the actual mechanism that keeps it out of `--check`/`--ingest` - this note
is belt-and-braces, not the fix. If a project's config has had that exclude
line removed (its own README genuinely wanted, or an older KB predating this
default), `sources/README.md` will resolve as an ordinary new source; do not
derive any rule from it in that case, and do not count it as brand material
when reporting totals to the user.

## What to do on an escalation

For every source `--ingest` lists under "need the model tier":

1. Read it with the Read tool - a scanned PDF with the `pages` parameter, an
   image directly. Read the whole document; do not sample pages.
2. Transcribe faithfully. Copy what the document says, in its own words. Do
   not summarise, paraphrase, or clean up its prose - a paraphrase is not the
   source, and a rule derived from your paraphrase is a rule derived from
   nothing.
3. Persist it yourself. `ingestText` (`scripts/lib/ingest.mjs`) only *builds*
   an entry - it writes nothing to disk. Nothing else does this for the model
   tier either: `--check` and `--ingest` never call it (see "Escalation
   itself is NOT performed here" in `ingest.mjs`), so a transcription that
   stops at step 2 leaves `evidence/sources.json` completely unaware anything
   was ever read. The full sequence, the same one `runIngest` performs for
   the script tier, is four calls, in order:

   ```js
   import { readFileSync } from 'node:fs'
   import { loadIndex, saveIndex, nextEntryId, upsertEntry } from '<plugin>/scripts/lib/sourceindex.mjs'
   import { ingestText } from '<plugin>/scripts/lib/ingest.mjs'
   import { sha256File } from '<plugin>/scripts/lib/hash.mjs'

   const kbRoot = '<KB>'
   const now = new Date().toISOString()
   const abs = '/absolute/path/to/the/original/file'   // the file you just READ, not a transcript file

   const index = loadIndex(kbRoot)
   const entry = ingestText({
     sha256: sha256File(abs),      // hash of the ORIGINAL bytes - see below, this is not optional
     origin: 'sources/brand-deck.pdf', // exactly the origin --ingest printed for this source
     format: 'pdf',                // the format --ingest printed, e.g. pdf, image, html
     bytes: readFileSync(abs).length,
     locale: 'en',                 // the locale this source was attributed under
     label: null,
     strings: ['Paragraph one of the transcription.', 'Paragraph two.', '...'],
     headings: ['Any section headings, if the source has them']
   }, { kbRoot, now, id: nextEntryId(index), from: '<register id, e.g. s02>', tier: 'model' })

   upsertEntry(index, entry)
   saveIndex(kbRoot, index, now)
   ```

   Write this as a one-off script and run it with `node "<absolute path>"`,
   the same invocation convention every other script in this plugin uses.

   **The `sha256` must hash the original file's bytes (`sha256File(abs)`),
   never the transcription.** Source identity is content-hash-keyed
   throughout this plugin (`sourceindex.mjs`'s own header comment: "Identity
   is the sha256 of the bytes, never the path"), and `--check` computes that
   same hash from the file on disk every time it runs. Hash the transcription
   instead and the entry you just saved will never match what `--check` sees
   next time - the source stays permanently "new," is ingested again, and a
   second index entry with a different id and the same origin accumulates
   for it on every future run.

   A transcription with real content passed as `strings` (not a single bare
   string - it must be an array) is what marks the entry `used` rather than
   `skipped`; get the shape wrong and the entry silently drops out of the
   fingerprint with no error raised anywhere, indistinguishable from having
   done nothing at all.

## Estimated, and what that limits

A model-tier transcription is recorded `fidelity: 'estimated'`, never
`measured`. Restating parent spec 5.4 rather than assuming it survived from an
earlier task: **an `estimated` source may support an `assumed` rule, and never a `derived` one**,
whatever its extracted text looks like once it is in front of you. Vision
reads a page correctly far more often than a script parser fakes
reading one, but the plugin does not let a single transcription - unverified
against any second source - stand in as proof. Corroborate it with a second,
independent source before anything drawn from it can be written at
`derived`, exactly as any other single source would need to be.

## The cost warning

Reading a scanned PDF or an image costs real tokens, and a directory of two
hundred of them is an expensive surprise nobody asked for. Before transcribing
anything:

- Report the escalation count from the `--ingest` report to the user first,
  every time - not just when it is large.
- If more than ten sources need the model tier in one run, stop and ask
  before transcribing any of them. Offer to do the first ten now and the rest
  in a later batch, or to proceed with all of them if the user confirms the
  cost is expected.

## Missing is normal, not a problem

Sources are never committed (see `<KB>/.gitignore`).
A fresh clone has none of them, and `--check` says so plainly:

```
sources: all 3 known source(s) are absent from this machine; statistics intact.
```

That line is informational, not a warning. Do not tell the user something is
broken, ask them to restore files, or treat a missing source as a gap in the
knowledge base - the statistics it produced already live in the committed
index and the KB stays exactly as sound as it was when that source was last
analysed. Only raise it as a real problem if the user expected a specific
source to be present and it is not, or if `--root`/`--kb` look like they are
pointed at the wrong place.
