# Speaker Profiles - Design Spec

**Date:** 2026-09-10
**Status:** draft for review
**Supersedes:** the "Multi-brand UI" item deferred in §14 of
`2026-08-26-voice-and-tone-plugin-design.md`
**Decision:** Proposal C of three - a shared house layer plus one overlay
profile per speaker, with a small set of locked house rules. Proposals A
(personas as tone variants) and B (independent sibling knowledge bases) were
rejected; §13 records why.

---

## 1. Purpose

Today one knowledge base describes one voice. `config.profiles` exists, and
every script accepts `--profile`, but a profile only selects locales and scan
paths. `loadKb()` reads one `voice.md`, one `tone.md`, and one of everything
else, whatever profile is named.

That is enough for a brand that speaks with one voice. It is not enough as
soon as more than one first-person voice writes under the same brand, which
is common: founders and executives posting under their own names, a support
team with its own register, a product line or sub-brand, a mascot, an AI
assistant with a voice deliberately distinct from the marketing site's.

The request that triggered this spec was a company with about fifteen named
ambassadors, each with a personal tone-of-voice document, alongside the
company voice. The sample documents showed the shape any such case shows:
the same handful of house rules restated in every document in slightly
different words, and differences between people that are *voice*, not tone -
one writes only "we", one writes "I tested this myself", one writes a
different regional variant of the language with its own citation style. The
design below is for the shape, not for that company.

The feature therefore has to satisfy three things at once:

1. A speaker owns their voice characteristics, default dials, and examples.
2. The house owns lexicon, mechanics, audiences, channels, locales, and a
   small set of rules no speaker may override.
3. A knowledge base with no speakers behaves exactly as it does today.

### 1.1 Vocabulary

| Term | Means |
|---|---|
| **house** | The shared layer: every file at `<KB>/` root. Also a speaker in its own right - the brand's own voice. |
| **speaker** | Any first-person voice under the house: the brand itself, a named person, a team, a product line, a mascot, an AI assistant. |
| **overlay** | The directory `<KB>/profiles/<slug>/` holding one speaker's own rules. |
| **profile** | A `config.yml` entry. `default` is the house. Every other profile is a speaker and owns one overlay. |
| **locked rule** | A house rule listed under `locks:` in `config.yml`. It applies to every speaker and cannot be overridden. |
| **resolved knowledge base** | House plus one overlay, merged by the rules in §4. What every consumer reads. |

Two levels, fixed. There is no `extends:` key, because there is nothing to
choose: an overlay always sits on the house, and an overlay never sits on
another overlay. A three-level cascade is where "which rule won" stops being
answerable.

### 1.2 Non-goals

- Topics, content pillars, editorial calendars, and regional or market
  focus. Those describe what to write about; this plugin governs how. An
  adopter whose own system carries such fields should hear that they stay
  outside the knowledge base before a demo rather than during one.
- Inheritance between speakers, or speaker groups.
- Publishing, scheduling, or anything after the draft exists.

---

## 2. Layout

```
.voice-and-tone/
  config.yml                 profiles (default + one per speaker), locks, scan, sources, thresholds
  CONTEXT.md                 GENERATED house card - unchanged
  voice.md                   house voice; the brand's own characteristics
  tone.md                    house default dials, state vectors, context offsets, house cells
  audience.md                shared audiences
  lexicon.md                 shared lexicon
  mechanics.md               shared mechanics
  channels/<name>.md         shared channel playbooks
  locales/<code>.md          shared locale packs
  examples/                  house samples
  evidence/
    ledger.md                ONE ledger for house and every speaker; entries carry a Profile field
    sources.json             ONE source index; entries carry a profile field
    fingerprint.json         house fingerprint and baseline - unchanged
    manifest.json            house scan manifest - unchanged
    conflicts.md             shared; entries carry a Profile field
  .drafts/                   shared; frontmatter already records profile
  profiles/
    <slug>/
      CONTEXT.md             GENERATED speaker card
      voice.md               the speaker's characteristics - REPLACES house characteristics (§4.2)
      tone.md                the speaker's default dials and authored cells (§4.3)
      lexicon.md             additions and overrides, merged by ID
      mechanics.md           additions and overrides, merged by ID
      audience.md            additions and overrides, merged by ID
      channels/<name>.md     additions and overrides, merged by ID
      locales/<code>.md      additions and overrides, merged by ID
      examples/              the speaker's approved, rejected, pairs
      evidence/
        fingerprint.json     the speaker's fingerprint and baseline
        manifest.json        the speaker's scan manifest
      sources/               the speaker's inbox, gitignored like the house inbox
```

