---
description: Turn your edits to a plugin draft into evidence, and into rules once corroborated
argument-hint: "[<final-file>] [--draft <draft-file>]"
---

# /voice-and-tone:learn

Diffs a draft the plugin produced against your edited version, classifies each
edit, and proposes rules for the ones that clear the corroboration threshold.

**A single edit never becomes a rule.** It is recorded as evidence. Promotion
needs `thresholds.corroboration` (default 2) independent corrections from
*different drafts* pointing the same way - one editing pass is one opinion, not
three. Unambiguous lexicon swaps are the one exception and fire immediately.

## Usage

```
/voice-and-tone:learn                              use the most recent draft and its file
/voice-and-tone:learn content/pricing.md           diff against the draft that produced it
/voice-and-tone:learn --draft .voice-and-tone/.drafts/2026-08-26-error-upload.md
```

Every proposal is shown with its diffs as evidence and approved individually.
Nothing is written to the knowledge base without a yes.

## Invokes

The `voice-maintenance` skill.

$ARGUMENTS
