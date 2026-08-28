import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseYaml } from '../scripts/lib/yaml.mjs'
import { STATES, CONTEXTS } from '../scripts/lib/kb.mjs'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const surfaceFile = (...parts) => path.join(root, ...parts)

/** Every markdown file the plugin ships as logic a model executes. */
function shippedMarkdown (dir = null, out = []) {
  if (dir === null) {
    for (const top of ['skills', 'commands', 'agents']) shippedMarkdown(surfaceFile(top), out)
    return out
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) shippedMarkdown(abs, out)
    else if (entry.name.endsWith('.md')) out.push(abs)
  }
  return out
}

/** The slice of a document between two markers, for pinning a procedure step. */
function between (text, startMarker, endMarker) {
  const start = text.indexOf(startMarker)
  assert.ok(start !== -1, `marker "${startMarker}" is missing`)
  const end = text.indexOf(endMarker, start + startMarker.length)
  assert.ok(end !== -1, `marker "${endMarker}" is missing after "${startMarker}"`)
  return text.slice(start, end)
}

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

test('every script any shipped skill, command, or agent names actually exists', () => {
  // Previously scoped to two files, which is how a reference to a script that
  // was never built (D2) survived in a third. Every shipped markdown file gets
  // checked now.
  const surfaces = shippedMarkdown()
  assert.ok(surfaces.length > 10, `expected the full markdown surface, walked ${surfaces.length} files`)
  let checked = 0
  for (const file of surfaces) {
    for (const match of readFileSync(file, 'utf8').matchAll(/scripts\/((?:lib\/)?[\w-]+\.mjs)/g)) {
      checked++
      assert.ok(
        existsSync(surfaceFile('scripts', ...match[1].split('/'))),
        `${path.relative(root, file)} names missing scripts/${match[1]}`
      )
    }
  }
  assert.ok(checked > 0, 'no script reference was found at all - the regex stopped matching')
})

