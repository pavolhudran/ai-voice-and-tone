# Changelog

## 0.2.0 - 2026-09-10

Speaker profiles. One knowledge base can now hold a shared house layer plus
one overlay per speaker under `profiles/<slug>/`, with `locks:` naming the
house rules no speaker may override. New command `/voice-and-tone:speaker`;
`--profile <slug>` on every drafting, reviewing, and reporting command; a
`speakers` status panel, five new gap detectors (G17-G21), and per-speaker
status pages. A knowledge base with no speakers is byte-identical to 0.1.0
across the compiler, the validator, and both status renderers
(`test/conformance.test.mjs`). Spec:
`.superpowers/specs/2026-09-10-speaker-profiles-design.md`.

## 0.1.0 - 2026-08-28

First release: discovery, the tone model, source ingestion, review, learn,
audit, sync, and the status dashboard with its shareable page.
