# Speaker Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one knowledge base hold a shared house layer plus one overlay profile per speaker, with locked house rules, without changing a single byte of output for a knowledge base that has no speakers.

**Architecture:** One new resolution function, `resolveKb(kbRoot, profileName)` in `scripts/lib/kb.mjs`, loads the house and one overlay through the existing `loadKb()` and merges them by the rules in spec §4. Every consumer that today calls `loadKb()` switches to `resolveKb()`; a resolved knowledge base with no overlay is the house with three extra fields on every rule (`origin`, `locked`, `overrides`), so consumers do not branch. Per-speaker artifacts (fingerprint, manifest, card) live under `profiles/<slug>/`, chosen by one helper, `artifactRoot(kbRoot, profileName)`. The state object grows `kb.role`, `locks`, `speakers`, and `speaker`; both renderers read those and draw nothing new unless a speaker exists.

**Tech Stack:** Node 18.13+, ESM, zero runtime dependencies, `node:test` + `node:assert/strict`. No new dependency may be added.

**Spec:** `.superpowers/specs/2026-09-10-speaker-profiles-design.md`

## Global Constraints

Copied from the spec and from `test/conformance.test.mjs`. **Every task's requirements implicitly include this section.**

- **Zero npm dependencies.** Nothing may be installed.
- **Node floor is 18.13.** Never use `import.meta.dirname`. Use `path.dirname(fileURLToPath(import.meta.url))`.
- **Stdout is ASCII-only.** Everything printed goes through `writeOut()` in `scripts/lib/cli.mjs`. The rendering palette is `+ - | = # . : < > ^ [ ] ( ) / !` plus `A-Za-z0-9` and space.
- **No shelling out** from `scripts/`, `skills/`, `commands/`, `agents/`. No `grep`, `sed`, `awk`, `find`, `cat` invocations in any `.mjs` or `.md` there.
- **Paths use `path.join()`.** Never concatenate a literal `/`.
- **Files are LF, no BOM, no control bytes, no symlinks.**
- **Exit codes:** `0` success, `1` bad flag or throw, `2` validation failure. `status.mjs` never exits `2`.
- **`--now` is honoured** everywhere a timestamp or age is computed.
- **Every script uses `parseCliArgs`** and prints help via `printHelp`. `test/conformance.test.mjs` help-checks every `scripts/*.mjs` automatically.
- **Byte identity.** A knowledge base with no `profiles/` directory and no `locks` key must produce byte-identical `CONTEXT.md`, `validate.mjs` output, the ASCII status screen, and the status HTML page. `--json` may gain keys but every pre-existing key keeps its value. Task 12 pins this with a golden test.
- **Renderers do no I/O.** `lib/render.mjs` and `lib/html.mjs` never import `node:fs`; `test/render.test.mjs` and `test/html.test.mjs` assert it.
- **Every knowledge-base write in a skill is a proposed diff**, approved item by item.

## Spec deviations, decided here

1. **The house header keeps the word `default`.** Spec §9.2 shows `Acme | house | ...`. Printing `house` would change today's screen for every existing knowledge base and break byte identity. The house view prints `default` as it does now; only the speaker view changes, to `maya (speaker)`.
2. **`--json` is not byte-identical.** Spec §8.3 asks for it; the state object must carry the new blocks for the renderers to read them. Every existing key keeps its value; the golden test asserts that instead.
3. **The `speakers` menu row, the `speakers` panel, the `locks` settings line, the hero chip, and the HTML Speakers section appear only when the house declares at least one speaker or at least one lock.** Same reason: nothing on today's screen may move.
4. **`voice.md` prose sections (persona rules, self-reference rules) are not merged by any script.** Spec §4.2 describes a per-section merge; that merge is performed by the skill reading both files, because no script consumes those sections. The speaker card points at both files.
5. **`W_ID_RANGE_COLLISION_RISK` uses a decade rule.** Spec §4.4 says "inside a range the house is still growing into". Concretely: a speaker addition with prefix `L`, `M`, `C`, `A`, or `X` whose number is below the next multiple of ten above the house's highest number for that prefix. House max `L22` means speaker additions start at `L30`.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/lib/config.mjs` | **Modify.** `locks: []` default; `activeProfile()` merges a speaker onto `default`; `speakerProfiles()`, `isSpeaker()`, `overlayRoot()`, `artifactRoot()`. |
| `scripts/lib/kb.mjs` | **Modify.** `defaultDialsOf()`, `interpolate()` third term, `resolveKb()`, `mergeRules()`. `loadKb()` unchanged. |
| `scripts/lib/register.mjs` | **Modify.** `resolveEntry()` attributes locale from the entry's own profile and stamps `profile` on each file; `entriesForProfile()`. |
| `scripts/lib/corpus.mjs` | **Modify.** `gatherAll()` scopes the register and the index to the profile. |
| `scripts/sources.mjs` | **Modify.** `--add --profile` persists `profile` on the register entry; ingest stamps `profile` on index entries; `--check`/`--ingest` scope to a speaker profile. |
| `scripts/scan.mjs`, `scripts/fingerprint.mjs` | **Modify.** Default output path comes from `artifactRoot()`. |
| `scripts/validate.mjs` | **Modify.** Seven new checks; `main` validates the house and every speaker. |
| `scripts/compile-context.mjs` | **Modify.** Compiles from resolved rules; speaker header, guardrails, override marks, overlay output path. |
| `scripts/lib/state.mjs` | **Modify.** `kb.role`, `kb.speaker`, `locks`, `speakers`, `rules.byOrigin`; per-profile artifact paths; draft and source filtering. |
| `scripts/lib/gaps.mjs` | **Modify.** `G17`..`G21`. |
| `scripts/lib/render.mjs` | **Modify.** `speakers` panel; header, rules, settings, missing, menu read the new blocks. |
| `scripts/lib/html.mjs` | **Modify.** Speakers section, hero chip and eyebrow, origin split, locks line. |
| `scripts/status.mjs` | **Modify.** `--artifact` path per speaker. |
| `templates/kb/profiles/_template/**` | **Create.** Overlay skeleton. |
| `templates/kb/config.yml`, `templates/kb/gitignore` | **Modify.** Commented `locks: []`; ignore `profiles/*/sources/`. |
| `test/fixtures/house-with-speakers/**` | **Create.** A house with two speakers, one overriding a locked rule on purpose. |
| `commands/speaker.md` | **Create.** The one new command. |
| `commands/{write,rewrite,localize,review,status,sync,audit,connect}.md` | **Modify.** `--profile`. |
| `skills/voice-discovery/references/speaker-discovery.md` | **Create.** |
| `skills/voice-discovery/SKILL.md`, `skills/voice-maintenance/SKILL.md`, `skills/voice-and-tone/SKILL.md`, `skills/voice-and-tone/references/{write-flow,interpolation}.md`, `skills/voice-review/SKILL.md`, `skills/voice-review/references/{severity,finding-format}.md`, `skills/voice-observability/SKILL.md`, `skills/voice-observability/references/{panels,gap-catalogue}.md`, `agents/voice-critic.md` | **Modify.** |
| `README.md`, `CHANGELOG.md` | **Modify.** |
| `test/{config,kb,register,corpus,sources,validate,compile-context,state,gaps,render,html,status,surface,templates,conformance}.test.mjs` | **Modify.** |

---

## Task 1: Config helpers for speakers, locks, and artifact roots

**Files:**
- Modify: `scripts/lib/config.mjs`
- Test: `test/config.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DEFAULT_CONFIG.locks` (`[]`); `activeProfile(config, name)` returns `{ ...default, ...speaker }` for a speaker; `speakerProfiles(config) -> [{ slug, name, primary_locale, locales }]` sorted by slug; `isSpeaker(config, name) -> boolean`; `overlayRoot(kbRoot, slug) -> string`; `artifactRoot(kbRoot, profileName, config) -> string` (the directory whose `evidence/` and `CONTEXT.md` belong to that profile).

- [ ] **Step 1: Write the failing tests**

Append to `test/config.test.mjs`:

```js
import { speakerProfiles, isSpeaker, overlayRoot, artifactRoot } from '../scripts/lib/config.mjs'

test('locks default to an empty list', () => {
  const dir = makeTmpProject({})
  try {
    assert.deepEqual(loadConfig(path.join(dir, '.voice-and-tone')).locks, [])
  } finally {
    cleanup(dir)
  }
})

test('a speaker profile inherits locales from default unless it sets its own', () => {
  const config = loadConfig(makeTmpProject({
    '.voice-and-tone/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: en',
      '    locales: [en, de]',
      '  maya:',
      '    name: "Maya Lind"',
      '  bramble:',
      '    name: "Acme Bramble"',
      '    locales: [en]',
      ''
    ].join('\n')
  }) + '/.voice-and-tone')
  assert.deepEqual(activeProfile(config, 'maya').locales, ['en', 'de'])
  assert.equal(activeProfile(config, 'maya').primary_locale, 'en')
  assert.equal(activeProfile(config, 'maya').name, 'Maya Lind')
  assert.deepEqual(activeProfile(config, 'bramble').locales, ['en'])
  assert.equal(activeProfile(config, 'nobody').name, 'Unnamed', 'an unknown profile still falls back to the plugin default')
})

test('speakerProfiles lists every non-default profile, sorted, and isSpeaker agrees', () => {
  const config = {
    profiles: {
      default: { name: 'Acme', primary_locale: 'en', locales: ['en'] },
      maya: { name: 'Maya Lind' },
      helpdesk: { name: 'Acme Support' }
    }
  }
  assert.deepEqual(speakerProfiles(config).map((p) => p.slug), ['helpdesk', 'maya'])
  assert.equal(speakerProfiles(config)[1].name, 'Maya Lind')
  assert.deepEqual(speakerProfiles(config)[1].locales, ['en'], 'inherited from default')
  assert.equal(isSpeaker(config, 'maya'), true)
  assert.equal(isSpeaker(config, 'default'), false)
  assert.equal(isSpeaker(config, 'ghost'), false, 'undeclared is not a speaker')
  assert.deepEqual(speakerProfiles({}), [])
})

test('overlayRoot and artifactRoot point at the overlay for a speaker and at the house otherwise', () => {
  const config = { profiles: { default: { name: 'Acme' }, maya: { name: 'Maya Lind' } } }
  assert.equal(overlayRoot('/kb', 'maya'), path.join('/kb', 'profiles', 'maya'))
  assert.equal(artifactRoot('/kb', 'maya', config), path.join('/kb', 'profiles', 'maya'))
  assert.equal(artifactRoot('/kb', 'default', config), '/kb')
  assert.equal(artifactRoot('/kb', 'ghost', config), '/kb', 'an undeclared profile writes nothing into profiles/')
})
```

Note: `test/config.test.mjs` already imports `loadConfig`, `activeProfile`, `makeTmpProject`, `cleanup`, `path`, and `test`/`assert`. Add only the new names to its existing import line; do not duplicate imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/pavolhudran/Sites/ai-voice-and-tone && node --test test/config.test.mjs`
Expected: FAIL, `speakerProfiles` is not exported.

- [ ] **Step 3: Implement**

In `scripts/lib/config.mjs`, add `locks: []` to `DEFAULT_CONFIG` after `sources: []`:

```js
  sources: [],
  // House rule IDs no speaker overlay may override. Empty by design: a
  // knowledge base with no speakers has nothing to lock, and G21 in
  // lib/gaps.mjs is what tells a house WITH speakers that its guardrails
  // are all still overridable.
  locks: [],
```

Replace `activeProfile` and add the helpers at the end of the file:

```js
/**
 * A speaker profile inherits `primary_locale` and `locales` from `default`
 * unless it sets its own. Spec §3: "primary_locale and locales inherited
 * from default unless set". The house profile is returned as declared; an
 * unknown name still falls back to the plugin default, as before.
 */
export function activeProfile (config, profileName = 'default') {
  const profiles = config?.profiles ?? {}
  if (profileName === 'default') return profiles.default ?? DEFAULT_CONFIG.profiles.default
  const speaker = profiles[profileName]
  if (!speaker) return DEFAULT_CONFIG.profiles.default
  const house = profiles.default ?? DEFAULT_CONFIG.profiles.default
  return { ...house, ...speaker }
}

/** Every profile other than `default`, each merged onto the house, sorted by slug. */
export function speakerProfiles (config) {
  const profiles = config?.profiles ?? {}
  return Object.keys(profiles)
    .filter((slug) => slug !== 'default')
    .sort()
    .map((slug) => ({ slug, ...activeProfile(config, slug) }))
}

export function isSpeaker (config, profileName) {
  return profileName !== 'default' && Boolean(config?.profiles?.[profileName])
}

/** Where a speaker's own rule files live. Two levels, fixed: never nested. */
export function overlayRoot (kbRoot, slug) {
  return path.join(kbRoot, 'profiles', slug)
}

/**
 * The directory whose evidence/fingerprint.json, evidence/manifest.json and
 * CONTEXT.md belong to this profile: the overlay for a declared speaker, the
 * house for `default` and for any name config does not declare. Scripts
 * that wrote to <kb>/evidence/ before keep doing so unless a real speaker is
 * named, which is what keeps every existing invocation byte-identical.
 */
