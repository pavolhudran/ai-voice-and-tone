---
description: Validate the knowledge base and recompile CONTEXT.md
argument-hint: "[--bump major|minor|patch] [--profile <slug>]"
---

# /voice-and-tone:sync

Runs `scripts/validate.mjs` for integrity - broken evidence refs, orphaned rules,
duplicate IDs, unknown contexts or states, dial values out of range, violated
humor gates - then regenerates `CONTEXT.md` with `scripts/compile-context.mjs`,
bumps `kb_version`, and appends to `CHANGELOG.md`.

Also prunes `.voice-and-tone/.drafts/` entries older than 90 days.

`CONTEXT.md` is a generated file. Hand edits to it are lost here by design; the
change belongs in the source file the card compiles from.

## Usage

```
/voice-and-tone:sync
/voice-and-tone:sync --bump minor
```

Exits without recompiling if validation finds errors - a card compiled from a
broken knowledge base is worse than a stale one.

## Speakers

Without `--profile`, validates and compiles the house and every declared
speaker (`profiles/<slug>/CONTEXT.md` each). `--profile <slug>` limits the
recompile to one speaker. Version bumps: **major** when house voice
characteristics or `locks:` change; **minor** when a speaker is added or
removed, or cells or rules are added anywhere; **patch** for wording.

## Invokes

The `voice-maintenance` skill.

$ARGUMENTS
