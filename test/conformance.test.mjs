import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, lstatSync, existsSync, cpSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeTmpProject, cleanup } from './helpers/tmp.mjs'
import { toAscii } from '../scripts/lib/cli.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// D1: derived, never listed. A hardcoded array silently stops help-checking the
// day a sixth script lands, which is the stale-list defect this codebase keeps
// producing.
const SCRIPTS = readdirSync(path.join(root, 'scripts'))
  .filter((name) => name.endsWith('.mjs'))
  .sort()

// The global constraints bind the procedures written into skill, command, and
// agent markdown just as hard as they bind the scripts - those files are plugin
// logic executed by a model, and markdown telling a model to `grep` is the most
// likely place for the violation, since no linter catches it.
const LOGIC_DIRS = ['scripts', 'skills', 'commands', 'agents']
const LOGIC_FILE = /\.(mjs|md)$/

function walkPlugin (dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.tmp', '.superpowers', '.remember', 'vendor'].includes(entry.name)) continue
    const abs = path.join(dir, entry.name)
    out.push(abs)
    if (entry.isDirectory()) walkPlugin(abs, out)
  }
  return out
}

function walkPluginLogic () {
  const out = []
  for (const dir of LOGIC_DIRS) {
    for (const abs of walkPlugin(path.join(root, dir))) {
      if (LOGIC_FILE.test(abs)) out.push(abs)
    }
  }
  return out
}

// The scripts that ship as plugin logic, .mjs only - vendor/ is already
// pruned out of walkPlugin above, so this only ever names our own code.
function allPluginScripts () {
  return walkPluginLogic().filter((abs) => abs.endsWith('.mjs'))
}

test('the conformance walk actually reaches every directory holding plugin logic', () => {
  // Without this, extending the walks below is unfalsifiable: a walk that
  // silently visits nothing passes every assertion in every loop it feeds.
  const visited = new Set(walkPluginLogic())
  const mustSee = [
    path.join(root, 'scripts', 'validate.mjs'),
    path.join(root, 'scripts', 'lib', 'kb.mjs'),
    path.join(root, 'skills', 'voice-and-tone', 'SKILL.md'),
    path.join(root, 'skills', 'voice-and-tone', 'references', 'write-flow.md'),
    path.join(root, 'commands', 'write.md'),
    path.join(root, 'agents', 'voice-critic.md')
  ]
  for (const abs of mustSee) {
    assert.ok(visited.has(abs), `the logic walk never visits ${path.relative(root, abs)}`)
  }
  assert.ok(SCRIPTS.length >= 5, `expected the five shipped scripts, found ${SCRIPTS.length}`)
})

test('no symlinks anywhere in the plugin tree', () => {
  for (const abs of walkPlugin()) {
    assert.ok(!lstatSync(abs).isSymbolicLink(), `${path.relative(root, abs)} is a symlink`)
  }
})

