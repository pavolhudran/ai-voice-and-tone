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
