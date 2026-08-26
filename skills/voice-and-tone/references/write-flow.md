# Write-time flow

## Determining the context

Ten contexts, fixed. Pick the one the artifact actually lives in:

`marketing-page` · `product-ui` · `system-error` · `help-doc` · `email` ·
`social` · `legal-policy` · `notification` · `support-reply` · `release-notes`

Signals: where will this be rendered, who ships it, and what happens right before
the reader sees it.

## Determining the reader state

Eight states, fixed, and **emotional only**:

`delighted` · `curious` · `focused` · `uncertain` · `confused` · `frustrated` ·
`anxious-at-risk` · `disappointed-leaving`

Funnel stage is not a state. "Considering a purchase" is a context plus a state
(`marketing-page` + `curious`), not a third axis. Mixing the two produces cells
that cannot be composed.

Ask what just happened to the reader:

| What just happened | State |
|---|---|
| Something worked, and it mattered | `delighted` |
| They are browsing, nothing at stake | `curious` |
| Mid-task, wants no interruption | `focused` |
| Considering, missing one fact | `uncertain` |
| Tried, and the result was not what they expected | `confused` |
| Blocked, and suspecting it is our fault | `frustrated` |
| Money, data, or deadline at risk | `anxious-at-risk` |
| Decided to leave, or nearly | `disappointed-leaving` |

Ask the user only when two states would produce genuinely different copy and you
cannot tell which applies.

## Loading, in order

1. `<KB>/CONTEXT.md` - always
2. `<KB>/tone.md` - only the one cell, or the vector tables if interpolating
3. `<KB>/channels/<name>.md` - only if it exists
4. `<KB>/locales/<code>.md` - only if the target is not the primary locale
5. `<KB>/examples/approved.md` - only when you need a calibration sample
6. `<KB>/lexicon.md`, `<KB>/mechanics.md` - only when the compiled card's top
   entries are not enough for the piece at hand

Never load `evidence/ledger.md` while drafting. It is for explaining a rule, not
for applying one.

## Draft frontmatter

Every draft written to `<KB>/.drafts/`:

```markdown
---
generated: 2026-08-26T09:41:00.000Z
profile: default
context: system-error
state: frustrated
cell: T-system-error/frustrated
cell_source: authored
locale: en
kb_version: 0.3.1
---

That file didn't upload - it's over the 25 MB limit. Try a smaller one.
```

Filename: `<ISO-timestamp>-<slug>.md`, colons removed from the timestamp so it is
a legal filename on Windows.

## Reporting

One line, no ceremony:

```
profile default · cell: system-error/frustrated (authored) · locale: en
```

If the cell was interpolated, say so - it tells the user the guide has a gap
worth filling, and it is the moment they are most likely to fill it.