test('plugin logic never shells out to unix text tools', () => {
  const forbidden = /\b(?:grep|sed|awk|find|cat)\s+-|\bexecSync\(|\bchild_process\b/
  for (const abs of walkPluginLogic()) {
    if (abs.endsWith(path.join('scripts', 'vendor.mjs'))) continue // the one exception, by design
    const source = readFileSync(abs, 'utf8')
    assert.ok(!forbidden.test(source), `${path.relative(root, abs)} shells out or uses a unix text tool`)
  }
})

test('plugin logic never uses the newer built-in dirname shorthand on import.meta', () => {
  // That shorthand needs Node >= 20.11. package.json's "engines" (and
  // test/manifest.test.mjs, which pins it) declare a floor of >= 18.13, where
  // the shorthand is undefined and the next path.join(undefined, ...) throws
  // - a real crash for a user on the declared floor, not a style nit. Four
  // scripts reached for it anyway (fixed alongside this sweep); this postdates
  // that fix and exists so the next file that needs a directory path cannot
  // silently reintroduce the same crash. The portable replacement is
  // path.dirname(fileURLToPath(import.meta.url)).
  for (const abs of allPluginScripts()) {
    const source = readFileSync(abs, 'utf8')
    assert.ok(!source.includes('import.meta.dirname'),
      `${path.relative(root, abs)} uses import.meta.dirname (needs Node >= 20.11); ` +
      'use path.dirname(fileURLToPath(import.meta.url)) to stay on the declared >= 18.13 floor')
  }
})

test('plugin logic builds paths with path.join, never by concatenating a separator', () => {
  const concatenated = /['"`]\s*\+\s*['"`]\/|\/['"`]\s*\+\s*(?!\/)/
  for (const abs of walkPluginLogic()) {
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

test('no file in the plugin tree carries a literal control character', () => {
  // The same defect class as the BOM guard above, and it has landed in this
  // project three times: a source line needs a non-printable sentinel (a
  // delimiter no real text will contain), someone's editor or shell
  // collapses the intended \u00XX escape into the raw byte, and it is
  // invisible in review - a diff shows nothing, and it's invisible in every
  // editor, because it renders exactly one narrow control-picture glyph
  // wide either way. Tab, LF and CR are legitimate file content and are
  // covered by the CRLF test above, so they are excluded here.
  for (const abs of walkPlugin()) {
    if (lstatSync(abs).isDirectory()) continue
    if (!/\.(mjs|md|json|yml|yaml)$/.test(abs)) continue
    const bytes = readFileSync(abs)
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]
      const isControl = byte < 0x20 && byte !== 0x09 && byte !== 0x0A && byte !== 0x0D
      assert.ok(!isControl, `${path.relative(root, abs)} contains a literal control byte (0x${byte.toString(16).padStart(2, '0')}) at byte ${i}`)
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

test('walkPlugin skips gitignored scratch trees but still visits real plugin dot-directories', () => {
  // F58: the exclusion list names .superpowers and .remember explicitly rather
  // than skipping every dot-directory - a blanket dotdir rule would also skip
  // .claude-plugin/, which holds plugin.json and is real shipped plugin content.
  // This pins that distinction so a future "just skip dotdirs" refactor fails
  // loudly instead of silently narrowing what the conformance suite checks.
  const visited = walkPlugin()
  assert.ok(
    visited.includes(path.join(root, '.claude-plugin', 'plugin.json')),
    'walkPlugin must still visit .claude-plugin/plugin.json'
  )
  for (const abs of visited) {
    assert.ok(
      !abs.includes(`${path.sep}.superpowers${path.sep}`) && !abs.endsWith(`${path.sep}.superpowers`),
      `walkPlugin must not descend into .superpowers, found ${path.relative(root, abs)}`
    )
  }
})

test('toAscii normalizes a non-breaking space to a regular space, not a question mark', () => {
  // F57: the NBSP entry in cli.mjs's TYPOGRAPHIC table was a dead no-op
  // (pattern and replacement both an ordinary space). A real NBSP fell
  // through to the blanket [^\x00-\x7F] replace and became '?'.
  const input = 'a\u00A0b'
  const output = toAscii(input)
  assert.equal(output, 'a b')
  assert.ok(!output.includes('?'), 'a non-breaking space must not degrade to a question mark')
})

const VENDOR = 'vendor'

test('only the vendoring tool may use npm or a child process', () => {
  for (const file of allPluginScripts()) {
    if (file.includes(VENDOR)) continue
    if (file.endsWith(path.join('scripts', 'vendor.mjs'))) continue // the one exception, by design
    const body = readFileSync(file, 'utf8')
    assert.ok(
      !/child_process|execSync|execFileSync|spawnSync/.test(body),
      `${file} spawns a process; only scripts/vendor.mjs may, and it never runs on a user machine`
    )
  }
})

test('a knowledge base with no speakers is byte-identical across the compiler, the validator, and both status renderers', () => {
  // The invariant every task in the speaker-profiles plan promised
  // (.superpowers/plans/2026-09-10-speaker-profiles.md, Global Constraints).
  // The expected outputs were captured from the commit before that plan's
  // first task and live beside the fixture; regenerate them ONLY from that
  // commit, never from a later one, or the test would pin whatever the last
  // change happened to produce.
  const fixture = path.join(root, 'test', 'fixtures', 'house-only')
  const expectedDir = path.join(fixture, '_expected')
  const dir = makeTmpProject({ 'content/a.md': '# A\n\nWe leverage it. One thing worth knowing.\n' })
  try {
    const kbRoot = path.join(dir, '.voice-and-tone')
    cpSync(fixture, kbRoot, { recursive: true, filter: (src) => !src.includes('_expected') })
    const NOW = '2026-09-10T00:00:00.000Z'
    const run = (script, args) => execFileSync(
      process.execPath, [path.join(root, 'scripts', script), '--root', dir, '--now', NOW, ...args], { encoding: 'utf8' }
    )
    const expected = (name) => readFileSync(path.join(expectedDir, name), 'utf8')
    // The screen truncates a long kb path before any substitution could
    // reach it, so that one line is normalised on both sides.
    const normalise = (text) => text
      .split(dir).join('<root>')
      .replace(/^(\s+kb path\s+).*$/m, '$1<kb path>')

    run('scan.mjs', [])
    run('fingerprint.mjs', ['--set-baseline'])
    run('compile-context.mjs', [])
    assert.equal(readFileSync(path.join(kbRoot, 'CONTEXT.md'), 'utf8'), expected('CONTEXT.md'))

    let validateOut
    try { validateOut = run('validate.mjs', []) } catch (error) { validateOut = error.stdout }
    assert.equal(validateOut, expected('validate.txt'))

    assert.equal(normalise(run('status.mjs', [])), normalise(expected('status.txt')))

    run('status.mjs', ['--artifact', '--out', path.join(dir, 'status.html')])
    assert.equal(normalise(readFileSync(path.join(dir, 'status.html'), 'utf8')), expected('status.html'))
  } finally {
    cleanup(dir)
  }
})
