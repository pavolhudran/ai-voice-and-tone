---
description: Turn off-brand text into on-brand text, showing what changed and why
argument-hint: "<text or file path> [--context <c>] [--state <s>] [--profile <slug>]"
---

# /voice-and-tone:rewrite

Takes existing copy and brings it into the brand's voice. Preserves every fact -
changing meaning is not a tone change.

## Usage

```
/voice-and-tone:rewrite "We regret to inform you that your payment has failed."
/voice-and-tone:rewrite content/pricing.md --context marketing-page
```

## Output

The rewritten text, followed by a short table of what changed and which rule ID
drove each change. Rules you could not apply because the knowledge base has no
opinion are listed too - those are gaps worth filling.

Both the original and the rewrite are logged to `.voice-and-tone/.drafts/` so a
later `/voice-and-tone:learn` has the full chain.

## Speakers

`--profile <slug>` rewrites into that speaker's voice instead of the house's.

## Invokes

The `voice-and-tone` skill.

$ARGUMENTS
