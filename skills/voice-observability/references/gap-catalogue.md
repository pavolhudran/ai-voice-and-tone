# Gap catalogue

Every detector is a pure predicate over the state object, implemented in
`scripts/lib/gaps.mjs` and asserted in `test/gaps.test.mjs`. This file is the
prose companion, not a second source of truth - if the two ever disagree, the
code is right and this file is stale.

## Ranking

By **leverage** first, then severity, then id. That is the rule the interview
already uses (`voice-discovery/references/gap-analysis.md`): what unlocks the
most goes first. A blocker nobody can act on yet is not the most useful line on
the screen.

Severity reuses the review scale (`voice-review/references/severity.md`) rather
than inventing a fourth vocabulary: `blocker`, `warning`, `nit`.

## The detectors

| ID | Fires when | Sev | Lev | Fix |
|---|---|---|---|---|
| `G01` | no knowledge base | blocker | 5 | `/voice-and-tone:init` |
| `G02` | `validate` reports errors | blocker | 5 | `/voice-and-tone:sync` |
| `G03` | a locale has no drift baseline | blocker | 4 | `fingerprint.mjs --set-baseline` |
| `G04` | registered material never ingested | blocker | 4 | `/voice-and-tone:connect --ingest` |
| `G05` | every rule is `assumed` | warning | 4 | `/voice-and-tone:init` |
| `G06` | a context has corpus traffic and 0 authored cells | warning | 3 | `/voice-and-tone:write <context>` |
| `G07` | `CONTEXT.md` older than a file it compiles from | warning | 3 | `/voice-and-tone:sync` |
| `G08` | no manifest, or listed files changed since | warning | 2 | `/voice-and-tone:status --refresh` |
| `G09` | a drift metric exceeds `thresholds.drift_pct` | warning | 2 | `/voice-and-tone:audit --section drift` |
| `G10` | `disputed` rules are unresolved | warning | 2 | `/voice-and-tone:audit` |
| `G11` | a source changed since it was analysed | warning | 2 | `/voice-and-tone:connect --ingest` |
| `G12` | an active locale has no locale pack | nit | 3 | `/voice-and-tone:localize <code>` |
| `G13` | drafts await `:learn` | nit | 2 | `/voice-and-tone:learn` |
| `G14` | a source was extracted by an unpinned library version | nit | 1 | `/voice-and-tone:connect --ingest` |
| `G15` | rules cite no evidence | nit | 1 | cite evidence |
| `G16` | `CONTEXT.md` is over 900 tokens | nit | 1 | trim rules |
| `G17` | a speaker has no voice characteristic or no default dials line | blocker | 4 | `/voice-and-tone:speaker add <slug>` |
| `G18` | a speaker has no drift baseline | blocker | 3 | `fingerprint.mjs --set-baseline --profile <slug>` |
| `G19` | a speaker's registered material was never ingested | blocker | 3 | `/voice-and-tone:connect --ingest --profile <slug>` |
| `G20` | a speaker card is older than a file it compiles from, house files included | warning | 3 | `/voice-and-tone:sync --profile <slug>` |
| `G21` | the house declares speakers and `locks:` is empty | warning | 3 | add `locks:` to `config.yml`, then `/voice-and-tone:sync` |

`G17`-`G20` run once per speaker: over every declared speaker in the house
view, where each gap is prefixed `[<slug>]`, and over the one speaker in a
speaker view (`--profile <slug>`), with no prefix. `G21` is a house-level
judgement and fires once: a house with speakers and no locks has guardrails
every speaker can override, which is rarely what the brand team believes it
has.

### Two guards worth knowing about

**`G01` short-circuits everything.** With no knowledge base, every other
detector would report on an empty state object, burying the single real remedy
under a wall of consequences of it.

**`G05` requires at least one rule.** "Every rule is assumed" over zero rules is
vacuously true, and would fire on a bare knowledge base where the draft stage is
the real story.

**`G11` only fires under `--refresh`.** Read-only mode never hashes, so it
cannot know, and says `not checked` rather than reporting zero.

## What is deliberately not a gap

Each of these **looks** like a gap. Reporting any of them would make the tool
worse. `test/gaps.test.mjs` asserts that each produces nothing.

| Not a gap | Why |
|---|---|
| **Known sources absent from this machine** | Sources are deliberately uncommitted, so a fresh clone has none of them and the statistics survive without them. `scripts/sources.mjs` already reasons this out: warning here "would just teach people to commit sources to silence it." |
| **Coverage below 80/80** | Eighty cells is the denominator, not a target. `audit-report.md`: "nobody is expected to reach it." |
| **A computed cell** | The matrix filling itself along the paths you actually write is the intended behaviour, not a hole. |
| **Files skipped for having no extractor** | Expected, and already reported by `scan`. Only container-format skips are actionable, and those surface as `G04`. |
| **A `disputed` rule existing** | `G10` fires because the dispute is **unresolved**, never because conflict is a fault. When two sources genuinely disagree that is information, and both sides are held open until the user decides. |
| **A speaker whose every cell is computed** | Same as the house: the matrix fills itself along the paths that speaker actually writes. |
| **A speaker with zero overrides** | Inheriting everything is the expected starting state, not a hole. |
| **A speaker whose card has never been compiled** | `G17` already owns "this speaker is not finished"; a second gap for the missing card would be the same remedy twice. |

If a user asks why one of these is not reported, the answer is that the silence
is deliberate - not that the detector is missing.
