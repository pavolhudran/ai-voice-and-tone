# Audit report

## Coverage

How much of the matrix is authored rather than computed. Eighty cells is the
denominator; nobody is expected to reach it.

```
Coverage       12 / 80 authored (15%)

  system-error      6 / 8   the cells that carry the most risk - good
  product-ui        4 / 8
  email             2 / 8
  marketing-page    0 / 8   every write here is interpolated, so never humorous
  ...
```

Flag any context with zero authored cells **and** measurable corpus traffic. That
combination means the project writes there constantly and the guide has never
been asked about it.

## Drift

Current fingerprint against the baseline captured at init, per locale, never
averaged across locales.

```
Drift (en, baseline 2026-03-02)

  mean sentence length   14.2 -> 19.8   +39%   ***
  contraction rate       31.0 -> 12.4   -60%   ***
  exclamation rate       0.04 -> 0.03    -25%
  reading grade           7.1 ->  9.6   +35%   ***
```

Flag anything past 25%. Then ask the question the numbers cannot answer: is this
drift, or did the corpus change shape - a new docs section, a legal page, a
migration? A fingerprint that suddenly includes 400 pages of API reference has
not drifted, it has been diluted. Check the manifest before concluding.

## Rule health

| State | Test | Ask |
|---|---|---|
| **dead** | never triggered a finding since it was written | is this rule about something we no longer write? |
| **overridden** | violated and the violation kept, repeatedly | enforce it, or retire it? |
| **stale** | newest evidence older than `thresholds.stale_months` **and** never triggered | still true? |
| **disputed** | sources conflict, unresolved | channel split, or drift? |

```
Rule health

  overridden   L07  "leverage" -> "use"       broken 14 times, kept 14 times
                    A rule broken every time is not a rule. Enforce or retire?

  stale        M11  "no em dashes in UI"      newest evidence e09, 2025-04-11
                    Never triggered since. Still true?

  dead         C03  "press release boilerplate"  no findings, no drafts, 11 months

  disputed     M12  contraction use            marketing 0%, app UI 61%
```

A rule flagged `overridden` is the highest-value line in the whole report. It is
the one place where the guide and the practice are in open disagreement, and
somebody has been quietly winning that argument for months.

## Inventory

Scored findings across the corpus, so the audit ends with something to do.

```
Inventory (from 214 files, 18,402 words)

  blockers    31   across 12 files
  warnings   104   across 41 files
  nits       288   across 88 files

  worst files
    content/pricing.md            9 blockers
    locales/en/errors.json        7 blockers
    content/about.md              4 blockers
```

Offer `/voice-and-tone:review <file>` on the worst file, not on all of them. An
audit that ends in a 300-item list ends in nothing.

## Speakers

House audit only, and only when `config.yml` declares speakers. One row each.

```
Speakers (3 declared, locks: V2, L20)

  maya       overrides 2   locks broken 0   drift ok     cells 3/80   last draft 4d
  jonas      overrides 0   locks broken 1   drift n/a    cells 0/80   last draft never
  helpdesk   overrides 1   locks broken 0   drift FLAG   cells 1/80   last draft 12d
```

A lock broken is a validation error and belongs to `:sync`; it is listed here
so the person running the audit sees it beside the speaker it concerns. Each
override is a candidate for the third closing question.

## Closing

Two questions, always - three when there are speakers - and nothing else:

1. Which overridden rules do we enforce, and which do we retire?
2. Which disputed entries are channel splits, and which are drift?
3. For each speaker override: is it that speaker's own, or a house rule
   every speaker should carry?

All write `decision` evidence entries. All are the point of running the audit.
