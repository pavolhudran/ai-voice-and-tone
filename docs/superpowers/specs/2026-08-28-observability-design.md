# Observability — Design Spec

**Date:** 2026-08-28
**Status:** Draft for review
**Repo:** `ai-voice-and-tone`
**Branch:** `design/observability-spec` (from `feat/source-ingestion` @ `645d803`)
**Extends:** `2026-08-26-voice-and-tone-plugin-design.md`, `2026-08-27-source-ingestion-design.md`

---

## 1. Purpose

Give the plugin a single, fast, deterministic answer to three questions it can
currently only answer in fragments:

1. **What do we have?** — the state of the knowledge base, right now.
2. **What is it set to?** — profiles, locales, thresholds, register, runtime.
3. **What is missing?** — ranked, each with the command that closes it.

Scope is **observation only**. Nothing here derives a rule, drafts copy, runs an
interview, or makes a judgement call. Everything downstream is unchanged.

### 1.1 The core idea

> Observability observes. It never changes what it observes.

`:status` reads the artifacts on disk and reports how stale they are. It does not
re-scan, re-measure, re-ingest, or re-fetch. A stale manifest becomes a **visible
gap with a fix command**, not a silent refresh that hides how long the numbers
have been wrong.

That one decision is what separates this from `:audit` — which refreshes and
interprets — and what makes `:status` safe to run on a knowledge base that is
half-built, broken, or absent entirely.

### 1.2 The second core idea

> The dashboard is generated, never drawn.

`CONTEXT.md` exists in its current form because the framework this plugin builds
on had a documented flaw: its voice page and its own summary listed different
characteristics, since the summary was maintained by hand and drifted. The fix
was to recompile it every time and discard hand edits.

**A status screen a model draws freehand from JSON is that same defect, one level
down.** It would render differently on every run, could not be diffed, could not
be tested, and would quietly disagree with the numbers it claims to summarise.

So the ASCII is produced by a script and asserted against golden strings. The
model's job is navigation and explanation, never arithmetic and never layout.
This is the same split the codebase already enforces between `diff.mjs` (supplies
mechanical facts, refuses to classify them) and the `voice-maintenance` skill
(classifies, computes nothing).

### 1.3 Non-goals

- **Not a TUI.** `test/conformance.test.mjs` forbids child processes outright, and
  a slash command has no curses loop. The menu is a chat loop over a stateless
  script. No terminal control sequences, no cursor movement, no clearing.
- **Not a replacement for `:audit`.** `:audit` asks the two questions that need a
  human answer. `:status` asks nothing and decides nothing.
- **Not a linter.** It reports `validate.mjs`'s findings; it does not add checks.
- **Not a history.** One point in time. Trend lines over `CHANGELOG.md` are §16.
- **No new runtime dependency.** §9 of the parent spec holds without exception.

---

## 2. Current state

Verified against the code on the branch tip, not inferred from the docs.

### 2.1 State lives in seven artifacts with no single reader

| Artifact | Written by | Holds |
|---|---|---|
| `config.yml` | `:init`, `:connect` | profiles, locales, the register (`sources:`), thresholds, runtime |
| `evidence/manifest.json` | `scan.mjs` | copy-bearing files, per-locale totals, `skipped` / `unindexed` / `missing` |
| `evidence/fingerprint.json` | `fingerprint.mjs` | per-locale metrics **and the drift baseline** |
| `evidence/sources.json` | `sources.mjs` | source index: hash, status, stats, `produced` rule ids |
| `voice.md` `tone.md` `lexicon.md` `mechanics.md` `audience.md` | authored | rules with confidence and evidence refs |
| `evidence/ledger.md`, `evidence/conflicts.md` | `:learn`, `:audit` | evidence entries, unresolved disputes |
| `CONTEXT.md`, `CHANGELOG.md`, `.drafts/` | `compile-context.mjs`, `:sync`, `:write` | the compiled card, history, corrections pending `:learn` |

Every one of these already has a loader in `scripts/lib/`. Nothing new needs
parsing — the collector composes existing functions.

### 2.2 Gap A — `:audit` is a judgement instrument, not an observation instrument

