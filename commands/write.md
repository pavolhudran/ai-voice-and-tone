---
description: Draft on-brand copy for a context and a reader state
argument-hint: "<what to write> [--context <c>] [--state <s>] [--locale <code>] [--profile <slug>]"
---

# /voice-and-tone:write

Drafts copy using the project's voice-and-tone knowledge base. Infers the context
and reader state from your request; override either explicitly when you know
better.

## Usage

```
/voice-and-tone:write an error for a file over the upload limit
/voice-and-tone:write release notes for the scheduling feature --context release-notes
/voice-and-tone:write a win-back email --state disappointed-leaving --locale cs
```

## Contexts

`marketing-page` · `product-ui` · `system-error` · `help-doc` · `email` ·
`social` · `legal-policy` · `notification` · `support-reply` · `release-notes`

## Reader states

`delighted` · `curious` · `focused` · `uncertain` · `confused` · `frustrated` ·
`anxious-at-risk` · `disappointed-leaving`

Emotional state only. Funnel stage is a context plus a state, not a third axis.

## Options

- `--context <c>` - one of the ten above
- `--state <s>` - one of the eight above
- `--locale <code>` - apply a locale pack
- `--profile <slug>` - write as that speaker; "write this as Maya" resolves the same way
- `--variants <n>` - produce n alternatives

## Invokes

The `voice-and-tone` skill. For buttons, errors, empty states, and notifications,
the `microcopy` skill takes over - it has tighter length rules.

$ARGUMENTS
