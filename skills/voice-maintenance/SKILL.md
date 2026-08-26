---
name: voice-maintenance
description: >
  WHEN: the user edited copy the plugin produced, wants the knowledge base
  updated from corrections, asks how healthy or current the voice guide is, wants
  to retire or change a rule, or needs the compiled card rebuilt.
  WHAT: captures corrections as evidence and promotes them to rules only on
  corroboration, audits coverage, drift, and rule health, and recompiles and
  validates the knowledge base.
  TRIGGERS: 'learn from my edits', 'update the voice guide', 'audit our voice',
  'is this rule still right', 'rebuild CONTEXT.md', 'sync the knowledge base'.
---

# Voice maintenance

A guide that cannot change is a guide that gets ignored. A guide that changes on
one person's Tuesday is worse.

> Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated
> with or endorsed by Mailchimp.

## Precedence

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

## The rule that governs all three commands

**Every write is a proposed diff.** Show the change, show the evidence behind it,
get approval on each item separately, then write. Never silently edit the
knowledge base - not even to fix something obviously wrong. Especially not then.

---

## `:learn` - corrections become rules

1. Find the draft in `<KB>/.drafts/`. Read its frontmatter for cell, profile,
   locale, and kb_version.
2. Get mechanical ground truth:

   ```
   node "<plugin>/scripts/diff.mjs" --draft "<draft>" --final "<final>" --kb "<KB>"
   ```

   The script reports word-level changes, length shift, and single-word swaps. It
   does **not** classify them - that is your job, and the division is deliberate.

3. Classify every edit per `references/correction-classes.md`.
4. Write each edit to `<KB>/evidence/ledger.md` as a `correction` entry and to
   `<KB>/examples/pairs.md`. **This happens whether or not a rule follows.**
5. Apply the corroboration threshold.
6. Propose only what cleared it, each with its diffs shown as evidence.

### Corroboration

A single edit is recorded as evidence and does **not** create a rule. Promotion
requires `thresholds.corroboration` (default 2) **independent** corrections
pointing the same way.

**Independent means from different drafts** - not different lines within one
draft. One editing pass reflects one mood, and three changes in it are one
opinion, not three.

**The one exception:** an unambiguous lexicon swap fires immediately. If a user
changes `leverage` to `use`, there is nothing to corroborate.

A single-word replacement is not automatically unambiguous. Before firing the
exception, apply the "Telling word swap from tone shift" test in
`references/correction-classes.md` - a word that carries its own warmth or
formality (`excited` -> `pleased`) is a tone shift wearing a word-swap
disguise, and stays corroboration-gated.

Without this threshold the knowledge base overfits to a single editing session
and begins confidently enforcing an accidental preference - which is worse than
having no rule, because now it blocks.

### Retraction

When the user says "ignore the 2024 newsletters, we've changed", do not guess.
Find the evidence entries for that source, read their `Produced:` lines, and
reopen exactly those rules. That is what bidirectional evidence is for.

---

## `:audit` - health and drift

Follow `references/audit-report.md`. Four sections, in this order:

1. **Coverage** - authored cells versus interpolated, per context
2. **Drift** - current fingerprint against the baseline captured at init
3. **Rule health** - dead, overridden, stale, disputed
4. **Inventory** - scored findings across the scanned corpus

Refresh the numbers first:

```
node "<plugin>/scripts/scan.mjs" --root "<project>" --kb "<KB>"
node "<plugin>/scripts/fingerprint.mjs" --root "<project>" --kb "<KB>"
node "<plugin>/scripts/validate.mjs" --kb "<KB>"
```

Do **not** pass `--set-baseline` here. The baseline is the point of comparison; a
refreshed baseline shows zero drift by construction and tells you nothing.

End by asking the two questions the report exists to raise:
- For each overridden rule: **enforce it, or retire it?** A rule broken every time
  and kept anyway is not a rule.
- For each `disputed` entry: **channel split, or drift?**

---

## `:sync` - recompile and validate

1. `node "<plugin>/scripts/validate.mjs" --kb "<KB>"` - fix every error first
2. `node "<plugin>/scripts/compile-context.mjs" --root "<project>" --kb "<KB>"`
3. Bump `kb_version` in `<KB>/config.yml`:
   - **major** - voice characteristics changed
   - **minor** - cells or rules added
   - **patch** - examples, evidence, wording
4. Append to `<KB>/CHANGELOG.md`: version, date, what changed, which evidence
   entries drove it
5. Prune `<KB>/.drafts/` entries older than 90 days

`CONTEXT.md` is generated. If a user has hand-edited it, their changes are lost on
the next sync - that is the design, not a bug. It is why the file carries a
generated-file banner. If they want the change kept, it belongs in the source file
the card compiles from.
