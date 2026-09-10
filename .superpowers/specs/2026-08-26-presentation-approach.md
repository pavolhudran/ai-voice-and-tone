# Presentation: one-page interactive plugin explainer

**Date:** 2026-08-26
**Status:** built
**Output:** `docs/presentation/index.html`, one self-contained file
**Deployed by:** `.gitlab-ci.yml`, `pages` job, copies `docs/presentation/` to `public/`
**Scope note:** this document covers the presentation only. It reads the repository
and changes nothing in `scripts/`, `skills/`, `commands/`, `agents/`, `templates/`
or `test/`.

This started as a plan and is now a record of what was built and why. Where the
built page departs from the original plan, the reason is given.

---

## 1. Who it is for

Someone who has never seen the plugin, has five minutes, and needs to leave able
to explain it to a third person. A teammate, a stakeholder, a prospective user.
The page assumes no knowledge of Claude Code, of the plugin, or of voice-and-tone
frameworks.

That ruled out two formats. It is not API documentation, since `README.md` does
that better. And it is not a deck of bullet points, because the two ideas worth
carrying away are both mechanisms, and a mechanism is understood by operating it.

## 2. The through-line

> **A voice guide the plugin can prove, not just recite.**

Every rule carries where it came from and how sure we are. That one decision
drives three systems that would otherwise be unrelated: which questions get
asked, which findings block, and which rules get retired. A reader who leaves
with only that has got the point.

The second idea, earned after the first lands: **voice is constant, tone flexes**,
and the tone half is computed rather than authored, because eighty cells is not
authorable and a guide nobody finishes is a guide nobody uses.

## 3. What earns interactivity

Three things. Everything else is prose, a diagram or a table.

| Interaction | Why it earns its place |
|---|---|
| **Confidence to consequence** | The core claim is that one axis drives three systems. Clicking `confirmed` and watching interview, review and maintenance all change together *is* the argument. Prose could only assert it. |
| **The live tone matrix** | 10 contexts by 8 states, computed in the browser from the vectors shipped in `templates/kb/tone.md`. The reader discovers interpolation by using it, and discovers the humor gates by trying to break them. |
| **The corroboration counter** | "One edit is evidence, two is a rule" is counter-intuitive, and it is what stops the knowledge base overfitting to one bad afternoon. Two buttons, only one of which moves the counter. |

Deliberately not interactive: the command list, the file tree, the pipeline and
the start guide. They are inventory or sequence, and both are tables.

**Change from plan:** the matrix gained an **"authored cell" toggle**. Without it
the page could only describe gate 1; with it, a reader can watch humor unlock on
`social/delighted` and stay locked on `frustrated`. Both gates become
demonstrable rather than stated.

## 4. Page structure as built

```
+----------------------------------------------------------------+
|  Voice & Tone                    [ Built on Mailchimp's ... ↗ ] |  white
+----------------------------------------------------------------+
|  Problem  Mechanism  Pipeline  Tone  Gates  KB  Surface  ...    |  warm grey
+----------------------------------------------------------------+

 HERO  (full-bleed Cavendish Yellow)
   eyebrow: A Claude Code plugin, built on Mailchimp's framework
   h1:      A brand voice guide your tooling can prove.
   chips:   8 commands · 5 skills · 1 critic · 5 CLI scripts ·
            11 shared modules · Node 18+ · Not affiliated with Mailchimp

 1  THE PROBLEM        two yellow cards, normal guide vs a rule with evidence
 2  THE MECHANISM      INTERACTIVE 1: confidence chips, three outcome cards
 3  THE PIPELINE       seven cream tiles, scan through canonize
 4  THE TONE MATRIX    INTERACTIVE 2: the 10x8 grid, live arithmetic, dials
 5  THE HUMOR GATES    two warn-tinted blocks, then the failure-mode quote
 6  THE KNOWLEDGE BASE annotated file tree, two supporting cards
 7  THE SURFACE        commands table, skills table, the critic
 8  MAINTENANCE        INTERACTIVE 3: corroboration counter and ledger
 9  GET STARTED        seven steps, staircase layout
 FOOTER                attribution, licensing, on a cream band
```

**Change from plan:** section 9 did not exist in the original plan, which ended at
maintenance. The page explained the plugin and never said how to begin using it.
Seven steps, each carrying the literal command, sourced from `README.md` and
`commands/init.md` rather than written from memory.

### The tone matrix, in detail

```
              marketing product system  help  email social
                 -page     -ui   -error  -doc
    confused      [ ]      [X]     [ ]    [ ]   [ ]    [ ]   <- clicked
    frustrated    [!]      [!]     [!]    [!]   [!]    [!]   <- humor locked
    anxious       [!]      [!]     [!]    [!]   [!]    [!]

    selected: T-product-ui/confused          [ interpolated ]
    [ ] Treat this cell as authored
    +----------------------------------------------------------+
    | state vector    confused    3   1   4   4   2   2         |
    | context offset  product-ui  0   0  +1  -1   0   0         |
    | ----------------------------------------------- clamp     |
    | after clamp + gates         3   0   4   3   2   2         |
    +----------------------------------------------------------+
    warmth      ###.  3/4
    humor       ....  0/4   locked, with the reason stated
    directness  ####  4/4
```