export function artifactRoot (kbRoot, profileName, config) {
  return isSpeaker(config, profileName) ? overlayRoot(kbRoot, profileName) : kbRoot
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/config.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite, then commit**

Run: `npm test`
Expected: all green; `activeProfile` for `default` is unchanged so nothing else moves.

```bash
git add scripts/lib/config.mjs test/config.test.mjs
git commit -m "feat(config): speaker profiles inherit the house; locks, overlayRoot, artifactRoot helpers"
```

---

## Task 2: `resolveKb` - merge one overlay onto the house

**Files:**
- Modify: `scripts/lib/kb.mjs`
- Test: `test/kb.test.mjs`

**Interfaces:**
- Consumes: `loadConfig`, `isSpeaker`, `overlayRoot`, `activeProfile` from Task 1.
- Produces:
  - `defaultDialsOf(toneMd) -> { warmth, humor, ... } | null` (null when no `**Default dials:**` line).
  - `speakerOffsetOf(houseToneMd, overlayToneMd) -> dials | null`.
  - `interpolate(stateVector, contextOffset, speakerOffset = {})`.
  - `resolveCell(context, state, { cells, vectors, speakerOffset })`.
  - `mergeRules(houseRules, overlayRules, locks) -> { rules, overrides, lockViolations }`.
  - `resolveKb(kbRoot, profileName = 'default') -> kb` where every rule has `origin: 'house' | 'speaker'`, `locked: boolean`, `path: 'voice.md' | 'profiles/<slug>/voice.md'`, and an override carries `overrides: <house rule>`. The object also has `profileName`, `role: 'house' | 'speaker'`, `speaker: { slug, name } | null`, `locks: string[]`, `overrides: rule[]`, `lockViolations: [{ id, file, line, houseRule }]`, `speakerOffset`, `houseRoot`, `overlayRoot`, `house` (the raw house kb) and `overlay` (the raw overlay kb, or null).

- [ ] **Step 1: Write the failing tests**

Append to `test/kb.test.mjs` (add `defaultDialsOf`, `speakerOffsetOf`, `mergeRules`, `resolveKb` to the existing import from `kb.mjs`):

```js
const HOUSE = {
  'kb/config.yml': [
    'profiles:',
    '  default:',
    '    name: "Acme"',
    '    primary_locale: en',
    '    locales: [en]',
    '  maya:',
    '    name: "Maya Lind"',
    'locks: [V2, L20]',
    ''
  ].join('\n'),
  'kb/voice.md': [
    '### V1 · Plainspoken `confirmed` ev: e1',
    '',
    '**Means:** Clarity above all.',
    '**Rules out:** fluff',
    '',
    '### V2 · No pressure `confirmed` ev: e1',
    '',
    '**Means:** Never manufacture urgency.',
    '**Rules out:** countdowns'
  ].join('\n'),
  'kb/tone.md': [
    '**Default dials:** warmth 3 · humor 0 · directness 3 · detail 2 · urgency 2 · formality 2',
    '',
    '| State | warmth | humor | directness | detail | urgency | formality |',
    '|---|---|---|---|---|---|---|',
    '| curious | 3 | 2 | 3 | 3 | 1 | 2 |',
    '| focused | 2 | 1 | 4 | 2 | 2 | 2 |',
    '',
    '| Context | warmth | humor | directness | detail | urgency | formality |',
    '|---|---|---|---|---|---|---|',
    '| social | 1 | 2 | 0 | -2 | 0 | -2 |',
    '',
    '### T-social/curious `confirmed` ev: e1',
    '',
    '**Dials:** warmth 4 · humor 2 · directness 3 · detail 1 · urgency 1 · formality 0'
  ].join('\n'),
  'kb/lexicon.md': [
    '| ID | Avoid | Prefer | Why | Conf | Ev |',
    '|---|---|---|---|---|---|',
    '| L01 | leverage | use | jargon | confirmed | e1 |',
    '| L20 | game changer | (cut) | hype | confirmed | e1 |'
  ].join('\n'),
  'kb/mechanics.md': [
    '| ID | Rule | Pattern | Conf | Ev |',
    '|---|---|---|---|---|',
    '| M01 | sentence case | | confirmed | e1 |'
  ].join('\n'),
  'kb/evidence/ledger.md': '### e1 — 2026-08-26 — interview\n\n**Produced:** V1, V2, L01, L20, M01, T-social/curious\n'
}

const OVERLAY = {
  'kb/profiles/maya/voice.md': [
    '### V1 · Builder `confirmed` ev: e1',
    '',
    '**Means:** Writes from what she built this week.',
    '**Rules out:** commentary from the sidelines'
  ].join('\n'),
  'kb/profiles/maya/tone.md': [
    '**Default dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 3',
    '',
    '| State | warmth | humor | directness | detail | urgency | formality |',
    '|---|---|---|---|---|---|---|',
    '| focused | 1 | 0 | 4 | 3 | 2 | 3 |',
    '',
    '### T-social/focused `confirmed` ev: e1',
    '',
    '**Dials:** warmth 1 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 3'
  ].join('\n'),
  'kb/profiles/maya/lexicon.md': [
    '| ID | Avoid | Prefer | Why | Conf | Ev |',
    '|---|---|---|---|---|---|',
    '| L01 | leverage | lean on | her word | confirmed | e1 |',
    '| L30 | excited to announce | (cut) | hype | confirmed | e1 |'
  ].join('\n')
}

test('defaultDialsOf reads the dials line and returns null without one', () => {
  assert.deepEqual(defaultDialsOf(HOUSE['kb/tone.md']),
    { warmth: 3, humor: 0, directness: 3, detail: 2, urgency: 2, formality: 2 })
  assert.equal(defaultDialsOf('# Tone\n'), null)
})

test('speakerOffsetOf is overlay defaults minus house defaults, per dial, and null without overlay defaults', () => {
  assert.deepEqual(speakerOffsetOf(HOUSE['kb/tone.md'], OVERLAY['kb/profiles/maya/tone.md']),
    { warmth: -1, humor: 0, directness: 1, detail: 1, urgency: -1, formality: 1 })
  assert.equal(speakerOffsetOf(HOUSE['kb/tone.md'], '# Tone\n'), null)
  assert.deepEqual(speakerOffsetOf('# Tone\n', OVERLAY['kb/profiles/maya/tone.md']),
    { warmth: 0, humor: 0, directness: 2, detail: 1, urgency: -1, formality: 1 },
    'a house with no dials line is treated as the neutral 2 on every dial')
})

test('interpolate applies a speaker offset as a third term, clamps, and still zeroes humor', () => {
  const state = { warmth: 3, humor: 2, directness: 3, detail: 3, urgency: 1, formality: 2 }
  const context = { warmth: 1, humor: 2, directness: 0, detail: -2, urgency: 0, formality: -2 }
  const offset = { warmth: -1, humor: 3, directness: 1, detail: 1, urgency: -1, formality: 1 }
  assert.deepEqual(interpolate(state, context, offset),
    { warmth: 3, humor: 0, directness: 4, detail: 2, urgency: 0, formality: 1 })
  assert.deepEqual(interpolate(state, context), interpolate(state, context, {}),
    'an absent offset is the identity, so every existing caller is unchanged')
})

test('resolveCell passes the speaker offset through to interpolation only', () => {
  const vectors = { states: { curious: { warmth: 3, humor: 2, directness: 3, detail: 3, urgency: 1, formality: 2 } }, contexts: { social: { warmth: 1, humor: 2, directness: 0, detail: -2, urgency: 0, formality: -2 } } }
  const offset = { warmth: -1, humor: 0, directness: 1, detail: 1, urgency: -1, formality: 1 }
  const computed = resolveCell('social', 'curious', { cells: [], vectors, speakerOffset: offset })
  assert.equal(computed.source, 'interpolated')
  assert.equal(computed.dials.warmth, 3)
  assert.equal(computed.dials.directness, 4)
  const authored = resolveCell('social', 'curious', {
    cells: [{ id: 'T-social/curious', context: 'social', state: 'curious', confidence: 'confirmed', dials: { warmth: 4, humor: 2, directness: 3, detail: 1, urgency: 1, formality: 0 } }],
    vectors, speakerOffset: offset
  })
  assert.equal(authored.dials.warmth, 4, 'an authored cell is never shifted')
})

test('mergeRules: additions add, same-id overrides replace, locked ids are refused', () => {
  const house = [
    { id: 'L01', file: 'lexicon', kind: 'table', line: 3 },
    { id: 'L20', file: 'lexicon', kind: 'table', line: 4 }
  ]
  const overlay = [
    { id: 'L01', file: 'lexicon', kind: 'table', line: 3 },
    { id: 'L20', file: 'lexicon', kind: 'table', line: 4 },
    { id: 'L30', file: 'lexicon', kind: 'table', line: 5 }
  ]
  const { rules, overrides, lockViolations } = mergeRules(house, overlay, ['L20'])
  assert.deepEqual(rules.map((r) => [r.id, r.origin, r.locked]),
    [['L20', 'house', true], ['L01', 'speaker', false], ['L30', 'speaker', false]])
  assert.equal(rules.find((r) => r.id === 'L01').overrides.line, 3)
  assert.deepEqual(overrides.map((r) => r.id), ['L01'])
  assert.deepEqual(lockViolations.map((v) => v.id), ['L20'])
})

test('resolveKb with no overlay is the house, tagged, with role house', () => {
  const dir = makeTmpProject(HOUSE)
  try {
    const kb = resolveKb(path.join(dir, 'kb'))
    assert.equal(kb.role, 'house')
    assert.equal(kb.speaker, null)
    assert.deepEqual(kb.locks, ['V2', 'L20'])
    assert.ok(kb.rules.every((r) => r.origin === 'house'))
    assert.equal(kb.rules.find((r) => r.id === 'V2').locked, true)
    assert.equal(kb.rules.find((r) => r.id === 'V1').locked, false)
    assert.equal(kb.rules.find((r) => r.id === 'V1').path, 'voice.md')
    assert.deepEqual(kb.overrides, [])
    assert.deepEqual(kb.lockViolations, [])
    assert.equal(kb.speakerOffset, null)
    assert.deepEqual(kb.rules.map((r) => r.id), loadKb(path.join(dir, 'kb')).rules.map((r) => r.id), 'same rules, same order as loadKb')
    const unknown = resolveKb(path.join(dir, 'kb'), 'ghost')
    assert.equal(unknown.role, 'house', 'an undeclared profile resolves to the house')
  } finally {
    cleanup(dir)
  }
})

test('resolveKb merges an overlay: voice replaces as a set, locked voice is appended, others merge by id', () => {
  const dir = makeTmpProject({ ...HOUSE, ...OVERLAY })
  try {
    const kb = resolveKb(path.join(dir, 'kb'), 'maya')
    assert.equal(kb.role, 'speaker')
    assert.deepEqual(kb.speaker, { slug: 'maya', name: 'Maya Lind' })
    const voice = kb.rules.filter((r) => r.id.startsWith('V'))
    assert.deepEqual(voice.map((r) => [r.id, r.name, r.origin, r.locked]),
      [['V1', 'Builder', 'speaker', false], ['V2', 'No pressure', 'house', true]],
      "the house's unlocked V1 is gone, its locked V2 follows the speaker's own")
    const l01 = kb.rules.find((r) => r.id === 'L01')
    assert.equal(l01.origin, 'speaker')
    assert.equal(l01.cells.Prefer, 'lean on')
    assert.equal(l01.overrides.cells.Prefer, 'use')
    assert.equal(l01.path, path.posix.join('profiles', 'maya', 'lexicon.md'))
    assert.equal(kb.rules.find((r) => r.id === 'L30').origin, 'speaker')
    assert.equal(kb.rules.find((r) => r.id === 'M01').origin, 'house', 'inherited untouched')
    assert.equal(kb.rules.filter((r) => r.id === 'L20').length, 1)
    assert.equal(kb.rules.find((r) => r.id === 'L20').origin, 'house', 'the locked house row wins')
    assert.deepEqual(kb.overrides.map((r) => r.id), ['L01'])
    assert.deepEqual(kb.lockViolations.map((v) => v.id), [])
  } finally {
    cleanup(dir)
  }
})

test('resolveKb: cells are the overlay only, vectors merge by row, offset is derived, evidence is the house ledger', () => {
  const dir = makeTmpProject({ ...HOUSE, ...OVERLAY })
  try {
    const kb = resolveKb(path.join(dir, 'kb'), 'maya')
    assert.deepEqual(kb.cells.map((c) => c.id), ['T-social/focused'], 'house authored cells are not inherited')
    assert.equal(kb.vectors.states.curious.warmth, 3, 'inherited row')
    assert.equal(kb.vectors.states.focused.warmth, 1, 'overridden row')
    assert.equal(kb.vectors.contexts.social.detail, -2)
    assert.deepEqual(kb.speakerOffset, { warmth: -1, humor: 0, directness: 1, detail: 1, urgency: -1, formality: 1 })
    assert.equal(kb.evidence.length, 1)
    assert.equal(kb.config.profiles.maya.name, 'Maya Lind', 'config is the house config, not a default read from the overlay dir')
    assert.equal(kb.present.voice, true, 'presence is the house presence')
    assert.equal(kb.houseRoot, path.join(dir, 'kb'))
    assert.equal(kb.overlayRoot, path.join(dir, 'kb', 'profiles', 'maya'))
    assert.equal(kb.tone, OVERLAY['kb/profiles/maya/tone.md'], 'kb.tone is the overlay text, so default dials are the speaker\'s')
  } finally {
    cleanup(dir)
  }
})

test('resolveKb records a lock violation and keeps the house rule', () => {
  const dir = makeTmpProject({
    ...HOUSE,
    'kb/profiles/maya/lexicon.md': [
      '| ID | Avoid | Prefer | Why | Conf | Ev |',
      '|---|---|---|---|---|---|',
      '| L20 | game changer | fine actually | she likes it | confirmed | e1 |'
    ].join('\n')
  })
  try {
    const kb = resolveKb(path.join(dir, 'kb'), 'maya')
    assert.deepEqual(kb.lockViolations.map((v) => [v.id, v.file, v.line]), [['L20', path.posix.join('profiles', 'maya', 'lexicon.md'), 3]])
    assert.equal(kb.rules.find((r) => r.id === 'L20').cells.Prefer, '(cut)')
    assert.equal(kb.speakerOffset, null, 'no overlay tone.md means no dials line means no offset')
  } finally {
    cleanup(dir)
  }
})

test('resolveKb: an overlay with no V rule inherits the whole house voice', () => {
  const dir = makeTmpProject({ ...HOUSE, 'kb/profiles/maya/lexicon.md': '# Lexicon\n' })
  try {
    const kb = resolveKb(path.join(dir, 'kb'), 'maya')
    assert.deepEqual(kb.rules.filter((r) => r.id.startsWith('V')).map((r) => [r.id, r.origin]), [['V1', 'house'], ['V2', 'house']])
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/kb.test.mjs`
Expected: FAIL, `defaultDialsOf` is not exported.

- [ ] **Step 3: Implement**

In `scripts/lib/kb.mjs`, change the config import and add the three helpers after `parseDials`:

```js
import { loadConfig, isSpeaker, overlayRoot as overlayRootFor, activeProfile } from './config.mjs'
```

```js
/**
 * The `**Default dials:**` line of a tone.md, or null when there is none.
 * Moved here from compile-context.mjs so the speaker offset (below) and the
 * card compiler read the same line the same way.
 */
export function defaultDialsOf (toneMd) {
  const line = /^\*\*Default dials:\*\*\s*(.+)$/m.exec(toneMd || '')
  return line ? parseDials(line[1]) : null
}

/**
 * Spec §4.3: speaker_offset = overlay default dials - house default dials,
 * per dial. Derived, never authored: one line in the overlay shifts the
 * whole matrix. A house with no dials line counts as the neutral 2 on
 * every dial, matching compile-context's NEUTRAL_DIALS. An overlay with no
 * dials line yields null - the speaker has not stated a voice yet, and
 * validate reports W_SPEAKER_NO_VOICE rather than silently using zero.
 */
export function speakerOffsetOf (houseToneMd, overlayToneMd) {
  const overlay = defaultDialsOf(overlayToneMd)
  if (!overlay) return null
  const house = defaultDialsOf(houseToneMd) ?? {}
  const out = {}
  for (const dial of DIALS) out[dial] = Number(overlay[dial] ?? 2) - Number(house[dial] ?? 2)
  return out
}
```

Replace `interpolate` and the interpolated branch of `resolveCell`:

```js
/** Spec 6.5 arithmetic plus the §4.3 speaker term, then gate 1: computed cells never carry humor. */
export function interpolate (stateVector = {}, contextOffset = {}, speakerOffset = {}) {
  const dials = {}
  for (const dial of DIALS) {
    dials[dial] = clamp(
      Number(stateVector[dial] ?? 2) + Number(contextOffset[dial] ?? 0) + Number(speakerOffset?.[dial] ?? 0)
    )
  }
  dials.humor = 0
  return dials
}
```

In `resolveCell`, change the signature to `{ cells = [], vectors = { states: {}, contexts: {} }, speakerOffset = {} } = {}` and the interpolated branch's `dials:` line to:

```js
    dials: applyHumorGates(interpolate(vectors.states[state], vectors.contexts[context], speakerOffset), state),
```

Add `mergeRules` and `resolveKb` after `loadKb`:

```js
const VOICE = (rule) => rule.id.startsWith('V')

/**
 * Spec §4.2 and §4.4. Voice replaces as a set: if the overlay has any V rule,
 * the house's unlocked V rules are dropped and its locked ones are appended
 * after the speaker's. Everything else merges by id: same id overrides,
 * new id adds, a locked id is refused and recorded.
 *
 * Order matters for byte identity downstream: with an empty overlay the
 * result is the house list in the house's own order, tagged - nothing moves.
 */
export function mergeRules (houseRules, overlayRules, locks = []) {
  const locked = new Set(locks)
  const tagHouse = (rule) => ({ ...rule, origin: 'house', locked: locked.has(rule.id) })
  const tagSpeaker = (rule) => ({ ...rule, origin: 'speaker', locked: false })

  const overrides = []
  const lockViolations = []
  const overlayById = new Map()
  for (const rule of overlayRules) if (!overlayById.has(rule.id)) overlayById.set(rule.id, rule)
  const speakerHasVoice = overlayRules.some(VOICE)

  const rules = []
  for (const house of houseRules) {
    const hit = overlayById.get(house.id)
    if (locked.has(house.id)) {
      if (hit) lockViolations.push({ id: house.id, file: hit.path ?? `${hit.file}.md`, line: hit.line, houseRule: house })
      if (VOICE(house) && speakerHasVoice) continue // appended after the speaker's voice, below
      rules.push(tagHouse(house))
      continue
    }
    if (VOICE(house) && speakerHasVoice) continue
    if (hit) continue // replaced; the speaker rule is pushed in overlay order below
    rules.push(tagHouse(house))
  }
  for (const rule of overlayRules) {
    if (locked.has(rule.id)) continue
    const houseRule = houseRules.find((h) => h.id === rule.id)
    const tagged = tagSpeaker(rule)
    if (houseRule && !VOICE(rule)) {
      tagged.overrides = houseRule
      overrides.push(tagged)
    }
    rules.push(tagged)
  }
  if (speakerHasVoice) {
    for (const house of houseRules) if (VOICE(house) && locked.has(house.id)) rules.push(tagHouse(house))
  }
  return { rules, overrides, lockViolations }
}

/**
 * The house plus one overlay, merged by the rules in spec §4. This is the
 * one function every consumer reads a knowledge base through; loadKb() is
 * the per-directory parser underneath it.
 *
 * With no overlay - `default`, an undeclared name, or a declared speaker
 * whose directory does not exist yet - the result is the house with
 * `origin`, `locked` and `path` on every rule and nothing else changed.
 */
export function resolveKb (kbRoot, profileName = 'default') {
  const house = loadKb(kbRoot)
  const config = house.config
  const locks = Array.isArray(config.locks) ? config.locks : []
  const withPath = (rules, prefix) => rules.map((rule) => ({
    ...rule, path: prefix ? path.posix.join(prefix, `${rule.file}.md`) : `${rule.file}.md`
  }))

  const overlayDir = overlayRootFor(kbRoot, profileName)
  const speaking = isSpeaker(config, profileName) && existsSync(overlayDir)

  if (!speaking) {
    const { rules } = mergeRules(withPath(house.rules, ''), [], locks)
    return {
      ...house,
      rules,
      profileName,
      role: 'house',
      speaker: null,
      locks,
      overrides: [],
      lockViolations: [],
      speakerOffset: null,
      houseRoot: kbRoot,
      overlayRoot: null,
      house,
      overlay: null
    }
  }

  const overlay = loadKb(overlayDir)
  const prefix = path.posix.join('profiles', profileName)
  const { rules, overrides, lockViolations } = mergeRules(
    withPath(house.rules, ''), withPath(overlay.rules, prefix), locks
  )
  const profile = activeProfile(config, profileName)

  return {
    ...house,
    // The overlay owns the tone text: default dials and authored cells are
    // the speaker's. Vectors merge row by row; cells are NOT inherited (§4.3).
    tone: overlay.tone,
    cells: overlay.cells,
    vectors: {
      states: { ...house.vectors.states, ...overlay.vectors.states },
      contexts: { ...house.vectors.contexts, ...overlay.vectors.contexts }
    },
    channels: { ...house.channels, ...overlay.channels },
    locales: { ...house.locales, ...overlay.locales },
    unparsedHeadings: [
      ...house.unparsedHeadings,
      ...overlay.unparsedHeadings.map((h) => ({ ...h, file: path.posix.join(prefix, h.file) }))
    ],
    rules,
    config,
    profileName,
    role: 'speaker',
    speaker: { slug: profileName, name: profile.name },
    locks,
    overrides,
    lockViolations,
    speakerOffset: speakerOffsetOf(house.tone, overlay.tone),
    houseRoot: kbRoot,
    overlayRoot: overlayDir,
    house,
    overlay
  }
}
```

`existsSync` and `path` are already imported at the top of `kb.mjs`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/kb.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite, then commit**

Run: `npm test`
Expected: all green. `interpolate` and `resolveCell` are backwards compatible; nothing else calls the new functions yet.

```bash
git add scripts/lib/kb.mjs test/kb.test.mjs
git commit -m "feat(kb): resolveKb merges one overlay onto the house; speaker offset in interpolation"
```

---

## Task 3: Sources carry a profile

**Files:**
- Modify: `scripts/lib/register.mjs`, `scripts/lib/corpus.mjs`, `scripts/sources.mjs`
- Test: `test/register.test.mjs`, `test/corpus.test.mjs`, `test/sources.test.mjs`

**Interfaces:**
- Consumes: `activeProfile`, `isSpeaker` from Task 1.
- Produces: `entriesForProfile(register, profileName, config) -> entry[]`; every file from `resolveEntry` carries `profile: string | null`; `gatherAll({ profileName })` scopes register and index to that profile; `runAdd(ctx, { target, label, profile })` writes `profile` into the register entry; ingested index entries carry `profile`.

- [ ] **Step 1: Write the failing tests**

Append to `test/register.test.mjs` (add `entriesForProfile` to its import from `register.mjs`; it already imports `resolveEntry`, `loadRegister`, `makeTmpProject`, `cleanup`, `path`):

```js
test('entriesForProfile: the house sees unattributed entries, a speaker sees only its own', () => {
  const config = { profiles: { default: { name: 'Acme' }, maya: { name: 'Maya Lind' } } }
  const register = [
    { id: 's01', kind: 'project', include: ['content/**/*.md'], exclude: [] },
    { id: 's02', kind: 'inbox', path: 'sources/' },
    { id: 's03', kind: 'inbox', path: 'profiles/maya/sources/', profile: 'maya' }
  ]
  assert.deepEqual(entriesForProfile(register, 'default', config).map((e) => e.id), ['s01', 's02'])
  assert.deepEqual(entriesForProfile(register, 'maya', config).map((e) => e.id), ['s03'])
  assert.deepEqual(entriesForProfile(register, 'ghost', config).map((e) => e.id), ['s01', 's02'], 'an undeclared profile is the house')
})

test('resolveEntry attributes locale from the entry\'s own profile and stamps profile on each file', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/profiles/maya/sources/post-de.md': 'Hallo.\n',
    '.voice-and-tone/sources/note.md': 'Hello.\n'
  })
  try {
    const config = {
      profiles: {
        default: { name: 'Acme', primary_locale: 'en', locales: ['en'] },
        maya: { name: 'Maya Lind', primary_locale: 'de', locales: ['de', 'en'] }
      }
    }
    const kbRoot = path.join(dir, '.voice-and-tone')
    const ctx = { projectRoot: dir, kbRoot, config, profileName: 'default' }
    const speaker = resolveEntry({ id: 's03', kind: 'inbox', path: 'profiles/maya/sources/', profile: 'maya' }, ctx)
    assert.equal(speaker.files[0].locale, 'de', 'the speaker\'s own locales decide, even from a house context')
    assert.equal(speaker.files[0].profile, 'maya')
    const house = resolveEntry({ id: 's02', kind: 'inbox', path: 'sources/' }, ctx)
    assert.equal(house.files[0].locale, 'en')
    assert.equal(house.files[0].profile, null)
  } finally {
    cleanup(dir)
  }
})
```

Append to `test/corpus.test.mjs` (it imports `gatherAll`, `loadConfig`, `makeTmpProject`, `cleanup`, `path`):

```js
test('gatherAll scopes the register to the profile: house files for default, speaker files for a speaker', () => {
  const dir = makeTmpProject({
    'content/page.md': '# Page\n\nHouse copy here.\n',
    '.voice-and-tone/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: en',
      '    locales: [en]',
      '  maya:',
      '    name: "Maya Lind"',
      'sources:',
      '  - id: s01',
      '    kind: project',
      '    include: ["content/**/*.md"]',
      '    exclude: []',
      '  - id: s02',
      '    kind: inbox',
      '    path: "profiles/maya/sources/"',
      '    profile: maya',
      ''
    ].join('\n'),
    '.voice-and-tone/profiles/maya/sources/post.md': 'Her post.\n',
    '.voice-and-tone/evidence/sources.json': JSON.stringify({
      generated: '2026-09-10T00:00:00.000Z',
      sources: [{
        id: 'f001', sha256: 'abc', kind: 'file', from: 's02', origin: 'profiles/maya/sources/post.md',
        format: 'markdown', locale: 'en', tier: 'script', status: 'used', profile: 'maya',
        stats: { strings: 1, words: 2, sentences: 1 }, produced: []
      }]
    })
  })
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    const config = loadConfig(kbRoot)
    const house = gatherAll({ projectRoot: dir, kbRoot, config, profileName: 'default' })
    assert.deepEqual(house.files.map((f) => f.rel), ['content/page.md'], 'the speaker\'s indexed post is not house corpus')
    const maya = gatherAll({ projectRoot: dir, kbRoot, config, profileName: 'maya' })
    assert.deepEqual(maya.files.map((f) => f.rel ?? f.origin), ['profiles/maya/sources/post.md'])
    assert.equal(maya.unindexed.length, 0)
  } finally {
    cleanup(dir)
  }
})
```

Append to `test/sources.test.mjs` (it imports `runAdd`, `runIngest`, `runCheck`, `loadConfig`, `loadIndex`, `makeTmpProject`, `cleanup`, `path`; check the top of the file and add any missing name to the existing import lines):

```js
test('runAdd with a profile persists it on the register entry, and ingest stamps it on the index entry', async () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: en',
      '    locales: [en]',
      '  maya:',
      '    name: "Maya Lind"',
      'sources:',
      '  - id: s01',
      '    kind: project',
      '    include: ["content/**/*.md"]',
      '    exclude: []',
      ''
    ].join('\n'),
    'material/post.md': 'Her post about the thing she built.\n'
  })
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    const ctx = { projectRoot: dir, kbRoot, config: loadConfig(kbRoot), profileName: 'maya', now: '2026-09-10T00:00:00.000Z' }
    const { entry } = runAdd(ctx, { target: path.join(dir, 'material'), label: 'posts', profile: 'maya' })
    assert.equal(entry.profile, 'maya')
    const written = loadConfig(kbRoot)
    assert.equal(written.sources.find((s) => s.id === entry.id).profile, 'maya')

    const after = { ...ctx, config: written }
    await runIngest(after, {})
    const index = loadIndex(kbRoot)
    assert.equal(index.sources.length, 1)
    assert.equal(index.sources[0].profile, 'maya')

    const houseCheck = runCheck({ ...after, profileName: 'default' })
    assert.equal(houseCheck.index.sources.filter((s) => (s.profile ?? null) === null).length, 0)
    assert.deepEqual(houseCheck.register.map((r) => r.id), ['s01'], 'a house check does not see the speaker\'s register entry')
    const speakerCheck = runCheck(after)
    assert.deepEqual(speakerCheck.register.map((r) => r.id), [entry.id])
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/register.test.mjs test/corpus.test.mjs test/sources.test.mjs`
Expected: FAIL on `entriesForProfile` missing, `profile` undefined on files, and register scoping.

- [ ] **Step 3: Implement**

`scripts/lib/register.mjs`: import `isSpeaker` alongside `activeProfile`, add after `nextRegisterId`:

```js
/**
 * Spec §3: `sources[].profile` is optional, absent means house. The house
 * corpus is every unattributed entry; a speaker's corpus is exactly the
 * entries attributed to it. An undeclared profile name is the house, the
 * same fallback activeProfile takes.
 */
export function entriesForProfile (register, profileName, config) {
  const speaking = isSpeaker(config, profileName)
  return (register ?? []).filter((entry) => {
    const owner = entry.profile ?? null
    return speaking ? owner === profileName : owner === null
  })
}
```

In `resolveEntry`, change the first three lines of the body so the entry's own profile decides its locales:

```js
  const { config, profileName = 'default' } = ctx
  const owner = entry.profile ?? null
  const profile = activeProfile(config, owner ?? profileName)
  const primary = profile.primary_locale ?? 'en'
  const locales = profile.locales ?? [primary]
```

and add `profile: owner,` to the object pushed into `base.files` (after `label`).

`scripts/lib/corpus.mjs`: import `entriesForProfile` from `./register.mjs` and `isSpeaker` from `./config.mjs`. In `gatherAll`, replace the first two lines of the body:

```js
  const register = entriesForProfile(loadRegister(config), profileName, config)
  const resolved = resolveRegister(register, { projectRoot, kbRoot, config, profileName })
  const index = loadIndex(kbRoot)
  // Index entries are scoped the same way the register is: by the profile
  // stamped on them at ingest. An entry with no profile is house material.
  const speaking = isSpeaker(config, profileName)
  const indexSources = (index.sources ?? []).filter((s) => (speaking ? s.profile === profileName : (s.profile ?? null) === null))
```

Then, everywhere below in `gatherAll` that reads `index.sources`, read `indexSources` instead (there are two places: the `indexedOrigins` set and the loop that pulls indexed entries' stats into `files`). The `unindexed`/`missing` logic is unchanged.

`scripts/sources.mjs`:

1. `runAdd(ctx, { target, label = null, profile = null })`: add `...(profile ? { profile } : {})` to both entry shapes.
2. `runCheck`: after `const register = loadRegister(ctx.config)`, add `const scoped = isSpeaker(ctx.config, ctx.profileName) ? entriesForProfile(register, ctx.profileName, ctx.config) : register` and resolve `scoped` instead of `register`; return `register: scoped`. A house-context check still sees every entry, because ingestion is attribution-preserving and `--ingest` without a profile must analyse everything (spec §6.2). Import `entriesForProfile` from `./lib/register.mjs` and `isSpeaker` from `./lib/config.mjs`.
3. `ingestOne`: after a successful `ingestFile`, stamp `entry.profile = file.profile ?? null` before returning. In `runRefresh`, stamp `candidate.profile = entry.profile ?? null` right after `fetched` is destructured.
4. `main`: pass `profile: isSpeaker(ctx.config, ctx.profileName) ? ctx.profileName : null` into `runAdd`. Update `--help` so the `--profile` line reads `'  --profile <name>     config profile; with --add, attributes the source to that speaker'`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/register.test.mjs test/corpus.test.mjs test/sources.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite, then commit**

Run: `npm test`
Expected: all green.

```bash
git add scripts/lib/register.mjs scripts/lib/corpus.mjs scripts/sources.mjs test/register.test.mjs test/corpus.test.mjs test/sources.test.mjs
git commit -m "feat(sources): register entries and index entries carry a profile; corpus scopes to it"
```

---

## Task 4: Scan and fingerprint write into the profile's artifact root

**Files:**
- Modify: `scripts/scan.mjs`, `scripts/fingerprint.mjs`
- Test: `test/scan.test.mjs`, `test/fingerprint.test.mjs`

**Interfaces:**
- Consumes: `artifactRoot` from Task 1.
- Produces: `scan.mjs --profile <slug>` writes `profiles/<slug>/evidence/manifest.json`; `fingerprint.mjs --profile <slug>` writes `profiles/<slug>/evidence/fingerprint.json` and preserves that file's own baseline.

- [ ] **Step 1: Write the failing tests**

Append to `test/scan.test.mjs` (it runs the script via `execFileSync(process.execPath, [SCAN, ...])`; reuse its helpers):

```js
test('--profile <speaker> writes the manifest under the overlay, never the house', () => {
  const dir = makeTmpProject({
    'content/a.md': '# A\n\nHouse copy.\n',
    '.voice-and-tone/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '    primary_locale: en',
      '    locales: [en]',
      '  maya:',
      '    name: "Maya Lind"',
      'sources:',
      '  - id: s01',
      '    kind: project',
      '    include: ["content/**/*.md"]',
      '    exclude: []',
      ''
    ].join('\n'),
    '.voice-and-tone/profiles/maya/voice.md': '# Voice\n'
  })
  try {
    execFileSync(process.execPath, [SCAN, '--root', dir, '--profile', 'maya', '--now', '2026-09-10T00:00:00.000Z'])
    assert.ok(existsSync(path.join(dir, '.voice-and-tone', 'profiles', 'maya', 'evidence', 'manifest.json')))
    assert.ok(!existsSync(path.join(dir, '.voice-and-tone', 'evidence', 'manifest.json')))
    const manifest = JSON.parse(readFileSync(path.join(dir, '.voice-and-tone', 'profiles', 'maya', 'evidence', 'manifest.json'), 'utf8'))
    assert.equal(manifest.profile, 'maya')
    assert.equal(manifest.totals.files, 0, 'the project entry is house material, so the speaker corpus is empty')
  } finally {
    cleanup(dir)
  }
})
```

Append the same shape to `test/fingerprint.test.mjs`, asserting `profiles/maya/evidence/fingerprint.json` exists after `--profile maya --set-baseline`, that `baseline` is non-null there, and that a second run without `--set-baseline` keeps that baseline while `.voice-and-tone/evidence/fingerprint.json` is untouched.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/scan.test.mjs test/fingerprint.test.mjs`
Expected: FAIL, the files land in the house `evidence/`.

- [ ] **Step 3: Implement**

In both scripts, import `artifactRoot` from `./lib/config.mjs` and replace the default output path:

`scan.mjs`:
```js
  const out = values.out
    ? path.resolve(values.out)
    : path.join(artifactRoot(kbRoot, values.profile ?? 'default', config), 'evidence', 'manifest.json')
```

`fingerprint.mjs`:
```js
  const out = values.out
    ? path.resolve(values.out)
    : path.join(artifactRoot(kbRoot, values.profile ?? 'default', config), 'evidence', 'fingerprint.json')
```

`writeTextFile` creates parent directories (check `fsx.mjs`; if it does not, add `mkdirSync(path.dirname(out), { recursive: true })` before the write in both scripts).

- [ ] **Step 4: Run the tests, then the suite, then commit**

Run: `node --test test/scan.test.mjs test/fingerprint.test.mjs && npm test`
Expected: PASS.

```bash
git add scripts/scan.mjs scripts/fingerprint.mjs test/scan.test.mjs test/fingerprint.test.mjs
git commit -m "feat(scan,fingerprint): per-speaker manifest and fingerprint under the overlay"
```

---

## Task 5: Validation - locks, overlays, and every speaker

**Files:**
- Modify: `scripts/validate.mjs`
- Test: `test/validate.test.mjs`
- Create: `test/fixtures/house-with-speakers/**`

**Interfaces:**
- Consumes: `resolveKb`, `speakerProfiles`, `overlayRoot` from Tasks 1-2.
- Produces: `validateKb(kb)` reports `E_LOCKED_OVERRIDE`, `E_UNKNOWN_LOCK`, `E_OVERLAY_DIR_MISMATCH`, `W_SPEAKER_NO_VOICE`, `W_ID_RANGE_COLLISION_RISK`, `W_OVERRIDE_UNEVIDENCED`; `validateAll(kbRoot) -> { errors, warnings, findings, counts, profiles: [{ profile, errors, warnings, counts }] }`; `main` uses `validateAll`.

- [ ] **Step 1: Create the fixture**

Create these files under `test/fixtures/house-with-speakers/` (a complete house plus two speakers; `jonas` overrides a locked rule on purpose):

`config.yml`:
```yaml
version: 1
kb_version: 0.3.0
profiles:
  default:
    name: "Acme"
    primary_locale: en
    locales: [en]
  maya:
    name: "Maya Lind"
  jonas:
    name: "Jonas Berg"
locks: [V2, L20]
sources:
  - id: s01
    kind: project
    include: ["content/**/*.md"]
    exclude: []
thresholds:
  corroboration: 2
  derived_min_samples: 5
  stale_months: 9
```

`voice.md`:
```markdown
# Voice

### V1 · Plainspoken   `confirmed`  ev: e1

**Means:** Clarity above all.
**Rules out:** fluff, hype

### V2 · No pressure   `confirmed`  ev: e1

**Means:** Never manufacture urgency.
**Rules out:** countdowns, scarcity framing
```

`tone.md`: copy `templates/kb/tone.md` verbatim, then append:
```markdown

### T-social/curious   `confirmed`  ev: e1

**Reader is feeling:** browsing
**Dials:** warmth 4 · humor 2 · directness 3 · detail 1 · urgency 1 · formality 0
**Do:** one idea
**Don't:** stack claims
**Example:** *"One thing worth knowing."*
```

`lexicon.md`:
```markdown
# Lexicon

## Avoid

| ID | Avoid | Prefer | Why | Conf | Ev |
|---|---|---|---|---|---|
| L01 | leverage | use | jargon | confirmed | e1 |

## Never say

| ID | Avoid | Prefer | Why | Conf | Ev |
|---|---|---|---|---|---|
| L20 | game changer | (cut) | hype | confirmed | e1 |
```

`mechanics.md`:
```markdown
# Mechanics

| ID | Rule | Pattern | Conf | Ev |
|---|---|---|---|---|
| M01 | Sentence case. | | confirmed | e1 |
```

`audience.md`: `# Audience\n`. `evidence/ledger.md`:
```markdown
# Evidence ledger

### e1 — 2026-08-26 — interview

**Type:** preference pairs
**Produced:** V1, V2, L01, L20, M01, T-social/curious, V3, L30, T-social/focused
```

`profiles/maya/voice.md`:
```markdown
### V3 · Builder   `confirmed`  ev: e1

**Means:** Writes from what she built this week.
**Rules out:** commentary from the sidelines
```

`profiles/maya/tone.md`:
```markdown
**Default dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 3

### T-social/focused   `confirmed`  ev: e1

**Reader is feeling:** mid-task
**Dials:** warmth 1 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 3
**Do:** the number first
**Don't:** warm up
**Example:** *"Forty percent faster. Here is why."*
```

`profiles/maya/lexicon.md`:
```markdown
| ID | Avoid | Prefer | Why | Conf | Ev |
|---|---|---|---|---|---|
| L01 | leverage | lean on | her word | confirmed | e1 |
| L30 | excited to announce | (cut) | hype | confirmed | e1 |
```

`profiles/jonas/voice.md`: `# Voice\n` (no V rule, no dials line, on purpose). `profiles/jonas/lexicon.md`:
```markdown
| ID | Avoid | Prefer | Why | Conf | Ev |
|---|---|---|---|---|---|
| L20 | game changer | keep it | he likes it | confirmed | e1 |
| L02 | utilize | use | jargon | derived | |
```

- [ ] **Step 2: Write the failing tests**

Append to `test/validate.test.mjs` (it imports `validateKb`, `loadKb`, `makeTmpProject`, `cleanup`, `path`; add `validateAll` and `resolveKb` from `../scripts/lib/kb.mjs`):

```js
import { cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'house-with-speakers')

function fixtureKb () {
  const dir = makeTmpProject({})
  cpSync(FIXTURE, path.join(dir, '.voice-and-tone'), { recursive: true })
  return { dir, kbRoot: path.join(dir, '.voice-and-tone') }
}

test('the house of the fixture validates clean', () => {
  const { dir, kbRoot } = fixtureKb()
  try {
    const report = validateKb(resolveKb(kbRoot, 'default'))
    assert.equal(report.errors, 0, JSON.stringify(report.findings, null, 2))
  } finally {
    cleanup(dir)
  }
})

test('E_LOCKED_OVERRIDE names the overlay file and line; the house keeps its rule', () => {
  const { dir, kbRoot } = fixtureKb()
  try {
    const report = validateKb(resolveKb(kbRoot, 'jonas'))
    const hit = report.findings.find((f) => f.code === 'E_LOCKED_OVERRIDE')
    assert.ok(hit)
    assert.equal(hit.file, path.posix.join('profiles', 'jonas', 'lexicon.md'))
    assert.equal(hit.line, 3)
    assert.match(hit.message, /L20/)
    assert.ok(!report.findings.some((f) => f.code === 'E_DUPLICATE_ID'), 'an override is not a duplicate')
  } finally {
    cleanup(dir)
  }
})

test('W_SPEAKER_NO_VOICE fires for an overlay with no V rule and no dials line', () => {
  const { dir, kbRoot } = fixtureKb()
  try {
    const jonas = validateKb(resolveKb(kbRoot, 'jonas'))
    assert.ok(jonas.findings.some((f) => f.code === 'W_SPEAKER_NO_VOICE'))
    const maya = validateKb(resolveKb(kbRoot, 'maya'))
    assert.ok(!maya.findings.some((f) => f.code === 'W_SPEAKER_NO_VOICE'))
  } finally {
    cleanup(dir)
  }
})

test('W_ID_RANGE_COLLISION_RISK fires for a speaker addition below the next decade above the house', () => {
  const { dir, kbRoot } = fixtureKb()
  try {
    const jonas = validateKb(resolveKb(kbRoot, 'jonas'))
    const hit = jonas.findings.find((f) => f.code === 'W_ID_RANGE_COLLISION_RISK')
    assert.ok(hit, 'L02 sits below L30, the first safe id when the house tops out at L20')
    assert.match(hit.message, /L02/)
    assert.match(hit.message, /L30/)
    const maya = validateKb(resolveKb(kbRoot, 'maya'))
    assert.ok(!maya.findings.some((f) => f.code === 'W_ID_RANGE_COLLISION_RISK'), 'L30 is safe')
  } finally {
    cleanup(dir)
  }
})

test('W_OVERRIDE_UNEVIDENCED fires for an override citing no evidence, not for one that does', () => {
  const dir = makeTmpProject({})
  try {
    cpSync(FIXTURE, path.join(dir, '.voice-and-tone'), { recursive: true })
    const kbRoot = path.join(dir, '.voice-and-tone')
    const clean = validateKb(resolveKb(kbRoot, 'maya'))
    assert.ok(!clean.findings.some((f) => f.code === 'W_OVERRIDE_UNEVIDENCED'))
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path.join(kbRoot, 'profiles', 'maya', 'lexicon.md'), [
      '| ID | Avoid | Prefer | Why | Conf | Ev |',
      '|---|---|---|---|---|---|',
      '| L01 | leverage | lean on | her word | confirmed | |'
    ].join('\n'))
    const dirty = validateKb(resolveKb(kbRoot, 'maya'))
    assert.ok(dirty.findings.some((f) => f.code === 'W_OVERRIDE_UNEVIDENCED'))
  } finally {
    cleanup(dir)
  }
})

test('E_UNKNOWN_LOCK and E_OVERLAY_DIR_MISMATCH are house-level findings', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': [
      'profiles:',
      '  default:',
      '    name: "Acme"',
      '  maya:',
      '    name: "Maya Lind"',
      'locks: [V9]',
      ''
    ].join('\n'),
    '.voice-and-tone/voice.md': '### V1 · Plain `assumed`\n\n**Means:** x\n',
    '.voice-and-tone/tone.md': '# Tone\n',
    '.voice-and-tone/profiles/stray/voice.md': '# Voice\n'
  })
  try {
    const report = validateKb(resolveKb(path.join(dir, '.voice-and-tone'), 'default'))
    const codes = report.findings.map((f) => f.code)
    assert.ok(codes.includes('E_UNKNOWN_LOCK'))
    const mismatches = report.findings.filter((f) => f.code === 'E_OVERLAY_DIR_MISMATCH')
    assert.equal(mismatches.length, 2, 'maya declared without a directory, stray directory without a declaration')
  } finally {
    cleanup(dir)
  }
})

test('validateAll validates the house and every speaker and sums the counts', () => {
  const { dir, kbRoot } = fixtureKb()
  try {
    const report = validateAll(kbRoot)
    assert.deepEqual(report.profiles.map((p) => p.profile), ['default', 'jonas', 'maya'])
    assert.equal(report.errors, 1, 'exactly the lock violation in jonas')
    assert.ok(report.findings.some((f) => f.code === 'E_LOCKED_OVERRIDE'))
    assert.ok(!report.findings.some((f) => f.code === 'E_UNKNOWN_LOCK'))
  } finally {
    cleanup(dir)
  }
})

test('validateAll on a knowledge base with no speakers is validateKb of the house, byte for byte', () => {
  const dir = makeTmpProject({
    '.voice-and-tone/config.yml': 'profiles:\n  default:\n    name: "Acme"\n',
    '.voice-and-tone/voice.md': '### V1 · Plain `assumed`\n\n**Means:** x\n',
    '.voice-and-tone/tone.md': '# Tone\n'
  })
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    const all = validateAll(kbRoot)
    const one = validateKb(loadKb(kbRoot))
    assert.deepEqual(all.findings, one.findings)
    assert.deepEqual(all.counts, one.counts)
  } finally {
    cleanup(dir)
  }
})
```

The `W_OVERRIDE_UNEVIDENCED` test uses `await import`, so declare it `test('...', async () => { ... })`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/validate.test.mjs`
Expected: FAIL, `validateAll` not exported and new codes absent.

- [ ] **Step 4: Implement**

In `scripts/validate.mjs`:

1. Import `resolveKb` from `./lib/kb.mjs` (it already imports `loadKb` and the constants), and `speakerProfiles`, `overlayRoot` from `./lib/config.mjs`. Import `existsSync`, `readdirSync` from `node:fs`.

2. In `validateKb`, change `add` so it honours a rule's `path`:

```js
  const add = (severity, code, message, file, line) =>
    addFile(severity, code, message, /\.md$/.test(file) ? file : `${file}.md`, line)
```

and in the `for (const rule of rules)` loop, replace every `rule.file` passed to `add` with `rule.path ?? rule.file`. For cells and vectors, compute once before the cell loop:

```js
  const toneFile = kb.role === 'speaker' ? path.posix.join('profiles', kb.profileName, 'tone.md') : 'tone'
```

and pass `toneFile` where `'tone'` was passed.

3. Add the new checks after the vectors block and before the source-index section:

```js
  // --- speakers and locks (spec §4, §8.2) --------------------------------
  for (const violation of kb.lockViolations ?? []) {
    addFile('error', 'E_LOCKED_OVERRIDE',
      `rule ${violation.id} is locked by the house (config.yml locks:) and cannot be overridden; ` +
      'the house rule stays in force - remove this row, or unlock it in config.yml if the brand team agrees',
      violation.file, violation.line ?? 0)
  }

  if (kb.role !== 'speaker') {
    const houseIds = new Set((kb.house?.rules ?? kb.rules ?? []).map((r) => r.id))
    for (const id of kb.locks ?? []) {
      if (!houseIds.has(id)) {
        addFile('error', 'E_UNKNOWN_LOCK', `config.yml locks ${id}, which the house does not define`, 'config.yml', 0)
      }
    }
    if (kb.kbRoot) {
      const declared = new Set(speakerProfiles(kb.config).map((p) => p.slug))
      for (const slug of declared) {
        if (!existsSync(overlayRoot(kb.kbRoot, slug))) {
          addFile('error', 'E_OVERLAY_DIR_MISMATCH',
            `profile ${slug} is declared in config.yml but profiles/${slug}/ does not exist - ` +
            'run /voice-and-tone:speaker add, or remove the profile',
            'config.yml', 0)
        }
      }
      const profilesDir = path.join(kb.kbRoot, 'profiles')
      if (existsSync(profilesDir)) {
        for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name.startsWith('_') || declared.has(entry.name)) continue
          addFile('error', 'E_OVERLAY_DIR_MISMATCH',
            `profiles/${entry.name}/ exists but config.yml declares no profile ${entry.name} - ` +
            'declare it, or remove the directory',
            'config.yml', 0)
        }
      }
    }
  }

  if (kb.role === 'speaker') {
    const speakerVoice = rules.some((r) => r.origin === 'speaker' && r.id.startsWith('V'))
    if (!speakerVoice || !kb.speakerOffset) {
      addFile('warning', 'W_SPEAKER_NO_VOICE',
        `speaker ${kb.profileName} defines ${speakerVoice ? 'no default dials line' : 'no voice characteristic'}; ` +
        'it is the house in a costume until /voice-and-tone:speaker add finishes discovery',
        path.posix.join('profiles', kb.profileName, speakerVoice ? 'tone.md' : 'voice.md'), 0)
    }

    // Spec deviation 5: the decade rule. The first safe id for a speaker
    // addition is the next multiple of ten above the house's highest id of
    // the same prefix; below that, the next house rule silently turns the
    // addition into an override.
    const houseMax = {}
    for (const rule of kb.house?.rules ?? []) {
      const m = /^([LMCAX])(\d+)$/.exec(rule.id)
      if (m) houseMax[m[1]] = Math.max(houseMax[m[1]] ?? 0, Number(m[2]))
    }
    for (const rule of rules) {
      if (rule.origin !== 'speaker' || rule.overrides) continue
      const m = /^([LMCAX])(\d+)$/.exec(rule.id)
      if (!m || houseMax[m[1]] === undefined) continue
      const safe = (Math.floor(houseMax[m[1]] / 10) + 1) * 10
      if (Number(m[2]) < safe) {
        addFile('warning', 'W_ID_RANGE_COLLISION_RISK',
          `rule ${rule.id} is a speaker addition inside the house's ${m[1]} range (house tops out at ` +
          `${m[1]}${String(houseMax[m[1]]).padStart(2, '0')}); renumber from ${m[1]}${safe} so a future house rule cannot silently override it`,
          rule.path ?? `${rule.file}.md`, rule.line)
      }
    }

    for (const rule of kb.overrides ?? []) {
      if ((rule.evidence ?? []).length === 0) {
        addFile('warning', 'W_OVERRIDE_UNEVIDENCED',
          `rule ${rule.id} overrides a house rule but cites no evidence; replacing a house rule is a claim that needs one`,
          rule.path ?? `${rule.file}.md`, rule.line)
      }
    }
  }