`skills/voice-maintenance/SKILL.md` runs `scan.mjs`, `fingerprint.mjs`, and
`validate.mjs` before reporting, so it **writes** to `evidence/`. It is
model-driven, it presumes a populated knowledge base, and it closes by demanding
two decisions ("enforce or retire", "channel split or drift").

It cannot answer "what do we have right now" — least of all at stage two of setup,
when there is nothing yet to audit and the honest answer is a checklist.

### 2.3 Gap B — nothing reports settings

`thresholds.corroboration` decides whether an edit becomes a rule.
`thresholds.stale_months` decides what counts as stale. The register decides what
the corpus even is. `profiles.<name>.locales` decides which fingerprints exist.

None of it is visible anywhere except by reading YAML by hand.

### 2.4 Gap C — nothing computes "what is missing"

The knowledge exists, scattered, and no component collects it:

- `scan.mjs` knows about `unindexed` — registered files never ingested.
- `validate.mjs` knows `W_STALE_EXTRACTOR`, `W_LOCALE_NOT_ACTIVE`, `W_NO_EVIDENCE`.
- `audit-report.md` knows "zero authored cells **and** measurable corpus traffic".
- `fingerprint.mjs` knows whether a baseline exists.
- `compile-context.mjs` knows when the card is over its token budget.

Each surfaces at most in its own stdout, on the run that produced it, and only if
someone was reading. There is no ranked, persistent, actionable list.

### 2.5 Incidental finding — `audit-report.md` is hand-typed ASCII

`skills/voice-maintenance/references/audit-report.md` carries example coverage
blocks, drift tables, and rule-health lists as **hand-typed ASCII the model
imitates**. That is §1.2's defect one level further down: the examples cannot
drift from the code because they were never connected to it.

Not fixed in v1. See §16.

---

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| **D1** | `:status` writes nothing by default | §1.1. Enforced by a test that snapshots every mtime under the KB across a default run. |
| **D2** | `--refresh` is opt-in and narrow | Re-runs `buildManifest` and `buildFingerprint` only. Never ingests, never fetches a URL, **never sets the baseline**. |
| **D3** | ASCII is rendered by a script, asserted as golden strings | §1.2. |
| **D4** | Collector and renderer are separate modules | The collector is asserted as data, the renderer as strings, and `--json` falls out for free. |
| **D5** | A new `voice-observability` skill, not a section of `voice-maintenance` | `voice-maintenance` is governed by "every write is a proposed diff" — it exists to change the knowledge base. This never writes. Keeping them apart makes that boundary enforceable rather than merely stated. |
| **D6** | Pure ASCII, fixed width 72 | `toAscii()` (`scripts/lib/cli.mjs`) replaces every non-ASCII byte with `?`, and conformance enforces ASCII-only stdout. Box-drawing is impossible; `+ - \| = # . : < >` is the whole palette. |
| **D7** | Gap severities reuse `blocker` / `warning` / `nit` | `skills/voice-review/references/severity.md` already defines that scale. A fourth severity vocabulary in one plugin is a defect. |
| **D8** | Gaps are ranked by leverage, then severity | `skills/voice-discovery/references/gap-analysis.md` already established leverage ranking for the interview. Same rule, same reason: what unlocks the most goes first. |
| **D9** | Absent sources are never a gap | `scripts/sources.mjs` already reasons this out: sources are deliberately uncommitted, a fresh clone has none, and warning "would just teach people to commit sources to silence it." |
| **D10** | Freshness detection is exact for the card, approximate for the corpus | §7.2. Stated in the output rather than papered over. |
| **D11** | The new script is a peer of the existing five | Same `parseCliArgs` base options, same `--json`, same `--now`, same exit codes. Conformance enrols it automatically — `SCRIPTS` is derived from `readdirSync('scripts')`, not a hardcoded list. |

---

## 4. Surface

### 4.1 `/voice-and-tone:status` — new command

```
/voice-and-tone:status                    overview + menu
/voice-and-tone:status --panel drift      one panel
/voice-and-tone:status --panel all        every panel, one shot
/voice-and-tone:status --refresh          re-scan and re-measure first
/voice-and-tone:status --locale cs        scope drift and corpus to one locale
/voice-and-tone:status --width 100        render wider (clamped 60..120)
/voice-and-tone:status --json             the whole state object
```

`commands/status.md` frontmatter:

