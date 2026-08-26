# Voice & Tone Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, project-agnostic Claude Code plugin that discovers, canonizes, applies, and maintains a brand's voice and tone from evidence-backed rules stored in the target project.

**Architecture:** Five zero-dependency Node scripts provide deterministic ground truth (file scanning, corpus metrics, KB parsing/validation, context compilation, mechanical diffing). Five skills and one fresh-context agent provide the model-side judgement. The two never do each other's job: scripts measure, the model interprets. Everything the model asserts is anchored to a numbered evidence entry and a confidence level, and that single axis drives interview priority, review severity, and rule retirement.

**Tech Stack:** Node >= 18 (ESM `.mjs`, zero npm dependencies, `node:test` for tests), Markdown for all knowledge-base and skill files, a hand-rolled minimal YAML subset parser for `config.yml`.

**Spec:** `docs/superpowers/specs/2026-08-26-voice-and-tone-plugin-design.md`

## Global Constraints

These apply to every task. Copied verbatim from the spec where the spec states a value.

**Resolved open questions (§13), decided before planning:**
- Plugin name is `voice-and-tone`. Commands are `/voice-and-tone:init`, `:write`, `:review`, `:rewrite`, `:learn`, `:audit`, `:sync`, `:localize`.
- License: MIT for `scripts/`, CC BY-NC 4.0 for method docs. `LICENSE` states both and says which paths each covers.
- `.drafts/` is gitignored by the generated KB and pruned at 90 days.
- First `:write` to a new channel generates the tone cell only; the full channel playbook is generated on second use.

**Cross-platform (spec §9) — hard rules, no exceptions:**
- Invoke scripts as `node "<absolute path>"`. Never `./script.mjs`. No shebangs relied upon.
- **Zero** use of `grep`, `find`, `sed`, `awk`, `cat` in plugin logic. All file walking and text processing happens in JS.
- `path.join()` everywhere. No literal `/` in constructed filesystem paths.
- Scripts write UTF-8 **files** and print **only ASCII** to stdout.
- Normalize line endings (`\r\n` -> `\n`, and lone `\r` -> `\n`) on read before computing any metric.
- No symlinks in the plugin tree.

**Runtime:**
- Node >= 18. Zero npm dependencies, ever. `node:test` + `node:assert/strict` are the only test tooling.
- Every script accepts `--kb <dir>` (defaults to `.voice-and-tone` under cwd) and `--help`.
- Exit codes: `0` success, `1` unexpected error, `2` validation/integrity failures.

**Attribution (spec §2):**
- Encode method and structure only. **No substantial verbatim prose from Mailchimp's guide** in the plugin or in anything it generates.
- Attribution appears in plugin `README.md`, top-level `ATTRIBUTION.md`, and the header of every generated `CONTEXT.md`.
- Attribution wording states: built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0); not affiliated with or endorsed by Mailchimp.

**Fixed vocabularies — used identically in every task:**
- Confidence levels: `confirmed`, `derived`, `assumed`, `disputed`.
- Evidence types: `source`, `corpus`, `interview`, `correction`, `decision`.
- Rule ID prefixes: `V` voice, `T` tone cell, `L` lexicon, `M` mechanics, `C` channel, `A` audience, `X` locale. Evidence IDs are `e` + monotonic integer. IDs are never reused.
- Reader emotional states (8): `delighted`, `curious`, `focused`, `uncertain`, `confused`, `frustrated`, `anxious-at-risk`, `disappointed-leaving`.
- Contexts (10): `marketing-page`, `product-ui`, `system-error`, `help-doc`, `email`, `social`, `legal-policy`, `notification`, `support-reply`, `release-notes`.
- Dials (6), integer 0-4: `warmth`, `humor`, `directness`, `detail`, `urgency`, `formality`.
- States forcing `humor: 0` regardless of arithmetic: `frustrated`, `anxious-at-risk`, `disappointed-leaving`.
- Tone cell IDs are `T-<context>/<state>`, e.g. `T-product-ui/confused`.

> Note: the spec writes the last two states as `anxious/at-risk` and `disappointed/leaving`. A `/` inside a cell ID would collide with the `T-<context>/<state>` separator and with filesystem paths, so the canonical machine tokens are `anxious-at-risk` and `disappointed-leaving`. Human-facing prose may still render them with a slash.

**Precedence (spec §11) — stated in every skill:**
1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

---

## File Structure

Plugin tree (this repo). Every file listed is created by a task below.

```
ai-voice-and-tone/
  .claude-plugin/plugin.json      plugin manifest: name, version, description, author
  .gitignore                      node/OS noise only; the plugin has no build output
  package.json                    private, type=module, engines>=18, test script. No deps.
  LICENSE                         dual: MIT for scripts/, CC BY-NC 4.0 for docs
  ATTRIBUTION.md                  Mailchimp framework credit + source-fidelity note
  README.md                       what it is, install, the 8 commands, the KB layout

  commands/                       thin dispatchers; each names the skill it invokes
    init.md  write.md  review.md  rewrite.md
    learn.md audit.md  sync.md    localize.md

  skills/
    voice-discovery/SKILL.md            scan -> measure -> draft -> interview -> canonize
      references/interview-method.md    preference-pair construction, leverage ranking
      references/gap-analysis.md        which KB slot maps to which question
      references/locale-seed.md         mechanical locale seeds (typography, not opinion)
    voice-and-tone/SKILL.md             the core applier (:write, :rewrite)
      references/write-flow.md          the §8.6 flow, step by step
      references/interpolation.md       state vectors + context offsets + humor gates
      references/always-on-layers.md    accessibility + translation-readiness
    voice-review/SKILL.md               critique with severities (:review)
      references/severity.md            confidence -> severity, plus the two overrides
      references/finding-format.md      file:line anchored markdown findings
    microcopy/SKILL.md                  buttons, errors, empty states, notifications
      references/patterns.md            length budgets and shape per element type
    voice-maintenance/SKILL.md          :learn, :audit, :sync
      references/correction-classes.md  the five edit classes and corroboration rule
      references/audit-report.md        coverage / drift / rule health / inventory

  agents/voice-critic.md          fresh-context critic + the read-back test

  scripts/
    lib/yaml.mjs                  minimal YAML subset parse/stringify
    lib/glob.mjs                  glob -> RegExp, posix paths only
    lib/fsx.mjs                   walk, read (EOL-normalized), write (UTF-8), toPosix
    lib/text.mjs                  paragraph/sentence/word segmentation, EN syllables
    lib/extract.mjs               copy extraction per format (md, json, yaml, po, html, txt)
    lib/config.mjs                config defaults, load, save, KB root resolution
    lib/metrics.mjs               universal + English-only corpus metrics
    lib/kb.mjs                    KB markdown parsers + interpolation + vocabularies
    scan.mjs                      -> evidence/manifest.json
    fingerprint.mjs               -> evidence/fingerprint.json (per locale)
    compile-context.mjs           -> CONTEXT.md
    validate.mjs                  -> integrity report, exit 2 on failure
    diff.mjs                      -> mechanical draft->final deltas

  templates/kb/                   skeletons copied into the target project by :init
    config.yml  CONTEXT.md  voice.md  tone.md  audience.md
    lexicon.md  mechanics.md  CHANGELOG.md  gitignore
    evidence/ledger.md  evidence/conflicts.md  evidence/fingerprint.json
    examples/approved.md  examples/rejected.md  examples/pairs.md
    channels/_template.md  locales/_template.md

  test/                           node:test, one file per lib/script
    yaml.test.mjs  glob.test.mjs  fsx.test.mjs  text.test.mjs
    extract.test.mjs config.test.mjs metrics.test.mjs kb.test.mjs
    scan.test.mjs  fingerprint.test.mjs compile-context.test.mjs
    validate.test.mjs diff.test.mjs
    templates.test.mjs            every template parses with lib/kb + lib/yaml
    conformance.test.mjs          §9 cross-platform rules, enforced mechanically
    helpers/tmp.mjs               make/remove a temp project fixture

  docs/superpowers/specs/2026-08-26-voice-and-tone-plugin-design.md   (exists)
  docs/superpowers/plans/2026-08-26-voice-and-tone-plugin.md          (this file)
```

Knowledge base tree — **generated into the target project**, never into the plugin. Exactly spec §4.2.

```
<target-project>/.voice-and-tone/
  config.yml  CONTEXT.md  voice.md  tone.md  audience.md  lexicon.md  mechanics.md
  channels/<name>.md   locales/<code>.md
  examples/{approved,rejected,pairs}.md
  evidence/{ledger.md,fingerprint.json,conflicts.md,manifest.json}
  .drafts/   CHANGELOG.md   .gitignore
```

`evidence/manifest.json` is the one addition to the spec's §4.2 layout: `scan.mjs` needs somewhere to persist its output, and `evidence/` is where measured facts already live.

**Dependency order.** `lib/` bottom-up (yaml, glob, fsx, text, extract, config, metrics, kb), then the scripts that consume them, then templates (validated by the parsers), then the model-side surface (agent, skills, commands), then the docs and conformance sweep.

---

### Task 1: Repo scaffolding, manifest, licensing, test harness

Establishes the plugin identity and the test vehicle every later task depends on. Nothing here is voice-and-tone logic; it is the frame.

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `package.json`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `ATTRIBUTION.md`
- Create: `test/helpers/tmp.mjs`
- Test: `test/manifest.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `test/helpers/tmp.mjs` exporting `makeTmpProject(files) -> string` (absolute path to a fresh temp dir seeded with the given `{relPath: contents}` map) and `cleanup(dir) -> void`. Every later test file imports these two.

- [ ] **Step 1: Write the failing test**

`test/manifest.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('plugin manifest declares the voice-and-tone plugin', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')
  )
  assert.equal(manifest.name, 'voice-and-tone')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.ok(manifest.description.length > 20)
})

test('package.json pins the runtime floor and stays dependency-free', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.devDependencies, undefined)
  assert.match(pkg.engines.node, /18/)
})

test('licensing and attribution ship at the repo root', () => {
  for (const file of ['LICENSE', 'ATTRIBUTION.md']) {
    assert.ok(existsSync(path.join(root, file)), `${file} is missing`)
  }
  const license = readFileSync(path.join(root, 'LICENSE'), 'utf8')
  assert.match(license, /MIT/)
  assert.match(license, /CC BY-NC 4\.0/)
  assert.match(license, /scripts\//)

  const attribution = readFileSync(path.join(root, 'ATTRIBUTION.md'), 'utf8')
  assert.match(attribution, /not affiliated with or endorsed by Mailchimp/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/manifest.test.mjs`
Expected: FAIL with `ENOENT: no such file or directory, open '.../.claude-plugin/plugin.json'`

- [ ] **Step 3: Write the manifest and package files**

`.claude-plugin/plugin.json`:

```json
{
  "name": "voice-and-tone",
  "version": "0.1.0",
  "description": "Build, maintain, and apply a brand's voice and tone on any project. Every rule carries its evidence and a confidence level, so the guide can be proved rather than recited. Built on Mailchimp's Voice and Tone framework.",
  "author": {
    "name": "Pavol Hudran"
  }
}
```

`package.json`:

```json
{
  "name": "voice-and-tone-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Tests and zero-dependency scripts for the voice-and-tone Claude Code plugin.",
  "engines": {
    "node": ">=18.13.0"
  },
  "scripts": {
    "test": "node --test test/"
  }
}
```

`.gitignore`:

```gitignore
node_modules/
.DS_Store
Thumbs.db
*.log
.tmp/
```

- [ ] **Step 4: Write LICENSE**

`LICENSE`:

```
This repository is dual-licensed. Which license applies depends on the path.

===============================================================================
scripts/ and test/ - MIT License
===============================================================================

Copyright (c) 2026 Pavol Hudran

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

===============================================================================
Everything else - CC BY-NC 4.0
===============================================================================

The method documentation - commands/, skills/, agents/, templates/, README.md,
ATTRIBUTION.md, and docs/ - is licensed under the Creative Commons
Attribution-NonCommercial 4.0 International License.

You may share and adapt this material for non-commercial purposes, provided you
give appropriate credit and indicate if changes were made.

Full text: https://creativecommons.org/licenses/by-nc/4.0/legalcode

This material adapts the method and structure of Mailchimp's Content Style
Guide, which is itself published under CC BY-NC 4.0. See ATTRIBUTION.md.
```

- [ ] **Step 5: Write ATTRIBUTION.md**

`ATTRIBUTION.md`:

```markdown
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
```

- [ ] **Step 6: Write the test helper**

`test/helpers/tmp.mjs`:

```js
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Create a throwaway project directory seeded with files.
 * @param {Record<string, string>} files - relative POSIX-ish path -> contents
 * @returns {string} absolute path to the new directory
 */
export function makeTmpProject (files = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vat-'))
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'))
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, contents, 'utf8')
  }
  return dir
}

export function cleanup (dir) {
  rmSync(dir, { recursive: true, force: true })
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test test/manifest.test.mjs`
Expected: PASS, 3 tests

- [ ] **Step 8: Commit**

```bash
git add .claude-plugin package.json .gitignore LICENSE ATTRIBUTION.md test
git commit -m "chore: scaffold voice-and-tone plugin, licensing, and test harness"
```

---

### Task 2: Minimal YAML subset parser

`config.yml` is the only YAML the plugin reads, and the plugin may take no dependencies. A full YAML implementation is not needed and is a liability; a documented subset is. The parser must reject what it does not understand rather than guessing, because a silently mis-parsed `scan.exclude` would let the fingerprint eat `node_modules`.

**Files:**
- Create: `scripts/lib/yaml.mjs`
- Test: `test/yaml.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseYaml(source: string) -> object` - throws `Error` with a line number on unsupported syntax.
  - `stringifyYaml(value: object) -> string` - 2-space indent, `\n` endings, trailing newline.

Supported subset, documented in a header comment in the file: nested block maps with 2-space indent; block sequences of scalars (`- item`); inline flow sequences (`[a, b]`); block scalars (`|` literal, `>` folded); scalars typed as integer, `true`/`false`, `null` (bare `~` or empty), otherwise string; single- and double-quoted strings; `#` comments (whole-line, and after a value when preceded by whitespace); blank lines. Unsupported and throwing: anchors/aliases, multiple documents, sequences of maps, tabs for indentation.

**Why block scalars are in the subset.** Claude Code skill and agent frontmatter uses `description: >` throughout, and this plugin's own surface tests parse its own frontmatter with this parser. A user's `config.yml` carrying a block scalar would otherwise hard-fail inside `loadConfig`.

- [ ] **Step 1: Write the failing test**

`test/yaml.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseYaml, stringifyYaml } from '../scripts/lib/yaml.mjs'

test('parses the shape of config.yml', () => {
  const src = [
    'version: 1',
    'kb_version: 0.1.0',
    'profiles:',
    '  default:',
    '    name: "Acme"',
    '    primary_locale: en',
    '    locales: [en, cs]',
    'scan:',
    '  include:',
    '    - "content/**/*.md"',
    '    - "locales/**/*.json"',
    '  exclude: ["node_modules/**"]',
    'runtime:',
    '  node: detected   # probed once',
    'thresholds:',
    '  corroboration: 2',
    '  derived_min_samples: 5'
  ].join('\n')

  const got = parseYaml(src)
  assert.equal(got.version, 1)
  assert.equal(got.kb_version, '0.1.0')
  assert.equal(got.profiles.default.name, 'Acme')
  assert.deepEqual(got.profiles.default.locales, ['en', 'cs'])
  assert.deepEqual(got.scan.include, ['content/**/*.md', 'locales/**/*.json'])
  assert.deepEqual(got.scan.exclude, ['node_modules/**'])
  assert.equal(got.runtime.node, 'detected')
  assert.equal(got.thresholds.corroboration, 2)
})

test('types scalars without swallowing version-like strings', () => {
  const got = parseYaml('a: 1\nb: true\nc: false\nd: ~\ne:\nf: 0.1.0\ng: "2"')
  assert.equal(got.a, 1)
  assert.equal(got.b, true)
  assert.equal(got.c, false)
  assert.equal(got.d, null)
  assert.equal(got.e, null)
  assert.equal(got.f, '0.1.0')
  assert.equal(got.g, '2')
})

test('strips comments but keeps # inside quotes', () => {
  const got = parseYaml('a: plain # trailing\nb: "has # hash"\n# whole line\nc: 3')
  assert.equal(got.a, 'plain')
  assert.equal(got.b, 'has # hash')
  assert.equal(got.c, 3)
})

test('block scalars fold and preserve, and end at the dedent', () => {
  const folded = parseYaml('a: 1\nb: >\n  one\n  two\nc: 3\n')
  assert.equal(folded.b, 'one two', 'a folded scalar joins its lines with spaces')
  assert.equal(folded.c, 3, 'the block ends where the indentation drops')

  const literal = parseYaml('a: |\n  one\n  two\n')
  assert.equal(literal.a, 'one\ntwo', 'a literal scalar keeps its newlines')
})

test('folded scalars carry skill frontmatter, blank line and all', () => {
  const src = [
    'name: voice-discovery',
    'description: >',
    '  WHEN: no knowledge base exists yet.',
    '  WHAT: runs the discovery pipeline.',
    'tools: Read, Glob, Grep'
  ].join('\n')
  const got = parseYaml(src)
  assert.equal(got.name, 'voice-discovery')
  assert.equal(got.description, 'WHEN: no knowledge base exists yet. WHAT: runs the discovery pipeline.')
  assert.equal(got.tools, 'Read, Glob, Grep')
})

test('throws with a line number on unsupported syntax', () => {
  assert.throws(() => parseYaml('a: 1\n\tb: 2'), /line 2/)
  assert.throws(() => parseYaml('a: &anchor 1'), /line 1/)
  assert.throws(() => parseYaml('a: 1\n--- \nb: 2'), /line 2/)
})

test('round-trips through stringify', () => {
  const value = {
    version: 1,
    profiles: { default: { name: 'Acme', locales: ['en', 'cs'] } },
    thresholds: { corroboration: 2 }
  }
  assert.deepEqual(parseYaml(stringifyYaml(value)), value)
})

test('stringify ends with exactly one newline and uses two-space indent', () => {
  const out = stringifyYaml({ a: { b: 1 } })
  assert.equal(out, 'a:\n  b: 1\n')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/yaml.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/yaml.mjs'`

- [ ] **Step 3: Implement the parser**

`scripts/lib/yaml.mjs`:

```js
/**
 * Minimal YAML subset, sufficient for .voice-and-tone/config.yml.
 * Zero dependencies by design (see spec section 9).
 *
 * Supported: nested block maps (2-space indent), block sequences of scalars,
 * inline flow sequences [a, b], block scalars (| literal, > folded),
 * single/double-quoted strings, integers, true/false, null (~ or empty),
 * # comments, blank lines.
 *
 * Block scalars are in the subset because Claude Code skill and agent
 * frontmatter uses `description: >`, and this plugin parses its own frontmatter.
 *
 * Unsupported and rejected with a line number: anchors and aliases, multiple
 * documents, sequences of maps, tab indentation.
 */

const UNSUPPORTED = [
  [/^\s*---\s*$/, 'multiple documents'],
  [/^\s*\.\.\.\s*$/, 'document end marker'],
  [/:\s*[&*]\S/, 'anchors and aliases']
]

const BLOCK_SCALAR = /^([|>])([-+])?\d*\s*$/

function fail (lineNo, message) {
  throw new Error(`yaml: line ${lineNo}: ${message}`)
}

function stripComment (raw) {
  let out = ''
  let quote = null
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (quote) {
      out += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue }
    if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1]))) break
    out += ch
  }
  return out.replace(/\s+$/, '')
}

function parseScalar (raw, lineNo) {
  const text = raw.trim()
  if (text === '') return null
  if (text === '~' || text === 'null') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^-?\d+$/.test(text)) return Number(text)
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) fail(lineNo, 'unterminated flow sequence')
    const inner = text.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((part) => parseScalar(part, lineNo))
  }
  if (text.startsWith('{')) fail(lineNo, 'flow mappings are not supported')
  const quoted = /^"(.*)"$|^'(.*)'$/.exec(text)
  if (quoted) return quoted[1] !== undefined ? quoted[1] : quoted[2]
  return text
}

export function parseYaml (source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n')
  const root = {}
  // Each frame owns a container and the indent its children sit at.
  const stack = [{ indent: -1, container: root }]
  // Lines already swallowed by a block scalar; skipped rather than re-parsed.
  let consumeUntil = -1

  lines.forEach((raw, index) => {
    if (index <= consumeUntil) return
    const lineNo = index + 1
    if (raw.includes('\t')) fail(lineNo, 'tab indentation is not supported')
    for (const [pattern, what] of UNSUPPORTED) {
      if (pattern.test(raw)) fail(lineNo, `${what} are not supported`)
    }

    const line = stripComment(raw)
    if (line.trim() === '') return

    const indent = line.length - line.trimStart().length
    if (indent % 2 !== 0) fail(lineNo, 'indentation must be a multiple of two spaces')
    const body = line.trim()

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1].container

    if (body.startsWith('- ') || body === '-') {
      if (!Array.isArray(parent)) fail(lineNo, 'sequence item outside a sequence')
      const item = body === '-' ? null : body.slice(2)
      if (item !== null && /:\s/.test(item)) fail(lineNo, 'sequences of maps are not supported')
      parent.push(parseScalar(item ?? '', lineNo))
      return
    }

    const split = /^([^:]+):(.*)$/.exec(body)
    if (!split) fail(lineNo, `cannot parse "${body}"`)
    const key = split[1].trim().replace(/^["']|["']$/g, '')
    const rest = split[2].trim()

    if (Array.isArray(parent)) fail(lineNo, 'mapping key inside a sequence')

    const block = BLOCK_SCALAR.exec(rest)
    if (block) {
      // Consume every following line indented deeper than this key.
      const collected = []
      let end = index + 1
      let blockIndent = null
      for (; end < lines.length; end++) {
        const candidate = lines[end]
        if (candidate.trim() === '') { collected.push(''); continue }
        const candidateIndent = candidate.length - candidate.trimStart().length
        if (candidateIndent <= indent) break
        if (blockIndent === null) blockIndent = candidateIndent
        collected.push(candidate.slice(blockIndent))
      }
      while (collected.length && collected[collected.length - 1] === '') collected.pop()

      const value = block[1] === '|'
        ? collected.join('\n')
        : collected.reduce((acc, line) => {
            if (line === '') return `${acc}\n`
            if (acc === '' || acc.endsWith('\n')) return acc + line
            return `${acc} ${line}`
          }, '')

      parent[key] = block[2] === '+' ? `${value}\n` : value
      consumeUntil = end - 1
      return
    }

    if (rest === '') {
      // Container: a nested map, or a block sequence. Decide by peeking ahead.
      let next = null
      for (let j = index + 1; j < lines.length; j++) {
        const peek = stripComment(lines[j])
        if (peek.trim() === '') continue
        next = peek
        break
      }
      const nextIndent = next ? next.length - next.trimStart().length : -1
      const isSequence = next !== null && nextIndent > indent && next.trim().startsWith('-')
      const container = isSequence ? [] : {}
      parent[key] = container
      stack.push({ indent, container })
      return
    }

    parent[key] = parseScalar(rest, lineNo)
  })

  return root
}

function stringifyScalar (value) {
  if (value === null || value === undefined) return '~'
  if (typeof value === 'string' && value.includes('\n')) {
    throw new Error('yaml: use stringifyYaml for multi-line strings, not a scalar position')
  }
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const text = String(value)
  const needsQuotes =
    text === '' ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(text) ||
    /:\s|\s#/.test(text) ||
    /^(true|false|null|~)$/.test(text) ||
    /^-?\d+$/.test(text)
  return needsQuotes ? `"${text.replace(/"/g, '\\"')}"` : text
}

export function stringifyYaml (value, depth = 0) {
  const pad = '  '.repeat(depth)
  let out = ''
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) {
      if (child.length === 0) { out += `${pad}${key}: []\n`; continue }
      out += `${pad}${key}:\n`
      for (const item of child) out += `${pad}  - ${stringifyScalar(item)}\n`
      continue
    }
    if (child && typeof child === 'object') {
      out += `${pad}${key}:\n${stringifyYaml(child, depth + 1)}`
      continue
    }
    if (typeof child === 'string' && child.includes('\n')) {
      out += `${pad}${key}: |\n`
      for (const line of child.split('\n')) out += `${pad}  ${line}\n`
      continue
    }
    out += `${pad}${key}: ${stringifyScalar(child)}\n`
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/yaml.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/yaml.mjs test/yaml.test.mjs
git commit -m "feat(lib): minimal zero-dependency YAML subset parser for config.yml"
```

---

### Task 3: Glob matching and filesystem walking

Spec §9 forbids `find`, so directory traversal is JS. `scan.include`/`scan.exclude` are globs, so a glob matcher is needed. Excludes must **prune** directories rather than filter results afterwards, or scanning a repo with `node_modules` takes minutes instead of milliseconds.

**Files:**
- Create: `scripts/lib/glob.mjs`
- Create: `scripts/lib/fsx.mjs`
- Test: `test/glob.test.mjs`
- Test: `test/fsx.test.mjs`

**Interfaces:**
- Consumes: `test/helpers/tmp.mjs` from Task 1.
- Produces:
  - `glob.mjs`: `globToRegExp(pattern: string) -> RegExp` (anchored, POSIX separators only); `matchesAny(relPosixPath: string, patterns: string[]) -> boolean`.
  - `fsx.mjs`: `toPosix(p: string) -> string`; `walk(rootDir: string, {include: string[], exclude: string[]}) -> string[]` (absolute paths, sorted by POSIX relative path, symlinks skipped); `readTextFile(abs: string) -> string` (UTF-8, BOM stripped, EOL normalized); `writeTextFile(abs: string, contents: string) -> void` (creates parent dirs, writes UTF-8 with `\n` endings).

- [ ] **Step 1: Write the failing glob test**

`test/glob.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { globToRegExp, matchesAny } from '../scripts/lib/glob.mjs'

test('* stops at a path separator, ** crosses it', () => {
  assert.ok(globToRegExp('content/*.md').test('content/a.md'))
  assert.ok(!globToRegExp('content/*.md').test('content/nested/a.md'))
  assert.ok(globToRegExp('content/**/*.md').test('content/a.md'))
  assert.ok(globToRegExp('content/**/*.md').test('content/deep/nested/a.md'))
  assert.ok(globToRegExp('node_modules/**').test('node_modules/pkg/index.js'))
  assert.ok(globToRegExp('**/*.json').test('locales/en/common.json'))
})

test('braces expand and ? matches one non-separator character', () => {
  const re = globToRegExp('src/*.{md,mdx}')
  assert.ok(re.test('src/a.md'))
  assert.ok(re.test('src/a.mdx'))
  assert.ok(!re.test('src/a.txt'))
  assert.ok(globToRegExp('v?.md').test('v1.md'))
  assert.ok(!globToRegExp('v?.md').test('v12.md'))
})

test('regex metacharacters in the pattern are literal', () => {
  assert.ok(globToRegExp('docs/a.b.md').test('docs/a.b.md'))
  assert.ok(!globToRegExp('docs/a.b.md').test('docs/axbxmd'))
  assert.ok(globToRegExp('a+b/c.md').test('a+b/c.md'))
})

test('matchesAny short-circuits over a list', () => {
  assert.ok(matchesAny('dist/app.js', ['node_modules/**', 'dist/**']))
  assert.ok(!matchesAny('src/app.js', ['node_modules/**', 'dist/**']))
  assert.ok(!matchesAny('src/app.js', []))
})
```

- [ ] **Step 2: Write the failing fsx test**

`test/fsx.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { walk, readTextFile, writeTextFile, toPosix } from '../scripts/lib/fsx.mjs'

test('walk includes matches, prunes excluded directories, and sorts', () => {
  const dir = makeTmpProject({
    'content/b.md': 'b',
    'content/a.md': 'a',
    'content/deep/c.md': 'c',
    'content/notes.txt': 'skip me',
    'node_modules/pkg/readme.md': 'never'
  })
  try {
    const found = walk(dir, {
      include: ['content/**/*.md'],
      exclude: ['node_modules/**']
    }).map((abs) => toPosix(path.relative(dir, abs)))
    assert.deepEqual(found, ['content/a.md', 'content/b.md', 'content/deep/c.md'])
  } finally {
    cleanup(dir)
  }
})

test('walk with no include patterns returns nothing', () => {
  const dir = makeTmpProject({ 'a.md': 'a' })
  try {
    assert.deepEqual(walk(dir, { include: [], exclude: [] }), [])
  } finally {
    cleanup(dir)
  }
})

test('readTextFile strips the BOM and normalizes CRLF and lone CR', () => {
  const dir = makeTmpProject({ 'a.md': '\uFEFFone\r\ntwo\rthree\n' })
  try {
    assert.equal(readTextFile(path.join(dir, 'a.md')), 'one\ntwo\nthree\n')
  } finally {
    cleanup(dir)
  }
})

test('writeTextFile creates parent directories and writes LF endings', () => {
  const dir = makeTmpProject({})
  try {
    const target = path.join(dir, 'evidence', 'nested', 'out.md')
    writeTextFile(target, 'a\r\nb\n')
    assert.equal(readFileSync(target, 'utf8'), 'a\nb\n')
  } finally {
    cleanup(dir)
  }
})

