# Panels

Nine panels, plus `all`. Each answers one question and raises one more.

## `pipeline`

How far through `scan -> ingest -> measure -> draft -> interview -> canonize`
the knowledge base has come. `[##]` reached, `[..]` not.

**Six stages, not seven.** The discovery pipeline has a `gaps` step between
draft and interview, where the questionnaire is computed. It leaves no artifact
on disk, so it cannot be observed, and a box the plugin can never fill would be
worse than no box at all.

Stages are reported individually, not as a chain. A knowledge base can
legitimately have `measure` without `ingest` - a pure project corpus with an
empty inbox - and the panel shows that rather than smoothing it into a false
progress bar. `at:` names the furthest stage reached, not a count.

## `integrity`

Three lines that answer "can I trust the rest of this screen".

- **validate** - errors and warnings from `scripts/validate.mjs`, unchanged.
- **card** - whether `CONTEXT.md` is older than any of the five files it
  compiles from. This is **exact**: it names the file that put it behind.
- **scan** - the manifest's age, and how many of its own listed files have
  changed since.

**The manifest figure cannot see new files.** Detecting a file created since the
scan would mean re-globbing the register, which is the scan. The line says so.
`--refresh` is what closes that gap.

## `coverage`

The ten-by-eight tone matrix. `#` authored, `.` computed.

**A computed cell is not a shortfall.** Interpolation is the design: the matrix
fills itself along the paths you actually write. Eighty is the denominator, not
a target, and nobody is expected to reach it.

The caret rule marks the three states that force `humor 0` -`frustrated`,
`anxious-at-risk`, `disappointed-leaving` - in authored cells too.

A `!` beside the tally means the context has real corpus traffic and no authored
cell at all. **That** is the row worth acting on: every write there is
interpolated, so it can never be humorous, whatever the dials say.

## `rules`

Rules by confidence, with what each level does in review: `confirmed` blocks,
`derived` warns, `assumed` is a nit, `disputed` is never enforced.

The question it raises: is the shape right? A knowledge base that is all
`assumed` has never been interviewed. One that is all `confirmed` has probably
never been questioned.

## `drift`

The current fingerprint against the baseline captured at init, per locale,
**never averaged across locales**.

`n/a` does not mean zero. It means the arithmetic was undefined - a zero
baseline, or a metric present on one side only - and the bar shows `n/a` rather
than sitting empty, because an empty bar reads as "no drift", which is a
different and much more comforting claim.

`FLAG` marks a metric past `thresholds.drift_pct` (default 25). Then ask the
question the numbers cannot answer: is this drift, or did the corpus change
shape? A fingerprint that suddenly includes 400 pages of API reference has not
drifted, it has been diluted. Check the sources panel before concluding.

## `sources`

What is registered, what has been analysed, and what has never been ingested.

**Absent sources are not a fault.** Sources are deliberately uncommitted, so a
fresh clone has none of them, and the statistics survive without them.

Source freshness is only checked under `--refresh`, because deciding whether a
registered source is stale means hashing it. Read-only mode says `not checked`
rather than reporting zero stale - zero would claim everything is current, which
it has not earned.

## `evidence`

Entries by type, open conflicts, and drafts waiting on `:learn`.

A draft sitting in `.drafts/` is an edit that has not become evidence yet.

## `settings`

Everything that changes behaviour and is otherwise invisible: profile, locales,
thresholds, runtime, the vendored extractor versions, and the register.

`corroboration` decides whether an edit becomes a rule. `stale_months` decides
what counts as stale. `drift_pct` decides what gets flagged above. The register
decides what the corpus even is.

## `missing`

Every gap, ranked by leverage then severity, each with the command that closes
it. `[!!]` blocker, `[! ]` warning, `[. ]` nit.

Capped at ten, with `+N more`. An audit that ends in a 300-item list ends in
nothing.

See `gap-catalogue.md` for every detector - and for the five things that look
like gaps and must never be reported as one.

## `speakers`

House view only, and only once `config.yml` declares a speaker. One row per
speaker: voice rules, authored cells, overrides, lock violations (`!`, also a
validation error in `integrity`), drift (`ok`, `FLAG`, or `n/a` with no
baseline), drafts pending.

Every computed cell on a new speaker is expected, not a gap. Zero overrides
is the expected starting state. The question it raises: does each speaker
sound like themselves? That is the critic's read-back, per draft, not a
number this panel can carry.

Under `--profile <slug>` every other panel shows the resolved speaker: its
matrix, its rules split by origin, its own fingerprint against its own
baseline, its register entries, its drafts, and its gaps without a prefix.
