import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { toAscii } from '../scripts/lib/cli.mjs'

// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\x00-\x7F]/

test('output stays ASCII, which is the rule the whole function exists for', () => {
  for (const sample of ['Klidný', 'Łódź', '日本語', 'naïve — “quoted”', '🚀']) {
    assert.ok(!NON_ASCII.test(toAscii(sample)), `leaked non-ASCII for ${sample}`)
  }
})

test('diacritics are transliterated to their base letter, not blanked', () => {
  assert.equal(toAscii('Klidný · Vykání s blízkostí · Vděčný'), 'Klidny * Vykani s blizkosti * Vdecny')
  assert.equal(toAscii('VYČISTĚTE MYSL, VYPOŤTE STRES'), 'VYCISTETE MYSL, VYPOTTE STRES')
  assert.equal(toAscii('RBP_masáže-miminek.txt'), 'RBP_masaze-miminek.txt')
})

test('transliteration covers the Latin-script locales the plugin claims to serve', () => {
  assert.equal(toAscii('Łódź'), 'Lodz')          // pl
  assert.equal(toAscii('Straße'), 'Strase')      // de
  assert.equal(toAscii('smørrebrød'), 'smorrebrod') // da
  assert.equal(toAscii('Ștefan'), 'Stefan')      // ro
  assert.equal(toAscii('İstanbul'), 'Istanbul')  // tr
})

test('transliteration preserves width, because padding happens before this runs', () => {
  // Renderers pad to a column width and only then hand the line to toAscii.
  // A substitution that changes length shifts the box border on that row and
  // every alignment below it. This is why the ss-sharp maps to 's' and not
  // the linguistically better 'ss'.
  const samples = [
    'Klidný · Vykání s blízkostí · Vděčný',
    'VYČISTĚTE MYSL, VYPOŤTE STRES, DOSYŤTE DUŠI.',
    'Łódź Straße Øre Þór ıi æther œuvre',
    'naïve “quoted” cañón',
    '日本語 🚀'
  ]
  for (const sample of samples) {
    assert.equal(toAscii(sample).length, sample.length, `width changed for: ${sample}`)
  }
})

test('the ellipsis expands, and the renderer is what accounts for it', () => {
  // The one substitution here that is not one-to-one. It is not "fixed" by
  // shrinking it - three periods is the right rendering - it is handled by
  // render.mjs measuring the FOLDED string, so nothing is ever padded to a
  // width the fold then changes. See `measurable` there.
  assert.equal(toAscii('a…b'), 'a...b')
  assert.equal(toAscii('a…b').length, 'a…b'.length + 2)
})

test('characters with no Latin base still fall through to a question mark', () => {
  // Honest: there is no width-preserving Latin answer for these.
  assert.equal(toAscii('日本語'), '???')
  assert.match(toAscii('ok 日 ok'), /ok \? ok/)
})

test('typographic punctuation is normalised before transliteration', () => {
  assert.equal(toAscii('“smart” ‘quotes’'), '"smart" \'quotes\'')
  assert.equal(toAscii('em — dash'), 'em - dash')
  assert.equal(toAscii('a…b'), 'a...b')
})

// --- F12: a reader that goes away must not produce a stack trace

test('a closed pipe ends the process quietly instead of crashing', () => {
  // Node reports a broken pipe as an asynchronous 'error' event on the stream,
  // not as a throw from write(), so a try/catch around the write does not
  // catch it. With no listener it became an unhandled exception, and piping a
  // status screen into `head` printed a Node stack trace where the user
  // expected truncated output.
  const script = `
    import { writeOut } from ${JSON.stringify(new URL('../scripts/lib/cli.mjs', import.meta.url).href)}
    for (let i = 0; i < 20000; i++) writeOut('line ' + i + '\\n')
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // A tiny maxBuffer makes the parent stop reading, closing the pipe early.
    maxBuffer: 1024
  })

  assert.ok(!/EPIPE/.test(result.stderr ?? ''), `stderr should carry no EPIPE trace, got: ${result.stderr}`)
  assert.ok(!/Unhandled|throw er/.test(result.stderr ?? ''), `no unhandled exception, got: ${result.stderr}`)
})
