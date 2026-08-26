# Always-on layers

These apply to every draft and every review. They are not a checklist run at the
end - a checklist at the end catches the ones you remember to look for.

## Accessibility

- **No directional language.** "The button below" breaks in a screen reader and
  on a narrow viewport. Name the thing instead.
- **Links name their destination.** Never "click here", never a bare URL as link
  text. The link text should make sense read alone, out of order.
- **Plain language.** Prefer the shorter, commoner word where it means the same.
- **Acronyms defined on first use**, per page, not per site.
- **Proper heading nesting.** No level skipped, one h1.
- **Alt text** describes function where the image does something, content where it
  shows something, and is empty where the image is decorative.
- **Most important information first.** Front-load the sentence and the page.

## Translation-readiness

Source copy that translates cleanly is also source copy that reads cleanly.

- **Active voice.** Passive constructions lose the actor, and many languages
  cannot recover it.
- **No double negatives.**
- **No idioms, slang, or clichés.** They translate into nonsense or into nothing.
- **Disambiguate words with several senses** - `once`, `since`, `right`, `may`,
  `left`. Pick the unambiguous synonym.
- **Avoid gerund-heavy constructions.** "-ing" forms are grammatically ambiguous
  out of context.
- **One term per concept.** Never vary a term for the sake of variety; a synonym
  reads as a different thing.
- **Spell out units** rather than abbreviating them.
- **ISO currency codes**, not symbols, wherever the audience is not single-market.

## Severity

Accessibility violations and non-inclusive language are **always Blocker** in
review, regardless of the confidence of any rule involved. Everything else
inherits its severity from the confidence of the rule it breaks.
