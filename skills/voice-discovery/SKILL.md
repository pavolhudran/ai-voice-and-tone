---
name: voice-discovery
description: >
  WHEN: no voice-and-tone knowledge base exists yet, the user offers new source
  material for one, or asks to build, bootstrap, or extend a brand voice guide.
  WHAT: runs the discovery pipeline - scan the project for copy, measure a corpus
  fingerprint, draft a knowledge base where every rule carries evidence and a
  confidence level, compute a questionnaire from the gaps, interview by
  preference pairs on the project's own strings, then canonize.
  TRIGGERS: 'set up our voice', 'build a voice guide', 'we have a style guide to
  import', 'what is our tone of voice', 'no knowledge base found'.
---

# Voice discovery

Build a voice-and-tone knowledge base that can be **proved**, not just recited.
Every rule records where it came from and how sure we are, because that one axis
drives interview priority, review severity, and rule retirement.

> Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated
> with or endorsed by Mailchimp. Encode method and structure. **Never copy
> verbatim prose from that guide into a knowledge base** - every rule you write
> must be derived from this project's corpus, this user's answers, or this
> user's corrections.

## Precedence

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

## Before anything

Resolve `<KB>` = `.voice-and-tone/` at the project root unless the user names
another path. If `<KB>/config.yml` already exists, this is an **extension** run:
skip to step 5 and diff against what is there rather than overwriting it.

Probe the runtime once: run `node --version`. Record the result - it decides
whether metrics are `measured` or `estimated`, and an `estimated` fingerprint may
only ever produce `assumed` rules, never `derived`.

## 1. Source and scan

Copy the templates from `<plugin>/templates/kb/` into `<KB>/` first, so the
scripts have a config to read. Rename `gitignore` to `.gitignore`.

**Then name the brand and declare its locales, before ingesting anything.**
Ask for the brand name and which languages it publishes in, and write both to
`<KB>/config.yml`'s `profiles.default` - `name`, `primary_locale`, `locales`.

**In the same breath, ask how many voices there are.** One question, three
answers: does the brand speak with **one voice**, with **several speakers**
(founders, a support team, a product line, a mascot, an assistant - anyone who
writes in the first person under the brand), or **decide later**? Say plainly
that speakers can be added at any time with `/voice-and-tone:speaker add`, so
"later" costs nothing. Whatever the answer, the house pipeline below runs
first; on "several", note the names now and offer `speaker add` for each at
the end (see "Speakers" below) rather than interleaving them.

This is not bookkeeping to be tidied up later. A source's locale is attributed
when it is first ingested, from the locales declared at that moment, and the
template ships `locales: [en]`. Ingest a Czech corpus before saying it is
Czech and every file of it is filed as English. `sources.mjs` warns when the
profile still holds the placeholder name for exactly this reason - and the
order of these steps is what decides whether a user ever sees that warning.

(A knowledge base that got this wrong is no longer stuck: the next
`--ingest` re-attributes every entry from the locales as declared now, and
reports each correction. But the fingerprint taken in between was wrong, and
any rule derived from it needs re-deriving - so it is much cheaper to ask
first.)

Ask where the project's brand material lives before scanning anything -
project copy, a folder elsewhere on disk, pages on the web, or files the user
has not dropped in yet. Mention `<KB>/sources/` explicitly: it is where
anything that is not already project copy (a brand deck, a style guide PDF,
exported newsletters) belongs, and nothing placed there is ever committed.

Then ask what shape the project is, or infer it:

| Project shape | Where the copy lives |
|---|---|
| App / codebase | i18n and locale files, error catalogs, README, docs |
| Marketing site | page content, markdown/MDX, meta descriptions, CMS exports |
| Docs repo | the docs themselves |
| No repo | a folder the user points at, pasted text, or URLs |

Adjust the `project` entry's `include` under `<KB>/config.yml`'s `sources:` list
to match, then run:

```
node "<plugin>/scripts/scan.mjs" --root "<project>" --kb "<KB>"
node "<plugin>/scripts/sources.mjs" --root "<project>" --kb "<KB>" --check
```

