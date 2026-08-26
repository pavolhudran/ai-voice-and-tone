# Attribution

This plugin is built on **Mailchimp's Voice and Tone framework**, published as part of
the Mailchimp Content Style Guide under
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).

- Style guide: <https://styleguide.mailchimp.com/>
- Canonical markdown source: <https://github.com/mailchimp/content-style-guide>

This project is **not affiliated with or endorsed by Mailchimp.**

## What is borrowed, and what is not

What is borrowed is **method and structure**: the idea that voice is constant while tone
flexes with the reader's emotional state; the shape of a tone scenario card; the practice
of writing for translation and for accessibility as always-on layers rather than as a
checklist at the end.

What is **not** borrowed is prose. This plugin carries no substantial verbatim text from
Mailchimp's guide, and it generates none into any knowledge base it produces. Every rule
in a generated knowledge base is derived from the user's own corpus, the user's own
answers, or the user's own corrections - and each one records which.

## Source fidelity

The scenario-card layer that made the framework well known - user quote, "the reader is
feeling...", tone, do/don't, example - lived on the retired companion site
`voiceandtone.com`, not on the current style guide, whose tone section is roughly 200
words. This plugin **reconstructs that card pattern as a documented method** and fills the
cells from the user's own project. It does not claim to reproduce Mailchimp's cells.

Two documented inconsistencies in the source informed the design:

1. The guide's voice page and its own TL;DR list different voice characteristics. A
   hand-maintained digest drifts from its source. Therefore `CONTEXT.md` is always
   generated, never hand-edited.
2. The source's tone axis is emotional state only. Mixing funnel stages into that axis
   produces non-composable cells. Therefore the state axis here is emotion-only, and
   channel lives on a separate context axis.