```yaml
---
description: Show the state of the voice knowledge base - coverage, drift, sources, settings, and what is missing
argument-hint: "[--panel <name>|all] [--refresh] [--locale <code>] [--width <n>] [--json]"
---
```

### 4.2 `skills/voice-observability/` — new skill

```yaml
---
name: voice-observability
description: >
  WHEN: the user asks what the voice knowledge base currently contains, how
  complete it is, what is configured, what is missing, or wants a dashboard,
  status screen, or overview of the voice-and-tone setup.
  WHAT: reads every knowledge-base artifact without modifying any of them,
  renders a deterministic ASCII dashboard, and ranks what is missing with the
  command that closes each gap.
  TRIGGERS: 'what do we have', 'voice status', 'show me the state', 'how
  complete is our voice guide', 'what is missing', 'dashboard', 'what is
  configured'.
---
```

The skill body is short by design. It runs the script, shows the output verbatim,
waits for a menu selection, and re-invokes with `--panel`. It **never** restates a
number in prose that the script printed, and never draws a panel of its own.

Two references:

- `references/panels.md` — what each panel means and the question it raises.
- `references/gap-catalogue.md` — every detector, its evidence, its fix, and the
  four things that are deliberately **not** gaps (§9.3).

### 4.3 Scripts

```
scripts/status.mjs        CLI. Composes collect() and render(), owns flags and exit codes.
scripts/lib/state.mjs     COLLECTOR. Artifacts in, one plain state object out. No strings.
scripts/lib/render.mjs    RENDERER. State object in, ASCII out. No file I/O.
```

The boundary is absolute: `state.mjs` imports from `node:fs`; `render.mjs` does
not import `node:fs` at all. A test asserts that.

---

## 5. The state object

`collect({ projectRoot, kbRoot, config, profileName, now })` returns:

```js
{
  generated,                    // ISO, from --now or Date.now()
  kb: {
    root, exists, version,      // kb_version from config.yml
    brand, profile, locales, primaryLocale
  },
  stage: {
    at,                         // the furthest stage reached
    reached: { scan, ingest, measure, draft, interview, canonize }  // booleans
  },
  integrity: {
    errors, warnings,
    byCode,                     // { E_DUPLICATE_ID: 2, W_NO_EVIDENCE: 5, ... }
    findings                    // validate.mjs findings, verbatim
  },
  freshness: {
    card:      { generated, staleAgainst: ['tone.md'], ageDays },
    manifest:  { generated, ageDays, changedSince, checked },
    fingerprint: { generated, ageDays }
  },
  coverage: {
    authored, possible,         // 14, 80
    byContext: [{ context, authored, of, cells, traffic }]
  },                            // cells: 8 entries, 'authored' | 'computed'
  rules: {
    total,
    byConfidence,               // { confirmed, derived, assumed, disputed }
    byFile                      // { voice, tone, lexicon, mechanics, ... }
  },
  evidence: {
    total, byType,              // source | corpus | interview | correction | decision
    conflicts, drafts
  },
  drift: {
    thresholdPct,
    byLocale: {                 // null baseline is a first-class value, not an error
      en: { baseline, metrics: [{ name, from, to, deltaPct, flagged }] }
    }
  },
  sources: {
    registered, analysed, missing, unindexed,
    freshness: 'unchecked' | 'checked',
    stale, fresh,               // null when freshness === 'unchecked'
    entries: [{ id, kind, label, origin, status, fidelity, analysed, produced }]
  },
  corpus: {
    totals, byLocale,           // straight from manifest.json
    skipped, unreadable, fidelity
  },
  settings: {
    thresholds, register, runtime, vendor  // vendor from vendor/manifest.json
  },
  gaps: [{ id, severity, leverage, what, why, fix }]   // ranked, §9
}
```

Every field is JSON-serialisable. `--json` prints this object and nothing else.

### 5.1 Degradation

`collect()` never throws. Every artifact is optional, and its absence is a value:

| Absent | Yields |
|---|---|
| `.voice-and-tone/` entirely | `kb.exists: false`, one gap (`G01`), every other ring empty |
| `manifest.json` | `corpus.totals: null`, `freshness.manifest: null`, gap `G08` |
| `fingerprint.json` | `drift.byLocale: {}`, gap `G03` |
| `sources.json` | `sources.registered` from the register, `analysed: 0` |
| `baseline` within a fingerprint | `drift.byLocale[l].baseline: null`, gap `G03` for that locale |