test('toPosix converts Windows separators', () => {
  assert.equal(toPosix('a\\b\\c.md'), 'a/b/c.md')
  assert.equal(toPosix('a/b/c.md'), 'a/b/c.md')
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `node --test test/glob.test.mjs test/fsx.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/glob.mjs'`

- [ ] **Step 4: Implement glob.mjs**

`scripts/lib/glob.mjs`:

```js
/**
 * Tiny glob matcher. Patterns and paths are always POSIX-separated; callers
 * convert with fsx.toPosix first (spec section 9 forbids literal separators in
 * constructed paths, and forbids shelling out to find).
 *
 * Supported: * (within one segment), ** (across segments), ?, {a,b} alternation.
 */

const REGEX_SPECIALS = /[.+^$()|[\]\\]/g

export function globToRegExp (pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // "**/" may match zero segments, so "content/**/*.md" also matches
        // "content/a.md". A bare "**" matches anything including separators.
        if (pattern[i + 2] === '/') { out += '(?:[^/]*\\/)*'; i += 2 } else { out += '.*'; i += 1 }
      } else {
        out += '[^/]*'
      }
      continue
    }
    if (ch === '?') { out += '[^/]'; continue }
    if (ch === '{') {
      const close = pattern.indexOf('}', i)
      if (close !== -1) {
        const alts = pattern.slice(i + 1, close).split(',')
        out += `(?:${alts.map((a) => a.replace(REGEX_SPECIALS, '\\$&')).join('|')})`
        i = close
        continue
      }
    }
    out += ch.replace(REGEX_SPECIALS, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

export function matchesAny (relPosixPath, patterns) {
  for (const pattern of patterns) {
    if (globToRegExp(pattern).test(relPosixPath)) return true
  }
  return false
}
```

- [ ] **Step 5: Implement fsx.mjs**

`scripts/lib/fsx.mjs`:

```js
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { matchesAny } from './glob.mjs'

/** Filesystem paths use path.sep; glob matching uses POSIX. This bridges them. */
export function toPosix (p) {
  return String(p).split(path.sep).join('/').split('\\').join('/')
}

// A directory is pruned when an exclude pattern would match anything inside it.
// Probing with a sentinel child generalizes to "dist/**", "**/node_modules/**",
// and anything else, without special-casing pattern shapes.
function isPrunedDir (relPosix, exclude) {
  return matchesAny(`${relPosix}/__vat_probe__`, exclude) || matchesAny(relPosix, exclude)
}

export function walk (rootDir, { include = [], exclude = [] } = {}) {
  if (include.length === 0) return []
  const found = []

  const visit = (absDir, relPosix) => {
    let entries
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return // unreadable directory is not fatal to a scan
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue // spec section 9: no symlinks
      const childRel = relPosix ? `${relPosix}/${entry.name}` : entry.name
      const childAbs = path.join(absDir, entry.name)
      if (entry.isDirectory()) {
        if (isPrunedDir(childRel, exclude)) continue
        visit(childAbs, childRel)
        continue
      }
      if (!entry.isFile()) continue
      if (matchesAny(childRel, exclude)) continue
      if (!matchesAny(childRel, include)) continue
      found.push({ abs: childAbs, rel: childRel })
    }
  }

  visit(rootDir, '')
  found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return found.map((f) => f.abs)
}

export function readTextFile (abs) {
  const raw = readFileSync(abs, 'utf8')
  return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

export function writeTextFile (abs, contents) {
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, String(contents).replace(/\r\n?/g, '\n'), 'utf8')
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/glob.test.mjs test/fsx.test.mjs`
Expected: PASS, 9 tests

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/glob.mjs scripts/lib/fsx.mjs test/glob.test.mjs test/fsx.test.mjs
git commit -m "feat(lib): glob matching and pruning filesystem walk"
```

---

### Task 4: Text segmentation

Every metric in §5.3 is a ratio over sentences, words, or paragraphs. If segmentation is wrong the whole fingerprint is wrong, and worse, it is wrong *confidently* - which is the failure the evidence model exists to prevent. Abbreviations and initials are the two cases that break naive splitting on `.`.

**Files:**
- Create: `scripts/lib/text.mjs`
- Test: `test/text.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeEol(s) -> string`; `splitParagraphs(text) -> string[]`; `splitSentences(text) -> string[]` (terminators retained); `splitWords(text) -> string[]` (Unicode letters/digits, apostrophes and inner hyphens kept); `countSyllablesEn(word) -> number`.

- [ ] **Step 1: Write the failing test**

`test/text.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeEol, splitParagraphs, splitSentences, splitWords, countSyllablesEn
} from '../scripts/lib/text.mjs'

test('normalizeEol folds CRLF and lone CR', () => {
  assert.equal(normalizeEol('a\r\nb\rc\n'), 'a\nb\nc\n')
})

test('paragraphs split on blank lines and drop empties', () => {
  assert.deepEqual(splitParagraphs('one\nstill one\n\n\ntwo\n\n'), ['one\nstill one', 'two'])
})

test('sentences keep their terminator', () => {
  assert.deepEqual(
    splitSentences('Your campaign is scheduled. Nice work! Ready?'),
    ['Your campaign is scheduled.', 'Nice work!', 'Ready?']
  )
})

test('sentences do not split on abbreviations or initials', () => {
  assert.deepEqual(splitSentences('Ask Dr. Smith about it.'), ['Ask Dr. Smith about it.'])
  assert.deepEqual(splitSentences('Contact J. Smith today.'), ['Contact J. Smith today.'])
  assert.deepEqual(
    splitSentences('Use commas, semicolons, etc. Then stop.'),
    ['Use commas, semicolons, etc. Then stop.']
  )
})

test('sentences absorb a trailing closing quote', () => {
  assert.deepEqual(
    splitSentences('She said "go." Then she left.'),
    ['She said "go."', 'Then she left.']
  )
})

test('words are Unicode-aware and keep internal punctuation', () => {
  assert.deepEqual(splitWords("Don't over-promise, prosím."), ["Don't", 'over-promise', 'prosím'])
  assert.deepEqual(splitWords('--- *** 42'), ['42'])
})

test('English syllable counting is close enough for a reading grade', () => {
  assert.equal(countSyllablesEn('the'), 1)
  assert.equal(countSyllablesEn('campaign'), 2)
  assert.equal(countSyllablesEn('scheduled'), 2)
  assert.equal(countSyllablesEn('accessibility'), 6)
  assert.equal(countSyllablesEn(''), 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/text.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/text.mjs'`

- [ ] **Step 3: Implement text.mjs**

`scripts/lib/text.mjs`:

```js
/** Segmentation shared by every metric. Language-neutral unless a name says En. */

// Abbreviations that end in a period without ending a sentence. Deliberately
// short: a long list starts suppressing real sentence breaks.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'vs', 'etc', 'fig', 'no', 'inc', 'ltd',
  'co', 'jr', 'sr', 'approx', 'dept', 'est', 'vol', 'al', 'e.g', 'i.e'
])
const CLOSERS = '"\')]\u00bb\u201d\u2019'

export function normalizeEol (s) {
  return String(s).replace(/\r\n?/g, '\n')
}

export function splitParagraphs (text) {
  return normalizeEol(text)
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export function splitSentences (text) {
  const flat = normalizeEol(text).replace(/\s+/g, ' ').trim()
  if (!flat) return []

  const out = []
  let start = 0

  for (let i = 0; i < flat.length; i++) {
    if (!'.!?'.includes(flat[i])) continue

    let end = i
    while (end + 1 < flat.length && '.!?'.includes(flat[end + 1])) end++
    let after = end + 1
    while (after < flat.length && CLOSERS.includes(flat[after])) after++

    // Mid-word punctuation (URLs, decimals) is not a boundary.
    if (after < flat.length && flat[after] !== ' ') { i = end; continue }

    const candidate = flat.slice(start, after).trim()

    if (flat[i] === '.') {
      const lastToken = (candidate.match(/([\p{L}.]+)\.$/u) || [])[1]
      if (lastToken && ABBREVIATIONS.has(lastToken.slice(0, -1).toLowerCase())) { i = end; continue }
      // "J. Smith" - a lone capital before the period is an initial.
      if (/(?:^|\s)\p{Lu}\.$/u.test(candidate)) { i = end; continue }
    }

    if (candidate) out.push(candidate)
    start = after + 1
    i = after
  }

  const tail = flat.slice(start).trim()
  if (tail) out.push(tail)
  return out
}

export function splitWords (text) {
  return normalizeEol(text).match(/[\p{L}\p{N}]+(?:[''\u2019-][\p{L}\p{N}]+)*/gu) || []
}

export function countSyllablesEn (word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  const trimmed = w
    .replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
  const groups = trimmed.match(/[aeiouy]{1,2}/g)
  return groups ? groups.length : 1
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/text.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/text.mjs test/text.test.mjs
git commit -m "feat(lib): sentence, paragraph, and word segmentation"
```

---

### Task 5: Copy extraction per format

Spec §5.2 fixes the v1 formats: JSON/YAML/PO locale files (values, not keys), Markdown/MDX, plain text, HTML text nodes. Source-code string literals are explicitly out of scope - the false-positive rate would poison the fingerprint.

The filters matter as much as the parsing. A locale JSON is full of URLs, hex colors, and format tokens; counting `#4A90D9` as a two-syllable word makes the reading grade meaningless.

**Files:**
- Create: `scripts/lib/extract.mjs`
- Test: `test/extract.test.mjs`

**Interfaces:**
- Consumes: `parseYaml` from Task 2; `splitParagraphs` from Task 4.
- Produces:
  - `COPY_EXTENSIONS: Record<string, string>` - extension (with dot, lowercase) to format name.
  - `formatFor(absPath) -> string | null`
  - `extractStrings(absPath, raw) -> { format: string, strings: string[] }` - returns `{format: null, strings: []}` for unsupported extensions.
  - `extractHeadings(absPath, raw) -> string[]` - markdown `#` headings and HTML `<h1>`-`<h6>` text; `[]` for every other format. The heading-case metric needs it, and pulling it in here keeps `lib/corpus.mjs` able to gather everything in one pass.

- [ ] **Step 1: Write the failing test**

`test/extract.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractStrings, extractHeadings, formatFor } from '../scripts/lib/extract.mjs'

test('markdown drops code and frontmatter, keeps prose, alt text, and link text', () => {
  const md = [
    '---',
    'title: Ignored',
    '---',
    '# Schedule a campaign',
    '',
    'Your campaign is scheduled. Read the [setup guide](/docs/setup).',
    '',
    '```js',
    'const secret = 1',
    '```',
    '',
    '- First item',
    '- Second item',
    '',
    '![A calendar icon](/img/cal.png)',
    '',
    'Use `npm install` first.'
  ].join('\n')

  const { format, strings } = extractStrings('/x/a.md', md)
  assert.equal(format, 'markdown')
  assert.ok(strings.includes('Schedule a campaign'))
  assert.ok(strings.some((s) => s.includes('Read the setup guide.')))
  assert.ok(strings.includes('First item'))
  assert.ok(strings.includes('Second item'))
  assert.ok(strings.includes('A calendar icon'))
  assert.ok(!strings.some((s) => s.includes('const secret')))
  assert.ok(!strings.some((s) => s.includes('title: Ignored')))
  assert.ok(strings.some((s) => s === 'Use first.'))
})

test('markdown keeps table cell text but not the separator row', () => {
  const md = '| Avoid | Prefer |\n|---|---|\n| leverage | use |'
  const { strings } = extractStrings('/x/a.md', md)
  assert.ok(strings.includes('leverage'))
  assert.ok(strings.includes('Prefer'))
  assert.ok(!strings.some((s) => s.includes('---')))
})

test('json takes values not keys, and drops non-copy values', () => {
  const json = JSON.stringify({
    save: 'Save',
    nested: { greeting: 'Hi there', url: 'https://example.com', color: '#4A90D9' },
    count: 3,
    empty: '',
    list: ['Delete', 'Cancel']
  })
  const { format, strings } = extractStrings('/x/en.json', json)
  assert.equal(format, 'json')
  assert.deepEqual(strings.sort(), ['Cancel', 'Delete', 'Hi there', 'Save'])
})

test('yaml takes values, and falls back to a line scan on unsupported syntax', () => {
  assert.deepEqual(extractStrings('/x/en.yml', 'save: Save\nnested:\n  hi: Hi there').strings.sort(),
    ['Hi there', 'Save'])
  // Anchors are outside the YAML subset; the line-scan fallback still finds copy.
  const messy = 'save: Save\nalias: &a Reuse me\n'
  assert.ok(extractStrings('/x/en.yml', messy).strings.includes('Save'))
})

test('po prefers a non-empty msgstr, falls back to msgid, skips the header', () => {
  const po = [
    'msgid ""',
    'msgstr "Content-Type: text/plain"',
    '',
    'msgid "Save"',
    'msgstr "Uložit"',
    '',
    'msgid "Your campaign is scheduled."',
    'msgstr ""'
  ].join('\n')
  const { format, strings } = extractStrings('/x/cs.po', po)
  assert.equal(format, 'po')
  assert.deepEqual(strings, ['Uložit', 'Your campaign is scheduled.'])
})

test('html keeps text nodes and alt attributes, drops script and style', () => {
  const html = [
    '<style>.a{color:red}</style>',
    '<script>var x = 1</script>',
    '<h1>Schedule a campaign</h1>',
    '<p>All set &amp; ready.</p>',
    '<img alt="A calendar icon" src="/c.png">'
  ].join('\n')
  const { format, strings } = extractStrings('/x/a.html', html)
  assert.equal(format, 'html')
  assert.ok(strings.includes('Schedule a campaign'))
  assert.ok(strings.includes('All set & ready.'))
  assert.ok(strings.includes('A calendar icon'))
  assert.ok(!strings.some((s) => s.includes('color:red')))
  assert.ok(!strings.some((s) => s.includes('var x')))
})

test('headings come from markdown hashes and html heading tags', () => {
  assert.deepEqual(
    extractHeadings('/x/a.md', '# Schedule a campaign\n\ntext\n\n## Set Up Billing\n'),
    ['Schedule a campaign', 'Set Up Billing']
  )
  assert.deepEqual(
    extractHeadings('/x/a.html', '<h1>Reports</h1><h2>Set Up Billing</h2>'),
    ['Reports', 'Set Up Billing']
  )
  assert.deepEqual(extractHeadings('/x/en.json', '{"a":"b"}'), [])
})

test('unsupported extensions are recognised as such, not guessed at', () => {
  assert.equal(formatFor('/x/app.tsx'), null)
  assert.deepEqual(extractStrings('/x/app.tsx', 'const a = "Save"'), { format: null, strings: [] })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/extract.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/extract.mjs'`

- [ ] **Step 3: Implement extract.mjs**

`scripts/lib/extract.mjs`:

```js
import path from 'node:path'
import { parseYaml } from './yaml.mjs'
import { splitParagraphs } from './text.mjs'

export const COPY_EXTENSIONS = {
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.markdown': 'markdown',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.po': 'po',
  '.pot': 'po',
  '.html': 'html',
  '.htm': 'html',
  '.txt': 'text'
}

export function formatFor (absPath) {
  return COPY_EXTENSIONS[path.extname(String(absPath)).toLowerCase()] || null
}

// A value that carries no brand voice: URLs, tokens, colors, bare numbers,
// anything without a letter. Counting these would skew every metric.
function isCopy (value) {
  const text = String(value).trim()
  if (text.length === 0) return false
  if (!/\p{L}/u.test(text)) return false
  if (/^(?:https?:|mailto:|tel:|data:|\/\/)/i.test(text)) return false
  if (/^[#.]?[0-9a-f]{3,8}$/i.test(text)) return false
  if (/^[/.]{1,2}\//.test(text)) return false
  if (/^[A-Z0-9_]+$/.test(text) && text.length > 2) return false
  return true
}

function pushCopy (out, value) {
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (isCopy(text)) out.push(text)
}

function extractMarkdown (raw) {
  let body = raw
    .replace(/^---\n[\s\S]*?\n---\n/, '')          // YAML frontmatter
    .replace(/^```[\s\S]*?^```$/gm, '')             // fenced code
    .replace(/^~~~[\s\S]*?^~~~$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')                // HTML comments
    .replace(/^(?:import|export)\s.*$/gm, '')       // MDX module syntax
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')       // image -> alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')        // link -> link text
    .replace(/`[^`\n]*`/g, '')                      // inline code
    .replace(/<[^>\n]+>/g, '')                      // inline HTML/JSX tags

  const out = []
  for (const block of splitParagraphs(body)) {
    for (const line of block.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (/^\|?\s*:?-{2,}/.test(trimmed)) continue  // table separator row
      if (trimmed.includes('|')) {
        for (const cell of trimmed.split('|')) pushCopy(out, cell)
        continue
      }
      pushCopy(
        out,
        trimmed
          .replace(/^#{1,6}\s+/, '')                // heading marker
          .replace(/^>\s?/, '')                     // blockquote marker
          .replace(/^(?:[-*+]|\d+\.)\s+/, '')       // list marker
          .replace(/^\s*\[[ xX]\]\s*/, '')          // task checkbox
          .replace(/\*\*|__|\*|_|~~/g, '')          // emphasis
      )
    }
  }
  return out
}

function walkJsonValues (node, out) {
  if (typeof node === 'string') { pushCopy(out, node); return }
  if (Array.isArray(node)) { for (const item of node) walkJsonValues(item, out); return }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) walkJsonValues(value, out)
  }
}

function extractYaml (raw) {
  const out = []
  try {
    walkJsonValues(parseYaml(raw), out)
    return out
  } catch {
    // Real-world locale YAML uses anchors and merge keys the subset rejects.
    // Degrade to a line scan rather than losing the whole file.
    for (const line of raw.split('\n')) {
      const match = /^\s*[\w.$-]+:\s*(\S.*)$/.exec(line)
      if (match) pushCopy(out, match[1].replace(/^["']|["']$/g, ''))
    }
    return out
  }
}

function unquotePo (line) {
  const match = /"((?:[^"\\]|\\.)*)"/.exec(line)
  if (!match) return ''
  return match[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function extractPo (raw) {
  const out = []
  let field = null
  const entry = { msgid: '', msgstr: '' }

  const flush = () => {
    if (entry.msgid !== '' || entry.msgstr !== '') {
      // A blank msgid is the PO header block, never copy.
      if (entry.msgid !== '') pushCopy(out, entry.msgstr || entry.msgid)
    }
    entry.msgid = ''
    entry.msgstr = ''
    field = null
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') { flush(); continue }
    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith('msgid_plural')) { field = 'msgid'; entry.msgid += unquotePo(trimmed); continue }
    if (trimmed.startsWith('msgid')) { field = 'msgid'; entry.msgid = unquotePo(trimmed); continue }
    if (trimmed.startsWith('msgstr')) { field = 'msgstr'; entry.msgstr = unquotePo(trimmed); continue }
    if (trimmed.startsWith('"') && field) { entry[field] += unquotePo(trimmed) }
  }
  flush()
  return out
}

function decodeEntities (text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => named[name.toLowerCase()] ?? whole)
}

function extractHtml (raw) {
  const out = []
  const body = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  for (const match of body.matchAll(/\b(?:alt|title|aria-label|placeholder)\s*=\s*"([^"]*)"/gi)) {
    pushCopy(out, decodeEntities(match[1]))
  }
  for (const chunk of body.replace(/<[^>]*>/g, '\n').split('\n')) {
    pushCopy(out, decodeEntities(chunk))
  }
  return out
}

export function extractHeadings (absPath, raw) {
  const format = formatFor(absPath)
  const text = String(raw).replace(/\r\n?/g, '\n')
  const out = []

  if (format === 'markdown') {
    const withoutCode = text.replace(/^```[\s\S]*?^```$/gm, '')
    for (const match of withoutCode.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      pushCopy(out, match[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, ''))
    }
    return out
  }
  if (format === 'html') {
    for (const match of text.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
      pushCopy(out, decodeEntities(match[1].replace(/<[^>]*>/g, ' ')))
    }
    return out
  }
  return out
}

