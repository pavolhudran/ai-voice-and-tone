---
name: voice-and-tone
description: >
  WHEN: writing, drafting, or rewriting any user-facing text - marketing pages,
  product UI, error messages, help docs, emails, social posts, notifications,
  release notes, support replies - or when asked to make existing copy sound like
  the brand. WHAT: loads the project's compiled voice card, resolves the tone cell
  for the reader's emotional state and the context, drafts inside those dials, and
  applies accessibility and translation-readiness as always-on layers.
  TRIGGERS: 'write this', 'draft a', 'make this sound like us', 'in our voice',
  'on-brand copy', 'rewrite this', 'localize this'.
---

# Voice & Tone - the applier

Voice is constant. Tone flexes with what the reader is feeling.

> Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated
> with or endorsed by Mailchimp.

## Precedence

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

When the knowledge base conflicts with a user instruction, **the instruction
wins**, and the conflict is offered to `/voice-and-tone:learn` as potential
evidence - it may be a one-off, or it may be the KB being wrong.

## No knowledge base?

Do not block. Say so in one line, offer `/voice-and-tone:init` or the 3-question
quick start, and draft using plugin defaults meanwhile. Label the output as
drafted without a knowledge base.

## The flow

Full detail in `references/write-flow.md`.

1. **Load** `<KB>/CONTEXT.md`. Nothing else, yet.
2. **Determine context and reader state.** Infer from what the user is asking for.
   Ask only if genuinely ambiguous - a wrong guess is cheap to correct, a
   needless question is not.
3. **Resolve the cell.** Load the authored cell from `<KB>/tone.md` if it exists.
   Otherwise interpolate - see `references/interpolation.md`.
4. **Load the channel playbook** `<KB>/channels/<name>.md` if one exists, and the
   **locale pack** `<KB>/locales/<code>.md` if the target is not the primary locale.
5. **Draft** inside the dials.
6. **Self-check** against the voice characteristics and the always-on layers in
   `references/always-on-layers.md`.
7. **Log the draft** to `<KB>/.drafts/<ISO-timestamp>-<slug>.md` with frontmatter
   recording cell, profile, locale, and kb_version. This is not optional - it is
   what `/voice-and-tone:learn` diffs against later.
8. **Report** one line: `profile <name> · cell: <context>/<state> · locale: <code>
   · <authored|interpolated>`.

## The humor gates - hard rules

1. Humor requires an **authored** cell. An interpolated cell never produces
   humor, whatever the arithmetic yields.
2. `frustrated`, `anxious-at-risk`, and `disappointed-leaving` force `humor 0`
   regardless of dial values, in authored cells too.

The failure mode of a computed cell must be "a bit flat", never "joked at someone
whose payment just failed".

## Promoting a cell

When you interpolate a cell for real work, offer to promote it: draft the full
cell in the §6.4 shape - reader is feeling, dials, do, don't, example - and if
the user approves, write it to `<KB>/tone.md` at `confirmed` with a `decision`
evidence entry. The matrix fills itself along the paths actually written.

## Channels

First write to a new channel produces the **tone cell only**. On the second write
to the same channel, offer to generate the full playbook from
`templates/kb/channels/_template.md`.

## Rewriting

Same flow, with the original as input. Additionally:
- Preserve every fact. Changing meaning is not a tone change.
- Show what changed and why, referencing rule IDs.
- Log both the original and your version to `.drafts/` so a later correction has
  a full chain.

## Localizing

`/voice-and-tone:localize` applies a locale pack to existing copy. Load the pack,
apply the mechanical conventions - quotes, dates, separators, currency - then the
brand decisions - register, anglicism policy, capitalization. **This is not
translation.** If the text needs translating, say so and ask; the plugin governs
how text is written, not what language it is in.

## After writing

If the user edits your draft, that edit is evidence. Offer
`/voice-and-tone:learn` - but never promote a rule from a single correction
unless it is an unambiguous lexicon swap.