This mirrors `loadIndex`, which already degrades a missing or corrupt
`sources.json` to an empty index rather than failing, and `loadKb`, which reads
every absent file as `''`.

**Why this matters more here than anywhere else:** `:status` is the first thing a
new user runs, and at that moment nothing exists. A crash on an empty directory
would fail exactly the case the feature is most for.

---

## 6. Lifecycle stage inference

The discovery pipeline is `scan -> ingest -> measure -> draft -> gaps ->
interview -> canonize`. Six of those seven leave an artifact. `gaps` does not — the
questionnaire is computed in memory and consumed by the interview — so it is
**not shown as its own segment**. Inventing a box the plugin cannot observe would
be the drift defect again, in miniature.

| Stage | Reached when |
|---|---|
| `scan` | `manifest.json` exists and `totals.files > 0` |
| `ingest` | `sources.json` has at least one entry, **or** the register holds no non-`project` entry (nothing to ingest) |
| `measure` | `fingerprint.json` has at least one locale under `byLocale` |
| `draft` | at least one rule parses out of `voice` / `tone` / `lexicon` / `mechanics` |
| `interview` | at least one rule carries a confidence other than `assumed`, **or** at least one evidence entry has type `interview` |
| `canonize` | `CONTEXT.md` exists **and** `validate` reports zero errors **and** `fingerprint.baseline` is non-null |

`stage.at` is the last stage in that order whose predicate holds. Stages are
reported individually, not as a monotonic chain — a knowledge base can legitimately
have `measure` without `ingest` (a pure project corpus, nothing dropped in), and
the display must show that rather than smoothing it into a false progress bar.

---

## 7. Freshness

### 7.1 The card — exact

`CONTEXT.md` compiles from `voice.md`, `tone.md`, `lexicon.md`, `mechanics.md`,
and `config.yml` (`compileContext` reads exactly these). Comparing its mtime
against those five is five `statSync` calls and is **exact**: any source newer
than the card means the card is behind, and the panel names which file.

### 7.2 The corpus — approximate, and said so

Detecting that the manifest is stale would, in full, require re-globbing the
register — which is the scan. So read-only mode does what it can cheaply and is
honest about the rest:

- **Reported:** the manifest's age in days, and how many of **its own listed
  files** have an mtime newer than `manifest.generated` (one `statSync` per listed
  file; 142 files is immaterial).
- **Not reported:** files created since the manifest was written. Detecting those
  is what `--refresh` is for.

The panel says `changed 12 of 142 listed (new files not detected - use --refresh)`.
A number with its limit attached is worth more than a number that quietly lies.

### 7.3 Source freshness — only under `--refresh`

Deciding whether a registered source is `stale` means hashing it, which is what
`diffIndex` does. On a corpus of PDFs and decks that is real I/O, and it is not
worth paying on every glance.

Read-only mode sets `sources.freshness: 'unchecked'` and the panel prints
`freshness not checked (read-only) - run --refresh`. Under `--refresh`, the
collector calls `resolveRegister` + `filterVanished` + `diffIndex` directly (no
child process, per conformance) and fills in `stale` and `fresh`.

---

## 8. The renderer

### 8.1 ASCII grammar

Palette, and nothing else: `+ - | = # . : < > ^ [ ] ( ) /` and `A-Za-z0-9`.

| Glyph | Means |
|---|---|
| `#` | present, authored, filled |
| `.` | absent, computed, empty |
| `=` | a major rule (panel top) |
| `-` | a minor rule (panel divider) |
| `<` `>` | direction of a drift delta |
| `^` | a caret annotation pointing up at the row above |
| `[!!]` `[! ]` `[. ]` | gap severity: blocker, warning, nit |

Width is 72 by default; `--width <n>` clamps to 60..120. 72 fits a default 80-column
terminal with margin and survives a markdown code fence in a pull request without
wrapping.

### 8.2 Primitives