Every overlay file is optional. A missing overlay file means "inherit
everything". An overlay directory that exists but is empty is a valid speaker
with the house voice, which is the state a speaker is in for the ten seconds
between scaffolding and discovery.

The overlay uses the same file names, the same rule format (§4.3 and §4.4 of
the original spec), and the same parser. Nothing in `kb.mjs`'s parsing changes;
what changes is what happens after two directories have been parsed.

---

## 3. `config.yml`

```yaml
version: 1
kb_version: 0.3.0
profiles:
  default:                      # the house
    name: "Acme"
    primary_locale: en
    locales: [en, de]
  maya:                         # a person; overlay at profiles/maya/
    name: "Maya Lind"
    # primary_locale and locales inherited from default unless set
  helpdesk:                     # a team; overlay at profiles/helpdesk/
    name: "Acme Support"
  bramble:                      # a product line; overlay at profiles/bramble/
    name: "Acme Bramble"
    locales: [en]               # a speaker may narrow or change locales
locks: [V2, L20, L21, L22, M03]        # house rule IDs no speaker may override
scan: ...
sources:
  - id: s01
    kind: local
    path: profiles/maya/sources
    profile: maya               # attributes every file here to the speaker
thresholds: ...
```

Rules:

- `default` is always the house. Renaming it is not supported.
- A profile other than `default` **is** a speaker. Its overlay is
  `profiles/<key>/`. The key is the slug; the directory name must match.
- `locks` is a list of house rule IDs. It lives in config, not in the rule
  files, for one reason: a lock is a governance decision owned by the brand
  team, and one list in one place is auditable in a way that a marker
  scattered across six files is not. `validate` checks every ID in it exists
  in the house.
- `sources[].profile` is optional. Absent means house. The `--profile` flag on
  `sources.mjs` already exists; this field is what makes the attribution
  persist instead of being a per-run argument.
- `version` stays `1`. Every addition here is optional, so an existing
  `config.yml` needs no migration.

---

## 4. Resolution

`kb.mjs` gains one function and every consumer switches to it:

```
resolveKb(kbRoot, profileName = 'default')
  -> house = loadKb(kbRoot)
     if profileName === 'default' or no overlay dir: return house, tagged origin 'house'
     overlay = loadKb(join(kbRoot, 'profiles', profileName))
     merge per §4.2-§4.5
     return { ...merged, house, overlay, profileName, role: 'speaker' }
```

Every rule in a resolved knowledge base carries three extra fields:
`origin` (`house` | `speaker`), `locked` (boolean), and, on a speaker rule that
replaced a house rule, `overrides` (the house rule it replaced).

### 4.1 The precedence line, extended

The plugin's precedence today is: user instruction, project `CLAUDE.md`, the
knowledge base, plugin defaults. It becomes:

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. **Locked house rules**
4. **The speaker overlay**
5. **The house**
6. Plugin defaults

A user instruction still outranks a lock, because it always has. What changes
is what happens next: when a draft written under an instruction breaks a
locked rule, the draft is logged with `lock_override: <id>` in its frontmatter
and `:learn` surfaces it as a `decision` candidate. Locks are meant to be hard
for the *speaker file* to break, not for the person in the room.

### 4.2 Voice - replace as a set, locked rules always apply

If the overlay `voice.md` defines any `V` rule, the house's unlocked `V` rules
are not inherited. A speaker's voice is their own. The house's **locked** `V`
rules are appended after the speaker's, tagged `locked`, and the compiled card
lists them under a "House guardrails" heading rather than among the speaker's
characteristics.

If the overlay `voice.md` defines no `V` rule, the house voice is inherited
whole. That is the state of a freshly scaffolded speaker, and `status`
reports it as gap `G17` (§9.3).

The non-rule sections of `voice.md` - persona rules, self-reference rules, and
what we call readers - merge **per named section**: an overlay section
replaces the house section of the same heading; a section the overlay does not
define is inherited.

"We Are / We Are Not" is generated, as before, from the resolved set.

### 4.3 Tone - one line drives the matrix

The overlay `tone.md` may contain:

- A `**Default dials:**` line. Required for a speaker to have a voice at all;
  its absence is part of `G17`.
