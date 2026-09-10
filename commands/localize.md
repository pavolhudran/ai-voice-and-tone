---
description: Apply a locale pack's conventions and register to existing copy
argument-hint: "<text or file path> --locale <code> [--profile <slug>]"
---

# /voice-and-tone:localize

Applies `.voice-and-tone/locales/<code>.md` to copy: quotation marks, date and
number formats, currency placement, then the brand decisions - address register,
anglicism policy, capitalization, diacritic enforcement.

**This is not translation.** It governs how text is written in a language, not
which language it is in. If the text needs translating, the command says so and
asks rather than guessing.

## Usage

```
/voice-and-tone:localize content/pricing.cs.md --locale cs
/voice-and-tone:localize "Vaše kampaň je naplánovaná." --locale cs
```

If no pack exists for the locale, offers to create one: typography is seeded
mechanically, brand decisions are interviewed.

## Speakers

`--profile <slug>` applies the speaker's own locale pack where it overrides the house's.

## Invokes

The `voice-and-tone` skill, locale path.

$ARGUMENTS