```js
export const WIDTH = 72

export function rule (char, width)                 // '+========...========+'
export function panel (title, lines, width)        // titled block with rules
export function bar (value, max, width, opts)      // '############        '
export function stackedBar (segments, width)       // confidence distribution
export function matrix (rows, cols, cellAt, opts)  // the tone grid
export function pipeline (stages, reached, width)  // the lifecycle strip
export function deltaBar (pct, width)              // centre-anchored, '<' or '>'
export function kv (pairs, width)                  // aligned key/value block
export function truncate (text, width)             // never mid-word where avoidable
export function render (state, { panel, width })   // the whole screen
```

`render.mjs` performs no file I/O and imports nothing from `node:fs`. Its output
is ASCII by construction; `writeOut`'s `toAscii()` remains as belt and braces, not
as the mechanism.

### 8.3 The overview

```
+======================================================================+
| VOICE & TONE : STATE           Vivido | default | kb 0.4.2 | en,cs   |
+======================================================================+

 PIPELINE   scan  ingst  meas  draft  intvw  canon
            [##]  [##]   [##]  [##]   [..]   [..]      at: draft

 INTEGRITY  validate  0 errors  3 warnings
            CONTEXT.md  STALE - 7 days behind tone.md
            manifest    4 days old, 12 of 142 listed files changed
                        (new files not detected - use --refresh)

 TONE MATRIX                            14 of 80 authored (18%)
                       del cur foc unc cnf frs anx dis
   marketing-page       .   .   .   .   .   .   .   .    0/8  <- traffic
   product-ui           #   #   .   .   #   .   .   .    3/8
   system-error         #   #   #   #   #   #   #   .    7/8
   help-doc             .   .   #   .   .   .   .   .    1/8
   email                #   .   .   .   .   .   .   .    1/8
   social               .   .   .   .   .   .   .   .    0/8  <- traffic
   legal-policy         .   .   .   .   .   .   .   .    0/8
   notification         .   .   .   .   .   .   .   .    0/8
   support-reply        #   #   .   .   .   .   .   .    2/8
   release-notes        #   .   .   .   .   .   .   .    1/8
                                            ^^^^^^^^^^^^
                                            humor forced to 0
   # authored    . computed - never humorous, whatever the dials say

 RULES  47 total
   confirmed  ############                12   blocks in review
   derived    ####################        20   warns
   assumed    #############               13   nit
   disputed   ##                           2   never enforced

 DRIFT  threshold 25%
   en   baseline 2026-03-02
        mean sentence   14.2 -> 19.8   +39%  [>>>>>>>>>>      ]  FLAG
        contractions    31.0 -> 12.4   -60%  [<<<<<<<<<<<<<<< ]  FLAG
        reading grade    7.1 ->  9.6   +35%  [>>>>>>>>>       ]  FLAG
        exclamations    0.04 -> 0.03   -25%  [<<<<<           ]
   cs   no baseline - drift cannot be measured for this locale

 SOURCES  5 registered | 4 analysed | 0 missing | 1 not ingested
   s01 project  content/**, docs/**        142 files   measured
   s02 inbox    sources/                     3 files   measured
   s03 local    ~/brand/guide.docx           1 file    measured
   s04 url      vivido.fit/about            fetched 2026-08-01
   s05 local    ~/brand/deck.pdf            NOT INGESTED
   freshness not checked (read-only) - run --refresh

 MISSING  5 gaps, highest leverage first
   1 [!!] locale cs has no drift baseline
          drift can never be measured there
          -> node scripts/fingerprint.mjs --set-baseline, or finish :init
   2 [!!] 1 registered source has never been ingested
          its words are in no fingerprint and no rule
          -> /voice-and-tone:connect --ingest
   3 [! ] marketing-page: corpus traffic, 0 authored cells
          every write there is interpolated, so it can never be humorous
          -> /voice-and-tone:write marketing-page ...
   4 [! ] CONTEXT.md is 7 days behind tone.md
          the always-loaded card does not reflect the current tone model
          -> /voice-and-tone:sync
   5 [. ] locale cs has no locale pack
          -> /voice-and-tone:localize cs

+----------------------------------------------------------------------+
| 1 coverage  2 drift  3 rules  4 sources  5 evidence  6 settings      |
| 7 missing   8 everything                                    q done   |
+----------------------------------------------------------------------+
```

### 8.4 The empty case

The screen a first-time user sees must be useful, not an error:

