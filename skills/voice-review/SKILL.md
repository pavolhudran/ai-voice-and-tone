---
name: voice-review
description: >
  WHEN: asked whether copy is on brand, to check or critique text against the
  brand voice, or to review a page, a string file, or a pull request's copy.
  WHAT: reads the knowledge base, finds violations, and reports them with
  file:line anchors and a severity derived from the confidence of the rule broken.
  Accessibility and non-inclusive language are always blockers.
  TRIGGERS: 'is this on brand', 'check this copy', 'review the copy', 'does this
  sound like us', 'voice review'.
---

# Voice review

Critique against the knowledge base, with severities that come from evidence
rather than from taste.

> Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated
> with or endorsed by Mailchimp.

## Precedence

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

## Flow

1. Load `<KB>/CONTEXT.md`.
2. Determine the context and reader state of the text under review. If it came
   from `.drafts/`, read them from the frontmatter instead of guessing.
3. Load the resolved cell, the channel playbook, and the locale pack if relevant.
4. Load `<KB>/lexicon.md` and `<KB>/mechanics.md` in full - review needs the whole
   list, not the compiled top-8.
5. Find violations. For each, record the rule ID, the confidence, and a `file:line`
   anchor. Format in `references/finding-format.md`.
6. Apply the always-on layers from
   `skills/voice-and-tone/references/always-on-layers.md`.
7. Assign severity per `references/severity.md`.
8. Report. Blockers first, then warnings, then nits.

## Severity, in one line

`confirmed` -> **Blocker** · `derived` -> Warning · `assumed` -> Nit ·
`disputed` -> **not reported as a violation at all**

Always **Blocker** regardless of any rule's confidence: accessibility violations,
and non-inclusive language.

A `disputed` rule may be *mentioned* as an open question, never as a finding. The
conflict is information, and review is not where it gets settled - `:audit` is.

## The rule the review must not break

Do not invent rules. If the copy reads badly but no rule in the knowledge base
covers it, say so explicitly and offer it as a **candidate rule** for
`/voice-and-tone:learn`. An unfounded finding is worse than a missed one - it
teaches the user to distrust the whole report.

## Scale

- A single string or paragraph: review inline, in this conversation.
- A file, a directory, or a diff: review inline, grouped by file.
- Anything the user wants an independent judgement on, or where you drafted the
  copy yourself: dispatch the `voice-critic` agent. It runs in fresh context and
  cannot be argued into approving its own work - because it never did any.

## Dispatching the critic

Hand it the draft as plain text with the frontmatter stripped - no `cell:`,
`context:`, or `state:` fields, and no file path into `<KB>/.drafts/` where those
fields live, since reading that file would show the answer and the guess before
it. The read-back test only means something if the guess happens before the
critic can see what it was supposed to guess. Reveal the actual cell to the
critic only after Task 1's guess is recorded, so it can do its own comparison.

## After the report

Offer the two follow-ups that matter:
- `/voice-and-tone:rewrite` for the blockers
- `/voice-and-tone:learn` for anything the user disagrees with - a rejected
  finding is evidence about the rule, not just about the copy
