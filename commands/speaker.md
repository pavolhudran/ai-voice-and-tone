---
description: Add, list, or remove a speaker - a first-person voice that inherits the house and replaces its voice
argument-hint: "add <slug> --name \"<display name>\" [--from <path|url> ...] [--locale <code>] | list | remove <slug>"
---

# /voice-and-tone:speaker

A speaker is any first-person voice under the house: a named person, a team,
a product line, a mascot, an assistant. It owns its voice characteristics,
default dials, authored cells and examples; it inherits the house's lexicon,
mechanics, audiences, channels and locales, and may override any of them by
ID except the ones the house has locked.

## Usage

```
/voice-and-tone:speaker add maya --name "Maya Lind" --from ~/Brand/maya-posts/
/voice-and-tone:speaker add helpdesk --name "Acme Support" --from ~/Brand/support-tone.docx --locale de
/voice-and-tone:speaker list
/voice-and-tone:speaker remove maya
```

## `add`

Runs speaker discovery: scaffolds `profiles/<slug>/` from the overlay
template, declares the profile in `config.yml`, registers every `--from`
source under the speaker with `scripts/sources.mjs --add --profile <slug>`,
ingests it, fingerprints it with `--profile <slug> --set-baseline`, drafts
the overlay, interviews on the speaker's own strings, and compiles the
speaker card. A tone-of-voice document among the sources is registered
material: its explicit rules enter at `confirmed`.

Ends by proposing the house's "Never say" IDs into `locks:` if the house has
no locks yet.

## `list`

One line per speaker - slug, name, voice rules, authored cells, overrides,
drafts pending. Read-only; the same numbers as
`/voice-and-tone:status --panel speakers`.

## `remove`

Retraction: reads every ledger entry tagged with the profile, follows its
`Produced:` line, reopens exactly those rules, then removes the overlay, the
profile from `config.yml`, and the speaker's register entries. Every step is
a proposed diff, approved separately.

## Invokes

`add` - the `voice-discovery` skill, speaker path (`references/speaker-discovery.md`).
`list` - the `voice-observability` skill.
`remove` - the `voice-maintenance` skill.

$ARGUMENTS