test('no shipped markdown points at templates/kb/ without the plugin prefix', () => {
  // A bare templates/kb/ resolves against the user's project root, where it
  // does not exist - and one of these is the literal first action of :init.
  for (const file of shippedMarkdown()) {
    const text = readFileSync(file, 'utf8')
    for (const [index, line] of text.split('\n').entries()) {
      for (const match of line.matchAll(/templates\/kb\//g)) {
        const before = line.slice(0, match.index)
        assert.ok(
          before.endsWith('<plugin>/'),
          `${path.relative(root, file)}:${index + 1} names templates/kb/ without the <plugin>/ prefix`
        )
      }
    }
  }
})

test('the applier and microcopy agree on which one takes a short UI string', () => {
  // Both skill descriptions claim error messages and notifications. The routing
  // used to live only in commands/write.md, so a natural-language trigger drove
  // the applier straight past microcopy's element budgets.
  const applier = readFileSync(surfaceFile('skills', 'voice-and-tone', 'SKILL.md'), 'utf8')
  const micro = readFileSync(surfaceFile('skills', 'microcopy', 'SKILL.md'), 'utf8')

  assert.match(applier, /`microcopy`/, 'the applier must name the skill it hands short work to')
  assert.match(micro, /`?voice-and-tone`?/, 'microcopy must name the skill it hands long work to')

  const threshold = /roughly (\d+) words/
  const applierThreshold = threshold.exec(applier)
  const microThreshold = threshold.exec(micro)
  assert.ok(applierThreshold, 'the applier must state a numeric handoff threshold')
  assert.ok(microThreshold, 'microcopy must state a numeric handoff threshold')
  assert.equal(
    applierThreshold[1], microThreshold[1],
    'the two skills must name the same word count, or a piece falls between them'
  )
})

test('generated knowledge bases are told to carry attribution', () => {
  const { body } = readFrontmatter(surfaceFile('skills', 'voice-discovery', 'SKILL.md'))
  assert.match(body, /Mailchimp/)
  assert.match(body, /verbatim/i, 'the skill must forbid carrying source prose into the KB')
})

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

test('the critic cannot browse its way to the read-back answer', () => {
  const { frontmatter, body } = readFrontmatter(surfaceFile('agents', 'voice-critic.md'))
  assert.ok(!/Glob/.test(frontmatter.tools), 'critic must not be granted Glob - it cannot discover .drafts/ paths it should not have')
  assert.ok(!/Grep/.test(frontmatter.tools), 'critic must not be granted Grep - it cannot search for the answer')
  assert.match(body, /never[^\n]*\.drafts\//i, 'the critic must be told never to read .drafts/, under any circumstance')
})

test('the review skill mechanizes the critic dispatch as two turns, not one prompt', () => {
  const { body } = readFrontmatter(surfaceFile('skills', 'voice-review', 'SKILL.md'))
  assert.match(body, /Turn 1/)
  assert.match(body, /Turn 2/)
  assert.match(body, /SendMessage/)
  assert.match(body, /never combine/i, 'the skill must forbid folding the reveal into the same prompt as the guess')
})

test('turn 1 of the critic dispatch never hands over tone.md', () => {
  // tone.md carries every authored cell's Example: line, which for a draft
  // written from an authored cell is the closest text in the KB to the draft -
  // the read-back answer by a slower route than .drafts/.
  const { body } = readFrontmatter(surfaceFile('skills', 'voice-review', 'SKILL.md'))
  const turnOne = between(body, '**Turn 1**', '**Turn 2**')
  assert.ok(turnOne.includes('CONTEXT.md'), 'turn 1 still hands over the compiled card')
  assert.ok(turnOne.includes('voice.md'), 'turn 1 still hands over voice.md')
  assert.ok(!turnOne.includes('tone.md'), 'turn 1 must not name tone.md at all')
  assert.ok(
    between(body, '**Turn 2**', '## After the report').includes('tone.md'),
    'turn 2 is where tone.md is handed over'
  )
})

test('the critic carries both fixed vocabularies itself, so turn 1 needs no tone.md', () => {
  const { body } = readFrontmatter(surfaceFile('agents', 'voice-critic.md'))
  for (const context of CONTEXTS) {
    assert.ok(body.includes(context), `voice-critic.md must list the context ${context}`)
  }
  for (const state of STATES) {
    assert.ok(body.includes(state), `voice-critic.md must list the state ${state}`)
  }
  const firstTurn = between(body, '**First turn:**', '**Second turn**')
  assert.ok(firstTurn.includes('CONTEXT.md'), 'the first turn still gets the compiled card')
  assert.ok(firstTurn.includes('voice.md'), 'the first turn still gets voice.md')
  assert.ok(!firstTurn.includes('tone.md'), 'the first turn must not name tone.md at all')
  assert.ok(
    between(body, '**Second turn**', '## The ten contexts').includes('tone.md'),
    'the second turn is where tone.md belongs'
  )
})

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

test('every command file the plugin ships is one of the nine in the spec', () => {
  const expected = [
    'audit.md', 'connect.md', 'init.md', 'learn.md', 'localize.md',
    'review.md', 'rewrite.md', 'sync.md', 'write.md'
  ]
  const actual = readdirSync(surfaceFile('commands')).filter((f) => f.endsWith('.md')).sort()
  assert.deepEqual(actual, expected)
})

test('connect is a real command naming the skill it invokes', () => {
  const body = readFileSync(surfaceFile('commands', 'connect.md'), 'utf8')
  assert.match(body, /^---\ndescription:/m)
  assert.match(body, /voice-discovery/)
  // --inbox never existed as a real flag on sources.mjs; --ingest is what
  // actually analyses anything newly dropped into the inbox.
  assert.ok(!body.includes('--inbox'), 'connect.md must not document a flag sources.mjs does not have')
  for (const flag of ['--ingest', '--refresh', '--forget']) assert.ok(body.includes(flag), flag)
})

test('every flag connect.md documents actually exists on sources.mjs --help', () => {
  // Task 15 fix round 2: --inbox was documented and never implemented, and
  // the only thing that would have caught it earlier is running the real
  // CLI rather than trusting the doc. This runs it.
  const body = readFileSync(surfaceFile('commands', 'connect.md'), 'utf8')
  const documented = new Set(
    [...body.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]).filter((f) => f !== '--')
  )
  const help = execFileSync(
    process.execPath, [surfaceFile('scripts', 'sources.mjs'), '--help'], { encoding: 'utf8' }
  )
  const real = new Set([...help.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]))
  for (const flag of documented) {
    assert.ok(real.has(flag), `connect.md documents ${flag}, which sources.mjs --help does not list`)
  }
})

