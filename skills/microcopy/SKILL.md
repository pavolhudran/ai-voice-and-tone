---
name: microcopy
description: >
  WHEN: writing or fixing the shortest copy in a product - button and link
  labels, error messages, empty states, notifications, toasts, tooltips,
  placeholders, confirmation dialogs, form validation, loading states.
  WHAT: applies the knowledge base at micro length, where the constraints are
  tightest and the read count is highest, using the same tone cells as long-form
  copy but with fixed length budgets and element-specific shapes.
  TRIGGERS: 'button label', 'error message', 'empty state', 'toast', 'tooltip',
  'what should this say', 'validation message', 'confirmation dialog'.
---

# Microcopy

Same voice, same cells, much less room.

> Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated
> with or endorsed by Mailchimp.

## Precedence

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

## Flow

1. Load `<KB>/CONTEXT.md`.
2. Identify the element and take its budget from `references/patterns.md`.
3. Resolve the cell. Almost all microcopy is `product-ui`, `system-error`, or
   `notification`; the state is what varies.
4. Draft to the budget. If it does not fit, the problem is usually that the
   sentence is doing two jobs - split it, or cut one.
5. Apply the always-on layers from
   `skills/voice-and-tone/references/always-on-layers.md`. They matter more here,
   not less: a button labelled "Click here" fails at 11 characters.
6. Log to `<KB>/.drafts/` like any other draft.
7. Offer 2-3 alternatives. Microcopy is cheap to vary and expensive to get wrong.

## The rules that bite at this length

- **Humor gates apply, hard.** `system-error` + `frustrated` is the single most
  common microcopy cell and one of the three states that force `humor 0`. An
  error message is never the place for a joke, and an interpolated cell may not
  produce humor at all.
- **Say what happened, then what to do next.** In that order. An error that
  explains without instructing has done half its job.
- **Own it if it is ours.** Do not use passive voice to hide an actor the reader
  can work out anyway.
- **Never apologize twice.** One "sorry" at most, and only where the fault is real.
- **Buttons are verbs.** The label says what happens when it is pressed, not what
  the screen is called.
- **Never "Click here".** Never a bare URL. Never "the button below".

## When to hand off

Anything over roughly 50 words, or anything with more than one paragraph, belongs
to the `voice-and-tone` skill. Say so and hand over rather than stretching this
skill past its shape.