- Partial state-vector and context-offset tables. Rows override the house row
  of the same name; absent rows are inherited.
- Authored cells, in the existing §6.4 shape.

**Authored house cells are not inherited.** A cell's Do, Don't, and Example are
written in a voice, and the house's voice is not the speaker's. A speaker
starts with every cell interpolated and promotes cells along the paths they
actually write, exactly as a new knowledge base does today. This is also what
keeps humor gate 1 honest: a speaker can only produce humor through a cell a
human authored *for that speaker*.

Interpolation gains one term. Today:

```
cell(context, state) = clamp(state_vector[state] + context_offset[context], 0, 4)
```

For a speaker:

```
speaker_offset      = overlay default dials - house default dials     (per dial)
cell(context, state) = clamp(state_vector[state] + context_offset[context] + speaker_offset, 0, 4)
```

then gates 1 and 2, unchanged, in that order. The offset is derived, never
authored: a speaker states their defaults in one line and the whole matrix
shifts with them. This is the same shift `audience.md` today asks a writer to
apply by hand for A2 and A3; for speakers it is machine arithmetic because a
speaker is the *only* thing being written, so there is nothing for the
interpolator to silently consume by accident.

`interpolate(stateVector, contextOffset, speakerOffset = {})` in `kb.mjs` is
the one signature change. `resolveCell` passes it through. The
`references/interpolation.md` file, which tells the write skill to reproduce
the arithmetic by hand, gains the third term.

Rejected alternative: require a speaker to re-author all eight state vectors.
Eight rows of six numbers per speaker, times however many speakers, and the
rows are psychology, not personality; they would be copied, then drift.

### 4.4 Lexicon, mechanics, audience, channels, locales - merge by ID

For every table-rule and prose-rule file other than `voice.md`:

- An overlay rule whose ID exists in the house **overrides** that house rule.
  The house rule is dropped from the resolved set; the speaker rule carries
  `overrides: <house rule>`.
- An overlay rule whose ID does not exist in the house is an **addition**.
- An overlay rule whose ID is in `locks` is a **validation error**
  (`E_LOCKED_OVERRIDE`). The resolved set keeps the house rule.
- Two speakers may reuse the same new ID. They are never resolved together.

Speaker additions should use IDs above the house's range by convention
(`L30+`, `M20+`, `C10+`); `validate` warns (`W_ID_RANGE_COLLISION_RISK`) when
a speaker addition sits inside a range the house is still growing into,
because the next house rule would silently turn an addition into an override.

### 4.5 Examples, evidence, drafts

- `examples/` does not merge. The write skill loads the speaker's `approved.md`
  for calibration and falls back to the house's only when the speaker has
  none, and says so.
- `evidence/ledger.md` is one file. Entries gain an optional
  `**Profile:** <slug>` line; absent means house. IDs stay `e<n>`, global,
  never renumbered. This is what keeps retraction bidirectional across
  speakers: `speaker remove` reads every entry with that profile, follows
  `Produced:`, and reopens exactly those rules.
- `evidence/sources.json` entries gain `profile`. `sources.mjs --ingest`
  writes it from `--profile` or from the register entry's `profile` field.
- `evidence/fingerprint.json` and `manifest.json` exist per speaker under the
  overlay, because drift is per speaker: one speaker drifting from their own
  baseline is a different fact from the house drifting from its own.
- `.drafts/` frontmatter already records `profile`. It gains
  `lock_override` (§4.1) when applicable.

### 4.6 Locales

A speaker may declare a locale the house does not - a regional variant, or
a language only that speaker publishes in. The speaker's overlay
`locales/<code>.md` is then the pack. Validation check 5 already
aggregates locales across every declared profile, so a speaker-only locale is
not flagged.

---

## 5. Compiled cards

`compile-context.mjs --profile <slug>` writes `profiles/<slug>/CONTEXT.md`.
Without the flag it writes the house card, byte-identical to today's output
for a knowledge base with no speakers. `:sync` compiles the house and every
speaker.

The speaker card differs from the house card in four places, all within the
existing token budget (`G16`, 900 tokens):

