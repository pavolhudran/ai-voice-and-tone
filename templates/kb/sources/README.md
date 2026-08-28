# Drop brand material here

Anything you want the voice derived from: past newsletters, the brand deck, a
tone-of-voice PDF, exported blog posts, webinar transcripts.

**These files are not committed, and that is deliberate.** They are inputs, not
artifacts. Client material should not end up in a git history, and decks do not
belong in a repository.

What survives is `../evidence/sources.json`: every source's content hash, what
was extracted from it, how much text it held, and which rules it produced. That
record is rich enough to recompute the whole voice fingerprint and to subtract
any single source - so a colleague who clones this repository with an empty
`sources/` folder still gets the correct baseline, not a false drift report.

Run `/voice-and-tone:connect --ingest` after adding anything.

To commit these files anyway, delete the `sources/` line from `.gitignore`.