```
+======================================================================+
| VOICE & TONE : STATE                              no knowledge base  |
+======================================================================+

 PIPELINE   scan  ingst  meas  draft  intvw  canon
            [..]  [..]   [..]  [..]   [..]   [..]      not started

 There is no .voice-and-tone/ in this project.

 MISSING  1 gap
   1 [!!] no knowledge base
          nothing to observe yet
          -> /voice-and-tone:init

+----------------------------------------------------------------------+
| /voice-and-tone:init   discover, measure, interview, canonize        |
+----------------------------------------------------------------------+
```

### 8.5 Panels

`--panel <name>` prints one block plus the menu footer. Names: `pipeline`,
`integrity`, `coverage`, `rules`, `drift`, `sources`, `evidence`, `settings`,
`missing`, `all`. An unknown name exits 1 and lists the valid ones.

The **settings** panel is the one not shown above:

```
 SETTINGS
   profile        default   "Vivido"
   locales        en (primary), cs
   thresholds     corroboration 2   derived_min_samples 5   stale_months 9
                  drift_pct 25
   runtime        node detected, probed 2026-08-01
   vendor         officeparser 4.2.0   pdfjs 4.6.82
   register       5 entries: 1 project, 1 inbox, 2 local, 1 url
   kb path        .voice-and-tone/
```

---

## 9. The gap catalogue

### 9.1 Shape

Each detector is a pure predicate over the state object:

```js
{ id, severity, leverage, what, why, fix }
```

- `severity` — `blocker` | `warning` | `nit` (D7)
- `leverage` — integer 0..5, how many other gaps or capabilities resolving this
  unlocks (D8)
- `why` — one line, the consequence. Never a restatement of `what`.
- `fix` — the literal command to run, or `null` when it is a judgement call.

Sorted by `leverage` descending, then `severity`, then `id`. The list is
**capped at ten** in the rendered panel with `+N more` — the audit report's own
rule applies: "An audit that ends in a 300-item list ends in nothing."

### 9.2 The detectors

| ID | Fires when | Sev | Lev | Fix |
|---|---|---|---|---|
| `G01` | no knowledge base (mirrors `E_NO_KB`) | blocker | 5 | `/voice-and-tone:init` |
| `G02` | `validate` reports errors | blocker | 5 | fix, then `/voice-and-tone:sync` |
| `G03` | no drift baseline, per locale | blocker | 4 | `fingerprint.mjs --set-baseline` |
| `G04` | `manifest.unindexed.count > 0` | blocker | 4 | `/voice-and-tone:connect --ingest` |
| `G05` | every rule is `assumed` | warning | 4 | `/voice-and-tone:init` (interview) |
| `G06` | a context has corpus traffic and 0 authored cells | warning | 3 | `/voice-and-tone:write <context>` |
| `G07` | `CONTEXT.md` older than a file it compiles from | warning | 3 | `/voice-and-tone:sync` |
| `G08` | manifest missing, or listed files changed since | warning | 2 | `--refresh`, or `:audit` |
| `G09` | a drift metric exceeds `thresholds.drift_pct` | warning | 2 | `/voice-and-tone:audit --section drift` |
| `G10` | rules with confidence `disputed` exist | warning | 2 | `/voice-and-tone:audit` |
| `G11` | a source is `stale` (only under `--refresh`) | warning | 2 | `/voice-and-tone:connect --ingest` |
| `G12` | an active locale has no `locales/<code>.md` | nit | 3 | `/voice-and-tone:localize <code>` |
| `G13` | `.drafts/` holds entries and no `correction` evidence is newer | nit | 2 | `/voice-and-tone:learn` |
| `G14` | `validate` reports `W_STALE_EXTRACTOR` | nit | 1 | `/voice-and-tone:connect --ingest` |
| `G15` | `validate` reports `W_NO_EVIDENCE` | nit | 1 | `null` — cite evidence |
| `G16` | `CONTEXT.md` estimated over 900 tokens | nit | 1 | trim rules |

### 9.3 What is deliberately not a gap

This section exists because each of these **looks** like a gap and reporting it
would make the tool worse. `references/gap-catalogue.md` carries it verbatim, and
`test/gaps.test.mjs` asserts each one produces nothing.

