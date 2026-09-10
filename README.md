# Voice & Tone

A Claude Code plugin that builds, maintains, and applies a brand's voice and tone
on any project - an application codebase, a marketing site, a documentation repo,
or a bare folder of text with no code in it at all.

Built on Mailchimp's Voice and Tone framework: **voice is constant, tone flexes
with the reader's emotional state.**

**[Read the illustrated overview](https://ai-voice-and-tone-9125a0.gitlab.io/)** -
the same material for a non-technical audience, with the tone matrix and the
corroboration rule as things you can click. This README is the developer's cut:
file layout, the arithmetic, what is enforced by code, and how to run the tests.

## The problem it solves

Every company has a line like "be warm, but professional". Almost none can say
who decided it, based on what, or whether it is still true. So the guide drifts
from what the company actually publishes, and nobody notices, because there is
nothing to notice with.

Here every rule carries **where it came from** (an evidence ID) and **how sure we
are** (a confidence level). That single value drives three systems that are
usually separate:

| Confidence | Interview priority | Review severity | Maintenance |
|---|---|---|---|
| `confirmed` | not asked | blocks | retires on contradicted evidence |
| `derived` | low | warns | retires when stale |
| `assumed` | high - asked first | nit | replaced as soon as evidence arrives |
| `disputed` | asked as a decision | **never enforced** | held open until you choose |

`disputed` is the interesting one. When two sources genuinely disagree - a formal
marketing site, a casual product UI - that is information, not error. Both sides
are recorded in `evidence/conflicts.md` and neither is enforced until you decide.

## Install

```
/plugin marketplace add https://gitlab.com/pavol.hudran/ai-voice-and-tone
/plugin install voice-and-tone@ai-voice-and-tone
```

Or from a local checkout, point the marketplace at the directory instead:

```
/plugin marketplace add ~/Sites/ai-voice-and-tone
```

**Requires Node 18 or newer.** `/voice-and-tone:init`, `:connect`, `:learn`,
`:audit`, `:status`, and `:sync` run scripts directly and will not complete
without it - `:init` calls `scan.mjs` at its first step, `:connect` calls
`sources.mjs`, `:status` calls `status.mjs`. The
writing and review commands - `:write`, `:rewrite`, `:localize`, `:review` -
read the compiled knowledge base and need no runtime once it exists.

Zero npm dependencies, now and permanently. Nothing to install beyond the plugin.

## Start here

```
/voice-and-tone:init
```

Creates `.voice-and-tone/` in your project root, then **commit it** - it is
markdown, so voice changes arrive as pull requests you can read and revert.
`.drafts/` and `sources/` are gitignored; see
["Where your material goes"](#where-your-material-goes) below for why.
During discovery it asks whether the brand speaks with one voice or several;
answer later and add speakers any time with `/voice-and-tone:speaker add`.

```
/voice-and-tone:status         # what you have, what it is set to, what is missing
/voice-and-tone:write an error for a file over the upload limit
/voice-and-tone:review content/pricing.md
/voice-and-tone:learn          # after you edit what it drafted
/voice-and-tone:audit          # coverage, drift, rules broken so often they are not rules
```

`:status` reads and never writes, so it is the safe thing to run first on a
knowledge base you did not build. `:audit` refreshes the numbers and ends by
asking you to decide something; `:status` only ever tells you where you are.

It also renders as a page you can send. See
[The report](#the-report-a-page-you-can-send) below.

## Discovery: it reads what you have already written

There is no template to fill in. `:init` runs a seven-stage pipeline over your
existing copy:

```
scan -> ingest -> measure -> draft -> gaps -> interview -> canonize
```

- **scan** - which files actually contain copy (`scripts/scan.mjs`)
- **ingest** - an existing style guide enters as `confirmed`
- **measure** - sentence length, contraction rate, reading grade, per language,
  never averaged across locales (`scripts/fingerprint.mjs`)
- **draft** - fill every slot, honestly labelled `assumed`
- **gaps** - rank the unknowns by how many downstream rules each one unlocks
- **interview** - forced choices between rewrites of your **own** strings
- **canonize** - validate, compile, commit (`scripts/validate.mjs`, `compile-context.mjs`)

The interview is preference-pair calibration, not adjective elicitation. Asked
"how formal are you, 1-5?", people answer unreliably - they are describing
themselves. Shown two rewrites of a string they recognise, they answer well.
Anything the corpus already answered is never asked.

## Where your material goes

Drop brand material - a style guide, the brand deck, past newsletters, a
tone-of-voice PDF - into `.voice-and-tone/sources/`, or point `/voice-and-tone:connect`
at a file, folder, or URL anywhere else. Run `/voice-and-tone:connect` any time
to see what is new, changed, or missing.

**Nothing you add is committed.** `sources/` is gitignored by default - what
survives is `evidence/sources.json`, the record of every source's content
hash, what was extracted from it, and which rules it produced. Identity is
the hash, not the path, so re-adding the same file from a different folder is
a detectable no-op. That record alone is enough to recompute the fingerprint
or subtract any single source later, so a colleague who clones the repository
with an empty `sources/` gets the same baseline, not a false drift report.

Read deterministically, no dependencies to install: Markdown, plain text,
JSON, YAML, PO, HTML, RTF, CSV/TSV, WebVTT/SubRip, `.docx`, `.pptx`, `.xlsx`,
`.odt`, `.odp`, `.ods`, and PDFs with a text layer. Scanned PDFs, images, and
JS-rendered pages are read by the model instead and recorded `estimated` -
they can support `assumed` rules but never `derived` ones. Legacy `.doc`,
`.ppt`, and `.xls` are refused; re-save them as the modern format.

Container formats are read by two libraries vendored into the plugin rather
than installed - pinned versions, hash-verified, so the same document
extracts identically on every machine. See `vendor/README.md` for versions
and licenses.

To commit source material anyway, delete the `sources/` line from
`.voice-and-tone/.gitignore`.

## The tone model

Ten contexts by eight reader states is eighty cells, which nobody authors. So the
knowledge base stores **eight state vectors** and **ten context offsets** and
computes the rest:

```
cell(context, state) = clamp(state_vector[state] + context_offset[context], 0, 4)
```

Authored cells override completely, and computed cells get promoted to authored
on first real use - the matrix fills itself along the paths you actually write.

Six dials, 0-4: `warmth` `humor` `directness` `detail` `urgency` `formality`.
Cell IDs are `T-<context>/<state>`, e.g. `T-system-error/frustrated`.

### Two humor gates, both hard

1. **Humor requires an authored cell.** A computed cell never produces humor,
   whatever the arithmetic says.
2. **`frustrated`, `anxious-at-risk` and `disappointed-leaving` force `humor 0`** -
   in authored cells too.

Every other dial is arithmetic. Humor is not, because the cost is not symmetrical:
too flat is a bad sentence, a joke at someone whose payment just failed is a lost
customer. The failure mode of a computed cell must be "a bit flat".

Both gates are **functions, not instructions** - `interpolate()` and
`applyHumorGates()` in `scripts/lib/kb.mjs`. A rule written in prose is one a
language model can reason its way around. A function that returns zero cannot be
argued with.

## The knowledge base

Lives in your project, in markdown, under version control. No database, no
dashboard, no account:

```
.voice-and-tone/
  config.yml         profiles, locales, thresholds, and the source register
  CONTEXT.md         GENERATED digest, ~600 tokens - the always-loaded card
  voice.md           characteristics (constant), each with what it rules out
  tone.md            authored cells + eight state vectors + ten context offsets
  audience.md        who we write for, and the states they arrive in
  lexicon.md         love / avoid / never say, ranked by what your corpus breaks
  mechanics.md       grammar, casing, punctuation, web elements
  channels/          per-channel playbooks, generated on second use
  locales/           per-language packs; typography seeded, register asked
  examples/          approved, rejected, and before/after pairs
  sources/           where you drop brand material; gitignored, never committed
  evidence/
    ledger.md        numbered, dated, and bidirectional
    fingerprint.json measured metrics, and the baseline drift is measured against
    manifest.json    which files carry copy, and their per-locale totals
    sources.json     every source's hash, statistics, and the rules it produced
    conflicts.md     sources that genuinely disagree
  profiles/<slug>/   one overlay per speaker (optional) - see Speakers
  CHANGELOG.md       appended on every approved change
```

Several first-person voices under one brand? See [Speakers](#speakers).

**`CONTEXT.md` is generated and hand edits are discarded by design.** The
framework this builds on has a documented flaw: its voice page and its own
summary list different characteristics, because the summary was maintained by
hand and drifted. Here it is recompiled by `compile-context.mjs` every time.

**The evidence ledger points both ways.** Rules cite their evidence; each evidence
entry lists the rules it produced. Say "ignore the 2024 newsletters" and the
plugin knows exactly which rules to reopen instead of guessing.

## Speakers

This is new, and optional: one knowledge base can hold a shared **house**
layer plus one **speaker** overlay per first-person voice that writes under
the brand.

A speaker is any first-person voice under the house - a founder posting under
her own name, a support team, a product line, a mascot, an assistant. It owns
its voice characteristics, default dials, authored cells and examples; it
inherits the house's lexicon, mechanics, audiences, channels and locales, and
may override any of them by ID, except the rules the house has locked. Two
levels, fixed: an overlay always sits on the house, never on another overlay,
so "which rule won" is always answerable.

Each speaker is a profile in `config.yml` (`default` is the house) and an
overlay under `profiles/<slug>/`, in the same file names and rule format as
the house. Every overlay file is optional; a missing file means "inherit":

```
profiles/<slug>/
  CONTEXT.md         GENERATED speaker card
  voice.md           the speaker's characteristics - replaces the house's
  tone.md            default dials, and the cells this speaker authored
  lexicon.md         additions and overrides, merged by ID; likewise mechanics,
                     audience, channels, and locales
  examples/          the speaker's approved, rejected, and before/after pairs
  evidence/          the speaker's own fingerprint, baseline, and manifest
  sources/           the speaker's inbox; gitignored like the house's
```

**The arithmetic gains one term.** A speaker states its default dials once;
the difference from the house's default dials is `speaker_offset`, added to
`state_vector + context_offset` before the clamp and the humor gates, which
are unchanged:

```
speaker_offset       = speaker default dials - house default dials      (per dial)
cell(context, state) = clamp(state_vector[state] + context_offset[context] + speaker_offset, 0, 4)
```

Authored cells are never shifted, and house-authored cells are not inherited:
a speaker can only produce humor through a cell a human authored for that
speaker, which is what keeps gate 1 honest.

### Locks

`locks:` in `config.yml` names the house rules no speaker may override. They
print on every speaker card under "House guardrails (locked)", a speaker that
breaks one fails validation, and `validate` checks that every listed ID exists
in the house:

```yaml
locks: [V2, L20, L21, L22, M03]   # house rule IDs no speaker may override
# one list, in one place: a lock is a governance decision owned by the brand team
```

### The speaker command

- `/voice-and-tone:speaker add <slug> --name "<name>" [--from <path|url> ...] [--locale <code>]` - scaffolds the overlay, registers the material under the speaker, fingerprints it, drafts, interviews on the speaker's own strings, compiles the speaker card.
- `/voice-and-tone:speaker list` - one line per speaker: slug, name, voice rules, authored cells, overrides, drafts pending. Read-only.
- `/voice-and-tone:speaker remove <slug>` - retraction: reopens every rule the speaker's evidence produced, then removes the overlay, the profile, and its register entries, each step a proposed diff.

All three are backed by one script, `scripts/speaker.mjs`: `--add` copies the
overlay template, declares the profile in `config.yml` with its comments
intact, and registers the speaker's inbox; `--list` prints the same numbers as
the status panel; `--remove --dry-run` prints the plan before anything is
written. The scaffold is deterministic, so every speaker starts the same way.

### `--profile`

`--profile <slug>` selects a speaker on `:write`, `:rewrite`, `:localize`,
`:review`, `:status`, `:sync`, `:audit`, and `:connect`. Natural language
works too: "write this as Maya" resolves to the profile whose `name` matches.
`:learn` takes no flag - the draft's frontmatter names the profile, and that
decides where a proposed rule lands. Review findings print their origin:
`L03 (house)`, `L31 (maya)`, `M07 (maya, overrides house)`, `L20 (house, locked)`.

A default speaker for a project is one line in its `CLAUDE.md`:

```
voice-and-tone: default profile <slug>
```

### Status and the critic

The house view of `:status` gains a `speakers` panel - one line per speaker
with voice rules, authored cells, overrides, lock violations, drift, and
drafts pending - and five gap detectors, `G17` to `G21`: a speaker with no
voice rule or default dials, no drift baseline, registered material never
ingested, a card older than what it compiles from, and a house with speakers
but an empty `locks`. `--profile <slug>` shows one speaker's resolved state,
and `--artifact` under it writes `.drafts/status-<slug>.html`, one stable
link per speaker.

With two or more speakers the critic's read-back test asks one more question:
**which speaker wrote this?** A wrong guess is a finding. Several speakers who
all sound like the house is the failure mode a multi-speaker knowledge base
exists to prevent.

A knowledge base with no speakers is unchanged, byte for byte.

## Commands and skills

Commands are explicit. Skills trigger themselves - ask for a button label and
`microcopy` loads without a command.

| Command | What it does |
|---|---|
| `/voice-and-tone:init` | discover, measure, interview, canonize |
| `/voice-and-tone:connect` | register brand material and see what has been analysed |
| `/voice-and-tone:write` | draft for a context and a reader state |
| `/voice-and-tone:review` | critique with severities and `file:line` anchors |
| `/voice-and-tone:rewrite` | off-brand text to on-brand, showing what changed and why |
| `/voice-and-tone:learn` | turn your corrections into rules, once corroborated |
| `/voice-and-tone:audit` | coverage, drift, rule health, scored inventory |
| `/voice-and-tone:status` | what you have, what it is set to, and what is missing |
| `/voice-and-tone:sync` | validate and recompile the card |
| `/voice-and-tone:localize` | apply a locale pack |
| `/voice-and-tone:speaker` | add, list, or remove a speaker that inherits the house and replaces its voice |

| Skill | Triggers when |
|---|---|
| `voice-and-tone` | you ask for copy, or for something to sound like you |
| `voice-review` | you ask whether something is on brand |
| `microcopy` | buttons, errors, empty states, notifications |
| `voice-discovery` | no knowledge base exists, or you offer new material |
| `voice-maintenance` | you edited a draft, or asked how healthy the guide is |
| `voice-observability` | you ask what state the guide is in, or what is missing |

`--profile <slug>` selects a speaker on the writing, review, and status
commands - see [Speakers](#speakers).

### The critic

`agents/voice-critic.md` runs in a **fresh context** with `Read` only. It sees the
knowledge base and the draft, never the reasoning behind it - so it cannot be told
why a choice was made, and cannot be talked into accepting it.

It also takes the **read-back test**: given the copy with its labels stripped, it
must name the context and reader state. Guess wrong and the tone missed. No human
needed. The dispatch is two turns precisely so the guess is made before the answer
is revealed. With two or more speakers it also asks which speaker wrote it.

## The report: a page you can send

The status screen is ASCII because a terminal is where it is read. The palette
is `+`, `-`, `|` and `=` because Windows console codepages mangle anything else,
and every column is padded to a measured width. That is careful work in a
terminal and dead weight in a browser.

```
/voice-and-tone:status --artifact
```

The same command renders the same state as a self-contained HTML page, written
to `<KB>/.drafts/status.html`, which the shipped template gitignores. Publish it
and you have a link for whoever decides what the brand sounds like and does not
open a terminal to find out.

**It is a second renderer, not a second reading.** Same collector, same state
object. `scripts/lib/html.mjs` is a sibling of `scripts/lib/render.mjs` and,
like it, imports no `node:fs` - a renderer that could read a file could put
something on the page the state never carried. A page assembled by a model from
`--json` output would be a *description* of the numbers, free to drift from them
while looking just as authoritative. Run it twice with `--now` pinned and the
bytes are identical.

What the page earns over seventy-two columns of ASCII:

- **The tone matrix becomes a proof sheet.** Authored cells print in ink;
  computed cells print in non-photo blue, the colour a print shop marks a sheet
  up in precisely because it does not reproduce. Identity is never colour alone:
  an authored cell carries a filled mark and its own label.
- **Drift gets a real axis**, with the flag threshold drawn on the track rather
  than stated beside it.
- **Everything is on one page**, so a validation error sits next to the rule it
  names and a drift flag next to the corpus that moved.

There is deliberately no `--panel` equivalent. `--panel` exists because a
terminal cannot scroll back usefully; a page can, and slicing it would hide
exactly the cross-reading the page is for.

Re-running overwrites the same path, so re-publishing updates the same link
rather than scattering new ones. Under `--profile <slug>` the page is written
to `.drafts/status-<slug>.html`, one stable link per speaker.

## Learning: your edits are evidence

Rewrite something the plugin drafted and `:learn` records what changed.
`scripts/diff.mjs` supplies the mechanical facts - word-level changes, length
shift, single-token swaps - and the model classifies them. The script provides
ground truth; the model interprets; neither does the other's job.

**One edit never becomes a rule.** Promotion needs `thresholds.corroboration`
independent corrections pointing the same way, and independent means *from
different drafts*. A single editing pass is one opinion, however many changes it
contains.

- **The one exception** - an unambiguous lexicon swap fires immediately. Change
  `leverage` to `use` and there is nothing to corroborate. A single-word change
  that shifts register (`excited` to `pleased`) is a tone shift, not a swap, and
  stays gated.
- **What never becomes a rule** - factual corrections. "25 MB" to "20 MB" means
  your limit moved, not that the voice is wrong. Learning from those would enforce
  product facts as style.
- **The question audits ask** - a rule broken every time and kept anyway is not a
  rule. `:audit` surfaces those and makes you choose: enforce it, or retire it.

## Always on

Applied to every draft and every review, not as a checklist at the end:

- **Accessibility** - no directional language, links that name their destination,
  plain words, acronyms defined, headings nested, alt text, most important thing first
- **Translation-readiness** - active voice, no double negatives, no idioms, one
  term per concept, spelled-out units, ISO currency codes

Accessibility violations and non-inclusive language are **always** blockers,
whatever confidence any rule carries.

## Development

```
npm test        # or: node --test test/
```

Zero dependencies. Node 18+. Exit codes: `0` success, `1` unexpected error,
`2` validation or integrity failure.

The scripts run identically on macOS, Windows, and Linux, and
`test/conformance.test.mjs` enforces that rather than trusting it - no shell
tools in plugin logic, `path.join()` throughout, ASCII-only stdout, no shebangs,
no symlinks, LF line endings. Those checks cover the skill and command markdown
too, since those are instructions a model executes.

## Attribution and license

Built on [Mailchimp's Content Style Guide](https://styleguide.mailchimp.com/),
published under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
**Not affiliated with or endorsed by Mailchimp.** This plugin encodes method and
structure and carries no substantial verbatim prose from that guide - see
[ATTRIBUTION.md](ATTRIBUTION.md).

Dual licensed: **MIT** for `scripts/` and `test/`, **CC BY-NC 4.0** for the method
documentation. See [LICENSE](LICENSE).
