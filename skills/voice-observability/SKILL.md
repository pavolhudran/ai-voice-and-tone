---
name: voice-observability
description: >
  WHEN: the user asks what the voice knowledge base currently contains, how
  complete it is, what is configured, what is missing, or wants a dashboard,
  status screen, or overview of the voice-and-tone setup.
  WHAT: reads every knowledge-base artifact without modifying any of them,
  renders a deterministic ASCII dashboard, and ranks what is missing with the
  command that closes each gap.
  TRIGGERS: 'what do we have', 'voice status', 'show me the state', 'how
  complete is our voice guide', 'what is missing', 'dashboard', 'what is
  configured'.
---

# Voice observability

Observability observes. It never changes what it observes.

> Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated
> with or endorsed by Mailchimp.

## Precedence

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

## The rule that governs this whole skill

**This skill writes nothing.** Not the knowledge base, not the manifest, not the
fingerprint. The one exception is `--refresh`, and only when the user asks for
it by name.

If you find yourself wanting to fix something you can see on the screen, stop
and hand off to the command that owns it. The screen already names it.

## Run it

```
node "<plugin>/scripts/status.mjs" --root "<project>" --kb "<KB>"
```

Show the output **verbatim**. Then wait.

## Two prohibitions, both absolute

1. **Never restate a number the script printed.** Not in a summary, not as a
   "key takeaway", not rephrased. The dashboard is generated precisely so that
   no hand-maintained summary can drift from it - and a paraphrase in the chat
   is a hand-maintained summary.

2. **Never draw a panel.** Not a table, not a chart, not "here is a simpler
   view". If a view is wanted that the script cannot produce, that is a change
   to `scripts/lib/render.mjs`, not something to improvise. A block you draw
   this turn will look different next turn, and neither version can be tested.

What you *should* add is what the script cannot: which gap matters most for what
the user is actually trying to do, and what the two-step path to closing it is.

## When a page is wanted instead of a screen

Prohibition 2 above forbids you from drawing a panel. `--artifact` is the
sanctioned way to give someone a better-looking view without breaking it: the
script still draws, you still do not.

Reach for it when the user asks for something shareable, says the screen is hard
to read, wants to send the state to someone who does not use a terminal, or is
working anywhere a monospace block renders badly.

```
node "<plugin>/scripts/status.mjs" --root "<project>" --kb "<KB>" --artifact
```

That writes `<KB>/.drafts/status.html` and prints the path. Then publish that
exact file with the Artifact tool and give the user the link.

Two things to hold to:

- **Publish the file the script wrote. Never assemble a page yourself**, and
  never edit the one it produced. A page you write is a description of the
  numbers, free to drift from them while looking equally authoritative - the
  precise failure the generated dashboard exists to prevent.
- **Re-publish the same path** on later runs. The Artifact tool redeploys to the
  same URL for the same file path, so the link the user already has keeps
  working instead of being replaced by a new one each time.

Say the same thing you would say about the screen: which gap matters most for
what they are actually doing. Do not narrate the page's contents back to them -
they can see it, and prohibition 1 still applies.

## The menu

The footer lists the panels. When the user picks one:

```
node "<plugin>/scripts/status.mjs" --root "<project>" --kb "<KB>" --panel <name>
```

Panels: `pipeline`, `integrity`, `coverage`, `rules`, `drift`, `sources`,
`evidence`, `settings`, `missing`, `all`.

Read `references/panels.md` for what each one means and the question it raises.

## Refreshing

`--refresh` is the only writing this skill ever does, and only on request. It
rebuilds the manifest and the fingerprint and hashes registered sources. It does
not set the baseline, does not ingest, and does not fetch.

Offer it when the screen says the manifest is behind. Do not run it by reflex:
the staleness figure is itself information, and refreshing away every trace of
how long the numbers were wrong is the thing this command exists not to do.

## Handing off

When the user picks a fix, stop being the status skill and invoke the command
that owns it. Do not do the work here.

| Gap | Owner |
|---|---|
| no knowledge base, interview never ran | `/voice-and-tone:init` |
| material not ingested, source stale | `/voice-and-tone:connect` |
| card behind its sources, validation errors | `/voice-and-tone:sync` |
| drift past threshold, disputed rules | `/voice-and-tone:audit` |
| drafts awaiting corroboration | `/voice-and-tone:learn` |
| locale has no pack | `/voice-and-tone:localize` |

## What this skill must not answer

Whether a rule should be **enforced or retired**, and whether a disputed entry
is a **channel split or drift**. Both need a decision from the user, and
`:audit` is where that decision is asked for and recorded as `decision`
evidence. Answering either one here would record nothing and decide something.

Read `references/gap-catalogue.md` before explaining any gap - especially the
section on what is deliberately not a gap.