```

4. Add `validateAll` and switch `main` to it:

```js
/**
 * The house, then every declared speaker, each resolved. Findings are
 * concatenated in that order; counts are the house's plus each speaker's own
 * (a house rule inherited by three speakers is counted once per report it
 * appears in, which is what each profile line says).
 */
export function validateAll (kbRoot) {
  const house = resolveKb(kbRoot, 'default')
  const reports = [{ profile: 'default', ...validateKb(house) }]
  for (const { slug } of speakerProfiles(house.config)) {
    reports.push({ profile: slug, ...validateKb(resolveKb(kbRoot, slug)) })
  }
  return {
    errors: reports.reduce((n, r) => n + r.errors, 0),
    warnings: reports.reduce((n, r) => n + r.warnings, 0),
    findings: reports.flatMap((r) => r.findings),
    counts: reports[0].counts,
    profiles: reports.map((r) => ({ profile: r.profile, errors: r.errors, warnings: r.warnings, counts: r.counts }))
  }
}
```

In `main`, replace `const report = validateKb(loadKb(kbRoot))` with `const report = validateAll(kbRoot)`, and after the existing `validate: N rules, ...` line add, only when `report.profiles.length > 1`:

```js
    for (const p of report.profiles.slice(1)) {
      lines.push(
        `validate: speaker ${p.profile}: ${p.counts.rules} rules, ${p.counts.cells} authored cells, ` +
        `${count(p.errors, 'error')}, ${count(p.warnings, 'warning')}`
      )
    }
