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
