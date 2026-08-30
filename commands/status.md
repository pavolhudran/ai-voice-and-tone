---
description: Show the state of the voice knowledge base - coverage, drift, sources, settings, and what is missing
argument-hint: "[--panel <name>|all] [--refresh] [--locale <code>] [--width <n>] [--json]"
---

# /voice-and-tone:status

What you have, what it is set to, and what is missing - in one screen, computed
rather than described.

Read-only. It reports how stale the numbers are rather than quietly refreshing
them, so "the manifest is four days behind" is something you can see instead of
something that silently corrects itself every time you look.

## Usage

```
/voice-and-tone:status
/voice-and-tone:status --panel pipeline
/voice-and-tone:status --panel integrity
/voice-and-tone:status --panel coverage
/voice-and-tone:status --panel rules
/voice-and-tone:status --panel drift
/voice-and-tone:status --panel sources
/voice-and-tone:status --panel evidence
/voice-and-tone:status --panel settings
/voice-and-tone:status --panel missing
/voice-and-tone:status --refresh
/voice-and-tone:status --width 100
/voice-and-tone:status --json
```

## The panels

| Panel | Answers |
|---|---|
| `pipeline` | how far through `scan -> ingest -> measure -> draft -> interview -> canonize` you are |
| `integrity` | validation errors and warnings, and whether the card and the manifest are behind |
| `coverage` | the ten-by-eight tone matrix, authored against computed |
| `rules` | how many rules sit at each confidence, and what each one does in review |
| `drift` | the current fingerprint against its baseline, per locale, never averaged |
| `sources` | what is registered, what has been analysed, what has never been ingested |
| `evidence` | entries by type, open conflicts, drafts waiting on `:learn` |
| `settings` | profiles, locales, thresholds, runtime, vendored extractor versions, the register |
| `missing` | every gap, ranked, each with the command that closes it |

## `--refresh`

Rebuilds the manifest and the fingerprint, then hashes registered sources to
tell stale from current. Exactly that, and nothing else:

- It **never sets the drift baseline.** A refreshed baseline shows zero drift by
  construction and tells you nothing.
- It **never ingests.** Ingestion can escalate a source to the model tier and
  spend tokens; looking at a dashboard must not.
- It **never fetches.** Network access belongs to `/voice-and-tone:connect
  --refresh` alone.

## What it will not tell you

Whether a rule should be enforced or retired, and whether a disputed entry is a
channel split or drift. Those need a decision, and the command that asks for one
- and records it as `decision` evidence - is `/voice-and-tone:audit`.

## Invokes

The `voice-observability` skill.

$ARGUMENTS
