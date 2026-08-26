# Interview method

## Why not adjectives

"How formal are you, 1-5?" produces answers people cannot introspect reliably and
that do not survive contact with a real string. Forced choice between concrete
rewrites of the project's **own** copy does, because the user is judging a
sentence they recognise rather than describing themselves.

## Preference pairs

Pull a real string from the manifest. Rewrite it 3 ways, each isolating one
variable where possible.

```
Your string: "Campaign scheduled successfully."

A  "Your campaign is scheduled. Nice work."          <- warmth
B  "Campaign scheduled successfully."                <- neutral baseline
C  "All set - your campaign goes out Thursday at 9am."  <- specificity
```

Include the unchanged original as one option. If the user picks it, that is a
finding: the current corpus is on-brand for that variable, and the derived rule
is confirmed rather than overturned.

Each pick:
1. adjusts the dial vector for the relevant state and context
2. writes a `confirmed` rule
3. writes an `interview` ledger entry storing the whole pair, with `Produced:`
   listing every rule the pick created

## Where adjectives are still right

Preference pairs need a string to work on. Where none exists, ask openly:

- messaging pillars
- audience description and the states they arrive in
- persona rules - does the mascot speak?
- self-reference rules - brand name casing, what the brand calls its users

## Round shape

Batch up to 4 questions per `AskUserQuestion` call - a hard tool limit. Default
to 3 rounds maximum per session. Open every round with what the previous round
resolved, so the user can see the guide being built rather than being quizzed.

Always offer "good enough for now". Whatever is left stays `assumed` and is
queued for the next run. A half-built knowledge base with honest confidence
levels is worth more than a complete one with invented ones.

## What never gets asked

- Anything the corpus already answers at `derived` and nothing contradicts
- Anything a `confirmed` rule already settles
- The same question twice in one session, in different words