1. **Header line:** `**Brand:** Acme · **Speaker:** Maya Lind (maya) · **Locales:** en, de · ...`
2. **Voice:** the speaker's characteristics, then a `## House guardrails
   (locked)` list. A locked rule shows its `Rules out:` line, since that is
   the part a writer needs.
3. **Lexicon and mechanics:** ranked against the *speaker's* corpus, so the
   most-violated-first ordering reflects what this person actually does.
   Overrides are marked `(overrides house)`.
4. **Where to look next:** points at overlay paths, and adds a row
   `| The house card | ../../CONTEXT.md |`.

---

## 6. Command surface

### 6.1 One new command: `/voice-and-tone:speaker`

```
/voice-and-tone:speaker add <slug> --name "<display name>" [--from <path|url> ...] [--locale <code>]
/voice-and-tone:speaker list
/voice-and-tone:speaker remove <slug>
```

**`add`** runs speaker discovery (§7.1): scaffold the overlay from
`templates/kb/profiles/_template/`, add the profile to `config.yml`, register
`--from` material under the speaker's profile, ingest, fingerprint with
`--set-baseline --profile <slug>`, draft the overlay, interview, canonize.
An existing tone-of-voice document is registered material and its explicit
rules enter at `confirmed`, as today.

**`list`** prints one line per speaker: slug, name, voice rules, authored
cells, overrides, drafts pending. It is `status --panel speakers` without the
frame, and it is read-only.

**`remove`** is the retraction path: reopen every rule produced by evidence
tagged with the profile, delete the overlay, delete the config entry, and
remove the speaker's register entries. Every step is a proposed diff, approved
individually, per the maintenance skill's governing rule.

Invokes: `voice-discovery` (add), `voice-observability` (list),
`voice-maintenance` (remove).

### 6.2 Existing commands gain `--profile <slug>`

| Command | Change |
|---|---|
| `write`, `rewrite`, `localize` | `--profile <slug>` selects the speaker. Already listed in `write.md` as "select a brand in a multi-brand project"; now implemented. Natural language "write this as Maya" resolves to the profile whose `name` matches. |
| `review` | `--profile <slug>`. Findings print origin: `L03 (house)`, `L31 (maya)`, `M07 (maya, overrides house)`, `L20 (house, locked)`. |
| `status` | `--profile <slug>` shows that speaker's resolved state. Without it, the house view gains a `speakers` panel. `--artifact` per speaker writes `.drafts/status-<slug>.html`. See §9. |
| `sync` | Validates and compiles the house and every speaker. `--profile <slug>` limits to one. |
| `audit` | `--profile <slug>` audits one speaker. Without it, the house audit gains a fifth section, "Speakers" (§7.3). |
| `learn` | No flag. The draft's frontmatter names the profile, and that decides where a proposed rule lands (§7.2). |
| `connect` | `--profile <slug>` on register and ingest, persisted into the register entry. |
| `init` | Unchanged. Creates the house. Mentions `speaker add` in its closing report when the conversation has named more than one first-person voice. |

A default speaker for a session can be set in the project's `CLAUDE.md`
(`voice-and-tone: default profile maya`); precedence level 2 already covers
it, so nothing new is needed in the plugin beyond documenting the line.

### 6.3 No other new commands

`house` is not a command; the house is `default`. `lock` is not a command;
locks are a list in `config.yml`, edited through `:sync` proposals or by hand.

---

## 7. Skills

No new skill. Five existing skills and the agent change.

### 7.1 `voice-discovery` - a speaker path

New reference `references/speaker-discovery.md`. The pipeline is the existing
one with these differences:

- Templates come from `templates/kb/profiles/_template/`, not `templates/kb/`.
- Scan and fingerprint run with `--profile <slug>`, so the corpus is the
  speaker's registered material only - their posts, their tone document.
- The draft step writes to the overlay. It drafts `V` rules and a
  `**Default dials:**` line from the speaker's material, and lexicon or
  mechanics rules only where the speaker's material contradicts or extends
  the house. A rule the house already states is not re-derived; it is
  inherited and the ledger says so.
- The draft step proposes any house rule the speaker's material appears to
  break as a candidate override, shown against the house rule, and refuses
  to propose one against a locked rule: that surfaces as a `disputed` entry
  in `conflicts.md` with the profile field set, for `:audit` to raise.
- The interview uses preference pairs on the **speaker's own** strings, three
  pairs by default, and adds one question the house interview never asks:
  "Which of these should be house rules?" for any candidate the speaker's
  material shares with a second, already-discovered speaker. Two speakers
  writing the same rule independently is corroboration for the house.
- Canonize compiles the speaker card.

Also: when the conversation has named more than one first-person voice -
founders, executives, ambassadors, authors, a support team, a product line, a
mascot, an assistant - the skill offers `speaker add` at the end of `init`
and proposes the house's "Never say" IDs into `locks`.

### 7.2 `voice-maintenance` - where a correction lands

**`:learn`.** The draft's frontmatter names the profile. A correction to a
speaker draft becomes a `correction` ledger entry with that profile and, on
corroboration, a rule in the **overlay**. Two additional cases:

- If the corrected rule is a house rule and the same correction is
  corroborated across drafts from **two or more speakers**, propose it at the
  house level instead, and say why.
- If the correction contradicts a locked rule, record the evidence, propose
  nothing, and name the lock. Changing a lock is an `:audit` decision.

**`:audit`.** A fifth section, "Speakers", in the house audit: one row per
speaker with override count, lock conflicts, drift flag, cells authored, and
days since last draft. It ends with a third question alongside the existing
two: for each candidate override, **override, or house rule?**

**`:sync`.** Validates the house and every overlay resolved, compiles every
card, bumps once. Version semantics: **major** when house voice characteristics
or `locks` change; **minor** when a speaker is added or removed, or cells or
rules are added anywhere; **patch** for wording and examples.

### 7.3 `voice-and-tone` and `microcopy` - the applier

- Step 1 loads `profiles/<slug>/CONTEXT.md` when a speaker is resolved, else
  the house card. Speaker resolution order: `--profile`, then "as <name>" in
  the request, then `CLAUDE.md`'s default profile, then house.
- Step 3 loads the speaker's cell or interpolates with the speaker offset.
- Step 4 loads the resolved channel playbook and locale pack.
- Step 5, calibration sample: the speaker's `examples/approved.md`, falling
  back to the house's with a note.
- Step 6, self-check: locked rules are checked explicitly and named in the
  report line if the user instruction forced a break.
- Step 8, report line: `profile maya · cell: social/curious (interpolated,
  speaker offset applied) · locale: en`.

`microcopy` changes only in passing the profile through.

### 7.4 `voice-review` - origin and locks

- Every finding names the rule's origin (§6.2).
- **A locked rule broken is always a Blocker**, whatever the rule's
  confidence. `references/severity.md` gains this as a third "always
  Blocker" row beside accessibility and non-inclusive language. The reasoning
  is the same as for `confirmed`: a lock is the brand team's explicit
  instruction.
- Reviewing a speaker's text without `--profile` and without a draft
  frontmatter reviews it against the house, and the report's first line says
  so, because the most likely mistake is reviewing a speaker against the
  house and filing their voice as violations.

### 7.5 `voice-observability`

Gains the `speakers` panel and the `--profile` flag. Its prohibitions are
unchanged: it draws nothing, restates nothing. §9 has the detail.

### 7.6 `voice-critic` agent - the speaker read-back

The read-back test asks the critic to name the context and reader state from
the bare draft. When the knowledge base has two or more speakers, turn 1 also
asks: **which speaker wrote this?** The critic is given the list of speaker
names and each speaker's `voice.md` path, nothing else. A wrong guess is a
finding: the draft is not distinguishably that speaker. This is the test a
multi-speaker knowledge base actually needs - several speakers who all sound
like the house is the failure mode - and it costs one extra line in the
first-turn prompt.

Turn 2 hands the critic the resolved speaker card and overlay paths, as it
hands the house paths today.

---

## 8. Scripts and validation

### 8.1 Touched modules

| Module | Change |
|---|---|
| `lib/kb.mjs` | `resolveKb()`; `interpolate()` third term; rule fields `origin`, `locked`, `overrides`. `loadKb()` unchanged. |
| `lib/config.mjs` | `locks` default `[]`; `speakerProfiles(config)` helper; `overlayRoot(kbRoot, slug)`. |
| `compile-context.mjs` | Reads a resolved knowledge base; speaker header, guardrails section, override marks, overlay output path. |
| `validate.mjs` | New checks (§8.2). Validates the house, then each overlay resolved. |
| `scan.mjs`, `fingerprint.mjs` | Output path is the overlay's `evidence/` when `--profile` is a speaker. |
| `sources.mjs` | Persists `profile` on register entries and index entries; `--check` and `--ingest` filter by it. |
| `lib/state.mjs` | `role`, `locks`, `speakers[]`, `speaker{}` blocks (§9.1). |
| `lib/gaps.mjs` | `G17`-`G21` (§9.3). |
| `lib/render.mjs` | `speakers` panel; header, rules, settings, missing panels read the new blocks. |
| `lib/html.mjs` | Speakers section; hero chip; origin split in the confidence section. |
| `status.mjs` | `--profile` selects a speaker; `--artifact` path per speaker. |
| `templates/kb/profiles/_template/` | New. Overlay skeleton. |
| `templates/kb/config.yml` | Adds a commented `locks: []` line. |

### 8.2 New validation codes

| Code | Level | Fires when |
|---|---|---|
| `E_LOCKED_OVERRIDE` | error | an overlay rule reuses the ID of a locked house rule |
| `E_UNKNOWN_LOCK` | error | `locks` names an ID the house does not define |
| `E_OVERLAY_DIR_MISMATCH` | error | a speaker profile exists in config with no `profiles/<slug>/` directory, or the reverse |
| `W_SPEAKER_NO_VOICE` | warning | an overlay defines no `V` rule and no default dials; the speaker is the house in a costume |
| `W_ID_RANGE_COLLISION_RISK` | warning | §4.4 |
| `W_OVERRIDE_UNEVIDENCED` | warning | an overlay override cites no evidence; replacing a house rule is a claim that needs one |

Existing checks run unchanged over the house and over each resolved speaker;
messages on overlay findings name the speaker, so `E_HUMOR_GATE` on
`profiles/maya/tone.md` reads as that speaker's error, not the house's.
`E_DUPLICATE_ID` is evaluated per directory, not across the merge; an ID that
appears in both is an override, not a duplicate.

### 8.3 Backward compatibility, asserted

A knowledge base with no `profiles/` directory and no `locks` key must produce,
for `compile-context`, `validate`, and `status` (both renderers and `--json`):
byte-identical output to the current release. `test/conformance.test.mjs`
gains this as a golden test over the shipped template and over a fixture copy
of the Vivido knowledge base.

---

## 9. Observability

### 9.1 The state object

`collect()` gains:

```
kb.role        'house' | 'speaker'
kb.speaker     { slug, name } when role is speaker
locks          { declared: [...], violated: [...] }
speakers       house view only: one entry per declared speaker -
               { slug, name, voiceRules, authoredCells, overrides, lockViolations,
                 corpusWords, fingerprintAgeDays, driftFlagged, draftsPending,
                 sourcesNeverIngested, cardStale }
