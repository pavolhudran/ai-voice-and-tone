# Interpolation

## Why

Ten contexts times eight states is eighty cells. Eighty cells is not authorable,
and a guide nobody finishes is a guide nobody uses. So the knowledge base stores
eight state vectors and ten context offsets, and computes the rest.

```
cell(context, state) = clamp(state_vector[state] + context_offset[context], 0, 4)
```

Applied to each of the six dials in turn. An authored cell overrides the
computation completely - it is not blended.

## The dials

Six, integer 0-4, displayed as words rather than numbers when talking to the user:

| Dial | 0 | 4 |
|---|---|---|
| warmth | clinical | warm |
| humor | straight-faced | playful |
| directness | cushioned | blunt |
| detail | terse | thorough |
| urgency | relaxed | act now |
| formality | casual | formal |

`enthusiasm` is deliberately **not** a dial - it conflates warmth and urgency, and
a conflated dial cannot be set correctly.

## The gates

**Gate 1 - humor requires an authored cell.** A computed cell never carries
humor, whatever the arithmetic yields. If the sum says `humor 3`, the answer is
still `0` until a human has written that cell and approved it. This is why a
knowledge base with no authored cells at all computes a neutral `humor 0` -
never the neutral `2` every other dial defaults to.

**Gate 2 - three states force humor 0**, in authored cells too:
`frustrated`, `anxious-at-risk`, `disappointed-leaving`.

Both gates are implemented in `scripts/lib/kb.mjs` as pure functions, so they
cannot be reasoned past. Do not reimplement them from memory - resolve the cell
through the code path or reproduce it exactly.

## Promotion

A computed cell is marked `interpolated`. On first real use, offer to promote it:

1. Draft the full cell - reader is feeling, dials, do, don't, example
2. Show it to the user
3. On approval, write it to `tone.md` at `confirmed` with a `decision` evidence
   entry naming the cell under `Produced:`

The matrix fills itself along the paths the project actually writes, which is the
only order in which eighty cells ever get authored.