export function extractStrings (absPath, raw) {
  const format = formatFor(absPath)
  if (!format) return { format: null, strings: [] }
  const text = String(raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

  switch (format) {
    case 'markdown': return { format, strings: extractMarkdown(text) }
    case 'json': {
      const out = []
      try { walkJsonValues(JSON.parse(text), out) } catch { /* malformed JSON yields nothing */ }
      return { format, strings: out }
    }
    case 'yaml': return { format, strings: extractYaml(text) }
    case 'po': return { format, strings: extractPo(text) }
    case 'html': return { format, strings: extractHtml(text) }
    case 'text': {
      const out = []
      for (const block of splitParagraphs(text)) pushCopy(out, block)
      return { format, strings: out }
    }
    default: return { format: null, strings: [] }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/extract.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/extract.mjs test/extract.test.mjs
git commit -m "feat(lib): copy extraction and heading collection for six formats"
```

---

### Task 6: Config, CLI conventions, and `scan.mjs`

The first user-facing script. It answers "what in this project is actually copy?" and writes the manifest every later step reads. Locale attribution happens here, because §5.3 requires per-locale fingerprints that are never averaged - if `scan` loses the locale, `fingerprint` cannot recover it.

**Files:**
- Create: `scripts/lib/config.mjs`
- Create: `scripts/lib/cli.mjs`
- Create: `scripts/lib/corpus.mjs`
- Create: `scripts/scan.mjs`
- Test: `test/config.test.mjs`
- Test: `test/scan.test.mjs`

**Interfaces:**
- Consumes: `parseYaml`/`stringifyYaml` (Task 2), `walk`/`readTextFile`/`writeTextFile`/`toPosix` (Task 3), `extractStrings`/`formatFor` (Task 5), `splitSentences`/`splitWords` (Task 4).
- Produces:
  - `config.mjs`: `DEFAULT_CONFIG` (frozen); `kbRootFor(projectRoot, override?) -> string`; `loadConfig(kbRoot) -> object` (deep-merged onto defaults; defaults alone if absent); `saveConfig(kbRoot, config) -> void`; `localeOf(relPosixPath, locales, primaryLocale) -> string`.
  - `cli.mjs`: `parseCliArgs(argv, extraOptions?) -> {values, positionals}`; `resolveRoots(values) -> {projectRoot, kbRoot}`; `nowIso(values) -> string`; `die(message) -> never` (prints ASCII to stderr, exits 1).
  - `corpus.mjs`: `gatherCorpus(projectRoot, config, profileName) -> Array<{rel, abs, format, locale, strings, headings}>` - the single walk-extract-attribute loop. `scan.mjs`, `fingerprint.mjs`, and `compile-context.mjs` all read the corpus through it, so a change to extraction or locale attribution lands in one place.
  - `scan.mjs`: writes `<kb>/evidence/manifest.json` shaped `{generated, projectRoot, totals:{files,strings,words,sentences}, byLocale:{<code>:{files,strings,words}}, files:[{path,format,locale,strings,words,sentences}]}`, and exports `buildManifest(projectRoot, config, nowIso) -> object` for testing without spawning a process.

- [ ] **Step 1: Write the failing config test**

`test/config.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { DEFAULT_CONFIG, kbRootFor, loadConfig, saveConfig, localeOf } from '../scripts/lib/config.mjs'

test('defaults match the spec thresholds', () => {
  assert.equal(DEFAULT_CONFIG.version, 1)
  assert.equal(DEFAULT_CONFIG.thresholds.corroboration, 2)
  assert.equal(DEFAULT_CONFIG.thresholds.derived_min_samples, 5)
  assert.equal(DEFAULT_CONFIG.thresholds.stale_months, 9)
  assert.ok(DEFAULT_CONFIG.scan.exclude.includes('node_modules/**'))
})

test('kbRootFor defaults to .voice-and-tone and honours an override', () => {
  assert.equal(kbRootFor('/p'), path.join('/p', '.voice-and-tone'))
  assert.equal(kbRootFor('/p', '/elsewhere/kb'), path.resolve('/elsewhere/kb'))
})

test('loadConfig deep-merges over defaults and survives a missing file', () => {
  const dir = makeTmpProject({
    'kb/config.yml': 'kb_version: 0.4.2\nthresholds:\n  corroboration: 3\n'
  })
  try {
    const config = loadConfig(path.join(dir, 'kb'))
    assert.equal(config.kb_version, '0.4.2')
    assert.equal(config.thresholds.corroboration, 3)
    assert.equal(config.thresholds.stale_months, 9, 'untouched defaults survive the merge')
    assert.deepEqual(loadConfig(path.join(dir, 'absent')).thresholds, DEFAULT_CONFIG.thresholds)
  } finally {
    cleanup(dir)
  }
})

test('saveConfig round-trips through loadConfig', () => {
  const dir = makeTmpProject({})
  try {
    const kb = path.join(dir, 'kb')
    saveConfig(kb, { ...DEFAULT_CONFIG, kb_version: '1.2.3' })
    assert.equal(loadConfig(kb).kb_version, '1.2.3')
  } finally {
    cleanup(dir)
  }
})

test('localeOf reads the locale from the path, else falls back to primary', () => {
  const locales = ['en', 'cs']
  assert.equal(localeOf('locales/cs/common.json', locales, 'en'), 'cs')
  assert.equal(localeOf('src/i18n/cs.json', locales, 'en'), 'cs')
  assert.equal(localeOf('content/cs/index.md', locales, 'en'), 'cs')
  assert.equal(localeOf('content/index.md', locales, 'en'), 'en')
  assert.equal(localeOf('content/csv/index.md', locales, 'en'), 'en', 'csv is not the cs locale')
})
```

- [ ] **Step 2: Write the failing scan test**

`test/scan.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs'
import { buildManifest } from '../scripts/scan.mjs'

const config = {
  ...DEFAULT_CONFIG,
  profiles: { default: { name: 'Acme', primary_locale: 'en', locales: ['en', 'cs'] } },
  scan: { include: ['content/**/*.md', 'locales/**/*.json'], exclude: ['node_modules/**'] }
}

test('manifest counts copy per file and groups by locale', () => {
  const dir = makeTmpProject({
    'content/a.md': '# Hi\n\nYour campaign is scheduled. Nice work.\n',
    'locales/cs/common.json': JSON.stringify({ save: 'Uložit', cancel: 'Zrušit' }),
    'content/ignored.txt': 'not in the include list',
    'node_modules/pkg/readme.md': 'never'
  })
  try {
    const manifest = buildManifest(dir, config, '2026-08-26T00:00:00.000Z')

    assert.equal(manifest.generated, '2026-08-26T00:00:00.000Z')
    assert.equal(manifest.totals.files, 2)
    assert.deepEqual(manifest.files.map((f) => f.path), ['content/a.md', 'locales/cs/common.json'])

    const md = manifest.files[0]
    assert.equal(md.format, 'markdown')
    assert.equal(md.locale, 'en')
    assert.equal(md.sentences, 3, 'heading plus two sentences')

    assert.equal(manifest.files[1].locale, 'cs')
    assert.equal(manifest.byLocale.cs.strings, 2)
    assert.equal(manifest.byLocale.en.files, 1)
  } finally {
    cleanup(dir)
  }
})

test('an empty project produces a valid, empty manifest rather than throwing', () => {
  const dir = makeTmpProject({})
  try {
    const manifest = buildManifest(dir, config, '2026-08-26T00:00:00.000Z')
    assert.deepEqual(manifest.files, [])
    assert.equal(manifest.totals.words, 0)
    assert.deepEqual(manifest.byLocale, {})
  } finally {
    cleanup(dir)
  }
})

test('paths in the manifest are POSIX on every platform', () => {
  const dir = makeTmpProject({ 'content/deep/nested/a.md': 'Copy here.' })
  try {
    const manifest = buildManifest(dir, config, '2026-08-26T00:00:00.000Z')
    assert.equal(manifest.files[0].path, 'content/deep/nested/a.md')
    assert.ok(!manifest.files[0].path.includes(path.sep === '/' ? '\\' : '\\'))
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `node --test test/config.test.mjs test/scan.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/config.mjs'`

- [ ] **Step 4: Implement config.mjs**

`scripts/lib/config.mjs`:

```js
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseYaml, stringifyYaml } from './yaml.mjs'
import { readTextFile, writeTextFile } from './fsx.mjs'

export const KB_DIRNAME = '.voice-and-tone'

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  kb_version: '0.1.0',
  profiles: {
    default: { name: 'Unnamed', primary_locale: 'en', locales: ['en'] }
  },
  scan: {
    include: [
      'content/**/*.md',
      'content/**/*.mdx',
      'docs/**/*.md',
      'locales/**/*.json',
      'locales/**/*.yml',
      'locales/**/*.po',
      'README.md'
    ],
    exclude: ['node_modules/**', 'dist/**', 'build/**', '.git/**', '.voice-and-tone/**']
  },
  runtime: { node: 'detected', probed: null },
  thresholds: { corroboration: 2, derived_min_samples: 5, stale_months: 9 }
})

export function kbRootFor (projectRoot, override) {
  return override ? path.resolve(override) : path.join(projectRoot, KB_DIRNAME)
}

function deepMerge (base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key]
    out[key] =
      current && typeof current === 'object' && !Array.isArray(current) &&
      value && typeof value === 'object' && !Array.isArray(value)
        ? deepMerge(current, value)
        : value
  }
  return out
}

export function loadConfig (kbRoot) {
  const file = path.join(kbRoot, 'config.yml')
  if (!existsSync(file)) return deepMerge(DEFAULT_CONFIG, {})
  return deepMerge(DEFAULT_CONFIG, parseYaml(readTextFile(file)))
}

export function saveConfig (kbRoot, config) {
  writeTextFile(path.join(kbRoot, 'config.yml'), stringifyYaml(config))
}

/**
 * Attribute a file to a locale by path segment or by basename.
 * Matches whole segments only, so "content/csv/x.md" is not Czech.
 */
export function localeOf (relPosixPath, locales, primaryLocale) {
  const segments = relPosixPath.split('/')
  const basename = segments[segments.length - 1]
  const stem = basename.replace(/\.[^.]+$/, '')
  for (const locale of locales) {
    if (segments.slice(0, -1).includes(locale)) return locale
    if (stem === locale) return locale
    if (stem.endsWith(`.${locale}`) || stem.endsWith(`-${locale}`) || stem.endsWith(`_${locale}`)) return locale
  }
  return primaryLocale
}

export function activeProfile (config, profileName = 'default') {
  return config.profiles?.[profileName] ?? DEFAULT_CONFIG.profiles.default
}
```

- [ ] **Step 5: Implement cli.mjs**

`scripts/lib/cli.mjs`:

```js
import { parseArgs } from 'node:util'
import path from 'node:path'
import { kbRootFor } from './config.mjs'

const BASE_OPTIONS = {
  root: { type: 'string' },        // project root; defaults to cwd
  kb: { type: 'string' },          // knowledge base dir; defaults to <root>/.voice-and-tone
  out: { type: 'string' },         // override the output file
  now: { type: 'string' },         // fixed ISO timestamp, for reproducible output
  json: { type: 'boolean' },       // machine-readable summary on stdout
  help: { type: 'boolean', short: 'h' }
}

export function parseCliArgs (argv, extraOptions = {}) {
  return parseArgs({
    args: argv,
    options: { ...BASE_OPTIONS, ...extraOptions },
    allowPositionals: true,
    strict: true
  })
}

export function resolveRoots (values) {
  const projectRoot = path.resolve(values.root ?? process.cwd())
  return { projectRoot, kbRoot: kbRootFor(projectRoot, values.kb) }
}

export function nowIso (values) {
  return values.now ?? new Date().toISOString()
}

/** Spec section 9: stdout and stderr stay ASCII. */
export function die (message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(1)
}

export function printHelp (name, lines) {
  process.stdout.write([`usage: node ${name} [options]`, '', ...lines, ''].join('\n'))
}
```

- [ ] **Step 6: Implement corpus.mjs**

One walk, one extraction, one locale attribution - three consumers. `scan.mjs`, `fingerprint.mjs`, and `compile-context.mjs` differ in what they compute, never in what they read.

`scripts/lib/corpus.mjs`:

```js
import path from 'node:path'
import { walk, readTextFile, toPosix } from './fsx.mjs'
import { extractStrings, extractHeadings } from './extract.mjs'
import { activeProfile, localeOf } from './config.mjs'

/**
 * Read every copy-bearing file the config points at, in a stable order.
 * Files that yield no copy are dropped: an empty locale stub is not a data point.
 */
export function gatherCorpus (projectRoot, config, profileName = 'default') {
  const profile = activeProfile(config, profileName)
  const primary = profile.primary_locale ?? 'en'
  const locales = profile.locales ?? [primary]
  const out = []

  for (const abs of walk(projectRoot, config.scan)) {
    let raw
    try { raw = readTextFile(abs) } catch { continue } // unreadable file is skipped, not fatal
    const rel = toPosix(path.relative(projectRoot, abs))
    const { format, strings } = extractStrings(abs, raw)
    if (!format || strings.length === 0) continue
    out.push({
      rel,
      abs,
      format,
      locale: localeOf(rel, locales, primary),
      strings,
      headings: extractHeadings(abs, raw)
    })
  }
  return out
}

/** Group a gathered corpus by locale. Spec 5.3: locales are never averaged together. */
export function byLocale (corpus) {
  const buckets = new Map()
  for (const file of corpus) {
    const bucket = buckets.get(file.locale) ?? { strings: [], headings: [], files: 0 }
    bucket.strings.push(...file.strings)
    bucket.headings.push(...file.headings)
    bucket.files += 1
    buckets.set(file.locale, bucket)
  }
  return buckets
}
```

- [ ] **Step 7: Implement scan.mjs**

`scripts/scan.mjs`:

```js
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeTextFile, toPosix } from './lib/fsx.mjs'
import { splitSentences, splitWords } from './lib/text.mjs'
import { loadConfig } from './lib/config.mjs'
import { gatherCorpus } from './lib/corpus.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp } from './lib/cli.mjs'

export function buildManifest (projectRoot, config, generated, profileName = 'default') {
  const files = []
  const byLocale = {}
  const totals = { files: 0, strings: 0, words: 0, sentences: 0 }

  for (const file of gatherCorpus(projectRoot, config, profileName)) {
    const joined = file.strings.join('\n')
    const entry = {
      path: file.rel,
      format: file.format,
      locale: file.locale,
      strings: file.strings.length,
      words: splitWords(joined).length,
      sentences: file.strings.reduce((sum, s) => sum + splitSentences(s).length, 0)
    }
    files.push(entry)

    totals.files += 1
    totals.strings += entry.strings
    totals.words += entry.words
    totals.sentences += entry.sentences

    const bucket = byLocale[entry.locale] ?? (byLocale[entry.locale] = { files: 0, strings: 0, words: 0 })
    bucket.files += 1
    bucket.strings += entry.strings
    bucket.words += entry.words
  }

  return { generated, projectRoot: toPosix(projectRoot), profile: profileName, totals, byLocale, files }
}

function main (argv) {
  const { values } = parseCliArgs(argv, { profile: { type: 'string' } })
  if (values.help) {
    printHelp('scripts/scan.mjs', [
      'Writes a manifest of copy-bearing files to <kb>/evidence/manifest.json.',
      '',
      '  --root <dir>      project root (default: cwd)',
      '  --kb <dir>        knowledge base dir (default: <root>/.voice-and-tone)',
      '  --out <file>      output path override',
      '  --profile <name>  config profile (default: default)',
      '  --now <iso>       fixed timestamp for reproducible output',
      '  --json            print the manifest summary as JSON'
    ])
    return
  }

  const { projectRoot, kbRoot } = resolveRoots(values)
  const config = loadConfig(kbRoot)
  const manifest = buildManifest(projectRoot, config, nowIso(values), values.profile ?? 'default')

  const out = values.out ? path.resolve(values.out) : path.join(kbRoot, 'evidence', 'manifest.json')
  writeTextFile(out, `${JSON.stringify(manifest, null, 2)}\n`)

  if (values.json) {
    process.stdout.write(`${JSON.stringify({ totals: manifest.totals, byLocale: manifest.byLocale })}\n`)
    return
  }
  process.stdout.write(
    `scan: ${manifest.totals.files} files, ${manifest.totals.strings} strings, ` +
    `${manifest.totals.words} words, ${manifest.totals.sentences} sentences\n` +
    `scan: locales ${Object.keys(manifest.byLocale).join(', ') || 'none'}\n` +
    `scan: wrote ${toPosix(path.relative(projectRoot, out))}\n`
  )
}

// Run main only when invoked as a script, so tests can import buildManifest freely.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test test/config.test.mjs test/scan.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 9: Verify the CLI runs end to end on this repo**

Run: `node "$(pwd)/scripts/scan.mjs" --root "$(pwd)" --kb "$(pwd)/.tmp/kb" --now 2026-08-26T00:00:00.000Z`
Expected: an ASCII summary naming a non-zero file count, and `.tmp/kb/evidence/manifest.json` created. Then remove `.tmp` (the `.tmp/` entry added to `.gitignore` in Task 1 covers it).

- [ ] **Step 10: Commit**

```bash
git add scripts/lib/config.mjs scripts/lib/cli.mjs scripts/lib/corpus.mjs scripts/scan.mjs test/config.test.mjs test/scan.test.mjs
git commit -m "feat(scripts): scan.mjs manifest with per-locale attribution"
```

---

### Task 7: Corpus metrics

Spec §5.3, verbatim, including the split it insists on: universal metrics run for any language; English-only metrics are marked `null` for other locales rather than computed. Contraction rate is meaningless in Czech and syllable heuristics are English-specific - reporting them anyway produces confident nonsense, which is exactly what this plugin exists to stop.

Every rate needs a stated denominator or the numbers are not comparable across corpora. The denominators are fixed here and never changed.

**Files:**
- Create: `scripts/lib/metrics.mjs`
- Test: `test/metrics.test.mjs`

**Interfaces:**
- Consumes: `splitSentences`, `splitWords`, `splitParagraphs`, `countSyllablesEn` (Task 4).
- Produces:
  - `universalMetrics({strings, headings, locale}) -> object`
  - `englishMetrics({strings}) -> object`
  - `computeFingerprint({strings, headings, locale}) -> {locale, sample, universal, english}` where `english` is `null` unless `locale` starts with `en`.
  - `PERSON_MARKERS: Record<string, {first: string[], second: string[]}>` - per-locale pronoun sets; a locale absent from the table yields `null` marker rates rather than a wrong number.

**Denominators, fixed:**
- `share of sentences`, `share of words`, `share of headings`, `share of list candidates`: `0..1`, rounded to 3 decimals.
- `per1000Words`: occurrences per 1000 words, rounded to 2 decimals.
- Lengths are counts, rounded to 2 decimals.
- Any metric whose denominator is zero is `null`, never `0`.

- [ ] **Step 1: Write the failing test**

`test/metrics.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { universalMetrics, englishMetrics, computeFingerprint, PERSON_MARKERS } from '../scripts/lib/metrics.mjs'

const strings = [
  'Your campaign is scheduled.',
  'Nice work!',
  'Want to schedule another one?',
  'We sent it - the report is ready; check your inbox.'
]

test('universal metrics count structure and punctuation', () => {
  const m = universalMetrics({ strings, headings: [], locale: 'en' })
  assert.equal(m.sentenceCount, 4)
  assert.equal(m.wordCount, 21)
  assert.equal(m.exclamationRate, 0.25)
  assert.equal(m.questionRate, 0.25)
  assert.ok(m.meanSentenceLength > 0)
  assert.ok(m.sentenceLengthSd >= 0)
  assert.equal(m.semicolonPer1000Words > 0, true)
  assert.equal(m.emojiPer1000Words, 0)
})

test('heading case ratio counts Title Case among multi-word headings', () => {
  const m = universalMetrics({
    strings: ['x'],
    headings: ['Schedule A Campaign', 'Schedule a campaign', 'Reports', 'Set Up Billing'],
    locale: 'en'
  })
  assert.equal(m.headingTitleCaseRatio, 0.667, 'Reports is single-word and excluded')
})

test('person marker rates are null for a locale with no marker set', () => {
  assert.ok(PERSON_MARKERS.en.second.includes('you'))
  const en = universalMetrics({ strings: ['You can schedule it. We will send it.'], headings: [], locale: 'en' })
  assert.ok(en.secondPersonPer1000Words > 0)
  assert.ok(en.firstPersonPer1000Words > 0)

  const xx = universalMetrics({ strings: ['Neco tady je.'], headings: [], locale: 'xx' })
  assert.equal(xx.firstPersonPer1000Words, null)
  assert.equal(xx.secondPersonPer1000Words, null)
})

test('empty input yields nulls, not zeros', () => {
  const m = universalMetrics({ strings: [], headings: [], locale: 'en' })
  assert.equal(m.sentenceCount, 0)
  assert.equal(m.meanSentenceLength, null)
  assert.equal(m.exclamationRate, null)
  assert.equal(m.headingTitleCaseRatio, null)
})

test('english metrics detect contractions, passive, imperative, hedges, intensifiers', () => {
  const m = englishMetrics({
    strings: [
      "We didn't send it.",
      'The report was generated by the system.',
      'Open the settings page.',
      'This might possibly work.',
      'It is very extremely good.'
    ]
  })
  assert.ok(m.contractionPer1000Words > 0)
  assert.equal(m.passiveRate > 0, true)
  assert.equal(m.imperativeOpenerRate > 0, true)
  assert.ok(m.hedgePer1000Words > 0)
  assert.ok(m.intensifierPer1000Words > 0)
  assert.ok(m.readingGrade > 0)
  assert.ok(m.longWordRate >= 0)
})

test('oxford comma rate is measured only over serial-list candidates', () => {
  const withOxford = englishMetrics({ strings: ['Email, social, and web.'] })
  assert.equal(withOxford.oxfordCommaRate, 1)
  const without = englishMetrics({ strings: ['Email, social and web.'] })
  assert.equal(without.oxfordCommaRate, 0)
  const neither = englishMetrics({ strings: ['Just one thing.'] })
  assert.equal(neither.oxfordCommaRate, null)
})

test('computeFingerprint marks english metrics N/A for other locales', () => {
  const cs = computeFingerprint({ strings: ['Vase kampan je naplanovana.'], headings: [], locale: 'cs' })
  assert.equal(cs.english, null)
  assert.ok(cs.universal.wordCount > 0)
  assert.equal(cs.sample.strings, 1)

  const en = computeFingerprint({ strings: ['Your campaign is scheduled.'], headings: [], locale: 'en' })
  assert.ok(en.english !== null)
  assert.equal(en.locale, 'en')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/metrics.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/metrics.mjs'`

- [ ] **Step 3: Implement metrics.mjs**

`scripts/lib/metrics.mjs`:

```js
import { splitSentences, splitWords, splitParagraphs, countSyllablesEn } from './text.mjs'

/**
 * Pronoun markers per locale. Spec section 5.3 lists person-marker rates as
 * universal, but a rate needs a marker set. A locale with no entry reports null
 * rather than a number derived from the wrong language's pronouns.
 */
export const PERSON_MARKERS = {
  en: {
    first: ['i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours'],
    second: ['you', 'your', 'yours', "you're", "you'll", "you've"]
  },
  cs: {
    first: ['ja', 'me', 'mne', 'muj', 'moje', 'my', 'nas', 'nam', 'nase'],
    second: ['ty', 'tebe', 'tvuj', 'tvoje', 'vy', 'vas', 'vam', 'vase']
  },
  de: {
    first: ['ich', 'mich', 'mir', 'mein', 'wir', 'uns', 'unser'],
    second: ['du', 'dich', 'dir', 'dein', 'ihr', 'euch', 'euer', 'sie', 'ihnen']
  }
}

const EN_HEDGES = new Set([
  'maybe', 'perhaps', 'might', 'could', 'somewhat', 'fairly', 'rather', 'seems',
  'appears', 'generally', 'usually', 'often', 'probably', 'possibly', 'just',
  'simply', 'basically', 'essentially', 'quite', 'slightly'
])
const EN_INTENSIFIERS = new Set([
  'very', 'really', 'extremely', 'incredibly', 'super', 'totally', 'absolutely',
  'highly', 'completely', 'definitely', 'literally', 'amazing', 'awesome', 'huge'
])
const EN_IMPERATIVE_OPENERS = new Set([
  'add', 'browse', 'check', 'choose', 'click', 'connect', 'copy', 'create',
  'delete', 'download', 'edit', 'enable', 'enter', 'explore', 'find', 'get',
  'go', 'install', 'join', 'learn', 'log', 'make', 'open', 'pick', 'read',
  'remove', 'rename', 'reset', 'review', 'save', 'schedule', 'select', 'send',
  'set', 'share', 'sign', 'start', 'stop', 'switch', 'try', 'turn', 'update',
  'upgrade', 'upload', 'use', 'view', 'visit', 'write'
])
const PASSIVE = /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ed|born|done|made|given|taken|seen|known|written|shown|held|sent|built|kept|found|put|set|read)\b/i
const CONTRACTION = /\b\w+['’](?:t|s|re|ve|ll|d|m)\b/gi
const SERIAL_LIST = /[\w'’-]+\s*,\s*[\w'’-]+(?:\s*,)?\s+(?:and|or)\s+[\w'’-]+/gi
const OXFORD = /,\s+(?:and|or)\s+/i

const round = (value, places) =>
  value === null || !Number.isFinite(value) ? null : Number(value.toFixed(places))
const share = (count, total) => (total > 0 ? round(count / total, 3) : null)
const per1000 = (count, words) => (words > 0 ? round((count * 1000) / words, 2) : null)
const countMatches = (text, pattern) => (text.match(pattern) || []).length

function median (numbers) {
  if (numbers.length === 0) return null
  const sorted = [...numbers].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function stdDev (numbers) {
  if (numbers.length === 0) return null
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length
  const variance = numbers.reduce((sum, n) => sum + (n - mean) ** 2, 0) / numbers.length
  return Math.sqrt(variance)
}

function isTitleCase (heading) {
  const words = splitWords(heading)
  if (words.length < 2) return null
  const minor = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'to', 'for', 'with'])
  const significant = words.filter((w, i) => i === 0 || !minor.has(w.toLowerCase()))
  return significant.every((w) => /^[\p{Lu}\p{N}]/u.test(w))
}

export function universalMetrics ({ strings = [], headings = [], locale = 'en' } = {}) {
  const text = strings.join('\n\n')
  const sentences = strings.flatMap((s) => splitSentences(s))
  const words = splitWords(text)
  const paragraphs = splitParagraphs(text)
  const sentenceLengths = sentences.map((s) => splitWords(s).length)
  const wordCount = words.length

  const markers = PERSON_MARKERS[String(locale).slice(0, 2).toLowerCase()] ?? null
  const lowerWords = words.map((w) => w.toLowerCase())
  const countIn = (set) => lowerWords.filter((w) => set.includes(w)).length

  const headingVerdicts = headings.map(isTitleCase).filter((v) => v !== null)

  return {
    sentenceCount: sentences.length,
    wordCount,
    paragraphCount: paragraphs.length,
    meanSentenceLength: sentences.length ? round(sentenceLengths.reduce((a, b) => a + b, 0) / sentences.length, 2) : null,
    medianSentenceLength: round(median(sentenceLengths), 2),
    sentenceLengthSd: round(stdDev(sentenceLengths), 2),
    meanParagraphLength: paragraphs.length
      ? round(paragraphs.reduce((sum, p) => sum + splitSentences(p).length, 0) / paragraphs.length, 2)
      : null,
    meanWordLength: wordCount ? round(words.reduce((sum, w) => sum + w.length, 0) / wordCount, 2) : null,
    exclamationRate: share(sentences.filter((s) => /!\p{P}*$/u.test(s)).length, sentences.length),
    questionRate: share(sentences.filter((s) => /\?\p{P}*$/u.test(s)).length, sentences.length),
    emojiPer1000Words: per1000(countMatches(text, /\p{Extended_Pictographic}/gu), wordCount),
    emDashPer1000Words: per1000(countMatches(text, /—|\s-\s/g), wordCount),
    semicolonPer1000Words: per1000(countMatches(text, /;/g), wordCount),
    headingTitleCaseRatio: share(headingVerdicts.filter(Boolean).length, headingVerdicts.length),
    firstPersonPer1000Words: markers ? per1000(countIn(markers.first), wordCount) : null,
    secondPersonPer1000Words: markers ? per1000(countIn(markers.second), wordCount) : null
  }
}

export function englishMetrics ({ strings = [] } = {}) {
  const text = strings.join('\n\n')
  const sentences = strings.flatMap((s) => splitSentences(s))
  const words = splitWords(text)
  const wordCount = words.length
  const lowerWords = words.map((w) => w.toLowerCase())
  const syllables = words.reduce((sum, w) => sum + countSyllablesEn(w), 0)

  const listCandidates = text.match(SERIAL_LIST) || []
  const oxfordCount = listCandidates.filter((candidate) => OXFORD.test(candidate)).length

  const imperativeOpeners = sentences.filter((sentence) => {
    const first = (splitWords(sentence)[0] || '').toLowerCase()
    return EN_IMPERATIVE_OPENERS.has(first)
  }).length

  return {
    contractionPer1000Words: per1000(countMatches(text, CONTRACTION), wordCount),
    readingGrade: sentences.length && wordCount
      ? round(0.39 * (wordCount / sentences.length) + 11.8 * (syllables / wordCount) - 15.59, 2)
      : null,
    passiveRate: share(sentences.filter((s) => PASSIVE.test(s)).length, sentences.length),
    imperativeOpenerRate: share(imperativeOpeners, sentences.length),
    hedgePer1000Words: per1000(lowerWords.filter((w) => EN_HEDGES.has(w)).length, wordCount),
    intensifierPer1000Words: per1000(lowerWords.filter((w) => EN_INTENSIFIERS.has(w)).length, wordCount),
    oxfordCommaRate: share(oxfordCount, listCandidates.length),
    longWordRate: share(words.filter((w) => countSyllablesEn(w) > 3).length, wordCount)
  }
}

export function computeFingerprint ({ strings = [], headings = [], locale = 'en' } = {}) {
  const isEnglish = String(locale).toLowerCase().startsWith('en')
  return {
    locale,
    sample: {
      strings: strings.length,
      words: splitWords(strings.join('\n\n')).length,
      sentences: strings.flatMap((s) => splitSentences(s)).length
    },
    universal: universalMetrics({ strings, headings, locale }),
    english: isEnglish ? englishMetrics({ strings }) : null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/metrics.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/metrics.mjs test/metrics.test.mjs
git commit -m "feat(lib): universal and English-only corpus metrics"
```

---

### Task 8: `fingerprint.mjs`

Turns the corpus into `evidence/fingerprint.json`, one fingerprint per locale, **never averaged across locales** (§5.3). Also carries the §5.4 degradation flag: a fingerprint marked `estimated` may only ever produce `assumed` rules, so the flag has to live in the artifact rather than in someone's memory.

`--set-baseline` freezes the current numbers as the drift baseline `:audit` compares against (§7.3).

**Files:**
- Create: `scripts/fingerprint.mjs`
- Test: `test/fingerprint.test.mjs`

**Interfaces:**
- Consumes: `gatherCorpus`/`byLocale` (Task 6), `loadConfig` (Task 6), `computeFingerprint` (Task 7), `writeTextFile`/`readTextFile`/`toPosix` (Task 3), CLI helpers (Task 6).
- Produces: `buildFingerprint(projectRoot, config, {generated, source, profileName}) -> {generated, source, byLocale: Record<string, Fingerprint>, baseline: null | {generated, byLocale}}`, written to `<kb>/evidence/fingerprint.json`.

- [ ] **Step 1: Write the failing test**

`test/fingerprint.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs'
import { buildFingerprint } from '../scripts/fingerprint.mjs'

const config = {
  ...DEFAULT_CONFIG,
  profiles: { default: { name: 'Acme', primary_locale: 'en', locales: ['en', 'cs'] } },
  scan: { include: ['content/**/*.md', 'locales/**/*.json'], exclude: ['node_modules/**'] }
}

const opts = { generated: '2026-08-26T00:00:00.000Z', source: 'measured', profileName: 'default' }

test('fingerprints are computed per locale and never merged', () => {
  const dir = makeTmpProject({
    'content/a.md': '# Schedule a campaign\n\nYour campaign is scheduled. Nice work!\n',
    'locales/cs/common.json': JSON.stringify({ save: 'Ulozit', hint: 'Vase kampan je naplanovana.' })
  })
  try {
    const fp = buildFingerprint(dir, config, opts)
    assert.deepEqual(Object.keys(fp.byLocale).sort(), ['cs', 'en'])
    assert.equal(fp.source, 'measured')
    assert.ok(fp.byLocale.en.english !== null, 'english metrics present for en')
    assert.equal(fp.byLocale.cs.english, null, 'english metrics are N/A for cs')
    assert.equal(fp.byLocale.en.universal.headingTitleCaseRatio !== undefined, true)
    assert.equal(fp.baseline, null)
  } finally {
    cleanup(dir)
  }
})

test('an estimated fingerprint records the degraded source', () => {
  const dir = makeTmpProject({ 'content/a.md': 'Copy here.' })
  try {
    assert.equal(buildFingerprint(dir, config, { ...opts, source: 'estimated' }).source, 'estimated')
  } finally {
    cleanup(dir)
  }
})

test('a project with no copy produces an empty but valid fingerprint', () => {
  const dir = makeTmpProject({})
  try {
    const fp = buildFingerprint(dir, config, opts)
    assert.deepEqual(fp.byLocale, {})
    assert.equal(fp.generated, '2026-08-26T00:00:00.000Z')
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/fingerprint.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/fingerprint.mjs'`

- [ ] **Step 3: Implement fingerprint.mjs**

`scripts/fingerprint.mjs`:

```js
import path from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { readTextFile, writeTextFile, toPosix } from './lib/fsx.mjs'
import { loadConfig } from './lib/config.mjs'
import { gatherCorpus, byLocale } from './lib/corpus.mjs'
import { computeFingerprint } from './lib/metrics.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp } from './lib/cli.mjs'

export function buildFingerprint (projectRoot, config, { generated, source = 'measured', profileName = 'default' }) {
  const buckets = byLocale(gatherCorpus(projectRoot, config, profileName))
  const out = {}
  // Sorted so the artifact is stable across runs and diffs cleanly in git.
  for (const locale of [...buckets.keys()].sort()) {
    const { strings, headings } = buckets.get(locale)
    out[locale] = computeFingerprint({ strings, headings, locale })
  }
  return { generated, source, byLocale: out, baseline: null }
}

function main (argv) {
  const { values } = parseCliArgs(argv, {
    profile: { type: 'string' },
    source: { type: 'string' },
    'set-baseline': { type: 'boolean' }
  })
  if (values.help) {
    printHelp('scripts/fingerprint.mjs', [
      'Writes per-locale corpus metrics to <kb>/evidence/fingerprint.json.',
      '',
      '  --root <dir>      project root (default: cwd)',
      '  --kb <dir>        knowledge base dir',
      '  --profile <name>  config profile (default: default)',
      '  --source <kind>   measured | estimated (default: measured)',
      '  --set-baseline    freeze these numbers as the drift baseline',
      '  --now <iso>       fixed timestamp',
      '  --json            print the summary as JSON'
    ])
    return
  }

  const source = values.source ?? 'measured'
  if (source !== 'measured' && source !== 'estimated') die('--source must be measured or estimated')

  const { projectRoot, kbRoot } = resolveRoots(values)
  const config = loadConfig(kbRoot)
  const generated = nowIso(values)
  const fingerprint = buildFingerprint(projectRoot, config, {
    generated, source, profileName: values.profile ?? 'default'
  })

  const out = values.out ? path.resolve(values.out) : path.join(kbRoot, 'evidence', 'fingerprint.json')

  // Preserve an existing baseline unless explicitly re-set.
  if (existsSync(out)) {
    try {
      fingerprint.baseline = JSON.parse(readTextFile(out)).baseline ?? null
    } catch { /* a corrupt previous fingerprint is replaced, not repaired */ }
  }
  if (values['set-baseline']) {
    fingerprint.baseline = { generated, byLocale: fingerprint.byLocale }
  }

  writeTextFile(out, `${JSON.stringify(fingerprint, null, 2)}\n`)

  if (values.json) {
    process.stdout.write(`${JSON.stringify({ source, locales: Object.keys(fingerprint.byLocale) })}\n`)
    return
  }
  const lines = [`fingerprint: source=${source}`]
  for (const [locale, fp] of Object.entries(fingerprint.byLocale)) {
    lines.push(
      `fingerprint: ${locale} words=${fp.sample.words} sentences=${fp.sample.sentences} ` +
      `meanSentence=${fp.universal.meanSentenceLength} english=${fp.english ? 'yes' : 'n/a'}`
    )
  }
  if (Object.keys(fingerprint.byLocale).length === 0) lines.push('fingerprint: no copy found; check scan.include')
  if (fingerprint.baseline) lines.push(`fingerprint: baseline ${fingerprint.baseline.generated}`)
  lines.push(`fingerprint: wrote ${toPosix(path.relative(projectRoot, out))}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/fingerprint.test.mjs`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/fingerprint.mjs test/fingerprint.test.mjs
git commit -m "feat(scripts): per-locale corpus fingerprint with drift baseline"
```

---

### Task 9: Knowledge-base parser and tone interpolation

The KB is markdown so humans can read it and git can diff it, which means the plugin needs a parser for its own format. §4.3 and §4.4 fix the rule shapes; §4.6 fixes the evidence shape; §6.5 fixes interpolation; §6.6 fixes the two humor gates.

The humor gates are implemented here rather than in a skill on purpose. A gate written in prose is a gate the model can talk itself past; a gate in a pure function returns `0` every time. The failure mode of a computed cell must be "a bit flat", never "joked at someone whose payment just failed".

**Files:**
- Create: `scripts/lib/kb.mjs`
- Test: `test/kb.test.mjs`

**Interfaces:**
- Consumes: `readTextFile` (Task 3), `loadConfig` (Task 6).
- Produces:
  - Vocabularies: `STATES`, `CONTEXTS`, `DIALS`, `HUMOR_ZERO_STATES`, `CONFIDENCE_LEVELS`, `EVIDENCE_TYPES`, `ID_PREFIXES`.
  - `cellId(context, state) -> string`
  - `parseRuleHeading(line) -> {id, name, confidence, evidence} | null`
  - `parseProseRules(md) -> Array<{id, name, confidence, evidence, fields, line}>` - HTML-commented blocks are masked out first, with line numbers preserved
  - `parseTables(md) -> Array<{section, headers, rows}>`
  - `parseTableRules(md) -> Array<{id, confidence, evidence, cells, section, line}>`
  - `parseToneCells(md) -> Array<{id, context, state, confidence, evidence, dials, feeling, do, dont, example, line}>`
  - `parseVectors(md) -> {states: Record<string, Dials>, contexts: Record<string, Dials>}`
  - `parseEvidence(md) -> Array<{id, date, type, fields, produced, line}>`
  - `interpolate(stateVector, contextOffset) -> Dials` (clamped 0-4, `humor` forced to 0 - gate 1)
  - `applyHumorGates(dials, state) -> Dials` (gate 2)
  - `resolveCell(context, state, {cells, vectors}) -> {id, context, state, dials, source, confidence, cell}`
  - `loadKb(kbRoot) -> {config, voice, tone, lexicon, mechanics, audience, ledger, conflicts, rules, cells, vectors, evidence, channels, locales, files}`

- [ ] **Step 1: Write the failing test**

`test/kb.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import {
  STATES, CONTEXTS, DIALS, HUMOR_ZERO_STATES,
  cellId, parseRuleHeading, parseProseRules, parseTables, parseTableRules,
  parseToneCells, parseVectors, parseEvidence,
  interpolate, applyHumorGates, resolveCell, loadKb
} from '../scripts/lib/kb.mjs'

test('vocabularies match the spec exactly', () => {
  assert.equal(STATES.length, 8)
  assert.equal(CONTEXTS.length, 10)
  assert.deepEqual(DIALS, ['warmth', 'humor', 'directness', 'detail', 'urgency', 'formality'])
  assert.deepEqual(HUMOR_ZERO_STATES, ['frustrated', 'anxious-at-risk', 'disappointed-leaving'])
  assert.ok(STATES.includes('anxious-at-risk'))
  assert.ok(CONTEXTS.includes('system-error'))
  assert.equal(cellId('product-ui', 'confused'), 'T-product-ui/confused')
})

test('rule headings yield id, name, confidence, and evidence refs', () => {
  assert.deepEqual(
    parseRuleHeading('### V1 · Plainspoken   `confirmed`  ev: e12, e18'),
    { id: 'V1', name: 'Plainspoken', confidence: 'confirmed', evidence: ['e12', 'e18'] }
  )
  assert.deepEqual(
    parseRuleHeading('### T-system-error/frustrated   `derived`  ev: e40'),
    { id: 'T-system-error/frustrated', name: null, confidence: 'derived', evidence: ['e40'] }
  )
  assert.deepEqual(
    parseRuleHeading('### V2 · Genuine `assumed`'),
    { id: 'V2', name: 'Genuine', confidence: 'assumed', evidence: [] }
  )
  assert.equal(parseRuleHeading('## Voice characteristics'), null)
})

test('prose rules capture their labelled fields', () => {
  const md = [
    '## Characteristics',
    '',
    '### V1 · Plainspoken   `confirmed`  ev: e12',
    '',
    '**Means:** Clarity above all.',
    '**Rules out:** fluffy metaphor, upsell language',
    '**Do:** name the thing · state the outcome',
    "**Don't:** reach for a simile",
    '**Example:** *"Your campaign is scheduled."*',
    '',
    '### V2 · Genuine   `assumed`',
    '',
    '**Means:** We sound like a person.'
  ].join('\n')

  const rules = parseProseRules(md)
  assert.equal(rules.length, 2)
  assert.equal(rules[0].fields.Means, 'Clarity above all.')
  assert.deepEqual(rules[0].fields['Rules out'], 'fluffy metaphor, upsell language')
  assert.equal(rules[0].evidence[0], 'e12')
  assert.equal(rules[1].confidence, 'assumed')
  assert.ok(rules[0].line > 0, 'line numbers anchor review findings')
})

test('rules and tables inside HTML comments are documentation, not rules', () => {
  const md = [
    '## Characteristics',
    '',
    '<!--',
    '### V1 · Plainspoken   `confirmed`  ev: e99',
    '',
    '**Means:** An example nobody has adopted yet.',
    '-->',
    '',
    '### V2 · Genuine   `confirmed`  ev: e1',
    '',
    '**Means:** A real rule.'
  ].join('\n')

  const rules = parseProseRules(md)
  assert.deepEqual(rules.map((r) => r.id), ['V2'], 'the commented example must not become a rule')
  assert.equal(rules[0].line, 9, 'masking preserves line numbers')

  const commentedTable = [
    '<!--',
    '| ID | Avoid | Prefer | Why | Conf | Ev |',
    '|---|---|---|---|---|---|',
    '| L99 | example | sample | illustration | confirmed | e99 |',
    '-->'
  ].join('\n')
  assert.deepEqual(parseTableRules(commentedTable), [])

  assert.deepEqual(parseEvidence('<!--\n### e99 — 2026-08-26 — interview\n-->'), [])
})

test('tabular rules read ID, Conf, and Ev columns', () => {
  const md = [
    '## Avoid',
    '',
    '| ID  | Avoid    | Prefer | Why         | Conf      | Ev  |',
    '|-----|----------|--------|-------------|-----------|-----|',
    '| L07 | leverage | use    | jargon      | confirmed | e22 |',
    '| L08 | simply   | —      | condescends | derived   | e31, e33 |'
  ].join('\n')

  const rules = parseTableRules(md)
  assert.equal(rules.length, 2)
  assert.equal(rules[0].id, 'L07')
  assert.equal(rules[0].cells.Avoid, 'leverage')
  assert.equal(rules[0].confidence, 'confirmed')
  assert.deepEqual(rules[1].evidence, ['e31', 'e33'])
  assert.equal(rules[0].section, 'Avoid')

  const tables = parseTables(md)
  assert.equal(tables.length, 1)
  assert.deepEqual(tables[0].headers, ['ID', 'Avoid', 'Prefer', 'Why', 'Conf', 'Ev'])
})

test('tone cells parse dials, do/dont lists, and the example', () => {
  const md = [
    '### T-system-error/frustrated   `confirmed`  ev: e12, e40',
    '',
    "**Reader is feeling:** blocked, and suspecting it's our fault",
    '**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2',
    '**Do:** say what happened · say what to do next · own it if it is ours',
    "**Don't:** joke · apologize twice",
    '**Example:** *"That file did not upload."*'
  ].join('\n')

  const [cell] = parseToneCells(md)
  assert.equal(cell.id, 'T-system-error/frustrated')
  assert.equal(cell.context, 'system-error')
  assert.equal(cell.state, 'frustrated')
  assert.deepEqual(cell.dials, { warmth: 2, humor: 0, directness: 4, detail: 3, urgency: 1, formality: 2 })
  assert.equal(cell.do.length, 3)
  assert.deepEqual(cell.dont, ['joke', 'apologize twice'])
  assert.equal(cell.example, 'That file did not upload.')
})

test('state vectors and context offsets come from their own tables', () => {
  const md = [
    '## State vectors',
    '',
    '| State | warmth | humor | directness | detail | urgency | formality |',
    '|---|---|---|---|---|---|---|',
    '| delighted | 4 | 3 | 2 | 1 | 1 | 1 |',
    '| confused | 3 | 1 | 4 | 4 | 2 | 2 |',
    '',
    '## Context offsets',
    '',
    '| Context | warmth | humor | directness | detail | urgency | formality |',
    '|---|---|---|---|---|---|---|',
    '| system-error | -1 | -2 | +1 | 0 | 0 | 0 |'
  ].join('\n')

  const vectors = parseVectors(md)
  assert.equal(vectors.states.delighted.warmth, 4)
  assert.equal(vectors.states.confused.detail, 4)
  assert.equal(vectors.contexts['system-error'].humor, -2)
  assert.equal(vectors.contexts['system-error'].directness, 1)
})

test('evidence entries are bidirectional: they record what they produced', () => {
  const md = [
    '### e12 — 2026-08-26 — interview',
    '',
    '**Type:** preference-pair',
    '**Asked:** error-message formality',
    '**Answer:** B',
    '**Produced:** V1, T-product-ui/frustrated, M04'
  ].join('\n')

  const [entry] = parseEvidence(md)
  assert.equal(entry.id, 'e12')
  assert.equal(entry.date, '2026-08-26')
  assert.equal(entry.type, 'interview')
  assert.deepEqual(entry.produced, ['V1', 'T-product-ui/frustrated', 'M04'])
  assert.equal(entry.fields.Answer, 'B')
})

test('interpolation clamps to 0-4 and never yields humor (gate 1)', () => {
  const dials = interpolate(
    { warmth: 4, humor: 4, directness: 2, detail: 1, urgency: 1, formality: 1 },
    { warmth: 2, humor: 2, directness: -3, detail: 0, urgency: 0, formality: 0 }
  )
  assert.equal(dials.warmth, 4, 'clamped at the top')
  assert.equal(dials.directness, 0, 'clamped at the bottom')
  assert.equal(dials.humor, 0, 'an interpolated cell may never produce humor')
})

test('gate 2 forces humor to zero for three states even in an authored cell', () => {
  for (const state of HUMOR_ZERO_STATES) {
    const gated = applyHumorGates({ warmth: 3, humor: 4, directness: 2, detail: 2, urgency: 2, formality: 2 }, state)
    assert.equal(gated.humor, 0, `${state} must never be joked at`)
  }
  const ok = applyHumorGates({ warmth: 3, humor: 4, directness: 2, detail: 2, urgency: 2, formality: 2 }, 'delighted')
  assert.equal(ok.humor, 4, 'an authored cell for a safe state keeps its humor')
})

test('resolveCell prefers an authored cell and marks computed ones', () => {
  const cells = parseToneCells([
    '### T-system-error/frustrated   `confirmed`  ev: e1',
    '',
    '**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2'
  ].join('\n'))
  const vectors = {
    states: { delighted: { warmth: 4, humor: 3, directness: 2, detail: 1, urgency: 1, formality: 1 } },
    contexts: { email: { warmth: 0, humor: 0, directness: 0, detail: 1, urgency: 0, formality: 1 } }
  }

  const authored = resolveCell('system-error', 'frustrated', { cells, vectors })
  assert.equal(authored.source, 'authored')
  assert.equal(authored.dials.directness, 4)
  assert.equal(authored.confidence, 'confirmed')

  const computed = resolveCell('email', 'delighted', { cells, vectors })
  assert.equal(computed.source, 'interpolated')
  assert.equal(computed.confidence, 'interpolated')
  assert.equal(computed.dials.humor, 0)
  assert.equal(computed.dials.formality, 2)
  assert.equal(computed.id, 'T-email/delighted')
})

test('loadKb reads every KB file it finds and tolerates missing ones', () => {
  const dir = makeTmpProject({
    'kb/config.yml': 'kb_version: 0.2.0\n',
    'kb/voice.md': '### V1 · Plainspoken `confirmed` ev: e1\n\n**Means:** Clear.\n',
    'kb/lexicon.md': '| ID | Avoid | Prefer | Why | Conf | Ev |\n|---|---|---|---|---|---|\n| L01 | leverage | use | jargon | confirmed | e1 |\n',
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V1, L01\n',
    'kb/channels/email.md': '### C01 · Subject lines `assumed`\n\n**Means:** Short.\n',
    'kb/locales/cs.md': '### X01 · Vykani `confirmed` ev: e1\n\n**Means:** Formal address.\n'
  })
  try {
    const kb = loadKb(path.join(dir, 'kb'))
    assert.equal(kb.config.kb_version, '0.2.0')
    assert.equal(kb.rules.find((r) => r.id === 'V1').confidence, 'confirmed')
    assert.equal(kb.rules.find((r) => r.id === 'L01').cells.Prefer, 'use')
    assert.equal(kb.evidence[0].produced.length, 2)
    assert.deepEqual(Object.keys(kb.channels), ['email'])
    assert.deepEqual(Object.keys(kb.locales), ['cs'])
    assert.deepEqual(kb.cells, [], 'no tone.md means no cells, not a crash')
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/kb.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/kb.mjs'`

- [ ] **Step 3: Implement kb.mjs**

`scripts/lib/kb.mjs`:

```js
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { readTextFile } from './fsx.mjs'
import { loadConfig } from './config.mjs'

export const STATES = [
  'delighted', 'curious', 'focused', 'uncertain',
  'confused', 'frustrated', 'anxious-at-risk', 'disappointed-leaving'
]

export const CONTEXTS = [
  'marketing-page', 'product-ui', 'system-error', 'help-doc', 'email',
  'social', 'legal-policy', 'notification', 'support-reply', 'release-notes'
]

export const DIALS = ['warmth', 'humor', 'directness', 'detail', 'urgency', 'formality']

/** Spec section 6.6, gate 2. Not configurable. */
export const HUMOR_ZERO_STATES = ['frustrated', 'anxious-at-risk', 'disappointed-leaving']

export const CONFIDENCE_LEVELS = ['confirmed', 'derived', 'assumed', 'disputed']
export const EVIDENCE_TYPES = ['source', 'corpus', 'interview', 'correction', 'decision']
export const ID_PREFIXES = {
  V: 'voice', T: 'tone', L: 'lexicon', M: 'mechanics', C: 'channel', A: 'audience', X: 'locale'
}

/**
 * Templates and real knowledge bases keep their example rules inside HTML
 * comments. Those are documentation, not rules - parsing them would enter
 * phantom rules citing evidence that does not exist, and would let a user's
 * commented-out rule silently enforce in review. Blank the comment body but
 * keep the newlines, so reported line numbers still anchor to the file.
 */
function maskComments (md) {
  return String(md).replace(/<!--[\s\S]*?-->/g, (block) => block.replace(/[^\n]/g, ' '))
}

const HEADING = /^#{2,4}\s+([A-Z][\w./-]*)\s*(?:·\s*([^`]*?))?\s*`([a-z]+)`(?:\s*ev:\s*([^`]+?))?\s*$/
const FIELD = /^\*\*([^:*]+):\*\*\s*(.*)$/
const EVIDENCE_HEADING = /^#{2,4}\s+(e\d+)\s*[—-]\s*(\d{4}-\d{2}-\d{2})\s*[—-]\s*([a-z-]+)\s*$/
const LIST_SEPARATOR = /\s*·\s*/

export function cellId (context, state) {
  return `T-${context}/${state}`
}

function parseRefs (raw) {
  if (!raw) return []
  return raw.split(/[,\s]+/).map((r) => r.trim()).filter(Boolean)
}

export function parseRuleHeading (line) {
  const match = HEADING.exec(String(line))
  if (!match) return null
  return {
    id: match[1],
    name: match[2] ? match[2].trim() : null,
    confidence: match[3],
    evidence: parseRefs(match[4])
  }
}

function collectFields (lines, from, to) {
  const fields = {}
  for (let i = from; i < to; i++) {
    const match = FIELD.exec(lines[i].trim())
    if (match) fields[match[1].trim()] = match[2].trim()
  }
  return fields
}

function blockBoundaries (lines) {
  // Every heading line index, plus a sentinel so the last block has an end.
  const starts = []
  lines.forEach((line, index) => {
    if (/^#{1,6}\s/.test(line)) starts.push(index)
  })
  starts.push(lines.length)
  return starts
}

export function parseProseRules (md) {
  const lines = maskComments(md).split('\n')
  const bounds = blockBoundaries(lines)
  const rules = []
  for (let b = 0; b < bounds.length - 1; b++) {
    const start = bounds[b]
    const heading = parseRuleHeading(lines[start])
    if (!heading) continue
    rules.push({ ...heading, fields: collectFields(lines, start + 1, bounds[b + 1]), line: start + 1 })
  }
  return rules
}

function currentSection (lines, upto) {
  for (let i = upto; i >= 0; i--) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(lines[i])
    if (match) return match[1].replace(/`[a-z]+`.*$/, '').trim()
  }
  return null
}

function splitRow (line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

export function parseTables (md) {
  const lines = maskComments(md).split('\n')
  const tables = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|')) continue
    if (!/^\s*\|?[\s:-]*-{2,}[\s:|-]*$/.test(lines[i + 1])) continue

    const headers = splitRow(lines[i])
    const rows = []
    let r = i + 2
    for (; r < lines.length && lines[r].trim().startsWith('|'); r++) {
      const cells = splitRow(lines[r])
      const row = {}
      headers.forEach((header, index) => { row[header] = cells[index] ?? '' })
      rows.push({ row, line: r + 1 })
    }
    tables.push({ section: currentSection(lines, i), headers, rows })
    i = r - 1
  }
  return tables
}

export function parseTableRules (md) {
  const out = []
  for (const table of parseTables(md)) {
    if (!table.headers.includes('ID')) continue
    for (const { row, line } of table.rows) {
      const id = (row.ID || '').trim()
      if (!id || /^-+$/.test(id)) continue
      const cells = { ...row }
      delete cells.ID
      delete cells.Conf
      delete cells.Ev
      out.push({
        id,
        confidence: (row.Conf || '').trim() || null,
        evidence: parseRefs(row.Ev),
        cells,
        section: table.section,
        line
      })
    }
  }
  return out
}

export function parseDials (raw) {
  const dials = {}
  for (const match of String(raw).matchAll(/([a-z]+)\s*([+-]?\d+)/gi)) {
    const name = match[1].toLowerCase()
    if (DIALS.includes(name)) dials[name] = Number(match[2])
  }
  return dials
}

function parseList (raw) {
  if (!raw) return []
  return String(raw).split(LIST_SEPARATOR).map((item) => item.trim()).filter(Boolean)
}

export function parseToneCells (md) {
  const cells = []
  for (const rule of parseProseRules(md)) {
    const match = /^T-([a-z-]+)\/([a-z-]+)$/.exec(rule.id)
    if (!match) continue
    cells.push({
      id: rule.id,
      context: match[1],
      state: match[2],
      confidence: rule.confidence,
      evidence: rule.evidence,
      dials: parseDials(rule.fields.Dials || ''),
      feeling: rule.fields['Reader is feeling'] || null,
      do: parseList(rule.fields.Do),
      dont: parseList(rule.fields["Don't"]),
      example: (rule.fields.Example || '').replace(/^\*?"?|"?\*?$/g, '').trim() || null,
      line: rule.line
    })
  }
  return cells
}

function vectorsFromTable (table) {
  const out = {}
  const keyColumn = table.headers[0]
  for (const { row } of table.rows) {
    const key = (row[keyColumn] || '').trim()
    if (!key || /^-+$/.test(key)) continue
    const dials = {}
    for (const dial of DIALS) {
      if (row[dial] !== undefined && row[dial] !== '') dials[dial] = Number(row[dial])
    }
    out[key] = dials
  }
  return out
}

export function parseVectors (md) {
  const result = { states: {}, contexts: {} }
  for (const table of parseTables(md)) {
    const first = (table.headers[0] || '').toLowerCase()
    if (first === 'state') Object.assign(result.states, vectorsFromTable(table))
    if (first === 'context') Object.assign(result.contexts, vectorsFromTable(table))
  }
  return result
}

export function parseEvidence (md) {
  const lines = maskComments(md).split('\n')
  const bounds = blockBoundaries(lines)
  const entries = []
  for (let b = 0; b < bounds.length - 1; b++) {
    const start = bounds[b]
    const match = EVIDENCE_HEADING.exec(lines[start])
    if (!match) continue
    const fields = collectFields(lines, start + 1, bounds[b + 1])
    entries.push({
      id: match[1],
      date: match[2],
      type: match[3],
      fields,
      produced: parseRefs(fields.Produced),
      line: start + 1
    })
  }
  return entries
}

const clamp = (n) => Math.max(0, Math.min(4, n))

/** Spec 6.5 arithmetic, plus gate 1: computed cells never carry humor. */
export function interpolate (stateVector = {}, contextOffset = {}) {
  const dials = {}
  for (const dial of DIALS) {
    dials[dial] = clamp(Number(stateVector[dial] ?? 2) + Number(contextOffset[dial] ?? 0))
  }
  dials.humor = 0
  return dials
}

/** Spec 6.6 gate 2. Applies to authored cells too. */
export function applyHumorGates (dials, state) {
  const out = { ...dials }
  if (HUMOR_ZERO_STATES.includes(state)) out.humor = 0
  return out
}

export function resolveCell (context, state, { cells = [], vectors = { states: {}, contexts: {} } } = {}) {
  const id = cellId(context, state)
  const authored = cells.find((cell) => cell.id === id)

  if (authored) {
    return {
      id,
      context,
      state,
      dials: applyHumorGates({ ...authored.dials }, state),
      source: 'authored',
      confidence: authored.confidence,
      cell: authored
    }
  }

  return {
    id,
    context,
    state,
    dials: applyHumorGates(interpolate(vectors.states[state], vectors.contexts[context]), state),
    source: 'interpolated',
    confidence: 'interpolated',
    cell: null
  }
}

function readIfPresent (file) {
  return existsSync(file) ? readTextFile(file) : ''
}

function readDirectory (dir) {
  if (!existsSync(dir)) return {}
  const out = {}
  for (const name of readdirSync(dir).sort()) {
    if (!name.toLowerCase().endsWith('.md')) continue
    if (name.startsWith('_')) continue // _template.md is a skeleton, not content
    out[name.replace(/\.md$/i, '')] = readTextFile(path.join(dir, name))
  }
  return out
}

export function loadKb (kbRoot) {
  const files = {
    voice: readIfPresent(path.join(kbRoot, 'voice.md')),
    tone: readIfPresent(path.join(kbRoot, 'tone.md')),
    audience: readIfPresent(path.join(kbRoot, 'audience.md')),
    lexicon: readIfPresent(path.join(kbRoot, 'lexicon.md')),
    mechanics: readIfPresent(path.join(kbRoot, 'mechanics.md')),
    ledger: readIfPresent(path.join(kbRoot, 'evidence', 'ledger.md')),
    conflicts: readIfPresent(path.join(kbRoot, 'evidence', 'conflicts.md')),
    context: readIfPresent(path.join(kbRoot, 'CONTEXT.md'))
  }
  const channels = readDirectory(path.join(kbRoot, 'channels'))
  const locales = readDirectory(path.join(kbRoot, 'locales'))

  const proseSources = { ...files, ...channels, ...locales }
  const rules = []
  for (const [name, body] of Object.entries(proseSources)) {
    if (name === 'ledger' || name === 'context') continue
    for (const rule of parseProseRules(body)) rules.push({ ...rule, file: name, kind: 'prose' })
    for (const rule of parseTableRules(body)) rules.push({ ...rule, file: name, kind: 'table' })
  }

  return {
    kbRoot,
    config: loadConfig(kbRoot),
    ...files,
    channels,
    locales,
    files,
    rules,
    cells: parseToneCells(files.tone),
    vectors: parseVectors(files.tone),
    evidence: parseEvidence(files.ledger)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/kb.test.mjs`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/kb.mjs test/kb.test.mjs
git commit -m "feat(lib): knowledge-base parser, tone interpolation, humor gates"
```

---

### Task 10: `validate.mjs`

§7.4 lists what `:sync` must catch: broken evidence refs, orphaned rules, duplicate IDs, cells referencing unknown contexts or states, dial values out of range. Two more belong here because they are the ones that would do real damage silently: a violated humor gate, and one-way evidence.

§4.6 makes bidirectionality a requirement, not a nicety - "when a user says *ignore the 2024 newsletters, we've changed*, the plugin knows exactly which rules to reopen rather than guessing". A rule citing `e12` while `e12` does not list that rule breaks retraction, and nothing else in the system would notice.

**Files:**
- Create: `scripts/validate.mjs`
- Test: `test/validate.test.mjs`

**Interfaces:**
- Consumes: `loadKb` and the vocabularies (Task 9), CLI helpers (Task 6).
- Produces: `validateKb(kb) -> {findings: Array<{severity: 'error'|'warning', code, message, file, line}>, errors: number, warnings: number}`. CLI exits `2` when `errors > 0`.

**Codes, fixed:**

| Code | Severity | Meaning |
|---|---|---|
| `E_NO_KB` | error | `config.yml`, `voice.md`, and `tone.md` are all absent - there is no knowledge base at this path |
| `E_DUPLICATE_ID` | error | the same rule ID appears twice |
| `E_UNKNOWN_PREFIX` | error | rule ID uses a prefix outside `V T L M C A X` |
| `E_NO_CONFIDENCE` | error | rule declares no confidence at all (an empty `Conf` column) |
| `E_UNKNOWN_CONFIDENCE` | error | confidence outside the four levels |
| `E_BROKEN_EVIDENCE_REF` | error | rule cites an evidence ID the ledger does not have |
| `E_UNKNOWN_EVIDENCE_TYPE` | error | ledger entry type outside the five types |
| `E_UNKNOWN_CONTEXT` | error | tone cell names a context outside the ten |
| `E_UNKNOWN_STATE` | error | tone cell names a state outside the eight |
| `E_DIAL_RANGE` | error | authored dial outside 0-4, or an unknown dial name |
| `E_VECTOR_RANGE` | error | state vector outside 0-4, or context offset outside -4-+4 |
| `E_HUMOR_GATE` | error | authored cell for a humor-zero state carries humor > 0 |
| `W_NO_EVIDENCE` | warning | a non-`assumed` rule cites no evidence |
| `W_ONE_WAY_EVIDENCE` | warning | rule cites evidence that does not list the rule back |
| `W_ORPHAN_EVIDENCE` | warning | ledger entry claims to have produced a rule that does not exist |
| `W_MISSING_VECTOR` | warning | a state or context has no vector, so interpolation falls back to neutral |
| `W_UNPARSED_RULE_HEADING` | warning | a heading reads as a rule ID but omits the backtick confidence, so it is parsed as no rule at all |

- [ ] **Step 1: Write the failing test**

`test/validate.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { loadKb } from '../scripts/lib/kb.mjs'
import { validateKb } from '../scripts/validate.mjs'

const codesOf = (report) => report.findings.map((f) => f.code)

function kbFrom (files) {
  const dir = makeTmpProject(files)
  return { dir, kb: loadKb(path.join(dir, 'kb')) }
}

test('a clean knowledge base reports nothing', () => {
  const { dir, kb } = kbFrom({
    'kb/voice.md': '### V1 · Plainspoken `confirmed` ev: e1\n\n**Means:** Clear.\n',
    'kb/tone.md': [
      '### T-system-error/frustrated `confirmed` ev: e1',
      '',
      '**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2',
      '',
      '## State vectors',
      '',
      '| State | warmth | humor | directness | detail | urgency | formality |',
      '|---|---|---|---|---|---|---|',
      '| frustrated | 2 | 0 | 4 | 3 | 1 | 2 |',
      '',
      '## Context offsets',
      '',
      '| Context | warmth | humor | directness | detail | urgency | formality |',
      '|---|---|---|---|---|---|---|',
      '| system-error | -1 | -2 | 1 | 0 | 0 | 0 |'
    ].join('\n'),
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V1, T-system-error/frustrated\n'
  })
  try {
    const report = validateKb(kb)
    assert.equal(report.errors, 0, JSON.stringify(report.findings))
    assert.ok(!codesOf(report).includes('W_ONE_WAY_EVIDENCE'))
  } finally {
    cleanup(dir)
  }
})

test('duplicate ids, bad confidence, and broken refs are errors', () => {
  const { dir, kb } = kbFrom({
    'kb/voice.md': [
      '### V1 · Plainspoken `confirmed` ev: e1',
      '',
      '**Means:** Clear.',
      '',
      '### V1 · Repeated `confirmed` ev: e1',
      '',
      '**Means:** Duplicate id.',
      '',
      '### V2 · Odd `probably` ev: e99',
      '',
      '**Means:** Bad confidence and a missing evidence id.',
      '',
      '### Q1 · Wrong prefix `assumed`',
      '',
      '**Means:** No such prefix.'
    ].join('\n'),
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V1\n'
  })
  try {
    const codes = codesOf(validateKb(kb))
    assert.ok(codes.includes('E_DUPLICATE_ID'))
    assert.ok(codes.includes('E_UNKNOWN_CONFIDENCE'))
    assert.ok(codes.includes('E_BROKEN_EVIDENCE_REF'))
    assert.ok(codes.includes('E_UNKNOWN_PREFIX'))
  } finally {
    cleanup(dir)
  }
})

test('tone cells are checked against the fixed vocabularies and dial range', () => {
  const { dir, kb } = kbFrom({
    'kb/tone.md': [
      '### T-carrier-pigeon/confused `confirmed` ev: e1',
      '',
      '**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2',
      '',
      '### T-email/hangry `confirmed` ev: e1',
      '',
      '**Dials:** warmth 9 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2'
    ].join('\n'),
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — decision\n\n**Produced:** T-carrier-pigeon/confused, T-email/hangry\n'
  })
  try {
    const codes = codesOf(validateKb(kb))
    assert.ok(codes.includes('E_UNKNOWN_CONTEXT'))
    assert.ok(codes.includes('E_UNKNOWN_STATE'))
    assert.ok(codes.includes('E_DIAL_RANGE'))
  } finally {
    cleanup(dir)
  }
})

test('an authored cell cannot smuggle humor past gate 2', () => {
  const { dir, kb } = kbFrom({
    'kb/tone.md': [
      '### T-system-error/frustrated `confirmed` ev: e1',
      '',
      '**Dials:** warmth 2 · humor 3 · directness 4 · detail 3 · urgency 1 · formality 2'
    ].join('\n'),
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — decision\n\n**Produced:** T-system-error/frustrated\n'
  })
  try {
    const finding = validateKb(kb).findings.find((f) => f.code === 'E_HUMOR_GATE')
    assert.ok(finding, 'humor on a frustrated cell must be an error')
    assert.match(finding.message, /frustrated/)
  } finally {
    cleanup(dir)
  }
})

test('one-way evidence and orphaned evidence are warnings, not errors', () => {
  const { dir, kb } = kbFrom({
    'kb/voice.md': '### V1 · Plainspoken `confirmed` ev: e1\n\n**Means:** Clear.\n\n### V2 · Genuine `derived`\n\n**Means:** No evidence at all.\n',
    'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V7\n'
  })
  try {
    const report = validateKb(kb)
    const codes = codesOf(report)
    assert.ok(codes.includes('W_ONE_WAY_EVIDENCE'), 'V1 cites e1 but e1 does not list V1')
    assert.ok(codes.includes('W_ORPHAN_EVIDENCE'), 'e1 claims V7, which does not exist')
    assert.ok(codes.includes('W_NO_EVIDENCE'), 'a derived rule with no evidence')
    assert.equal(report.errors, 0)
    assert.ok(report.warnings >= 3)
  } finally {
    cleanup(dir)
  }
})

test('findings carry a file and a line so they can be jumped to', () => {
  const { dir, kb } = kbFrom({
    'kb/voice.md': '# Voice\n\n### V1 · Odd `probably`\n\n**Means:** Bad.\n',
    'kb/evidence/ledger.md': ''
  })
  try {
    const finding = validateKb(kb).findings.find((f) => f.code === 'E_UNKNOWN_CONFIDENCE')
    assert.equal(finding.file, 'voice.md')
    assert.equal(finding.line, 3)
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/validate.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/validate.mjs'`

- [ ] **Step 3: Implement validate.mjs**

`scripts/validate.mjs`:

```js
import { pathToFileURL } from 'node:url'
import {
  loadKb, STATES, CONTEXTS, DIALS, CONFIDENCE_LEVELS, EVIDENCE_TYPES, ID_PREFIXES,
  HUMOR_ZERO_STATES, cellId
} from './lib/kb.mjs'
import { parseCliArgs, resolveRoots, die, printHelp } from './lib/cli.mjs'

export function validateKb (kb) {
  const findings = []
  const add = (severity, code, message, file, line) =>
    findings.push({ severity, code, message, file: `${file}.md`, line })

  const evidenceById = new Map(kb.evidence.map((entry) => [entry.id, entry]))
  const ruleIds = new Set()

  for (const rule of kb.rules) {
    if (ruleIds.has(rule.id)) {
      add('error', 'E_DUPLICATE_ID', `rule id ${rule.id} is used more than once`, rule.file, rule.line)
    }
    ruleIds.add(rule.id)

    if (!ID_PREFIXES[rule.id[0]]) {
      add('error', 'E_UNKNOWN_PREFIX', `rule id ${rule.id} uses an unknown prefix`, rule.file, rule.line)
    }
    if (rule.confidence && !CONFIDENCE_LEVELS.includes(rule.confidence)) {
      add('error', 'E_UNKNOWN_CONFIDENCE',
        `rule ${rule.id} has confidence "${rule.confidence}"`, rule.file, rule.line)
    }
    for (const ref of rule.evidence) {
      if (!evidenceById.has(ref)) {
        add('error', 'E_BROKEN_EVIDENCE_REF',
          `rule ${rule.id} cites ${ref}, which is not in the ledger`, rule.file, rule.line)
        continue
      }
      if (!evidenceById.get(ref).produced.includes(rule.id)) {
        add('warning', 'W_ONE_WAY_EVIDENCE',
          `rule ${rule.id} cites ${ref}, but ${ref} does not list ${rule.id} under Produced`,
          rule.file, rule.line)
      }
    }
    if (rule.evidence.length === 0 && rule.confidence && rule.confidence !== 'assumed') {
      add('warning', 'W_NO_EVIDENCE',
        `rule ${rule.id} is ${rule.confidence} but cites no evidence`, rule.file, rule.line)
    }
  }

  for (const entry of kb.evidence) {
    if (!EVIDENCE_TYPES.includes(entry.type)) {
      add('error', 'E_UNKNOWN_EVIDENCE_TYPE',
        `evidence ${entry.id} has type "${entry.type}"`, 'evidence/ledger', entry.line)
    }
    for (const produced of entry.produced) {
      if (!ruleIds.has(produced)) {
        add('warning', 'W_ORPHAN_EVIDENCE',
          `evidence ${entry.id} claims to have produced ${produced}, which does not exist`,
          'evidence/ledger', entry.line)
      }
    }
  }

  for (const cell of kb.cells) {
    if (!CONTEXTS.includes(cell.context)) {
      add('error', 'E_UNKNOWN_CONTEXT', `cell ${cell.id} names context "${cell.context}"`, 'tone', cell.line)
    }
    if (!STATES.includes(cell.state)) {
      add('error', 'E_UNKNOWN_STATE', `cell ${cell.id} names state "${cell.state}"`, 'tone', cell.line)
    }
    for (const [dial, value] of Object.entries(cell.dials)) {
      if (!DIALS.includes(dial) || !Number.isInteger(value) || value < 0 || value > 4) {
        add('error', 'E_DIAL_RANGE', `cell ${cell.id} has ${dial} = ${value}; dials are integers 0-4`,
          'tone', cell.line)
      }
    }
    if (HUMOR_ZERO_STATES.includes(cell.state) && Number(cell.dials.humor) > 0) {
      add('error', 'E_HUMOR_GATE',
        `cell ${cell.id} sets humor ${cell.dials.humor}; state "${cell.state}" forces humor 0`,
        'tone', cell.line)
    }
  }

  const hasVectors = Object.keys(kb.vectors.states).length > 0 || Object.keys(kb.vectors.contexts).length > 0
  if (hasVectors) {
    for (const [state, dials] of Object.entries(kb.vectors.states)) {
      if (!STATES.includes(state)) add('error', 'E_UNKNOWN_STATE', `state vector "${state}" is not a known state`, 'tone', 0)
      for (const [dial, value] of Object.entries(dials)) {
        if (!Number.isInteger(value) || value < 0 || value > 4) {
          add('error', 'E_VECTOR_RANGE', `state vector ${state}.${dial} = ${value}; must be 0-4`, 'tone', 0)
        }
      }
    }
    for (const [context, dials] of Object.entries(kb.vectors.contexts)) {
      if (!CONTEXTS.includes(context)) add('error', 'E_UNKNOWN_CONTEXT', `context offset "${context}" is not a known context`, 'tone', 0)
      for (const [dial, value] of Object.entries(dials)) {
        if (!Number.isInteger(value) || value < -4 || value > 4) {
          add('error', 'E_VECTOR_RANGE', `context offset ${context}.${dial} = ${value}; must be -4 to 4`, 'tone', 0)
        }
      }
    }
    for (const state of STATES) {
      if (!kb.vectors.states[state]) {
        add('warning', 'W_MISSING_VECTOR', `state "${state}" has no vector; interpolation falls back to neutral`, 'tone', 0)
      }
    }
    for (const context of CONTEXTS) {
      if (!kb.vectors.contexts[context]) {
        add('warning', 'W_MISSING_VECTOR', `context "${context}" has no offset; interpolation falls back to neutral`, 'tone', 0)
      }
    }
  }

  return {
    findings,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    counts: {
      rules: kb.rules.length,
      cells: kb.cells.length,
      evidence: kb.evidence.length,
      authoredCells: kb.cells.length,
      possibleCells: CONTEXTS.length * STATES.length
    }
  }
}

function main (argv) {
  const { values } = parseCliArgs(argv)
  if (values.help) {
    printHelp('scripts/validate.mjs', [
      'Checks knowledge-base integrity. Exits 2 when any error is found.',
      '',
      '  --root <dir>   project root (default: cwd)',
      '  --kb <dir>     knowledge base dir',
      '  --json         print the report as JSON'
    ])
    return
  }

  const { kbRoot } = resolveRoots(values)
  const report = validateKb(loadKb(kbRoot))

  if (values.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    const lines = report.findings.map(
      (f) => `validate: ${f.severity.toUpperCase()} ${f.code} ${f.file}:${f.line} ${f.message}`
    )
    lines.push(
      `validate: ${report.counts.rules} rules, ${report.counts.cells} authored cells of ` +
      `${report.counts.possibleCells}, ${report.counts.evidence} evidence entries`
    )
    lines.push(`validate: ${report.errors} errors, ${report.warnings} warnings`)
    process.stdout.write(`${lines.join('\n')}\n`)
  }

  if (report.errors > 0) process.exit(2)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main, cellId }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/validate.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/validate.mjs test/validate.test.mjs
git commit -m "feat(scripts): knowledge-base integrity validation"
```

---

### Task 11: `compile-context.mjs` and violation ranking

`CONTEXT.md` is the always-loaded card, and §4.8 is unambiguous: **generated only, never hand-edited**, ~600 tokens, with lexicon and mechanics entries "ranked by violation frequency in the corpus, `confirmed` first on ties". Ranking by frequency is what makes the budget worth spending - the eight entries the project actually breaks are worth more than the eight with the lowest IDs.

**Files:**
- Create: `scripts/lib/hits.mjs`
- Create: `scripts/compile-context.mjs`
- Test: `test/hits.test.mjs`
- Test: `test/compile-context.test.mjs`

**Interfaces:**
- Consumes: `gatherCorpus` (Task 6), `loadKb`/`parseDials`/vocabularies (Task 9), `writeTextFile` (Task 3), CLI helpers (Task 6).
- Produces:
  - `hits.mjs`: `countHits(corpusStrings, rules) -> Map<ruleId, number>`; `rankRules(rules, hits) -> Rule[]` (hits desc, then `confirmed` before others, then ID ascending).
  - `compile-context.mjs`: `compileContext(kb, {corpusStrings, generated, profileName}) -> string`; `estimateTokens(text) -> number`. Writes `<kb>/CONTEXT.md`.

**How a rule becomes countable:** a lexicon rule is counted by whole-word, case-insensitive occurrences of its `Avoid` cell. A mechanics rule is counted only when its row carries a `Pattern` column holding a regular-expression source; without one it scores `0` and sorts on confidence and ID. This is deliberate - a mechanics rule with no machine-checkable pattern should not outrank one the corpus demonstrably breaks.

- [ ] **Step 1: Write the failing hits test**

`test/hits.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countHits, rankRules } from '../scripts/lib/hits.mjs'

const lexicon = [
  { id: 'L01', confidence: 'derived', cells: { Avoid: 'leverage', Prefer: 'use' } },
  { id: 'L02', confidence: 'confirmed', cells: { Avoid: 'simply', Prefer: '—' } },
  { id: 'L03', confidence: 'confirmed', cells: { Avoid: 'utilize', Prefer: 'use' } }
]

test('hits are whole-word and case-insensitive', () => {
  const hits = countHits(
    ['Leverage the tool.', 'We simply leverage it.', 'Leveraged is a different word.'],
    lexicon
  )
  assert.equal(hits.get('L01'), 2, 'Leveraged must not count')
  assert.equal(hits.get('L02'), 1)
  assert.equal(hits.get('L03'), 0)
})

test('a mechanics rule counts only when it carries a Pattern', () => {
  const mechanics = [
    { id: 'M01', confidence: 'confirmed', cells: { Rule: 'no double spaces', Pattern: '\\s{2,}' } },
    { id: 'M02', confidence: 'confirmed', cells: { Rule: 'sentence case headings' } }
  ]
  const hits = countHits(['one  two', 'three  four'], mechanics)
  assert.equal(hits.get('M01'), 2)
  assert.equal(hits.get('M02'), 0)
})

test('an invalid pattern scores zero instead of throwing', () => {
  const hits = countHits(['anything'], [{ id: 'M09', confidence: 'assumed', cells: { Pattern: '([' } }])
  assert.equal(hits.get('M09'), 0)
})

test('ranking is hits desc, then confirmed first, then id', () => {
  const hits = new Map([['L01', 5], ['L02', 5], ['L03', 0]])
  assert.deepEqual(rankRules(lexicon, hits).map((r) => r.id), ['L02', 'L01', 'L03'])
})
```

- [ ] **Step 2: Write the failing compile-context test**

`test/compile-context.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { loadKb } from '../scripts/lib/kb.mjs'
import { compileContext, estimateTokens } from '../scripts/compile-context.mjs'

const files = {
  'kb/config.yml': [
    'kb_version: 0.3.1',
    'profiles:',
    '  default:',
    '    name: "Acme"',
    '    primary_locale: en',
    '    locales: [en, cs]'
  ].join('\n'),
  'kb/voice.md': [
    '### V1 · Plainspoken `confirmed` ev: e1',
    '',
    '**Means:** Clarity above all.',
    '**Rules out:** fluffy metaphor, upsell language',
    '',
    '### V2 · Genuine `derived` ev: e1',
    '',
    '**Means:** We sound like a person.',
    '**Rules out:** corporate throat-clearing'
  ].join('\n'),
  'kb/tone.md': [
    '**Default dials:** warmth 3 · humor 1 · directness 3 · detail 2 · urgency 2 · formality 2',
    '',
    '### T-system-error/frustrated `confirmed` ev: e1',
    '',
    '**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2'
  ].join('\n'),
  'kb/lexicon.md': [
    '| ID | Avoid | Prefer | Why | Conf | Ev |',
    '|---|---|---|---|---|---|',
    '| L01 | leverage | use | jargon | derived | e1 |',
    '| L02 | utilize | use | jargon | confirmed | e1 |'
  ].join('\n'),
  'kb/mechanics.md': [
    '| ID | Rule | Pattern | Conf | Ev |',
    '|---|---|---|---|---|',
    '| M01 | no double spaces | \\s{2,} | confirmed | e1 |'
  ].join('\n'),
  'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V1, V2, L01, L02, M01, T-system-error/frustrated\n',
  'kb/channels/email.md': '### C01 · Subject lines `assumed`\n\n**Means:** Short.\n',
  'kb/locales/cs.md': '### X01 · Vykani `confirmed` ev: e1\n\n**Means:** Formal address.\n'
}

test('CONTEXT.md carries every section 4.8 element', () => {
  const dir = makeTmpProject(files)
  try {
    const kb = loadKb(path.join(dir, 'kb'))
    const md = compileContext(kb, {
      corpusStrings: ['We leverage it.', 'We leverage it again.', 'one  two'],
      generated: '2026-08-26T00:00:00.000Z'
    })

    assert.match(md, /GENERATED FILE/)
    assert.match(md, /not affiliated with or endorsed by Mailchimp/i)
    assert.match(md, /Acme/)
    assert.match(md, /0\.3\.1/)
    assert.match(md, /en, cs/)
    assert.match(md, /Plainspoken/)
    assert.match(md, /fluffy metaphor/)
    assert.match(md, /Default dials/)
    assert.match(md, /warmth 3/)
    assert.match(md, /leverage/)
    assert.match(md, /no double spaces/)
    assert.match(md, /humor/i)
    assert.match(md, /frustrated/)
    assert.match(md, /channels\/email\.md/)
    assert.match(md, /locales\/cs\.md/)
    assert.match(md, /tone\.md/)
  } finally {
    cleanup(dir)
  }
})

test('lexicon entries are ranked by corpus violations, not by id', () => {
  const dir = makeTmpProject(files)
  try {
    const kb = loadKb(path.join(dir, 'kb'))
    const md = compileContext(kb, {
      corpusStrings: ['leverage leverage leverage', 'utilize'],
      generated: '2026-08-26T00:00:00.000Z'
    })
    assert.ok(md.indexOf('leverage') < md.indexOf('utilize'),
      'the more-violated term comes first even though L02 is confirmed')
  } finally {
    cleanup(dir)
  }
})

test('the compiled card stays inside its token budget', () => {
  const dir = makeTmpProject(files)
  try {
    const md = compileContext(loadKb(path.join(dir, 'kb')), {
      corpusStrings: [],
      generated: '2026-08-26T00:00:00.000Z'
    })
    assert.ok(estimateTokens(md) < 900, `estimated ${estimateTokens(md)} tokens`)
  } finally {
    cleanup(dir)
  }
})

test('an empty knowledge base still compiles a valid card', () => {
  const dir = makeTmpProject({ 'kb/config.yml': 'kb_version: 0.1.0\n' })
  try {
    const md = compileContext(loadKb(path.join(dir, 'kb')), {
      corpusStrings: [], generated: '2026-08-26T00:00:00.000Z'
    })
    assert.match(md, /GENERATED FILE/)
    assert.match(md, /none yet/i)
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `node --test test/hits.test.mjs test/compile-context.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/hits.mjs'`

- [ ] **Step 4: Implement hits.mjs**

`scripts/lib/hits.mjs`:

```js
const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function patternFor (rule) {
  const explicit = rule.cells?.Pattern
  if (explicit) {
    try { return new RegExp(explicit, 'gi') } catch { return null } // a broken pattern scores 0
  }
  const avoid = rule.cells?.Avoid
  if (!avoid || avoid === '—' || avoid === '-') return null
  // Unicode-aware word boundaries: \b would mis-handle diacritics.
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(avoid)}(?![\\p{L}\\p{N}])`, 'giu')
}

export function countHits (corpusStrings, rules) {
  const text = corpusStrings.join('\n')
  const hits = new Map()
  for (const rule of rules) {
    const pattern = patternFor(rule)
    hits.set(rule.id, pattern ? (text.match(pattern) || []).length : 0)
  }
  return hits
}

export function rankRules (rules, hits) {
  return [...rules].sort((a, b) => {
    const byHits = (hits.get(b.id) ?? 0) - (hits.get(a.id) ?? 0)
    if (byHits !== 0) return byHits
    const aConfirmed = a.confidence === 'confirmed' ? 0 : 1
    const bConfirmed = b.confidence === 'confirmed' ? 0 : 1
    if (aConfirmed !== bConfirmed) return aConfirmed - bConfirmed
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}
```

- [ ] **Step 5: Implement compile-context.mjs**

`scripts/compile-context.mjs`:

```js
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeTextFile, toPosix } from './lib/fsx.mjs'
import { loadConfig, activeProfile } from './lib/config.mjs'
import { gatherCorpus } from './lib/corpus.mjs'
import { loadKb, parseDials, parseTableRules, DIALS, HUMOR_ZERO_STATES } from './lib/kb.mjs'
import { countHits, rankRules } from './lib/hits.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp } from './lib/cli.mjs'

const ATTRIBUTION =
  'Built on Mailchimp\'s Voice and Tone framework (CC BY-NC 4.0). ' +
  'Not affiliated with or endorsed by Mailchimp.'

const NEUTRAL_DIALS = Object.fromEntries(DIALS.map((dial) => [dial, 2]))

export function estimateTokens (text) {
  return Math.ceil(String(text).length / 4)
}

function renderDials (dials) {
  return DIALS.map((dial) => `${dial} ${dials[dial] ?? 2}`).join(' · ')
}

function defaultDials (toneMd) {
  const line = /^\*\*Default dials:\*\*\s*(.+)$/m.exec(toneMd || '')
  return line ? { ...NEUTRAL_DIALS, ...parseDials(line[1]) } : NEUTRAL_DIALS
}

export function compileContext (kb, { corpusStrings = [], generated, profileName = 'default' } = {}) {
  const profile = activeProfile(kb.config, profileName)
  const voiceRules = kb.rules.filter((r) => r.file === 'voice' && r.id.startsWith('V'))
  const lexicon = parseTableRules(kb.lexicon || '')
  const mechanics = parseTableRules(kb.mechanics || '')

  const topLexicon = rankRules(lexicon, countHits(corpusStrings, lexicon)).slice(0, 8)
  const topMechanics = rankRules(mechanics, countHits(corpusStrings, mechanics)).slice(0, 6)

  const lines = []
  lines.push('<!-- GENERATED FILE - do not edit by hand. Rebuild with /voice-and-tone:sync -->')
  lines.push('')
  lines.push('# Voice & Tone - compiled card')
  lines.push('')
  lines.push(`> ${ATTRIBUTION}`)
  lines.push('')
  lines.push(
    `**Brand:** ${profile.name} · **Profile:** ${profileName} · ` +
    `**Locales:** ${(profile.locales ?? []).join(', ') || profile.primary_locale} · ` +
    `**KB version:** ${kb.config.kb_version} · **Generated:** ${generated}`
  )
  lines.push('')

  lines.push('## Voice - constant')
  lines.push('')
  if (voiceRules.length === 0) {
    lines.push('_None yet. Run `/voice-and-tone:init` to discover them._')
  } else {
    for (const rule of voiceRules.slice(0, 6)) {
      lines.push(`- **${rule.name ?? rule.id}** (\`${rule.confidence}\`) - ${rule.fields.Means ?? ''}`)
      lines.push(`  - Rules out: ${rule.fields['Rules out'] ?? '(unspecified)'}`)
    }
  }
  lines.push('')

  lines.push('## Default dials')
  lines.push('')
  lines.push(renderDials(defaultDials(kb.tone)))
  lines.push('')

  lines.push('## Lexicon - most-violated first')
  lines.push('')
  if (topLexicon.length === 0) {
    lines.push('_None yet._')
  } else {
    lines.push('| Avoid | Prefer | Conf |')
    lines.push('|---|---|---|')
    for (const rule of topLexicon) {
      lines.push(`| ${rule.cells.Avoid ?? ''} | ${rule.cells.Prefer ?? ''} | ${rule.confidence ?? ''} |`)
    }
  }
  lines.push('')

  lines.push('## Mechanics - most-violated first')
  lines.push('')
  if (topMechanics.length === 0) {
    lines.push('_None yet._')
  } else {
    for (const rule of topMechanics) {
      lines.push(`- ${rule.cells.Rule ?? Object.values(rule.cells)[0] ?? rule.id} (\`${rule.confidence}\`)`)
    }
  }
  lines.push('')

  lines.push('## Humor gate')
  lines.push('')
  lines.push('Humor requires an **authored** tone cell. An interpolated cell never carries humor.')
  lines.push(`These states force \`humor 0\` whatever the dials say: ${HUMOR_ZERO_STATES.join(' · ')}.`)
  lines.push('')

  lines.push('## Where to look next')
  lines.push('')
  lines.push('| Need | Load |')
  lines.push('|---|---|')
  lines.push(`| A tone cell | \`tone.md\` - ${kb.cells.length} authored of ${10 * 8} |`)
  const channelNames = Object.keys(kb.channels)
  const localeNames = Object.keys(kb.locales)
  lines.push(`| A channel playbook | ${channelNames.length ? channelNames.map((n) => `\`channels/${n}.md\``).join(', ') : '_none yet_'} |`)
  lines.push(`| A locale pack | ${localeNames.length ? localeNames.map((n) => `\`locales/${n}.md\``).join(', ') : '_none yet_'} |`)
  lines.push('| Who we write for | `audience.md` |')
  lines.push('| Why a rule exists | `evidence/ledger.md` |')
  lines.push('')

  return `${lines.join('\n')}\n`
}

function main (argv) {
  const { values } = parseCliArgs(argv, { profile: { type: 'string' } })
  if (values.help) {
    printHelp('scripts/compile-context.mjs', [
      'Regenerates <kb>/CONTEXT.md from the knowledge base. Never edit CONTEXT.md by hand.',
      '',
      '  --root <dir>      project root (default: cwd)',
      '  --kb <dir>        knowledge base dir',
      '  --profile <name>  config profile (default: default)',
      '  --now <iso>       fixed timestamp',
      '  --json            print the summary as JSON'
    ])
    return
  }

  const { projectRoot, kbRoot } = resolveRoots(values)
  const kb = loadKb(kbRoot)
  const config = loadConfig(kbRoot)
  const profileName = values.profile ?? 'default'
  const corpusStrings = gatherCorpus(projectRoot, config, profileName).flatMap((f) => f.strings)

  const md = compileContext(kb, { corpusStrings, generated: nowIso(values), profileName })
  const out = values.out ? path.resolve(values.out) : path.join(kbRoot, 'CONTEXT.md')
  writeTextFile(out, md)

  const tokens = estimateTokens(md)
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ tokens, bytes: md.length })}\n`)
    return
  }
  const lines = [`compile-context: wrote ${toPosix(path.relative(projectRoot, out))} (~${tokens} tokens)`]
  if (tokens > 900) lines.push('compile-context: WARNING over the ~600 token target; trim rules or shorten Means lines')
  process.stdout.write(`${lines.join('\n')}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
```

- [ ] **Step 6: Export `parseDials` from kb.mjs**

`parseDials` is already defined and exported in Task 9. Confirm the import in Step 5 resolves:

Run: `node -e "import('./scripts/lib/kb.mjs').then(m => console.log(typeof m.parseDials))"`
Expected: `function`

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test test/hits.test.mjs test/compile-context.test.mjs`
Expected: PASS, 4 + 4 tests

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/hits.mjs scripts/compile-context.mjs test/hits.test.mjs test/compile-context.test.mjs
git commit -m "feat(scripts): compile CONTEXT.md with violation-ranked rules"
```

---

### Task 12: `diff.mjs`

§8.5 draws the line precisely: `diff.mjs` produces **mechanical** deltas only - word-level changes and length shifts. Semantic classification (§7.1: word swap / tone shift / structural / formatting / factual) is the model's job. "The script provides ground truth; the model interprets. Neither does the other's job."

The one structural inference the script *is* allowed is a word swap, because a removal immediately followed by an insertion of a single token is a mechanical fact, not a judgement. §7.1 lets unambiguous lexicon swaps bypass the corroboration threshold, so surfacing them cleanly is worth the extra pass.

**Files:**
- Create: `scripts/diff.mjs`
- Test: `test/diff.test.mjs`

**Interfaces:**
- Consumes: `splitWords`/`splitSentences`/`normalizeEol` (Task 4), `readTextFile`/`writeTextFile` (Task 3), CLI helpers (Task 6).
- Produces: `mechanicalDiff(draftText, finalText) -> {before, after, changes, wordSwaps, summary}` where `before`/`after` are `{words, sentences, meanSentenceLength}`, `changes` is an array of `{type: 'equal'|'add'|'remove', tokens: string[]}`, `wordSwaps` is `[{from, to}]`, and `summary` is `{added, removed, unchanged, wordDelta, wordDeltaPct}`.

- [ ] **Step 1: Write the failing test**

`test/diff.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mechanicalDiff } from '../scripts/diff.mjs'

test('an unchanged text reports no changes', () => {
  const result = mechanicalDiff('Your campaign is scheduled.', 'Your campaign is scheduled.')
  assert.equal(result.summary.added, 0)
  assert.equal(result.summary.removed, 0)
  assert.equal(result.summary.wordDelta, 0)
  assert.deepEqual(result.wordSwaps, [])
})

test('a single word substitution is reported as a swap', () => {
  const result = mechanicalDiff('We leverage the tool.', 'We use the tool.')
  assert.deepEqual(result.wordSwaps, [{ from: 'leverage', to: 'use' }])
  assert.equal(result.summary.added, 1)
  assert.equal(result.summary.removed, 1)
})

test('length shift is measured in words and percent', () => {
  const result = mechanicalDiff(
    'Your campaign is scheduled and will go out on Thursday at nine.',
    'Campaign scheduled.'
  )
  assert.equal(result.before.words, 12)
  assert.equal(result.after.words, 2)
  assert.equal(result.summary.wordDelta, -10)
  assert.equal(result.summary.wordDeltaPct, -83.33)
})

test('sentence counts and mean sentence length come along', () => {
  const result = mechanicalDiff('One. Two. Three.', 'One sentence only now.')
  assert.equal(result.before.sentences, 3)
  assert.equal(result.after.sentences, 1)
  assert.equal(result.after.meanSentenceLength, 4)
})

test('multi-word rewrites are changes but not swaps', () => {
  const result = mechanicalDiff('Please try again later.', 'Try again in a minute.')
  assert.ok(result.summary.added > 0)
  assert.ok(result.summary.removed > 0)
  assert.deepEqual(result.wordSwaps, [], 'a multi-token rewrite is for the model to classify')
})

test('empty input on either side does not throw', () => {
  assert.equal(mechanicalDiff('', 'Something new.').summary.removed, 0)
  assert.equal(mechanicalDiff('Something old.', '').summary.added, 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/diff.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/diff.mjs'`

- [ ] **Step 3: Implement diff.mjs**

`scripts/diff.mjs`:

```js
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { readTextFile, writeTextFile, toPosix } from './lib/fsx.mjs'
import { splitWords, splitSentences } from './lib/text.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp } from './lib/cli.mjs'

/** Longest common subsequence over word tokens. O(n*m); drafts are short. */
function lcsTable (a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  return table
}

function diffTokens (a, b) {
  const table = lcsTable(a, b)
  const changes = []
  const push = (type, token) => {
    const last = changes[changes.length - 1]
    if (last && last.type === type) last.tokens.push(token)
    else changes.push({ type, tokens: [token] })
  }

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push('equal', a[i]); i++; j++ } else if (table[i + 1][j] >= table[i][j + 1]) { push('remove', a[i]); i++ } else { push('add', b[j]); j++ }
  }
  while (i < a.length) { push('remove', a[i]); i++ }
  while (j < b.length) { push('add', b[j]); j++ }
  return changes
}

function measure (text) {
  const words = splitWords(text)
  const sentences = splitSentences(text)
  return {
    words: words.length,
    sentences: sentences.length,
    meanSentenceLength: sentences.length
      ? Number((words.length / sentences.length).toFixed(2))
      : null
  }
}

export function mechanicalDiff (draftText, finalText) {
  const before = measure(draftText)
  const after = measure(finalText)
  const changes = diffTokens(splitWords(draftText), splitWords(finalText))

  // A one-token removal immediately followed by a one-token insertion is a
  // mechanical fact. Anything longer is a rewrite for the model to classify.
  const wordSwaps = []
  for (let i = 0; i < changes.length - 1; i++) {
    const current = changes[i]
    const next = changes[i + 1]
    if (current.type === 'remove' && next.type === 'add' &&
        current.tokens.length === 1 && next.tokens.length === 1) {
      wordSwaps.push({ from: current.tokens[0], to: next.tokens[0] })
    }
  }

  const added = changes.filter((c) => c.type === 'add').reduce((n, c) => n + c.tokens.length, 0)
  const removed = changes.filter((c) => c.type === 'remove').reduce((n, c) => n + c.tokens.length, 0)
  const unchanged = changes.filter((c) => c.type === 'equal').reduce((n, c) => n + c.tokens.length, 0)

  return {
    before,
    after,
    changes,
    wordSwaps,
    summary: {
      added,
      removed,
      unchanged,
      wordDelta: after.words - before.words,
      wordDeltaPct: before.words
        ? Number((((after.words - before.words) / before.words) * 100).toFixed(2))
        : null
    }
  }
}

function main (argv) {
  const { values } = parseCliArgs(argv, {
    draft: { type: 'string' },
    final: { type: 'string' }
  })
  if (values.help) {
    printHelp('scripts/diff.mjs', [
      'Mechanical draft-to-final deltas. Semantic classification is the model job.',
      '',
      '  --draft <file>  the plugin-produced draft',
      '  --final <file>  the text after the user edited it',
      '  --out <file>    output path (default: <kb>/.drafts/<draft-name>.diff.json)',
      '  --json          print the full result as JSON instead of writing a file'
    ])
    return
  }
  if (!values.draft || !values.final) die('--draft and --final are both required')

  const draftPath = path.resolve(values.draft)
  const result = mechanicalDiff(readTextFile(draftPath), readTextFile(path.resolve(values.final)))
  result.generated = nowIso(values)

  if (values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  const { projectRoot, kbRoot } = resolveRoots(values)
  const base = path.basename(draftPath).replace(/\.[^.]+$/, '')
  const out = values.out ? path.resolve(values.out) : path.join(kbRoot, '.drafts', `${base}.diff.json`)
  writeTextFile(out, `${JSON.stringify(result, null, 2)}\n`)

  process.stdout.write(
    `diff: +${result.summary.added} -${result.summary.removed} words, ` +
    `length ${result.summary.wordDelta >= 0 ? '+' : ''}${result.summary.wordDelta} ` +
    `(${result.summary.wordDeltaPct ?? 'n/a'}%)\n` +
    `diff: ${result.wordSwaps.length} single-word swaps\n` +
    `diff: wrote ${toPosix(path.relative(projectRoot, out))}\n`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/diff.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Run the whole suite**

Run: `node --test test/`
Expected: PASS, all tests from Tasks 1-12

- [ ] **Step 6: Commit**

```bash
git add scripts/diff.mjs test/diff.test.mjs
git commit -m "feat(scripts): mechanical draft-to-final diff with word-swap detection"
```

---

### Task 13: Knowledge-base templates

The skeletons `:init` copies into a target project. They matter more than they look: the tone template ships the **complete** default state-vector and context-offset tables, which is what makes §6.5 interpolation work on day one. Without them every uncomputed cell falls back to neutral and the plugin has no opinion at all.

Everything shipped here is `assumed` - a plugin default, unverified - so nothing enters a user's project claiming a confidence it has not earned.

**Files:**
- Create: `templates/kb/config.yml`
- Create: `templates/kb/CONTEXT.md`
- Create: `templates/kb/voice.md`
- Create: `templates/kb/tone.md`
- Create: `templates/kb/audience.md`
- Create: `templates/kb/lexicon.md`
- Create: `templates/kb/mechanics.md`
- Create: `templates/kb/CHANGELOG.md`
- Create: `templates/kb/gitignore`
- Create: `templates/kb/evidence/ledger.md`
- Create: `templates/kb/evidence/conflicts.md`
- Create: `templates/kb/evidence/fingerprint.json`
- Create: `templates/kb/examples/approved.md`
- Create: `templates/kb/examples/rejected.md`
- Create: `templates/kb/examples/pairs.md`
- Create: `templates/kb/channels/_template.md`
- Create: `templates/kb/locales/_template.md`
- Test: `test/templates.test.mjs`

**Interfaces:**
- Consumes: `parseYaml` (Task 2), `loadKb`/`parseVectors`/vocabularies (Task 9), `validateKb` (Task 10), `compileContext` (Task 11).
- Produces: no code. The contract is that a KB assembled from these templates validates with zero errors and zero warnings, and that `parseVectors` finds all 8 states and all 10 contexts.

- [ ] **Step 1: Write the failing test**

`test/templates.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, cpSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { parseYaml } from '../scripts/lib/yaml.mjs'
import { loadKb, parseVectors, STATES, CONTEXTS, DIALS } from '../scripts/lib/kb.mjs'
import { validateKb } from '../scripts/validate.mjs'
import { compileContext } from '../scripts/compile-context.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templates = path.join(root, 'templates', 'kb')

test('every file the spec section 4.2 layout names is present', () => {
  const expected = [
    'config.yml', 'CONTEXT.md', 'voice.md', 'tone.md', 'audience.md', 'lexicon.md',
    'mechanics.md', 'CHANGELOG.md', 'gitignore',
    path.join('evidence', 'ledger.md'), path.join('evidence', 'conflicts.md'),
    path.join('evidence', 'fingerprint.json'),
    path.join('examples', 'approved.md'), path.join('examples', 'rejected.md'),
    path.join('examples', 'pairs.md'),
    path.join('channels', '_template.md'), path.join('locales', '_template.md')
  ]
  for (const rel of expected) {
    assert.ok(existsSync(path.join(templates, rel)), `templates/kb/${rel} is missing`)
  }
})

test('the config template parses and carries the spec thresholds', () => {
  const config = parseYaml(readFileSync(path.join(templates, 'config.yml'), 'utf8'))
  assert.equal(config.version, 1)
  assert.equal(config.thresholds.corroboration, 2)
  assert.equal(config.thresholds.derived_min_samples, 5)
  assert.equal(config.thresholds.stale_months, 9)
  assert.ok(config.scan.exclude.includes('node_modules/**'))
})

test('the tone template ships a complete vector table for every state and context', () => {
  const vectors = parseVectors(readFileSync(path.join(templates, 'tone.md'), 'utf8'))
  for (const state of STATES) {
    assert.ok(vectors.states[state], `no state vector for ${state}`)
    for (const dial of DIALS) {
      assert.equal(typeof vectors.states[state][dial], 'number', `${state}.${dial}`)
    }
  }
  for (const context of CONTEXTS) {
    assert.ok(vectors.contexts[context], `no context offset for ${context}`)
    for (const dial of DIALS) {
      assert.equal(typeof vectors.contexts[context][dial], 'number', `${context}.${dial}`)
    }
  }
})

test('the three humor-zero states carry humor 0 in the shipped vectors', () => {
  const vectors = parseVectors(readFileSync(path.join(templates, 'tone.md'), 'utf8'))
  for (const state of ['frustrated', 'anxious-at-risk', 'disappointed-leaving']) {
    assert.equal(vectors.states[state].humor, 0, `${state} must ship with humor 0`)
  }
})

test('a knowledge base built from the templates validates clean', () => {
  const dir = makeTmpProject({})
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    cpSync(templates, kbRoot, { recursive: true })
    const report = validateKb(loadKb(kbRoot))
    assert.equal(report.errors, 0, JSON.stringify(report.findings, null, 2))
    assert.equal(report.warnings, 0, JSON.stringify(report.findings, null, 2))
  } finally {
    cleanup(dir)
  }
})

test('CONTEXT.md compiles from the templates and says it is generated', () => {
  const dir = makeTmpProject({})
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    cpSync(templates, kbRoot, { recursive: true })
    const md = compileContext(loadKb(kbRoot), {
      corpusStrings: [], generated: '2026-08-26T00:00:00.000Z'
    })
    assert.match(md, /GENERATED FILE/)
    assert.match(md, /not affiliated with or endorsed by Mailchimp/i)
  } finally {
    cleanup(dir)
  }
})

test('the shipped CONTEXT.md template refuses to be hand-edited', () => {
  const md = readFileSync(path.join(templates, 'CONTEXT.md'), 'utf8')
  assert.match(md, /GENERATED FILE/)
  assert.match(md, /voice-and-tone:sync/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/templates.test.mjs`
Expected: FAIL - `templates/kb/config.yml is missing`

- [ ] **Step 3: Write `templates/kb/config.yml`**

```yaml
# Voice & Tone knowledge base configuration.
# Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0).
# Not affiliated with or endorsed by Mailchimp.
version: 1
kb_version: 0.1.0
profiles:
  default:
    name: "Unnamed"
    primary_locale: en
    locales: [en]
scan:
  include:
    - "content/**/*.md"
    - "content/**/*.mdx"
    - "docs/**/*.md"
    - "locales/**/*.json"
    - "locales/**/*.yml"
    - "locales/**/*.po"
    - "README.md"
  exclude:
    - "node_modules/**"
    - "dist/**"
    - "build/**"
    - ".git/**"
    - ".voice-and-tone/**"
runtime:
  node: detected
  probed: ~
thresholds:
  corroboration: 2
  derived_min_samples: 5
  stale_months: 9
```

- [ ] **Step 4: Write `templates/kb/tone.md`**

The vector tables are the substance of this file. Values are plugin defaults at `assumed` confidence; `:init` overwrites them from the interview.

```markdown
# Tone

Tone flexes with the reader's emotional state. Voice does not.

**Default dials:** warmth 3 · humor 1 · directness 3 · detail 2 · urgency 2 · formality 2

Dials are integers 0-4. A cell is `state_vector + context_offset`, clamped to 0-4.

## Humor gates

1. Humor requires an **authored** cell. An interpolated cell never carries humor,
   whatever the arithmetic yields.
2. `frustrated`, `anxious-at-risk`, and `disappointed-leaving` force `humor 0`
   regardless of dial values, in authored cells too.

## State vectors

| State | warmth | humor | directness | detail | urgency | formality |
|---|---|---|---|---|---|---|
| delighted | 4 | 3 | 2 | 1 | 1 | 1 |
| curious | 3 | 2 | 3 | 3 | 1 | 2 |
| focused | 2 | 1 | 4 | 2 | 2 | 2 |
| uncertain | 3 | 1 | 4 | 3 | 1 | 2 |
| confused | 3 | 1 | 4 | 4 | 2 | 2 |
| frustrated | 2 | 0 | 4 | 3 | 2 | 2 |
| anxious-at-risk | 3 | 0 | 4 | 3 | 3 | 3 |
| disappointed-leaving | 3 | 0 | 4 | 2 | 1 | 3 |

## Context offsets

| Context | warmth | humor | directness | detail | urgency | formality |
|---|---|---|---|---|---|---|
| marketing-page | 1 | 1 | 0 | -1 | 1 | -1 |
| product-ui | 0 | 0 | 1 | -1 | 0 | 0 |
| system-error | -1 | -2 | 1 | 0 | 0 | 0 |
| help-doc | 0 | -1 | 1 | 2 | -1 | 0 |
| email | 1 | 0 | 0 | 0 | 0 | 0 |
| social | 1 | 2 | 0 | -2 | 0 | -2 |
| legal-policy | -1 | -2 | 1 | 2 | -1 | 2 |
| notification | 0 | 0 | 1 | -2 | 1 | 0 |
| support-reply | 1 | -1 | 1 | 1 | 0 | 0 |
| release-notes | 0 | 0 | 1 | 1 | -1 | 0 |

## Authored cells

Cells are promoted here on first real use: the model drafts the full cell, the
user approves it, and it becomes `confirmed`. The matrix fills itself along the
paths actually written.

<!--
Copy this shape for a new cell:

### T-system-error/frustrated   `confirmed`  ev: e12

**Reader is feeling:** blocked, and suspecting it is our fault
**Dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 2
**Do:** say what happened · say what to do next · own it if it is ours
**Don't:** joke · apologize twice · imply they did it wrong
**Example:** *"That file didn't upload - it's over the 25 MB limit. Try a smaller one."*
-->
```

- [ ] **Step 5: Write the remaining markdown templates**

`templates/kb/voice.md`:

```markdown
# Voice - constant

Voice does not change. Tone does. Target 3-6 characteristics; 4 is the default.

## Characteristics

<!--
### V1 · Plainspoken   `confirmed`  ev: e12, e18

**Means:** Clarity above all - we strip hype and over-promise.
**Rules out:** fluffy metaphor, emotional manipulation, upsell language
**Do:** name the thing · state the outcome
**Don't:** reach for a simile when a noun will do
**Example:** *"Your campaign is scheduled."*
-->

## We Are / We Are Not

GENERATED from the `Rules out:` lines above plus the top lexicon entries.
Do not hand-maintain this section - a hand-kept digest drifts from its source.

## Persona rules

Does the brand have a mascot or character? Does it speak, and under what
constraints?

## Self-reference rules

Brand name capitalization · product naming · what the brand calls its users.
```

`templates/kb/audience.md`:

```markdown
# Audience

Who we write for, and what they are feeling when they arrive.

<!--
### A1 · Small-team marketer   `confirmed`  ev: e07

**Means:** Runs campaigns alone, between three other jobs.
**Rules out:** enterprise procurement language, agency jargon
**Do:** lead with the outcome · assume competence, not expertise
**Don't:** explain marketing to a marketer
**Example:** *"Schedule it once. We'll send it Thursday."*
-->

## States they arrive in

| State | When | Where they land |
|---|---|---|
```

`templates/kb/lexicon.md`:

```markdown
# Lexicon

## Love

| ID | Prefer | Why | Conf | Ev |
|---|---|---|---|---|

## Avoid

| ID | Avoid | Prefer | Why | Conf | Ev |
|---|---|---|---|---|---|

## Never say

| ID | Avoid | Prefer | Why | Conf | Ev |
|---|---|---|---|---|---|
```

`templates/kb/mechanics.md`:

```markdown
# Mechanics

Grammar, casing, punctuation, and web elements.

`Pattern` is an optional regular expression that makes a rule machine-countable.
Rules with a pattern can be ranked by how often the corpus breaks them; rules
without one are still enforced by the reviewer, they just do not compete for a
slot in the compiled card.

| ID | Rule | Pattern | Conf | Ev |
|---|---|---|---|---|
```

`templates/kb/CHANGELOG.md`:

```markdown
# Knowledge base changelog

Semver on `kb_version`: **major** when voice characteristics change, **minor**
when cells or rules are added, **patch** for examples, evidence, and wording.

Appended automatically on every approved change. Newest first.
```

`templates/kb/CONTEXT.md`:

```markdown
<!-- GENERATED FILE - do not edit by hand. Rebuild with /voice-and-tone:sync -->

# Voice & Tone - compiled card

Not compiled yet. Run `/voice-and-tone:init` to build the knowledge base, or
`/voice-and-tone:sync` to compile this card from a knowledge base that already exists.
```

`templates/kb/gitignore` (copied to `.voice-and-tone/.gitignore`):

```gitignore
# Plugin-produced drafts, kept for :learn. Pruned at 90 days.
.drafts/
```

`templates/kb/evidence/ledger.md`:

```markdown
# Evidence ledger

Numbered, dated, never renumbered. Every rule points at its evidence and every
entry lists the rules it produced - that bidirectionality is what makes
retraction tractable.

Types: `source` · `corpus` · `interview` · `correction` · `decision`

<!--
### e12 — 2026-08-26 — interview

**Type:** preference-pair
**Asked:** error-message formality, A/B on the project's own string
**Answer:** B — "Campaign scheduled successfully."
**Produced:** V1, T-product-ui/frustrated, M04
-->
```

`templates/kb/evidence/conflicts.md`:

```markdown
# Unresolved conflicts

Sources that genuinely disagree. Recorded at `disputed`, which is **never
enforced** in review. A formal marketing site and a casual app UI may be a
legitimate channel split or may be real drift - the plugin records both sides
and asks rather than picking.

<!--
### D1 — 2026-08-26

**About:** contraction use
**Side A:** marketing site, 0 contractions in 240 sentences (`source`, e04)
**Side B:** app UI strings, 61% contraction rate (`corpus`, e05)
**Asked?** not yet
-->
```

`templates/kb/evidence/fingerprint.json`:

```json
{
  "generated": null,
  "source": "measured",
  "byLocale": {},
  "baseline": null
}
```

`templates/kb/examples/approved.md`:

```markdown
# Approved examples

On-brand samples with provenance. Each entry says where it came from, so a
sample that later turns out to predate a voice change can be retracted.

| Text | Where from | Cell | Ev |
|---|---|---|---|
```

`templates/kb/examples/rejected.md`:

```markdown
# Rejected examples

The anti-corpus. Off-brand samples and what is wrong with them. Useful to a
reviewer in a way that a rule alone is not.

| Text | What is wrong | Rule | Ev |
|---|---|---|---|
```

`templates/kb/examples/pairs.md`:

```markdown
# Before / after pairs

Correction pairs captured by `/voice-and-tone:learn`. A pair is evidence even
before it is a rule - promotion needs `thresholds.corroboration` independent
corrections pointing the same way.

| Before | After | Class | Ev |
|---|---|---|---|
```

`templates/kb/channels/_template.md`:

```markdown
# Channel: <name>

Generated on the second write to this channel. The first write produces only the
tone cell.

## Constraints

| Element | Limit |
|---|---|

## Rules

<!--
### C01 · Subject lines   `confirmed`  ev: e30

**Means:** One idea, front-loaded.
**Rules out:** curiosity gaps, all-caps, emoji openers
**Do:** name the thing that happened
**Don't:** tease
**Example:** *"Your Thursday campaign is scheduled."*
-->
```

`templates/kb/locales/_template.md`:

```markdown
# Locale: <code>

## Seeded mechanically

Typography, not brand opinion - no interview needed.

| Convention | Value |
|---|---|
| Quotation marks | |
| Date format | |
| Number separator | |
| Decimal separator | |
| Currency placement | |

## Elicited by interview

Brand decisions, not typography.

<!--
### X01 · Address register   `confirmed`  ev: e44

**Means:** Formal address everywhere except in-product UI.
**Rules out:** mixing registers inside one piece
**Do:** stay consistent within a piece
**Don't:** switch register mid-flow
**Example:** *"Vaše kampaň je naplánovaná."*
-->

## Translation-readiness base layer

Applies beneath every locale pack: active voice · no double negatives · no
idioms, slang, or clichés · disambiguate words with several senses · avoid
gerund-heavy constructions · one term per concept, never synonym-switching ·
spelled-out units · ISO currency codes.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/templates.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 7: Run the whole suite**

Run: `node --test test/`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add templates test/templates.test.mjs
git commit -m "feat(templates): knowledge-base skeletons with complete default tone vectors"
```

---

### Task 14: `voice-discovery` skill and `/voice-and-tone:init`

The pipeline of §5.1: `scan -> ingest -> measure -> draft KB -> gap analysis -> interview -> canonize`. This is where the plugin earns the claim in §1.1 - every rule it writes carries where it came from and how sure it is.

Two design decisions carry the weight here and both are in the skill body, not left to judgement:
- The interview is **preference-pair calibration on the project's own strings**, not adjective elicitation. People answer "how formal are you?" unreliably and answer "A or B?" well.
- The questionnaire is **computed from the gaps and ranked by leverage**. A question resolving five downstream rules is asked before one resolving one, and anything the corpus already answered is not asked at all.

**Files:**
- Create: `skills/voice-discovery/SKILL.md`
- Create: `skills/voice-discovery/references/interview-method.md`
- Create: `skills/voice-discovery/references/gap-analysis.md`
- Create: `skills/voice-discovery/references/locale-seed.md`
- Create: `commands/init.md`
- Test: `test/surface.test.mjs`

**Interfaces:**
- Consumes: all five scripts, `templates/kb/`.
- Produces: `test/surface.test.mjs` with helpers `readFrontmatter(absPath) -> {frontmatter: object, body: string}` and `surfaceFile(...parts) -> string`, both reused by Tasks 15-19.

- [ ] **Step 1: Write the failing test**

`test/surface.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYaml } from '../scripts/lib/yaml.mjs'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const surfaceFile = (...parts) => path.join(root, ...parts)

export function readFrontmatter (absPath) {
  const raw = readFileSync(absPath, 'utf8').replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  assert.ok(match, `${absPath} has no YAML frontmatter`)
  return { frontmatter: parseYaml(match[1]), body: match[2] }
}

test('voice-discovery skill declares itself and states precedence', () => {
  const { frontmatter, body } = readFrontmatter(surfaceFile('skills', 'voice-discovery', 'SKILL.md'))
  assert.equal(frontmatter.name, 'voice-discovery')
  assert.ok(frontmatter.description.length > 60, 'description must carry trigger phrases')
  assert.match(body, /Precedence/)
  assert.match(body, /CLAUDE\.md/)
  assert.match(body, /preference-pair/i)
  assert.match(body, /leverage/i)
})

test('voice-discovery references exist and are linked from the skill', () => {
  const { body } = readFrontmatter(surfaceFile('skills', 'voice-discovery', 'SKILL.md'))
  for (const ref of ['interview-method.md', 'gap-analysis.md', 'locale-seed.md']) {
    assert.ok(existsSync(surfaceFile('skills', 'voice-discovery', 'references', ref)), `${ref} missing`)
    assert.ok(body.includes(ref), `SKILL.md never points at ${ref}`)
  }
})

test('the init command names its skill and its argument shape', () => {
  const { frontmatter, body } = readFrontmatter(surfaceFile('commands', 'init.md'))
  assert.ok(frontmatter.description.length > 10)
  assert.match(body, /voice-discovery/)
  assert.match(body, /--add/)
})

test('every script a skill or command invokes actually exists', () => {
  const surfaces = [
    surfaceFile('skills', 'voice-discovery', 'SKILL.md'),
    surfaceFile('commands', 'init.md')
  ]
  for (const file of surfaces) {
    const body = readFileSync(file, 'utf8')
    for (const match of body.matchAll(/scripts\/([\w-]+\.mjs)/g)) {
      assert.ok(existsSync(surfaceFile('scripts', match[1])), `${file} names missing scripts/${match[1]}`)
    }
  }
})

test('generated knowledge bases are told to carry attribution', () => {
  const { body } = readFrontmatter(surfaceFile('skills', 'voice-discovery', 'SKILL.md'))
  assert.match(body, /Mailchimp/)
  assert.match(body, /verbatim/i, 'the skill must forbid carrying source prose into the KB')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/surface.test.mjs`
Expected: FAIL - `ENOENT ... skills/voice-discovery/SKILL.md`

- [ ] **Step 3: Write `skills/voice-discovery/SKILL.md`**

````markdown
---
name: voice-discovery
description: >
  WHEN: no voice-and-tone knowledge base exists yet, the user offers new source
  material for one, or asks to build, bootstrap, or extend a brand voice guide.
  WHAT: runs the discovery pipeline - scan the project for copy, measure a corpus
  fingerprint, draft a knowledge base where every rule carries evidence and a
  confidence level, compute a questionnaire from the gaps, interview by
  preference pairs on the project's own strings, then canonize.
  TRIGGERS: 'set up our voice', 'build a voice guide', 'we have a style guide to
  import', 'what is our tone of voice', 'no knowledge base found'.
---

# Voice discovery

Build a voice-and-tone knowledge base that can be **proved**, not just recited.
Every rule records where it came from and how sure we are, because that one axis
drives interview priority, review severity, and rule retirement.

> Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated
> with or endorsed by Mailchimp. Encode method and structure. **Never copy
> verbatim prose from that guide into a knowledge base** - every rule you write
> must be derived from this project's corpus, this user's answers, or this
> user's corrections.

## Precedence

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

## Before anything

Resolve `<KB>` = `.voice-and-tone/` at the project root unless the user names
another path. If `<KB>/config.yml` already exists, this is an **extension** run:
skip to step 6 and diff against what is there rather than overwriting it.

Probe the runtime once: run `node --version`. Record the result - it decides
whether metrics are `measured` or `estimated`, and an `estimated` fingerprint may
only ever produce `assumed` rules, never `derived`.

## 1. Scan

Copy the templates from `templates/kb/` into `<KB>/` first, so the scripts have a
config to read. Rename `gitignore` to `.gitignore`.

Then ask what shape the project is, or infer it:

| Project shape | Where the copy lives |
|---|---|
| App / codebase | i18n and locale files, error catalogs, README, docs |
| Marketing site | page content, markdown/MDX, meta descriptions, CMS exports |
| Docs repo | the docs themselves |
| No repo | a folder the user points at, pasted text, or URLs |

Adjust `scan.include` in `<KB>/config.yml` to match, then run:

```
node "<plugin>/scripts/scan.mjs" --root "<project>" --kb "<KB>"
```

Read the printed totals back to the user. If the file count is zero, the include
patterns are wrong - fix them before going further rather than fingerprinting
nothing.

**Out of scope for v1:** string literals inside source code. Too language-specific
and too error-prone; the false positives would poison the fingerprint. Point
`scan.include` at specific files instead.

## 2. Ingest

If the project already has a style guide, a tone-of-voice document, or a writing
handbook, read it and enter its rules at `confirmed` with an evidence entry of
type `source`. An existing explicit rule outranks anything inferred.

## 3. Measure

```
node "<plugin>/scripts/fingerprint.mjs" --root "<project>" --kb "<KB>" --set-baseline
```

Add `--source estimated` if Node was absent and you are estimating the metrics
yourself. Say so in one line to the user, and note how to upgrade.

Fingerprints are per locale and are never averaged across locales. English-only
metrics come back `null` for other languages - that is correct, not a gap.

## 4. Draft the knowledge base

Fill every slot. Nothing is left blank:

- Corpus-supported, with at least `derived_min_samples` distinct occurrences in
  two or more files -> `derived`
- Plugin default, unverified -> `assumed`
- Sources that genuinely disagree -> write **both** sides to
  `<KB>/evidence/conflicts.md` at `disputed`, and do not pick

Write each rule in the §4.3 shape, with an evidence ID, and add the matching
ledger entry with a `Produced:` line naming every rule it created. Bidirectionality
is required: it is what makes retraction possible later.

## 5. Gap analysis

Read `references/gap-analysis.md`. Turn unfilled and low-confidence slots into
candidate questions, then rank them by **leverage** - how many downstream rules
each answer resolves. Drop anything the corpus already answered.

## 6. Interview

Read `references/interview-method.md`. The primary mechanism is forced choice
between rewrites of the project's **own** strings, not adjective elicitation.

Constraints:
- At most 4 questions per `AskUserQuestion` call
- At most 3 rounds per session by default
- Always exitable with "good enough for now" - the rest stays `assumed` and queued

Each pick writes a `confirmed` rule and an `interview` ledger entry that stores
the pair as evidence.

## 7. Locales

For each locale beyond the primary, create `<KB>/locales/<code>.md` from
`templates/kb/locales/_template.md`. Read `references/locale-seed.md`: fill the
typography conventions mechanically - they are not brand opinions and need no
question - and interview only for the brand decisions.

## 8. Canonize

1. Run `node "<plugin>/scripts/validate.mjs" --kb "<KB>"`. Fix every error before continuing.
2. Run `node "<plugin>/scripts/compile-context.mjs" --root "<project>" --kb "<KB>"`.
3. Append a `CHANGELOG.md` entry and set `kb_version` (first build: `0.1.0`).
4. Report: how many rules at each confidence level, how many cells authored of 80,
   which locales, and what stayed `assumed` and queued.

**Never silently edit the knowledge base.** Show the proposed content, get
approval, then write.

## Cold start

If the user asks for copy and no knowledge base exists, do **not** block. Offer:

- the full pipeline above, or
- a 3-question quick start - brand name, primary reader, one preference pair on
  a string from their project - producing a provisional KB with everything
  `assumed`, ready to be upgraded later
````

- [ ] **Step 4: Write `skills/voice-discovery/references/interview-method.md`**

```markdown
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
```

- [ ] **Step 5: Write `skills/voice-discovery/references/gap-analysis.md`**

```markdown
# Gap analysis

## The rule

The questionnaire is computed, never canned. A slot that the corpus answers is
not asked about. A slot whose answer unlocks five other slots is asked first.

## Slot inventory

| Slot | File | Fills from corpus? | Leverage |
|---|---|---|---|
| Voice characteristics | `voice.md` | partly - rhythm, register | **high** - drives We Are/We Are Not, lexicon, every cell |
| Persona rules | `voice.md` | no | low unless a mascot exists |
| Self-reference | `voice.md` | yes - name casing is countable | medium |
| Audience segments | `audience.md` | rarely | **high** - state axis depends on it |
| Default dials | `tone.md` | yes - formality, detail, exclamation rate | **high** |
| State vectors | `tone.md` | no | medium - defaults ship usable |
| Context offsets | `tone.md` | partly - per-channel corpora differ | medium |
| Lexicon: avoid | `lexicon.md` | yes - frequency plus an off-brand check | medium |
| Lexicon: never say | `lexicon.md` | no | medium - small but absolute |
| Mechanics | `mechanics.md` | yes - most are countable | low individually |
| Locale register | `locales/*.md` | sometimes | **high** per locale |
| Locale typography | `locales/*.md` | seeded mechanically | none - never ask |

## Ranking

1. Compute leverage: how many other slots the answer would resolve or constrain.
2. Drop every slot already at `confirmed`.
3. Drop every slot at `derived` with no contradicting evidence.
4. Raise every slot appearing in `evidence/conflicts.md` - a `disputed` slot is
   asked with **both sides shown**, because the conflict is information.
5. Ask in leverage order, 4 per round.

## Turning a gap into a question

| Gap kind | Question shape |
|---|---|
| A dial has no evidence | preference pair on a real string that varies that dial |
| A lexicon candidate is frequent but unjudged | "you use X often - keep it, or swap it?" |
| Two sources disagree | show both, ask whether it is a channel split or drift |
| A slot has no corpus at all | open question, adjective-style, clearly labelled as such |
```

- [ ] **Step 6: Write `skills/voice-discovery/references/locale-seed.md`**

```markdown
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
```

- [ ] **Step 7: Write `commands/init.md`**

```markdown
---
description: Discover, measure, interview, and canonize a voice-and-tone knowledge base
argument-hint: "[--add <source>] [--quick]"
---

# /voice-and-tone:init

Runs the full discovery pipeline: scan the project for copy, measure a corpus
fingerprint, draft a knowledge base with evidence and confidence on every rule,
compute a questionnaire from the gaps, interview by preference pairs, canonize.

Creates `.voice-and-tone/` in the project root.

## Usage

```
/voice-and-tone:init                      full pipeline
/voice-and-tone:init --quick              3 questions, provisional KB, all assumed
/voice-and-tone:init --add <path-or-url>  ingest new material into an existing KB
```

`--add` re-runs ingest on the new material only, diffs it against the rules that
already exist, and records contradictions as `disputed` rather than overwriting
anything.

## Invokes

The `voice-discovery` skill.

$ARGUMENTS
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test test/surface.test.mjs`
Expected: PASS, 5 tests

- [ ] **Step 9: Commit**

```bash
git add skills/voice-discovery commands/init.md test/surface.test.mjs
git commit -m "feat(skills): voice-discovery pipeline and the init command"
```

---

### Task 15: `voice-and-tone` skill and the write commands

The core applier - §8.6's write-time flow. It is the most-used surface, so it loads `CONTEXT.md` (~600 tokens) and then pulls **only** the one cell, playbook, or locale pack it needs. That is progressive disclosure applied to brand knowledge: the alternative, loading the whole KB every time, costs thousands of tokens to answer "what should this button say?".

Two things are non-negotiable in this skill and are stated as rules, not guidance: the humor gates, and logging every draft to `.drafts/` so `:learn` has something to diff against later. A draft that is never logged is a correction that can never become a rule.

**Files:**
- Create: `skills/voice-and-tone/SKILL.md`
- Create: `skills/voice-and-tone/references/write-flow.md`
- Create: `skills/voice-and-tone/references/interpolation.md`
- Create: `skills/voice-and-tone/references/always-on-layers.md`
- Create: `commands/write.md`
- Create: `commands/rewrite.md`
- Create: `commands/localize.md`
- Test: `test/surface.test.mjs` - add cases

**Interfaces:**
- Consumes: `readFrontmatter`/`surfaceFile` (Task 14).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Add the failing test cases**

Append to `test/surface.test.mjs`:

```js
test('the applier skill states the flow, the gates, and draft logging', () => {
  const { frontmatter, body } = readFrontmatter(surfaceFile('skills', 'voice-and-tone', 'SKILL.md'))
  assert.equal(frontmatter.name, 'voice-and-tone')
  assert.match(body, /CONTEXT\.md/)
  assert.match(body, /\.drafts\//, 'every draft must be logged for :learn')
  assert.match(body, /humor/i)
  assert.match(body, /interpolated/i)
  assert.match(body, /Precedence/)
  for (const ref of ['write-flow.md', 'interpolation.md', 'always-on-layers.md']) {
    assert.ok(existsSync(surfaceFile('skills', 'voice-and-tone', 'references', ref)), `${ref} missing`)
    assert.ok(body.includes(ref), `SKILL.md never points at ${ref}`)
  }
})

test('the interpolation reference states both humor gates verbatim', () => {
  const text = readFileSync(surfaceFile('skills', 'voice-and-tone', 'references', 'interpolation.md'), 'utf8')
  assert.match(text, /authored/i)
  for (const state of ['frustrated', 'anxious-at-risk', 'disappointed-leaving']) {
    assert.ok(text.includes(state), `${state} must be named in the humor gate`)
  }
})

test('the always-on layers cover accessibility and translation readiness', () => {
  const text = readFileSync(surfaceFile('skills', 'voice-and-tone', 'references', 'always-on-layers.md'), 'utf8')
  assert.match(text, /directional language/i)
  assert.match(text, /alt text/i)
  assert.match(text, /double negatives/i)
  assert.match(text, /ISO currency/i)
})

test('write, rewrite, and localize commands all route to the applier', () => {
  for (const name of ['write.md', 'rewrite.md', 'localize.md']) {
    const { frontmatter, body } = readFrontmatter(surfaceFile('commands', name))
    assert.ok(frontmatter.description.length > 10, `${name} needs a description`)
    assert.match(body, /voice-and-tone/, `${name} must name the skill it invokes`)
  }
})

test('the write command lists the fixed context and state vocabularies', () => {
  const { body } = readFrontmatter(surfaceFile('commands', 'write.md'))
  for (const token of ['system-error', 'product-ui', 'frustrated', 'confused', 'delighted']) {
    assert.ok(body.includes(token), `write.md must list ${token}`)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/surface.test.mjs`
Expected: FAIL - `ENOENT ... skills/voice-and-tone/SKILL.md`

- [ ] **Step 3: Write `skills/voice-and-tone/SKILL.md`**

````markdown
---
name: voice-and-tone
description: >
  WHEN: writing, drafting, or rewriting any user-facing text - marketing pages,
  product UI, error messages, help docs, emails, social posts, notifications,
  release notes, support replies - or when asked to make existing copy sound like
  the brand. WHAT: loads the project's compiled voice card, resolves the tone cell
  for the reader's emotional state and the context, drafts inside those dials, and
  applies accessibility and translation-readiness as always-on layers.
  TRIGGERS: 'write this', 'draft a', 'make this sound like us', 'in our voice',
  'on-brand copy', 'rewrite this', 'localize this'.
---

# Voice & Tone - the applier

Voice is constant. Tone flexes with what the reader is feeling.

> Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated
> with or endorsed by Mailchimp.

## Precedence

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

When the knowledge base conflicts with a user instruction, **the instruction
wins**, and the conflict is offered to `/voice-and-tone:learn` as potential
evidence - it may be a one-off, or it may be the KB being wrong.

## No knowledge base?

Do not block. Say so in one line, offer `/voice-and-tone:init` or the 3-question
quick start, and draft using plugin defaults meanwhile. Label the output as
drafted without a knowledge base.

## The flow

Full detail in `references/write-flow.md`.

1. **Load** `<KB>/CONTEXT.md`. Nothing else, yet.
2. **Determine context and reader state.** Infer from what the user is asking for.
   Ask only if genuinely ambiguous - a wrong guess is cheap to correct, a
   needless question is not.
3. **Resolve the cell.** Load the authored cell from `<KB>/tone.md` if it exists.
   Otherwise interpolate - see `references/interpolation.md`.
4. **Load the channel playbook** `<KB>/channels/<name>.md` if one exists, and the
   **locale pack** `<KB>/locales/<code>.md` if the target is not the primary locale.
5. **Draft** inside the dials.
6. **Self-check** against the voice characteristics and the always-on layers in
   `references/always-on-layers.md`.
7. **Log the draft** to `<KB>/.drafts/<ISO-timestamp>-<slug>.md` with frontmatter
   recording cell, profile, locale, and kb_version. This is not optional - it is
   what `/voice-and-tone:learn` diffs against later.
8. **Report** one line: `profile <name> · cell: <context>/<state> · locale: <code>
   · <authored|interpolated>`.

## The humor gates - hard rules

1. Humor requires an **authored** cell. An interpolated cell never produces
   humor, whatever the arithmetic yields.
2. `frustrated`, `anxious-at-risk`, and `disappointed-leaving` force `humor 0`
   regardless of dial values, in authored cells too.

The failure mode of a computed cell must be "a bit flat", never "joked at someone
whose payment just failed".

## Promoting a cell

When you interpolate a cell for real work, offer to promote it: draft the full
cell in the §6.4 shape - reader is feeling, dials, do, don't, example - and if
the user approves, write it to `<KB>/tone.md` at `confirmed` with a `decision`
evidence entry. The matrix fills itself along the paths actually written.

## Channels

First write to a new channel produces the **tone cell only**. On the second write
to the same channel, offer to generate the full playbook from
`templates/kb/channels/_template.md`.

## Rewriting

Same flow, with the original as input. Additionally:
- Preserve every fact. Changing meaning is not a tone change.
- Show what changed and why, referencing rule IDs.
- Log both the original and your version to `.drafts/` so a later correction has
  a full chain.

## Localizing

`/voice-and-tone:localize` applies a locale pack to existing copy. Load the pack,
apply the mechanical conventions - quotes, dates, separators, currency - then the
brand decisions - register, anglicism policy, capitalization. **This is not
translation.** If the text needs translating, say so and ask; the plugin governs
how text is written, not what language it is in.

## After writing

If the user edits your draft, that edit is evidence. Offer
`/voice-and-tone:learn` - but never promote a rule from a single correction
unless it is an unambiguous lexicon swap.
````

- [ ] **Step 4: Write `skills/voice-and-tone/references/write-flow.md`**

````markdown
# Write-time flow

## Determining the context

Ten contexts, fixed. Pick the one the artifact actually lives in:

`marketing-page` · `product-ui` · `system-error` · `help-doc` · `email` ·
`social` · `legal-policy` · `notification` · `support-reply` · `release-notes`

Signals: where will this be rendered, who ships it, and what happens right before
the reader sees it.

## Determining the reader state

Eight states, fixed, and **emotional only**:

`delighted` · `curious` · `focused` · `uncertain` · `confused` · `frustrated` ·
`anxious-at-risk` · `disappointed-leaving`

Funnel stage is not a state. "Considering a purchase" is a context plus a state
(`marketing-page` + `curious`), not a third axis. Mixing the two produces cells
that cannot be composed.

Ask what just happened to the reader:

| What just happened | State |
|---|---|
| Something worked, and it mattered | `delighted` |
| They are browsing, nothing at stake | `curious` |
| Mid-task, wants no interruption | `focused` |
| Considering, missing one fact | `uncertain` |
| Tried, and the result was not what they expected | `confused` |
| Blocked, and suspecting it is our fault | `frustrated` |
| Money, data, or deadline at risk | `anxious-at-risk` |
| Decided to leave, or nearly | `disappointed-leaving` |

Ask the user only when two states would produce genuinely different copy and you
cannot tell which applies.

## Loading, in order

1. `<KB>/CONTEXT.md` - always
2. `<KB>/tone.md` - only the one cell, or the vector tables if interpolating
3. `<KB>/channels/<name>.md` - only if it exists
4. `<KB>/locales/<code>.md` - only if the target is not the primary locale
5. `<KB>/examples/approved.md` - only when you need a calibration sample
6. `<KB>/lexicon.md`, `<KB>/mechanics.md` - only when the compiled card's top
   entries are not enough for the piece at hand

Never load `evidence/ledger.md` while drafting. It is for explaining a rule, not
for applying one.

## Draft frontmatter

Every draft written to `<KB>/.drafts/`:

```markdown
---
generated: 2026-08-26T09:41:00.000Z
profile: default
context: system-error
state: frustrated
cell: T-system-error/frustrated
cell_source: authored
locale: en
kb_version: 0.3.1
---

That file didn't upload - it's over the 25 MB limit. Try a smaller one.
```

Filename: `<ISO-timestamp>-<slug>.md`, colons removed from the timestamp so it is
a legal filename on Windows.

## Reporting

One line, no ceremony:

```
profile default · cell: system-error/frustrated (authored) · locale: en
```

If the cell was interpolated, say so - it tells the user the guide has a gap
worth filling, and it is the moment they are most likely to fill it.
````

- [ ] **Step 5: Write `skills/voice-and-tone/references/interpolation.md`**

```markdown
# Interpolation

## Why

Ten contexts times eight states is eighty cells. Eighty cells is not authorable,
and a guide nobody finishes is a guide nobody uses. So the knowledge base stores
eight state vectors and ten context offsets, and computes the rest.

```
cell(context, state) = clamp(state_vector[state] + context_offset[context], 0, 4)
```

An authored cell overrides the computation completely - it is not blended.

## The dials

Six, integer 0-4, displayed as words rather than numbers when talking to the user:

| Dial | 0 | 4 |
|---|---|---|
| warmth | clinical | warm |
| humor | straight-faced | playful |
| directness | cushioned | blunt |
| detail | terse | thorough |
| urgency | relaxed | act now |
| formality | casual | formal |

`enthusiasm` is deliberately **not** a dial - it conflates warmth and urgency, and
a conflated dial cannot be set correctly.

## The gates

**Gate 1 - humor requires an authored cell.** A computed cell never carries
humor, whatever the arithmetic yields. If the sum says `humor 3`, the answer is
still `0` until a human has written that cell and approved it.

**Gate 2 - three states force humor 0**, in authored cells too:
`frustrated`, `anxious-at-risk`, `disappointed-leaving`.

Both gates are implemented in `scripts/lib/kb.mjs` as pure functions, so they
cannot be reasoned past. Do not reimplement them from memory - resolve the cell
through the code path or reproduce it exactly.

## Promotion

A computed cell is marked `interpolated`. On first real use, offer to promote it:

1. Draft the full cell - reader is feeling, dials, do, don't, example
2. Show it to the user
3. On approval, write it to `tone.md` at `confirmed` with a `decision` evidence
   entry naming the cell under `Produced:`

The matrix fills itself along the paths the project actually writes, which is the
only order in which eighty cells ever get authored.
```

- [ ] **Step 6: Write `skills/voice-and-tone/references/always-on-layers.md`**

```markdown
# Always-on layers

These apply to every draft and every review. They are not a checklist run at the
end - a checklist at the end catches the ones you remember to look for.

## Accessibility

- **No directional language.** "The button below" breaks in a screen reader and
  on a narrow viewport. Name the thing instead.
- **Links name their destination.** Never "click here", never a bare URL as link
  text. The link text should make sense read alone, out of order.
- **Plain language.** Prefer the shorter, commoner word where it means the same.
- **Acronyms defined on first use**, per page, not per site.
- **Proper heading nesting.** No level skipped, one h1.
- **Alt text** describes function where the image does something, content where it
  shows something, and is empty where the image is decorative.
- **Most important information first.** Front-load the sentence and the page.

## Translation-readiness

Source copy that translates cleanly is also source copy that reads cleanly.

- **Active voice.** Passive constructions lose the actor, and many languages
  cannot recover it.
- **No double negatives.**
- **No idioms, slang, or clichés.** They translate into nonsense or into nothing.
- **Disambiguate words with several senses** - `once`, `since`, `right`, `may`,
  `left`. Pick the unambiguous synonym.
- **Avoid gerund-heavy constructions.** "-ing" forms are grammatically ambiguous
  out of context.
- **One term per concept.** Never vary a term for the sake of variety; a synonym
  reads as a different thing.
- **Spell out units** rather than abbreviating them.
- **ISO currency codes**, not symbols, wherever the audience is not single-market.

## Severity

Accessibility violations and non-inclusive language are **always Blocker** in
review, regardless of the confidence of any rule involved. Everything else
inherits its severity from the confidence of the rule it breaks.
```

- [ ] **Step 7: Write the three commands**

`commands/write.md`:

```markdown
---
description: Draft on-brand copy for a context and a reader state
argument-hint: "<what to write> [--context <c>] [--state <s>] [--locale <code>]"
---

# /voice-and-tone:write

Drafts copy using the project's voice-and-tone knowledge base. Infers the context
and reader state from your request; override either explicitly when you know
better.

## Usage

```
/voice-and-tone:write an error for a file over the upload limit
/voice-and-tone:write release notes for the scheduling feature --context release-notes
/voice-and-tone:write a win-back email --state disappointed-leaving --locale cs
```

## Contexts

`marketing-page` · `product-ui` · `system-error` · `help-doc` · `email` ·
`social` · `legal-policy` · `notification` · `support-reply` · `release-notes`

## Reader states

`delighted` · `curious` · `focused` · `uncertain` · `confused` · `frustrated` ·
`anxious-at-risk` · `disappointed-leaving`

Emotional state only. Funnel stage is a context plus a state, not a third axis.

## Options

- `--context <c>` - one of the ten above
- `--state <s>` - one of the eight above
- `--locale <code>` - apply a locale pack
- `--profile <name>` - select a brand in a multi-brand project
- `--variants <n>` - produce n alternatives

## Invokes

The `voice-and-tone` skill. For buttons, errors, empty states, and notifications,
the `microcopy` skill takes over - it has tighter length rules.

$ARGUMENTS
```

`commands/rewrite.md`:

```markdown
---
description: Turn off-brand text into on-brand text, showing what changed and why
argument-hint: "<text or file path> [--context <c>] [--state <s>]"
---

# /voice-and-tone:rewrite

Takes existing copy and brings it into the brand's voice. Preserves every fact -
changing meaning is not a tone change.

## Usage

```
/voice-and-tone:rewrite "We regret to inform you that your payment has failed."
/voice-and-tone:rewrite content/pricing.md --context marketing-page
```

## Output

The rewritten text, followed by a short table of what changed and which rule ID
drove each change. Rules you could not apply because the knowledge base has no
opinion are listed too - those are gaps worth filling.

Both the original and the rewrite are logged to `.voice-and-tone/.drafts/` so a
later `/voice-and-tone:learn` has the full chain.

## Invokes

The `voice-and-tone` skill.

$ARGUMENTS
```

`commands/localize.md`:

```markdown
---
description: Apply a locale pack's conventions and register to existing copy
argument-hint: "<text or file path> --locale <code>"
---

# /voice-and-tone:localize

Applies `.voice-and-tone/locales/<code>.md` to copy: quotation marks, date and
number formats, currency placement, then the brand decisions - address register,
anglicism policy, capitalization, diacritic enforcement.

**This is not translation.** It governs how text is written in a language, not
which language it is in. If the text needs translating, the command says so and
asks rather than guessing.

## Usage

```
/voice-and-tone:localize content/pricing.cs.md --locale cs
/voice-and-tone:localize "Vaše kampaň je naplánovaná." --locale cs
```

If no pack exists for the locale, offers to create one: typography is seeded
mechanically, brand decisions are interviewed.

## Invokes

The `voice-and-tone` skill, locale path.

$ARGUMENTS
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test test/surface.test.mjs`
Expected: PASS, 10 tests

- [ ] **Step 9: Commit**

```bash
git add skills/voice-and-tone commands/write.md commands/rewrite.md commands/localize.md test/surface.test.mjs
git commit -m "feat(skills): voice-and-tone applier with write, rewrite, localize"
```

---

### Task 16: `voice-review` skill, `voice-critic` agent, `/voice-and-tone:review`

§8.4 makes review severity a function of the evidence model rather than of taste: a `confirmed` rule blocks, a `derived` rule warns, an `assumed` rule is a nit, and a `disputed` rule is **never enforced**. Two exceptions override that and are always Blocker - accessibility violations and non-inclusive language.

The `voice-critic` agent runs in **fresh context** and sees only the knowledge base and the draft. It never sees the drafting rationale, so it cannot be argued into approving the work it is reviewing - which is the entire reason it is a separate agent rather than a second pass in the same conversation.

The read-back test in §8.3 is the cheap falsifiable check: hand the critic the draft with its metadata stripped and ask it to name the context and reader state. A wrong guess means the tone missed. No human needed.

**Files:**
- Create: `skills/voice-review/SKILL.md`
- Create: `skills/voice-review/references/severity.md`
- Create: `skills/voice-review/references/finding-format.md`
- Create: `agents/voice-critic.md`
- Create: `commands/review.md`
- Test: `test/surface.test.mjs` - add cases

- [ ] **Step 1: Add the failing test cases**

Append to `test/surface.test.mjs`:

```js
test('the review skill maps every confidence level to a severity', () => {
  const { frontmatter, body } = readFrontmatter(surfaceFile('skills', 'voice-review', 'SKILL.md'))
  assert.equal(frontmatter.name, 'voice-review')
  const severity = readFileSync(surfaceFile('skills', 'voice-review', 'references', 'severity.md'), 'utf8')
  for (const level of ['confirmed', 'derived', 'assumed', 'disputed']) {
    assert.ok(severity.includes(level), `severity.md must map ${level}`)
  }
  assert.match(severity, /never enforced/i, 'disputed rules are never enforced')
  assert.match(severity, /accessibility/i)
  assert.match(severity, /inclusive/i)
  assert.match(body, /file:line/)
})

test('the critic agent runs fresh and is told what it may not see', () => {
  const { frontmatter, body } = readFrontmatter(surfaceFile('agents', 'voice-critic.md'))
  assert.equal(frontmatter.name, 'voice-critic')
  assert.match(body, /fresh context/i)
  assert.match(body, /read-back/i)
  assert.match(body, /rationale/i, 'the critic must be told it never sees the drafting rationale')
})

test('the review command routes to the review skill and offers the critic', () => {
  const { body } = readFrontmatter(surfaceFile('commands', 'review.md'))
  assert.match(body, /voice-review/)
  assert.match(body, /voice-critic/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/surface.test.mjs`
Expected: FAIL - `ENOENT ... skills/voice-review/SKILL.md`

- [ ] **Step 3: Write `skills/voice-review/SKILL.md`**

````markdown
---
name: voice-review
description: >
  WHEN: asked whether copy is on brand, to check or critique text against the
  brand voice, or to review a page, a string file, or a pull request's copy.
  WHAT: reads the knowledge base, finds violations, and reports them with
  file:line anchors and a severity derived from the confidence of the rule broken.
  Accessibility and non-inclusive language are always blockers.
  TRIGGERS: 'is this on brand', 'check this copy', 'review the copy', 'does this
  sound like us', 'voice review'.
---

# Voice review

Critique against the knowledge base, with severities that come from evidence
rather than from taste.

> Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated
> with or endorsed by Mailchimp.

## Precedence

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

## Flow

1. Load `<KB>/CONTEXT.md`.
2. Determine the context and reader state of the text under review. If it came
   from `.drafts/`, read them from the frontmatter instead of guessing.
3. Load the resolved cell, the channel playbook, and the locale pack if relevant.
4. Load `<KB>/lexicon.md` and `<KB>/mechanics.md` in full - review needs the whole
   list, not the compiled top-8.
5. Find violations. For each, record the rule ID, the confidence, and a `file:line`
   anchor. Format in `references/finding-format.md`.
6. Apply the always-on layers from
   `skills/voice-and-tone/references/always-on-layers.md`.
7. Assign severity per `references/severity.md`.
8. Report. Blockers first, then warnings, then nits.

## Severity, in one line

`confirmed` -> **Blocker** · `derived` -> Warning · `assumed` -> Nit ·
`disputed` -> **not reported as a violation at all**

Always **Blocker** regardless of any rule's confidence: accessibility violations,
and non-inclusive language.

A `disputed` rule may be *mentioned* as an open question, never as a finding. The
conflict is information, and review is not where it gets settled - `:audit` is.

## The rule the review must not break

Do not invent rules. If the copy reads badly but no rule in the knowledge base
covers it, say so explicitly and offer it as a **candidate rule** for
`/voice-and-tone:learn`. An unfounded finding is worse than a missed one - it
teaches the user to distrust the whole report.

## Scale

- A single string or paragraph: review inline, in this conversation.
- A file, a directory, or a diff: review inline, grouped by file.
- Anything the user wants an independent judgement on, or where you drafted the
  copy yourself: dispatch the `voice-critic` agent. It runs in fresh context and
  cannot be argued into approving its own work - because it never did any.

## After the report

Offer the two follow-ups that matter:
- `/voice-and-tone:rewrite` for the blockers
- `/voice-and-tone:learn` for anything the user disagrees with - a rejected
  finding is evidence about the rule, not just about the copy
````

- [ ] **Step 4: Write `skills/voice-review/references/severity.md`**

```markdown
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
```

- [ ] **Step 5: Write `skills/voice-review/references/finding-format.md`**

````markdown
# Finding format

Markdown, anchored, one finding per violation. The anchor is what makes a report
actionable rather than merely correct.

```markdown
### Blockers

**`content/pricing.md:14`** - L07 `confirmed`
> "Leverage our platform to simplify your workflow."

Two lexicon violations in one sentence: `leverage` -> `use`, `simply` has no
replacement and should be cut. Evidence: e22, e31.

**Suggested:** "Use our platform to tidy up your workflow."

### Warnings

**`content/pricing.md:22`** - M04 `derived`
> "Ready to get started?? "

Double question mark, and the sentence is the third question in four lines. The
corpus question rate is 0.08; this section is at 0.75.

### Nits

**`content/pricing.md:31`** - V2 `assumed`
> "We are thrilled to announce..."

Reads as announcement language rather than plainspoken. `V2 · Genuine` is only
`assumed` - if this is right, `/voice-and-tone:learn` can confirm the rule instead.
```

## Rules for a finding

- **Quote the offending text.** A finding without the text is a claim.
- **Name the rule ID and its confidence.** Both. The ID lets the user look it up;
  the confidence tells them how hard to take it.
- **Cite the evidence IDs** for blockers. If a user is going to be blocked, they
  are entitled to see why the rule exists.
- **Suggest a fix** for blockers and warnings. Nits may be reported without one.
- **One finding per violation.** Do not bundle three lexicon hits into one entry;
  each one is separately acceptable or rejectable.
- **No finding without a rule.** If nothing in the knowledge base covers it, it
  goes under "Candidate rules", not under a severity heading.
````

- [ ] **Step 6: Write `agents/voice-critic.md`**

````markdown
---
name: voice-critic
description: >
  Independent voice-and-tone critic. Runs in fresh context with access to the
  knowledge base and the draft only - never the reasoning that produced the
  draft. Use when copy needs a judgement that cannot be argued with, especially
  when the same session wrote the copy. Returns findings with severities, plus a
  read-back verdict on whether the tone hit its target.
tools: Read, Glob, Grep
---

# Voice critic

You are reviewing copy against a knowledge base you did not help build, produced
by a process you did not see.

## What you have

- `<KB>/CONTEXT.md`, `tone.md`, `lexicon.md`, `mechanics.md`, `voice.md`,
  and the relevant `channels/` and `locales/` files
- The draft

## What you do not have, by design

The drafting rationale. You cannot see why the writer made a choice, and you must
not ask. **This is the point.** A critic who can hear the defence can be talked
into accepting it, and a critic who can be talked around is not a check on
anything.

If the draft's intent is unclear from the draft itself, that is a finding, not a
question.

## Task 1 - the read-back test

**Do this first, before reading any metadata about the draft.**

Read the draft alone. Then answer:

- Which of the ten contexts does this read as?
- Which of the eight reader states does it read as written for?
- How confident are you, high or low?

Then compare against the draft's actual cell.

- **Match** - the tone landed.
- **Mismatch** - the tone missed, and this is the single most important finding in
  your report. Say which cell it reads as, and which dial is furthest off.
- **Low confidence either way** - the copy is tonally vague. Report it as a
  warning even when your guess happened to be right.

This test is cheap and falsifiable, and it catches the failure mode a rule-by-rule
check cannot: copy that breaks no rule and still sounds like someone else.

## Task 2 - findings

Follow `skills/voice-review/references/finding-format.md` and
`skills/voice-review/references/severity.md`:

`confirmed` -> Blocker · `derived` -> Warning · `assumed` -> Nit ·
`disputed` -> never enforced

Accessibility violations and non-inclusive language are Blockers regardless.

## Task 3 - the honest summary

End with one line the reader can act on:

```
read-back: expected system-error/frustrated, read as marketing-page/curious - MISS
findings: 2 blockers, 1 warning, 3 nits
verdict: rewrite
```

Verdict is `ship`, `fix-then-ship`, or `rewrite`. Do not soften it. You are not
in the conversation that has to receive it, which is exactly why you can be
accurate.

## What you must not do

- Do not invent rules. If nothing in the knowledge base covers a problem, list it
  under "Candidate rules" and say plainly that it is not currently a rule.
- Do not rewrite the copy. Suggest fixes for blockers; the rewrite is someone
  else's job.
- Do not soften a verdict because the draft is close. Close is a `rewrite` when
  the read-back missed.
````

- [ ] **Step 7: Write `commands/review.md`**

```markdown
---
description: Review copy against the knowledge base, with severities and file:line anchors
argument-hint: "<text, file, directory, or --diff> [--critic]"
---

# /voice-and-tone:review

Reviews copy against `.voice-and-tone/`. Severity comes from the confidence of the
rule broken: `confirmed` blocks, `derived` warns, `assumed` is a nit, `disputed`
is never enforced. Accessibility violations and non-inclusive language always
block.

## Usage

```
/voice-and-tone:review content/pricing.md
/voice-and-tone:review locales/en/common.json
/voice-and-tone:review --diff              review only the copy changed on this branch
/voice-and-tone:review content/ --critic   dispatch the independent critic
```

## `--critic`

Dispatches the `voice-critic` agent in fresh context. It sees the knowledge base
and the draft, never the reasoning that produced the draft, and it runs the
read-back test: given the copy with its metadata stripped, can it name the context
and reader state? A wrong guess means the tone missed.

Use it whenever this session wrote the copy. Self-review by the author is worth
less than it feels like.

## Invokes

The `voice-review` skill, and the `voice-critic` agent when `--critic` is passed.

$ARGUMENTS
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test test/surface.test.mjs`
Expected: PASS, 13 tests

- [ ] **Step 9: Commit**

```bash
git add skills/voice-review agents/voice-critic.md commands/review.md test/surface.test.mjs
git commit -m "feat(skills): voice-review, the fresh-context critic, and the read-back test"
```

---

### Task 17: `microcopy` skill

Buttons, errors, empty states, and notifications are where a voice guide either works or is quietly ignored. The full applier is the wrong tool at 3 words: its flow costs more than the artifact, and its length instincts are calibrated for paragraphs.

This skill exists because the shortest copy has the tightest constraints and the highest read count, and because `system-error` + `frustrated` is the cell where the humor gates matter most.

**Files:**
- Create: `skills/microcopy/SKILL.md`
- Create: `skills/microcopy/references/patterns.md`
- Test: `test/surface.test.mjs` - add cases

- [ ] **Step 1: Add the failing test cases**

Append to `test/surface.test.mjs`:

```js
test('microcopy declares itself and defers to the applier for long form', () => {
  const { frontmatter, body } = readFrontmatter(surfaceFile('skills', 'microcopy', 'SKILL.md'))
  assert.equal(frontmatter.name, 'microcopy')
  assert.match(frontmatter.description, /button|error|empty state|notification/i)
  assert.match(body, /patterns\.md/)
  assert.match(body, /voice-and-tone/, 'must hand off long-form work')
  assert.match(body, /humor/i)
})

test('microcopy patterns carry concrete length budgets', () => {
  const text = readFileSync(surfaceFile('skills', 'microcopy', 'references', 'patterns.md'), 'utf8')
  for (const element of ['Button', 'Error', 'Empty state', 'Notification', 'Tooltip']) {
    assert.ok(text.includes(element), `patterns.md must cover ${element}`)
  }
  assert.match(text, /\d+\s*(characters|chars|words)/i, 'budgets must be numeric, not vibes')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/surface.test.mjs`
Expected: FAIL - `ENOENT ... skills/microcopy/SKILL.md`

- [ ] **Step 3: Write `skills/microcopy/SKILL.md`**

````markdown
---
name: microcopy
description: >
  WHEN: writing or fixing the shortest copy in a product - button and link
  labels, error messages, empty states, notifications, toasts, tooltips,
  placeholders, confirmation dialogs, form validation, loading states.
  WHAT: applies the knowledge base at micro length, where the constraints are
  tightest and the read count is highest, using the same tone cells as long-form
  copy but with fixed length budgets and element-specific shapes.
  TRIGGERS: 'button label', 'error message', 'empty state', 'toast', 'tooltip',
  'what should this say', 'validation message', 'confirmation dialog'.
---

# Microcopy

Same voice, same cells, much less room.

> Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated
> with or endorsed by Mailchimp.

## Precedence

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

## Flow

1. Load `<KB>/CONTEXT.md`.
2. Identify the element and take its budget from `references/patterns.md`.
3. Resolve the cell. Almost all microcopy is `product-ui`, `system-error`, or
   `notification`; the state is what varies.
4. Draft to the budget. If it does not fit, the problem is usually that the
   sentence is doing two jobs - split it, or cut one.
5. Apply the always-on layers from
   `skills/voice-and-tone/references/always-on-layers.md`. They matter more here,
   not less: a button labelled "Click here" fails at 11 characters.
6. Log to `<KB>/.drafts/` like any other draft.
7. Offer 2-3 alternatives. Microcopy is cheap to vary and expensive to get wrong.

## The rules that bite at this length

- **Humor gates apply, hard.** `system-error` + `frustrated` is the single most
  common microcopy cell and one of the three states that force `humor 0`. An
  error message is never the place for a joke, and an interpolated cell may not
  produce humor at all.
- **Say what happened, then what to do next.** In that order. An error that
  explains without instructing has done half its job.
- **Own it if it is ours.** Do not use passive voice to hide an actor the reader
  can work out anyway.
- **Never apologize twice.** One "sorry" at most, and only where the fault is real.
- **Buttons are verbs.** The label says what happens when it is pressed, not what
  the screen is called.
- **Never "Click here".** Never a bare URL. Never "the button below".

## When to hand off

Anything over roughly 50 words, or anything with more than one paragraph, belongs
to the `voice-and-tone` skill. Say so and hand over rather than stretching this
skill past its shape.
````

- [ ] **Step 4: Write `skills/microcopy/references/patterns.md`**

```markdown
# Microcopy patterns

Budgets are defaults. A channel playbook in `<KB>/channels/` overrides them, and
a platform constraint - a push notification cap, a column width - overrides both.

| Element | Budget | Shape | Usual cell |
|---|---|---|---|
| Button / primary action | 1-3 words, 20 characters | verb first, says what happens | `product-ui` + `focused` |
| Button / secondary | 1-3 words, 20 characters | never "Cancel" when a real verb exists | `product-ui` + `focused` |
| Link label | 2-6 words | names its destination, reads alone | any |
| Error message | 1-2 sentences, 140 characters | what happened, then what to do | `system-error` + `frustrated` |
| Form validation | 1 sentence, 80 characters | what is wrong with *this field* | `product-ui` + `confused` |
| Empty state | 1-3 sentences plus an action | why it is empty, what fills it | `product-ui` + `uncertain` |
| Notification / toast | 1 sentence, 90 characters | the outcome, not the process | `notification` + varies |
| Push notification | title 40 characters, body 120 | front-load; the tail gets truncated | `notification` + varies |
| Tooltip | 1 sentence, 80 characters | the thing the label could not say | `product-ui` + `uncertain` |
| Placeholder | 1-4 words | an example, never a duplicate of the label | `product-ui` + `focused` |
| Confirmation dialog | title plus 1-2 sentences plus 2 buttons | name the consequence in the title | `product-ui` + `anxious-at-risk` |
| Loading state | 2-5 words | what is happening, not "Please wait" | `product-ui` + `focused` |
| Success message | 1 sentence, 90 characters | confirm the outcome, offer the next step | `product-ui` + `delighted` |

## Error messages

The shape that works, in order:

1. **What happened** - concretely, in the reader's terms
2. **Why**, if the reason is actionable. Skip it if it is not.
3. **What to do next** - one action, not a list

> "That file didn't upload - it's over the 25 MB limit. Try a smaller one."

What that avoids: no error code as the first thing, no "oops", no "something went
wrong" without saying what, no blame, no joke, no second apology.

## Confirmation dialogs

The title carries the consequence, not the question. "Delete 4 campaigns?" beats
"Are you sure?", because a reader who skims only the title still knows what is
about to happen. Buttons name their actions - "Delete" and "Keep", never "OK" and
"Cancel".

## Empty states

An empty state is the only screen guaranteed to be seen by every new user. Say why
it is empty, say what will fill it, and give exactly one way to start. `anxious`
is the wrong read here - a new user is `uncertain`, and reassurance without an
action is just noise.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/surface.test.mjs`
Expected: PASS, 15 tests

- [ ] **Step 6: Commit**

```bash
git add skills/microcopy test/surface.test.mjs
git commit -m "feat(skills): microcopy with element budgets and hard humor gates"
```

---

### Task 18: `voice-maintenance` skill and `/voice-and-tone:learn`, `:audit`, `:sync`

§7 is where this plugin differs from a static style guide, and §7.1's corroboration threshold is the load-bearing rule: **a single edit is evidence, never a rule.** Promotion needs `thresholds.corroboration` independent corrections pointing the same way, and independent means *from different drafts* - one editing pass reflects one mood. Without that, the knowledge base overfits to a single session and starts confidently enforcing an accidental preference.

The one exception is an unambiguous lexicon swap, which fires immediately: if someone changes `leverage` to `use`, there is nothing to corroborate.

`:audit`'s overridden-rules report asks the sharpest question in the design: a rule broken every time and kept anyway is not a rule. Enforce it or retire it.

**Files:**
- Create: `skills/voice-maintenance/SKILL.md`
- Create: `skills/voice-maintenance/references/correction-classes.md`
- Create: `skills/voice-maintenance/references/audit-report.md`
- Create: `commands/learn.md`
- Create: `commands/audit.md`
- Create: `commands/sync.md`
- Test: `test/surface.test.mjs` - add cases

- [ ] **Step 1: Add the failing test cases**

Append to `test/surface.test.mjs`:

```js
test('maintenance states the corroboration rule and its one exception', () => {
  const { frontmatter, body } = readFrontmatter(surfaceFile('skills', 'voice-maintenance', 'SKILL.md'))
  assert.equal(frontmatter.name, 'voice-maintenance')
  assert.match(body, /corroboration/i)
  assert.match(body, /different drafts/i, 'independence must be defined, not assumed')
  assert.match(body, /lexicon/i)
  assert.match(body, /proposed diff/i, 'the KB is never silently edited')
})

test('the five correction classes are all named, including the ignored one', () => {
  const text = readFileSync(
    surfaceFile('skills', 'voice-maintenance', 'references', 'correction-classes.md'), 'utf8')
  for (const cls of ['word swap', 'tone shift', 'structural', 'formatting', 'factual']) {
    assert.ok(text.toLowerCase().includes(cls), `correction-classes.md must cover "${cls}"`)
  }
  assert.match(text, /ignored/i, 'factual edits are ignored, not learned from')
})

test('the audit report covers coverage, drift, rule health, and inventory', () => {
  const text = readFileSync(
    surfaceFile('skills', 'voice-maintenance', 'references', 'audit-report.md'), 'utf8')
  for (const section of ['Coverage', 'Drift', 'Rule health', 'Inventory']) {
    assert.ok(text.includes(section), `audit-report.md must have a ${section} section`)
  }
  for (const health of ['dead', 'overridden', 'stale', 'disputed']) {
    assert.ok(text.includes(health), `rule health must classify "${health}"`)
  }
})

test('learn, audit, and sync commands route to the maintenance skill', () => {
  for (const name of ['learn.md', 'audit.md', 'sync.md']) {
    const { frontmatter, body } = readFrontmatter(surfaceFile('commands', name))
    assert.ok(frontmatter.description.length > 10, `${name} needs a description`)
    assert.match(body, /voice-maintenance/, `${name} must name its skill`)
  }
  assert.match(readFileSync(surfaceFile('commands', 'sync.md'), 'utf8'), /compile-context\.mjs|validate\.mjs/)
})

test('every command file the plugin ships is one of the eight in the spec', () => {
  const expected = ['audit.md', 'init.md', 'learn.md', 'localize.md', 'review.md', 'rewrite.md', 'sync.md', 'write.md']
  const actual = readdirSync(surfaceFile('commands')).filter((f) => f.endsWith('.md')).sort()
  assert.deepEqual(actual, expected)
})
```

Add `readdirSync` to the `node:fs` import at the top of `test/surface.test.mjs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/surface.test.mjs`
Expected: FAIL - `ENOENT ... skills/voice-maintenance/SKILL.md`

- [ ] **Step 3: Write `skills/voice-maintenance/SKILL.md`**

````markdown
---
name: voice-maintenance
description: >
  WHEN: the user edited copy the plugin produced, wants the knowledge base
  updated from corrections, asks how healthy or current the voice guide is, wants
  to retire or change a rule, or needs the compiled card rebuilt.
  WHAT: captures corrections as evidence and promotes them to rules only on
  corroboration, audits coverage, drift, and rule health, and recompiles and
  validates the knowledge base.
  TRIGGERS: 'learn from my edits', 'update the voice guide', 'audit our voice',
  'is this rule still right', 'rebuild CONTEXT.md', 'sync the knowledge base'.
---

# Voice maintenance

A guide that cannot change is a guide that gets ignored. A guide that changes on
one person's Tuesday is worse.

> Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated
> with or endorsed by Mailchimp.

## Precedence

1. Direct user instruction in the current conversation
2. Project `CLAUDE.md` / `AGENTS.md`
3. The knowledge base
4. Plugin defaults

## The rule that governs all three commands

**Every write is a proposed diff.** Show the change, show the evidence behind it,
get approval on each item separately, then write. Never silently edit the
knowledge base - not even to fix something obviously wrong. Especially not then.

---

## `:learn` - corrections become rules

1. Find the draft in `<KB>/.drafts/`. Read its frontmatter for cell, profile,
   locale, and kb_version.
2. Get mechanical ground truth:

   ```
   node "<plugin>/scripts/diff.mjs" --draft "<draft>" --final "<final>" --kb "<KB>"
   ```

   The script reports word-level changes, length shift, and single-word swaps. It
   does **not** classify them - that is your job, and the division is deliberate.

3. Classify every edit per `references/correction-classes.md`.
4. Write each edit to `<KB>/evidence/ledger.md` as a `correction` entry and to
   `<KB>/examples/pairs.md`. **This happens whether or not a rule follows.**
5. Apply the corroboration threshold.
6. Propose only what cleared it, each with its diffs shown as evidence.

### Corroboration

A single edit is recorded as evidence and does **not** create a rule. Promotion
requires `thresholds.corroboration` (default 2) **independent** corrections
pointing the same way.

**Independent means from different drafts** - not different lines within one
draft. One editing pass reflects one mood, and three changes in it are one
opinion, not three.

**The one exception:** an unambiguous lexicon swap fires immediately. If a user
changes `leverage` to `use`, there is nothing to corroborate.

Without this threshold the knowledge base overfits to a single editing session
and begins confidently enforcing an accidental preference - which is worse than
having no rule, because now it blocks.

### Retraction

When the user says "ignore the 2024 newsletters, we've changed", do not guess.
Find the evidence entries for that source, read their `Produced:` lines, and
reopen exactly those rules. That is what bidirectional evidence is for.

---

## `:audit` - health and drift

Follow `references/audit-report.md`. Four sections, in this order:

1. **Coverage** - authored cells versus interpolated, per context
2. **Drift** - current fingerprint against the baseline captured at init
3. **Rule health** - dead, overridden, stale, disputed
4. **Inventory** - scored findings across the scanned corpus

Refresh the numbers first:

```
node "<plugin>/scripts/scan.mjs" --root "<project>" --kb "<KB>"
node "<plugin>/scripts/fingerprint.mjs" --root "<project>" --kb "<KB>"
node "<plugin>/scripts/validate.mjs" --kb "<KB>"
```

Do **not** pass `--set-baseline` here. The baseline is the point of comparison; a
refreshed baseline shows zero drift by construction and tells you nothing.

End by asking the two questions the report exists to raise:
- For each overridden rule: **enforce it, or retire it?** A rule broken every time
  and kept anyway is not a rule.
- For each `disputed` entry: **channel split, or drift?**

---

## `:sync` - recompile and validate

1. `node "<plugin>/scripts/validate.mjs" --kb "<KB>"` - fix every error first
2. `node "<plugin>/scripts/compile-context.mjs" --root "<project>" --kb "<KB>"`
3. Bump `kb_version` in `<KB>/config.yml`:
   - **major** - voice characteristics changed
   - **minor** - cells or rules added
   - **patch** - examples, evidence, wording
4. Append to `<KB>/CHANGELOG.md`: version, date, what changed, which evidence
   entries drove it
5. Prune `<KB>/.drafts/` entries older than 90 days

`CONTEXT.md` is generated. If a user has hand-edited it, their changes are lost on
the next sync - that is the design, not a bug. It is why the file carries a
generated-file banner. If they want the change kept, it belongs in the source file
the card compiles from.
````

- [ ] **Step 4: Write `skills/voice-maintenance/references/correction-classes.md`**

```markdown
# Correction classes

`scripts/diff.mjs` gives mechanical ground truth: which words changed, how the
length shifted, which single-word swaps happened. Classification is yours. The
script never classifies and you never re-derive the mechanics by eye.

| Class | What it looks like | Becomes |
|---|---|---|
| **word swap** | one word consistently replaced by another | a proposed lexicon row |
| **tone shift** | register, warmth, or directness moved across the piece | a dial adjustment on that cell |
| **structural** | sentences split, merged, reordered; a list became prose | a mechanics or rhythm rule |
| **formatting** | casing, punctuation, emphasis, heading style | a mechanics rule |
| **factual** | a number, name, date, or claim corrected | **ignored** |

## Why factual edits are ignored

They are not style signals. A user fixing "25 MB" to "20 MB" is telling you the
limit changed, not that the voice is wrong. Learning from them would fill the
lexicon with product facts and start enforcing them as style, which then blocks
correct copy the next time the fact changes.

Record the edit as evidence so the chain is complete. Propose nothing.

## Telling tone shift from structural

They overlap, and it matters because they produce different rules.

- If the **dials** would have to change to produce the new text, it is a tone
  shift. Ask: which dial, which direction, how far?
- If the dials would produce the new text fine and only the **arrangement**
  changed, it is structural.

When genuinely both, record both, and let corroboration decide which survives.

## Threshold, restated

Two independent corrections, from **different drafts**, pointing the same way.
Lexicon swaps are exempt and fire immediately.

Three changes inside one editing pass are one data point, not three. This is the
single rule that keeps the knowledge base from overfitting to one afternoon.

## Proposal format

```markdown
**Proposed: L14** `leverage` -> `use`   (lexicon swap, immediate)

Evidence:
  e51  2026-08-14  draft 2026-08-14-error-upload.md   "leverage" -> "use"

Accept / reject / edit?
```

```markdown
**Proposed: dial change on T-email/curious** - detail 2 -> 3

Evidence:
  e52  2026-08-14  draft 2026-08-14-welcome.md    +34 words, 2 sentences split
  e58  2026-08-21  draft 2026-08-21-winback.md    +41 words, 1 example added

Two independent corrections, different drafts, same direction.

Accept / reject / edit?
```

One proposal per item. Never batch them behind a single yes.
```

- [ ] **Step 5: Write `skills/voice-maintenance/references/audit-report.md`**

````markdown
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

  disputed     D1   contraction use            marketing 0%, app UI 61%
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

## Closing

Two questions, always, and nothing else:

1. Which overridden rules do we enforce, and which do we retire?
2. Which disputed entries are channel splits, and which are drift?

Both write `decision` evidence entries. Both are the point of running the audit.
````

- [ ] **Step 6: Write the three commands**

`commands/learn.md`:

```markdown
---
description: Turn your edits to a plugin draft into evidence, and into rules once corroborated
argument-hint: "[<final-file>] [--draft <draft-file>]"
---

# /voice-and-tone:learn

Diffs a draft the plugin produced against your edited version, classifies each
edit, and proposes rules for the ones that clear the corroboration threshold.

**A single edit never becomes a rule.** It is recorded as evidence. Promotion
needs `thresholds.corroboration` (default 2) independent corrections from
*different drafts* pointing the same way - one editing pass is one opinion, not
three. Unambiguous lexicon swaps are the one exception and fire immediately.

## Usage

```
/voice-and-tone:learn                              use the most recent draft and its file
/voice-and-tone:learn content/pricing.md           diff against the draft that produced it
/voice-and-tone:learn --draft .voice-and-tone/.drafts/2026-08-26-error-upload.md
```

Every proposal is shown with its diffs as evidence and approved individually.
Nothing is written to the knowledge base without a yes.

## Invokes

The `voice-maintenance` skill.

$ARGUMENTS
```

`commands/audit.md`:

```markdown
---
description: Report coverage, drift, rule health, and a scored inventory of findings
argument-hint: "[--locale <code>] [--section coverage|drift|health|inventory]"
---

# /voice-and-tone:audit

Four sections: how much of the tone matrix is authored, how far the corpus has
drifted from its baseline, which rules are dead, overridden, stale, or disputed,
and a scored inventory of findings across the project.

Ends with the two questions it exists to raise: which overridden rules to enforce
or retire, and which disputed entries are channel splits rather than drift.

## Usage

```
/voice-and-tone:audit
/voice-and-tone:audit --locale cs
/voice-and-tone:audit --section drift
```

Refreshes the manifest and fingerprint first. Does **not** move the drift
baseline - a refreshed baseline shows zero drift by construction.

## Invokes

The `voice-maintenance` skill.

$ARGUMENTS
```

`commands/sync.md`:

```markdown
---
description: Validate the knowledge base and recompile CONTEXT.md
argument-hint: "[--bump major|minor|patch]"
---

# /voice-and-tone:sync

Runs `scripts/validate.mjs` for integrity - broken evidence refs, orphaned rules,
duplicate IDs, unknown contexts or states, dial values out of range, violated
humor gates - then regenerates `CONTEXT.md` with `scripts/compile-context.mjs`,
bumps `kb_version`, and appends to `CHANGELOG.md`.

Also prunes `.voice-and-tone/.drafts/` entries older than 90 days.

`CONTEXT.md` is a generated file. Hand edits to it are lost here by design; the
change belongs in the source file the card compiles from.

## Usage

```
/voice-and-tone:sync
/voice-and-tone:sync --bump minor
```

Exits without recompiling if validation finds errors - a card compiled from a
broken knowledge base is worse than a stale one.

## Invokes

The `voice-maintenance` skill.

$ARGUMENTS
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test test/surface.test.mjs`
Expected: PASS, 20 tests

- [ ] **Step 8: Commit**

```bash
git add skills/voice-maintenance commands/learn.md commands/audit.md commands/sync.md test/surface.test.mjs
git commit -m "feat(skills): voice-maintenance with corroboration, audit, and sync"
```

---

### Task 19: README, ASCII hardening, and the cross-platform conformance sweep

§9's rules are hard rules, and hard rules that are only written down get broken. This task turns each one into a test that fails the build.

The ASCII rule needs more than a review pass: `validate.mjs` interpolates rule IDs, context names, and confidence strings into its messages, and any of those can carry diacritics from a user's knowledge base. A Windows console will mangle them. The fix is one helper, applied at every stdout boundary.

**Files:**
- Create: `README.md` (replaces the GitLab template already at the repo root)
- Modify: `scripts/lib/cli.mjs` - add `toAscii`, `writeOut`
- Modify: `scripts/scan.mjs`, `scripts/fingerprint.mjs`, `scripts/compile-context.mjs`, `scripts/validate.mjs`, `scripts/diff.mjs` - route every `process.stdout.write` through `writeOut`
- Test: `test/conformance.test.mjs`

**Interfaces:**
- Produces: `cli.mjs` gains `toAscii(text) -> string` (replaces every code point above 0x7E with `?`, and normalizes common typographic characters first so the output stays readable) and `writeOut(text) -> void`.

- [ ] **Step 1: Write the failing test**

`test/conformance.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = ['scan.mjs', 'fingerprint.mjs', 'compile-context.mjs', 'validate.mjs', 'diff.mjs']

function walkPlugin (dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.tmp'].includes(entry.name)) continue
    const abs = path.join(dir, entry.name)
    out.push(abs)
    if (entry.isDirectory()) walkPlugin(abs, out)
  }
  return out
}

test('no symlinks anywhere in the plugin tree', () => {
  for (const abs of walkPlugin()) {
    assert.ok(!lstatSync(abs).isSymbolicLink(), `${path.relative(root, abs)} is a symlink`)
  }
})

test('plugin logic never shells out to unix text tools', () => {
  const forbidden = /\b(?:grep|sed|awk|find|cat)\s+-|\bexecSync\(|\bchild_process\b/
  for (const abs of walkPlugin(path.join(root, 'scripts'))) {
    if (!abs.endsWith('.mjs')) continue
    const source = readFileSync(abs, 'utf8')
    assert.ok(!forbidden.test(source), `${path.relative(root, abs)} shells out or uses a unix text tool`)
  }
})

test('scripts build paths with path.join, never by concatenating a separator', () => {
  const concatenated = /['"`]\s*\+\s*['"`]\/|\/['"`]\s*\+\s*(?!\/)/
  for (const abs of walkPlugin(path.join(root, 'scripts'))) {
    if (!abs.endsWith('.mjs')) continue
    for (const [index, line] of readFileSync(abs, 'utf8').split('\n').entries()) {
      if (line.includes('http') || line.trim().startsWith('*') || line.trim().startsWith('//')) continue
      assert.ok(!concatenated.test(line),
        `${path.relative(root, abs)}:${index + 1} builds a path with a literal separator`)
    }
  }
})

test('no file in the plugin tree carries CRLF endings', () => {
  for (const abs of walkPlugin()) {
    if (lstatSync(abs).isDirectory()) continue
    if (!/\.(mjs|md|json|yml|yaml)$/.test(abs)) continue
    assert.ok(!readFileSync(abs, 'utf8').includes('\r'), `${path.relative(root, abs)} has CRLF endings`)
  }
})

test('no file in the plugin tree carries a literal byte-order mark', () => {
  // A literal BOM is invisible in a diff and survives review by not being seen.
  // Three implementers in this build typed one by accident where the source
  // called for a \uFEFF escape. This guard does not rely on anyone noticing.
  for (const abs of walkPlugin()) {
    if (lstatSync(abs).isDirectory()) continue
    if (!/\.(mjs|md|json|yml|yaml)$/.test(abs)) continue
    const bytes = readFileSync(abs)
    for (let i = 0; i < bytes.length - 2; i++) {
      const isBom = bytes[i] === 0xEF && bytes[i + 1] === 0xBB && bytes[i + 2] === 0xBF
      assert.ok(!isBom, `${path.relative(root, abs)} contains a literal BOM at byte ${i}`)
    }
  }
})

test('every script prints ASCII-only help', () => {
  for (const name of SCRIPTS) {
    const out = execFileSync(process.execPath, [path.join(root, 'scripts', name), '--help'], { encoding: 'utf8' })
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[^\x00-\x7F]/.test(out), `${name} --help printed a non-ASCII character`)
    assert.match(out, /usage: node/)
  }
})

test('scripts stay ASCII on stdout even when the corpus is not', () => {
  const dir = makeTmpProject({
    'content/a.md': '# Naplánováno\n\nVaše kampaň je naplánovaná. Skvělá práce!\n',
    '.voice-and-tone/config.yml': [
      'version: 1',
      'profiles:',
      '  default:',
      '    name: "Značka"',
      '    primary_locale: cs',
      '    locales: [cs]',
      'scan:',
      '  include:',
      '    - "content/**/*.md"',
      '  exclude:',
      '    - "node_modules/**"'
    ].join('\n')
  })
  try {
    for (const name of ['scan.mjs', 'fingerprint.mjs']) {
      const out = execFileSync(
        process.execPath,
        [path.join(root, 'scripts', name), '--root', dir, '--now', '2026-08-26T00:00:00.000Z'],
        { encoding: 'utf8' }
      )
      // eslint-disable-next-line no-control-regex
      assert.ok(!/[^\x00-\x7F]/.test(out), `${name} leaked a non-ASCII character to stdout`)
    }
  } finally {
    cleanup(dir)
  }
})

test('scripts write UTF-8 files even though they print ASCII', () => {
  const dir = makeTmpProject({
    'content/a.md': 'Vaše kampaň je naplánovaná.\n',
    '.voice-and-tone/config.yml': 'version: 1\nscan:\n  include:\n    - "content/**/*.md"\n  exclude:\n    - "node_modules/**"\n'
  })
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'scan.mjs'), '--root', dir], { encoding: 'utf8' })
    const manifest = readFileSync(path.join(dir, '.voice-and-tone', 'evidence', 'manifest.json'), 'utf8')
    assert.ok(manifest.includes('content/a.md'))
    assert.ok(!manifest.includes('\r'))
  } finally {
    cleanup(dir)
  }
})

test('README carries attribution, install, and all eight commands', () => {
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.match(readme, /not affiliated with or endorsed by Mailchimp/i)
  assert.match(readme, /CC BY-NC 4\.0/)
  assert.match(readme, /MIT/)
  for (const command of ['init', 'write', 'review', 'rewrite', 'learn', 'audit', 'sync', 'localize']) {
    assert.ok(readme.includes(`/voice-and-tone:${command}`), `README omits :${command}`)
  }
  assert.ok(!readme.includes('makeareadme.com'), 'the GitLab template README must be replaced')
})

test('the repo root holds no stray plugin entry points', () => {
  assert.ok(existsSync(path.join(root, '.claude-plugin', 'plugin.json')))
  assert.ok(!existsSync(path.join(root, 'plugin.json')), 'the manifest belongs in .claude-plugin/')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/conformance.test.mjs`
Expected: FAIL - the README assertions fail against the GitLab template, and the ASCII-on-stdout test fails because `scan.mjs` prints the locale list unfiltered.

- [ ] **Step 3: Add `toAscii` and `writeOut` to cli.mjs**

Append to `scripts/lib/cli.mjs`:

```js
const TYPOGRAPHIC = [
  [/[‘’‚‛]/g, "'"],
  [/[“”„‟]/g, '"'],
  [/[–—]/g, '-'],
  [/…/g, '...'],
  [/·/g, '*'],
  [/ /g, ' ']
]

/**
 * Spec section 9: scripts write UTF-8 files but print only ASCII. Windows
 * console codepages mangle anything else, and a knowledge base can legitimately
 * contain diacritics that end up interpolated into a status line.
 */
export function toAscii (text) {
  let out = String(text)
  for (const [pattern, replacement] of TYPOGRAPHIC) out = out.replace(pattern, replacement)
  // eslint-disable-next-line no-control-regex
  return out.replace(/[^\x00-\x7F]/g, '?')
}

export function writeOut (text) {
  process.stdout.write(toAscii(text))
}
```

Change `die` and `printHelp` to route through it:

```js
export function die (message) {
  process.stderr.write(toAscii(`error: ${message}\n`))
  process.exit(1)
}

export function printHelp (name, lines) {
  writeOut([`usage: node ${name} [options]`, '', ...lines, ''].join('\n'))
}
```

- [ ] **Step 4: Route every script's stdout through `writeOut`**

In each of `scripts/scan.mjs`, `scripts/fingerprint.mjs`, `scripts/compile-context.mjs`, `scripts/validate.mjs`, and `scripts/diff.mjs`:

1. Add `writeOut` to the import from `./lib/cli.mjs`.
2. Replace every `process.stdout.write(` with `writeOut(`.

Leave `writeTextFile` calls untouched - files stay UTF-8. This is the whole point
of the split: the artifact keeps its diacritics, the terminal does not have to.

- [ ] **Step 5: Write `README.md`**

````markdown
# Voice & Tone

A Claude Code plugin that builds, maintains, and applies a brand's voice and tone
on any project - an application codebase, a marketing site, a documentation repo,
or a bare folder of text with no code in it at all.

Built on Mailchimp's Voice and Tone framework: **voice is constant, tone flexes
with the reader's emotional state.**

## The idea

A voice guide the plugin can prove, not just recite.

Every rule in the knowledge base carries **where it came from** (evidence) and
**how sure we are** (confidence). That one decision drives three systems that are
otherwise separate:

- **Interview priority** - unconfirmed rules become the next questions
- **Review severity** - `confirmed` rules block, `assumed` rules are nits,
  `disputed` rules are never enforced at all
- **Maintenance** - rules with stale or contradicted evidence surface for retirement

## Install

```
/plugin install voice-and-tone
```

Requires **Node 18 or newer** for the measurement scripts. Without Node the plugin
still works: the model estimates the same metrics and marks them `estimated`, and
an estimated fingerprint may only ever produce `assumed` rules, never `derived`.
Missing runtime degrades precision, never function.

Zero npm dependencies. Nothing to install beyond the plugin itself.

## Start here

```
/voice-and-tone:init
```

Scans your project for copy, measures a corpus fingerprint, drafts a knowledge
base, works out what it still does not know, and asks you - mostly by showing you
rewrites of your **own** strings and asking which one sounds like you.

Creates `.voice-and-tone/` in your project root.

## Commands

| Command | What it does |
|---|---|
| `/voice-and-tone:init` | discover, measure, interview, canonize |
| `/voice-and-tone:write` | draft for a context and a reader state |
| `/voice-and-tone:review` | critique with severities and `file:line` anchors |
| `/voice-and-tone:rewrite` | off-brand text to on-brand text |
| `/voice-and-tone:learn` | turn your corrections into rules, once corroborated |
| `/voice-and-tone:audit` | coverage, drift, rule health, scored inventory |
| `/voice-and-tone:sync` | validate and recompile the card |
| `/voice-and-tone:localize` | apply a locale pack |

Skills trigger on their own too - ask for a button label or say "make this sound
like us" and the right one loads without a command.

## The knowledge base

Lives in your project, in markdown, under version control:

```
.voice-and-tone/
  config.yml         profiles, locales, scan paths, thresholds
  CONTEXT.md         GENERATED digest, ~600 tokens - the always-loaded card
  voice.md           characteristics (constant) + persona rules
  tone.md            authored cells + state vectors + context offsets
  audience.md        who we write for, and the states they arrive in
  lexicon.md         love / use carefully / avoid / never say
  mechanics.md       grammar, casing, punctuation, web elements
  channels/          per-channel playbooks
  locales/           per-language packs
  examples/          approved, rejected, and before/after pairs
  evidence/          the numbered ledger, the fingerprint, the conflicts
  CHANGELOG.md
```

`CONTEXT.md` is generated and never hand-edited. A hand-maintained digest drifts
from its source - the plugin is designed around that specific failure.

## The tone model

Ten contexts by eight reader states is eighty cells, which nobody authors. So the
knowledge base stores **eight state vectors** and **ten context offsets** and
computes the rest:

```
cell(context, state) = clamp(state_vector[state] + context_offset[context], 0, 4)
```

Authored cells override completely, and computed cells get promoted to authored
on first real use - the matrix fills itself along the paths you actually write.

Six dials, 0-4: `warmth` `humor` `directness` `detail` `urgency` `formality`.

**Two humor gates, both hard:**

1. Humor requires an authored cell. A computed cell never produces humor.
2. `frustrated`, `anxious-at-risk`, and `disappointed-leaving` force `humor 0` -
   in authored cells too.

The failure mode of a computed cell must be "a bit flat", never "joked at someone
whose payment just failed".

## Always on

Applied to every draft and every review, not as a checklist at the end:

- **Accessibility** - no directional language, links that name their destination,
  plain words, acronyms defined, headings nested, alt text, most important thing first
- **Translation-readiness** - active voice, no double negatives, no idioms, one
  term per concept, spelled-out units, ISO currency codes

Accessibility violations and non-inclusive language are **always** blockers,
whatever confidence any rule carries.

## Development

```
node --test test/
```

Zero dependencies. Node 18+. The scripts run identically on macOS, Windows, and
Linux - `test/conformance.test.mjs` enforces that rather than trusting it.

## Attribution and license

Built on [Mailchimp's Content Style Guide](https://styleguide.mailchimp.com/),
published under
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). **Not affiliated
with or endorsed by Mailchimp.** This plugin encodes method and structure and
carries no substantial verbatim prose from that guide - see
[ATTRIBUTION.md](ATTRIBUTION.md).

Dual licensed: **MIT** for `scripts/` and `test/`, **CC BY-NC 4.0** for the method
documentation. See [LICENSE](LICENSE).
````

- [ ] **Step 6: Run the conformance suite**

Run: `node --test test/conformance.test.mjs`
Expected: PASS, 10 tests

- [ ] **Step 7: Run everything**

Run: `node --test test/`
Expected: PASS, every test from Tasks 1-19

- [ ] **Step 8: End-to-end smoke test on a real fixture**

```bash
mkdir -p .tmp/demo/content
printf '# Schedule a campaign\n\nYour campaign is scheduled. Nice work!\n' > .tmp/demo/content/a.md
node "$(pwd)/scripts/scan.mjs" --root "$(pwd)/.tmp/demo"
node "$(pwd)/scripts/fingerprint.mjs" --root "$(pwd)/.tmp/demo" --set-baseline
node "$(pwd)/scripts/validate.mjs" --kb "$(pwd)/.tmp/demo/.voice-and-tone"
node "$(pwd)/scripts/compile-context.mjs" --root "$(pwd)/.tmp/demo"
```

Expected: `scan` reports 1 file, `fingerprint` reports one locale with a baseline,
`validate` exits 0 with no errors, `compile-context` writes a card under the token
budget. Then remove `.tmp`.

- [ ] **Step 9: Commit**

```bash
git add README.md scripts test/conformance.test.mjs
git commit -m "feat: README, ASCII-safe stdout, and cross-platform conformance tests"
```

---

## Self-Review

Run this checklist against the spec after the plan is written and before executing it.

**1. Spec coverage.** Every numbered section maps to a task:

| Spec § | Covered by |
|---|---|
| §2 Attribution and licensing | Task 1 (LICENSE, ATTRIBUTION.md), Task 11 (`CONTEXT.md` header), Task 19 (README) |
| §3 Rule, evidence, confidence | Task 9 (vocabularies, parsers), Task 10 (validation) |
| §4.2 KB layout | Task 13 (templates) |
| §4.3-4.6 Rule and evidence formats | Task 9 |
| §4.7 `config.yml` | Task 2 (YAML), Task 6 (defaults, load/save), Task 13 (template) |
| §4.8 `CONTEXT.md` | Task 11 |
| §4.9 Freshness | Task 18 (`audit-report.md` stale rules) |
| §5.2 Scan | Task 5 (extraction), Task 6 (`scan.mjs`) |
| §5.3 Fingerprint, universal/English split | Task 7, Task 8 |
| §5.4 Runtime degradation | Task 8 (`--source estimated`), Task 14 (probe step) |
| §5.5 Gap analysis | Task 14 (`gap-analysis.md`) |
| §5.6 Preference-pair interview | Task 14 (`interview-method.md`) |
| §5.7 Cold start | Task 14, Task 15 |
| §6.1 Voice, generated We Are/We Are Not | Task 13 (`voice.md` template), Task 14 |
| §6.2 Two axes | Task 9 (`STATES`, `CONTEXTS`) |
| §6.3 Six dials | Task 9 (`DIALS`), Task 15 (`interpolation.md`) |
| §6.4 Authored cell format | Task 9 (`parseToneCells`), Task 13 |
| §6.5 Interpolation | Task 9 (`interpolate`, `resolveCell`) |
| §6.6 Humor gates | Task 9 (pure functions), Task 10 (`E_HUMOR_GATE`), Task 15, Task 17 |
| §6.7 Always-on layers | Task 15 (`always-on-layers.md`) |
| §7.1 `:learn` and corroboration | Task 12 (`diff.mjs`), Task 18 |
| §7.2 `:init --add` | Task 14 (extension run), `commands/init.md` |
| §7.3 `:audit` | Task 18 (`audit-report.md`), Task 8 (baseline) |
| §7.4 `:sync` | Task 10, Task 11, Task 18 |
| §7.5 Versioning | Task 18 (`:sync` bump), Task 13 (`CHANGELOG.md`) |
| §8.1 Eight commands | Tasks 14-18, asserted in Task 18's command-inventory test |
| §8.2 Five skills | Tasks 14-18 |
| §8.3 Agent and read-back test | Task 16 |
| §8.4 Review output | Task 16 (`severity.md`, `finding-format.md`) |
| §8.5 Five scripts | Tasks 6, 8, 10, 11, 12 |
| §8.6 Write-time flow | Task 15 (`write-flow.md`) |
| §9 Cross-platform | Global Constraints, enforced in Task 19 |
| §10 Locale packs | Task 14 (`locale-seed.md`), Task 13 (`locales/_template.md`) |
| §11 Precedence | stated in all five skills, asserted in Tasks 14-18 |
| §12 Repository layout | File Structure section |
| §13 Open questions | resolved in Global Constraints |
| §14 Deferred | not built - correct |

Gaps found and closed while writing: `lib/corpus.mjs` (three consumers of one walk), `extractHeadings` (the heading-case metric had no source), `toAscii` (§9's ASCII rule needed enforcement at the boundary, not review), and `evidence/manifest.json` (`scan.mjs` had nowhere to write).

**2. Placeholder scan.** No task contains "TBD", "implement later", "add error handling", or "similar to Task N". Every code step carries the actual code. Every markdown deliverable carries its actual content.

**3. Type consistency.** Names used across task boundaries, checked once each: `gatherCorpus`/`byLocale` (Task 6 -> 8, 11) · `extractStrings`/`extractHeadings`/`formatFor` (Task 5 -> 6) · `computeFingerprint` (Task 7 -> 8) · `loadKb`/`parseToneCells`/`parseVectors`/`parseDials`/`parseTableRules`/`resolveCell` (Task 9 -> 10, 11, 13) · `validateKb` (Task 10 -> 13) · `compileContext`/`estimateTokens` (Task 11 -> 13) · `countHits`/`rankRules` (Task 11 internal) · `mechanicalDiff` (Task 12 -> 18 docs) · `makeTmpProject`/`cleanup` (Task 1 -> everywhere) · `readFrontmatter`/`surfaceFile` (Task 14 -> 15-18) · `toAscii`/`writeOut` (Task 19 -> all scripts). The state tokens `anxious-at-risk` and `disappointed-leaving` are spelled identically in `kb.mjs`, the tone template, every skill, and every test.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-26-voice-and-tone-plugin.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - a fresh subagent per task, review between tasks, fast iteration. Well suited here: Tasks 2-12 are self-contained TDD units with tight interfaces, and Tasks 14-18 are independent markdown deliverables.
2. **Inline Execution** - execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.
