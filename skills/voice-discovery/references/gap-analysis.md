# Gap analysis

## The rule

The questionnaire is computed, never canned. A slot that the corpus answers is
not asked about. A slot whose answer unlocks five other slots is asked first.

## Slot inventory

| Slot | File | Fills from corpus? | Leverage |
|---|---|---|---|
| Voice characteristics | `voice.md` | partly - rhythm, register | **high** - drives We Are/We Are Not, lexicon, every cell |
| Persona rules | `voice.md` | no | low unless a mascot exists |
| Self-reference | `voice.md` | yes - name casing is countable | medium |
| Audience segments | `audience.md` | rarely | **high** - state axis depends on it |
| Default dials | `tone.md` | yes - formality, detail, exclamation rate | **high** |
| State vectors | `tone.md` | no | medium - defaults ship usable |
| Context offsets | `tone.md` | partly - per-channel corpora differ | medium |
| Lexicon: avoid | `lexicon.md` | yes - frequency plus an off-brand check | medium |
| Lexicon: never say | `lexicon.md` | no | medium - small but absolute |
| Mechanics | `mechanics.md` | yes - most are countable | low individually |
| Locale register | `locales/*.md` | sometimes | **high** per locale |
| Locale typography | `locales/*.md` | seeded mechanically | none - never ask |

## Ranking

1. Compute leverage: how many other slots the answer would resolve or constrain.
2. Drop every slot already at `confirmed`.
3. Drop every slot at `derived` with no contradicting evidence.
4. Raise every slot appearing in `evidence/conflicts.md` - a `disputed` slot is
   asked with **both sides shown**, because the conflict is information.
5. Ask in leverage order, 4 per round.

## Turning a gap into a question

| Gap kind | Question shape |
|---|---|
| A dial has no evidence | preference pair on a real string that varies that dial |
| A lexicon candidate is frequent but unjudged | "you use X often - keep it, or swap it?" |
| Two sources disagree | show both, ask whether it is a channel split or drift |
| A slot has no corpus at all | open question, adjective-style, clearly labelled as such |