test('every literal flag sequence connect.md shows in its usage block is accepted by the real parser', () => {
  // Task 15 fix round 3: "--refresh <id>" was documented, and the parser
  // accepts a bare positional there without complaint - it just silently
  // ignores it. That means "does the parser accept this token" cannot be
  // the whole check (round 3's defect would sail straight through it); it
  // is still worth running for the class round 2's --inbox belonged to,
  // where a doc names a flag the parser rejects outright. Whether a flag
  // that IS accepted actually does what its line claims is pinned instead
  // by targeted behavioural tests (sources.test.mjs's --refresh --only
  // tests, the --forget test above).
  //
  // Two usage rows are deliberately skipped: the bare `<path>` and `<url>`
  // rows are user-facing shorthand for the skill to translate into
  // `--add <path>` / `--add <url>` - they were never meant to be typed at
  // sources.mjs directly, so running them literally would test a mapping
  // this file does not claim to make. Every OTHER row in the usage block is
  // asserted to consist only of real flags and the `<id>` placeholder,
  // which is what keeps this from silently degrading into a test that only
  // ever checks the two rows that happen to already be flag-only today.
  const body = readFileSync(surfaceFile('commands', 'connect.md'), 'utf8')
  const usageStart = body.indexOf('## Usage')
  assert.ok(usageStart !== -1, 'connect.md has no Usage section')
  const block = between(body.slice(usageStart), '```\n', '\n```')
  const lines = block.split('\n').filter((l) => l.startsWith('/voice-and-tone:connect'))
  assert.ok(lines.length >= 5, 'expected the usage block to still list its documented invocations')

  const dir = makeTmpProject({})
  try {
    let literalLines = 0
    for (const line of lines) {
      const rest = line.slice('/voice-and-tone:connect'.length).trim()
      const rawTokens = rest.length ? rest.split(/\s{2,}/)[0].trim().split(/\s+/) : []
      if (!rawTokens.every((t) => t === '<id>' || /^--[a-z][a-z-]*$/.test(t))) continue // <path>/<url> shorthand
      literalLines++
      const tokens = rawTokens.map((t) => (t === '<id>' ? 's01' : t))
      // A line like "--forget <id>" legitimately exits 1 here (no such id in
      // an empty project) - that is a domain error, not a parse failure, and
      // execFileSync throws on any non-zero exit. Only "Unknown option" (the
      // real parser's own rejection message) means the flag itself is bad.
      let out
      try {
        out = execFileSync(
          process.execPath, [surfaceFile('scripts', 'sources.mjs'), '--root', dir, ...tokens],
          { encoding: 'utf8' }
        )
      } catch (error) {
        out = `${error.stdout ?? ''}${error.stderr ?? ''}`
      }
      assert.ok(!/unknown option/i.test(out), `"${line}" is rejected by the real parser`)
    }
    assert.ok(literalLines >= 3, 'expected at least the bare/--ingest/--refresh rows to be checked as literal invocations')
  } finally {
    cleanup(dir)
  }
})

test('init documents --add as implemented, pointing at the script that does it', () => {
  const body = readFileSync(surfaceFile('commands', 'init.md'), 'utf8')
  assert.match(body, /--add/)
  assert.match(body, /sources\.mjs/, 'the promise is now backed by a script')
})

test('the discovery skill tells the model what to do on an escalation', () => {
  const body = readFileSync(surfaceFile('skills', 'voice-discovery', 'references', 'sourcing.md'), 'utf8')
  assert.match(body, /estimated/)
  assert.match(body, /never .*derived/i)
  assert.match(body, /sources\.mjs/)
})
