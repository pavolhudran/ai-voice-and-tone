# Finding format

Markdown, anchored, one finding per violation. The anchor is what makes a report
actionable rather than merely correct.

```markdown
### Blockers

**`content/pricing.md:14`** - L07 (house, locked) `confirmed`
> "Leverage our platform to simplify your workflow."

Two lexicon violations in one sentence: `leverage` -> `use`, `simply` has no
replacement and should be cut. Evidence: e22, e31.

**Suggested:** "Use our platform to tidy up your workflow."

### Warnings

**`content/pricing.md:22`** - M04 `derived`
> "Ready to get started?? "

Double question mark, and the sentence is the third question in four lines. The
corpus question rate is 0.08; this section is at 0.75.

### Nits

**`content/pricing.md:31`** - V2 `assumed`
> "We are thrilled to announce..."

Reads as announcement language rather than plainspoken. `V2 · Genuine` is only
`assumed` - if this is right, `/voice-and-tone:learn` can confirm the rule instead.
```

## Rules for a finding

- **Quote the offending text.** A finding without the text is a claim.
- **Name the rule ID and its confidence.** Both. The ID lets the user look it up;
  the confidence tells them how hard to take it.
- **Name the origin.** `(house)`, `(<slug>)`, `(<slug>, overrides house)`, or
  `(house, locked)`. A reader must know whose rule was broken.
- **Cite the evidence IDs** for blockers. If a user is going to be blocked, they
  are entitled to see why the rule exists.
- **Suggest a fix** for blockers and warnings. Nits may be reported without one.
- **One finding per violation.** Do not bundle three lexicon hits into one entry;
  each one is separately acceptable or rejectable.
- **No finding without a rule.** If nothing in the knowledge base covers it, it
  goes under "Candidate rules", not under a severity heading.