| Not a gap | Why |
|---|---|
| Known sources absent from disk | Sources are deliberately uncommitted; a fresh clone has none. `sources.mjs` already reasons this out: warning "would just teach people to commit sources to silence it." (D9) |
| Coverage below 80/80 | `audit-report.md`: "Eighty cells is the denominator; nobody is expected to reach it." Interpolation is the design, not a shortfall. |
| A computed cell | The matrix filling itself along the paths you actually write is the intended behaviour. |
| Files skipped for `no-extractor` | Expected and already reported by `scan`. Only `container`-reason skips are actionable, and those surface as `G04`. |
| `disputed` rules existing | Only surfaced as `G10` because they are **unresolved**, never because conflict is itself a fault. Conflict is information. |

---

## 10. The menu

There is no TUI (§1.3). The loop is:

1. The skill runs `status.mjs` and shows the output **verbatim**.
2. The user replies with a number, a panel name, or `q`.
3. The skill re-invokes `status.mjs --panel <name>` and shows that verbatim.
4. Repeat until `q`, or until the user picks a fix command, at which point the
   skill hands off to the owning command and stops.

The script is stateless; the conversation carries the state. Two rules bind the
skill and are asserted in `test/surface.test.mjs` the way the existing
command/flag agreements already are:

- **It never restates a number the script printed.** Paraphrasing a metric into
  prose is how the summary drifts from the source — §1.2, again.
- **It never draws a panel.** If a view is wanted that the renderer cannot
  produce, that is a change to `render.mjs`, not an improvisation.

---

## 11. `--refresh`

Exactly three things, in this order:

1. `buildManifest(...)` → write `evidence/manifest.json`
2. `buildFingerprint(...)` → write `evidence/fingerprint.json`, **preserving the
   existing baseline**
3. source freshness via `resolveRegister` + `filterVanished` + `diffIndex`
   (in memory; `sources.json` is **not** rewritten)

Three invariants, each with its own test:

- **Never `--set-baseline`.** `voice-maintenance/SKILL.md` already states why: "a
  refreshed baseline shows zero drift by construction and tells you nothing."
- **Never ingest.** Ingestion can spend model tokens (`needsModelTier`); a status
  refresh must not.
- **Never fetch.** Network access belongs to `:connect --refresh` alone.

The output header states plainly which mode produced it: `read-only` or
`refreshed 2026-08-28T09:14:00Z`.

---

## 12. Cross-platform constraints

Inherited from §9 of the parent spec, all already enforced by
`test/conformance.test.mjs`, which picks up the new files automatically:

- ASCII-only stdout. `SCRIPTS` is derived from `readdirSync('scripts')`, so
  `status.mjs --help` is help-checked from the moment it lands.
- No shelling out, no `child_process`. The collector imports library functions
  directly.
- `path.join()` throughout; no literal separators.
- No `import.meta.dirname` (needs Node ≥ 20.11; the declared floor is 18.13).
- LF endings, no BOM, no control bytes, no symlinks.
- The skill and command markdown are swept by the same walk, since they are
  plugin logic a model executes.

---

## 13. Testing

| File | Covers |
|---|---|
| `test/state.test.mjs` | every ring from fixture KBs; stage inference table-driven across all six predicates; freshness with controlled mtimes; drift arithmetic including a zero baseline value, a locale missing from the baseline, and no baseline at all |
| `test/render.test.mjs` | every primitive; **golden output at width 72**; ASCII-only assertion on every rendered panel; width clamping at 60 and 120; truncation of a long brand name; `render.mjs` imports nothing from `node:fs` |
| `test/status.test.mjs` | `--json` shape; each `--panel` name; unknown panel exits 1 and lists valid names; `--refresh` writes manifest and fingerprint and **leaves `baseline` byte-identical**; the empty-KB screen renders instead of throwing |
| `test/gaps.test.mjs` | each of `G01`..`G16` fires on a KB built to trigger it and stays silent on one built not to; **every row of §9.3 produces no gap**; ranking order; the ten-item cap |
| `test/surface.test.mjs` | (extend) every flag `commands/status.md` documents is accepted by the real parser — the agreement the existing tests already enforce for `:connect` and `:init` |

### 13.1 The test that makes D1 real

```
test('a default run does not write a single byte under the knowledge base')
```

Snapshot `{path -> mtimeMs, size}` for every file under the KB, run
`status.mjs` with no flags, snapshot again, assert deep equality.