```

Place the `count` helper above its first use. Keep the existing summary line and the final `N errors, N warnings` line exactly as they are so a no-speaker run is byte-identical.

- [ ] **Step 5: Run the tests, then the suite, then commit**

Run: `node --test test/validate.test.mjs && npm test`
Expected: PASS. If `test/templates.test.mjs` or `test/kb.test.mjs` break on `add()` now accepting a `.md` name, fix the call sites, not the tests.

```bash
git add scripts/validate.mjs test/validate.test.mjs test/fixtures
git commit -m "feat(validate): locks, overlay mismatches, speaker checks; validateAll over every profile"
```

---

## Task 6: Compile a speaker card

**Files:**
- Modify: `scripts/compile-context.mjs`
- Test: `test/compile-context.test.mjs`

**Interfaces:**
- Consumes: `resolveKb`, `defaultDialsOf`, `artifactRoot`.
- Produces: `compileContext(kb, opts)` reads `kb.rules` (not the raw table text), renders the speaker header, `## House guardrails (locked)`, `(overrides house)` marks, and overlay paths; `main --profile <slug>` writes `profiles/<slug>/CONTEXT.md`.

- [ ] **Step 1: Write the failing tests**

Append to `test/compile-context.test.mjs` (add `resolveKb` to the `kb.mjs` import, `cpSync` is already imported, add `fileURLToPath` if missing and define `FIXTURE` as in Task 5):

```js
test('the house card compiled from a resolved kb is byte-identical to one compiled from loadKb', () => {
  const dir = makeTmpProject(files)
  try {
    const opts = { corpusStrings: ['We leverage it.', 'one  two'], generated: '2026-08-26T00:00:00.000Z' }
    assert.equal(compileContext(resolveKb(path.join(dir, 'kb')), opts), compileContext(loadKb(path.join(dir, 'kb')), opts))
  } finally {
    cleanup(dir)
  }
})

test('a speaker card carries the speaker header, the guardrails, the override mark, and overlay paths', () => {
  const dir = makeTmpProject({})
  try {
    cpSync(FIXTURE, path.join(dir, 'kb'), { recursive: true })
    const kb = resolveKb(path.join(dir, 'kb'), 'maya')
    const md = compileContext(kb, { corpusStrings: ['We leverage it.'], generated: '2026-09-10T00:00:00.000Z', profileName: 'maya' })
    assert.match(md, /\*\*Brand:\*\* Acme · \*\*Speaker:\*\* Maya Lind \(maya\)/)
    assert.match(md, /- \*\*Builder\*\* \(`confirmed`\)/)
    assert.ok(!md.includes('**Plainspoken**'), 'the house\'s unlocked V1 is not on the speaker card')
    assert.match(md, /## House guardrails \(locked\)/)
    assert.match(md, /- \*\*No pressure\*\* .*Rules out: countdowns, scarcity framing/)
    assert.match(md, /L20/, 'a locked lexicon row is listed among the guardrails')
    assert.match(md, /\| `leverage` \| `lean on` \| confirmed \|/)
    assert.match(md, /Overrides: L01/)
    assert.match(md, /warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 3/, 'default dials are the speaker\'s')
    assert.match(md, /\| The house card \| `\.\.\/\.\.\/CONTEXT\.md` \|/)
    assert.match(md, /`profiles\/maya\/tone\.md`/)
  } finally {
    cleanup(dir)
  }
})

test('main --profile writes the speaker card under the overlay', () => {
  const dir = makeTmpProject({})
  try {
    cpSync(FIXTURE, path.join(dir, '.voice-and-tone'), { recursive: true })
    execFileSync(process.execPath, [
      path.join(root, 'scripts', 'compile-context.mjs'), '--root', dir, '--profile', 'maya', '--now', '2026-09-10T00:00:00.000Z'
    ])
    assert.ok(existsSync(path.join(dir, '.voice-and-tone', 'profiles', 'maya', 'CONTEXT.md')))
    assert.ok(!existsSync(path.join(dir, '.voice-and-tone', 'CONTEXT.md')))
  } finally {
    cleanup(dir)
  }
})
```

Add `import { execFileSync } from 'node:child_process'`, `import { existsSync } from 'node:fs'` and `const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')` at the top if not present.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/compile-context.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `scripts/compile-context.mjs`:

1. Imports: replace `loadKb, parseDials, parseTableRules` in the `kb.mjs` import with `resolveKb, defaultDialsOf`; import `artifactRoot` from `./lib/config.mjs`. Delete the local `defaultDials` function and use `defaultDialsOf(kb.tone) ?? NEUTRAL_DIALS` merged as before: `{ ...NEUTRAL_DIALS, ...(defaultDialsOf(toneMd) ?? {}) }` when a line exists, else `NEUTRAL_DIALS`. Keep `NEUTRAL_DIALS` exactly as it is.

