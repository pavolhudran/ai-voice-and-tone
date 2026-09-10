---
description: Discover, measure, interview, and canonize a voice-and-tone knowledge base
argument-hint: "[--add <source>] [--quick]"
---

# /voice-and-tone:init

Runs the full discovery pipeline: scan the project for copy, measure a corpus
fingerprint, draft a knowledge base with evidence and confidence on every rule,
compute a questionnaire from the gaps, interview by preference pairs, canonize.

Creates `.voice-and-tone/` in the project root. Early on it asks whether the
brand speaks with one voice, with several speakers, or whether to decide
later - speakers can always be added afterwards with
`/voice-and-tone:speaker add`.

## Usage

```
/voice-and-tone:init                      full pipeline
/voice-and-tone:init --quick              3 questions, provisional KB, all assumed
/voice-and-tone:init --add <path-or-url>  ingest new material into an existing KB
```

`--add` registers the new material with `scripts/sources.mjs --add`, ingests
it, and diffs it against the rules that already exist, recording
contradictions as `disputed` rather than overwriting anything. This is the
same registration `/voice-and-tone:connect` performs - reach for `:connect`
directly when you only want to manage sources (register, refresh, forget)
without running the rest of the pipeline.

## Invokes

The `voice-discovery` skill.

$ARGUMENTS
