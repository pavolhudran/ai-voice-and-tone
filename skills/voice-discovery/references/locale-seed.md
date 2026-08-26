# Locale seeding

Split every locale pack in two. The first half is typography and has a correct
answer that does not depend on the brand. The second half is brand opinion and
must be asked.

## Seeded mechanically - never ask

| Locale | Quotes | Date | Thousands | Decimal | Currency |
|---|---|---|---|---|---|
| en-US | " " | MM/DD/YYYY | , | . | before: $9.99 |
| en-GB | " " | DD/MM/YYYY | , | . | before: GBP 9.99 |
| cs | low-high double quotes | D. M. YYYY | space | , | after: 9,99 CZK |
| de | low-high double quotes | DD.MM.YYYY | . | , | after: 9,99 EUR |
| fr | guillemets, spaced | DD/MM/YYYY | space | , | after: 9,99 EUR |
| es | guillemets or " " | DD/MM/YYYY | . | , | after: 9,99 EUR |
| pl | low-high double quotes | DD.MM.YYYY | space | , | after: 9,99 PLN |

For a locale not listed, state the convention you are using and ask the user to
confirm it once. Write the confirmation as a `decision` evidence entry so it is
never asked again.

## Elicited by interview - always ask

- **Address register** - formal or informal, and whether it differs by channel.
  This is the single highest-leverage locale question; ask it first.
- **Anglicisms** - which loan words are acceptable, which are not
- **Loan-word policy** for product and industry terms
- **Capitalization** conventions in headings and UI labels
- **Pluralization** notes, where the language needs more forms than English
- **Diacritic enforcement** - strict, or tolerated in some contexts

## What sits beneath every pack

The translation-readiness layer applies to source copy in every language: active
voice, no double negatives, no idioms or slang, disambiguated words with several
senses, no gerund-heavy constructions, one term per concept, spelled-out units,
ISO currency codes.

## Fingerprints

Computed per locale and never averaged across locales. English-only metrics -
contraction rate, reading grade, passive-voice rate, Oxford comma rate - come
back `null` for other languages. That is the honest answer, not a missing value
to be filled in.
