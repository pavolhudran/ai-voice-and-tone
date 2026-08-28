import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdirSync, cpSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { writeTextFile } from './lib/fsx.mjs'
import { sha256File } from './lib/hash.mjs'
import { parseCliArgs, writeOut, die, printHelp } from './lib/cli.mjs'

/**
 * Regenerate vendor/ from pinned upstream versions.
 *
 * MAINTAINER TOOL ONLY. This is the single file in the repository allowed to
 * use child_process or npm, because it never runs on a user's machine - its
 * committed output does. The conformance sweep excludes it for that reason and
 * that reason alone.
 *
 * Bump a version here, run `npm run vendor`, review the diff, commit. The
 * manifest's hashes are what let test/vendor.test.mjs prove the committed
 * bytes are the bytes this script produced.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const VENDOR = path.join(ROOT, 'vendor')
const WORK = path.join(VENDOR, '.work')

const PINNED = {
  'pdfjs-dist': {
    version: '4.10.38',
    license: 'Apache-2.0',
    source: 'https://github.com/mozilla/pdf.js',
    // The legacy build is the one that runs under plain Node without a DOM.
    copy: [
      ['legacy/build/pdf.min.mjs', 'pdfjs/pdf.min.mjs'],
      ['legacy/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs'],
      ['LICENSE', 'pdfjs/LICENSE']
    ]
  },
  officeparser: {
    version: '7.8.0',
    license: 'MIT',
    source: 'https://github.com/harshankur/officeParser',
    bundle: {
      entry: "module.exports = require('officeparser')",
      out: 'officeparser/officeparser.cjs',
      // tesseract.js is OCR - the model tier's job here, and 100+ MB.
      // pdfjs-dist is vendored separately and used directly.
      external: ['tesseract.js', 'pdfjs-dist', 'canvas', 'sharp']
    },
    copy: [['LICENSE', 'officeparser/LICENSE']]
  }
}

function npmInstall (name, version) {
  mkdirSync(WORK, { recursive: true })
  writeTextFile(path.join(WORK, 'package.json'), JSON.stringify({ private: true }, null, 2))
  execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', `${name}@${version}`], {
    cwd: WORK, stdio: 'inherit'
  })
  return path.join(WORK, 'node_modules', name)
}

function main (argv) {
  const { values } = parseCliArgs(argv)
  if (values.help) {
    printHelp('scripts/vendor.mjs', [
      'Regenerates vendor/ from the pinned upstream versions in this file.',
      'Maintainer tool only - it shells out to npm and never runs on a user machine.',
      '',
      '  npm run vendor    the only supported invocation'
    ])
    return
  }

  // Remove only what this script owns and regenerates. vendor/ can hold
  // hand-authored files (vendor/README.md) that are not this script's to
  // delete, so a full rmSync(VENDOR, ...) is deliberately not used here.
  for (const owned of ['pdfjs', 'officeparser', 'manifest.json']) {
    rmSync(path.join(VENDOR, owned), { recursive: true, force: true })
  }
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(VENDOR, { recursive: true })
  const libraries = {}

  for (const [name, spec] of Object.entries(PINNED)) {
    writeOut(`vendor: installing ${name}@${spec.version}\n`)
    const installed = npmInstall(name, spec.version)

    const actual = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8')).version
    if (actual !== spec.version) die(`${name} resolved to ${actual}, expected ${spec.version}`)

    for (const [from, to] of spec.copy ?? []) {
      const src = path.join(installed, from)
      if (!existsSync(src)) die(`${name}: ${from} not found upstream`)
      mkdirSync(path.dirname(path.join(VENDOR, to)), { recursive: true })
      cpSync(src, path.join(VENDOR, to))
    }

    if (spec.bundle) {
      const entry = path.join(WORK, `entry-${name}.cjs`)
      writeTextFile(entry, spec.bundle.entry)
      const out = path.join(VENDOR, spec.bundle.out)
      mkdirSync(path.dirname(out), { recursive: true })
      execFileSync('npx', [
        'esbuild', entry, '--bundle', '--platform=node', '--format=cjs', '--minify',
        ...spec.bundle.external.map((e) => `--external:${e}`),
        `--outfile=${out}`, '--log-level=error'
      ], { cwd: WORK, stdio: 'inherit' })
    }

    const files = {}
    for (const [, to] of spec.copy ?? []) files[to] = sha256File(path.join(VENDOR, to))
    if (spec.bundle) files[spec.bundle.out] = sha256File(path.join(VENDOR, spec.bundle.out))

    libraries[name] = { version: spec.version, license: spec.license, source: spec.source, files }
  }

  rmSync(WORK, { recursive: true, force: true })
  writeTextFile(path.join(VENDOR, 'manifest.json'), `${JSON.stringify({ libraries }, null, 2)}\n`)
  writeOut('vendor: wrote vendor/manifest.json\n')
}

// Run main only when invoked as a script, so tests can import this module freely.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }
