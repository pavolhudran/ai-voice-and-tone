---
description: Report coverage, drift, rule health, and a scored inventory of findings
argument-hint: "[--locale <code>] [--section coverage|drift|health|inventory]"
---

# /voice-and-tone:audit

Four sections: how much of the tone matrix is authored, how far the corpus has
drifted from its baseline, which rules are dead, overridden, stale, or disputed,
and a scored inventory of findings across the project.

Ends with the two questions it exists to raise: which overridden rules to enforce
or retire, and which disputed entries are channel splits rather than drift.

## Usage

```
/voice-and-tone:audit
/voice-and-tone:audit --locale cs
/voice-and-tone:audit --section drift
```

Refreshes the manifest and fingerprint first. Does **not** move the drift
baseline - a refreshed baseline shows zero drift by construction.

## Invokes

The `voice-maintenance` skill.

$ARGUMENTS
