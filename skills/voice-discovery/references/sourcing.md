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
of the templates so an empty inbox still explains itself. It will appear as a
plain new source the first time `--check` runs - do not derive any rule from
it, and do not count it as brand material when reporting totals to the user.

## What to do on an escalation

For every source `--ingest` lists under "need the model tier":

1. Read it with the Read tool - a scanned PDF with the `pages` parameter, an
   image directly. Read the whole document; do not sample pages.
2. Transcribe faithfully. Copy what the document says, in its own words. Do
   not summarise, paraphrase, or clean up its prose - a paraphrase is not the
   source, and a rule derived from your paraphrase is a rule derived from
   nothing.
3. Write the transcription back with `ingestText` (`scripts/lib/ingest.mjs`),
   passing `tier: 'model'`. This is the only path that ever sets that tier;
   `--check` and `--ingest` never do it for you, by design (see "Escalation
   itself is NOT performed here" in `ingest.mjs`).

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