```

In a speaker view every existing block - `coverage`, `rules`, `drift`,
`sources`, `evidence`, `corpus`, `freshness`, `integrity` - is computed over
the **resolved** speaker knowledge base and the **speaker's** fingerprint,
manifest, and register entries. `rules` additionally splits
`byOrigin: { house, speaker, overrides, locked }`.

Both renderers still read one state object. That invariant is the reason the
artifact and the screen cannot disagree, and it holds here: nothing in §9.2
or §9.4 re-derives a number.

### 9.2 The ASCII dashboard

**Header.** Right-hand side becomes `Acme | house | kb 0.3.0 | en,de` for the
house and `Acme | maya (speaker) | kb 0.3.0 | en,de` under `--profile`.

**New panel `speakers`**, house view only, tenth in the menu:

```
+- SPEAKERS  4 declared ---------------------------------------------------+
|   slug        name              voice  cells  over  lock  drift  drafts   |
|   maya        Maya Lind           6      3      2     -    ok      1      |
|   jonas       Jonas Berg          6      1      0     -    n/a     0      |
|   helpdesk    Acme Support        5      0      1     1!   FLAG    0      |
|   bramble     Acme Bramble        4      2      3     -    ok      2      |
+--------------------------------------------------------------------------+
```

`n/a` means no baseline, as in the drift panel. `!` in the lock column is a
validation error and appears in `integrity` too.

**Existing panels under `--profile <slug>`:**

- `coverage` - the speaker's matrix. Every cell is `.` on a new speaker; that
  is not a gap, and the note beneath says "speaker offset applied".
- `rules` - adds one line: `origin: house 31 · speaker 12 · overrides 2 · locked 6`.
- `drift` - the speaker's fingerprint against the speaker's baseline.
- `sources` - filtered to the speaker's register entries.
- `evidence` - drafts filtered to the profile.
- `settings` - `profile` line reads `maya  "Maya Lind"  speaker of Acme`; a new `locks` line lists the declared IDs.
- `missing` - gaps for this speaker only.

**`missing` in the house view** aggregates speaker gaps with a `[slug]`
prefix, still capped at ten, still ranked by leverage then severity.

### 9.3 Gap detectors

| ID | Fires when | Sev | Lev | Fix |
|---|---|---|---|---|
| `G17` | a speaker has no `V` rule or no default dials | blocker | 4 | `/voice-and-tone:speaker add <slug>` (finish discovery) |
| `G18` | a speaker has no drift baseline | blocker | 3 | `fingerprint.mjs --set-baseline --profile <slug>` |
| `G19` | a speaker's registered material was never ingested | blocker | 3 | `/voice-and-tone:connect --ingest --profile <slug>` |
| `G20` | a speaker card is older than a file it compiles from, house files included | warning | 3 | `/voice-and-tone:sync --profile <slug>` |
| `G21` | the house has speakers and `locks` is empty | warning | 3 | add `locks` to `config.yml`, then `/voice-and-tone:sync` |

`G21` is the one genuinely new judgement: a house with speakers and no locks
has guardrails that every speaker can override, which is usually not what the
brand team believes they have. It fires once, at house level.

Lock violations are not a separate gap; they are validation errors and `G02`
already owns those.

**Deliberately not a gap:** a speaker whose every cell is computed (same
reason as the house); a speaker with zero overrides (inheriting everything is
the expected starting state); a speaker whose voice resembles another's (that
is the critic's read-back finding, per draft, not a static property the state
object can assert).

### 9.4 The artifact

`status.mjs --artifact` writes `.drafts/status.html` for the house, as today,
and `.drafts/status-<slug>.html` under `--profile <slug>`. Distinct paths are
deliberate: the Artifact tool maps a path to a URL, so the house page and each
speaker page keep stable, separate links across republishes.

Changes to `html.mjs`, all reading §9.1:

- **Hero.** House view: unchanged headline, plus a spec chip `speakers 4`.
  Speaker view: `<h1>` is the brand, the eyebrow reads "speaking as Maya
  Lind", and the headline uses the speaker's numbers.
- **Attention.** Gap rows carry the `[slug]` prefix in the house view, and a
  speaker page shows only its own.
- **New section "Speakers"**, house view only, after Pipeline: one row per
  speaker with the §9.2 columns, a `FLAG` or `n/a` drift mark using the
  existing status colours, and a short lede: "Each speaker inherits the house
  and replaces its voice."
- **Confidence section.** A second small table, origin split, in the speaker
  view.
- **Settings.** Locks listed as inline code, after the locale packs line.

No new styles beyond the existing status set; the yellow band, the type, and
the light-only decision from the observability spec stand.

---

## 10. Templates

`templates/kb/profiles/_template/`:

```
voice.md        heading, one commented example V rule, empty persona and self-reference sections
tone.md         a commented "Default dials:" line and an empty "Authored cells" section;
                NO vector tables - they are inherited, and a copied table would drift
