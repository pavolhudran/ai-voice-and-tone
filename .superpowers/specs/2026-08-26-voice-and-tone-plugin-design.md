# Voice & Tone Plugin — Design Spec

**Date:** 2026-08-26
**Status:** Approved for planning
**Repo:** `ai-voice-and-tone`

---

## 1. Purpose

A project-agnostic Claude Code plugin that builds, maintains, and applies a brand's
voice and tone. It works on any project shape — an application codebase, a marketing
site, a documentation repo, or a bare folder of text with no code at all.

The plugin is built on Mailchimp's Voice and Tone framework: voice is constant, tone
flexes with the reader's emotional state.

### 1.1 The core idea

> A voice guide the plugin can prove, not just recite.

Every rule in the knowledge base carries **where it came from** (evidence) and **how
sure we are** (confidence). That single decision drives three otherwise-separate
systems:

- **Interview priority** — unconfirmed rules become questions
- **Review severity** — confirmed rules block, assumed rules are nits
- **Maintenance** — rules with stale or contradicted evidence are surfaced for retirement

### 1.2 Non-goals

- Not a visual/brand-identity system. Text only.
- Not a translation engine. It governs how text is written, including for
  translatability, but does not translate.
- Not a CMS or content pipeline. It reads and writes files.
- No dependency on any other plugin. Fully standalone.

---

## 2. Attribution and licensing

Mailchimp's Content Style Guide is published under **CC BY-NC 4.0**.

**Rules for this plugin:**

- Encode **method and structure**, which are not copyrightable. Do not carry
  substantial verbatim prose from Mailchimp's guide into the plugin or into any
  knowledge base it generates.
- Attribution appears in: plugin `README.md`, a top-level `ATTRIBUTION.md`, and the
  header of every generated `CONTEXT.md`.
- Attribution text states: built on Mailchimp's Voice and Tone framework
  (CC BY-NC 4.0); not affiliated with or endorsed by Mailchimp.
- Distribution intent is **public but free** (non-commercial). If that changes,
  §2 is the section to revisit; nothing else in the design depends on it.

### 2.1 Source fidelity note

The scenario-card layer that made Mailchimp's framework famous (user quote →
"the reader is feeling…" → tone → do/don't → example) lived on the retired
companion site `voiceandtone.com`, not on the current style guide. The current
guide's tone section is roughly 200 words. This plugin **reconstructs that card
pattern as a documented method** and generates the cells from the user's own
project. It does not claim to reproduce Mailchimp's cells.

Two documented inconsistencies in the source that informed this design:

1. The guide's voice page lists *plainspoken, genuine, translators, dry humor*;
   its TL;DR lists *human, familiar, friendly, straightforward*. A hand-maintained
   digest drifts from its source. **Therefore: `CONTEXT.md` is always generated.**
2. Mailchimp's tone axis is emotional state only. Mixing funnel stages into that
   axis produces non-composable cells. **Therefore: the state axis is emotion-only.**

---

## 3. Core concepts

### 3.1 Rule

A single normative statement about how the brand writes. Has an ID, a confidence
level, and one or more evidence references.

### 3.2 Evidence

A dated, numbered record of *why* a rule exists. Five types:

| Type | Origin |
|---|---|
| `source` | An ingested document (existing style guide, past content) |
| `corpus` | A measured property of the sample corpus |
| `interview` | A user answer, including preference-pair picks |
| `correction` | A user edit to a plugin-produced draft |
| `decision` | An explicit user ruling, e.g. resolving a conflict |

### 3.3 Confidence

| Level | Meaning | Interview | Review severity |
|---|---|---|---|
| `confirmed` | User stated it explicitly | never re-asked | **Blocker** |
| `derived` | Inferred from corpus, N ≥ `derived_min_samples` | asked only if contradicted | Warning |
| `assumed` | Plugin default, unverified | queued for interview | Nit |
| `disputed` | Sources genuinely conflict, unresolved | asked with both sides shown | **never enforced** |

