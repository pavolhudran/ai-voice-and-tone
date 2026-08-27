import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractRtf, extractSubtitles, extractDelimited } from '../scripts/lib/textish.mjs'

test('rtf control words are dropped and text survives', () => {
  const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}
\f0\fs24 Your campaign is scheduled.\par
Nice work.\par}`
  assert.deepEqual(extractRtf(rtf), ['Your campaign is scheduled.', 'Nice work.'])
})

test('rtf hex escapes and unicode escapes decode', () => {
  // \'e9 is e-acute in the ANSI codepage; \u283? is a unicode escape with an
  // ASCII fallback character that must be discarded, not kept.
  assert.deepEqual(extractRtf(String.raw`{\rtf1 caf\'e9\par}`), ['café'])
  assert.deepEqual(extractRtf(String.raw`{\rtf1 \u283?ivot\par}`), ['ěivot'])
})

test('rtf groups marked ignorable are skipped entirely', () => {
  const rtf = String.raw`{\rtf1{\*\generator Word}Real copy.\par}`
  assert.deepEqual(extractRtf(rtf), ['Real copy.'])
})

test('rtf cp1252 hex escapes decode to their real glyph, not a raw control character', () => {
  // Fix round 2, Important 1: RTF_CP1252_HIGH used to cover only 7 of the
  // ~25 defined codepoints in the 0x80-0x9F range; everything else fell
  // through to String.fromCharCode(code), emitting the raw C1 control byte.
  // These are exactly the coordinator's reproduction cases - an ellipsis, a
  // trademark sign, a euro sign, and a dagger, all common in brand copy.
  assert.deepEqual(extractRtf(String.raw`{\rtf1 Wait for it\'85\par}`), ['Wait for it…'])
  assert.deepEqual(extractRtf(String.raw`{\rtf1 Acme\'99\par}`), ['Acme™'])
  assert.deepEqual(extractRtf(String.raw`{\rtf1 Costs \'80 50\par}`), ['Costs € 50'])
  assert.deepEqual(extractRtf(String.raw`{\rtf1 Note\'86 here\par}`), ['Note† here'])
})

test('the five cp1252-undefined bytes in 0x80-0x9F are dropped, never emitted as a control character', () => {
  // 0x81, 0x8D, 0x8F, 0x90, 0x9D have no cp1252 glyph. Decided: drop the
  // byte entirely rather than substitute a replacement character, matching
  // this parser's existing convention of discarding rather than keeping a
  // fallback (the \u escape's ASCII fallback character is discarded the
  // same way, a few lines up).
  for (const hex of ['81', '8d', '8f', '90', '9d']) {
    assert.deepEqual(extractRtf(String.raw`{\rtf1 A\'` + hex + String.raw`B\par}`), ['AB'], `0x${hex}`)
  }
})

test('vtt cues are extracted and timing lines dropped', () => {
  const vtt = [
    'WEBVTT', '', '1', '00:00:01.000 --> 00:00:04.000',
    'Welcome to the session.', '', '2', '00:00:04.500 --> 00:00:07.000',
    'We keep things short.', ''
  ].join('\n')
  assert.deepEqual(extractSubtitles(vtt), ['Welcome to the session.', 'We keep things short.'])
})

test('srt cues are extracted and a multi-line cue becomes one string', () => {
  const srt = [
    '1', '00:00:01,000 --> 00:00:04,000',
    'Welcome to the session,', 'and thanks for joining.', ''
  ].join('\n')
  assert.deepEqual(extractSubtitles(srt), ['Welcome to the session, and thanks for joining.'])
})

test('vtt cue settings and speaker tags do not leak into the text', () => {
  const vtt = [
    'WEBVTT', '', '00:00:01.000 --> 00:00:04.000 align:start position:10%',
    '<v Speaker>Hello there</v>', ''
  ].join('\n')
  assert.deepEqual(extractSubtitles(vtt), ['Hello there'])
})

test('multi-line NOTE and STYLE blocks are swallowed whole, not just their opening line', () => {
  // Fix round 2, Important 2: only the opening line was recognised, so
  // continuation lines - including a whole multi-line CSS block - fell
  // straight through into cue text.
  const vtt = [
    'WEBVTT',
    'NOTE', 'This is a comment.', 'Still part of the note.', '',
    'STYLE', '::cue {', '  color: yellow;', '}', '',
    '00:00:01.000 --> 00:00:04.000', 'Real cue text.'
  ].join('\n')
  assert.deepEqual(extractSubtitles(vtt), ['Real cue text.'])
})

test('a bare NOTE opener with no trailing space is recognised', () => {
  // startsWith('NOTE ') requires a trailing space, so the spec's primary
  // bare "NOTE" form (a comment with no same-line text) was not recognised
  // as an opener at all.
  const vtt = ['NOTE', 'a comment', '', '00:00:01.000 --> 00:00:02.000', 'Hi.'].join('\n')
  assert.deepEqual(extractSubtitles(vtt), ['Hi.'])
})

test('a NOTE block runs until a blank line even if a real cue follows with none', () => {
  // Per the WebVTT spec, a comment block's body runs until a blank line or
  // end of file - full stop, regardless of what the following lines look
  // like. There is no "this line looks like a cue timing, so end the
  // comment early" special case; a cue with no blank line separating it
  // from a preceding NOTE is, per spec, still inside that comment's body.
  const vtt = ['NOTE', 'This is a comment.', '00:00:01.000 --> 00:00:04.000', 'Real cue text.'].join('\n')
  assert.deepEqual(extractSubtitles(vtt), [])
})

test('a named (non-numeric) cue identifier is dropped, not kept as text', () => {
  // CUE_INDEX only matched a bare number, so a named identifier like
  // "intro-cue" leaked into the corpus as if it were cue text. WebVTT
  // allows any non-blank identifier line that does not contain "-->".
  const vtt = ['intro-cue', '00:00:01.000 --> 00:00:02.000', 'Hello.'].join('\n')
  assert.deepEqual(extractSubtitles(vtt), ['Hello.'])
})

test('delimited files yield cell values, not the numbers between them', () => {
  const csv = 'name,label,count\nsave,Save changes,12\ncancel,Discard and close,3\n'
  assert.deepEqual(
    extractDelimited(csv, ','),
    ['name', 'label', 'count', 'save', 'Save changes', 'cancel', 'Discard and close']
  )
})

test('quoted csv cells containing the delimiter stay whole', () => {
  const csv = 'a,b\n"Save, then close",Discard\n'
  assert.deepEqual(extractDelimited(csv, ','), ['a', 'b', 'Save, then close', 'Discard'])
})

test('tab-separated files work through the same path', () => {
  assert.deepEqual(extractDelimited('one\ttwo\n', '\t'), ['one', 'two'])
})
