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

## Telling word swap from tone shift

This is the pairing that matters most, because word swap is the one class that
skips corroboration entirely. A single-word replacement can be either class,
and only a genuine word swap fires immediately - a tone shift that happens to
be expressed through one word is still corroboration-gated, same as any other
dial move.

**Test:** would the original word, standing alone, name a feeling, an emphasis
level, or a formality register - the kind of word a thesaurus groups by *how
warm or formal it sounds*, not by *what it means*? If yes, it is a tone shift.
If the two words are interchangeable in warmth and formality and differ only in
whether one is jargon, technical terminology, or a stock phrase - same
register, only the plainness changed - it is a genuine word swap.

- `leverage` -> `use`: same warmth, same formality, same register. The only
  difference is that one is corporate jargon. **Word swap** - fires
  immediately.
- `excited` -> `pleased`: same shape as the swap above - one word in, one word
  out - but `excited` and `pleased` sit at different points on the warmth
  dial. Swapping one for the other is not jargon removal, it is cooling the
  copy down. **Tone shift wearing a word-swap disguise** - corroboration-gated.

When in doubt, ask whether the correction would still make sense as a
`<KB>/lexicon.md` entry on its own, with no dial attached. `leverage -> use`
does. `excited -> pleased` does not - "excited" is not wrong or non-standard,
this piece just wanted a calmer register.

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
