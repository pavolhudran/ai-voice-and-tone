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

The scaffold is a script, so it is the same every time:
`scripts/speaker.mjs --add <slug> --name "<display name>" [--locale <code>]`
copies the overlay template to `profiles/<slug>/`, declares the profile in
`config.yml` (comments kept), and registers the speaker's inbox
`profiles/<slug>/sources/` under the speaker. Then speaker discovery takes
over: every `--from` source is registered with
`scripts/sources.mjs --add --profile <slug>`, ingested, fingerprinted with
`--profile <slug> --set-baseline`; the overlay is drafted from the speaker's
material, interviewed on the speaker's own strings, and the speaker card is
compiled. A tone-of-voice document among the sources is registered material:
its explicit rules enter at `confirmed`.

Ends by proposing the house's "Never say" IDs into `locks:` if the house has
no locks yet.

## `list`

`scripts/speaker.mjs --list`: one line per speaker - slug, name, voice
rules, authored cells, overrides, locks broken, drafts pending - and the
declared locks. Read-only; the same numbers as
`/voice-and-tone:status --panel speakers`.

## `remove`

Retraction. `scripts/speaker.mjs --remove <slug> --dry-run` prints the plan:
the overlay, the register and index entries attributed to the speaker, the
ledger entries carrying its profile, and every rule they produced. Shown as
a proposed diff; on approval `--remove <slug>` (no dry run) removes the
overlay, the profile, its register entries and its index entries, and the
skill reopens exactly the rules named. Ledger entries are never deleted.

## Invokes

`add` - the `voice-discovery` skill, speaker path (`references/speaker-discovery.md`).
`list` - the `voice-observability` skill.
`remove` - the `voice-maintenance` skill.

$ARGUMENTS
