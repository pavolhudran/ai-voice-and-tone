# Voice & Tone

A Claude Code plugin that builds, maintains, and applies a brand's voice and tone
on any project - an application codebase, a marketing site, a documentation repo,
or a bare folder of text with no code in it at all.

Built on Mailchimp's Voice and Tone framework: **voice is constant, tone flexes
with the reader's emotional state.**

**[Read the illustrated overview](https://pavol.hudran.gitlab.io/ai-voice-and-tone/)** -
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
/plugin install voice-and-tone
```

**Requires Node 18 or newer.** `/voice-and-tone:init`, `:learn`, `:audit`, and
`:sync` run the measurement scripts directly and will not complete without it -
`:init` calls `scan.mjs` at its first step. The writing and review commands -
`:write`, `:rewrite`, `:localize`, `:review` - read the compiled knowledge base
and need no runtime once it exists.

Zero npm dependencies, now and permanently. Nothing to install beyond the plugin.

## Start here

```
/voice-and-tone:init
```

Creates `.voice-and-tone/` in your project root, then **commit it** - it is
markdown, so voice changes arrive as pull requests you can read and revert. Only
`.drafts/` is gitignored.

```
/voice-and-tone:write an error for a file over the upload limit
/voice-and-tone:review content/pricing.md
/voice-and-tone:learn          # after you edit what it drafted
/voice-and-tone:audit          # coverage, drift, rules broken so often they are not rules
```

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
  config.yml         profiles, locales, scan paths, thresholds
  CONTEXT.md         GENERATED digest, ~600 tokens - the always-loaded card
  voice.md           characteristics (constant), each with what it rules out
  tone.md            authored cells + eight state vectors + ten context offsets
  audience.md        who we write for, and the states they arrive in
  lexicon.md         love / avoid / never say, ranked by what your corpus breaks
  mechanics.md       grammar, casing, punctuation, web elements
  channels/          per-channel playbooks, generated on second use
  locales/           per-language packs; typography seeded, register asked
  examples/          approved, rejected, and before/after pairs
  evidence/
    ledger.md        numbered, dated, and bidirectional
    fingerprint.json measured metrics, and the baseline drift is measured against
    conflicts.md     sources that genuinely disagree
  CHANGELOG.md       appended on every approved change
```

**`CONTEXT.md` is generated and hand edits are discarded by design.** The
framework this builds on has a documented flaw: its voice page and its own
summary list different characteristics, because the summary was maintained by
hand and drifted. Here it is recompiled by `compile-context.mjs` every time.

**The evidence ledger points both ways.** Rules cite their evidence; each evidence
entry lists the rules it produced. Say "ignore the 2024 newsletters" and the
plugin knows exactly which rules to reopen instead of guessing.

## Commands and skills

Commands are explicit. Skills trigger themselves - ask for a button label and
`microcopy` loads without a command.

| Command | What it does |
|---|---|
| `/voice-and-tone:init` | discover, measure, interview, canonize |
| `/voice-and-tone:write` | draft for a context and a reader state |
| `/voice-and-tone:review` | critique with severities and `file:line` anchors |
| `/voice-and-tone:rewrite` | off-brand text to on-brand, showing what changed and why |
| `/voice-and-tone:learn` | turn your corrections into rules, once corroborated |
| `/voice-and-tone:audit` | coverage, drift, rule health, scored inventory |
| `/voice-and-tone:sync` | validate and recompile the card |
| `/voice-and-tone:localize` | apply a locale pack |

| Skill | Triggers when |
|---|---|
| `voice-and-tone` | you ask for copy, or for something to sound like you |
| `voice-review` | you ask whether something is on brand |
| `microcopy` | buttons, errors, empty states, notifications |
| `voice-discovery` | no knowledge base exists, or you offer new material |
| `voice-maintenance` | you edited a draft, or asked how healthy the guide is |

### The critic

`agents/voice-critic.md` runs in a **fresh context** with `Read` only. It sees the
knowledge base and the draft, never the reasoning behind it - so it cannot be told
why a choice was made, and cannot be talked into accepting it.

It also takes the **read-back test**: given the copy with its labels stripped, it
must name the context and reader state. Guess wrong and the tone missed. No human
needed. The dispatch is two turns precisely so the guess is made before the answer
is revealed.

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