This is the same posture the plugin already takes toward its two humor gates:
they are functions rather than instructions, because "a rule written in prose is
one a language model can reason its way around." Read-only stated in a doc is a
rule in prose. Read-only asserted over mtimes is a function that returns zero.

---

## 14. Migration

Purely additive. No existing artifact changes shape, no existing script changes
behaviour, no knowledge base needs migrating.

One new optional config key:

```yaml
thresholds:
  drift_pct: 25        # new; defaults to 25 when absent
```

Added to `DEFAULT_CONFIG` in `scripts/lib/config.mjs`. `deepMerge` already
supplies it for every existing `config.yml`, so no user file needs editing and
`test/migration.test.mjs`'s parity guarantee holds unchanged.

### 14.1 Coordination note

`templates/kb/config.yml` and `scripts/lib/config.mjs` are under active edit on
`feat/source-ingestion` (the `scan:` → `sources:` collapse). The `drift_pct`
addition touches `DEFAULT_CONFIG.thresholds` only — a different key from that
work — but it should land **after** that branch merges to keep the diff clean.

---

## 15. Open questions

1. **Should the menu accept composition** — `--panel coverage,drift`? Cheap to
   add, but every extra flag is another row `test/surface.test.mjs` must agree
   with. Recommend: no in v1.
2. **Should `G06` ("traffic, no authored cells") use word count or file count**
   for "traffic"? `audit-report.md` says "measurable corpus traffic" without
   defining it. Recommend: words, with a floor of 500, since one long legal page
   should not make `legal-policy` look busy.
3. **Should `:status` be allowed to auto-trigger as a skill**, or command-only?
   Auto-triggering on "what do we have" is the point of a skill, but it risks
   firing on unrelated questions. Recommend: skill with the narrow trigger list
   in §4.2, revisited after use.
4. **Does the drift panel need a per-metric baseline date**, or is one date per
   locale enough? Currently one, since the baseline is captured atomically.

---

## 16. Deferred

- **Refactor `:audit`'s numeric sections onto `render.mjs`.** §2.5 — the
  hand-typed ASCII in `audit-report.md` is the drift defect one level down.
  Deferred because it touches an approved, working skill, but `render.mjs`'s API
  should be shaped today so that this is a later wiring job and not a rewrite.
  Specifically: `matrix`, `stackedBar`, and `deltaBar` must take plain data, never
  a state object.
- **Trend over time.** `CHANGELOG.md` and the ledger carry dates; a sparkline of
  coverage or drift across versions is possible and out of scope.
- **Per-channel and per-locale drill-down** beyond `--locale`.
- **A `--watch` mode.** Would need a loop, which needs a process model this
  plugin deliberately does not have.

---

## 17. Evidence for this spec

Read on 2026-08-28, on `feat/source-ingestion` @ `645d803` plus its uncommitted
working tree:

| Claim | Source |
|---|---|
| ASCII-only stdout is enforced, `?` substitution | `scripts/lib/cli.mjs` `toAscii`, `test/conformance.test.mjs` |
| Conformance enrols new scripts automatically | `test/conformance.test.mjs`, `SCRIPTS` from `readdirSync` |
| `:audit` refreshes and therefore writes | `skills/voice-maintenance/SKILL.md` |
| Baseline must not be refreshed | `skills/voice-maintenance/SKILL.md`, `commands/audit.md` |
| Absent sources must not warn | `scripts/sources.mjs`, `runCheck` reporting block |
| `unindexed` exists and names the right remedy | `scripts/lib/corpus.mjs` `gatherAll`, `scripts/scan.mjs` |
| Coverage denominator is not a target | `skills/voice-maintenance/references/audit-report.md` |
| Severity scale is confidence-derived | `skills/voice-review/references/severity.md` |
| Leverage ranking already exists | `skills/voice-discovery/references/gap-analysis.md` |
| Loaders degrade rather than throw | `scripts/lib/sourceindex.mjs` `loadIndex`, `scripts/lib/kb.mjs` `loadKb` |
| `CONTEXT.md` compiles from five files | `scripts/compile-context.mjs` `compileContext` |
| Card token budget warns at 900 | `scripts/compile-context.mjs` `main` |
| Generated summaries drift when hand-maintained | `README.md`, "The knowledge base" |
| Gates are functions, not instructions | `README.md`, "Two humor gates, both hard" |