`disputed` exists because conflicting sources are information, not error. A formal
marketing site and a casual app UI may be a legitimate channel split or may be real
drift. The plugin records both and asks.

---

## 4. Knowledge base

### 4.1 Location

Lives in the **target project**, not the plugin. Default path `.voice-and-tone/`
at project root; overridable in `config.yml`.

### 4.2 Layout

```
.voice-and-tone/
  config.yml              profiles, locales, scan paths, thresholds, runtime probe
  CONTEXT.md              GENERATED digest (~600 tokens) — the always-loaded card
  voice.md                characteristics (constant) + persona rules
  tone.md                 authored cells + state vectors + context offsets
  audience.md             who we write for, their states
  lexicon.md              love / use-carefully / avoid / never-say
  mechanics.md            grammar, casing, punctuation, web elements
  channels/<name>.md      per-channel playbooks (generated on demand)
  locales/<code>.md       per-language packs
  examples/
    approved.md           on-brand samples with provenance
    rejected.md           off-brand samples (anti-corpus)
    pairs.md              before/after correction pairs
  evidence/
    ledger.md             numbered, dated evidence entries
    fingerprint.json      measured or estimated corpus metrics
    conflicts.md          unresolved contradictions
  .drafts/                plugin-produced drafts, for :learn (gitignore recommended)
  CHANGELOG.md
```

### 4.3 Rule format — prose rules

```markdown
### V1 · Plainspoken   `confirmed`  ev: e12, e18

**Means:** Clarity above all — we strip hype and over-promise.
**Rules out:** fluffy metaphor, emotional manipulation, upsell language
**Do:** name the thing; state the outcome
**Don't:** reach for a simile when a noun will do
**Example:** *"Your campaign is scheduled."*
```

The heading carries ID, name, confidence, and evidence refs. Readable by humans,
greppable by the plugin, diffable by git.

### 4.4 Rule format — tabular rules

```markdown
| ID  | Avoid    | Prefer | Why         | Conf      | Ev  |
|-----|----------|--------|-------------|-----------|-----|
| L07 | leverage | use    | jargon      | confirmed | e22 |
| L08 | simply   | —      | condescends | derived   | e31 |
```

### 4.5 ID scheme

Prefix by rule type, monotonic within type, never reused:

`V` voice · `T` tone cell · `L` lexicon · `M` mechanics · `C` channel ·
`A` audience · `X` locale

Tone cell IDs are readable: `T-product-ui/confused`.

Evidence IDs: `e` + monotonic integer, never reused.

### 4.6 Evidence ledger format

```markdown
### e12 — 2026-08-26 — interview
**Type:** preference-pair
**Asked:** error-message formality, A/B on the project's own string
**Answer:** B — "Campaign scheduled successfully."
**Produced:** V1, T-product-ui/frustrated, M04
```

**Bidirectionality is required.** Rules reference evidence; evidence records which
rules it produced. This makes retraction tractable: when a user says "ignore the
2024 newsletters, we've changed," the plugin knows exactly which rules to reopen
rather than guessing.

### 4.7 `config.yml`

```yaml
version: 1
kb_version: 0.1.0
profiles:
  default:
    name: "Acme"
    primary_locale: en
    locales: [en, cs]
scan:
  include: ["content/**/*.md", "locales/**/*.json"]
  exclude: ["node_modules/**", "dist/**", ".git/**"]
runtime:
  node: detected        # detected | absent
  probed: 2026-08-26
thresholds:
  corroboration: 2          # corrections needed before a rule is proposed
  derived_min_samples: 5    # distinct occurrences of a pattern, in >=2 files,
                            # before a corpus observation becomes `derived`
  stale_months: 9           # age at which unused rules are flagged
```

### 4.8 `CONTEXT.md` — the compiled card

**Generated only. Never hand-edited.** Regenerated by `:sync` and after every
approved KB change. Target budget ~600 tokens. Contains:

1. Attribution line + brand, profile, locales, KB version, generated timestamp
2. Voice characteristics: name + one-line "rules out" (4 × 2 lines)
3. Default dial vector
4. Top 8 lexicon avoid→prefer entries, ranked by violation frequency in the
   corpus, `confirmed` first on ties
5. Top 6 mechanics rules, same ranking
6. The humor gate reminder
7. A pointer table: where to load the tone cell, channel playbook, locale pack

Skills load `CONTEXT.md` cheaply and pull only the specific cell/channel/locale
file they need. This is progressive disclosure applied to brand knowledge.

### 4.9 Freshness

A rule's age is the date of its newest evidence entry. `:audit` flags a rule when
it is both older than `stale_months` **and** either never triggered (dead) or
repeatedly overridden.

---

## 5. Discovery and the generated questionnaire

### 5.1 Pipeline

```
scan → ingest → measure → draft KB → gap analysis → interview → canonize
```

### 5.2 Scan

Adapts to project shape:

| Project type | Sources |
|---|---|
| App / codebase | i18n & locale files, error catalogs, README, docs |
| Marketing site | page content, markdown/MDX, meta descriptions, CMS exports |
| Docs repo | the docs themselves |
| No repo | a user-supplied folder, pasted text, URLs |

**In scope for v1 string extraction:** JSON/YAML/PO locale files (values, not keys),
Markdown/MDX, plain text, HTML text nodes.

**Out of scope for v1:** extracting string literals from source code. Too
language-specific and too error-prone; the false-positive rate would poison the
fingerprint. Users can point `scan.include` at specific files instead.

An existing style guide found in the project is ingested as a `source` and its
rules enter at `confirmed`.

### 5.3 Measure — the voice fingerprint

Deterministic metrics computed by `fingerprint.mjs`.

**Universal (any language):**
sentence count · word count · mean/median sentence length · sentence-length SD ·
mean paragraph length · exclamation rate · question rate · emoji rate ·
em-dash rate · semicolon rate · mean word length · heading case ratio
(title vs sentence) · first-person marker rate · second-person marker rate

**English-only (marked N/A for other locales):**
contraction rate · Flesch-Kincaid reading grade · passive-voice heuristic rate ·
imperative-opener rate · hedge rate · intensifier rate · Oxford comma rate ·
long-word rate (>3 syllables)

**Rationale for the split:** contraction rate is meaningless in Czech; syllable
heuristics for reading grade are English-specific. Reporting them for a Czech
corpus would produce confident nonsense. Per-locale fingerprints are computed
separately and never averaged across locales.

### 5.4 Runtime and degradation

The plugin probes once for Node and records the result in `config.yml`.

- **Node present:** metrics are `measured`. Can support `derived` rules.
- **Node absent:** the model estimates the same metrics. Tagged `estimated`.
  An `estimated` fingerprint may only ever produce `assumed` rules, never
  `derived`. A one-line note explains how to upgrade.

Missing runtime degrades precision, never function. The degradation reuses the
existing confidence axis rather than introducing a special mode.

### 5.5 Draft KB and gap analysis

Every slot is filled at `derived` or `assumed`; contradictions are written to
`evidence/conflicts.md` at `disputed`.

The questionnaire is **computed from the gaps**, ranked by leverage: a question
resolving five downstream rules is asked before one resolving one. Anything already
answered implicitly by the corpus is not asked.

### 5.6 Interview — preference-pair calibration

The primary mechanism is **not** adjective elicitation ("how formal are you?"),
which people answer unreliably. It is forced choice between rewrites of the
project's **own** strings:

```
Your string: "Campaign scheduled successfully."

A  "Your campaign is scheduled. Nice work."
B  "Campaign scheduled successfully."
C  "All set — your campaign goes out Thursday at 9am."
```

Each pick adjusts the dial vector and writes a `confirmed` rule with the pair
stored as evidence. Options are designed so each isolates one variable where
possible (A: warmth, B: neutral baseline, C: specificity).