### The start guide, staircase

Each tile is 60% of the container, stepping right by `(100 - 60) / 6`, so step 1
sits flush left and step 7 lands flush right. The descent is driven by the tile
width, so changing the width keeps both edges aligned. Below 68rem it collapses
to full-width tiles, because a decorative diagonal is not worth an unreadable
step.

```
1 ------------
2   ------------
3     ------------
4       ------------
5         ------------
6           ------------
7             ------------
```

## 5. Visual direction

**Changed entirely from the plan.** The original proposed a copy-editor's proof
sheet: proofing stock, printer's blue-black, a blue-pencil accent. On review the
direction became **Mailchimp's own visual family**, since the plugin is built on
their framework and the resemblance signals that lineage.

- **Colour.** Cavendish Yellow `#ffe01b` and Peppercorn `#241c15`, their two
  signature values. Warm cream `#fbf7ec` and a light grey `#f0efe9` for secondary
  bands. Their teal `#007c89` carries links. A warm red `#b8341f` is reserved
  **only** for the humor gates, so semantic colour stays separate from brand colour.
- **Type.** Their faces (Means, Graphik) are proprietary, so: **Fraunces** for
  display as the closest free analogue to Means, **Archivo** for body as a closer
  match to Graphik's proportions than Inter, **IBM Plex Mono** for rule IDs, cell
  names and dial readouts. The machine-checkable things get the machine face.
- **Flat colour fields, no outlines.** Mailchimp never outlines a card. Large
  shapes are defined by fill alone. Interior controls, where fill is not enough
  at small sizes, carry a warm 1px hairline `#e4dccb`.
- **Light only.** No dark theme and no `prefers-color-scheme` block. The reference
  identity is light-first, and the page renders identically for every viewer.
  Every colour is defined once on bare `:root`; `body` paints its own background.
- **Dials are four discrete blocks**, never a smooth bar, because they are
  integers 0 to 4 and a bar would imply otherwise. Gate-locked cells use diagonal
  hatching borrowed from proof-correction marks.
- **Structure encodes content.** Sections carry eyebrows rather than numbers,
  because they are not a sequence. The start guide is numbered, because it is.

## 6. Copy rules

- **No em dashes.** House rule. Each one was rewritten rather than re-punctuated,
  since an em dash usually hides either a comma splice or two sentences pretending
  to be one.
- **Type floor.** Nothing renders below 12.8px. Body small text sits at 14.1 to
  15.2px, uppercase micro-labels at 12.8 to 13.1px.
- **Balanced wrapping.** `text-wrap: balance` plus a `ch` cap on short standalone
  paragraphs, `text-wrap: pretty` on longer body copy. The cap matters: `balance`
  is a no-op on a line that already fits, so a wide container needs a width limit
  before there is anything to balance.
- **Counts are verified against the repository**, not remembered. `5 scripts` was
  wrong: there are 5 CLI scripts and 11 shared modules, 16 `.mjs` files in total.

## 7. Attribution

The closer the visual gets to Mailchimp's, the more work the disclaimer does.

- A yellow button in the header links to
  <https://styleguide.mailchimp.com/voice-and-tone/>.
- The hero eyebrow names the framework and links to it again.
- A filled pill in the hero reads **Not affiliated with Mailchimp**.
- The footer carries the full CC BY-NC 4.0 statement and the dual licence.
- No logo, no wordmark, no claim of endorsement. Palette and type feel are
  lineage; a logo would be impersonation.

## 8. Technical constraints

- One file. No build step, no bundler, no npm. Opening it from disk works.
- Vanilla JS in a single inline `<script>`.
- The matrix computes from the real vectors and offsets in
  `templates/kb/tone.md`, so the page shows what the plugin actually does. The
  clamp and both gates are reimplemented in about fifteen lines mirroring
  `kb.mjs`, with a source comment naming the file the truth lives in. This is a
  deliberate small debt: the page can drift from the plugin, where describing the
  arithmetic in prose would drift immediately and invisibly.
- Keyboard navigable: the matrix is a grid of real buttons, arrow keys move,
  Enter selects. Scroll spy marks the current section with `aria-current`.
- Respects `prefers-reduced-motion`. External links carry `rel="noopener noreferrer"`.
- No external requests beyond the Google Fonts stylesheet.

## 9. Deliberately out of scope

- The 19-task build history, the review loop, the rulings. Interesting to the
  people who built it, irrelevant to someone learning what it does.
- Per-metric detail of the fingerprint. "It measures your corpus" plus two
  examples is the right altitude.
- Locale-pack internals. One line that packs exist, and that they split typography
  from brand opinion, is enough.
- The plugin's own test suite. A count was tried in the hero and removed: it is a
  fact about the build, not about what the plugin does.

## 10. Resolved

The plan asked whether the fresh-context critic and its read-back test deserved
their own interactive section. **Resolved: no.** It keeps two lines inside the
Surface section. Three interactions already carry the page, and a fourth would
have made the read-back test compete with the tone matrix for the same attention.
