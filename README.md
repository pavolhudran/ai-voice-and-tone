# Voice & Tone

A Claude Code plugin that builds, maintains, and applies a brand's voice and tone
on any project - an application codebase, a marketing site, a documentation repo,
or a bare folder of text with no code in it at all.

Built on Mailchimp's Voice and Tone framework: **voice is constant, tone flexes
with the reader's emotional state.**

## The idea

A voice guide the plugin can prove, not just recite.

Every rule in the knowledge base carries **where it came from** (evidence) and
**how sure we are** (confidence). That one decision drives three systems that are
otherwise separate:

- **Interview priority** - unconfirmed rules become the next questions
- **Review severity** - `confirmed` rules block, `assumed` rules are nits,
  `disputed` rules are never enforced at all
- **Maintenance** - rules with stale or contradicted evidence surface for retirement

## Install

```
/plugin install voice-and-tone
```

Requires **Node 18 or newer** for the measurement scripts. Without Node the plugin
still works: the model estimates the same metrics and marks them `estimated`, and
an estimated fingerprint may only ever produce `assumed` rules, never `derived`.
Missing runtime degrades precision, never function.

Zero npm dependencies. Nothing to install beyond the plugin itself.

## Start here

```
/voice-and-tone:init
```

Scans your project for copy, measures a corpus fingerprint, drafts a knowledge
base, works out what it still does not know, and asks you - mostly by showing you
rewrites of your **own** strings and asking which one sounds like you.

Creates `.voice-and-tone/` in your project root.

## Commands

| Command | What it does |
|---|---|
| `/voice-and-tone:init` | discover, measure, interview, canonize |
| `/voice-and-tone:write` | draft for a context and a reader state |
| `/voice-and-tone:review` | critique with severities and `file:line` anchors |
| `/voice-and-tone:rewrite` | off-brand text to on-brand text |
| `/voice-and-tone:learn` | turn your corrections into rules, once corroborated |
| `/voice-and-tone:audit` | coverage, drift, rule health, scored inventory |
| `/voice-and-tone:sync` | validate and recompile the card |
| `/voice-and-tone:localize` | apply a locale pack |

Skills trigger on their own too - ask for a button label or say "make this sound
like us" and the right one loads without a command.

## The knowledge base

Lives in your project, in markdown, under version control:

```
.voice-and-tone/
  config.yml         profiles, locales, scan paths, thresholds
  CONTEXT.md         GENERATED digest, ~600 tokens - the always-loaded card
  voice.md           characteristics (constant) + persona rules
  tone.md            authored cells + state vectors + context offsets
  audience.md        who we write for, and the states they arrive in
  lexicon.md         love / use carefully / avoid / never say
  mechanics.md       grammar, casing, punctuation, web elements
  channels/          per-channel playbooks
  locales/           per-language packs
  examples/          approved, rejected, and before/after pairs
  evidence/          the numbered ledger, the fingerprint, the conflicts
  CHANGELOG.md
```

`CONTEXT.md` is generated and never hand-edited. A hand-maintained digest drifts
from its source - the plugin is designed around that specific failure.

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

**Two humor gates, both hard:**

1. Humor requires an authored cell. A computed cell never produces humor.
2. `frustrated`, `anxious-at-risk`, and `disappointed-leaving` force `humor 0` -
   in authored cells too.

The failure mode of a computed cell must be "a bit flat", never "joked at someone
whose payment just failed".

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
node --test test/
```

Zero dependencies. Node 18+. The scripts run identically on macOS, Windows, and
Linux - `test/conformance.test.mjs` enforces that rather than trusting it.

## Attribution and license

Built on [Mailchimp's Content Style Guide](https://styleguide.mailchimp.com/),
published under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
**Not affiliated with or endorsed by Mailchimp.** This plugin encodes method and
structure and carries no substantial verbatim prose from that guide - see
[ATTRIBUTION.md](ATTRIBUTION.md).

Dual licensed: **MIT** for `scripts/` and `test/`, **CC BY-NC 4.0** for the method
documentation. See [LICENSE](LICENSE).
