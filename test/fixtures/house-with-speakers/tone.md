# Tone

Tone flexes with the reader's emotional state. Voice does not.

**Default dials:** warmth 3 · humor 0 · directness 3 · detail 2 · urgency 2 · formality 2

Dials are integers 0-4. A cell is `state_vector + context_offset`, clamped to 0-4.

## Humor gates

1. Humor requires an **authored** cell. An interpolated cell never carries humor,
   whatever the arithmetic yields.
2. `frustrated`, `anxious-at-risk`, and `disappointed-leaving` force `humor 0`
   regardless of dial values, in authored cells too.

## State vectors

The `humor` column here and in the context offsets below is **authored-cell
reference only**. Gate 1 zeroes humor on every interpolated cell, so no
arithmetic over these two tables can ever produce a nonzero humor dial. The
numbers say what humor would be worth in a cell a human has written and
approved - they are not an input the interpolator reads.

| State | warmth | humor | directness | detail | urgency | formality |
|---|---|---|---|---|---|---|
| delighted | 4 | 3 | 2 | 1 | 1 | 1 |
| curious | 3 | 2 | 3 | 3 | 1 | 2 |
| focused | 2 | 1 | 4 | 2 | 2 | 2 |
| uncertain | 3 | 1 | 4 | 3 | 1 | 2 |
| confused | 3 | 1 | 4 | 4 | 2 | 2 |
| frustrated | 2 | 0 | 4 | 3 | 2 | 2 |
| anxious-at-risk | 3 | 0 | 4 | 3 | 3 | 3 |
| disappointed-leaving | 3 | 0 | 4 | 2 | 1 | 3 |

## Context offsets

`humor` is authored-cell reference only here too - see the note above.

| Context | warmth | humor | directness | detail | urgency | formality |
|---|---|---|---|---|---|---|
| marketing-page | 1 | 1 | 0 | -1 | 1 | -1 |
| product-ui | 0 | 0 | 1 | -1 | 0 | 0 |
| system-error | -1 | -2 | 1 | 0 | 0 | 0 |
| help-doc | 0 | -1 | 1 | 2 | -1 | 0 |
| email | 1 | 0 | 0 | 0 | 0 | 0 |
| social | 1 | 2 | 0 | -2 | 0 | -2 |
| legal-policy | -1 | -2 | 1 | 2 | -1 | 2 |
| notification | 0 | 0 | 1 | -2 | 1 | 0 |
| support-reply | 1 | -1 | 1 | 1 | 0 | 0 |
| release-notes | 0 | 0 | 1 | 1 | -1 | 0 |

## Authored cells

Cells are promoted here on first real use: the model drafts the full cell, the
user approves it, and it becomes `confirmed`. The matrix fills itself along the
paths actually written.

<!--
Copy this shape for a new cell:

### T-system-error/frustrated   `confirmed`  ev: e12

**Reader is feeling:** blocked, and suspecting it is our fault
**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2
**Do:** say what happened · say what to do next · own it if it is ours
**Don't:** joke · apologize twice · imply they did it wrong
**Example:** *"That file didn't upload - it's over the 25 MB limit. Try a smaller one."*
-->

### T-social/curious   `confirmed`  ev: e1

**Reader is feeling:** browsing
**Dials:** warmth 4 · humor 2 · directness 3 · detail 1 · urgency 1 · formality 0
**Do:** one idea
**Don't:** stack claims
**Example:** *"One thing worth knowing."*
