---
description: Discover, measure, interview, and canonize a voice-and-tone knowledge base
argument-hint: "[--add <source>] [--quick]"
---

# /voice-and-tone:init

Runs the full discovery pipeline: scan the project for copy, measure a corpus
fingerprint, draft a knowledge base with evidence and confidence on every rule,
compute a questionnaire from the gaps, interview by preference pairs, canonize.

Creates `.voice-and-tone/` in the project root.

## Usage

```
/voice-and-tone:init                      full pipeline
/voice-and-tone:init --quick              3 questions, provisional KB, all assumed
/voice-and-tone:init --add <path-or-url>  ingest new material into an existing KB
```

`--add` re-runs ingest on the new material only, diffs it against the rules that
already exist, and records contradictions as `disputed` rather than overwriting
anything.

## Invokes

The `voice-discovery` skill.

$ARGUMENTS
