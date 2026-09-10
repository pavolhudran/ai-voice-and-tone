# Speaker discovery

The discovery pipeline, run for one speaker. Everything here assumes the
house already exists; if it does not, run the house pipeline first.

A speaker is any first-person voice under the house - a person, a team, a
product line, a mascot, an assistant. Two levels, fixed: an overlay sits on
the house and never on another overlay.

## 1. Scaffold and declare

1. One command does the scaffold, the declaration and the inbox:
   `node "<plugin>/scripts/speaker.mjs" --root "<project>" --kb "<KB>" --add <slug> --name "<display name>" [--locale <code>]`
   It copies `<plugin>/templates/kb/profiles/_template/` to
   `<KB>/profiles/<slug>/`, adds the profile under `profiles:` in
   `config.yml` with comments intact, and registers
   `profiles/<slug>/sources/` as the speaker's inbox. Pass `--locale` only
   when the speaker publishes in a language the house does not lead with.
   Say what it did; it is deterministic, so there is no diff to approve.
2. Register each `--from` source under the speaker:
   `node "<plugin>/scripts/sources.mjs" --root "<project>" --kb "<KB>" --add <path|url> --profile <slug>`
   A path inside the knowledge base registers as an `inbox` entry with a
   relative path (config.yml is committed, so it never carries a machine
   path); anything elsewhere on disk is a `local` entry.
3. A document that describes several speakers at once - one tone-of-voice
   file with a section per person - is split first: one file per speaker in
   that speaker's inbox, so each source belongs to exactly one profile. The
   original may be registered once, under the house or under one speaker,
   for provenance.

## 2. Scan, ingest, measure - scoped

```
node "<plugin>/scripts/sources.mjs" --root "<project>" --kb "<KB>" --ingest --profile <slug>
node "<plugin>/scripts/scan.mjs" --root "<project>" --kb "<KB>" --profile <slug>
node "<plugin>/scripts/fingerprint.mjs" --root "<project>" --kb "<KB>" --profile <slug> --set-baseline
```

The corpus is the speaker's material only. Project files are house material
and never enter a speaker's fingerprint. Follow `sourcing.md` for anything
that needs the model tier.

## 3. Draft the overlay

Write into `<KB>/profiles/<slug>/`, never into the house:

- `voice.md`: 3-6 `V` characteristics from the speaker's material. Number
  them from `V1`; they replace the house's unlocked characteristics as a set.
- `tone.md`: one `**Default dials:**` line. That line is the speaker's
  personality in the arithmetic - the interpolator adds (speaker defaults -
  house defaults) to every computed cell. No vector tables; override a
  single row only when the material demands it.
- `lexicon.md`, `mechanics.md`, `audience.md`, `channels/<name>.md`: only
  where the speaker's material contradicts or extends the house. Reuse a
  house ID to override; add new IDs from the next multiple of ten above the
  house's highest for that prefix. Never reuse a locked ID - propose that as
  a `disputed` entry in `evidence/conflicts.md` with `**Profile:** <slug>`
  instead, for `:audit` to raise.
- A rule the house already states is inherited, not re-derived. Say so in
  the ledger entry rather than writing it twice.

Every ledger entry for this speaker carries `**Profile:** <slug>` and a
`Produced:` line, in the single house ledger.

## 4. Interview

Preference pairs on the speaker's own strings, three pairs by default, per
`interview-method.md`. One extra question when another speaker already
exists and shares a candidate rule: **"Which of these should be house rules?"**
Two speakers writing the same rule independently is corroboration for the
house; on a yes, write it to the house file and cite both speakers' evidence.

## 5. Canonize

```
node "<plugin>/scripts/validate.mjs" --root "<project>" --kb "<KB>"
node "<plugin>/scripts/compile-context.mjs" --root "<project>" --kb "<KB>" --profile <slug>
```

Fix every error first. `W_SPEAKER_NO_VOICE` must be gone by now.

Then, if `locks:` is empty in `config.yml`, propose the house's "Never say"
IDs into it and show the diff. A house with speakers and no locks has
guardrails every speaker can override.

Report: rules by confidence on the overlay, cells authored, overrides, and
the report line the applier will print: `profile <slug> · ...`.