Read the printed totals back to the user. If the file count is zero, the include
patterns are wrong - fix them before going further rather than fingerprinting
nothing.

**Out of scope for v1:** string literals inside source code. Too language-specific
and too error-prone; the false positives would poison the fingerprint. Point
the `project` entry's `include` at specific files instead.

If the project already has a style guide, a tone-of-voice document, or a
writing handbook - on disk, dropped into `<KB>/sources/`, or named with
`--add` - it is registered brand material, not an ad-hoc read: run
`node "<plugin>/scripts/sources.mjs" --root "<project>" --kb "<KB>" --ingest`
and read `references/sourcing.md` for how to read the report and act on it,
including what to do when a source needs the model tier. Rules an existing
document states explicitly enter at `confirmed` with an evidence entry of type
`source`; an existing explicit rule outranks anything inferred.

## 2. Measure

```
node "<plugin>/scripts/fingerprint.mjs" --root "<project>" --kb "<KB>" --set-baseline
```

Add `--source estimated` if Node was absent and you are estimating the metrics
yourself. Say so in one line to the user, and note how to upgrade.

Fingerprints are per locale and are never averaged across locales. English-only
metrics come back `null` for other languages - that is correct, not a gap.

## 3. Draft the knowledge base

Fill every slot. Nothing is left blank:

- Corpus-supported, with at least `derived_min_samples` distinct occurrences in
  two or more files -> `derived`
- Plugin default, unverified -> `assumed`
- Sources that genuinely disagree -> write **both** sides to
  `<KB>/evidence/conflicts.md` at `disputed`, and do not pick

Write each rule in the §4.3 shape, with an evidence ID, and add the matching
ledger entry with a `Produced:` line naming every rule it created. Bidirectionality
is required: it is what makes retraction possible later.

## 4. Gap analysis

Read `references/gap-analysis.md`. Turn unfilled and low-confidence slots into
candidate questions, then rank them by **leverage** - how many downstream rules
each answer resolves. Drop anything the corpus already answered.

## 5. Interview

Read `references/interview-method.md`. The primary mechanism is preference-pair
calibration - forced choice between rewrites of the project's **own** strings,
not adjective elicitation.

Constraints:
- At most 4 questions per `AskUserQuestion` call
- At most 3 rounds per session by default
- Always exitable with "good enough for now" - the rest stays `assumed` and queued

Each pick writes a `confirmed` rule and an `interview` ledger entry that stores
the pair as evidence.

## 6. Locales

For each locale beyond the primary, create `<KB>/locales/<code>.md` from
`<plugin>/templates/kb/locales/_template.md`. Read `references/locale-seed.md`:
fill the typography conventions mechanically - they are not brand opinions and
need no question - and interview only for the brand decisions.

## 7. Canonize

1. Run `node "<plugin>/scripts/validate.mjs" --kb "<KB>"`. Fix every error before continuing.
2. Run `node "<plugin>/scripts/compile-context.mjs" --root "<project>" --kb "<KB>"`.
3. Append a `CHANGELOG.md` entry and set `kb_version` (first build: `0.1.0`).
4. Report: how many rules at each confidence level, how many cells authored of 80,
   which locales, and what stayed `assumed` and queued.

**Never silently edit the knowledge base.** Show the proposed content, get
approval, then write.

## Cold start

If the user asks for copy and no knowledge base exists, do **not** block. Offer:

- the full pipeline above, or
- a 3-question quick start - brand name, primary reader, one preference pair on
  a string from their project - producing a provisional KB with everything
  `assumed`, ready to be upgraded later

## Speakers

When the conversation has named more than one first-person voice - founders,
executives, ambassadors, authors, a support team, a product line, a mascot, an
assistant - offer `/voice-and-tone:speaker add <slug>` at the end of the
house pipeline, and read `references/speaker-discovery.md` before running it.
A speaker inherits the house and replaces its voice; it never runs the house
pipeline again.