lexicon.md      table headers only, with a comment stating the ID range convention
mechanics.md    table headers only
audience.md     empty
channels/       empty, with the existing channels/_template.md copied in
examples/       approved.md, rejected.md, pairs.md headers
evidence/       empty; fingerprint and manifest are written by the scripts
sources/        README.md explaining the inbox is the speaker's, gitignored
```

`templates/kb/gitignore` gains `profiles/*/sources/` and
`profiles/*/CONTEXT.md` is **not** ignored: the speaker card is an artifact,
committed like the house card.

---

## 11. Mapping the inputs adopters bring

The material an adopter arrives with is rarely shaped like this knowledge
base. These are the shapes seen so far and where each lands. The mapping is
guidance for the discovery skill, not a schema: any input that states a rule
about *how* something is written has a home here, and any input that states
*what* to write about does not.

| Input | Lands in |
|---|---|
| A company style guide, brand book, or tone-of-voice document | the house |
| The brand's own public voice (a company page, the marketing site, an official account) | the house `voice.md`. Recommendation: the house is a speaker. A faceless house with every voice in an overlay adds a directory for no gain. |
| A personal or team tone-of-voice document | `profiles/<slug>/voice.md` and the default dials line |
| Phrases to use and to avoid, per speaker | `profiles/<slug>/lexicon.md` |
| Post or message structure, formatting, and engagement rules for one channel | `profiles/<slug>/channels/<channel>.md`, over a house `channels/<channel>.md` |
| Audiences a speaker addresses that the house does not | `profiles/<slug>/audience.md` |
| Good and bad examples, per speaker | `profiles/<slug>/examples/approved.md`, `rejected.md` |
| A spelling variant, citation style, or typographic habit specific to one speaker | a speaker locale pack, or a mechanics rule in the overlay |
| Rules that recur across several speakers' documents | house rules, and candidates for `locks` |
| Topics, pillars, calendars, markets, performance metrics | out of scope (§1.2) |

---

## 12. Testing

New or extended tests, one file each where the module is new:

- `kb.test.mjs` - `resolveKb`: no overlay is identity; override by ID;
  addition; voice replaced as a set; locked `V` appended; locked override
  rejected; per-section merge of `voice.md` prose; `interpolate` with offset,
  clamped, gates still last.
- `validate.test.mjs` - every code in §8.2, and `E_DUPLICATE_ID` not firing
  across the merge.
- `compile-context.test.mjs` - speaker card golden; house card unchanged.
- `state.test.mjs`, `gaps.test.mjs` - `speakers` block, `byOrigin`,
  `G17`-`G21`, the three deliberate non-gaps.
- `render.test.mjs`, `html.test.mjs` - `speakers` panel and section goldens;
  house output unchanged with no speakers.
- `sources.test.mjs` - `profile` persisted on register and index entries;
  filtering.
- `conformance.test.mjs` - §8.3, the byte-identity guarantee.
- A fixture knowledge base `test/fixtures/house-with-speakers/` with a house
  and two speakers, one of which overrides a locked rule on purpose.

---

## 13. Alternatives rejected

**A. Personas as tone variants in one knowledge base.** A `personas.md` of
dial shifts and phrase lists, like the A2 and A3 audience shifts. Cheapest;
touches no loader. Rejected because the differences between speakers are
voice, not tone: a dial shift cannot express "we" versus "I", and a review finding could
not say whose rule it cites. Precedents: HubSpot's per-channel tone override,
Grammarly's per-group tone profile.

**B. Independent sibling knowledge bases.** Each speaker a full `profiles/`
copy; `--profile` selects a directory; no precedence logic. Rejected because
every shared rule would be copied once per speaker and drift, `:learn` could
not propagate a house correction, and there would be no way to ask whether a
speaker's post is also on-brand for the house. Even the tools that use this
model (Writer, Jasper, Acrolinx) share the style guide and terms by linking
rather than copying.

**C, as specified.** The pattern every product that handles people under one
company converges on: a non-overridable company layer and a personal delivery
layer on top (DSMN8, Oktopost), with an explicit exception mechanism (Intuit's
one named exception to its shared AI voice). No shipping product does
trait-level inheritance for voice, which is why voice replaces as a set here
rather than merging.

---

## 14. Open questions for review

1. **The brand's own public voice as the house, or as a speaker?** §11 recommends the house.
2. **Locks in `config.yml`, or a marker in the rule files?** §3 chooses config
   for governance reasons. The cost is that a reader of `lexicon.md` cannot
   see a lock without opening config; the compiled card shows it, which is
   where writers look.
3. **Speaker offset arithmetic (§4.3), or re-authored vectors?** Offset is
   chosen. It is the one place this spec adds arithmetic to the interpolator.
4. **Speaker read-back in the critic (§7.6):** keep, or defer to a second
   release? It is cheap and it is the test a multi-speaker setup needs, so it is in.
5. **`speaker remove` deleting the overlay** versus archiving it under
   `profiles/_retired/`. Deleting is proposed; the ledger keeps the evidence
   either way.

---

## 15. Sequencing

For the implementation plan, in dependency order:

1. `kb.mjs` resolve, locks, interpolate offset; `config.mjs` helpers; tests.
2. `validate.mjs` checks; fixture knowledge base.
3. `compile-context.mjs` per profile; conformance golden.
4. `sources.mjs`, `scan.mjs`, `fingerprint.mjs` profile paths and persistence.
5. `state.mjs`, `gaps.mjs`, `render.mjs`, `html.mjs`, `status.mjs`.
6. Templates and the `speaker` command; `speaker-discovery.md`.
7. Skill and agent edits; `severity.md`, `interpolation.md`, `write-flow.md`,
   `panels.md`, `gap-catalogue.md`; command docs; README; CHANGELOG.
