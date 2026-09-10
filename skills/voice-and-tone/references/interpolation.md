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

For a speaker (a profile with an overlay under `<KB>/profiles/<slug>/`), one
more term:

```
speaker_offset       = overlay default dials - house default dials   (per dial)
cell(context, state) = clamp(state_vector[state] + context_offset[context] + speaker_offset, 0, 4)
```

then gates 1 and 2 below, unchanged, in that order. The offset is derived from
the two `**Default dials:**` lines, never authored, so one line in the overlay
shifts the whole matrix. An authored speaker cell is never shifted.
`speakerOffsetOf` and `interpolate` in `scripts/lib/kb.mjs` are the reference
implementation.

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

Both gates are implemented in `scripts/lib/kb.mjs` as pure functions
(`interpolate`, `applyHumorGates`, `resolveCell`), so they cannot be reasoned
past there. **No CLI script resolves a cell for you** - the plugin ships five,
and they are scan, fingerprint, validate, compile-context, and diff. Cell
resolution at write time is yours to do, so do it by reproducing the arithmetic
and the two gates above exactly, in that order; read `scripts/lib/kb.mjs` if you
need the tie-breaks, and never work from memory of a previous session.

## Promotion

A computed cell is marked `interpolated`. On first real use, offer to promote it:

1. Draft the full cell - reader is feeling, dials, do, don't, example
2. Show it to the user
3. On approval, write it to `tone.md` at `confirmed` with a `decision` evidence
   entry naming the cell under `Produced:`

The matrix fills itself along the paths the project actually writes, which is the
only order in which eighty cells ever get authored.