Adjective and open questions are still used where no corpus string exists
(messaging pillars, audience description, persona rules).

**Constraints:** max 4 questions per `AskUserQuestion` call (tool limit); default
max 3 rounds per session; always exitable with "good enough for now," leaving the
remainder `assumed` and queued.

### 5.7 Cold start

If a user asks for copy and no KB exists, the plugin does **not** block. It offers:

- `:init` for the full pipeline, or
- a 3-question quick start producing a provisional KB with everything `assumed`

---

## 6. Voice and tone model

### 6.1 Voice — constant

3–6 characteristics, default target 4. Format per §4.3.

Also captured in `voice.md`:

- **Persona rules** — if the brand has a mascot or character, does it speak, and
  under what constraints? (Mailchimp's Freddie never talks.)
- **Self-reference rules** — brand name capitalization, product naming, what the
  brand calls its users.

**We Are / We Are Not is generated**, not authored. It compiles from the
`Rules out:` lines plus top lexicon entries. Hand-maintaining it alongside the
characteristics guarantees drift — the same failure the source guide exhibits
between its voice page and its TL;DR.

### 6.2 Tone — two axes

**Reader emotional state (8), emotion-only:**

`delighted` · `curious` · `focused` · `uncertain` · `confused` · `frustrated` ·
`anxious/at-risk` · `disappointed/leaving`

**Context (10):**

`marketing-page` · `product-ui` · `system-error` · `help-doc` · `email` ·
`social` · `legal-policy` · `notification` · `support-reply` · `release-notes`

### 6.3 Dials

Six dials, 0–4 scale, displayed as words:

`warmth` · `humor` · `directness` · `detail` · `urgency` · `formality`

`humor` is included deliberately: it is the dial the source framework most cares
about modulating ("if you're unsure, keep a straight face"). `enthusiasm` is not a
dial — it conflates warmth and urgency.

### 6.4 Authored cell format

```markdown
### T-system-error/frustrated   `confirmed`  ev: e12, e40

**Reader is feeling:** blocked, and suspecting it's our fault
**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2
**Do:** say what happened · say what to do next · own it if it's ours
**Don't:** joke · apologize twice · say "oops" · imply they did it wrong
**Example:** *"That file didn't upload — it's over the 25 MB limit. Try a smaller one."*
```

### 6.5 Interpolation

80 cells is not authorable. Store instead:

- **8 state vectors** (one per emotional state)
- **10 context offsets** (one per context)

```
cell(context, state) = clamp(state_vector[state] + context_offset[context], 0, 4)
```

Authored cells override completely. Computed cells are marked `interpolated` and
**promoted on first real use**: the model drafts the full cell, the user approves,
it becomes `confirmed`. The matrix fills itself along the paths actually written.

### 6.6 Humor gates — hard rules

1. **Humor requires an authored cell.** An interpolated cell may never produce
   humor, whatever the arithmetic yields.
2. **Three states force `humor: 0`** regardless of dial values:
   `frustrated`, `anxious/at-risk`, `disappointed/leaving`.

The failure mode of a computed cell must be "a bit flat," never "joked at someone
whose payment just failed."

### 6.7 Always-on layers

Applied to every draft and every review, not as a separate checklist:

**Accessibility:** no directional language · links name their destination ·
plain language · acronyms defined on first use · proper heading nesting ·
alt text guidance · most important information first

**Translation-readiness:** active voice · no double negatives · no idioms, slang,
or clichés · disambiguate `once`/`since`/`right` · avoid gerund-heavy
constructions · no synonym-switching for one concept · spelled-out units ·
ISO currency codes

---

## 7. Maintenance loop

Every write is a **proposed diff**. The plugin never silently edits the KB.

### 7.1 `:learn` — corrections become rules

Every plugin-produced draft is logged to `.voice-and-tone/.drafts/<ISO>-<slug>.md`
with frontmatter recording cell, profile, locale, and KB version.

`:learn` diffs draft → user's final and classifies each edit:

| Class | Action |
|---|---|
| word swap | proposed lexicon row |
| tone shift | dial adjustment on that cell |
| structural | mechanics or rhythm rule |
| formatting | mechanics rule |
| **factual** | **ignored** — not a style signal |

**Corroboration threshold.** A single edit is recorded as evidence but does **not**
create a rule. Promotion requires N ≥ `thresholds.corroboration` *independent*
corrections pointing the same way — independent meaning **from different drafts**,
not different lines within one draft, since one editing pass reflects one mood — except unambiguous lexicon swaps, which fire
immediately. Without this the KB overfits to a single editing session and begins
confidently enforcing an accidental preference.

Proposals are shown with their diff as evidence and approved individually.

### 7.2 `:init --add <source>` — new material

Re-runs ingest on new material only, diffs against existing rules, and surfaces
contradictions as `disputed` rather than overwriting.

### 7.3 `:audit` — health and drift

Reports:

- **Coverage** — authored vs interpolated cells
- **Drift** — current corpus fingerprint vs the baseline captured at init
- **Rule health** — dead (never triggered) · overridden (violated and kept) ·
  stale (old evidence, no recent use) · disputed (unresolved)
- **Inventory** — scored findings across scanned files

The overridden-rules report asks the user to enforce or retire: a rule broken
every time is not a rule.

### 7.4 `:sync` — recompile and validate

Rebuilds `CONTEXT.md`, appends to `CHANGELOG.md`, and validates KB integrity:
broken evidence refs, orphaned rules, duplicate IDs, cells referencing unknown
contexts or states, dial values out of range.

### 7.5 Versioning

Semver on `kb_version`:

- `major` — voice characteristics changed
- `minor` — cells or rules added
- `patch` — examples, evidence, wording

`CHANGELOG.md` is auto-appended on every approved change.

---

## 8. Surface

### 8.1 Commands

| Command | Behavior |
|---|---|
| `:init` | discover → measure → draft → interview → canonize |
| `:write` | draft for a context + reader state |
| `:review` | critique with severities |
| `:rewrite` | off-brand text → on-brand |
| `:learn` | capture corrections into rules |
| `:audit` | health, coverage, drift |
| `:sync` | recompile + validate |
| `:localize` | apply a locale pack |

### 8.2 Skills (auto-triggering)

| Skill | Trigger |
|---|---|
| `voice-and-tone` | "write / draft / make this sound like us" — core applier |
| `voice-review` | "is this on brand", "check this copy" |
| `microcopy` | buttons, errors, empty states, notifications |
| `voice-discovery` | no KB present, or new sources offered |
| `voice-maintenance` | corrections, audits, updates |

### 8.3 Agent

`voice-critic` — runs in **fresh context**, reads only the KB and the draft. It
never sees the drafting rationale, so it cannot be argued into approving the work
it is reviewing.

**Optional depth setting — the read-back test:** the critic is given the draft
without its metadata and asked to guess the context and reader state. A wrong
guess means the tone missed. Cheap, falsifiable, requires no human.

### 8.4 Review output

Markdown findings with `file:line` anchors. Severity derives from the confidence of
the rule violated (§3.3), with two exceptions that are always **Blocker** regardless:
accessibility violations and non-inclusive language.

### 8.5 Scripts — Node, zero dependencies

| Script | Output |
|---|---|
| `scan.mjs` | manifest of copy-bearing files with counts |
| `fingerprint.mjs` | `fingerprint.json` |
| `compile-context.mjs` | `CONTEXT.md` from the KB |
| `validate.mjs` | KB integrity report |
| `diff.mjs` | mechanical draft→final deltas |

`diff.mjs` produces **mechanical** deltas only (word-level changes, length shifts).
Semantic classification (§7.1) is done by the model. The script provides ground
truth; the model interprets it. Neither does the other's job.

### 8.6 Write-time flow

```
load CONTEXT.md
  → determine context + reader state (infer; ask only if genuinely ambiguous)
  → load authored cell, or interpolate
  → load channel playbook + locale pack if applicable
  → draft
  → self-check + accessibility/translation layers
  → log to .drafts/
  → report: "profile X · cell: product-ui/confused · locale: cs"
```

---

## 9. Cross-platform constraints

The plugin must run identically on macOS, Windows, and Linux. These are hard rules
for every script and every skill that shells out:

- Invoke as `node "<absolute path>"` — never `./script.mjs`. Windows does not honor
  shebangs and the exec bit does not survive most transfers.
- **Zero** use of `grep`, `find`, `sed`, `awk`, `cat` in plugin logic. All file
  walking and text processing happens in JS.
- `path.join()` everywhere. No literal `/` in constructed paths.
- Scripts write UTF-8 **files** and print only ASCII status to stdout. Windows
  console codepages mangle non-ASCII, and locale packs make diacritics load-bearing.
- Normalize line endings (`\r\n` → `\n`) on read before computing any metric,
  otherwise sentence and paragraph counts differ by platform.
- No symlinks in the plugin tree.

---

## 10. Locale packs

`locales/<code>.md` — generated by interview, per §5.6.

**Seeded mechanically** (typography, not brand opinion — no interview needed):
quotation mark convention (`„ "` cs/de, `« »` fr, `" "` en) · date format ·
number and decimal separators · currency placement.

**Elicited by interview** (brand decisions):
address register — formal vs informal, and whether it differs by channel ·
anglicisms to avoid · loan-word policy · capitalization conventions ·
pluralization notes · diacritic enforcement level.

The Mailchimp translation-readiness rules (§6.7) form the base layer beneath every
pack.

Fingerprints are computed per locale and never averaged across locales (§5.3).

---

## 11. Precedence

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

Stated in every skill. When the KB conflicts with a user instruction, the
instruction wins and the conflict is offered to `:learn` as potential evidence.

---

## 12. Repository layout

```
ai-voice-and-tone/
  .claude-plugin/plugin.json
  README.md
  ATTRIBUTION.md
  LICENSE
  commands/            init, write, review, rewrite, learn, audit, sync, localize
  skills/<name>/SKILL.md + references/
  agents/voice-critic.md
  scripts/             scan, fingerprint, compile-context, validate, diff (.mjs)
  templates/kb/        skeletons for every KB file
  docs/superpowers/specs/
```

---

## 13. Open questions

- **Plugin/command namespace length.** `/voice-and-tone:init` is verbose to type.
  Decide whether to keep it or use a shorter plugin name with the full name as the
  display title.
- **Draft retention policy.** How long to keep `.drafts/` before pruning, and
  whether to gitignore by default. Current assumption: gitignore, prune at 90 days.
- **The plugin's own license.** §2 covers Mailchimp's license over *their* material.
  This plugin's own code and docs need a license of their own. Options: MIT for
  `scripts/` with CC BY-NC 4.0 for the method docs (mirrors the source's terms and
  keeps the derived-material question clean), or CC BY-NC 4.0 throughout. Needs a
  decision before the first public push.
- **Channel playbook seeding.** Whether the first `:write` to a new channel should
  generate a full playbook or only the tone cell. Current assumption: cell only;
  playbook generated on second use.

---

## 14. Deferred (explicitly out of scope for v1)

- Evaluation harness with held-out corpus samples
- Git hooks / pre-commit prose linting
- Multi-brand UI (the `config.yml` profile scheme is designed for it; the commands
  are not)
- Source-code string literal extraction (§5.2)
- Voice A/B testing against engagement metrics

---

## 15. Sources

- Mailchimp Content Style Guide — <https://styleguide.mailchimp.com/>
- Canonical markdown source — <https://github.com/mailchimp/content-style-guide>
- License — CC BY-NC 4.0
