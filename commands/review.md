---
description: Review copy against the knowledge base, with severities and file:line anchors
argument-hint: "<text, file, directory, or --diff> [--critic]"
---

# /voice-and-tone:review

Reviews copy against `.voice-and-tone/`. Severity comes from the confidence of the
rule broken: `confirmed` blocks, `derived` warns, `assumed` is a nit, `disputed`
is never enforced. Accessibility violations and non-inclusive language always
block.

## Usage

```
/voice-and-tone:review content/pricing.md
/voice-and-tone:review locales/en/common.json
/voice-and-tone:review --diff              review only the copy changed on this branch
/voice-and-tone:review content/ --critic   dispatch the independent critic
```

## `--critic`

Dispatches the `voice-critic` agent in fresh context. It sees the knowledge base
and the draft, never the reasoning that produced the draft, and it runs the
read-back test: given the copy with its metadata stripped, can it name the context
and reader state? A wrong guess means the tone missed.

Use it whenever this session wrote the copy. Self-review by the author is worth
less than it feels like.

## Invokes

The `voice-review` skill, and the `voice-critic` agent when `--critic` is passed.

$ARGUMENTS
