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