2. Read rules from the resolved object:

```js
  const rulesIn = (file) => kb.rules.filter((r) => r.file === file && r.kind === 'table' && notDisputed(r))
  const voiceRules = kb.rules.filter((r) => r.file === 'voice' && r.id.startsWith('V') && notDisputed(r))
  const lexicon = rulesIn('lexicon')
  const mechanics = rulesIn('mechanics')
```

`loadKb` pushes prose rules then table rules per file in `parseTableRules` order, so the house card's ranking input is the same list it was.

3. Header: when `kb.role === 'speaker'`:

```js
  const who = kb.role === 'speaker'
    ? `**Brand:** ${profile.name} · **Speaker:** ${kb.speaker.name} (${kb.speaker.slug}) · `
    : `**Brand:** ${profile.name} · **Profile:** ${profileName} · `
```

where `profile` is `activeProfile(kb.config, 'default')` for the brand name in the speaker case. Keep the rest of the line unchanged.

4. Voice section: unchanged for the house. For a speaker, list only `voiceRules.filter((r) => r.origin === 'speaker')` in the existing shape, then:

```js
  if (kb.role === 'speaker') {
    const locked = kb.rules.filter((r) => r.locked)
    lines.push('## House guardrails (locked)')
    lines.push('')
    if (locked.length === 0) lines.push('_None declared - see `locks:` in config.yml._')
    for (const rule of locked) {
      if (rule.kind === 'prose') {
        lines.push(`- **${rule.name ?? rule.id}** (\`${rule.confidence}\`) - Rules out: ${rule.fields['Rules out'] ?? rule.fields.Means ?? '(unspecified)'}`)
      } else {
        const avoid = rule.cells.Avoid ?? rule.cells.Rule ?? Object.values(rule.cells)[0] ?? ''
        lines.push(`- **${rule.id}** (\`${rule.confidence}\`) - ${avoid}${rule.cells.Prefer ? ` -> ${rule.cells.Prefer}` : ''}`)
      }
    }
    lines.push('')
  }
```

5. After the lexicon table and after the mechanics list, for a speaker only, when any override exists in that file:

```js
  const overriddenIn = (file) => (kb.overrides ?? []).filter((r) => r.file === file).map((r) => r.id)
  // after the lexicon table:
  if (kb.role === 'speaker' && overriddenIn('lexicon').length) lines.push(`Overrides: ${overriddenIn('lexicon').join(', ')} (house rule replaced)`, '')
  // after the mechanics list, same for 'mechanics'
```

6. "Where to look next" for a speaker: prefix `tone.md`, `channels/`, `locales/`, `audience.md` with `profiles/<slug>/` where the overlay defines them (house files otherwise), keep `evidence/ledger.md`, and add `| The house card | \`../../CONTEXT.md\` |` as the last row. Add `| The house voice | \`../../voice.md\` |` too, since persona and self-reference sections are merged by the skill (deviation 4).

7. `main`: `const kb = resolveKb(kbRoot, profileName)`; `const config = kb.config`; default `out` becomes `path.join(artifactRoot(kbRoot, profileName, config), 'CONTEXT.md')`.

- [ ] **Step 4: Run the tests, then the suite, then commit**

Run: `node --test test/compile-context.test.mjs && npm test`
Expected: PASS, including the templates test that compiles the shipped template.

```bash
git add scripts/compile-context.mjs test/compile-context.test.mjs
git commit -m "feat(compile-context): speaker card with guardrails and override marks; house card unchanged"
```

---

## Task 7: State object - role, locks, speakers

**Files:**
- Modify: `scripts/lib/state.mjs`
- Test: `test/state.test.mjs`

**Interfaces:**
- Consumes: `resolveKb`, `speakerProfiles`, `isSpeaker`, `artifactRoot`, `overlayRoot`, `entriesForProfile`.
- Produces on the state object: `kb.role`, `kb.speaker` (`{ slug, name } | null`), `locks: { declared: string[], violated: string[] }`, `rules.byOrigin: { house, speaker, overrides, locked }`, `speakers: SpeakerSummary[]`, where

```
SpeakerSummary = { slug, name, voiceRules, hasDefaultDials, authoredCells, overrides, lockViolations,
                   corpusWords, fingerprintAgeDays, driftBaseline: boolean, driftFlagged,
                   draftsPending, sourcesNeverIngested, cardStale: string[] | null }
```

In the house view `speakers` lists every declared speaker; in a speaker view it lists only that speaker. Per-profile artifact paths are used for manifest, fingerprint and card.

- [ ] **Step 1: Write the failing tests**

Append to `test/state.test.mjs` (add `cpSync` to the `node:fs` import; define `FIXTURE` as in Task 5):

```js
function fixtureState (profileName) {
  const dir = makeTmpProject({})
  cpSync(FIXTURE, path.join(dir, '.voice-and-tone'), { recursive: true })
  const kbRoot = path.join(dir, '.voice-and-tone')
  try {
    return collect({ projectRoot: dir, kbRoot, config: loadConfig(kbRoot), profileName, now: NOW })
  } finally {
    cleanup(dir)
  }
}

test('a knowledge base with no speakers reports role house, no locks, no speakers, and every old key intact', () => {
  const state = stateOf({ 'content/a.md': '# Hello\n', '.voice-and-tone/config.yml': MINIMAL_CONFIG, '.voice-and-tone/voice.md': '# V\n', '.voice-and-tone/tone.md': '# T\n' })
  assert.equal(state.kb.role, 'house')
  assert.equal(state.kb.speaker, null)
  assert.deepEqual(state.locks, { declared: [], violated: [] })
  assert.deepEqual(state.speakers, [])
  assert.deepEqual(state.rules.byOrigin, { house: 0, speaker: 0, overrides: 0, locked: 0 })
  assert.equal(state.kb.profile, 'default')
})

test('the house view lists every speaker with its summary numbers', () => {
  const state = fixtureState('default')
  assert.equal(state.kb.role, 'house')
  assert.deepEqual(state.locks.declared, ['V2', 'L20'])
  assert.deepEqual(state.speakers.map((s) => s.slug), ['jonas', 'maya'])
  const maya = state.speakers.find((s) => s.slug === 'maya')
  assert.equal(maya.name, 'Maya Lind')
  assert.equal(maya.voiceRules, 1)
  assert.equal(maya.hasDefaultDials, true)
  assert.equal(maya.authoredCells, 1)
  assert.equal(maya.overrides, 1)
  assert.equal(maya.lockViolations, 0)
  assert.equal(maya.driftBaseline, false, 'no fingerprint under the overlay yet')
  assert.equal(maya.cardStale, null, 'no card compiled yet')
  const jonas = state.speakers.find((s) => s.slug === 'jonas')
  assert.equal(jonas.voiceRules, 0)
  assert.equal(jonas.hasDefaultDials, false)
  assert.equal(jonas.lockViolations, 1)
  assert.equal(state.integrity.errors, 0, 'the house view validates the house alone')
})

test('a speaker view resolves that speaker: rules by origin, cells, locks violated, one speaker in the list', () => {
  const state = fixtureState('jonas')
  assert.equal(state.kb.role, 'speaker')
  assert.deepEqual(state.kb.speaker, { slug: 'jonas', name: 'Jonas Berg' })
  assert.deepEqual(state.locks.violated, ['L20'])
  assert.ok(state.integrity.errors >= 1)
  assert.equal(state.rules.byOrigin.speaker, 1, 'L02 only; the L20 row was refused')
  assert.equal(state.rules.byOrigin.locked, 2)
  assert.deepEqual(state.speakers.map((s) => s.slug), ['jonas'])
  const maya = fixtureState('maya')
  assert.equal(maya.coverage.authored, 1)
  assert.equal(maya.rules.byOrigin.overrides, 1)
})

test('drafts are counted for the profile they belong to', () => {
  const state = stateOf({
    '.voice-and-tone/config.yml': MINIMAL_CONFIG.replace('profiles:\n', 'profiles:\n  maya:\n    name: "Maya Lind"\n'),
    '.voice-and-tone/voice.md': '# V\n',
    '.voice-and-tone/tone.md': '# T\n',
    '.voice-and-tone/profiles/maya/voice.md': '# V\n',
    '.voice-and-tone/.drafts/a.md': '---\nprofile: default\n---\nx\n',
    '.voice-and-tone/.drafts/b.md': '---\nprofile: maya\n---\ny\n',
    '.voice-and-tone/.drafts/c.md': 'no frontmatter at all\n'
  })
  assert.equal(state.evidence.drafts, 2, 'default plus the unlabelled one')
  assert.equal(state.speakers[0].draftsPending, 1)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/state.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `scripts/lib/state.mjs`:

1. Imports: add `resolveKb`, `defaultDialsOf` to the `kb.mjs` import; add `speakerProfiles, isSpeaker, artifactRoot, overlayRoot` to the `config.mjs` import; import `entriesForProfile` from `./register.mjs`.

2. Replace `countDrafts(kbRoot)` with a profile-aware version:

```js
/**
 * Drafts belong to the profile their frontmatter names. A draft with no
 * frontmatter, or no `profile:` line, is the house's - every draft written
 * before speakers existed looks like that, so the house count is unchanged.
 */
function countDrafts (kbRoot, profileName = 'default') {
  const dir = path.join(kbRoot, '.drafts')
  if (!existsSync(dir)) return 0
  try {
    let n = 0
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const head = readTextFile(path.join(dir, entry.name)).slice(0, 2000)
      const match = /^---\n[\s\S]*?^profile:\s*(\S+)\s*$[\s\S]*?^---/m.exec(head)
      const owner = match ? match[1] : 'default'
      if (owner === profileName) n += 1
    }
    return n
  } catch {
    return 0
  }
}
```

3. `cardFreshness(kbRoot, now, { cardRoot = kbRoot, extraSourceRoots = [] } = {})`: the card is `path.join(cardRoot, 'CONTEXT.md')`; sources are `CARD_SOURCES` under `cardRoot` and under each of `extraSourceRoots`, named with a `profiles/<slug>/` prefix when they come from the overlay. For a speaker: `cardRoot = overlay`, `extraSourceRoots = [kbRoot]`. Keep the default call byte-identical.

4. Add `summariseSpeaker`:

```js
function summariseSpeaker ({ kbRoot, projectRoot, config, slug, now }) {
  const kb = resolveKb(kbRoot, slug)
  const root = overlayRoot(kbRoot, slug)
  const fingerprint = readJson(path.join(root, 'evidence', 'fingerprint.json'))
  const manifest = readJson(path.join(root, 'evidence', 'manifest.json'))
  const drift = driftOf(fingerprint, config.thresholds?.drift_pct ?? 25)
  const flagged = Object.values(drift.byLocale).some((l) => l.metrics.some((m) => m.flagged))
  const card = cardFreshness(kbRoot, now, { cardRoot: root, extraSourceRoots: [kbRoot] })
  return {
    slug,
    name: kb.speaker?.name ?? slug,
    voiceRules: kb.rules.filter((r) => r.origin === 'speaker' && r.id.startsWith('V')).length,
    hasDefaultDials: defaultDialsOf(kb.overlay?.tone ?? '') !== null,
    authoredCells: kb.cells.length,
    overrides: kb.overrides.length,
    lockViolations: kb.lockViolations.length,
    corpusWords: manifest?.totals?.words ?? 0,
    fingerprintAgeDays: fingerprint ? ageDays(Date.parse(fingerprint.generated), now) : null,
    driftBaseline: Boolean(fingerprint?.baseline),
    driftFlagged: flagged,
    draftsPending: countDrafts(kbRoot, slug),
    sourcesNeverIngested: manifest?.unindexed?.count ?? 0,
    cardStale: card ? card.staleAgainst : null
  }
}
```

5. In `collect`: replace `const kb = loadKb(kbRoot)` with `const kb = resolveKb(kbRoot, profileName)`; compute `const root = artifactRoot(kbRoot, profileName, config)` and read `manifest`, `fingerprint` from `root`; `cardExists` and `cardTokens` from `path.join(root, 'CONTEXT.md')`; `freshness.card` via the new options when `kb.role === 'speaker'`; `register` as `entriesForProfile(loadRegister(config), profileName, config)`; `index` filtered like Task 3 (`sourcesOf` receives the filtered index); drafts via `countDrafts(kbRoot, profileName)`. Add to the state:

```js
    kb: { ...existing fields..., role: kb.role, speaker: kb.speaker },
    locks: { declared: kb.locks, violated: kb.lockViolations.map((v) => v.id) },
    rules: {
      ...existing...,
      byOrigin: {
        house: kb.rules.filter((r) => r.origin === 'house').length,
        speaker: kb.rules.filter((r) => r.origin === 'speaker').length,
        overrides: kb.overrides.length,
        locked: kb.rules.filter((r) => r.locked).length
      }
    },
    speakers: !exists
      ? []
      : kb.role === 'speaker'
        ? [summariseSpeaker({ kbRoot, projectRoot, config, slug: profileName, now })]
        : speakerProfiles(config).map(({ slug }) => summariseSpeaker({ kbRoot, projectRoot, config, slug, now })),
```

`validation` stays `validateKb(kb)` over the resolved object, so a speaker view carries that speaker's findings and the house view the house's.

- [ ] **Step 4: Run the tests, then the suite, then commit**

Run: `node --test test/state.test.mjs && npm test`
Expected: PASS.

```bash
git add scripts/lib/state.mjs test/state.test.mjs
git commit -m "feat(state): role, locks, byOrigin, and a speakers block on the state object"
```

---

## Task 8: Gap detectors G17 to G21

**Files:**
- Modify: `scripts/lib/gaps.mjs`
- Test: `test/gaps.test.mjs`

**Interfaces:**
- Consumes: `state.speakers`, `state.locks`, `state.kb.role` from Task 7.
- Produces: detectors `G17`..`G21`; in the house view each speaker gap's `what` is prefixed `[slug] `.

- [ ] **Step 1: Write the failing tests**

Append to `test/gaps.test.mjs` (extend `healthyState()` with `kb.role: 'house'`, `kb.speaker: null`, `locks: { declared: [], violated: [] }`, `speakers: []`, and `rules.byOrigin: { house: 4, speaker: 0, overrides: 0, locked: 0 }` so existing tests keep passing):

```js
function speaker (overrides = {}) {
  return {
    slug: 'maya', name: 'Maya Lind', voiceRules: 3, hasDefaultDials: true, authoredCells: 2, overrides: 0,
    lockViolations: 0, corpusWords: 900, fingerprintAgeDays: 1, driftBaseline: true, driftFlagged: false,
    draftsPending: 0, sourcesNeverIngested: 0, cardStale: [],
    ...overrides
  }
}

test('a healthy house with one healthy speaker and a lock reports nothing', () => {
  const state = healthyState({ speakers: [speaker()], locks: { declared: ['V2'], violated: [] } })
  assert.deepEqual(detectGaps(state), [])
})

test('G17 fires when a speaker has no voice rule or no dials line, prefixed with the slug in the house view', () => {
  const state = healthyState({ speakers: [speaker({ voiceRules: 0 })], locks: { declared: ['V2'], violated: [] } })
  const gap = detectGaps(state).find((g) => g.id === 'G17')
  assert.ok(gap)
  assert.equal(gap.severity, 'blocker')
  assert.match(gap.what, /^\[maya\] /)
  assert.match(gap.fix, /speaker add maya/)
  const dials = healthyState({ speakers: [speaker({ hasDefaultDials: false })], locks: { declared: ['V2'], violated: [] } })
  assert.ok(detectGaps(dials).some((g) => g.id === 'G17'))
})

test('G17 carries no prefix in a speaker view', () => {
  const state = healthyState({
    kb: { ...healthyState().kb, role: 'speaker', speaker: { slug: 'maya', name: 'Maya Lind' } },
    speakers: [speaker({ voiceRules: 0 })], locks: { declared: ['V2'], violated: [] }
  })
  const gap = detectGaps(state).find((g) => g.id === 'G17')
  assert.ok(!gap.what.startsWith('['))
})

test('G18, G19, G20 fire on a speaker without a baseline, with never-ingested sources, with a stale card', () => {
  const state = healthyState({
    speakers: [speaker({ driftBaseline: false, sourcesNeverIngested: 2, cardStale: ['voice.md'] })],
    locks: { declared: ['V2'], violated: [] }
  })
  const ids = detectGaps(state).map((g) => g.id)
  for (const id of ['G18', 'G19', 'G20']) assert.ok(ids.includes(id), id)
  assert.match(detectGaps(state).find((g) => g.id === 'G18').fix, /--set-baseline --profile maya/)
  assert.match(detectGaps(state).find((g) => g.id === 'G19').fix, /connect --ingest --profile maya/)
  assert.match(detectGaps(state).find((g) => g.id === 'G20').fix, /sync --profile maya/)
})

test('G21 fires once, at house level, when speakers exist and no lock is declared', () => {
  const state = healthyState({ speakers: [speaker(), speaker({ slug: 'jonas', name: 'Jonas Berg' })] })
  const gaps = detectGaps(state).filter((g) => g.id === 'G21')
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].severity, 'warning')
  assert.ok(!detectGaps(healthyState()).some((g) => g.id === 'G21'), 'no speakers, no G21')
  const speakerView = healthyState({
    kb: { ...healthyState().kb, role: 'speaker', speaker: { slug: 'maya', name: 'Maya Lind' } },
    speakers: [speaker()]
  })
  assert.ok(!detectGaps(speakerView).some((g) => g.id === 'G21'), 'G21 is a house-level judgement')
})

