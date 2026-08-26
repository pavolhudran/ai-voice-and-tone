# Severity

## Derived from confidence

| Rule confidence | Severity | Why |
|---|---|---|
| `confirmed` | **Blocker** | the user stated this explicitly; breaking it is breaking their instruction |
| `derived` | Warning | inferred from the corpus with enough samples; probably right, not certain |
| `assumed` | Nit | a plugin default nobody has confirmed; report it, do not insist |
| `disputed` | **never enforced** | sources genuinely conflict; enforcing either side would be picking a winner the user has not picked |

## Always Blocker, whatever the rule says

- **Accessibility violations** - directional language, unlabelled links,
  undefined acronyms, skipped heading levels, missing or wrong alt text.
- **Non-inclusive language** - gendered defaults where neutral wording exists,
  ableist idiom, exclusionary metaphor.

These override the table above in both directions: they block even when no rule
in the knowledge base mentions them, and they block even when the rule that does
mention them is only `assumed`.

## Disputed rules in a report

Do not file them as findings. Mention them once, at the end, under a heading of
their own:

```
Open question - not enforced
  D1  contraction use: marketing site 0%, app UI 61%. Channel split, or drift?
      Resolve with /voice-and-tone:audit.
```

## Counting

Report totals as `N blockers, N warnings, N nits`. If there are zero blockers,
say so in the first line - the most useful thing a review can tell someone in a
hurry is that nothing is on fire.
