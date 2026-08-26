# Correction classes

`scripts/diff.mjs` gives mechanical ground truth: which words changed, how the
length shifted, which single-word swaps happened. Classification is yours. The
script never classifies and you never re-derive the mechanics by eye.

| Class | What it looks like | Becomes |
|---|---|---|
| **word swap** | one word consistently replaced by another | a proposed lexicon row |
| **tone shift** | register, warmth, or directness moved across the piece | a dial adjustment on that cell |
| **structural** | sentences split, merged, reordered; a list became prose | a mechanics or rhythm rule |
| **formatting** | casing, punctuation, emphasis, heading style | a mechanics rule |
| **factual** | a number, name, date, or claim corrected | **ignored** |

## Why factual edits are ignored

They are not style signals. A user fixing "25 MB" to "20 MB" is telling you the
limit changed, not that the voice is wrong. Learning from them would fill the
lexicon with product facts and start enforcing them as style, which then blocks
correct copy the next time the fact changes.

Record the edit as evidence so the chain is complete. Propose nothing.

## Telling tone shift from structural

They overlap, and it matters because they produce different rules.

- If the **dials** would have to change to produce the new text, it is a tone
  shift. Ask: which dial, which direction, how far?
- If the dials would produce the new text fine and only the **arrangement**
  changed, it is structural.

When genuinely both, record both, and let corroboration decide which survives.

## Threshold, restated

Two independent corrections, from **different drafts**, pointing the same way.
Lexicon swaps are exempt and fire immediately.

Three changes inside one editing pass are one data point, not three. This is the
single rule that keeps the knowledge base from overfitting to one afternoon.

## Proposal format

```markdown
**Proposed: L14** `leverage` -> `use`   (lexicon swap, immediate)

Evidence:
  e51  2026-08-14  draft 2026-08-14-error-upload.md   "leverage" -> "use"

Accept / reject / edit?
```

```markdown
**Proposed: dial change on T-email/curious** - detail 2 -> 3

Evidence:
  e52  2026-08-14  draft 2026-08-14-welcome.md    +34 words, 2 sentences split
  e58  2026-08-21  draft 2026-08-21-winback.md    +41 words, 1 example added

Two independent corrections, different drafts, same direction.

Accept / reject / edit?
```

One proposal per item. Never batch them behind a single yes.