test('deliberately not a gap: a speaker with every cell computed, with zero overrides, with a cardStale of null', () => {
  const state = healthyState({ speakers: [speaker({ authoredCells: 0, overrides: 0, cardStale: null })], locks: { declared: ['V2'], violated: [] } })
  assert.deepEqual(detectGaps(state).map((g) => g.id), [])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/gaps.test.mjs`
Expected: FAIL, no `G17`.

- [ ] **Step 3: Implement**

Append to `DETECTORS` in `scripts/lib/gaps.mjs`:

```js
  // --- speakers (spec §9.3) ------------------------------------------------
  // Each of G17-G20 iterates state.speakers: every declared speaker in the
  // house view, only the current one in a speaker view. The slug prefix is
  // added only in the house view, where a gap has to say whose it is.
  {
    id: 'G17',
    severity: 'blocker',
    leverage: 4,
    detect: (state) => perSpeaker(state, (s) => (s.voiceRules === 0 || !s.hasDefaultDials)
      ? {
          what: `speaker ${s.slug} has ${s.voiceRules === 0 ? 'no voice characteristic' : 'no default dials line'}`,
          why: 'until it states a voice, it is the house in a costume',
          fix: `/voice-and-tone:speaker add ${s.slug}`
        }
      : null)
  },
  {
    id: 'G18',
    severity: 'blocker',
    leverage: 3,
    detect: (state) => perSpeaker(state, (s) => !s.driftBaseline
      ? {
          what: `speaker ${s.slug} has no drift baseline`,
          why: 'drift can never be measured for this speaker',
          fix: `node scripts/fingerprint.mjs --set-baseline --profile ${s.slug}`
        }
      : null)
  },
  {
    id: 'G19',
    severity: 'blocker',
    leverage: 3,
    detect: (state) => perSpeaker(state, (s) => s.sourcesNeverIngested > 0
      ? {
          what: `speaker ${s.slug}: ${s.sourcesNeverIngested} registered source(s) never ingested`,
          why: 'their words are in no fingerprint and behind no rule',
          fix: `/voice-and-tone:connect --ingest --profile ${s.slug}`
        }
      : null)
  },
  {
    id: 'G20',
    severity: 'warning',
    leverage: 3,
    detect: (state) => perSpeaker(state, (s) => s.cardStale?.length
      ? {
          what: `speaker ${s.slug}: card is behind ${s.cardStale.join(', ')}`,
          why: 'the speaker card no longer matches the files it compiles from',
          fix: `/voice-and-tone:sync --profile ${s.slug}`
        }
      : null)
  },
  {
    id: 'G21',
    severity: 'warning',
    leverage: 3,
    detect: (state) => state.kb.role === 'house' && (state.speakers ?? []).length > 0 && (state.locks?.declared ?? []).length === 0
      ? {
          what: `${state.speakers.length} speaker(s) declared and no locks`,
          why: 'every house guardrail is overridable by every speaker, which is rarely what the brand team believes',
          fix: 'add locks: [...] to config.yml, then /voice-and-tone:sync'
        }
      : null
  }
```

and above `DETECTORS`:

```js
/**
 * Run a per-speaker predicate over state.speakers and return one gap per hit,
 * or null. detectGaps() already accepts an array from a detector (see
 * below); the slug prefix is the house view's way of saying whose gap it is.
 */
function perSpeaker (state, predicate) {
  const hits = []
  for (const s of state.speakers ?? []) {
    const gap = predicate(s)
    if (!gap) continue
    hits.push(state.kb?.role === 'house' ? { ...gap, what: `[${s.slug}] ${gap.what}` } : gap)
  }
  return hits.length ? hits : null
}
```

Then, in `detectGaps`, where each detector's result is pushed, accept an array: if `Array.isArray(result)` push one gap per element (each carrying the detector's `id`, `severity`, `leverage`); otherwise push as today. Read the existing `detectGaps` body first; the change is one `Array.isArray` branch at the push site, nothing else.

Also record in the header comment the three new deliberate non-gaps: a speaker with every cell computed, a speaker with zero overrides, a speaker whose card has never been compiled (`cardStale: null`).

- [ ] **Step 4: Run the tests, then the suite, then commit**

Run: `node --test test/gaps.test.mjs && npm test`
Expected: PASS.

```bash
git add scripts/lib/gaps.mjs test/gaps.test.mjs
git commit -m "feat(gaps): G17-G21 speaker detectors with a house-view slug prefix"
```

---

## Task 9: ASCII renderer - speakers panel and speaker view

**Files:**
- Modify: `scripts/lib/render.mjs`
- Test: `test/render.test.mjs`

**Interfaces:**
- Consumes: `state.kb.role`, `state.kb.speaker`, `state.locks`, `state.speakers`, `state.rules.byOrigin`.
- Produces: `PANELS` gains `'speakers'` before `'all'`; `render(state, { panel: 'speakers' })`; header, rules, settings, missing and menu changes gated on speakers or locks existing.

- [ ] **Step 1: Write the failing tests**

Append to `test/render.test.mjs` (it has a `fullState()` or similar fixture builder; extend it with `kb.role: 'house'`, `kb.speaker: null`, `locks: { declared: [], violated: [] }`, `speakers: []`, `rules.byOrigin: {...}`; if it has none, build one from the shape in `test/html.test.mjs`'s `STATE`):

```js
const SPEAKERS = [
  { slug: 'maya', name: 'Maya Lind', voiceRules: 6, hasDefaultDials: true, authoredCells: 3, overrides: 2, lockViolations: 0, corpusWords: 900, fingerprintAgeDays: 1, driftBaseline: true, driftFlagged: false, draftsPending: 1, sourcesNeverIngested: 0, cardStale: [] },
  { slug: 'jonas', name: 'Jonas Berg', voiceRules: 6, hasDefaultDials: true, authoredCells: 1, overrides: 0, lockViolations: 0, corpusWords: 0, fingerprintAgeDays: null, driftBaseline: false, driftFlagged: false, draftsPending: 0, sourcesNeverIngested: 0, cardStale: null },
  { slug: 'helpdesk', name: 'Acme Support', voiceRules: 5, hasDefaultDials: true, authoredCells: 0, overrides: 1, lockViolations: 1, corpusWords: 1200, fingerprintAgeDays: 3, driftBaseline: true, driftFlagged: true, draftsPending: 0, sourcesNeverIngested: 0, cardStale: [] }
]

test('a state with no speakers and no locks renders exactly as before: no speakers panel, no locks line, old menu', () => {
  const out = render(fullState())
  assert.ok(!out.includes('SPEAKERS'))
  assert.ok(!out.includes('locks'))
  assert.ok(out.includes('6 settings  7 missing  8 all'))
})

test('the speakers panel lists one row per speaker with the spec columns', () => {
  const out = render({ ...fullState(), speakers: SPEAKERS, locks: { declared: ['V2'], violated: [] } }, { panel: 'speakers' })
  assert.match(out, /SPEAKERS  3 declared/)
  assert.match(out, /slug\s+name\s+voice\s+cells\s+over\s+lock\s+drift\s+drafts/)
  assert.match(out, /maya\s+Maya Lind\s+6\s+3\s+2\s+-\s+ok\s+1/)
  assert.match(out, /jonas\s+Jonas Berg\s+6\s+1\s+0\s+-\s+n\/a\s+0/)
  assert.match(out, /helpdesk\s+Acme Support\s+5\s+0\s+1\s+1!\s+FLAG\s+0/)
})

test('in the house view with speakers, the menu offers the speakers panel and settings lists the locks', () => {
  const out = render({ ...fullState(), speakers: SPEAKERS, locks: { declared: ['V2', 'L20'], violated: [] } })
  assert.ok(out.includes('SPEAKERS'))
  assert.match(out, /9 speakers/)
  assert.match(out, /locks\s+V2, L20/)
})

test('a speaker view names the speaker in the header and settings and splits rules by origin', () => {
  const state = {
    ...fullState(),
    kb: { ...fullState().kb, role: 'speaker', speaker: { slug: 'maya', name: 'Maya Lind' }, profile: 'maya' },
    speakers: [SPEAKERS[0]],
    locks: { declared: ['V2'], violated: [] },
    rules: { ...fullState().rules, byOrigin: { house: 31, speaker: 12, overrides: 2, locked: 6 } }
  }
  const out = render(state)
  assert.match(out, /\| maya \(speaker\) \|/)
  assert.match(out, /origin: house 31 \* speaker 12 \* overrides 2 \* locked 6/)
  assert.match(out, /profile\s+maya\s+"Maya Lind"\s+speaker of /)
  assert.ok(!out.includes('SPEAKERS'), 'the speakers panel is house view only')
  assert.match(out, /speaker offset applied/)
})

test('PANELS gains speakers and keeps all last', () => {
  assert.equal(PANELS[PANELS.length - 1], 'all')
  assert.ok(PANELS.includes('speakers'))
})
```

The middle dot in `origin:` lines renders as `*` because `toAscii` maps `·` to `*`; write the source line with `·` and assert on `*`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/render.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `scripts/lib/render.mjs`:

1. `PANELS`: insert `'speakers'` before `'all'`.
2. `header`: when `state.kb.role === 'speaker'`, the middle segment is `${state.kb.speaker.slug} (speaker)` instead of `state.kb.profile`.
3. New `speakersPanel(state, width)`:

```js
function speakersPanel (state, width) {
  const speakers = state.speakers ?? []
  if (state.kb.role !== 'house' || speakers.length === 0) return panel('SPEAKERS  none declared', [], width)
  const cols = [['slug', 11], ['name', 19], ['voice', 7], ['cells', 7], ['over', 6], ['lock', 6], ['drift', 7], ['drafts', 6]]
  const line = (cells) => INDENT + cols.map(([, w], i) => pad(String(cells[i]), w)).join('').trimEnd()
  const lines = [line(cols.map(([name]) => name))]
  for (const s of speakers) {
    const drift = !s.driftBaseline ? 'n/a' : s.driftFlagged ? 'FLAG' : 'ok'
    lines.push(line([s.slug, truncate(s.name, 18), s.voiceRules, s.authoredCells, s.overrides,
      s.lockViolations ? `${s.lockViolations}!` : '-', drift, s.draftsPending]))
  }
  lines.push('')
  lines.push(`${INDENT}each speaker inherits the house and replaces its voice`)
  lines.push(`${INDENT}! lock violation (also in integrity)   n/a no baseline`)
  return panel(`SPEAKERS  ${speakers.length} declared`, lines, width)
}
```

4. `rulesPanel`: when `state.kb.role === 'speaker'`, append `${INDENT}origin: house ${o.house} · speaker ${o.speaker} · overrides ${o.overrides} · locked ${o.locked}` where `o = state.rules.byOrigin`.
5. `coveragePanel`: when `state.kb.role === 'speaker'`, add the line `${INDENT}speaker offset applied to every computed cell` after the legend.
6. `settingsPanel`: the `profile` line becomes `${state.kb.profile}  "${state.kb.speaker.name}"  speaker of ${state.kb.brand ?? ''}` in a speaker view; add `${INDENT}${pad('locks', 15)}${declared.join(', ') || 'none'}` only when `state.kb.role === 'speaker' || (state.speakers ?? []).length > 0 || declared.length > 0`.
7. `menu`: when `showSpeakers` (house view with at least one speaker) the second row reads `' 6 settings  7 missing  8 all  9 speakers'`; otherwise unchanged. Thread a flag from `render` into `menu`.
8. `PANEL_FN.speakers = speakersPanel`; in `render`'s `all` composition insert the speakers panel after `pipeline` only when `showSpeakers`.

- [ ] **Step 4: Run the tests, then the suite, then commit**

Run: `node --test test/render.test.mjs && npm test`
Expected: PASS, including the existing golden output tests (nothing moved for a state without speakers).

```bash
git add scripts/lib/render.mjs test/render.test.mjs
git commit -m "feat(render): speakers panel, speaker view header and origin split"
```

---

## Task 10: HTML renderer - speakers section and speaker view

**Files:**
- Modify: `scripts/lib/html.mjs`
- Test: `test/html.test.mjs`

**Interfaces:**
- Consumes: the same state blocks as Task 9.
- Produces: hero chip `speakers N` and eyebrow `speaking as <name>`; `section('speakers', ...)` after Pipeline in the house view when speakers exist; an origin table under Rules by confidence in a speaker view; locks in Settings; `[slug]` prefix already comes from `gaps`.

- [ ] **Step 1: Write the failing tests**

Append to `test/html.test.mjs` (reuse `STATE`; extend it with `kb.role: 'house'`, `kb.speaker: null`, `locks: { declared: [], violated: [] }`, `speakers: []`, `rules.byOrigin`):

```js
test('with no speakers and no locks the page has no Speakers section, no chip, no locks note', () => {
  const html = renderHtml(STATE)
  assert.ok(!html.includes('id="speakers"'))
  assert.ok(!html.includes('speakers <b>'))
  assert.ok(!html.includes('Locks:'))
})

test('the house view with speakers renders the Speakers section, one row each, and the chip', () => {
  const html = renderHtml({ ...STATE, speakers: SPEAKERS, locks: { declared: ['V2'], violated: [] } })
  assert.ok(html.includes('id="speakers"'))
  assert.match(html, /speakers <b>3<\/b>/)
  assert.match(html, /<th scope="row">maya<\/th>/)
  assert.match(html, /Maya Lind/)
  assert.match(html, /class="pill pill--warn"[^>]*>FLAG</)
  assert.match(html, /n\/a/)
  assert.match(html, /Locks: <code>V2<\/code>/)
})

test('a speaker view says who is speaking and splits rules by origin', () => {
  const html = renderHtml({
    ...STATE,
    kb: { ...STATE.kb, role: 'speaker', speaker: { slug: 'maya', name: 'Maya Lind' }, profile: 'maya' },
    speakers: [SPEAKERS[0]],
    locks: { declared: ['V2'], violated: [] },
    rules: { ...STATE.rules, byOrigin: { house: 31, speaker: 12, overrides: 2, locked: 6 } }
  })
  assert.match(html, /speaking as Maya Lind/)
  assert.ok(!html.includes('id="speakers"'), 'house view only')
  assert.match(html, /<th scope="row">house<\/th><td class="n">31<\/td>/)
  assert.match(html, /<th scope="row">overrides<\/th><td class="n">2<\/td>/)
})

test('every speaker name is escaped', () => {
  const html = renderHtml({ ...STATE, speakers: [{ ...SPEAKERS[0], name: 'A <b>bold</b> & co' }] })
  assert.ok(html.includes('A &lt;b&gt;bold&lt;/b&gt; &amp; co'))
  assert.ok(!html.includes('A <b>bold</b>'))
})
```

Copy the `SPEAKERS` constant from Task 9 into this file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/html.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `scripts/lib/html.mjs`:

1. `hero`: eyebrow becomes `speaking as ${escapeHtml(kb.speaker.name)}` when `kb.role === 'speaker'`; add `['speakers', String(speakers.length)]` to `specs` only when `kb.role === 'house' && speakers.length > 0`. The headline for a speaker view uses the same arithmetic over the speaker's own coverage and rules (they already are, since `collect` resolved the speaker).
2. New `speakersSection(state)`:

```js
function speakersSection (state) {
  const rows = (state.speakers ?? []).map((s) => {
    const drift = !s.driftBaseline
      ? '<span class="pill pill--soft">n/a</span>'
      : s.driftFlagged ? '<span class="pill pill--warn">FLAG</span>' : '<span class="pill pill--good">ok</span>'
    return `<tr>
            <th scope="row">${escapeHtml(s.slug)}</th>
            <td>${escapeHtml(s.name)}</td>
            <td class="n">${num(s.voiceRules, '0')}</td>
            <td class="n">${num(s.authoredCells, '0')}</td>
            <td class="n">${num(s.overrides, '0')}</td>
            <td class="n">${s.lockViolations ? `<span class="pill pill--warn">${num(s.lockViolations)}</span>` : '-'}</td>
            <td>${drift}</td>
            <td class="n">${num(s.draftsPending, '0')}</td>
          </tr>`
  }).join('\n          ')
  return `<div class="table__scroll">
        <table class="data data--head">
          <caption class="sr-only">Speakers declared on this house</caption>
          <thead><tr><th scope="col">slug</th><th scope="col">name</th><th scope="col">voice</th><th scope="col">cells</th><th scope="col">overrides</th><th scope="col">locks broken</th><th scope="col">drift</th><th scope="col">drafts</th></tr></thead>
          <tbody>
          ${rows}
          </tbody>
        </table>
      </div>`
}
```

Check the existing `STYLES` block for `pill--warn`, `pill--good`, `pill--soft`; add the two missing pill variants on the existing status colours if only `pill--soft` exists.

3. `confidence(rules, role)`: when `role === 'speaker'`, append a second small table:

```js
  <table class="data data--head"><caption class="sr-only">Rules by origin</caption>
    <thead><tr><th scope="col">origin</th><th scope="col">rules</th></tr></thead>
    <tbody>
      <tr><th scope="row">house</th><td class="n">${num(by.house, '0')}</td></tr>
      <tr><th scope="row">speaker</th><td class="n">${num(by.speaker, '0')}</td></tr>
      <tr><th scope="row">overrides</th><td class="n">${num(by.overrides, '0')}</td></tr>
      <tr><th scope="row">locked</th><td class="n">${num(by.locked, '0')}</td></tr>
    </tbody></table>
```

4. `settings`: append `<p class="note">Locks: ${locks.map((id) => `<code>${escapeHtml(id)}</code>`).join(' ')}</p>` only when `state.locks?.declared?.length` or the view is a speaker (`Locks: none declared` then).
5. `renderHtml`: after the Pipeline section, when `kb.role === 'house' && speakers.length > 0`:

```js
  ${section('speakers', 'Speakers', 'Each speaker inherits the house and replaces its voice. Locked house rules apply to all of them.', speakersSection(state))}
```

- [ ] **Step 4: Run the tests, then the suite, then commit**

Run: `node --test test/html.test.mjs && npm test`
Expected: PASS.

```bash
git add scripts/lib/html.mjs test/html.test.mjs
git commit -m "feat(html): speakers section, speaking-as hero, origin split, locks note"
```

---

## Task 11: `status.mjs` - per-speaker views and artifacts

**Files:**
- Modify: `scripts/status.mjs`
- Test: `test/status.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: `status.mjs --profile <slug>` collects that speaker; `--artifact` writes `.drafts/status-<slug>.html` for a speaker and `.drafts/status.html` for the house; `--refresh --profile <slug>` rebuilds the speaker's manifest and fingerprint under the overlay; `--panel speakers` accepted.

- [ ] **Step 1: Write the failing tests**

Append to `test/status.test.mjs` (define `FIXTURE` and a `fixtureProject()` helper that copies it into `.voice-and-tone`):

```js
test('--profile <speaker> renders that speaker, and --artifact lands on a per-speaker path', () => {
  const dir = fixtureProject()
  try {
    const screen = run(dir, ['--profile', 'maya'])
    assert.match(screen, /maya \(speaker\)/)
    run(dir, ['--profile', 'maya', '--artifact'])
    assert.ok(existsSync(path.join(dir, '.voice-and-tone', '.drafts', 'status-maya.html')))
    assert.ok(!existsSync(path.join(dir, '.voice-and-tone', '.drafts', 'status.html')))
    run(dir, ['--artifact'])
    assert.ok(existsSync(path.join(dir, '.voice-and-tone', '.drafts', 'status.html')))
  } finally {
    cleanup(dir)
  }
})

test('--refresh --profile <speaker> writes only under the overlay', () => {
  const dir = fixtureProject()
  try {
    run(dir, ['--profile', 'maya', '--refresh'])
    assert.ok(existsSync(path.join(dir, '.voice-and-tone', 'profiles', 'maya', 'evidence', 'manifest.json')))
    assert.ok(existsSync(path.join(dir, '.voice-and-tone', 'profiles', 'maya', 'evidence', 'fingerprint.json')))
    assert.ok(!existsSync(path.join(dir, '.voice-and-tone', 'evidence', 'manifest.json')))
  } finally {
    cleanup(dir)
  }
})

test('--json in the house view carries the speakers block and G17 for the speaker with no voice', () => {
  const dir = fixtureProject()
  try {
    const state = JSON.parse(run(dir, ['--json']))
    assert.equal(state.kb.role, 'house')
    assert.deepEqual(state.speakers.map((s) => s.slug), ['jonas', 'maya'])
    assert.ok(state.gaps.some((g) => g.id === 'G17' && g.what.startsWith('[jonas]')))
  } finally {
    cleanup(dir)
  }
})

test('--panel speakers is accepted', () => {
  const dir = fixtureProject()
  try {
    assert.match(run(dir, ['--panel', 'speakers']), /SPEAKERS  2 declared/)
  } finally {
    cleanup(dir)
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/status.test.mjs`
Expected: FAIL on the artifact path and the refresh path.

- [ ] **Step 3: Implement**

In `scripts/status.mjs`:

1. Import `artifactRoot, isSpeaker` from `./lib/config.mjs`.
2. `refresh`: write the manifest and fingerprint to `path.join(artifactRoot(kbRoot, profileName, config), 'evidence', ...)` instead of `kbRoot`; read the previous baseline from the same path.
3. `--artifact` default path: `path.join(kbRoot, '.drafts', isSpeaker(config, profileName) ? `status-${profileName}.html` : 'status.html')`.
4. `--help`: extend the `--profile` line to `'  --profile <name>  config profile (default: default); a speaker slug shows that speaker'` and the `--artifact` line to mention `status-<slug>.html`.

- [ ] **Step 4: Run the tests, then the suite, then commit**

Run: `node --test test/status.test.mjs && npm test`
Expected: PASS.

```bash
git add scripts/status.mjs test/status.test.mjs
git commit -m "feat(status): per-speaker views, refresh, and artifact paths"
```

---

## Task 12: Byte-identity golden test

**Files:**
- Modify: `test/conformance.test.mjs`
- Create: `test/fixtures/house-only/**` (a copy of `house-with-speakers` with `profiles/` deleted, the two speaker profiles and the `locks:` line removed from `config.yml`, and `V3, L30, T-social/focused` dropped from the ledger's `Produced:` line)

**Interfaces:** none new. This task exists to make the Global Constraint "byte identity" a test.

- [ ] **Step 1: Write the test**

Append to `test/conformance.test.mjs`:

```js
test('a knowledge base with no speakers is byte-identical across the compiler, the validator, and both status renderers', () => {
  // The invariant every task in the speaker-profiles plan promised. The
  // expected outputs were captured from the commit before Task 1 and live
  // beside the fixture; regenerate them ONLY from that commit, never from a
  // later one, or the test would pin whatever the last change produced.
  const fixture = path.join(root, 'test', 'fixtures', 'house-only')
  const expectedDir = path.join(fixture, '_expected')
  const dir = makeTmpProject({ 'content/a.md': '# A\n\nWe leverage it. One thing worth knowing.\n' })
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    cpSync(fixture, kbRoot, { recursive: true, filter: (src) => !src.includes('_expected') })
    const NOW = '2026-09-10T00:00:00.000Z'
    const node = process.execPath
    const run = (script, args) => execFileSync(node, [path.join(root, 'scripts', script), '--root', dir, '--now', NOW, ...args], { encoding: 'utf8' })

    run('scan.mjs', [])
    run('fingerprint.mjs', ['--set-baseline'])
    run('compile-context.mjs', [])
    assert.equal(readFileSync(path.join(kbRoot, 'CONTEXT.md'), 'utf8'), readFileSync(path.join(expectedDir, 'CONTEXT.md'), 'utf8'))

    let validateOut
    try { validateOut = run('validate.mjs', []) } catch (error) { validateOut = error.stdout }
    assert.equal(validateOut, readFileSync(path.join(expectedDir, 'validate.txt'), 'utf8'))

    const screen = run('status.mjs', []).replace(new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<root>')
    assert.equal(screen, readFileSync(path.join(expectedDir, 'status.txt'), 'utf8'))

    run('status.mjs', ['--artifact', '--out', path.join(dir, 'status.html')])
    const page = readFileSync(path.join(dir, 'status.html'), 'utf8').replace(new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<root>')
    assert.equal(page, readFileSync(path.join(expectedDir, 'status.html'), 'utf8'))
  } finally {
    cleanup(dir)
  }
})
```

`cpSync` is imported from `node:fs` at the top of the file if not already.

- [ ] **Step 2: Capture the expected outputs from the pre-feature commit**

Check out the commit before Task 1 into a temporary worktree, and run the same four commands there against the `house-only` fixture (the fixture files must be created in the worktree by hand for this step, since they do not exist in that commit). Save `CONTEXT.md`, `validate.txt`, `status.txt` (with the temp root replaced by `<root>`) and `status.html` (same replacement) into `test/fixtures/house-only/_expected/`. Remove the worktree.

```bash
cd /Users/pavolhudran/Sites/ai-voice-and-tone
BASE=$(git log --format=%H --grep='speaker profiles inherit the house' -n 1)^
git worktree add /tmp/vat-base "$BASE"
# create the fixture project under /tmp/vat-base-proj by copying test/fixtures/house-only there,
# run scan, fingerprint --set-baseline, compile-context, validate, status, status --artifact --out
# with --now 2026-09-10T00:00:00.000Z, replace the temp root with <root>, save under _expected/
git worktree remove /tmp/vat-base
```

- [ ] **Step 3: Run the test**

Run: `node --test test/conformance.test.mjs`
Expected: PASS. Any failure is a real regression in Tasks 1-11; fix the code, never the expected files.

- [ ] **Step 4: Commit**

```bash
git add test/conformance.test.mjs test/fixtures/house-only
git commit -m "test: byte-identity golden for a knowledge base with no speakers"
```

---

## Task 13: Templates and the `speaker` command

**Files:**
- Create: `templates/kb/profiles/_template/{voice.md,tone.md,lexicon.md,mechanics.md,audience.md,channels/_template.md,examples/approved.md,examples/rejected.md,examples/pairs.md,sources/README.md}`
- Modify: `templates/kb/config.yml`, `templates/kb/gitignore`
- Create: `commands/speaker.md`
- Modify: `test/templates.test.mjs`, `test/surface.test.mjs`

- [ ] **Step 1: Write the failing tests**

In `test/templates.test.mjs`, add to the `expected` list of the first test:

```js
    path.join('profiles', '_template', 'voice.md'), path.join('profiles', '_template', 'tone.md'),
    path.join('profiles', '_template', 'lexicon.md'), path.join('profiles', '_template', 'mechanics.md'),
    path.join('profiles', '_template', 'audience.md'), path.join('profiles', '_template', 'channels', '_template.md'),
    path.join('profiles', '_template', 'examples', 'approved.md'), path.join('profiles', '_template', 'examples', 'rejected.md'),
    path.join('profiles', '_template', 'examples', 'pairs.md'), path.join('profiles', '_template', 'sources', 'README.md')
```

and append:

```js
test('the overlay template ships no vector tables and no rule, and a copied overlay validates clean as a speaker', () => {
  const tone = readFileSync(path.join(templates, 'profiles', '_template', 'tone.md'), 'utf8')
  assert.ok(!tone.includes('| State |'), 'vectors are inherited; a copied table would drift')
  assert.ok(!tone.includes('| Context |'))
  const dir = makeTmpProject({})
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    cpSync(templates, kbRoot, { recursive: true })
    cpSync(path.join(templates, 'profiles', '_template'), path.join(kbRoot, 'profiles', 'maya'), { recursive: true })
    writeFileSync(path.join(kbRoot, 'config.yml'), readFileSync(path.join(kbRoot, 'config.yml'), 'utf8').replace('profiles:\n', 'profiles:\n  maya:\n    name: "Maya Lind"\n'))
    const report = validateKb(resolveKb(kbRoot, 'maya'))
    assert.equal(report.errors, 0, JSON.stringify(report.findings, null, 2))
    assert.deepEqual(report.findings.map((f) => f.code), ['W_SPEAKER_NO_VOICE'], 'the one expected warning on a fresh overlay')
  } finally {
    cleanup(dir)
  }
})

test('the gitignore template ignores every speaker inbox and keeps speaker cards', () => {
  const ignore = readFileSync(path.join(templates, 'gitignore'), 'utf8')
  assert.ok(ignore.includes('profiles/*/sources/'))
  assert.ok(!ignore.includes('CONTEXT.md'))
})

test('the config template documents locks', () => {
  assert.match(readFileSync(path.join(templates, 'config.yml'), 'utf8'), /^# ?locks:/m)
})
```

Add `writeFileSync` to the `node:fs` import and `resolveKb` to the `kb.mjs` import.

In `test/surface.test.mjs`, change the command list test's `expected` array to include `'speaker.md'` (sorted: after `'rewrite.md'`), and update its comment to "Eleven since the speaker-profiles spec added :speaker". Append:

```js
test('speaker is a real command with three verbs routing to the right skills', () => {
  const body = readFileSync(surfaceFile('commands', 'speaker.md'), 'utf8')
  assert.match(body, /^---\ndescription:/m)
  for (const verb of ['add', 'list', 'remove']) assert.ok(body.includes(`speaker ${verb}`), verb)
  assert.match(body, /voice-discovery/)
  assert.match(body, /voice-maintenance/)
  assert.match(body, /voice-observability/)
  assert.match(body, /--from/)
})

test('every command that drafts, reviews, or reports documents --profile', () => {
  for (const name of ['write', 'rewrite', 'localize', 'review', 'status', 'sync', 'audit', 'connect']) {
    const body = readFileSync(surfaceFile('commands', `${name}.md`), 'utf8')
    assert.ok(body.includes('--profile'), `${name}.md never mentions --profile`)
  }
})

test('README lists :speaker among the commands', () => {
  assert.ok(readFileSync(surfaceFile('README.md'), 'utf8').includes('/voice-and-tone:speaker'))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/templates.test.mjs test/surface.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Create the overlay template**

`templates/kb/profiles/_template/voice.md`:
```markdown
# Voice - this speaker

A speaker's voice replaces the house's characteristics. Locked house rules
still apply and are listed on the compiled card under "House guardrails".

## Characteristics

<!--
### V1 · Builder   `confirmed`  ev: e12

**Means:** Writes from what she built this week, not from the sidelines.
**Rules out:** commentary without a hand in the work, hype without a number
**Do:** lead with the specific thing · say what surprised you
**Don't:** announce without substance
**Example:** *"I tested the new flow on Tuesday. Here is what broke."*
-->

## Persona rules

Only what differs from the house. Absent means inherited.

## Self-reference rules

Only what differs from the house - for a person, usually "I" where the house
says "we".
```

`templates/kb/profiles/_template/tone.md`:
```markdown
# Tone - this speaker

Tone still flexes with the reader's emotional state. What is the speaker's
own is the default dials line below and any authored cell.

State vectors and context offsets are inherited from the house and are NOT
copied here - a copied table drifts. Override a single row by adding a table
with only that row.

<!--
**Default dials:** warmth 2 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 3
-->

## Authored cells

House cells are not inherited: a cell's Do, Don't and Example are written in
a voice, and the house's is not this speaker's. Cells are promoted here on
first real use, exactly as on the house.

<!--
### T-social/focused   `confirmed`  ev: e12

**Reader is feeling:** mid-task, wants the number
**Dials:** warmth 1 · humor 0 · directness 4 · detail 3 · urgency 1 · formality 3
**Do:** the number first · then why
**Don't:** warm up · hedge
**Example:** *"Forty percent faster. Here is why."*
-->
```

`lexicon.md`:
```markdown
# Lexicon - this speaker

Merged onto the house by ID. Reuse a house ID to override that rule; a new
ID adds. Start new IDs at the next multiple of ten above the house's highest
(house tops out at L22 -> start at L30), so a future house rule cannot
silently override yours. A locked house ID cannot be overridden.

## Love

| ID | Prefer | Why | Conf | Ev |
|---|---|---|---|---|

## Avoid

| ID | Avoid | Prefer | Why | Conf | Ev |
|---|---|---|---|---|---|
```

`mechanics.md`: the house template's header paragraph, then an empty `| ID | Rule | Pattern | Conf | Ev |` table. `audience.md`: `# Audience - this speaker\n\nOnly audiences the house does not already describe, or overrides by ID.\n`. `channels/_template.md`: copy `templates/kb/channels/_template.md`. `examples/{approved,rejected,pairs}.md`: copy the house templates' headers. `sources/README.md`:
```markdown
# This speaker's material

Drop this speaker's own writing here - exported posts, a personal tone
document, transcripts. Never committed, like the house inbox. Register it
with `/voice-and-tone:connect <path> --profile <slug>` and ingest with
`/voice-and-tone:connect --ingest --profile <slug>`.
```

`templates/kb/config.yml`: after the `profiles:` block add:
```yaml
# House rule IDs no speaker may override. Only meaningful once
# /voice-and-tone:speaker add has created a profile; until then leave it out.
# locks: [L20, L21]
```

`templates/kb/gitignore`: append:
```
# Each speaker's own inbox, for the same reason. Speaker cards
# (profiles/*/CONTEXT.md) are artifacts and stay committed.
profiles/*/sources/
```

- [ ] **Step 4: Create the command**

`commands/speaker.md`:
```markdown
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
drafts pending. Read-only; the same numbers as `/voice-and-tone:status --panel speakers`.

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
```

- [ ] **Step 5: Add `--profile` to the eight command docs**

In each of `write.md`, `rewrite.md`, `localize.md`, `review.md`, `sync.md`, `audit.md`, `connect.md`, add one option line (`write.md` already has it; reword to `- \`--profile <slug>\` - write as that speaker; "write this as Maya" resolves the same way`). For `status.md`, add `/voice-and-tone:status --profile maya`, `--panel speakers`, and a `speakers` row to the panels table: `| \`speakers\` | one row per declared speaker: voice, cells, overrides, locks broken, drift, drafts |`. For `connect.md`: `--profile <slug>` on `--add` attributes the source to that speaker; on `--check`/`--ingest` scopes to it. For `sync.md`: without `--profile`, validates and compiles the house and every speaker. For `audit.md`: `--profile <slug>` audits one speaker; the house audit gains a "Speakers" section. Update `argument-hint` in each frontmatter accordingly.

- [ ] **Step 6: README**

Add a row to the commands table after `:localize`: `| \`/voice-and-tone:speaker\` | add, list, or remove a speaker that inherits the house and replaces its voice |`. Under "The knowledge base" add a short paragraph: what a speaker is, that `profiles/<slug>/` overlays the house, that `locks:` names what no speaker may override, and that a knowledge base without speakers is unchanged.

- [ ] **Step 7: Run the tests, then the suite, then commit**

Run: `node --test test/templates.test.mjs test/surface.test.mjs && npm test`
Expected: PASS.

```bash
git add templates commands README.md test/templates.test.mjs test/surface.test.mjs
git commit -m "feat(speaker): overlay template, the speaker command, --profile across the command surface"
```

---

## Task 14: Skills and the critic

**Files:**
- Create: `skills/voice-discovery/references/speaker-discovery.md`
- Modify: `skills/voice-discovery/SKILL.md`, `skills/voice-and-tone/SKILL.md`, `skills/voice-and-tone/references/write-flow.md`, `skills/voice-and-tone/references/interpolation.md`, `skills/voice-review/SKILL.md`, `skills/voice-review/references/severity.md`, `skills/voice-review/references/finding-format.md`, `skills/voice-maintenance/SKILL.md`, `skills/voice-maintenance/references/audit-report.md`, `skills/voice-observability/SKILL.md`, `skills/voice-observability/references/panels.md`, `skills/voice-observability/references/gap-catalogue.md`, `agents/voice-critic.md`
- Test: `test/surface.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `test/surface.test.mjs`:

```js
test('the discovery skill links the speaker path and it names the scripts and flags it runs', () => {
  const { body } = readFrontmatter(surfaceFile('skills', 'voice-discovery', 'SKILL.md'))
  assert.ok(body.includes('speaker-discovery.md'))
  const ref = readFileSync(surfaceFile('skills', 'voice-discovery', 'references', 'speaker-discovery.md'), 'utf8')
  assert.match(ref, /<plugin>\/templates\/kb\/profiles\/_template/)
  assert.match(ref, /--profile <slug>/)
  assert.match(ref, /--set-baseline/)
  assert.match(ref, /locks/)
  assert.match(ref, /Which of these should be house rules/)
})

test('the applier resolves the speaker before loading a card and reports it', () => {
  const { body } = readFrontmatter(surfaceFile('skills', 'voice-and-tone', 'SKILL.md'))
  assert.match(body, /profiles\/<slug>\/CONTEXT\.md/)
  assert.match(body, /--profile/)
  assert.match(body, /lock_override/)
  const flow = readFileSync(surfaceFile('skills', 'voice-and-tone', 'references', 'write-flow.md'), 'utf8')
  assert.match(flow, /speaker offset applied/)
  const interp = readFileSync(surfaceFile('skills', 'voice-and-tone', 'references', 'interpolation.md'), 'utf8')
  assert.match(interp, /speaker_offset/)
})

test('review names origin on every finding and makes a broken lock an always-blocker', () => {
  const { body } = readFrontmatter(surfaceFile('skills', 'voice-review', 'SKILL.md'))
  assert.match(body, /\(house\)/)
  assert.match(body, /locked/)
  const sev = readFileSync(surfaceFile('skills', 'voice-review', 'references', 'severity.md'), 'utf8')
  assert.match(sev, /locked/i)
  const fmt = readFileSync(surfaceFile('skills', 'voice-review', 'references', 'finding-format.md'), 'utf8')
  assert.match(fmt, /\(house\)|\(speaker\)|overrides house/)
})

test('maintenance says where a speaker correction lands and audit has a speakers section', () => {
  const { body } = readFrontmatter(surfaceFile('skills', 'voice-maintenance', 'SKILL.md'))
  assert.match(body, /overlay/)
  assert.match(body, /two or more speakers/)
  assert.match(body, /Speakers/)
  assert.match(body, /override, or house rule/)
  assert.match(body, /every speaker/)
})

test('observability documents the speakers panel and every new detector', async () => {
  const { DETECTORS } = await import('../scripts/lib/gaps.mjs')
  const catalogue = readFileSync(surfaceFile('skills', 'voice-observability', 'references', 'gap-catalogue.md'), 'utf8')
  for (const { id } of DETECTORS) assert.ok(catalogue.includes(`\`${id}\``), `${id} undocumented`)
  const panels = readFileSync(surfaceFile('skills', 'voice-observability', 'references', 'panels.md'), 'utf8')
  assert.match(panels, /## `speakers`/)
  const { body } = readFrontmatter(surfaceFile('skills', 'voice-observability', 'SKILL.md'))
  assert.match(body, /status-<slug>\.html/)
})

test('the critic asks which speaker wrote the draft when there is more than one', () => {
  const agent = readFileSync(surfaceFile('agents', 'voice-critic.md'), 'utf8')
  assert.match(agent, /which speaker wrote this/i)
  assert.match(agent, /profiles\/<slug>\/voice\.md/)
})
```

The existing test "the gap catalogue reference documents every shipped detector" may already cover `G17`..`G21`; if so, drop that assertion from the new test rather than duplicate it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/surface.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Write `speaker-discovery.md`**

`skills/voice-discovery/references/speaker-discovery.md`:

```markdown
# Speaker discovery

The discovery pipeline, run for one speaker. Everything here assumes the
house already exists; if it does not, run the house pipeline first.

A speaker is any first-person voice under the house - a person, a team, a
product line, a mascot, an assistant. Two levels, fixed: an overlay sits on
the house and never on another overlay.

## 1. Scaffold and declare

1. Copy `<plugin>/templates/kb/profiles/_template/` to `<KB>/profiles/<slug>/`.
2. Add the profile to `<KB>/config.yml` under `profiles:` - `name`, and
   `primary_locale`/`locales` only if they differ from the house. Show the
   diff; write on approval.
3. Register each `--from` source under the speaker:
   `node "<plugin>/scripts/sources.mjs" --root "<project>" --kb "<KB>" --add <path|url> --profile <slug>`

## 2. Scan, ingest, measure - scoped

```
node "<plugin>/scripts/sources.mjs" --root "<project>" --kb "<KB>" --ingest --profile <slug>
node "<plugin>/scripts/scan.mjs" --root "<project>" --kb "<KB>" --profile <slug>
node "<plugin>/scripts/fingerprint.mjs" --root "<project>" --kb "<KB>" --profile <slug> --set-baseline
```

The corpus is the speaker's material only. Project files are house material
and never enter a speaker's fingerprint. Follow `sourcing.md` for anything
that needs the model tier.

## 3. Draft the overlay

Write into `<KB>/profiles/<slug>/`, never into the house:

- `voice.md`: 3-6 `V` characteristics from the speaker's material. Number
  them from `V1`; they replace the house's unlocked characteristics as a set.
- `tone.md`: one `**Default dials:**` line. That line is the speaker's
  personality in the arithmetic - the interpolator adds (speaker defaults -
  house defaults) to every computed cell. No vector tables; override a
  single row only when the material demands it.
- `lexicon.md`, `mechanics.md`, `audience.md`, `channels/<name>.md`: only
  where the speaker's material contradicts or extends the house. Reuse a
  house ID to override; add new IDs from the next multiple of ten above the
  house's highest for that prefix. Never reuse a locked ID - propose that as
  a `disputed` entry in `evidence/conflicts.md` with `**Profile:** <slug>`
  instead, for `:audit` to raise.
- A rule the house already states is inherited, not re-derived. Say so in
  the ledger entry rather than writing it twice.

Every ledger entry for this speaker carries `**Profile:** <slug>` and a
`Produced:` line, in the single house ledger.

## 4. Interview

Preference pairs on the speaker's own strings, three pairs by default, per
`interview-method.md`. One extra question when another speaker already
exists and shares a candidate rule: **"Which of these should be house
rules?"** Two speakers writing the same rule independently is corroboration
for the house; on a yes, write it to the house file and cite both speakers'
evidence.

## 5. Canonize

```
node "<plugin>/scripts/validate.mjs" --root "<project>" --kb "<KB>"
node "<plugin>/scripts/compile-context.mjs" --root "<project>" --kb "<KB>" --profile <slug>
```

Fix every error first. `W_SPEAKER_NO_VOICE` must be gone by now.

Then, if `locks:` is empty in `config.yml`, propose the house's "Never say"
IDs into it and show the diff. A house with speakers and no locks has
guardrails every speaker can override.

Report: rules by confidence on the overlay, cells authored, overrides, and
the report line the applier will print: `profile <slug> · ...`.
```

- [ ] **Step 4: Edit the other skills**

`skills/voice-discovery/SKILL.md`: after "## Cold start", add:

```markdown
## Speakers

When the conversation has named more than one first-person voice - founders,
executives, ambassadors, authors, a support team, a product line, a mascot, an
assistant - offer `/voice-and-tone:speaker add <slug>` at the end of the
house pipeline, and read `references/speaker-discovery.md` before running it.
A speaker inherits the house and replaces its voice; it never runs the house
pipeline again.
```

`skills/voice-and-tone/SKILL.md`, "The flow", replace step 1 and step 8:

```markdown
1. **Resolve the speaker, then load the card.** In order: `--profile <slug>`,
   then "as <name>" in the request (match against `profiles.<slug>.name` in
   `<KB>/config.yml`), then a `voice-and-tone: default profile <slug>` line in
   the project's `CLAUDE.md`, then the house. Load
   `<KB>/profiles/<slug>/CONTEXT.md` for a speaker, `<KB>/CONTEXT.md` for the
   house. Nothing else, yet.
```

```markdown
8. **Report** one line: `profile <slug> · cell: <context>/<state> · locale: <code>
   · <authored|interpolated>`, adding `speaker offset applied` on an
   interpolated speaker cell and `lock_override: <id>` if a user instruction
   forced a locked rule to break (also written into the draft frontmatter).
```

And in "Precedence" insert `3. Locked house rules (config.yml locks:)` and `4. The speaker overlay` before "The knowledge base", renumbering. Add under "Promoting a cell": for a speaker, the cell is written to `<KB>/profiles/<slug>/tone.md`. Under step 5 add: calibration samples come from the speaker's `examples/approved.md`, falling back to the house's with a note.

`references/write-flow.md`: in "Loading, in order", make every path speaker-aware (`<KB>/profiles/<slug>/...` first, house second for channels and locales, overlay `tone.md` only for cells); in "Draft frontmatter" add `lock_override: null` as an optional field; in "Reporting" add the two suffixes above.

`references/interpolation.md`: after the formula add:

```
For a speaker:

speaker_offset       = overlay default dials - house default dials   (per dial)
cell(context, state) = clamp(state_vector[state] + context_offset[context] + speaker_offset, 0, 4)
```

then gates 1 and 2 unchanged, in that order. State that an authored cell is never shifted and that `speakerOffsetOf` in `scripts/lib/kb.mjs` is the reference implementation.

`skills/voice-review/SKILL.md`: step 1 resolves the speaker as the applier does (from `--profile`, from draft frontmatter, else the house) and says which in the report's first line; step 5 names the origin on every finding: `L03 (house)`, `L31 (maya)`, `M07 (maya, overrides house)`, `L20 (house, locked)`. "Severity, in one line" gains: `locked` house rule broken -> **Blocker**, whatever its confidence.

`references/severity.md`: add a third row to "Always Blocker": **A locked house rule broken** - `config.yml locks:` is the brand team's explicit instruction; a lock outranks the rule's own confidence.

`references/finding-format.md`: in the example, change the first heading line to `**\`content/pricing.md:14\`** - L07 (house, locked) \`confirmed\`` and add a rule: **Name the origin** - `(house)`, `(<slug>)`, `(<slug>, overrides house)`, `(house, locked)`.

`skills/voice-maintenance/SKILL.md`: under `:learn`, after step 6 add:

```markdown
### Where a correction lands

The draft's frontmatter names the profile. A correction to a speaker draft is
a `correction` entry with `**Profile:** <slug>` and, on corroboration, a rule
in `<KB>/profiles/<slug>/` - the overlay, never the house. Two more cases:

- The corrected rule is a house rule and the same correction is corroborated
  across drafts from **two or more speakers**: propose it at house level
  instead, and say why.
- The correction contradicts a locked rule: record the evidence, propose
  nothing, and name the lock. Changing a lock is an `:audit` decision.
```

Under `:audit`, add section 5, **Speakers** (house audit only): one row per speaker - overrides, lock conflicts, drift flag, cells authored, days since last draft - and a third closing question: for each candidate override, **override, or house rule?** `--profile <slug>` audits one speaker. Under `:sync`: validate and compile the house and every speaker (`compile-context.mjs --profile <slug>` per speaker); version rules become major = house voice or `locks` changed, minor = speaker added or removed or rules/cells added anywhere, patch = wording. Add a `:speaker remove` subsection: read every ledger entry with the profile, follow `Produced:`, reopen those rules, then remove overlay, config entry, register entries - each a proposed diff.

`references/audit-report.md`: add the Speakers section shape and the third question.

`skills/voice-observability/SKILL.md`: add `--profile <slug>` to "Run it"; add `speakers` to the panel list; in "When a page is wanted" say a speaker page lands at `<KB>/.drafts/status-<slug>.html` and is published on its own path so its link stays stable; add the handoff row `| speaker has no voice, no baseline, or never-ingested material | \`/voice-and-tone:speaker add\`, \`fingerprint.mjs --set-baseline --profile\`, \`/voice-and-tone:connect --ingest --profile\` |` and `| speakers declared, no locks | edit \`locks:\`, then \`/voice-and-tone:sync\` |`.

`references/panels.md`: add:

```markdown
## `speakers`

House view only. One row per declared speaker: voice rules, authored cells,
overrides, lock violations (`!`, also a validation error), drift (`ok`,
`FLAG`, or `n/a` with no baseline), drafts pending.

Every computed cell on a new speaker is expected, not a gap. Zero overrides
is the expected starting state. The question it raises: does each speaker
sound like themselves? That is the critic's read-back, per draft, not a
number this panel can carry.
```

and note that under `--profile <slug>` every other panel shows the resolved speaker.

`references/gap-catalogue.md`: add `G17`..`G21` rows in the table (copy `what`/`fix` from Task 8) and the three new deliberate non-gaps.

`agents/voice-critic.md`: in "What you have, first turn" add: "When `<KB>/config.yml` declares more than one profile: the list of speaker names and the path `<KB>/profiles/<slug>/voice.md` for each, plus `<KB>/voice.md` for the house." Add to Task 1: "**Which speaker wrote this?** Name one, or the house. A wrong guess is a finding: the draft is not distinguishably that speaker." In the second turn: the resolved speaker card and overlay paths.

- [ ] **Step 5: Run the tests, then the suite, then commit**

Run: `node --test test/surface.test.mjs && npm test`
Expected: PASS. `test/conformance.test.mjs` sweeps every `.md` under `skills/`, `commands/`, `agents/` for shell tool invocations and control bytes, so keep the new prose within those rules.

```bash
git add skills agents test/surface.test.mjs
git commit -m "docs(skills): speaker discovery, speaker-aware applier and review, maintenance and observability, critic read-back"
```

---

## Task 15: Changelog, plugin version, and a final full run

**Files:**
- Modify: `CHANGELOG.md` (repo root, if present; else `README.md`'s changelog section), `.claude-plugin/plugin.json`, `package.json`

- [ ] **Step 1: Bump and record**

Set `version` to `0.2.0` in `.claude-plugin/plugin.json` and `package.json`. Add a changelog entry:

```markdown
## 0.2.0 - 2026-09-10

Speaker profiles. One knowledge base can now hold a shared house layer plus
one overlay per speaker under `profiles/<slug>/`, with `locks:` naming the
house rules no speaker may override. New command `/voice-and-tone:speaker`;
`--profile <slug>` on every drafting, reviewing, and reporting command; a
`speakers` status panel, five new gap detectors (G17-G21), and per-speaker
status pages. A knowledge base with no speakers is byte-identical to 0.1.0
across the compiler, the validator, and both status renderers
(`test/conformance.test.mjs`). Spec: `.superpowers/specs/2026-09-10-speaker-profiles-design.md`.
```

If `test/manifest.test.mjs` pins the version, update its expectation.

- [ ] **Step 2: Full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 3: Smoke test against the fixture end to end**

```bash
cd /Users/pavolhudran/Sites/ai-voice-and-tone
TMP=$(mktemp -d) && mkdir -p "$TMP/content" && printf '# A\n\nWe leverage it.\n' > "$TMP/content/a.md"
cp -R test/fixtures/house-with-speakers "$TMP/.voice-and-tone"
node scripts/validate.mjs --root "$TMP"; echo "exit $?"        # expect 2: jonas overrides a lock
node scripts/compile-context.mjs --root "$TMP" --profile maya
node scripts/status.mjs --root "$TMP"                          # expect SPEAKERS panel and [jonas] G17
node scripts/status.mjs --root "$TMP" --profile maya --artifact
rm -rf "$TMP"
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md .claude-plugin/plugin.json package.json test
git commit -m "chore: 0.2.0 - speaker profiles"
```

---

## Self-review against the spec

| Spec section | Task |
|---|---|
| §2 layout, per-speaker evidence and card | 4, 6, 7, 13 |
| §3 config: `locks`, speaker profiles, `sources[].profile` | 1, 3, 13 |
| §4.1 precedence, `lock_override` in frontmatter | 14 |
| §4.2 voice replaces as a set, locked appended | 2 |
| §4.2 prose sections merged per section | deviation 4, 14 (skill) |
| §4.3 default dials, vectors by row, cells not inherited, speaker offset | 2, 14 |
| §4.4 merge by ID, lock refusal, decade rule | 2, 5 |
| §4.5 examples, single ledger with Profile, index profile, per-speaker fingerprint and manifest, drafts | 3, 4, 7, 14 |
| §4.6 locales | 1 (inheritance), 3 (attribution), 2 (overlay locale packs merge) |
| §5 compiled cards | 6 |
| §6.1 `speaker` command | 13, 14 |
| §6.2 `--profile` on existing commands | 3, 4, 6, 11, 13 |
| §7.1 speaker discovery | 14 |
| §7.2 learn, audit, sync | 14 |
| §7.3 applier, §7.4 review, §7.5 observability, §7.6 critic | 14 |
| §8.1 touched modules | 1-11 |
| §8.2 validation codes | 5 |
| §8.3 byte identity | 12 |
| §9.1 state object | 7 |
| §9.2 ASCII | 9 |
| §9.3 gaps | 8 |
| §9.4 artifact | 10, 11 |
| §10 templates | 13 |
| §12 tests | every task |

Placeholder scan: none. Type consistency: `resolveKb` fields (`role`, `speaker`, `locks`, `overrides`, `lockViolations`, `speakerOffset`, `house`, `overlay`, `houseRoot`, `overlayRoot`) are used with those exact names in Tasks 5, 6, 7; `SpeakerSummary` fields are used with those exact names in Tasks 8, 9, 10; `artifactRoot(kbRoot, profileName, config)` has the same argument order in Tasks 4, 6, 7, 11.
